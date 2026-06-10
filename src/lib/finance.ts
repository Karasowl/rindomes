import type { AppState, Category, GroupKey, Transaction } from "./types";

export const groups: Array<{ key: GroupKey; label: string }> = [
  { key: "income", label: "Ingresos" },
  { key: "essentials", label: "Gastos esenciales" },
  { key: "discretionary", label: "Gastos discrecionales" },
  { key: "debt", label: "Pago de deudas" },
  { key: "savings", label: "Ahorros" },
  { key: "investments", label: "Inversiones" },
];

export function formatMoney(cents: number, currency = "USD") {
  return new Intl.NumberFormat("es-DO", {
    style: "currency",
    currency,
    // "narrowSymbol" renders "$" for DOP/USD/MXN and "€" for EUR, instead of the
    // country-prefixed "RD$"/"US$" default. The original currency of a movement is
    // still shown explicitly elsewhere when it differs from the home currency.
    currencyDisplay: "narrowSymbol",
    maximumFractionDigits: Math.abs(cents) % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

export function toCents(value: string | number) {
  if (typeof value === "number") {
    return Math.round(value * 100);
  }
  const normalized = value.replace(/[^\d,.-]/g, "").replace(",", ".");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
}

export function categoryById(categories: Category[], id: string) {
  return categories.find((category) => category.id === id);
}

export function isOutflow(category?: Category) {
  return Boolean(category && category.group !== "income");
}

export function plannedCentsFor(state: AppState, categoryId: string, month = state.activeMonth) {
  return state.monthlyPlans.find((plan) => plan.month === month && plan.categoryId === categoryId)?.plannedCents
    ?? categoryById(state.categories, categoryId)?.plannedCents
    ?? 0;
}

export function summarize(state: AppState) {
  const approved = transactionsForMonth(state, state.activeMonth).filter((transaction) => transaction.status === "approved");
  const income = approved.reduce((total, transaction) => {
    if (transaction.type === "transfer" || transaction.type === "refund") return total;
    const category = categoryById(state.categories, transaction.categoryId);
    return total + (category?.group === "income" ? transaction.amountCents : 0);
  }, 0);
  const outflow = categoryActuals(state, state.activeMonth).reduce((total, entry) => {
    const category = categoryById(state.categories, entry.categoryId);
    return total + (isOutflow(category) ? entry.amountCents : 0);
  }, 0);
  const plannedIncome = state.categories
    .filter((category) => category.group === "income" && !category.archived)
    .reduce((total, category) => total + plannedCentsFor(state, category.id), 0);
  const plannedOutflow = state.categories
    .filter((category) => category.group !== "income" && !category.archived)
    .reduce((total, category) => total + plannedCentsFor(state, category.id), 0);
  const assets = state.netWorth
    .filter((item) => item.kind === "asset")
    .reduce((total, item) => total + item.amountCents, 0);
  const liabilities = state.netWorth
    .filter((item) => item.kind === "liability")
    .reduce((total, item) => total + item.amountCents, 0);
  // Net worth must reflect reality on a clean start: when the user hasn't manually
  // curated net-worth items, derive it from real account balances (those flagged
  // includeInNetWorth) minus tracked debts — so funded accounts never show a misleading
  // $0. Once the user adds explicit net-worth items (or runs "generar desde cuentas"),
  // those become the source of truth.
  const accountNetWorth =
    state.accounts
      .filter((account) => !account.archived && (account.includeInNetWorth ?? true))
      .reduce((total, account) => total + account.balanceCents, 0) -
    state.debts.reduce((total, debt) => total + debt.balanceCents, 0);

  return {
    income,
    outflow,
    remainder: income - outflow,
    plannedIncome,
    plannedOutflow,
    budgetRemaining: plannedIncome - outflow,
    assignable: plannedIncome - plannedOutflow,
    savingsRate: income > 0 ? percentageForGroups(state, ["savings", "investments"], income) : 0,
    netWorth: state.netWorth.length > 0 ? assets - liabilities : accountNetWorth,
  };
}

function percentageForGroups(state: AppState, keys: GroupKey[], income: number) {
  const ids = new Set(state.categories.filter((category) => keys.includes(category.group)).map((category) => category.id));
  const total = categoryActuals(state, state.activeMonth)
    .filter((entry) => ids.has(entry.categoryId))
    .reduce((sum, entry) => sum + entry.amountCents, 0);
  return total / income;
}

export function categoryUsage(state: AppState) {
  const actuals = categoryActuals(state, state.activeMonth);
  return state.categories
    .filter((category) => category.group !== "income" && !category.archived)
    .map((category) => {
      const plannedCents = plannedCentsFor(state, category.id);
      const spent = actuals
        .filter((entry) => entry.categoryId === category.id)
        .reduce((total, entry) => total + entry.amountCents, 0);
      return {
        ...category,
        plannedCents,
        spent,
        ratio: plannedCents > 0 ? spent / plannedCents : 0,
        remaining: plannedCents - spent,
      };
    })
    .sort((a, b) => b.ratio - a.ratio);
}

export function recentTransactions(transactions: Transaction[]) {
  return [...transactions]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 8);
}

export function monthKeyFromDate(date: string) {
  return date.slice(0, 7);
}

export function transactionsForMonth(state: AppState, month: string) {
  return state.transactions.filter((transaction) => monthKeyFromDate(transaction.date) === month);
}

export function categoryActuals(state: AppState, month: string) {
  return transactionsForMonth(state, month)
    .filter((transaction) => transaction.status === "approved" && transaction.type !== "transfer")
    .flatMap((transaction) => {
      const multiplier = transaction.type === "refund" ? -1 : 1;
      const splits = transaction.splits ?? [];
      if (!splits.length) {
        return [{ categoryId: transaction.categoryId, amountCents: transaction.amountCents * multiplier, transactionId: transaction.id }];
      }

      const splitTotal = splits.reduce((sum, split) => sum + split.amountCents, 0);
      const entries = splits.map((split) => ({
        categoryId: split.categoryId,
        amountCents: split.amountCents * multiplier,
        transactionId: transaction.id,
      }));
      const remainder = transaction.amountCents - splitTotal;
      return remainder === 0 ? entries : [...entries, { categoryId: transaction.categoryId, amountCents: remainder * multiplier, transactionId: transaction.id }];
    });
}

export function categoryActualCents(state: AppState, month: string, categoryId: string) {
  return categoryActuals(state, month)
    .filter((entry) => entry.categoryId === categoryId)
    .reduce((sum, entry) => sum + entry.amountCents, 0);
}

export function annualRows(state: AppState, year: string) {
  return Array.from({ length: 12 }, (_, index) => {
    const month = `${year}-${String(index + 1).padStart(2, "0")}`;
    const transactions = transactionsForMonth(state, month).filter((transaction) => transaction.status === "approved");
    const income = transactions.reduce((sum, transaction) => {
      if (transaction.type === "transfer" || transaction.type === "refund") return sum;
      const category = categoryById(state.categories, transaction.categoryId);
      return sum + (category?.group === "income" ? transaction.amountCents : 0);
    }, 0);
    const outflow = categoryActuals(state, month).reduce((sum, entry) => {
      const category = categoryById(state.categories, entry.categoryId);
      return sum + (isOutflow(category) ? entry.amountCents : 0);
    }, 0);
    const savings = categoryActuals(state, month).reduce((sum, entry) => {
      const category = categoryById(state.categories, entry.categoryId);
      return sum + (category && ["savings", "investments"].includes(category.group) ? entry.amountCents : 0);
    }, 0);
    const closing = state.monthClosings.find((item) => item.month === month);

    return {
      month,
      income,
      outflow,
      remainder: income - outflow,
      savingsRate: income > 0 ? savings / income : 0,
      transactionCount: transactions.length,
      closed: Boolean(closing),
      netWorth: closing?.netWorthCents ?? null,
    };
  });
}
