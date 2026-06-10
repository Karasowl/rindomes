// ============================================================================
// src/lib/ai-client.ts
// Provider selection for receipt/file capture.
//
// Decides between the entitled AI vision path (the injected Convex action
// `api.ai.parseReceiptWithAI`) and the free local heuristic, and ALWAYS falls
// back to the heuristic on any failure so the user is never blocked.
//
// PURITY / NO CONVEX IMPORT: this module never imports `convex` or the generated
// `api`. The Convex action is INJECTED as `callParse` (the caller binds it via
// useAction(api.ai.parseReceiptWithAI)). That keeps ai-client.ts unit-testable
// (you pass a fake callParse) and free of the convex runtime dependency. The
// `Id`-typed arguments are accepted as opaque strings here; the real Convex
// Id<T> branded strings the monolith passes are assignable to string.
// ============================================================================

import { suggestFromNaturalText, type NaturalCaptureSuggestion } from "./natural-capture";
import type { AiCaptureResult } from "./entitlement";
import type { AppState, ReceiptAttachment } from "./types";

// Opaque id type. The monolith passes real Convex Id<"attachments"> / Id<"households">
// branded strings, which satisfy `string`. Kept as `string` so this module needs
// no generated-types dependency.
type AttachmentId = string;
type HouseholdId = string;

// The output shape callers (receipt-capture view, monolith) consume. Always
// returns a usable suggestion: from the cloud model when entitled+available,
// otherwise from the local heuristic. `error` is set only when we fell back after
// a real AI attempt, so the UI can show an honest "usamos reglas locales" banner.
export interface AnalyzeReceiptResult {
  suggestion: NaturalCaptureSuggestion;
  isReceipt: boolean;
  provider: "openrouter" | "local";
  error?: string;
  usedModel?: string; // the OpenRouter model that produced the read
  usedTier?: "free" | "paid"; // free model or paid-credit fallback
  notice?: string; // e.g. the free model failed and we used the paid one
  // The server's failure code when we fell back (so the caller can route
  // not_entitled -> paywall, etc.). Absent on success or a plain AI-off skip.
  failCode?: "not_entitled" | "no_credits" | "ai_failed" | "bad_file" | "ai_off";
  // Transient review-only signals forwarded from the cloud extraction so the
  // review form can seed them. WITHOUT these, the receipt's parsed line items
  // never reach the editable rows, the printed date falls back to "today", and a
  // detected discount is lost. Absent on the local heuristic.
  items?: { name: string; quantity: number; amount: string }[];
  discountText?: string; // detected discount/savings, e.g. "RD$50"
  receiptDate?: string; // the printed receipt date (YYYY-MM-DD) -> Transaction.date
}

// Build the local-heuristic suggestion from whatever text the receipt carries
// (OCR/extracted text, note, merchant, amount), falling back to the file name.
// Mirrors ReceiptsView.analyzeReceipt's text assembly so the local path behaves
// identically whether reached directly or as the AI fallback.
function localSuggestionFromReceipt(
  receipt: ReceiptAttachment,
  state: AppState,
): NaturalCaptureSuggestion {
  const text = [
    receipt.extractedText,
    receipt.note,
    receipt.merchant,
    typeof receipt.amountCents === "number"
      ? `${receipt.amountCents / 100} ${receipt.currency ?? state.currency}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
  return suggestFromNaturalText(text || receipt.fileName, state);
}

// ---------------------------------------------------------------------------
// analyzeReceiptFile(opts)
//
// Flow:
//   1. ADVISORY gate: if the client snapshot says AI is off / not pro / no
//      credits, skip the round-trip and go straight to the local heuristic.
//      (The server re-checks authoritatively; this just avoids a guaranteed
//      failure round-trip and gives an honest provider:'local' result.)
//   2. Otherwise call the injected Convex action (callParse). On a true success
//      return the Claude extraction. On an entitlement/credits/failure result,
//      fall back to the local heuristic with an honest error message.
//   3. If callParse throws (network, action error), fall back to local too.
//
// The function NEVER throws and NEVER returns without a usable suggestion.
// ---------------------------------------------------------------------------
export async function analyzeReceiptFile(opts: {
  attachmentId: AttachmentId;
  householdId: HouseholdId;
  receipt?: ReceiptAttachment;
  state: AppState;
  aiEnabled: boolean;
  callParse: (a: {
    householdId: HouseholdId;
    attachmentId: AttachmentId;
  }) => Promise<AiCaptureResult>;
}): Promise<AnalyzeReceiptResult> {
  const { attachmentId, householdId, state, aiEnabled, callParse } = opts;

  const localFallback = (
    error?: string,
    failCode?: AnalyzeReceiptResult["failCode"],
  ): AnalyzeReceiptResult => ({
    suggestion: opts.receipt
      ? localSuggestionFromReceipt(opts.receipt, state)
      : suggestFromNaturalText(attachmentId, state),
    // The local heuristic can't tell a receipt from a note; treat as receipt by
    // default in this file-capture flow so the review banner stays neutral.
    isReceipt: true,
    provider: "local",
    error,
    failCode,
  });

  // Only skip the round-trip when AI is OFF. We do NOT pre-gate on the client's
  // (possibly stale) plan view — the server is the authority and returns a precise
  // reason — so an entitled user always gets the real AI read instead of a wrongly
  // skipped manual fallback. The caller routes `failCode === 'not_entitled'` to the paywall.
  if (!aiEnabled) {
    return localFallback();
  }

  try {
    const result = await callParse({ householdId, attachmentId });

    if (result.ok) {
      return {
        suggestion: result.extraction.suggestion,
        isReceipt: result.extraction.isReceipt,
        provider: "openrouter",
        usedModel: result.usedModel,
        usedTier: result.usedTier,
        notice: result.notice,
        // Forward the transient review-only signals so the review form seeds the
        // line-item rows, the printed receipt date, and any detected discount.
        items: result.extraction.items,
        discountText: result.extraction.discountText,
        receiptDate: result.extraction.receiptDate,
      };
    }

    // Authoritative failure from the server — fall back to the local heuristic but
    // carry the specific reason AND code so the UI shows why (límite/sin crédito/
    // inaccesible/ai-off) and can route not_entitled to the paywall.
    return localFallback(result.error, result.code);
  } catch (error) {
    // Network / action crash — never block the user; use the local heuristic.
    return localFallback(
      error instanceof Error ? error.message : "No se pudo contactar la IA.",
    );
  }
}
