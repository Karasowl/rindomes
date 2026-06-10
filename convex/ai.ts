"use node";

import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { action } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

// ============================================================================
// The enforceable, gated AI capture seam. parseReceiptWithAI is a Node action
// (it needs `fetch` + Buffer). ALL entitlement gating happens BEFORE any model
// call, so a free / AI-off / out-of-credits household never reaches the model.
//
// Provider: OpenRouter (OpenAI-compatible). Two-tier model strategy:
//   1) try the FREE vision model first (OPENROUTER_MODEL_FREE)
//   2) if it fails (rate limit / busy / inaccessible / unparseable / etc.),
//      fall back to the PAID model (OPENROUTER_MODEL_PAID) using the account's
//      credit.
// Every failure is CLASSIFIED (429 limit, 402 no credit, 404 unavailable, 5xx
// provider down, network, unreadable output...) and reported back so the UI can
// tell the user exactly what happened and why. If BOTH tiers fail, the client
// falls back to the local heuristic and shows the combined reason.
//
// Result shape mirrors AiCaptureResult in src/lib/entitlement.ts.
// ============================================================================

const TRANSACTION_TYPES = [
  "income",
  "expense",
  "transfer",
  "debt_payment",
  "saving",
  "investment",
  "refund",
] as const;
const CURRENCIES = ["DOP", "USD", "MXN", "EUR"] as const;

const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
// Defaults verified live on OpenRouter (jun 2026). Both overridable by env so the
// model can be swapped without a code change.
const DEFAULT_FREE_MODEL = "nvidia/nemotron-nano-12b-v2-vl:free";
const DEFAULT_PAID_MODEL = "qwen/qwen3-vl-30b-a3b-instruct";

type Suggestion = {
  type: (typeof TRANSACTION_TYPES)[number];
  amount: string;
  currency: (typeof CURRENCIES)[number];
  categoryId: string;
  subcategory: string;
  accountId: string;
  description: string;
  merchant: string;
  tags: string;
  note: string;
  confidence: number;
  reasons: string[];
  needsReview: boolean;
};

type ReceiptExtraction = {
  suggestion: Suggestion;
  isReceipt: boolean;
  discountText?: string;
  receiptDate?: string;
  // Transient structured line items (one per product line). Folded into
  // Transaction.lineItems on approve; `note` stays as the human summary.
  items?: { name: string; quantity: number; amount: string }[];
};

type AiCaptureResult =
  | {
      ok: true;
      extraction: ReceiptExtraction;
      provider: "openrouter";
      usedModel: string;
      usedTier: "free" | "paid";
      notice?: string;
    }
  | {
      ok: false;
      code: "not_entitled" | "no_credits" | "ai_failed" | "bad_file" | "ai_off";
      error: string;
    };

export const parseReceiptWithAI = action({
  args: { householdId: v.id("households"), attachmentId: v.id("attachments") },
  handler: async (ctx, { householdId, attachmentId }): Promise<AiCaptureResult> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return { ok: false, code: "not_entitled", error: "Inicia sesión para usar la captura con IA." };
    }

    // --- GATE: everything below runs before any model call. ---
    let entitlement;
    try {
      entitlement = await ctx.runQuery(api.entitlement.getEntitlement, { householdId });
    } catch {
      return { ok: false, code: "ai_failed", error: "No se pudo verificar tu suscripción." };
    }
    if (!entitlement.aiEnabled) {
      return { ok: false, code: "ai_off", error: "La IA está desactivada para este hogar. Actívala en Ajustes." };
    }
    if (!entitlement.canUseAi) {
      return { ok: false, code: "not_entitled", error: "La captura con IA es parte del plan Pro." };
    }
    if (entitlement.aiCreditsUsed >= entitlement.aiCreditsLimit) {
      return { ok: false, code: "no_credits", error: "Agotaste tus créditos de IA de este mes." };
    }

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      return { ok: false, code: "ai_failed", error: "La IA externa no está configurada (falta OPENROUTER_API_KEY)." };
    }

    // --- Load the attachment + the household's catalogs (for the id enums). ---
    const context = await ctx.runQuery(internal.entitlement.captureContext, { householdId, attachmentId });
    if (!context) {
      return { ok: false, code: "bad_file", error: "El recibo ya no existe." };
    }
    if (!context.storageId) {
      return { ok: false, code: "bad_file", error: "El recibo no tiene un archivo asociado." };
    }
    if (!context.categories.length || !context.accounts.length) {
      return { ok: false, code: "bad_file", error: "Faltan categorías o cuentas para clasificar el recibo." };
    }

    // --- Read the blob and encode as base64. ---
    let base64: string;
    try {
      const blob = await ctx.storage.get(context.storageId as Id<"_storage">);
      if (!blob) {
        return { ok: false, code: "bad_file", error: "No se pudo leer el archivo del recibo." };
      }
      const buffer = await blob.arrayBuffer();
      base64 = Buffer.from(buffer).toString("base64");
    } catch {
      return { ok: false, code: "ai_failed", error: "No se pudo leer el archivo del recibo." };
    }

    const contentType = context.contentType || "application/octet-stream";
    const isPdf = contentType === "application/pdf";
    const isImage = contentType.startsWith("image/");
    if (!isPdf && !isImage) {
      return { ok: false, code: "bad_file", error: "Formato no soportado: sube una imagen o un PDF del recibo." };
    }

    // OpenAI-compatible content part: image_url for images, file for PDFs.
    const dataUrl = `data:${isPdf ? "application/pdf" : contentType};base64,${base64}`;
    const fileBlock = isPdf
      ? { type: "file", file: { filename: context.fileName || "recibo.pdf", file_data: dataUrl } }
      : { type: "image_url", image_url: { url: dataUrl } };

    const categoryIds: string[] = context.categories.map((c: { id: string }) => c.id);
    const accountIds: string[] = context.accounts.map((a: { id: string }) => a.id);

    // No response_format: we keep the request portable across the varied free/paid
    // vision models (Nemotron, Gemma, Qwen…). Reliability comes from an explicit
    // JSON contract in the prompt + a tolerant parser + server-side validation.
    const systemPrompt = [
      "Eres el extractor financiero de RindoMes. Analiza la imagen o PDF (recibo, factura o nota) y extrae UNA sola transacción.",
      "Responde EXCLUSIVAMENTE con un objeto JSON válido, sin texto antes ni después, sin comentarios y sin ```.",
      "REGLAS CRÍTICAS:",
      "- amount = el TOTAL real de la compra (lo que costó). NUNCA uses el EFECTIVO/efectivo entregado, ni el método de pago, ni el CAMBIO/vuelto. Si ves TOTAL y EFECTIVO con valores distintos, usa SIEMPRE el TOTAL. Si solo hay líneas de productos sin total, súmalas. Verifica: total ≈ suma de productos (+ impuestos). Decimal sin símbolos (ej. \"377.00\").",
      "- receiptDate = la FECHA IMPRESA en el recibo, NO la fecha de hoy. Formato YYYY-MM-DD (convierte DD/MM/AAAA si hace falta). Déjala vacía solo si de verdad no aparece.",
      `- currency = detéctala del propio recibo por PAÍS, no por el símbolo. OJO: '$' por sí solo NO es USD — en México y República Dominicana el peso también usa '$'. Decide por RFC/IVA/dirección/ciudad: RFC o IVA o CDMX o "Estado de México" => MXN; RNC o RD$ => DOP; € => EUR; USD SOLO si el recibo es claramente de EE.UU. (US$, dirección en USA). Debe ser una de: ${CURRENCIES.join(", ")}. NO asumas ninguna por defecto ni te dejes llevar por el '$'.`,
      "- merchant = el nombre del negocio EXACTAMENTE como aparece impreso en el recibo (LITERAL, verbatim). NO lo acortes, NO quites sufijos legales/fiscales (S.A. de C.V., etc.), NO corrijas ni interpretes, y NO conviertas números a palabras ni palabras a números (si imprime \"3B\" pon \"3B\"; si imprime \"Tres B\" pon \"Tres B\"). Cópialo tal cual: es una clave estable para agrupar; el usuario le pondrá un apodo aparte.",
      "- description = resumen breve y genérico de la compra (ej. \"Compra · 11 productos\"). No metas el nombre legal aquí.",
      "- note = el DESGLOSE de productos, uno por línea, con el nombre del producto HUMANIZADO: interpreta las abreviaturas a un nombre comercial legible (ej. \"CopaHelad\"=>\"Copa helada\", \"7Up2.5L\"=>\"7Up 2.5L\", \"TartaMile\"=>\"Tarta milhojas\", \"McCorn390\"=>\"McCormick 390g\", \"AteDonVas\"=>\"Ate Don Vasco\"). Formato por línea: \"Cant x Nombre — precio\". Añade el IVA/ITBIS si aparece.",
      "- items = la versión ESTRUCTURADA del desglose: un array con un objeto por línea de producto, cada uno con { name (nombre comercial HUMANIZADO, igual que en note), quantity (número; usa 1 si no se indica), amount (decimal en string, el TOTAL de esa línea = precio unitario x cantidad, sin símbolos, ej. \"125.50\") }. Deja items como array vacío [] si no hay líneas de productos legibles. note sigue siendo el resumen humano; items es la versión para procesar.",
      "- categoryId = EXACTAMENTE uno de los ids de categoría dados; nunca inventes. Elige la más adecuada.",
      "- accountId = EXACTAMENTE uno de los ids de cuenta dados; nunca inventes.",
      `- type = uno de ${TRANSACTION_TYPES.join(", ")} (una compra normal es \"expense\").`,
      "- subcategory (string), tags (string separada por comas), discountText (string; vacío si no hay), isReceipt (boolean), confidence (0..1), reasons (array de strings), needsReview (boolean: true si dudas del total o la fecha).",
      "Devuelve TODAS estas claves exactamente: isReceipt, type, amount, currency, categoryId, subcategory, accountId, description, merchant, tags, note, items, confidence, reasons, needsReview, discountText, receiptDate.",
      "Si no es un recibo, isReceipt=false, baja la confianza y needsReview=true.",
    ].join("\n");

    const catalogText = JSON.stringify({
      categorias: context.categories,
      cuentas: context.accounts,
      textoExtraido: context.extractedText ?? undefined,
    });

    const messages = [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: [
          fileBlock,
          { type: "text", text: "Clasifica este recibo. Usa exclusivamente estos ids:\n" + catalogText },
        ],
      },
    ];

    // --- Attempt FREE first, then PAID. Dedup if the same model is configured. ---
    const freeModel = process.env.OPENROUTER_MODEL_FREE ?? DEFAULT_FREE_MODEL;
    const paidModel = process.env.OPENROUTER_MODEL_PAID ?? process.env.OPENROUTER_MODEL ?? DEFAULT_PAID_MODEL;
    const candidates: Array<{ model: string; tier: "free" | "paid" }> = [
      { model: freeModel, tier: "free" },
      { model: paidModel, tier: "paid" },
    ];
    const plan = candidates.filter((m, i, arr) => arr.findIndex((x) => x.model === m.model) === i);

    const attempts: Array<{ model: string; tier: "free" | "paid"; reason: string }> = [];

    for (const { model, tier } of plan) {
      const outcome = await tryModel({ apiKey, model, messages, categoryIds, accountIds });
      if (outcome.ok) {
        // Commit a credit + record the action atomically (re-checks credits).
        const committed = await ctx.runMutation(internal.entitlement.commitAiCapture, {
          householdId,
          inputPreview: `Recibo: ${context.fileName} · modelo: ${model}`,
          outputSummary: `${outcome.extraction.suggestion.merchant || outcome.extraction.suggestion.description} · ${outcome.extraction.suggestion.amount} ${outcome.extraction.suggestion.currency}`,
        });
        if (!committed) {
          return { ok: false, code: "no_credits", error: "Agotaste tus créditos de IA de este mes." };
        }
        const notice =
          attempts.length > 0
            ? `El modelo gratis no funcionó (${attempts[0].reason}); se usó el de pago (${model}).`
            : undefined;
        return { ok: true, extraction: outcome.extraction, provider: "openrouter", usedModel: model, usedTier: tier, notice };
      }
      attempts.push({ model, tier, reason: outcome.reason });
    }

    const error =
      "La IA no pudo leer el recibo. " +
      attempts
        .map((a) => `${a.tier === "free" ? "Modelo gratis" : "Modelo de pago"} (${a.model}): ${a.reason}`)
        .join(" · ");
    return { ok: false, code: "ai_failed", error };
  },
});

// --- One model attempt. Returns the extraction or a CLASSIFIED failure reason. ---
async function tryModel(opts: {
  apiKey: string;
  model: string;
  messages: unknown[];
  categoryIds: string[];
  accountIds: string[];
}): Promise<{ ok: true; extraction: ReceiptExtraction } | { ok: false; reason: string }> {
  const { apiKey, model, messages, categoryIds, accountIds } = opts;

  let response: Response;
  try {
    response = await fetch(OPENROUTER_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://rindomes.vercel.app",
        "X-Title": "RindoMes",
      },
      body: JSON.stringify({ model, max_tokens: 1500, messages }),
    });
  } catch {
    return { ok: false, reason: "no se pudo conectar al servicio de IA" };
  }

  if (!response.ok) {
    let detail = "";
    try {
      const body = await response.json();
      detail = body?.error?.message ?? "";
    } catch {
      // ignore unreadable error body
    }
    return { ok: false, reason: classifyStatus(response.status, detail) };
  }

  let payload: any;
  try {
    payload = await response.json();
  } catch {
    return { ok: false, reason: "respuesta ilegible del servicio" };
  }

  // OpenRouter sometimes returns HTTP 200 with an embedded error (upstream issue).
  if (payload?.error) {
    return { ok: false, reason: classifyStatus(Number(payload.error.code) || 0, String(payload.error.message ?? "")) };
  }

  const parsed = parseContentJson(payload);
  if (!parsed) {
    return { ok: false, reason: "el modelo no devolvió un JSON legible" };
  }
  const extraction = normalizeExtraction(parsed, categoryIds, accountIds);
  if (!extraction) {
    return { ok: false, reason: "los datos extraídos no fueron válidos (categoría/cuenta/monto)" };
  }
  return { ok: true, extraction };
}

// --- Human-readable, specific failure reasons (the "informa bien claro" rule). ---
function classifyStatus(status: number, detail: string): string {
  const d = detail ? ` — ${detail}` : "";
  if (status === 429) return `límite alcanzado o modelo saturado (429)${d}`;
  if (status === 402) return `sin crédito en OpenRouter (402)${d}`;
  if (status === 401 || status === 403) return `clave inválida o sin permiso para el modelo (${status})${d}`;
  if (status === 404) return `modelo no disponible o no encontrado (404)${d}`;
  if (status === 408) return `tiempo de espera agotado (408)${d}`;
  if (status >= 500) return `el proveedor del modelo falló temporalmente (${status})${d}`;
  if (status > 0) return `error ${status}${d}`;
  return `error desconocido del servicio${d}`;
}

// --- Pull the JSON object out of an OpenAI-compatible chat completion. The
// content may be a JSON string, an array of parts, JSON wrapped in ``` fences, or
// JSON with surrounding prose. Returns null on anything unparseable. ---
function parseContentJson(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== "object") return null;
  const choices = (payload as Record<string, unknown>).choices;
  if (!Array.isArray(choices) || !choices.length) return null;
  const message = (choices[0] as Record<string, unknown>)?.message as Record<string, unknown> | undefined;
  if (!message) return null;

  let text = "";
  const content = message.content;
  if (typeof content === "string") {
    text = content;
  } else if (Array.isArray(content)) {
    text = content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && typeof (part as Record<string, unknown>).text === "string") {
          return (part as Record<string, unknown>).text as string;
        }
        return "";
      })
      .join("");
  }

  text = text.trim();
  if (!text) return null;

  // Strip ```json fences if present.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) text = fenced[1].trim();

  const tryParse = (s: string): Record<string, unknown> | null => {
    try {
      const parsed = JSON.parse(s);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };

  const direct = tryParse(text);
  if (direct) return direct;

  // Last resort: grab the first {...} object embedded in surrounding prose.
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) {
    return tryParse(text.slice(start, end + 1));
  }
  return null;
}

// --- Coerce/validate the model output into a ReceiptExtraction. Defends against
// a model that ignores the id enums (returns null so the caller tries the next
// model / falls back). ---
function normalizeExtraction(
  input: Record<string, unknown>,
  categoryIds: string[],
  accountIds: string[],
): ReceiptExtraction | null {
  // Accept the strict enum, or map common model synonyms (e.g. "purchase"/"compra" -> "expense").
  const TYPE_SYNONYMS: Record<string, (typeof TRANSACTION_TYPES)[number]> = {
    purchase: "expense", compra: "expense", gasto: "expense", buy: "expense", pago: "expense", payment: "expense",
    ingreso: "income", deposit: "income", deposito: "income",
    transferencia: "transfer",
    refund: "refund", reembolso: "refund", devolucion: "refund",
    saving: "saving", ahorro: "saving",
    investment: "investment", inversion: "investment",
    debt: "debt_payment", deuda: "debt_payment",
  };
  const rawType = String(input.type ?? "").trim().toLowerCase();
  const type = (TRANSACTION_TYPES.includes(rawType as (typeof TRANSACTION_TYPES)[number])
    ? (rawType as (typeof TRANSACTION_TYPES)[number])
    : TYPE_SYNONYMS[rawType]);
  if (!type) return null;
  const currency = String(input.currency ?? "");
  if (!CURRENCIES.includes(currency as (typeof CURRENCIES)[number])) return null;

  const categoryId = String(input.categoryId ?? "");
  const accountId = String(input.accountId ?? "");
  if (!categoryIds.includes(categoryId) || !accountIds.includes(accountId)) return null;

  const reasonsRaw = input.reasons;
  const reasons = Array.isArray(reasonsRaw)
    ? reasonsRaw.filter((r): r is string => typeof r === "string")
    : [];

  const confidenceRaw = typeof input.confidence === "number" ? input.confidence : 0.5;
  const confidence = Math.max(0, Math.min(1, confidenceRaw));

  const suggestion: Suggestion = {
    type: type as (typeof TRANSACTION_TYPES)[number],
    amount: String(input.amount ?? ""),
    currency: currency as (typeof CURRENCIES)[number],
    categoryId,
    subcategory: String(input.subcategory ?? ""),
    accountId,
    description: String(input.description ?? ""),
    merchant: String(input.merchant ?? ""),
    tags: String(input.tags ?? ""),
    note: String(input.note ?? ""),
    confidence,
    reasons,
    needsReview: typeof input.needsReview === "boolean" ? input.needsReview : confidence < 0.75,
  };

  const discountText = typeof input.discountText === "string" ? input.discountText.trim() : "";
  const receiptDate = typeof input.receiptDate === "string" ? input.receiptDate.trim() : "";

  // --- Parse `items` defensively: array of { name, quantity, amount }. Coerce
  // quantity to a finite number (default 1), amount to a decimal string, name to
  // a trimmed string; drop malformed/empty entries; omit `items` if none survive.
  let items: { name: string; quantity: number; amount: string }[] | undefined;
  if (Array.isArray(input.items)) {
    const cleaned = input.items
      .map((raw) => {
        if (!raw || typeof raw !== "object") return null;
        const obj = raw as Record<string, unknown>;
        const name = String(obj.name ?? "").trim();
        if (!name) return null;
        const qtyRaw =
          typeof obj.quantity === "number"
            ? obj.quantity
            : Number(String(obj.quantity ?? "").replace(",", "."));
        const quantity = Number.isFinite(qtyRaw) && qtyRaw > 0 ? qtyRaw : 1;
        const amountRaw = obj.amount;
        const amount =
          typeof amountRaw === "number"
            ? String(amountRaw)
            : String(amountRaw ?? "").trim();
        if (!amount) return null;
        return { name, quantity, amount };
      })
      .filter((it): it is { name: string; quantity: number; amount: string } => it !== null);
    if (cleaned.length) items = cleaned;
  }

  return {
    suggestion,
    isReceipt: typeof input.isReceipt === "boolean" ? input.isReceipt : true,
    discountText: discountText || undefined,
    receiptDate: receiptDate || undefined,
    items,
  };
}
