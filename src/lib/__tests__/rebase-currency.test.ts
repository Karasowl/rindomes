import { describe, expect, it } from "vitest";
import { rebaseCurrency } from "@/lib/rebase-currency";
import { makeAccount, makeCategory, makePlan, makeState, makeTransaction } from "./fixtures";

// rate: units of USD per 1 DOP (quoteExchangeRate("DOP","USD").rate)
const RATE = 0.0169;
const DATE = "2026-06-10";

function dopState() {
  return makeState({
    currency: "DOP",
    activeSpaceId: "space-1",
    spaces: [
      { id: "space-1", name: "Hogar", kind: "personal", currency: "DOP", activeMonth: "2026-05", role: "owner", memberCount: 1, createdAt: "2026-01-01", updatedAt: "2026-01-01" },
      { id: "space-2", name: "Negocio", kind: "business", currency: "MXN", activeMonth: "2026-05", role: "owner", memberCount: 1, createdAt: "2026-01-01", updatedAt: "2026-01-01" },
    ],
    categories: [makeCategory({ id: "food", group: "essentials", name: "Comida", plannedCents: 100000 })],
    monthlyPlans: [{ ...makePlan("2026-05", "food", 100000), rolloverCents: 5000 }],
    accounts: [makeAccount({ id: "cash", name: "Efectivo", balanceCents: 250000, currency: "DOP", confirmedBalanceCents: 250000 })],
    transactions: [
      // A DOP-original expense (base == original today).
      makeTransaction({ type: "expense", date: "2026-05-02", categoryId: "food", amountCents: 50000, originalAmountCents: 50000, originalCurrency: "DOP", baseCurrency: "DOP", exchangeRate: 1, exchangeRateSource: "same_currency", splits: [{ id: "s1", categoryId: "food", amountCents: 20000 }] }),
      // A USD-original expense already converted into the DOP base.
      makeTransaction({ type: "expense", date: "2026-05-03", categoryId: "food", amountCents: 59100, originalAmountCents: 1000, originalCurrency: "USD", baseCurrency: "DOP", exchangeRate: 59.1, exchangeRateSource: "manual" }),
    ],
    goals: [{ id: "g1", name: "Viaje", targetCents: 1000000, savedCents: 300000, due: "2026-12-31" }],
    debts: [{ id: "d1", name: "Tarjeta", balanceCents: 800000, originalBalanceCents: 1000000, rate: 24, minimumCents: 50000, strategy: "avalanche" }],
    netWorth: [{ id: "n1", name: "Ahorros", kind: "asset", group: "bank", amountCents: 500000 }],
    review: [{ id: "r1", reason: "uncategorized", title: "Amazon", subtitle: "", amountCents: 88591, action: "Revisar" }],
    monthClosings: [{
      id: "c1", month: "2026-04", incomeCents: 4320000, outflowCents: 3915000, remainderCents: 405000,
      savingsRate: 0.09, netWorthCents: 1000000, closedAt: "2026-05-01",
      exceededCategories: [{ categoryId: "food", name: "Comida", plannedCents: 100000, spentCents: 120000, overCents: 20000 }],
      suggestedAdjustments: [{ categoryId: "food", name: "Comida", currentPlannedCents: 100000, suggestedPlannedCents: 120000, reason: "over" }],
    }],
  });
}

describe("rebaseCurrency", () => {
  it("is a no-op when the target equals the current base", () => {
    const state = dopState();
    expect(rebaseCurrency(state, "DOP", RATE, DATE)).toBe(state);
  });

  it("is a no-op for a non-positive or non-finite rate", () => {
    const state = dopState();
    expect(rebaseCurrency(state, "USD", 0, DATE)).toBe(state);
    expect(rebaseCurrency(state, "USD", -1, DATE)).toBe(state);
    expect(rebaseCurrency(state, "USD", Number.NaN, DATE)).toBe(state);
  });

  it("scales every base-denominated amount and relabels the base", () => {
    const next = rebaseCurrency(dopState(), "USD", RATE, DATE);
    expect(next.currency).toBe("USD");

    // Transaction base amount + splits scaled; base relabeled; rate compounded; date stamped.
    const [dopTx, usdTx] = next.transactions;
    expect(dopTx.amountCents).toBe(Math.round(50000 * RATE)); // 845
    expect(dopTx.baseCurrency).toBe("USD");
    expect(dopTx.exchangeRate).toBeCloseTo(1 * RATE, 10);
    expect(dopTx.exchangeRateDate).toBe(DATE);
    expect(dopTx.splits?.[0].amountCents).toBe(Math.round(20000 * RATE)); // 338
    // A DOP-original row is no longer same-currency once the base is USD.
    expect(dopTx.exchangeRateSource).toBe("manual");
    // A USD-original row becomes same-currency (its original now IS the base).
    expect(usdTx.exchangeRateSource).toBe("same_currency");
    expect(usdTx.amountCents).toBe(Math.round(59100 * RATE)); // ~999 ≈ original 1000

    // Budgets, goals, debts, net worth all scaled.
    expect(next.categories[0].plannedCents).toBe(Math.round(100000 * RATE));
    expect(next.monthlyPlans[0].plannedCents).toBe(Math.round(100000 * RATE));
    expect(next.monthlyPlans[0].rolloverCents).toBe(Math.round(5000 * RATE));
    expect(next.goals[0].targetCents).toBe(Math.round(1000000 * RATE));
    expect(next.goals[0].savedCents).toBe(Math.round(300000 * RATE));
    expect(next.debts[0].balanceCents).toBe(Math.round(800000 * RATE));
    expect(next.debts[0].originalBalanceCents).toBe(Math.round(1000000 * RATE));
    expect(next.debts[0].minimumCents).toBe(Math.round(50000 * RATE));
    expect(next.netWorth[0].amountCents).toBe(Math.round(500000 * RATE));

    // Review queue + historical month closings (the fields that the visual test caught as stale).
    expect(next.review[0].amountCents).toBe(Math.round(88591 * RATE));
    expect(next.monthClosings[0].incomeCents).toBe(Math.round(4320000 * RATE));
    expect(next.monthClosings[0].remainderCents).toBe(Math.round(405000 * RATE));
    expect(next.monthClosings[0].netWorthCents).toBe(Math.round(1000000 * RATE));
    expect(next.monthClosings[0].exceededCategories?.[0].overCents).toBe(Math.round(20000 * RATE));
    expect(next.monthClosings[0].suggestedAdjustments?.[0].suggestedPlannedCents).toBe(Math.round(120000 * RATE));
    expect(next.monthClosings[0].savingsRate).toBe(0.09); // ratio, not money — unchanged
  });

  it("never touches own-currency money: accounts, original amounts", () => {
    const next = rebaseCurrency(dopState(), "USD", RATE, DATE);
    // Accounts keep their own currency and balance untouched.
    expect(next.accounts[0].balanceCents).toBe(250000);
    expect(next.accounts[0].confirmedBalanceCents).toBe(250000);
    expect(next.accounts[0].currency).toBe("DOP");
    // Each transaction's original amount/currency is immutable truth.
    expect(next.transactions[0].originalAmountCents).toBe(50000);
    expect(next.transactions[0].originalCurrency).toBe("DOP");
    expect(next.transactions[1].originalAmountCents).toBe(1000);
    expect(next.transactions[1].originalCurrency).toBe("USD");
  });

  it("syncs the active space's currency label only", () => {
    const next = rebaseCurrency(dopState(), "USD", RATE, DATE);
    expect(next.spaces[0].currency).toBe("USD"); // active
    expect(next.spaces[1].currency).toBe("MXN"); // other space untouched
  });
});
