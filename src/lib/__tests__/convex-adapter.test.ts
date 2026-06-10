import { describe, expect, it } from "vitest";
import { stateSnapshotForConvex } from "@/lib/convex-adapter";
import { seedState } from "@/lib/seed";
import { makeCategory, makeState, makeTransaction } from "./fixtures";

describe("stateSnapshotForConvex", () => {
  it("preserves every transaction and keeps its category/account references", () => {
    const snapshot = stateSnapshotForConvex(seedState);
    expect(snapshot.transactions).toHaveLength(seedState.transactions.length);

    const categoryLocalIds = new Set(snapshot.categories.map((c) => c.localId));
    const accountLocalIds = new Set(snapshot.accounts.map((a) => a.localId));
    for (const txn of snapshot.transactions) {
      expect(categoryLocalIds.has(txn.categoryLocalId)).toBe(true);
      expect(accountLocalIds.has(txn.accountLocalId)).toBe(true);
    }
  });

  it("ships the real monthly plans when they exist", () => {
    const snapshot = stateSnapshotForConvex(seedState);
    expect(snapshot.monthlyPlans).toHaveLength(seedState.monthlyPlans.length);
    expect(snapshot.monthlyPlans.every((p) => p.categoryLocalId)).toBe(true);
  });

  it("derives a monthly plan per category when none exist yet", () => {
    const state = makeState({
      activeMonth: "2026-05",
      categories: [
        makeCategory({ id: "food", group: "essentials", name: "Comida", plannedCents: 50000 }),
        makeCategory({ id: "rent", group: "essentials", name: "Renta", plannedCents: 90000 }),
      ],
      monthlyPlans: [],
    });
    const snapshot = stateSnapshotForConvex(state);
    expect(snapshot.monthlyPlans).toHaveLength(2);
    const food = snapshot.monthlyPlans.find((p) => p.categoryLocalId === "food");
    expect(food?.plannedCents).toBe(50000);
    expect(food?.month).toBe("2026-05");
  });

  it("does not lose split lines on a transaction", () => {
    const state = makeState({
      categories: [makeCategory({ id: "food", group: "essentials", name: "Comida" })],
      transactions: [
        makeTransaction({
          type: "expense",
          date: "2026-05-05",
          categoryId: "food",
          amountCents: 10000,
          splits: [
            { id: "s1", categoryId: "food", amountCents: 6000 },
            { id: "s2", categoryId: "food", amountCents: 4000 },
          ],
        }),
      ],
    });
    const snapshot = stateSnapshotForConvex(state);
    expect(snapshot.transactions[0].splits).toHaveLength(2);
  });
});
