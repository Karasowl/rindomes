"use client";

import { type Dispatch, type FormEvent, type ReactNode, type SetStateAction, useState } from "react";
import { ArrowRight, Banknote, CreditCard, Landmark, Plus, Trash2, Wallet, WalletCards } from "lucide-react";
import { formatMoney, toCents } from "@/lib/finance";
import { accountKindLabel } from "@/lib/labels";
import { buildOnboardingState, type OnboardingInput } from "@/lib/onboarding";
import type { Account, AppState, CurrencyCode, Mode } from "@/lib/types";
import { useT } from "@/lib/i18n";

const MODES: Array<{ mode: Mode; title: string; recommended?: boolean; description: string }> = [
  {
    mode: "tracker",
    title: "Registro",
    description: "Anota ingresos y gastos a medida que ocurren, sin presupuesto.",
  },
  {
    mode: "monthly-plan",
    title: "Plan mensual",
    recommended: true,
    description: "Defines un presupuesto y comparas lo real contra lo planeado.",
  },
  {
    mode: "zero",
    title: "Base cero",
    description: "Asignas cada peso a una categoría antes de empezar el mes.",
  },
];

const ACCOUNT_KINDS: Array<{ kind: Account["kind"]; icon: typeof Wallet }> = [
  { kind: "cash", icon: Wallet },
  { kind: "bank", icon: Landmark },
  { kind: "credit", icon: CreditCard },
  { kind: "savings", icon: Banknote },
  { kind: "investment", icon: WalletCards },
];

// English copy for the module-level MODES constant, keyed by mode value (rendered via t()).
function modeTitleEn(mode: Mode): string {
  switch (mode) {
    case "tracker":
      return "Tracker";
    case "monthly-plan":
      return "Monthly plan";
    case "zero":
      return "Zero-based";
  }
}

function modeDescriptionEn(mode: Mode): string {
  switch (mode) {
    case "tracker":
      return "Log income and expenses as they happen, with no budget.";
    case "monthly-plan":
      return "Set a budget and compare actual spending against your plan.";
    case "zero":
      return "Assign every peso to a category before the month begins.";
  }
}

interface DraftAccount {
  name: string;
  kind: Account["kind"];
  balance: string;
}

interface DraftExpense {
  name: string;
  amount: string;
}

export function Onboarding({
  currency = "USD",
  activeMonth,
  onComplete,
  onSkip,
  relaunched = false,
  hasExistingData = false,
  onExit,
}: {
  currency?: CurrencyCode;
  activeMonth: string;
  onComplete: (state: AppState) => void;
  onSkip: () => void;
  relaunched?: boolean;
  hasExistingData?: boolean;
  onExit?: () => void;
}) {
  const { t } = useT();
  const [step, setStep] = useState(0);
  const [rerunConfirmed, setRerunConfirmed] = useState(!relaunched || !hasExistingData);
  const [ownerName, setOwnerName] = useState("");
  const [householdName, setHouseholdName] = useState("");
  const [mode, setMode] = useState<Mode>("monthly-plan");
  const [accounts, setAccounts] = useState<DraftAccount[]>([{ name: t("Efectivo", "Cash"), kind: "cash", balance: "" }]);
  const [income, setIncome] = useState("");
  const [otherIncome, setOtherIncome] = useState("");
  const [showOtherIncome, setShowOtherIncome] = useState(false);
  const [expenses, setExpenses] = useState<DraftExpense[]>([{ name: "", amount: "" }]);

  const incomeCents = toCents(income);
  const otherIncomeCents = toCents(otherIncome);
  const totalIncome = incomeCents + otherIncomeCents;
  const totalFixed = expenses.reduce((sum, expense) => sum + toCents(expense.amount), 0);
  const remainder = totalIncome - totalFixed;

  function finish() {
    const input: OnboardingInput = {
      ownerName,
      householdName,
      currency,
      activeMonth,
      mode,
      accounts: accounts
        .filter((account) => account.name.trim())
        .map((account) => ({ name: account.name, kind: account.kind, balanceCents: toCents(account.balance) })),
      incomeCents,
      otherIncomeCents,
      fixedExpenses: expenses.filter((expense) => expense.name.trim()).map((expense) => ({ name: expense.name, amountCents: toCents(expense.amount) })),
    };
    onComplete(buildOnboardingState(input));
  }

  if (!rerunConfirmed) {
    return (
      <main className="grain mesh-bg flex min-h-screen flex-col items-center justify-center px-5 py-10 text-[var(--ink)]">
        <section className="w-full max-w-xl rounded-3xl border border-white/70 bg-white/70 p-6 shadow-[var(--shadow)] backdrop-blur-xl">
          <p className="kicker">{t("Primer mes", "First month")}</p>
          <h1 className="serif mt-2 text-4xl font-bold tracking-tight">{t("Volver a configurar tu mes", "Set up your month again")}</h1>
          <p className="mt-4 text-sm leading-relaxed text-[var(--text-muted)]">
            {t("Ya tienes datos. Rehacer la configuración puede duplicar categorías o cuentas.", "You already have data. Running setup again can duplicate categories or accounts.")}
          </p>
          <div className="mt-7 grid gap-3 sm:grid-cols-[1fr_auto]">
            <button className="rounded-full bg-[var(--lime)] px-6 py-3 text-sm font-bold text-black transition hover:brightness-95" onClick={onExit} type="button">
              {t("Volver a la app", "Back to app")}
            </button>
            <button className="rounded-full border border-black/[0.46] bg-white/70 px-6 py-3 text-sm font-bold text-[var(--foreground)] transition hover:bg-white" onClick={() => setRerunConfirmed(true)} type="button">
              {t("Continuar de todos modos", "Continue anyway")}
            </button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="grain mesh-bg flex min-h-screen flex-col items-center px-5 py-10 text-[var(--ink)]">
      <div className="flex w-full max-w-xl flex-1 flex-col">
        {relaunched && onExit && (
          <button className="mb-6 inline-flex w-fit items-center gap-2 rounded-full border border-black/[0.46] bg-white/70 px-4 py-2 text-sm font-bold text-[var(--foreground)] transition hover:bg-white" onClick={onExit} type="button">
            {t("← Volver", "← Back")}
          </button>
        )}
        {step > 0 && (
          <div className="mb-8 flex items-center gap-2">
            {[0, 1, 2].map((index) => (
              <span
                key={index}
                className={`h-1.5 flex-1 rounded-full transition ${index <= step ? "bg-[var(--lime)]" : "bg-[var(--surface-muted)]"}`}
              />
            ))}
          </div>
        )}

        {step === 0 && (
          <section className="flex flex-1 flex-col justify-center">
            <div className="text-center">
              <Landmark className="mx-auto h-9 w-9 text-[var(--primary)]" />
              <h1 className="serif mt-6 text-5xl font-bold italic tracking-tight">RindoMes</h1>
              <p className="mt-4 text-[var(--text-muted)]">{t("¿Cómo quieres llevar tu mes?", "How do you want to manage your month?")}</p>
            </div>

            <div className="mt-8 space-y-3">
              {MODES.map((option) => {
                const active = mode === option.mode;
                return (
                  <button
                    className={`w-full rounded-3xl border p-5 text-left transition ${active ? "border-[var(--lime)] bg-[rgba(204,255,0,0.12)] shadow-sm" : "border-[var(--line)] bg-white/55 hover:bg-white/80"}`}
                    key={option.mode}
                    onClick={() => setMode(option.mode)}
                    type="button"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="serif text-2xl font-bold">{t(option.title, modeTitleEn(option.mode))}</h3>
                      {option.recommended && (
                        <span className="rounded-full bg-[var(--lime)] px-3 py-0.5 text-[10px] font-bold uppercase tracking-wider text-black">{t("Recomendado", "Recommended")}</span>
                      )}
                      {active && !option.recommended && (
                        <span className="text-sm font-bold text-[var(--primary)]">✓</span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-[var(--text-muted)]">{t(option.description, modeDescriptionEn(option.mode))}</p>
                  </button>
                );
              })}
            </div>

            <details className="group mt-6">
              <summary className="kicker cursor-pointer list-none text-[var(--primary)] [&::-webkit-details-marker]:hidden">{t("+ Personalizar", "+ Customize")}</summary>
              <div className="mt-3 space-y-3">
                <Field label={t("Tu nombre", "Your name")}>
                  <input className="field" value={ownerName} onChange={(event) => setOwnerName(event.target.value)} placeholder={t("Nombre", "Name")} />
                </Field>
                <Field label={t("Nombre del hogar", "Household name")}>
                  <input className="field" value={householdName} onChange={(event) => setHouseholdName(event.target.value)} placeholder={t("Ej. Mi Hogar", "e.g. My Household")} />
                </Field>
              </div>
            </details>

            <button className="mt-8 inline-flex w-full items-center justify-center gap-2 rounded-full bg-[var(--lime)] px-6 py-4 text-base font-bold text-black transition hover:brightness-95" onClick={() => setStep(1)} type="button">
              {t("Continuar", "Continue")} <ArrowRight className="h-5 w-5" />
            </button>
            <button className="mt-4 text-sm font-semibold text-[var(--text-muted)] hover:text-[var(--foreground)]" onClick={onSkip} type="button">
              {t("Configurar más tarde", "Set up later")}
            </button>
          </section>
        )}

        {step === 1 && (
          <section className="flex flex-1 flex-col">
            <h2 className="serif text-4xl font-bold tracking-tight">{t("Tu mes", "Your month")}</h2>

            <div className="mt-6 rounded-3xl border border-white/70 bg-white/55 p-5">
              <p className="kicker text-[var(--primary)]">{t("Ingresos", "Income")}</p>
              <Field label={t("Salario estimado", "Estimated salary")}>
                <MoneyInput currency={currency} value={income} onChange={setIncome} />
              </Field>
              {showOtherIncome ? (
                <Field label={t("Otros ingresos", "Other income")}>
                  <MoneyInput currency={currency} value={otherIncome} onChange={setOtherIncome} />
                </Field>
              ) : (
                <button className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-[var(--primary)]" onClick={() => setShowOtherIncome(true)} type="button">
                  <Plus className="h-4 w-4" /> {t("Añadir otros ingresos", "Add other income")}
                </button>
              )}
            </div>

            <div className="mt-4 rounded-3xl border border-white/70 bg-white/55 p-5">
              <p className="kicker text-[var(--danger)]">{t("Gastos obligatorios", "Essential expenses")}</p>
              <div className="mt-3 space-y-2">
                {expenses.map((expense, index) => (
                  <div className="flex items-center gap-2" key={index}>
                    <input className="field min-w-0 flex-1" value={expense.name} onChange={(event) => updateExpense(setExpenses, index, { name: event.target.value })} placeholder={t("Concepto", "Description")} />
                    <div className="flex w-32 shrink-0 items-center rounded-[0.875rem] border border-black/[0.46] bg-white px-2">
                      <span className="text-sm text-[var(--text-subtle)]">$</span>
                      <input className="w-full bg-transparent px-1 py-2 text-sm" value={expense.amount} onChange={(event) => updateExpense(setExpenses, index, { amount: event.target.value })} placeholder="0" inputMode="decimal" />
                    </div>
                    <button className="text-[var(--text-subtle)] hover:text-[var(--danger)]" onClick={() => setExpenses((current) => current.filter((_, i) => i !== index))} type="button" aria-label={t("Quitar", "Remove")}><Trash2 className="h-4 w-4" /></button>
                  </div>
                ))}
              </div>
              <button className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-[var(--primary)]" onClick={() => setExpenses((current) => [...current, { name: "", amount: "" }])} type="button">
                <Plus className="h-4 w-4" /> {t("Añadir gasto fijo", "Add fixed expense")}
              </button>
            </div>

            <div className="mt-4 rounded-3xl border border-white/70 bg-white/70 p-5 text-center">
              <div className="flex items-center justify-between text-sm">
                <span className="text-[var(--text-muted)]">{t("Ingresos totales", "Total income")}</span>
                <span className="font-bold text-[var(--primary)]">{formatMoney(totalIncome, currency)}</span>
              </div>
              <div className="mt-1 flex items-center justify-between text-sm">
                <span className="text-[var(--text-muted)]">{t("Gastos fijos", "Fixed expenses")}</span>
                <span className="font-bold text-[var(--danger)]">-{formatMoney(totalFixed, currency)}</span>
              </div>
              <p className="kicker mt-4">{t("Remanente disponible", "Available remainder")}</p>
              <p className={`serif text-4xl font-bold ${remainder < 0 ? "text-[var(--danger)]" : "text-[var(--foreground)]"}`}>{formatMoney(remainder, currency)}</p>
            </div>

            <StepNav onBack={() => setStep(0)} onNext={() => setStep(2)} />
          </section>
        )}

        {step === 2 && (
          <form
            className="flex flex-1 flex-col"
            onSubmit={(event: FormEvent<HTMLFormElement>) => {
              event.preventDefault();
              finish();
            }}
          >
            <h2 className="serif text-4xl font-bold tracking-tight">{t("Tus cuentas", "Your accounts")}</h2>
            <div className="mt-6 space-y-3">
              {accounts.map((account, index) => {
                const Icon = ACCOUNT_KINDS.find((option) => option.kind === account.kind)?.icon ?? Wallet;
                return (
                  <div className="rounded-3xl border border-white/70 bg-white/55 p-4" key={index}>
                    <div className="flex items-center gap-3">
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[var(--surface-soft)] text-[var(--primary)]"><Icon className="h-5 w-5" /></span>
                      <input className="min-w-0 flex-1 border-b border-black/[0.46] bg-transparent py-1 font-semibold" value={account.name} onChange={(event) => updateAccount(setAccounts, index, { name: event.target.value })} placeholder={t("Nombre de la cuenta", "Account name")} />
                      {accounts.length > 1 && (
                        <button className="text-[var(--text-subtle)] hover:text-[var(--danger)]" onClick={() => setAccounts((current) => current.filter((_, i) => i !== index))} type="button" aria-label={t("Quitar", "Remove")}><Trash2 className="h-4 w-4" /></button>
                      )}
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <label className="text-xs font-semibold text-[var(--text-muted)]">
                        {t("Tipo", "Type")}
                        <select className="mt-1 w-full rounded-lg border border-black/[0.46] bg-white px-2 py-2 text-sm" value={account.kind} onChange={(event) => updateAccount(setAccounts, index, { kind: event.target.value as Account["kind"] })}>
                          {ACCOUNT_KINDS.map((option) => <option key={option.kind} value={option.kind}>{accountKindLabel(option.kind)}</option>)}
                        </select>
                      </label>
                      <label className="text-xs font-semibold text-[var(--text-muted)]">
                        {t("Saldo actual", "Current balance")}
                        <input className="mt-1 w-full rounded-lg border border-black/[0.46] bg-white px-2 py-2 text-sm" value={account.balance} onChange={(event) => updateAccount(setAccounts, index, { balance: event.target.value })} placeholder="0.00" inputMode="decimal" />
                      </label>
                    </div>
                  </div>
                );
              })}
              <button className="flex w-full items-center justify-center gap-2 rounded-3xl border border-dashed border-black/[0.46] py-3 text-sm font-semibold text-[var(--text-muted)] hover:bg-white/50" onClick={() => setAccounts((current) => [...current, { name: "", kind: "bank", balance: "" }])} type="button">
                <Plus className="h-4 w-4" /> {t("Añadir otra cuenta", "Add another account")}
              </button>
            </div>

            <div className="mt-6 flex flex-col gap-3">
              <button className="inline-flex items-center justify-center gap-2 rounded-full bg-[var(--lime)] px-6 py-4 text-base font-bold text-black transition hover:brightness-95" type="submit">
                {t("Crear mi primer mes", "Create my first month")} <ArrowRight className="h-5 w-5" />
              </button>
              <button className="text-sm font-semibold text-[var(--text-muted)] hover:text-[var(--foreground)]" onClick={() => setStep(1)} type="button">
                {t("Atrás", "Back")}
              </button>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="mt-3 block">
      <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">{label}</span>
      {children}
    </label>
  );
}

function MoneyInput({ currency, value, onChange }: { currency: CurrencyCode; value: string; onChange: (value: string) => void }) {
  return (
    <div className="flex items-center gap-2 border-b-2 border-[var(--ink)] py-2">
      <span className="serif text-2xl font-bold text-[var(--text-muted)]">{currency === "EUR" ? "€" : "$"}</span>
      <input className="w-full bg-transparent text-2xl font-semibold" value={value} onChange={(event) => onChange(event.target.value)} placeholder="0.00" inputMode="decimal" />
    </div>
  );
}

function StepNav({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const { t } = useT();
  return (
    <div className="mt-auto flex items-center gap-3 pt-8">
      <button className="rounded-full border border-black/[0.46] px-5 py-3 text-sm font-semibold text-[var(--text-muted)] hover:bg-white/50" onClick={onBack} type="button">{t("Atrás", "Back")}</button>
      <button className="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-[var(--lime)] px-6 py-3 text-base font-bold text-black transition hover:brightness-95" onClick={onNext} type="button">
        {t("Continuar", "Continue")} <ArrowRight className="h-5 w-5" />
      </button>
    </div>
  );
}

function updateAccount(setAccounts: Dispatch<SetStateAction<DraftAccount[]>>, index: number, patch: Partial<DraftAccount>) {
  setAccounts((current) => current.map((account, i) => (i === index ? { ...account, ...patch } : account)));
}

function updateExpense(setExpenses: Dispatch<SetStateAction<DraftExpense[]>>, index: number, patch: Partial<DraftExpense>) {
  setExpenses((current) => current.map((expense, i) => (i === index ? { ...expense, ...patch } : expense)));
}
