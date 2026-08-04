"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ConvexHttpClient } from "convex/browser";
import { ConvexReactClient } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { ConvexAuthProvider } from "@convex-dev/auth/react";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;

const convex = CONVEX_URL ? new ConvexReactClient(CONVEX_URL) : null;

// Mismas claves y namespace que usa @convex-dev/auth/react internamente
// (useNamespacedStorage: `${clave}_${namespace sin caracteres no alfanuméricos}`,
// con namespace = la URL del deployment). Si la librería cambia este esquema,
// la recuperación de abajo simplemente no encuentra nada y no hace daño.
const ns = (CONVEX_URL ?? "").replace(/[^a-zA-Z0-9]/g, "");
const JWT_KEY = `__convexAuthJWT_${ns}`;
const REFRESH_KEY = `__convexAuthRefreshToken_${ns}`;

const authSignIn = makeFunctionReference<"action">("auth:signIn");

/**
 * Rescata una sesión cuyo JWT desapareció del storage pero cuyo refresh token
 * sobrevive (evicción parcial del navegador, escritura interrumpida). Sin esto,
 * el provider lee JWT=null, se declara sin sesión y obliga a un login manual
 * aunque el refresh token siga siendo perfectamente canjeable.
 *
 * Devuelve true si restauró tokens (el provider debe remontarse para releerlos).
 */
async function recoverSessionFromRefreshToken(): Promise<boolean> {
  if (!CONVEX_URL) return false;
  let refreshToken: string | null = null;
  try {
    if (window.localStorage.getItem(JWT_KEY)) return false;
    refreshToken = window.localStorage.getItem(REFRESH_KEY);
  } catch {
    return false; // storage inaccesible (modo privado estricto): nada que rescatar
  }
  if (!refreshToken) return false;
  try {
    const result = (await new ConvexHttpClient(CONVEX_URL).action(authSignIn, { refreshToken })) as {
      tokens?: { token: string; refreshToken: string } | null;
    };
    if (result?.tokens?.token && result.tokens.refreshToken) {
      window.localStorage.setItem(JWT_KEY, result.tokens.token);
      window.localStorage.setItem(REFRESH_KEY, result.tokens.refreshToken);
      return true;
    }
    // El backend respondió que el refresh token ya no vale: retirarlo evita
    // reintentar un canje muerto en cada visita.
    window.localStorage.removeItem(REFRESH_KEY);
    return false;
  } catch {
    // Error de red: conservar el token y reintentar en la próxima carga.
    return false;
  }
}

/**
 * Wraps the app in a Convex + Auth provider so components can use useQuery/useMutation
 * and useAuthActions against the live deployment. Falls back to rendering children
 * directly when NEXT_PUBLIC_CONVEX_URL is not configured (local-only mode).
 */
export function ConvexClientProvider({ children }: { children: ReactNode }) {
  // El provider lee los tokens solo al montarse; tras una recuperación hay que
  // remontarlo (cambio de key) para que relea el storage restaurado.
  const [authEpoch, setAuthEpoch] = useState(0);
  const recoveryStartedRef = useRef(false);

  useEffect(() => {
    if (!convex || recoveryStartedRef.current) return;
    recoveryStartedRef.current = true;
    void recoverSessionFromRefreshToken().then((recovered) => {
      if (recovered) setAuthEpoch((epoch) => epoch + 1);
    });
  }, []);

  if (!convex) return <>{children}</>;
  return (
    <ConvexAuthProvider key={authEpoch} client={convex}>
      {children}
    </ConvexAuthProvider>
  );
}
