import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";
import { ResendOTP } from "./ResendOTP";

// Email verification is OPT-IN via env. When both Resend vars are present we
// require a 6-digit OTP before sign up / sign in (Password({ verify: ResendOTP }));
// when they are absent we degrade to today's password-only flow with no code step.
// finance.authStatus.verificationEnforced mirrors this exact condition so the
// client UI knows whether to show the OTP screen.
const emailEnabled = !!(process.env.RESEND_API_KEY && process.env.AUTH_EMAIL_FROM);

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [emailEnabled ? Password({ verify: ResendOTP }) : Password],
  // Sesiones largas para una app de hogar: el tope total por defecto (30 días) forzaba un
  // re-login mensual a TODOS los usuarios aunque entraran a diario. El JWT de 1 hora obligaba
  // además a un canje de refresh token en casi cada apertura; en móvil, un canje interrumpido
  // (pestaña matada a mitad) puede quemar la cadena de tokens y tumbar la sesión. Un JWT de
  // 12 horas reduce esos canjes a ~1 por día sin tocar la revocación por sesión.
  session: {
    totalDurationMs: 1000 * 60 * 60 * 24 * 180, // 180 días de vida máxima por sesión
    inactiveDurationMs: 1000 * 60 * 60 * 24 * 60, // 60 días sin entrar antes de caducar
  },
  jwt: {
    durationMs: 1000 * 60 * 60 * 12, // 12 horas
  },
});
