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

describe.skipIf(!reachable)("Convex round-trip (real backend)", () => {
  it("persists the seed snapshot and reads it back intact", async () => {
    const client = new ConvexHttpClient(CONVEX_URL);

    const payload = stateSnapshotForConvex(seedState);
    const saved = await client.mutation(saveSnapshot, payload);

    expect(saved.householdId).toBeTruthy();
    expect(saved.transactions).toBe(seedState.transactions.length);
    expect(saved.categories).toBe(seedState.categories.length);
    expect(saved.accounts).toBe(seedState.accounts.length);

    const snapshot = await client.query(getHouseholdSnapshot, { householdId: saved.householdId });
    const restored = stateFromConvexSnapshot(snapshot, seedState);

    expect(restored.transactions.length).toBe(seedState.transactions.length);
    expect(restored.categories.length).toBe(seedState.categories.length);
    expect(restored.accounts.length).toBe(seedState.accounts.length);
    expect(restored.monthlyPlans.length).toBe(seedState.monthlyPlans.length);

    // A real value must survive the full save -> backend -> load -> reconstruct path.
    const rent = restored.transactions.find((t) => t.description === "Renta arboleda");
    expect(rent?.amountCents).toBe(950000);
  });

  it("rejects a stale write via optimistic concurrency (no silent overwrite)", async () => {
    const client = new ConvexHttpClient(CONVEX_URL);

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
