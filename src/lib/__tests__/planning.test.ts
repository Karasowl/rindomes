import { describe, expect, it } from "vitest";
import {
  mergeMonthlyPlans,
  monthlyPlansFromCategories,
  prepareMonthlyPlansForMonth,
  withMonthlyCategoryPlan,
} from "@/lib/planning";
import { plannedCentsFor } from "@/lib/finance";
import { makeCategory, makePlan, makeState } from "./fixtures";

const categories = [
  makeCategory({ id: "food", group: "essentials", name: "Comida", plannedCents: 50000 }),
  makeCategory({ id: "rent", group: "essentials", name: "Renta", plannedCents: 90000 }),
];

describe("monthlyPlansFromCategories", () => {
  it("creates one plan per category for the month", () => {
    const plans = monthlyPlansFromCategories(categories, "2026-05");
    expect(plans).toHaveLength(2);
    expect(plans.every((p) => p.month === "2026-05")).toBe(true);
    expect(plans.find((p) => p.categoryId === "food")?.plannedCents).toBe(50000);
  });
});

describe("withMonthlyCategoryPlan", () => {
  it("adds a plan line when the month has none for that category", () => {
    const state = makeState({ activeMonth: "2026-05", categories });
    const next = withMonthlyCategoryPlan(state, "food", 60000);
    expect(plannedCentsFor(next, "food")).toBe(60000);
  });

  it("replaces the existing plan line instead of duplicating it", () => {
    const state = makeState({
      activeMonth: "2026-05",
      categories,
      monthlyPlans: [makePlan("2026-05", "food", 50000)],
    });
    const next = withMonthlyCategoryPlan(state, "food", 75000);
    const foodPlans = next.monthlyPlans.filter((p) => p.month === "2026-05" && p.categoryId === "food");
    expect(foodPlans).toHaveLength(1);
    expect(foodPlans[0].plannedCents).toBe(75000);
  });

  it("does not touch another month's plan for the same category", () => {
    const state = makeState({
      activeMonth: "2026-06",
      categories,
      monthlyPlans: [makePlan("2026-05", "food", 50000)],
    });
    const next = withMonthlyCategoryPlan(state, "food", 80000);
    expect(plannedCentsFor(next, "food", "2026-05")).toBe(50000);
    expect(plannedCentsFor(next, "food", "2026-06")).toBe(80000);
  });
});

describe("mergeMonthlyPlans", () => {
  it("re-points a plan line to the target category when the target has none", () => {
    const plans = [makePlan("2026-05", "food", 50000)];
    const merged = mergeMonthlyPlans(plans, "food", "rent");
    expect(merged).toHaveLength(1);
    expect(merged[0].categoryId).toBe("rent");
    expect(merged[0].plannedCents).toBe(50000);
  });

  it("sums budgets when the target already has a plan that month", () => {
    const plans = [makePlan("2026-05", "food", 50000), makePlan("2026-05", "rent", 90000)];
    const merged = mergeMonthlyPlans(plans, "food", "rent");
    expect(merged.filter((p) => p.categoryId === "rent")).toHaveLength(1);
    expect(merged.find((p) => p.categoryId === "rent")?.plannedCents).toBe(140000);
    expect(merged.some((p) => p.categoryId === "food")).toBe(false);
  });
});

describe("prepareMonthlyPlansForMonth", () => {
  const baseState = () =>
    makeState({
      activeMonth: "2026-05",
      categories,
      monthlyPlans: [makePlan("2026-05", "food", 50000), makePlan("2026-05", "rent", 90000)],
    });

  it("clones the current plan into the next month", () => {
    const next = prepareMonthlyPlansForMonth(baseState(), "2026-06");
    expect(plannedCentsFor(next, "food", "2026-06")).toBe(50000);
    expect(plannedCentsFor(next, "rent", "2026-06")).toBe(90000);
  });

  it("applies suggested adjustments to the cloned plan", () => {
    const next = prepareMonthlyPlansForMonth(baseState(), "2026-06", [
      { categoryId: "food", name: "Comida", currentPlannedCents: 50000, suggestedPlannedCents: 65000, reason: "Te pasaste 2 meses seguidos." },
    ]);
    expect(plannedCentsFor(next, "food", "2026-06")).toBe(65000);
    expect(plannedCentsFor(next, "rent", "2026-06")).toBe(90000);
  });

  it("is idempotent: re-preparing a month that already has plans is a no-op", () => {
    const once = prepareMonthlyPlansForMonth(baseState(), "2026-06");
    const twice = prepareMonthlyPlansForMonth(once, "2026-06");
    expect(twice.monthlyPlans.filter((p) => p.month === "2026-06")).toHaveLength(2);
    expect(twice).toBe(once); // returns the same reference, no new state
  });

  it("excludes archived categories from the new month", () => {
    const state = makeState({
      activeMonth: "2026-05",
      categories: [...categories, makeCategory({ id: "old", group: "discretionary", name: "Vieja", plannedCents: 10000, archived: true })],
      monthlyPlans: [makePlan("2026-05", "food", 50000)],
    });
    const next = prepareMonthlyPlansForMonth(state, "2026-06");
    expect(next.monthlyPlans.some((p) => p.month === "2026-06" && p.categoryId === "old")).toBe(false);
  });
});
