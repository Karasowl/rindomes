import { describe, expect, it } from "vitest";
import { suggestFromNaturalText } from "@/lib/natural-capture";
import { makeAccount, makeCategory, makeState } from "./fixtures";

const baseCategories = [
  makeCategory({ id: "salary", group: "income", name: "Salario", subcategories: ["Consultorio"] }),
  makeCategory({ id: "health", group: "essentials", name: "Salud", subcategories: ["Farmacia", "Medico"] }),
  makeCategory({ id: "home", group: "essentials", name: "Hogar", subcategories: ["Ferreteria"] }),
  makeCategory({ id: "debt", group: "debt", name: "Deudas", subcategories: ["Tarjeta", "Prestamo"] }),
  makeCategory({ id: "savings", group: "savings", name: "Ahorro", subcategories: ["Meta"] }),
  makeCategory({ id: "invest", group: "investments", name: "Inversiones", subcategories: ["Retiro", "Bolsa"] }),
];

const accounts = [
  makeAccount({ id: "cash", name: "Efectivo", kind: "cash", defaultForCapture: true }),
  makeAccount({ id: "bank", name: "Cuenta corriente", kind: "bank" }),
  makeAccount({ id: "card", name: "Tarjeta credito", kind: "credit" }),
];

const state = makeState({ categories: baseCategories, accounts, currency: "DOP" });

describe("suggestFromNaturalText — amount & currency", () => {
  it("detects a plain amount", () => {
    expect(suggestFromNaturalText("Pague 750 en farmacia", state).amount).toBe("750");
  });

  it("detects a foreign currency token", () => {
    expect(suggestFromNaturalText("Pague 14.99 usd en Amazon", state).currency).toBe("USD");
  });
});

describe("suggestFromNaturalText — type classification", () => {
  it("classifies a card purchase as an expense, not a debt payment", () => {
    // Paying WITH a card is a normal expense; only paying DOWN the card is a debt payment.
    const result = suggestFromNaturalText("Pague 750 en farmacia con tarjeta por medicina", state);
    expect(result.type).toBe("expense");
  });

  it("still uses the credit card as the suggested account for a card purchase", () => {
    const result = suggestFromNaturalText("Pague 750 en farmacia con tarjeta por medicina", state);
    expect(result.accountId).toBe("card");
  });

  it("does not misclassify a hardware-store purchase as an investment", () => {
    // 'ferreteria' contains the letters 'ret' — must not trigger the investment branch.
    const result = suggestFromNaturalText("Compre 500 en ferreteria", state);
    expect(result.type).toBe("expense");
  });

  it("classifies income verbs as income", () => {
    expect(suggestFromNaturalText("Cobre 5000 de salario", state).type).toBe("income");
  });

  it("classifies an explicit loan/installment payment as a debt payment", () => {
    expect(suggestFromNaturalText("Pague la cuota del prestamo 2000", state).type).toBe("debt_payment");
  });

  it("classifies a retirement contribution as an investment", () => {
    expect(suggestFromNaturalText("Aporte 1000 a mi retiro", state).type).toBe("investment");
  });
});
