import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const currency = v.union(v.literal("DOP"), v.literal("USD"), v.literal("MXN"), v.literal("EUR"));
const mode = v.union(v.literal("tracker"), v.literal("monthly-plan"), v.literal("zero"));
const subscriptionPlan = v.union(v.literal("free"), v.literal("pro"));
const aiProvider = v.union(v.literal("local"), v.literal("openai"), v.literal("byok"), v.literal("claude"), v.literal("openrouter"));
const role = v.union(v.literal("owner"), v.literal("editor"), v.literal("viewer"));
const group = v.union(
  v.literal("income"),
  v.literal("essentials"),
  v.literal("discretionary"),
  v.literal("debt"),
  v.literal("savings"),
  v.literal("investments"),
);
const transactionType = v.union(
  v.literal("income"),
  v.literal("expense"),
  v.literal("transfer"),
  v.literal("debt_payment"),
  v.literal("saving"),
  v.literal("investment"),
  v.literal("refund"),
);
const movementStatus = v.union(
  v.literal("approved"),
  v.literal("needs_review"),
  v.literal("duplicate"),
  v.literal("adjustment"),
);
const notificationSettings = v.object({
  daily_capture: v.boolean(),
  recurring: v.boolean(),
  budget_risk: v.boolean(),
  month_close: v.boolean(),
  balance_confirm: v.boolean(),
  debt_payment: v.boolean(),
  goal_progress: v.boolean(),
  movement_review: v.boolean(),
  receipts: v.boolean(),
});

export default defineSchema({
  ...authTables,
  households: defineTable({
    name: v.string(),
    defaultCurrency: currency,
    activeMonth: v.string(),
    mode,
    activeSpaceLocalId: v.optional(v.string()),
    subscriptionPlan: v.optional(subscriptionPlan),
    aiProvider: v.optional(aiProvider),
    aiEnabled: v.optional(v.boolean()),
    aiHistoryEnabled: v.optional(v.boolean()),
    aiReceiptTextEnabled: v.optional(v.boolean()),
    notificationSettings: v.optional(notificationSettings),
    // Per-household merchant normalization rules (raw OCR/bank string -> clean alias).
    // Optional + additive so existing household rows stay valid.
    merchantAliases: v.optional(v.array(v.object({ raw: v.string(), alias: v.string() }))),
    createdAt: v.number(),
    updatedAt: v.number(),
    // Monotonic version for optimistic concurrency: saveSnapshot rejects a write whose
    // baseVersion is stale, so one device can never silently overwrite another's newer data.
    version: v.optional(v.number()),
    // Auth ownership. Anonymous households (no ownerUserId) stay open for the demo.
    ownerUserId: v.optional(v.id("users")),
  }).index("by_owner", ["ownerUserId"]),

  // Real multiuser membership: who can access a household.
  householdMembers: defineTable({
    householdId: v.id("households"),
    userId: v.optional(v.id("users")), // filled once the invited user signs in
    email: v.string(),
    name: v.optional(v.string()),
    role: v.union(v.literal("owner"), v.literal("editor"), v.literal("viewer")),
    invitedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_household", ["householdId"])
    .index("by_email", ["email"]),

  financialSpaces: defineTable({
    householdId: v.id("households"),
    localId: v.string(),
    name: v.string(),
    kind: v.union(v.literal("personal"), v.literal("family"), v.literal("business"), v.literal("test")),
    currency,
    activeMonth: v.string(),
    role,
    memberCount: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
    archived: v.boolean(),
  }).index("by_household", ["householdId"]),

  subscriptions: defineTable({
    householdId: v.id("households"),
    plan: subscriptionPlan,
    aiCreditsUsed: v.number(),
    aiCreditsLimit: v.number(),
    storageMbUsed: v.number(),
    storageMbLimit: v.number(),
    spacesLimit: v.number(),
    membersLimit: v.number(),
    updatedAt: v.number(),
    // Server-authoritative pro provenance: how/when pro was granted. Optional so existing
    // rows stay valid and the client never has to send these (only setHouseholdPlan writes them).
    proGrantedAt: v.optional(v.number()),
    proSource: v.optional(v.union(v.literal("stub_checkout"), v.literal("manual_grant"), v.literal("none"))),
  }).index("by_household", ["householdId"]),

  members: defineTable({
    householdId: v.id("households"),
    name: v.string(),
    role,
    avatar: v.string(),
    email: v.optional(v.string()),
  }).index("by_household", ["householdId"]),

  accounts: defineTable({
    householdId: v.id("households"),
    name: v.string(),
    kind: v.union(v.literal("cash"), v.literal("bank"), v.literal("credit"), v.literal("savings"), v.literal("investment")),
    currency,
    openingBalanceCents: v.number(),
    currentBalanceCents: v.number(),
    confirmedBalanceCents: v.optional(v.number()),
    lastConfirmedAt: v.optional(v.string()),
    includeInNetWorth: v.boolean(),
    defaultForCapture: v.optional(v.boolean()),
    notes: v.optional(v.string()),
    archived: v.boolean(),
  }).index("by_household", ["householdId"]),

  categories: defineTable({
    householdId: v.id("households"),
    group,
    name: v.string(),
    icon: v.optional(v.string()),
    color: v.optional(v.string()),
    subcategories: v.array(v.string()),
    isSystem: v.boolean(),
    source: v.union(v.literal("starter"), v.literal("user"), v.literal("imported")),
    archived: v.boolean(),
  })
    .index("by_household", ["householdId"])
    .index("by_household_group", ["householdId", "group"]),

  monthlyPlans: defineTable({
    householdId: v.id("households"),
    localId: v.optional(v.string()),
    month: v.string(),
    categoryId: v.id("categories"),
    plannedCents: v.number(),
    rolloverCents: v.number(),
    notes: v.optional(v.string()),
  })
    .index("by_household_month", ["householdId", "month"])
    .index("by_category_month", ["categoryId", "month"]),

  transactions: defineTable({
    householdId: v.id("households"),
    month: v.string(),
    type: transactionType,
    date: v.string(),
    description: v.string(),
    categoryId: v.optional(v.id("categories")),
    subcategory: v.optional(v.string()),
    accountId: v.id("accounts"),
    transferAccountId: v.optional(v.id("accounts")),
    linkedTransactionId: v.optional(v.id("transactions")),
    linkKind: v.optional(v.union(v.literal("refund"), v.literal("card_payment"), v.literal("correction"))),
    merchant: v.optional(v.string()),
    person: v.optional(v.string()),
    tags: v.array(v.string()),
    note: v.optional(v.string()),
    // Itemized receipt lines (factura). Optional + additive; amountCents is the line total.
    lineItems: v.optional(v.array(v.object({ name: v.string(), quantity: v.number(), amountCents: v.number() }))),
    originalAmountCents: v.number(),
    originalCurrency: currency,
    baseAmountCents: v.number(),
    baseCurrency: currency,
    exchangeRate: v.number(),
    exchangeRateDate: v.string(),
    exchangeRateSource: v.union(v.literal("api"), v.literal("manual"), v.literal("same_currency")),
    status: movementStatus,
    createdByMemberId: v.optional(v.id("members")),
    // Nombre del autor que registró el movimiento (quién puso qué). Optional + additive para
    // que las filas viejas sigan válidas; saveSnapshot lo escribe desde el `createdBy` del cliente
    // y el adapter lo lee de vuelta, de modo que la atribución por persona sobrevive la nube.
    createdByName: v.optional(v.string()),
    attachmentIds: v.array(v.id("attachments")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_household_month", ["householdId", "month"])
    .index("by_account_date", ["accountId", "date"])
    .index("by_category_month", ["categoryId", "month"])
    .searchIndex("search_description", {
      searchField: "description",
      filterFields: ["householdId", "month", "status"],
    }),

  transactionSplits: defineTable({
    transactionId: v.id("transactions"),
    categoryId: v.id("categories"),
    subcategory: v.optional(v.string()),
    amountCents: v.number(),
    note: v.optional(v.string()),
  }).index("by_transaction", ["transactionId"]),

  attachments: defineTable({
    householdId: v.id("households"),
    transactionId: v.optional(v.id("transactions")),
    storageId: v.optional(v.id("_storage")),
    fileName: v.string(),
    contentType: v.string(),
    source: v.union(v.literal("receipt"), v.literal("invoice"), v.literal("statement"), v.literal("other")),
    status: v.union(v.literal("uploaded"), v.literal("processing"), v.literal("needs_review"), v.literal("confirmed"), v.literal("error")),
    amountCents: v.optional(v.number()),
    currency: v.optional(currency),
    date: v.optional(v.string()),
    merchant: v.optional(v.string()),
    extractedText: v.optional(v.string()),
    note: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_household", ["householdId"])
    .index("by_transaction", ["transactionId"]),

  reviewItems: defineTable({
    householdId: v.id("households"),
    transactionId: v.optional(v.id("transactions")),
    targetType: v.optional(v.union(v.literal("transaction"), v.literal("receipt"), v.literal("account"), v.literal("category"), v.literal("rule"))),
    targetLocalId: v.optional(v.string()),
    reason: v.union(v.literal("uncategorized"), v.literal("duplicate"), v.literal("balance_adjustment"), v.literal("ai_suggestion"), v.literal("receipt_pending"), v.literal("budget_risk"), v.literal("recurring_pending"), v.literal("account_unconfirmed")),
    title: v.string(),
    subtitle: v.string(),
    amountCents: v.number(),
    action: v.optional(v.string()),
    status: v.union(v.literal("open"), v.literal("resolved"), v.literal("dismissed")),
    suggestedCategoryId: v.optional(v.id("categories")),
    createdAt: v.number(),
  })
    .index("by_household_status", ["householdId", "status"])
    .index("by_transaction", ["transactionId"]),

  comments: defineTable({
    householdId: v.id("households"),
    targetType: v.union(v.literal("transaction"), v.literal("category")),
    transactionId: v.optional(v.id("transactions")),
    categoryId: v.optional(v.id("categories")),
    authorMemberId: v.optional(v.id("members")),
    authorName: v.string(),
    body: v.string(),
    createdAt: v.number(),
  })
    .index("by_household", ["householdId"])
    .index("by_transaction", ["transactionId"])
    .index("by_category", ["categoryId"]),

  aiActions: defineTable({
    householdId: v.id("households"),
    kind: v.union(v.literal("text_capture"), v.literal("receipt_parse"), v.literal("monthly_summary"), v.literal("budget_suggestion")),
    provider: aiProvider,
    status: v.union(v.literal("suggested"), v.literal("accepted"), v.literal("failed")),
    inputPreview: v.string(),
    outputSummary: v.string(),
    creditsUsed: v.number(),
    createdAt: v.number(),
  }).index("by_household_created", ["householdId", "createdAt"]),

  recurringRules: defineTable({
    householdId: v.id("households"),
    localId: v.optional(v.string()),
    name: v.string(),
    type: transactionType,
    categoryId: v.optional(v.id("categories")),
    accountId: v.id("accounts"),
    amountCents: v.number(),
    currency,
    frequency: v.union(v.literal("weekly"), v.literal("biweekly"), v.literal("monthly"), v.literal("yearly")),
    nextDate: v.string(),
    merchant: v.optional(v.string()),
    note: v.optional(v.string()),
    active: v.boolean(),
  }).index("by_household_next", ["householdId", "nextDate"]),

  automationRules: defineTable({
    householdId: v.id("households"),
    localId: v.optional(v.string()),
    name: v.string(),
    matchText: v.string(),
    categoryId: v.id("categories"),
    accountId: v.optional(v.id("accounts")),
    merchant: v.optional(v.string()),
    subcategory: v.optional(v.string()),
    tag: v.optional(v.string()),
    active: v.boolean(),
  }).index("by_household", ["householdId"]),

  ruleApplications: defineTable({
    householdId: v.id("households"),
    localId: v.string(),
    ruleLocalId: v.string(),
    ruleName: v.string(),
    kind: v.union(v.literal("recurring"), v.literal("automation")),
    transactionLocalId: v.optional(v.string()),
    transactionDescription: v.optional(v.string()),
    summary: v.string(),
    status: v.union(v.literal("created_pending"), v.literal("classified"), v.literal("skipped")),
    createdAt: v.number(),
  }).index("by_household_created", ["householdId", "createdAt"]),

  debts: defineTable({
    householdId: v.id("households"),
    name: v.string(),
    accountId: v.optional(v.id("accounts")),
    balanceCents: v.number(),
    originalBalanceCents: v.optional(v.number()),
    rate: v.number(),
    minimumCents: v.number(),
    strategy: v.union(v.literal("snowball"), v.literal("avalanche"), v.literal("manual")),
    archived: v.boolean(),
  }).index("by_household", ["householdId"]),

  goals: defineTable({
    householdId: v.id("households"),
    localId: v.optional(v.string()),
    name: v.string(),
    targetCents: v.number(),
    savedCents: v.number(),
    due: v.string(),
    accountId: v.optional(v.id("accounts")),
    priority: v.optional(v.union(v.literal("low"), v.literal("medium"), v.literal("high"))),
    archived: v.boolean(),
  }).index("by_household", ["householdId"]),

  netWorthItems: defineTable({
    householdId: v.id("households"),
    name: v.string(),
    kind: v.union(v.literal("asset"), v.literal("liability")),
    group: v.union(v.literal("cash"), v.literal("bank"), v.literal("investment"), v.literal("property"), v.literal("debt"), v.literal("other")),
    amountCents: v.number(),
    asOfDate: v.string(),
  }).index("by_household_date", ["householdId", "asOfDate"]),

  monthClosings: defineTable({
    householdId: v.id("households"),
    month: v.string(),
    incomeCents: v.number(),
    outflowCents: v.number(),
    remainderCents: v.number(),
    savingsRate: v.number(),
    netWorthCents: v.number(),
    pendingReviewCount: v.optional(v.number()),
    pendingReceiptCount: v.optional(v.number()),
    confirmedAccountIds: v.optional(v.array(v.string())),
    exceededCategories: v.optional(v.array(v.object({
      categoryId: v.string(),
      name: v.string(),
      plannedCents: v.number(),
      spentCents: v.number(),
      overCents: v.number(),
    }))),
    suggestedAdjustments: v.optional(v.array(v.object({
      categoryId: v.string(),
      name: v.string(),
      currentPlannedCents: v.number(),
      suggestedPlannedCents: v.number(),
      reason: v.string(),
    }))),
    learning: v.optional(v.string()),
    nextMonthPrepared: v.optional(v.boolean()),
    notes: v.optional(v.string()),
    closedAt: v.number(),
  }).index("by_household_month", ["householdId", "month"]),
});
