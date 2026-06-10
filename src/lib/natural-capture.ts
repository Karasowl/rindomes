import type { AppState, CurrencyCode, TransactionType } from "./types";

export interface NaturalCaptureSuggestion {
  type: TransactionType;
  amount: string;
  currency: CurrencyCode;
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
}

const currencyTokens: Record<string, CurrencyCode> = {
  rd: "DOP",
  dop: "DOP",
  peso: "DOP",
  pesos: "DOP",
  usd: "USD",
  dolar: "USD",
  dolares: "USD",
  mxn: "MXN",
  eur: "EUR",
  euro: "EUR",
  euros: "EUR",
};

const incomeWords = ["cobre", "cobro", "recibi", "ingreso", "pago consultorio", "salario", "comision"];
// Note: "tarjeta" is intentionally NOT a debt word. Paying WITH a card is a normal
// expense; only paying DOWN a card/loan is a debt payment.
const debtWords = ["deuda", "prestamo", "cuota", "abono"];
const savingWords = ["ahorre", "ahorro", "meta", "fondo"];
// Stems matched at a word boundary so unrelated words (e.g. "ferreteria") never
// trigger by accident.
const investmentWords = ["invert", "inversion", "bolsa", "retiro"];

function hasKeyword(text: string, stems: string[]) {
  return stems.some((stem) => new RegExp(`\\b${stem}`).test(text));
}

export function suggestFromNaturalText(text: string, state: AppState): NaturalCaptureSuggestion {
  const normalized = normalize(text);
  const amount = detectAmount(normalized);
  const currency = detectCurrency(normalized, state.currency);
  const type = detectType(normalized);
  const category = detectCategory(normalized, state, type);
  const account = detectAccount(normalized, state);
  const merchant = detectMerchant(text);
  const reasons: string[] = [];

  if (amount > 0) reasons.push("Monto detectado en el texto.");
  if (currency !== state.currency) reasons.push(`Moneda original detectada: ${currency}.`);
  if (category) reasons.push(`Categoria sugerida por coincidencia: ${category.name}.`);
  if (account) reasons.push(`Cuenta sugerida: ${account.name}.`);
  if (merchant) reasons.push(`Comercio/persona detectado: ${merchant}.`);

  const confidence =
    (amount > 0 ? 0.3 : 0) +
    (category ? 0.25 : 0) +
    (account ? 0.15 : 0) +
    (merchant ? 0.1 : 0) +
    (text.length > 12 ? 0.1 : 0.05);

  const fallbackCategory = state.categories.find((item) => type === "income" ? item.group === "income" : item.group !== "income") ?? state.categories[0];
  const finalCategory = category ?? fallbackCategory;

  return {
    type,
    amount: amount ? String(amount) : "",
    currency,
    categoryId: finalCategory.id,
    subcategory: detectSubcategory(normalized, finalCategory.subcategories) ?? finalCategory.subcategories[0] ?? "",
    accountId: account?.id ?? state.accounts[0]?.id ?? "",
    description: cleanDescription(text, merchant),
    merchant,
    tags: ["texto-natural", confidence < 0.75 ? "revisar" : ""].filter(Boolean).join(", "),
    note: `Capturado por texto: ${text}`,
    confidence: Math.min(confidence, 0.95),
    reasons,
    needsReview: confidence < 0.75,
  };
}

function detectAmount(text: string) {
  const match = text.match(/(?:rd\$|\$|usd|dop|mxn|eur)?\s*(\d+(?:[.,]\d{1,2})?)/i);
  if (!match) return 0;
  return Number.parseFloat(match[1].replace(",", ".")) || 0;
}

function detectCurrency(text: string, fallback: CurrencyCode) {
  for (const [token, currency] of Object.entries(currencyTokens)) {
    if (new RegExp(`\\b${token}\\b`, "i").test(text)) return currency;
  }
  if (text.includes("$")) return fallback;
  return fallback;
}

function detectType(text: string): TransactionType {
  if (hasKeyword(text, incomeWords)) return "income";
  if (hasKeyword(text, debtWords)) return "debt_payment";
  if (hasKeyword(text, savingWords)) return "saving";
  if (hasKeyword(text, investmentWords)) return "investment";
  return "expense";
}

function detectCategory(text: string, state: AppState, type: TransactionType) {
  const candidates = state.categories.filter((category) => type === "income" ? category.group === "income" : category.group !== "income");
  return candidates.find((category) => {
    const tokens = [category.name, ...category.subcategories].map(normalize).filter(Boolean);
    return tokens.some((token) => token && text.includes(token));
  });
}

function detectSubcategory(text: string, subcategories: string[]) {
  return subcategories.find((subcategory) => text.includes(normalize(subcategory)));
}

function detectAccount(text: string, state: AppState) {
  if (text.includes("tarjeta")) return state.accounts.find((account) => account.kind === "credit") ?? state.accounts[0];
  if (text.includes("efectivo") || text.includes("cash")) return state.accounts.find((account) => account.kind === "cash") ?? state.accounts[0];
  if (text.includes("banco") || text.includes("cuenta")) return state.accounts.find((account) => account.kind === "bank") ?? state.accounts[0];
  return state.accounts.find((account) => text.includes(normalize(account.name))) ?? state.accounts[0];
}

function detectMerchant(text: string) {
  const match = text.match(/\b(?:en|a|para|de)\s+([A-Za-z0-9 ._-]{3,40})/i);
  return match?.[1]?.replace(/\s+(con|por|usando|el|la|los|las)\b.*$/i, "").trim() ?? "";
}

function cleanDescription(text: string, merchant: string) {
  const compact = text.trim().replace(/\s+/g, " ");
  if (!merchant) return compact.slice(0, 80);
  return compact.replace(merchant, "").replace(/\s+/g, " ").trim().slice(0, 80) || merchant;
}

function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
