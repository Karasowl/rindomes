"use client";

// Honest paywall. Props-only — no Convex import; the parent injects the real entitlement and
// the real startProUpgrade caller. The owner's rule is "no maqueta": this NEVER shows a fake
// "¡Ya eres Pro!" state. It calls the injected onStartCheckout (the server stub) and renders its
// real message verbatim, and always offers the free manual path so the user is never blocked.

import { ArrowLeft, Check, Sparkles } from "lucide-react";
import { useState } from "react";
import type { EntitlementView } from "@/lib/entitlement";
import { useT } from "@/lib/i18n";
import type { View } from "@/lib/types";

// Tuples of [es, en] — wrapped with t() at the render site since these are module-level constants.
const PRO_FEATURES: [string, string][] = [
  ["Lectura de recibos con IA (foto o PDF → movimiento listo para revisar)", "AI receipt reading (photo or PDF → a transaction ready to review)"],
  ["Captura por texto natural con IA del servidor", "Natural-language capture powered by server-side AI"],
  ["Créditos de IA mensuales incluidos", "Monthly AI credits included"],
  ["Tú siempre apruebas antes de guardar — nada se registra solo", "You always approve before saving — nothing is recorded on its own"],
];

const FREE_FEATURES: [string, string][] = [
  ["Captura manual completa (el corazón de RindoMes)", "Full manual capture (the heart of RindoMes)"],
  ["Subir recibos y adjuntarlos a tus movimientos", "Upload receipts and attach them to your transactions"],
  ["Adivinar con reglas locales (gratis, sin conexión)", "Suggestions from local rules (free, offline)"],
];

export function PaywallView({
  entitlement,
  onStartCheckout,
  onContinueManual,
  setView,
}: {
  entitlement: EntitlementView | null;
  onStartCheckout: () => Promise<{ status: string; message: string }>;
  onContinueManual: () => void;
  setView: (v: View) => void;
}) {
  const { t } = useT();
  const [checking, setChecking] = useState(false);
  // The honest result of the checkout stub. We render whatever the server returns — including
  // "checkout_not_configured" with its Spanish message — and we never flip this to a success.
  const [result, setResult] = useState<{ status: string; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isPro = entitlement?.plan === "pro";
  const aiOffPreference = entitlement ? !entitlement.aiEnabled : false;

  async function handleCheckout() {
    setChecking(true);
    setError(null);
    setResult(null);
    try {
      const response = await onStartCheckout();
      setResult(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("No se pudo iniciar el proceso de suscripción.", "We couldn't start the subscription process."));
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 pt-1">
        <div className="min-w-0">
          <p className="kicker">{t("Plan y suscripción", "Plan & subscription")}</p>
          <h2 className="serif mt-1.5 text-[1.9rem] font-bold leading-[1.05] tracking-tight md:text-[2.4rem]">{t("La IA de RindoMes es Pro", "RindoMes AI is a Pro feature")}</h2>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-[var(--text-muted)]">
            {t("Leer recibos y notas con IA requiere una suscripción. Tu plan actual es", "Reading receipts and notes with AI requires a subscription. Your current plan is")}{" "}
            <strong>{isPro ? t("Pro", "Pro") : t("Gratis", "Free")}</strong>. {t("La captura manual y las reglas locales siguen siendo gratis, para siempre.", "Manual capture and local rules stay free, forever.")}
          </p>
        </div>
        <button
          className="inline-flex shrink-0 items-center gap-2 rounded-2xl border border-[var(--line)] bg-white/70 px-4 py-2.5 text-sm font-semibold text-[var(--text-muted)] transition hover:bg-white"
          onClick={() => setView("home")}
          type="button"
        >
          <ArrowLeft className="h-4 w-4" /> {t("Volver", "Back")}
        </button>
      </div>

      {isPro && (
        <section className="glass rounded-3xl border border-[rgba(80,102,0,0.2)] bg-[rgba(204,255,0,0.08)] p-6">
          <p className="serif text-lg font-bold text-[var(--primary)]">{t("Ya tienes Pro activo", "Your Pro plan is active")}</p>
          <p className="mt-1.5 text-sm leading-relaxed text-[var(--text-muted)]">
            {aiOffPreference
              ? t("Tu plan Pro incluye IA, pero la tienes desactivada en Ajustes. Actívala cuando quieras usar la lectura con IA.", "Your Pro plan includes AI, but it's turned off in Settings. Turn it on whenever you want to use AI reading.")
              : t("Puedes usar la lectura de recibos con IA. Recuerda: siempre revisas y apruebas antes de guardar.", "You can use AI receipt reading. Remember: you always review and approve before saving.")}
          </p>
        </section>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="glass rounded-3xl p-6">
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-[var(--lime)] text-black">
              <Sparkles className="h-5 w-5" />
            </span>
            <h3 className="serif text-xl font-bold tracking-tight">{t("Pro · con IA", "Pro · with AI")}</h3>
          </div>
          <ul className="mt-5 grid gap-3">
            {PRO_FEATURES.map(([es, en]) => (
              <li className="flex items-start gap-2.5 text-sm text-[var(--foreground)]" key={es}>
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-[var(--primary)]" />
                <span>{t(es, en)}</span>
              </li>
            ))}
          </ul>

          {!isPro && (
            <div className="mt-6">
              <button
                className="w-full rounded-2xl bg-[var(--lime)] px-6 py-3.5 text-base font-bold text-black shadow-lg shadow-lime-300/30 transition hover:-translate-y-0.5 disabled:opacity-50"
                disabled={checking}
                onClick={() => void handleCheckout()}
                type="button"
              >
                {checking ? t("Conectando…", "Connecting…") : t("Empezar Pro", "Start Pro")}
              </button>

              {/* Honest stub surface: whatever the server returns, shown as-is. No fake success. */}
              {result && (
                <div className="mt-4 rounded-2xl border border-[rgba(80,102,0,0.18)] bg-white/70 px-4 py-3 text-sm leading-relaxed text-[var(--foreground)]">
                  <p className="kicker mb-1.5">{result.status === "checkout_not_configured" ? t("Pago aún no disponible", "Payments not available yet") : result.status}</p>
                  <p>{result.message}</p>
                </div>
              )}
              {error && (
                <p className="mt-4 rounded-2xl border border-[rgba(186,26,26,0.3)] bg-[rgba(186,26,26,0.06)] px-4 py-3 text-sm text-[var(--danger)]">
                  {error}
                </p>
              )}
            </div>
          )}
        </section>

        <section className="glass rounded-3xl p-6">
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-[var(--surface-soft)] text-[var(--primary)]">
              <Check className="h-5 w-5" />
            </span>
            <h3 className="serif text-xl font-bold tracking-tight">{t("Gratis · siempre disponible", "Free · always available")}</h3>
          </div>
          <ul className="mt-5 grid gap-3">
            {FREE_FEATURES.map(([es, en]) => (
              <li className="flex items-start gap-2.5 text-sm text-[var(--foreground)]" key={es}>
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-subtle)]" />
                <span>{t(es, en)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-6">
            <button
              className="w-full rounded-2xl border border-[var(--line)] bg-white px-6 py-3.5 text-base font-bold text-[var(--primary)] transition hover:-translate-y-0.5"
              onClick={onContinueManual}
              type="button"
            >
              {t("Continuar manualmente", "Continue manually")}
            </button>
            <p className="mt-3 text-center text-xs text-[var(--text-muted)]">
              {t("Sin tarjeta. Captura todo a mano o con reglas locales cuando quieras.", "No card needed. Capture everything by hand or with local rules whenever you like.")}
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
