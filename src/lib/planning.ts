import { plannedCentsFor } from "./finance";
import type { AppState } from "./types";

export function monthlyPlanId(month: string, categoryId: string) {
  return `plan-${month}-${categoryId}`;
}

export function monthlyPlansFromCategories(categories: AppState["categories"], month: string): AppState["monthlyPlans"] {
  return categories.map((category) => ({
    id: monthlyPlanId(month, category.id),
    month,
    categoryId: category.id,
    plannedCents: category.plannedCents,
    rolloverCents: 0,
  }));
}

/** Sets (or replaces) the planned budget for a category in a specific month. */
export function withMonthlyCategoryPlan(state: AppState, categoryId: string, plannedCents: number, month = state.activeMonth): AppState {
  const existing = state.monthlyPlans.find((plan) => plan.month === month && plan.categoryId === categoryId);
  const monthlyPlan = {
    id: existing?.id ?? monthlyPlanId(month, categoryId),
    month,
    categoryId,
    plannedCents,
    rolloverCents: existing?.rolloverCents ?? 0,
    notes: existing?.notes,
  };

  return {
    ...state,
    monthlyPlans: existing
      ? state.monthlyPlans.map((plan) => (plan.id === existing.id ? monthlyPlan : plan))
      : [...state.monthlyPlans, monthlyPlan],
  };
}

/**
 * Moves every plan line from one category into another (used when merging categories).
 * Order-independent: a source line is summed into the target's plan for that month
 * whether the target line appears before or after the source line in the array, so a
 * merge never leaves two plan lines for the same category in the same month.
 */
export function mergeMonthlyPlans(monthlyPlans: AppState["monthlyPlans"], fromCategoryId: string, toCategoryId: string): AppState["monthlyPlans"] {
  const result: AppState["monthlyPlans"] = [];
  const targetIndexByMonth = new Map<string, number>();

  // First pass: keep every non-source plan and remember where each target line lives.
  for (const plan of monthlyPlans) {
    if (plan.categoryId === fromCategoryId) continue;
    const index = result.push(plan) - 1;
    if (plan.categoryId === toCategoryId) targetIndexByMonth.set(plan.month, index);
  }

  // Second pass: fold each source line into the target for its month (sum or re-point).
  for (const plan of monthlyPlans) {
    if (plan.categoryId !== fromCategoryId) continue;
    const targetIndex = targetIndexByMonth.get(plan.month);
    if (targetIndex != null) {
      const target = result[targetIndex];
      result[targetIndex] = { ...target, plannedCents: target.plannedCents + plan.plannedCents };
    } else {
      const moved = { ...plan, id: monthlyPlanId(plan.month, toCategoryId), categoryId: toCategoryId };
      targetIndexByMonth.set(plan.month, result.push(moved) - 1);
    }
  }

  return result;
}

/**
 * Clones the active plan into `month` (e.g. when preparing/closing the next month),
 * applying any suggested adjustments from the month close. Idempotent: if the target
 * month already has plans it leaves state untouched so reopening a month never
 * duplicates or overwrites its budget.
 */
export function prepareMonthlyPlansForMonth(
  state: AppState,
  month: string,
  suggestedAdjustments: NonNullable<AppState["monthClosings"][number]["suggestedAdjustments"]> = [],
): AppState {
  if (state.monthlyPlans.some((plan) => plan.month === month)) return state;
  const adjustmentByCategory = new Map(suggestedAdjustments.map((adjustment) => [adjustment.categoryId, adjustment.suggestedPlannedCents]));
  const plans = state.categories
    .filter((category) => !category.archived)
    .map((category) => ({
      id: monthlyPlanId(month, category.id),
      month,
      categoryId: category.id,
      plannedCents: adjustmentByCategory.get(category.id) ?? plannedCentsFor(state, category.id),
      rolloverCents: 0,
    }));

  return {
    ...state,
    monthlyPlans: [...state.monthlyPlans, ...plans],
  };
}
