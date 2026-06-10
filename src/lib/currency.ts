import type { CurrencyCode } from "./types";

export const supportedCurrencies: CurrencyCode[] = ["DOP", "USD", "MXN", "EUR"];

const fallbackRates: Record<CurrencyCode, Record<CurrencyCode, number>> = {
  DOP: { DOP: 1, USD: 0.0169, MXN: 0.31, EUR: 0.0148 },
  USD: { DOP: 59.1, USD: 1, MXN: 18.35, EUR: 0.88 },
  MXN: { DOP: 3.22, USD: 0.0545, MXN: 1, EUR: 0.048 },
  EUR: { DOP: 67.1, USD: 1.14, MXN: 20.9, EUR: 1 },
};

export interface ExchangeQuote {
  rate: number;
  date: string;
  source: "api" | "manual" | "same_currency";
}

export async function quoteExchangeRate(from: CurrencyCode, to: CurrencyCode): Promise<ExchangeQuote> {
  const date = new Date().toISOString().slice(0, 10);

  if (from === to) {
    return { rate: 1, date, source: "same_currency" };
  }

  try {
    const response = await fetch(`https://open.er-api.com/v6/latest/${from}`, {
      cache: "no-store",
    });
    const data = await response.json() as { result?: string; rates?: Partial<Record<CurrencyCode, number>>; time_last_update_utc?: string };
    const rate = data.rates?.[to];

    if (data.result === "success" && typeof rate === "number" && Number.isFinite(rate)) {
      return {
        rate,
        date: data.time_last_update_utc ? new Date(data.time_last_update_utc).toISOString().slice(0, 10) : date,
        source: "api",
      };
    }
  } catch {
    // Keep capture usable offline; the user can overwrite the fixed rate.
  }

  return { rate: fallbackRates[from][to], date, source: "manual" };
}
