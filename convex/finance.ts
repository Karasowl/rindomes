import { getAuthUserId } from "@convex-dev/auth/server";
import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";

export const currentUser = queryGeneric({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    return await ctx.db.get(userId);
  },
});

/**
 * Public-safe auth status (booleans only — never leaks email/user data).
 * - authenticated:        is there a signed-in session right now?
 * - emailVerified:        does the user's password account carry a verified email?
 * - verificationEnforced: does this deployment have the Resend env configured, i.e.
 *                         is the OTP step active (Password({ verify: ResendOTP }))?
 *                         The AuthPanel reads this to decide whether to show the
 *                         OTP screen or fall back to today's password-only flow.
 */
export const authStatus = queryGeneric({
  args: {},
  handler: async (ctx) => {
    const verificationEnforced = !!(process.env.RESEND_API_KEY && process.env.AUTH_EMAIL_FROM);
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return { authenticated: false, emailVerified: false, verificationEnforced };
    }
    // A verified email shows up as a non-empty `emailVerified` on the user's
    // password authAccount. Absent the verify provider this stays false, which
    // is fine — verificationEnforced tells the client not to gate on it.
    let emailVerified = false;
    try {
      const accounts = await ctx.db
        .query("authAccounts")
        .filter((q: any) => q.eq(q.field("userId"), userId))
        .collect();
      emailVerified = accounts.some((account: any) => Boolean(account.emailVerified));
    } catch {
      emailVerified = false;
    }
    return { authenticated: true, emailVerified, verificationEnforced };
  },
});

// --- Multiuser authorization ---

async function householdMembersOf(ctx: any, householdId: any) {
  return await ctx.db
    .query("householdMembers")
    .withIndex("by_household", (q: any) => q.eq("householdId", householdId))
    .collect();
}

// Auth-first: NOBODY reaches a household without a real session. The internet
// can no longer read/write a household just by knowing its id.
//   - No session            -> rejected outright (this closed the open-by-default hole).
//   - Session, no owner yet  -> allowed; the caller claims it on first access (legacy
//                               anonymous households created before auth-first are adopted
//                               by the first signed-in user that opens them).
//   - Session, has owners    -> only the member users may read/write it.
// EXPORTED so the other backend modules (receipts.ts, entitlement.ts) reuse the
// exact same authorization rules. Signature is stable and load-bearing — do not
// change it without updating those callers.
export async function assertCanAccess(ctx: any, householdId: any, userId: any) {
  if (!userId) throw new Error("Inicia sesión para acceder a este hogar.");
  const members = await householdMembersOf(ctx, householdId);
  if (members.length === 0) return; // unclaimed household — the signed-in caller adopts it
  if (!members.some((m: any) => m.userId === userId)) {
    throw new Error("No tienes acceso a este hogar.");
  }
}

// EXPORTED for the same reason as assertCanAccess (entitlement.ts gates the
// owner-only setHouseholdPlan with it). Signature is stable.
export async function assertOwner(ctx: any, householdId: any, userId: any) {
  if (!userId) throw new Error("Inicia sesión.");
  const members = await householdMembersOf(ctx, householdId);
  const me = members.find((m: any) => m.userId === userId);
  if (!me || me.role !== "owner") throw new Error("Solo el propietario puede gestionar miembros.");
}

async function ensureOwnerMembership(ctx: any, householdId: any, userId: any) {
  const members = await householdMembersOf(ctx, householdId);
  if (members.some((m: any) => m.userId === userId)) return;
  const household = await ctx.db.get(householdId);
  if (household && !household.ownerUserId) {
    await ctx.db.patch(householdId, { ownerUserId: userId });
  }
  const user = await ctx.db.get(userId);
  await ctx.db.insert("householdMembers", {
    householdId,
    userId,
    email: user?.email ?? "",
    name: user?.name,
    role: "owner",
    invitedAt: Date.now(),
  });
}

/** Returns the household id the signed-in user belongs to, or null. */
export const getMyHousehold = queryGeneric({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const membership = await ctx.db
      .query("householdMembers")
      .withIndex("by_user", (q: any) => q.eq("userId", userId))
      .first();
    return membership?.householdId ?? null;
  },
});

export const listMembers = queryGeneric({
  args: { householdId: v.id("households") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    await assertCanAccess(ctx, args.householdId, userId);
    const members = await householdMembersOf(ctx, args.householdId);
    return members.map((m: any) => ({ id: m._id, email: m.email, name: m.name ?? null, role: m.role, active: Boolean(m.userId) }));
  },
});

export const inviteMember = mutationGeneric({
  args: {
    householdId: v.id("households"),
    email: v.string(),
    role: v.union(v.literal("editor"), v.literal("viewer")),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    await assertOwner(ctx, args.householdId, userId);
    const email = args.email.trim().toLowerCase();
    if (!email) throw new Error("Email inválido.");
    const existing = await householdMembersOf(ctx, args.householdId);
    if (existing.some((m: any) => m.email === email)) return null;
    const existingUser = await ctx.db
      .query("users")
      .withIndex("email", (q: any) => q.eq("email", email))
      .first();
    return await ctx.db.insert("householdMembers", {
      householdId: args.householdId,
      userId: existingUser?._id,
      email,
      name: existingUser?.name,
      role: args.role,
      invitedAt: Date.now(),
    });
  },
});

export const removeMember = mutationGeneric({
  args: { memberId: v.id("householdMembers") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    const member = await ctx.db.get(args.memberId);
    if (!member) return;
    await assertOwner(ctx, member.householdId, userId);
    if (member.role === "owner") throw new Error("No puedes quitar al propietario.");
    await ctx.db.delete(args.memberId);
  },
});

/** Called after login: links any pending email invites to this user and returns their household. */
export const claimInvites = mutationGeneric({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const user = await ctx.db.get(userId);
    const email = user?.email;
    if (!email) return null;
    const pending = await ctx.db
      .query("householdMembers")
      .withIndex("by_email", (q: any) => q.eq("email", email))
      .collect();
    for (const m of pending) {
      if (!m.userId) await ctx.db.patch(m._id, { userId });
    }
    const membership = await ctx.db
      .query("householdMembers")
      .withIndex("by_user", (q: any) => q.eq("userId", userId))
      .first();
    return membership?.householdId ?? null;
  },
});

/**
 * Adopts a still-unclaimed household (one with no membership records) for the
 * signed-in user. This is the migration seam for legacy anonymous households
 * created before auth-first: the client knows its local householdId, and on the
 * first authenticated load it calls this so the hogar gets a real owner and is
 * locked down. Idempotent: if the household already has members, it just verifies
 * the caller is one of them and changes nothing.
 */
export const claimHousehold = mutationGeneric({
  args: { householdId: v.id("households") },
  handler: async (ctx, { householdId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Inicia sesión para reclamar este hogar.");
    const members = await householdMembersOf(ctx, householdId);
    if (members.length === 0) {
      await ensureOwnerMembership(ctx, householdId, userId);
      return { claimed: true };
    }
    await assertCanAccess(ctx, householdId, userId);
    return { claimed: false };
  },
});

const currency = v.union(v.literal("DOP"), v.literal("USD"), v.literal("MXN"), v.literal("EUR"));
const mode = v.union(v.literal("tracker"), v.literal("monthly-plan"), v.literal("zero"));
const subscriptionPlan = v.union(v.literal("free"), v.literal("pro"));
const aiProvider = v.union(v.literal("local"), v.literal("openai"), v.literal("byok"), v.literal("claude"), v.literal("openrouter"));
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
const exchangeRateSource = v.union(v.literal("api"), v.literal("manual"), v.literal("same_currency"));
const recurringFrequency = v.union(v.literal("weekly"), v.literal("biweekly"), v.literal("monthly"), v.literal("yearly"));
const receiptStatus = v.union(v.literal("uploaded"), v.literal("processing"), v.literal("needs_review"), v.literal("confirmed"), v.literal("error"));
const movementStatus = v.union(
  v.literal("approved"),
  v.literal("needs_review"),
  v.literal("duplicate"),
  v.literal("adjustment"),
);
const notificationSettingsInput = v.object({
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
const defaultNotificationSettings = {
  daily_capture: true,
  recurring: true,
  budget_risk: true,
  month_close: true,
  balance_confirm: true,
  debt_payment: true,
  goal_progress: true,
  movement_review: true,
  receipts: true,
};

const categoryInput = {
  group,
  name: v.string(),
  subcategories: v.array(v.string()),
  plannedCents: v.number(),
  source: v.union(v.literal("starter"), v.literal("user"), v.literal("imported")),
  archived: v.optional(v.boolean()),
};

const transactionInput = {
  type: transactionType,
  date: v.string(),
  description: v.string(),
  categoryId: v.id("categories"),
  subcategory: v.optional(v.string()),
  accountId: v.id("accounts"),
  transferAccountId: v.optional(v.id("accounts")),
  linkedTransactionId: v.optional(v.id("transactions")),
  linkKind: v.optional(v.union(v.literal("refund"), v.literal("card_payment"), v.literal("correction"))),
  merchant: v.optional(v.string()),
  person: v.optional(v.string()),
  tags: v.array(v.string()),
  note: v.optional(v.string()),
  // Itemized receipt lines (factura). Optional + additive; mirrors transactionSnapshotInput
  // so a direct addTransaction call can never silently drop the breakdown.
  lineItems: v.optional(v.array(v.object({ name: v.string(), quantity: v.number(), amountCents: v.number() }))),
  originalAmountCents: v.number(),
  originalCurrency: currency,
  baseAmountCents: v.number(),
  baseCurrency: currency,
  exchangeRate: v.number(),
  exchangeRateDate: v.string(),
  exchangeRateSource,
  status: movementStatus,
  attachmentIds: v.array(v.id("attachments")),
};

const accountSnapshotInput = {
  localId: v.string(),
  name: v.string(),
  kind: v.union(v.literal("cash"), v.literal("bank"), v.literal("credit"), v.literal("savings"), v.literal("investment")),
  currency,
  balanceCents: v.number(),
  confirmedBalanceCents: v.optional(v.number()),
  lastConfirmedAt: v.optional(v.string()),
  includeInNetWorth: v.optional(v.boolean()),
  defaultForCapture: v.optional(v.boolean()),
  archived: v.optional(v.boolean()),
  notes: v.optional(v.string()),
};

const categorySnapshotInput = {
  localId: v.string(),
  group,
  name: v.string(),
  subcategories: v.array(v.string()),
  plannedCents: v.number(),
  source: v.union(v.literal("starter"), v.literal("user"), v.literal("imported")),
  archived: v.optional(v.boolean()),
};

const monthlyPlanSnapshotInput = {
  localId: v.string(),
  month: v.string(),
  categoryLocalId: v.string(),
  plannedCents: v.number(),
  rolloverCents: v.optional(v.number()),
  notes: v.optional(v.string()),
};

const transactionSnapshotInput = {
  localId: v.string(),
  type: transactionType,
  date: v.string(),
  description: v.string(),
  categoryLocalId: v.string(),
  subcategory: v.optional(v.string()),
  accountLocalId: v.string(),
  transferAccountLocalId: v.optional(v.string()),
  linkedTransactionLocalId: v.optional(v.string()),
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
  exchangeRateSource,
  status: movementStatus,
  createdBy: v.string(),
  splits: v.array(v.object({
    categoryLocalId: v.string(),
    subcategory: v.optional(v.string()),
    amountCents: v.number(),
    note: v.optional(v.string()),
  })),
};

const recurringRuleSnapshotInput = {
  localId: v.string(),
  name: v.string(),
  type: transactionType,
  categoryLocalId: v.string(),
  accountLocalId: v.string(),
  amountCents: v.number(),
  currency,
  frequency: recurringFrequency,
  nextDate: v.string(),
  merchant: v.optional(v.string()),
  note: v.optional(v.string()),
  active: v.boolean(),
};

const automationRuleSnapshotInput = {
  localId: v.string(),
  name: v.string(),
  matchText: v.string(),
  categoryLocalId: v.string(),
  accountLocalId: v.optional(v.string()),
  merchant: v.optional(v.string()),
  subcategory: v.optional(v.string()),
  tag: v.optional(v.string()),
  active: v.boolean(),
};

const ruleApplicationSnapshotInput = {
  localId: v.string(),
  ruleLocalId: v.string(),
  ruleName: v.string(),
  kind: v.union(v.literal("recurring"), v.literal("automation")),
  transactionLocalId: v.optional(v.string()),
  transactionDescription: v.optional(v.string()),
  summary: v.string(),
  status: v.union(v.literal("created_pending"), v.literal("classified"), v.literal("skipped")),
  createdAt: v.number(),
};

const receiptSnapshotInput = {
  localId: v.string(),
  transactionLocalId: v.optional(v.string()),
  // The real uploaded blob pointer. EXISTING attachments column — the snapshot
  // round-trip used to drop it, orphaning the file on every ~1.2s autosave.
  // Stored as a string here (the serialized form); normalized back to an
  // Id<"_storage"> when inserted (see the attachments insert below).
  storageId: v.optional(v.string()),
  fileName: v.string(),
  contentType: v.string(),
  source: v.union(v.literal("receipt"), v.literal("invoice"), v.literal("statement"), v.literal("other")),
  status: receiptStatus,
  amountCents: v.optional(v.number()),
  currency: v.optional(currency),
  date: v.optional(v.string()),
  merchant: v.optional(v.string()),
  extractedText: v.optional(v.string()),
  note: v.optional(v.string()),
  createdAt: v.number(),
};

const commentSnapshotInput = {
  targetType: v.union(v.literal("transaction"), v.literal("category")),
  targetLocalId: v.string(),
  authorMemberName: v.string(),
  authorName: v.string(),
  body: v.string(),
  createdAt: v.number(),
};

const goalSnapshotInput = {
  localId: v.string(),
  name: v.string(),
  targetCents: v.number(),
  savedCents: v.number(),
  due: v.string(),
  accountLocalId: v.optional(v.string()),
  priority: v.optional(v.union(v.literal("low"), v.literal("medium"), v.literal("high"))),
  archived: v.optional(v.boolean()),
};

const debtSnapshotInput = {
  name: v.string(),
  balanceCents: v.number(),
  originalBalanceCents: v.optional(v.number()),
  rate: v.number(),
  minimumCents: v.number(),
  strategy: v.union(v.literal("snowball"), v.literal("avalanche"), v.literal("manual")),
};

const netWorthSnapshotInput = {
  name: v.string(),
  kind: v.union(v.literal("asset"), v.literal("liability")),
  group: v.union(v.literal("cash"), v.literal("bank"), v.literal("investment"), v.literal("property"), v.literal("debt"), v.literal("other")),
  amountCents: v.number(),
};

const memberSnapshotInput = {
  name: v.string(),
  role: v.union(v.literal("owner"), v.literal("editor"), v.literal("viewer")),
  avatar: v.string(),
  email: v.optional(v.string()),
};

const spaceSnapshotInput = {
  localId: v.string(),
  name: v.string(),
  kind: v.union(v.literal("personal"), v.literal("family"), v.literal("business"), v.literal("test")),
  currency,
  activeMonth: v.string(),
  role: v.union(v.literal("owner"), v.literal("editor"), v.literal("viewer")),
  memberCount: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
  archived: v.boolean(),
};

const subscriptionSnapshotInput = {
  plan: subscriptionPlan,
  aiCreditsUsed: v.number(),
  aiCreditsLimit: v.number(),
  storageMbUsed: v.number(),
  storageMbLimit: v.number(),
  spacesLimit: v.number(),
  membersLimit: v.number(),
};

const aiActionSnapshotInput = {
  localId: v.string(),
  kind: v.union(v.literal("text_capture"), v.literal("receipt_parse"), v.literal("monthly_summary"), v.literal("budget_suggestion")),
  provider: aiProvider,
  status: v.union(v.literal("suggested"), v.literal("accepted"), v.literal("failed")),
  inputPreview: v.string(),
  outputSummary: v.string(),
  creditsUsed: v.number(),
  createdAt: v.number(),
};

const reviewItemSnapshotInput = {
  localId: v.string(),
  reason: v.union(v.literal("uncategorized"), v.literal("duplicate"), v.literal("balance_adjustment"), v.literal("ai_suggestion"), v.literal("receipt_pending"), v.literal("budget_risk"), v.literal("recurring_pending"), v.literal("account_unconfirmed")),
  title: v.string(),
  subtitle: v.string(),
  amountCents: v.number(),
  action: v.string(),
  targetType: v.optional(v.union(v.literal("transaction"), v.literal("receipt"), v.literal("account"), v.literal("category"), v.literal("rule"))),
  targetLocalId: v.optional(v.string()),
};

const monthClosingSnapshotInput = {
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
};

export const getHouseholdSnapshot = queryGeneric({
  args: {
    householdId: v.id("households"),
  },
  handler: async (ctx, { householdId }) => {
    const callerId = await getAuthUserId(ctx);
    await assertCanAccess(ctx, householdId, callerId);
    const [household, members, spaces, subscriptions, accounts, categories, plans, transactions, attachments, comments, aiActions, reviewItems, recurringRules, automationRules, ruleApplications, goals, debts, netWorthItems, monthClosings] = await Promise.all([
      ctx.db.get(householdId),
      ctx.db.query("members").withIndex("by_household", (q) => q.eq("householdId", householdId)).collect(),
      ctx.db.query("financialSpaces").withIndex("by_household", (q) => q.eq("householdId", householdId)).collect(),
      ctx.db.query("subscriptions").withIndex("by_household", (q) => q.eq("householdId", householdId)).collect(),
      ctx.db.query("accounts").withIndex("by_household", (q) => q.eq("householdId", householdId)).collect(),
      ctx.db.query("categories").withIndex("by_household", (q) => q.eq("householdId", householdId)).collect(),
      ctx.db.query("monthlyPlans").withIndex("by_household_month", (q) => q.eq("householdId", householdId)).collect(),
      ctx.db.query("transactions").withIndex("by_household_month", (q) => q.eq("householdId", householdId)).collect(),
      ctx.db.query("attachments").withIndex("by_household", (q) => q.eq("householdId", householdId)).collect(),
      ctx.db.query("comments").withIndex("by_household", (q) => q.eq("householdId", householdId)).collect(),
      ctx.db.query("aiActions").withIndex("by_household_created", (q) => q.eq("householdId", householdId)).collect(),
      ctx.db.query("reviewItems").withIndex("by_household_status", (q) => q.eq("householdId", householdId)).filter((q) => q.eq(q.field("status"), "open")).collect(),
      ctx.db.query("recurringRules").withIndex("by_household_next", (q) => q.eq("householdId", householdId)).collect(),
      ctx.db.query("automationRules").withIndex("by_household", (q) => q.eq("householdId", householdId)).collect(),
      ctx.db.query("ruleApplications").withIndex("by_household_created", (q) => q.eq("householdId", householdId)).collect(),
      ctx.db.query("goals").withIndex("by_household", (q) => q.eq("householdId", householdId)).collect(),
      ctx.db.query("debts").withIndex("by_household", (q) => q.eq("householdId", householdId)).collect(),
      ctx.db.query("netWorthItems").withIndex("by_household_date", (q) => q.eq("householdId", householdId)).collect(),
      ctx.db.query("monthClosings").withIndex("by_household_month", (q) => q.eq("householdId", householdId)).collect(),
    ]);
    const transactionSplits = (await Promise.all(transactions.map((transaction) => (
      ctx.db.query("transactionSplits").withIndex("by_transaction", (q) => q.eq("transactionId", transaction._id)).collect()
    )))).flat();

    return {
      household,
      members,
      spaces,
      subscription: subscriptions[0] ?? null,
      accounts,
      categories,
      plans,
      transactions,
      transactionSplits,
      attachments,
      comments,
      aiActions,
      reviewItems,
      recurringRules,
      automationRules,
      ruleApplications,
      goals,
      debts,
      netWorthItems,
      monthClosings,
    };
  },
});

export const createHousehold = mutationGeneric({
  args: {
    name: v.string(),
    defaultCurrency: currency,
    activeMonth: v.string(),
    mode,
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const householdId = await ctx.db.insert("households", {
      name: args.name,
      defaultCurrency: args.defaultCurrency,
      activeMonth: args.activeMonth,
      mode: args.mode,
      subscriptionPlan: "free",
      aiProvider: "local",
      aiEnabled: true,
      aiHistoryEnabled: true,
      aiReceiptTextEnabled: true,
      notificationSettings: defaultNotificationSettings,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("financialSpaces", {
      householdId,
      localId: "default",
      name: args.name,
      kind: "personal",
      currency: args.defaultCurrency,
      activeMonth: args.activeMonth,
      role: "owner",
      memberCount: 1,
      createdAt: now,
      updatedAt: now,
      archived: false,
    });

    await ctx.db.insert("subscriptions", {
      householdId,
      plan: "free",
      aiCreditsUsed: 0,
      aiCreditsLimit: 25,
      storageMbUsed: 0,
      storageMbLimit: 100,
      spacesLimit: 2,
      membersLimit: 2,
      updatedAt: now,
    });

    await ctx.db.insert("members", {
      householdId,
      name: "Propietario",
      role: "owner",
      avatar: "PR",
    });

    await ctx.db.insert("accounts", {
      householdId,
      name: "Efectivo",
      kind: "cash",
      currency: args.defaultCurrency,
      openingBalanceCents: 0,
      currentBalanceCents: 0,
      confirmedBalanceCents: 0,
      lastConfirmedAt: new Date(now).toISOString().slice(0, 10),
      includeInNetWorth: true,
      defaultForCapture: true,
      archived: false,
    });

    return householdId;
  },
});

export const saveSnapshot = mutationGeneric({
  args: {
    householdId: v.optional(v.id("households")),
    baseVersion: v.optional(v.number()),
    household: v.object({
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
      notificationSettings: v.optional(notificationSettingsInput),
      // Per-household merchant aliases. Optional + additive so older clients can omit them.
      merchantAliases: v.optional(v.array(v.object({ raw: v.string(), alias: v.string() }))),
    }),
    spaces: v.array(v.object(spaceSnapshotInput)),
    subscription: v.object(subscriptionSnapshotInput),
    accounts: v.array(v.object(accountSnapshotInput)),
    categories: v.array(v.object(categorySnapshotInput)),
    monthlyPlans: v.array(v.object(monthlyPlanSnapshotInput)),
    transactions: v.array(v.object(transactionSnapshotInput)),
    receipts: v.array(v.object(receiptSnapshotInput)),
    comments: v.array(v.object(commentSnapshotInput)),
    aiActions: v.array(v.object(aiActionSnapshotInput)),
    review: v.array(v.object(reviewItemSnapshotInput)),
    recurringRules: v.array(v.object(recurringRuleSnapshotInput)),
    automationRules: v.array(v.object(automationRuleSnapshotInput)),
    ruleApplications: v.array(v.object(ruleApplicationSnapshotInput)),
    members: v.array(v.object(memberSnapshotInput)),
    goals: v.array(v.object(goalSnapshotInput)),
    debts: v.array(v.object(debtSnapshotInput)),
    netWorth: v.array(v.object(netWorthSnapshotInput)),
    monthClosings: v.array(v.object(monthClosingSnapshotInput)),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const userId = await getAuthUserId(ctx);
    // Auth-first: a brand-new hogar can only be provisioned by a signed-in user, so it is
    // owned from birth and never lands in the cloud unclaimed/open. Existing hogares go
    // through the membership check (which also rejects anonymous callers).
    if (args.householdId) {
      await assertCanAccess(ctx, args.householdId, userId);
    } else if (!userId) {
      throw new Error("Inicia sesión para sincronizar tu hogar en la nube.");
    }

    // Optimistic concurrency: refuse to overwrite a household that already advanced past the
    // version the client last hydrated, so a stale device can never silently wipe newer cloud
    // data. The client re-hydrates and retries on a conflict.
    const existingHousehold = args.householdId ? await ctx.db.get(args.householdId) : null;
    const currentVersion = existingHousehold?.version ?? 0;
    if (args.householdId && args.baseVersion !== undefined && args.baseVersion !== currentVersion) {
      return { conflict: true as const, householdId: args.householdId as string, version: currentVersion, accounts: 0, categories: 0, transactions: 0 };
    }
    const nextVersion = currentVersion + 1;

    // SECURITY: the entitlement plan is SERVER-AUTHORED, never client-trusted.
    // The client snapshot still ships household.subscriptionPlan and
    // subscription.plan/proSource/proGrantedAt for back-compat, but a client
    // could set them to "pro" to self-grant. We ignore those fields entirely
    // and re-derive the plan from the existing server subscriptions row. Only
    // entitlement.setHouseholdPlan (owner-only, env-gated) — and a future
    // Stripe webhook calling it — may ever change the plan.
    const existingSubscription = args.householdId
      ? await ctx.db
          .query("subscriptions")
          .withIndex("by_household", (q) => q.eq("householdId", args.householdId))
          .first()
      : null;
    const serverPlan: "free" | "pro" = existingSubscription?.plan ?? "free";
    const serverProSource: "stub_checkout" | "manual_grant" | "none" =
      existingSubscription?.proSource ?? "none";
    const serverProGrantedAt: number | undefined = existingSubscription?.proGrantedAt;

    const householdId = args.householdId ?? await ctx.db.insert("households", {
      name: args.household.name,
      defaultCurrency: args.household.defaultCurrency,
      activeMonth: args.household.activeMonth,
      mode: args.household.mode,
      activeSpaceLocalId: args.household.activeSpaceLocalId,
      // SERVER-AUTHORED plan, not args.household.subscriptionPlan. A brand-new
      // household has no subscription row yet, so this is "free".
      subscriptionPlan: serverPlan,
      aiProvider: args.household.aiProvider,
      aiEnabled: args.household.aiEnabled,
      aiHistoryEnabled: args.household.aiHistoryEnabled,
      aiReceiptTextEnabled: args.household.aiReceiptTextEnabled,
      notificationSettings: args.household.notificationSettings ?? defaultNotificationSettings,
      merchantAliases: args.household.merchantAliases,
      ownerUserId: userId ?? undefined,
      createdAt: now,
      updatedAt: now,
      version: nextVersion,
    });

    if (userId) await ensureOwnerMembership(ctx, householdId, userId);

    if (args.householdId) {
      await ctx.db.patch(householdId, {
        name: args.household.name,
        defaultCurrency: args.household.defaultCurrency,
        activeMonth: args.household.activeMonth,
        mode: args.household.mode,
        activeSpaceLocalId: args.household.activeSpaceLocalId,
        // SERVER-AUTHORED plan (see note above) — never trust the client's value.
        subscriptionPlan: serverPlan,
        aiProvider: args.household.aiProvider,
        aiEnabled: args.household.aiEnabled,
        aiHistoryEnabled: args.household.aiHistoryEnabled,
        aiReceiptTextEnabled: args.household.aiReceiptTextEnabled,
        notificationSettings: args.household.notificationSettings ?? defaultNotificationSettings,
        merchantAliases: args.household.merchantAliases,
        updatedAt: now,
        version: nextVersion,
      });
    }

    const [members, spaces, subscriptions, accounts, categories, plans, transactions, attachments, comments, aiActions, reviewItems, recurringRules, automationRules, ruleApplications, goals, debts, netWorthItems, monthClosings] = await Promise.all([
      ctx.db.query("members").withIndex("by_household", (q) => q.eq("householdId", householdId)).collect(),
      ctx.db.query("financialSpaces").withIndex("by_household", (q) => q.eq("householdId", householdId)).collect(),
      ctx.db.query("subscriptions").withIndex("by_household", (q) => q.eq("householdId", householdId)).collect(),
      ctx.db.query("accounts").withIndex("by_household", (q) => q.eq("householdId", householdId)).collect(),
      ctx.db.query("categories").withIndex("by_household", (q) => q.eq("householdId", householdId)).collect(),
      ctx.db.query("monthlyPlans").withIndex("by_household_month", (q) => q.eq("householdId", householdId)).collect(),
      ctx.db.query("transactions").withIndex("by_household_month", (q) => q.eq("householdId", householdId)).collect(),
      ctx.db.query("attachments").withIndex("by_household", (q) => q.eq("householdId", householdId)).collect(),
      ctx.db.query("comments").withIndex("by_household", (q) => q.eq("householdId", householdId)).collect(),
      ctx.db.query("aiActions").withIndex("by_household_created", (q) => q.eq("householdId", householdId)).collect(),
      ctx.db.query("reviewItems").withIndex("by_household_status", (q) => q.eq("householdId", householdId)).collect(),
      ctx.db.query("recurringRules").withIndex("by_household_next", (q) => q.eq("householdId", householdId)).collect(),
      ctx.db.query("automationRules").withIndex("by_household", (q) => q.eq("householdId", householdId)).collect(),
      ctx.db.query("ruleApplications").withIndex("by_household_created", (q) => q.eq("householdId", householdId)).collect(),
      ctx.db.query("goals").withIndex("by_household", (q) => q.eq("householdId", householdId)).collect(),
      ctx.db.query("debts").withIndex("by_household", (q) => q.eq("householdId", householdId)).collect(),
      ctx.db.query("netWorthItems").withIndex("by_household_date", (q) => q.eq("householdId", householdId)).collect(),
      ctx.db.query("monthClosings").withIndex("by_household_month", (q) => q.eq("householdId", householdId)).collect(),
    ]);

    const transactionSplits = (await Promise.all(transactions.map((transaction) => (
      ctx.db.query("transactionSplits").withIndex("by_transaction", (q) => q.eq("transactionId", transaction._id)).collect()
    )))).flat();

    await Promise.all([
      ...members,
      ...spaces,
      ...subscriptions,
      ...accounts,
      ...categories,
      ...plans,
      ...transactionSplits,
      ...transactions,
      ...attachments,
      ...comments,
      ...aiActions,
      ...reviewItems,
      ...recurringRules,
      ...automationRules,
      ...ruleApplications,
      ...goals,
      ...debts,
      ...netWorthItems,
      ...monthClosings,
    ].map((document) => ctx.db.delete(document._id)));

    for (const space of args.spaces) {
      await ctx.db.insert("financialSpaces", {
        householdId,
        localId: space.localId,
        name: space.name,
        kind: space.kind,
        currency: space.currency,
        activeMonth: space.activeMonth,
        role: space.role,
        memberCount: space.memberCount,
        createdAt: space.createdAt,
        updatedAt: space.updatedAt,
        archived: space.archived,
      });
    }

    // SECURITY: do NOT spread args.subscription wholesale — that let any client
    // self-grant plan:"pro". Take only the advisory display/usage counters from
    // the client and PRESERVE the server-authored entitlement fields
    // (plan/proSource/proGrantedAt) captured before the wipe above.
    await ctx.db.insert("subscriptions", {
      householdId,
      plan: serverPlan,
      proSource: serverProSource,
      ...(serverProGrantedAt !== undefined ? { proGrantedAt: serverProGrantedAt } : {}),
      aiCreditsUsed: args.subscription.aiCreditsUsed,
      aiCreditsLimit: args.subscription.aiCreditsLimit,
      storageMbUsed: args.subscription.storageMbUsed,
      storageMbLimit: args.subscription.storageMbLimit,
      spacesLimit: args.subscription.spacesLimit,
      membersLimit: args.subscription.membersLimit,
      updatedAt: now,
    });

    const accountIds = new Map<string, string>();
    for (const account of args.accounts) {
      const accountId = await ctx.db.insert("accounts", {
        householdId,
        name: account.name,
        kind: account.kind,
        currency: account.currency,
        openingBalanceCents: account.balanceCents,
        currentBalanceCents: account.balanceCents,
        confirmedBalanceCents: account.confirmedBalanceCents,
        lastConfirmedAt: account.lastConfirmedAt,
        includeInNetWorth: account.includeInNetWorth ?? true,
        defaultForCapture: account.defaultForCapture,
        notes: account.notes,
        archived: account.archived ?? false,
      });
      accountIds.set(account.localId, accountId);
    }

    const categoryIds = new Map<string, string>();
    for (const category of args.categories) {
      const categoryId = await ctx.db.insert("categories", {
        householdId,
        group: category.group,
        name: category.name,
        subcategories: category.subcategories,
        source: category.source,
        isSystem: category.source === "starter",
        archived: category.archived ?? false,
      });
      categoryIds.set(category.localId, categoryId);
    }

    const snapshotPlans = args.monthlyPlans.length
      ? args.monthlyPlans
      : args.categories.map((category) => ({
          localId: `plan-${args.household.activeMonth}-${category.localId}`,
          month: args.household.activeMonth,
          categoryLocalId: category.localId,
          plannedCents: category.plannedCents,
          rolloverCents: 0,
          notes: undefined,
        }));

    for (const plan of snapshotPlans) {
      const categoryId = categoryIds.get(plan.categoryLocalId);
      if (!categoryId) continue;
      await ctx.db.insert("monthlyPlans", {
        householdId,
        localId: plan.localId,
        month: plan.month,
        categoryId,
        plannedCents: plan.plannedCents,
        rolloverCents: plan.rolloverCents ?? 0,
        notes: plan.notes,
      });
    }

    const transactionIds = new Map();
    for (const transaction of args.transactions) {
      const accountId = accountIds.get(transaction.accountLocalId);
      const transferAccountId = transaction.transferAccountLocalId ? accountIds.get(transaction.transferAccountLocalId) : undefined;
      const categoryId = categoryIds.get(transaction.categoryLocalId);
      if (!accountId || !categoryId) continue;

      const transactionId = await ctx.db.insert("transactions", {
        householdId,
        month: args.household.activeMonth,
        type: transaction.type,
        date: transaction.date,
        description: transaction.description,
        categoryId,
        subcategory: transaction.subcategory,
        accountId,
        transferAccountId,
        linkKind: transaction.linkKind,
        merchant: transaction.merchant,
        person: transaction.person,
        tags: transaction.tags,
        note: transaction.note,
        lineItems: transaction.lineItems,
        originalAmountCents: transaction.originalAmountCents,
        originalCurrency: transaction.originalCurrency,
        baseAmountCents: transaction.baseAmountCents,
        baseCurrency: transaction.baseCurrency,
        exchangeRate: transaction.exchangeRate,
        exchangeRateDate: transaction.exchangeRateDate,
        exchangeRateSource: transaction.exchangeRateSource,
        status: transaction.status,
        // Atribución: guardamos el nombre del autor que mandó el cliente, para que "quién puso qué"
        // sobreviva el round-trip a la nube (antes se perdía y al leer caía a members[0]).
        createdByName: transaction.createdBy,
        attachmentIds: [],
        createdAt: now,
        updatedAt: now,
      });
      transactionIds.set(transaction.localId, transactionId);

      for (const split of transaction.splits) {
        const splitCategoryId = categoryIds.get(split.categoryLocalId);
        if (!splitCategoryId) continue;

        await ctx.db.insert("transactionSplits", {
          transactionId,
          categoryId: splitCategoryId,
          subcategory: split.subcategory,
          amountCents: split.amountCents,
          note: split.note,
        });
      }
    }

    for (const transaction of args.transactions) {
      if (!transaction.linkedTransactionLocalId) continue;
      const transactionId = transactionIds.get(transaction.localId);
      const linkedTransactionId = transactionIds.get(transaction.linkedTransactionLocalId);
      if (transactionId && linkedTransactionId) {
        await ctx.db.patch(transactionId, { linkedTransactionId });
      }
    }

    for (const receipt of args.receipts) {
      await ctx.db.insert("attachments", {
        householdId,
        transactionId: receipt.transactionLocalId ? transactionIds.get(receipt.transactionLocalId) : undefined,
        // normalizeId validates the string is a real _storage id for this
        // deployment; anything else (stale/foreign/garbage) becomes undefined
        // so we never persist a bogus pointer.
        storageId: receipt.storageId ? (ctx.db.normalizeId("_storage", receipt.storageId) ?? undefined) : undefined,
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
        createdAt: receipt.createdAt,
      });
    }

    for (const comment of args.comments) {
      const targetTransactionId = comment.targetType === "transaction" ? transactionIds.get(comment.targetLocalId) : undefined;
      const targetCategoryId = comment.targetType === "category" ? categoryIds.get(comment.targetLocalId) : undefined;

      await ctx.db.insert("comments", {
        householdId,
        targetType: comment.targetType,
        transactionId: targetTransactionId,
        categoryId: targetCategoryId,
        authorName: comment.authorName,
        body: comment.body,
        createdAt: comment.createdAt,
      });
    }

    for (const action of args.aiActions) {
      await ctx.db.insert("aiActions", {
        householdId,
        kind: action.kind,
        provider: action.provider,
        status: action.status,
        inputPreview: action.inputPreview,
        outputSummary: action.outputSummary,
        creditsUsed: action.creditsUsed,
        createdAt: action.createdAt,
      });
    }

    for (const item of args.review) {
      const transactionId = item.targetType === "transaction" && item.targetLocalId ? transactionIds.get(item.targetLocalId) : undefined;
      await ctx.db.insert("reviewItems", {
        householdId,
        transactionId,
        targetType: item.targetType,
        targetLocalId: item.targetLocalId,
        reason: item.reason,
        title: item.title,
        subtitle: item.subtitle,
        amountCents: item.amountCents,
        action: item.action,
        status: "open",
        createdAt: now,
      });
    }

    for (const rule of args.recurringRules) {
      const accountId = accountIds.get(rule.accountLocalId);
      const categoryId = categoryIds.get(rule.categoryLocalId);
      if (!accountId || !categoryId) continue;

      await ctx.db.insert("recurringRules", {
        householdId,
        localId: rule.localId,
        name: rule.name,
        type: rule.type,
        categoryId,
        accountId,
        amountCents: rule.amountCents,
        currency: rule.currency,
        frequency: rule.frequency,
        nextDate: rule.nextDate,
        merchant: rule.merchant,
        note: rule.note,
        active: rule.active,
      });
    }

    for (const rule of args.automationRules) {
      const categoryId = categoryIds.get(rule.categoryLocalId);
      const accountId = rule.accountLocalId ? accountIds.get(rule.accountLocalId) : undefined;
      if (!categoryId) continue;

      await ctx.db.insert("automationRules", {
        householdId,
        localId: rule.localId,
        name: rule.name,
        matchText: rule.matchText,
        categoryId,
        accountId,
        merchant: rule.merchant,
        subcategory: rule.subcategory,
        tag: rule.tag,
        active: rule.active,
      });
    }

    for (const application of args.ruleApplications) {
      await ctx.db.insert("ruleApplications", {
        householdId,
        localId: application.localId,
        ruleLocalId: application.ruleLocalId,
        ruleName: application.ruleName,
        kind: application.kind,
        transactionLocalId: application.transactionLocalId,
        transactionDescription: application.transactionDescription,
        summary: application.summary,
        status: application.status,
        createdAt: application.createdAt,
      });
    }

    for (const member of args.members) {
      await ctx.db.insert("members", {
        householdId,
        name: member.name,
        role: member.role,
        avatar: member.avatar,
        email: member.email,
      });
    }

    for (const goal of args.goals) {
      const accountId = goal.accountLocalId ? accountIds.get(goal.accountLocalId) : undefined;
      await ctx.db.insert("goals", {
        householdId,
        localId: goal.localId,
        name: goal.name,
        targetCents: goal.targetCents,
        savedCents: goal.savedCents,
        due: goal.due,
        accountId,
        priority: goal.priority,
        archived: goal.archived ?? false,
      });
    }

    for (const debt of args.debts) {
      await ctx.db.insert("debts", {
        householdId,
        ...debt,
        archived: false,
      });
    }

    for (const item of args.netWorth) {
      await ctx.db.insert("netWorthItems", {
        householdId,
        ...item,
        asOfDate: `${args.household.activeMonth}-01`,
      });
    }

    for (const closing of args.monthClosings) {
      await ctx.db.insert("monthClosings", {
        householdId,
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
        closedAt: closing.closedAt,
      });
    }

    return {
      conflict: false as const,
      householdId,
      version: nextVersion,
      accounts: accountIds.size,
      categories: categoryIds.size,
      transactions: args.transactions.length,
    };
  },
});

export const addCategory = mutationGeneric({
  args: {
    householdId: v.id("households"),
    category: v.object(categoryInput),
  },
  handler: async (ctx, { householdId, category }) => {
    const categoryId = await ctx.db.insert("categories", {
      householdId,
      group: category.group,
      name: category.name.trim(),
      subcategories: category.subcategories.map((item) => item.trim()).filter(Boolean),
      source: category.source,
      isSystem: false,
      archived: false,
    });

    await ctx.db.insert("monthlyPlans", {
      householdId,
      month: (await ctx.db.get(householdId))?.activeMonth ?? new Date().toISOString().slice(0, 7),
      categoryId,
      plannedCents: category.plannedCents,
      rolloverCents: 0,
    });

    return categoryId;
  },
});

export const addTransaction = mutationGeneric({
  args: {
    householdId: v.id("households"),
    month: v.string(),
    transaction: v.object(transactionInput),
  },
  handler: async (ctx, { householdId, month, transaction }) => {
    const now = Date.now();

    return await ctx.db.insert("transactions", {
      householdId,
      month,
      ...transaction,
      createdAt: now,
      updatedAt: now,
    });
  },
});

// Permanently delete every row owned by a household (all financial data + members + the
// household doc itself). Mirrors the table set saveSnapshot wipes.
async function wipeHousehold(ctx: any, householdId: any) {
  const collected = await Promise.all([
    ctx.db.query("members").withIndex("by_household", (q: any) => q.eq("householdId", householdId)).collect(),
    ctx.db.query("financialSpaces").withIndex("by_household", (q: any) => q.eq("householdId", householdId)).collect(),
    ctx.db.query("subscriptions").withIndex("by_household", (q: any) => q.eq("householdId", householdId)).collect(),
    ctx.db.query("accounts").withIndex("by_household", (q: any) => q.eq("householdId", householdId)).collect(),
    ctx.db.query("categories").withIndex("by_household", (q: any) => q.eq("householdId", householdId)).collect(),
    ctx.db.query("monthlyPlans").withIndex("by_household_month", (q: any) => q.eq("householdId", householdId)).collect(),
    ctx.db.query("transactions").withIndex("by_household_month", (q: any) => q.eq("householdId", householdId)).collect(),
    ctx.db.query("attachments").withIndex("by_household", (q: any) => q.eq("householdId", householdId)).collect(),
    ctx.db.query("comments").withIndex("by_household", (q: any) => q.eq("householdId", householdId)).collect(),
    ctx.db.query("aiActions").withIndex("by_household_created", (q: any) => q.eq("householdId", householdId)).collect(),
    ctx.db.query("reviewItems").withIndex("by_household_status", (q: any) => q.eq("householdId", householdId)).collect(),
    ctx.db.query("recurringRules").withIndex("by_household_next", (q: any) => q.eq("householdId", householdId)).collect(),
    ctx.db.query("automationRules").withIndex("by_household", (q: any) => q.eq("householdId", householdId)).collect(),
    ctx.db.query("ruleApplications").withIndex("by_household_created", (q: any) => q.eq("householdId", householdId)).collect(),
    ctx.db.query("goals").withIndex("by_household", (q: any) => q.eq("householdId", householdId)).collect(),
    ctx.db.query("debts").withIndex("by_household", (q: any) => q.eq("householdId", householdId)).collect(),
    ctx.db.query("netWorthItems").withIndex("by_household_date", (q: any) => q.eq("householdId", householdId)).collect(),
    ctx.db.query("monthClosings").withIndex("by_household_month", (q: any) => q.eq("householdId", householdId)).collect(),
    ctx.db.query("householdMembers").withIndex("by_household", (q: any) => q.eq("householdId", householdId)).collect(),
  ]);
  const transactions = collected[6];
  const attachments = collected[7];
  const splits = (await Promise.all(transactions.map((transaction: any) =>
    ctx.db.query("transactionSplits").withIndex("by_transaction", (q: any) => q.eq("transactionId", transaction._id)).collect(),
  ))).flat();

  // Free the real _storage blobs BEFORE deleting the attachment rows — otherwise
  // the file pointers are lost and the blobs leak forever. Best-effort per blob
  // (a missing/already-deleted blob must not abort the whole wipe).
  let freedStorageBlobs = 0;
  for (const attachment of attachments as any[]) {
    if (!attachment.storageId) continue;
    try {
      await ctx.storage.delete(attachment.storageId);
      freedStorageBlobs += 1;
    } catch {
      // Blob already gone or invalid id — ignore and continue the wipe.
    }
  }

  await Promise.all([...collected.flat(), ...splits].map((document: any) => ctx.db.delete(document._id)));
  await ctx.db.delete(householdId);
  return freedStorageBlobs;
}

/** Permanently deletes the signed-in user's account: every hogar they own, all their
 *  memberships, and their auth identity (so the email can register again). */
export const deleteAccount = mutationGeneric({
  args: {
    // Explicit destructive-intent guard: the client must echo the literal
    // "DELETE", so a stray/replayed call can never nuke an account by accident.
    confirm: v.literal("DELETE"),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Inicia sesión para borrar tu cuenta.");
    if (args.confirm !== "DELETE") throw new Error("Confirmación inválida.");

    const memberships = await ctx.db
      .query("householdMembers")
      .withIndex("by_user", (q: any) => q.eq("userId", userId))
      .collect();

    const ownedHouseholdIds = new Set<string>();
    for (const membership of memberships) {
      const household = await ctx.db.get(membership.householdId);
      if (household && (household.ownerUserId === userId || membership.role === "owner")) {
        ownedHouseholdIds.add(membership.householdId);
      }
    }
    let freedStorageBlobs = 0;
    for (const householdId of ownedHouseholdIds) {
      // wipeHousehold frees each attachment's _storage blob before deleting rows.
      freedStorageBlobs += (await wipeHousehold(ctx, householdId as any)) ?? 0;
    }

    // Drop any leftover memberships of this user (e.g. invited to someone else's hogar).
    const leftover = await ctx.db
      .query("householdMembers")
      .withIndex("by_user", (q: any) => q.eq("userId", userId))
      .collect();
    await Promise.all(leftover.map((membership: any) => ctx.db.delete(membership._id)));

    // Capture the user's email up front so we can purge auth rate-limit rows
    // (keyed by the email identifier) even after the user doc is gone.
    const userDoc = await ctx.db.get(userId);
    const userEmail = userDoc?.email as string | undefined;

    // Best-effort removal of the full auth identity. authCleanup reports whether
    // EVERY side-table was cleared ("full") or whether something threw and we
    // bailed partway ("partial") — the data wipe above is the essential part and
    // already succeeded by this point, so we never fail the whole mutation here.
    let authCleanup: "full" | "partial" = "full";
    try {
      const sessions = await ctx.db.query("authSessions").filter((q: any) => q.eq(q.field("userId"), userId)).collect();
      for (const session of sessions) {
        const refreshTokens = await ctx.db.query("authRefreshTokens").filter((q: any) => q.eq(q.field("sessionId"), session._id)).collect();
        await Promise.all(refreshTokens.map((token: any) => ctx.db.delete(token._id)));
        // PKCE verifiers are keyed by sessionId — clear them with the session.
        const verifiers = await ctx.db.query("authVerifiers").filter((q: any) => q.eq(q.field("sessionId"), session._id)).collect();
        await Promise.all(verifiers.map((verifier: any) => ctx.db.delete(verifier._id)));
        await ctx.db.delete(session._id);
      }

      const accounts = await ctx.db.query("authAccounts").filter((q: any) => q.eq(q.field("userId"), userId)).collect();
      for (const account of accounts) {
        // OTP / magic-link / OAuth verification codes are keyed by accountId.
        const codes = await ctx.db.query("authVerificationCodes").filter((q: any) => q.eq(q.field("accountId"), account._id)).collect();
        await Promise.all(codes.map((code: any) => ctx.db.delete(code._id)));
        await ctx.db.delete(account._id);
      }

      // Sign-in / OTP rate-limit rows are keyed by the email identifier.
      if (userEmail) {
        const rateLimits = await ctx.db.query("authRateLimits").filter((q: any) => q.eq(q.field("identifier"), userEmail)).collect();
        await Promise.all(rateLimits.map((row: any) => ctx.db.delete(row._id)));
      }
    } catch {
      // Some auth side-table could not be cleared; the account data is gone but
      // a few stray auth rows may remain. Report it honestly to the caller.
      authCleanup = "partial";
    }

    await ctx.db.delete(userId);
    return { ok: true as const, authCleanup, freedStorageBlobs };
  },
});
