// ============================================================================
// src/lib/entitlement.ts
// Shared entitlement + AI capture result types and PURE helpers.
//
// This module is the SINGLE source of truth for the entitlement/AI result
// shapes shared between the client (advisory UX gating) and the Convex action's
// return type (authoritative gating). It must stay PURE: no React, no Convex
// imports, no side effects — only types, constants and pure functions — so it
// can be imported from both `convex/` and `src/` and unit-tested in isolation.
//
// IMPORTANT: the client-side helpers here are ADVISORY ONLY. The server
// (convex/entitlement.ts -> getEntitlement / requireEntitlement) is the real,
// enforceable gate. These helpers exist so the UI can show the right paywall /
// "IA apagada" copy WITHOUT a round-trip, never to grant access.
// ============================================================================

import type { AppState } from "./types";
import type { NaturalCaptureSuggestion } from "./natural-capture";

// ---------------------------------------------------------------------------
// Entitlement view — mirrors the Convex `getEntitlement` query return shape.
// `canUseAi` is derived server-side from plan === "pro"; the client trusts the
// server value when present and only falls back to advisory logic offline.
// ---------------------------------------------------------------------------
export type EntitlementView = {
  plan: "free" | "pro";
  aiEnabled: boolean; // households.aiEnabled — a free-user preference, not a grant
  canUseAi: boolean; // plan === "pro" (the gate)
  aiCreditsUsed: number;
  aiCreditsLimit: number;
  proSource: "stub_checkout" | "manual_grant" | "none";
  proGrantedAt: number | null;
};

// One reason enum shared by the server (action gate) and the client (UX gate).
export type EntitlementReason = "ok" | "ai_off" | "not_pro" | "no_credits";

// ---------------------------------------------------------------------------
// The vision/text capture result wrapper.
// `isReceipt`, `discountText` and `receiptDate` are TRANSIENT review-only
// signals: they are folded into EXISTING transaction fields on approve (note +
// 'descuento' tag, Transaction.date) and are NOT persisted as their own columns.
// `items` are the parsed receipt/factura lines: also TRANSIENT here (raw model
// strings) — capture-input maps them to the persisted Transaction.lineItems
// (name + quantity + amountCents) on approve. Mirrors convex/ai.ts.
// ---------------------------------------------------------------------------
export interface ReceiptExtraction {
  suggestion: NaturalCaptureSuggestion;
  isReceipt: boolean; // receipt-vs-note detection; drives the review banner only
  discountText?: string; // folded into note + 'descuento' tag on approve
  receiptDate?: string; // maps to Transaction.date (existing field); YYYY-MM-DD
  // Parsed factura lines (amount is a raw decimal string); mapped to the
  // persisted Transaction.lineItems on approve. Optional + additive.
  items?: { name: string; quantity: number; amount: string }[];
}

// The Convex action (convex/ai.ts -> parseReceiptWithAI) returns EXACTLY this.
export type AiCaptureResult =
  | {
      ok: true;
      extraction: ReceiptExtraction;
      provider: "openrouter";
      usedModel?: string; // which OpenRouter model produced this
      usedTier?: "free" | "paid"; // free model or paid-credit fallback
      notice?: string; // e.g. "el gratis falló (429); se usó el de pago"
    }
  | {
      ok: false;
      code: "not_entitled" | "no_credits" | "ai_failed" | "bad_file" | "ai_off";
      error: string;
    };

// ---------------------------------------------------------------------------
// Spanish (es-DO) copy constants for the paywall / gate / review surfaces.
// Centralised here so the paywall view, receipt-capture view and the AI buttons
// all speak with one voice. User-facing copy lives in the lib (pure data) so it
// can be reused by both client components and server error messages.
// ---------------------------------------------------------------------------
export const ENTITLEMENT_COPY = {
  // Paywall (PaywallView)
  paywallKicker: "RindoMes Pro",
  paywallTitle: "Activa la captura con IA",
  paywallBody:
    "La lectura automática de recibos con IA es parte de RindoMes Pro. " +
    "Mientras tanto puedes seguir capturando a mano y con las reglas locales, " +
    "que son gratis y funcionan sin conexión.",
  paywallCta: "Activar Pro",
  paywallContinueManual: "Seguir en modo manual",

  // Gate reasons (advisory banners on the AI buttons / receipt-capture view)
  reasonOk: "",
  reasonAiOff: "La IA está apagada. Actívala en Ajustes para sugerir con IA.",
  reasonNotPro:
    "La captura con IA es una función de RindoMes Pro. Usa la captura manual o las reglas locales gratis.",
  reasonNoCredits:
    "Agotaste tus créditos de IA de este mes. Sigue con la captura manual o espera al próximo ciclo.",

  // AI capture failure (UI falls back to the local heuristic)
  aiFailedFallback:
    "No se pudo analizar con IA. Usamos las reglas locales como respaldo; revisa antes de guardar.",
  badFile: "El archivo no se pudo leer. Sube una imagen o PDF del recibo.",

  // Honest stub checkout — never a fake "subscribed" state.
  checkoutNotConfigured:
    "El pago aún no está disponible. Estamos terminando la integración de cobro; " +
    "por ahora la captura con IA se activa solo por concesión manual.",
} as const;

// Map an EntitlementReason to its user-facing es-DO message (advisory copy).
export function entitlementReasonMessage(reason: EntitlementReason): string {
  switch (reason) {
    case "ai_off":
      return ENTITLEMENT_COPY.reasonAiOff;
    case "not_pro":
      return ENTITLEMENT_COPY.reasonNotPro;
    case "no_credits":
      return ENTITLEMENT_COPY.reasonNoCredits;
    case "ok":
    default:
      return ENTITLEMENT_COPY.reasonOk;
  }
}

// ---------------------------------------------------------------------------
// entitlementForAi(state) — ADVISORY UX gate only.
//
// Decides, from the client's local snapshot, whether the AI capture button
// should be enabled and, if not, which reason to surface. This is intentionally
// permissive about what it can KNOW (the client only sees subscription.plan and
// aiSettings.enabled) and intentionally NON-authoritative: the server re-checks
// everything in requireEntitlement before any model call. The order of checks
// matches the server (ai_off -> not_pro -> no_credits) so the UX message lines
// up with the real failure the action would return.
// ---------------------------------------------------------------------------
export function entitlementForAi(
  state: AppState,
): { allowed: boolean; reason: EntitlementReason } {
  if (!state.aiSettings.enabled) {
    return { allowed: false, reason: "ai_off" };
  }
  if (state.subscription.plan !== "pro") {
    return { allowed: false, reason: "not_pro" };
  }
  if (state.subscription.aiCreditsUsed >= state.subscription.aiCreditsLimit) {
    return { allowed: false, reason: "no_credits" };
  }
  return { allowed: true, reason: "ok" };
}

// ---------------------------------------------------------------------------
// isNotEntitled(r) — type guard narrowing an AiCaptureResult to its failure arm.
// Lets callers write `if (isNotEntitled(result)) { showPaywall(result.error) }`.
// ---------------------------------------------------------------------------
export function isNotEntitled(
  r: AiCaptureResult,
): r is Extract<AiCaptureResult, { ok: false }> {
  return r.ok === false;
}
