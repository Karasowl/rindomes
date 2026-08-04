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

/** Un hogar (espacio) al que pertenece la cuenta, con el rol real del usuario en él. */
export interface CloudHouseholdSummary {
  id: string;
  name: string;
  role: "owner" | "editor" | "viewer";
  mode: string;
  currency: string;
  memberCount: number;
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
 * Multi-hogar: la cuenta puede pertenecer a varios hogares (el suyo + los que la
 * invitaron). Este componente resuelve cuál es el ACTIVO con esta política:
 *   1. Al entrar se reclaman las invitaciones pendientes (claimInvites) ANTES de
 *      decidir nada — esto elimina la carrera que dejaba al invitado atrapado en
 *      su hogar viejo o lo mandaba a onboarding.
 *   2. Si se reclamó una invitación en este login, se cambia a ese hogar (el
 *      usuario acaba de ser invitado: quiere ver el hogar de su familia).
 *   3. Si la selección local (localStorage) es una membresía válida, se respeta.
 *   4. Si no hay selección válida, se usa la primera membresía.
 *   5. Sin membresías pero con hogar local (legado anónimo): se adopta.
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
  authEmail = "",
  onNeedsOnboarding,
  onHouseholdId,
  onHouseholds,
  requestedHouseholdId = null,
  onSwitchHandled,
  notify,
}: {
  state: AppState;
  setState: Dispatch<SetStateAction<AppState>>;
  ready: boolean;
  canEdit: boolean;
  // Email real de la sesión: permite que la hidratación te identifique con TU
  // persona del hogar (atribución de "quién puso qué") en vez de members[0].
  authEmail?: string;
  onNeedsOnboarding?: () => void;
  notify?: (message: string, tone?: "success" | "error" | "info") => void;
  // Lifts the active householdId up to AppShell. Called whenever it changes:
  // initial load (from localStorage), login switch (auth-scoped household), and
  // after a save that provisions a brand-new household. This is the seam the
  // gated views (paywall / receipt capture / entitlement) need, since every
  // gated Convex action requires the householdId that otherwise lives only here.
  onHouseholdId?: (id: string | null) => void;
  // Lifts the full membership list (mis hogares/espacios) up to AppShell so the
  // switcher UI (Espacios) and the role display (Cuenta) work off live data.
  onHouseholds?: (households: CloudHouseholdSummary[] | null) => void;
  // Explicit switch request from the UI (cambiar de espacio). Applied only if it
  // is a valid membership; cleared via onSwitchHandled.
  requestedHouseholdId?: string | null;
  onSwitchHandled?: () => void;
}) {
  const { t } = useT();
  const saveSnapshot = useMutation(api.finance.saveSnapshot);
  const [householdId, setHouseholdId] = useState<string | null>(() =>
    typeof window !== "undefined" ? window.localStorage.getItem(HOUSEHOLD_KEY) : null,
  );

  const { isAuthenticated } = useConvexAuth();
  const myHouseholds = useQuery(api.finance.listMyHouseholds, isAuthenticated ? {} : "skip") as
    | CloudHouseholdSummary[]
    | null
    | undefined;
  const claimInvites = useMutation(api.finance.claimInvites);
  const claimHousehold = useMutation(api.finance.claimHousehold);

  // Invitaciones: se reclaman UNA vez por login y el resultado gobierna la
  // resolución de hogar activo. undefined = todavía reclamando; null = no había
  // invitaciones nuevas; string = hogar recién vinculado en ESTE login.
  const [claimedInvite, setClaimedInvite] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (!isAuthenticated) {
      setClaimedInvite(undefined);
      return;
    }
    let cancelled = false;
    void claimInvites({})
      .then((claimed) => {
        if (!cancelled) setClaimedInvite((claimed as string | null) ?? null);
      })
      .catch(() => {
        if (!cancelled) setClaimedInvite(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, claimInvites]);
  const invitesResolved = claimedInvite !== undefined;

  const hydratedRef = useRef(false);
  const skipNextSaveRef = useRef(false);
  const suppressEchoUntilRef = useRef(0);
  const saveTimerRef = useRef<number | null>(null);
  const saveInFlightRef = useRef(false);
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

  // Guards the one-shot legacy adoption below so it fires once per local household.
  const claimedRef = useRef<string | null>(null);

  function switchActiveHousehold(next: string) {
    hydratedRef.current = false;
    versionRef.current = undefined;
    suppressEchoUntilRef.current = 0;
    // Syncing the active household from live membership data is a legitimate
    // external-state sync, not derived-render state.
    setHouseholdId(next);
    window.localStorage.setItem(HOUSEHOLD_KEY, next);
  }

  // Surface the active householdId + membership list to the parent (AppShell).
  useEffect(() => {
    onHouseholdId?.(householdId);
  }, [householdId, onHouseholdId]);
  useEffect(() => {
    onHouseholds?.(myHouseholds ?? null);
  }, [myHouseholds, onHouseholds]);

  // Resolución del hogar activo (ver política en el docstring). Corre solo con
  // las membresías YA resueltas y las invitaciones YA reclamadas: ese orden es
  // el arreglo de fondo — antes claimHousehold podía adoptar el hogar local
  // ANTES de que claimInvites vinculara la invitación, y el invitado terminaba
  // de dueño de un hogar basura en vez de dentro del hogar familiar.
  const inviteNotifiedRef = useRef(false);
  useEffect(() => {
    if (!isAuthenticated || myHouseholds === undefined || !invitesResolved) return;
    const memberships = myHouseholds ?? [];
    const ids = new Set(memberships.map((h) => h.id));

    // Una invitación reclamada EN ESTE login manda: el usuario acaba de ser
    // invitado y espera ver el hogar de su familia. Se CONSUME (pasa a null) al
    // aplicarse, para que un cambio de espacio manual posterior no sea revertido.
    // Si la membresía recién vinculada aún no aparece en el query reactivo, se
    // cae a la resolución normal y se reintenta en el próximo tick.
    if (claimedInvite && ids.has(claimedInvite)) {
      if (claimedInvite !== householdId) {
        switchActiveHousehold(claimedInvite);
        if (!inviteNotifiedRef.current) {
          inviteNotifiedRef.current = true;
          const joined = memberships.find((h) => h.id === claimedInvite);
          notifyRef.current?.(
            tRef.current(
              `Te uniste al hogar “${joined?.name ?? "compartido"}”. Puedes cambiar de espacio en Espacios.`,
              `You joined the “${joined?.name ?? "shared"}” household. You can switch spaces under Spaces.`,
            ),
            "success",
          );
        }
      }
      // Consumido: la selección del usuario vuelve a mandar de aquí en adelante.
      setClaimedInvite(null);
      return;
    }

    // Selección local válida: respetarla (aquí vive el multi-espacio).
    if (householdId && ids.has(householdId)) return;

    // Sin selección válida: primera membresía disponible.
    if (memberships.length > 0) {
      switchActiveHousehold(memberships[0].id);
      return;
    }

    // Sin membresías: hogar local legado (anónimo, pre auth-first) → adoptarlo.
    if (householdId && claimedRef.current !== householdId) {
      claimedRef.current = householdId;
      void claimHousehold({ householdId: householdId as Id<"households"> }).catch(() => {
        // Not adoptable (already owned by someone else): drop the local pointer so the user
        // hydrates their own account-scoped hogar instead of retrying a forbidden one.
        claimedRef.current = null;
        window.localStorage.removeItem(HOUSEHOLD_KEY);
        setHouseholdId(null);
      });
    }
  }, [isAuthenticated, myHouseholds, invitesResolved, claimedInvite, householdId, claimHousehold]);

  // Cambio de espacio pedido por la UI (Espacios): solo hacia membresías válidas.
  useEffect(() => {
    if (!requestedHouseholdId) return;
    const valid = (myHouseholds ?? []).some((h) => h.id === requestedHouseholdId);
    if (valid && requestedHouseholdId !== householdId) {
      switchActiveHousehold(requestedHouseholdId);
    }
    if (valid || myHouseholds !== undefined) onSwitchHandled?.();
  }, [requestedHouseholdId, myHouseholds, householdId, onSwitchHandled]);

  // Account-first onboarding: once we know the signed-in account has no hogar yet (and
  // this browser has no local one either), guide a brand-new user through setup. Esperar
  // a invitesResolved evita mandar a onboarding a alguien que SÍ fue invitado pero cuya
  // invitación aún no terminaba de vincularse.
  const onboardingNotifiedRef = useRef(false);
  useEffect(() => {
    if (!ready || onboardingNotifiedRef.current || !onNeedsOnboarding) return;
    if (!isAuthenticated || myHouseholds === undefined || !invitesResolved) return; // still resolving
    // Only prompt a genuinely brand-new account: no hogar AND it has never dismissed
    // onboarding. Once they complete or skip it (flag set), never auto-reopen it —
    // that re-prompt-on-reload was perceived as a loop.
    const dismissed = typeof window !== "undefined" && Boolean(window.localStorage.getItem("rindomes.onboarded"));
    if ((myHouseholds ?? []).length === 0 && !householdId && !dismissed) {
      onboardingNotifiedRef.current = true;
      onNeedsOnboarding();
    }
  }, [ready, isAuthenticated, myHouseholds, invitesResolved, householdId, onNeedsOnboarding]);

  // El query del snapshot solo corre contra un hogar que sabemos legible: una
  // membresía confirmada, o (sin membresías) el hogar local legado en adopción.
  // Sin este freno, un householdId viejo en localStorage (p. ej. te quitaron del
  // hogar) hacía EXPLOTAR getHouseholdSnapshot y la app entera moría en blanco.
  const memberships = myHouseholds ?? [];
  const readableHouseholdId =
    householdId &&
    isAuthenticated &&
    myHouseholds !== undefined &&
    invitesResolved &&
    (memberships.some((h) => h.id === householdId) || memberships.length === 0)
      ? householdId
      : null;
  const snapshot = useQuery(
    api.finance.getHouseholdSnapshot,
    readableHouseholdId ? { householdId: readableHouseholdId as Id<"households"> } : "skip",
  );

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
    const empty = createEmptyState();
    // Con el email real de la sesión, la hidratación puede mapearte a TU persona
    // del hogar (si existe) en vez de asumir que eres members[0].
    const fallback = authEmail ? { ...empty, user: { ...empty.user, email: authEmail } } : empty;
    setState(stateFromConvexSnapshot(snapshot, fallback));
  }, [snapshot, ready, setState, authEmail]);

  // Solo se puede aprovisionar un hogar NUEVO (sin id) cuando ya sabemos que la
  // cuenta de verdad no tiene ninguno: membresías resueltas, invitaciones
  // reclamadas y cero hogares. Antes bastaba estar autenticado, así que el estado
  // local de un invitado podía guardarse como hogar nuevo ANTES de que su
  // invitación terminara de vincularse (la carrera que rompía las invitaciones).
  const canProvisionNewHousehold =
    isAuthenticated && invitesResolved && myHouseholds !== undefined && memberships.length === 0;

  // Write-through: debounced save of local changes to Convex.
  useEffect(() => {
    if (!ready || !canEdit) return;
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false;
      return;
    }
    // For an existing household, never save before the initial hydrate (would clobber
    // real data with stale local state). For a new household, only provision once
    // memberships are resolved and empty (see canProvisionNewHousehold).
    const canWrite = householdId ? hydratedRef.current : canProvisionNewHousehold;
    if (!canWrite) return;
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(function fire() {
      // Serialize saves: a snapshot in flight still carries the PREVIOUS version, so firing a
      // second one before it resolves self-conflicts (baseVersion goes stale the moment the
      // first save bumps the household version). One client must never race itself.
      if (saveInFlightRef.current) {
        saveTimerRef.current = window.setTimeout(fire, 300);
        return;
      }
      saveInFlightRef.current = true;
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
        } finally {
          saveInFlightRef.current = false;
        }
      })();
    }, 1200);
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
  }, [state, ready, canEdit, householdId, saveSnapshot, canProvisionNewHousehold]);

  return null;
}
