// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { RindoMesApp } from "@/components/rindomes-app";
import { I18nProvider } from "@/lib/i18n";
import { currentMonthKey } from "@/lib/onboarding";

// The app now starts from a CLEAN empty state (no demo seed), with the active month
// set to the real current month. Tests build their own data via the capture flow, so
// assertions never depend on fabricated seed numbers.
const activeMonth = currentMonthKey();
const inMonthDate = `${activeMonth}-15`;

beforeEach(() => {
  window.localStorage.clear();
  // Simulate a user past first-run onboarding so the app renders the dashboard
  // (a fresh, empty localStorage otherwise opens the onboarding wizard).
  window.localStorage.setItem("rindomes.onboarded", "skip");
  // Force Spanish so the assertions below (Spanish UI labels) hold; the app now
  // defaults to English via i18n, and I18nProvider reads this stored choice on mount.
  window.localStorage.setItem("rindomes.lang", "es");
});

afterEach(() => {
  cleanup();
});

function setValue(el: Element, value: string) {
  fireEvent.change(el, { target: { value } });
}

// The layout renders both a desktop sidebar and a mobile nav, so each nav label
// appears more than once in jsdom (no CSS to hide one). Click the first match.
function clickNav(name: string) {
  fireEvent.click(screen.getAllByRole("button", { name })[0]);
}

describe("RindoMesApp — capture flow (integration)", () => {
  // After the eyes-on redesign, the Add screen leads with amount + category; the
  // secondary fields (date, description, …) live in a "Detalles" modal opened from a
  // compact row. The tests open that modal to reach those fields.
  function openDetails() {
    fireEvent.click(screen.getAllByText("Detalles")[0]);
  }

  it("captures an expense from the Add view and shows it in Movements", () => {
    const { container } = render(
      <I18nProvider>
        <RindoMesApp />
      </I18nProvider>,
    );

    // The capture screen is the heart of the product — it must be reachable.
    clickNav("Añadir");
    expect(screen.getByRole("heading", { name: /Añadir movimiento/i })).toBeTruthy();

    // Primary fields are on the main Add screen.
    const amount = container.querySelector<HTMLInputElement>('input[placeholder="0"]');
    const categorySelect = [...container.querySelectorAll<HTMLSelectElement>("select")].find((s) =>
      [...s.options].some((o) => o.value === "food"),
    );
    expect(amount).toBeTruthy();
    expect(categorySelect).toBeTruthy();
    setValue(amount!, "500");
    setValue(categorySelect!, "food");

    // Date + description live in the "Detalles" modal.
    openDetails();
    const date = container.querySelector<HTMLInputElement>('input[type="date"]');
    const description = container.querySelector<HTMLInputElement>('input[placeholder*="farmacia"]');
    expect(date).toBeTruthy();
    expect(description).toBeTruthy();
    setValue(date!, inMonthDate); // inside the active (current) month
    setValue(description!, "Prueba integracion");

    fireEvent.click(screen.getByRole("button", { name: "Guardar movimiento" }));

    // Navigate to Movements and assert the freshly captured movement is listed.
    clickNav("Movimientos");
    expect(screen.getAllByText(/Prueba integracion/i).length).toBeGreaterThan(0);
  });

  it("reflects the new expense in the active-month dashboard totals", () => {
    const { container } = render(
      <I18nProvider>
        <RindoMesApp />
      </I18nProvider>,
    );

    clickNav("Añadir");
    const amount = container.querySelector<HTMLInputElement>('input[placeholder="0"]')!;
    const categorySelect = [...container.querySelectorAll<HTMLSelectElement>("select")].find((s) =>
      [...s.options].some((o) => o.value === "food"),
    )!;
    setValue(amount, "500");
    setValue(categorySelect, "food");
    openDetails();
    const date = container.querySelector<HTMLInputElement>('input[type="date"]')!;
    setValue(date, inMonthDate);
    fireEvent.click(screen.getByRole("button", { name: "Guardar movimiento" }));

    // Back on the dashboard, "Gastos" must read exactly $500 — derived from the single
    // real movement on a clean ledger, not from any static/seed card.
    clickNav("Inicio");
    expect(screen.getAllByText("$500").length).toBeGreaterThan(0);
  });
});
