import type {
  Account,
  AppState,
  Category,
  MonthlyCategoryPlan,
  Transaction,
  TransactionType,
} from "@/lib/types";

let counter = 0;
const nextId = (prefix: string) => `${prefix}-${++counter}`;

export function makeCategory(partial: Partial<Category> & Pick<Category, "group" | "name">): Category {
  return {
    id: partial.id ?? nextId("cat"),
    group: partial.group,
    name: partial.name,
    subcategories: partial.subcategories ?? [],
    plannedCents: partial.plannedCents ?? 0,
    source: partial.source,
    archived: partial.archived,
  };
}

export function makeAccount(partial: Partial<Account> & Pick<Account, "name">): Account {
  return {
    id: partial.id ?? nextId("acc"),
    name: partial.name,
    kind: partial.kind ?? "cash",
    balanceCents: partial.balanceCents ?? 0,
    currency: partial.currency ?? "DOP",
    archived: partial.archived,
    defaultForCapture: partial.defaultForCapture,
    includeInNetWorth: partial.includeInNetWorth,
    confirmedBalanceCents: partial.confirmedBalanceCents,
    lastConfirmedAt: partial.lastConfirmedAt,
    notes: partial.notes,
  };
}

export function makeTransaction(
  partial: Partial<Transaction> & Pick<Transaction, "type" | "date" | "categoryId" | "amountCents">,
): Transaction {
  const type: TransactionType = partial.type;
  return {
    id: partial.id ?? nextId("txn"),
    type,
    date: partial.date,
    description: partial.description ?? "",
    categoryId: partial.categoryId,
    subcategory: partial.subcategory,
    accountId: partial.accountId ?? "acc-default",
    transferAccountId: partial.transferAccountId,
    linkedTransactionId: partial.linkedTransactionId,
    linkKind: partial.linkKind,
    merchant: partial.merchant,
    person: partial.person,
    tags: partial.tags ?? [],
    note: partial.note,
    originalAmountCents: partial.originalAmountCents ?? partial.amountCents,
    originalCurrency: partial.originalCurrency ?? "DOP",
    amountCents: partial.amountCents,
    baseCurrency: partial.baseCurrency ?? "DOP",
    exchangeRate: partial.exchangeRate ?? 1,
    exchangeRateDate: partial.exchangeRateDate ?? partial.date,
    exchangeRateSource: partial.exchangeRateSource ?? "same_currency",
    status: partial.status ?? "approved",
    createdBy: partial.createdBy ?? "tester",
    attachmentNames: partial.attachmentNames,
    splits: partial.splits,
    audit: partial.audit,
  };
}

export function makePlan(month: string, categoryId: string, plannedCents: number): MonthlyCategoryPlan {
  return { id: `plan-${month}-${categoryId}`, month, categoryId, plannedCents };
}

export function makeState(partial: Partial<AppState> = {}): AppState {
  return {
    user: {
      id: "user-test",
      name: "Tester",
      email: "tester@example.local",
      avatar: "TT",
      locale: "es-DO",
      timezone: "America/Santo_Domingo",
      status: "signed_in",
      provider: "local",
      currentMemberId: "m1",
      createdAt: "2026-01-01",
    },
    activeSpaceId: "space-test",
    spaces: [],
    subscription: {
      plan: "free",
      aiCreditsUsed: 0,
      aiCreditsLimit: 25,
      storageMbUsed: 0,
      storageMbLimit: 100,
      spacesLimit: 2,
      membersLimit: 2,
    },
    householdName: "Hogar Test",
    currency: "DOP",
    activeMonth: "2026-05",
    mode: "monthly-plan",
    categories: [],
    monthlyPlans: [],
    accounts: [],
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
    members: [{ id: "m1", name: "Tester", role: "owner", avatar: "TT" }],
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
    ...partial,
  };
}
