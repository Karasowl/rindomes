"use client";

// Receipt / note capture flow. Props-only by contract: NO direct convex import — every Convex
// dependency (uploadAttachment, parseReceipt, getReceiptUrl, onSave, onLinkReceipt, onOpenPaywall)
// is injected by the monolith. The owner's rule is "no maqueta":
//   * the file is really uploaded (uploadAttachment returns a real storageId),
//   * AI parsing is real and gated (when aiEnabled but not entitled we open the paywall, we do not parse),
//   * NOTHING is persisted until the user edits and presses "Aprobar y guardar" in the review form.
// When householdId is null (local-only mode) there is no server file storage / AI, so we render the
// manual review path directly from the picked file (filename-only attachment).

import { ArrowLeft, Camera, FileText, Loader2, Plus, Sparkles, Tag, Trash2, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Id } from "../../convex/_generated/dataModel";
import { CameraCapture } from "./camera-capture";
import { analyzeReceiptFile } from "@/lib/ai-client";
import { receiptToInput } from "@/lib/capture-input";
import { type AiCaptureResult, entitlementForAi, type ReceiptExtraction } from "@/lib/entitlement";
import { type ExchangeQuote, quoteExchangeRate } from "@/lib/currency";
import { categoryById, formatMoney, toCents } from "@/lib/finance";
import { useT } from "@/lib/i18n";
import { merchantDisplay, normalizeMerchant, receiptSourceLabel, reviewReasonLabel } from "@/lib/labels";
import type { NaturalCaptureSuggestion } from "@/lib/natural-capture";
import type { AppState, AttachmentRef, CurrencyCode, NewTransactionInput, ReceiptAttachment, TransactionType, View } from "@/lib/types";

const captureTypes: TransactionType[] = ["expense", "income", "transfer", "debt_payment", "saving", "investment", "refund"];
const captureTypeLabels: Record<TransactionType, string> = {
  income: "Ingreso",
  expense: "Gasto",
  transfer: "Transferencia",
  debt_payment: "Pago deuda",
  saving: "Ahorro",
  investment: "Inversión",
  refund: "Reembolso",
};
// Render-site translation for the module-level captureTypeLabels (Spanish stays the first arg).
function captureTypeLabel(type: TransactionType, t: (es: string, en: string) => string): string {
  switch (type) {
    case "income":
      return t("Ingreso", "Income");
    case "expense":
      return t("Gasto", "Expense");
    case "transfer":
      return t("Transferencia", "Transfer");
    case "debt_payment":
      return t("Pago deuda", "Debt payment");
    case "saving":
      return t("Ahorro", "Saving");
    case "investment":
      return t("Inversión", "Investment");
    case "refund":
      return t("Reembolso", "Refund");
    default:
      return captureTypeLabels[type];
  }
}
const supportedCurrencies: CurrencyCode[] = ["DOP", "USD", "MXN", "EUR"];
const sources: Array<{ value: ReceiptAttachment["source"]; label: string }> = [
  { value: "receipt", label: "Recibo" },
  { value: "invoice", label: "Factura" },
  { value: "statement", label: "Estado de cuenta" },
  { value: "other", label: "Otro" },
];

type Stage = "pick" | "camera" | "working" | "review";

// The registered attachments row id needed by parseReceipt/getReceiptUrl. The shared AttachmentRef
// only carries the _storage pointer, so the monolith's uploadAttachment helper additionally surfaces
// the attachments row id on the returned object. We read it structurally (additive) without mutating
// the shared AttachmentRef type. Returns null when absent so the gated server calls are skipped safely.
function resolveAttachmentId(ref: AttachmentRef): Id<"attachments"> | null {
  const candidate = (ref as AttachmentRef & { attachmentId?: string }).attachmentId;
  return candidate ? (candidate as Id<"attachments">) : null;
}

// Reasons surfaced by the AI/heuristic are display-only. The local heuristic already returns plain
// Spanish sentences, but a model may return developer-ish codes (snake_case / single token). Map any
// known reason code through reviewReasonLabel; keep human sentences as-is; drop anything that still
// looks like a raw code so no snake_case ever leaks to the user.
function humanizeReasons(reasons: string[]): string[] {
  const out: string[] = [];
  for (const raw of reasons) {
    const reason = raw.trim();
    if (!reason) continue;
    const looksLikeCode = /^[a-z][a-z0-9]*(_[a-z0-9]+)+$/.test(reason);
    if (looksLikeCode) {
      const mapped = reviewReasonLabel(reason);
      if (mapped !== reason) out.push(mapped); // known code -> Spanish label
      // else: still a raw code with no friendly label -> hide it
    } else {
      out.push(reason); // already a human sentence
    }
  }
  return out;
}

// Accept only images and PDFs, from ANY source (file picker, camera, drag-drop, paste).
function isAcceptedFile(file: File) {
  return file.type.startsWith("image/") || file.type === "application/pdf";
}

// An editable line-item row in the review form. `amount` is kept as a free-text string (the line
// TOTAL) while the user edits, mirroring how the AI returns it; it is parsed to amountCents only on
// approve (via receiptToInput's transient.items -> toCents). `key` is a stable React list key.
type LineItemRow = { key: string; name: string; quantity: number; amount: string };

let lineItemKeySeq = 0;
function newLineItemKey(): string {
  lineItemKeySeq += 1;
  return `li-${Date.now()}-${lineItemKeySeq}`;
}

// Seed editable rows from extraction.items (raw model {name, quantity, amount:string}). Returns an
// empty list when there are no parsed items (manual capture / itemless receipts) so lineItems stays
// undefined on approve and existing behavior is preserved.
function seedLineItems(extraction: ReceiptExtraction | null): LineItemRow[] {
  const items = extraction?.items;
  if (!items || items.length === 0) return [];
  return items.map((item) => ({
    key: newLineItemKey(),
    name: item.name ?? "",
    quantity: typeof item.quantity === "number" && item.quantity > 0 ? item.quantity : 1,
    amount: item.amount ?? "",
  }));
}

// A receipt-like attachment we build locally to drive receiptToInput. In server mode the storageId
// comes back from uploadAttachment; in local-only mode it is undefined (filename-only attachment).
function buildReceiptDraft(opts: {
  ref: AttachmentRef | null;
  fileName: string;
  contentType: string;
  source: ReceiptAttachment["source"];
}): ReceiptAttachment {
  return {
    id: `receipt-${Date.now()}`,
    fileName: opts.fileName,
    contentType: opts.contentType,
    source: opts.source,
    status: "needs_review",
    createdAt: new Date().toISOString(),
    storageId: opts.ref?.storageId,
  };
}

export function ReceiptCaptureView({
  state,
  householdId,
  aiEnabled,
  uploadAttachment,
  parseReceipt,
  getReceiptUrl,
  onSave,
  // onLinkReceipt is part of the contract's prop surface (the integrator passes it), but linking is
  // done via attachmentRefs threaded into the saved input — see the onApprove handler. It is not
  // destructured here because onSave returns boolean (no tx id) so we cannot call it honestly yet.
  onOpenPaywall,
  onSaveAlias,
  setView,
}: {
  state: AppState;
  householdId: Id<"households"> | null;
  aiEnabled: boolean;
  uploadAttachment: (file: File | Blob, fileName: string) => Promise<AttachmentRef>;
  parseReceipt: (a: { householdId: Id<"households">; attachmentId: Id<"attachments"> }) => Promise<AiCaptureResult>;
  getReceiptUrl: (a: { attachmentId: Id<"attachments"> }) => Promise<string | null>;
  onSave: (input: NewTransactionInput) => boolean;
  onLinkReceipt: (attachmentId: Id<"attachments">, txId: string) => void;
  onOpenPaywall: () => void;
  // Optional: remember a raw->alias merchant nickname for the whole household. When the integrator
  // injects it (writing to AppState.merchantAliases), the review form can offer "Guardar apodo".
  // When absent, the edited merchant is simply kept on this transaction — no aliasing, no crash.
  onSaveAlias?: (raw: string, alias: string) => void;
  setView: (v: View) => void;
}) {
  const { t } = useT();
  const [stage, setStage] = useState<Stage>("pick");
  const [source, setSource] = useState<ReceiptAttachment["source"]>("receipt");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Filled once we have something to review.
  const [receiptDraft, setReceiptDraft] = useState<ReceiptAttachment | null>(null);
  const [extraction, setExtraction] = useState<ReceiptExtraction | null>(null);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);

  // Advisory UX gate (the server is the real authority). Used to decide whether to even attempt AI.
  const aiGate = useMemo(() => entitlementForAi(state), [state]);

  const [isDragging, setIsDragging] = useState(false);

  // Revoke any object URL we created for a local preview.
  useEffect(() => {
    return () => {
      if (localPreviewUrl) URL.revokeObjectURL(localPreviewUrl);
    };
  }, [localPreviewUrl]);

  // Always-fresh handle to the upload pipeline so the window-level paste listener
  // (registered once per stage) and the drop handlers never call a stale closure.
  const handleUploadRef = useRef<(file: File | Blob) => Promise<void>>(async () => {});
  useEffect(() => {
    handleUploadRef.current = handleUpload;
  });

  // Pull the first usable image/PDF out of a drop or file-picker selection.
  function ingestFiles(files: FileList | File[] | null | undefined) {
    const picked = files ? Array.from(files).find(isAcceptedFile) : undefined;
    if (!picked) {
      setError(t("Usa una imagen (JPG/PNG) o un PDF del recibo.", "Use an image (JPG/PNG) or a PDF of the receipt."));
      return;
    }
    setError(null);
    void handleUploadRef.current(picked);
  }

  // Paste an image straight from the clipboard (screenshot or copied photo) while on
  // the picker — the modern way: we listen for the paste event, no "dale Ctrl+V aquí".
  useEffect(() => {
    if (stage !== "pick") return;
    function onPaste(event: ClipboardEvent) {
      const items = event.clipboardData?.items;
      let file: File | null = null;
      if (items) {
        for (const item of Array.from(items)) {
          if (item.kind === "file") {
            const candidate = item.getAsFile();
            if (candidate && isAcceptedFile(candidate)) {
              file = candidate;
              break;
            }
          }
        }
      }
      if (!file && event.clipboardData?.files?.length) {
        file = Array.from(event.clipboardData.files).find(isAcceptedFile) ?? null;
      }
      if (file) {
        event.preventDefault();
        setError(null);
        void handleUploadRef.current(file);
      }
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [stage]);

  // --- Pick (drop / upload / camera only) ----------------------------------
  if (stage === "pick") {
    // One-line note about how the file will be read (AI vs manual). No paragraph.
    const aiNote = householdId
      ? aiGate.allowed
        ? { text: t("La IA lo leerá y tú apruebas antes de guardar.", "AI reads it and you approve before saving."), tone: "ok" as const }
        : aiEnabled
          ? { text: t("Lectura con IA disponible en Pro · puedes capturarlo a mano gratis.", "AI reading is a Pro feature · you can enter it manually for free."), tone: "info" as const }
          : { text: t("La IA está desactivada · lo capturarás a mano.", "AI is turned off · you'll enter it manually."), tone: "muted" as const }
      : { text: t("Modo local · lo capturarás a mano.", "Local mode · you'll enter it manually."), tone: "muted" as const };
    const noteClass =
      aiNote.tone === "ok"
        ? "border-[rgba(80,102,0,0.22)] bg-[rgba(204,255,0,0.1)] text-[var(--foreground)]"
        : aiNote.tone === "info"
          ? "border-[rgba(80,102,0,0.18)] bg-white/70 text-[var(--text-muted)]"
          : "border-[var(--line)] bg-white/55 text-[var(--text-muted)]";

    return (
      <Shell setView={setView}>
        <section className="glass rounded-3xl p-6">
          <p className={`mb-5 inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-semibold ${noteClass}`}>
            <Sparkles className="h-3.5 w-3.5 text-[var(--primary)]" />
            {aiNote.text}
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <label
              className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border border-dashed p-8 text-center transition ${
                isDragging
                  ? "border-[var(--primary)] bg-white ring-2 ring-[var(--lime)]"
                  : "border-[rgba(18,20,20,0.46)] bg-white/55 hover:border-[var(--primary)] hover:bg-white"
              }`}
              onDragEnter={(event) => {
                event.preventDefault();
                setIsDragging(true);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={(event) => {
                event.preventDefault();
                setIsDragging(false);
              }}
              onDrop={(event) => {
                event.preventDefault();
                setIsDragging(false);
                ingestFiles(event.dataTransfer?.files);
              }}
            >
              <span className="grid h-12 w-12 place-items-center rounded-full bg-[var(--surface-soft)] text-[var(--primary)]">
                <Upload className="h-6 w-6" />
              </span>
              <span className="text-sm font-bold">{isDragging ? t("Suelta la imagen aquí", "Drop the image here") : t("Subir, arrastrar o pegar", "Upload, drag or paste")}</span>
              <span className="text-xs text-[var(--text-muted)]">{t("PDF, JPG o PNG", "PDF, JPG or PNG")}</span>
              <input
                className="hidden"
                type="file"
                accept="image/png,image/jpeg,application/pdf"
                onChange={(event) => ingestFiles(event.target.files)}
              />
            </label>

            <button
              className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-[rgba(18,20,20,0.46)] bg-white/55 p-8 text-center transition hover:border-[var(--primary)] hover:bg-white"
              onClick={() => setStage("camera")}
              type="button"
            >
              <span className="grid h-12 w-12 place-items-center rounded-full bg-[var(--surface-soft)] text-[var(--primary)]">
                <Camera className="h-6 w-6" />
              </span>
              <span className="text-sm font-bold">{t("Usar cámara", "Use camera")}</span>
              <span className="text-xs text-[var(--text-muted)]">{t("Toma una foto con el celular o la PC", "Take a photo with your phone or PC")}</span>
            </button>
          </div>

          {error && (
            <p className="mt-4 rounded-2xl border border-[rgba(186,26,26,0.3)] bg-[rgba(186,26,26,0.06)] px-4 py-3 text-sm text-[var(--danger)]">{error}</p>
          )}
        </section>
      </Shell>
    );
  }

  // --- Camera --------------------------------------------------------------
  if (stage === "camera") {
    return (
      <Shell setView={setView}>
        <section className="glass rounded-3xl p-6">
          <SectionHeaderLocal title={t("Tomar foto del recibo", "Take a photo of the receipt")} action={t("Volver", "Back")} onAction={() => setStage("pick")} />
          <div className="mt-5">
            <CameraCapture
              onCapture={(file) => void handleUpload(file)}
              onCancel={() => setStage("pick")}
            />
          </div>
        </section>
      </Shell>
    );
  }

  // --- Working (uploading / analyzing) ------------------------------------
  if (stage === "working") {
    return (
      <Shell setView={setView}>
        <section className="glass grid place-items-center gap-4 rounded-3xl px-6 py-16 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-[var(--primary)]" />
          <p className="text-sm font-semibold text-[var(--foreground)]">{status ?? t("Procesando…", "Processing…")}</p>
          <p className="max-w-sm text-xs text-[var(--text-muted)]">{t("Tu archivo se está subiendo de forma segura. Nada se guarda como movimiento hasta que tú lo apruebes.", "Your file is uploading securely. Nothing is saved as a transaction until you approve it.")}</p>
        </section>
      </Shell>
    );
  }

  // --- Review --------------------------------------------------------------
  return (
    <Shell setView={setView}>
      {status && (
        <p className="rounded-2xl border border-[rgba(80,102,0,0.18)] bg-white/70 px-4 py-3 text-sm text-[var(--text-muted)]">{status}</p>
      )}
      <ReceiptReviewView
        state={state}
        fileUrl={fileUrl}
        extraction={extraction}
        onApprove={(input) => {
          // The file pointer survives via attachmentRefs (storageId) threaded into the input, so
          // addTransaction sets storageId on the created ReceiptAttachment. That is the primary,
          // working link. onLinkReceipt is the optional backend confirm: it needs the created
          // transaction id, which onSave (boolean) does not return, so we do not call it with a
          // fabricated id (no maqueta). See followups for enabling it via a tx-id-returning save.
          const saved = onSave(input);
          if (saved) setView("movements");
        }}
        onCancel={() => {
          setStage("pick");
          setExtraction(null);
          setReceiptDraft(null);
          setFileUrl(null);
          setStatus(null);
        }}
        receiptDraft={receiptDraft}
        onSourceChange={(value) => {
          setSource(value);
          setReceiptDraft((current) => (current ? { ...current, source: value } : current));
        }}
        merchantAliases={state.merchantAliases}
        onSaveAlias={onSaveAlias}
      />
    </Shell>
  );

  // --- Upload + (gated) analyze pipeline ----------------------------------
  // Declared as a hoisted function so the picker/camera handlers above can call it.
  async function handleUpload(file: File | Blob) {
    const inferredName = file instanceof File ? file.name : `recibo-${Date.now()}.jpg`;
    const inferredType = file.type || (file instanceof File ? "application/octet-stream" : "image/jpeg");
    setError(null);
    setStatus(null);

    // Local preview for images.
    const isImage = inferredType.startsWith("image/");
    let preview: string | null = null;
    if (isImage) {
      preview = URL.createObjectURL(file);
      setLocalPreviewUrl(preview);
    }

    // LOCAL-ONLY MODE: manual review straight from the picked file. No upload, no AI.
    if (!householdId) {
      const draft = buildReceiptDraft({ ref: null, fileName: inferredName, contentType: inferredType, source });
      setReceiptDraft(draft);
      setExtraction(null);
      setFileUrl(preview);
      setStage("review");
      return;
    }

    setStage("working");
    setStatus(t("Subiendo archivo…", "Uploading file…"));

    let ref: AttachmentRef;
    try {
      ref = await uploadAttachment(file, inferredName);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("No se pudo subir el archivo. Inténtalo de nuevo.", "Couldn't upload the file. Please try again."));
      setStage("pick");
      return;
    }

    const draft = buildReceiptDraft({ ref, fileName: inferredName, contentType: inferredType, source });
    setReceiptDraft(draft);

    // parseReceipt / getReceiptUrl require the registered attachments row id (Id<"attachments">),
    // which is NOT the same as ref.storageId (Id<"_storage">). The shared AttachmentRef carries only
    // {fileName, storageId, contentType}, so we read the attachment id from an additive, optional
    // `attachmentId` field that the monolith's uploadAttachment helper (registerReceipt's return)
    // surfaces on the ref. When it is absent we never invent one: we skip the gated server calls and
    // fall back to manual review (never a crash). See followups for the exact integration shape.
    const attId = resolveAttachmentId(ref);

    // Prefer a signed server URL for the preview (works for PDFs too); fall back to local preview.
    if (attId) {
      try {
        const url = await getReceiptUrl({ attachmentId: attId });
        setFileUrl(url ?? preview);
      } catch {
        setFileUrl(preview);
      }
    } else {
      setFileUrl(preview);
    }

    // AI off (or local-only / no attachment id) -> manual review of the uploaded file.
    if (!aiEnabled || !attId) {
      setExtraction(null);
      setStatus(t("Revisa los datos del recibo y aprueba para guardar.", "Review the receipt details and approve to save."));
      setStage("review");
      return;
    }

    // Entitled path: the SERVER is the authority. analyzeReceiptFile only skips when AI is off;
    // otherwise it calls the action and, on any failure, falls back to the local heuristic WITH a
    // specific reason + code. We never pre-gate on the client's (possibly stale) plan view, so an
    // entitled user always gets the real AI read instead of an empty manual form.
    setStatus(t("Leyendo el recibo con IA…", "Reading the receipt with AI…"));
    const result = await analyzeReceiptFile({
      attachmentId: attId,
      householdId,
      receipt: draft,
      state,
      aiEnabled,
      // ai-client.ts accepts the ids as opaque strings (branded Id<T> satisfy string). Our injected
      // parseReceipt is typed with branded ids, so we adapt the broader string args back to branded
      // ids — safe because at runtime these ARE the branded id strings.
      callParse: (a) => parseReceipt({ householdId: a.householdId as Id<"households">, attachmentId: a.attachmentId as Id<"attachments"> }),
    });

    // Pro required -> paywall, not a silent manual fallback.
    if (result.failCode === "not_entitled") {
      onOpenPaywall();
      return;
    }

    // Thread the transient review-only signals the cloud extraction carries:
    //  - items     -> editable "Productos" rows (the receipt breakdown)
    //  - receiptDate-> seeds the date field (printed date, not "today")
    //  - discountText-> seeds the discount field
    // Absent on the local heuristic / older server builds -> empty rows + today, never a crash.
    setExtraction({
      suggestion: result.suggestion,
      isReceipt: result.isReceipt,
      items: result.items,
      discountText: result.discountText,
      receiptDate: result.receiptDate,
    });
    if (result.provider === "openrouter") {
      setStatus(t("Leído con IA. Revisa y aprueba.", "Read with AI. Review and approve."));
    } else {
      setStatus(
        result.error
          ? `${t("No se pudo leer con IA:", "Couldn't read with AI:")} ${result.error}. ${t("Usé reglas locales; revisa y corrige.", "Used local rules; please review and correct.")}`
          : t("Revisa los datos del recibo y aprueba para guardar.", "Review the receipt details and approve to save."),
      );
    }
    setStage("review");
  }
}

// ---------------------------------------------------------------------------
// ReceiptReviewView — MANDATORY editable human review. Nothing is saved until the
// user presses "Aprobar y guardar". Every extracted field is editable; confidence and
// reasons are shown read-only; an isReceipt banner is shown when AI flagged it.
// ---------------------------------------------------------------------------
export function ReceiptReviewView({
  state,
  fileUrl,
  extraction,
  onApprove,
  onCancel,
  receiptDraft,
  onSourceChange,
  merchantAliases,
  onSaveAlias,
}: {
  state: AppState;
  fileUrl: string | null;
  extraction: ReceiptExtraction | null;
  onApprove: (input: NewTransactionInput) => void;
  onCancel: () => void;
  // Optional: the uploaded-file descriptor so the approved input carries the real storageId/attachment.
  receiptDraft?: ReceiptAttachment | null;
  // Optional: change the document source (Ticket/Factura/…). Exposed only inside "Más opciones";
  // not asked before upload. Defaults to 'receipt'.
  onSourceChange?: (value: ReceiptAttachment["source"]) => void;
  // Optional: the household's saved merchant nicknames, used to show the clean display name as
  // context next to the raw merchant. Absent -> the raw merchant is shown unchanged.
  merchantAliases?: { raw: string; alias: string }[];
  // Optional: remember a raw->alias nickname for the household. When provided, the form offers a
  // small "Guardar apodo" control after the user shortens the name. When absent, the edited
  // merchant is simply kept on this transaction (no aliasing).
  onSaveAlias?: (raw: string, alias: string) => void;
}) {
  const { t } = useT();
  const today = new Date().toISOString().slice(0, 10);
  const activeAccounts = state.accounts.filter((account) => !account.archived);
  const firstExpense = state.categories.find((category) => category.group !== "income") ?? state.categories[0];

  // Seed the editable form from the extraction (if any) or sensible defaults.
  const seed: NaturalCaptureSuggestion = useMemo(() => {
    if (extraction) return extraction.suggestion;
    const fallbackAccount = activeAccounts.find((account) => account.defaultForCapture) ?? activeAccounts[0] ?? state.accounts[0];
    return {
      type: "expense",
      amount: "",
      currency: state.currency,
      categoryId: firstExpense?.id ?? "",
      subcategory: firstExpense?.subcategories[0] ?? "",
      accountId: fallbackAccount?.id ?? "",
      description: "",
      merchant: "",
      tags: "",
      note: "",
      confidence: 0,
      reasons: [],
      needsReview: true,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extraction]);

  const [form, setForm] = useState<NaturalCaptureSuggestion>(seed);
  const [date, setDate] = useState<string>(extraction?.receiptDate ?? today);
  const [discountText, setDiscountText] = useState<string>(extraction?.discountText ?? "");

  // Editable factura/receipt line items. Seeded from extraction.items (raw model strings:
  // {name, quantity, amount}); each row is freely editable and addable/removable. On approve
  // these are mapped to NewTransactionInput.lineItems (transient.items) so addTransaction stores
  // Transaction.lineItems. Itemless receipts/manual capture start with no rows -> lineItems
  // stays undefined and the app behaves exactly as before.
  const [lineItems, setLineItems] = useState<LineItemRow[]>(() => seedLineItems(extraction));

  // The raw merchant as the AI/heuristic read it, kept so the "Guardar apodo" affordance can
  // remember raw -> the user's shortened alias. Frozen from the initial seed; editing the merchant
  // field changes form.merchant (the alias candidate), not this raw source.
  const rawMerchant = useMemo(() => extraction?.suggestion.merchant ?? "", [extraction]);
  const [aliasSaved, setAliasSaved] = useState(false);
  const [exchangeRate, setExchangeRate] = useState<number>(1);
  const [exchangeMeta, setExchangeMeta] = useState<{ date: string; source: "api" | "manual" | "same_currency" }>({ date: today, source: "same_currency" });
  const [saving, setSaving] = useState(false);
  // AI-first: when the AI read the receipt, default to a glanceable summary and keep the full
  // editable form collapsed (one tap to confirm). Manual capture opens the form directly.
  const [showDetails, setShowDetails] = useState<boolean>(!extraction);

  // Quote the exchange rate when the original currency differs from home currency.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const quote = await quoteExchangeRate(form.currency, state.currency);
      if (cancelled) return;
      setExchangeRate(quote.rate);
      setExchangeMeta({ date: quote.date, source: quote.source });
    })();
    return () => {
      cancelled = true;
    };
  }, [form.currency, state.currency]);

  const selectedCategory = categoryById(state.categories, form.categoryId);
  // Plain-language confidence reasons (no developer-ish snake_case).
  const reasons = useMemo(() => humanizeReasons(extraction?.suggestion.reasons ?? []), [extraction]);
  const otherCurrency = form.currency !== state.currency;
  const converted = toCents(form.amount) * exchangeRate;
  const canApprove = !!form.amount && toCents(form.amount) > 0 && !!form.accountId && !!form.categoryId;

  function set<K extends keyof NaturalCaptureSuggestion>(key: K, value: NaturalCaptureSuggestion[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  // --- Editable line items (Productos) ------------------------------------
  function updateLineItem(key: string, patch: Partial<Omit<LineItemRow, "key">>) {
    setLineItems((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }
  function addLineItem() {
    setLineItems((rows) => [...rows, { key: newLineItemKey(), name: "", quantity: 1, amount: "" }]);
  }
  function removeLineItem(key: string) {
    setLineItems((rows) => rows.filter((row) => row.key !== key));
  }

  // Sum of the editable line totals (cents), for a quiet running total next to "Productos".
  const lineItemsTotalCents = lineItems.reduce((sum, row) => sum + toCents(row.amount), 0);

  // --- Merchant nickname (apodo) ------------------------------------------
  // Whether the user shortened/changed the raw merchant into something new worth remembering.
  const editedMerchant = form.merchant.trim();
  const aliasIsNew =
    !!onSaveAlias &&
    !!rawMerchant.trim() &&
    !!editedMerchant &&
    normalizeMerchant(editedMerchant) !== normalizeMerchant(rawMerchant) &&
    merchantDisplay(rawMerchant, merchantAliases).trim() !== editedMerchant &&
    !aliasSaved;

  function saveAlias() {
    if (!onSaveAlias || !rawMerchant.trim() || !editedMerchant) return;
    onSaveAlias(rawMerchant.trim(), editedMerchant);
    setAliasSaved(true);
  }

  function approve() {
    if (!canApprove || saving) return;
    setSaving(true);

    // Build the receipt-shaped attachment so receiptToInput preserves createdBy='Recibo',
    // status='needs_review' and the 'recibo' tag, and carries the storageId/attachmentRefs.
    const receipt: ReceiptAttachment = receiptDraft ?? {
      id: `receipt-${Date.now()}`,
      fileName: "recibo",
      contentType: "application/octet-stream",
      source: "receipt",
      status: "needs_review",
      createdAt: new Date().toISOString(),
    };

    const quote: ExchangeQuote = { rate: exchangeRate, date: exchangeMeta.date, source: exchangeMeta.source };

    // Map the edited rows back to the transient {name, quantity, amount:string} shape receiptToInput
    // expects; it parses amount with toCents and stores Transaction.lineItems. Drop fully-empty rows
    // (no name AND no amount) so blank trailing rows never become {amountCents: 0} noise. When nothing
    // usable remains we pass undefined, keeping itemless movements unchanged.
    const editedItems = lineItems
      .map((row) => ({ name: row.name.trim(), quantity: row.quantity || 1, amount: row.amount.trim() }))
      .filter((row) => row.name !== "" || row.amount !== "");

    // The single mapping layer. receiptToInput preserves createdBy='Recibo'/status needs_review/the
    // 'recibo' tag, folds the discount (transient) into note + a 'descuento' tag, maps the edited date
    // to Transaction.date, threads attachmentRefs (with storageId) so the file pointer survives the
    // next autosave (the plan's HIGHEST risk), and maps the edited line items to Transaction.lineItems.
    // The `form` IS the reviewed suggestion the user approved. We pass transient signals rather than
    // pre-folding them, so there is one fold, not two.
    const input = receiptToInput(receipt, form, quote, {
      discountText: discountText.trim() || undefined,
      receiptDate: date,
      isReceipt: extraction?.isReceipt,
      items: editedItems.length > 0 ? editedItems : undefined,
    });

    onApprove(input);
    setSaving(false);
  }

  const isPdf = (fileUrl ?? "").toLowerCase().includes(".pdf") || (receiptDraft?.contentType ?? "").includes("pdf");

  return (
    <section className="glass rounded-3xl p-6">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div>
          <p className="kicker mb-1">{t("Revisión obligatoria", "Review required")}</p>
          <h3 className="serif text-2xl font-bold tracking-tight">{t("Revisa y aprueba el recibo", "Review and approve the receipt")}</h3>
          <p className="mt-1.5 max-w-lg text-sm leading-relaxed text-[var(--text-muted)]">
            {t("Revisa lo que leyó la IA y ajusta solo si algo no cuadra. Nada se guarda hasta que presiones", "Check what the AI read and adjust only if something's off. Nothing is saved until you press")} <strong>{t("Aprobar y guardar", "Approve and save")}</strong>.
          </p>
        </div>
      </div>

      {/* Warn ONLY when the AI doubts it's a receipt — a positive banner would just be noise. */}
      {extraction && !extraction.isReceipt && (
        <div className="mt-5 flex items-start gap-3 rounded-2xl border border-[rgba(186,26,26,0.28)] bg-[rgba(186,26,26,0.05)] px-4 py-3 text-sm text-[var(--foreground)]">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-[var(--primary)]" />
          <span>{t("Esto no parece un recibo. Revísalo con cuidado.", "This doesn't look like a receipt. Review it carefully.")}</span>
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,360px)_1fr]">
        {/* File preview */}
        <div className="grid gap-3">
          <p className="kicker">{t("Archivo", "File")}</p>
          <div className="overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface-soft)]">
            {fileUrl && !isPdf && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={fileUrl} alt={t("Recibo", "Receipt")} className="max-h-[420px] w-full object-contain" />
            )}
            {fileUrl && isPdf && (
              <a
                className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center text-sm font-semibold text-[var(--primary)]"
                href={fileUrl}
                target="_blank"
                rel="noreferrer"
              >
                <FileText className="h-10 w-10" />
                {t("Abrir PDF en otra pestaña", "Open PDF in a new tab")}
                <span className="text-xs font-normal text-[var(--text-muted)]">{receiptDraft?.fileName ?? "documento.pdf"}</span>
              </a>
            )}
            {!fileUrl && (
              <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center text-sm text-[var(--text-muted)]">
                <FileText className="h-8 w-8 text-[var(--text-subtle)]" />
                {receiptDraft?.fileName ?? t("Sin vista previa disponible", "No preview available")}
              </div>
            )}
          </div>

          {/* Confidence + reasons (read-only) */}
          {extraction && (
            <div className="rounded-2xl border border-[var(--line)] bg-white/55 p-4">
              <div className="flex items-center justify-between">
                <p className="kicker">{t("Confianza IA", "AI confidence")}</p>
                <span className={`serif text-xl font-bold ${form.needsReview ? "text-[var(--danger)]" : "text-[var(--primary)]"}`}>
                  {Math.round((extraction.suggestion.confidence ?? 0) * 100)}%
                </span>
              </div>
              {reasons.length > 0 && (
                <ul className="mt-2 space-y-1 text-xs text-[var(--text-muted)]">
                  {reasons.map((reason) => (
                    <li key={reason}>· {reason}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {/* Review: AI result shown as a glanceable summary; full form only on demand. */}
        <div className="grid gap-4">
          {extraction && (
            <ReceiptSummaryCard
              form={form}
              date={date}
              discountText={discountText}
              categoryName={selectedCategory?.name ?? "—"}
              homeCurrency={state.currency}
              converted={converted}
              lineItems={lineItems}
              detailsOpen={showDetails}
              onToggleDetails={() => setShowDetails((value) => !value)}
            />
          )}

          {showDetails && (
            <>
              {/* Type */}
              <LabeledSelect
                label={t("Tipo", "Type")}
                value={form.type}
                options={captureTypes}
                render={(value) => captureTypeLabel(value as TransactionType, t)}
                onChange={(value) => {
                  const type = value as TransactionType;
                  const category = state.categories.find((item) => (type === "income" ? item.group === "income" : item.group !== "income")) ?? state.categories[0];
                  setForm((current) => ({ ...current, type, categoryId: current.categoryId || category?.id || "" }));
                }}
              />

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-2 text-sm font-semibold">
              {t("Monto", "Amount")}
              <input
                className="field"
                inputMode="decimal"
                placeholder="0.00"
                value={form.amount}
                onChange={(event) => set("amount", event.target.value)}
              />
            </label>
            <LabeledSelect
              label={t("Moneda", "Currency")}
              value={form.currency}
              options={supportedCurrencies}
              onChange={(value) => set("currency", value as CurrencyCode)}
            />
          </div>

          {otherCurrency && (
            <div className="rounded-2xl bg-[var(--surface-soft)] p-4 text-xs text-[var(--text-muted)]">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-2 text-sm font-semibold">
                  {t("Tasa hacia", "Rate to")} {state.currency}
                  <input
                    className="field"
                    inputMode="decimal"
                    value={exchangeRate}
                    onChange={(event) => {
                      setExchangeRate(Number(event.target.value) || 1);
                      setExchangeMeta((current) => ({ ...current, source: "manual" }));
                    }}
                  />
                </label>
                <p className="self-end">
                  {t("Se guarda como", "Saved as")} <strong>{formatMoney(Math.round(converted), state.currency)}</strong> · {t("tasa", "rate")} {exchangeMeta.source} {t("del", "of")} {exchangeMeta.date}
                </p>
              </div>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <LabeledSelect
              label={t("Cuenta", "Account")}
              value={form.accountId}
              options={activeAccounts.map((account) => account.id)}
              render={(id) => state.accounts.find((account) => account.id === id)?.name ?? id}
              onChange={(value) => set("accountId", value)}
            />
            <LabeledSelect
              label={t("Categoría", "Category")}
              value={form.categoryId}
              options={state.categories.filter((category) => !category.archived).map((category) => category.id)}
              render={(id) => categoryById(state.categories, id)?.name ?? id}
              onChange={(value) => {
                const category = categoryById(state.categories, value);
                setForm((current) => ({ ...current, categoryId: value, subcategory: category?.subcategories[0] ?? current.subcategory }));
              }}
            />
          </div>

          <LabeledCombo
            label={t("Subcategoría o detalle", "Subcategory or detail")}
            value={form.subcategory}
            options={selectedCategory?.subcategories ?? []}
            onChange={(value) => set("subcategory", value)}
            placeholder={t("Detalle específico (opcional)", "Specific detail (optional)")}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2 text-sm font-semibold">
              <span>{t("Comercio (como en el recibo)", "Merchant (as on the receipt)")}</span>
              <input
                className="field"
                value={form.merchant}
                placeholder={t("Ej. Farmacia, Juan…", "e.g. Pharmacy, John…")}
                onChange={(event) => {
                  setAliasSaved(false);
                  set("merchant", event.target.value);
                }}
              />
              {/* Discoverability: tell the user they can shorten it into a remembered nickname. */}
              {onSaveAlias && rawMerchant.trim() && (
                <span className="text-xs font-normal text-[var(--text-muted)]">
                  {t(
                    "Edítalo para mostrarlo con un apodo corto; se recordará para este comercio en toda la app.",
                    "Edit it to show a short nickname; it'll be remembered for this merchant across the app.",
                  )}
                </span>
              )}
              {/* One small, unobtrusive control to remember raw -> alias for the household. */}
              {aliasIsNew && (
                <button
                  type="button"
                  onClick={saveAlias}
                  className="inline-flex w-fit items-center gap-1.5 rounded-full border border-[rgba(18,20,20,0.46)] bg-white/70 px-2.5 py-1 text-xs font-semibold text-[var(--primary)] transition hover:bg-white"
                >
                  <Tag className="h-3.5 w-3.5" /> {t("Guardar apodo", "Save nickname")} «{editedMerchant}»
                </button>
              )}
              {aliasSaved && (
                <span className="text-xs font-normal text-[var(--primary)]">{t("Apodo guardado para este comercio.", "Nickname saved for this merchant.")}</span>
              )}
            </div>
            <label className="grid gap-2 text-sm font-semibold">
              {t("Fecha del recibo", "Receipt date")}
              <input className="field" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            </label>
          </div>

          <LabeledInput label={t("Descripción", "Description")} value={form.description} onChange={(value) => set("description", value)} placeholder={t("Qué se compró", "What was bought")} />

          {/* Productos: editable line items parsed from the factura. Lives in the details area so the
              glance-and-confirm summary stays uncluttered. Each row is editable; add/remove freely. */}
          <LineItemsEditor
            rows={lineItems}
            currency={form.currency}
            totalCents={lineItemsTotalCents}
            onUpdate={updateLineItem}
            onAdd={addLineItem}
            onRemove={removeLineItem}
          />

          {/* Secondary fields collapsed so the default view leads with monto/categoría/comercio/fecha. */}
          <details className="rounded-2xl border border-[var(--line)] bg-white/55 px-4 py-3">
            <summary className="cursor-pointer list-none text-sm font-semibold text-[var(--primary)] transition hover:opacity-70">
              {t("Más opciones", "More options")}
            </summary>
            <div className="mt-4 grid gap-4">
              <LabeledSelect
                label={t("Tipo de documento", "Document type")}
                value={receiptDraft?.source ?? "receipt"}
                options={sources.map((item) => item.value)}
                render={(value) => receiptSourceLabel(value)}
                onChange={(value) => onSourceChange?.(value as ReceiptAttachment["source"])}
              />
              <LabeledInput label={t("Etiquetas", "Tags")} value={form.tags} onChange={(value) => set("tags", value)} placeholder={t("recibo, familia…", "receipt, family…")} />
              <LabeledInput label={t("Descuento o ahorro (opcional)", "Discount or savings (optional)")} value={discountText} onChange={setDiscountText} placeholder={`${t("Ej.", "e.g.")} ${formatMoney(5000, form.currency)} ${t("de descuento", "off")}`} />

              <label className="grid gap-2 text-sm font-semibold">
                {t("Nota", "Note")}
                <textarea className="field min-h-20" value={form.note} onChange={(event) => set("note", event.target.value)} />
              </label>

              <label className="flex items-center gap-2 text-sm font-semibold">
                <input type="checkbox" checked={form.needsReview} onChange={(event) => set("needsReview", event.target.checked)} />
                {t("Mandar a bandeja de revisión", "Send to review inbox")}
              </label>
            </div>
          </details>
            </>
          )}
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-2.5 sm:grid-cols-[1fr_auto]">
        <button
          className="rounded-2xl bg-[var(--lime)] px-6 py-3.5 text-base font-bold text-black shadow-lg shadow-lime-300/30 transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-70"
          disabled={!canApprove || saving}
          onClick={approve}
          type="button"
        >
          {saving ? t("Guardando…", "Saving…") : t("Aprobar y guardar", "Approve and save")}
        </button>
        <button
          className="rounded-2xl border border-[rgba(18,20,20,0.46)] bg-white px-6 py-3.5 text-base font-bold text-[var(--text-muted)] transition hover:-translate-y-0.5"
          onClick={onCancel}
          type="button"
        >
          {t("Descartar", "Discard")}
        </button>
      </div>
      {!canApprove && (
        <p className="mt-3 text-xs text-[var(--text-muted)]">{t("Indica al menos un monto válido, una cuenta y una categoría para poder guardar.", "Enter at least a valid amount, an account and a category to be able to save.")}</p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Local, decoupled primitives — re-implemented (not imported from the monolith) so this
// component has zero coupling to rindomes-app.tsx, matching the shared design-system classes.
// ---------------------------------------------------------------------------
function Shell({ children, setView }: { children: React.ReactNode; setView: (v: View) => void }) {
  const { t } = useT();
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 pt-1">
        <div className="min-w-0">
          <p className="kicker">{t("Captura de recibos", "Receipt capture")}</p>
          <h2 className="serif mt-1.5 text-[1.9rem] font-bold leading-[1.05] tracking-tight md:text-[2.4rem]">{t("Capturar recibo", "Capture receipt")}</h2>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-[var(--text-muted)]">
            {t("Sube o fotografía un recibo. RindoMes te ayuda a leerlo, pero tú siempre revisas y apruebas antes de guardar.", "Upload or photograph a receipt. RindoMes helps you read it, but you always review and approve before saving.")}
          </p>
        </div>
        <button
          className="inline-flex shrink-0 items-center gap-2 rounded-2xl border border-[var(--line)] bg-white/70 px-4 py-2.5 text-sm font-semibold text-[var(--text-muted)] transition hover:bg-white"
          onClick={() => setView("home")}
          type="button"
        >
          <ArrowLeft className="h-4 w-4" /> {t("Volver al inicio", "Back to home")}
        </button>
      </div>
      {children}
    </div>
  );
}

function SectionHeaderLocal({ title, action, onAction }: { title: string; action: string; onAction: () => void }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <h3 className="serif text-xl font-bold tracking-tight">{title}</h3>
      <button className="shrink-0 text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--primary)] transition hover:opacity-70" onClick={onAction} type="button">{action}</button>
    </div>
  );
}

function LabeledInput({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return (
    <label className="grid gap-2 text-sm font-semibold">
      {label}
      <input className="field" value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function LabeledSelect({ label, value, options, render, onChange }: { label: string; value: string; options: string[]; render?: (value: string) => string; onChange: (value: string) => void }) {
  return (
    <label className="grid gap-2 text-sm font-semibold">
      {label}
      <select className="field" value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option} value={option}>{render ? render(option) : option}</option>
        ))}
      </select>
    </label>
  );
}

function LabeledCombo({ label, value, options, onChange, placeholder }: { label: string; value: string; options: string[]; onChange: (value: string) => void; placeholder?: string }) {
  const listId = `receipt-list-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <label className="grid gap-2 text-sm font-semibold">
      {label}
      <input className="field" list={listId} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
      <datalist id={listId}>
        {options.map((option) => (
          <option key={option} value={option} />
        ))}
      </datalist>
    </label>
  );
}

// Glanceable read of what the AI extracted — the default "mira y confirma" view. The full
// editable form stays hidden behind "Ajustar detalles" so the common case is one tap to approve.
function ReceiptSummaryCard({
  form,
  date,
  discountText,
  categoryName,
  homeCurrency,
  converted,
  lineItems,
  detailsOpen,
  onToggleDetails,
}: {
  form: NaturalCaptureSuggestion;
  date: string;
  discountText: string;
  categoryName: string;
  homeCurrency: CurrencyCode;
  converted: number;
  lineItems: LineItemRow[];
  detailsOpen: boolean;
  onToggleDetails: () => void;
}) {
  const { t } = useT();
  // Always show the currency CODE so two different "$" currencies are never ambiguous.
  const amountLabel = form.amount ? `${formatMoney(Math.round(toCents(form.amount)), form.currency)} ${form.currency}` : "—";
  const convertedLabel =
    form.currency !== homeCurrency && form.amount
      ? ` ≈ ${formatMoney(Math.round(converted), homeCurrency)} ${homeCurrency}`
      : "";
  return (
    <div className="rounded-2xl border border-[var(--line)] bg-white/65 p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="kicker">{t("Esto leyó la IA", "This is what the AI read")}</p>
        <span className="rounded-full bg-[var(--lime)] px-3 py-1 text-[11px] font-bold text-black">{captureTypeLabel(form.type, t)}</span>
      </div>
      <p className="serif mt-2 text-3xl font-bold tracking-tight">
        {amountLabel}
        {convertedLabel && <span className="text-sm font-normal text-[var(--text-muted)]">{convertedLabel}</span>}
      </p>
      <dl className="mt-3 grid gap-1.5 text-sm">
        <SummaryRow k={t("Categoría", "Category")} v={categoryName} />
        {form.merchant ? <SummaryRow k={t("Comercio", "Merchant")} v={form.merchant} /> : null}
        <SummaryRow k={t("Fecha", "Date")} v={date} />
        {form.description ? <SummaryRow k={t("Descripción", "Description")} v={form.description} /> : null}
        {discountText ? <SummaryRow k={t("Descuento", "Discount")} v={discountText} /> : null}
      </dl>

      {/* Detected products shown at a glance — no need to dig into "Adjust details". */}
      {lineItems.length > 0 && (
        <div className="mt-4 border-t border-[var(--line)] pt-3">
          <p className="kicker mb-1.5">
            {t("Productos", "Items")} ({lineItems.length})
          </p>
          <ul className="grid gap-1 text-sm">
            {lineItems.slice(0, 6).map((item) => (
              <li key={item.key} className="flex items-baseline justify-between gap-3">
                <span className="truncate text-[var(--foreground)]">
                  {item.quantity > 1 ? `${item.quantity}× ` : ""}
                  {item.name || "—"}
                </span>
                <span className="shrink-0 font-semibold text-[var(--foreground)]">
                  {item.amount ? formatMoney(Math.round(toCents(item.amount)), form.currency) : ""}
                </span>
              </li>
            ))}
            {lineItems.length > 6 && (
              <li className="text-xs text-[var(--text-muted)]">
                +{lineItems.length - 6} {t("más", "more")}
              </li>
            )}
          </ul>
        </div>
      )}

      <button
        type="button"
        onClick={onToggleDetails}
        className="mt-4 text-sm font-semibold text-[var(--primary)] transition hover:opacity-70"
      >
        {detailsOpen ? t("Ocultar detalles", "Hide details") : t("Ajustar detalles", "Adjust details")}
      </button>
    </div>
  );
}

function SummaryRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-[var(--text-muted)]">{k}</dt>
      <dd className="text-right font-semibold text-[var(--foreground)]">{v}</dd>
    </div>
  );
}

// Editable "Productos" section: one row per receipt line (name, quantity, line total). Seeded from
// the AI extraction and freely editable; the user can add or remove rows. The line total is the
// amount FOR THAT LINE (quantity already factored in), matching LineItem.amountCents semantics.
function LineItemsEditor({
  rows,
  currency,
  totalCents,
  onUpdate,
  onAdd,
  onRemove,
}: {
  rows: LineItemRow[];
  currency: CurrencyCode;
  totalCents: number;
  onUpdate: (key: string, patch: Partial<Omit<LineItemRow, "key">>) => void;
  onAdd: () => void;
  onRemove: (key: string) => void;
}) {
  const { t } = useT();
  return (
    <div className="rounded-2xl border border-[var(--line)] bg-white/55 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="kicker">{t("Productos", "Items")}</p>
        {rows.length > 0 && (
          <span className="text-xs text-[var(--text-muted)]">
            {rows.length} {rows.length === 1 ? t("línea", "line") : t("líneas", "lines")} · {formatMoney(Math.round(totalCents), currency)}
          </span>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="mt-2 text-xs text-[var(--text-muted)]">{t("Sin productos detallados. Agrega líneas si quieres desglosar el recibo.", "No itemized products. Add lines if you want to break down the receipt.")}</p>
      ) : (
        <div className="mt-3 grid gap-2">
          {/* Column captions, hidden on narrow screens to keep rows readable. */}
          <div className="hidden grid-cols-[1fr_4rem_6rem_2rem] gap-2 px-1 text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--text-subtle)] sm:grid">
            <span>{t("Producto", "Item")}</span>
            <span className="text-center">{t("Cant.", "Qty")}</span>
            <span className="text-right">{t("Importe", "Amount")}</span>
            <span />
          </div>
          {rows.map((row) => (
            <div key={row.key} className="grid grid-cols-[1fr_4rem_6rem_2rem] items-center gap-2">
              <input
                className="field"
                value={row.name}
                placeholder={t("Producto", "Item")}
                aria-label={t("Nombre del producto", "Item name")}
                onChange={(event) => onUpdate(row.key, { name: event.target.value })}
              />
              <input
                className="field text-center"
                inputMode="numeric"
                value={row.quantity}
                aria-label={t("Cantidad", "Quantity")}
                onChange={(event) => onUpdate(row.key, { quantity: Math.max(1, Math.round(Number(event.target.value) || 1)) })}
              />
              <input
                className="field text-right"
                inputMode="decimal"
                value={row.amount}
                placeholder="0.00"
                aria-label={t("Importe de la línea", "Line amount")}
                onChange={(event) => onUpdate(row.key, { amount: event.target.value })}
              />
              <button
                type="button"
                onClick={() => onRemove(row.key)}
                aria-label={t("Quitar producto", "Remove item")}
                className="grid h-9 w-9 place-items-center rounded-xl border border-[rgba(18,20,20,0.46)] bg-white text-[var(--text-subtle)] transition hover:border-[var(--danger)] hover:text-[var(--danger)]"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={onAdd}
        className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--primary)] transition hover:opacity-70"
      >
        <Plus className="h-4 w-4" /> {t("Agregar producto", "Add item")}
      </button>
    </div>
  );
}
