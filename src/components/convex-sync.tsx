"use client";

import { type Dispatch, type SetStateAction, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { stateFromConvexSnapshot, stateSnapshotForConvex } from "@/lib/convex-adapter";
import { useT } from "@/lib/i18n";
import { createEmptyState } from "@/lib/onboarding";
import type { AppState } from "@/lib/types";

const HOUSEHOLD_KEY = "rindomes.convex.householdId";

export type SyncStatus = "idle" | "saving" | "saved" | "offline_error" | "conflict";

export interface SyncStatusState {
  status: SyncStatus;
  lastSavedAt?: number;
}

const syncStatusListeners = new Set<() => void>();
let syncStatusSnapshot: SyncStatusState = { status: "idle" };
let savedIdleTimer: number | null = null;

function setSyncStatus(status: SyncStatus, lastSavedAt = syncStatusSnapshot.lastSavedAt) {
  if (savedIdleTimer && typeof window !== "undefined") {
    window.clearTimeout(savedIdleTimer);
    savedIdleTimer = null;
  }
  syncStatusSnapshot = { status, lastSavedAt };
  syncStatusListeners.forEach((listener) => listener());
  if (status === "saved" && typeof window !== "undefined") {
    savedIdleTimer = window.setTimeout(() => {
      syncStatusSnapshot = { status: "idle", lastSavedAt };
      syncStatusListeners.forEach((listener) => listener());
      savedIdleTimer = null;
    }, 2000);
  }
}

function subscribeSyncStatus(listener: () => void) {
  syncStatusListeners.add(listener);
  return () => {
    syncStatusListeners.delete(listener);
  };
}

function getSyncStatusSnapshot() {
  return syncStatusSnapshot;
}

export function useSyncStatus() {
  return useSyncExternalStore(subscribeSyncStatus, getSyncStatusSnapshot, getSyncStatusSnapshot);
}

/**
 * Makes Convex the live source of truth, without rewriting every view:
 * - Reads the household snapshot reactively (useQuery) and hydrates the app state.
 * - Writes every local change back through a debounced saveSnapshot mutation.
 * - Suppresses the echo of our own writes so the reactive update doesn't loop.
 *
 * Rendered only when Convex is configured (so the hooks always run inside the
 * ConvexProvider). The local state + localStorage path keeps the UI instant and
 * works offline; this component reconciles it with the backend.
 */
export function ConvexSync({
  state,
  setState,
  ready,
  canEdit,
  onNeedsOnboarding,
  onHouseholdId,
  notify,
}: {
  state: AppState;
  setState: Dispatch<SetStateAction<AppState>>;
  ready: boolean;
  canEdit: boolean;
  onNeedsOnboarding?: () => void;
  notify?: (message: string, tone?: "success" | "error" | "info") => void;
  // Lifts the active householdId up to AppShell. Called whenever it changes:
  // initial load (from localStorage), login switch (auth-scoped household), and
  // after a save that provisions a brand-new household. This is the seam the
  // gated views (paywall / receipt capture / entitlement) need, since every
  // gated Convex action requires the householdId that otherwise lives only here.
  // A post-email-verify session lands on the same `isAuthenticated` -> myHousehold
  // hydration path below, so onHouseholdId fires for verified sign-ins too.
  onHouseholdId?: (id: string | null) => void;
}) {
  const { t } = useT();
  const saveSnapshot = useMutation(api.finance.saveSnapshot);
  const [householdId, setHouseholdId] = useState<string | null>(() =>
    typeof window !== "undefined" ? window.localStorage.getItem(HOUSEHOLD_KEY) : null,
  );
  const snapshot = useQuery(
    api.finance.getHouseholdSnapshot,
    householdId ? { householdId: householdId as Id<"households"> } : "skip",
  );

  const hydratedRef = useRef(false);
  const skipNextSaveRef = useRef(false);
  const suppressEchoUntilRef = useRef(0);
  const saveTimerRef = useRef<number | null>(null);
  // Stable refs so the persistence effect below never re-runs (= never re-saves) just because
  // the language or the toast callback identity changed.
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  const tRef = useRef(t);
  tRef.current = t;

  // A conflict/offline chip must not survive an account or household switch.
  useEffect(() => {
    setSyncStatus("idle");
  }, [householdId]);
  // The household version this client last hydrated. Sent as baseVersion on every save so the
  // backend can reject (instead of silently apply) a write made against stale data.
  const versionRef = useRef<number | undefined>(undefined);

  // Only provision a brand-new household (no id yet) once the user has completed
  // onboarding — never from the untouched demo seed of someone just exploring.
  const onboardingCompleted =
    typeof window !== "undefined" && window.localStorage.getItem("rindomes.onboarded") === "1";

  const { isAuthenticated } = useConvexAuth();
  const myHousehold = useQuery(api.finance.getMyHousehold, isAuthenticated ? {} : "skip");
  const claimInvites = useMutation(api.finance.claimInvites);
  const claimHousehold = useMutation(api.finance.claimHousehold);
  // Guards the one-shot adoption below so it fires once per local household, not on every render.
  const claimedRef = useRef<string | null>(null);

  // Surface the active householdId to the parent (AppShell). This single effect
  // covers every way householdId can change — the initial localStorage value, the
  // login switch to the auth-scoped household (incl. a post-email-verify session,
  // which hydrates through the same myHousehold path), and the post-save provision
  // of a brand-new household — because all of them flow through this state setter.
  useEffect(() => {
    onHouseholdId?.(householdId);
  }, [householdId, onHouseholdId]);

  // On login, link any pending email invites to this account.
  useEffect(() => {
    if (isAuthenticated) void claimInvites({}).catch(() => {});
  }, [isAuthenticated, claimInvites]);

  // Auth-first migration: a household this browser created anonymously (before auth-first)
  // sits in the cloud unclaimed/open. The moment its owner signs in — and the account has no
  // hogar of its own yet (myHousehold === null) — adopt the local one so it gets a real owner
  // and is locked down. Once claimed, getMyHousehold resolves to it and the sync proceeds
  // normally. One-shot per local household via claimedRef so we never loop.
  useEffect(() => {
    if (!isAuthenticated || !householdId || myHousehold !== null) return;
    if (claimedRef.current === householdId) return;
    claimedRef.current = householdId;
    void claimHousehold({ householdId: householdId as Id<"households"> }).catch(() => {
      // Not adoptable (already owned by someone else): drop the local pointer so the user
      // hydrates their own account-scoped hogar instead of retrying a forbidden one.
      claimedRef.current = null;
    });
  }, [isAuthenticated, householdId, myHousehold, claimHousehold]);

  // When signed in, the account's household is the source of truth: switch to it
  // (this is how an invited member ends up on the shared hogar across devices).
  useEffect(() => {
    if (isAuthenticated && myHousehold && myHousehold !== householdId) {
      hydratedRef.current = false;
      // Syncing the active household from the auth-scoped query is a legitimate
      // external-state sync, not derived-render state.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHouseholdId(myHousehold);
      window.localStorage.setItem(HOUSEHOLD_KEY, myHousehold);
    }
  }, [isAuthenticated, myHousehold, householdId]);

  // Account-first onboarding: once we know the signed-in account has no hogar yet (and
  // this browser has no local one either), guide a brand-new user through setup. Deferring
  // this to here — instead of a mount-time localStorage guess — means a returning user on a
  // new device hydrates their existing hogar instead of being sent through onboarding again.
  const onboardingNotifiedRef = useRef(false);
  useEffect(() => {
    if (!ready || onboardingNotifiedRef.current || !onNeedsOnboarding) return;
    if (!isAuthenticated || myHousehold === undefined) return; // still resolving
    // Only prompt a genuinely brand-new account: no hogar AND it has never dismissed
    // onboarding. Once they complete or skip it (flag set), never auto-reopen it —
    // that re-prompt-on-reload was perceived as a loop.
    const dismissed = typeof window !== "undefined" && Boolean(window.localStorage.getItem("rindomes.onboarded"));
    if (myHousehold === null && !householdId && !dismissed) {
      onboardingNotifiedRef.current = true;
      onNeedsOnboarding();
    }
  }, [ready, isAuthenticated, myHousehold, householdId, onNeedsOnboarding]);

  // Reactive read: hydrate on initial load and on idle remote updates.
  useEffect(() => {
    if (!ready || snapshot === undefined) return; // still loading
    if (snapshot === null) {
      hydratedRef.current = true; // household not found; local copy is authoritative
      return;
    }
    // Ignore the reactive update caused by our own recent save.
    if (hydratedRef.current && Date.now() < suppressEchoUntilRef.current) return;
    hydratedRef.current = true;
    skipNextSaveRef.current = true; // don't write a freshly-read snapshot back
    versionRef.current = (snapshot.household as { version?: number } | null)?.version ?? 0;
    setState(stateFromConvexSnapshot(snapshot, createEmptyState()));
  }, [snapshot, ready, setState]);

  // Write-through: debounced save of local changes to Convex.
  useEffect(() => {
    if (!ready || !canEdit) return;
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false;
      return;
    }
    // For an existing household, never save before the initial hydrate (would clobber
    // real data with stale local state). For a new household, only provision after onboarding.
    const canWrite = householdId ? hydratedRef.current : (onboardingCompleted || isAuthenticated);
    if (!canWrite) return;
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      void (async () => {
        try {
          setSyncStatus("saving");
          const baseVersion = householdId ? versionRef.current : undefined;
          const payload = stateSnapshotForConvex(state, householdId ?? undefined, baseVersion);
          const result = await saveSnapshot(payload as Parameters<typeof saveSnapshot>[0]);
          if (result?.conflict) {
            // Another device advanced the hogar past our version. Don't overwrite it: drop
            // our stale write and let the reactive snapshot re-hydrate the latest cloud state.
            setSyncStatus("conflict");
            notifyRef.current?.(tRef.current("Otro dispositivo guardó primero: tus últimos cambios se recargaron desde la nube.", "Another device saved first: your latest changes were reloaded from the cloud."), "error");
            hydratedRef.current = false;
            suppressEchoUntilRef.current = 0;
            return;
          }
          suppressEchoUntilRef.current = Date.now() + 2500;
          if (typeof result?.version === "number") versionRef.current = result.version;
          if (result?.householdId && result.householdId !== householdId) {
            setHouseholdId(result.householdId);
            window.localStorage.setItem(HOUSEHOLD_KEY, result.householdId);
          }
          setSyncStatus("saved", Date.now());
        } catch {
          // Keep the local copy; the next change retries.
          setSyncStatus("offline_error");
        }
      })();
    }, 1200);
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
  }, [state, ready, canEdit, householdId, saveSnapshot, onboardingCompleted, isAuthenticated]);

  return null;
}
