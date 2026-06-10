import { EmailConfig } from "@convex-dev/auth/server";

/**
 * Custom email-verification provider for Convex Auth's Password provider
 * (`Password({ verify: ResendOTP })`). It emails a 6-digit one-time code via
 * the Resend REST API.
 *
 * Self-contained on purpose:
 *  - No `resend` npm SDK and no Auth.js transport import — just a raw `fetch`,
 *    so it adds ZERO new dependencies.
 *  - Codes are 6 numeric digits generated with the runtime CSPRNG
 *    (`crypto.getRandomValues`).
 *  - `maxAge` is 900s (15 minutes) — the window the code stays valid.
 *  - `sendVerificationRequest` throws on any non-2xx Resend response so the
 *    failure surfaces to the client (AuthPanel) as a real error the user can
 *    retry / resend, instead of a silent "we sent a code" lie.
 *
 * Env (both must be set for auth.ts to wire this up at all):
 *  - RESEND_API_KEY   — a Resend API key.
 *  - AUTH_EMAIL_FROM  — verified sender, e.g. `RindoMes <noreply@tudominio.com>`.
 */
export const ResendOTP: EmailConfig = {
  id: "email-otp",
  type: "email",
  name: "Código por correo",
  // 15 minutes. Auth.js stores this on the verification code's expiration.
  maxAge: 60 * 15,

  /** 6 cryptographically-random numeric digits (e.g. "048213"). */
  async generateVerificationToken() {
    const digits = new Uint32Array(6);
    crypto.getRandomValues(digits);
    return Array.from(digits, (value) => (value % 10).toString()).join("");
  },

  async sendVerificationRequest({ identifier: email, token }) {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.AUTH_EMAIL_FROM;
    if (!apiKey || !from) {
      // Should never happen: auth.ts only wires this provider when both are set.
      throw new Error("Falta configurar RESEND_API_KEY y AUTH_EMAIL_FROM.");
    }

    const subject = "Tu código de verificación de RindoMes";
    const text = [
      "Hola,",
      "",
      `Tu código de verificación de RindoMes es: ${token}`,
      "",
      "Escríbelo en la app para confirmar tu correo. El código vence en 15 minutos.",
      "",
      "Si no solicitaste este código, puedes ignorar este mensaje.",
    ].join("\n");
    const html = [
      '<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1c1917;line-height:1.6">',
      "<p>Hola,</p>",
      "<p>Tu código de verificación de RindoMes es:</p>",
      `<p style="font-size:28px;font-weight:700;letter-spacing:6px;margin:16px 0">${token}</p>`,
      "<p>Escríbelo en la app para confirmar tu correo. El código vence en 15 minutos.</p>",
      "<p style=\"color:#78716c;font-size:13px\">Si no solicitaste este código, puedes ignorar este mensaje.</p>",
      "</div>",
    ].join("");

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: [email], subject, text, html }),
    });

    if (!response.ok) {
      // Surface a real, actionable error (AuthPanel shows it + offers "reenviar").
      let detail = "";
      try {
        detail = await response.text();
      } catch {
        detail = "";
      }
      throw new Error(
        `No se pudo enviar el código de verificación (Resend ${response.status}). ${detail}`.trim(),
      );
    }
  },
};
