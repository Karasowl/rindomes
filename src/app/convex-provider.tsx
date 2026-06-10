"use client";

import { type ReactNode } from "react";
import { ConvexReactClient } from "convex/react";
import { ConvexAuthProvider } from "@convex-dev/auth/react";

const convex = process.env.NEXT_PUBLIC_CONVEX_URL
  ? new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL)
  : null;

/**
 * Wraps the app in a Convex + Auth provider so components can use useQuery/useMutation
 * and useAuthActions against the live deployment. Falls back to rendering children
 * directly when NEXT_PUBLIC_CONVEX_URL is not configured (local-only mode).
 */
export function ConvexClientProvider({ children }: { children: ReactNode }) {
  if (!convex) return <>{children}</>;
  return <ConvexAuthProvider client={convex}>{children}</ConvexAuthProvider>;
}
