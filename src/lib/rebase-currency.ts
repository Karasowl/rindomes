// ============================================================================
// src/lib/rebase-currency.ts
// Change the household BASE (reporting) currency and convert every base-denominated
// amount so totals stay meaningful instead of being silently re-labeled.
//
// KEY MODEL FACT: `amountCents` on a Transaction is ALWAYS stored in the base currency
// (regardless of the transaction's originalCurrency). So switching the base from `old`
// to `new` is a uniform scale of every base-denominated number by `rate`
// (= units of new per 1 unit of old = quoteExchangeRate(old, new).rate).
//
// CONVERTED (base-denominated): transaction.amountCents + splits, category.plannedCents,
// monthlyPlan.plannedCents/rolloverCents, goal.targetCents/savedCents,
// debt.balanceCents/originalBalanceCents/minimumCents, netWorth.amountCents.
//
// LEFT UNTOUCHED (their own currency, by design — "each account keeps its own currency"):
// account.balanceCents/confirmedBalanceCents, transaction.originalAmountCents/Currency,
// lineItems, receipts, recurringRule.amountCents. Derived totals (summarize) recompute
// from the converted transactions on their own.
// ============================================================================

import type { AppState, CurrencyCode } from "./types";

const scale = (cents: number, rate: number): number => Math.round(cents * rate);

/**
 * Return a new AppState rebased to `toCurrency`. `rate` is units of `toCurrency` per 1
 * unit of the current base (i.e. `quoteExchangeRate(state.currency, toCurrency).rate`).
 * `date` is the YYYY-MM-DD the rate was quoted, stamped onto each transaction.
 *
 * No-op (returns the input) when `toCurrency` already equals the current base or `rate`
 * is not a positive finite number — callers can apply unconditionally.
 */
export function rebaseCurrency(
  state: AppState,
  toCurrency: CurrencyCode,
  rate: number,
  date: string,
): AppState {
  if (toCurrency === state.currency) return state;
  if (!Number.isFinite(rate) || rate <= 0) return state;

  return {
    ...state,
    currency: toCurrency,
    transactions: state.transactions.map((tx) => ({
      ...tx,
      amountCents: scale(tx.amountCents, rate),
      baseCurrency: toCurrency,
      exchangeRate: tx.exchangeRate * rate,
      exchangeRateDate: date,
      // "same_currency" implied rate 1; once rebased that no longer holds unless the
      // original happens to be the new base, so relabel scaled rows as "manual".
      exchangeRateSource:
        tx.originalCurrency === toCurrency
          ? "same_currency"
          : tx.exchangeRateSource === "same_currency"
            ? "manual"
            : tx.exchangeRateSource,
      splits: tx.splits?.map((split) => ({ ...split, amountCents: scale(split.amountCents, rate) })),
    })),
    categories: state.categories.map((category) => ({
      ...category,
      plannedCents: scale(category.plannedCents, rate),
    })),
    monthlyPlans: state.monthlyPlans.map((plan) => ({
      ...plan,
      plannedCents: scale(plan.plannedCents, rate),
      rolloverCents: plan.rolloverCents === undefined ? undefined : scale(plan.rolloverCents, rate),
    })),
    goals: state.goals.map((goal) => ({
      ...goal,
      targetCents: scale(goal.targetCents, rate),
      savedCents: scale(goal.savedCents, rate),
    })),
    debts: state.debts.map((debt) => ({
      ...debt,
      balanceCents: scale(debt.balanceCents, rate),
      originalBalanceCents:
        debt.originalBalanceCents === undefined ? undefined : scale(debt.originalBalanceCents, rate),
      minimumCents: scale(debt.minimumCents, rate),
    })),
    netWorth: state.netWorth.map((item) => ({ ...item, amountCents: scale(item.amountCents, rate) })),
    // Review queue amounts are base-denominated display figures (shown in "Necesita tu atención").
    review: state.review.map((item) => ({ ...item, amountCents: scale(item.amountCents, rate) })),
    // Historical month closings are base-denominated snapshots (shown in Reports → Cierres).
    // savingsRate is a ratio and counts are counts — only the *Cents fields convert.
    monthClosings: state.monthClosings.map((closing) => ({
      ...closing,
      incomeCents: scale(closing.incomeCents, rate),
      outflowCents: scale(closing.outflowCents, rate),
      remainderCents: scale(closing.remainderCents, rate),
      netWorthCents: scale(closing.netWorthCents, rate),
      exceededCategories: closing.exceededCategories?.map((row) => ({
        ...row,
        plannedCents: scale(row.plannedCents, rate),
        spentCents: scale(row.spentCents, rate),
        overCents: scale(row.overCents, rate),
      })),
      suggestedAdjustments: closing.suggestedAdjustments?.map((row) => ({
        ...row,
        currentPlannedCents: scale(row.currentPlannedCents, rate),
        suggestedPlannedCents: scale(row.suggestedPlannedCents, rate),
      })),
    })),
    // Keep the active space's currency label in sync with the base (label only; spaces
    // hold no amounts). Other spaces are independent and left as-is.
    spaces: state.spaces.map((space) =>
      space.id === state.activeSpaceId ? { ...space, currency: toCurrency } : space,
    ),
  };
}
