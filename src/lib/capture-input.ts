// ============================================================================
// src/lib/capture-input.ts
// The convergence glue (Pillar 4).
//
// Every capture source — the manual form, the AI/heuristic text capture, and
// the receipt vision capture — maps to ONE shape, NewTransactionInput, before
// calling addTransaction (the single Transaction writer in the monolith). These
// helpers ARE that single mapping layer. They are PURE and unit-testable: no
// React, no Convex, no side effects — given the same inputs they always return
// the same NewTransactionInput.
//
// Why this exists: before this module each capture path built its own ad-hoc
// transaction object (AIView.createMovement, ReceiptsView.createMovementFromReceipt,
// AddMovementView), which let provenance/status/tags drift. Funnelling all paths
// through these helpers + addTransaction guarantees one consistent save path.
// ============================================================================

import type { ExchangeQuote } from "./currency";
import { toCents } from "./finance";
import type { NaturalCaptureSuggestion } from "./natural-capture";
import type {
  AppState,
  AttachmentRef,
  CurrencyCode,
  LineItem,
  NewTransactionInput,
  ReceiptAttachment,
  TransactionType,
  View,
} from "./types";

// Today as YYYY-MM-DD (the format Transaction.date / NewTransactionInput.date use).
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// Parse a comma-separated tags string into a trimmed, non-empty list.
function splitTags(tags: string): string[] {
  return tags
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

// Join a list of tags back into the comma-separated string NewTransactionInput uses,
// de-duplicated and order-preserving (first occurrence wins).
function joinTags(tags: string[]): string {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const tag of tags) {
    const trimmed = tag.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    ordered.push(trimmed);
  }
  return ordered.join(", ");
}

// Map ExchangeQuote (currency.ts) onto the three exchange fields of the input.
function exchangeFields(quote: ExchangeQuote): {
  exchangeRate: number;
  exchangeRateDate: string;
  exchangeRateSource: "api" | "manual" | "same_currency";
} {
  return {
    exchangeRate: quote.rate,
    exchangeRateDate: quote.date,
    exchangeRateSource: quote.source,
  };
}

// ---------------------------------------------------------------------------
// suggestionToInput(s, opts)
//
// Maps a NaturalCaptureSuggestion (AI text, local heuristic, or the suggestion
// half of a ReceiptExtraction) to a NewTransactionInput. Mirrors what the old
// AIView.createMovement built inline: transferAccountId defaults to the same
// account (only used when type === 'transfer'), date defaults to today, and the
// exchange fields come from the resolved quote.
//
// `opts.date` lets a caller override the date (e.g. a receipt's own date).
// `opts.attachmentRefs` threads real uploaded files so the created
// ReceiptAttachment can carry its storageId (the file pointer that must survive
// autosave). attachmentNames is derived from those refs for back-compat.
// `opts.afterSaveView` lets the caller pick where to land after saving.
// ---------------------------------------------------------------------------
export function suggestionToInput(
  s: NaturalCaptureSuggestion,
  opts: {
    date?: string;
    attachmentRefs?: AttachmentRef[];
    quote: ExchangeQuote;
    afterSaveView?: View;
    extraTags?: string[];
  },
): NewTransactionInput {
  const refs = opts.attachmentRefs ?? [];
  const tags = joinTags([...splitTags(s.tags), ...(opts.extraTags ?? [])]);
  return {
    type: s.type,
    date: opts.date || today(),
    amount: s.amount,
    currency: s.currency,
    ...exchangeFields(opts.quote),
    accountId: s.accountId,
    // Only consumed by addTransaction when type === 'transfer'; mirror the
    // source account so the field is never empty (matches AIView.createMovement).
    transferAccountId: s.accountId,
    linkedTransactionId: "",
    linkKind: undefined,
    categoryId: s.categoryId,
    subcategory: s.subcategory,
    description: s.description,
    merchant: s.merchant,
    tags,
    note: s.note,
    needsReview: s.needsReview,
    attachmentNames: refs.map((ref) => ref.fileName),
    attachmentRefs: refs.length > 0 ? refs : undefined,
    afterSaveView: opts.afterSaveView,
  };
}

// ---------------------------------------------------------------------------
// receiptToInput(r, s, quote, transient?)
//
// Maps a ReceiptAttachment (+ an optional suggestion from AI/heuristic, +
// optional transient review-only signals) to a NewTransactionInput, preserving
// the receipt provenance that the old createMovementFromReceipt guaranteed:
//   - status 'needs_review'  -> needsReview: true (a receipt is ALWAYS reviewed)
//   - a 'recibo' tag          -> always present, first, de-duplicated
//   - createdBy 'Recibo'      -> carried as the RECEIPT_CREATED_BY tag + note so it
//                                survives the converged addTransaction (which sets
//                                createdBy from the signed-in user). See note below.
//
// Transient folds (NOT persisted as their own columns — Product Decision #4):
//   - transient.discountText -> appended to note + a 'descuento' tag
//   - transient.receiptDate  -> Transaction.date (falls back to r.date, then today)
//   - transient.isReceipt    -> currently informational; influences nothing here,
//                               the review UI shows the banner.
//   - transient.items        -> mapped to NewTransactionInput.lineItems (the parsed
//                               factura lines): each raw {name, quantity, amount:string}
//                               becomes {name, quantity, amountCents}. Quantity falls
//                               back to 1; amount is parsed with toCents (line TOTAL).
//
// NOTE on createdBy: NewTransactionInput has NO createdBy field — addTransaction
// derives createdBy from the signed-in user. To keep the 'Recibo' provenance the
// old path guaranteed, we tag the input with RECEIPT_TAG ('recibo'). The monolith
// integrator may additionally special-case receipt inputs to stamp createdBy
// 'Recibo'; the tag is the portable, persisted signal that this came from a recibo.
// ---------------------------------------------------------------------------
export const RECEIPT_TAG = "recibo";
export const DISCOUNT_TAG = "descuento";
export const RECEIPT_CREATED_BY = "Recibo";

export function receiptToInput(
  r: ReceiptAttachment,
  s: NaturalCaptureSuggestion | null,
  quote: ExchangeQuote,
  transient?: {
    discountText?: string;
    receiptDate?: string;
    isReceipt?: boolean;
    items?: { name: string; quantity: number; amount: string }[];
  },
): NewTransactionInput {
  const currency: CurrencyCode = r.currency ?? s?.currency ?? "USD";
  const amountFromReceipt =
    typeof r.amountCents === "number" ? (r.amountCents / 100).toString() : "";
  const amount = amountFromReceipt || s?.amount || "";
  const type: TransactionType = s?.type ?? "expense";

  // Description / merchant / note precedence mirrors createMovementFromReceipt:
  // the suggestion leads, the receipt's own metadata is the fallback.
  const description =
    s?.description ||
    (r.merchant ? `Recibo ${r.merchant}` : "") ||
    r.fileName;
  const merchant = r.merchant || s?.merchant || "";

  // Fold the discount (transient review signal) into the note as free text and
  // add a 'descuento' tag — NO new column is introduced (field-mapping decision).
  const baseNote = s?.note || r.extractedText || r.note || "";
  const discount = transient?.discountText?.trim();
  const note = discount
    ? [baseNote, `Descuento: ${discount}`].filter(Boolean).join(" — ")
    : baseNote;

  // Tags: 'recibo' is always first; fold 'descuento' when a discount is present;
  // then append the suggestion's own tags. joinTags de-dups + preserves order.
  const tags = joinTags([
    RECEIPT_TAG,
    ...(discount ? [DISCOUNT_TAG] : []),
    ...(s ? splitTags(s.tags) : []),
  ]);

  // The single real attachment for this receipt, carrying storageId so the file
  // pointer survives the next autosave (the highest-priority risk in the plan).
  const refs: AttachmentRef[] = [
    { fileName: r.fileName, storageId: r.storageId, contentType: r.contentType },
  ];

  // receiptDate -> Transaction.date (existing field). Precedence: explicit
  // transient signal, then the receipt's own date, then today.
  const date = transient?.receiptDate || r.date || today();

  // Parsed factura lines -> persisted LineItem[]. amount is a raw decimal string
  // from the model (the line TOTAL); toCents parses it. quantity defaults to 1.
  // Omitted entirely (undefined) when no items were parsed, so the manual/text
  // paths and itemless receipts stay valid.
  const lineItems: LineItem[] | undefined =
    transient?.items && transient.items.length
      ? transient.items.map((item) => ({
          name: item.name,
          quantity: item.quantity || 1,
          amountCents: toCents(item.amount),
        }))
      : undefined;

  return {
    type,
    date,
    amount,
    currency,
    ...exchangeFields(quote),
    accountId: s?.accountId ?? "",
    transferAccountId: s?.accountId ?? "",
    linkedTransactionId: "",
    linkKind: undefined,
    categoryId: s?.categoryId ?? "",
    subcategory: s?.subcategory ?? "",
    description,
    merchant,
    tags,
    note,
    // A receipt-sourced movement is ALWAYS reviewed before it counts.
    needsReview: true,
    attachmentNames: [r.fileName],
    attachmentRefs: refs,
    // Parsed factura lines (optional + additive); undefined for itemless receipts.
    lineItems,
    afterSaveView: "movements",
  };
}

// ---------------------------------------------------------------------------
// emptyManualInput(state)
//
// The blank starting point for the manual AddMovement form: an expense today in
// the household currency, on the default-for-capture account (falling back to the
// first account), with the first non-income category. Pure: derives only from the
// passed AppState. exchangeRateSource starts as 'same_currency' (rate 1) because
// the default currency equals the base currency until the user changes it.
// ---------------------------------------------------------------------------
export function emptyManualInput(state: AppState): NewTransactionInput {
  const defaultAccount =
    state.accounts.find((account) => account.defaultForCapture && !account.archived) ??
    state.accounts.find((account) => !account.archived) ??
    state.accounts[0];
  const defaultCategory =
    state.categories.find((category) => category.group !== "income" && !category.archived) ??
    state.categories.find((category) => !category.archived) ??
    state.categories[0];

  return {
    type: "expense",
    date: today(),
    amount: "",
    currency: state.currency,
    exchangeRate: 1,
    exchangeRateDate: today(),
    exchangeRateSource: "same_currency",
    accountId: defaultAccount?.id ?? "",
    transferAccountId: defaultAccount?.id ?? "",
    linkedTransactionId: "",
    linkKind: undefined,
    categoryId: defaultCategory?.id ?? "",
    subcategory: defaultCategory?.subcategories[0] ?? "",
    description: "",
    merchant: "",
    tags: "",
    note: "",
    needsReview: false,
    attachmentNames: [],
    attachmentRefs: undefined,
    afterSaveView: undefined,
  };
}
