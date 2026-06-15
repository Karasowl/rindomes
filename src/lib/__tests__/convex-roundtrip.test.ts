import { describe, expect, it } from "vitest";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import {
  stateFromConvexSnapshot,
  stateSnapshotForConvex,
  type ConvexHouseholdSnapshot,
  type ConvexSnapshotPayload,
} from "@/lib/convex-adapter";
import { seedState } from "@/lib/seed";

// Real backend round-trip. Runs only when a Convex deployment is reachable
// (e.g. `CONVEX_AGENT_MODE=anonymous npx convex dev` running locally), otherwise
// the whole describe block is skipped so the offline/CI suite stays green.
const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "http://127.0.0.1:3210";

async function backendReachable() {
  try {
    const res = await fetch(`${CONVEX_URL}/version`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

const reachable = await backendReachable();

// Auth-first: the backend rejects anonymous callers, so the round-trip needs a real session.
// We sign up a throwaway account (Password provider) and reuse its token. If the deployment
// enforces email verification (OTP), signUp returns no session and we can't auth headlessly —
// the whole block then skips instead of failing.
async function getAuthToken(): Promise<string | null> {
  try {
    const client = new ConvexHttpClient(CONVEX_URL);
    const signIn = makeFunctionReference<"action", { provider: string; params: Record<string, unknown> }, { tokens?: { token?: string } | null }>("auth:signIn");
    const res = await client.action(signIn, {
      provider: "password",
      params: { email: `roundtrip+${Date.now()}@example.com`, password: "test-password-123", flow: "signUp" },
    });
    return res?.tokens?.token ?? null;
  } catch {
    return null;
  }
}

const authToken = reachable ? await getAuthToken() : null;

type SaveResult = {
  conflict: boolean;
  householdId: string;
  version: number;
  accounts: number;
  categories: number;
  transactions: number;
};
const saveSnapshot = makeFunctionReference<"mutation", ConvexSnapshotPayload, SaveResult>("finance:saveSnapshot");
const getHouseholdSnapshot = makeFunctionReference<
  "query",
  { householdId: string },
  ConvexHouseholdSnapshot
>("finance:getHouseholdSnapshot");

describe.skipIf(!reachable || !authToken)("Convex round-trip (real backend)", () => {
  it("persists the seed snapshot and reads it back intact, incl. per-author attribution", async () => {
    const client = new ConvexHttpClient(CONVEX_URL);
    client.setAuth(authToken!);

    // Stamp ONE transaction with a distinct author (not the first member's name) so the
    // assertion below proves attribution truly round-trips per movement, instead of passing
    // by the old members[0] fallback.
    const DISTINCT_AUTHOR = "Esposa (atribucion QA)";
    const stamped = {
      ...seedState,
      transactions: seedState.transactions.map((t, i) => (i === 0 ? { ...t, createdBy: DISTINCT_AUTHOR } : t)),
    };

    const payload = stateSnapshotForConvex(stamped);
    const saved = await client.mutation(saveSnapshot, payload);

    expect(saved.householdId).toBeTruthy();
    expect(saved.transactions).toBe(stamped.transactions.length);
    expect(saved.categories).toBe(stamped.categories.length);
    expect(saved.accounts).toBe(stamped.accounts.length);

    const snapshot = await client.query(getHouseholdSnapshot, { householdId: saved.householdId });
    const restored = stateFromConvexSnapshot(snapshot, stamped);

    expect(restored.transactions.length).toBe(stamped.transactions.length);
    expect(restored.categories.length).toBe(stamped.categories.length);
    expect(restored.accounts.length).toBe(stamped.accounts.length);
    expect(restored.monthlyPlans.length).toBe(stamped.monthlyPlans.length);

    // A real value must survive the full save -> backend -> load -> reconstruct path.
    const rent = restored.transactions.find((t) => t.description === "Renta");
    expect(rent?.amountCents).toBe(950000);

    // "Quién puso qué": the original author survives...
    expect(rent?.createdBy).toBe("Owner");
    // ...AND a distinct author on another movement survives too (so two people's entries stay
    // attributed to each, never collapsed to the first member).
    const byEsposa = restored.transactions.find((t) => t.createdBy === DISTINCT_AUTHOR);
    expect(byEsposa).toBeTruthy();
    expect(byEsposa?.description).toBe("Pago consultorio");
  });

  it("rejects a stale write via optimistic concurrency (no silent overwrite)", async () => {
    const client = new ConvexHttpClient(CONVEX_URL);
    client.setAuth(authToken!);

    // First save provisions the hogar at version 1.
    const first = await client.mutation(saveSnapshot, stateSnapshotForConvex(seedState));
    expect(first.conflict).toBe(false);
    expect(first.version).toBe(1);
    const householdId = first.householdId;

    // A correct save against the current version succeeds and bumps to 2 (simulates device A).
    const second = await client.mutation(saveSnapshot, stateSnapshotForConvex(seedState, householdId, 1));
    expect(second.conflict).toBe(false);
    expect(second.version).toBe(2);

    // Device B still thinks it is on version 1 → its save must be REJECTED, not applied,
    // so device A's data is never silently overwritten.
    const stale = await client.mutation(saveSnapshot, stateSnapshotForConvex(seedState, householdId, 1));
    expect(stale.conflict).toBe(true);
    expect(stale.version).toBe(2); // server reports the real current version so the client can re-hydrate

    // A save with the corrected version goes through again.
    const retry = await client.mutation(saveSnapshot, stateSnapshotForConvex(seedState, householdId, 2));
    expect(retry.conflict).toBe(false);
    expect(retry.version).toBe(3);
  });
});
