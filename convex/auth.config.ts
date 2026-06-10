// Auth provider config for Convex Auth (JWT issuer/audience).
//
// Optional email-verification env vars (consumed by convex/auth.ts +
// convex/ResendOTP.ts, NOT here — listed so they're discoverable in one place):
//   RESEND_API_KEY   — Resend API key. Required to turn ON email-verified auth.
//   AUTH_EMAIL_FROM  — verified sender, e.g. `RindoMes <noreply@tudominio.com>`.
// Set BOTH to enforce the 6-digit OTP step; leave either unset to keep the
// password-only flow. (finance.authStatus.verificationEnforced reflects this.)
const authConfig = {
  providers: [
    {
      domain: process.env.CONVEX_SITE_URL,
      applicationID: "convex",
    },
  ],
};

export default authConfig;
