import type { Account, AppState, Category, CurrencyCode, Mode, MonthlyCategoryPlan } from "./types";

export interface OnboardingAccountInput {
  name: string;
  kind: Account["kind"];
  balanceCents: number;
  currency?: CurrencyCode;
}

export interface OnboardingFixedExpense {
  name: string;
  amountCents: number;
}

export interface OnboardingInput {
  ownerName: string;
  householdName: string;
  currency: CurrencyCode;
  activeMonth: string; // "YYYY-MM"
  mode: Mode;
  accounts: OnboardingAccountInput[];
  incomeCents: number;
  otherIncomeCents: number;
  fixedExpenses: OnboardingFixedExpense[];
}

function slug(value: string, fallback: string) {
  const base = value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return base || fallback;
}

/**
 * Builds a complete, valid AppState from the onboarding wizard answers. Pure and
 * deterministic so it can be unit-tested. The resulting state is what gets persisted
 * to Convex on first run (replacing the demo seed).
 */
export function buildOnboardingState(input: OnboardingInput): AppState {
  const currency = input.currency;
  const month = input.activeMonth;
  const ownerName = input.ownerName.trim() || "Yo";
  const householdName = input.householdName.trim() || `Hogar de ${ownerName}`;

  const accounts: Account[] = (input.accounts.length
    ? input.accounts
    : [{ name: "Efectivo", kind: "cash" as const, balanceCents: 0 }]
  ).map((account, index) => ({
    id: `acc-${slug(account.name, `cuenta-${index + 1}`)}-${index + 1}`,
    name: account.name.trim() || `Cuenta ${index + 1}`,
    kind: account.kind,
    balanceCents: account.balanceCents,
    currency: account.currency ?? currency,
    includeInNetWorth: true,
    defaultForCapture: index === 0,
    confirmedBalanceCents: account.balanceCents,
    lastConfirmedAt: `${month}-01`,
  }));

  const totalIncome = input.incomeCents + input.otherIncomeCents;

  // Starter categories: one income bucket, the user's fixed expenses as essentials,
  // plus a few standard variable buckets so the plan is usable from day one.
  const incomeCategory: Category = {
    id: "salary",
    group: "income",
    name: "Ingresos",
    subcategories: ["Salario", "Otros"],
    plannedCents: totalIncome,
    source: "starter",
  };

  const fixedCategories: Category[] = input.fixedExpenses
    .filter((expense) => expense.name.trim())
    .map((expense, index) => ({
      id: `fixed-${slug(expense.name, `gasto-${index + 1}`)}-${index + 1}`,
      group: "essentials" as const,
      name: expense.name.trim(),
      subcategories: [],
      plannedCents: expense.amountCents,
      source: "starter" as const,
    }));

  const variableCategories: Category[] = [
    { id: "food", group: "essentials", name: "Comida", subcategories: ["Supermercado", "Comida fuera"], plannedCents: 0, source: "starter" },
    { id: "transport", group: "essentials", name: "Transporte", subcategories: ["Gasolina", "Transporte"], plannedCents: 0, source: "starter" },
    { id: "leisure", group: "discretionary", name: "Ocio e imprevistos", subcategories: ["Salidas", "Compras"], plannedCents: 0, source: "starter" },
    { id: "savings", group: "savings", name: "Ahorro", subcategories: ["Emergencia", "Metas"], plannedCents: 0, source: "starter" },
  ];

  const categories = [incomeCategory, ...fixedCategories, ...variableCategories];

  const monthlyPlans: MonthlyCategoryPlan[] = categories.map((category) => ({
    id: `plan-${month}-${category.id}`,
    month,
    categoryId: category.id,
    plannedCents: category.plannedCents,
    rolloverCents: 0,
  }));

  return {
    user: {
      id: `user-${slug(ownerName, "owner")}`,
      name: ownerName,
      email: "",
      avatar: ownerName.slice(0, 2).toUpperCase(),
      locale: "es-DO",
      timezone: "America/Santo_Domingo",
      status: "signed_in",
      provider: "local",
      currentMemberId: "m1",
      createdAt: `${month}-01`,
    },
    activeSpaceId: "space-1",
    spaces: [
      {
        id: "space-1",
        name: householdName,
        kind: "family",
        currency,
        activeMonth: month,
        role: "owner",
        memberCount: 1,
        createdAt: `${month}-01`,
        updatedAt: `${month}-01`,
      },
    ],
    subscription: {
      plan: "free",
      aiCreditsUsed: 0,
      aiCreditsLimit: 25,
      storageMbUsed: 0,
      storageMbLimit: 100,
      spacesLimit: 2,
      membersLimit: 2,
    },
    householdName,
    currency,
    activeMonth: month,
    mode: input.mode,
    categories,
    monthlyPlans,
    accounts,
    transactions: [],
    receipts: [],
    comments: [],
    review: [],
    recurringRules: [],
    automationRules: [],
    ruleApplications: [],
    goals: [],
    debts: [],
    netWorth: [],
    members: [{ id: "m1", name: ownerName, role: "owner", avatar: ownerName.slice(0, 2).toUpperCase() }],
    aiSettings: { enabled: false, provider: "local", saveHistory: true, allowReceiptText: true },
    aiActions: [],
    notificationSettings: {
      daily_capture: true,
      recurring: true,
      budget_risk: true,
      month_close: true,
      balance_confirm: true,
      debt_payment: true,
      goal_progress: true,
      movement_review: true,
      receipts: true,
    },
    monthClosings: [],
  };
}

/** Current month as "YYYY-MM" from local date components (timezone-safe, no toISOString). */
export function currentMonthKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * A valid but completely EMPTY AppState — no fake demo data, ever. This is the initial
 * state before onboarding/cloud-hydrate resolve, the fallback for missing snapshot fields,
 * and the target of "empezar de cero". It reuses buildOnboardingState with blank input so
 * it always has the exact same shape as a real first run (one zero-balance cash account,
 * zero-planned starter categories, and empty ledgers). The owner sees their own clean slate,
 * never someone else's fabricated finances.
 */
export function createEmptyState(currency: CurrencyCode = "USD", month = currentMonthKey()): AppState {
  // Reuse the onboarding builder with blank input: same shape as a real first run, but
  // with empty ledgers. (The local user.status is left as buildOnboardingState sets it;
  // real cross-device auth is governed separately by Convex Auth.)
  return buildOnboardingState({
    ownerName: "",
    householdName: "",
    currency,
    activeMonth: month,
    mode: "monthly-plan",
    accounts: [],
    incomeCents: 0,
    otherIncomeCents: 0,
    fixedExpenses: [],
  });
}
