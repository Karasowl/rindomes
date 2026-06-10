import { NextResponse } from "next/server";
import type { AppState, CurrencyCode, TransactionType } from "@/lib/types";

interface CaptureRequest {
  text?: string;
  apiKey?: string;
  activeMonth?: string;
  currency?: CurrencyCode;
  categories?: Array<Pick<AppState["categories"][number], "id" | "name" | "group" | "subcategories">>;
  accounts?: Array<Pick<AppState["accounts"][number], "id" | "name" | "kind" | "currency">>;
}

const fallbackModel = "gpt-5-mini";
const currencies: CurrencyCode[] = ["DOP", "USD", "MXN", "EUR"];
const transactionTypes: TransactionType[] = ["income", "expense", "transfer", "debt_payment", "saving", "investment", "refund"];

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as CaptureRequest;
  const text = body.text?.trim() ?? "";
  const categories = body.categories?.filter((category) => category.id && category.name) ?? [];
  const accounts = body.accounts?.filter((account) => account.id && account.name) ?? [];

  // BYOK ONLY. Esta ruta Next no tiene sesion de Convex, asi que NUNCA debe
  // consumir creditos del servidor ni otorgar acceso a la IA gestionada. Por eso
  // exige que el cliente envie su propia clave (apiKey) y nunca cae a
  // process.env.OPENAI_API_KEY para llamadas anonimas: de lo contrario cualquiera
  // podria saltarse el gate de entitlement de Convex usando la clave del servidor.
  // La IA gestionada (con gate y creditos) vive en la accion de Convex parseReceiptWithAI.
  const apiKey = body.apiKey?.trim();

  if (!apiKey) {
    return NextResponse.json(
      { error: "Esta ruta solo acepta tu propia clave (BYOK): envia 'apiKey' en el cuerpo. La IA gestionada se usa desde la app." },
      { status: 401 },
    );
  }

  if (!text || !categories.length || !accounts.length) {
    return NextResponse.json({ error: "Faltan texto, categorias o cuentas para clasificar." }, { status: 400 });
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL ?? fallbackModel,
      instructions: [
        "Eres el clasificador financiero de RindoMes para hogares.",
        "Devuelve solo JSON valido con el esquema solicitado.",
        "No inventes categorias ni cuentas: usa exclusivamente los ids recibidos.",
        "Si el texto es ambiguo, baja la confianza y marca needsReview=true.",
        "La descripcion debe preservar el detalle real del gasto, aunque sea incomodo o muy especifico.",
      ].join(" "),
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: JSON.stringify({
                text,
                activeMonth: body.activeMonth,
                baseCurrency: body.currency,
                categories,
                accounts,
              }),
            },
          ],
        },
      ],
      max_output_tokens: 800,
      text: {
        format: {
          type: "json_schema",
          name: "rindomes_capture",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              type: { type: "string", enum: transactionTypes },
              amount: { type: "string", description: "Monto en formato decimal sin simbolos." },
              currency: { type: "string", enum: currencies },
              categoryId: { type: "string", enum: categories.map((category) => category.id) },
              subcategory: { type: "string" },
              accountId: { type: "string", enum: accounts.map((account) => account.id) },
              description: { type: "string" },
              merchant: { type: "string" },
              tags: { type: "string", description: "Etiquetas separadas por coma." },
              note: { type: "string" },
              confidence: { type: "number", minimum: 0, maximum: 1 },
              reasons: { type: "array", items: { type: "string" } },
              needsReview: { type: "boolean" },
            },
            required: ["type", "amount", "currency", "categoryId", "subcategory", "accountId", "description", "merchant", "tags", "note", "confidence", "reasons", "needsReview"],
          },
        },
      },
    }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    return NextResponse.json({ error: openAiError(payload) }, { status: response.status });
  }

  const outputText = extractOutputText(payload);
  if (!outputText) {
    return NextResponse.json({ error: "OpenAI no devolvio una sugerencia legible." }, { status: 502 });
  }

  try {
    return NextResponse.json(JSON.parse(outputText));
  } catch {
    return NextResponse.json({ error: "La sugerencia de OpenAI no vino en JSON valido." }, { status: 502 });
  }
}

function extractOutputText(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const record = payload as Record<string, unknown>;
  if (typeof record.output_text === "string") return record.output_text;
  const output = Array.isArray(record.output) ? record.output : [];

  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = Array.isArray((item as Record<string, unknown>).content) ? (item as Record<string, unknown>).content as unknown[] : [];
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const text = (part as Record<string, unknown>).text;
      if (typeof text === "string") return text;
    }
  }

  return "";
}

function openAiError(payload: unknown) {
  if (!payload || typeof payload !== "object") return "OpenAI rechazo la solicitud.";
  const error = (payload as Record<string, unknown>).error;
  if (!error || typeof error !== "object") return "OpenAI rechazo la solicitud.";
  const message = (error as Record<string, unknown>).message;
  return typeof message === "string" ? message : "OpenAI rechazo la solicitud.";
}
