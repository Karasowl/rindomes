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
});
