import { describe, expect, it } from "vitest";
import { buildOnboardingState, type OnboardingInput } from "@/lib/onboarding";
import { plannedCentsFor, summarize } from "@/lib/finance";

const baseInput: OnboardingInput = {
  ownerName: "Usuario",
  householdName: "Mi Hogar",
  currency: "DOP",
  activeMonth: "2026-06",
  mode: "monthly-plan",
  accounts: [
    { name: "Efectivo", kind: "cash", balanceCents: 500000 },
    { name: "Banco", kind: "bank", balanceCents: 1200000 },
  ],
  incomeCents: 350000,
  otherIncomeCents: 50000,
  fixedExpenses: [
    { name: "Renta", amountCents: 120000 },
    { name: "Servicios", amountCents: 30000 },
  ],
};

describe("buildOnboardingState", () => {
  it("produces a usable AppState with the chosen mode, household and month", () => {
    const state = buildOnboardingState(baseInput);
    expect(state.mode).toBe("monthly-plan");
    expect(state.householdName).toBe("Mi Hogar");
    expect(state.activeMonth).toBe("2026-06");
    expect(state.user.name).toBe("Usuario");
    expect(state.transactions).toHaveLength(0); // a fresh real household, no demo data
  });

  it("creates the accounts and marks the first as the default for capture", () => {
    const state = buildOnboardingState(baseInput);
    expect(state.accounts).toHaveLength(2);
    expect(state.accounts[0].defaultForCapture).toBe(true);
    expect(state.accounts[1].defaultForCapture).toBeFalsy();
    expect(state.accounts[0].balanceCents).toBe(500000);
  });

  it("plans income as the total of salary + other income", () => {
    const state = buildOnboardingState(baseInput);
    const incomeCategory = state.categories.find((c) => c.group === "income");
    expect(incomeCategory).toBeDefined();
    expect(plannedCentsFor(state, incomeCategory!.id)).toBe(400000); // 350000 + 50000
  });

  it("turns each fixed expense into a planned essentials category", () => {
    const state = buildOnboardingState(baseInput);
    const renta = state.categories.find((c) => c.name === "Renta");
    const servicios = state.categories.find((c) => c.name === "Servicios");
    expect(renta?.group).toBe("essentials");
    expect(plannedCentsFor(state, renta!.id)).toBe(120000);
    expect(plannedCentsFor(state, servicios!.id)).toBe(30000);
  });

  it("yields a remanente disponible of income minus fixed expenses via summarize", () => {
    const state = buildOnboardingState(baseInput);
    const summary = summarize(state);
    // plannedIncome 400000, plannedOutflow = fixed 150000 (+ variable 0) => assignable 250000
    expect(summary.plannedIncome).toBe(400000);
    expect(summary.plannedOutflow).toBe(150000);
    expect(summary.assignable).toBe(250000);
  });

  it("falls back to a cash account and sensible names when given minimal input", () => {
    const state = buildOnboardingState({ ...baseInput, accounts: [], householdName: "", ownerName: "" });
    expect(state.accounts).toHaveLength(1);
    expect(state.accounts[0].kind).toBe("cash");
    expect(state.householdName.length).toBeGreaterThan(0);
    expect(state.user.name.length).toBeGreaterThan(0);
  });
});
