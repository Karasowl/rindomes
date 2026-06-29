"use client";

import { type FormEvent, useState } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useT } from "@/lib/i18n";

/**
 * Real authentication (Convex Auth, email + password) with an optional
 * email-verification step (OTP). Auth is opt-in: the app works without it, but
 * signing in ties your hogar to a real account so it follows you across devices.
 *
 * Three-state machine:
 *   A. "credentials" — email + password, with a sign-up / sign-in toggle.
 *   B. "code"        — 6-digit code sent by email (only when verification is on).
 *   C. signed in     — handled by the `isAuthenticated` branch below.
 *
 * The Convex Auth Password provider drives all of it via a single client call:
 *   A: signIn('password', { email, password, flow: 'signUp' | 'signIn' })
 *      - When email verification is enabled, this RESOLVES WITHOUT a session and
 *        triggers the code email; we then advance to state B.
 *      - When it's disabled (today's password-only flow), this resolves WITH a
 *        session and `isAuthenticated` flips — we never show state B.
 *   B: signIn('password', { email, code, flow: 'email-verification' })
 *      - Resolves WITH a session on the right code.
 *   Resend: re-call A with the stored credentials.
 *
 * Whether to expect state B is decided by api.finance.authStatus.verificationEnforced,
 * which mirrors the presence of the email-sending env vars on the backend. When it
 * is false, the OTP step is skipped entirely and the legacy flow is preserved.
 */
export function AuthPanel() {
  const { t } = useT();
  const { isLoading, isAuthenticated } = useConvexAuth();
  const { signIn, signOut } = useAuthActions();
  const user = useQuery(api.finance.currentUser);
  const authStatus = useQuery(api.finance.authStatus);
  // While authStatus is still resolving we assume the legacy (no-verification)
  // behavior; if the backend reports verification on, the form advances to the
  // code step on submit. Either way the actual session creation is what gates C.
  const verificationEnforced = authStatus?.verificationEnforced ?? false;

  const [flow, setFlow] = useState<"signIn" | "signUp">("signIn");
  const [step, setStep] = useState<"credentials" | "code">("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);

  if (isLoading) {
    return (
      <div className="rounded-2xl border border-[var(--line)] bg-white/60 p-4 text-sm text-[var(--text-muted)]">
        {t("Cargando sesión…", "Loading session…")}
      </div>
    );
  }

  // State C — signed in.
  if (isAuthenticated) {
    return (
      <div className="rounded-2xl border border-[var(--line)] bg-white/70 p-5">
        <p className="kicker text-[var(--primary)]">
          {verificationEnforced
            ? t("Cuenta verificada", "Account verified")
            : t("Sesión iniciada", "Signed in")}
        </p>
        <p className="mt-1 font-semibold">{(user?.email as string) ?? t("Sesión iniciada", "Signed in")}</p>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          {t(
            "Tu hogar se sincroniza con esta cuenta en cualquier dispositivo.",
            "Your household syncs with this account on any device.",
          )}
        </p>
        <button
          className="mt-4 rounded-full border border-[var(--line-strong)] bg-white px-4 py-2 text-sm font-bold text-[var(--danger)]"
          onClick={() => void signOut()}
          type="button"
        >
          {t("Cerrar sesión", "Sign out")}
        </button>
      </div>
    );
  }

  function resetToCredentials() {
    setStep("credentials");
    setCode("");
    setError("");
    setInfo("");
  }

  // State A — submit email + password. Sends the code (verification on) or signs
  // in directly (verification off).
  async function handleCredentials(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setInfo("");
    setSubmitting(true);
    try {
      await signIn("password", { email, password, flow });
      // If verification is enforced, the call above resolved without a session and
      // we now need the 6-digit code. Otherwise `isAuthenticated` has flipped and
      // this component re-renders into state C; advancing the step is harmless.
      if (verificationEnforced) {
        setStep("code");
        setInfo(
          t(
            `Te enviamos un código de 6 dígitos a ${email}.`,
            `We sent a 6-digit code to ${email}.`,
          ),
        );
      }
    } catch (err) {
      setError(credentialsErrorMessage(flow, err, t));
    } finally {
      setSubmitting(false);
    }
  }

  // State B — submit the 6-digit code to complete email verification.
  async function handleCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setInfo("");
    setSubmitting(true);
    try {
      await signIn("password", { email, code, flow: "email-verification" });
      // On success the session is created and the component re-renders into state C.
    } catch {
      setError(
        t(
          "El código no es válido o expiró. Revisa el email o reenvía uno nuevo.",
          "That code is invalid or expired. Check your email or send a new one.",
        ),
      );
    } finally {
      setSubmitting(false);
    }
  }

  // Resend = re-run the credentials submit (state A) to issue a fresh code.
  async function handleResend() {
    setError("");
    setInfo("");
    setResending(true);
    try {
      await signIn("password", { email, password, flow });
      setInfo(
        t(`Enviamos un nuevo código a ${email}.`, `We sent a new code to ${email}.`),
      );
    } catch {
      setError(
        t(
          "No pudimos reenviar el código. Inténtalo de nuevo en un momento.",
          "We couldn't resend the code. Please try again in a moment.",
        ),
      );
    } finally {
      setResending(false);
    }
  }

  // State B — code entry.
  if (step === "code") {
    return (
      <form className="rounded-2xl border border-[var(--line)] bg-white/70 p-5" onSubmit={handleCode}>
        <p className="kicker text-[var(--primary)]">{t("Verifica tu email", "Verify your email")}</p>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          {t("Ingresa el código de 6 dígitos que enviamos a", "Enter the 6-digit code we sent to")}{" "}
          <span className="font-semibold">{email}</span>.
        </p>
        <div className="mt-4">
          <input
            className="w-full rounded-xl border border-[rgba(18,20,20,0.46)] bg-white px-4 py-3 text-center text-lg font-semibold tracking-[0.4em] focus:border-[var(--primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2 placeholder:text-[rgba(18,20,20,0.62)]"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            placeholder="••••••"
            aria-label={t("Código de verificación", "Verification code")}
            required
            autoFocus
          />
        </div>
        {info && <p className="mt-3 text-sm font-semibold text-[var(--primary)]">{info}</p>}
        {error && <p className="mt-3 text-sm font-semibold text-[var(--danger)]">{error}</p>}
        <button
          className="mt-4 w-full rounded-full bg-[var(--lime)] px-5 py-3 text-sm font-bold text-black transition hover:brightness-95 disabled:opacity-60"
          disabled={submitting || code.length !== 6}
          type="submit"
        >
          {submitting
            ? t("Verificando…", "Verifying…")
            : t("Verificar y entrar", "Verify and continue")}
        </button>
        <button
          className="mt-3 w-full text-center text-sm font-semibold text-[var(--text-muted)] hover:text-[var(--foreground)] disabled:opacity-60"
          onClick={() => void handleResend()}
          disabled={resending}
          type="button"
        >
          {resending ? t("Reenviando…", "Resending…") : t("Reenviar código", "Resend code")}
        </button>
        <p className="mt-3 text-center text-xs text-[var(--text-subtle)]">
          <button
            className="font-semibold underline underline-offset-2 hover:text-[var(--text-muted)]"
            onClick={resetToCredentials}
            type="button"
          >
            {t("Cambiar email o contraseña", "Change email or password")}
          </button>
        </p>
      </form>
    );
  }

  // State A — credentials.
  return (
    <form className="rounded-2xl border border-[var(--line)] bg-white/70 p-5" onSubmit={handleCredentials}>
      <p className="kicker text-[var(--primary)]">
        {flow === "signIn" ? t("Iniciar sesión", "Sign in") : t("Crear cuenta", "Create account")}
      </p>
      <p className="mt-1 text-sm text-[var(--text-muted)]">
        {t("Sincroniza tu hogar entre dispositivos.", "Sync your household across devices.")}
      </p>
      <div className="mt-4 space-y-3">
        <input
          className="w-full rounded-xl border border-[rgba(18,20,20,0.46)] bg-white px-4 py-3 text-sm focus:border-[var(--primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2 placeholder:text-[rgba(18,20,20,0.62)]"
          name="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t("tu@email.com", "you@email.com")}
          required
          autoComplete="email"
        />
        <input
          className="w-full rounded-xl border border-[rgba(18,20,20,0.46)] bg-white px-4 py-3 text-sm focus:border-[var(--primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2 placeholder:text-[rgba(18,20,20,0.62)]"
          name="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t("Contraseña", "Password")}
          required
          autoComplete={flow === "signIn" ? "current-password" : "new-password"}
        />
      </div>
      {info && <p className="mt-3 text-sm font-semibold text-[var(--primary)]">{info}</p>}
      {error && <p className="mt-3 text-sm font-semibold text-[var(--danger)]">{error}</p>}
      <button
        className="mt-4 w-full rounded-full bg-[var(--lime)] px-5 py-3 text-sm font-bold text-black transition hover:brightness-95 disabled:opacity-60"
        disabled={submitting}
        type="submit"
      >
        {submitting
          ? t("Procesando…", "Processing…")
          : flow === "signIn"
            ? t("Iniciar sesión", "Sign in")
            : t("Crear cuenta", "Create account")}
      </button>
      <button
        className="mt-3 w-full text-center text-sm font-semibold text-[var(--text-muted)] hover:text-[var(--foreground)]"
        onClick={() => {
          setFlow(flow === "signIn" ? "signUp" : "signIn");
          setError("");
          setInfo("");
        }}
        type="button"
      >
        {flow === "signIn"
          ? t("Crear cuenta", "Create account")
          : t("Ya tengo cuenta", "I already have an account")}
      </button>
    </form>
  );
}

/**
 * Distinguishes a real email-send failure (verification on, but the code email
 * could not be delivered) from ordinary bad credentials, so the user gets honest
 * guidance instead of a generic message.
 */
function credentialsErrorMessage(
  flow: "signIn" | "signUp",
  err: unknown,
  t: (es: string, en: string) => string,
): string {
  const raw = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  if (
    raw.includes("resend") ||
    raw.includes("could not send") ||
    raw.includes("send email") ||
    (raw.includes("email") && raw.includes("fail"))
  ) {
    return t(
      "No pudimos enviar el código de verificación. Revisa el email e inténtalo de nuevo, o usa “Reenviar código”.",
      "We couldn't send the verification code. Check your email and try again, or use “Resend code”.",
    );
  }
  return flow === "signIn"
    ? t(
        "No se pudo iniciar sesión. Revisa tu email y contraseña.",
        "Couldn't sign in. Check your email and password.",
      )
    : t(
        "No se pudo crear la cuenta. Usa un email válido y una contraseña de 8+ caracteres.",
        "Couldn't create the account. Use a valid email and a password of 8+ characters.",
      );
}
