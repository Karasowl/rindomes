import type { ImportedWorkbook } from "./excel-import";
import type { AppState, Category, CurrencyCode, GroupKey, LineItem, Transaction, TransactionType } from "./types";

export function categoryForConvex(category: Category) {
  return {
    group: category.group,
    name: category.name,
    subcategories: category.subcategories,
    plannedCents: category.plannedCents,
    source: category.source ?? "user",
    archived: Boolean(category.archived),
  };
}

export function transactionForConvex(transaction: Transaction) {
  return {
    type: transaction.type,
    date: transaction.date,
    description: transaction.description,
    subcategory: transaction.subcategory,
    merchant: transaction.merchant,
    person: transaction.person,
    tags: transaction.tags,
    note: transaction.note,
    originalAmountCents: transaction.originalAmountCents,
    originalCurrency: transaction.originalCurrency,
    baseAmountCents: transaction.amountCents,
    baseCurrency: transaction.baseCurrency,
    exchangeRate: transaction.exchangeRate,
    exchangeRateDate: transaction.exchangeRateDate,
    exchangeRateSource: transaction.exchangeRateSource,
    status: transaction.status,
    linkKind: transaction.linkKind,
    // Itemized receipt lines round-tripped onto the snapshot payload (optional + additive).
    // Omitted (undefined) when the movement has no lines, mirroring the schema's v.optional.
    lineItems: transaction.lineItems && transaction.lineItems.length
      ? transaction.lineItems.map((item) => ({
          name: item.name,
          quantity: item.quantity,
          amountCents: item.amountCents,
        }))
      : undefined,
    splits: (transaction.splits ?? []).map((split) => ({
      categoryLocalId: split.categoryId,
      subcategory: split.subcategory,
      amountCents: split.amountCents,
      note: split.note,
    })),
  };
}

export function workbookImportForConvex(workbook: ImportedWorkbook) {
  const categoriesById = new Map(workbook.categories.map((category) => [category.id, category.name]));

  return {
    month: workbook.activeMonth,
    categories: workbook.categories.map(categoryForConvex),
    transactions: workbook.transactions.map((transaction) => ({
      ...transactionForConvex(transaction),
      categoryName: categoriesById.get(transaction.categoryId) ?? transaction.description,
    })),
  };
}

export function stateSnapshotForConvex(state: AppState, householdId?: string, baseVersion?: number) {
  const monthlyPlans: AppState["monthlyPlans"] = state.monthlyPlans.length
    ? state.monthlyPlans
    : state.categories.map((category) => ({
        id: `plan-${state.activeMonth}-${category.id}`,
        month: state.activeMonth,
        categoryId: category.id,
        plannedCents: category.plannedCents,
        rolloverCents: 0,
      }));

  return {
    householdId,
    baseVersion,
    household: {
      name: state.householdName,
      defaultCurrency: state.currency,
      activeMonth: state.activeMonth,
      mode: state.mode,
      activeSpaceLocalId: state.activeSpaceId,
      subscriptionPlan: state.subscription.plan,
      aiProvider: state.aiSettings.provider,
      aiEnabled: state.aiSettings.enabled,
      aiHistoryEnabled: state.aiSettings.saveHistory,
      aiReceiptTextEnabled: state.aiSettings.allowReceiptText,
      notificationSettings: state.notificationSettings,
      // Per-household merchant aliases round-tripped on the household doc (optional + additive).
      // Omitted (undefined) when empty, mirroring the household schema's v.optional column.
      merchantAliases: state.merchantAliases && state.merchantAliases.length
        ? state.merchantAliases.map((entry) => ({ raw: entry.raw, alias: entry.alias }))
        : undefined,
    },
    spaces: state.spaces.map((space) => ({
      localId: space.id,
      name: space.name,
      kind: space.kind,
      currency: space.currency,
      activeMonth: space.activeMonth,
      role: space.role,
      memberCount: space.memberCount,
      createdAt: new Date(space.createdAt).getTime(),
      updatedAt: new Date(space.updatedAt).getTime(),
      archived: Boolean(space.archived),
    })),
    subscription: {
      plan: state.subscription.plan,
      aiCreditsUsed: state.subscription.aiCreditsUsed,
      aiCreditsLimit: state.subscription.aiCreditsLimit,
      storageMbUsed: state.subscription.storageMbUsed,
      storageMbLimit: state.subscription.storageMbLimit,
      spacesLimit: state.subscription.spacesLimit,
      membersLimit: state.subscription.membersLimit,
    },
    accounts: state.accounts.map((account) => ({
      localId: account.id,
      name: account.name,
      kind: account.kind,
      currency: account.currency ?? state.currency,
      balanceCents: account.balanceCents,
      confirmedBalanceCents: account.confirmedBalanceCents,
      lastConfirmedAt: account.lastConfirmedAt,
      includeInNetWorth: account.includeInNetWorth,
      defaultForCapture: account.defaultForCapture,
      archived: account.archived,
      notes: account.notes,
    })),
    categories: state.categories.map((category) => ({
      localId: category.id,
      ...categoryForConvex(category),
    })),
    monthlyPlans: monthlyPlans.map((plan) => ({
      localId: plan.id,
      month: plan.month,
      categoryLocalId: plan.categoryId,
      plannedCents: plan.plannedCents,
      rolloverCents: plan.rolloverCents ?? 0,
      notes: plan.notes,
    })),
    transactions: state.transactions.map((transaction) => ({
      localId: transaction.id,
      ...transactionForConvex(transaction),
      categoryLocalId: transaction.categoryId,
      accountLocalId: transaction.accountId,
      transferAccountLocalId: transaction.transferAccountId,
      linkedTransactionLocalId: transaction.linkedTransactionId,
      linkKind: transaction.linkKind,
      createdBy: transaction.createdBy,
    })),
    receipts: state.receipts.map((receipt) => ({
      localId: receipt.id,
      transactionLocalId: receipt.transactionId,
      // Round-trip the real file pointer so an autosave never orphans the uploaded blob.
      // saveSnapshot normalizes this back to an Id<"_storage"> on the attachments insert.
      storageId: receipt.storageId,
      fileName: receipt.fileName,
      contentType: receipt.contentType,
      source: receipt.source,
      status: receipt.status,
      amountCents: receipt.amountCents,
      currency: receipt.currency,
      date: receipt.date,
      merchant: receipt.merchant,
      extractedText: receipt.extractedText,
      note: receipt.note,
      createdAt: new Date(receipt.createdAt).getTime(),
    })),
    comments: state.comments.map((comment) => ({
      targetType: comment.targetType,
      targetLocalId: comment.targetId,
      authorMemberName: state.members.find((member) => member.id === comment.authorMemberId)?.name ?? comment.authorName,
      authorName: comment.authorName,
      body: comment.body,
      createdAt: new Date(comment.createdAt).getTime(),
    })),
    aiActions: state.aiActions.map((action) => ({
      localId: action.id,
      kind: action.kind,
      provider: action.provider,
      status: action.status,
      inputPreview: action.inputPreview,
      outputSummary: action.outputSummary,
      creditsUsed: action.creditsUsed,
      createdAt: new Date(action.createdAt).getTime(),
    })),
    review: state.review.map((item) => ({
      localId: item.id,
      reason: item.reason,
      title: item.title,
      subtitle: item.subtitle,
      amountCents: item.amountCents,
      action: item.action,
      targetType: item.targetType,
      targetLocalId: item.targetId,
    })),
    recurringRules: state.recurringRules.map((rule) => ({
      localId: rule.id,
      name: rule.name,
      type: rule.type,
      categoryLocalId: rule.categoryId,
      accountLocalId: rule.accountId,
      amountCents: rule.amountCents,
      currency: rule.currency,
      frequency: rule.frequency,
      nextDate: rule.nextDate,
      merchant: rule.merchant,
      note: rule.note,
      active: rule.active,
    })),
    automationRules: state.automationRules.map((rule) => ({
      localId: rule.id,
      name: rule.name,
      matchText: rule.matchText,
      categoryLocalId: rule.categoryId,
      accountLocalId: rule.accountId,
      merchant: rule.merchant,
      subcategory: rule.subcategory,
      tag: rule.tag,
      active: rule.active,
    })),
    ruleApplications: state.ruleApplications.map((application) => ({
      localId: application.id,
      ruleLocalId: application.ruleId,
      ruleName: application.ruleName,
      kind: application.kind,
      transactionLocalId: application.transactionId,
      transactionDescription: application.transactionDescription,
      summary: application.summary,
      status: application.status,
      createdAt: new Date(application.createdAt).getTime(),
    })),
    members: state.members.map((member) => ({
      name: member.name,
      role: member.role,
      avatar: member.avatar,
      email: member.email,
    })),
    goals: state.goals.map((goal) => ({
      localId: goal.id,
      name: goal.name,
      targetCents: goal.targetCents,
      savedCents: goal.savedCents,
      due: goal.due,
      accountLocalId: goal.accountId,
      priority: goal.priority,
      archived: goal.archived,
    })),
    debts: state.debts.map((debt) => ({
      name: debt.name,
      balanceCents: debt.balanceCents,
      originalBalanceCents: debt.originalBalanceCents,
      rate: debt.rate,
      minimumCents: debt.minimumCents,
      strategy: debt.strategy,
    })),
    netWorth: state.netWorth.map((item) => ({
      name: item.name,
      kind: item.kind,
      group: item.group,
      amountCents: item.amountCents,
    })),
    monthClosings: state.monthClosings.map((closing) => ({
      month: closing.month,
      incomeCents: closing.incomeCents,
      outflowCents: closing.outflowCents,
      remainderCents: closing.remainderCents,
      savingsRate: closing.savingsRate,
      netWorthCents: closing.netWorthCents,
      pendingReviewCount: closing.pendingReviewCount,
      pendingReceiptCount: closing.pendingReceiptCount,
      confirmedAccountIds: closing.confirmedAccountIds,
      exceededCategories: closing.exceededCategories,
      suggestedAdjustments: closing.suggestedAdjustments,
      learning: closing.learning,
      nextMonthPrepared: closing.nextMonthPrepared,
      notes: closing.notes,
      closedAt: new Date(closing.closedAt).getTime(),
    })),
  };
}

type RawRecord = Record<string, unknown>;

export interface ConvexHouseholdSnapshot {
  household?: RawRecord | null;
  members?: RawRecord[];
  spaces?: RawRecord[];
  subscription?: RawRecord | null;
  accounts?: RawRecord[];
  categories?: RawRecord[];
  plans?: RawRecord[];
  transactions?: RawRecord[];
  transactionSplits?: RawRecord[];
  attachments?: RawRecord[];
  comments?: RawRecord[];
  aiActions?: RawRecord[];
  reviewItems?: RawRecord[];
  recurringRules?: RawRecord[];
  automationRules?: RawRecord[];
  ruleApplications?: RawRecord[];
  goals?: RawRecord[];
  debts?: RawRecord[];
  netWorthItems?: RawRecord[];
  monthClosings?: RawRecord[];
}

function isRecord(value: unknown): value is RawRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringValue(record: RawRecord | undefined | null, key: string): string;
function stringValue(record: RawRecord | undefined | null, key: string, fallback: string): string;
function stringValue(record: RawRecord | undefined | null, key: string, fallback: undefined): string | undefined;
function stringValue(record: RawRecord | undefined | null, key: string, fallback: string | undefined = "") {
  const value = record?.[key];
  return typeof value === "string" ? value : fallback;
}

function numberValue(record: RawRecord | undefined | null, key: string): number;
function numberValue(record: RawRecord | undefined | null, key: string, fallback: number): number;
function numberValue(record: RawRecord | undefined | null, key: string, fallback: undefined): number | undefined;
function numberValue(record: RawRecord | undefined | null, key: string, fallback: number | undefined = 0) {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function booleanValue(record: RawRecord | undefined | null, key: string, fallback = false) {
  const value = record?.[key];
  return typeof value === "boolean" ? value : fallback;
}

function records(value: unknown): RawRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function stringArray(record: RawRecord | undefined | null, key: string) {
  const value = record?.[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

// Deserialize the optional transactions.lineItems column back into LineItem[]. Returns
// undefined (not []) when absent so a movement without a factura stays exactly as it was —
// mirroring how storageId/optional fields default to undefined rather than a placeholder.
function lineItemsValue(record: RawRecord | undefined | null): LineItem[] | undefined {
  const value = record?.["lineItems"];
  if (!Array.isArray(value)) return undefined;
  const items = value.filter(isRecord).map((item) => ({
    name: stringValue(item, "name", ""),
    quantity: numberValue(item, "quantity", 0),
    amountCents: numberValue(item, "amountCents", 0),
  }));
  return items.length ? items : undefined;
}

// Deserialize the optional households.merchantAliases column back into AppState.merchantAliases.
// Returns undefined when absent (additive/optional) so households without aliases stay valid.
function merchantAliasesValue(record: RawRecord | undefined | null): { raw: string; alias: string }[] | undefined {
  const value = record?.["merchantAliases"];
  if (!Array.isArray(value)) return undefined;
  const aliases = value.filter(isRecord).map((entry) => ({
    raw: stringValue(entry, "raw", ""),
    alias: stringValue(entry, "alias", ""),
  }));
  return aliases.length ? aliases : undefined;
}

function dateFromMs(record: RawRecord | undefined | null, key: string, fallback: string) {
  const value = numberValue(record, key, Number.NaN);
  return Number.isFinite(value) ? new Date(value).toISOString().slice(0, 10) : fallback;
}

function currencyValue(value: string, fallback: CurrencyCode): CurrencyCode {
  return ["DOP", "USD", "MXN", "EUR"].includes(value) ? value as CurrencyCode : fallback;
}

function normalizeLoadedAccounts(accounts: AppState["accounts"]) {
  const firstActive = accounts.find((account) => !account.archived);
  const hasDefault = accounts.some((account) => !account.archived && account.defaultForCapture);

  return accounts.map((account) => ({
    ...account,
    includeInNetWorth: account.includeInNetWorth ?? true,
    defaultForCapture: account.defaultForCapture || (!hasDefault && account.id === firstActive?.id),
  }));
}

function groupValue(value: string, fallback: GroupKey): GroupKey {
  return ["income", "essentials", "discretionary", "debt", "savings", "investments"].includes(value) ? value as GroupKey : fallback;
}

function transactionTypeValue(value: string, fallback: TransactionType): TransactionType {
  return ["income", "expense", "transfer", "debt_payment", "saving", "investment", "refund"].includes(value) ? value as TransactionType : fallback;
}

export function stateFromConvexSnapshot(snapshot: ConvexHouseholdSnapshot, fallback: AppState): AppState {
  const today = new Date().toISOString().slice(0, 10);
  const household = isRecord(snapshot.household) ? snapshot.household : undefined;
  const rawMembers = records(snapshot.members);
  const rawSpaces = records(snapshot.spaces);
  const rawAccounts = records(snapshot.accounts);
  const rawPlans = records(snapshot.plans);
  const rawCategories = records(snapshot.categories);
  const rawTransactions = records(snapshot.transactions);
  const rawSplits = records(snapshot.transactionSplits);
  const rawAttachments = records(snapshot.attachments);
  const rawComments = records(snapshot.comments);
  const rawAiActions = records(snapshot.aiActions);
  const rawReview = records(snapshot.reviewItems);
  const rawRecurring = records(snapshot.recurringRules);
  const rawAutomation = records(snapshot.automationRules);
  const rawRuleApplications = records(snapshot.ruleApplications);
  const rawGoals = records(snapshot.goals);
  const rawDebts = records(snapshot.debts);
  const rawNetWorth = records(snapshot.netWorthItems);
  const rawClosings = records(snapshot.monthClosings);
  const baseCurrency = currencyValue(stringValue(household, "defaultCurrency", fallback.currency), fallback.currency);
  const activeMonth = stringValue(household, "activeMonth", fallback.activeMonth);
  const plansByCategory = new Map(rawPlans.filter((plan) => stringValue(plan, "month") === activeMonth).map((plan) => [stringValue(plan, "categoryId"), numberValue(plan, "plannedCents")]));
  const firstFallbackCategory = fallback.categories[0]?.id ?? "category";
  const firstFallbackAccount = fallback.accounts[0]?.id ?? "account";

  const members: AppState["members"] = rawMembers.map((member) => ({
    id: stringValue(member, "_id", `member-${stringValue(member, "name", "persona")}`),
    name: stringValue(member, "name", "Persona"),
    role: ["owner", "editor", "viewer"].includes(stringValue(member, "role")) ? stringValue(member, "role") as AppState["members"][number]["role"] : "viewer",
    avatar: stringValue(member, "avatar", "RM"),
    email: stringValue(member, "email", undefined),
  }));

  const spaces: AppState["spaces"] = rawSpaces.map((space) => ({
    id: stringValue(space, "localId", stringValue(space, "_id", "default")),
    name: stringValue(space, "name", stringValue(household, "name", fallback.householdName)),
    kind: ["personal", "family", "business", "test"].includes(stringValue(space, "kind")) ? stringValue(space, "kind") as AppState["spaces"][number]["kind"] : "personal",
    currency: currencyValue(stringValue(space, "currency", baseCurrency), baseCurrency),
    activeMonth: stringValue(space, "activeMonth", activeMonth),
    role: ["owner", "editor", "viewer"].includes(stringValue(space, "role")) ? stringValue(space, "role") as AppState["spaces"][number]["role"] : "owner",
    memberCount: numberValue(space, "memberCount", Math.max(1, members.length)),
    createdAt: dateFromMs(space, "createdAt", today),
    updatedAt: dateFromMs(space, "updatedAt", today),
    archived: booleanValue(space, "archived", false),
  }));

  const accounts: AppState["accounts"] = rawAccounts.map((account) => ({
    id: stringValue(account, "_id", stringValue(account, "name", firstFallbackAccount)),
    name: stringValue(account, "name", "Cuenta"),
    kind: ["cash", "bank", "credit", "savings", "investment"].includes(stringValue(account, "kind")) ? stringValue(account, "kind") as AppState["accounts"][number]["kind"] : "bank",
    balanceCents: numberValue(account, "currentBalanceCents"),
    currency: currencyValue(stringValue(account, "currency", baseCurrency), baseCurrency),
    archived: booleanValue(account, "archived", false),
    defaultForCapture: booleanValue(account, "defaultForCapture", false),
    includeInNetWorth: booleanValue(account, "includeInNetWorth", true),
    confirmedBalanceCents: numberValue(account, "confirmedBalanceCents", undefined),
    lastConfirmedAt: stringValue(account, "lastConfirmedAt", undefined),
    notes: stringValue(account, "notes", undefined),
  }));
  const normalizedAccounts = normalizeLoadedAccounts(accounts);

  const categories: AppState["categories"] = rawCategories.map((category) => ({
    id: stringValue(category, "_id", stringValue(category, "name", firstFallbackCategory)),
    group: groupValue(stringValue(category, "group"), "discretionary"),
    name: stringValue(category, "name", "Categoria"),
    subcategories: stringArray(category, "subcategories"),
    plannedCents: plansByCategory.get(stringValue(category, "_id")) ?? 0,
    source: ["starter", "user", "imported"].includes(stringValue(category, "source")) ? stringValue(category, "source") as Category["source"] : "user",
    archived: booleanValue(category, "archived", false),
  }));
  const monthlyPlans: AppState["monthlyPlans"] = rawPlans.map((plan) => ({
    id: stringValue(plan, "localId", stringValue(plan, "_id", `plan-${stringValue(plan, "month", activeMonth)}-${stringValue(plan, "categoryId", firstFallbackCategory)}`)),
    month: stringValue(plan, "month", activeMonth),
    categoryId: stringValue(plan, "categoryId", firstFallbackCategory),
    plannedCents: numberValue(plan, "plannedCents"),
    rolloverCents: numberValue(plan, "rolloverCents", 0),
    notes: stringValue(plan, "notes", undefined),
  }));

  const categoryIds = new Set(categories.map((category) => category.id));
  const accountIds = new Set(normalizedAccounts.map((account) => account.id));
  const fallbackCategoryId = categories[0]?.id ?? firstFallbackCategory;
  const fallbackAccountId = accounts[0]?.id ?? firstFallbackAccount;
  const splitsByTransaction = new Map<string, RawRecord[]>();
  for (const split of rawSplits) {
    const transactionId = stringValue(split, "transactionId");
    splitsByTransaction.set(transactionId, [...(splitsByTransaction.get(transactionId) ?? []), split]);
  }

  const transactions: AppState["transactions"] = rawTransactions.map((transaction) => {
    const id = stringValue(transaction, "_id", `tx-${numberValue(transaction, "createdAt", Date.now())}`);
    const categoryId = stringValue(transaction, "categoryId", fallbackCategoryId);
    const accountId = stringValue(transaction, "accountId", fallbackAccountId);
    return {
      id,
      type: transactionTypeValue(stringValue(transaction, "type"), "expense"),
      date: stringValue(transaction, "date", `${activeMonth}-01`),
      description: stringValue(transaction, "description", "Movimiento"),
      categoryId: categoryIds.has(categoryId) ? categoryId : fallbackCategoryId,
      subcategory: stringValue(transaction, "subcategory", undefined),
      accountId: accountIds.has(accountId) ? accountId : fallbackAccountId,
      transferAccountId: stringValue(transaction, "transferAccountId", undefined),
      linkedTransactionId: stringValue(transaction, "linkedTransactionId", undefined),
      linkKind: ["refund", "card_payment", "correction"].includes(stringValue(transaction, "linkKind")) ? stringValue(transaction, "linkKind") as Transaction["linkKind"] : undefined,
      merchant: stringValue(transaction, "merchant", undefined),
      person: stringValue(transaction, "person", undefined),
      tags: stringArray(transaction, "tags"),
      note: stringValue(transaction, "note", undefined),
      // Itemized receipt lines carried back into AppState so the next autosave preserves them.
      // undefined when the stored transaction had no lines (mirrors the optional schema column).
      lineItems: lineItemsValue(transaction),
      originalAmountCents: numberValue(transaction, "originalAmountCents"),
      originalCurrency: currencyValue(stringValue(transaction, "originalCurrency", baseCurrency), baseCurrency),
      amountCents: numberValue(transaction, "baseAmountCents"),
      baseCurrency,
      exchangeRate: numberValue(transaction, "exchangeRate", 1),
      exchangeRateDate: stringValue(transaction, "exchangeRateDate", stringValue(transaction, "date", today)),
      exchangeRateSource: ["api", "manual", "same_currency"].includes(stringValue(transaction, "exchangeRateSource")) ? stringValue(transaction, "exchangeRateSource") as Transaction["exchangeRateSource"] : "same_currency",
      status: ["approved", "needs_review", "duplicate", "adjustment"].includes(stringValue(transaction, "status")) ? stringValue(transaction, "status") as Transaction["status"] : "approved",
      createdBy: stringValue(transaction, "createdByMemberId", members[0]?.name ?? "RindoMes"),
      attachmentNames: [],
      splits: (splitsByTransaction.get(id) ?? []).map((split) => ({
        id: stringValue(split, "_id", `split-${id}`),
        categoryId: categoryIds.has(stringValue(split, "categoryId")) ? stringValue(split, "categoryId") : fallbackCategoryId,
        subcategory: stringValue(split, "subcategory", undefined),
        amountCents: numberValue(split, "amountCents"),
        note: stringValue(split, "note", undefined),
      })),
      audit: [],
    };
  });

  const receipts: AppState["receipts"] = rawAttachments.map((attachment) => ({
    id: stringValue(attachment, "_id", `receipt-${numberValue(attachment, "createdAt", Date.now())}`),
    fileName: stringValue(attachment, "fileName", "archivo"),
    contentType: stringValue(attachment, "contentType", "application/octet-stream"),
    source: ["receipt", "invoice", "statement", "other"].includes(stringValue(attachment, "source")) ? stringValue(attachment, "source") as AppState["receipts"][number]["source"] : "receipt",
    status: ["uploaded", "processing", "needs_review", "confirmed", "error"].includes(stringValue(attachment, "status")) ? stringValue(attachment, "status") as AppState["receipts"][number]["status"] : "uploaded",
    createdAt: dateFromMs(attachment, "createdAt", today),
    transactionId: stringValue(attachment, "transactionId", undefined),
    // The real file pointer (attachments.storageId). Carried back into AppState so the next
    // autosave preserves it and getReceiptUrl can resolve a download URL.
    storageId: stringValue(attachment, "storageId", undefined),
    amountCents: numberValue(attachment, "amountCents", undefined),
    currency: currencyValue(stringValue(attachment, "currency", baseCurrency), baseCurrency),
    date: stringValue(attachment, "date", undefined),
    merchant: stringValue(attachment, "merchant", undefined),
    extractedText: stringValue(attachment, "extractedText", undefined),
    note: stringValue(attachment, "note", undefined),
  }));

  const currentMember = members.find((member) => member.email && member.email === fallback.user.email) ?? members[0];

  return {
    ...fallback,
    user: {
      ...fallback.user,
      status: currentMember ? "signed_in" : fallback.user.status,
      name: currentMember?.name ?? fallback.user.name,
      email: currentMember?.email ?? fallback.user.email,
      currentMemberId: currentMember?.id ?? fallback.user.currentMemberId,
    },
    activeSpaceId: stringValue(household, "activeSpaceLocalId", spaces[0]?.id ?? fallback.activeSpaceId),
    spaces: spaces.length ? spaces : fallback.spaces,
    subscription: isRecord(snapshot.subscription)
      ? {
          // plan is read server-authoritatively from the subscriptions row. NOTE: the client
          // still SERIALIZES subscription.plan in stateSnapshotForConvex for back-compat, but
          // saveSnapshot IGNORES it server-side and preserves the row's plan/proSource/proGrantedAt;
          // only setHouseholdPlan may change the plan. This deserializer is the display source of truth.
          plan: ["free", "pro"].includes(stringValue(snapshot.subscription, "plan")) ? stringValue(snapshot.subscription, "plan") as AppState["subscription"]["plan"] : "free",
          aiCreditsUsed: numberValue(snapshot.subscription, "aiCreditsUsed"),
          aiCreditsLimit: numberValue(snapshot.subscription, "aiCreditsLimit", 25),
          storageMbUsed: numberValue(snapshot.subscription, "storageMbUsed"),
          storageMbLimit: numberValue(snapshot.subscription, "storageMbLimit", 100),
          spacesLimit: numberValue(snapshot.subscription, "spacesLimit", 2),
          membersLimit: numberValue(snapshot.subscription, "membersLimit", 2),
          // Provenance is read-only display data; default to 'none'/undefined when the row predates it.
          proSource: ["stub_checkout", "manual_grant", "none"].includes(stringValue(snapshot.subscription, "proSource")) ? stringValue(snapshot.subscription, "proSource") as AppState["subscription"]["proSource"] : "none",
          proGrantedAt: numberValue(snapshot.subscription, "proGrantedAt", undefined),
        }
      : fallback.subscription,
    householdName: stringValue(household, "name", fallback.householdName),
    currency: baseCurrency,
    activeMonth,
    mode: ["tracker", "monthly-plan", "zero"].includes(stringValue(household, "mode")) ? stringValue(household, "mode") as AppState["mode"] : fallback.mode,
    // Per-household merchant aliases read off the household doc; falls back to the prior value
    // when the row predates the column (optional + additive, never throws).
    merchantAliases: merchantAliasesValue(household) ?? fallback.merchantAliases,
    aiSettings: {
      enabled: typeof household?.aiEnabled === "boolean" ? household.aiEnabled : fallback.aiSettings.enabled,
      provider: ["local", "openai", "byok", "claude", "openrouter"].includes(stringValue(household, "aiProvider")) ? stringValue(household, "aiProvider") as AppState["aiSettings"]["provider"] : fallback.aiSettings.provider,
      saveHistory: typeof household?.aiHistoryEnabled === "boolean" ? household.aiHistoryEnabled : fallback.aiSettings.saveHistory,
      allowReceiptText: typeof household?.aiReceiptTextEnabled === "boolean" ? household.aiReceiptTextEnabled : fallback.aiSettings.allowReceiptText,
    },
    notificationSettings: {
      ...fallback.notificationSettings,
      ...(isRecord(household?.notificationSettings)
        ? Object.fromEntries(Object.entries(household.notificationSettings).filter(([, value]) => typeof value === "boolean")) as Partial<AppState["notificationSettings"]>
        : {}),
    },
    categories: categories.length ? categories : fallback.categories,
    monthlyPlans: monthlyPlans.length ? monthlyPlans : fallback.monthlyPlans,
    accounts: normalizedAccounts.length ? normalizedAccounts : fallback.accounts,
    transactions,
    receipts,
    comments: rawComments.map((comment) => ({
      id: stringValue(comment, "_id", `comment-${numberValue(comment, "createdAt", Date.now())}`),
      targetType: stringValue(comment, "categoryId") ? "category" : "transaction",
      targetId: stringValue(comment, "categoryId", stringValue(comment, "transactionId", "")),
      authorMemberId: stringValue(comment, "authorMemberId", currentMember?.id ?? ""),
      authorName: stringValue(comment, "authorName", currentMember?.name ?? "RindoMes"),
      body: stringValue(comment, "body"),
      createdAt: dateFromMs(comment, "createdAt", today),
    })),
    aiActions: rawAiActions.map((action) => ({
      id: stringValue(action, "_id", `ai-${numberValue(action, "createdAt", Date.now())}`),
      kind: ["text_capture", "receipt_parse", "monthly_summary", "budget_suggestion"].includes(stringValue(action, "kind")) ? stringValue(action, "kind") as AppState["aiActions"][number]["kind"] : "text_capture",
      provider: ["local", "openai", "byok", "claude", "openrouter"].includes(stringValue(action, "provider")) ? stringValue(action, "provider") as AppState["aiActions"][number]["provider"] : "local",
      status: ["suggested", "accepted", "failed"].includes(stringValue(action, "status")) ? stringValue(action, "status") as AppState["aiActions"][number]["status"] : "suggested",
      inputPreview: stringValue(action, "inputPreview"),
      outputSummary: stringValue(action, "outputSummary"),
      creditsUsed: numberValue(action, "creditsUsed"),
      createdAt: dateFromMs(action, "createdAt", today),
    })),
    review: rawReview.map((item) => ({
      id: stringValue(item, "localId", stringValue(item, "_id", `review-${numberValue(item, "createdAt", Date.now())}`)),
      reason: ["uncategorized", "duplicate", "balance_adjustment", "ai_suggestion", "receipt_pending", "budget_risk", "recurring_pending", "account_unconfirmed"].includes(stringValue(item, "reason")) ? stringValue(item, "reason") as AppState["review"][number]["reason"] : "uncategorized",
      title: stringValue(item, "title", "Revision"),
      subtitle: stringValue(item, "subtitle"),
      amountCents: numberValue(item, "amountCents"),
      action: stringValue(item, "action", "Revisar"),
      targetType: ["transaction", "receipt", "account", "category", "rule"].includes(stringValue(item, "targetType")) ? stringValue(item, "targetType") as AppState["review"][number]["targetType"] : stringValue(item, "transactionId") ? "transaction" : undefined,
      targetId: stringValue(item, "targetLocalId", undefined) ?? stringValue(item, "transactionId", undefined),
    })),
    recurringRules: rawRecurring.map((rule) => ({
      id: stringValue(rule, "localId", stringValue(rule, "_id", `rec-${stringValue(rule, "name", "regla")}`)),
      name: stringValue(rule, "name", "Regla recurrente"),
      type: transactionTypeValue(stringValue(rule, "type"), "expense"),
      categoryId: categoryIds.has(stringValue(rule, "categoryId")) ? stringValue(rule, "categoryId") : fallbackCategoryId,
      accountId: accountIds.has(stringValue(rule, "accountId")) ? stringValue(rule, "accountId") : fallbackAccountId,
      amountCents: numberValue(rule, "amountCents"),
      currency: currencyValue(stringValue(rule, "currency", baseCurrency), baseCurrency),
      frequency: ["weekly", "biweekly", "monthly", "yearly"].includes(stringValue(rule, "frequency")) ? stringValue(rule, "frequency") as AppState["recurringRules"][number]["frequency"] : "monthly",
      nextDate: stringValue(rule, "nextDate", `${activeMonth}-01`),
      merchant: stringValue(rule, "merchant", undefined),
      note: stringValue(rule, "note", undefined),
      active: booleanValue(rule, "active", true),
    })),
    automationRules: rawAutomation.map((rule) => ({
      id: stringValue(rule, "localId", stringValue(rule, "_id", `auto-${stringValue(rule, "name", "regla")}`)),
      name: stringValue(rule, "name", "Regla"),
      matchText: stringValue(rule, "matchText"),
      categoryId: categoryIds.has(stringValue(rule, "categoryId")) ? stringValue(rule, "categoryId") : fallbackCategoryId,
      accountId: accountIds.has(stringValue(rule, "accountId")) ? stringValue(rule, "accountId") : undefined,
      merchant: stringValue(rule, "merchant", undefined),
      subcategory: stringValue(rule, "subcategory", undefined),
      tag: stringValue(rule, "tag", undefined),
      active: booleanValue(rule, "active", true),
    })),
    ruleApplications: rawRuleApplications.map((application) => ({
      id: stringValue(application, "localId", stringValue(application, "_id", `rule-app-${numberValue(application, "createdAt", Date.now())}`)),
      ruleId: stringValue(application, "ruleLocalId", stringValue(application, "ruleId", "")),
      ruleName: stringValue(application, "ruleName", "Regla"),
      kind: ["recurring", "automation"].includes(stringValue(application, "kind")) ? stringValue(application, "kind") as AppState["ruleApplications"][number]["kind"] : "automation",
      transactionId: stringValue(application, "transactionLocalId", undefined),
      transactionDescription: stringValue(application, "transactionDescription", undefined),
      summary: stringValue(application, "summary", "Aplicacion registrada."),
      status: ["created_pending", "classified", "skipped"].includes(stringValue(application, "status")) ? stringValue(application, "status") as AppState["ruleApplications"][number]["status"] : "classified",
      createdAt: dateFromMs(application, "createdAt", today),
    })),
    goals: rawGoals.map((goal) => ({
      id: stringValue(goal, "localId", stringValue(goal, "_id", `goal-${stringValue(goal, "name", "meta")}`)),
      name: stringValue(goal, "name", "Meta"),
      targetCents: numberValue(goal, "targetCents"),
      savedCents: numberValue(goal, "savedCents"),
      due: stringValue(goal, "due", activeMonth),
      accountId: accountIds.has(stringValue(goal, "accountId")) ? stringValue(goal, "accountId") : stringValue(goal, "accountLocalId", undefined),
      priority: ["low", "medium", "high"].includes(stringValue(goal, "priority")) ? stringValue(goal, "priority") as AppState["goals"][number]["priority"] : undefined,
      archived: booleanValue(goal, "archived", false),
    })),
    debts: rawDebts.map((debt) => ({
      id: stringValue(debt, "_id", `debt-${stringValue(debt, "name", "deuda")}`),
      name: stringValue(debt, "name", "Deuda"),
      balanceCents: numberValue(debt, "balanceCents"),
      originalBalanceCents: numberValue(debt, "originalBalanceCents", undefined),
      rate: numberValue(debt, "rate"),
      minimumCents: numberValue(debt, "minimumCents"),
      strategy: ["snowball", "avalanche", "manual"].includes(stringValue(debt, "strategy")) ? stringValue(debt, "strategy") as AppState["debts"][number]["strategy"] : "manual",
    })),
    netWorth: rawNetWorth.map((item) => ({
      id: stringValue(item, "_id", `nw-${stringValue(item, "name", "item")}`),
      name: stringValue(item, "name", "Item"),
      kind: ["asset", "liability"].includes(stringValue(item, "kind")) ? stringValue(item, "kind") as AppState["netWorth"][number]["kind"] : "asset",
      group: ["cash", "bank", "investment", "property", "debt", "other"].includes(stringValue(item, "group")) ? stringValue(item, "group") as AppState["netWorth"][number]["group"] : "other",
      amountCents: numberValue(item, "amountCents"),
    })),
    members: members.length ? members : fallback.members,
    monthClosings: rawClosings.map((closing) => ({
      id: stringValue(closing, "_id", `close-${stringValue(closing, "month", activeMonth)}`),
      month: stringValue(closing, "month", activeMonth),
      incomeCents: numberValue(closing, "incomeCents"),
      outflowCents: numberValue(closing, "outflowCents"),
      remainderCents: numberValue(closing, "remainderCents"),
      savingsRate: numberValue(closing, "savingsRate"),
      netWorthCents: numberValue(closing, "netWorthCents"),
      closedAt: dateFromMs(closing, "closedAt", today),
      pendingReviewCount: numberValue(closing, "pendingReviewCount", undefined),
      pendingReceiptCount: numberValue(closing, "pendingReceiptCount", undefined),
      confirmedAccountIds: stringArray(closing, "confirmedAccountIds"),
      exceededCategories: records(closing.exceededCategories).map((item) => ({
        categoryId: stringValue(item, "categoryId"),
        name: stringValue(item, "name"),
        plannedCents: numberValue(item, "plannedCents"),
        spentCents: numberValue(item, "spentCents"),
        overCents: numberValue(item, "overCents"),
      })),
      suggestedAdjustments: records(closing.suggestedAdjustments).map((item) => ({
        categoryId: stringValue(item, "categoryId"),
        name: stringValue(item, "name"),
        currentPlannedCents: numberValue(item, "currentPlannedCents"),
        suggestedPlannedCents: numberValue(item, "suggestedPlannedCents"),
        reason: stringValue(item, "reason"),
      })),
      learning: stringValue(closing, "learning", undefined),
      nextMonthPrepared: booleanValue(closing, "nextMonthPrepared", false),
      notes: stringValue(closing, "notes", undefined),
    })),
  };
}

export type ConvexSnapshotPayload = ReturnType<typeof stateSnapshotForConvex>;
