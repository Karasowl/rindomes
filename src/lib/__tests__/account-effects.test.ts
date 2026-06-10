import { describe, expect, it } from "vitest";
import { applyAccountEffect } from "@/lib/account-effects";
import { makeAccount, makeTransaction } from "./fixtures";

const accounts = () => [
  makeAccount({ id: "cash", name: "Efectivo", kind: "cash", balanceCents: 100000 }),
  makeAccount({ id: "bank", name: "Banco", kind: "bank", balanceCents: 500000 }),
];

const balanceOf = (list: ReturnType<typeof accounts>, id: string) =>
  list.find((a) => a.id === id)!.balanceCents;

describe("applyAccountEffect — apply (direction = 1)", () => {
  it("an expense decreases the source account", () => {
    const txn = makeTransaction({ type: "expense", date: "2026-05-01", categoryId: "c", amountCents: 30000, accountId: "cash" });
    const result = applyAccountEffect(accounts(), txn, 1);
    expect(balanceOf(result, "cash")).toBe(70000);
    expect(balanceOf(result, "bank")).toBe(500000); // untouched
  });

  it("income increases the source account", () => {
    const txn = makeTransaction({ type: "income", date: "2026-05-01", categoryId: "c", amountCents: 40000, accountId: "bank" });
    expect(balanceOf(applyAccountEffect(accounts(), txn, 1), "bank")).toBe(540000);
  });

  it("a refund increases the source account (money returned)", () => {
    const txn = makeTransaction({ type: "refund", date: "2026-05-01", categoryId: "c", amountCents: 5000, accountId: "cash" });
    expect(balanceOf(applyAccountEffect(accounts(), txn, 1), "cash")).toBe(105000);
  });

  it.each(["debt_payment", "saving", "investment"] as const)("a %s decreases the source account", (type) => {
    const txn = makeTransaction({ type, date: "2026-05-01", categoryId: "c", amountCents: 10000, accountId: "cash" });
    expect(balanceOf(applyAccountEffect(accounts(), txn, 1), "cash")).toBe(90000);
  });

  it("a transfer moves money from source to destination", () => {
    const txn = makeTransaction({ type: "transfer", date: "2026-05-01", categoryId: "c", amountCents: 25000, accountId: "cash", transferAccountId: "bank" });
    const result = applyAccountEffect(accounts(), txn, 1);
    expect(balanceOf(result, "cash")).toBe(75000);
    expect(balanceOf(result, "bank")).toBe(525000);
  });
});

describe("applyAccountEffect — reverse (direction = -1)", () => {
  it("reversing an approved expense restores the balance", () => {
    const txn = makeTransaction({ type: "expense", date: "2026-05-01", categoryId: "c", amountCents: 30000, accountId: "cash", status: "approved" });
    expect(balanceOf(applyAccountEffect(accounts(), txn, -1), "cash")).toBe(130000);
  });

  it("reversing a non-approved movement is a no-op", () => {
    const txn = makeTransaction({ type: "expense", date: "2026-05-01", categoryId: "c", amountCents: 30000, accountId: "cash", status: "needs_review" });
    expect(applyAccountEffect(accounts(), txn, -1)).toEqual(accounts());
  });

  it("apply then reverse returns the exact original balances", () => {
    const txn = makeTransaction({ type: "transfer", date: "2026-05-01", categoryId: "c", amountCents: 25000, accountId: "cash", transferAccountId: "bank", status: "approved" });
    const applied = applyAccountEffect(accounts(), txn, 1);
    const reversed = applyAccountEffect(applied, txn, -1);
    expect(reversed).toEqual(accounts());
  });
});

describe("applyAccountEffect — guards", () => {
  it("adjustment movements never move balances", () => {
    const txn = makeTransaction({ type: "expense", date: "2026-05-01", categoryId: "c", amountCents: 30000, accountId: "cash", status: "adjustment" });
    expect(applyAccountEffect(accounts(), txn, 1)).toEqual(accounts());
  });

  it("an undefined transaction is a no-op", () => {
    expect(applyAccountEffect(accounts(), undefined, 1)).toEqual(accounts());
  });

  it("does not mutate the input array", () => {
    const input = accounts();
    const txn = makeTransaction({ type: "expense", date: "2026-05-01", categoryId: "c", amountCents: 30000, accountId: "cash" });
    applyAccountEffect(input, txn, 1);
    expect(input[0].balanceCents).toBe(100000);
  });
});
