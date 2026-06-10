// Single source of human-facing Spanish (es-DO) labels for enum-like values.
// Display-only: never change stored data, enum values, props, or control flow —
// these maps only translate codes into what the USER SEES so no raw code leaks to the UI.
//
// Every enum exports a Record<string, string> map AND a tiny helper that returns the
// label, falling back to the raw value if the code is unknown. The union members below
// are the REAL ones declared in ./types.ts (do not invent values).
//
// Pure module: no React, no imports beyond types.

import type {
  AiProvider,
  CurrencyCode,
  RecurringFrequency,
  SubscriptionPlan,
  TransactionType,
} from "./types";
import { getActiveLang } from "./i18n";

// Account.kind: "cash" | "bank" | "credit" | "savings" | "investment"
export const ACCOUNT_KIND_LABELS: Record<string, string> = {
  cash: "Efectivo",
  bank: "Banco",
  credit: "Tarjeta de crédito",
  savings: "Ahorro",
  investment: "Inversión",
};
export const ACCOUNT_KIND_LABELS_EN: Record<string, string> = {
  cash: "Cash",
  bank: "Bank",
  credit: "Credit card",
  savings: "Savings",
  investment: "Investment",
};
export function accountKindLabel(k: string): string {
  const m = getActiveLang() === "es" ? ACCOUNT_KIND_LABELS : ACCOUNT_KIND_LABELS_EN;
  return m[k] ?? ACCOUNT_KIND_LABELS[k] ?? k;
}

// TransactionType: "income" | "expense" | "transfer" | "debt_payment" | "saving" | "investment" | "refund"
export const TRANSACTION_TYPE_LABELS: Record<TransactionType, string> = {
  income: "Ingreso",
  expense: "Gasto",
  transfer: "Transferencia",
  debt_payment: "Deuda",
  saving: "Ahorro",
  investment: "Inversión",
  refund: "Reembolso",
};
export const TRANSACTION_TYPE_LABELS_EN: Record<TransactionType, string> = {
  income: "Income",
  expense: "Expense",
  transfer: "Transfer",
  debt_payment: "Debt",
  saving: "Saving",
  investment: "Investment",
  refund: "Refund",
};
export function transactionTypeLabel(t: string): string {
  const m = getActiveLang() === "es" ? TRANSACTION_TYPE_LABELS : TRANSACTION_TYPE_LABELS_EN;
  return m[t as TransactionType] ?? TRANSACTION_TYPE_LABELS[t as TransactionType] ?? t;
}

// Transaction.status: "approved" | "needs_review" | "duplicate" | "adjustment"
export const TRANSACTION_STATUS_LABELS: Record<string, string> = {
  approved: "Aprobado",
  needs_review: "Por revisar",
  duplicate: "Duplicado",
  adjustment: "Ajuste",
};
export const TRANSACTION_STATUS_LABELS_EN: Record<string, string> = {
  approved: "Approved",
  needs_review: "Needs review",
  duplicate: "Duplicate",
  adjustment: "Adjustment",
};
export function transactionStatusLabel(s: string): string {
  const m = getActiveLang() === "es" ? TRANSACTION_STATUS_LABELS : TRANSACTION_STATUS_LABELS_EN;
  return m[s] ?? TRANSACTION_STATUS_LABELS[s] ?? s;
}

// ReviewItem.reason:
// "uncategorized" | "duplicate" | "balance_adjustment" | "ai_suggestion"
// | "receipt_pending" | "budget_risk" | "recurring_pending" | "account_unconfirmed"
export const REVIEW_REASON_LABELS: Record<string, string> = {
  uncategorized: "Sin categoría",
  duplicate: "Movimiento duplicado",
  balance_adjustment: "Ajuste de saldo",
  ai_suggestion: "Sugerencia IA",
  receipt_pending: "Recibo pendiente",
  budget_risk: "Riesgo de presupuesto",
  recurring_pending: "Recurrente pendiente",
  account_unconfirmed: "Cuenta sin confirmar",
};
export const REVIEW_REASON_LABELS_EN: Record<string, string> = {
  uncategorized: "Uncategorized",
  duplicate: "Duplicate transaction",
  balance_adjustment: "Balance adjustment",
  ai_suggestion: "AI suggestion",
  receipt_pending: "Receipt pending",
  budget_risk: "Budget risk",
  recurring_pending: "Recurring pending",
  account_unconfirmed: "Account unconfirmed",
};
export function reviewReasonLabel(r: string): string {
  const m = getActiveLang() === "es" ? REVIEW_REASON_LABELS : REVIEW_REASON_LABELS_EN;
  return m[r] ?? REVIEW_REASON_LABELS[r] ?? r;
}

// Member.role / FinancialSpace.role: "owner" | "editor" | "viewer"
export const ROLE_LABELS: Record<string, string> = {
  owner: "Propietario",
  editor: "Editor",
  viewer: "Solo lectura",
};
export const ROLE_LABELS_EN: Record<string, string> = {
  owner: "Owner",
  editor: "Editor",
  viewer: "View only",
};
export function roleLabel(role: string): string {
  const m = getActiveLang() === "es" ? ROLE_LABELS : ROLE_LABELS_EN;
  return m[role] ?? ROLE_LABELS[role] ?? role;
}

// RecurringFrequency: "weekly" | "biweekly" | "monthly" | "yearly"
export const RECURRING_FREQUENCY_LABELS: Record<RecurringFrequency, string> = {
  weekly: "Semanal",
  biweekly: "Quincenal",
  monthly: "Mensual",
  yearly: "Anual",
};
export const RECURRING_FREQUENCY_LABELS_EN: Record<RecurringFrequency, string> = {
  weekly: "Weekly",
  biweekly: "Biweekly",
  monthly: "Monthly",
  yearly: "Yearly",
};
export function recurringFrequencyLabel(f: string): string {
  const m = getActiveLang() === "es" ? RECURRING_FREQUENCY_LABELS : RECURRING_FREQUENCY_LABELS_EN;
  return m[f as RecurringFrequency] ?? RECURRING_FREQUENCY_LABELS[f as RecurringFrequency] ?? f;
}

// Debt.strategy: "snowball" | "avalanche" | "manual"
export const DEBT_STRATEGY_LABELS: Record<string, string> = {
  avalanche: "Avalancha (tasa alta primero)",
  snowball: "Bola de nieve (saldo pequeño primero)",
  manual: "Manual",
};
export const DEBT_STRATEGY_LABELS_EN: Record<string, string> = {
  avalanche: "Avalanche (highest rate first)",
  snowball: "Snowball (smallest balance first)",
  manual: "Manual",
};
export function debtStrategyLabel(s: string): string {
  const m = getActiveLang() === "es" ? DEBT_STRATEGY_LABELS : DEBT_STRATEGY_LABELS_EN;
  return m[s] ?? DEBT_STRATEGY_LABELS[s] ?? s;
}

// SubscriptionPlan: "free" | "pro"
export const SUBSCRIPTION_PLAN_LABELS: Record<SubscriptionPlan, string> = {
  free: "Gratis",
  pro: "Pro",
};
export const SUBSCRIPTION_PLAN_LABELS_EN: Record<SubscriptionPlan, string> = {
  free: "Free",
  pro: "Pro",
};
export function subscriptionPlanLabel(p: string): string {
  const m = getActiveLang() === "es" ? SUBSCRIPTION_PLAN_LABELS : SUBSCRIPTION_PLAN_LABELS_EN;
  return m[p as SubscriptionPlan] ?? SUBSCRIPTION_PLAN_LABELS[p as SubscriptionPlan] ?? p;
}

// AiProvider (AiSettings.provider): "local" | "openai" | "byok" | "claude" | "openrouter"
export const AI_PROVIDER_LABELS: Record<AiProvider, string> = {
  local: "Local (sin nube)",
  openai: "OpenAI",
  byok: "Tu propia clave",
  claude: "Claude",
  openrouter: "OpenRouter",
};
export const AI_PROVIDER_LABELS_EN: Record<AiProvider, string> = {
  local: "Local (no cloud)",
  openai: "OpenAI",
  byok: "Your own key",
  claude: "Claude",
  openrouter: "OpenRouter",
};
export function aiProviderLabel(p: string): string {
  const m = getActiveLang() === "es" ? AI_PROVIDER_LABELS : AI_PROVIDER_LABELS_EN;
  return m[p as AiProvider] ?? AI_PROVIDER_LABELS[p as AiProvider] ?? p;
}

// CurrencyCode: "DOP" | "USD" | "MXN" | "EUR"
export const CURRENCY_LABELS: Record<CurrencyCode, string> = {
  DOP: "Peso dominicano (DOP)",
  USD: "Dólar estadounidense (USD)",
  MXN: "Peso mexicano (MXN)",
  EUR: "Euro (EUR)",
};
export const CURRENCY_LABELS_EN: Record<CurrencyCode, string> = {
  DOP: "Dominican peso (DOP)",
  USD: "US dollar (USD)",
  MXN: "Mexican peso (MXN)",
  EUR: "Euro (EUR)",
};
export function currencyLabel(c: string): string {
  const m = getActiveLang() === "es" ? CURRENCY_LABELS : CURRENCY_LABELS_EN;
  return m[c as CurrencyCode] ?? CURRENCY_LABELS[c as CurrencyCode] ?? c;
}

// FinancialSpace.kind: "personal" | "family" | "business" | "test"
export const SPACE_KIND_LABELS: Record<string, string> = {
  personal: "Personal",
  family: "Familia",
  business: "Negocio",
  test: "Prueba",
};
export const SPACE_KIND_LABELS_EN: Record<string, string> = {
  personal: "Personal",
  family: "Family",
  business: "Business",
  test: "Test",
};
export function spaceKindLabel(k: string): string {
  const m = getActiveLang() === "es" ? SPACE_KIND_LABELS : SPACE_KIND_LABELS_EN;
  return m[k] ?? SPACE_KIND_LABELS[k] ?? k;
}

// ReceiptAttachment.source: "receipt" | "invoice" | "statement" | "other"
export const RECEIPT_SOURCE_LABELS: Record<string, string> = {
  receipt: "Ticket/recibo",
  invoice: "Factura",
  statement: "Estado de cuenta",
  other: "Otro",
};
export const RECEIPT_SOURCE_LABELS_EN: Record<string, string> = {
  receipt: "Receipt",
  invoice: "Invoice",
  statement: "Statement",
  other: "Other",
};
export function receiptSourceLabel(s: string): string {
  const m = getActiveLang() === "es" ? RECEIPT_SOURCE_LABELS : RECEIPT_SOURCE_LABELS_EN;
  return m[s] ?? RECEIPT_SOURCE_LABELS[s] ?? s;
}

// ReceiptAttachment.status: "uploaded" | "processing" | "needs_review" | "confirmed" | "error"
export const RECEIPT_STATUS_LABELS: Record<string, string> = {
  uploaded: "Subido",
  processing: "Procesando",
  needs_review: "Pendiente",
  confirmed: "Confirmado",
  error: "Error",
};
export const RECEIPT_STATUS_LABELS_EN: Record<string, string> = {
  uploaded: "Uploaded",
  processing: "Processing",
  needs_review: "Pending",
  confirmed: "Confirmed",
  error: "Error",
};
export function receiptStatusLabel(s: string): string {
  const m = getActiveLang() === "es" ? RECEIPT_STATUS_LABELS : RECEIPT_STATUS_LABELS_EN;
  return m[s] ?? RECEIPT_STATUS_LABELS[s] ?? s;
}

// Goal.priority: "low" | "medium" | "high"
export const PRIORITY_LABELS: Record<string, string> = {
  low: "Baja",
  medium: "Media",
  high: "Alta",
};
export const PRIORITY_LABELS_EN: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};
export function priorityLabel(p: string): string {
  const m = getActiveLang() === "es" ? PRIORITY_LABELS : PRIORITY_LABELS_EN;
  return m[p] ?? PRIORITY_LABELS[p] ?? p;
}

// AiAction.kind: "text_capture" | "receipt_parse" | "monthly_summary" | "budget_suggestion"
export const AI_ACTION_KIND_LABELS: Record<string, string> = {
  text_capture: "Captura de texto",
  receipt_parse: "Lectura de recibo",
  monthly_summary: "Resumen mensual",
  budget_suggestion: "Sugerencia de presupuesto",
};
export const AI_ACTION_KIND_LABELS_EN: Record<string, string> = {
  text_capture: "Text capture",
  receipt_parse: "Receipt parsing",
  monthly_summary: "Monthly summary",
  budget_suggestion: "Budget suggestion",
};
export function aiActionKindLabel(k: string): string {
  const m = getActiveLang() === "es" ? AI_ACTION_KIND_LABELS : AI_ACTION_KIND_LABELS_EN;
  return m[k] ?? AI_ACTION_KIND_LABELS[k] ?? k;
}

// AiAction.status: "suggested" | "accepted" | "failed"
export const AI_ACTION_STATUS_LABELS: Record<string, string> = {
  suggested: "Sugerida",
  accepted: "Aceptada",
  failed: "Fallida",
};
export const AI_ACTION_STATUS_LABELS_EN: Record<string, string> = {
  suggested: "Suggested",
  accepted: "Accepted",
  failed: "Failed",
};
export function aiActionStatusLabel(s: string): string {
  const m = getActiveLang() === "es" ? AI_ACTION_STATUS_LABELS : AI_ACTION_STATUS_LABELS_EN;
  return m[s] ?? AI_ACTION_STATUS_LABELS[s] ?? s;
}

// Merchant nicknames (AppState.merchantAliases): map a raw OCR/bank merchant string to a
// clean display alias the user prefers. Display-only: never mutates the stored raw value.
// Matching is forgiving — lowercased + trimmed — so "  AMAZON " matches a saved "amazon" alias.
// Optional + additive: when there are no aliases (or no match) the raw merchant is returned
// unchanged, so transactions and households without aliases keep working exactly as before.

// Normalizer used to compare a raw merchant against saved aliases. Keep matching logic here so
// callers (and tests) share one definition instead of re-implementing lowercase/trim each time.
export function normalizeMerchant(value: string): string {
  return value.trim().toLowerCase();
}

// Returns the alias whose `raw` matches the given merchant (case-insensitive, trimmed),
// otherwise returns the original raw merchant untouched.
export function merchantDisplay(
  raw: string,
  aliases?: { raw: string; alias: string }[],
): string {
  if (!aliases || aliases.length === 0) return raw;
  const needle = normalizeMerchant(raw);
  if (!needle) return raw;
  const match = aliases.find((entry) => normalizeMerchant(entry.raw) === needle);
  const alias = match?.alias.trim();
  return alias ? alias : raw;
}
