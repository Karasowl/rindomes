import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { assertCanAccess, assertOwner } from "./finance";

// ============================================================================
// Server-authoritative entitlement. This module is the ONLY legitimate writer
// of the `pro` plan. The client's snapshot plan is advisory and ignored by
// saveSnapshot; the real source of truth is the `subscriptions` row.
// ============================================================================

// Mirrors EntitlementView in src/lib/entitlement.ts (the lib group owns that
// type; this query returns the same structural shape).
export type EntitlementView = {
  plan: "free" | "pro";
  aiEnabled: boolean;
  canUseAi: boolean;
  aiCreditsUsed: number;
  aiCreditsLimit: number;
  proSource: "stub_checkout" | "manual_grant" | "none";
  proGrantedAt: number | null;
};

// Free-tier credit ceiling used when a household has no subscriptions row yet
// (demo households). Matches createHousehold's default aiCreditsLimit.
const DEFAULT_FREE_CREDITS_LIMIT = 25;

async function readSubscription(ctx: any, householdId: Id<"households">) {
  return await ctx.db
    .query("subscriptions")
    .withIndex("by_household", (q: any) => q.eq("householdId", householdId))
    .first();
}

/**
 * Returns the household's entitlement view. Defaults to plan='free' and
 * proSource='none' when there is no subscriptions row, so demo households are
 * safe (they never accidentally read as pro). `aiEnabled` reflects the
 * household's own AI preference; `canUseAi` is strictly plan === 'pro'.
 */
export const getEntitlement = query({
  args: { householdId: v.id("households") },
  handler: async (ctx, { householdId }): Promise<EntitlementView> => {
    const userId = await getAuthUserId(ctx);
    await assertCanAccess(ctx, householdId, userId);

    const household = await ctx.db.get(householdId);
    const subscription = await readSubscription(ctx, householdId);

    // Plan is server-authoritative: read it from the subscriptions row, never
    // from the household.subscriptionPlan mirror (which the client can dirty).
    const plan: "free" | "pro" = subscription?.plan === "pro" ? "pro" : "free";
    const aiEnabled = household?.aiEnabled ?? false;
    const aiCreditsUsed = subscription?.aiCreditsUsed ?? 0;
    const aiCreditsLimit = subscription?.aiCreditsLimit ?? DEFAULT_FREE_CREDITS_LIMIT;
    const proSource: EntitlementView["proSource"] = subscription?.proSource ?? "none";
    const proGrantedAt = subscription?.proGrantedAt ?? null;

    return {
      plan,
      aiEnabled,
      canUseAi: plan === "pro",
      aiCreditsUsed,
      aiCreditsLimit,
      proSource,
      proGrantedAt,
    };
  },
});

export type RequireEntitlementResult = {
  plan: "free" | "pro";
  canUseAi: boolean;
  aiCreditsUsed: number;
  aiCreditsLimit: number;
};

/**
 * Internal helper used by the AI action's gate. Throws a structured error
 * ({ code: 'not_entitled' } when not pro, { code: 'no_credits' } when the AI
 * credit allowance is exhausted) so callers can map to AiCaptureResult codes.
 * Not a Convex function — a plain async helper meant to run inside a query or
 * mutation ctx.
 */
export async function requireEntitlement(
  ctx: any,
  householdId: Id<"households">,
  userId: Id<"users"> | null,
): Promise<RequireEntitlementResult> {
  await assertCanAccess(ctx, householdId, userId);
  const subscription = await readSubscription(ctx, householdId);
  const plan: "free" | "pro" = subscription?.plan === "pro" ? "pro" : "free";
  if (plan !== "pro") {
    throw { code: "not_entitled" as const };
  }
  const aiCreditsUsed = subscription?.aiCreditsUsed ?? 0;
  const aiCreditsLimit = subscription?.aiCreditsLimit ?? DEFAULT_FREE_CREDITS_LIMIT;
  if (aiCreditsUsed >= aiCreditsLimit) {
    throw { code: "no_credits" as const };
  }
  return { plan, canUseAi: true, aiCreditsUsed, aiCreditsLimit };
}

/**
 * HONEST checkout stub. Real billing (Stripe/LemonSqueezy) is not wired yet, so
 * this NEVER reports a fake success. It returns the seam a future checkout
 * integration will replace, plus a Spanish message the paywall surfaces. The
 * only function that may actually grant pro is setHouseholdPlan below (which a
 * future Stripe webhook will call).
 */
export const startProUpgrade = mutation({
  args: { householdId: v.id("households") },
  handler: async (
    ctx,
    { householdId },
  ): Promise<{
    status: "checkout_not_configured";
    seam: "stripe";
    message: string;
  }> => {
    const userId = await getAuthUserId(ctx);
    // Even the stub asserts access so it can't be probed for arbitrary households.
    await assertCanAccess(ctx, householdId, userId);
    return {
      status: "checkout_not_configured",
      seam: "stripe",
      message:
        "El pago aún no está disponible. Estamos terminando de configurar la suscripción Pro; mientras tanto puedes seguir usando RindoMes en modo manual sin límites.",
    };
  },
});

/**
 * The ONLY legitimate writer of the pro plan. Guarded by assertOwner AND the
 * RINDOMES_ALLOW_TEST_GRANTS env flag, so it cannot be used to self-grant pro in
 * a normal deployment. This is EXACTLY the seam a future Stripe webhook will
 * call: it sets subscriptions.plan, proSource='manual_grant', proGrantedAt=now,
 * and mirrors households.subscriptionPlan so the rest of the app stays
 * consistent. Setting plan='free' here also clears proSource/proGrantedAt.
 */
export const setHouseholdPlan = mutation({
  args: {
    householdId: v.id("households"),
    plan: v.union(v.literal("free"), v.literal("pro")),
  },
  handler: async (
    ctx,
    { householdId, plan },
  ): Promise<{ ok: true; plan: "free" | "pro" }> => {
    const userId = await getAuthUserId(ctx);
    await assertOwner(ctx, householdId, userId);

    if (!process.env.RINDOMES_ALLOW_TEST_GRANTS) {
      throw new Error(
        "Los cambios de plan manuales están deshabilitados en este entorno.",
      );
    }

    const now = Date.now();
    const subscription = await readSubscription(ctx, householdId);

    if (subscription) {
      await ctx.db.patch(subscription._id, {
        plan,
        proSource: plan === "pro" ? ("manual_grant" as const) : ("none" as const),
        proGrantedAt: plan === "pro" ? now : undefined,
        updatedAt: now,
      });
    } else {
      // No row yet (demo household): create one with the granted plan and the
      // same default limits createHousehold uses for free.
      await ctx.db.insert("subscriptions", {
        householdId,
        plan,
        aiCreditsUsed: 0,
        aiCreditsLimit: DEFAULT_FREE_CREDITS_LIMIT,
        storageMbUsed: 0,
        storageMbLimit: 100,
        spacesLimit: 2,
        membersLimit: 2,
        updatedAt: now,
        proSource: plan === "pro" ? ("manual_grant" as const) : ("none" as const),
        proGrantedAt: plan === "pro" ? now : undefined,
      });
    }

    // Mirror onto the household doc so any reader of household.subscriptionPlan
    // (and the snapshot re-derivation in finance.ts) sees the same value.
    await ctx.db.patch(householdId, {
      subscriptionPlan: plan,
      updatedAt: now,
    });

    return { ok: true, plan };
  },
});

// ============================================================================
// Internal DB helpers for the AI capture action (convex/ai.ts).
//
// The AI action is a "use node" module, and Convex only allows ACTIONS in Node
// runtime files — queries/mutations must live in a default-runtime module. So
// the action's read (captureContext) and its atomic credit-bump (commitAiCapture)
// live here and are invoked via ctx.runQuery(internal.entitlement.captureContext)
// / ctx.runMutation(internal.entitlement.commitAiCapture).
// ============================================================================

/** Reads the attachment + the household's category/account catalogs the AI prompt
 *  needs (so categoryId/accountId become strict enums Claude cannot escape). */
export const captureContext = internalQuery({
  args: { householdId: v.id("households"), attachmentId: v.id("attachments") },
  handler: async (ctx, { householdId, attachmentId }) => {
    const attachment = await ctx.db.get(attachmentId);
    if (!attachment || attachment.householdId !== householdId) {
      return null;
    }
    const [categories, accounts] = await Promise.all([
      ctx.db
        .query("categories")
        .withIndex("by_household", (q) => q.eq("householdId", householdId))
        .collect(),
      ctx.db
        .query("accounts")
        .withIndex("by_household", (q) => q.eq("householdId", householdId))
        .collect(),
    ]);
    return {
      storageId: (attachment.storageId ?? null) as string | null,
      contentType: attachment.contentType,
      fileName: attachment.fileName,
      extractedText: (attachment.extractedText ?? null) as string | null,
      categories: categories
        .filter((c) => !c.archived)
        .map((c) => ({ id: c._id as string, name: c.name, group: c.group })),
      accounts: accounts
        .filter((a) => !a.archived)
        .map((a) => ({ id: a._id as string, name: a.name, kind: a.kind })),
    };
  },
});

/** Atomically bumps the AI credit counter and records an aiActions row. Re-checks
 *  credits inside the transaction so concurrent captures can't overrun the limit.
 *  Returns false if no credit was available. */
export const commitAiCapture = internalMutation({
  args: {
    householdId: v.id("households"),
    inputPreview: v.string(),
    outputSummary: v.string(),
  },
  handler: async (ctx, { householdId, inputPreview, outputSummary }): Promise<boolean> => {
    const now = Date.now();
    const subscription = await readSubscription(ctx, householdId);

    const used = subscription?.aiCreditsUsed ?? 0;
    const limit = subscription?.aiCreditsLimit ?? DEFAULT_FREE_CREDITS_LIMIT;
    if (used >= limit) return false;

    if (subscription) {
      await ctx.db.patch(subscription._id, {
        aiCreditsUsed: used + 1,
        updatedAt: now,
      });
    }

    await ctx.db.insert("aiActions", {
      householdId,
      kind: "receipt_parse",
      // Server vision capture runs through OpenRouter; record it honestly.
      provider: "openrouter",
      status: "accepted",
      inputPreview: inputPreview.slice(0, 200),
      outputSummary: outputSummary.slice(0, 200),
      creditsUsed: 1,
      createdAt: now,
    });
    return true;
  },
});

// ============================================================================
// One-time safety migration (run once after deploying the entitlement fix).
//
// Before the server-authoritative plan fix, the old client-trusting saveSnapshot
// let any client write plan='pro'. This forces every household back to 'free'
// UNLESS its subscription row carries a legitimate proSource ('manual_grant' or
// 'stub_checkout'). Since proSource is brand new, in practice this clears every
// unearned 'pro' flag. It is idempotent — re-running only normalizes leftovers.
//
//   npx convex run entitlement:normalizeProPlans --prod
// ============================================================================
export const normalizeProPlans = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const legit = (s: { proSource?: string } | null | undefined) =>
      s?.proSource === "manual_grant" || s?.proSource === "stub_checkout";

    const subs = await ctx.db.query("subscriptions").collect();
    let subsNormalized = 0;
    for (const sub of subs) {
      if (sub.plan === "pro" && !legit(sub)) {
        await ctx.db.patch(sub._id, {
          plan: "free",
          proSource: "none",
          proGrantedAt: undefined,
          updatedAt: now,
        });
        subsNormalized++;
      }
    }

    // Also fix any household mirror that reads 'pro' without a legitimate row.
    const households = await ctx.db.query("households").collect();
    let mirrorsNormalized = 0;
    for (const h of households) {
      if (h.subscriptionPlan === "pro") {
        const sub = await readSubscription(ctx, h._id);
        if (!(sub?.plan === "pro" && legit(sub))) {
          await ctx.db.patch(h._id, { subscriptionPlan: "free", updatedAt: now });
          mirrorsNormalized++;
        }
      }
    }

    return {
      subsNormalized,
      mirrorsNormalized,
      totalSubscriptions: subs.length,
      totalHouseholds: households.length,
    };
  },
});

// ============================================================================
// TEST-ONLY pro grant. Env-gated by RINDOMES_ALLOW_TEST_GRANTS so it can only run
// where you explicitly enabled manual grants. Grants plan='pro' (proSource
// 'manual_grant') to the household(s) OWNED by `email`, or to ALL households when
// no email is given. Resets AI credits and ensures a usable limit so the AI path
// can be exercised. Run after the real keys are in:
//   npx convex run entitlement:grantTestPro '{"email":"tu@correo.com"}' --prod
// This is NOT a billing path — real pro will come from a Stripe webhook calling
// setHouseholdPlan. It exists purely to smoke-test the gated AI capture.
// ============================================================================
export const grantTestPro = internalMutation({
  args: { email: v.optional(v.string()) },
  handler: async (ctx, { email }) => {
    if (!process.env.RINDOMES_ALLOW_TEST_GRANTS) {
      throw new Error("RINDOMES_ALLOW_TEST_GRANTS no está habilitado en este entorno.");
    }
    const now = Date.now();

    let householdIds: Id<"households">[];
    if (email) {
      const target = email.trim().toLowerCase();
      const members = await ctx.db.query("householdMembers").collect();
      householdIds = [
        ...new Set(
          members
            .filter((m: any) => String(m.email ?? "").toLowerCase() === target && m.role === "owner")
            .map((m: any) => m.householdId as Id<"households">),
        ),
      ];
    } else {
      const households = await ctx.db.query("households").collect();
      householdIds = households.map((h) => h._id);
    }

    let granted = 0;
    for (const householdId of householdIds) {
      const subscription = await readSubscription(ctx, householdId);
      if (subscription) {
        await ctx.db.patch(subscription._id, {
          plan: "pro",
          proSource: "manual_grant",
          proGrantedAt: now,
          aiCreditsUsed: 0,
          aiCreditsLimit: Math.max(subscription.aiCreditsLimit ?? 0, 200),
          updatedAt: now,
        });
      } else {
        await ctx.db.insert("subscriptions", {
          householdId,
          plan: "pro",
          aiCreditsUsed: 0,
          aiCreditsLimit: 200,
          storageMbUsed: 0,
          storageMbLimit: 100,
          spacesLimit: 2,
          membersLimit: 2,
          updatedAt: now,
          proSource: "manual_grant",
          proGrantedAt: now,
        });
      }
      // Also turn AI ON for the household so the gated capture actually runs for testing.
      await ctx.db.patch(householdId, { subscriptionPlan: "pro", aiEnabled: true, updatedAt: now });
      granted++;
    }

    return { granted, householdIds };
  },
});
