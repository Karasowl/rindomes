import { describe, expect, it } from "vitest";
import {
  annualRows,
  categoryActualCents,
  categoryUsage,
  plannedCentsFor,
  summarize,
  transactionsForMonth,
} from "@/lib/finance";
import { makeCategory, makePlan, makeState, makeTransaction } from "./fixtures";

const categories = [
  makeCategory({ id: "salary", group: "income", name: "Salario", plannedCents: 100000 }),
  makeCategory({ id: "food", group: "essentials", name: "Comida", plannedCents: 50000 }),
  makeCategory({ id: "transport", group: "essentials", name: "Transporte", plannedCents: 30000 }),
  makeCategory({ id: "savings", group: "savings", name: "Ahorro", plannedCents: 20000 }),
];

describe("transactionsForMonth", () => {
  it("only returns transactions whose date falls in the given month", () => {
    const state = makeState({
      transactions: [
        makeTransaction({ type: "expense", date: "2026-05-03", categoryId: "food", amountCents: 1000 }),
        makeTransaction({ type: "expense", date: "2026-04-30", categoryId: "food", amountCents: 9999 }),
        makeTransaction({ type: "expense", date: "2026-06-01", categoryId: "food", amountCents: 8888 }),
      ],
    });
    const may = transactionsForMonth(state, "2026-05");
    expect(may).toHaveLength(1);
    expect(may[0].amountCents).toBe(1000);
  });
});

describe("summarize", () => {
  it("counts only approved income in the active month", () => {
    const state = makeState({
      categories,
      transactions: [
        makeTransaction({ type: "income", date: "2026-05-02", categoryId: "salary", amountCents: 100000 }),
        makeTransaction({ type: "income", date: "2026-05-09", categoryId: "salary", amountCents: 5000, status: "needs_review" }),
        makeTransaction({ type: "income", date: "2026-04-02", categoryId: "salary", amountCents: 99999 }),
      ],
    });
    expect(summarize(state).income).toBe(100000);
  });

  it("excludes transfers from income and outflow", () => {
    const state = makeState({
      categories,
      transactions: [
        makeTransaction({ type: "income", date: "2026-05-02", categoryId: "salary", amountCents: 100000 }),
        makeTransaction({ type: "transfer", date: "2026-05-04", categoryId: "food", amountCents: 25000, accountId: "a", transferAccountId: "b" }),
      ],
    });
    const result = summarize(state);
    expect(result.income).toBe(100000);
    expect(result.outflow).toBe(0);
  });

  it("treats refunds as a reduction of the original category spend, not income", () => {
    const state = makeState({
      categories,
      transactions: [
        makeTransaction({ type: "income", date: "2026-05-02", categoryId: "salary", amountCents: 100000 }),
        makeTransaction({ type: "expense", date: "2026-05-05", categoryId: "food", amountCents: 30000 }),
        makeTransaction({ type: "refund", date: "2026-05-06", categoryId: "food", amountCents: 5000 }),
      ],
    });
    const result = summarize(state);
    expect(result.income).toBe(100000);
    // 30000 spent - 5000 refunded = 25000 net outflow on food
    expect(result.outflow).toBe(25000);
    expect(result.remainder).toBe(75000);
  });

  it("computes savings rate from savings+investment actuals over income", () => {
    const state = makeState({
      categories,
      transactions: [
        makeTransaction({ type: "income", date: "2026-05-02", categoryId: "salary", amountCents: 100000 }),
        makeTransaction({ type: "saving", date: "2026-05-05", categoryId: "savings", amountCents: 20000 }),
      ],
    });
    expect(summarize(state).savingsRate).toBeCloseTo(0.2, 5);
  });
});

describe("categoryActuals", () => {
  it("splits a mixed receipt across its split categories", () => {
    const state = makeState({
      categories,
      transactions: [
        makeTransaction({
          type: "expense",
          date: "2026-05-05",
          categoryId: "food",
          amountCents: 10000,
          splits: [
            { id: "s1", categoryId: "food", amountCents: 6000 },
            { id: "s2", categoryId: "transport", amountCents: 4000 },
          ],
        }),
      ],
    });
    expect(categoryActualCents(state, "2026-05", "food")).toBe(6000);
    expect(categoryActualCents(state, "2026-05", "transport")).toBe(4000);
  });

  it("assigns the unsplit remainder back to the parent category", () => {
    const state = makeState({
      categories,
      transactions: [
        makeTransaction({
          type: "expense",
          date: "2026-05-05",
          categoryId: "food",
          amountCents: 10000,
          splits: [{ id: "s1", categoryId: "transport", amountCents: 4000 }],
        }),
      ],
    });
    expect(categoryActualCents(state, "2026-05", "transport")).toBe(4000);
    expect(categoryActualCents(state, "2026-05", "food")).toBe(6000);
  });

  it("ignores non-approved transactions", () => {
    const state = makeState({
      categories,
      transactions: [
        makeTransaction({ type: "expense", date: "2026-05-05", categoryId: "food", amountCents: 10000, status: "needs_review" }),
      ],
    });
    expect(categoryActualCents(state, "2026-05", "food")).toBe(0);
  });
});

describe("plannedCentsFor", () => {
  it("uses the active-month plan when present", () => {
    const state = makeState({
      categories,
      monthlyPlans: [makePlan("2026-05", "food", 70000)],
    });
    expect(plannedCentsFor(state, "food")).toBe(70000);
  });

  it("falls back to the category base plan when the month has no plan", () => {
    const state = makeState({ categories, monthlyPlans: [makePlan("2026-05", "food", 70000)] });
    expect(plannedCentsFor(state, "food", "2026-07")).toBe(50000);
  });

  it("does not bleed one month's plan into another", () => {
    const state = makeState({
      categories,
      activeMonth: "2026-06",
      monthlyPlans: [makePlan("2026-05", "food", 70000), makePlan("2026-06", "food", 90000)],
    });
    expect(plannedCentsFor(state, "food")).toBe(90000);
  });
});

describe("categoryUsage", () => {
  it("reports spent, remaining and ratio per non-income category", () => {
    const state = makeState({
      categories,
      monthlyPlans: [makePlan("2026-05", "food", 50000)],
      transactions: [
        makeTransaction({ type: "expense", date: "2026-05-05", categoryId: "food", amountCents: 40000 }),
      ],
    });
    const food = categoryUsage(state).find((c) => c.id === "food");
    expect(food).toBeDefined();
    expect(food!.spent).toBe(40000);
    expect(food!.remaining).toBe(10000);
    expect(food!.ratio).toBeCloseTo(0.8, 5);
  });

  it("excludes archived categories", () => {
    const state = makeState({
      categories: [...categories, makeCategory({ id: "old", group: "discretionary", name: "Vieja", archived: true })],
    });
    expect(categoryUsage(state).some((c) => c.id === "old")).toBe(false);
  });
});

describe("annualRows", () => {
  it("produces 12 rows and lands month data on the right index", () => {
    const state = makeState({
      categories,
      transactions: [
        makeTransaction({ type: "income", date: "2026-03-02", categoryId: "salary", amountCents: 80000 }),
        makeTransaction({ type: "expense", date: "2026-03-10", categoryId: "food", amountCents: 30000 }),
      ],
    });
    const rows = annualRows(state, "2026");
    expect(rows).toHaveLength(12);
    const march = rows[2];
    expect(march.month).toBe("2026-03");
    expect(march.income).toBe(80000);
    expect(march.outflow).toBe(30000);
    expect(march.remainder).toBe(50000);
  });
});
