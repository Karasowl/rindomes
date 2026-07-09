"use client";

import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Bell,
  Bot,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  CreditCard,
  Download,
  FileSpreadsheet,
  Home,
  Info,
  Landmark,
  LayoutDashboard,
  Menu,
  MoreVertical,
  Plus,
  ReceiptText,
  Repeat,
  Settings,
  ShieldCheck,
  Sparkles,
  Target,
  Upload,
  UserRound,
  Users,
  WalletCards,
  X,
  type LucideIcon,
} from "lucide-react";
import { createContext, type Dispatch, type FormEvent, type ReactNode, type SetStateAction, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useAction, useConvexAuth, useConvex, useMutation, useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { applyAccountEffect } from "@/lib/account-effects";
import { accountKindLabel, aiActionKindLabel, aiActionStatusLabel, aiProviderLabel, currencyLabel, debtStrategyLabel, merchantDisplay, priorityLabel, receiptSourceLabel, receiptStatusLabel, recurringFrequencyLabel, reviewReasonLabel, roleLabel, spaceKindLabel, subscriptionPlanLabel, transactionStatusLabel, transactionTypeLabel } from "@/lib/labels";
import { ConvexSync, useSyncStatus } from "./convex-sync";
import { Onboarding } from "./onboarding";
import { AuthPanel } from "./auth-panel";
import { MembersPanel } from "./members-panel";
import { PaywallView } from "./paywall-view";
import { ReceiptCaptureView } from "./receipt-capture";
import { entitlementForAi, type AiCaptureResult, type EntitlementView, ENTITLEMENT_COPY } from "@/lib/entitlement";
import { receiptToInput, suggestionToInput, RECEIPT_TAG, RECEIPT_CREATED_BY } from "@/lib/capture-input";
import { advanceRecurringDate, defaultDateForMonth, endOfMonth, formatMonthLabel, nextMonthKey, prevMonthKey } from "@/lib/dates";
import { mergeMonthlyPlans, monthlyPlanId, monthlyPlansFromCategories, prepareMonthlyPlansForMonth, withMonthlyCategoryPlan } from "@/lib/planning";
import { isConvexConfigured } from "@/lib/convex-client";
import { LanguageToggle, useT } from "@/lib/i18n";
import { quoteExchangeRate, supportedCurrencies } from "@/lib/currency";
import { rebaseCurrency } from "@/lib/rebase-currency";
import { annualRows, categoryActualCents, categoryById, categoryUsage, formatMoney, groups, plannedCentsFor, recentTransactions, summarize, toCents, transactionsForMonth } from "@/lib/finance";
import { suggestFromNaturalText, type NaturalCaptureSuggestion } from "@/lib/natural-capture";
import { createEmptyState } from "@/lib/onboarding";
import type { AiAction, AiProvider, AppState, AttachmentRef, CurrencyCode, FamilyComment, GroupKey, Mode, NewTransactionInput, NotificationKind, ReceiptAttachment, RecurringFrequency, RuleApplication, Transaction, TransactionType, View } from "@/lib/types";

const nav: Array<{ view: View; label: string; icon: LucideIcon }> = [
  { view: "home", label: "Inicio", icon: Home },
  { view: "setup", label: "Primer mes", icon: Sparkles },
  { view: "spaces", label: "Espacios", icon: Building2 },
  { view: "plan", label: "Plan", icon: WalletCards },
  { view: "add", label: "Añadir", icon: Plus },
  { view: "ai", label: "IA", icon: Bot },
  { view: "receipts", label: "Recibos", icon: Upload },
  { view: "movements", label: "Movimientos", icon: ReceiptText },
  { view: "accounts", label: "Cuentas", icon: CreditCard },
  { view: "rules", label: "Reglas", icon: Repeat },
  { view: "review", label: "Revisión", icon: ClipboardList },
  { view: "networth", label: "Patrimonio", icon: Landmark },
  { view: "debts", label: "Deudas", icon: ShieldCheck },
  { view: "goals", label: "Metas", icon: Target },
  { view: "reports", label: "Reportes", icon: LayoutDashboard },
  { view: "family", label: "Familia", icon: Users },
  { view: "export", label: "Exportar", icon: Download },
  { view: "account", label: "Cuenta", icon: UserRound },
  { view: "settings", label: "Ajustes", icon: Settings },
  { view: "import", label: "Importar", icon: FileSpreadsheet },
];

const navByView = new Map(nav.map((item) => [item.view, item] as const));

// Desktop sidebar: a short "daily" tier is always visible; everything else lives under a
// collapsible "Más herramientas" section so the app reads as configure-once / use-daily
// instead of an overwhelming wall of 20 screens.
//
// The daily tier is deliberately the three things RindoMes is FOR — ver (Inicio, ahora
// fusionado con Insights), registrar (Añadir, la única entrada de captura) y revisar
// (Movimientos) — más Revisión para confirmar lo que la app preparó. El presupuesto
// (`plan`) baja a segundo plano: sigue disponible, pero deja de gobernar la app como en
// la hoja de cálculo vieja. Mobile keeps the flat `nav` bottom bar.
const primaryViews: View[] = ["home", "add", "movements", "review"];
const advancedGroups: Array<{ label: string; items: View[] }> = [
  { label: "Plan y patrimonio", items: ["plan", "reports", "networth", "debts", "goals"] },
  { label: "Cuentas y automatización", items: ["accounts", "rules", "receipts", "ai"] },
  { label: "Hogar y datos", items: ["family", "spaces", "import", "export"] },
  { label: "Sistema", items: ["setup", "account", "settings"] },
];
const advancedViews = new Set<View>(advancedGroups.flatMap((group) => group.items));

// Primary destinations for the mobile bottom bar (the rest live under "Más").
const mobilePrimary: View[] = ["home", "movements", "add", "review"];

const modeLabels: Record<Mode, string> = {
  tracker: "Seguimiento",
  "monthly-plan": "Plan mensual",
  zero: "Sobres / base cero",
};

// Render-site translators for module-level label constants (nav/modes/groups). The Spanish
// literals above stay as the canonical source; these return the active-language string when a
// component renders, using the shared t(es, en) helper passed in from useT().
type Translate = (es: string, en: string) => string;

function navLabel(view: View, t: Translate): string {
  switch (view) {
    case "home": return t("Inicio", "Home");
    case "setup": return t("Primer mes", "First month");
    case "spaces": return t("Espacios", "Spaces");
    case "plan": return t("Plan", "Plan");
    case "add": return t("Añadir", "Add");
    case "ai": return t("IA", "AI");
    case "receipts": return t("Recibos", "Receipts");
    case "movements": return t("Movimientos", "Transactions");
    case "accounts": return t("Cuentas", "Accounts");
    case "rules": return t("Reglas", "Rules");
    case "review": return t("Revisión", "Review");
    case "networth": return t("Patrimonio", "Net worth");
    case "debts": return t("Deudas", "Debts");
    case "goals": return t("Metas", "Goals");
    case "reports": return t("Reportes", "Reports");
    case "family": return t("Familia", "Family");
    case "export": return t("Exportar", "Export");
    case "account": return t("Cuenta", "Account");
    case "settings": return t("Ajustes", "Settings");
    case "import": return t("Importar", "Import");
    default: return navByView.get(view)?.label ?? view;
  }
}

function modeLabel(mode: Mode, t: Translate): string {
  switch (mode) {
    case "tracker": return t("Seguimiento", "Tracking");
    case "monthly-plan": return t("Plan mensual", "Monthly plan");
    case "zero": return t("Sobres / base cero", "Envelopes / zero-based");
    default: return modeLabels[mode];
  }
}

function advancedGroupLabel(label: string, t: Translate): string {
  switch (label) {
    case "Plan y patrimonio": return t("Plan y patrimonio", "Plan & net worth");
    case "Cuentas y automatización": return t("Cuentas y automatización", "Accounts & automation");
    case "Patrimonio": return t("Patrimonio", "Net worth");
    case "Hogar y datos": return t("Hogar y datos", "Household & data");
    case "Sistema": return t("Sistema", "System");
    default: return label;
  }
}

const localStateStorageKey = "rindomes.localState.v1";

interface AppNotification {
  id: string;
  kind: NotificationKind;
  label: string;
  title: string;
  subtitle: string;
  action: string;
  view: View;
  tone?: "default" | "danger";
}

type ToastTone = "success" | "error" | "info";

interface ToastItem {
  id: string;
  message: string;
  tone: ToastTone;
  visible: boolean;
}

interface ToastContextValue {
  notify: (message: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastContextValue>({ notify: () => {} });

function useToast() {
  return useContext(ToastContext);
}

function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const notify = useCallback((message: string, tone: ToastTone = "info") => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setToasts((current) => [...current, { id, message, tone, visible: true }].slice(-6));
    window.setTimeout(() => {
      setToasts((current) => current.map((toast) => toast.id === id ? { ...toast, visible: false } : toast));
    }, 3200);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 3500);
  }, []);

  return (
    <ToastContext.Provider value={{ notify }}>
      {children}
      <ToastViewport toasts={toasts} />
    </ToastContext.Provider>
  );
}

function ToastViewport({ toasts }: { toasts: ToastItem[] }) {
  const visibleToasts = toasts.slice(-3);

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-5 left-1/2 z-50 flex w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 flex-col gap-2 md:bottom-6 md:left-auto md:right-6 md:w-96 md:max-w-none md:translate-x-0"
    >
      {visibleToasts.map((toast) => {
        const Icon = toast.tone === "success" ? CheckCircle2 : toast.tone === "error" ? AlertTriangle : Info;
        const toneClass = toast.tone === "success" ? "text-[var(--primary)]" : toast.tone === "error" ? "text-[var(--danger)]" : "text-[var(--text-muted)]";
        return (
          <div
            className={`pointer-events-auto flex items-start gap-3 rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm font-semibold text-[var(--foreground)] shadow-[var(--shadow)] backdrop-blur-xl transition-all duration-200 ${toast.visible ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"}`}
            key={toast.id}
            role="status"
          >
            <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${toneClass}`} />
            <span>{toast.message}</span>
          </div>
        );
      })}
    </div>
  );
}

function NavButton({ viewKey, active, onClick }: { viewKey: View; active: boolean; onClick: () => void }) {
  const { t } = useT();
  const item = navByView.get(viewKey)!;
  const Icon = item.icon;
  return (
    <button
      className={`flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-[13px] transition ${
        active
          ? "bg-[var(--lime)] font-bold text-black shadow-sm"
          : "text-[var(--on-dark-muted)] hover:bg-white/10 hover:text-[var(--on-dark)]"
      }`}
      onClick={onClick}
      type="button"
    >
      <Icon className={`h-4 w-4 shrink-0 ${active ? "text-black" : "text-[var(--on-dark-subtle)]"}`} />
      <span className="truncate">{navLabel(viewKey, t)}</span>
    </button>
  );
}

// When the cloud is configured, account-first: nobody reaches the app without a real
// Convex Auth session, so every hogar is tied to an account and follows the user across
// devices (no anonymous data trapped in one browser). In local-only mode (no Convex URL)
// the app runs without the gate.
const convexConfigured = isConvexConfigured();

export function RindoMesApp() {
  if (!convexConfigured) return <AppShell />;
  return <AuthGate />;
}

function AuthGate() {
  const { t } = useT();
  const { isLoading, isAuthenticated } = useConvexAuth();
  const currentUser = useQuery(api.finance.currentUser, isAuthenticated ? {} : "skip");
  if (isLoading) {
    return (
      <main className="grain mesh-bg flex min-h-screen items-center justify-center px-5 text-base font-semibold text-[var(--ink)]">
        {t("Cargando tu sesión…", "Loading your session…")}
      </main>
    );
  }
  if (!isAuthenticated) return <AuthLanding />;
  return <AppShell authed authEmail={(currentUser?.email as string | undefined) ?? ""} />;
}

function AuthLanding() {
  const { t } = useT();
  return (
    <main className="grain mesh-bg flex min-h-screen flex-col items-center justify-center px-5 py-10 text-[var(--ink)]">
      <div className="w-full max-w-sm">
        <div className="text-center">
          <Landmark className="mx-auto h-9 w-9 text-[var(--primary)]" />
          <h1 className="serif mt-6 text-5xl font-bold italic tracking-tight">RindoMes</h1>
          <p className="mt-4 text-lg text-[var(--text-muted)]">
            {t("Tus finanzas en la nube, sincronizadas en el celular y la computadora.", "Your finances in the cloud, synced across your phone and computer.")}
          </p>
        </div>
        <div className="mt-8">
          <AuthPanel />
        </div>
      </div>
    </main>
  );
}

// The cloud-bound surface the gated views consume. All of it requires a live ConvexProvider, so it
// is produced ONLY inside <CloudBindings/> (rendered when Convex is configured). In local-only mode
// (no provider) `cloud` is null and every gated view falls back to the manual path — never crashes.
interface CloudBindings {
  entitlement: EntitlementView | null;
  uploadAttachment: (file: File | Blob, fileName: string) => Promise<AttachmentRef>;
  getReceiptUrl: (a: { attachmentId: Id<"attachments"> }) => Promise<string | null>;
  onLinkReceipt: (attachmentId: Id<"attachments">, txId: string) => void;
  parseReceipt: (a: { householdId: Id<"households">; attachmentId: Id<"attachments"> }) => Promise<AiCaptureResult>;
  startProUpgrade: (a: { householdId: Id<"households"> }) => Promise<{ status: string; message: string }>;
}

// Calls every Convex hook the gated views need and lifts a stable bundle up to AppShell. Mounted
// only when Convex is configured (so the hooks always run inside a provider). It renders nothing.
// Mirrors the onHouseholdId lift in ConvexSync: the hooks live here, the values flow up via a
// stable callback. The effect re-emits when the bound functions or the reactive entitlement change.
function CloudBindings({
  householdId,
  onBindings,
}: {
  householdId: string | null;
  onBindings: (b: CloudBindings) => void;
}) {
  const entitlement = useQuery(
    api.entitlement.getEntitlement,
    householdId ? { householdId: householdId as Id<"households"> } : "skip",
  ) as EntitlementView | null | undefined;

  const convexClient = useConvex();
  const generateReceiptUploadUrl = useMutation(api.receipts.generateReceiptUploadUrl);
  const registerReceipt = useMutation(api.receipts.registerReceipt);
  const linkReceiptToTransactionMutation = useMutation(api.receipts.linkReceiptToTransaction);
  const parseReceiptWithAI = useAction(api.ai.parseReceiptWithAI);
  const startProUpgradeMutation = useMutation(api.entitlement.startProUpgrade);

  // uploadAttachment: the real file pipeline the receipt-capture view consumes.
  //   1) ask the server for a one-time upload URL,
  //   2) POST the raw bytes (Content-Type = the file's type) — the response is { storageId },
  //   3) register an authoritative attachments row (status 'uploaded') with that storageId,
  //   4) return an AttachmentRef carrying both the _storage pointer AND the attachments row id
  //      (the additive `attachmentId` field the receipt-capture view reads to enable AI/preview).
  // Throws on any failure so the view shows an honest error and falls back to manual review.
  const uploadAttachment = useCallback(
    async (file: File | Blob, fileName: string): Promise<AttachmentRef> => {
      if (!householdId) {
        throw new Error("No hay un hogar en la nube todavía. Captura el recibo a mano.");
      }
      const hid = householdId as Id<"households">;
      const contentType = file.type || contentTypeFromFileName(fileName);
      const uploadUrl = await generateReceiptUploadUrl({ householdId: hid });
      const response = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": contentType },
        body: file,
      });
      if (!response.ok) {
        throw new Error("No se pudo subir el archivo al almacenamiento. Inténtalo de nuevo.");
      }
      const { storageId } = (await response.json()) as { storageId: Id<"_storage"> };
      const attachmentId = await registerReceipt({
        householdId: hid,
        storageId,
        fileName,
        contentType,
        source: "receipt",
      });
      // AttachmentRef + the additive attachmentId the receipt-capture view reads structurally.
      return { fileName, storageId, contentType, attachmentId } as AttachmentRef;
    },
    [householdId, generateReceiptUploadUrl, registerReceipt],
  );

  // getReceiptUrl: imperative per-attachment signed-URL resolver for the review preview.
  const getReceiptUrl = useCallback(
    (a: { attachmentId: Id<"attachments"> }) =>
      convexClient.query(api.receipts.getReceiptUrl, a),
    [convexClient],
  );

  // onLinkReceipt: confirm the receipt<->transaction link server-side (status 'confirmed').
  // Best-effort: the file pointer already survives via attachmentRefs/storageId on the saved tx.
  const onLinkReceipt = useCallback(
    (attachmentId: Id<"attachments">, txId: string) => {
      void linkReceiptToTransactionMutation({
        attachmentId,
        transactionId: txId as Id<"transactions">,
      }).catch(() => {});
    },
    [linkReceiptToTransactionMutation],
  );

  const startProUpgrade = useCallback(
    (a: { householdId: Id<"households"> }) => startProUpgradeMutation(a),
    [startProUpgradeMutation],
  );

  useEffect(() => {
    onBindings({
      entitlement: entitlement ?? null,
      uploadAttachment,
      getReceiptUrl,
      onLinkReceipt,
      parseReceipt: parseReceiptWithAI,
      startProUpgrade,
    });
  }, [entitlement, uploadAttachment, getReceiptUrl, onLinkReceipt, parseReceiptWithAI, startProUpgrade, onBindings]);

  return null;
}

function AppShell(props: { authed?: boolean; authEmail?: string }) {
  return (
    <ToastProvider>
      <AppShellContent {...props} />
    </ToastProvider>
  );
}

function AppShellContent({ authed = false, authEmail = "" }: { authed?: boolean; authEmail?: string }) {
  const { t } = useT();
  const { notify } = useToast();
  const [state, setState] = useState<AppState>(() => createEmptyState());
  const [view, setView] = useState<View>("home");
  const [viewHistory, setViewHistory] = useState<View[]>([]);
  const [localStateReady, setLocalStateReady] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingRelaunched, setOnboardingRelaunched] = useState(false);
  const [addInitialType, setAddInitialType] = useState<TransactionType>("expense");
  const [showAdvanced, setShowAdvanced] = useState(false);

  // The active cloud household, lifted out of ConvexSync via onHouseholdId. It is the seam
  // every gated Convex action needs (entitlement / receipts / AI). `null` means local-only
  // mode (no cloud household yet) — gated views render the manual path, never crash.
  const [householdId, setHouseholdId] = useState<string | null>(null);

  // The bound Convex surface, produced by <CloudBindings/> (only when Convex is configured). Null
  // in local-only mode — every gated view falls back to the manual path. A stable setter keeps the
  // CloudBindings effect from re-firing on identity churn.
  const [cloud, setCloud] = useState<CloudBindings | null>(null);
  const entitlement = cloud?.entitlement ?? null;

  // AppShell-level wrappers over the cloud surface, with honest manual fallbacks when the cloud is
  // not available (local-only mode or before CloudBindings has emitted). These are what the gated
  // views receive, so the views never see a raw Convex hook and never crash without a provider.
  const uploadAttachment = useCallback(
    (file: File | Blob, fileName: string): Promise<AttachmentRef> => {
      if (!cloud) {
        return Promise.reject(new Error(t("No hay un hogar en la nube todavía. Captura el recibo a mano.", "There's no cloud household yet. Capture the receipt manually.")));
      }
      return cloud.uploadAttachment(file, fileName);
    },
    [cloud, t],
  );
  const getReceiptUrl = useCallback(
    (a: { attachmentId: Id<"attachments"> }): Promise<string | null> =>
      cloud ? cloud.getReceiptUrl(a) : Promise.resolve(null),
    [cloud],
  );
  const onLinkReceipt = useCallback(
    (attachmentId: Id<"attachments">, txId: string) => {
      cloud?.onLinkReceipt(attachmentId, txId);
    },
    [cloud],
  );
  const parseReceipt = useCallback(
    (a: { householdId: Id<"households">; attachmentId: Id<"attachments"> }) => {
      if (!cloud) {
        return Promise.resolve({ ok: false as const, code: "ai_off" as const, error: ENTITLEMENT_COPY.reasonAiOff });
      }
      return cloud.parseReceipt(a);
    },
    [cloud],
  );

  // App-level navigation with a back stack so nested flows always have a way back.
  function navigate(next: View, options?: { initialType?: TransactionType }) {
    if (next === "setup") {
      setOnboardingRelaunched(true);
      setShowOnboarding(true); // "Primer mes" opens the guided wizard full-screen
      return;
    }
    if (next === "add") setAddInitialType(options?.initialType ?? "expense");
    if (next !== view) setViewHistory((stack) => [...stack, view].slice(-30));
    setView(next);
  }

  function goBack() {
    if (!viewHistory.length) return;
    setView(viewHistory[viewHistory.length - 1]);
    setViewHistory((stack) => stack.slice(0, -1));
  }
  const [permissionMessage, setPermissionMessage] = useState("");
  const summary = useMemo(() => summarize(state), [state]);
  const usage = useMemo(() => categoryUsage(state), [state]);
  const currentMember = currentWorkspaceMember(state);
  // In cloud mode a user only reaches AppShell after real Convex Auth, so they are a
  // signed-in owner and may edit — the local user.status pseudo-session no longer gates it.
  const canEdit = authed || canEditWorkspace(state);
  // createEmptyState scaffolds zero-amount plans for the starter categories, so bare
  // monthlyPlans.length would flag a pristine account as "has data" and scare-warn on setup.
  const hasExistingSetupData = state.transactions.length > 0 || state.monthlyPlans.some((plan) => plan.plannedCents > 0);

  // Whether the paid AI capture is actually usable. The server query is authoritative when
  // present; otherwise we fall back to the local advisory gate. We also need a real cloud
  // household (the gated actions require it). When false we hide/disable paid-AI affordances but
  // ALWAYS keep the manual path and the free "Adivinar con reglas (gratis)" available.
  const aiCanUse = entitlement
    ? entitlement.canUseAi && entitlement.aiEnabled
    : entitlementForAi(state).allowed;
  const aiAvailable = convexConfigured && !!householdId && aiCanUse;

  const guardedSetState: Dispatch<SetStateAction<AppState>> = (action) => {
    if (!canEdit) {
      setPermissionMessage(t("Tu sesion esta en solo lectura. Cambia a propietario/editor para modificar este workspace.", "Your session is read-only. Switch to owner or editor to make changes to this workspace."));
      return;
    }
    setPermissionMessage("");
    setState(action);
  };

  useEffect(() => {
    const storedState = readLocalState();
    const onboardingFlag = window.localStorage.getItem("rindomes.onboarded");
    const hasHousehold = Boolean(window.localStorage.getItem("rindomes.convex.householdId"));
    const timer = window.setTimeout(() => {
      if (storedState) {
        setState(storedState);
      } else if (!onboardingFlag && !hasHousehold && !convexConfigured) {
        // Local-only mode: a fresh user with no cache goes straight to onboarding.
        // In cloud mode the decision is deferred to ConvexSync, which only opens
        // onboarding once it confirms the signed-in account has no hogar yet —
        // so a returning user on a new device hydrates their data instead of
        // being sent through setup again.
        setShowOnboarding(true);
      }
      setLocalStateReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  function completeOnboarding(next: AppState) {
    window.localStorage.setItem("rindomes.onboarded", "1");
    setState(next);
    setShowOnboarding(false);
    setOnboardingRelaunched(false);
    setView("home");
  }

  function skipOnboarding() {
    window.localStorage.setItem("rindomes.onboarded", "skip");
    setShowOnboarding(false);
    setOnboardingRelaunched(false);
    setView("home");
  }

  useEffect(() => {
    if (!localStateReady) return;
    writeLocalState(state);
  }, [localStateReady, state]);

  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    if (window.location.hostname === "localhost") return;
    // When a new service worker takes control (after a deploy), reload once so the user
    // always lands on the fresh build instead of a stale cached one. Skip the very first
    // install (no previous controller) so we don't reload on a brand-new visit.
    let refreshing = false;
    const hadController = Boolean(navigator.serviceWorker.controller);
    const onControllerChange = () => {
      if (refreshing || !hadController) return;
      refreshing = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    void navigator.serviceWorker.register("/sw.js").then((registration) => {
      void registration.update();
    }).catch(() => {});
    return () => navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
  }, []);

  function addTransaction(input: NewTransactionInput) {
    if (!confirmClosedMonthChange(state, input.date)) return false;
    if (!canEdit) {
      setPermissionMessage(t("Tu sesion esta en solo lectura. No puedes guardar movimientos en este workspace.", "Your session is read-only. You can't save transactions in this workspace."));
      setView("account");
      return false;
    }

    const category = state.categories.find((item) => item.id === input.categoryId) ?? state.categories[0];
    const tags = input.tags.split(",").map((tag) => tag.trim()).filter(Boolean);
    // Receipt-sourced inputs (tagged 'recibo' by receiptToInput) keep the 'Recibo' provenance the
    // old createMovementFromReceipt path stamped; everything else is authored by the signed-in user.
    const fromReceipt = tags.includes(RECEIPT_TAG);
    const author = fromReceipt ? RECEIPT_CREATED_BY : (state.user.name?.trim() || "Yo");
    const id = `tx-${Date.now()}`;
    const createdAt = new Date().toISOString();
    const amountCents = toCents(input.amount);
    const tx: Transaction = {
      id,
      type: category.group === "income" ? "income" : input.type,
      date: input.date,
      description: input.description || category.name,
      categoryId: category.id,
      subcategory: input.subcategory || category.subcategories[0],
      accountId: input.accountId,
      transferAccountId: input.type === "transfer" ? input.transferAccountId : undefined,
      linkedTransactionId: input.linkedTransactionId || undefined,
      linkKind: input.type === "refund" ? "refund" : input.linkKind,
      merchant: input.merchant,
      tags,
      note: input.note,
      originalAmountCents: amountCents,
      originalCurrency: input.currency,
      amountCents: Math.round(amountCents * input.exchangeRate),
      baseCurrency: state.currency,
      exchangeRate: input.exchangeRate,
      exchangeRateDate: input.exchangeRateDate,
      exchangeRateSource: input.exchangeRateSource,
      status: input.needsReview ? "needs_review" : "approved",
      createdBy: author,
      attachmentNames: input.attachmentNames,
      // Itemized factura lines parsed at capture (optional + additive). Carried onto the
      // Transaction so the movement detail can list "Productos" and the convex-adapter
      // round-trips them; undefined for movements captured without itemization.
      lineItems: input.lineItems && input.lineItems.length ? input.lineItems : undefined,
      audit: [movementAudit("created", fromReceipt ? t("Movimiento creado desde un recibo.", "Transaction created from a receipt.") : t("Movimiento creado desde captura manual.", "Transaction created from manual entry."), author, createdAt)],
    };
    // Build the ReceiptAttachment rows. When the input carries real uploaded files
    // (attachmentRefs), set storageId + contentType on the created receipt so the file pointer
    // survives the next autosave (the plan's HIGHEST risk). attachmentRefs is keyed by fileName;
    // fall back to the filename-only shape for manual attachments.
    const refByName = new Map<string, AttachmentRef>(
      (input.attachmentRefs ?? []).map((ref) => [ref.fileName, ref] as const),
    );
    const receipts: ReceiptAttachment[] = input.attachmentNames.map((fileName, index) => {
      const ref = refByName.get(fileName);
      return {
        id: `receipt-${id}-${index}`,
        fileName,
        contentType: ref?.contentType ?? contentTypeFromFileName(fileName),
        source: "receipt",
        status: tx.status === "approved" ? "confirmed" : "needs_review",
        createdAt: new Date().toISOString().slice(0, 10),
        transactionId: id,
        amountCents: tx.originalAmountCents,
        currency: tx.originalCurrency,
        date: tx.date,
        merchant: tx.merchant,
        extractedText: tx.note,
        note: tx.description,
        // The real file pointer (Convex _storage). Without this the round-trip drops the file.
        storageId: ref?.storageId,
      };
    });
    setState((current) => ({
      ...current,
      accounts: tx.status === "approved" ? applyAccountEffect(current.accounts, tx, 1) : current.accounts,
      transactions: [tx, ...current.transactions],
      receipts: [...receipts, ...current.receipts],
      review: tx.status === "needs_review"
        ? [
            {
              id: `review-${id}`,
              reason: "ai_suggestion",
              title: tx.description,
              subtitle: t("Movimiento marcado para confirmar categoria o detalle", "Transaction flagged to confirm its category or details"),
              amountCents: -tx.amountCents,
              action: t("Revisar", "Review"),
              targetType: "transaction",
              targetId: id,
            },
            ...current.review,
          ]
        : current.review,
    }));
    navigate(input.afterSaveView ?? "movements");
    return true;
  }

  function resetLocalData() {
    clearLocalState();
    window.localStorage.removeItem("rindomes.onboarded");
    setState(createEmptyState(state.currency));
    setView("home");
    setOnboardingRelaunched(false);
    setShowOnboarding(true);
  }

  if (showOnboarding) {
    return (
      <Onboarding
        currency={state.currency}
        activeMonth={state.activeMonth}
        onComplete={completeOnboarding}
        onSkip={skipOnboarding}
        relaunched={onboardingRelaunched}
        hasExistingData={hasExistingSetupData}
        onExit={() => {
          setShowOnboarding(false);
          setOnboardingRelaunched(false);
          setView("home");
        }}
      />
    );
  }

  return (
    <main className="grain mesh-bg min-h-screen pb-28 text-[var(--ink)]">
      {convexConfigured && (
        <>
          <ConvexSync
            state={state}
            setState={setState}
            ready={localStateReady}
            canEdit={canEdit}
            onNeedsOnboarding={() => {
              setOnboardingRelaunched(false);
              setShowOnboarding(true);
            }}
            onHouseholdId={setHouseholdId}
            notify={notify}
          />
          {/* Produces the bound Convex surface (entitlement + receipts/AI helpers) only inside the
              provider; lifts it up via setCloud (a stable setState dispatcher). */}
          <CloudBindings householdId={householdId} onBindings={setCloud} />
        </>
      )}
      <TopBar state={state} setView={navigate} canGoBack={viewHistory.length > 0} onBack={goBack} authed={authed} authEmail={authEmail} showSyncStatus={convexConfigured && authed} onChangeMonth={(month) => guardedSetState((current) => ({ ...current, activeMonth: month }))} />
      <div className="mx-auto grid w-full max-w-[1280px] gap-6 px-5 pb-12 pt-5 md:grid-cols-[244px_minmax(0,1fr)] md:px-12 lg:px-16">
        {/* Panel tinta-oliva: el ancla oscura del layout. Sobre él, el item activo lima por fin
            se LEE como activo (sobre crema, lima apenas se distinguía de un chip blanco). */}
        <aside className="app-scrollbar sticky top-24 hidden h-[calc(100vh-6.5rem)] flex-col gap-1.5 overflow-y-auto rounded-3xl bg-[var(--ink-olive)] p-2.5 shadow-lg md:flex">
          <div className="flex flex-col gap-0.5">
            {primaryViews.map((viewKey) => (
              <NavButton key={viewKey} viewKey={viewKey} active={view === viewKey} onClick={() => navigate(viewKey)} />
            ))}
          </div>
          <button
            className="mt-1 flex items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--on-dark-subtle)] transition hover:bg-white/10 hover:text-[var(--on-dark-muted)]"
            onClick={() => setShowAdvanced((open) => !open)}
            type="button"
            aria-expanded={showAdvanced || advancedViews.has(view)}
          >
            {t("Más herramientas", "More tools")}
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showAdvanced || advancedViews.has(view) ? "rotate-180" : ""}`} />
          </button>
          {(showAdvanced || advancedViews.has(view)) &&
            advancedGroups.map((group) => (
              <div className="flex flex-col gap-0.5" key={group.label}>
                <p className="px-3 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--on-dark-subtle)]">{advancedGroupLabel(group.label, t)}</p>
                {group.items.map((viewKey) => (
                  <NavButton key={viewKey} viewKey={viewKey} active={view === viewKey} onClick={() => navigate(viewKey)} />
                ))}
              </div>
            ))}
        </aside>
        <section className="min-w-0">
          {permissionMessage && (
            <div className="mb-4 rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm font-semibold text-[var(--danger)]">
              {permissionMessage}
            </div>
          )}
          {!authed && state.user.status === "signed_out" && view !== "account" && (
            <div className="mb-4 rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm text-[var(--foreground)]">
              {t("Estas usando RindoMes sin sesion. Crea o inicia una cuenta local para guardar identidad, permisos y sincronizacion futura con Convex.", "You're using RindoMes without signing in. Create or sign in to a local account to save your identity, permissions, and future Convex sync.")}
              <button className="ml-3 font-bold text-[var(--primary)]" onClick={() => navigate("account")} type="button">{t("Abrir cuenta", "Open account")}</button>
            </div>
          )}
          {!authed && currentMember?.role === "viewer" && view !== "account" && (
            <div className="mb-4 rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm text-[var(--foreground)]">
              {t(`Vista de solo lectura para ${currentMember.name}. Puedes consultar y exportar, pero no cambiar datos financieros.`, `Read-only view for ${currentMember.name}. You can browse and export, but not change financial data.`)}
            </div>
          )}
          {view === "home" && <HomeView state={state} summary={summary} usage={usage} setView={navigate} onAddIncome={() => navigate("add", { initialType: "income" })} onChangeMonth={(month) => guardedSetState((current) => ({ ...current, activeMonth: month }))} />}
          {view === "setup" && <SetupView state={state} setState={guardedSetState} setView={navigate} />}
          {view === "spaces" && <SpacesView state={state} setState={guardedSetState} />}
          {view === "plan" && <PlanView state={state} usage={usage} summary={summary} setState={guardedSetState} />}
          {view === "add" && <AddMovementView state={state} onSave={addTransaction} setView={navigate} initialType={addInitialType} />}
          {view === "ai" && <AIView state={state} setState={guardedSetState} onSave={addTransaction} aiAvailable={aiAvailable} onOpenPaywall={() => navigate("paywall")} />}
          {view === "receipts" && <ReceiptsView state={state} setState={guardedSetState} setView={navigate} onSave={addTransaction} uploadAttachment={uploadAttachment} householdId={householdId} />}
          {view === "movements" && <MovementsView state={state} setState={guardedSetState} setView={navigate} />}
          {view === "accounts" && <AccountsView state={state} setState={guardedSetState} setView={navigate} />}
          {view === "rules" && <RulesView state={state} setState={guardedSetState} />}
          {view === "review" && <ReviewView state={state} setState={guardedSetState} />}
          {view === "networth" && <NetWorthView state={state} setState={guardedSetState} />}
          {view === "debts" && <DebtsView state={state} setState={guardedSetState} />}
          {view === "goals" && <GoalsView state={state} setState={guardedSetState} />}
          {view === "reports" && <ReportsView state={state} usage={usage} summary={summary} setState={guardedSetState} />}
          {view === "family" && <FamilyView state={state} setState={guardedSetState} />}
          {view === "export" && <ExportView state={state} />}
          {view === "account" && <AccountView state={state} setState={setState} authed={authed} />}
          {view === "settings" && <SettingsView state={state} setState={guardedSetState} convexConfigured={isConvexConfigured()} onResetLocal={resetLocalData} entitlement={entitlement ?? null} onOpenPaywall={() => navigate("paywall")} />}
          {view === "import" && <ImportView state={state} setState={guardedSetState} />}
          {view === "receipt-capture" && (
            <ReceiptCaptureView
              state={state}
              householdId={householdId as Id<"households"> | null}
              // Use the SERVER-authoritative "can use AI" (Pro + AI on), not the local toggle,
              // so an entitled user always gets the real AI read instead of an empty manual form.
              aiEnabled={aiCanUse}
              uploadAttachment={uploadAttachment}
              parseReceipt={parseReceipt}
              getReceiptUrl={getReceiptUrl}
              onSave={addTransaction}
              onLinkReceipt={onLinkReceipt}
              onOpenPaywall={() => navigate("paywall")}
              setView={navigate}
            />
          )}
          {view === "paywall" && (
            <PaywallView
              entitlement={entitlement ?? null}
              onStartCheckout={async () => {
                // Honest stub: with no cloud household (or no cloud at all) we cannot start a real
                // checkout, so we return the same "not configured" message the server would.
                if (!cloud || !householdId) {
                  return { status: "checkout_not_configured", message: ENTITLEMENT_COPY.checkoutNotConfigured };
                }
                return await cloud.startProUpgrade({ householdId: householdId as Id<"households"> });
              }}
              onContinueManual={() => navigate("add")}
              setView={navigate}
            />
          )}
        </section>
      </div>
      <MobileNav view={view} setView={navigate} />
    </main>
  );
}

function MonthSwitcher({ month, onChange }: { month: string; onChange: (month: string) => void }) {
  const { t } = useT();
  const lang = t("es", "en") as "es" | "en";
  // Mes real "ahora": si el mes activo no es este, mostramos un botón "Hoy" para volver, y así
  // el usuario nunca queda atrapado viendo un mes viejo sin darse cuenta.
  const now = new Date();
  const realMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const onCurrent = month === realMonth;

  // Popover propio (NO el selector nativo del navegador, que rompía el diseño de la app):
  // navegación de año + grilla de meses, estilada con los tokens de la app.
  const [open, setOpen] = useState(false);
  const [activeYear, activeMonthIdx] = month.split("-").map(Number) as [number, number];
  // Año que se está navegando dentro del popover (independiente del mes activo hasta elegir).
  const [viewYear, setViewYear] = useState(activeYear);
  // Reabrir siempre sobre el año del mes activo.
  useEffect(() => {
    if (open) setViewYear(activeYear);
  }, [open, activeYear]);

  const monthNames = lang === "es"
    ? ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]
    : ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const [realYear, realMonthIdx] = realMonth.split("-").map(Number) as [number, number];

  function pick(monthIndex: number) {
    onChange(`${viewYear}-${String(monthIndex + 1).padStart(2, "0")}`);
    setOpen(false);
  }

  return (
    <div className="flex shrink-0 items-center gap-0.5 rounded-full border border-white/70 bg-[var(--surface-soft)] px-1 py-1 shadow-sm backdrop-blur">
      <button
        type="button"
        aria-label={t("Mes anterior", "Previous month")}
        onClick={() => onChange(prevMonthKey(month))}
        className="grid h-7 w-7 place-items-center rounded-full text-[var(--text-muted)] transition hover:bg-white"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={t("Elegir mes", "Pick month")}
          className="flex items-center gap-1 whitespace-nowrap rounded-full px-1.5 py-0.5 text-sm font-bold text-[var(--primary)] transition hover:bg-white"
        >
          <span>{formatMonthLabel(month, lang)}</span>
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
        {open && (
          <>
            {/* Capa para cerrar al hacer clic fuera. */}
            <button
              type="button"
              aria-hidden
              tabIndex={-1}
              className="fixed inset-0 z-40 cursor-default"
              onClick={() => setOpen(false)}
            />
            <div
              role="dialog"
              aria-label={t("Elegir mes", "Pick month")}
              className="absolute left-1/2 top-[calc(100%+0.5rem)] z-50 w-64 -translate-x-1/2 rounded-2xl border border-[var(--line)] bg-white p-3 shadow-xl"
            >
              {/* Navegación de año */}
              <div className="flex items-center justify-between px-1">
                <button
                  type="button"
                  aria-label={t("Año anterior", "Previous year")}
                  onClick={() => setViewYear((y) => y - 1)}
                  className="grid h-7 w-7 place-items-center rounded-full text-[var(--text-muted)] transition hover:bg-slate-100"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="text-sm font-bold text-[var(--ink)]">{viewYear}</span>
                <button
                  type="button"
                  aria-label={t("Año siguiente", "Next year")}
                  onClick={() => setViewYear((y) => y + 1)}
                  className="grid h-7 w-7 place-items-center rounded-full text-[var(--text-muted)] transition hover:bg-slate-100"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
              {/* Grilla de meses */}
              <div className="mt-2 grid grid-cols-3 gap-1.5">
                {monthNames.map((name, idx) => {
                  const isActive = viewYear === activeYear && idx === activeMonthIdx - 1;
                  const isReal = viewYear === realYear && idx === realMonthIdx - 1;
                  return (
                    <button
                      key={name}
                      type="button"
                      onClick={() => pick(idx)}
                      aria-current={isActive ? "true" : undefined}
                      className={`rounded-xl py-2 text-[13px] font-semibold transition ${
                        isActive
                          ? "bg-[var(--lime)] text-black shadow-sm"
                          : isReal
                            ? "text-[var(--primary)] ring-1 ring-inset ring-[var(--primary)] hover:bg-slate-50"
                            : "text-[var(--text-muted)] hover:bg-slate-100"
                      }`}
                    >
                      {name}
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
      <button
        type="button"
        aria-label={t("Mes siguiente", "Next month")}
        onClick={() => onChange(nextMonthKey(month))}
        className="grid h-7 w-7 place-items-center rounded-full text-[var(--text-muted)] transition hover:bg-white"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
      {!onCurrent && (
        <button
          type="button"
          onClick={() => onChange(realMonth)}
          className="ml-0.5 rounded-full bg-[var(--lime)] px-2.5 py-1 text-[11px] font-bold text-black transition hover:brightness-95"
          aria-label={t("Ir al mes actual", "Go to current month")}
        >
          {t("Hoy", "Today")}
        </button>
      )}
    </div>
  );
}

function TopBar({
  state,
  setView,
  canGoBack,
  onBack,
  authed = false,
  authEmail = "",
  showSyncStatus = false,
  onChangeMonth,
}: {
  state: AppState;
  setView: (view: View) => void;
  canGoBack: boolean;
  onBack: () => void;
  authed?: boolean;
  authEmail?: string;
  showSyncStatus?: boolean;
  onChangeMonth: (month: string) => void;
}) {
  const { t } = useT();
  const signedIn = authed || state.user.status === "signed_in";
  const accountLabel = authed ? (authEmail || state.user.name || t("Cuenta", "Account")) : (state.user.status === "signed_in" ? state.user.name : t("Inicia sesión", "Sign in"));
  const [open, setOpen] = useState(false);
  const notifications = buildNotifications(state, t);

  function openNotification(view: View) {
    setView(view);
    setOpen(false);
  }

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--line)] bg-[rgba(254,248,245,0.9)] px-5 py-4 backdrop-blur-xl md:px-16">
      <div className="mx-auto flex max-w-[1280px] items-center justify-between">
        <div className="flex items-center gap-3">
          {canGoBack && (
            <button
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white text-[var(--foreground)] shadow-sm transition hover:bg-white"
              onClick={onBack}
              type="button"
              aria-label={t("Atrás", "Back")}
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
          )}
          <div className="grid h-10 w-10 place-items-center rounded-full bg-[var(--ink-olive)] text-sm font-bold text-[var(--lime)] shadow-sm">RM</div>
          <h1 className="serif hidden text-3xl font-bold italic tracking-tight sm:block md:text-4xl">RindoMes</h1>
        </div>
        {/* Selector de mes GLOBAL: la app trabaja por mes, así que ver y cambiar el mes vive en la
            cabecera, visible en todas las vistas. Todo lo derivado usa state.activeMonth, así que
            cambiarlo recalcula cada pantalla. */}
        <MonthSwitcher month={state.activeMonth} onChange={onChangeMonth} />
        <div className="flex items-center gap-2">
          <LanguageToggle />
          {showSyncStatus && <SyncStatusChip />}
          <button className="hidden max-w-[180px] rounded-full bg-[var(--surface-soft)] px-4 py-2 text-left text-xs font-semibold text-[var(--foreground)] transition hover:bg-white md:block" onClick={() => setView("account")} type="button">
            <span className="block text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{signedIn ? t("Sesión", "Session") : t("Sin sesión", "Signed out")}</span>
            <span className="block truncate">{accountLabel}</span>
          </button>
        <div className="relative">
          <button className="relative rounded-full p-2 transition hover:bg-[var(--surface-muted)]" onClick={() => setOpen((current) => !current)} type="button" aria-label={t("Notificaciones", "Notifications")}>
            <Bell className="h-5 w-5" />
            {notifications.length > 0 && (
              <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-[var(--warning-bar)] px-1 text-[10px] font-bold text-white">
                {notifications.length}
              </span>
            )}
          </button>
          {open && (
            <div className="absolute right-0 mt-3 w-[min(360px,calc(100vw-40px))] rounded-3xl border border-white/80 bg-[rgba(254,248,245,0.96)] p-4 shadow-2xl backdrop-blur-2xl">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="kicker">{t("Centro de alertas", "Alerts center")}</p>
                  <h2 className="serif mt-1 text-2xl font-bold">{notifications.length ? t(`${notifications.length} pendientes`, `${notifications.length} pending`) : t("Todo al día", "All caught up")}</h2>
                </div>
                <button className="rounded-full bg-white px-3 py-1 text-xs font-bold" onClick={() => setOpen(false)} type="button">{t("Cerrar", "Close")}</button>
              </div>
              <div className="mt-4 grid gap-3">
                {notifications.map((notification) => (
                  <button className="rounded-2xl bg-[var(--surface-soft)] p-4 text-left transition hover:bg-white" key={notification.id} onClick={() => openNotification(notification.view)} type="button">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className={`text-xs font-bold uppercase tracking-[0.16em] ${notification.tone === "danger" ? "text-[var(--warning)]" : "text-[var(--primary)]"}`}>{notification.label}</p>
                        <h3 className="mt-1 font-semibold">{notification.title}</h3>
                        <p className="mt-1 text-sm text-[var(--text-muted)]">{notification.subtitle}</p>
                      </div>
                      <span className="rounded-full bg-[var(--lime)] px-3 py-1 text-xs font-bold text-black">{notification.action}</span>
                    </div>
                  </button>
                ))}
                {!notifications.length && <p className="rounded-2xl border border-dashed border-[var(--line)] p-4 text-sm text-[var(--text-muted)]">{t("No hay revisiones, recibos, cierres ni reglas pendientes.", "No pending reviews, receipts, closings, or rules.")}</p>}
              </div>
            </div>
          )}
        </div>
        </div>
      </div>
    </header>
  );
}

function SyncStatusChip() {
  const { t } = useT();
  const sync = useSyncStatus();

  const label = sync.status === "saving"
    ? t("Guardando...", "Saving...")
    : sync.status === "offline_error"
      ? t("Sin conexión", "Offline")
      : sync.status === "conflict"
        ? t("Conflicto", "Conflict")
        : t("Guardado", "Saved");
  const dotClass = sync.status === "saving"
    ? "bg-amber-500 animate-pulse"
    : sync.status === "offline_error" || sync.status === "conflict"
      ? "bg-[var(--danger)]"
      : "bg-green-600";
  const showText = sync.status !== "idle";

  return (
    <div aria-atomic="true" aria-live="polite" className="inline-flex h-8 items-center gap-2 rounded-full bg-[var(--surface-soft)] px-2.5 text-xs font-semibold text-[var(--text-muted)]" role="status" aria-label={label} title={label}>
      <span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 rounded-full ${dotClass}`} />
      {showText && <span className="hidden whitespace-nowrap md:inline">{label}</span>}
    </div>
  );
}

function MobileNav({ view, setView }: { view: View; setView: (view: View) => void }) {
  const { t } = useT();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreItems = nav.filter((item) => !mobilePrimary.includes(item.view));

  return (
    <>
      {moreOpen && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/30 backdrop-blur-sm md:hidden" onClick={() => setMoreOpen(false)}>
          <div className="w-full rounded-t-3xl border-t border-white/80 bg-[rgba(254,248,245,0.97)] p-5 pb-8 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="serif text-2xl font-bold">{t("Todas las vistas", "All views")}</h2>
              <button className="grid h-9 w-9 place-items-center rounded-full bg-white text-[var(--foreground)] shadow-sm transition hover:bg-[var(--surface-soft)]" onClick={() => setMoreOpen(false)} type="button" aria-label={t("Cerrar", "Close")}>
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {moreItems.map((item) => {
                const Icon = item.icon;
                const active = view === item.view;
                return (
                  <button
                    className={`flex flex-col items-center gap-1.5 rounded-2xl p-3 text-[11px] transition ${active ? "bg-[rgba(204,255,0,0.3)] font-semibold text-[var(--primary)]" : "text-[var(--text-muted)] hover:bg-[var(--surface-muted)]"}`}
                    key={item.view}
                    onClick={() => { setView(item.view); setMoreOpen(false); }}
                    type="button"
                  >
                    <Icon className="h-5 w-5" />
                    <span className="text-center leading-tight">{navLabel(item.view, t)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
      <nav className="fixed bottom-5 left-1/2 z-40 grid w-[92%] max-w-md -translate-x-1/2 grid-cols-5 items-center rounded-full bg-[rgba(35,43,19,0.96)] px-2 py-2 shadow-2xl backdrop-blur-xl md:hidden">
        {(["home", "movements", "add", "review", "more"] as const).map((slot) => {
          if (slot === "add") {
            return (
              <div className="flex justify-center" key="add">
                <button
                  className="-mt-8 grid h-14 w-14 place-items-center rounded-full bg-[var(--lime)] text-black shadow-lg shadow-[rgba(80,102,0,0.35)] active:scale-95"
                  onClick={() => setView("add")}
                  type="button"
                  aria-label={t("Añadir", "Add")}
                >
                  <Plus className="h-6 w-6" />
                </button>
              </div>
            );
          }
          if (slot === "more") {
            return (
              <button
                className={`flex flex-col items-center gap-0.5 text-[10px] ${moreOpen ? "font-semibold text-[var(--lime)]" : "text-[var(--on-dark-muted)]"}`}
                key="more"
                onClick={() => setMoreOpen(true)}
                type="button"
                aria-expanded={moreOpen}
              >
                <Menu className="h-5 w-5" />
                {t("Más", "More")}
              </button>
            );
          }
          const item = navByView.get(slot)!;
          const Icon = item.icon;
          const active = view === slot;
          const label = slot === "movements" ? t("Movs", "Txns") : slot === "review" ? t("Revisar", "Review") : navLabel(slot, t);
          return (
            <button
              className={`flex flex-col items-center gap-0.5 text-[10px] ${active ? "font-semibold text-[var(--lime)]" : "text-[var(--on-dark-muted)]"}`}
              key={slot}
              onClick={() => setView(slot)}
              type="button"
            >
              <Icon className="h-5 w-5" />
              {label}
            </button>
          );
        })}
      </nav>
    </>
  );
}

function HomeView({
  state,
  summary,
  usage,
  setView,
  onAddIncome,
  onChangeMonth,
}: {
  state: AppState;
  summary: ReturnType<typeof summarize>;
  usage: ReturnType<typeof categoryUsage>;
  setView: (view: View) => void;
  onAddIncome: () => void;
  onChangeMonth: (month: string) => void;
}) {
  const { t } = useT();
  const lang = t("es", "en") as "es" | "en";
  // Contexto temporal: ¿estoy viendo un mes futuro o un mes pasado vacío? Sin esto, saltar a un
  // mes sin datos muestra todo en cero sin explicar por qué.
  const realMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
  const isFutureMonth = state.activeMonth > realMonth;
  const monthTransactions = transactionsForMonth(state, state.activeMonth);
  const monthHasData = monthTransactions.length > 0;
  const recentMonthTransactions = recentTransactions(monthTransactions);
  const approved = monthTransactions.filter((transaction) => transaction.status === "approved");

  // Gastos reales del mes (sin transferencias ni ingresos). La descripción literal de cada
  // movimiento es la fuente del "exactamente de qué fue" que la hoja de cálculo perdía.
  const expenseTxns = approved.filter((transaction) => {
    const category = categoryById(state.categories, transaction.categoryId);
    return transaction.type !== "transfer" && category != null && category.group !== "income";
  });

  // En qué se va la plata: top categorías por GASTO REAL (no por % de presupuesto), cada una
  // con su movimiento más grande para que se vea el detalle concreto, no solo la categoría.
  const topSpending = [...usage]
    .filter((item) => item.spent > 0)
    .sort((a, b) => b.spent - a.spent)
    .slice(0, 5)
    .map((item) => {
      const inCategory = expenseTxns.filter((transaction) => transaction.categoryId === item.id);
      const biggest = [...inCategory].sort((a, b) => b.amountCents - a.amountCents)[0];
      return { id: item.id, name: item.name, spent: item.spent, count: inCategory.length, detail: biggest?.description ?? "" };
    });
  const topSpent = topSpending.reduce((sum, item) => sum + item.spent, 0) || 1;

  // El gasto más grande del mes, con su texto literal.
  const biggestExpense = [...expenseTxns].sort((a, b) => b.amountCents - a.amountCents)[0];

  // Tendencia: este mes vs. el promedio de los meses anteriores con datos. Mira hasta 3 meses
  // hacia atrás CRUZANDO el cambio de año (antes solo comparaba dentro del año en curso, así que
  // enero se quedaba sin comparación). Reusa annualRows por año para que el gasto salga correcto
  // (incluye splits/reembolsos).
  const priorMonthKeys: string[] = [];
  let cursorMonth = state.activeMonth;
  for (let i = 0; i < 3; i++) {
    cursorMonth = prevMonthKey(cursorMonth);
    priorMonthKeys.push(cursorMonth);
  }
  const rowsByYear = new Map(Array.from(new Set(priorMonthKeys.map((key) => key.slice(0, 4)))).map((y) => [y, annualRows(state, y)] as const));
  const priorOutflows = priorMonthKeys
    .map((key) => rowsByYear.get(key.slice(0, 4))?.[Number(key.slice(5, 7)) - 1])
    .filter((row): row is NonNullable<typeof row> => Boolean(row) && row!.transactionCount > 0)
    .map((row) => row.outflow);
  const avgOutflow = priorOutflows.length ? Math.round(priorOutflows.reduce((sum, value) => sum + value, 0) / priorOutflows.length) : 0;
  const trendPct = avgOutflow > 0 ? (summary.outflow - avgOutflow) / avgOutflow : 0;
  const spentShare = summary.income > 0 ? summary.outflow / summary.income : 0;
  const usesSpendingPlanHeadline = state.mode === "monthly-plan" && summary.plannedOutflow > 0;
  const headlineCents = usesSpendingPlanHeadline ? summary.plannedOutflow - summary.outflow : summary.remainder;
  const headlineNegative = headlineCents < 0;
  // El kicker dice el ESTADO en palabras y el número da la magnitud, siempre en positivo
  // para el modo plan ("TE PASASTE DEL PLAN · $7,320" y no "PUEDES GASTAR TODAVÍA ·
  // -$7,320", que era una contradicción). La línea de abajo muestra la cuenta.
  const headlineKicker = usesSpendingPlanHeadline
    ? headlineNegative
      ? t("TE PASASTE DEL PLAN", "OVER YOUR PLAN")
      : t("PUEDES GASTAR TODAVÍA", "LEFT TO SPEND")
    : t("BALANCE DEL MES", "MONTH BALANCE");
  const headlineAmountCents = usesSpendingPlanHeadline ? Math.abs(headlineCents) : headlineCents;
  const headlineExplainer = usesSpendingPlanHeadline
    ? t(`Plan de gastos ${formatMoney(summary.plannedOutflow, state.currency)} − gastado ${formatMoney(summary.outflow, state.currency)}`, `Spending plan ${formatMoney(summary.plannedOutflow, state.currency)} − spent ${formatMoney(summary.outflow, state.currency)}`)
    : t(`Ingresos ${formatMoney(summary.income, state.currency)} − gastos ${formatMoney(summary.outflow, state.currency)}`, `Income ${formatMoney(summary.income, state.currency)} − spending ${formatMoney(summary.outflow, state.currency)}`);
  const incomeRow = summary.plannedIncome > 0
    ? t(`Ingresos del mes: ${formatMoney(summary.income, state.currency)} de ${formatMoney(summary.plannedIncome, state.currency)} esperados`, `Month income: ${formatMoney(summary.income, state.currency)} of ${formatMoney(summary.plannedIncome, state.currency)} expected`)
    : t(`Ingresos del mes: ${formatMoney(summary.income, state.currency)}`, `Month income: ${formatMoney(summary.income, state.currency)}`);

  // Observaciones en lenguaje claro, todas derivadas de los datos reales de arriba.
  const observations: string[] = [];
  if (biggestExpense) {
    observations.push(t(
      `Tu mayor gasto del mes fue ${formatMoney(biggestExpense.amountCents, state.currency)}: ${biggestExpense.description}.`,
      `Your biggest expense this month was ${formatMoney(biggestExpense.amountCents, state.currency)}: ${biggestExpense.description}.`,
    ));
  }
  if (avgOutflow > 0 && Math.abs(trendPct) >= 0.1) {
    observations.push(trendPct > 0
      ? t(`Llevas ${Math.round(trendPct * 100)}% más de gasto que tu promedio mensual (${formatMoney(avgOutflow, state.currency)}).`, `You're spending ${Math.round(trendPct * 100)}% more than your monthly average (${formatMoney(avgOutflow, state.currency)}).`)
      : t(`Vas ${Math.round(Math.abs(trendPct) * 100)}% por debajo de tu promedio mensual (${formatMoney(avgOutflow, state.currency)}).`, `You're ${Math.round(Math.abs(trendPct) * 100)}% below your monthly average (${formatMoney(avgOutflow, state.currency)}).`));
  }
  if (summary.income > 0) {
    observations.push(t(`Has gastado el ${Math.round(spentShare * 100)}% de tus ingresos de este mes.`, `You've spent ${Math.round(spentShare * 100)}% of this month's income.`));
  }
  if (summary.savingsRate > 0) {
    observations.push(t(`Tu tasa de ahorro del mes va en ${Math.round(summary.savingsRate * 100)}%.`, `Your savings rate this month is ${Math.round(summary.savingsRate * 100)}%.`));
  }

  return (
    <div className="grid gap-5">
      {/* Contexto cuando ves un mes futuro, o un mes pasado sin movimientos: explica por qué está
          en cero y ofrece volver al mes actual (en vez de dejar al usuario confundido). */}
      {(isFutureMonth || (state.activeMonth !== realMonth && !monthHasData)) && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--lime)] bg-[rgba(204,255,0,0.14)] px-5 py-3.5 text-sm">
          <span className="font-medium text-[var(--foreground)]">
            {isFutureMonth
              ? t(`Estás viendo ${formatMonthLabel(state.activeMonth, lang)}, un mes que aún no llega. Lo que registres con esa fecha aparecerá aquí.`, `You're viewing ${formatMonthLabel(state.activeMonth, lang)}, a month that hasn't arrived yet. Anything dated then will show up here.`)
              : t(`No hubo movimientos en ${formatMonthLabel(state.activeMonth, lang)}.`, `No transactions in ${formatMonthLabel(state.activeMonth, lang)}.`)}
          </span>
          <button type="button" onClick={() => onChangeMonth(realMonth)} className="shrink-0 rounded-full bg-[var(--lime)] px-4 py-1.5 text-xs font-bold text-black transition hover:brightness-95">
            {t(`Ir a ${formatMonthLabel(realMonth, lang)}`, `Go to ${formatMonthLabel(realMonth, lang)}`)}
          </button>
        </div>
      )}
      {/* Hero en tinta-oliva: el ancla emocional del Inicio. El número vive sobre oscuro
          (crema si vas bien, ámbar si te pasaste — el rojo queda para errores de verdad). */}
      <section className="overflow-hidden rounded-3xl bg-[var(--ink-olive)] px-6 py-9 text-center text-[var(--on-dark)] shadow-lg">
        <p className="kicker text-[var(--lime)]">{headlineKicker}</p>
        <h2 className={`amount serif mx-auto mt-2 max-w-full break-words text-[clamp(2.25rem,6vw,4.5rem)] font-bold leading-none tracking-tight ${headlineNegative ? "text-[var(--warning-on-dark)]" : "text-[var(--on-dark)]"}`}>{formatMoney(headlineAmountCents, state.currency)}</h2>
        <p className="mx-auto mt-3 max-w-2xl text-sm font-semibold text-[var(--on-dark-muted)]">{headlineExplainer}</p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-4 py-1.5 text-xs font-semibold text-[var(--on-dark-muted)]">
            <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-[var(--lime)]" />
            <span className="min-w-0 truncate">{incomeRow}</span>
          </span>
          <button className="shrink-0 rounded-full bg-white/15 px-3.5 py-1.5 text-xs font-bold text-[var(--on-dark)] transition hover:bg-white/25" onClick={onAddIncome} type="button">
            {t("Registrar ingreso", "Add income")}
          </button>
        </div>
        <div className="mt-3 inline-flex max-w-full items-center gap-1.5 rounded-full border border-[rgba(204,255,0,0.28)] bg-[rgba(204,255,0,0.1)] px-4 py-1.5 text-xs font-semibold text-[var(--lime)]">
          <ArrowDownLeft className="h-3.5 w-3.5" />
          <span className="amount min-w-0 truncate">{t(`${formatMoney(summary.outflow, state.currency)} en gastos este mes`, `${formatMoney(summary.outflow, state.currency)} spent this month`)}</span>
        </div>
        {/* Una sola entrada de captura: registrar es la acción protagonista del Inicio. */}
        <div className="mt-6 flex justify-center">
          <button className="inline-flex items-center gap-2 rounded-full bg-[var(--lime)] px-7 py-3 text-base font-bold text-black shadow-lg transition hover:-translate-y-0.5" onClick={() => setView("add")} type="button">
            <Plus className="h-5 w-5" />
            {t("Registrar gasto o ingreso", "Record expense or income")}
          </button>
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-12">
        {/* Insights · en qué se va tu plata (con el detalle real, no solo la categoría). */}
        <Card className="lg:col-span-7">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="kicker">{formatMonthLabel(state.activeMonth, t("es", "en") as "es" | "en")} · {modeLabel(state.mode, t)}</p>
              <h3 className="serif mt-1 text-xl font-bold">{t("En qué se va tu plata", "Where your money goes")}</h3>
            </div>
            <button className="shrink-0 rounded-full bg-white px-3.5 py-1.5 text-xs font-bold text-[var(--primary)] shadow-sm transition hover:bg-[var(--surface-soft)]" onClick={() => setView("reports")} type="button">
              {t("Ver reportes", "Reports")}
            </button>
          </div>
          <div className="mt-4 space-y-3.5">
            {topSpending.map((item) => (
              <div key={item.id}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate font-semibold">{item.name}</span>
                  <span className="amount shrink-0 whitespace-nowrap text-base font-bold">{formatMoney(item.spent, state.currency)}</span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--surface-soft)]">
                  <div className="h-full rounded-full bg-[var(--primary)]" style={{ width: `${Math.min(100, Math.round((item.spent / topSpent) * 100))}%` }} />
                </div>
                {/* Si la descripción del mayor movimiento es literalmente el nombre de la categoría
                    ("comida · el mayor: comida"), repetirla es ruido: mostramos solo el conteo. */}
                {item.detail && item.detail.trim().toLowerCase() !== item.name.trim().toLowerCase() ? (
                  <p className="mt-1 truncate text-xs text-[var(--text-muted)]">{item.count > 1 ? t(`${item.count} movs · el mayor: ${item.detail}`, `${item.count} txns · biggest: ${item.detail}`) : item.detail}</p>
                ) : item.count > 1 ? (
                  <p className="mt-1 truncate text-xs text-[var(--text-muted)]">{t(`${item.count} movimientos`, `${item.count} transactions`)}</p>
                ) : null}
              </div>
            ))}
            {!topSpending.length && (
              <EmptyState title={t("Aún no hay gastos", "No expenses yet")} subtitle={t("Registra tus gastos y aquí verás, en lenguaje claro, exactamente en qué se va tu dinero.", "Record your expenses and you'll see here, in plain language, exactly where your money goes.")}>
                <button className="rounded-full bg-[var(--lime)] px-5 py-2.5 text-sm font-bold text-black transition hover:brightness-95" onClick={() => setView("add")} type="button">{t("Registrar el primero", "Record the first one")}</button>
              </EmptyState>
            )}
          </div>
        </Card>

        {/* Insights · lo que la app nota por ti, en lenguaje claro. */}
        <Card className="lg:col-span-5">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-[var(--primary)]" />
            <h3 className="serif text-xl font-bold">{t("Lo que nota la app", "What the app notices")}</h3>
          </div>
          <div className="mt-4 space-y-2.5">
            {observations.map((text, index) => (
              <div className="rounded-2xl bg-[var(--surface-soft)] p-4 text-sm font-medium text-[var(--foreground)]" key={index}>{text}</div>
            ))}
            {!observations.length && (
              <EmptyState title={t("Aún sin lecturas", "Nothing to read yet")} subtitle={t("Con unos cuantos movimientos la app empieza a decirte qué es inusual, qué se repite y dónde podrías ajustar.", "With a few transactions the app starts telling you what's unusual, what repeats, and where you could adjust.")} />
            )}
          </div>
        </Card>

        <Card className="lg:col-span-7">
          <SectionHeader title={t("Movimientos recientes", "Recent transactions")} action={t("Ver todos", "View all")} onAction={() => setView("movements")} />
          {recentMonthTransactions.length ? (
            <div className="mt-1"><TransactionList state={state} transactions={recentMonthTransactions} /></div>
          ) : (
            <div className="mt-4">
              <EmptyState title={t("Registra tu primer movimiento", "Record your first transaction")} subtitle={t("Registra tus ingresos y gastos para ver tu situación financiera actualizada.", "Record your income and expenses to see your finances update in real time.")}>
                <button className="rounded-full bg-[var(--lime)] px-5 py-2.5 text-sm font-bold text-black transition hover:brightness-95" onClick={() => setView("add")} type="button">{t("Añadir movimiento", "Add transaction")}</button>
                <button className="rounded-full bg-white px-5 py-2.5 text-sm font-bold text-[var(--primary)] shadow-sm transition hover:bg-[var(--surface-soft)]" onClick={() => setView("import")} type="button">{t("Importar datos", "Import data")}</button>
              </EmptyState>
            </div>
          )}
        </Card>

        <Card className="lg:col-span-5">
          <SectionHeader title={t("Necesita tu atención", "Needs your attention")} action={t("Abrir", "Open")} onAction={() => setView("review")} />
          <div className="mt-4 space-y-2.5">
            {state.review.slice(0, 3).map((item) => (
              <div className="rounded-2xl bg-[var(--surface-soft)] p-4" key={item.id}>
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">{reviewReasonLabel(item.reason)}</p>
                <div className="mt-1.5 flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate font-semibold">{item.title}</span>
                  <span className="amount shrink-0 whitespace-nowrap text-base font-bold">{formatMoney(item.amountCents, state.currency)}</span>
                </div>
              </div>
            ))}
            {!state.review.length && (
              <EmptyState title={t("Sin pendientes", "Nothing pending")} subtitle={t("Los recibos, duplicados y sugerencias aparecerán aquí para que confirmes antes de que afecten tu mes.", "Receipts, duplicates, and suggestions will appear here for you to confirm before they affect your month.")} />
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

function SetupView({
  state,
  setState,
  setView,
}: {
  state: AppState;
  setState: Dispatch<SetStateAction<AppState>>;
  setView: (view: View) => void;
}) {
  const { t } = useT();
  // The active month is always the current month — pre-filled and read-only so it never
  // becomes a decision the user has to make on the very first screen.
  const currentMonth = state.activeMonth || new Date().toISOString().slice(0, 7);
  // First decision: how much to set up now. "simple" creates a clean month with sensible
  // defaults; "full" also lets the user name the account and (optionally) seed a budget.
  const [path, setPath] = useState<"simple" | "full">("simple");
  // The base budget is opt-in even on the full path: most people just want to start.
  const [showBudget, setShowBudget] = useState(false);
  const [draft, setDraft] = useState({
    householdName: state.householdName,
    ownerName: state.members[0]?.name ?? "",
    currency: state.currency,
    activeMonth: currentMonth,
    mode: state.mode,
    useCase: "familia",
    accountName: state.accounts[0]?.name ?? "Cuenta principal",
    accountKind: "bank" as AppState["accounts"][number]["kind"],
    openingBalance: "",
    expectedIncome: "",
    housingPlan: "",
    foodPlan: "",
    transportPlan: "",
  });
  const plannedOutflow = toCents(draft.housingPlan) + toCents(draft.foodPlan) + toCents(draft.transportPlan);
  const plannedIncome = toCents(draft.expectedIncome);

  function createMonth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const householdName = draft.householdName.trim() || "Mi hogar";
    const ownerName = draft.ownerName.trim() || "Propietario";
    const currency = draft.currency as CurrencyCode;
    const activeMonth = draft.activeMonth || new Date().toISOString().slice(0, 7);
    const accountId = `account-${slugify(draft.accountName || "principal")}`;
    const categories = createStarterCategories({
      income: toCents(draft.expectedIncome),
      housing: toCents(draft.housingPlan),
      food: toCents(draft.foodPlan),
      transport: toCents(draft.transportPlan),
    });

    setState((current) => ({
      ...current,
      user: {
        ...current.user,
        name: ownerName,
        avatar: initialsForName(ownerName),
        status: "signed_in",
        provider: "local",
        currentMemberId: "m-owner",
        lastLoginAt: new Date().toISOString(),
      },
      activeSpaceId: `space-${slugify(householdName)}`,
      spaces: [
        {
          id: `space-${slugify(householdName)}`,
          name: householdName,
          kind: draft.useCase === "negocio" ? "business" : draft.useCase === "personal" ? "personal" : draft.useCase === "prueba" ? "test" : "family",
          currency,
          activeMonth,
          role: "owner",
          memberCount: 1,
          createdAt: new Date().toISOString().slice(0, 10),
          updatedAt: new Date().toISOString().slice(0, 10),
        },
      ],
      householdName,
      currency,
      activeMonth,
      mode: draft.mode as Mode,
      accounts: [
        {
          id: accountId,
          name: draft.accountName.trim() || "Cuenta principal",
          kind: draft.accountKind,
          balanceCents: toCents(draft.openingBalance),
          currency,
        },
      ],
      categories,
      monthlyPlans: monthlyPlansFromCategories(categories, activeMonth),
      transactions: [],
      comments: [],
      receipts: [],
      review: [],
      recurringRules: [],
      automationRules: [],
      ruleApplications: [],
      goals: [],
      debts: [],
      netWorth: [
        {
          id: `nw-${accountId}`,
          name: draft.accountName.trim() || "Cuenta principal",
          kind: toCents(draft.openingBalance) >= 0 ? "asset" : "liability",
          group: draft.accountKind === "investment" ? "investment" : draft.accountKind === "credit" ? "debt" : "bank",
          amountCents: Math.abs(toCents(draft.openingBalance)),
        },
      ],
      members: [
        {
          id: "m-owner",
          name: ownerName,
          role: "owner",
          avatar: initialsForName(ownerName),
          email: current.user.email,
        },
      ],
      monthClosings: [],
    }));
    setView("plan");
  }

  function startSimple() {
    const currency = draft.currency as CurrencyCode;
    const ownerName = draft.ownerName.trim() || "Propietario";
    const activeMonth = draft.activeMonth || new Date().toISOString().slice(0, 7);
    const categories = createStarterCategories({ income: 0, housing: 0, food: 0, transport: 0 });
    setState((current) => ({
      ...current,
      user: {
        ...current.user,
        name: ownerName,
        avatar: initialsForName(ownerName),
        status: "signed_in",
        provider: "local",
        currentMemberId: "m-owner",
        lastLoginAt: new Date().toISOString(),
      },
      activeSpaceId: `space-${slugify(draft.householdName || "mi-hogar")}`,
      spaces: [
        {
          id: `space-${slugify(draft.householdName || "mi-hogar")}`,
          name: draft.householdName.trim() || "Mi hogar",
          kind: "personal",
          currency,
          activeMonth,
          role: "owner",
          memberCount: 1,
          createdAt: new Date().toISOString().slice(0, 10),
          updatedAt: new Date().toISOString().slice(0, 10),
        },
      ],
      householdName: draft.householdName.trim() || "Mi hogar",
      currency,
      activeMonth,
      mode: "tracker",
      accounts: [{ id: "cash", name: "Efectivo", kind: "cash", balanceCents: 0, currency }],
      categories,
      monthlyPlans: monthlyPlansFromCategories(categories, activeMonth),
      transactions: [],
      comments: [],
      receipts: [],
      review: [],
      recurringRules: [],
      automationRules: [],
      ruleApplications: [],
      goals: [],
      debts: [],
      netWorth: [],
      members: [{ id: "m-owner", name: ownerName, role: "owner", avatar: initialsForName(ownerName), email: current.user.email }],
      monthClosings: [],
    }));
    setView("add");
  }

  return (
    <ViewShell title={t("Crear primer mes", "Create your first month")} eyebrow={t("Primer mes", "First month")} description={t("Crea tu primer mes en segundos.", "Set up your first month in seconds.")}>
      <form className="grid gap-5" onSubmit={createMonth}>
        {/* First decision, up top: how much to set up now. */}
        <Card>
          <div className="grid gap-3 sm:grid-cols-2">
            {([
              { id: "simple", title: t("Empezar simple", "Start simple"), hint: t("Mes limpio con valores por defecto.", "A clean month with sensible defaults.") },
              { id: "full", title: t("Crear mes y plan", "Create month and plan"), hint: t("Nombra la cuenta y, si quieres, define un presupuesto base.", "Name your account and, if you'd like, set a base budget.") },
            ] as const).map((option) => {
              const selected = path === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setPath(option.id)}
                  className={`flex items-start gap-3 rounded-2xl border p-4 text-left transition ${selected ? "border-[var(--primary)] bg-[rgba(204,255,0,0.12)]" : "border-[var(--line)] bg-[var(--surface-soft)] hover:bg-white"}`}
                  aria-pressed={selected}
                >
                  <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 ${selected ? "border-[var(--primary)]" : "border-slate-300"}`} aria-hidden="true">
                    {selected && <span className="h-2.5 w-2.5 rounded-full bg-[var(--primary)]" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block font-bold">{option.title}</span>
                    <span className="mt-1 block text-sm text-[var(--text-muted)]">{option.hint}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </Card>

        <Card>
          <div className="grid gap-4 md:grid-cols-2">
            <Input label={t("Nombre del espacio", "Space name")} value={draft.householdName} onChange={(value) => setDraft((current) => ({ ...current, householdName: value }))} placeholder={t("Personal, familia, negocio", "Personal, family, business")} />
            <Input label={t("Propietario", "Owner")} value={draft.ownerName} onChange={(value) => setDraft((current) => ({ ...current, ownerName: value }))} placeholder={t("Tu nombre", "Your name")} />
            <Select label={t("Moneda base", "Base currency")} value={draft.currency} options={supportedCurrencies} render={currencyLabel} onChange={(value) => setDraft((current) => ({ ...current, currency: value as CurrencyCode }))} />
            <label className="grid gap-2 text-sm font-semibold">
              {t("Mes activo", "Active month")}
              <input className="field bg-[var(--surface-soft)] text-[var(--text-muted)]" value={draft.activeMonth} readOnly aria-readonly="true" />
            </label>
          </div>
          <details className="mt-4">
            <summary className="cursor-pointer select-none text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-subtle)]">{t("Configuración avanzada", "Advanced settings")}</summary>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <Select label={t("Tipo de uso", "Use case")} value={draft.useCase} options={["personal", "familia", "negocio", "prueba"]} render={(value) => labelForUseCase(value)} onChange={(value) => setDraft((current) => ({ ...current, useCase: value }))} />
              <Select label={t("Modo inicial", "Starting mode")} value={draft.mode} options={["tracker", "monthly-plan", "zero"]} render={(value) => modeLabel(value as Mode, t)} onChange={(value) => setDraft((current) => ({ ...current, mode: value as Mode }))} />
            </div>
          </details>
        </Card>

        {path === "full" && (
          <Card>
            <h3 className="serif text-xl font-bold">{t("Cuenta inicial", "Starting account")}</h3>
            <div className="mt-5 grid gap-4 md:grid-cols-3">
              <Input label={t("Cuenta", "Account")} value={draft.accountName} onChange={(value) => setDraft((current) => ({ ...current, accountName: value }))} placeholder={t("Banco principal, efectivo", "Main bank, cash")} />
              <Select label={t("Tipo", "Type")} value={draft.accountKind} options={["cash", "bank", "credit", "savings", "investment"]} render={accountKindLabel} onChange={(value) => setDraft((current) => ({ ...current, accountKind: value as typeof draft.accountKind }))} />
              <Input label={t("Saldo inicial", "Opening balance")} value={draft.openingBalance} onChange={(value) => setDraft((current) => ({ ...current, openingBalance: value }))} placeholder="0.00" />
            </div>
          </Card>
        )}

        {path === "full" && (
          <Card>
            <label className="flex cursor-pointer items-center gap-3 text-sm font-semibold">
              <input type="checkbox" className="h-4 w-4 accent-[var(--primary)]" checked={showBudget} onChange={(event) => setShowBudget(event.target.checked)} />
              {t("Añadir presupuesto base", "Add a base budget")}
            </label>
            {showBudget && (
              <>
                <p className="mt-3 text-sm text-[var(--text-muted)]">{t("Las demás categorías se crean en $0 y las ajustas cuando quieras.", "Every other category starts at $0, and you can adjust them whenever you like.")}</p>
                <div className="mt-5 grid grid-cols-2 gap-4 md:grid-cols-4">
                  <Input label={t("Ingreso esperado", "Expected income")} value={draft.expectedIncome} onChange={(value) => setDraft((current) => ({ ...current, expectedIncome: value }))} placeholder="0.00" />
                  <Input label={t("Hogar", "Housing")} value={draft.housingPlan} onChange={(value) => setDraft((current) => ({ ...current, housingPlan: value }))} placeholder="0.00" />
                  <Input label={t("Comida", "Food")} value={draft.foodPlan} onChange={(value) => setDraft((current) => ({ ...current, foodPlan: value }))} placeholder="0.00" />
                  <Input label={t("Transporte", "Transport")} value={draft.transportPlan} onChange={(value) => setDraft((current) => ({ ...current, transportPlan: value }))} placeholder="0.00" />
                </div>
                <div className="mt-6 grid gap-4 md:grid-cols-3">
                  <Metric label={t("Ingreso plan", "Planned income")} value={formatMoney(plannedIncome, draft.currency)} />
                  <Metric label={t("Gasto plan", "Planned spending")} value={formatMoney(plannedOutflow, draft.currency)} />
                  <Metric label={t("Sin asignar", "Unassigned")} value={formatMoney(plannedIncome - plannedOutflow, draft.currency)} tone={plannedIncome - plannedOutflow < 0 ? "bad" : "good"} />
                </div>
              </>
            )}
          </Card>
        )}

        <div className="grid gap-3">
          {path === "simple" ? (
            <button className="rounded-2xl bg-[var(--lime)] px-6 py-4 text-sm font-bold text-black" onClick={startSimple} type="button">{t("Empezar simple", "Start simple")}</button>
          ) : (
            <button className="rounded-2xl bg-[var(--lime)] px-6 py-4 text-sm font-bold text-black" type="submit">{t("Crear mes y plan", "Create month and plan")}</button>
          )}
        </div>
      </form>
    </ViewShell>
  );
}

function SpacesView({ state, setState }: { state: AppState; setState: Dispatch<SetStateAction<AppState>> }) {
  const { t } = useT();
  const activeSpace = state.spaces.find((space) => space.id === state.activeSpaceId) ?? state.spaces[0];
  const limits = subscriptionUsage(state);
  const canAddMembers = state.subscription.plan === "pro" || state.members.length < state.subscription.membersLimit;

  function activateSpace(id: string) {
    const space = state.spaces.find((item) => item.id === id);
    if (!space) return;

    setState((current) => ({
      ...current,
      activeSpaceId: id,
      householdName: space.name,
      currency: space.currency,
      activeMonth: space.activeMonth,
      spaces: current.spaces.map((item) => item.id === id ? { ...item, updatedAt: new Date().toISOString().slice(0, 10) } : item),
    }));
  }

  function setPlan(plan: AppState["subscription"]["plan"]) {
    setState((current) => ({
      ...current,
      subscription: plan === "pro"
        ? { ...current.subscription, plan, aiCreditsLimit: 500, storageMbLimit: 2048, spacesLimit: 20, membersLimit: 10 }
        : { ...current.subscription, plan, aiCreditsLimit: 25, storageMbLimit: 100, spacesLimit: 2, membersLimit: 2 },
    }));
  }

  const visibleSpaces = state.spaces.filter((space) => !space.archived);

  return (
    <ViewShell title={t("Espacios y plan", "Spaces and plan")} eyebrow={activeSpace?.name ?? state.householdName} description={t("Gestiona espacios y conoce tus límites de plan.", "Manage your spaces and keep an eye on your plan limits.")}>
      <Card>
        <div className="grid grid-cols-2 gap-4">
          <Metric label={t("Espacios", "Spaces")} value={`${limits.spacesUsed}/${limits.spacesLimit}`} tone={limits.spacesUsed >= limits.spacesLimit ? "bad" : undefined} />
          <Metric label={t("Miembros", "Members")} value={`${limits.membersUsed}/${limits.membersLimit}`} tone={!canAddMembers ? "bad" : undefined} />
        </div>
        <details className="mt-4 border-t border-[var(--line)] pt-3 text-sm text-[var(--text-muted)]">
          <summary className="cursor-pointer select-none text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-subtle)]">{t("Detalles de uso", "Usage details")}</summary>
          <div className="mt-3 grid grid-cols-2 gap-4">
            <Metric label={t("Créditos IA", "AI credits")} value={`${limits.aiUsed}/${limits.aiLimit}`} />
            <Metric label={t("Almacenamiento (MB)", "Storage (MB)")} value={`${limits.storageUsed}/${limits.storageLimit}`} />
          </div>
        </details>
      </Card>

      <Card>
        <h3 className="serif text-xl font-bold">{t("Plan", "Plan")}</h3>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {(["free", "pro"] as const).map((plan) => {
            const selected = state.subscription.plan === plan;
            const planLimits = plan === "pro" ? t("20 espacios · 10 miembros", "20 spaces · 10 members") : t("2 espacios · 2 miembros", "2 spaces · 2 members");
            return (
              <div
                key={plan}
                className={`flex items-start gap-3 rounded-2xl border p-4 transition ${selected ? "border-[var(--primary)] bg-[rgba(204,255,0,0.12)]" : "border-[var(--line)] bg-[var(--surface-soft)]"}`}
              >
                <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 ${selected ? "border-[var(--primary)]" : "border-slate-300"}`} aria-hidden="true">
                  {selected && <span className="h-2.5 w-2.5 rounded-full bg-[var(--primary)]" />}
                </span>
                <div className="min-w-0">
                  <p className="font-bold">{subscriptionPlanLabel(plan)}{selected ? t(" · Activo", " · Active") : ""}</p>
                  <p className="mt-1 text-sm text-[var(--text-muted)]">{plan === "pro" ? t("Más IA y adjuntos.", "More AI and attachments.") : t("Generoso para empezar a registrar tu mes.", "Plenty to get started tracking your month.")}</p>
                  <p className="mt-1 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--text-subtle)]">{planLimits}</p>
                </div>
              </div>
            );
          })}
        </div>
        {state.subscription.plan === "free" ? (
          <button className="mt-4 rounded-2xl bg-[var(--lime)] px-6 py-4 text-sm font-bold" onClick={() => setPlan("pro")} type="button">{t("Mejorar a Pro", "Upgrade to Pro")}</button>
        ) : (
          <button className="mt-4 rounded-2xl bg-white px-6 py-4 text-sm font-bold" onClick={() => setPlan("free")} type="button">{t("Volver a Gratis", "Switch back to Free")}</button>
        )}
      </Card>

      <Card>
        <h3 className="serif text-xl font-bold">{t("Tus espacios", "Your spaces")}</h3>
        <div className="mt-4 grid gap-2.5">
          {visibleSpaces.map((space) => {
            const isActive = space.id === state.activeSpaceId;
            const members = `${space.memberCount} ${space.memberCount === 1 ? t("miembro", "member") : t("miembros", "members")}`;
            return (
              <CompactRow
                key={space.id}
                label={space.name}
                sublabel={`${spaceKindLabel(space.kind)} · ${roleLabel(space.role)} · ${members}`}
                value={isActive ? t("Activo", "Active") : t("Activar", "Activate")}
                valueTone={isActive ? "primary" : "default"}
                onClick={isActive ? undefined : () => activateSpace(space.id)}
              />
            );
          })}
        </div>
      </Card>
    </ViewShell>
  );
}

function PlanView({
  state,
  usage,
  summary,
  setState,
}: {
  state: AppState;
  usage: ReturnType<typeof categoryUsage>;
  summary: ReturnType<typeof summarize>;
  setState: Dispatch<SetStateAction<AppState>>;
}) {
  const { t } = useT();
  const [moveDraft, setMoveDraft] = useState({
    fromCategoryId: usage.find((item) => item.remaining > 0)?.id ?? usage[0]?.id ?? "",
    toCategoryId: usage.find((item) => item.remaining < 0)?.id ?? usage[1]?.id ?? usage[0]?.id ?? "",
    amount: "",
  });
  // Single source of truth: the detail/edit lives in a Modal, opened by a row.
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const [planDraft, setPlanDraft] = useState("");

  const selectedUsage = selectedCategoryId ? usage.find((item) => item.id === selectedCategoryId) : undefined;
  const selectedCategory = selectedUsage ? categoryById(state.categories, selectedUsage.id) : undefined;
  const selectedHasSpendWithoutBudget = Boolean(selectedUsage && selectedUsage.plannedCents === 0 && selectedUsage.spent > 0);
  const selectedMovements = selectedUsage
    ? transactionsForMonth(state, state.activeMonth)
        .filter((transaction) => transaction.categoryId === selectedUsage.id || transaction.splits?.some((split) => split.categoryId === selectedUsage.id))
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 8)
    : [];

  function openCategory(id: string) {
    const item = usage.find((entry) => entry.id === id);
    setPlanDraft(item ? (item.plannedCents / 100).toFixed(0) : "");
    setSelectedCategoryId(id);
  }

  function updatePlan(id: string, value: string) {
    const plannedCents = toCents(value);
    setState((current) => withMonthlyCategoryPlan(current, id, plannedCents));
  }

  function savePlanDraft() {
    if (!selectedUsage) return;
    updatePlan(selectedUsage.id, planDraft);
    setSelectedCategoryId(null);
  }

  function movePlannedMoney(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amountCents = toCents(moveDraft.amount);
    if (amountCents <= 0 || !moveDraft.fromCategoryId || !moveDraft.toCategoryId || moveDraft.fromCategoryId === moveDraft.toCategoryId) return;

    setState((current) => {
      const fromPlanned = plannedCentsFor(current, moveDraft.fromCategoryId);
      const toPlanned = plannedCentsFor(current, moveDraft.toCategoryId);
      return withMonthlyCategoryPlan(
        withMonthlyCategoryPlan(current, moveDraft.fromCategoryId, Math.max(0, fromPlanned - amountCents)),
        moveDraft.toCategoryId,
        toPlanned + amountCents,
      );
    });
    setMoveDraft((current) => ({ ...current, amount: "" }));
  }

  function assignRemainingToCategory(categoryId: string) {
    if (summary.assignable <= 0) return;
    setState((current) => withMonthlyCategoryPlan(current, categoryId, plannedCentsFor(current, categoryId) + summary.assignable));
  }

  // La cifra grande del Plan usa el MISMO concepto que el titular del Inicio (plan de gastos
  // − gastado, en positivo y con el estado en palabras). Antes mostraba ingreso esperado −
  // gastado sin etiqueta: un número gigante que no cuadraba con nada de lo visible.
  const planLeftCents = summary.plannedOutflow - summary.outflow;
  const planOver = planLeftCents < 0;
  const planHeadlineLabel = state.mode === "zero"
    ? t("Por asignar", "To assign")
    : state.mode === "tracker"
      ? t("Balance del mes", "Month balance")
      : planOver
        ? t("Te pasaste del plan", "Over your plan")
        : t("Puedes gastar todavía", "Left to spend");
  const planHeadlineCents = state.mode === "zero" ? summary.assignable : state.mode === "tracker" ? summary.remainder : Math.abs(planLeftCents);
  const planHeadlineExplainer = state.mode === "monthly-plan"
    ? t(`Plan de gastos ${formatMoney(summary.plannedOutflow, state.currency)} − gastado ${formatMoney(summary.outflow, state.currency)}`, `Spending plan ${formatMoney(summary.plannedOutflow, state.currency)} − spent ${formatMoney(summary.outflow, state.currency)}`)
    : null;
  const planHeadlineWarning = (state.mode === "zero" && summary.assignable !== 0) || (state.mode === "monthly-plan" && planOver);

  return (
    <ViewShell title={t("Plan mensual", "Monthly plan")} eyebrow={state.activeMonth} description={t("Define lo esperado, mira lo real y corrige antes del cierre.", "Set what you expect, watch what's real, and adjust before the close.")}>
      <Card>
        <p className="kicker">{modeLabel(state.mode, t)} · {planHeadlineLabel}</p>
        <h2 className={`amount serif mt-2 max-w-full break-words text-6xl font-bold ${planHeadlineWarning ? "text-[var(--warning)]" : ""}`}>
          {formatMoney(planHeadlineCents, state.currency)}
        </h2>
        {planHeadlineExplainer && <p className="mt-2 text-sm font-semibold text-[var(--text-muted)]">{planHeadlineExplainer}</p>}
        <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
          <Metric label={t("Planificado", "Planned")} value={formatMoney(summary.plannedOutflow, state.currency)} />
          <Metric label={t("Gastado", "Spent")} value={formatMoney(summary.outflow, state.currency)} />
          <Metric label={t("Ingreso esperado", "Expected income")} value={formatMoney(summary.plannedIncome, state.currency)} />
          <Metric label={state.mode === "zero" ? t("Por asignar", "To assign") : t("Remanente real", "Actual balance")} value={formatMoney(state.mode === "zero" ? summary.assignable : summary.remainder, state.currency)} tone={(state.mode === "zero" ? summary.assignable : summary.remainder) < 0 ? "bad" : "good"} />
        </div>
        <Progress className="mt-5" value={summary.outflow / Math.max(summary.plannedOutflow, 1)} danger={summary.outflow > summary.plannedOutflow} />
      </Card>
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="serif text-xl font-bold tracking-tight">{t(`Categorías (${usage.length})`, `Categories (${usage.length})`)}</h3>
          {state.mode !== "tracker" && usage.length > 1 && (
            <button
              className="shrink-0 rounded-full border border-[var(--line)] bg-white px-4 py-2 text-xs font-bold text-[var(--primary)] transition hover:bg-[var(--surface-muted)]"
              onClick={() => setMoveOpen(true)}
              type="button"
            >
              {t("Mover plan", "Move budget")}
            </button>
          )}
        </div>
        <div className="mt-4 grid gap-2">
          {usage.length ? (
            usage.map((item) => {
              const hasSpendWithoutBudget = item.plannedCents === 0 && item.spent > 0;
              return (
                <button
                  className="group rounded-2xl border border-[var(--line)] bg-[var(--surface-soft)] px-4 py-3 text-left transition hover:border-[var(--primary)] hover:bg-[var(--surface-muted)]"
                  key={item.id}
                  onClick={() => openCategory(item.id)}
                  type="button"
                >
                  <div className="flex items-center gap-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-[var(--line)] bg-white text-[var(--text-muted)]">
                      <WalletCards className="h-5 w-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold leading-tight text-[var(--ink)]">{item.name}</p>
                      <p className="mt-0.5 truncate text-sm text-[var(--text-muted)]">
                        {t(
                          `${formatMoney(item.spent, state.currency)} de ${formatMoney(item.plannedCents, state.currency)}`,
                          `${formatMoney(item.spent, state.currency)} of ${formatMoney(item.plannedCents, state.currency)}`,
                        )}
                      </p>
                    </div>
                    <span className={`shrink-0 whitespace-nowrap text-sm font-bold leading-tight ${hasSpendWithoutBudget ? "text-[var(--text-muted)]" : item.ratio > 1 ? "text-[var(--warning)]" : "text-[var(--ink)]"}`}>
                      {hasSpendWithoutBudget ? t("sin presupuesto", "no budget") : `${Math.round(item.ratio * 100)}%`}
                    </span>
                    <ChevronRight className="h-5 w-5 shrink-0 text-[var(--text-subtle)] transition group-hover:text-[var(--text-muted)]" />
                  </div>
                  {hasSpendWithoutBudget ? (
                    <div className="mt-3 h-1.5 rounded-full border border-dashed border-[var(--text-subtle)] bg-[var(--surface-soft)]" />
                  ) : (
                    <Progress className="mt-3" value={item.ratio} />
                  )}
                </button>
              );
            })
          ) : (
            <EmptyState
              title={t("Sin categorías de gasto", "No spending categories")}
              subtitle={t("Crea categorías en Ajustes para empezar a planificar.", "Create categories in Settings to start planning.")}
            />
          )}
        </div>
      </Card>

      {/* Edit/detail Modal — single source of truth for one category */}
      <Modal
        open={Boolean(selectedUsage)}
        onClose={() => setSelectedCategoryId(null)}
        title={selectedUsage ? selectedUsage.name : t("Categoría", "Category")}
        footer={
          <>
            <button
              className="rounded-2xl border border-[var(--line)] bg-white px-5 py-2.5 text-sm font-bold text-[var(--foreground)] transition hover:bg-[var(--surface-muted)]"
              onClick={() => setSelectedCategoryId(null)}
              type="button"
            >
              {t("Cancelar", "Cancel")}
            </button>
            <button
              className="rounded-2xl bg-[var(--lime)] px-5 py-2.5 text-sm font-bold text-black disabled:opacity-70"
              onClick={savePlanDraft}
              type="button"
              disabled={state.mode === "tracker"}
            >
              {t("Guardar", "Save")}
            </button>
          </>
        }
      >
        {selectedUsage && (
          <div className="grid gap-5">
            <div>
              <p className="text-sm text-[var(--text-muted)]">{subcategoryPreview(selectedCategory?.subcategories, t("Sin datos", "No data"))}</p>
              {selectedHasSpendWithoutBudget ? (
                <div className="mt-3 h-2 rounded-full border border-dashed border-[var(--text-subtle)] bg-[var(--surface-soft)]" />
              ) : (
                <Progress className="mt-3" value={selectedUsage.ratio} danger={selectedUsage.ratio > 1} />
              )}
              <div className="mt-2 flex justify-between text-sm text-[var(--text-muted)]">
                <span>{t(`${formatMoney(selectedUsage.spent, state.currency)} de ${formatMoney(selectedUsage.plannedCents, state.currency)}`, `${formatMoney(selectedUsage.spent, state.currency)} of ${formatMoney(selectedUsage.plannedCents, state.currency)}`)}</span>
                <span className={selectedHasSpendWithoutBudget ? "font-semibold text-[var(--text-muted)]" : selectedUsage.ratio > 1 ? "font-bold text-[var(--warning)]" : "font-semibold"}>
                  {selectedHasSpendWithoutBudget ? t("sin presupuesto", "no budget") : `${Math.round(selectedUsage.ratio * 100)}%`}
                </span>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Metric label={t("Plan", "Plan")} value={formatMoney(selectedUsage.plannedCents, state.currency)} />
              <Metric label={t("Real", "Actual")} value={formatMoney(selectedUsage.spent, state.currency)} tone={selectedUsage.ratio > 1 ? "bad" : undefined} />
              <Metric label={selectedUsage.remaining >= 0 ? t("Disponible", "Available") : t("Exceso", "Over")} value={formatMoney(Math.abs(selectedUsage.remaining), state.currency)} tone={selectedUsage.remaining < 0 ? "bad" : "good"} />
            </div>
            <Input
              label={state.mode === "tracker" ? t("Referencia", "Reference") : t("Ajustar plan", "Adjust plan")}
              value={planDraft}
              onChange={setPlanDraft}
              placeholder="0"
            />
            {state.mode === "zero" && summary.assignable > 0 && (
              <button
                className="rounded-full border border-[var(--line)] bg-white px-4 py-2 text-xs font-bold text-[var(--primary)] transition hover:bg-[var(--surface-muted)]"
                onClick={() => {
                  assignRemainingToCategory(selectedUsage.id);
                  setSelectedCategoryId(null);
                }}
                type="button"
              >
                {t("Asignar restante a esta categoria", "Assign remaining to this category")}
              </button>
            )}
            <div>
              <div className="flex items-center justify-between gap-3">
                <h4 className="font-semibold">{t("Movimientos del mes", "Transactions this month")}</h4>
                <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold">{t(`${selectedMovements.length} recientes`, `${selectedMovements.length} recent`)}</span>
              </div>
              <div className="mt-3 grid gap-2">
                {selectedMovements.length ? (
                  selectedMovements.map((transaction) => (
                    <div className="grid gap-2 rounded-2xl border border-[var(--line)] bg-[var(--surface-soft)] p-3 sm:grid-cols-[1fr_auto] sm:items-center" key={transaction.id}>
                      <div className="min-w-0">
                        <p className="kicker">{transaction.date} · {transactionStatusLabel(transaction.status)}</p>
                        <h5 className="truncate font-semibold">{transaction.description}</h5>
                        <p className="truncate text-sm text-[var(--text-muted)]">{transaction.merchant ? merchantDisplay(transaction.merchant, state.merchantAliases) : transaction.person ?? t("Sin datos", "No details")}{transaction.subcategory ? ` · ${transaction.subcategory}` : ""}</p>
                      </div>
                      <span className="amount shrink-0 whitespace-nowrap font-semibold">{formatMoney(transaction.amountCents, state.currency)}</span>
                    </div>
                  ))
                ) : (
                  <div className="rounded-2xl border border-dashed border-[var(--line)] bg-[var(--surface-soft)] p-6 text-center text-sm text-[var(--text-muted)]">
                    {t(`Esta categoria no tiene movimientos en ${state.activeMonth}.`, `This category has no transactions in ${state.activeMonth}.`)}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Move budget between categories Modal (secondary / power-user) */}
      <Modal
        open={moveOpen}
        onClose={() => setMoveOpen(false)}
        title={t("Mover plan entre categorias", "Move budget between categories")}
        footer={
          <>
            <button
              className="rounded-2xl border border-[var(--line)] bg-white px-5 py-2.5 text-sm font-bold text-[var(--foreground)] transition hover:bg-[var(--surface-muted)]"
              onClick={() => setMoveOpen(false)}
              type="button"
            >
              {t("Cancelar", "Cancel")}
            </button>
            <button
              className="rounded-2xl bg-[var(--lime)] px-5 py-2.5 text-sm font-bold text-[var(--ink)] disabled:opacity-70"
              type="submit"
              form="plan-move-form"
              disabled={toCents(moveDraft.amount) <= 0 || moveDraft.fromCategoryId === moveDraft.toCategoryId}
            >
              {t("Reasignar", "Reassign")}
            </button>
          </>
        }
      >
        <form
          className="grid gap-3"
          id="plan-move-form"
          onSubmit={(event) => {
            movePlannedMoney(event);
            setMoveOpen(false);
          }}
        >
          <Select label={t("Desde", "From")} value={moveDraft.fromCategoryId} options={usage.map((item) => item.id)} render={(id) => categoryById(state.categories, id)?.name ?? id} onChange={(value) => setMoveDraft((current) => ({ ...current, fromCategoryId: value }))} />
          <Select label={t("Hacia", "To")} value={moveDraft.toCategoryId} options={usage.map((item) => item.id)} render={(id) => categoryById(state.categories, id)?.name ?? id} onChange={(value) => setMoveDraft((current) => ({ ...current, toCategoryId: value }))} />
          <Input label={t("Monto", "Amount")} value={moveDraft.amount} onChange={(value) => setMoveDraft((current) => ({ ...current, amount: value }))} placeholder="0.00" />
        </form>
      </Modal>
    </ViewShell>
  );
}

// NewTransactionInput now lives in @/lib/types (imported above) so the pure capture-input
// helpers (suggestionToInput / receiptToInput / emptyManualInput) and the monolith share one
// canonical shape — including the additive attachmentRefs field that carries real uploaded
// files (with storageId) through addTransaction.

const captureTypes: TransactionType[] = ["expense", "income", "transfer", "debt_payment", "saving", "investment", "refund"];

const captureTypeLabels: Record<TransactionType, string> = {
  expense: "Gasto",
  income: "Ingreso",
  transfer: "Transferencia",
  debt_payment: "Deuda",
  saving: "Ahorro",
  investment: "Inversion",
  refund: "Reembolso",
};

function categoriesForCaptureType(categories: AppState["categories"], type: TransactionType) {
  const activeCategories = categories.filter((category) => !category.archived);
  if (type === "income") return activeCategories.filter((category) => category.group === "income");
  if (type === "debt_payment") return activeCategories.filter((category) => category.group === "debt");
  if (type === "saving") return activeCategories.filter((category) => category.group === "savings");
  if (type === "investment") return activeCategories.filter((category) => category.group === "investments");
  return activeCategories.filter((category) => category.group !== "income");
}

function AddMovementView({ state, onSave, setView, initialType = "expense" }: { state: AppState; onSave: (input: NewTransactionInput) => boolean; setView: (view: View) => void; initialType?: TransactionType }) {
  const { t } = useT();
  const { notify } = useToast();
  const firstExpense = state.categories.find((category) => category.group !== "income") ?? state.categories[0];
  // An income capture must never land on an expense-group category (it would distort the
  // month totals): prefer an archived income category over crossing groups.
  const crossGroupFallback = initialType === "income"
    ? state.categories.find((category) => category.group === "income") ?? firstExpense
    : firstExpense;
  const initialCategory = categoriesForCaptureType(state.categories, initialType)[0] ?? crossGroupFallback;
  const activeAccounts = state.accounts.filter((account) => !account.archived);
  const defaultAccount = activeAccounts.find((account) => account.defaultForCapture) ?? activeAccounts[0] ?? state.accounts[0];
  const transferAccount = activeAccounts.find((account) => account.id !== defaultAccount?.id) ?? defaultAccount;
  const today = new Date().toISOString().slice(0, 10);
  // La fecha del movimiento cae en el mes que estás viendo (no siempre hoy): si navegaste a un
  // mes pasado/futuro con el selector, lo que registres aparece en ESE mes. `today` se reserva
  // para datos atados al momento real (p. ej. la fecha de la tasa de cambio).
  const captureDate = defaultDateForMonth(state.activeMonth);
  const [form, setForm] = useState<NewTransactionInput>({
    type: initialType,
    date: captureDate,
    amount: "",
    currency: state.currency,
    exchangeRate: 1,
    exchangeRateDate: today,
    exchangeRateSource: "same_currency",
    accountId: defaultAccount?.id ?? "",
    transferAccountId: transferAccount?.id ?? "",
    linkedTransactionId: "",
    linkKind: undefined,
    categoryId: initialCategory.id,
    subcategory: initialCategory.subcategories[0] ?? "",
    description: "",
    merchant: "",
    tags: "",
    note: "",
    needsReview: false,
    attachmentNames: [],
  });
  const [rateStatus, setRateStatus] = useState<"idle" | "loading" | "ready" | "fallback">("idle");
  const [showCurrency, setShowCurrency] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const selectedCategory = categoryById(state.categories, form.categoryId);
  const otherCurrency = form.currency !== state.currency;
  const currencySymbol = form.currency === "EUR" ? "€" : "$";
  const converted = toCents(form.amount) * form.exchangeRate;
  // Reembolsos entre meses: un gasto se puede reembolsar aunque sea de otro mes (compraste en
  // mayo, te devuelven en junio). Listamos los gastos reembolsables de TODOS los meses, los más
  // recientes primero (el Select muestra la fecha, así que el mes queda claro), acotado a 60.
  const refundableTransactions = state.transactions
    .filter((transaction) => transaction.status === "approved" && transaction.type !== "transfer" && transaction.type !== "refund" && categoryById(state.categories, transaction.categoryId)?.group !== "income")
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 60);
  const linkedTransaction = state.transactions.find((transaction) => transaction.id === form.linkedTransactionId);
  const creditAccounts = activeAccounts.filter((account) => account.kind === "credit");
  const categoryOptions = categoriesForCaptureType(state.categories, form.type);
  const recentCaptureTransactions = transactionsForMonth(state, state.activeMonth)
    .filter((transaction) => transaction.status === "approved" && transaction.type !== "transfer")
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 8);
  const recentCategoryIds = Array.from(new Set(recentCaptureTransactions.map((transaction) => transaction.categoryId)))
    .filter((id) => categoryOptions.some((category) => category.id === id))
    .slice(0, 4);
  const frequentAmounts = Array.from(new Set(recentCaptureTransactions.map((transaction) => transaction.originalAmountCents)))
    .filter((amount) => amount > 0)
    .slice(0, 4);
  const lastTransaction = recentCaptureTransactions[0];

  async function refreshRate(nextCurrency = form.currency) {
    setRateStatus("loading");
    const quote = await quoteExchangeRate(nextCurrency, state.currency);
    setForm((current) => ({
      ...current,
      currency: nextCurrency,
      exchangeRate: quote.rate,
      exchangeRateDate: quote.date,
      exchangeRateSource: quote.source,
    }));
    setRateStatus(quote.source === "api" || quote.source === "same_currency" ? "ready" : "fallback");
  }

  function movementDescription(input: NewTransactionInput) {
    const category = categoryById(state.categories, input.categoryId);
    return input.description.trim() || input.merchant.trim() || input.subcategory.trim() || category?.name || captureTypeLabels[input.type];
  }

  function clearForNextMovement() {
    setForm((current) => ({
      ...current,
      amount: "",
      description: "",
      merchant: "",
      tags: "",
      note: "",
      attachmentNames: [],
      needsReview: false,
      date: captureDate,
      linkedTransactionId: current.type === "refund" ? current.linkedTransactionId : "",
    }));
  }

  function saveMovement(afterSaveView: View) {
    if (!form.amount) return;
    if (form.type === "refund" && !form.linkedTransactionId) return;
    const saved = onSave({
      ...form,
      description: movementDescription(form),
      afterSaveView,
    });
    if (saved) {
      notify(t("Movimiento guardado", "Transaction saved"), "success");
      if (afterSaveView === "add") clearForNextMovement();
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    saveMovement("movements");
  }

  function useLastTransaction() {
    if (!lastTransaction) return;
    const category = categoryById(state.categories, lastTransaction.categoryId) ?? firstExpense;
    setForm((current) => ({
      ...current,
      type: lastTransaction.type,
      amount: (lastTransaction.originalAmountCents / 100).toFixed(2),
      currency: lastTransaction.originalCurrency,
      exchangeRate: lastTransaction.exchangeRate,
      exchangeRateDate: lastTransaction.exchangeRateDate,
      exchangeRateSource: lastTransaction.exchangeRateSource,
      accountId: lastTransaction.accountId,
      transferAccountId: lastTransaction.transferAccountId ?? current.transferAccountId,
      categoryId: category.id,
      subcategory: lastTransaction.subcategory ?? category.subcategories[0] ?? "",
      description: lastTransaction.description,
      merchant: lastTransaction.merchant ?? "",
      tags: lastTransaction.tags.join(", "),
      note: lastTransaction.note ?? "",
    }));
  }

  const accountName = state.accounts.find((account) => account.id === form.accountId)?.name ?? "";
  const detailsFilled = [form.description, form.merchant, form.tags, form.note].filter((value) => value.trim().length > 0).length + form.attachmentNames.length + (form.needsReview ? 1 : 0);
  const detailsSummary = detailsFilled > 0 ? t(`${detailsFilled} con dato`, `${detailsFilled} set`) : t("Toca para añadir", "Tap to add");

  return (
    <ViewShell title={t("Registrar", "Record")} eyebrow={t("Una sola entrada · elige cómo capturar", "One entry · choose how to capture")}>
      <form className="grid gap-5 pb-2" onSubmit={submit}>
        {/* Una sola entrada de captura: aquí defines la forma (escribir / IA / recibo) y sigues
            sin saltar entre pantallas distintas del menú. */}
        <div className="grid grid-cols-3 gap-1.5 rounded-2xl bg-[var(--surface-soft)] p-1.5">
          <span className="rounded-xl bg-[var(--lime)] px-2 py-2.5 text-center text-xs font-bold text-black shadow-sm">{t("Escribir", "Type")}</span>
          <button className="rounded-xl px-2 py-2.5 text-center text-xs font-semibold text-[var(--text-muted)] transition hover:bg-[var(--surface-muted)]" onClick={() => setView("ai")} type="button">{t("Con IA", "With AI")}</button>
          <button className="rounded-xl px-2 py-2.5 text-center text-xs font-semibold text-[var(--text-muted)] transition hover:bg-[var(--surface-muted)]" onClick={() => setView("receipt-capture")} type="button">{t("Recibo", "Receipt")}</button>
        </div>
        {/* Primario · Monto + Categoría */}
        <Card>
          {/* Tipo · control compacto */}
          <div className="grid grid-cols-4 gap-1 rounded-2xl bg-[var(--surface-soft)] p-1.5 lg:grid-cols-7">
            {captureTypes.map((type) => (
              <button
                className={`rounded-xl px-2 py-2 text-xs font-semibold transition ${form.type === type ? "bg-[var(--lime)] text-black shadow-sm" : "text-[var(--text-muted)] hover:bg-[var(--surface-muted)]"}`}
                key={type}
                onClick={() => {
                  const linked = type === "refund" ? refundableTransactions[0] : undefined;
                  const category = linked
                    ? categoryById(state.categories, linked.categoryId) ?? firstExpense
                    : categoriesForCaptureType(state.categories, type)[0] ?? state.categories[0];
                  setForm((current) => ({
                    ...current,
                    type,
                    categoryId: category.id,
                    subcategory: linked?.subcategory ?? category.subcategories[0] ?? "",
                    linkedTransactionId: linked?.id ?? "",
                    linkKind: type === "refund" ? "refund" : undefined,
                    description: type === "refund" && linked ? `Reembolso: ${linked.description}` : current.description,
                  }));
                }}
                type="button"
              >
                {transactionTypeLabel(type)}
              </button>
            ))}
          </div>

          {/* Monto · protagonista */}
          <div className="mt-7 flex items-end justify-center gap-1.5">
            <span className="serif pb-2 text-3xl font-bold text-[var(--text-subtle)]">{currencySymbol}</span>
            <input
              className="serif w-full max-w-[7ch] rounded-xl bg-transparent text-center text-6xl font-bold leading-none outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] placeholder:text-[var(--text-subtle)]"
              inputMode="decimal"
              placeholder="0"
              value={form.amount}
              onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))}
            />
          </div>
          <p className="mt-2 text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-subtle)]">{t("Monto", "Amount")}</p>

          {frequentAmounts.length > 0 && (
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {frequentAmounts.map((amount) => (
                <button className="rounded-full border border-[var(--line)] bg-white px-3.5 py-1.5 text-xs font-bold text-[var(--primary)] transition hover:bg-white" key={amount} onClick={() => setForm((current) => ({ ...current, amount: (amount / 100).toFixed(2) }))} type="button">
                  {formatMoney(amount, form.currency)}
                </button>
              ))}
            </div>
          )}

          {/* Categoría · segunda en jerarquía */}
          <div className="mt-6 border-t border-[var(--line)] pt-5">
            {recentCategoryIds.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-2">
                {recentCategoryIds.map((categoryId) => (
                  <button className={`rounded-full border px-3 py-1.5 text-xs font-bold transition ${form.categoryId === categoryId ? "border-[var(--lime)] bg-[rgba(204,255,0,0.25)] text-[var(--primary)]" : "border-[var(--line)] bg-white text-[var(--primary)] hover:bg-white"}`} key={categoryId} onClick={() => {
                    const category = categoryById(state.categories, categoryId);
                    setForm((current) => ({ ...current, categoryId, subcategory: category?.subcategories[0] ?? current.subcategory }));
                  }} type="button">
                    {categoryById(state.categories, categoryId)?.name ?? categoryId}
                  </button>
                ))}
              </div>
            )}
            <Select label={t("Categoría", "Category")} value={form.categoryId} onChange={(value) => {
              const category = categoryById(state.categories, value);
              setForm((current) => ({ ...current, categoryId: value, subcategory: category?.subcategories[0] ?? "" }));
            }} options={categoryOptions.map((category) => category.id)} render={(id) => form.type === "transfer" ? `${categoryById(state.categories, id)?.name ?? id} ${t("(referencia)", "(reference)")}` : categoryById(state.categories, id)?.name ?? id} />
            {form.type === "refund" && (
              <div className="mt-4">
                <Select label={t("Gasto original", "Original expense")} value={form.linkedTransactionId} onChange={(value) => {
                  const linked = state.transactions.find((transaction) => transaction.id === value);
                  setForm((current) => ({
                    ...current,
                    linkedTransactionId: value,
                    categoryId: linked?.categoryId ?? current.categoryId,
                    subcategory: linked?.subcategory ?? current.subcategory,
                    description: linked ? `Reembolso: ${linked.description}` : current.description,
                    merchant: linked?.merchant ?? current.merchant,
                  }));
                }} options={refundableTransactions.map((transaction) => transaction.id)} render={(id) => {
                  const transaction = state.transactions.find((item) => item.id === id);
                  return transaction ? `${transaction.date} · ${transaction.description} · ${formatMoney(transaction.amountCents, state.currency)}` : id;
                }} />
              </div>
            )}
          </div>

          {/* "¿Qué fue exactamente?" a la vista, no enterrado en un modal: el movimiento se queda
              con tus palabras, no con el nombre de la categoría. Es justo lo que la hoja vieja perdía. */}
          <div className="mt-5 border-t border-[var(--line)] pt-5">
            <Input label={t("¿Qué fue exactamente?", "What was it exactly?")} value={form.description} onChange={(value) => setForm((current) => ({ ...current, description: value }))} placeholder={t("Ej. súper de la semana + pañales en Bravo", "e.g. weekly groceries + diapers at Bravo")} />
          </div>

          {/* Detalles · todo lo demás (cuenta, fecha, comercio, etiquetas, moneda), colapsado en un modal */}
          <div className="mt-4 grid gap-2.5">
            <CompactRow label={t("Más detalles", "More details")} sublabel={accountName} value={detailsSummary} onClick={() => setShowDetails(true)} />
            {lastTransaction && (
              <button className="text-center text-xs font-semibold text-[var(--primary)] transition hover:opacity-70" onClick={useLastTransaction} type="button">{t("↺ Duplicar último", "↺ Duplicate last")} ({lastTransaction.description.slice(0, 22)})</button>
            )}
          </div>
        </Card>

        <Modal
          open={showDetails}
          onClose={() => setShowDetails(false)}
          title={t("Detalles", "Details")}
          footer={
            <button className="rounded-2xl bg-[var(--lime)] px-5 py-2.5 text-sm font-bold text-black" onClick={() => setShowDetails(false)} type="button">
              {t("Listo", "Done")}
            </button>
          }
        >
          <div className="grid gap-4">
            <Select label={form.type === "transfer" ? t("Cuenta origen", "From account") : t("Cuenta", "Account")} value={form.accountId} onChange={(value) => setForm((current) => ({ ...current, accountId: value }))} options={activeAccounts.map((account) => account.id)} render={(id) => state.accounts.find((account) => account.id === id)?.name ?? id} />
            {form.type === "transfer" && (
              <Select label={t("Cuenta destino", "To account")} value={form.transferAccountId} onChange={(value) => setForm((current) => ({ ...current, transferAccountId: value }))} options={activeAccounts.map((account) => account.id)} render={(id) => state.accounts.find((account) => account.id === id)?.name ?? id} />
            )}
            <label className="grid gap-2 text-sm font-semibold">
              {t("Fecha", "Date")}
              <input className="field" type="date" value={form.date} onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))} />
            </label>
            <ComboInput label={t("Subcategoría o detalle", "Subcategory or detail")} value={form.subcategory} options={selectedCategory?.subcategories ?? []} onChange={(value) => setForm((current) => ({ ...current, subcategory: value }))} placeholder={t("Algo específico", "Something specific")} />
            <Input label={t("Comercio o persona", "Merchant or person")} value={form.merchant} onChange={(value) => setForm((current) => ({ ...current, merchant: value }))} placeholder={t("Ej. Amazon, tienda", "e.g. Amazon, store")} />
            <Input label={t("Etiquetas", "Tags")} value={form.tags} onChange={(value) => setForm((current) => ({ ...current, tags: value }))} placeholder={t("familia, imprevisto", "family, unexpected")} />
            <label className="grid gap-2 text-sm font-semibold">
              {t("Nota", "Note")}
              <textarea className="field min-h-24" value={form.note} onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))} />
            </label>
            <label className="flex cursor-pointer items-center justify-between rounded-2xl border border-dashed border-[var(--line)] bg-[var(--surface-soft)] p-4 text-sm font-semibold">
              <span className="inline-flex items-center gap-2"><Upload className="h-4 w-4" /> {form.attachmentNames.length > 0 ? t(`${form.attachmentNames.length} archivo(s)`, `${form.attachmentNames.length} file(s)`) : t("Fotos o recibos", "Photos or receipts")}</span>
              <input className="hidden" type="file" multiple onChange={(event) => setForm((current) => ({ ...current, attachmentNames: Array.from(event.target.files ?? []).map((file) => file.name) }))} />
            </label>
            <label className="flex items-center gap-2 text-sm font-semibold">
              <input type="checkbox" checked={form.needsReview} onChange={(event) => setForm((current) => ({ ...current, needsReview: event.target.checked }))} />
              {t("Mandar a revisión", "Send to review")}
            </label>

            {/* Moneda y tasa */}
            <button className="text-left text-xs font-semibold text-[var(--text-muted)] transition hover:text-[var(--primary)]" onClick={() => setShowCurrency((open) => !open)} type="button">
              {otherCurrency || showCurrency ? t("Moneda y tasa ▴", "Currency and rate ▴") : t("¿Otra moneda? ▾", "Another currency? ▾")}
            </button>
            {(showCurrency || otherCurrency) && (
              <div className="rounded-2xl bg-[var(--surface-soft)] p-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Select label={t("Moneda original", "Original currency")} value={form.currency} onChange={(value) => void refreshRate(value as CurrencyCode)} options={supportedCurrencies} />
                  <label className="grid gap-2 text-sm font-semibold">
                    {t("Tasa hacia", "Rate to")} {state.currency}
                    <input className="field" inputMode="decimal" value={form.exchangeRate} onChange={(event) => setForm((current) => ({ ...current, exchangeRate: Number(event.target.value) || 1, exchangeRateSource: "manual" }))} />
                  </label>
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-[var(--text-muted)]">
                  <p>{t("Se guarda como", "Saved as")} <strong>{formatMoney(Math.round(converted), state.currency)}</strong></p>
                  <button className="rounded-full bg-white px-3 py-1.5 font-semibold text-[var(--primary)] shadow-sm" disabled={rateStatus === "loading"} onClick={() => void refreshRate()} type="button">
                    {rateStatus === "loading" ? t("Actualizando…", "Updating…") : t("Actualizar tasa", "Refresh rate")}
                  </button>
                </div>
              </div>
            )}

            {/* Guía según el tipo + ajuste de saldo */}
            {form.type === "transfer" && creditAccounts.length > 0 && (
              <div className="rounded-2xl bg-[var(--surface-soft)] p-4 text-sm text-[var(--text-muted)]">
                <p className="font-semibold text-[var(--foreground)]">{t("Pago de tarjeta", "Card payment")}</p>
                <p className="mt-1">{t("Registra el pago como transferencia a la cuenta de crédito para no duplicar el gasto.", "Record the payment as a transfer to the credit account so you don't double-count the expense.")}</p>
                <button
                  className="mt-3 rounded-full bg-[var(--lime)] px-4 py-2 text-xs font-bold text-black"
                  onClick={() => {
                    const credit = creditAccounts[0];
                    setForm((current) => ({
                      ...current,
                      transferAccountId: credit.id,
                      linkKind: "card_payment",
                      description: current.description || `${t("Pago de", "Payment to")} ${credit.name}`,
                      categoryId: state.categories.find((category) => category.group === "debt")?.id ?? current.categoryId,
                    }));
                  }}
                  type="button"
                >
                  {t("Usar pago de tarjeta", "Use card payment")}
                </button>
              </div>
            )}
            {["debt_payment", "saving", "investment"].includes(form.type) && (
              <div className="rounded-2xl bg-[var(--surface-soft)] p-4 text-sm text-[var(--text-muted)]">
                {form.type === "debt_payment" && t("Cuenta como pago de deuda. Si pagas tarjeta por compras ya registradas, usa Transferencia.", "Counts as a debt payment. If you're paying a card for purchases already recorded, use Transfer.")}
                {form.type === "saving" && t("Cuenta dentro de tu ahorro real del mes.", "Counts toward your real savings for the month.")}
                {form.type === "investment" && t("Cuenta como inversión real y puede vincularse con patrimonio neto.", "Counts as a real investment and can link to net worth.")}
              </div>
            )}
            {form.type === "refund" && linkedTransaction && (
              <div className="rounded-2xl bg-[var(--surface-soft)] p-4 text-sm text-[var(--text-muted)]">
                {t("Reduce el gasto real de", "Reduces the real spending of")} {categoryById(state.categories, linkedTransaction.categoryId)?.name ?? t("la categoría original", "the original category")}.
              </div>
            )}
            <button className="text-left text-xs font-semibold text-[var(--text-muted)] transition hover:text-[var(--primary)]" onClick={() => setView("accounts")} type="button">{t("Ajuste de saldo", "Balance adjustment")}</button>
          </div>
        </Modal>

        <div className="sticky bottom-24 z-20 grid grid-cols-1 gap-2.5 rounded-3xl border border-white/80 bg-[rgba(254,248,245,0.9)] p-3 shadow-2xl backdrop-blur-2xl sm:grid-cols-[1fr_auto] md:static md:bottom-auto md:border-0 md:bg-transparent md:p-0 md:shadow-none md:backdrop-blur-0">
          <button className="rounded-2xl bg-[var(--lime)] px-6 py-3.5 text-base font-bold text-black shadow-lg shadow-lime-300/30 transition hover:-translate-y-0.5" type="submit">
            {t("Guardar movimiento", "Save transaction")}
          </button>
          <button className="rounded-2xl border border-[var(--line)] bg-white px-6 py-3.5 text-base font-bold text-[var(--primary)] transition hover:-translate-y-0.5" onClick={() => saveMovement("add")} type="button">
            {t("Guardar y añadir otro", "Save and add another")}
          </button>
        </div>
      </form>
    </ViewShell>
  );
}

function AIView({ state, setState, onSave, aiAvailable, onOpenPaywall }: { state: AppState; setState: Dispatch<SetStateAction<AppState>>; onSave: (input: NewTransactionInput) => boolean; aiAvailable: boolean; onOpenPaywall: () => void }) {
  const { t } = useT();
  const [text, setText] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [receiptNames, setReceiptNames] = useState<string[]>([]);
  const [suggestion, setSuggestion] = useState<NaturalCaptureSuggestion | null>(null);
  const [saving, setSaving] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [aiStatus, setAiStatus] = useState("");
  const creditsRemaining = Math.max(0, state.subscription.aiCreditsLimit - state.subscription.aiCreditsUsed);

  function recordAiAction(action: Omit<AiAction, "id" | "createdAt">) {
    setState((current) => ({
      ...current,
      subscription: action.creditsUsed > 0
        ? { ...current.subscription, aiCreditsUsed: Math.min(current.subscription.aiCreditsLimit, current.subscription.aiCreditsUsed + action.creditsUsed) }
        : current.subscription,
      aiActions: current.aiSettings.saveHistory
        ? [
            {
              id: `ai-${Date.now()}`,
              createdAt: new Date().toISOString(),
              ...action,
            },
            ...current.aiActions,
          ].slice(0, 100)
        : current.aiActions,
    }));
  }

  async function analyze() {
    setAnalyzing(true);
    const externalAllowed = state.aiSettings.enabled && state.aiSettings.provider !== "local" && (state.aiSettings.provider === "byok" || creditsRemaining > 0);
    const provider: AiProvider = apiKey.trim() ? "byok" : externalAllowed ? state.aiSettings.provider : "local";
    setAiStatus(provider === "local" ? t("Analizando con reglas locales...", "Analyzing with local rules...") : t("Analizando con IA externa...", "Analyzing with external AI..."));

    try {
      if (provider === "local") throw new Error(t("Proveedor local seleccionado o sin creditos disponibles.", "Local provider selected or no credits available."));
      const response = await fetch("/api/ai/capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          apiKey: apiKey.trim() || undefined,
          activeMonth: state.activeMonth,
          currency: state.currency,
          categories: state.categories.map((category) => ({
            id: category.id,
            name: category.name,
            group: category.group,
            subcategories: category.subcategories,
          })),
          accounts: state.accounts.map((account) => ({
            id: account.id,
            name: account.name,
            kind: account.kind,
            currency: account.currency ?? state.currency,
          })),
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? t("No se pudo analizar con IA externa.", "Could not analyze with external AI."));
      setSuggestion(payload as NaturalCaptureSuggestion);
      recordAiAction({
        kind: "text_capture",
        provider,
        status: "suggested",
        inputPreview: text.slice(0, 140),
        outputSummary: `${payload.description ?? t("Sugerencia", "Suggestion")} · ${t("confianza", "confidence")} ${Math.round((payload.confidence ?? 0) * 100)}%`,
        creditsUsed: provider === "openai" ? 1 : 0,
      });
      setAiStatus(t("Sugerencia generada con IA externa. Revisa antes de guardar.", "Suggestion generated with external AI. Review before saving."));
    } catch (error) {
      const localSuggestion = suggestFromNaturalText(text, state);
      setSuggestion(localSuggestion);
      recordAiAction({
        kind: "text_capture",
        provider: "local",
        status: "suggested",
        inputPreview: text.slice(0, 140),
        outputSummary: `${localSuggestion.description} · ${t("confianza", "confidence")} ${Math.round(localSuggestion.confidence * 100)}%`,
        creditsUsed: 0,
      });
      setAiStatus(`${error instanceof Error ? error.message : t("IA externa no disponible.", "External AI unavailable.")} ${t("Use reglas locales como respaldo.", "Using local rules as a fallback.")}`);
    } finally {
      setAnalyzing(false);
    }
  }

  // Always-available, free, offline guess from the local rules engine. Never gated — this is the
  // manual-parity escape hatch the owner requires regardless of subscription.
  function guessLocally() {
    const localSuggestion = suggestFromNaturalText(text, state);
    setSuggestion(localSuggestion);
    recordAiAction({
      kind: "text_capture",
      provider: "local",
      status: "suggested",
      inputPreview: text.slice(0, 140),
      outputSummary: `${localSuggestion.description} · ${t("confianza", "confidence")} ${Math.round(localSuggestion.confidence * 100)}%`,
      creditsUsed: 0,
    });
    setAiStatus(t("Sugerencia generada con reglas locales (gratis). Revisa antes de guardar.", "Suggestion generated with local rules (free). Review before saving."));
  }

  async function createMovement() {
    if (!suggestion) return;

    setSaving(true);
    const quote = await quoteExchangeRate(suggestion.currency, state.currency);
    // Converged save path: map the suggestion to the canonical NewTransactionInput and call the
    // single Transaction writer (addTransaction via onSave). receiptNames here are filename-only
    // (no uploaded bytes in the text-capture flow), so we pass them as attachmentNames refs.
    onSave(
      suggestionToInput(suggestion, {
        quote,
        attachmentRefs: receiptNames.map((fileName) => ({ fileName })),
      }),
    );
    recordAiAction({
      kind: "text_capture",
      provider: suggestion.confidence >= 0 ? state.aiSettings.provider : "local",
      status: "accepted",
      inputPreview: text.slice(0, 140),
      outputSummary: `${t("Movimiento aceptado:", "Transaction accepted:")} ${suggestion.description}`,
      creditsUsed: 0,
    });
    setSaving(false);
  }

  return (
    <ViewShell title={t("IA y captura inteligente", "AI and smart capture")} eyebrow={t("Opcional, revisable y manual-first", "Optional, reviewable and manual-first")} description={t("Captura rápida con confirmación manual.", "Fast capture with manual confirmation.")}>
      <div className="grid gap-6 lg:grid-cols-[1fr_420px]">
        <Card>
          <h3 className="serif text-xl font-bold">{t("Texto natural", "Natural text")}</h3>
          <label className="mt-5 grid gap-2 text-sm font-semibold">
            {t("Movimiento", "Transaction")}
            <textarea className="field min-h-36" value={text} onChange={(event) => setText(event.target.value)} />
          </label>
          {/* Primary action: auto-pick the best provider (BYOK > paid > local) inside analyze(). */}
          <button className="mt-4 w-full rounded-2xl bg-[var(--lime)] px-6 py-4 text-sm font-bold text-black disabled:opacity-70" disabled={analyzing || !text.trim()} onClick={() => void analyze()} type="button">
            {analyzing ? t("Analizando...", "Analyzing...") : t("Sugerir movimiento", "Suggest transaction")}
          </button>
          {/* Always-available free path: never gated, regardless of plan or AI toggle. */}
          <button
            className="mt-3 w-full text-center text-sm font-semibold text-[var(--primary)] underline-offset-4 hover:underline is-disabled disabled:opacity-70"
            disabled={!text.trim()}
            onClick={guessLocally}
            type="button"
          >
            {t("Sugerir con reglas locales", "Suggest with local rules")}
          </button>
          {!aiAvailable && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[rgba(80,102,0,0.18)] bg-[rgba(204,255,0,0.08)] px-4 py-3 text-xs text-[var(--foreground)]">
              <span>{t("La IA es parte de RindoMes Pro.", "AI is part of RindoMes Pro.")}</span>
              <button className="shrink-0 rounded-full bg-[var(--lime)] px-3 py-1.5 text-xs font-bold text-black" onClick={onOpenPaywall} type="button">
                {t("Activar Pro", "Activate Pro")}
              </button>
            </div>
          )}
          {aiStatus && <p className="mt-3 rounded-2xl bg-[var(--surface-soft)] px-4 py-3 text-sm text-[var(--text-muted)]">{aiStatus}</p>}

          <details className="mt-4 rounded-2xl bg-[var(--surface-soft)] p-4">
            <summary className="cursor-pointer select-none text-xs font-bold uppercase tracking-[0.16em] text-[var(--primary)]">{t("Opciones avanzadas", "Advanced options")}</summary>
            <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
              <Card><Metric label={t("Proveedor", "Provider")} value={state.aiSettings.enabled ? aiProviderLabel(state.aiSettings.provider) : t("Desactivada", "Disabled")} /></Card>
              <Card><Metric label={t("Créditos", "Credits")} value={`${creditsRemaining}/${state.subscription.aiCreditsLimit}`} tone={creditsRemaining <= 3 ? "bad" : "good"} /></Card>
              <Card><Metric label={t("Historial IA", "AI history")} value={String(state.aiActions.length)} /></Card>
              <Card><Metric label={t("Costo última acción", "Last action cost")} value={state.aiActions[0] ? String(state.aiActions[0].creditsUsed) : "0"} /></Card>
            </div>
            <label className="mt-4 grid gap-2 text-sm font-semibold">
              {t("Tu propia clave IA (avanzado)", "Your own AI key (advanced)")}
              <input className="field" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={t("sk-... (opcional, queda solo en este dispositivo)", "sk-... (optional, stays only on this device)")} type="password" />
            </label>
            <label className="mt-4 flex cursor-pointer items-center justify-between rounded-2xl border border-dashed border-[var(--line)] bg-[var(--surface-soft)] p-4 text-sm font-semibold">
              <span className="inline-flex items-center gap-2"><Upload className="h-4 w-4" /> {t("Recibos o screenshots para revisar", "Receipts or screenshots to review")}</span>
              <input className="hidden" type="file" multiple onChange={(event) => setReceiptNames(Array.from(event.target.files ?? []).map((file) => file.name))} />
            </label>
            {receiptNames.length > 0 && <p className="mt-2 text-sm text-[var(--text-muted)]">{receiptNames.join(", ")}</p>}
          </details>
        </Card>

        <Card>
          <h3 className="serif text-xl font-bold">{t("Sugerencia", "Suggestion")}</h3>
          {!suggestion && <p className="mt-3 text-sm text-[var(--text-muted)]">{t("Analiza un texto para ver monto, categoria, cuenta y nivel de confianza.", "Analyze a text to see amount, category, account and confidence level.")}</p>}
          {suggestion && (
            <div className="mt-5 grid gap-4">
              <Metric label={t("Confianza", "Confidence")} value={`${Math.round(suggestion.confidence * 100)}%`} tone={suggestion.needsReview ? "bad" : "good"} />
              <ListCard title={suggestion.description} subtitle={`${categoryById(state.categories, suggestion.categoryId)?.name ?? t("Categoria", "Category")} · ${state.accounts.find((account) => account.id === suggestion.accountId)?.name ?? t("Cuenta", "Account")}`} value={formatMoney(toCents(suggestion.amount), suggestion.currency)} />
              <div className="rounded-2xl bg-[var(--surface-soft)] p-4">
                <p className="font-semibold">{t("Razones", "Reasons")}</p>
                <ul className="mt-2 space-y-1 text-sm text-[var(--text-muted)]">
                  {suggestion.reasons.map((reason) => <li key={reason}>{reason}</li>)}
                </ul>
              </div>
              <button className="rounded-2xl bg-[var(--lime)] px-6 py-4 text-sm font-bold text-black disabled:opacity-70" disabled={saving || !suggestion.amount} onClick={() => void createMovement()} type="button">
                {saving ? t("Guardando...", "Saving...") : t("Guardar movimiento", "Save transaction")}
              </button>
            </div>
          )}
        </Card>
      </div>
      <Card>
        <h3 className="serif text-xl font-bold">{t("Historial IA", "AI history")}</h3>
        <div className="mt-5 grid gap-3">
          {state.aiActions.slice(0, 8).map((action) => (
            <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-soft)] p-4" key={action.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="kicker">{aiProviderLabel(action.provider)} · {aiActionKindLabel(action.kind)} · {aiActionStatusLabel(action.status)}</p>
                  <h4 className="mt-1 font-semibold">{action.outputSummary}</h4>
                  <p className="mt-1 text-sm text-[var(--text-muted)]">{action.inputPreview}</p>
                </div>
                <span className="rounded-full bg-white px-3 py-1 text-xs font-bold">{action.creditsUsed} {t("credito(s)", "credit(s)")}</span>
              </div>
            </div>
          ))}
          {!state.aiActions.length && <p className="rounded-2xl border border-dashed border-[var(--line)] p-5 text-sm text-[var(--text-muted)]">{t("No hay acciones IA guardadas.", "No saved AI actions.")}</p>}
        </div>
      </Card>
    </ViewShell>
  );
}

function ReceiptsView({
  state,
  setState,
  setView,
  onSave,
  uploadAttachment,
  householdId,
}: {
  state: AppState;
  setState: Dispatch<SetStateAction<AppState>>;
  setView: (view: View) => void;
  onSave: (input: NewTransactionInput) => boolean;
  uploadAttachment: (file: File | Blob, fileName: string) => Promise<AttachmentRef>;
  householdId: string | null;
}) {
  const { t } = useT();
  const firstReceipt = state.receipts[0];
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [selectedId, setSelectedId] = useState(firstReceipt?.id ?? "");
  // Defaults applied to receipts created via the upfront "Seleccionar archivos" picker.
  // Per-receipt metadata is edited in the detail panel (single source of truth); receipt-capture
  // handles extraction. These stay as sensible defaults so uploads never require a pre-fill form.
  const [draft] = useState({
    source: "receipt" as ReceiptAttachment["source"],
    status: "needs_review" as ReceiptAttachment["status"],
    amount: "",
    currency: state.currency,
    date: new Date().toISOString().slice(0, 10),
    merchant: "",
    extractedText: "",
    note: "",
  });
  const [receiptSuggestion, setReceiptSuggestion] = useState<{ receiptId: string; suggestion: NaturalCaptureSuggestion } | null>(null);
  const [linkTransactionId, setLinkTransactionId] = useState("");
  // One-at-a-time edit: clicking a row opens this Modal — the single source of truth for the
  // 6+ fields, extracted text and AI suggestion. The always-open detail panel is gone.
  const [editOpen, setEditOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const selected = state.receipts.find((receipt) => receipt.id === selectedId) ?? state.receipts[0];
  const selectedSuggestion = receiptSuggestion && receiptSuggestion.receiptId === selected?.id ? receiptSuggestion.suggestion : null;
  const pending = state.receipts.filter((receipt) => receipt.status === "needs_review" || receipt.status === "uploaded").length;
  const linkableTransactions = transactionsForMonth(state, state.activeMonth).filter((transaction) => !transaction.attachmentNames?.includes(selected?.fileName ?? ""));

  // Upload the real bytes when a cloud household exists, so each receipt carries its storageId
  // (the file pointer that must survive autosave). In local-only mode (no householdId) we keep the
  // previous filename-only behavior — the manual path stays fully working without any keys/cloud.
  async function addReceiptFiles(files?: FileList | null) {
    const incoming = Array.from(files ?? []);
    if (!incoming.length) return;

    setUploadError(null);
    const today = new Date().toISOString().slice(0, 10);
    setUploading(true);

    let receipts: ReceiptAttachment[];
    try {
      receipts = await Promise.all(
        incoming.map(async (file, index): Promise<ReceiptAttachment> => {
          // Try to upload real bytes; fall back to filename-only on local-only mode or any failure.
          let storageId: string | undefined;
          if (householdId) {
            try {
              const ref = await uploadAttachment(file, file.name);
              storageId = ref.storageId;
            } catch {
              // Keep the filename-only receipt so the user is never blocked.
              storageId = undefined;
            }
          }
          return {
            id: `receipt-${Date.now()}-${index}`,
            fileName: file.name,
            contentType: file.type || contentTypeFromFileName(file.name),
            source: draft.source,
            status: "needs_review",
            createdAt: today,
            amountCents: toCents(draft.amount) || undefined,
            currency: draft.currency as CurrencyCode,
            date: draft.date,
            merchant: draft.merchant.trim() || undefined,
            extractedText: draft.extractedText.trim() || undefined,
            note: draft.note.trim() || undefined,
            storageId,
          };
        }),
      );
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : t("No se pudieron subir los archivos.", "Could not upload the files."));
      setUploading(false);
      return;
    }

    if (householdId && receipts.some((receipt) => !receipt.storageId)) {
      setUploadError(t("Algunos archivos no se subieron al almacenamiento; quedaron solo con su nombre. Puedes volver a intentarlo.", "Some files were not uploaded to storage; only their names were kept. You can try again."));
    }

    setState((current) => ({
      ...current,
      receipts: [...receipts, ...current.receipts],
      review: [
        ...receipts.map((receipt) => ({
          id: `review-${receipt.id}`,
          reason: "receipt_pending" as const,
          title: receipt.fileName,
          subtitle: t("Recibo pendiente.", "Pending receipt."),
          amountCents: receipt.amountCents ? -receipt.amountCents : 0,
          action: t("Revisar", "Review"),
          targetType: "receipt" as const,
          targetId: receipt.id,
        })),
        ...current.review,
      ],
    }));
    setSelectedId(receipts[0]?.id ?? selectedId);
    setUploading(false);
  }

  function updateReceipt(id: string, patch: Partial<ReceiptAttachment>) {
    setState((current) => ({
      ...current,
      receipts: current.receipts.map((receipt) => receipt.id === id ? { ...receipt, ...patch } : receipt),
    }));
  }

  function linkReceiptToTransaction(receipt: ReceiptAttachment) {
    if (!linkTransactionId) return;

    setState((current) => ({
      ...current,
      receipts: current.receipts.map((item) => item.id === receipt.id ? { ...item, status: "confirmed", transactionId: linkTransactionId } : item),
      transactions: current.transactions.map((transaction) => transaction.id === linkTransactionId
        ? {
            ...transaction,
            attachmentNames: Array.from(new Set([...(transaction.attachmentNames ?? []), receipt.fileName])),
            audit: [...(transaction.audit ?? []), movementAudit("edited", `${t("Recibo vinculado:", "Receipt linked:")} ${receipt.fileName}.`, current.user.name || "RindoMes")],
          }
        : transaction),
      review: current.review.filter((item) => item.id !== `review-${receipt.id}` && item.targetId !== receipt.id),
    }));
    setLinkTransactionId("");
  }

  function confirmReceiptOnly(receipt: ReceiptAttachment) {
    setState((current) => ({
      ...current,
      receipts: current.receipts.map((item) => item.id === receipt.id ? { ...item, status: "confirmed" } : item),
      review: current.review.filter((item) => item.id !== `review-${receipt.id}` && item.targetId !== receipt.id),
    }));
  }

  function deleteReceipt(receipt: ReceiptAttachment) {
    const nextSelection = state.receipts.find((item) => item.id !== receipt.id)?.id ?? "";
    setState((current) => ({
      ...current,
      receipts: current.receipts.filter((item) => item.id !== receipt.id),
      transactions: current.transactions.map((transaction) => transaction.attachmentNames?.includes(receipt.fileName)
        ? { ...transaction, attachmentNames: transaction.attachmentNames.filter((fileName) => fileName !== receipt.fileName) }
        : transaction),
      review: current.review.filter((item) => item.id !== `review-${receipt.id}` && item.targetId !== receipt.id),
    }));
    setSelectedId(nextSelection);
    setReceiptSuggestion((current) => current?.receiptId === receipt.id ? null : current);
    setLinkTransactionId("");
  }

  function analyzeReceipt(receipt: ReceiptAttachment) {
    const text = [
      receipt.extractedText,
      receipt.note,
      receipt.merchant,
      receipt.amountCents ? `${receipt.amountCents / 100} ${receipt.currency ?? state.currency}` : "",
    ].filter(Boolean).join("\n");
    const suggestion = suggestFromNaturalText(text || receipt.fileName, state);
    setReceiptSuggestion({ receiptId: receipt.id, suggestion });

    updateReceipt(receipt.id, {
      amountCents: receipt.amountCents ?? (suggestion.amount ? toCents(suggestion.amount) : undefined),
      currency: receipt.currency ?? suggestion.currency,
      merchant: receipt.merchant || suggestion.merchant || undefined,
      status: "needs_review",
    });
  }

  async function createMovementFromReceipt(receipt: ReceiptAttachment) {
    const suggestion = receiptSuggestion?.receiptId === receipt.id ? receiptSuggestion.suggestion : null;
    const amountCents = receipt.amountCents ?? (suggestion?.amount ? toCents(suggestion.amount) : 0);
    if (!amountCents) return;

    const currency = receipt.currency ?? suggestion?.currency ?? state.currency;
    const quote = await quoteExchangeRate(currency, state.currency);

    // Converged save path: map the existing receipt (+ optional local suggestion) to the canonical
    // NewTransactionInput and call the single Transaction writer (addTransaction via onSave).
    // receiptToInput preserves the 'recibo' provenance/status needs_review/the 'recibo' tag and
    // threads attachmentRefs (with the receipt's storageId) so the file pointer survives autosave.
    const input = receiptToInput(receipt, suggestion, quote);
    const saved = onSave(input);

    if (saved) {
      // addTransaction already created a fresh ReceiptAttachment row from input.attachmentRefs —
      // confirmed and carrying the SAME storageId (the file pointer). So the original standalone
      // receipt row (uploaded earlier, status needs_review) is now redundant; drop it and its
      // review item to avoid a duplicate. The storageId survives on the new, tx-linked row.
      setState((current) => ({
        ...current,
        receipts: current.receipts.filter((item) => item.id !== receipt.id),
        review: current.review.filter((item) => item.id !== `review-${receipt.id}` && item.targetId !== receipt.id),
      }));
      setEditOpen(false);
    }
  }

  function openReceipt(receipt: ReceiptAttachment) {
    setSelectedId(receipt.id);
    setLinkTransactionId("");
    setEditOpen(true);
  }

  // Pending receipts read as "needs attention"; everything else is neutral.
  const filteredReceipts = state.receipts.filter((receipt) => statusFilter === "all" || receipt.status === statusFilter);

  return (
    <ViewShell title={t("Adjuntos y recibos", "Attachments and receipts")} eyebrow={`${pending} ${t("pendientes", "pending")}`}>
      <Card>
        <div className="grid gap-5 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <h3 className="serif text-xl font-bold">{t("Subir comprobantes", "Upload receipts")}</h3>
            <p className="mt-2 text-sm text-[var(--text-muted)]">{t("Sube recibos para crear movimientos.", "Upload receipts to create transactions.")}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              className="inline-flex items-center justify-center rounded-2xl border border-[var(--line)] bg-white px-6 py-4 text-sm font-bold text-[var(--primary)] transition hover:bg-[var(--surface-soft)]"
              onClick={() => setView("receipt-capture")}
              type="button"
            >
              <ReceiptText className="mr-2 h-4 w-4" />
              {t("Capturar con cámara o IA", "Capture with camera or AI")}
            </button>
            <label className={`inline-flex cursor-pointer items-center justify-center rounded-2xl bg-[var(--lime)] px-6 py-4 text-sm font-bold text-black ${uploading ? "opacity-70" : ""}`}>
              <Upload className="mr-2 h-4 w-4" />
              {uploading ? t("Subiendo…", "Uploading…") : t("Seleccionar archivos", "Select files")}
              <input className="hidden" type="file" multiple disabled={uploading} onChange={(event) => void addReceiptFiles(event.target.files)} />
            </label>
          </div>
        </div>
        {uploadError && (
          <p className="mt-4 rounded-2xl border border-[rgba(186,26,26,0.3)] bg-[rgba(186,26,26,0.06)] px-4 py-3 text-sm text-[var(--danger)]">{uploadError}</p>
        )}
      </Card>

      <Card>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <SectionHeader title={t("Recibos", "Receipts")} action={t("Capturar", "Capture")} onAction={() => setView("receipt-capture")} />
          <div className="min-w-[12rem]">
            <Select
              label={t("Estado", "Status")}
              value={statusFilter}
              options={["all", "needs_review", "uploaded", "processing", "confirmed", "error"]}
              render={(value) => (value === "all" ? t("Todos", "All") : receiptStatusLabel(value))}
              onChange={setStatusFilter}
            />
          </div>
        </div>

        <div className="mt-5 grid gap-3">
          {filteredReceipts.map((receipt) => (
            <CompactRow
              key={receipt.id}
              icon={<ReceiptText className="h-5 w-5" />}
              label={receipt.fileName}
              sublabel={`${receiptStatusLabel(receipt.status)} · ${receipt.merchant ?? t("Sin comercio", "No merchant")} · ${receipt.date ?? receipt.createdAt}`}
              value={formatMoney(receipt.amountCents ?? 0, receipt.currency ?? state.currency)}
              valueTone={receipt.status === "needs_review" || receipt.status === "uploaded" ? "danger" : "default"}
              onClick={() => openReceipt(receipt)}
            />
          ))}
          {!state.receipts.length && (
            <p className="rounded-2xl border border-dashed border-[var(--line)] p-6 text-center text-sm text-[var(--text-muted)]">{t("Todavía no hay recibos.", "No receipts yet.")}</p>
          )}
          {Boolean(state.receipts.length) && !filteredReceipts.length && (
            <p className="rounded-2xl border border-dashed border-[var(--line)] p-6 text-center text-sm text-[var(--text-muted)]">{t("No hay recibos con este estado.", "No receipts with this status.")}</p>
          )}
        </div>
      </Card>

      {/* Editar/crear desde recibo: el Modal es la única fuente de verdad — los 6+ campos, el texto
          extraído y la sugerencia de IA viven aquí. Lo primario (Comercio/Fecha/Monto) primero; lo
          secundario (Estado/Origen/Moneda/Texto) se colapsa en "Más opciones". Footer: "Crear
          movimiento" primario + RowMenu (Vincular existente / Confirmar sin movimiento / Eliminar). */}
      <Modal
        open={editOpen && Boolean(selected)}
        onClose={() => setEditOpen(false)}
        title={selected?.fileName ?? t("Recibo", "Receipt")}
        footer={selected && (
          <>
            <RowMenu
              items={[
                { label: t("Vincular existente", "Link existing"), onClick: () => { if (linkTransactionId) { linkReceiptToTransaction(selected); setEditOpen(false); } } },
                { label: t("Confirmar sin movimiento", "Confirm without transaction"), onClick: () => { confirmReceiptOnly(selected); setEditOpen(false); } },
                { label: t("Eliminar recibo", "Delete receipt"), danger: true, onClick: () => { deleteReceipt(selected); setEditOpen(false); } },
              ]}
            />
            <button
              className="rounded-2xl bg-[var(--lime)] px-5 py-3 text-sm font-bold text-black disabled:opacity-70"
              disabled={!selected.amountCents && !selectedSuggestion?.amount}
              onClick={() => void createMovementFromReceipt(selected)}
              type="button"
            >
              {t("Crear movimiento", "Create transaction")}
            </button>
          </>
        )}
      >
        {selected && (
          <div className="grid gap-3">
            <p className="kicker">{receiptSourceLabel(selected.source)} · {receiptStatusLabel(selected.status)}</p>
            <Input label={t("Comercio/persona", "Merchant/person")} value={selected.merchant ?? ""} onChange={(value) => updateReceipt(selected.id, { merchant: value })} />
            <Input label={t("Fecha", "Date")} value={selected.date ?? ""} onChange={(value) => updateReceipt(selected.id, { date: value })} />
            <Input label={t("Monto", "Amount")} value={selected.amountCents ? String(selected.amountCents / 100) : ""} onChange={(value) => updateReceipt(selected.id, { amountCents: toCents(value) })} />

            {selectedSuggestion && (
              <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-soft)] p-4 text-sm">
                <p className="kicker">{t("Sugerido por IA", "AI suggestion")}</p>
                <div className="mt-2 flex items-start justify-between gap-3">
                  <div>
                    <p className="font-bold">{selectedSuggestion.description}</p>
                    <p className="mt-1 text-[var(--text-muted)]">{categoryById(state.categories, selectedSuggestion.categoryId)?.name ?? t("Categoría", "Category")} · {state.accounts.find((account) => account.id === selectedSuggestion.accountId)?.name ?? t("Cuenta", "Account")}</p>
                  </div>
                  <span className="serif text-2xl font-bold">{formatMoney(toCents(selectedSuggestion.amount), selectedSuggestion.currency)}</span>
                </div>
                <p className="mt-3 text-[var(--text-muted)]">{t("Confianza", "Confidence")} {Math.round(selectedSuggestion.confidence * 100)}% · {selectedSuggestion.needsReview ? t("requiere revisión", "needs review") : t("lista para confirmar", "ready to confirm")}</p>
              </div>
            )}

            {selected.transactionId && (
              <div className="rounded-2xl bg-[var(--surface-soft)] p-4 text-sm text-[var(--text-muted)]">
                {t("Vinculado a", "Linked to")} {state.transactions.find((transaction) => transaction.id === selected.transactionId)?.description ?? selected.transactionId}.
              </div>
            )}

            <Select label={t("Vincular a movimiento", "Link to transaction")} value={linkTransactionId} options={["", ...linkableTransactions.map((transaction) => transaction.id)]} render={(id) => {
              const transaction = state.transactions.find((item) => item.id === id);
              return transaction ? `${transaction.date} · ${transaction.description} · ${formatMoney(transaction.amountCents, state.currency)}` : t("Elegir movimiento existente", "Choose an existing transaction");
            }} onChange={setLinkTransactionId} />

            <details className="rounded-2xl bg-[var(--surface-soft)] p-4">
              <summary className="cursor-pointer select-none text-xs font-bold uppercase tracking-[0.16em] text-[var(--primary)]">{t("Más opciones", "More options")}</summary>
              <div className="mt-4 grid gap-3">
                <Select label={t("Estado", "Status")} value={selected.status} options={["uploaded", "processing", "needs_review", "confirmed", "error"]} render={receiptStatusLabel} onChange={(value) => updateReceipt(selected.id, { status: value as ReceiptAttachment["status"] })} />
                <Select label={t("Origen", "Source")} value={selected.source} options={["receipt", "invoice", "statement", "other"]} render={receiptSourceLabel} onChange={(value) => updateReceipt(selected.id, { source: value as ReceiptAttachment["source"] })} />
                <Select label={t("Moneda", "Currency")} value={selected.currency ?? state.currency} options={supportedCurrencies} onChange={(value) => updateReceipt(selected.id, { currency: value as CurrencyCode })} />
                <div className="grid gap-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold">{t("Texto extraído", "Extracted text")}</span>
                    <button className="rounded-full bg-white px-3 py-1.5 text-xs font-bold text-[var(--primary)] shadow-sm" onClick={() => analyzeReceipt(selected)} type="button">
                      {t("Analizar texto del recibo", "Analyze receipt text")}
                    </button>
                  </div>
                  <textarea className="field min-h-24" value={selected.extractedText ?? ""} onChange={(event) => updateReceipt(selected.id, { extractedText: event.target.value })} />
                </div>
              </div>
            </details>
          </div>
        )}
      </Modal>
    </ViewShell>
  );
}

function MovementsView({ state, setState, setView }: { state: AppState; setState: Dispatch<SetStateAction<AppState>>; setView: (view: View) => void }) {
  const { t } = useT();
  const lang = t("es", "en") as "es" | "en";
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  // Por defecto Movimientos muestra SOLO el mes activo (el del selector global). El toggle amplía
  // a todos los meses. Antes listaba todo mezclado e ignoraba el mes.
  const [showAllMonths, setShowAllMonths] = useState(false);
  const [selectedId, setSelectedId] = useState(() => transactionsForMonth(state, state.activeMonth)[0]?.id ?? "");
  const [splitDraft, setSplitDraft] = useState({
    categoryId: state.categories.find((category) => category.group !== "income")?.id ?? state.categories[0]?.id ?? "",
    amount: "",
    note: "",
  });
  const [splitError, setSplitError] = useState("");
  const [commentDraft, setCommentDraft] = useState("");
  // One-at-a-time overlays: full edit form, split manager, and read-only "more info".
  const [editOpen, setEditOpen] = useState(false);
  const [splitsOpen, setSplitsOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const filtered = useMemo(() => state.transactions.filter((transaction) => {
    const category = categoryById(state.categories, transaction.categoryId);
    const needle = `${transaction.description} ${transaction.merchant ?? ""} ${transaction.tags.join(" ")} ${category?.name ?? ""}`.toLowerCase();
    const matchesQuery = !query || needle.includes(query.toLowerCase());
    const matchesStatus = statusFilter === "all" || transaction.status === statusFilter;
    const matchesType = typeFilter === "all" || transaction.type === typeFilter;
    const matchesMonth = showAllMonths || transaction.date.slice(0, 7) === state.activeMonth;
    return matchesMonth && matchesQuery && matchesStatus && matchesType;
  }), [query, showAllMonths, state.activeMonth, state.categories, state.transactions, statusFilter, typeFilter]);
  const selected = filtered.find((transaction) => transaction.id === selectedId);

  useEffect(() => {
    const nextSelectedId = filtered.some((transaction) => transaction.id === selectedId) ? selectedId : filtered[0]?.id ?? "";
    if (selectedId !== nextSelectedId) setSelectedId(nextSelectedId);
  }, [filtered, selectedId]);

  function updateTransaction(id: string, patch: Partial<Transaction>) {
    const currentTransaction = state.transactions.find((transaction) => transaction.id === id);
    if (currentTransaction && !confirmClosedMonthChange(state, patch.date ?? currentTransaction.date)) return;

    setState((current) => {
      let accounts = current.accounts;
      const shouldRebalance = Boolean(patch.status || patch.accountId || patch.transferAccountId || patch.type || "amountCents" in patch);
      const transactions = current.transactions.map((transaction) => {
        if (transaction.id !== id) return transaction;

        const updated = { ...transaction, ...patch };
        if (shouldRebalance) {
          accounts = applyAccountEffect(accounts, transaction, -1);
          accounts = applyAccountEffect(accounts, updated, 1);
        }
        const auditAction = auditActionForPatch(patch);
        return auditAction
          ? {
              ...updated,
              audit: [
                ...(transaction.audit ?? []),
                movementAudit(auditAction, auditSummaryForPatch(transaction, patch), state.user.name?.trim() || "Yo"),
              ],
            }
          : updated;
      });

      return {
        ...current,
        accounts,
        transactions,
        review: patch.status === "approved" ? current.review.filter((item) => inferReviewTargetId(item, current) !== id) : current.review,
      };
    });
  }

  function addSplit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !splitDraft.categoryId || !splitDraft.amount) return;
    if (!confirmClosedMonthChange(state, selected.date)) return;

    const category = categoryById(state.categories, splitDraft.categoryId);
    const amountCents = toCents(splitDraft.amount);
    const nextSplitTotal = splitTotal + amountCents;
    if (amountCents <= 0) {
      setSplitError(t("El monto del split debe ser mayor que cero.", "The split amount must be greater than zero."));
      return;
    }
    if (nextSplitTotal > selected.amountCents + 1) {
      setSplitError(t("La suma de splits no puede superar el total del movimiento.", "The sum of splits cannot exceed the transaction total."));
      return;
    }
    setSplitError("");
    updateTransaction(selected.id, {
      splits: [
        ...(selected.splits ?? []),
        {
          id: `split-${Date.now()}`,
          categoryId: splitDraft.categoryId,
          subcategory: category?.subcategories[0],
          amountCents,
          note: splitDraft.note,
        },
      ],
    });
    setSplitDraft((current) => ({ ...current, amount: "", note: "" }));
  }

  function deleteSplit(splitId: string) {
    if (!selected) return;
    if (!confirmClosedMonthChange(state, selected.date)) return;
    setSplitError("");
    updateTransaction(selected.id, {
      splits: (selected.splits ?? []).filter((split) => split.id !== splitId),
    });
  }

  function deleteSelectedTransaction() {
    if (!selected) return;
    if (!confirmClosedMonthChange(state, selected.date)) return;

    const nextSelection = filtered.find((transaction) => transaction.id !== selected.id)?.id ?? "";
    setState((current) => {
      // Remove the selected movement AND any movement linked to it (e.g. a refund tied to
      // this expense), reversing every account effect and every mirror ledger (debt/goal/
      // net-worth) so balances keep cuadrando al centavo and no orphan refund is left behind.
      const removedIds = new Set<string>([selected.id]);
      current.transactions.forEach((transaction) => {
        if (transaction.linkedTransactionId && removedIds.has(transaction.linkedTransactionId)) removedIds.add(transaction.id);
      });
      const removed = current.transactions.filter((transaction) => removedIds.has(transaction.id));

      let accounts = current.accounts;
      let ledgers: Pick<AppState, "debts" | "goals" | "netWorth"> = {
        debts: current.debts,
        goals: current.goals,
        netWorth: current.netWorth,
      };
      removed.forEach((transaction) => {
        accounts = applyAccountEffect(accounts, transaction, -1);
        ledgers = reverseMirrorLedgers(ledgers, transaction);
      });

      return {
        ...current,
        accounts,
        debts: ledgers.debts,
        goals: ledgers.goals,
        netWorth: ledgers.netWorth,
        transactions: current.transactions.filter((transaction) => !removedIds.has(transaction.id)),
        comments: current.comments.filter((comment) => !(comment.targetType === "transaction" && removedIds.has(comment.targetId))),
        review: current.review.filter((item) => !removed.some((tx) => item.id === `review-${tx.id}` || item.title === tx.description)),
      };
    });
    setSelectedId(nextSelection);
  }

  function duplicateSelectedTransaction() {
    if (!selected) return;

    const duplicate: Transaction = {
      ...selected,
      id: `copy-${selected.id}-${Date.now()}`,
      date: new Date().toISOString().slice(0, 10),
      description: `${selected.description} ${t("copia", "copy")}`,
      status: "needs_review",
      createdBy: t("Duplicado manual", "Manual duplicate"),
      audit: [
        ...(selected.audit ?? []),
        movementAudit("duplicated", `${t("Duplicado desde", "Duplicated from")} ${selected.description}.`, state.user.name?.trim() || t("Yo", "Me")),
      ],
    };
    setState((current) => ({
      ...current,
      accounts: duplicate.status === "approved" ? applyAccountEffect(current.accounts, duplicate, 1) : current.accounts,
      transactions: [duplicate, ...current.transactions],
      review: [
        {
          id: `review-${duplicate.id}`,
          reason: "duplicate",
          title: duplicate.description,
          subtitle: t("Movimiento duplicado manualmente; confirma que no sea un error.", "Transaction duplicated manually; confirm it isn't a mistake."),
          amountCents: -duplicate.amountCents,
          action: "Confirmar",
          targetType: "transaction",
          targetId: duplicate.id,
        },
        ...current.review,
      ],
    }));
    setSelectedId(duplicate.id);
  }

  function markSelectedReviewed() {
    if (!selected) return;
    if (!confirmClosedMonthChange(state, selected.date)) return;

    setState((current) => ({
      ...current,
      accounts: selected.status === "needs_review" ? applyAccountEffect(current.accounts, selected, 1) : current.accounts,
      transactions: current.transactions.map((transaction) => transaction.id === selected.id ? { ...transaction, status: "approved", audit: [...(transaction.audit ?? []), movementAudit("reviewed", t("Movimiento marcado como revisado.", "Transaction marked as reviewed."), state.user.name?.trim() || t("Yo", "Me"))] } : transaction),
      review: current.review.filter((item) => item.id !== `review-${selected.id}` && item.title !== selected.description),
    }));
  }

  function convertSelectedToRecurring() {
    if (!selected) return;

    setState((current) => ({
      ...current,
      recurringRules: [
        ...current.recurringRules,
        {
          id: `rr-from-${selected.id}-${Date.now()}`,
          name: selected.description,
          type: selected.type,
          categoryId: selected.categoryId,
          accountId: selected.accountId,
          amountCents: selected.originalAmountCents,
          currency: selected.originalCurrency,
          frequency: "monthly",
          nextDate: advanceRecurringDate(selected.date, "monthly"),
          merchant: selected.merchant,
          note: selected.note,
          active: true,
        },
      ],
    }));
    setView("rules");
  }

  function createRuleFromSelected() {
    if (!selected) return;

    const matchText = (selected.merchant || selected.description).trim().toLowerCase();
    if (!matchText) return;

    setState((current) => ({
      ...current,
      automationRules: [
        ...current.automationRules,
        {
          id: `ar-from-${selected.id}-${Date.now()}`,
          name: `${selected.description} ${t("a", "to")} ${categoryById(state.categories, selected.categoryId)?.name ?? t("categoria", "category")}`,
          matchText,
          categoryId: selected.categoryId,
          accountId: selected.accountId,
          merchant: selected.merchant,
          subcategory: selected.subcategory,
          tag: selected.tags[0],
          active: true,
        },
      ],
    }));
    setView("rules");
  }

  function createRefundFromSelected() {
    if (!selected) return;
    const refund: Transaction = {
      ...selected,
      id: `refund-${selected.id}-${Date.now()}`,
      type: "refund",
      date: new Date().toISOString().slice(0, 10),
      description: `${t("Reembolso:", "Refund:")} ${selected.description}`,
      linkedTransactionId: selected.id,
      linkKind: "refund",
      status: "needs_review",
      createdBy: state.user.name?.trim() || t("Yo", "Me"),
      splits: undefined,
      audit: [movementAudit("created", `${t("Reembolso vinculado a", "Refund linked to")} ${selected.description}.`, state.user.name?.trim() || t("Yo", "Me"))],
    };
    setState((current) => ({
      ...current,
      transactions: [refund, ...current.transactions],
      review: [
        {
          id: `review-${refund.id}`,
          reason: "ai_suggestion",
          title: refund.description,
          subtitle: t("Confirma monto y cuenta del reembolso antes de aplicarlo.", "Confirm the refund's amount and account before applying it."),
          amountCents: refund.amountCents,
          action: "Confirmar",
          targetType: "transaction",
          targetId: refund.id,
        },
        ...current.review,
      ],
    }));
    setSelectedId(refund.id);
  }

  function addMovementComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !commentDraft.trim()) return;

    setState((current) => ({
      ...current,
      comments: [
        createFamilyComment(current, "transaction", selected.id, commentDraft.trim()),
        ...current.comments,
      ],
    }));
    setCommentDraft("");
  }

  const splitTotal = selected?.splits?.reduce((sum, split) => sum + split.amountCents, 0) ?? 0;

  return (
    <ViewShell title={t("Movimientos", "Transactions")} eyebrow={t("Registro auditable", "Auditable record")} description="">
      <Card>
        <SectionHeader
          title={showAllMonths
            ? t("Todos los movimientos", "All transactions")
            : t(`Movimientos · ${formatMonthLabel(state.activeMonth, lang)}`, `Transactions · ${formatMonthLabel(state.activeMonth, lang)}`)}
          action={t("Añadir", "Add")}
          onAction={() => setView("add")}
        />
        <div className="mt-5 grid gap-3 md:grid-cols-[1fr_0.7fr_0.7fr]">
          <Input label={t("Buscar", "Search")} value={query} onChange={setQuery} placeholder={t("Descripción, comercio, tag o categoría", "Description, merchant, tag or category")} />
          <Select label={t("Estado", "Status")} value={statusFilter} options={["all", "approved", "needs_review", "duplicate", "adjustment"]} render={(value) => value === "all" ? t("Todos", "All") : transactionStatusLabel(value)} onChange={setStatusFilter} />
          <Select label={t("Tipo", "Type")} value={typeFilter} options={["all", "income", "expense", "transfer", "refund", "debt_payment", "saving", "investment"]} render={(value) => value === "all" ? t("Todos", "All") : transactionTypeLabel(value)} onChange={setTypeFilter} />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-[var(--text-muted)]">
            {showAllMonths
              ? t("Mostrando todos los meses", "Showing all months")
              : t(`Mostrando ${formatMonthLabel(state.activeMonth, lang)}`, `Showing ${formatMonthLabel(state.activeMonth, lang)}`)}
          </span>
          <button type="button" onClick={() => setShowAllMonths((value) => !value)} className="rounded-full border border-[var(--line)] bg-white px-3 py-1 font-semibold text-[var(--primary)] transition hover:bg-[var(--surface-muted)]">
            {showAllMonths ? t("Ver solo este mes", "Only this month") : t("Ver todos los meses", "All months")}
          </button>
        </div>
        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
          <div className="min-w-0 divide-y divide-[var(--line)]">
            {filtered.map((transaction) => (
              <button
                className={`grid w-full min-w-0 gap-3 py-4 text-left sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center ${selected?.id === transaction.id ? "rounded-2xl bg-[var(--surface-soft)] px-3" : ""}`}
                key={transaction.id}
                onClick={() => setSelectedId(transaction.id)}
                type="button"
              >
                <TransactionRow state={state} transaction={transaction} />
              </button>
            ))}
            {!filtered.length && (
              <div className="rounded-2xl border border-dashed border-[var(--line)] bg-[var(--surface-soft)] p-6 text-sm text-[var(--text-muted)]">
                <p className="font-semibold text-[var(--foreground)]">{t("No hay movimientos con estos filtros.", "No transactions match these filters.")}</p>
                <p className="mt-1">{t("Cambia los filtros o añade un movimiento nuevo.", "Change the filters or add a new transaction.")}</p>
                <button className="mt-4 rounded-full bg-[var(--lime)] px-4 py-2 text-xs font-bold text-black" onClick={() => setView("add")} type="button">{t("Añadir movimiento", "Add transaction")}</button>
              </div>
            )}
          </div>
          {selected && (
            <div className="min-w-0 rounded-3xl border border-[var(--line)] bg-[var(--surface-soft)] p-5">
              {/* Glance: el número primero, luego descripción y categoría. Todo lo demás vive en el Modal de edición. */}
              <p className="kicker">{transactionStatusLabel(selected.status)}</p>
              <p className={`amount serif mt-1 max-w-full break-words text-[clamp(2rem,5vw,3rem)] font-bold leading-none ${selected.type === "income" || selected.type === "transfer" || selected.type === "refund" ? "text-[var(--primary)]" : ""}`}>
                {selected.type === "income" || selected.type === "refund" ? "+" : selected.type === "transfer" ? "" : "-"}{formatMoney(selected.amountCents, state.currency)}
              </p>
              <h3 className="serif mt-3 text-2xl font-bold leading-tight">{selected.description}</h3>
              <p className="mt-1 text-sm text-[var(--text-muted)]">
                {categoryById(state.categories, selected.categoryId)?.name ?? selected.categoryId}
                {selected.merchant ? ` · ${merchantDisplay(selected.merchant, state.merchantAliases)}` : ""} · {selected.date}
              </p>

              <div className="mt-5 grid gap-2">
                <button className="rounded-2xl bg-[var(--lime)] px-4 py-3 text-sm font-bold text-black" onClick={markSelectedReviewed} type="button">{t("Marcar revisado", "Mark reviewed")}</button>
                <div className="grid grid-cols-2 gap-2">
                  <button className="rounded-2xl bg-white px-4 py-3 text-sm font-bold transition hover:bg-[var(--surface-muted)]" onClick={() => setEditOpen(true)} type="button">{t("Editar", "Edit")}</button>
                  <button className="rounded-2xl bg-white px-4 py-3 text-sm font-bold transition hover:bg-[var(--surface-muted)]" onClick={() => { setSplitError(""); setSplitsOpen(true); }} type="button">
                    {t("Dividir", "Split")}{selected.splits?.length ? ` (${selected.splits.length})` : ""}
                  </button>
                </div>
                <div className="flex items-center justify-between gap-2 rounded-2xl bg-[var(--surface-soft)] px-2 py-1">
                  <button className="rounded-xl px-3 py-2 text-sm font-semibold text-[var(--primary)] transition hover:bg-[var(--surface-muted)]" onClick={() => setInfoOpen(true)} type="button">{t("Más info", "More info")}</button>
                  <RowMenu
                    items={[
                      { label: t("Duplicar", "Duplicate"), onClick: duplicateSelectedTransaction },
                      { label: t("Hacer recurrente", "Make recurring"), onClick: convertSelectedToRecurring },
                      { label: t("Crear regla", "Create rule"), onClick: createRuleFromSelected },
                      { label: t("Crear reembolso", "Create refund"), onClick: createRefundFromSelected },
                      { label: t("Eliminar movimiento", "Delete transaction"), danger: true, onClick: deleteSelectedTransaction },
                    ]}
                  />
                </div>
              </div>

              {selected.linkedTransactionId && (
                <button
                  className="mt-4 flex w-full items-center gap-2 rounded-2xl border border-[var(--line)] bg-[var(--surface-soft)] p-3 text-left text-sm text-[var(--text-muted)] transition hover:border-[var(--primary)]/40 hover:bg-[var(--surface-muted)]"
                  onClick={() => selected.linkedTransactionId && setSelectedId(selected.linkedTransactionId)}
                  type="button"
                >
                  <span className="kicker shrink-0">{selected.linkKind ?? t("vinculo", "link")}</span>
                  <span className="min-w-0 flex-1 truncate font-semibold text-[var(--ink)]">{state.transactions.find((transaction) => transaction.id === selected.linkedTransactionId)?.description ?? selected.linkedTransactionId}</span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-subtle)]" />
                </button>
              )}

              {splitTotal > 0 && (
                <p className={`mt-4 text-sm font-semibold ${splitTotal === selected.amountCents ? "text-[var(--primary)]" : "text-[var(--danger)]"}`}>
                  {t("Dividido", "Split")} {formatMoney(splitTotal, state.currency)} {t("de", "of")} {formatMoney(selected.amountCents, state.currency)}
                </p>
              )}
            </div>
          )}
        </div>
      </Card>

      {/* Editar movimiento: el formulario completo (~14 campos) vive aquí. Primero Monto/Descripción/Categoría;
          el resto se colapsa bajo "Más opciones" para reducir carga cognitiva. Bind a los mismos handlers. */}
      <Modal
        open={editOpen && Boolean(selected)}
        onClose={() => setEditOpen(false)}
        title={t("Editar movimiento", "Edit transaction")}
        footer={<button className="rounded-2xl bg-[var(--lime)] px-5 py-3 text-sm font-bold text-[var(--ink)]" onClick={() => setEditOpen(false)} type="button">{t("Listo", "Done")}</button>}
      >
        {selected && (
          <div className="grid gap-3">
            <AmountInput
              key={selected.id}
              label={`${t("Monto", "Amount")}${selected.originalCurrency !== state.currency ? ` (${selected.originalCurrency})` : ""}`}
              originalAmountCents={selected.originalAmountCents}
              onCommit={(cents) => updateTransaction(selected.id, { originalAmountCents: cents, amountCents: Math.round(cents * selected.exchangeRate) })}
            />
            <Input label={t("Descripción", "Description")} value={selected.description} onChange={(value) => updateTransaction(selected.id, { description: value })} />
            <Select label={t("Categoría", "Category")} value={selected.categoryId} options={state.categories.map((category) => category.id)} render={(id) => categoryById(state.categories, id)?.name ?? id} onChange={(value) => {
              const category = categoryById(state.categories, value);
              updateTransaction(selected.id, {
                categoryId: value,
                subcategory: category?.subcategories[0] ?? "",
                type: selected.type === "transfer" || selected.type === "refund" ? selected.type : transactionTypeForGroup(category?.group),
              });
            }} />
            <details className="rounded-2xl bg-[var(--surface-soft)] p-4">
              <summary className="cursor-pointer select-none text-xs font-bold uppercase tracking-[0.16em] text-[var(--primary)]">{t("Más opciones", "More options")}</summary>
              <div className="mt-4 grid gap-3">
                <Input label={t("Fecha", "Date")} value={selected.date} onChange={(value) => updateTransaction(selected.id, { date: value })} />
                <Input label={t("Comercio/persona", "Merchant/person")} value={selected.merchant ?? ""} onChange={(value) => updateTransaction(selected.id, { merchant: value })} />
                <ComboInput label={t("Subcategoría o detalle libre", "Subcategory or free-form detail")} value={selected.subcategory ?? ""} options={categoryById(state.categories, selected.categoryId)?.subcategories ?? []} onChange={(value) => updateTransaction(selected.id, { subcategory: value })} />
                <Select label={t("Cuenta", "Account")} value={selected.accountId} options={state.accounts.map((account) => account.id)} render={(id) => state.accounts.find((account) => account.id === id)?.name ?? id} onChange={(value) => updateTransaction(selected.id, { accountId: value })} />
                {selected.type === "transfer" && (
                  <Select label={t("Cuenta destino", "To account")} value={selected.transferAccountId ?? ""} options={state.accounts.map((account) => account.id)} render={(id) => state.accounts.find((account) => account.id === id)?.name ?? id} onChange={(value) => updateTransaction(selected.id, { transferAccountId: value })} />
                )}
                <Select label={t("Estado", "Status")} value={selected.status} options={["approved", "needs_review", "duplicate", "adjustment"]} render={(value) => transactionStatusLabel(value)} onChange={(value) => updateTransaction(selected.id, { status: value as Transaction["status"] })} />
                <Input label={t("Tags", "Tags")} value={selected.tags.join(", ")} onChange={(value) => updateTransaction(selected.id, { tags: value.split(",").map((tag) => tag.trim()).filter(Boolean) })} />
                <label className="grid gap-2 text-sm font-semibold">
                  {t("Nota", "Note")}
                  <textarea className="field min-h-20" value={selected.note ?? ""} onChange={(event) => updateTransaction(selected.id, { note: event.target.value })} />
                </label>
              </div>
            </details>
          </div>
        )}
      </Modal>

      {/* Dividir movimiento: formulario + lista de splits aislados del panel. */}
      <Modal
        open={splitsOpen && Boolean(selected)}
        onClose={() => setSplitsOpen(false)}
        title={t("Dividir movimiento", "Split transaction")}
        footer={<button className="rounded-2xl bg-[var(--lime)] px-5 py-3 text-sm font-bold text-[var(--ink)]" onClick={() => setSplitsOpen(false)} type="button">{t("Listo", "Done")}</button>}
      >
        {selected && (
          <div className="grid gap-4">
            <div>
              <p className="text-sm text-[var(--text-muted)]">{t("Total dividido", "Split total")} {formatMoney(splitTotal, state.currency)} {t("de", "of")} {formatMoney(selected.amountCents, state.currency)}</p>
              <p className={`mt-1 text-sm font-semibold ${splitTotal === selected.amountCents ? "text-[var(--primary)]" : "text-[var(--danger)]"}`}>
                {splitTotal === selected.amountCents ? t("Split completo: las categorias reciben el real dividido.", "Split complete: categories receive the divided actual amount.") : `${t("Falta asignar", "Still to assign")} ${formatMoney(selected.amountCents - splitTotal, state.currency)}.`}
              </p>
              {splitError && <p className="mt-1 text-sm font-semibold text-[var(--danger)]">{splitError}</p>}
            </div>
            {(selected.splits ?? []).length > 0 && (
              <div className="space-y-2">
                {(selected.splits ?? []).map((split) => (
                  <div className="grid gap-3 rounded-2xl bg-[var(--surface-soft)] p-3 text-sm sm:grid-cols-[1fr_auto_auto] sm:items-center" key={split.id}>
                    <span>{categoryById(state.categories, split.categoryId)?.name ?? t("Categoria", "Category")} · {split.note ?? t("sin nota", "no note")}</span>
                    <strong className="amount shrink-0 whitespace-nowrap">{formatMoney(split.amountCents, state.currency)}</strong>
                    <button className="rounded-full bg-red-50 px-3 py-1 text-xs font-bold text-[var(--danger)]" onClick={() => deleteSplit(split.id)} type="button">{t("Quitar", "Remove")}</button>
                  </div>
                ))}
              </div>
            )}
            <form className="grid gap-3" onSubmit={addSplit}>
              <Select label={t("Categoría", "Category")} value={splitDraft.categoryId} options={state.categories.filter((category) => category.group !== "income").map((category) => category.id)} render={(id) => categoryById(state.categories, id)?.name ?? id} onChange={(value) => setSplitDraft((current) => ({ ...current, categoryId: value }))} />
              <Input label={t("Monto", "Amount")} value={splitDraft.amount} onChange={(value) => setSplitDraft((current) => ({ ...current, amount: value }))} placeholder="0.00" />
              <Input label={t("Nota", "Note")} value={splitDraft.note} onChange={(value) => setSplitDraft((current) => ({ ...current, note: value }))} placeholder={t("Parte del movimiento", "Part of the transaction")} />
              <button className="rounded-2xl bg-[var(--lime)] px-5 py-3 text-sm font-bold text-[var(--ink)]" type="submit">{t("Agregar split", "Add split")}</button>
            </form>
          </div>
        )}
      </Modal>

      {/* Más info: adjuntos, productos, historial y comentarios (lecturas + comentar) en un solo lugar. */}
      <Modal
        open={infoOpen && Boolean(selected)}
        onClose={() => setInfoOpen(false)}
        title={t("Más info", "More info")}
        footer={<button className="rounded-2xl bg-[var(--lime)] px-5 py-3 text-sm font-bold text-[var(--ink)]" onClick={() => setInfoOpen(false)} type="button">{t("Listo", "Done")}</button>}
      >
        {selected && (
          <div className="grid gap-5">
            {selected.attachmentNames?.length ? (
              <div className="rounded-2xl bg-[var(--surface-soft)] p-4">
                <p className="font-semibold">{t("Adjuntos", "Attachments")}</p>
                <p className="mt-1 text-sm text-[var(--text-muted)]">{selected.attachmentNames.join(", ")}</p>
              </div>
            ) : null}

            {/* Productos: read-only factura lines parsed at captura (name · cantidad · importe). */}
            {selected.lineItems?.length ? (
              <div className="rounded-2xl bg-[var(--surface-soft)] p-4">
                <p className="font-semibold">{t("Productos", "Products")}</p>
                <div className="mt-3 space-y-2">
                  {selected.lineItems.map((item, index) => (
                    <div className="grid grid-cols-[1fr_auto_auto] items-baseline gap-3 text-sm" key={`${item.name}-${index}`}>
                      <span className="min-w-0 truncate text-[var(--foreground)]">{item.name || t("Producto", "Product")}</span>
                      <span className="text-xs text-[var(--text-muted)]">x{item.quantity || 1}</span>
                      <strong className="amount shrink-0 whitespace-nowrap text-[var(--foreground)]">{formatMoney(item.amountCents, selected.originalCurrency)}</strong>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="rounded-2xl bg-[var(--surface-soft)] p-4">
              <p className="font-semibold">{t("Historial del movimiento", "Transaction history")}</p>
              <div className="mt-3 space-y-2">
                {(selected.audit ?? [movementAudit("created", t("Movimiento importado o creado antes del historial local.", "Transaction imported or created before local history."), selected.createdBy)]).map((event) => (
                  <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-soft)] p-3 text-sm" key={event.id}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold">{event.summary}</span>
                      <span className="text-xs text-[var(--text-muted)]">{new Date(event.at).toLocaleString("es-DO")}</span>
                    </div>
                    <p className="mt-1 text-xs uppercase tracking-[0.16em] text-[var(--text-muted)]">{event.by} · {event.action}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl bg-[var(--surface-soft)] p-4">
              <p className="font-semibold">{t("Comentarios familiares", "Family comments")}</p>
              <form className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]" onSubmit={addMovementComment}>
                <Input label={t("Comentario", "Comment")} value={commentDraft} onChange={setCommentDraft} placeholder={t("Ej. Esto me lo van a reembolsar", "e.g. This will be reimbursed to me")} />
                <div className="flex items-end">
                  <button className="w-full rounded-2xl bg-[var(--lime)] px-5 py-3 text-sm font-bold text-[var(--ink)]" type="submit">{t("Comentar", "Comment")}</button>
                </div>
              </form>
              <CommentList comments={commentsForTarget(state, "transaction", selected.id)} />
            </div>
          </div>
        )}
      </Modal>
    </ViewShell>
  );
}

function accountKindIcon(kind: AppState["accounts"][number]["kind"]) {
  switch (kind) {
    case "cash":
      return <WalletCards className="h-5 w-5" />;
    case "credit":
      return <CreditCard className="h-5 w-5" />;
    case "investment":
      return <Building2 className="h-5 w-5" />;
    case "savings":
      return <Landmark className="h-5 w-5" />;
    default:
      return <Landmark className="h-5 w-5" />;
  }
}

function AccountsView({ state, setState, setView }: { state: AppState; setState: Dispatch<SetStateAction<AppState>>; setView: (view: View) => void }) {
  const { t } = useT();
  const activeAccounts = state.accounts.filter((account) => !account.archived);
  const emptyDraft = {
    name: "",
    kind: "bank" as AppState["accounts"][number]["kind"],
    currency: state.currency,
    balance: "",
    notes: "",
  };
  const [showNew, setShowNew] = useState(false);
  const [draft, setDraft] = useState(emptyDraft);
  // Edit-one-at-a-time draft for the account edit Modal.
  const [editId, setEditId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({
    name: "",
    kind: "bank" as AppState["accounts"][number]["kind"],
    currency: state.currency,
    notes: "",
  });
  // Reconcile Modal target (account id) + form.
  const [reconcileId, setReconcileId] = useState<string | null>(null);
  const [reconcile, setReconcile] = useState({ actual: "", note: "" });
  const editAccount = state.accounts.find((account) => account.id === editId) ?? null;
  const reconcileAccountItem = state.accounts.find((account) => account.id === reconcileId) ?? null;
  const total = state.accounts
    .filter((account) => !account.archived && account.includeInNetWorth !== false)
    .reduce((sum, account) => sum + (account.currency === state.currency || !account.currency ? account.balanceCents : 0), 0);

  function addAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.name.trim()) return;

    setState((current) => ({
      ...current,
      accounts: normalizeAccounts([
        ...current.accounts,
        {
          id: `account-${Date.now()}`,
          name: draft.name.trim(),
          kind: draft.kind,
          currency: draft.currency as CurrencyCode,
          balanceCents: toCents(draft.balance),
          confirmedBalanceCents: toCents(draft.balance),
          lastConfirmedAt: new Date().toISOString().slice(0, 10),
          includeInNetWorth: true,
          notes: draft.notes.trim() || undefined,
        },
      ]),
    }));
    setDraft(emptyDraft);
    setShowNew(false);
  }

  function openEdit(account: AppState["accounts"][number]) {
    setEditDraft({
      name: account.name,
      kind: account.kind,
      currency: (account.currency ?? state.currency) as CurrencyCode,
      notes: account.notes ?? "",
    });
    setEditId(account.id);
  }

  function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editId || !editDraft.name.trim()) return;
    updateAccount(editId, {
      name: editDraft.name.trim(),
      kind: editDraft.kind,
      currency: editDraft.currency as CurrencyCode,
      notes: editDraft.notes.trim() || undefined,
    });
    setEditId(null);
  }

  function openReconcile(id: string) {
    setReconcile({ actual: "", note: "" });
    setReconcileId(id);
  }

  function updateAccount(id: string, patch: Partial<AppState["accounts"][number]>) {
    setState((current) => ({
      ...current,
      accounts: normalizeAccounts(current.accounts.map((account) => account.id === id ? { ...account, ...patch } : account)),
    }));
  }

  function setDefaultAccount(id: string) {
    setState((current) => ({
      ...current,
      accounts: current.accounts.map((account) => ({ ...account, defaultForCapture: account.id === id })),
    }));
  }

  function archiveAccount(id: string) {
    setState((current) => ({
      ...current,
      accounts: normalizeAccounts(current.accounts.map((account) => account.id === id ? { ...account, archived: !account.archived, defaultForCapture: false } : account)),
    }));
  }

  function reconcileAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const account = state.accounts.find((item) => item.id === reconcileId);
    if (!account || !reconcile.actual) return;

    const actualCents = toCents(reconcile.actual);
    const difference = actualCents - account.balanceCents;
    const positive = difference >= 0;
    const category = state.categories.find((item) => positive ? item.group === "income" : item.group !== "income") ?? state.categories[0];
    const adjustment: Transaction = {
      id: `adjust-${Date.now()}`,
      type: positive ? "income" : "expense",
      date: new Date().toISOString().slice(0, 10),
      description: `${t("Ajuste de saldo -", "Balance adjustment -")} ${account.name}`,
      categoryId: category.id,
      subcategory: t("Conciliacion manual", "Manual reconciliation"),
      accountId: account.id,
      merchant: account.name,
      tags: ["conciliacion"],
      note: reconcile.note || `${t("Saldo anterior", "Previous balance")} ${formatMoney(account.balanceCents, account.currency ?? state.currency)}; ${t("saldo real", "actual balance")} ${formatMoney(actualCents, account.currency ?? state.currency)}.`,
      originalAmountCents: Math.abs(difference),
      originalCurrency: account.currency ?? state.currency,
      amountCents: Math.abs(difference),
      baseCurrency: account.currency ?? state.currency,
      exchangeRate: 1,
      exchangeRateDate: new Date().toISOString().slice(0, 10),
      exchangeRateSource: "same_currency",
      status: "adjustment",
      createdBy: t("Conciliacion manual", "Manual reconciliation"),
    };

    setState((current) => ({
      ...current,
      accounts: current.accounts.map((item) => item.id === account.id ? { ...item, balanceCents: actualCents, confirmedBalanceCents: actualCents, lastConfirmedAt: new Date().toISOString().slice(0, 10) } : item),
      transactions: [adjustment, ...current.transactions],
      review: [
        {
          id: `review-${adjustment.id}`,
          reason: "balance_adjustment",
          title: account.name,
          subtitle: `${t("Diferencia", "Difference")} ${formatMoney(difference, account.currency ?? state.currency)} ${t("registrada como ajuste.", "recorded as an adjustment.")}`,
          amountCents: difference,
          action: t("Confirmar", "Confirm"),
          targetType: "transaction",
          targetId: adjustment.id,
        },
        ...current.review,
      ],
    }));
    setReconcile({ actual: "", note: "" });
    setReconcileId(null);
  }

  return (
    <ViewShell
      title={t("Cuentas", "Accounts")}
      eyebrow={t("Saldos y conciliacion", "Balances and reconciliation")}
      description={t("Administra cuentas reales, saldos y conciliación mensual.", "Manage real accounts, balances and monthly reconciliation.")}
      action={
        <button className="inline-flex items-center gap-2 rounded-2xl bg-[var(--lime)] px-5 py-3 text-sm font-bold text-[var(--ink)]" onClick={() => { setDraft(emptyDraft); setShowNew(true); }} type="button">
          <Plus className="h-4 w-4" />
          {t("Nueva cuenta", "New account")}
        </button>
      }
    >
      <div className="grid gap-4 md:grid-cols-3">
        <Card><Metric label={t("Saldo base", "Base balance")} value={formatMoney(total, state.currency)} tone="good" /></Card>
        <Card><Metric label={t("Cuentas activas", "Active accounts")} value={`${activeAccounts.length}/${state.accounts.length}`} /></Card>
        <Card><Metric label={t("A conciliar", "To reconcile")} value={String(state.review.filter((item) => item.reason === "balance_adjustment").length)} tone="bad" /></Card>
      </div>

      <Card>
        <div className="grid gap-2.5">
          {state.accounts.length ? (
            state.accounts.map((account) => {
              const currency = account.currency ?? state.currency;
              const sublabelParts = [accountKindLabel(account.kind), currency];
              if (account.defaultForCapture) sublabelParts.push(t("Predeterminada", "Default"));
              if (account.archived) sublabelParts.push(t("Archivada", "Archived"));
              return (
                <div className={account.archived ? "opacity-70" : ""} key={account.id}>
                  <CompactRow
                    icon={accountKindIcon(account.kind)}
                    label={account.name}
                    sublabel={sublabelParts.join(" · ")}
                    value={formatMoney(account.balanceCents, currency)}
                    valueTone={account.balanceCents < 0 ? "danger" : "primary"}
                    onClick={() => openEdit(account)}
                    menu={[
                      { label: t("Editar", "Edit"), onClick: () => openEdit(account) },
                      { label: t("Confirmar saldo", "Confirm balance"), onClick: () => updateAccount(account.id, { confirmedBalanceCents: account.balanceCents, lastConfirmedAt: new Date().toISOString().slice(0, 10) }) },
                      ...(account.archived ? [] : [{ label: account.defaultForCapture ? t("Cuenta por defecto", "Default account") : t("Hacer predeterminada", "Make default"), onClick: () => setDefaultAccount(account.id) }]),
                      { label: t("Conciliar", "Reconcile"), onClick: () => openReconcile(account.id) },
                      { label: t("Transferir", "Transfer"), onClick: () => setView("add") },
                      { label: t("Ver movimientos", "View transactions"), onClick: () => setView("movements") },
                      { label: account.includeInNetWorth !== false ? t("Excluir de patrimonio", "Exclude from net worth") : t("Incluir en patrimonio", "Include in net worth"), onClick: () => updateAccount(account.id, { includeInNetWorth: account.includeInNetWorth === false }) },
                      { label: account.archived ? t("Reactivar", "Reactivate") : t("Archivar", "Archive"), danger: !account.archived, onClick: () => archiveAccount(account.id) },
                    ]}
                  />
                </div>
              );
            })
          ) : (
            <EmptyState
              title={t("Aún no hay cuentas", "No accounts yet")}
              subtitle={t("Crea tu primera cuenta para registrar saldos y conciliar.", "Create your first account to track balances and reconcile.")}
            >
              <button className="rounded-2xl bg-[var(--lime)] px-5 py-3 text-sm font-bold text-[var(--ink)]" onClick={() => { setDraft(emptyDraft); setShowNew(true); }} type="button">{t("Nueva cuenta", "New account")}</button>
            </EmptyState>
          )}
        </div>
      </Card>

      <Modal
        open={showNew}
        onClose={() => setShowNew(false)}
        title={t("Nueva cuenta", "New account")}
        footer={
          <>
            <button className="rounded-2xl border border-[var(--line)] bg-white px-5 py-3 text-sm font-bold" onClick={() => setShowNew(false)} type="button">{t("Cancelar", "Cancel")}</button>
            <button className="rounded-2xl bg-[var(--lime)] px-5 py-3 text-sm font-bold text-[var(--ink)] disabled:opacity-70" disabled={!draft.name.trim()} form="account-new-form" type="submit">{t("Agregar", "Add")}</button>
          </>
        }
      >
        <form className="grid gap-4" id="account-new-form" onSubmit={addAccount}>
          <Input label={t("Nombre", "Name")} value={draft.name} onChange={(value) => setDraft((current) => ({ ...current, name: value }))} placeholder={t("p.ej. Mi banco", "e.g. My bank")} />
          <Input label={t("Saldo inicial", "Initial balance")} value={draft.balance} onChange={(value) => setDraft((current) => ({ ...current, balance: value }))} placeholder="0.00" />
          <details className="rounded-2xl bg-[var(--surface-soft)] p-4">
            <summary className="cursor-pointer select-none text-xs font-bold uppercase tracking-[0.16em] text-[var(--primary)]">{t("Más opciones", "More options")}</summary>
            <div className="mt-4 grid gap-4">
              <Select label={t("Tipo", "Type")} value={draft.kind} options={["cash", "bank", "credit", "savings", "investment"]} render={(value) => accountKindLabel(value)} onChange={(value) => setDraft((current) => ({ ...current, kind: value as typeof draft.kind }))} />
              <Select label={t("Moneda", "Currency")} value={draft.currency} options={supportedCurrencies} onChange={(value) => setDraft((current) => ({ ...current, currency: value as CurrencyCode }))} />
              <Input label={t("Notas", "Notes")} value={draft.notes} onChange={(value) => setDraft((current) => ({ ...current, notes: value }))} placeholder={t("p.ej. Corte del mes, uso", "e.g. Statement date, usage")} />
            </div>
          </details>
        </form>
      </Modal>

      <Modal
        open={Boolean(editAccount)}
        onClose={() => setEditId(null)}
        title={t("Editar cuenta", "Edit account")}
        footer={
          <>
            <button className="rounded-2xl border border-[var(--line)] bg-white px-5 py-3 text-sm font-bold" onClick={() => setEditId(null)} type="button">{t("Cancelar", "Cancel")}</button>
            <button className="rounded-2xl bg-[var(--lime)] px-5 py-3 text-sm font-bold text-[var(--ink)] disabled:opacity-70" disabled={!editDraft.name.trim()} form="account-edit-form" type="submit">{t("Guardar", "Save")}</button>
          </>
        }
      >
        {editAccount && (
          <form className="grid gap-4" id="account-edit-form" onSubmit={saveEdit}>
            <Input label={t("Nombre", "Name")} value={editDraft.name} onChange={(value) => setEditDraft((current) => ({ ...current, name: value }))} />
            <Select label={t("Tipo", "Type")} value={editDraft.kind} options={["cash", "bank", "credit", "savings", "investment"]} render={(value) => accountKindLabel(value)} onChange={(value) => setEditDraft((current) => ({ ...current, kind: value as AppState["accounts"][number]["kind"] }))} />
            <details className="rounded-2xl bg-[var(--surface-soft)] p-4">
              <summary className="cursor-pointer select-none text-xs font-bold uppercase tracking-[0.16em] text-[var(--primary)]">{t("Más opciones", "More options")}</summary>
              <div className="mt-4 grid gap-4">
                <Select label={t("Moneda", "Currency")} value={editDraft.currency} options={supportedCurrencies} onChange={(value) => setEditDraft((current) => ({ ...current, currency: value as CurrencyCode }))} />
                <Input label={t("Notas", "Notes")} value={editDraft.notes} onChange={(value) => setEditDraft((current) => ({ ...current, notes: value }))} placeholder={t("p.ej. Corte del mes, uso", "e.g. Statement date, usage")} />
              </div>
            </details>
            <p className="text-xs text-[var(--text-muted)]">{t("Confirmada", "Confirmed")} {editAccount.lastConfirmedAt ?? t("sin confirmar", "unconfirmed")}</p>
          </form>
        )}
      </Modal>

      <Modal
        open={Boolean(reconcileAccountItem)}
        onClose={() => setReconcileId(null)}
        title={t("Conciliar cuenta", "Reconcile account")}
        footer={
          <>
            <button className="rounded-2xl border border-[var(--line)] bg-white px-5 py-3 text-sm font-bold" onClick={() => setReconcileId(null)} type="button">{t("Cancelar", "Cancel")}</button>
            <button className="rounded-2xl bg-[var(--lime)] px-5 py-3 text-sm font-bold text-[var(--ink)] disabled:opacity-70" disabled={!reconcile.actual} form="account-reconcile-form" type="submit">{t("Conciliar", "Reconcile")}</button>
          </>
        }
      >
        {reconcileAccountItem && (
          <form className="grid gap-4" id="account-reconcile-form" onSubmit={reconcileAccount}>
            <p className="text-sm text-[var(--text-muted)]">{reconcileAccountItem.name} · {t("Saldo actual", "Current balance")} {formatMoney(reconcileAccountItem.balanceCents, reconcileAccountItem.currency ?? state.currency)}</p>
            <Input label={t("Saldo real", "Actual balance")} value={reconcile.actual} onChange={(value) => setReconcile((current) => ({ ...current, actual: value }))} placeholder="0.00" />
            <Input label={t("Nota", "Note")} value={reconcile.note} onChange={(value) => setReconcile((current) => ({ ...current, note: value }))} placeholder={t("p.ej. Corte del 30 de junio", "e.g. Statement as of June 30")} />
          </form>
        )}
      </Modal>
    </ViewShell>
  );
}

function RulesView({ state, setState }: { state: AppState; setState: Dispatch<SetStateAction<AppState>> }) {
  const { t } = useT();
  const firstExpense = state.categories.find((category) => category.group !== "income") ?? state.categories[0];
  const [recurringDraft, setRecurringDraft] = useState({
    name: "",
    type: "expense" as TransactionType,
    categoryId: firstExpense.id,
    accountId: state.accounts[0]?.id ?? "",
    amount: "",
    currency: state.currency,
    frequency: "monthly" as RecurringFrequency,
    nextDate: `${state.activeMonth}-01`,
    merchant: "",
    note: "",
  });
  const [ruleDraft, setRuleDraft] = useState({
    name: "",
    matchText: "",
    categoryId: firstExpense.id,
    accountId: "",
    merchant: "",
    subcategory: "",
    tag: "",
  });
  const emptyRecurringDraft = {
    name: "",
    type: "expense" as TransactionType,
    categoryId: firstExpense.id,
    accountId: state.accounts[0]?.id ?? "",
    amount: "",
    currency: state.currency,
    frequency: "monthly" as RecurringFrequency,
    nextDate: `${state.activeMonth}-01`,
    merchant: "",
    note: "",
  };
  const emptyRuleDraft = {
    name: "",
    matchText: "",
    categoryId: firstExpense.id,
    accountId: "",
    merchant: "",
    subcategory: "",
    tag: "",
  };
  const [operationMessage, setOperationMessage] = useState("");
  // Modal targets: "new" opens the create form, an id opens that row's edit form.
  const [showNewRecurring, setShowNewRecurring] = useState(false);
  const [showNewRule, setShowNewRule] = useState(false);
  const [editRecurringId, setEditRecurringId] = useState<string | null>(null);
  const [editRuleId, setEditRuleId] = useState<string | null>(null);
  const editRecurringRule = state.recurringRules.find((rule) => rule.id === editRecurringId) ?? null;
  const editAutomationRule = state.automationRules.find((rule) => rule.id === editRuleId) ?? null;
  const latestRuleApplications = [...state.ruleApplications].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 8);
  const activeRuleCategories = state.categories.filter((category) => !category.archived);
  const activeRuleAccounts = state.accounts.filter((account) => !account.archived);

  function addRecurringRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!recurringDraft.name.trim() || !recurringDraft.amount || !recurringDraft.accountId) return;

    setState((current) => ({
      ...current,
      recurringRules: [
        ...current.recurringRules,
        {
          id: `rr-${Date.now()}`,
          name: recurringDraft.name.trim(),
          type: recurringDraft.type,
          categoryId: recurringDraft.categoryId,
          accountId: recurringDraft.accountId,
          amountCents: toCents(recurringDraft.amount),
          currency: recurringDraft.currency as CurrencyCode,
          frequency: recurringDraft.frequency,
          nextDate: recurringDraft.nextDate,
          merchant: recurringDraft.merchant.trim() || undefined,
          note: recurringDraft.note.trim() || undefined,
          active: true,
        },
      ],
    }));
    setRecurringDraft(emptyRecurringDraft);
    setShowNewRecurring(false);
    setOperationMessage(t("Regla recurrente creada. Se generara como movimiento pendiente cuando corresponda.", "Recurring rule created. It will be generated as a pending transaction when due."));
  }

  function openEditRecurring(rule: AppState["recurringRules"][number]) {
    setRecurringDraft({
      name: rule.name,
      type: rule.type,
      categoryId: rule.categoryId,
      accountId: rule.accountId,
      amount: (rule.amountCents / 100).toString(),
      currency: rule.currency,
      frequency: rule.frequency,
      nextDate: rule.nextDate,
      merchant: rule.merchant ?? "",
      note: rule.note ?? "",
    });
    setEditRecurringId(rule.id);
  }

  function saveRecurringRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editRecurringId || !recurringDraft.name.trim() || !recurringDraft.amount || !recurringDraft.accountId) return;

    setState((current) => ({
      ...current,
      recurringRules: current.recurringRules.map((rule) => rule.id === editRecurringId ? {
        ...rule,
        name: recurringDraft.name.trim(),
        type: recurringDraft.type,
        categoryId: recurringDraft.categoryId,
        accountId: recurringDraft.accountId,
        amountCents: toCents(recurringDraft.amount),
        currency: recurringDraft.currency as CurrencyCode,
        frequency: recurringDraft.frequency,
        nextDate: recurringDraft.nextDate,
        merchant: recurringDraft.merchant.trim() || undefined,
        note: recurringDraft.note.trim() || undefined,
      } : rule),
    }));
    setRecurringDraft(emptyRecurringDraft);
    setEditRecurringId(null);
    setOperationMessage(t("Regla recurrente actualizada.", "Recurring rule updated."));
  }

  function deleteRecurringRule(ruleId: string) {
    setState((current) => ({
      ...current,
      recurringRules: current.recurringRules.filter((rule) => rule.id !== ruleId),
    }));
    if (editRecurringId === ruleId) setEditRecurringId(null);
    setOperationMessage(t("Regla recurrente eliminada.", "Recurring rule deleted."));
  }

  function addAutomationRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ruleDraft.name.trim() || !ruleDraft.matchText.trim()) return;

    setState((current) => ({
      ...current,
      automationRules: [
        ...current.automationRules,
        {
          id: `ar-${Date.now()}`,
          name: ruleDraft.name.trim(),
          matchText: ruleDraft.matchText.trim().toLowerCase(),
          categoryId: ruleDraft.categoryId,
          accountId: ruleDraft.accountId || undefined,
          merchant: ruleDraft.merchant.trim() || undefined,
          subcategory: ruleDraft.subcategory.trim() || undefined,
          tag: ruleDraft.tag.trim() || undefined,
          active: true,
        },
      ],
    }));
    setRuleDraft(emptyRuleDraft);
    setShowNewRule(false);
    setOperationMessage(t("Regla creada.", "Rule created."));
  }

  function openEditRule(rule: AppState["automationRules"][number]) {
    setRuleDraft({
      name: rule.name,
      matchText: rule.matchText,
      categoryId: rule.categoryId,
      accountId: rule.accountId ?? "",
      merchant: rule.merchant ?? "",
      subcategory: rule.subcategory ?? "",
      tag: rule.tag ?? "",
    });
    setEditRuleId(rule.id);
  }

  function saveAutomationRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editRuleId || !ruleDraft.name.trim() || !ruleDraft.matchText.trim()) return;

    setState((current) => ({
      ...current,
      automationRules: current.automationRules.map((rule) => rule.id === editRuleId ? {
        ...rule,
        name: ruleDraft.name.trim(),
        matchText: ruleDraft.matchText.trim().toLowerCase(),
        categoryId: ruleDraft.categoryId,
        accountId: ruleDraft.accountId || undefined,
        merchant: ruleDraft.merchant.trim() || undefined,
        subcategory: ruleDraft.subcategory.trim() || undefined,
        tag: ruleDraft.tag.trim() || undefined,
      } : rule),
    }));
    setRuleDraft(emptyRuleDraft);
    setEditRuleId(null);
    setOperationMessage(t("Regla actualizada.", "Rule updated."));
  }

  function deleteAutomationRule(ruleId: string) {
    setState((current) => ({
      ...current,
      automationRules: current.automationRules.filter((rule) => rule.id !== ruleId),
    }));
    if (editRuleId === ruleId) setEditRuleId(null);
    setOperationMessage(t("Regla eliminada.", "Rule deleted."));
  }

  function toggleRecurringRule(ruleId: string) {
    setState((current) => ({
      ...current,
      recurringRules: current.recurringRules.map((rule) => rule.id === ruleId ? { ...rule, active: !rule.active } : rule),
    }));
  }

  function toggleAutomationRule(ruleId: string) {
    setState((current) => ({
      ...current,
      automationRules: current.automationRules.map((rule) => rule.id === ruleId ? { ...rule, active: !rule.active } : rule),
    }));
  }

  function skipRecurringThisMonth(ruleId: string) {
    const rule = state.recurringRules.find((item) => item.id === ruleId);
    if (!rule) return;

    let nextDate = rule.nextDate;
    const endDate = endOfMonth(state.activeMonth);
    while (nextDate <= endDate) nextDate = advanceRecurringDate(nextDate, rule.frequency);

    const event: RuleApplication = {
      // eslint-disable-next-line react-hooks/purity -- runs only in this click handler, not during render
      id: `ra-skip-${rule.id}-${Date.now()}`,
      ruleId: rule.id,
      ruleName: rule.name,
      kind: "recurring",
      summary: `${t("Se omitio", "Skipped")} ${rule.name} ${t("en", "in")} ${state.activeMonth}; ${t("proxima fecha", "next date")} ${nextDate}.`,
      status: "skipped",
      createdAt: new Date().toISOString(),
    };

    setState((current) => ({
      ...current,
      recurringRules: current.recurringRules.map((item) => item.id === rule.id ? { ...item, nextDate } : item),
      ruleApplications: [event, ...current.ruleApplications].slice(0, 250),
      review: current.review.filter((item) => item.id !== `review-recurring-${current.activeMonth}-${rule.id}`),
    }));
    setOperationMessage(`${rule.name} ${t("omitido este mes. La regla sigue activa para la siguiente fecha.", "skipped this month. The rule stays active for the next date.")}`);
  }

  async function markRecurringPaid(ruleId: string) {
    const rule = state.recurringRules.find((item) => item.id === ruleId);
    if (!rule) return;

    const date = rule.nextDate < `${state.activeMonth}-01` ? `${state.activeMonth}-01` : rule.nextDate;
    const quote = await quoteExchangeRate(rule.currency, state.currency);
    const transactionId = `paid-${rule.id}-${date}-${state.transactions.length + state.ruleApplications.length}`;
    const transaction: Transaction = {
      id: transactionId,
      type: rule.type,
      date,
      description: rule.name,
      categoryId: rule.categoryId,
      subcategory: t("Recurrente", "Recurring"),
      accountId: rule.accountId,
      merchant: rule.merchant,
      tags: ["recurrente", "pagado"],
      note: rule.note,
      originalAmountCents: rule.amountCents,
      originalCurrency: rule.currency,
      amountCents: Math.round(rule.amountCents * quote.rate),
      baseCurrency: state.currency,
      exchangeRate: quote.rate,
      exchangeRateDate: quote.date,
      exchangeRateSource: quote.source,
      status: "approved",
      createdBy: t("Regla recurrente", "Recurring rule"),
      audit: [movementAudit("created", `${t("Recurrente marcado como pagado:", "Recurring marked as paid:")} ${rule.name}.`, state.user.name || "RindoMes")],
    };
    let nextDate = advanceRecurringDate(date, rule.frequency);
    while (nextDate <= endOfMonth(state.activeMonth)) nextDate = advanceRecurringDate(nextDate, rule.frequency);

    const event: RuleApplication = {
      id: `ra-paid-${rule.id}-${transaction.id}`,
      ruleId: rule.id,
      ruleName: rule.name,
      kind: "recurring",
      transactionId: transaction.id,
      transactionDescription: transaction.description,
      summary: `${t("Marco", "Marked")} ${transaction.description} ${t("como pagado el", "as paid on")} ${transaction.date}.`,
      status: "classified",
      createdAt: new Date().toISOString(),
    };

    setState((current) => ({
      ...current,
      accounts: applyAccountEffect(current.accounts, transaction, 1),
      transactions: [transaction, ...current.transactions],
      recurringRules: current.recurringRules.map((item) => item.id === rule.id ? { ...item, nextDate } : item),
      ruleApplications: [event, ...current.ruleApplications].slice(0, 250),
      review: current.review.filter((item) => item.id !== `review-recurring-${current.activeMonth}-${rule.id}`),
    }));
    setOperationMessage(`${rule.name} ${t("registrado como pagado y aplicado a la cuenta.", "recorded as paid and applied to the account.")}`);
  }

  async function generateRecurringForMonth() {
    const endDate = endOfMonth(state.activeMonth);
    const startDate = `${state.activeMonth}-01`;
    const activeRules = state.recurringRules.filter((rule) => rule.active && rule.nextDate <= endDate);
    if (!activeRules.length) {
      setOperationMessage(t("No hay reglas recurrentes pendientes para este mes.", "No recurring rules pending for this month."));
      return;
    }

    const generated: Array<{ transaction: Transaction; rule: (typeof activeRules)[number] }> = [];
    const updatedNextDates = new Map<string, string>();
    for (const rule of activeRules) {
      let dueDate = rule.nextDate;
      while (dueDate < startDate) dueDate = advanceRecurringDate(dueDate, rule.frequency);

      const quote = await quoteExchangeRate(rule.currency, state.currency);
      while (dueDate <= endDate) {
        const id = `rec-${rule.id}-${dueDate}`;
        if (!state.transactions.some((transaction) => transaction.id === id)) {
          generated.push({
            rule,
            transaction: {
              id,
              type: rule.type,
              date: dueDate,
              description: rule.name,
              categoryId: rule.categoryId,
              subcategory: t("Recurrente", "Recurring"),
              accountId: rule.accountId,
              merchant: rule.merchant,
              tags: ["recurrente"],
              note: rule.note,
              originalAmountCents: rule.amountCents,
              originalCurrency: rule.currency,
              amountCents: Math.round(rule.amountCents * quote.rate),
              baseCurrency: state.currency,
              exchangeRate: quote.rate,
              exchangeRateDate: quote.date,
              exchangeRateSource: quote.source,
              status: "needs_review",
              createdBy: t("Regla recurrente", "Recurring rule"),
            },
          });
        }
        dueDate = advanceRecurringDate(dueDate, rule.frequency);
      }
      updatedNextDates.set(rule.id, dueDate);
    }

    const generatedTransactions = generated.map((item) => item.transaction);
    const applicationEvents: RuleApplication[] = generated.map((item, index) => ({
      id: `ra-${item.rule.id}-${item.transaction.date}-${Date.now()}-${index}`,
      ruleId: item.rule.id,
      ruleName: item.rule.name,
      kind: "recurring",
      transactionId: item.transaction.id,
      transactionDescription: item.transaction.description,
      summary: `${t("Creo", "Created")} ${item.transaction.description} ${t("para", "for")} ${item.transaction.date} ${t("y lo envio a revision.", "and sent it to review.")}`,
      status: "created_pending",
      createdAt: new Date(Date.now() + index).toISOString(),
    }));

    setState((current) => ({
      ...current,
      recurringRules: current.recurringRules.map((rule) => updatedNextDates.has(rule.id) ? { ...rule, nextDate: updatedNextDates.get(rule.id) ?? rule.nextDate } : rule),
      transactions: [...generatedTransactions, ...current.transactions],
      ruleApplications: [...applicationEvents, ...current.ruleApplications].slice(0, 250),
      review: [
        ...generatedTransactions.map((transaction) => ({
          id: `review-${transaction.id}`,
          reason: "uncategorized" as const,
          title: transaction.description,
          subtitle: `${t("Recurrente generado para", "Recurring generated for")} ${transaction.date}; ${t("confirma monto, tasa y categoria.", "confirm amount, rate and category.")}`,
          amountCents: transaction.type === "income" ? transaction.amountCents : -transaction.amountCents,
          action: t("Confirmar", "Confirm"),
          targetType: "transaction" as const,
          targetId: transaction.id,
        })),
        ...current.review,
      ],
    }));
    setOperationMessage(`${generatedTransactions.length} ${t("movimientos recurrentes generados y enviados a revision.", "recurring transactions generated and sent to review.")}`);
  }

  function applyAutomationRules() {
    let changedCount = 0;

    setState((current) => {
      const activeRules = current.automationRules.filter((rule) => rule.active);
      const applicationEvents: RuleApplication[] = [];
      const changedTransactionIds = new Set<string>();
      const transactions = current.transactions.map((transaction) => {
        if (transaction.status !== "needs_review") return transaction;

        const haystack = [transaction.description, transaction.merchant, transaction.note, transaction.subcategory, ...transaction.tags]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        const rule = activeRules.find((item) => haystack.includes(item.matchText.toLowerCase()));
        if (!rule) return transaction;

        changedTransactionIds.add(transaction.id);
        applicationEvents.push({
          id: `ra-${rule.id}-${transaction.id}-${Date.now()}-${applicationEvents.length}`,
          ruleId: rule.id,
          ruleName: rule.name,
          kind: "automation",
          transactionId: transaction.id,
          transactionDescription: transaction.description,
          summary: `${t("Clasifico", "Classified")} ${transaction.description} ${t("como", "as")} ${categoryById(current.categories, rule.categoryId)?.name ?? t("categoria", "category")}${rule.subcategory ? ` / ${rule.subcategory}` : ""}.`,
          status: "classified",
          createdAt: new Date(Date.now() + applicationEvents.length).toISOString(),
        });
        return {
          ...transaction,
          categoryId: rule.categoryId,
          accountId: rule.accountId ?? transaction.accountId,
          merchant: rule.merchant ?? transaction.merchant,
          subcategory: rule.subcategory ?? transaction.subcategory,
          tags: rule.tag ? Array.from(new Set([...transaction.tags, rule.tag])) : transaction.tags,
          note: [transaction.note, `${t("Regla aplicada:", "Rule applied:")} ${rule.name}`].filter(Boolean).join(" | "),
          status: "approved" as const,
          audit: [
            ...(transaction.audit ?? []),
            {
              id: `audit-rule-${rule.id}-${Date.now()}`,
              at: new Date().toISOString(),
              by: t("Reglas", "Rules"),
              action: "edited" as const,
              summary: `${t("Regla aplicada:", "Rule applied:")} ${rule.name}`,
            },
          ],
        };
      });

      changedCount = changedTransactionIds.size;
      return {
        ...current,
        transactions,
        ruleApplications: [...applicationEvents, ...current.ruleApplications].slice(0, 250),
        review: current.review.filter((item) => !item.targetId || !changedTransactionIds.has(item.targetId)),
      };
    });

    setOperationMessage(`${changedCount} ${t("movimientos clasificados con reglas locales.", "transactions classified with local rules.")}`);
  }

  return (
    <ViewShell
      title={t("Reglas y recurrentes", "Rules and recurring")}
      eyebrow={t("Automatizacion sin caja negra", "Automation without a black box")}
      description={t("Gastos repetidos y clasificaciones explicitas reducen captura manual sin inventar categorias fijas.", "Repeated expenses and explicit classifications reduce manual capture without inventing fixed categories.")}
      action={
        <div className="flex flex-wrap gap-2">
          <button className="inline-flex items-center gap-2 rounded-2xl bg-[var(--lime)] px-5 py-3 text-sm font-bold text-[var(--ink)]" onClick={() => { setRecurringDraft(emptyRecurringDraft); setShowNewRecurring(true); }} type="button">
            <Plus className="h-4 w-4" />
            {t("Nueva regla recurrente", "New recurring rule")}
          </button>
          <button className="inline-flex items-center gap-2 rounded-2xl border border-[var(--line)] bg-white px-5 py-3 text-sm font-bold" onClick={() => { setRuleDraft(emptyRuleDraft); setShowNewRule(true); }} type="button">
            <Plus className="h-4 w-4" />
            {t("Nueva automatización", "New automation")}
          </button>
        </div>
      }
    >
      <div className="grid gap-4 md:grid-cols-3">
        <Card><Metric label={t("Recurrentes activas", "Active recurring")} value={String(state.recurringRules.filter((rule) => rule.active).length)} /></Card>
        <Card><Metric label={t("Reglas locales", "Local rules")} value={String(state.automationRules.filter((rule) => rule.active).length)} /></Card>
        <Card><Metric label={t("Aplicaciones auditadas", "Audited applications")} value={String(state.ruleApplications.length)} /></Card>
      </div>

      <Card>
        <div className="grid gap-5 lg:grid-cols-[1fr_auto_auto] lg:items-center">
          <div>
            <h3 className="serif text-xl font-bold">{t("Operaciones del mes", "Operations this month")}</h3>
            <p className="mt-2 text-sm text-[var(--text-muted)]">{operationMessage} {t("Hay", "There are")} {state.transactions.filter((transaction) => transaction.status === "needs_review").length} {t("movimientos pendientes de revision.", "transactions pending review.")}</p>
          </div>
          <button className="rounded-2xl bg-[var(--lime)] px-5 py-3 text-sm font-bold text-[var(--ink)]" onClick={() => void generateRecurringForMonth()} type="button">{t("Generar pendientes", "Generate pending")}</button>
          <button className="rounded-2xl bg-white px-5 py-3 text-sm font-bold" onClick={applyAutomationRules} type="button">{t("Aplicar reglas", "Apply rules")}</button>
        </div>
      </Card>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="kicker">{t("historial de aplicaciones", "application history")}</p>
            <h3 className="serif text-xl font-bold">{t("Que regla hizo que", "Which rule did what")}</h3>
          </div>
          <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold">{latestRuleApplications.length} {t("recientes", "recent")}</span>
        </div>
        <div className="mt-5 grid gap-3">
          {latestRuleApplications.length ? latestRuleApplications.map((application) => (
            <div className="grid gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface-soft)] p-4 md:grid-cols-[1fr_auto] md:items-center" key={application.id}>
              <div>
                <p className="kicker">{application.kind === "recurring" ? t("recurrente", "recurring") : t("clasificacion", "classification")} · {new Date(application.createdAt).toLocaleString("es-DO")}</p>
                <h4 className="mt-1 font-semibold">{application.ruleName}</h4>
                <p className="text-sm text-[var(--text-muted)]">{application.summary}</p>
              </div>
              <span className="rounded-full bg-[var(--surface-soft)] px-3 py-1 text-xs font-semibold">{application.status === "created_pending" ? t("en revision", "in review") : application.status === "classified" ? t("clasificado", "classified") : t("omitido", "skipped")}</span>
            </div>
          )) : (
            <div className="rounded-2xl border border-dashed border-[var(--line)] bg-[var(--surface-soft)] p-6 text-center text-sm text-[var(--text-muted)]">
              {t("Todavia no hay aplicaciones registradas. Genera recurrentes o aplica reglas para ver la bitacora.", "No applications recorded yet. Generate recurring transactions or apply rules to see the log.")}
            </div>
          )}
        </div>
      </Card>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <h3 className="serif text-xl font-bold">{t("Gastos e ingresos recurrentes", "Recurring expenses and income")}</h3>
          <div className="mt-5 grid gap-2.5">
            {state.recurringRules.length ? state.recurringRules.map((rule) => (
              <div className={rule.active ? "" : "opacity-70"} key={rule.id}>
                <CompactRow
                  icon={<Repeat className="h-5 w-5" />}
                  label={rule.name}
                  sublabel={`${recurringFrequencyLabel(rule.frequency)} · ${t("próxima", "next")} ${rule.nextDate}${rule.active ? "" : ` · ${t("pausada", "paused")}`}`}
                  value={formatMoney(rule.amountCents, rule.currency)}
                  onClick={() => openEditRecurring(rule)}
                  menu={[
                    { label: t("Marcar pagado", "Mark paid"), onClick: () => void markRecurringPaid(rule.id) },
                    { label: t("Omitir este mes", "Skip this month"), onClick: () => skipRecurringThisMonth(rule.id) },
                    { label: t("Editar", "Edit"), onClick: () => openEditRecurring(rule) },
                    { label: rule.active ? t("Pausar", "Pause") : t("Reactivar", "Reactivate"), onClick: () => toggleRecurringRule(rule.id) },
                    { label: t("Eliminar", "Delete"), danger: true, onClick: () => deleteRecurringRule(rule.id) },
                  ]}
                />
              </div>
            )) : (
              <EmptyState
                title={t("Aún no hay recurrentes", "No recurring rules yet")}
                subtitle={t("Registra gastos e ingresos repetidos para generarlos como pendientes cada mes.", "Add repeated expenses and income to generate them as pending each month.")}
              >
                <button className="inline-flex items-center gap-2 rounded-2xl bg-[var(--lime)] px-5 py-3 text-sm font-bold text-[var(--ink)]" onClick={() => { setRecurringDraft(emptyRecurringDraft); setShowNewRecurring(true); }} type="button">
                  <Plus className="h-4 w-4" />
                  {t("Nueva regla recurrente", "New recurring rule")}
                </button>
              </EmptyState>
            )}
          </div>
        </Card>

        <Card>
          <h3 className="serif text-xl font-bold">{t("Reglas sin IA", "Rules without AI")}</h3>
          <div className="mt-5 grid gap-2.5">
            {state.automationRules.length ? state.automationRules.map((rule) => (
              <div className={rule.active ? "" : "opacity-70"} key={rule.id}>
                <CompactRow
                  icon={<Sparkles className="h-5 w-5" />}
                  label={rule.name}
                  sublabel={`${t("si contiene:", "if it contains:")} ${rule.matchText} · ${categoryById(state.categories, rule.categoryId)?.name ?? t("categoría", "category")}${rule.active ? "" : ` · ${t("pausada", "paused")}`}`}
                  onClick={() => openEditRule(rule)}
                  menu={[
                    { label: t("Editar", "Edit"), onClick: () => openEditRule(rule) },
                    { label: rule.active ? t("Pausar", "Pause") : t("Reactivar", "Reactivate"), onClick: () => toggleAutomationRule(rule.id) },
                    { label: t("Eliminar", "Delete"), danger: true, onClick: () => deleteAutomationRule(rule.id) },
                  ]}
                />
              </div>
            )) : (
              <EmptyState
                title={t("Aún no hay reglas", "No rules yet")}
                subtitle={t("Crea reglas que clasifiquen movimientos por texto, sin caja negra.", "Create rules that classify transactions by text, without a black box.")}
              >
                <button className="inline-flex items-center gap-2 rounded-2xl bg-[var(--lime)] px-5 py-3 text-sm font-bold text-[var(--ink)]" onClick={() => { setRuleDraft(emptyRuleDraft); setShowNewRule(true); }} type="button">
                  <Plus className="h-4 w-4" />
                  {t("Nueva automatización", "New automation")}
                </button>
              </EmptyState>
            )}
          </div>
        </Card>
      </div>

      <Modal
        open={showNewRecurring}
        onClose={() => setShowNewRecurring(false)}
        title={t("Nueva regla recurrente", "New recurring rule")}
        footer={
          <>
            <button className="rounded-2xl border border-[var(--line)] bg-white px-5 py-3 text-sm font-bold" onClick={() => setShowNewRecurring(false)} type="button">{t("Cancelar", "Cancel")}</button>
            <button className="rounded-2xl bg-[var(--lime)] px-5 py-3 text-sm font-bold text-[var(--ink)] disabled:opacity-70" disabled={!recurringDraft.name.trim() || !recurringDraft.amount || !recurringDraft.accountId} form="recurring-new-form" type="submit">{t("Crear recurrente", "Create recurring")}</button>
          </>
        }
      >
        <form className="grid gap-4" id="recurring-new-form" onSubmit={addRecurringRule}>
          <Input label={t("Nombre", "Name")} value={recurringDraft.name} onChange={(value) => setRecurringDraft((current) => ({ ...current, name: value }))} placeholder={t("Renta, colegio, suscripción", "Rent, tuition, subscription")} />
          <Input label={t("Monto", "Amount")} value={recurringDraft.amount} onChange={(value) => setRecurringDraft((current) => ({ ...current, amount: value }))} placeholder="0.00" />
          <Select label={t("Categoría", "Category")} value={recurringDraft.categoryId} options={activeRuleCategories.map((category) => category.id)} render={(id) => categoryById(state.categories, id)?.name ?? id} onChange={(value) => setRecurringDraft((current) => ({ ...current, categoryId: value }))} />
          <details className="rounded-2xl bg-[var(--surface-soft)] p-4">
            <summary className="cursor-pointer select-none text-xs font-bold uppercase tracking-[0.16em] text-[var(--primary)]">{t("Más opciones", "More options")}</summary>
            <div className="mt-4 grid gap-4">
              <Select label={t("Cuenta", "Account")} value={recurringDraft.accountId} options={activeRuleAccounts.map((account) => account.id)} render={(id) => state.accounts.find((account) => account.id === id)?.name ?? t("Cuenta", "Account")} onChange={(value) => setRecurringDraft((current) => ({ ...current, accountId: value }))} />
              <label className="grid gap-2 text-sm font-semibold">
                {t("Próxima fecha", "Next date")}
                <input className="field" type="date" value={recurringDraft.nextDate} onChange={(event) => setRecurringDraft((current) => ({ ...current, nextDate: event.target.value }))} />
              </label>
              <Select label={t("Tipo", "Type")} value={recurringDraft.type} options={["expense", "income", "debt_payment", "saving", "investment"]} render={transactionTypeLabel} onChange={(value) => setRecurringDraft((current) => ({ ...current, type: value as TransactionType }))} />
              <Select label={t("Moneda", "Currency")} value={recurringDraft.currency} options={supportedCurrencies} onChange={(value) => setRecurringDraft((current) => ({ ...current, currency: value as CurrencyCode }))} />
              <Select label={t("Frecuencia", "Frequency")} value={recurringDraft.frequency} options={["weekly", "biweekly", "monthly", "yearly"]} render={recurringFrequencyLabel} onChange={(value) => setRecurringDraft((current) => ({ ...current, frequency: value as RecurringFrequency }))} />
              <Input label={t("Comercio/persona", "Merchant/person")} value={recurringDraft.merchant} onChange={(value) => setRecurringDraft((current) => ({ ...current, merchant: value }))} placeholder={t("Comercio o persona", "Merchant or person")} />
              <Input label={t("Nota", "Note")} value={recurringDraft.note} onChange={(value) => setRecurringDraft((current) => ({ ...current, note: value }))} placeholder={t("Condiciones, corte, contrato", "Terms, billing date, contract")} />
            </div>
          </details>
        </form>
      </Modal>

      <Modal
        open={Boolean(editRecurringRule)}
        onClose={() => setEditRecurringId(null)}
        title={t("Editar recurrente", "Edit recurring")}
        footer={
          <>
            <button className="rounded-2xl border border-[var(--line)] bg-white px-5 py-3 text-sm font-bold" onClick={() => setEditRecurringId(null)} type="button">{t("Cancelar", "Cancel")}</button>
            <button className="rounded-2xl bg-[var(--lime)] px-5 py-3 text-sm font-bold text-[var(--ink)] disabled:opacity-70" disabled={!recurringDraft.name.trim() || !recurringDraft.amount || !recurringDraft.accountId} form="recurring-edit-form" type="submit">{t("Guardar", "Save")}</button>
          </>
        }
      >
        {editRecurringRule && (
          <form className="grid gap-4" id="recurring-edit-form" onSubmit={saveRecurringRule}>
            <Input label={t("Nombre", "Name")} value={recurringDraft.name} onChange={(value) => setRecurringDraft((current) => ({ ...current, name: value }))} placeholder={t("Renta, colegio, suscripción", "Rent, tuition, subscription")} />
            <Input label={t("Monto", "Amount")} value={recurringDraft.amount} onChange={(value) => setRecurringDraft((current) => ({ ...current, amount: value }))} placeholder="0.00" />
            <Select label={t("Categoría", "Category")} value={recurringDraft.categoryId} options={activeRuleCategories.map((category) => category.id)} render={(id) => categoryById(state.categories, id)?.name ?? id} onChange={(value) => setRecurringDraft((current) => ({ ...current, categoryId: value }))} />
            <details className="rounded-2xl bg-[var(--surface-soft)] p-4">
              <summary className="cursor-pointer select-none text-xs font-bold uppercase tracking-[0.16em] text-[var(--primary)]">{t("Más opciones", "More options")}</summary>
              <div className="mt-4 grid gap-4">
                <Select label={t("Cuenta", "Account")} value={recurringDraft.accountId} options={activeRuleAccounts.map((account) => account.id)} render={(id) => state.accounts.find((account) => account.id === id)?.name ?? t("Cuenta", "Account")} onChange={(value) => setRecurringDraft((current) => ({ ...current, accountId: value }))} />
                <label className="grid gap-2 text-sm font-semibold">
                  {t("Próxima fecha", "Next date")}
                  <input className="field" type="date" value={recurringDraft.nextDate} onChange={(event) => setRecurringDraft((current) => ({ ...current, nextDate: event.target.value }))} />
                </label>
                <Select label={t("Tipo", "Type")} value={recurringDraft.type} options={["expense", "income", "debt_payment", "saving", "investment"]} render={transactionTypeLabel} onChange={(value) => setRecurringDraft((current) => ({ ...current, type: value as TransactionType }))} />
                <Select label={t("Moneda", "Currency")} value={recurringDraft.currency} options={supportedCurrencies} onChange={(value) => setRecurringDraft((current) => ({ ...current, currency: value as CurrencyCode }))} />
                <Select label={t("Frecuencia", "Frequency")} value={recurringDraft.frequency} options={["weekly", "biweekly", "monthly", "yearly"]} render={recurringFrequencyLabel} onChange={(value) => setRecurringDraft((current) => ({ ...current, frequency: value as RecurringFrequency }))} />
                <Input label={t("Comercio/persona", "Merchant/person")} value={recurringDraft.merchant} onChange={(value) => setRecurringDraft((current) => ({ ...current, merchant: value }))} placeholder={t("Comercio o persona", "Merchant or person")} />
                <Input label={t("Nota", "Note")} value={recurringDraft.note} onChange={(value) => setRecurringDraft((current) => ({ ...current, note: value }))} placeholder={t("Condiciones, corte, contrato", "Terms, billing date, contract")} />
              </div>
            </details>
          </form>
        )}
      </Modal>

      <Modal
        open={showNewRule}
        onClose={() => setShowNewRule(false)}
        title={t("Nueva automatización", "New automation")}
        footer={
          <>
            <button className="rounded-2xl border border-[var(--line)] bg-white px-5 py-3 text-sm font-bold" onClick={() => setShowNewRule(false)} type="button">{t("Cancelar", "Cancel")}</button>
            <button className="rounded-2xl bg-[var(--lime)] px-5 py-3 text-sm font-bold text-[var(--ink)] disabled:opacity-70" disabled={!ruleDraft.name.trim() || !ruleDraft.matchText.trim()} form="rule-new-form" type="submit">{t("Crear regla", "Create rule")}</button>
          </>
        }
      >
        <form className="grid gap-4" id="rule-new-form" onSubmit={addAutomationRule}>
          <Input label={t("Nombre", "Name")} value={ruleDraft.name} onChange={(value) => setRuleDraft((current) => ({ ...current, name: value }))} placeholder={t("Farmacia a salud", "Pharmacy to health")} />
          <Input label={t("Buscar cuando contiene", "Match when it contains")} value={ruleDraft.matchText} onChange={(value) => setRuleDraft((current) => ({ ...current, matchText: value }))} placeholder="farmacia, netflix, shell" />
          <Select label={t("Categoría", "Category")} value={ruleDraft.categoryId} options={activeRuleCategories.map((category) => category.id)} render={(id) => categoryById(state.categories, id)?.name ?? id} onChange={(value) => setRuleDraft((current) => ({ ...current, categoryId: value }))} />
          <details className="rounded-2xl bg-[var(--surface-soft)] p-4">
            <summary className="cursor-pointer select-none text-xs font-bold uppercase tracking-[0.16em] text-[var(--primary)]">{t("Más opciones", "More options")}</summary>
            <div className="mt-4 grid gap-4">
              <Select label={t("Cuenta opcional", "Optional account")} value={ruleDraft.accountId} options={["", ...activeRuleAccounts.map((account) => account.id)]} render={(id) => id ? state.accounts.find((account) => account.id === id)?.name ?? id : t("Mantener cuenta", "Keep account")} onChange={(value) => setRuleDraft((current) => ({ ...current, accountId: value }))} />
              <Input label={t("Comercio/persona", "Merchant/person")} value={ruleDraft.merchant} onChange={(value) => setRuleDraft((current) => ({ ...current, merchant: value }))} placeholder={t("Opcional", "Optional")} />
              <Input label={t("Subcategoria libre", "Free-form subcategory")} value={ruleDraft.subcategory} onChange={(value) => setRuleDraft((current) => ({ ...current, subcategory: value }))} placeholder={t("Opcional", "Optional")} />
              <Input label={t("Tag", "Tag")} value={ruleDraft.tag} onChange={(value) => setRuleDraft((current) => ({ ...current, tag: value }))} placeholder={t("familia, negocio", "family, business")} />
            </div>
          </details>
        </form>
      </Modal>

      <Modal
        open={Boolean(editAutomationRule)}
        onClose={() => setEditRuleId(null)}
        title={t("Editar automatización", "Edit automation")}
        footer={
          <>
            <button className="rounded-2xl border border-[var(--line)] bg-white px-5 py-3 text-sm font-bold" onClick={() => setEditRuleId(null)} type="button">{t("Cancelar", "Cancel")}</button>
            <button className="rounded-2xl bg-[var(--lime)] px-5 py-3 text-sm font-bold text-[var(--ink)] disabled:opacity-70" disabled={!ruleDraft.name.trim() || !ruleDraft.matchText.trim()} form="rule-edit-form" type="submit">{t("Guardar", "Save")}</button>
          </>
        }
      >
        {editAutomationRule && (
          <form className="grid gap-4" id="rule-edit-form" onSubmit={saveAutomationRule}>
            <Input label={t("Nombre", "Name")} value={ruleDraft.name} onChange={(value) => setRuleDraft((current) => ({ ...current, name: value }))} placeholder={t("Farmacia a salud", "Pharmacy to health")} />
            <Input label={t("Buscar cuando contiene", "Match when it contains")} value={ruleDraft.matchText} onChange={(value) => setRuleDraft((current) => ({ ...current, matchText: value }))} placeholder="farmacia, netflix, shell" />
            <Select label={t("Categoría", "Category")} value={ruleDraft.categoryId} options={activeRuleCategories.map((category) => category.id)} render={(id) => categoryById(state.categories, id)?.name ?? id} onChange={(value) => setRuleDraft((current) => ({ ...current, categoryId: value }))} />
            <details className="rounded-2xl bg-[var(--surface-soft)] p-4">
              <summary className="cursor-pointer select-none text-xs font-bold uppercase tracking-[0.16em] text-[var(--primary)]">{t("Más opciones", "More options")}</summary>
              <div className="mt-4 grid gap-4">
                <Select label={t("Cuenta opcional", "Optional account")} value={ruleDraft.accountId} options={["", ...activeRuleAccounts.map((account) => account.id)]} render={(id) => id ? state.accounts.find((account) => account.id === id)?.name ?? id : t("Mantener cuenta", "Keep account")} onChange={(value) => setRuleDraft((current) => ({ ...current, accountId: value }))} />
                <Input label={t("Comercio/persona", "Merchant/person")} value={ruleDraft.merchant} onChange={(value) => setRuleDraft((current) => ({ ...current, merchant: value }))} placeholder={t("Opcional", "Optional")} />
                <Input label={t("Subcategoria libre", "Free-form subcategory")} value={ruleDraft.subcategory} onChange={(value) => setRuleDraft((current) => ({ ...current, subcategory: value }))} placeholder={t("Opcional", "Optional")} />
                <Input label={t("Tag", "Tag")} value={ruleDraft.tag} onChange={(value) => setRuleDraft((current) => ({ ...current, tag: value }))} placeholder={t("familia, negocio", "family, business")} />
              </div>
            </details>
          </form>
        )}
      </Modal>
    </ViewShell>
  );
}

type ReviewFilter = "all" | "receipt" | "duplicate" | "adjustment" | "detected";

function reviewItemBucket(reason: string): ReviewFilter {
  if (reason === "receipt_pending") return "receipt";
  if (reason === "duplicate") return "duplicate";
  if (reason === "balance_adjustment") return "adjustment";
  if (["budget_risk", "recurring_pending", "account_unconfirmed"].includes(reason)) return "detected";
  return "all";
}

function reviewReasonIcon(reason: string): ReactNode {
  switch (reason) {
    case "receipt_pending":
      return <ReceiptText className="h-5 w-5" />;
    case "duplicate":
      return <AlertTriangle className="h-5 w-5" />;
    case "budget_risk":
      return <AlertTriangle className="h-5 w-5" />;
    case "recurring_pending":
      return <Repeat className="h-5 w-5" />;
    case "account_unconfirmed":
      return <Landmark className="h-5 w-5" />;
    case "balance_adjustment":
      return <WalletCards className="h-5 w-5" />;
    default:
      return <ClipboardList className="h-5 w-5" />;
  }
}

function ReviewView({ state, setState }: { state: AppState; setState: Dispatch<SetStateAction<AppState>> }) {
  const { t } = useT();
  const [filter, setFilter] = useState<ReviewFilter>("all");
  const [openItemId, setOpenItemId] = useState<string | null>(null);

  const grouped = {
    receipt: state.review.filter((item) => item.reason === "receipt_pending").length,
    duplicate: state.review.filter((item) => item.reason === "duplicate").length,
    adjustment: state.review.filter((item) => item.reason === "balance_adjustment").length,
    detected: state.review.filter((item) => ["budget_risk", "recurring_pending", "account_unconfirmed"].includes(item.reason)).length,
  };

  function detectReviewItems() {
    setState((current) => {
      const existingIds = new Set(current.review.map((item) => item.id));
      const detected: AppState["review"] = [];

      for (const item of categoryUsage(current).filter((category) => category.ratio > 1)) {
        const id = `review-budget-${current.activeMonth}-${item.id}`;
        if (!existingIds.has(id)) {
          detected.push({
            id,
            reason: "budget_risk",
            title: item.name,
            subtitle: `${t("Excedida por", "Exceeded by")} ${formatMoney(item.spent - item.plannedCents, current.currency)} ${t("este mes.", "this month.")}`,
            amountCents: item.spent - item.plannedCents,
            action: t("Revisado", "Reviewed"),
            targetType: "category",
            targetId: item.id,
          });
        }
      }

      for (const rule of current.recurringRules.filter((rule) => rule.active && rule.nextDate <= endOfMonth(current.activeMonth))) {
        const id = `review-recurring-${current.activeMonth}-${rule.id}`;
        if (!existingIds.has(id)) {
          detected.push({
            id,
            reason: "recurring_pending",
            title: rule.name,
            subtitle: `${t("Recurrente pendiente desde", "Recurring pending since")} ${rule.nextDate}; ${t("genera o marca decision del mes.", "generate it or mark this month's decision.")}`,
            amountCents: rule.type === "income" ? rule.amountCents : -rule.amountCents,
            action: t("Revisado", "Reviewed"),
            targetType: "rule",
            targetId: rule.id,
          });
        }
      }

      for (const account of current.accounts.filter((account) => !account.archived && !account.lastConfirmedAt?.startsWith(current.activeMonth))) {
        const id = `review-account-${current.activeMonth}-${account.id}`;
        if (!existingIds.has(id)) {
          detected.push({
            id,
            reason: "account_unconfirmed",
            title: account.name,
            subtitle: t("Saldo de cuenta sin confirmar durante el mes activo.", "Account balance unconfirmed during the active month."),
            amountCents: account.balanceCents,
            action: t("Confirmar saldo", "Confirm balance"),
            targetType: "account",
            targetId: account.id,
          });
        }
      }

      return detected.length ? { ...current, review: [...detected, ...current.review] } : current;
    });
  }

  // AI/rules do the work: auto-detect pending items on mount and whenever the
  // active month changes, so the user just glances and confirms (no manual button).
  useEffect(() => {
    detectReviewItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.activeMonth]);

  function resolveReview(id: string, resolution: "approve" | "duplicate" | "dismiss") {
    setState((current) => {
      const item = current.review.find((reviewItem) => reviewItem.id === id);
      if (!item) return current;

      const targetId = inferReviewTargetId(item, current);
      const targetTransaction = current.transactions.find((transaction) => transaction.id === targetId);
      return {
        ...current,
        accounts: item.reason === "account_unconfirmed" && resolution === "approve" && item.targetId
          ? current.accounts.map((account) => account.id === item.targetId ? { ...account, confirmedBalanceCents: account.balanceCents, lastConfirmedAt: new Date().toISOString().slice(0, 10) } : account)
          : resolution === "approve" && targetTransaction?.status === "needs_review"
            ? applyAccountEffect(current.accounts, targetTransaction, 1)
            : resolution === "duplicate"
              ? applyAccountEffect(current.accounts, targetTransaction, -1)
              : current.accounts,
        transactions: current.transactions.map((transaction) => {
          if (targetId !== transaction.id) return transaction;
          if (resolution === "duplicate") return { ...transaction, status: "duplicate" };
          if (resolution === "approve" && transaction.status === "needs_review") return { ...transaction, status: "approved" };
          return transaction;
        }),
        receipts: current.receipts.map((receipt) => {
          if (targetId !== receipt.id) return receipt;
          if (resolution === "approve") return { ...receipt, status: "confirmed" };
          if (resolution === "dismiss") return { ...receipt, status: "error" };
          return receipt;
        }),
        review: current.review.filter((reviewItem) => reviewItem.id !== id),
      };
    });
  }

  const visibleItems = filter === "all" ? state.review : state.review.filter((item) => reviewItemBucket(item.reason) === filter);
  const openItem = openItemId ? state.review.find((item) => item.id === openItemId) ?? null : null;
  const chips: Array<{ key: ReviewFilter; label: string; count: number; danger?: boolean }> = [
    { key: "all", label: t("Todos", "All"), count: state.review.length },
    { key: "receipt", label: t("Recibos", "Receipts"), count: grouped.receipt },
    { key: "duplicate", label: t("Duplicados", "Duplicates"), count: grouped.duplicate, danger: grouped.duplicate > 0 },
    { key: "adjustment", label: t("Ajustes", "Adjustments"), count: grouped.adjustment },
    { key: "detected", label: t("Detectados", "Detected"), count: grouped.detected, danger: grouped.detected > 0 },
  ];

  function primaryButtonFor(item: AppState["review"][number], onDone?: () => void) {
    if (item.reason === "duplicate") {
      return (
        <button className="rounded-full bg-red-50 px-5 py-3 text-sm font-semibold text-[var(--danger)]" onClick={() => { resolveReview(item.id, "duplicate"); onDone?.(); }} type="button">{t("Marcar duplicado", "Mark duplicate")}</button>
      );
    }
    return (
      <button className="rounded-full bg-[var(--lime)] px-5 py-3 text-sm font-semibold text-[var(--ink)]" onClick={() => { resolveReview(item.id, "approve"); onDone?.(); }} type="button">{item.action}</button>
    );
  }

  return (
    <ViewShell
      title={t("Necesita revisión", "Needs review")}
      eyebrow={`${state.review.length} ${t("pendientes", "pending")}`}
      description={t("La IA y las reglas sugieren; el usuario decide.", "AI and rules suggest; you decide.")}
      action={
        <button className="rounded-full bg-white px-4 py-2 text-xs font-semibold text-[var(--text-muted)] transition hover:bg-[var(--surface-muted)]" onClick={detectReviewItems} type="button">
          {t("Actualizar", "Refresh")}
        </button>
      }
    >
      <div className="flex flex-wrap gap-2">
        {chips.map((chip) => {
          const active = filter === chip.key;
          return (
            <button
              key={chip.key}
              className={`rounded-full border px-3.5 py-1.5 text-sm font-semibold transition ${active ? "border-transparent bg-[var(--ink)] text-white" : "divider-strong bg-[var(--surface-soft)] text-[var(--text-muted)] hover:bg-[var(--surface-soft)]"}`}
              onClick={() => setFilter(chip.key)}
              type="button"
            >
              {chip.label}
              <span className={`ml-1.5 ${active ? "text-white/70" : chip.danger ? "text-[var(--warning)]" : "text-[var(--text-subtle)]"}`}>{chip.count}</span>
            </button>
          );
        })}
      </div>

      {visibleItems.length ? (
        <div className="grid gap-2.5">
          {visibleItems.map((item) => (
            <CompactRow
              key={item.id}
              icon={reviewReasonIcon(item.reason)}
              label={item.title}
              sublabel={reviewReasonLabel(item.reason)}
              value={formatMoney(item.amountCents, state.currency)}
              valueTone={item.reason === "duplicate" || item.reason === "budget_risk" ? "warn" : "default"}
              onClick={() => setOpenItemId(item.id)}
              menu={[
                item.reason === "duplicate"
                  ? { label: t("Marcar duplicado", "Mark duplicate"), danger: true, onClick: () => resolveReview(item.id, "duplicate") }
                  : { label: item.action, onClick: () => resolveReview(item.id, "approve") },
                { label: t("Ignorar", "Dismiss"), onClick: () => resolveReview(item.id, "dismiss") },
              ]}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          title={filter === "all" ? t("Todo al día", "All caught up") : t("Nada aquí", "Nothing here")}
          subtitle={filter === "all" ? t("No hay movimientos, recibos ni ajustes pendientes.", "No pending transactions, receipts or adjustments.") : t("Cambia el filtro para ver otros pendientes.", "Switch the filter to see other pending items.")}
        />
      )}

      <Modal
        open={Boolean(openItem)}
        onClose={() => setOpenItemId(null)}
        title={openItem ? openItem.title : ""}
        footer={openItem ? (
          <>
            <button className="rounded-full bg-white px-5 py-3 text-sm font-semibold" onClick={() => { resolveReview(openItem.id, "dismiss"); setOpenItemId(null); }} type="button">{t("Ignorar", "Dismiss")}</button>
            {primaryButtonFor(openItem, () => setOpenItemId(null))}
          </>
        ) : null}
      >
        {openItem && (
          <div className="grid gap-4">
            <div className="flex items-baseline justify-between gap-4">
              <p className="kicker">{reviewReasonLabel(openItem.reason)}</p>
              <span className="amount serif text-3xl font-bold">{formatMoney(openItem.amountCents, state.currency)}</span>
            </div>
            <ReviewEvidence state={state} item={openItem} />
          </div>
        )}
      </Modal>
    </ViewShell>
  );
}

function ReviewEvidence({ state, item }: { state: AppState; item: AppState["review"][number] }) {
  const { t } = useT();
  const targetId = inferReviewTargetId(item, state);
  const transaction = state.transactions.find((candidate) => candidate.id === targetId);
  const receipt = state.receipts.find((candidate) => candidate.id === targetId);
  const account = state.accounts.find((candidate) => candidate.id === targetId);
  const category = state.categories.find((candidate) => candidate.id === targetId);
  const rule = state.recurringRules.find((candidate) => candidate.id === targetId);

  if (transaction) {
    return (
      <p className="mt-2 text-sm text-[var(--text-muted)]">
        {transaction.date} · {categoryById(state.categories, transaction.categoryId)?.name ?? t("Sin categoría", "No category")} · {transaction.merchant ? merchantDisplay(transaction.merchant, state.merchantAliases) : t("Sin comercio", "No merchant")}
      </p>
    );
  }

  if (receipt) {
    return (
      <p className="mt-2 text-sm text-[var(--text-muted)]">
        {receipt.fileName} · {receiptStatusLabel(receipt.status)} · {receipt.merchant ?? t("Sin comercio", "No merchant")}
      </p>
    );
  }

  if (account) {
    return (
      <p className="mt-2 text-sm text-[var(--text-muted)]">
        {t("Saldo", "Balance")} {formatMoney(account.balanceCents, account.currency ?? state.currency)} · {t("confirmada", "confirmed")} {account.lastConfirmedAt ?? t("nunca", "never")}
      </p>
    );
  }

  if (category) {
    const usage = categoryUsage(state).find((candidate) => candidate.id === category.id);
    return (
      <p className="mt-2 text-sm text-[var(--text-muted)]">
        {t("Plan", "Plan")} {formatMoney(plannedCentsFor(state, category.id), state.currency)} · {t("real", "actual")} {formatMoney(usage?.spent ?? 0, state.currency)}
      </p>
    );
  }

  if (rule) {
    return (
      <p className="mt-2 text-sm text-[var(--text-muted)]">
        {t("Próxima", "Next")} {rule.nextDate} · {formatMoney(rule.amountCents, rule.currency)}
      </p>
    );
  }

  return null;
}

// NetWorthItem.group → human label. There is no helper in @/lib/labels for this
// enum, so it lives here (same module) and follows the active UI language via t().
type NetWorthGroup = AppState["netWorth"][number]["group"];
const NET_WORTH_GROUPS: NetWorthGroup[] = ["cash", "bank", "investment", "property", "debt", "other"];

function netWorthGroupLabel(group: string, t: (es: string, en: string) => string) {
  switch (group) {
    case "cash":
      return t("Efectivo", "Cash");
    case "bank":
      return t("Cuenta bancaria", "Bank account");
    case "investment":
      return t("Inversiones", "Investments");
    case "property":
      return t("Propiedad", "Property");
    case "debt":
      return t("Deuda", "Debt");
    default:
      return t("Otro", "Other");
  }
}

function netWorthGroupIcon(group: string) {
  switch (group) {
    case "cash":
      return <WalletCards className="h-5 w-5" />;
    case "investment":
      return <ArrowUpRight className="h-5 w-5" />;
    case "property":
      return <Building2 className="h-5 w-5" />;
    case "debt":
      return <CreditCard className="h-5 w-5" />;
    default:
      return <Landmark className="h-5 w-5" />;
  }
}

function NetWorthView({ state, setState }: { state: AppState; setState: Dispatch<SetStateAction<AppState>> }) {
  const { t } = useT();
  const assetItems = state.netWorth.filter((item) => item.kind === "asset");
  const liabilityItems = state.netWorth.filter((item) => item.kind === "liability");
  const assets = assetItems.reduce((sum, item) => sum + item.amountCents, 0);
  const liabilities = liabilityItems.reduce((sum, item) => sum + item.amountCents, 0);
  const netWorth = assets - liabilities;
  const previousClosing = [...state.monthClosings]
    .filter((closing) => closing.month < state.activeMonth)
    .sort((a, b) => b.month.localeCompare(a.month))[0];
  const nominalChange = previousClosing ? netWorth - previousClosing.netWorthCents : 0;
  const percentChange = previousClosing && previousClosing.netWorthCents !== 0 ? nominalChange / Math.abs(previousClosing.netWorthCents) : 0;

  const emptyDraft = {
    name: "",
    kind: "asset" as "asset" | "liability",
    group: "bank" as NetWorthGroup,
    amount: "",
  };
  // "Nueva entrada" Modal (manual add) + form.
  const [showNew, setShowNew] = useState(false);
  const [draft, setDraft] = useState(emptyDraft);
  // Edit Modal target (item id) + form.
  const [editId, setEditId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState(emptyDraft);
  const editItem = state.netWorth.find((item) => item.id === editId) ?? null;

  function openNew() {
    setDraft(emptyDraft);
    setShowNew(true);
  }

  function addNetWorthItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.name.trim()) return;

    setState((current) => ({
      ...current,
      netWorth: [
        ...current.netWorth,
        {
          id: `nw-${Date.now()}`,
          name: draft.name.trim(),
          kind: draft.kind,
          group: draft.group,
          amountCents: toCents(draft.amount),
        },
      ],
    }));
    setDraft(emptyDraft);
    setShowNew(false);
  }

  function openEdit(item: AppState["netWorth"][number]) {
    setEditDraft({
      name: item.name,
      kind: item.kind,
      group: item.group,
      amount: (item.amountCents / 100).toString(),
    });
    setEditId(item.id);
  }

  function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editId || !editDraft.name.trim()) return;
    updateNetWorthItem(editId, {
      name: editDraft.name.trim(),
      kind: editDraft.kind,
      group: editDraft.group,
      amountCents: toCents(editDraft.amount),
    });
    setEditId(null);
  }

  function updateNetWorthItem(id: string, patch: Partial<AppState["netWorth"][number]>) {
    setState((current) => ({
      ...current,
      netWorth: current.netWorth.map((item) => item.id === id ? { ...item, ...patch } : item),
    }));
  }

  function deleteNetWorthItem(id: string) {
    setState((current) => ({
      ...current,
      netWorth: current.netWorth.filter((item) => item.id !== id),
    }));
    setEditId((current) => (current === id ? null : current));
  }

  function generateSnapshotFromAccounts() {
    const accountItems: AppState["netWorth"] = state.accounts
      .filter((account) => !account.archived && account.includeInNetWorth !== false)
      .map((account) => ({
        id: `nw-account-${account.id}`,
        name: account.name,
        kind: account.balanceCents >= 0 ? "asset" as const : "liability" as const,
        group: account.kind === "credit" ? "debt" as const : account.kind === "cash" ? "cash" as const : account.kind === "investment" ? "investment" as const : "bank" as const,
        amountCents: Math.abs(account.balanceCents),
      }));
    const debtItems: AppState["netWorth"] = state.debts.map((debt) => ({
      id: `nw-debt-${debt.id}`,
      name: debt.name,
      kind: "liability",
      group: "debt",
      amountCents: debt.balanceCents,
    }));

    setState((current) => ({
      ...current,
      netWorth: [...accountItems, ...debtItems],
    }));
  }

  const empty = state.netWorth.length === 0;
  const groupSelect = (
    value: NetWorthGroup,
    onChange: (value: NetWorthGroup) => void,
  ) => (
    <Select
      label={t("Grupo", "Group")}
      value={value}
      options={NET_WORTH_GROUPS}
      render={(option) => netWorthGroupLabel(option, t)}
      onChange={(next) => onChange(next as NetWorthGroup)}
    />
  );

  const renderSection = (
    title: string,
    items: AppState["netWorth"],
    total: number,
    tone: "good" | "bad",
  ) => (
    <details className="glass rounded-3xl p-6" open>
      <summary className="flex cursor-pointer select-none items-center justify-between gap-4">
        <span className="serif text-xl font-bold tracking-tight">{title}</span>
        <span className="flex items-center gap-3">
          <span className={`amount serif text-xl font-bold ${tone === "good" ? "text-[var(--primary)]" : "text-[var(--warning)]"}`}>{formatMoney(total, state.currency)}</span>
          <span className="kicker">{items.length}</span>
        </span>
      </summary>
      <div className="mt-4 grid gap-2.5">
        {items.length ? (
          items.map((item) => (
            <CompactRow
              key={item.id}
              icon={netWorthGroupIcon(item.group)}
              label={item.name}
              sublabel={netWorthGroupLabel(item.group, t)}
              value={formatMoney(item.amountCents, state.currency)}
              valueTone={tone === "good" ? "primary" : "danger"}
              onClick={() => openEdit(item)}
              menu={[
                { label: t("Editar", "Edit"), onClick: () => openEdit(item) },
                { label: t("Eliminar", "Delete"), danger: true, onClick: () => deleteNetWorthItem(item.id) },
              ]}
            />
          ))
        ) : (
          <p className="rounded-2xl border border-dashed border-[var(--line)] p-4 text-center text-sm text-[var(--text-muted)]">{t("Nada aquí todavía.", "Nothing here yet.")}</p>
        )}
      </div>
    </details>
  );

  return (
    <ViewShell title={t("Patrimonio neto", "Net worth")} eyebrow={t("Valor actual", "Current value")} description={t("Registro de activos y pasivos del hogar.", "Record of the household's assets and liabilities.")}>
      <Card>
        <p className="kicker">{t("Neto familiar", "Family net worth")}</p>
        <h2 className="serif mt-2 text-6xl font-bold">{formatMoney(netWorth, state.currency)}</h2>
        <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
          <Metric label={t("Activos", "Assets")} value={formatMoney(assets, state.currency)} tone="good" />
          <Metric label={t("Pasivos", "Liabilities")} value={formatMoney(liabilities, state.currency)} tone="bad" />
          <Metric label={t("Cambio", "Change")} value={previousClosing ? formatMoney(nominalChange, state.currency) : t("Sin cierre previo", "No prior close")} tone={nominalChange >= 0 ? "good" : "bad"} />
          <Metric label="%" value={previousClosing ? `${Math.round(percentChange * 100)}%` : t("N/D", "N/A")} tone={percentChange >= 0 ? "good" : "bad"} />
        </div>
        {previousClosing && <p className="mt-4 text-sm text-[var(--text-muted)]">{t("vs. cierre", "vs. close")} {previousClosing.month}: {formatMoney(previousClosing.netWorthCents, state.currency)}</p>}
      </Card>

      <Card>
        <h3 className="serif text-xl font-bold tracking-tight">{t("Actualizar snapshot", "Update snapshot")}</h3>
        <p className="mt-1.5 text-sm text-[var(--text-muted)]">{t("Crea el snapshot en un toque desde tus cuentas y deudas.", "Build the snapshot in one tap from your accounts and debts.")}</p>
        <button className="mt-4 w-full rounded-2xl bg-[var(--lime)] px-5 py-3.5 text-sm font-bold text-[var(--ink)]" onClick={generateSnapshotFromAccounts} type="button">{t("Generar desde cuentas", "Generate from accounts")}</button>
        <details className="mt-3 rounded-2xl bg-[var(--surface-soft)] p-4">
          <summary className="cursor-pointer select-none text-xs font-bold uppercase tracking-[0.16em] text-[var(--primary)]">{t("o agregar manualmente", "or add manually")}</summary>
          <button className="mt-4 rounded-2xl border border-[var(--line)] bg-white px-5 py-3 text-sm font-bold" onClick={openNew} type="button">{t("Nueva entrada", "New entry")}</button>
        </details>
      </Card>

      {empty ? (
        <Card>
          <EmptyState
            title={t("Aún no hay activos ni pasivos", "No assets or liabilities yet")}
            subtitle={t("Genera el snapshot desde tus cuentas o agrega uno manualmente.", "Generate the snapshot from your accounts or add one manually.")}
          >
            <button className="rounded-2xl bg-[var(--lime)] px-5 py-3 text-sm font-bold text-[var(--ink)]" onClick={generateSnapshotFromAccounts} type="button">{t("Generar desde cuentas", "Generate from accounts")}</button>
            <button className="rounded-2xl border border-[var(--line)] bg-white px-5 py-3 text-sm font-bold" onClick={openNew} type="button">{t("Nueva entrada", "New entry")}</button>
          </EmptyState>
        </Card>
      ) : (
        <>
          {renderSection(t("Activos", "Assets"), assetItems, assets, "good")}
          {renderSection(t("Pasivos", "Liabilities"), liabilityItems, liabilities, "bad")}
        </>
      )}

      <Modal
        open={showNew}
        onClose={() => setShowNew(false)}
        title={t("Nueva entrada", "New entry")}
        footer={
          <>
            <button className="rounded-2xl border border-[var(--line)] bg-white px-5 py-3 text-sm font-bold" onClick={() => setShowNew(false)} type="button">{t("Cancelar", "Cancel")}</button>
            <button className="rounded-2xl bg-[var(--lime)] px-5 py-3 text-sm font-bold text-[var(--ink)] disabled:opacity-70" disabled={!draft.name.trim()} form="networth-new-form" type="submit">{t("Agregar", "Add")}</button>
          </>
        }
      >
        <form className="grid gap-4" id="networth-new-form" onSubmit={addNetWorthItem}>
          <Input label={t("Nombre", "Name")} value={draft.name} onChange={(value) => setDraft((current) => ({ ...current, name: value }))} placeholder={t("Casa, auto, tarjeta", "House, car, card")} />
          <Select label={t("Tipo", "Type")} value={draft.kind} options={["asset", "liability"]} render={(value) => value === "asset" ? t("Activo", "Asset") : t("Pasivo", "Liability")} onChange={(value) => setDraft((current) => ({ ...current, kind: value as "asset" | "liability", group: value === "asset" ? "bank" : "debt" }))} />
          {groupSelect(draft.group, (value) => setDraft((current) => ({ ...current, group: value }))) }
          <Input label={t("Monto", "Amount")} value={draft.amount} onChange={(value) => setDraft((current) => ({ ...current, amount: value }))} placeholder="0.00" />
        </form>
      </Modal>

      <Modal
        open={Boolean(editItem)}
        onClose={() => setEditId(null)}
        title={t("Editar entrada", "Edit entry")}
        footer={
          <>
            <button className="rounded-2xl border border-[var(--line)] bg-white px-5 py-3 text-sm font-bold" onClick={() => setEditId(null)} type="button">{t("Cancelar", "Cancel")}</button>
            <button className="rounded-2xl bg-[var(--lime)] px-5 py-3 text-sm font-bold text-[var(--ink)] disabled:opacity-70" disabled={!editDraft.name.trim()} form="networth-edit-form" type="submit">{t("Guardar", "Save")}</button>
          </>
        }
      >
        {editItem && (
          <form className="grid gap-4" id="networth-edit-form" onSubmit={saveEdit}>
            <Input label={t("Nombre", "Name")} value={editDraft.name} onChange={(value) => setEditDraft((current) => ({ ...current, name: value }))} />
            <Select label={t("Tipo", "Type")} value={editDraft.kind} options={["asset", "liability"]} render={(value) => value === "asset" ? t("Activo", "Asset") : t("Pasivo", "Liability")} onChange={(value) => setEditDraft((current) => ({ ...current, kind: value as "asset" | "liability" }))} />
            {groupSelect(editDraft.group, (value) => setEditDraft((current) => ({ ...current, group: value }))) }
            <Input label={t("Monto", "Amount")} value={editDraft.amount} onChange={(value) => setEditDraft((current) => ({ ...current, amount: value }))} placeholder="0.00" />
            <button className="justify-self-start rounded-2xl bg-red-50 px-5 py-3 text-sm font-bold text-[var(--danger)]" onClick={() => deleteNetWorthItem(editItem.id)} type="button">{t("Eliminar", "Delete")}</button>
          </form>
        )}
      </Modal>
    </ViewShell>
  );
}

type DebtStrategy = "snowball" | "avalanche" | "manual";

function DebtsView({ state, setState }: { state: AppState; setState: Dispatch<SetStateAction<AppState>> }) {
  const { t } = useT();
  const activeAccounts = state.accounts.filter((account) => !account.archived);
  const debtCategory = state.categories.find((category) => category.group === "debt") ?? state.categories.find((category) => category.group !== "income") ?? state.categories[0];
  const defaultAccountId = activeAccounts.find((account) => account.defaultForCapture)?.id ?? activeAccounts[0]?.id ?? "";
  const emptyForm = { name: "", balance: "", rate: "", minimum: "", strategy: "avalanche" as DebtStrategy };

  // One Modal open at a time. addOpen → create; editId → edit one debt; payId → record a payment for one debt.
  const [addOpen, setAddOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [payId, setPayId] = useState<string | null>(null);
  const [draft, setDraft] = useState(emptyForm);
  const [paymentDraft, setPaymentDraft] = useState({
    accountId: defaultAccountId,
    amount: "",
    date: new Date().toISOString().slice(0, 10),
    note: "",
  });

  // Short strategy labels for the select; the full explanation lives in the field hint.
  const strategyShort = (value: string) => value === "avalanche" ? t("Avalancha", "Avalanche") : value === "snowball" ? t("Bola de nieve", "Snowball") : t("Manual", "Manual");

  const editingDebt = state.debts.find((debt) => debt.id === editId) ?? null;
  const payingDebt = state.debts.find((debt) => debt.id === payId) ?? null;
  // Highest-rate debt gets the danger accent (the strategy focus). Falls back to highest balance when rates tie at 0.
  const focusDebtId = state.debts.length
    ? [...state.debts].sort((a, b) => (b.rate - a.rate) || (b.balanceCents - a.balanceCents))[0]?.id
    : undefined;

  function paidRatio(debt: AppState["debts"][number]) {
    return 1 - debt.balanceCents / Math.max(debt.originalBalanceCents ?? debt.balanceCents, 1);
  }

  function openAdd() {
    setDraft(emptyForm);
    setAddOpen(true);
  }

  function openEdit(debt: AppState["debts"][number]) {
    setDraft({
      name: debt.name,
      balance: (debt.balanceCents / 100).toString(),
      rate: (debt.rate * 100).toString(),
      minimum: (debt.minimumCents / 100).toString(),
      strategy: debt.strategy,
    });
    setEditId(debt.id);
  }

  function openPayment(debt: AppState["debts"][number]) {
    setPaymentDraft({ accountId: defaultAccountId, amount: "", date: new Date().toISOString().slice(0, 10), note: "" });
    setPayId(debt.id);
  }

  function addDebt() {
    if (!draft.name.trim()) return;
    setState((current) => ({
      ...current,
      debts: [
        ...current.debts,
        {
          id: `debt-${Date.now()}`,
          name: draft.name.trim(),
          balanceCents: toCents(draft.balance),
          originalBalanceCents: toCents(draft.balance),
          rate: Math.max(0, Number(draft.rate) || 0) / 100,
          minimumCents: toCents(draft.minimum),
          strategy: draft.strategy,
        },
      ],
    }));
    setAddOpen(false);
  }

  function saveDebt() {
    if (!editId || !draft.name.trim()) return;
    updateDebt(editId, {
      name: draft.name.trim(),
      balanceCents: toCents(draft.balance),
      rate: Math.max(0, Number(draft.rate) || 0) / 100,
      minimumCents: toCents(draft.minimum),
      strategy: draft.strategy,
    });
    setEditId(null);
  }

  function updateDebt(id: string, patch: Partial<AppState["debts"][number]>) {
    setState((current) => ({
      ...current,
      debts: current.debts.map((debt) => debt.id === id ? { ...debt, ...patch } : debt),
    }));
  }

  function deleteDebt(id: string) {
    setState((current) => ({
      ...current,
      debts: current.debts.filter((debt) => debt.id !== id),
    }));
  }

  function registerPayment() {
    const debt = state.debts.find((item) => item.id === payId);
    const account = state.accounts.find((item) => item.id === paymentDraft.accountId);
    const amountCents = toCents(paymentDraft.amount);
    if (!debt || !account || !debtCategory || amountCents <= 0) return;

    const transaction: Transaction = {
      id: `debt-pay-${debt.id}-${Date.now()}`,
      type: "debt_payment",
      date: paymentDraft.date,
      description: `${t("Pago deuda -", "Debt payment -")} ${debt.name}`,
      categoryId: debtCategory.id,
      subcategory: debt.name,
      accountId: account.id,
      merchant: debt.name,
      tags: ["deuda", `debt:${debt.id}`],
      note: paymentDraft.note || `${t("Pago aplicado a", "Payment applied to")} ${debt.name}.`,
      originalAmountCents: amountCents,
      originalCurrency: account.currency ?? state.currency,
      amountCents,
      baseCurrency: state.currency,
      exchangeRate: 1,
      exchangeRateDate: paymentDraft.date,
      exchangeRateSource: "same_currency",
      status: "approved",
      createdBy: state.user.name || "RindoMes",
      audit: [movementAudit("created", `${t("Pago registrado desde Deudas para", "Payment recorded from Debts for")} ${debt.name}.`, state.user.name || "RindoMes")],
    };

    setState((current) => ({
      ...current,
      accounts: applyAccountEffect(current.accounts, transaction, 1),
      debts: current.debts.map((item) => item.id === debt.id ? { ...item, balanceCents: Math.max(0, item.balanceCents - amountCents), originalBalanceCents: item.originalBalanceCents ?? item.balanceCents } : item),
      netWorth: current.netWorth.map((item) => (
        item.kind === "liability" && item.group === "debt" && normalizeImportKey(item.name).includes(normalizeImportKey(debt.name))
          ? { ...item, amountCents: Math.max(0, item.amountCents - amountCents) }
          : item
      )),
      transactions: [transaction, ...current.transactions],
    }));
    setPayId(null);
  }

  // Shared form body for add / edit: balance is the lead datum, secondary fields behind "Más opciones".
  const debtFormFields = (
    <div className="grid gap-4">
      <Input label={t("Nombre", "Name")} value={draft.name} onChange={(value) => setDraft((current) => ({ ...current, name: value }))} placeholder={t("Ej. Tarjeta de crédito", "e.g. Credit card")} />
      <Input label={t("Balance", "Balance")} value={draft.balance} onChange={(value) => setDraft((current) => ({ ...current, balance: value }))} placeholder="0.00" />
      <details className="rounded-2xl bg-[var(--surface-soft)] p-3">
        <summary className="cursor-pointer select-none text-xs font-bold uppercase tracking-[0.16em] text-[var(--text-muted)]">{t("Más opciones", "More options")}</summary>
        <div className="mt-3 grid gap-4">
          <Input label={t("Tasa %", "Rate %")} value={draft.rate} onChange={(value) => setDraft((current) => ({ ...current, rate: value }))} placeholder="0" />
          <Input label={t("Pago mínimo", "Minimum payment")} value={draft.minimum} onChange={(value) => setDraft((current) => ({ ...current, minimum: value }))} placeholder="0.00" />
          <div className="grid gap-1">
            <Select label={t("Estrategia", "Strategy")} value={draft.strategy} options={["avalanche", "snowball", "manual"]} render={strategyShort} onChange={(value) => setDraft((current) => ({ ...current, strategy: value as DebtStrategy }))} />
            <span className="text-xs text-[var(--text-muted)]">{debtStrategyLabel(draft.strategy)}</span>
          </div>
        </div>
      </details>
    </div>
  );

  return (
    <ViewShell
      title={t("Control de deudas", "Debt control")}
      eyebrow={t("Pago y control", "Payment and tracking")}
      description={t("Saldos, pagos mínimos y estrategia de pago sin mezclar con gastos comunes.", "Balances, minimum payments and payoff strategy kept separate from everyday spending.")}
      action={
        <button className="rounded-full bg-[var(--lime)] px-5 py-2.5 text-sm font-bold text-black shadow-sm transition hover:brightness-95" onClick={openAdd} type="button">
          <span className="inline-flex items-center gap-1.5"><Plus className="h-4 w-4" />{t("Nueva deuda", "New debt")}</span>
        </button>
      }
    >
      <Card>
        {state.debts.length === 0 ? (
          <EmptyState
            title={t("Sin deudas registradas", "No debts yet")}
            subtitle={t("Agrega un saldo para seguir su pago y elegir una estrategia.", "Add a balance to track payoff and pick a strategy.")}
          >
            <button className="rounded-full bg-[var(--lime)] px-5 py-2.5 text-sm font-bold text-black" onClick={openAdd} type="button">{t("Nueva deuda", "New debt")}</button>
          </EmptyState>
        ) : (
          <div className="grid gap-2.5">
            {state.debts.map((debt) => {
              const ratio = paidRatio(debt);
              const focus = debt.id === focusDebtId && state.debts.length > 1;
              return (
                <div key={debt.id} className={focus ? "rounded-2xl border-l-4 border-l-[var(--primary)]" : ""}>
                  <CompactRow
                    icon={<CreditCard className="h-5 w-5" />}
                    label={debt.name}
                    sublabel={`${formatMoney(debt.balanceCents, state.currency)} · ${t("mínimo", "minimum")} ${formatMoney(debt.minimumCents, state.currency)} · ${strategyShort(debt.strategy)}`}
                    value={`${Math.round(ratio * 100)}% ${t("pagado", "paid")}`}
                    valueTone={focus ? "danger" : "default"}
                    onClick={() => openEdit(debt)}
                    menu={[
                      { label: t("Registrar pago", "Record payment"), onClick: () => openPayment(debt) },
                      { label: t("Editar", "Edit"), onClick: () => openEdit(debt) },
                      { label: t("Eliminar", "Delete"), danger: true, onClick: () => deleteDebt(debt.id) },
                    ]}
                  />
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* New debt */}
      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title={t("Nueva deuda", "New debt")}
        footer={
          <>
            <button className="rounded-2xl border border-[var(--line)] bg-white px-5 py-2.5 text-sm font-bold" onClick={() => setAddOpen(false)} type="button">{t("Cancelar", "Cancel")}</button>
            <button className="rounded-2xl bg-[var(--lime)] px-5 py-2.5 text-sm font-bold text-[var(--ink)] disabled:opacity-70" onClick={addDebt} type="button" disabled={!draft.name.trim()}>{t("Agregar", "Add")}</button>
          </>
        }
      >
        {debtFormFields}
      </Modal>

      {/* Edit debt: same fields + progress + payment history, one item at a time */}
      <Modal
        open={Boolean(editingDebt)}
        onClose={() => setEditId(null)}
        title={t("Editar deuda", "Edit debt")}
        footer={
          <>
            <button className="rounded-2xl border border-[var(--line)] bg-white px-5 py-2.5 text-sm font-bold" onClick={() => setEditId(null)} type="button">{t("Cancelar", "Cancel")}</button>
            <button className="rounded-2xl bg-[var(--lime)] px-5 py-2.5 text-sm font-bold text-[var(--ink)] disabled:opacity-70" onClick={saveDebt} type="button" disabled={!draft.name.trim()}>{t("Guardar", "Save")}</button>
          </>
        }
      >
        {editingDebt && (
          <div className="grid gap-5">
            <div className="rounded-2xl bg-[var(--surface-soft)] p-4">
              <div className="flex items-end justify-between gap-3">
                <p className="text-sm font-semibold">{t("Balance actual:", "Current balance:")} {formatMoney(editingDebt.balanceCents, state.currency)}</p>
                <span className="kicker">{Math.round(paidRatio(editingDebt) * 100)}% {t("pagado", "paid")}</span>
              </div>
              <Progress className="mt-3" value={paidRatio(editingDebt)} />
              <button className="mt-4 rounded-full bg-[var(--lime)] px-4 py-2 text-xs font-bold text-black" onClick={() => { const debt = editingDebt; setEditId(null); openPayment(debt); }} type="button">{t("Registrar pago", "Record payment")}</button>
            </div>
            {debtFormFields}
            <div className="rounded-2xl bg-[var(--surface-soft)] p-4">
              <p className="font-semibold">{t("Histórico de pagos", "Payment history")}</p>
              <div className="mt-3 space-y-2">
                {state.transactions.filter((transaction) => transaction.tags.includes(`debt:${editingDebt.id}`)).slice(0, 8).map((transaction) => (
                  <div className="flex items-center justify-between gap-3 rounded-xl bg-[var(--surface-soft)] px-3 py-2 text-sm" key={transaction.id}>
                    <span>{transaction.date} · {transaction.description}</span>
                    <strong>{formatMoney(transaction.amountCents, transaction.baseCurrency)}</strong>
                  </div>
                ))}
                {!state.transactions.some((transaction) => transaction.tags.includes(`debt:${editingDebt.id}`)) && <p className="text-sm text-[var(--text-muted)]">{t("Todavía no hay pagos registrados desde esta vista.", "No payments recorded from this view yet.")}</p>}
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Record payment, debt pre-filled from the row */}
      <Modal
        open={Boolean(payingDebt)}
        onClose={() => setPayId(null)}
        title={payingDebt ? `${t("Registrar pago", "Record payment")} · ${payingDebt.name}` : t("Registrar pago", "Record payment")}
        footer={
          <>
            <button className="rounded-2xl border border-[var(--line)] bg-white px-5 py-2.5 text-sm font-bold" onClick={() => setPayId(null)} type="button">{t("Cancelar", "Cancel")}</button>
            <button className="rounded-2xl bg-[var(--lime)] px-5 py-2.5 text-sm font-bold text-[var(--ink)] disabled:opacity-70" onClick={registerPayment} type="button" disabled={toCents(paymentDraft.amount) <= 0 || !paymentDraft.accountId}>{t("Registrar", "Record")}</button>
          </>
        }
      >
        <div className="grid gap-4">
          <Input label={t("Monto", "Amount")} value={paymentDraft.amount} onChange={(value) => setPaymentDraft((current) => ({ ...current, amount: value }))} placeholder="0.00" />
          <Select label={t("Cuenta", "Account")} value={paymentDraft.accountId} options={activeAccounts.map((account) => account.id)} render={(id) => state.accounts.find((account) => account.id === id)?.name ?? t("Cuenta", "Account")} onChange={(value) => setPaymentDraft((current) => ({ ...current, accountId: value }))} />
          <label className="grid gap-2 text-sm font-semibold">
            {t("Fecha", "Date")}
            <input className="field" type="date" value={paymentDraft.date} onChange={(event) => setPaymentDraft((current) => ({ ...current, date: event.target.value }))} />
          </label>
          <details className="rounded-2xl bg-[var(--surface-soft)] p-3">
            <summary className="cursor-pointer select-none text-xs font-bold uppercase tracking-[0.16em] text-[var(--text-muted)]">{t("Más opciones", "More options")}</summary>
            <div className="mt-3">
              <Input label={t("Nota", "Note")} value={paymentDraft.note} onChange={(value) => setPaymentDraft((current) => ({ ...current, note: value }))} placeholder={t("Detalle del pago", "Payment detail")} />
            </div>
          </details>
        </div>
      </Modal>
    </ViewShell>
  );
}

function GoalsView({ state, setState }: { state: AppState; setState: Dispatch<SetStateAction<AppState>> }) {
  const { t } = useT();
  const activeAccounts = state.accounts.filter((account) => !account.archived);
  const savingCategory = state.categories.find((category) => category.group === "savings") ?? state.categories.find((category) => category.group !== "income") ?? state.categories[0];
  const [draft, setDraft] = useState({
    name: "",
    target: "",
    saved: "",
    due: state.activeMonth,
    accountId: activeAccounts.find((account) => account.kind === "savings")?.id ?? activeAccounts[0]?.id ?? "",
    priority: "medium" as NonNullable<AppState["goals"][number]["priority"]>,
  });
  const [showNewGoal, setShowNewGoal] = useState(false);
  const [showNewGoalMore, setShowNewGoalMore] = useState(false);
  const [moveMode, setMoveMode] = useState<"contribute" | "withdraw">("contribute");
  const [moveGoalId, setMoveGoalId] = useState<string | null>(null);
  const [editGoalId, setEditGoalId] = useState<string | null>(null);
  const [historyGoalId, setHistoryGoalId] = useState<string | null>(null);
  const [moveDraft, setMoveDraft] = useState({
    accountId: activeAccounts.find((account) => account.defaultForCapture)?.id ?? activeAccounts[0]?.id ?? "",
    amount: "",
    date: new Date().toISOString().slice(0, 10),
    note: "",
  });

  // Open the Move-money modal for one goal; preset mode and optional suggested amount.
  function openMove(goalId: string, mode: "contribute" | "withdraw", amount?: string) {
    setMoveMode(mode);
    setMoveGoalId(goalId);
    setMoveDraft((current) => ({ ...current, amount: amount ?? "", note: "" }));
  }

  function addGoal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.name.trim()) return;

    setState((current) => ({
      ...current,
      goals: [
        ...current.goals,
        {
          id: `goal-${Date.now()}`,
          name: draft.name.trim(),
          targetCents: toCents(draft.target),
          savedCents: toCents(draft.saved),
          due: draft.due,
          accountId: draft.accountId || undefined,
          priority: draft.priority,
        },
      ],
    }));
    setDraft({ name: "", target: "", saved: "", due: state.activeMonth, accountId: draft.accountId, priority: "medium" });
  }

  function updateGoal(id: string, patch: Partial<AppState["goals"][number]>) {
    setState((current) => ({
      ...current,
      goals: current.goals.map((goal) => goal.id === id ? { ...goal, ...patch } : goal),
    }));
  }

  function deleteGoal(id: string) {
    setState((current) => ({
      ...current,
      goals: current.goals.map((goal) => goal.id === id ? { ...goal, archived: true } : goal),
    }));
  }

  function registerContribution(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const goal = state.goals.find((item) => item.id === moveGoalId);
    const account = state.accounts.find((item) => item.id === moveDraft.accountId);
    const amountCents = toCents(moveDraft.amount);
    if (!goal || !account || !savingCategory || amountCents <= 0) return;

    const transaction: Transaction = {
      id: `goal-contrib-${goal.id}-${Date.now()}`,
      type: "saving",
      date: moveDraft.date,
      description: `Aporte meta - ${goal.name}`,
      categoryId: savingCategory.id,
      subcategory: goal.name,
      accountId: account.id,
      merchant: goal.name,
      tags: ["meta", `goal:${goal.id}`],
      note: moveDraft.note || `Aporte aplicado a ${goal.name}.`,
      originalAmountCents: amountCents,
      originalCurrency: account.currency ?? state.currency,
      amountCents,
      baseCurrency: state.currency,
      exchangeRate: 1,
      exchangeRateDate: moveDraft.date,
      exchangeRateSource: "same_currency",
      status: "approved",
      createdBy: state.user.name || "RindoMes",
      audit: [movementAudit("created", `${t("Aporte registrado desde Metas para", "Contribution recorded from Goals for")} ${goal.name}.`, state.user.name || "RindoMes")],
    };

    setState((current) => ({
      ...current,
      accounts: applyAccountEffect(current.accounts, transaction, 1),
      goals: current.goals.map((item) => item.id === goal.id ? { ...item, savedCents: item.savedCents + amountCents } : item),
      transactions: [transaction, ...current.transactions],
    }));
    setMoveDraft((current) => ({ ...current, amount: "", note: "" }));
    setMoveGoalId(null);
  }

  function registerWithdrawal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const goal = state.goals.find((item) => item.id === moveGoalId);
    const account = state.accounts.find((item) => item.id === moveDraft.accountId);
    const amountCents = toCents(moveDraft.amount);
    if (!goal || !account || !savingCategory || amountCents <= 0) return;
    const appliedCents = Math.min(amountCents, goal.savedCents);

    const transaction: Transaction = {
      id: `goal-withdraw-${goal.id}-${Date.now()}`,
      type: "refund",
      date: moveDraft.date,
      description: `Retiro meta - ${goal.name}`,
      categoryId: savingCategory.id,
      subcategory: goal.name,
      accountId: account.id,
      merchant: goal.name,
      tags: ["meta", `goal:${goal.id}`, "retiro-meta"],
      note: moveDraft.note || `Retiro aplicado a ${goal.name}.`,
      originalAmountCents: appliedCents,
      originalCurrency: account.currency ?? state.currency,
      amountCents: appliedCents,
      baseCurrency: state.currency,
      exchangeRate: 1,
      exchangeRateDate: moveDraft.date,
      exchangeRateSource: "same_currency",
      status: "approved",
      createdBy: state.user.name || "RindoMes",
      audit: [movementAudit("created", `${t("Retiro registrado desde Metas para", "Withdrawal recorded from Goals for")} ${goal.name}.`, state.user.name || "RindoMes")],
    };

    setState((current) => ({
      ...current,
      accounts: applyAccountEffect(current.accounts, transaction, 1),
      goals: current.goals.map((item) => item.id === goal.id ? { ...item, savedCents: Math.max(0, item.savedCents - appliedCents) } : item),
      transactions: [transaction, ...current.transactions],
    }));
    setMoveDraft((current) => ({ ...current, amount: "", note: "" }));
    setMoveGoalId(null);
  }

  function suggestedMonthlyContribution(goal: AppState["goals"][number]) {
    const today = new Date(`${state.activeMonth}-01T00:00:00`);
    const due = new Date(`${goal.due || state.activeMonth}-01T00:00:00`);
    const months = Math.max(1, (due.getFullYear() - today.getFullYear()) * 12 + due.getMonth() - today.getMonth() + 1);
    return Math.max(0, Math.ceil((goal.targetCents - goal.savedCents) / months));
  }

  function submitMove(event: FormEvent<HTMLFormElement>) {
    if (moveMode === "withdraw") registerWithdrawal(event);
    else registerContribution(event);
  }

  const activeGoals = state.goals.filter((goal) => !goal.archived);
  const moveGoal = moveGoalId ? state.goals.find((goal) => goal.id === moveGoalId) : undefined;
  const editGoal = editGoalId ? state.goals.find((goal) => goal.id === editGoalId) : undefined;
  const historyGoal = historyGoalId ? state.goals.find((goal) => goal.id === historyGoalId) : undefined;
  const accountName = (id?: string) => (id ? state.accounts.find((account) => account.id === id)?.name ?? t("Cuenta", "Account") : t("Sin cuenta", "No account"));
  const goalTransactions = (goalId: string) => state.transactions.filter((transaction) => transaction.tags.includes(`goal:${goalId}`));

  return (
    <ViewShell
      title={t("Ahorros y metas", "Savings & goals")}
      eyebrow={t("Separar dinero futuro", "Set money aside for later")}
      description={t("Metas independientes del gasto corriente: fondo de emergencia, carro o viajes.", "Goals kept separate from everyday spending: emergency fund, a car, or trips.")}
      action={<button className="rounded-full bg-[var(--lime)] px-5 py-2.5 text-sm font-bold text-black shadow-sm transition hover:brightness-95" onClick={() => setShowNewGoal((open) => !open)} type="button">{showNewGoal ? t("Cerrar", "Close") : t("+ Nueva meta", "+ New goal")}</button>}
    >
      {showNewGoal && (
        <Card>
          <p className="kicker mb-4">{t("Nueva meta", "New goal")}</p>
          <form className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[1fr_0.8fr_0.8fr_auto] lg:items-end" onSubmit={(event) => { addGoal(event); setShowNewGoal(false); setShowNewGoalMore(false); }}>
            <Input label={t("Nombre", "Name")} value={draft.name} onChange={(value) => setDraft((current) => ({ ...current, name: value }))} placeholder={t("Fondo emergencia, viaje, carro", "Emergency fund, trip, car")} />
            <Input label={t("Meta", "Target")} value={draft.target} onChange={(value) => setDraft((current) => ({ ...current, target: value }))} placeholder="0.00" />
            <label className="grid gap-2 text-sm font-semibold">
              {t("Fecha límite", "Due date")}
              <input className="field" type="month" value={draft.due} onChange={(event) => setDraft((current) => ({ ...current, due: event.target.value }))} />
            </label>
            <div className="flex items-end"><button className="w-full rounded-2xl bg-[var(--lime)] px-5 py-3 text-sm font-bold" type="submit">{t("Agregar", "Add")}</button></div>
            <div className="sm:col-span-2 lg:col-span-4">
              <button className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--primary)] transition hover:text-[var(--ink)]" onClick={() => setShowNewGoalMore((open) => !open)} type="button">{showNewGoalMore ? t("Menos opciones", "Fewer options") : t("Más opciones", "More options")}</button>
              {showNewGoalMore && (
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  <Select label={t("Cuenta asociada", "Linked account")} value={draft.accountId} options={["", ...activeAccounts.map((account) => account.id)]} render={(id) => id ? accountName(id) : t("Sin cuenta", "No account")} onChange={(value) => setDraft((current) => ({ ...current, accountId: value }))} />
                  <Select label={t("Prioridad", "Priority")} value={draft.priority} options={["low", "medium", "high"]} render={priorityLabel} onChange={(value) => setDraft((current) => ({ ...current, priority: value as typeof draft.priority }))} />
                </div>
              )}
            </div>
          </form>
        </Card>
      )}

      {activeGoals.length === 0 && !showNewGoal && (
        <EmptyState title={t("Aún no tienes metas", "You don't have any goals yet")} subtitle={t("Crea tu primera meta", "Create your first goal")}>
          <button className="rounded-full bg-[var(--lime)] px-5 py-2.5 text-sm font-bold text-black" onClick={() => setShowNewGoal(true)} type="button">{t("+ Nueva meta", "+ New goal")}</button>
        </EmptyState>
      )}

      {activeGoals.length > 0 && (
        <div className="grid gap-3">
          {activeGoals.map((goal) => {
            const pct = goal.targetCents > 0 ? Math.round((goal.savedCents / goal.targetCents) * 100) : 0;
            const count = goalTransactions(goal.id).length;
            const hasPriority = goal.priority === "high" || goal.priority === "low";
            return (
              <Card key={goal.id} className="!p-4 sm:!p-5">
                <div className="flex items-center gap-4">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-[var(--line)] bg-white text-[var(--text-muted)]">
                    <Target className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="serif truncate text-lg font-bold leading-tight">{goal.name}</h3>
                      {hasPriority && <span className="rounded-full bg-[var(--surface-soft)] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--text-muted)]">{priorityLabel(goal.priority ?? "medium")}</span>}
                    </div>
                    <button className="mt-1 text-xs font-semibold text-[var(--text-muted)] transition hover:text-[var(--primary)]" onClick={() => setHistoryGoalId(goal.id)} type="button">
                      {count > 0 ? t(`${count} aportes`, `${count} contributions`) : t("Sin aportes", "No contributions")}
                    </button>
                  </div>
                  <span className="serif shrink-0 text-3xl font-bold text-[var(--primary)]">{pct}%</span>
                  <RowMenu
                    items={[
                      { label: t("Editar meta", "Edit goal"), onClick: () => setEditGoalId(goal.id) },
                      { label: t("Ver aportes", "View contributions"), onClick: () => setHistoryGoalId(goal.id) },
                      { label: t("Archivar meta", "Archive goal"), onClick: () => deleteGoal(goal.id), danger: true },
                    ]}
                  />
                </div>
                <Progress className="mt-3" value={goal.targetCents > 0 ? goal.savedCents / goal.targetCents : 0} />
                <div className="mt-3 flex items-center justify-between gap-3">
                  <p className="text-sm text-[var(--text-muted)]">{formatMoney(goal.savedCents, state.currency)} {t("de", "of")} {formatMoney(goal.targetCents, state.currency)}</p>
                  <button
                    className="shrink-0 rounded-full bg-[var(--lime)] px-5 py-2 text-sm font-bold text-black shadow-sm transition hover:brightness-95"
                    onClick={() => openMove(goal.id, "contribute", (suggestedMonthlyContribution(goal) / 100).toString())}
                    type="button"
                  >
                    {t("Aportar", "Add")}
                  </button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Edit one goal */}
      <Modal
        open={Boolean(editGoal)}
        onClose={() => setEditGoalId(null)}
        title={t("Editar meta", "Edit goal")}
        footer={
          <>
            <button className="rounded-2xl bg-red-50 px-4 py-2.5 text-sm font-bold text-[var(--danger)]" onClick={() => { if (editGoal) deleteGoal(editGoal.id); setEditGoalId(null); }} type="button">{t("Archivar meta", "Archive goal")}</button>
            <button className="rounded-2xl bg-[var(--lime)] px-5 py-2.5 text-sm font-bold text-black" onClick={() => setEditGoalId(null)} type="button">{t("Listo", "Done")}</button>
          </>
        }
      >
        {editGoal && (
          <div className="grid gap-4">
            <Input label={t("Nombre", "Name")} value={editGoal.name} onChange={(value) => updateGoal(editGoal.id, { name: value })} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Input label={t("Objetivo", "Target")} value={(editGoal.targetCents / 100).toString()} onChange={(value) => updateGoal(editGoal.id, { targetCents: toCents(value) })} />
              <Input label={t("Ahorrado", "Saved")} value={(editGoal.savedCents / 100).toString()} onChange={(value) => updateGoal(editGoal.id, { savedCents: toCents(value) })} />
            </div>
            <label className="grid gap-2 text-sm font-semibold">
              {t("Fecha límite", "Due date")}
              <input className="field" type="month" value={editGoal.due} onChange={(event) => updateGoal(editGoal.id, { due: event.target.value })} />
            </label>
            <Select label={t("Cuenta asociada", "Linked account")} value={editGoal.accountId ?? ""} options={["", ...activeAccounts.map((account) => account.id)]} render={(id) => id ? accountName(id) : t("Sin cuenta", "No account")} onChange={(value) => updateGoal(editGoal.id, { accountId: value || undefined })} />
            <Select label={t("Prioridad", "Priority")} value={editGoal.priority ?? "medium"} options={["low", "medium", "high"]} render={priorityLabel} onChange={(value) => updateGoal(editGoal.id, { priority: value as AppState["goals"][number]["priority"] })} />
          </div>
        )}
      </Modal>

      {/* Move money for one goal — opened from Aportar / Aporte sugerido */}
      <Modal
        open={Boolean(moveGoal)}
        onClose={() => setMoveGoalId(null)}
        title={moveGoal ? `${moveMode === "withdraw" ? t("Retirar de", "Withdraw from") : t("Aportar a", "Add to")} ${moveGoal.name}` : t("Mover dinero", "Move money")}
        footer={
          <>
            <button className="rounded-2xl border border-[rgba(80,102,0,0.78)] bg-white px-4 py-2.5 text-sm font-bold text-[var(--text-muted)]" onClick={() => setMoveGoalId(null)} type="button">{t("Cancelar", "Cancel")}</button>
            <button className={`rounded-2xl px-5 py-2.5 text-sm font-bold ${moveMode === "withdraw" ? "border border-[rgba(80,102,0,0.78)] bg-white text-[var(--primary)]" : "bg-[var(--lime)] text-black"}`} form="goal-move-form" type="submit">{moveMode === "withdraw" ? t("Retirar", "Withdraw") : t("Aportar", "Add")}</button>
          </>
        }
      >
        {moveGoal && (
          <form className="grid gap-4" id="goal-move-form" onSubmit={submitMove}>
            <div className="flex gap-1 self-start rounded-full bg-[var(--surface-soft)] p-1 text-xs font-bold">
              <button className={`rounded-full px-4 py-1.5 transition ${moveMode === "contribute" ? "bg-[var(--lime)] text-black shadow-sm" : "text-[var(--text-muted)]"}`} onClick={() => setMoveMode("contribute")} type="button">{t("Aportar", "Add")}</button>
              <button className={`rounded-full px-4 py-1.5 transition ${moveMode === "withdraw" ? "bg-[var(--lime)] text-black shadow-sm" : "text-[var(--text-muted)]"}`} onClick={() => setMoveMode("withdraw")} type="button">{t("Retirar", "Withdraw")}</button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Input label={t("Monto", "Amount")} value={moveDraft.amount} onChange={(value) => setMoveDraft((current) => ({ ...current, amount: value }))} placeholder="0.00" />
              <label className="grid gap-2 text-sm font-semibold">
                {t("Fecha", "Date")}
                <input className="field" type="date" value={moveDraft.date} onChange={(event) => setMoveDraft((current) => ({ ...current, date: event.target.value }))} />
              </label>
            </div>
            <Select label={moveMode === "withdraw" ? t("Cuenta destino", "Destination account") : t("Cuenta", "Account")} value={moveDraft.accountId} options={activeAccounts.map((account) => account.id)} render={(id) => accountName(id)} onChange={(value) => setMoveDraft((current) => ({ ...current, accountId: value }))} />
            <details className="rounded-2xl bg-[var(--surface-soft)] p-3">
              <summary className="cursor-pointer select-none text-xs font-bold uppercase tracking-[0.16em] text-[var(--text-muted)]">{t("Más opciones", "More options")}</summary>
              <div className="mt-3">
                <Input label={t("Nota", "Note")} value={moveDraft.note} onChange={(value) => setMoveDraft((current) => ({ ...current, note: value }))} placeholder={t("Detalle del movimiento", "Transaction detail")} />
              </div>
            </details>
          </form>
        )}
      </Modal>

      {/* Contribution history for one goal */}
      <Modal
        open={Boolean(historyGoal)}
        onClose={() => setHistoryGoalId(null)}
        title={historyGoal ? `${t("Aportes", "Contributions")} · ${historyGoal.name}` : t("Aportes", "Contributions")}
        footer={
          historyGoal && (
            <button className="rounded-2xl bg-[var(--lime)] px-5 py-2.5 text-sm font-bold text-black" onClick={() => { const id = historyGoal.id; setHistoryGoalId(null); openMove(id, "contribute", (suggestedMonthlyContribution(historyGoal) / 100).toString()); }} type="button">{t("Aportar", "Add")}</button>
          )
        }
      >
        {historyGoal && (
          <div className="grid gap-2">
            {goalTransactions(historyGoal.id).map((transaction) => (
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface-soft)] px-4 py-3 text-sm" key={transaction.id}>
                <div className="min-w-0">
                  <p className="truncate font-semibold">{transaction.description}</p>
                  <p className="text-xs text-[var(--text-muted)]">{transaction.date}</p>
                </div>
                <strong className="serif shrink-0 text-base">{formatMoney(transaction.amountCents, transaction.baseCurrency)}</strong>
              </div>
            ))}
            {goalTransactions(historyGoal.id).length === 0 && (
              <p className="rounded-2xl border border-dashed border-[var(--line)] p-4 text-sm text-[var(--text-muted)]">{t("Todavía no hay movimientos registrados.", "No transactions recorded yet.")}</p>
            )}
          </div>
        )}
      </Modal>
    </ViewShell>
  );
}

function emptyClosingDraft(month: string) {
  return {
    month,
    reviewChecked: false,
    exceededChecked: false,
    leftoversChecked: false,
    savingsChecked: false,
    debtsChecked: false,
    confirmedAccountIds: [] as string[],
    learning: "",
    prepareNext: true,
  };
}

type ReportBreakdownFacet = "category" | "account" | "merchant" | "tag" | "type";

interface ReportBreakdownRow {
  id: string;
  label: string;
  amountCents: number;
  count: number;
  plannedCents?: number;
  subtitle?: string;
}

const reportFacetLabels: Record<ReportBreakdownFacet, string> = {
  category: "Categoria",
  account: "Cuenta",
  merchant: "Comercio/persona",
  tag: "Etiqueta",
  type: "Tipo",
};

function daysInMonthKey(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(year, monthNumber, 0).getDate();
}

function elapsedDaysForMonth(month: string) {
  const today = new Date();
  const currentMonth = today.toISOString().slice(0, 7);
  if (month < currentMonth) return daysInMonthKey(month);
  if (month > currentMonth) return 1;
  return Math.max(1, today.getDate());
}

function ReportsView({
  state,
  usage,
  summary,
  setState,
}: {
  state: AppState;
  usage: ReturnType<typeof categoryUsage>;
  summary: ReturnType<typeof summarize>;
  setState: Dispatch<SetStateAction<AppState>>;
}) {
  const { t } = useT();
  const [reportMode, setReportMode] = useState<"month" | "analysis" | "year" | "closings">("month");
  const [reportFacet, setReportFacet] = useState<ReportBreakdownFacet>("category");
  const [accountsModalOpen, setAccountsModalOpen] = useState(false);
  const [closingDraftState, setClosingDraft] = useState(() => emptyClosingDraft(state.activeMonth));
  const closingDraft = closingDraftState.month === state.activeMonth ? closingDraftState : emptyClosingDraft(state.activeMonth);
  // Año de la lectura anual, navegable de forma independiente (el cierre mensual sigue usando
  // state.activeMonth). Arranca en el año del mes activo.
  const [selectedYear, setSelectedYear] = useState(state.activeMonth.slice(0, 4));
  const year = selectedYear;
  const monthlyTransactions = useMemo(() => transactionsForMonth(state, state.activeMonth), [state]);
  const approvedMonthlyTransactions = useMemo(() => monthlyTransactions.filter((transaction) => transaction.status === "approved"), [monthlyTransactions]);
  const nextMonth = nextMonthKey(state.activeMonth);
  const rows = useMemo(() => annualRows(state, year), [state, year]);
  const annualIncome = rows.reduce((sum, row) => sum + row.income, 0);
  const annualOutflow = rows.reduce((sum, row) => sum + row.outflow, 0);
  const elapsedDays = elapsedDaysForMonth(state.activeMonth);
  const remainingDays = Math.max(1, daysInMonthKey(state.activeMonth) - elapsedDays + 1);
  const dailyOutflowAverage = Math.round(summary.outflow / elapsedDays);
  const estimatedDailyAvailable = Math.round(summary.remainder / remainingDays);
  const isMonthClosed = state.monthClosings.some((closing) => closing.month === state.activeMonth);
  const monthlyTransactionIds = useMemo(() => new Set(monthlyTransactions.map((transaction) => transaction.id)), [monthlyTransactions]);
  const pendingReceiptCount = state.receipts.filter((receipt) => (
    ["uploaded", "processing", "needs_review"].includes(receipt.status)
    && (receipt.date ?? receipt.createdAt).slice(0, 7) === state.activeMonth
  )).length;
  const pendingReviewCount = state.review.filter((item) => {
    if (item.targetType === "transaction" && item.targetId) return monthlyTransactionIds.has(item.targetId);
    if (item.targetType === "receipt" && item.targetId) {
      const receipt = state.receipts.find((candidate) => candidate.id === item.targetId);
      return receipt ? (receipt.date ?? receipt.createdAt).slice(0, 7) === state.activeMonth : true;
    }
    return true;
  }).length + monthlyTransactions.filter((transaction) => (
    transaction.status === "needs_review"
    && !state.review.some((item) => item.targetType === "transaction" && item.targetId === transaction.id)
  )).length;
  const exceededCategories = usage.filter((item) => item.ratio > 1);
  const leftoverCents = usage.filter((item) => item.remaining > 0).reduce((sum, item) => sum + item.remaining, 0);
  const savingsActualCents = state.categories
    .filter((category) => ["savings", "investments"].includes(category.group))
    .reduce((sum, category) => sum + categoryActualCents(state, state.activeMonth, category.id), 0);
  const debtActualCents = state.categories
    .filter((category) => category.group === "debt")
    .reduce((sum, category) => sum + categoryActualCents(state, state.activeMonth, category.id), 0);
  const accountBalancesChecked = state.accounts.length === 0 || state.accounts.every((account) => closingDraft.confirmedAccountIds.includes(account.id));
  const closingChecklistDone = closingDraft.reviewChecked
    && accountBalancesChecked
    && closingDraft.exceededChecked
    && closingDraft.leftoversChecked
    && closingDraft.savingsChecked
    && closingDraft.debtsChecked;
  const closingProgress = [
    closingDraft.reviewChecked,
    accountBalancesChecked,
    closingDraft.exceededChecked,
    closingDraft.leftoversChecked,
    closingDraft.savingsChecked,
    closingDraft.debtsChecked,
  ].filter(Boolean).length;
  const suggestedAdjustments = exceededCategories.map((item) => ({
    categoryId: item.id,
    name: item.name,
    currentPlannedCents: item.plannedCents,
    suggestedPlannedCents: Math.max(item.plannedCents, Math.ceil(item.spent / 10000) * 10000),
    reason: `Gasto real de ${formatMoney(item.spent, state.currency)} contra plan de ${formatMoney(item.plannedCents, state.currency)}.`,
  }));
  const reportRows = useMemo(() => {
    if (reportFacet === "category") {
      return usage
        .filter((item) => item.spent !== 0 || item.plannedCents !== 0)
        .map((item) => ({
          id: item.id,
          label: item.name,
          amountCents: item.spent,
          plannedCents: item.plannedCents,
          count: approvedMonthlyTransactions.filter((transaction) => transaction.categoryId === item.id || transaction.splits?.some((split) => split.categoryId === item.id)).length,
          subtitle: item.remaining < 0 ? `${formatMoney(Math.abs(item.remaining), state.currency)} sobre plan` : `${formatMoney(item.remaining, state.currency)} disponible`,
        }));
    }

    const byId = new Map<string, ReportBreakdownRow>();
    const add = (id: string, label: string, amountCents: number, subtitle?: string) => {
      const current = byId.get(id) ?? { id, label, amountCents: 0, count: 0, subtitle };
      byId.set(id, {
        ...current,
        amountCents: current.amountCents + amountCents,
        count: current.count + 1,
        subtitle: current.subtitle ?? subtitle,
      });
    };

    for (const transaction of approvedMonthlyTransactions) {
      const category = categoryById(state.categories, transaction.categoryId);
      const isIncome = category?.group === "income";
      const isTransfer = transaction.type === "transfer";
      const multiplier = transaction.type === "refund" ? -1 : 1;
      const amount = transaction.amountCents * multiplier;

      if (reportFacet === "account") {
        if (!isTransfer && !isIncome) {
          const account = state.accounts.find((item) => item.id === transaction.accountId);
          add(transaction.accountId, account?.name ?? "Cuenta eliminada", amount, account?.kind);
        }
      }

      if (reportFacet === "merchant") {
        if (!isTransfer && !isIncome) {
          const label = transaction.merchant || transaction.person || "Sin comercio/persona";
          add(label, label, amount, category?.name);
        }
      }

      if (reportFacet === "tag") {
        if (!isTransfer && !isIncome) {
          const tags = transaction.tags.length ? transaction.tags : ["sin-etiqueta"];
          for (const tag of tags) add(tag, tag, amount, category?.name);
        }
      }

      if (reportFacet === "type") {
        add(transaction.type, transactionTypeLabel(transaction.type), amount, isTransfer ? t("No altera ingreso/gasto real", "Does not affect real income/spending") : category?.name);
      }
    }

    return [...byId.values()].sort((a, b) => Math.abs(b.amountCents) - Math.abs(a.amountCents));
  }, [approvedMonthlyTransactions, reportFacet, state.accounts, state.categories, state.currency, usage, t]);
  const reportTotal = reportRows.reduce((sum, row) => sum + Math.max(0, row.amountCents), 0);

  function closeMonth() {
    if (isMonthClosed || !closingChecklistDone) return;
    const learning = closingDraft.learning.trim();
    const notes = [
      "Cierre guiado desde Reportes.",
      `Pendientes de revision: ${pendingReviewCount}. Recibos pendientes: ${pendingReceiptCount}.`,
      exceededCategories.length ? `Categorias excedidas: ${exceededCategories.map((item) => item.name).join(", ")}.` : "Sin categorias excedidas.",
      learning ? `Aprendizaje: ${learning}` : "Sin aprendizaje escrito.",
    ].join(" ");

    setState((current) => {
      if (current.monthClosings.some((closing) => closing.month === state.activeMonth)) return current;
      const month = closingDraft.prepareNext ? nextMonthKey(current.activeMonth) : current.activeMonth;
      const updatedAt = new Date().toISOString().slice(0, 10);
      const stateWithNextPlan = closingDraft.prepareNext ? prepareMonthlyPlansForMonth(current, month, suggestedAdjustments) : current;

      return {
        ...stateWithNextPlan,
        activeMonth: month,
        spaces: closingDraft.prepareNext
          ? stateWithNextPlan.spaces.map((space) => (
            space.id === current.activeSpaceId ? { ...space, activeMonth: month, updatedAt } : space
          ))
          : stateWithNextPlan.spaces,
        monthClosings: [
          {
            id: `close-${state.activeMonth}-${Date.now()}`,
            month: state.activeMonth,
            incomeCents: summary.income,
            outflowCents: summary.outflow,
            remainderCents: summary.remainder,
            savingsRate: summary.savingsRate,
            netWorthCents: summary.netWorth,
            closedAt: updatedAt,
            pendingReviewCount,
            pendingReceiptCount,
            confirmedAccountIds: closingDraft.confirmedAccountIds,
            exceededCategories: exceededCategories.map((item) => ({
              categoryId: item.id,
              name: item.name,
              plannedCents: item.plannedCents,
              spentCents: item.spent,
              overCents: item.spent - item.plannedCents,
            })),
            suggestedAdjustments,
            learning,
            nextMonthPrepared: closingDraft.prepareNext,
            notes,
          },
          ...stateWithNextPlan.monthClosings,
        ],
      };
    });
  }

  function prepareNextMonth() {
    setState((current) => {
      const month = nextMonthKey(current.activeMonth);
      const updatedAt = new Date().toISOString().slice(0, 10);
      const stateWithNextPlan = prepareMonthlyPlansForMonth(current, month);

      return {
        ...stateWithNextPlan,
        activeMonth: month,
        spaces: stateWithNextPlan.spaces.map((space) => (
          space.id === current.activeSpaceId ? { ...space, activeMonth: month, updatedAt } : space
        )),
      };
    });
  }

  return (
    <ViewShell title={t("Reportes", "Reports")} eyebrow={t("Mensual y anual", "Monthly and annual")} description={t("Tasa de ahorro, ingresos reales, gasto promedio y cierre mensual en un vistazo.", "Savings rate, real income, average spending, and month-end close at a glance.")}>
      <div className="grid grid-cols-4 rounded-full bg-[var(--surface-soft)] p-2">
        {[
          ["month", t("Mes", "Month")],
          ["analysis", t("Análisis", "Analysis")],
          ["year", t("Año", "Year")],
          ["closings", t("Cierres", "Closings")],
        ].map(([value, label]) => (
          <button
            className={`rounded-full px-4 py-3 text-sm font-semibold ${reportMode === value ? "bg-[var(--lime)] text-black" : "text-[var(--text-muted)]"}`}
            key={value}
            onClick={() => setReportMode(value as "month" | "analysis" | "year" | "closings")}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {reportMode === "year" ? (
          <>
            <Card><Metric label={t("Ingreso anual", "Annual income")} value={formatMoney(annualIncome, state.currency)} tone="good" /></Card>
            <Card><Metric label={t("Egreso anual", "Annual spending")} value={formatMoney(annualOutflow, state.currency)} /></Card>
            <Card><Metric label={t("Balance anual", "Annual balance")} value={formatMoney(annualIncome - annualOutflow, state.currency)} tone={annualIncome - annualOutflow < 0 ? "bad" : "good"} /></Card>
          </>
        ) : reportMode === "analysis" ? (
          <>
            <Card><Metric label={t("Promedio diario gasto", "Average daily spending")} value={formatMoney(dailyOutflowAverage, state.currency)} /></Card>
            <Card><Metric label={t("Disponible diario estimado", "Estimated daily available")} value={formatMoney(estimatedDailyAvailable, state.currency)} tone={estimatedDailyAvailable < 0 ? "bad" : undefined} /></Card>
            <Card><Metric label={t("Días restantes", "Days remaining")} value={String(remainingDays)} /></Card>
          </>
        ) : reportMode === "closings" ? (
          <>
            <Card><Metric label={t("Tasa ahorro/inversión", "Savings/investment rate")} value={`${Math.round(summary.savingsRate * 100)}%`} tone="good" /></Card>
            <Card><Metric label={t("Meses cerrados", "Months closed")} value={String(state.monthClosings.length)} /></Card>
            <Card><Metric label={t("Mes activo", "Active month")} value={isMonthClosed ? t("Cerrado", "Closed") : t("Abierto", "Open")} tone={isMonthClosed ? undefined : "good"} /></Card>
          </>
        ) : (
          <>
            <Card><Metric label={t("Tasa ahorro/inversión", "Savings/investment rate")} value={`${Math.round(summary.savingsRate * 100)}%`} tone="good" /></Card>
            <Card><Metric label={t("Categorías excedidas", "Over-budget categories")} value={String(exceededCategories.length)} tone={exceededCategories.length ? "bad" : undefined} /></Card>
            <Card><Metric label={t("Movimientos del mes", "Transactions this month")} value={String(monthlyTransactions.length)} /></Card>
          </>
        )}
      </div>

      {reportMode === "month" && (
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h3 className="serif text-xl font-bold">{t("Cierre mensual guiado", "Guided month-end close")}</h3>
              <p className="mt-1 text-sm text-[var(--text-muted)]">{t("Marca cada paso y cierra el mes.", "Check each step, then close the month.")}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button className="rounded-full border border-[rgba(80,102,0,0.78)] bg-white px-5 py-3 text-sm font-bold" onClick={prepareNextMonth} type="button">
                {t("Preparar", "Prepare")} {nextMonth}
              </button>
              <button className="rounded-full bg-[var(--lime)] px-6 py-3 text-sm font-bold disabled:opacity-70" disabled={isMonthClosed || !closingChecklistDone} onClick={closeMonth} type="button">
                {isMonthClosed ? t("Mes cerrado", "Month closed") : t(`Cerrar mes (${closingProgress}/6)`, `Close month (${closingProgress}/6)`)}
              </button>
            </div>
          </div>

          <div className="mt-5 space-y-2">
            {([
              {
                key: "reviewChecked",
                title: t("Pendientes revisados", "Pending items reviewed"),
                detail: t(`${pendingReviewCount} por revisar · ${pendingReceiptCount} recibo(s)`, `${pendingReviewCount} to review · ${pendingReceiptCount} receipt(s)`),
              },
              {
                key: "exceededChecked",
                title: t("Categorías excedidas revisadas", "Over-budget categories reviewed"),
                detail: t(`${exceededCategories.length} excedida(s)`, `${exceededCategories.length} over budget`),
              },
              {
                key: "leftoversChecked",
                title: t("Sobrantes reasignados", "Leftovers reassigned"),
                detail: t(`${formatMoney(leftoverCents, state.currency)} disponible`, `${formatMoney(leftoverCents, state.currency)} available`),
              },
              {
                key: "savingsChecked",
                title: t("Ahorro e inversión confirmados", "Savings and investments confirmed"),
                detail: t(`${formatMoney(savingsActualCents, state.currency)} aplicado`, `${formatMoney(savingsActualCents, state.currency)} applied`),
              },
              {
                key: "debtsChecked",
                title: t("Deudas verificadas", "Debts verified"),
                detail: t(`${formatMoney(debtActualCents, state.currency)} pagado`, `${formatMoney(debtActualCents, state.currency)} paid`),
              },
            ] as Array<{ key: "reviewChecked" | "exceededChecked" | "leftoversChecked" | "savingsChecked" | "debtsChecked"; title: string; detail: string }>).map((step) => {
              const done = closingDraft[step.key];
              return (
                <CompactRow
                  key={step.key}
                  icon={done ? <ShieldCheck className="h-5 w-5 text-[var(--primary)]" /> : <ClipboardList className="h-5 w-5" />}
                  label={step.title}
                  sublabel={step.detail}
                  value={done ? t("Listo", "Done") : t("Pendiente", "Pending")}
                  valueTone={done ? "primary" : "default"}
                  onClick={() => setClosingDraft((draft) => ({
                    ...(draft.month === state.activeMonth ? draft : emptyClosingDraft(state.activeMonth)),
                    [step.key]: !done,
                  }))}
                />
              );
            })}

            {(() => {
              const accountsConfirmed = closingDraft.confirmedAccountIds.length;
              const accountsTotal = state.accounts.length;
              const accountsDone = accountBalancesChecked;
              return (
                <CompactRow
                  icon={accountsDone ? <ShieldCheck className="h-5 w-5 text-[var(--primary)]" /> : <Landmark className="h-5 w-5" />}
                  label={t("Saldos de cuentas confirmados", "Account balances confirmed")}
                  sublabel={t(`${accountsConfirmed} de ${accountsTotal} cuenta(s) revisadas`, `${accountsConfirmed} of ${accountsTotal} account(s) reviewed`)}
                  value={accountsDone ? t("Listo", "Done") : t("Revisar", "Review")}
                  valueTone={accountsDone ? "primary" : "default"}
                  onClick={() => setAccountsModalOpen(true)}
                />
              );
            })()}
          </div>

          <details className="group mt-4">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-bold text-[var(--foreground)]">
              <ChevronRight className="h-4 w-4 transition group-open:rotate-90" />
              {t("Más opciones", "More options")}
            </summary>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-soft)] p-4">
                <p className="kicker">{t("Resumen de cierre", "Close summary")}</p>
                <div className="mt-4 grid gap-3">
                  <Metric label={t("Ingresos", "Income")} value={formatMoney(summary.income, state.currency)} />
                  <Metric label={t("Egresos", "Spending")} value={formatMoney(summary.outflow, state.currency)} />
                  <Metric label={t("Remanente", "Remaining")} value={formatMoney(summary.remainder, state.currency)} tone={summary.remainder < 0 ? "bad" : "good"} />
                  <Metric label={t("Patrimonio", "Net worth")} value={formatMoney(summary.netWorth, state.currency)} />
                </div>
              </div>

              <div className="space-y-4">
                <label className="grid gap-2 text-sm font-semibold">
                  {t("Aprendizaje del mes", "Lesson learned this month")}
                  <textarea
                    className="field min-h-28"
                    onChange={(event) => setClosingDraft((draft) => ({
                      ...(draft.month === state.activeMonth ? draft : emptyClosingDraft(state.activeMonth)),
                      learning: event.target.value,
                    }))}
                    placeholder={t("Ej. el supermercado subió por compras grandes.", "E.g., groceries rose from bulk buys.")}
                    value={closingDraft.learning}
                  />
                </label>

                <label className="flex items-start gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface-soft)] p-4 text-sm">
                  <input
                    checked={closingDraft.prepareNext}
                    className="mt-1 h-5 w-5 accent-[var(--primary)]"
                    onChange={(event) => setClosingDraft((draft) => ({
                      ...(draft.month === state.activeMonth ? draft : emptyClosingDraft(state.activeMonth)),
                      prepareNext: event.target.checked,
                    }))}
                    type="checkbox"
                  />
                  <span>
                    <span className="block font-bold">{t(`Preparar ${nextMonth} al cerrar`, `Prepare ${nextMonth} on close`)}</span>
                    <span className="mt-1 block text-[var(--text-muted)]">{t("Copia el plan al mes siguiente.", "Copies the plan to next month.")}</span>
                  </span>
                </label>

                {suggestedAdjustments.length > 0 && (
                  <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-soft)] p-4">
                    <p className="font-bold">{t("Sugerencias para el próximo mes", "Suggestions for next month")}</p>
                    <div className="mt-3 space-y-2">
                      {suggestedAdjustments.slice(0, 4).map((item) => (
                        <div className="flex items-center justify-between gap-3 rounded-xl bg-[var(--surface)] px-3 py-2 text-sm" key={item.categoryId}>
                          <span>{item.name}</span>
                          <span className="font-bold">{formatMoney(item.suggestedPlannedCents, state.currency)}</span>
                        </div>
                      ))}
                    </div>
                    {suggestedAdjustments.length > 4 && (
                      <p className="mt-3 text-xs font-semibold text-[var(--text-muted)]">{t(`+${suggestedAdjustments.length - 4} más`, `+${suggestedAdjustments.length - 4} more`)}</p>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-[var(--line)] bg-[var(--surface-soft)] p-4">
              <h4 className="font-bold">{t("Fugas de capital", "Money leaks")}</h4>
              <div className="mt-4 space-y-3">
                {usage.slice(0, 5).map((item) => <RiskRow key={item.id} name={item.name} ratio={item.ratio} spent={item.spent} planned={item.plannedCents} currency={state.currency} />)}
              </div>
            </div>
          </details>

          <Modal
            open={accountsModalOpen}
            onClose={() => setAccountsModalOpen(false)}
            title={t("Confirmar saldos", "Confirm balances")}
            footer={(
              <>
                <button
                  className="rounded-full border border-[rgba(80,102,0,0.78)] bg-white px-5 py-2.5 text-sm font-bold"
                  onClick={() => setClosingDraft((draft) => ({
                    ...(draft.month === state.activeMonth ? draft : emptyClosingDraft(state.activeMonth)),
                    confirmedAccountIds: state.accounts.map((account) => account.id),
                  }))}
                  type="button"
                >
                  {t("Confirmar todas", "Confirm all")}
                </button>
                <button className="rounded-full bg-[var(--lime)] px-5 py-2.5 text-sm font-bold text-[var(--ink)]" onClick={() => setAccountsModalOpen(false)} type="button">
                  {t("Listo", "Done")}
                </button>
              </>
            )}
          >
            {state.accounts.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">{t("No hay cuentas para confirmar.", "No accounts to confirm.")}</p>
            ) : (
              <div className="space-y-2">
                {state.accounts.map((account) => {
                  const confirmed = closingDraft.confirmedAccountIds.includes(account.id);
                  return (
                    <CompactRow
                      key={account.id}
                      icon={confirmed ? <ShieldCheck className="h-5 w-5 text-[var(--primary)]" /> : <Landmark className="h-5 w-5" />}
                      label={account.name}
                      sublabel={formatMoney(account.balanceCents, account.currency ?? state.currency)}
                      value={confirmed ? t("Confirmada", "Confirmed") : t("Pendiente", "Pending")}
                      valueTone={confirmed ? "primary" : "default"}
                      onClick={() => setClosingDraft((draft) => {
                        const base = draft.month === state.activeMonth ? draft : emptyClosingDraft(state.activeMonth);
                        return {
                          ...base,
                          confirmedAccountIds: confirmed
                            ? base.confirmedAccountIds.filter((id) => id !== account.id)
                            : Array.from(new Set([...base.confirmedAccountIds, account.id])),
                        };
                      })}
                    />
                  );
                })}
              </div>
            )}
          </Modal>
        </Card>
      )}

      {reportMode === "analysis" && (
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h3 className="serif text-xl font-bold">{t("Explorador del mes", "Month explorer")}</h3>
              <p className="mt-1 text-sm text-[var(--text-muted)]">{t("Analiza por categoría, cuenta, comercio, etiqueta o tipo.", "Break down by category, account, merchant, tag, or type.")}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(reportFacetLabels) as ReportBreakdownFacet[]).map((facet) => (
                <button
                  className={`rounded-full px-4 py-2 text-xs font-bold ${reportFacet === facet ? "bg-[var(--lime)] text-black" : "border border-[rgba(80,102,0,0.78)] bg-white text-[var(--text-muted)]"}`}
                  key={facet}
                  onClick={() => setReportFacet(facet)}
                  type="button"
                >
                  {t(reportFacetLabels[facet], { category: "Category", account: "Account", merchant: "Merchant/person", tag: "Tag", type: "Type" }[facet])}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-4 md:grid-cols-4">
            <Metric label={t("Ingresos reales", "Real income")} value={formatMoney(summary.income, state.currency)} tone="good" />
            <Metric label={t("Egresos reales", "Real spending")} value={formatMoney(summary.outflow, state.currency)} />
            <Metric label={t("Gasto promedio diario", "Average daily spending")} value={formatMoney(dailyOutflowAverage, state.currency)} />
            <Metric label={t("Disponible por dia restante", "Available per remaining day")} value={formatMoney(estimatedDailyAvailable, state.currency)} tone={estimatedDailyAvailable < 0 ? "bad" : "good"} />
          </div>

          <div className="mt-6 overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface-soft)]">
            {reportRows.length === 0 && (
              <p className="p-6 text-sm text-[var(--text-muted)]">{t("No hay movimientos aprobados para este reporte. Registra o aprueba movimientos del mes para ver analisis.", "No approved transactions for this report. Record or approve transactions this month to see analysis.")}</p>
            )}
            {reportRows.map((row) => {
              const ratio = reportTotal > 0 ? Math.min(Math.abs(row.amountCents) / reportTotal, 1) : 0;
              return (
                <div className="border-b border-[var(--line)] p-4 last:border-b-0" key={row.id}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-bold">{row.label}</p>
                      <p className="mt-1 text-sm text-[var(--text-muted)]">
                        {row.count} {t("mov.", "txns")} {row.subtitle ? `· ${row.subtitle}` : ""}
                        {row.plannedCents !== undefined ? ` · ${t("Plan", "Plan")} ${formatMoney(row.plannedCents, state.currency)}` : ""}
                      </p>
                    </div>
                    <span className={`serif text-2xl font-bold ${row.amountCents < 0 ? "text-[var(--primary)]" : ""}`}>{formatMoney(row.amountCents, state.currency)}</span>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-900/10">
                    <div className="h-full rounded-full bg-[var(--primary)]" style={{ width: `${Math.max(4, Math.round(ratio * 100))}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {reportMode === "year" && (
        <Card>
          <div className="flex items-center justify-between gap-3">
            <h3 className="serif text-xl font-bold">{t("Lectura anual", "Annual overview")}</h3>
            <div className="flex items-center gap-0.5 rounded-full border border-[var(--line)] bg-white px-1 py-1">
              <button type="button" aria-label={t("Año anterior", "Previous year")} onClick={() => setSelectedYear(String(Number(year) - 1))} className="grid h-7 w-7 place-items-center rounded-full text-[var(--text-muted)] transition hover:bg-white">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="px-2 text-sm font-bold text-[var(--primary)]">{year}</span>
              <button type="button" aria-label={t("Año siguiente", "Next year")} onClick={() => setSelectedYear(String(Number(year) + 1))} className="grid h-7 w-7 place-items-center rounded-full text-[var(--text-muted)] transition hover:bg-white">
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="text-xs uppercase tracking-[0.16em] text-[var(--text-muted)]">
                <tr>
                  <th className="py-3">{t("Mes", "Month")}</th>
                  <th>{t("Ingresos", "Income")}</th>
                  <th>{t("Egresos", "Spending")}</th>
                  <th>{t("Remanente", "Remaining")}</th>
                  <th>{t("Ahorro", "Savings")}</th>
                  <th>{t("Movs", "Txns")}</th>
                  <th>{t("Cierre", "Close")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                {rows.map((row) => (
                  <tr key={row.month}>
                    <td className="py-3 font-semibold">{row.month}</td>
                    <td>{formatMoney(row.income, state.currency)}</td>
                    <td>{formatMoney(row.outflow, state.currency)}</td>
                    <td className={row.remainder < 0 ? "font-semibold text-[var(--warning)]" : "font-semibold text-[var(--primary)]"}>{formatMoney(row.remainder, state.currency)}</td>
                    <td>{Math.round(row.savingsRate * 100)}%</td>
                    <td>{row.transactionCount}</td>
                    <td>{row.closed ? t("Cerrado", "Closed") : t("Abierto", "Open")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {reportMode === "closings" && (
        <div className="grid gap-4">
          {state.monthClosings.map((closing) => (
            <Card key={closing.id}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="kicker">{t(`Cerrado el ${closing.closedAt}`, `Closed on ${closing.closedAt}`)}</p>
                  <h3 className="serif mt-1 text-3xl font-bold">{closing.month}</h3>
                  <p className="mt-2 text-sm text-[var(--text-muted)]">{closing.notes}</p>
                </div>
                <span className={`amount serif text-3xl font-bold ${closing.remainderCents < 0 ? "text-[var(--warning)]" : "text-[var(--primary)]"}`}>{formatMoney(closing.remainderCents, state.currency)}</span>
              </div>
              <div className="mt-5 grid gap-3 md:grid-cols-4">
                <Metric label={t("Ingresos", "Income")} value={formatMoney(closing.incomeCents, state.currency)} />
                <Metric label={t("Egresos", "Spending")} value={formatMoney(closing.outflowCents, state.currency)} />
                <Metric label={t("Ahorro", "Savings")} value={`${Math.round(closing.savingsRate * 100)}%`} />
                <Metric label={t("Patrimonio", "Net worth")} value={formatMoney(closing.netWorthCents, state.currency)} />
              </div>
              {(closing.pendingReviewCount !== undefined || closing.exceededCategories?.length || closing.learning) && (
                <div className="mt-5 grid gap-3 lg:grid-cols-3">
                  <div className="rounded-2xl bg-[var(--surface-soft)] p-4 text-sm">
                    <p className="font-bold">{t("Pendientes al cerrar", "Pending at close")}</p>
                    <p className="mt-1 text-[var(--text-muted)]">{t(`${closing.pendingReviewCount ?? 0} revision(es) · ${closing.pendingReceiptCount ?? 0} recibo(s)`, `${closing.pendingReviewCount ?? 0} review(s) · ${closing.pendingReceiptCount ?? 0} receipt(s)`)}</p>
                  </div>
                  <div className="rounded-2xl bg-[var(--surface-soft)] p-4 text-sm">
                    <p className="font-bold">{t("Excedidos", "Over budget")}</p>
                    <p className="mt-1 text-[var(--text-muted)]">{closing.exceededCategories?.length ? closing.exceededCategories.map((item) => item.name).join(", ") : t("Ninguno", "None")}</p>
                  </div>
                  <div className="rounded-2xl bg-[var(--surface-soft)] p-4 text-sm">
                    <p className="font-bold">{t("Siguiente mes", "Next month")}</p>
                    <p className="mt-1 text-[var(--text-muted)]">{closing.nextMonthPrepared ? t("Preparado automaticamente", "Prepared automatically") : t("No preparado desde el cierre", "Not prepared from this close")}</p>
                  </div>
                </div>
              )}
              {closing.learning && (
                <p className="mt-4 rounded-2xl bg-[var(--surface-soft)] p-4 text-sm text-[var(--foreground)]">{closing.learning}</p>
              )}
            </Card>
          ))}
        </div>
      )}
    </ViewShell>
  );
}

function FamilyView({ state, setState }: { state: AppState; setState: Dispatch<SetStateAction<AppState>> }) {
  const { t } = useT();
  const emptyMemberDraft = { name: "", email: "", role: "viewer" as AppState["members"][number]["role"], avatar: "" };
  const [memberModal, setMemberModal] = useState<{ mode: "add" } | { mode: "edit"; id: string } | null>(null);
  const [memberDraft, setMemberDraft] = useState(emptyMemberDraft);
  const [commentDraft, setCommentDraft] = useState({
    targetType: "transaction" as FamilyComment["targetType"],
    targetId: state.transactions[0]?.id ?? state.categories[0]?.id ?? "",
    body: "",
  });
  const [showCommentTarget, setShowCommentTarget] = useState(false);

  function openAddMember() {
    setMemberDraft(emptyMemberDraft);
    setMemberModal({ mode: "add" });
  }

  function openEditMember(member: AppState["members"][number]) {
    setMemberDraft({ name: member.name, email: member.email ?? "", role: member.role, avatar: member.avatar });
    setMemberModal({ mode: "edit", id: member.id });
  }

  function saveMember() {
    const name = memberDraft.name.trim();
    if (!name || !memberModal) return;
    if (memberModal.mode === "add") {
      setState((current) => ({
        ...current,
        members: [
          ...current.members,
          {
            id: `member-${Date.now()}`,
            name,
            email: memberDraft.email.trim().toLowerCase() || undefined,
            role: memberDraft.role,
            avatar: memberDraft.avatar.trim().slice(0, 3).toUpperCase() || initialsForName(name),
          },
        ],
      }));
    } else {
      const id = memberModal.id;
      updateMember(id, {
        name,
        email: memberDraft.email.trim().toLowerCase() || undefined,
        role: memberDraft.role,
        avatar: memberDraft.avatar.trim().slice(0, 3).toUpperCase() || initialsForName(name),
      });
    }
    setMemberModal(null);
  }

  function updateMember(id: string, patch: Partial<AppState["members"][number]>) {
    setState((current) => ({
      ...current,
      members: current.members.map((member) => member.id === id ? { ...member, ...patch } : member),
    }));
  }

  function canRemove(member: AppState["members"][number]) {
    if (state.members.length <= 1) return false;
    if (member.role === "owner" && state.members.filter((item) => item.role === "owner").length <= 1) return false;
    return true;
  }

  function removeMember(id: string) {
    setState((current) => {
      const member = current.members.find((item) => item.id === id);
      const owners = current.members.filter((item) => item.role === "owner");
      if (!member || current.members.length <= 1 || (member.role === "owner" && owners.length <= 1)) return current;
      return { ...current, members: current.members.filter((item) => item.id !== id) };
    });
  }

  function addFamilyComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!commentDraft.targetId || !commentDraft.body.trim()) return;

    setState((current) => ({
      ...current,
      comments: [
        createFamilyComment(current, commentDraft.targetType, commentDraft.targetId, commentDraft.body.trim()),
        ...current.comments,
      ],
    }));
    setCommentDraft((current) => ({ ...current, body: "" }));
  }

  const commentTargets = commentDraft.targetType === "transaction"
    ? state.transactions.map((transaction) => ({ id: transaction.id, label: `${transaction.date} - ${transaction.description}` }))
    : state.categories.map((category) => ({ id: category.id, label: category.name }));

  return (
    <ViewShell
      title={t("Centro familiar", "Family center")}
      eyebrow={state.householdName}
      description={t("Gestiona el acceso de los miembros del hogar.", "Manage access for the people in your household.")}
      action={
        <button className="inline-flex items-center gap-2 rounded-2xl bg-[var(--lime)] px-5 py-3 text-sm font-bold" onClick={openAddMember} type="button">
          <Plus className="h-4 w-4" />
          {t("Invitar", "Invite")}
        </button>
      }
    >
      <Card>
        <SectionHeader title={t("Miembros", "Members")} action={t("Invitar", "Invite")} onAction={openAddMember} />
        <div className="mt-4 grid gap-2">
          {state.members.map((member) => (
            <CompactRow
              key={member.id}
              icon={<span className="font-bold">{member.avatar}</span>}
              label={member.name}
              sublabel={member.email ? `${roleLabel(member.role)} · ${member.email}` : roleLabel(member.role)}
              value={roleLabel(member.role)}
              valueTone="primary"
              menu={[
                { label: t("Editar rol", "Edit role"), onClick: () => openEditMember(member) },
                ...(canRemove(member) ? [{ label: t("Eliminar", "Remove"), onClick: () => removeMember(member.id), danger: true }] : []),
              ]}
            />
          ))}
        </div>
      </Card>

      <Card>
        <h3 className="serif text-xl font-bold">{t("Notas", "Notes")}</h3>
        <form className="mt-5 grid gap-4 sm:grid-cols-1 lg:grid-cols-[1fr_1.3fr_auto] lg:items-end" onSubmit={addFamilyComment}>
          <Select label={t("Elemento", "Item")} value={commentDraft.targetId} options={commentTargets.map((target) => target.id)} render={(id) => commentTargets.find((target) => target.id === id)?.label ?? id} onChange={(value) => setCommentDraft((current) => ({ ...current, targetId: value }))} />
          <Input label={t("Comentario", "Comment")} value={commentDraft.body} onChange={(value) => setCommentDraft((current) => ({ ...current, body: value }))} placeholder={t("Añade una nota…", "Add a note…")} />
          <button className="w-full rounded-2xl bg-[var(--lime)] px-5 py-3 text-sm font-bold text-[var(--ink)] disabled:opacity-70" type="submit" disabled={!commentDraft.targetId || !commentDraft.body.trim()}>{t("Guardar nota", "Save note")}</button>
          <div className="lg:col-span-3">
            {showCommentTarget ? (
              <div className="rounded-2xl bg-[var(--surface-soft)] p-3 sm:max-w-xs">
                <Select label={t("Sobre", "About")} value={commentDraft.targetType} options={["transaction", "category"]} render={(value) => value === "transaction" ? t("Movimiento", "Movement") : t("Categoría", "Category")} onChange={(value) => {
                  const targetType = value as FamilyComment["targetType"];
                  const firstTarget = targetType === "transaction" ? state.transactions[0]?.id : state.categories[0]?.id;
                  setCommentDraft((current) => ({ ...current, targetType, targetId: firstTarget ?? "" }));
                }} />
              </div>
            ) : (
              <button className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--primary)] transition hover:text-[var(--ink)]" onClick={() => setShowCommentTarget(true)} type="button">
                {t("Más opciones", "More options")}
              </button>
            )}
          </div>
        </form>
        <CommentList comments={state.comments} state={state} />
      </Card>

      <Modal
        open={memberModal !== null}
        onClose={() => setMemberModal(null)}
        title={memberModal?.mode === "edit" ? t("Editar miembro", "Edit member") : t("Invitar miembro", "Invite member")}
        footer={
          <>
            <button className="rounded-2xl bg-white px-5 py-3 text-sm font-bold text-[var(--foreground)]" onClick={() => setMemberModal(null)} type="button">{t("Cancelar", "Cancel")}</button>
            <button className="rounded-2xl bg-[var(--lime)] px-5 py-3 text-sm font-bold text-[var(--ink)] disabled:opacity-70" onClick={saveMember} type="button" disabled={!memberDraft.name.trim()}>
              {memberModal?.mode === "edit" ? t("Guardar", "Save") : t("Agregar", "Add")}
            </button>
          </>
        }
      >
        <div className="grid gap-4">
          <div className="flex items-center gap-3">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-[var(--lime)] font-bold text-[var(--ink)]">
              {(memberDraft.avatar.trim().slice(0, 3).toUpperCase() || (memberDraft.name.trim() ? initialsForName(memberDraft.name.trim()) : "··"))}
            </span>
            <p className="text-sm text-[var(--text-muted)]">{t("Iniciales automáticas del nombre.", "Initials are generated from the name.")}</p>
          </div>
          <Input label={t("Nombre", "Name")} value={memberDraft.name} onChange={(value) => setMemberDraft((current) => ({ ...current, name: value }))} placeholder={t("Nombre del miembro", "Member's name")} />
          <Input label={t("Email", "Email")} value={memberDraft.email} onChange={(value) => setMemberDraft((current) => ({ ...current, email: value }))} placeholder="persona@email.com" />
          <Select label={t("Rol", "Role")} value={memberDraft.role} options={["owner", "editor", "viewer"]} render={roleLabel} onChange={(value) => setMemberDraft((current) => ({ ...current, role: value as typeof memberDraft.role }))} />
          <details className="rounded-2xl bg-[var(--surface-soft)] p-3">
            <summary className="cursor-pointer select-none text-xs font-bold uppercase tracking-[0.16em] text-[var(--text-muted)]">{t("Más opciones", "More options")}</summary>
            <div className="mt-3">
              <Input label={t("Iniciales", "Initials")} value={memberDraft.avatar} onChange={(value) => setMemberDraft((current) => ({ ...current, avatar: value }))} placeholder={t("Se generan del nombre", "Generated from the name")} />
            </div>
          </details>
        </div>
      </Modal>
    </ViewShell>
  );
}

function ExportView({ state }: { state: AppState }) {
  const { t } = useT();
  const { notify } = useToast();
  const monthlyTransactions = state.transactions.filter((transaction) => transaction.date.startsWith(state.activeMonth));
  const approved = monthlyTransactions.filter((transaction) => transaction.status === "approved");
  const summary = summarize(state);
  const usageRows = categoryUsage(state);
  const monthlyTextSummary = [
    `RindoMes - Resumen ${state.activeMonth}`,
    `Ingresos reales: ${formatMoney(summary.income, state.currency)}`,
    `Egresos reales: ${formatMoney(summary.outflow, state.currency)}`,
    `Remanente: ${formatMoney(summary.remainder, state.currency)}`,
    `Tasa ahorro/inversion: ${Math.round(summary.savingsRate * 100)}%`,
    `Patrimonio neto: ${formatMoney(summary.netWorth, state.currency)}`,
    "",
    "Categorias con mayor uso:",
    ...usageRows.slice(0, 6).map((item) => `- ${item.name}: ${formatMoney(item.spent, state.currency)} real / ${formatMoney(item.plannedCents, state.currency)} plan (${Math.round(item.ratio * 100)}%)`),
  ].join("\n");

  function notifyFileDownloaded() {
    notify(t("Archivo descargado", "File downloaded"), "success");
  }

  function exportTransactionsCsv() {
    const rows = monthlyTransactions.map((transaction) => {
      const category = categoryById(state.categories, transaction.categoryId);
      const account = state.accounts.find((item) => item.id === transaction.accountId);
      return [
        transaction.date,
        transaction.type,
        transaction.description,
        category?.name ?? "",
        transaction.subcategory ?? "",
        account?.name ?? "",
        transaction.merchant ?? "",
        transaction.originalCurrency,
        (transaction.originalAmountCents / 100).toFixed(2),
        transaction.baseCurrency,
        (transaction.amountCents / 100).toFixed(2),
        String(transaction.exchangeRate),
        transaction.exchangeRateDate,
        transaction.status,
        transaction.tags.join("|"),
        (transaction.splits ?? []).map((split) => `${categoryById(state.categories, split.categoryId)?.name ?? split.categoryId}:${(split.amountCents / 100).toFixed(2)}`).join("|"),
        transaction.note ?? "",
      ];
    });
    downloadText(`rindomes-movimientos-${state.activeMonth}.csv`, toCsv([
      "fecha",
      "tipo",
      "descripcion",
      "categoria",
      "subcategoria",
      "cuenta",
      "comercio_persona",
      "moneda_original",
      "monto_original",
      "moneda_base",
      "monto_base",
      "tasa",
      "fecha_tasa",
      "estado",
      "tags",
      "splits",
      "nota",
    ], rows), "text/csv;charset=utf-8");
    notifyFileDownloaded();
  }

  function exportPlanCsv() {
    const rows = usageRows.map((category) => {
      return [
        category.group,
        category.name,
        category.subcategories.join("|"),
        category.source ?? "user",
        (category.plannedCents / 100).toFixed(2),
        (category.spent / 100).toFixed(2),
        (category.remaining / 100).toFixed(2),
      ];
    });
    downloadText(`rindomes-plan-${state.activeMonth}.csv`, toCsv(["grupo", "categoria", "subcategorias", "origen", "plan", "real", "diferencia"], rows), "text/csv;charset=utf-8");
    notifyFileDownloaded();
  }

  function exportBackupJson() {
    downloadText(`rindomes-backup-${state.activeMonth}.json`, JSON.stringify(state, null, 2), "application/json;charset=utf-8");
    notifyFileDownloaded();
  }

  function exportMonthlySummaryText() {
    downloadText(`rindomes-resumen-${state.activeMonth}.txt`, monthlyTextSummary, "text/plain;charset=utf-8");
    notifyFileDownloaded();
  }

  async function exportWorkbookXlsx() {
    const ExcelJS = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "RindoMes";
    workbook.created = new Date();

    const summarySheet = workbook.addWorksheet("Resumen");
    summarySheet.addRows([
      ["Mes", state.activeMonth],
      ["Moneda", state.currency],
      ["Ingresos reales", summary.income / 100],
      ["Egresos reales", summary.outflow / 100],
      ["Remanente", summary.remainder / 100],
      ["Tasa ahorro/inversion", summary.savingsRate],
      ["Patrimonio neto", summary.netWorth / 100],
    ]);

    const movementSheet = workbook.addWorksheet("Movimientos");
    movementSheet.addRow(["fecha", "tipo", "descripcion", "categoria", "subcategoria", "cuenta", "comercio_persona", "moneda_original", "monto_original", "moneda_base", "monto_base", "estado", "tags", "nota"]);
    monthlyTransactions.forEach((transaction) => {
      const category = categoryById(state.categories, transaction.categoryId);
      const account = state.accounts.find((item) => item.id === transaction.accountId);
      movementSheet.addRow([
        transaction.date,
        transaction.type,
        transaction.description,
        category?.name ?? "",
        transaction.subcategory ?? "",
        account?.name ?? "",
        transaction.merchant ?? "",
        transaction.originalCurrency,
        transaction.originalAmountCents / 100,
        transaction.baseCurrency,
        transaction.amountCents / 100,
        transaction.status,
        transaction.tags.join("|"),
        transaction.note ?? "",
      ]);
    });

    const planSheet = workbook.addWorksheet("Plan vs real");
    planSheet.addRow(["grupo", "categoria", "plan", "real", "diferencia", "uso"]);
    usageRows.forEach((category) => {
      planSheet.addRow([category.group, category.name, category.plannedCents / 100, category.spent / 100, category.remaining / 100, category.ratio]);
    });

    const accountSheet = workbook.addWorksheet("Cuentas");
    accountSheet.addRow(["nombre", "tipo", "moneda", "saldo", "confirmado", "fecha_confirmacion", "por_defecto", "archivada", "notas"]);
    state.accounts.forEach((account) => {
      accountSheet.addRow([
        account.name,
        account.kind,
        account.currency ?? state.currency,
        account.balanceCents / 100,
        (account.confirmedBalanceCents ?? account.balanceCents) / 100,
        account.lastConfirmedAt ?? "",
        account.defaultForCapture ? "si" : "no",
        account.archived ? "si" : "no",
        account.notes ?? "",
      ]);
    });

    for (const sheet of workbook.worksheets) {
      sheet.columns.forEach((column) => {
        column.width = Math.max(14, Math.min(36, Math.max(...(column.values ?? []).map((value) => String(value ?? "").length + 2))));
      });
      sheet.getRow(1).font = { bold: true };
    }

    const buffer = await workbook.xlsx.writeBuffer();
    downloadBlob(`rindomes-${state.activeMonth}.xlsx`, new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    notifyFileDownloaded();
  }

  const exportRows: Array<{
    icon: ReactNode;
    label: string;
    sublabel: string;
    format: string;
    onClick: () => void;
  }> = [
    {
      icon: <FileSpreadsheet className="h-5 w-5" />,
      label: t("Excel completo", "Full Excel"),
      sublabel: t("Todo en un archivo para compartir", "Everything in one file to share"),
      format: "XLSX",
      onClick: () => void exportWorkbookXlsx(),
    },
    {
      icon: <WalletCards className="h-5 w-5" />,
      label: t("Movimientos", "Transactions"),
      sublabel: t("Tus movimientos del mes como hoja de cálculo", "This month's transactions as a spreadsheet"),
      format: "CSV",
      onClick: exportTransactionsCsv,
    },
    {
      icon: <ClipboardList className="h-5 w-5" />,
      label: t("Plan vs real", "Plan vs. actual"),
      sublabel: t("Presupuesto y gasto por categoría", "Budget and spending by category"),
      format: "CSV",
      onClick: exportPlanCsv,
    },
    {
      icon: <ReceiptText className="h-5 w-5" />,
      label: t("Resumen del mes", "Month summary"),
      sublabel: t("Ingresos, egresos y categorías clave", "Income, spending, and key categories"),
      format: "TXT",
      onClick: exportMonthlySummaryText,
    },
    {
      icon: <ShieldCheck className="h-5 w-5" />,
      label: t("Copia de seguridad", "Full backup"),
      sublabel: t("Todos tus datos para restaurar después", "All your data to restore later"),
      format: "JSON",
      onClick: exportBackupJson,
    },
  ];

  return (
    <ViewShell title={t("Exportación", "Export")} eyebrow={t("Salida de datos", "Data export")} description={t("Los datos del hogar no quedan encerrados: puedes llevar movimientos, plan o un backup completo fuera de la app.", "Your household data isn't locked in: take your transactions, plan, or a full backup out of the app anytime.")}>
      <Card>
        <p className="kicker">{t(`Exportando los datos de ${state.activeMonth}`, `Exporting ${state.activeMonth} data`)}</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Metric label={t("Movimientos", "Transactions")} value={String(monthlyTransactions.length)} />
          <Metric label={t("Aprobados", "Approved")} value={String(approved.length)} tone="good" />
          <Metric label={t("Categorías", "Categories")} value={String(state.categories.length)} />
        </div>
      </Card>

      <Card>
        <h3 className="serif text-xl font-bold tracking-tight">{t("Descargar", "Download")}</h3>
        <div className="mt-4 grid gap-2.5">
          {exportRows.map((row) => (
            <CompactRow
              key={`${row.label}-${row.format}`}
              icon={row.icon}
              label={row.label}
              sublabel={row.sublabel}
              value={row.format}
              valueTone="primary"
              onClick={row.onClick}
            />
          ))}
        </div>
      </Card>
    </ViewShell>
  );
}

// Cloud identity: the real Convex Auth session + members + danger zone. Rendered only when
// Convex is configured (so the auth/mutation hooks always run under the provider).
function CloudAccountSection() {
  const { t } = useT();
  const { notify } = useToast();
  const { signOut } = useAuthActions();
  const deleteAccount = useMutation(api.finance.deleteAccount);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  async function handleDelete() {
    if (typeof window !== "undefined" && !window.confirm(t("¿Borrar tu cuenta y TODOS tus datos de forma permanente? Esta acción no se puede deshacer.", "Permanently delete your account and ALL your data? This action can't be undone."))) return;
    setDeleting(true);
    setError("");
    try {
      // The mutation now requires the literal confirm:'DELETE' and returns an honest cleanup status.
      const result = await deleteAccount({ confirm: "DELETE" });
      if (typeof window !== "undefined") {
        window.localStorage.removeItem("rindomes.convex.householdId");
        window.localStorage.removeItem("rindomes.onboarded");
        window.localStorage.removeItem("rindomes.localState.v1");
        // Be honest: if the auth identity could only be partially cleaned, warn the user before we
        // sign out (their financial data IS gone, but some auth side-records may linger).
        if (result?.authCleanup === "partial") {
          window.alert(t("Borramos tus datos financieros, pero parte de tu identidad de acceso no se pudo eliminar por completo. Si vuelves a registrarte con el mismo correo y notas algo raro, contáctanos.", "We deleted your financial data, but part of your login identity couldn't be fully removed. If you sign up again with the same email and notice anything odd, contact us."));
        }
      }
      await signOut();
    } catch (caught) {
      setDeleting(false);
      setError(caught instanceof Error ? caught.message : t("No pude borrar la cuenta. Intenta de nuevo.", "I couldn't delete the account. Please try again."));
    }
  }

  return (
    <div className="mb-5 grid gap-5">
      <AuthPanel />
      <MembersPanel notify={notify} />
      <Card>
        <h3 className="serif text-2xl font-bold text-[var(--danger)]">{t("Zona de peligro", "Danger zone")}</h3>
        <p className="mt-2 text-sm text-[var(--text-muted)]">{t("Borra tu cuenta y todos tus datos (cuentas, movimientos, deudas, metas) de la nube de forma permanente. Tendrás que registrarte de nuevo para volver a usar la app.", "Permanently delete your account and all your data (accounts, transactions, debts, goals) from the cloud. You'll need to sign up again to use the app.")}</p>
        {error && <p className="mt-3 text-sm font-semibold text-[var(--danger)]">{error}</p>}
        <button
          className="mt-4 rounded-2xl border border-[var(--danger)] bg-red-50 px-5 py-3 text-sm font-bold text-[var(--danger)] transition hover:bg-red-100 disabled:opacity-70"
          onClick={() => void handleDelete()}
          disabled={deleting}
          type="button"
        >
          {deleting ? t("Borrando…", "Deleting…") : t("Borrar mi cuenta y mis datos", "Delete my account and data")}
        </button>
      </Card>
    </div>
  );
}

function AccountView({ state, setState, authed = false }: { state: AppState; setState: Dispatch<SetStateAction<AppState>>; authed?: boolean }) {
  const { t } = useT();
  const member = currentWorkspaceMember(state);
  const [draft, setDraft] = useState({
    name: state.user.name,
    email: state.user.email,
    locale: state.user.locale,
    timezone: state.user.timezone,
  });

  function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = draft.name.trim();
    const email = draft.email.trim().toLowerCase();
    if (!name || !email) return;

    setState((current) => {
      const existingMember = current.members.find((item) => item.email?.toLowerCase() === email || item.name.toLowerCase() === name.toLowerCase());
      const memberId = existingMember?.id ?? `member-${Date.now()}`;
      const nextMember = existingMember ?? {
        id: memberId,
        name,
        email,
        role: current.members.length ? "viewer" as const : "owner" as const,
        avatar: initialsForName(name),
      };

      return {
        ...current,
        user: {
          ...current.user,
          id: current.user.id || `user-${slugify(email)}`,
          name,
          email,
          avatar: initialsForName(name),
          locale: draft.locale || "es-DO",
          timezone: draft.timezone || "America/Santo_Domingo",
          status: "signed_in",
          provider: "local",
          currentMemberId: memberId,
          createdAt: current.user.createdAt || new Date().toISOString().slice(0, 10),
          lastLoginAt: new Date().toISOString(),
        },
        members: existingMember ? current.members.map((item) => item.id === memberId ? { ...item, name, email, avatar: initialsForName(name) } : item) : [...current.members, nextMember],
      };
    });
  }

  function signOut() {
    setState((current) => ({
      ...current,
      user: {
        ...current.user,
        status: "signed_out",
        lastLoginAt: new Date().toISOString(),
      },
    }));
  }

  function switchMember(memberId: string) {
    const selected = state.members.find((item) => item.id === memberId);
    if (!selected) return;

    setState((current) => ({
      ...current,
      user: {
        ...current.user,
        status: "signed_in",
        currentMemberId: memberId,
        name: selected.name,
        email: selected.email ?? current.user.email,
        avatar: selected.avatar,
        lastLoginAt: new Date().toISOString(),
      },
    }));
  }

  const sessionActive = authed || state.user.status === "signed_in";

  return (
    <ViewShell title={t("Cuenta y acceso", "Account & access")} eyebrow={authed ? t("Sesión verificada", "Verified session") : sessionActive ? t("Sesión local activa", "Local session active") : t("Sin sesión", "Not signed in")} description={t("Tu hogar se sincroniza con tu cuenta entre el celular y la computadora.", "Your household syncs to your account across your phone and computer.")}>
      {convexConfigured ? (
        <CloudAccountSection />
      ) : (
        <Card className="mb-5">
          <h3 className="serif text-xl font-bold">{t("Crear o iniciar sesión", "Create account or sign in")}</h3>
          <p className="mt-2 text-sm text-[var(--text-muted)]">{t("Tu sesión se guarda en este dispositivo.", "Your session is saved on this device.")}</p>
          <form className="mt-5 grid gap-3" onSubmit={signIn}>
            <Input label={t("Nombre", "Name")} value={draft.name} onChange={(value) => setDraft((current) => ({ ...current, name: value }))} placeholder={t("Nombre", "Name")} />
            <Input label={t("Email", "Email")} value={draft.email} onChange={(value) => setDraft((current) => ({ ...current, email: value }))} placeholder="tu@email.com" />
            <details className="rounded-2xl bg-[var(--surface-soft)] p-3">
              <summary className="cursor-pointer select-none text-xs font-bold uppercase tracking-[0.16em] text-[var(--text-muted)]">{t("Ajustar preferencias", "Adjust preferences")}</summary>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Input label={t("Idioma", "Language")} value={draft.locale} onChange={(value) => setDraft((current) => ({ ...current, locale: value }))} placeholder="es-DO" />
                <Input label={t("Zona horaria", "Time zone")} value={draft.timezone} onChange={(value) => setDraft((current) => ({ ...current, timezone: value }))} placeholder="America/Santo_Domingo" />
              </div>
            </details>
            <button className="rounded-2xl bg-[var(--lime)] px-5 py-3 text-sm font-bold text-[var(--ink)]" type="submit">
              {state.user.status === "signed_in" ? t("Actualizar sesión", "Update session") : t("Iniciar sesión local", "Sign in locally")}
            </button>
          </form>
          {state.user.status === "signed_in" && (
            <button className="mt-3 w-full rounded-2xl bg-white px-5 py-3 text-sm font-bold text-[var(--danger)]" onClick={signOut} type="button">
              {t("Cerrar sesión local", "Sign out locally")}
            </button>
          )}
        </Card>
      )}

      <Card>
        <h3 className="serif text-xl font-bold">{t("Permisos activos", "Active permissions")}</h3>
        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Metric label={t("Estado", "Status")} value={sessionActive ? t("Activa", "Active") : t("Anónima", "Anonymous")} tone={sessionActive ? "good" : "bad"} />
          <Metric label={t("Rol actual", "Current role")} value={roleLabel(authed ? "owner" : member?.role ?? "viewer")} />
        </div>
        {!convexConfigured && (
          <div className="mt-6">
            <Select label={t("Ver como", "View as")} value={state.user.currentMemberId} options={state.members.map((item) => item.id)} render={(id) => {
              const option = state.members.find((item) => item.id === id);
              return option ? `${option.name} - ${roleLabel(option.role)}` : id;
            }} onChange={switchMember} />
          </div>
        )}
      </Card>
    </ViewShell>
  );
}

function SettingsView({
  state,
  setState,
  convexConfigured,
  onResetLocal,
  entitlement,
  onOpenPaywall,
}: {
  state: AppState;
  setState: Dispatch<SetStateAction<AppState>>;
  convexConfigured: boolean;
  onResetLocal: () => void;
  entitlement: EntitlementView | null;
  onOpenPaywall: () => void;
}) {
  const { t } = useT();
  // Whether the account may actually use paid AI. Server value is authoritative when present;
  // otherwise advisory plan check. Turning "IA activa" ON when this is false routes to the paywall
  // instead of silently enabling a feature the user can't use.
  const canUseAi = entitlement ? entitlement.canUseAi : state.subscription.plan === "pro";
  const [mergeDraft, setMergeDraft] = useState({
    fromCategoryId: "",
    toCategoryId: "",
  });
  // Draft for a NEW merchant alias (raw legal name -> short nickname). Existing aliases are
  // edited inline against state.merchantAliases. Secondary/collapsed UI; optional + additive.
  const [aliasDraft, setAliasDraft] = useState({ raw: "", alias: "" });

  // ── Edit-in-modal UI state ──────────────────────────────────────────────
  // Categories: one is edited at a time inside a Modal. `editingCategoryId === "new"`
  // means the "Nueva categoría" create flow; any other id edits that existing category.
  // `categoryForm` is the working copy committed only on Guardar.
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [categoryForm, setCategoryForm] = useState({
    group: "discretionary" as GroupKey,
    name: "",
    subcategories: "",
    planned: "",
  });
  // Merchant alias edit: index of the alias being edited, or "new" for the create flow.
  const [editingAlias, setEditingAlias] = useState<number | "new" | null>(null);
  // Destructive confirm modal for "Borrar datos" (consolidates clear AI history + reset local).
  const [confirmClear, setConfirmClear] = useState(false);
  // Base-currency change: confirm + convert, never silently re-label. Holds the pending target
  // and its quoted rate while the confirm Modal is open; `currencyBusy` covers the rate fetch.
  const [currencyChange, setCurrencyChange] = useState<{
    to: CurrencyCode;
    rate: number;
    date: string;
    source: "api" | "manual" | "same_currency";
  } | null>(null);
  const [currencyBusy, setCurrencyBusy] = useState(false);

  async function requestCurrencyChange(to: CurrencyCode) {
    if (to === state.currency) return;
    setCurrencyBusy(true);
    try {
      const quote = await quoteExchangeRate(state.currency, to);
      setCurrencyChange({ to, rate: quote.rate, date: quote.date, source: quote.source });
    } finally {
      setCurrencyBusy(false);
    }
  }

  function applyCurrencyChange() {
    if (!currencyChange) return;
    const { to, rate, date } = currencyChange;
    setState((current) => rebaseCurrency(current, to, rate, date));
    setCurrencyChange(null);
  }

  function openNewCategory() {
    setCategoryForm({ group: "discretionary", name: "", subcategories: "", planned: "" });
    setEditingCategoryId("new");
  }

  function openEditCategory(category: AppState["categories"][number]) {
    setCategoryForm({
      group: category.group,
      name: category.name,
      subcategories: category.subcategories.join(", "),
      planned: (category.plannedCents / 100).toString(),
    });
    setEditingCategoryId(category.id);
  }

  // Commit the category Modal: create when id === "new", otherwise patch the existing one.
  // Reuses the same shape the old inline create/edit used so nothing downstream changes.
  function saveCategoryForm() {
    const name = categoryForm.name.trim();
    if (!name) return;
    const subcategories = categoryForm.subcategories
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    const plannedCents = toCents(categoryForm.planned);

    if (editingCategoryId === "new") {
      // Unique id generated in a click handler (saveCategoryForm runs on Guardar, never in render).
      // eslint-disable-next-line react-hooks/purity
      const id = `${slugify(name)}-${Date.now()}`;
      setState((current) => ({
        ...current,
        categories: [
          ...current.categories,
          { id, group: categoryForm.group, name, subcategories, plannedCents, source: "user" },
        ],
        monthlyPlans: [
          ...current.monthlyPlans,
          {
            id: monthlyPlanId(current.activeMonth, id),
            month: current.activeMonth,
            categoryId: id,
            plannedCents,
            rolloverCents: 0,
          },
        ],
      }));
    } else if (editingCategoryId) {
      updateCategory(editingCategoryId, { group: categoryForm.group, name, subcategories, plannedCents });
    }
    setEditingCategoryId(null);
  }

  function addMerchantAlias(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const raw = aliasDraft.raw.trim();
    const alias = aliasDraft.alias.trim();
    if (!raw || !alias) return;
    setState((current) => {
      const existing = current.merchantAliases ?? [];
      // Replace an alias for the same raw name (case-insensitive) instead of duplicating it.
      const lowered = raw.toLowerCase();
      const without = existing.filter((entry) => entry.raw.trim().toLowerCase() !== lowered);
      return { ...current, merchantAliases: [...without, { raw, alias }] };
    });
    setAliasDraft({ raw: "", alias: "" });
  }

  function updateMerchantAlias(index: number, patch: Partial<{ raw: string; alias: string }>) {
    setState((current) => {
      const existing = current.merchantAliases ?? [];
      const next = existing.map((entry, i) => (i === index ? { ...entry, ...patch } : entry));
      return { ...current, merchantAliases: next };
    });
  }

  function deleteMerchantAlias(index: number) {
    setState((current) => {
      const existing = current.merchantAliases ?? [];
      const next = existing.filter((_, i) => i !== index);
      return { ...current, merchantAliases: next.length ? next : undefined };
    });
  }

  function updateCategory(id: string, patch: Partial<AppState["categories"][number]>) {
    setState((current) => ({
      ...current,
      categories: current.categories.map((category) => category.id === id ? { ...category, ...patch } : category),
    }));
  }

  function deleteCategory(id: string) {
    setState((current) => {
      const inUse = current.transactions.some((transaction) => transaction.categoryId === id || transaction.splits?.some((split) => split.categoryId === id)) || current.recurringRules.some((rule) => rule.categoryId === id) || current.automationRules.some((rule) => rule.categoryId === id);
      if (inUse) return current;
      return {
        ...current,
        categories: current.categories.filter((category) => category.id !== id),
        monthlyPlans: current.monthlyPlans.filter((plan) => plan.categoryId !== id),
      };
    });
  }

  function archiveCategory(id: string) {
    setState((current) => ({
      ...current,
      categories: current.categories.map((category) => category.id === id ? { ...category, archived: !category.archived } : category),
    }));
  }

  function mergeCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mergeDraft.fromCategoryId || !mergeDraft.toCategoryId || mergeDraft.fromCategoryId === mergeDraft.toCategoryId) return;

    setState((current) => {
      const from = current.categories.find((category) => category.id === mergeDraft.fromCategoryId);
      const to = current.categories.find((category) => category.id === mergeDraft.toCategoryId);
      if (!from || !to || from.group !== to.group) return current;
      const mergedPlans = mergeMonthlyPlans(current.monthlyPlans, from.id, to.id);

      return {
        ...current,
        categories: current.categories.map((category) => {
          if (category.id === to.id) {
            return {
              ...category,
              subcategories: Array.from(new Set([...category.subcategories, ...from.subcategories])),
              plannedCents: category.plannedCents + from.plannedCents,
            };
          }
          if (category.id === from.id) {
            return { ...category, plannedCents: 0, archived: true };
          }
          return category;
        }),
        monthlyPlans: mergedPlans,
        transactions: current.transactions.map((transaction) => ({
          ...transaction,
          categoryId: transaction.categoryId === from.id ? to.id : transaction.categoryId,
          splits: transaction.splits?.map((split) => split.categoryId === from.id ? { ...split, categoryId: to.id } : split),
          audit: transaction.categoryId === from.id || transaction.splits?.some((split) => split.categoryId === from.id)
            ? [...(transaction.audit ?? []), movementAudit("edited", `${t("Categoria fusionada:", "Category merged:")} ${from.name} -> ${to.name}.`, current.user.name || "RindoMes")]
            : transaction.audit,
        })),
        recurringRules: current.recurringRules.map((rule) => rule.categoryId === from.id ? { ...rule, categoryId: to.id } : rule),
        automationRules: current.automationRules.map((rule) => rule.categoryId === from.id ? { ...rule, categoryId: to.id } : rule),
        review: current.review.map((item) => item.title === from.name ? { ...item, title: to.name } : item),
      };
    });
    setMergeDraft({ fromCategoryId: "", toCategoryId: "" });
  }

  function clearAiHistory() {
    setState((current) => ({
      ...current,
      aiActions: [],
      subscription: { ...current.subscription, aiCreditsUsed: 0 },
    }));
  }

  function exportPrivacyJson() {
    const payload = {
      user: state.user,
      householdName: state.householdName,
      spaces: state.spaces,
      members: state.members,
      aiSettings: state.aiSettings,
      aiActions: state.aiActions,
      notificationSettings: state.notificationSettings,
      exportedAt: new Date().toISOString(),
    };
    downloadText(`rindomes-privacidad-${state.activeMonth}.json`, JSON.stringify(payload, null, 2), "application/json;charset=utf-8");
  }

  // Categories that can receive a merge from `from` (same group, not itself, not archived).
  const mergeTargetsFor = (from: AppState["categories"][number]) =>
    state.categories.filter((category) => category.id !== from.id && !category.archived && category.group === from.group);
  const editingCategory = editingCategoryId && editingCategoryId !== "new"
    ? state.categories.find((category) => category.id === editingCategoryId)
    : null;
  const mergeTargets = editingCategory ? mergeTargetsFor(editingCategory) : [];
  // Notifications split: 4 that matter most up front, the rest behind "Más notificaciones".
  const keyNotifications: NotificationKind[] = ["daily_capture", "budget_risk", "month_close", "receipts"];
  const restNotifications = (Object.keys(notificationLabels) as NotificationKind[]).filter((kind) => !keyNotifications.includes(kind));
  const notificationCopy = (kind: NotificationKind) => t(notificationLabels[kind], { daily_capture: "Log daily spending", recurring: "Recurring due", budget_risk: "Category at risk", month_close: "Month-end close", balance_confirm: "Confirm balances", debt_payment: "Debt payment", goal_progress: "Savings goal", movement_review: "Transaction pending", receipts: "Receipts and attachments" }[kind]);
  const notificationToggle = (kind: NotificationKind) => (
    <label className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface-soft)] p-4 text-sm font-semibold" key={kind}>
      <span>{notificationCopy(kind)}</span>
      <input
        checked={state.notificationSettings[kind] ?? true}
        onChange={(event) => setState((current) => ({
          ...current,
          notificationSettings: { ...current.notificationSettings, [kind]: event.target.checked },
        }))}
        type="checkbox"
      />
    </label>
  );

  return (
    <ViewShell title={t("Ajustes y preferencias", "Settings & preferences")} eyebrow={t("Control del hogar", "Household controls")} description={t("Moneda, modo financiero, IA opcional y permisos no deben estar escondidos.", "Currency, financial mode, optional AI, and permissions shouldn't be hidden away.")}>
      {/* Modo financiero — foundational choice, its own labeled block */}
      <Card>
        <h3 className="serif text-xl font-bold">{t("Modo financiero", "Financial mode")}</h3>
        <p className="mt-2 text-sm text-[var(--text-muted)]">{t("Cómo prefieres llevar tus finanzas. Lo eliges una vez.", "How you prefer to manage your money. You choose this once.")}</p>
        <div className="mt-5">
          <Select label={t("Modo", "Mode")} value={state.mode} options={["tracker", "monthly-plan", "zero"]} render={(value) => t(modeLabels[value as Mode], { tracker: "Tracking", "monthly-plan": "Monthly plan", zero: "Envelopes / zero-based" }[value as Mode])} onChange={(value) => setState((current) => ({ ...current, mode: value as Mode }))} />
        </div>
      </Card>

      {/* Moneda base — secondary data config, separated from the mode */}
      <Card>
        <h3 className="serif text-xl font-bold">{t("Moneda base", "Base currency")}</h3>
        <p className="mt-2 text-sm text-[var(--text-muted)]">{t("La moneda de tu hogar para totales y reportes. Cada cuenta conserva su propia moneda.", "Your household's home currency for totals and reports. Each account keeps its own currency.")}</p>
        <div className="mt-5">
          <Select label={t("Moneda", "Currency")} value={state.currency} options={supportedCurrencies} render={currencyLabel} onChange={(value) => requestCurrencyChange(value as CurrencyCode)} />
          {currencyBusy && <p className="mt-2 text-xs text-[var(--text-muted)]">{t("Buscando la tasa de cambio…", "Fetching the exchange rate…")}</p>}
        </div>
      </Card>

      {/* Categorías — compact list, edit one at a time in a Modal */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="serif text-xl font-bold">{t("Categorias del hogar", "Household categories")}</h3>
            <p className="mt-1 text-sm text-[var(--text-muted)]">{t("Toca una para editarla.", "Tap one to edit it.")}</p>
          </div>
          <button className="flex shrink-0 items-center gap-2 rounded-2xl bg-[var(--lime)] px-5 py-3 text-sm font-bold text-[var(--ink)]" onClick={openNewCategory} type="button">
            <Plus className="h-4 w-4" />
            {t("Nueva categoría", "New category")}
          </button>
        </div>
        <div className="mt-5 grid gap-2.5">
          {state.categories.map((category) => {
            const usageCount = state.transactions.filter((transaction) => transaction.categoryId === category.id || transaction.splits?.some((split) => split.categoryId === category.id)).length;
            const ruleCount = state.recurringRules.filter((rule) => rule.categoryId === category.id).length + state.automationRules.filter((rule) => rule.categoryId === category.id).length;
            const canDelete = usageCount === 0 && ruleCount === 0;
            const groupLabel = groups.find((group) => group.key === category.group)?.label ?? category.group;
            const menu: RowMenuItem[] = [
              { label: t("Editar", "Edit"), onClick: () => openEditCategory(category) },
              { label: category.archived ? t("Reactivar", "Reactivate") : t("Archivar", "Archive"), onClick: () => archiveCategory(category.id) },
            ];
            if (mergeTargetsFor(category).length > 0) {
              menu.push({ label: t("Fusionar", "Merge"), onClick: () => openEditCategory(category) });
            }
            if (canDelete) {
              menu.push({ label: t("Eliminar", "Delete"), danger: true, onClick: () => deleteCategory(category.id) });
            }
            return (
              <div className={category.archived ? "opacity-70" : ""} key={category.id}>
                <CompactRow
                  icon={<WalletCards className="h-5 w-5" />}
                  label={category.name}
                  sublabel={t(`${groupLabel} · ${usageCount} mov · ${ruleCount} reglas`, `${groupLabel} · ${usageCount} mov · ${ruleCount} rules`)}
                  value={formatMoney(category.plannedCents, state.currency)}
                  onClick={() => openEditCategory(category)}
                  menu={menu}
                />
              </div>
            );
          })}
        </div>
      </Card>

      {/* IA opcional — provider + active by default; advanced toggles behind "Avanzado" */}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <Bot className="h-5 w-5 text-[var(--primary)]" />
            <div>
              <h3 className="font-semibold">{t("IA opcional", "Optional AI")}</h3>
              <p className="text-sm text-[var(--text-muted)]">{t("Sugiere categorías y detecta desviaciones.", "Suggests categories and flags deviations.")}</p>
            </div>
          </div>
          <span className="rounded-full bg-white px-4 py-2 text-xs font-bold">{t(`${state.subscription.aiCreditsUsed}/${state.subscription.aiCreditsLimit} creditos`, `${state.subscription.aiCreditsUsed}/${state.subscription.aiCreditsLimit} credits`)}</span>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          <Select label={t("Proveedor IA", "AI provider")} value={state.aiSettings.provider} options={["local", "openai", "byok"]} render={(value) => value === "local" ? t("Reglas locales (sin internet)", "Local rules (no internet)") : value === "openai" ? t("IA incluida (con tu plan)", "Included AI (with your plan)") : t("Tu propia API key", "Bring your own key")} onChange={(value) => setState((current) => ({ ...current, aiSettings: { ...current.aiSettings, provider: value as AiProvider } }))} />
          <label className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface-soft)] p-4 text-sm font-semibold">
            <span>{t("IA activa", "AI active")}</span>
            <input
              checked={state.aiSettings.enabled}
              onChange={(event) => {
                // Turning AI ON when the account is not entitled routes to the paywall instead of
                // silently enabling a paid feature. Turning it OFF always works (it's a preference).
                if (event.target.checked && !canUseAi) {
                  onOpenPaywall();
                  return;
                }
                setState((current) => ({ ...current, aiSettings: { ...current.aiSettings, enabled: event.target.checked } }));
              }}
              type="checkbox"
            />
          </label>
        </div>
        <details className="group mt-3">
          <summary className="flex cursor-pointer select-none items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-[var(--primary)] list-none">
            {t("Avanzado", "Advanced")}
            <ChevronDown className="h-4 w-4 transition group-open:rotate-180" />
          </summary>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <label className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface-soft)] p-4 text-sm font-semibold">
              <span>{t("Guardar historial IA", "Save AI history")}</span>
              <input checked={state.aiSettings.saveHistory} onChange={(event) => setState((current) => ({ ...current, aiSettings: { ...current.aiSettings, saveHistory: event.target.checked } }))} type="checkbox" />
            </label>
            <label className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface-soft)] p-4 text-sm font-semibold">
              <span>{t("Permitir texto de recibos", "Allow receipt text")}</span>
              <input checked={state.aiSettings.allowReceiptText} onChange={(event) => setState((current) => ({ ...current, aiSettings: { ...current.aiSettings, allowReceiptText: event.target.checked } }))} type="checkbox" />
            </label>
          </div>
        </details>
        {!canUseAi && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[rgba(80,102,0,0.18)] bg-[rgba(204,255,0,0.08)] px-4 py-3 text-sm text-[var(--foreground)]">
            <span>{t("La lectura con IA es parte de RindoMes Pro. La captura manual y las reglas locales (gratis) siempre están disponibles.", "AI reading is part of RindoMes Pro. Manual capture and local rules (free) are always available.")}</span>
            <button className="shrink-0 rounded-full bg-[var(--lime)] px-4 py-2 text-xs font-bold text-black" onClick={onOpenPaywall} type="button">
              {t("Activar Pro", "Upgrade to Pro")}
            </button>
          </div>
        )}
      </Card>

      {/* Notificaciones — 4 key up front, the rest behind a disclosure */}
      <Card>
        <div className="flex items-center gap-3">
          <Bell className="h-5 w-5 text-[var(--primary)]" />
          <h3 className="serif text-xl font-bold">{t("Notificaciones", "Notifications")}</h3>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {keyNotifications.map((kind) => notificationToggle(kind))}
        </div>
        <details className="group mt-3">
          <summary className="flex cursor-pointer select-none items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-[var(--primary)] list-none">
            {t("Más notificaciones", "More notifications")}
            <ChevronDown className="h-4 w-4 transition group-open:rotate-180" />
          </summary>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {restNotifications.map((kind) => notificationToggle(kind))}
          </div>
        </details>
      </Card>

      {/* Apodos de comercio — compact list inside a disclosure, edit one in a Modal */}
      <Card>
        <details className="group">
          <summary className="flex cursor-pointer select-none items-center justify-between gap-3 list-none">
            <div>
              <h3 className="serif text-xl font-bold">{t("Apodos de comercio", "Merchant nicknames")}</h3>
              <p className="mt-2 text-sm text-[var(--text-muted)]">{t("Muestra un nombre corto en lugar del nombre largo del recibo o del banco.", "Show a short name instead of the long one from the receipt or bank.")}</p>
            </div>
            <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-[var(--primary)]">
              {state.merchantAliases?.length ? t(`${state.merchantAliases.length} apodo(s)`, `${state.merchantAliases.length} nickname(s)`) : t("Ninguno", "None")}
              <ChevronDown className="h-4 w-4 transition group-open:rotate-180" />
            </span>
          </summary>
          <div className="mt-5 grid gap-3">
            <button className="flex w-fit items-center gap-2 rounded-2xl bg-[var(--lime)] px-5 py-3 text-sm font-bold text-[var(--ink)]" onClick={() => { setAliasDraft({ raw: "", alias: "" }); setEditingAlias("new"); }} type="button">
              <Plus className="h-4 w-4" />
              {t("Nuevo apodo", "New nickname")}
            </button>
            {state.merchantAliases?.length ? (
              <div className="grid gap-2.5">
                {state.merchantAliases.map((alias, index) => (
                  <CompactRow
                    key={`${alias.raw}-${index}`}
                    icon={<Building2 className="h-5 w-5" />}
                    label={alias.alias}
                    sublabel={alias.raw}
                    onClick={() => { setAliasDraft({ raw: alias.raw, alias: alias.alias }); setEditingAlias(index); }}
                    menu={[
                      { label: t("Editar", "Edit"), onClick: () => { setAliasDraft({ raw: alias.raw, alias: alias.alias }); setEditingAlias(index); } },
                      { label: t("Eliminar", "Delete"), danger: true, onClick: () => deleteMerchantAlias(index) },
                    ]}
                  />
                ))}
              </div>
            ) : (
              <p className="rounded-2xl border border-dashed border-[var(--line)] bg-[var(--surface-soft)] p-4 text-sm text-[var(--text-muted)]">
                {t("Aún no tienes apodos. Añade uno para que los movimientos muestren un nombre limpio.", "You don't have any nicknames yet. Add one so transactions show a clean name.")}
              </p>
            )}
          </div>
        </details>
      </Card>

      {/* Sincronización en la nube — status badge + one sentence */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-semibold">{t("Sincronización en la nube", "Cloud sync")}</h3>
          <span className={`inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-bold ${convexConfigured ? "bg-[rgba(204,255,0,0.18)] text-[var(--primary)]" : "bg-white text-[var(--text-muted)]"}`}>
            <span className={`h-2 w-2 rounded-full ${convexConfigured ? "bg-[var(--primary)]" : "bg-[var(--text-subtle)]"}`} />
            {convexConfigured ? t("Sync activo", "Sync on") : t("Modo local", "Local mode")}
          </span>
        </div>
        <p className="mt-2 text-sm text-[var(--text-muted)]">
          {convexConfigured
            ? t("Tus cambios se guardan solos y aparecen en todos tus dispositivos al iniciar sesión.", "Your changes save automatically and appear on all your devices when you sign in.")
            : t("Por ahora los cambios se guardan solo en este navegador.", "For now, changes are saved only in this browser.")}
        </p>
      </Card>

      {/* Privacidad y datos — safe export prominent; one destructive action with confirm */}
      <Card>
        <h3 className="serif text-xl font-bold">{t("Privacidad y datos", "Privacy & data")}</h3>
        <p className="mt-2 text-sm text-[var(--text-muted)]">{t("Descarga o elimina tus datos en cualquier momento.", "Download or delete your data anytime.")}</p>
        <div className="mt-5 flex flex-wrap gap-3">
          <button className="flex items-center gap-2 rounded-2xl bg-[var(--lime)] px-5 py-3 text-sm font-bold text-[var(--ink)]" onClick={exportPrivacyJson} type="button">
            <Download className="h-4 w-4" />
            {t("Exportar mis datos", "Export my data")}
          </button>
          <button className="rounded-2xl bg-red-50 px-5 py-3 text-sm font-bold text-[var(--danger)]" onClick={() => setConfirmClear(true)} type="button">{t("Borrar datos", "Delete data")}</button>
        </div>
      </Card>

      {/* ── Modals ──────────────────────────────────────────────────────── */}

      {/* Edit / create category */}
      <Modal
        open={editingCategoryId !== null}
        onClose={() => setEditingCategoryId(null)}
        title={editingCategoryId === "new" ? t("Nueva categoría", "New category") : t("Editar categoría", "Edit category")}
        footer={
          <>
            <button className="rounded-2xl border border-[var(--line)] bg-white px-5 py-3 text-sm font-bold" onClick={() => setEditingCategoryId(null)} type="button">{t("Cancelar", "Cancel")}</button>
            <button className="rounded-2xl bg-[var(--lime)] px-5 py-3 text-sm font-bold text-[var(--ink)] is-disabled" disabled={!categoryForm.name.trim()} onClick={saveCategoryForm} type="button">{t("Guardar", "Save")}</button>
          </>
        }
      >
        <div className="grid gap-4">
          <Input label={t("Nombre", "Name")} value={categoryForm.name} onChange={(value) => setCategoryForm((current) => ({ ...current, name: value }))} placeholder={t("Ej. Mascotas, Colegio, Salud", "E.g. Pets, School, Health")} />
          <Input label={t("Plan base", "Base plan")} value={categoryForm.planned} onChange={(value) => setCategoryForm((current) => ({ ...current, planned: value }))} placeholder="0.00" />
          <details className="group">
            <summary className="flex cursor-pointer select-none items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-[var(--primary)] list-none">
              {t("Más opciones", "More options")}
              <ChevronDown className="h-4 w-4 transition group-open:rotate-180" />
            </summary>
            <div className="mt-3 grid gap-4">
              <Select label={t("Grupo", "Group")} value={categoryForm.group} options={groups.map((group) => group.key)} render={(value) => groups.find((group) => group.key === value)?.label ?? value} onChange={(value) => setCategoryForm((current) => ({ ...current, group: value as GroupKey }))} />
              <Input label={t("Subcategorias", "Subcategories")} value={categoryForm.subcategories} onChange={(value) => setCategoryForm((current) => ({ ...current, subcategories: value }))} placeholder={t("Separadas por coma", "Comma-separated")} />
            </div>
          </details>
          {editingCategory && mergeTargets.length > 0 && (
            <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-soft)] p-4">
              <p className="text-sm font-bold text-[var(--foreground)]">{t("Fusionar con otra", "Merge into another")}</p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">{t("Mueve sus movimientos y plan a otra categoría del mismo grupo.", "Move its transactions and plan into another category of the same group.")}</p>
              <form className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end" onSubmit={(event) => { mergeCategory(event); setEditingCategoryId(null); }}>
                <Select label={t("Fusionar hacia", "Merge into")} value={mergeDraft.toCategoryId} options={["", ...mergeTargets.map((category) => category.id)]} render={(id) => categoryById(state.categories, id)?.name ?? t("Elegir destino", "Choose destination")} onChange={(value) => setMergeDraft({ fromCategoryId: editingCategory.id, toCategoryId: value })} />
                <button className="rounded-2xl border border-[var(--line)] bg-white px-5 py-3 text-sm font-bold text-[var(--primary)] disabled:opacity-50" disabled={!mergeDraft.toCategoryId} type="submit">{t("Fusionar", "Merge")}</button>
              </form>
            </div>
          )}
        </div>
      </Modal>

      {/* Edit / create merchant nickname */}
      <Modal
        open={editingAlias !== null}
        onClose={() => setEditingAlias(null)}
        title={editingAlias === "new" ? t("Nuevo apodo", "New nickname") : t("Editar apodo", "Edit nickname")}
      >
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            const raw = aliasDraft.raw.trim();
            const alias = aliasDraft.alias.trim();
            if (!raw || !alias) return;
            if (editingAlias === "new") {
              // Reuse the existing add handler so dedup/replace logic stays in one place.
              addMerchantAlias(event);
            } else if (typeof editingAlias === "number") {
              updateMerchantAlias(editingAlias, { raw, alias });
            }
            setEditingAlias(null);
          }}
        >
          <Input label={t("Nombre en el recibo", "Name on the receipt")} value={aliasDraft.raw} onChange={(value) => setAliasDraft((current) => ({ ...current, raw: value }))} placeholder={t("Ej. SUPERMERCADO NACIONAL SRL", "E.g. SUPERMERCADO NACIONAL SRL")} />
          <Input label={t("Apodo corto", "Short nickname")} value={aliasDraft.alias} onChange={(value) => setAliasDraft((current) => ({ ...current, alias: value }))} placeholder={t("Ej. Nacional", "E.g. Nacional")} />
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button className="rounded-2xl border border-[var(--line)] bg-white px-5 py-3 text-sm font-bold" onClick={() => setEditingAlias(null)} type="button">{t("Cancelar", "Cancel")}</button>
            <button className="rounded-2xl bg-[var(--lime)] px-5 py-3 text-sm font-bold text-[var(--ink)] is-disabled" disabled={!aliasDraft.raw.trim() || !aliasDraft.alias.trim()} type="submit">{t("Guardar", "Save")}</button>
          </div>
        </form>
      </Modal>

      {/* Destructive confirm: clear data */}
      <Modal
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        title={t("Borrar datos", "Delete data")}
        footer={
          <>
            <button className="rounded-2xl border border-[var(--line)] bg-white px-5 py-3 text-sm font-bold" onClick={() => setConfirmClear(false)} type="button">{t("Cancelar", "Cancel")}</button>
            <button className="rounded-2xl bg-red-50 px-5 py-3 text-sm font-bold text-[var(--danger)]" onClick={() => { setConfirmClear(false); onResetLocal(); }} type="button">{t("Borrar todo", "Delete everything")}</button>
          </>
        }
      >
        <div className="grid gap-4">
          <div className="flex items-start gap-3 rounded-2xl bg-red-50 p-4 text-sm text-[var(--danger)]">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <p>{t("Esto borra todos los datos de este navegador y reinicia la configuración. No se puede deshacer.", "This erases all data in this browser and restarts setup. It can't be undone.")}</p>
          </div>
          <button className="rounded-2xl border border-[var(--line)] bg-white px-5 py-3 text-sm font-bold" onClick={() => { setConfirmClear(false); clearAiHistory(); }} type="button">{t("Solo borrar historial IA", "Only clear AI history")}</button>
        </div>
      </Modal>

      {/* Confirm base-currency change: show the rate + what converts, then rebase amounts. */}
      <Modal
        open={currencyChange !== null}
        onClose={() => setCurrencyChange(null)}
        title={t("Cambiar moneda base", "Change base currency")}
        footer={
          <>
            <button className="rounded-2xl border border-[var(--line)] bg-white px-5 py-3 text-sm font-bold" onClick={() => setCurrencyChange(null)} type="button">{t("Cancelar", "Cancel")}</button>
            <button className="rounded-2xl bg-[var(--lime)] px-5 py-3 text-sm font-bold text-[var(--ink)]" onClick={applyCurrencyChange} type="button">{t("Convertir", "Convert")}</button>
          </>
        }
      >
        {currencyChange && (
          <div className="grid gap-4 text-sm text-[var(--foreground)]">
            <p>
              {t(
                `Cambiarás la moneda de tu hogar de ${currencyLabel(state.currency)} a ${currencyLabel(currencyChange.to)}.`,
                `You're changing your household currency from ${currencyLabel(state.currency)} to ${currencyLabel(currencyChange.to)}.`,
              )}
            </p>
            <div className="rounded-2xl bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-subtle)]">{t("Tasa de cambio", "Exchange rate")}</p>
              <p className="serif mt-1 text-lg font-bold">{`1 ${state.currency} = ${Number(currencyChange.rate.toPrecision(4))} ${currencyChange.to}`}</p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                {currencyChange.source === "api"
                  ? t(`Tasa de mercado del ${currencyChange.date}.`, `Market rate as of ${currencyChange.date}.`)
                  : t("Tasa de referencia (sin conexión). Puedes ajustar montos luego si hace falta.", "Reference rate (offline). You can adjust amounts later if needed.")}
              </p>
            </div>
            <p>
              {t(
                "Convertiremos tus totales: movimientos, presupuestos, metas, deudas y patrimonio. Tus cuentas conservan su propia moneda y los montos originales de cada movimiento no cambian.",
                "We'll convert your totals: transactions, budgets, goals, debts and net worth. Your accounts keep their own currency and each movement's original amount stays the same.",
              )}
            </p>
          </div>
        )}
      </Modal>
    </ViewShell>
  );
}

interface TextImportPreview {
  transactions: Transaction[];
  reviewItems: AppState["review"];
  warnings: string[];
  rowsRead: number;
  incomeCents: number;
  outflowCents: number;
}

function parseTextTransactions(input: string, state: AppState): TextImportPreview {
  const lines = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) {
    return { transactions: [], reviewItems: [], warnings: ["No hay filas para importar."], rowsRead: 0, incomeCents: 0, outflowCents: 0 };
  }

  const firstColumns = splitDelimitedLine(lines[0]);
  const hasHeader = firstColumns.some((cell) => ["fecha", "date", "descripcion", "description", "monto", "amount"].includes(normalizeImportKey(cell)));
  const headers = hasHeader ? firstColumns.map(normalizeImportKey) : ["fecha", "descripcion", "monto", "categoria", "cuenta", "comercio", "tags", "tipo", "moneda"];
  const dataLines = hasHeader ? lines.slice(1) : lines;
  const warnings: string[] = [];
  const transactions: Transaction[] = [];
  const reviewItems: AppState["review"] = [];
  const fallbackExpenseCategory = state.categories.find((category) => category.group !== "income") ?? state.categories[0];
  const fallbackIncomeCategory = state.categories.find((category) => category.group === "income") ?? fallbackExpenseCategory;
  const fallbackAccount = state.accounts[0];

  dataLines.forEach((line, index) => {
    const values = splitDelimitedLine(line);
    const row = Object.fromEntries(headers.map((header, headerIndex) => [header, values[headerIndex]?.trim() ?? ""]));
    const rawAmount = row.monto || row.amount || row.importe || row.valor;
    const amountValue = toCents(rawAmount);
    if (!rawAmount || amountValue === 0) {
      warnings.push(`Fila ${index + 1}: sin monto valido.`);
      return;
    }

    const rawType = normalizeImportKey(row.tipo || row.type);
    const type: TransactionType = rawType.includes("ingreso") || rawType === "income"
      ? "income"
      : rawType.includes("transfer") ? "transfer" : rawType.includes("reembolso") || rawType.includes("refund") ? "refund" : "expense";
    const amountCents = Math.abs(amountValue);
    const category = findImportCategory(row.categoria || row.category, state, type) ?? (type === "income" ? fallbackIncomeCategory : fallbackExpenseCategory);
    const account = findImportAccount(row.cuenta || row.account, state) ?? fallbackAccount;
    const date = normalizeImportDate(row.fecha || row.date, state.activeMonth);
    const id = `paste-${Date.now()}-${index}`;
    const needsReview = !findImportCategory(row.categoria || row.category, state, type) || !findImportAccount(row.cuenta || row.account, state);

    if (!category || !account) {
      warnings.push(`Fila ${index + 1}: faltan categorias o cuentas base para crear el movimiento.`);
      return;
    }

    const transaction: Transaction = {
      id,
      type,
      date,
      description: row.descripcion || row.description || row.detalle || row.nota || `${type === "income" ? "Ingreso" : "Gasto"} importado`,
      categoryId: category.id,
      subcategory: row.subcategoria || row.subcategory || category.subcategories[0] || "",
      accountId: account.id,
      transferAccountId: undefined,
      merchant: row.comercio || row.merchant || row.persona || row.person || "",
      tags: (row.tags || row.etiquetas || "pegado").split(/[;,]/).map((tag) => tag.trim()).filter(Boolean),
      note: row.nota || row.note || `Importado desde texto: ${line}`,
      originalAmountCents: amountCents,
      originalCurrency: currencyFromImport(row.moneda, state.currency),
      amountCents,
      baseCurrency: state.currency,
      exchangeRate: 1,
      exchangeRateDate: date,
      exchangeRateSource: "same_currency",
      status: needsReview ? "needs_review" : "approved",
      createdBy: state.user.name || "RindoMes",
      audit: [movementAudit("created", "Movimiento importado desde texto/CSV pegado.", state.user.name || "RindoMes")],
    };
    transactions.push(transaction);

    if (needsReview) {
      reviewItems.push({
        id: `review-${id}`,
        reason: "uncategorized",
        title: transaction.description,
        subtitle: "Importado desde texto con categoria o cuenta inferida.",
        amountCents: transaction.type === "income" ? transaction.amountCents : -transaction.amountCents,
        action: "Revisar",
        targetType: "transaction",
        targetId: id,
      });
    }
  });

  return {
    transactions,
    reviewItems,
    warnings,
    rowsRead: dataLines.length,
    incomeCents: transactions.filter((transaction) => transaction.type === "income").reduce((sum, transaction) => sum + transaction.amountCents, 0),
    outflowCents: transactions.filter((transaction) => transaction.type !== "income" && transaction.type !== "transfer" && transaction.type !== "refund").reduce((sum, transaction) => sum + transaction.amountCents, 0),
  };
}

function splitDelimitedLine(line: string) {
  const delimiter = line.includes("\t") ? "\t" : line.includes(";") ? ";" : ",";
  const cells: string[] = [];
  let current = "";
  let quoted = false;

  for (const char of line) {
    if (char === "\"") {
      quoted = !quoted;
      continue;
    }
    if (char === delimiter && !quoted) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function normalizeImportKey(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/(^_|_$)/g, "");
}

function findImportCategory(value: string, state: AppState, type: TransactionType) {
  const normalized = normalizeImportKey(value);
  if (!normalized) return undefined;
  const candidates = state.categories.filter((category) => type === "income" ? category.group === "income" : category.group !== "income");
  return candidates.find((category) => {
    const tokens = [category.name, ...category.subcategories].map(normalizeImportKey);
    return tokens.some((token) => token === normalized || token.includes(normalized) || normalized.includes(token));
  });
}

function findImportAccount(value: string, state: AppState) {
  const normalized = normalizeImportKey(value);
  if (!normalized) return undefined;
  return state.accounts.find((account) => {
    const token = normalizeImportKey(account.name);
    return token === normalized || token.includes(normalized) || normalized.includes(token);
  });
}

function currencyFromImport(value: string, fallback: CurrencyCode) {
  const normalized = value.trim().toUpperCase();
  return supportedCurrencies.includes(normalized as CurrencyCode) ? normalized as CurrencyCode : fallback;
}

function normalizeImportDate(value: string, activeMonth: string) {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const slash = trimmed.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/);
  if (slash) {
    const day = slash[1].padStart(2, "0");
    const month = slash[2].padStart(2, "0");
    const year = slash[3] ? slash[3].padStart(4, "20") : activeMonth.slice(0, 4);
    return `${year}-${month}-${day}`;
  }
  return `${activeMonth}-01`;
}

function ImportView({ state, setState }: { state: AppState; setState: Dispatch<SetStateAction<AppState>> }) {
  const { t } = useT();
  const { notify } = useToast();
  const [backupPreview, setBackupPreview] = useState<AppState | null>(null);
  const [pasteText, setPasteText] = useState("");
  const [textPreview, setTextPreview] = useState<TextImportPreview | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "applied" | "error">("idle");
  const [restoringBackup, setRestoringBackup] = useState(false);
  const [message, setMessage] = useState(t("Selecciona un respaldo JSON exportado desde RindoMes para restaurarlo.", "Select a JSON backup exported from RindoMes to restore it."));

  async function handleBackupFile(file?: File) {
    if (!file || restoringBackup) return;

    try {
      setStatus("loading");
      setMessage(t(`Leyendo ${file.name}...`, `Reading ${file.name}...`));
      const normalized = normalizeStoredState(JSON.parse(await file.text()));
      if (!normalized) throw new Error(t("Este archivo no es un respaldo de RindoMes.", "This file is not a RindoMes backup."));
      setBackupPreview(normalized);
      setStatus("ready");
      setMessage(t(
        `Respaldo leído: ${normalized.categories.length} categorías, ${normalized.transactions.length} movimientos, ${normalized.monthlyPlans.length} planes mensuales.`,
        `Backup read: ${normalized.categories.length} categories, ${normalized.transactions.length} transactions, ${normalized.monthlyPlans.length} monthly plans.`,
      ));
    } catch (error) {
      setBackupPreview(null);
      setStatus("error");
      setMessage(error instanceof Error ? error.message : t("No pude leer este archivo.", "I couldn't read this file."));
    }
  }

  async function applyBackup() {
    if (!backupPreview || restoringBackup) return;

    const backup = backupPreview;
    const transactionCount = backup.transactions.length;
    setRestoringBackup(true);
    setStatus("loading");
    setMessage(t("Restaurando respaldo...", "Restoring backup..."));
    await new Promise<void>((resolve) => window.setTimeout(resolve, 600));
    // The backup carries the household's finances; the session keeps its own identity,
    // plan, and member roster so restoring never signs you out or downgrades you.
    setState((current) => ({
      ...backup,
      user: current.user,
      subscription: current.subscription,
      members: current.members,
    }));
    setBackupPreview(null);
    setStatus("applied");
    setRestoringBackup(false);
    setMessage(t("Respaldo restaurado. El plan, los movimientos y las cuentas ahora salen del archivo.", "Backup restored. Your plan, transactions, and accounts now come from the file."));
    notify(t(`Respaldo restaurado: ${transactionCount} movimientos cargados.`, `Backup restored: ${transactionCount} transactions loaded.`), "success");
  }

  function previewTextImport() {
    const parsed = parseTextTransactions(pasteText, state);
    setTextPreview(parsed);
    setStatus(parsed.transactions.length ? "ready" : "error");
    setMessage(parsed.transactions.length
      ? t(`Texto listo: ${parsed.transactions.length} movimientos detectados de ${parsed.rowsRead} filas.`, `Text ready: ${parsed.transactions.length} transactions detected from ${parsed.rowsRead} rows.`)
      : parsed.warnings[0] ?? t("No pude detectar movimientos en el texto.", "I couldn't detect any transactions in the text."));
  }

  function applyTextImport() {
    if (!textPreview?.transactions.length) return;

    setState((current) => ({
      ...current,
      accounts: textPreview.transactions.reduce((accounts, transaction) => (
        transaction.status === "approved" ? applyAccountEffect(accounts, transaction, 1) : accounts
      ), current.accounts),
      transactions: [...textPreview.transactions, ...current.transactions],
      review: [...textPreview.reviewItems, ...current.review],
    }));
    setStatus("applied");
    setMessage(t(`Importados ${textPreview.transactions.length} movimientos pegados. ${textPreview.reviewItems.length} quedaron en revision.`, `Imported ${textPreview.transactions.length} pasted transactions. ${textPreview.reviewItems.length} left for review.`));
    notify(t(`Importados ${textPreview.transactions.length} movimientos pegados.`, `Imported ${textPreview.transactions.length} pasted transactions.`), "success");
  }

  return (
    <ViewShell title={t("Importacion de datos", "Data import")} eyebrow={t("Tus datos, de vuelta", "Your data, back in")} description={t("Restaura un respaldo completo de RindoMes o pega movimientos desde tu banco o una tabla.", "Restore a full RindoMes backup, or paste transactions from your bank or a table.")}>
      <Card>
        <div className="grid place-items-center rounded-3xl border border-dashed border-[var(--line)] bg-[var(--surface-soft)] p-10 text-center">
          <FileSpreadsheet className="h-12 w-12 text-[var(--primary)]" />
          <h3 className="serif mt-4 text-3xl font-bold">{t("Restaurar respaldo", "Restore backup")}</h3>
          <p className="mt-2 max-w-lg text-sm text-[var(--text-muted)]">{message}</p>
          <label className="mt-6 inline-flex cursor-pointer items-center rounded-full bg-[var(--lime)] px-6 py-3 font-semibold text-[var(--ink)]">
            <Download className="mr-2 inline h-4 w-4" />
            {status === "loading" ? t("Leyendo...", "Reading...") : t("Seleccionar archivo JSON", "Choose JSON file")}
            <input className="hidden" accept=".json,application/json" disabled={restoringBackup} type="file" onChange={(event) => void handleBackupFile(event.target.files?.[0])} />
          </label>
        </div>
      </Card>
      {backupPreview && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card>
            <Metric label={t("Categorias", "Categories")} value={String(backupPreview.categories.length)} />
          </Card>
          <Card>
            <Metric label={t("Movimientos", "Transactions")} value={String(backupPreview.transactions.length)} />
          </Card>
          <Card>
            <Metric label={t("Cuentas", "Accounts")} value={String(backupPreview.accounts.length)} />
          </Card>
          <Card className="lg:col-span-3">
            <div className="grid gap-5 lg:grid-cols-[1fr_auto] lg:items-center">
              <div>
                <h3 className="serif text-xl font-bold">{t("Vista previa del respaldo", "Backup preview")}</h3>
                <p className="mt-2 text-sm text-[var(--text-muted)]">
                  {t(
                    `Hogar "${backupPreview.householdName}" · moneda ${backupPreview.currency} · mes activo ${backupPreview.activeMonth} · ${backupPreview.monthlyPlans.length} planes mensuales. Restaurar reemplaza el plan, los movimientos y las cuentas actuales de este hogar.`,
                    `Household "${backupPreview.householdName}" · currency ${backupPreview.currency} · active month ${backupPreview.activeMonth} · ${backupPreview.monthlyPlans.length} monthly plans. Restoring replaces this household's current plan, transactions, and accounts.`,
                  )}
                </p>
              </div>
              <button className="rounded-2xl bg-[var(--lime)] px-6 py-4 font-bold text-[var(--ink)]" disabled={restoringBackup} onClick={() => void applyBackup()} type="button">
                {restoringBackup ? t("Restaurando...", "Restoring...") : t("Restaurar respaldo", "Restore backup")}
              </button>
            </div>
          </Card>
        </div>
      )}
      <Card>
        <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
          <div>
            <h3 className="serif text-xl font-bold">{t("Pegar CSV o texto tabular", "Paste CSV or tabular text")}</h3>
            <p className="mt-2 text-sm text-[var(--text-muted)]">{t("Acepta encabezados como fecha, descripcion, monto, categoria, cuenta, comercio, tags, tipo y moneda. Si falta categoria o cuenta exacta, el movimiento entra a revision.", "Accepts headers like date, description, amount, category, account, merchant, tags, type, and currency. If an exact category or account is missing, the transaction goes to review.")}</p>
            <textarea
              className="field mt-4 min-h-44 font-mono text-sm"
              onChange={(event) => setPasteText(event.target.value)}
              value={pasteText}
            />
            <div className="mt-4 flex flex-wrap gap-2">
              <button className="rounded-2xl bg-[var(--lime)] px-6 py-3 text-sm font-bold text-[var(--ink)]" onClick={previewTextImport} type="button">{t("Previsualizar texto", "Preview text")}</button>
              <button className="rounded-2xl border border-[var(--line)] bg-white px-6 py-3 text-sm font-bold is-disabled" disabled={!textPreview?.transactions.length} onClick={applyTextImport} type="button">{t("Aplicar texto", "Apply text")}</button>
            </div>
          </div>
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-soft)] p-4">
            <p className="kicker">{t("Resumen texto", "Text summary")}</p>
            {!textPreview && <p className="mt-3 text-sm text-[var(--text-muted)]">{t("Pega movimientos desde banco, notas o una tabla simple para ver la vista previa antes de tocar datos reales.", "Paste transactions from your bank, notes, or a simple table to preview before touching real data.")}</p>}
            {textPreview && (
              <div className="mt-4 grid gap-3">
                <Metric label={t("Movimientos", "Transactions")} value={String(textPreview.transactions.length)} />
                <Metric label={t("Ingresos", "Income")} value={formatMoney(textPreview.incomeCents, state.currency)} tone="good" />
                <Metric label={t("Egresos", "Spending")} value={formatMoney(textPreview.outflowCents, state.currency)} />
                <Metric label={t("A revision", "To review")} value={String(textPreview.reviewItems.length)} tone={textPreview.reviewItems.length ? "bad" : undefined} />
              </div>
            )}
          </div>
        </div>
        {textPreview && (
          <div className="mt-6 grid gap-3">
            {textPreview.warnings.slice(0, 4).map((warning) => (
              <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-semibold text-[var(--danger)]" key={warning}>{warning}</p>
            ))}
            <div className="overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface-soft)]">
              {textPreview.transactions.slice(0, 8).map((transaction) => (
                <div className="grid gap-2 border-b border-[var(--line)] p-4 last:border-b-0 sm:grid-cols-[1fr_auto] sm:items-center" key={transaction.id}>
                  <div>
                    <p className="font-bold">{transaction.description}</p>
                    <p className="text-sm text-[var(--text-muted)]">
                      {transaction.date} · {categoryById(state.categories, transaction.categoryId)?.name ?? t("Sin categoría", "No category")} · {state.accounts.find((account) => account.id === transaction.accountId)?.name ?? t("Cuenta", "Account")} · {transactionStatusLabel(transaction.status)}
                    </p>
                  </div>
                  <span className="serif text-2xl font-bold">{formatMoney(transaction.amountCents, transaction.originalCurrency)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>
    </ViewShell>
  );
}

function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`glass rounded-3xl p-6 ${className}`}>{children}</section>;
}

// ── Edit-in-modal primitives ───────────────────────────────────────────────
// Shared building blocks so every screen can show a compact list (one line per
// item) and edit ONE item at a time inside a Modal, instead of a wall of
// fully-expanded editable cards. See .rindomes-redesign-plan.json crossCutting.

type RowMenuItem = { label: string; onClick: () => void; danger?: boolean };

// Controlled overlay: centered panel on desktop, bottom-sheet on mobile.
// Closes on backdrop click and Esc. Renders nothing when !open.
function Modal({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const { t } = useT();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 backdrop-blur-sm sm:items-center sm:p-6"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-3xl border border-white/80 bg-[rgba(254,248,245,0.98)] shadow-2xl backdrop-blur-2xl sm:max-h-[88vh] sm:max-w-lg sm:rounded-3xl"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="flex items-start justify-between gap-4 border-b border-[var(--line)] px-5 py-4 sm:px-6">
          <h2 className="serif text-xl font-bold tracking-tight sm:text-2xl">{title}</h2>
          <button
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white text-[var(--foreground)] shadow-sm transition hover:bg-[var(--surface-soft)]"
            onClick={onClose}
            type="button"
            aria-label={t("Cerrar", "Close")}
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">{children}</div>
        {footer && (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--line)] px-5 py-4 sm:px-6">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

// Kebab (⋮) button that toggles a small popover list. Closes on outside click / Esc.
function RowMenu({ items }: { items: RowMenuItem[] }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onClick = () => setOpen(false);
    document.addEventListener("keydown", onKey);
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onClick);
    };
  }, [open]);

  if (!items.length) return null;

  return (
    <div className="relative shrink-0">
      <button
        className="grid h-9 w-9 place-items-center rounded-full text-[var(--text-muted)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]"
        onClick={(event) => {
          event.stopPropagation();
          setOpen((current) => !current);
        }}
        type="button"
        aria-label={t("Más acciones", "More actions")}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <MoreVertical className="h-5 w-5" />
      </button>
      {open && (
        <div
          className="absolute right-0 top-11 z-50 w-48 overflow-hidden rounded-2xl border border-white/80 bg-[rgba(254,248,245,0.98)] p-1.5 shadow-2xl backdrop-blur-2xl"
          onClick={(event) => event.stopPropagation()}
          role="menu"
        >
          {items.map((item, index) => (
            <button
              className={`block w-full rounded-xl px-3 py-2 text-left text-sm font-semibold transition hover:bg-[var(--surface-muted)] ${item.danger ? "text-[var(--danger)]" : "text-[var(--foreground)]"}`}
              key={`${item.label}-${index}`}
              onClick={(event) => {
                event.stopPropagation();
                setOpen(false);
                item.onClick();
              }}
              type="button"
              role="menuitem"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Single-line list item: leading icon/badge, primary label (+ optional sublabel),
// right-aligned value, trailing kebab RowMenu. The whole row is clickable for the
// primary action (onClick). Use instead of expanded editable cards in lists.
function CompactRow({
  icon,
  label,
  sublabel,
  value,
  valueTone = "default",
  onClick,
  menu,
}: {
  icon?: ReactNode;
  label: string;
  sublabel?: string;
  value?: string;
  valueTone?: "default" | "danger" | "warn" | "primary";
  onClick?: () => void;
  menu?: RowMenuItem[];
}) {
  const interactive = Boolean(onClick);
  const valueClass =
    valueTone === "danger"
      ? "text-[var(--danger)]"
      : valueTone === "warn"
        ? "text-[var(--warning)]"
        : valueTone === "primary"
          ? "text-[var(--primary)]"
          : "text-[var(--ink)]";

  return (
    <div
      className={`group flex items-center gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface-soft)] px-4 py-3 transition ${interactive ? "cursor-pointer divider-strong hover:border-[var(--primary)] hover:bg-[var(--surface-muted)]" : ""}`}
      onClick={onClick}
      onKeyDown={
        interactive
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
    >
      {icon && (
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-[var(--line)] bg-white text-[var(--text-muted)]">
          {icon}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold leading-tight text-[var(--ink)]">{label}</p>
        {sublabel && <p className="mt-0.5 truncate text-sm text-[var(--text-muted)]">{sublabel}</p>}
      </div>
      {value !== undefined && (
        <span className={`serif shrink-0 text-lg font-bold leading-tight ${valueClass}`}>{value}</span>
      )}
      {menu && menu.length > 0 ? (
        <RowMenu items={menu} />
      ) : interactive ? (
        <ChevronRight className="h-5 w-5 shrink-0 text-[var(--text-subtle)] transition group-hover:text-[var(--text-muted)]" />
      ) : null}
    </div>
  );
}

function ViewShell({ title, eyebrow, description, action, children }: { title: string; eyebrow: string; description?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 pt-1">
        <div className="min-w-0">
          <p className="kicker">{eyebrow}</p>
          <h2 className="serif mt-1.5 text-[1.9rem] font-bold leading-[1.05] tracking-tight md:text-[2.4rem]">{title}</h2>
          {description && <p className="mt-2 max-w-xl text-sm leading-relaxed text-[var(--text-muted)]">{description}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children}
    </div>
  );
}

function SectionHeader({ title, action, onAction }: { title: string; action: string; onAction: () => void }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <h3 className="serif text-xl font-bold tracking-tight">{title}</h3>
      <button className="shrink-0 text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--primary)] transition hover:opacity-70" onClick={onAction} type="button">{action}</button>
    </div>
  );
}

// One canonical, inviting empty state — used wherever a list/section has no data yet, so a
// fresh (clean-start) app reads as an intentional blank canvas, never as broken/placeholder.
function EmptyState({ title, subtitle, children }: { title: string; subtitle: string; children?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-[rgba(204,255,0,0.45)] bg-[rgba(204,255,0,0.06)] p-6 text-center">
      <p className="serif text-lg font-bold text-[var(--ink)]">{title}</p>
      <p className="mx-auto mt-1.5 max-w-sm text-sm leading-relaxed text-[var(--text-muted)]">{subtitle}</p>
      {children && <div className="mt-4 flex flex-wrap justify-center gap-2">{children}</div>}
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return (
    <div className="min-w-0">
      <p className="kicker">{label}</p>
      <p className={`amount mt-1.5 max-w-full break-words text-2xl font-bold leading-tight ${tone === "good" ? "text-[var(--primary)]" : tone === "bad" ? "text-[var(--warning)]" : ""}`}>{value}</p>
    </div>
  );
}

function Progress({ value, danger, className = "" }: { value: number; danger?: boolean; className?: string }) {
  // Excedido (value > 1): la barra completa representa lo GASTADO — el tramo oliva es lo
  // cubierto por el plan y el tramo ámbar el exceso. Así se VE cuánto te pasaste (300% se
  // distingue de 105%), en vez de la barra 100% roja idéntica para cualquier exceso.
  if (value > 1) {
    const planShare = Math.max(10, Math.round((1 / value) * 100));
    return (
      <div className={`flex h-2 gap-px overflow-hidden rounded-full bg-[rgba(35,43,19,0.12)] ${className}`}>
        <div className="h-full rounded-l-full bg-[var(--primary)]" style={{ width: `${planShare}%` }} />
        <div className="h-full rounded-r-full bg-[var(--warning-bar)]" style={{ width: `${100 - planShare}%` }} />
      </div>
    );
  }
  return (
    <div className={`h-2 overflow-hidden rounded-full bg-[rgba(35,43,19,0.12)] ${className}`}>
      <div className={`h-full rounded-full ${danger ? "bg-[var(--warning-bar)]" : "bg-[var(--primary)]"}`} style={{ width: `${Math.max(4, Math.min(value * 100, 100))}%` }} />
    </div>
  );
}

function RiskRow({ name, ratio, spent, planned, currency }: { name: string; ratio: number; spent: number; planned: number; currency: string }) {
  const { t } = useT();
  const danger = ratio > 0.95;
  return (
    <div>
      <div className="flex items-end justify-between">
        <span className="font-semibold">{name}</span>
        <span className={danger ? "font-bold text-[var(--warning)]" : "font-semibold"}>{Math.round(ratio * 100)}%</span>
      </div>
      <Progress className="mt-2" value={ratio} danger={danger} />
      <div className="mt-2 flex justify-between text-sm text-[var(--text-muted)]">
        <span>{formatMoney(spent, currency)} {t("gastado", "spent")}</span>
        <span>{formatMoney(planned, currency)} {t("limite", "limit")}</span>
      </div>
    </div>
  );
}

function TransactionList({ state, transactions }: { state: AppState; transactions: Transaction[] }) {
  return (
    <div className="mt-4 divide-y divide-[var(--line)]">
      {transactions.map((transaction) => {
        return (
          <div className="grid min-w-0 gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center" key={transaction.id}>
            <TransactionRow state={state} transaction={transaction} />
          </div>
        );
      })}
    </div>
  );
}

function TransactionRow({ state, transaction }: { state: AppState; transaction: Transaction }) {
  const { t } = useT();
  const category = categoryById(state.categories, transaction.categoryId);
  const income = transaction.type === "income" || category?.group === "income";
  const transfer = transaction.type === "transfer";
  const refund = transaction.type === "refund";
  const destination = transaction.transferAccountId ? state.accounts.find((account) => account.id === transaction.transferAccountId)?.name : undefined;
  const splitSummary = transaction.splits?.length ? splitCategorySummary(state, transaction) : "";
  const linked = transaction.linkedTransactionId ? state.transactions.find((item) => item.id === transaction.linkedTransactionId) : undefined;

  return (
    <>
      <div className="flex min-w-0 items-center gap-4">
        <div className={`grid h-12 w-12 shrink-0 place-items-center rounded-full ${income || transfer || refund ? "bg-[var(--lime)]" : "bg-[var(--surface-soft)]"}`}>
          {income || refund ? <ArrowUpRight className="h-5 w-5" /> : transfer ? <Repeat className="h-5 w-5" /> : <ArrowDownLeft className="h-5 w-5" />}
        </div>
        <div className="min-w-0">
          <p className="truncate font-semibold">{transaction.description}</p>
          <p className="truncate text-sm text-[var(--text-muted)]">{transaction.date} · {transfer ? t(`Transferencia a ${destination ?? "cuenta destino"}`, `Transfer to ${destination ?? "destination account"}`) : refund ? t(`Reembolso de ${linked?.description ?? category?.name ?? "gasto"}`, `Refund of ${linked?.description ?? category?.name ?? "expense"}`) : splitSummary || category?.name} · {transaction.merchant ? merchantDisplay(transaction.merchant, state.merchantAliases) : t("Sin comercio", "No merchant")}</p>
          <details className="group mt-0.5">
            {/* Antes iba en VERSALITAS con tracking — un grito repetido en cada fila. Ahora es
                un enlace discreto: la fila respira y el dato sigue a un click. */}
            <summary className="cursor-pointer select-none list-none text-xs font-medium text-[var(--text-subtle)] underline decoration-dotted underline-offset-2 transition hover:text-[var(--primary)]">{t("Detalles", "Details")}</summary>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              {t("Original", "Original")} {formatMoney(transaction.originalAmountCents, transaction.originalCurrency)} · {t("tasa", "rate")} {transaction.exchangeRate} ({transaction.exchangeRateSource}, {transaction.exchangeRateDate}) · {transactionStatusLabel(transaction.status)}
              {transaction.splits?.length ? ` · ${t(`${transaction.splits.length} splits`, `${transaction.splits.length} splits`)}` : ""}
            </p>
          </details>
        </div>
      </div>
      <p className={`amount shrink-0 whitespace-nowrap text-right text-lg font-bold ${income || transfer || refund ? "text-[var(--primary)]" : ""}`}>{income || refund ? "+" : transfer ? "" : "-"}{formatMoney(transaction.amountCents, state.currency)}</p>
    </>
  );
}

function ListCard({ title, subtitle, value, danger }: { title: string; subtitle: string; value: string; danger?: boolean }) {
  return (
    <Card>
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="font-semibold">{title}</h3>
          <p className="text-sm text-[var(--text-muted)]">{subtitle}</p>
        </div>
        <span className={`amount shrink-0 whitespace-nowrap text-lg font-bold ${danger ? "text-[var(--warning)]" : ""}`}>{value}</span>
      </div>
    </Card>
  );
}

// `state` is optional: when present (Family center, where comments span every
// item) each comment shows a human target label (movement description / category
// name) instead of the raw `targetType · targetId` enum dump. When omitted
// (Movements detail, already scoped to one transaction) the target line is hidden.
function CommentList({ comments, state }: { comments: FamilyComment[]; state?: AppState }) {
  const { t } = useT();
  return (
    <div className="mt-4 grid gap-2">
      {comments.map((comment) => {
        const target = state ? commentTargetLabel(state, comment, t("Movimiento", "Movement"), t("Categoría", "Category")) : null;
        return (
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-soft)] p-3 text-sm" key={comment.id}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold">{comment.authorName}</span>
              <span className="text-xs text-[var(--text-muted)]">{new Date(comment.createdAt).toLocaleString("es-DO")}</span>
            </div>
            <p className="mt-1 text-[var(--foreground)]">{comment.body}</p>
            {target && <p className="mt-2 text-xs font-semibold text-[var(--text-muted)]">{target}</p>}
          </div>
        );
      })}
      {!comments.length && <p className="rounded-2xl border border-dashed border-[var(--line)] p-4 text-sm text-[var(--text-muted)]">{t("Sin comentarios todavía.", "No comments yet.")}</p>}
    </div>
  );
}

function Input({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return (
    <label className="grid gap-2 text-sm font-semibold">
      {label}
      <input className="field" value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

// Editable amount with a local draft string so decimals type smoothly (a derived
// cents->string value would drop a trailing ".", "5." etc.). Mount with key={tx.id}
// so the draft re-initializes when a different movement is selected. Every change
// commits the parsed cents, and updateTransaction reverse-and-reapplies the account
// effect, so correcting a fat-fingered amount keeps every balance cuadrando al centavo.
function AmountInput({ label, originalAmountCents, onCommit }: { label: string; originalAmountCents: number; onCommit: (cents: number) => void }) {
  const { t } = useT();
  const [draft, setDraft] = useState(() => (originalAmountCents / 100).toString());
  return (
    <label className="grid gap-2 text-sm font-semibold">
      {label}
      <input
        className="field"
        value={draft}
        inputMode="decimal"
        placeholder="0.00"
        onChange={(event) => {
          setDraft(event.target.value);
          onCommit(toCents(event.target.value));
        }}
      />
      <span className="text-xs font-normal text-[var(--text-muted)]">{t("Corrige el monto; el saldo de la cuenta y el real por categoría se recalculan solos.", "Fix the amount; the account balance and the real per-category total recalculate on their own.")}</span>
    </label>
  );
}

function ComboInput({ label, value, options, onChange, placeholder }: { label: string; value: string; options: string[]; onChange: (value: string) => void; placeholder?: string }) {
  const listId = `list-${slugify(label)}`;
  return (
    <label className="grid gap-2 text-sm font-semibold">
      {label}
      <input className="field" list={listId} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
      <datalist id={listId}>
        {options.map((option) => <option key={option} value={option} />)}
      </datalist>
    </label>
  );
}

function Select({
  label,
  value,
  options,
  render,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  render?: (value: string) => string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-2 text-sm font-semibold">
      {label}
      <select className="field" value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => <option key={option} value={option}>{render ? render(option) : option}</option>)}
      </select>
    </label>
  );
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || "item";
}

// Compact a long comma-separated subcategory list so it never breaks the layout:
// shows the first `max` names and appends "+N" for the rest. Falls back to a neutral
// empty label when there are none — callers pass the active-language string via
// t("Sin datos", "No data") so the fallback follows the UI language.
function subcategoryPreview(subcategories: string[] | undefined, emptyLabel: string, max = 3): string {
  if (!subcategories || subcategories.length === 0) return emptyLabel;
  if (subcategories.length <= max) return subcategories.join(", ");
  return `${subcategories.slice(0, max).join(", ")} +${subcategories.length - max}`;
}

function readLocalState() {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(localStateStorageKey);
    if (!raw) return null;
    return normalizeStoredState(JSON.parse(raw));
  } catch {
    return null;
  }
}

function writeLocalState(state: AppState) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(localStateStorageKey, JSON.stringify(state));
  } catch {
    // Local persistence is a fallback; Convex remains the durable backend when configured.
  }
}

function clearLocalState() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(localStateStorageKey);
}

function normalizeStoredState(value: unknown): AppState | null {
  if (!value || typeof value !== "object") return null;
  const partial = value as Partial<AppState>;
  // Structural defaults come from an EMPTY real state, never demo data: a missing ledger
  // normalizes to an honest empty list, not someone else's fabricated finances.
  const base = createEmptyState((partial.currency as CurrencyCode) ?? "USD", partial.activeMonth);
  const categories = Array.isArray(partial.categories) ? partial.categories : base.categories;
  const activeMonth = partial.activeMonth ?? base.activeMonth;

  return {
    ...base,
    ...partial,
    user: { ...base.user, ...partial.user },
    activeSpaceId: partial.activeSpaceId ?? base.activeSpaceId,
    spaces: Array.isArray(partial.spaces) && partial.spaces.length > 0 ? partial.spaces : base.spaces,
    subscription: { ...base.subscription, ...partial.subscription },
    categories,
    monthlyPlans: Array.isArray(partial.monthlyPlans) ? partial.monthlyPlans : monthlyPlansFromCategories(categories, activeMonth),
    accounts: normalizeAccounts(Array.isArray(partial.accounts) ? partial.accounts : base.accounts),
    transactions: Array.isArray(partial.transactions) ? partial.transactions : [],
    receipts: Array.isArray(partial.receipts) ? partial.receipts : [],
    comments: Array.isArray(partial.comments) ? partial.comments : [],
    review: Array.isArray(partial.review) ? partial.review : [],
    recurringRules: Array.isArray(partial.recurringRules) ? partial.recurringRules : [],
    automationRules: Array.isArray(partial.automationRules) ? partial.automationRules : [],
    ruleApplications: Array.isArray(partial.ruleApplications) ? partial.ruleApplications : [],
    goals: Array.isArray(partial.goals) ? partial.goals : [],
    debts: Array.isArray(partial.debts) ? partial.debts : [],
    netWorth: Array.isArray(partial.netWorth) ? partial.netWorth : [],
    members: Array.isArray(partial.members) ? partial.members : base.members,
    aiSettings: { ...base.aiSettings, ...partial.aiSettings },
    aiActions: Array.isArray(partial.aiActions) ? partial.aiActions : [],
    notificationSettings: { ...base.notificationSettings, ...partial.notificationSettings },
    monthClosings: Array.isArray(partial.monthClosings) ? partial.monthClosings : [],
  };
}

function normalizeAccounts(accounts: AppState["accounts"]) {
  const firstActive = accounts.find((account) => !account.archived);
  const hasDefault = accounts.some((account) => !account.archived && account.defaultForCapture);

  return accounts.map((account) => ({
    ...account,
    includeInNetWorth: account.includeInNetWorth ?? true,
    defaultForCapture: account.defaultForCapture || (!hasDefault && account.id === firstActive?.id),
  }));
}

// Some movements keep a mirror balance in sync besides the account: a debt payment lowers
// debt.balanceCents (and the matching net-worth liability), a goal contribution raises
// goal.savedCents, a goal withdrawal lowers it. When such a movement is removed, that mirror
// must be undone too or the deuda/meta/patrimonio drift forever. Reverses by the tags/type
// written in registerPayment/registerContribution/registerWithdrawal.
function reverseMirrorLedgers(
  ledgers: Pick<AppState, "debts" | "goals" | "netWorth">,
  tx: Transaction,
): Pick<AppState, "debts" | "goals" | "netWorth"> {
  let { debts, goals, netWorth } = ledgers;

  const debtTag = tx.tags.find((tag) => tag.startsWith("debt:"));
  if (debtTag && tx.type === "debt_payment") {
    const debtId = debtTag.slice("debt:".length);
    const debt = debts.find((item) => item.id === debtId);
    if (debt) {
      debts = debts.map((item) => (item.id === debtId ? { ...item, balanceCents: item.balanceCents + tx.amountCents } : item));
      netWorth = netWorth.map((item) =>
        item.kind === "liability" && item.group === "debt" && normalizeImportKey(item.name).includes(normalizeImportKey(debt.name))
          ? { ...item, amountCents: item.amountCents + tx.amountCents }
          : item,
      );
    }
  }

  const goalTag = tx.tags.find((tag) => tag.startsWith("goal:"));
  if (goalTag) {
    const goalId = goalTag.slice("goal:".length);
    // Contribution (type "saving") added savedCents → subtract it back; withdrawal
    // (type "refund"/tag "retiro-meta") subtracted it → add it back.
    const wasWithdrawal = tx.type === "refund" || tx.tags.includes("retiro-meta");
    goals = goals.map((item) => {
      if (item.id !== goalId) return item;
      const next = wasWithdrawal ? item.savedCents + tx.amountCents : item.savedCents - tx.amountCents;
      return { ...item, savedCents: Math.max(0, next) };
    });
  }

  return { debts, goals, netWorth };
}

function transactionTypeForGroup(group?: GroupKey): TransactionType {
  if (group === "income") return "income";
  if (group === "debt") return "debt_payment";
  if (group === "savings") return "saving";
  if (group === "investments") return "investment";
  return "expense";
}

function confirmClosedMonthChange(state: AppState, date: string) {
  const month = date.slice(0, 7);
  const closed = state.monthClosings.some((closing) => closing.month === month);
  if (!closed || typeof window === "undefined") return true;
  return window.confirm(`El mes ${month} ya esta cerrado. Puedes editarlo, pero el cambio quedara fuera del cierre guardado. Deseas continuar?`);
}

function movementAudit(action: NonNullable<Transaction["audit"]>[number]["action"], summary: string, by = "Yo", at = new Date().toISOString()) {
  return {
    id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    at,
    by,
    action,
    summary,
  };
}

function auditActionForPatch(patch: Partial<Transaction>): NonNullable<Transaction["audit"]>[number]["action"] | null {
  if (patch.splits) return "split_added";
  if (patch.status === "approved") return "reviewed";
  const auditedFields = ["date", "categoryId", "subcategory", "accountId", "transferAccountId", "type", "amountCents", "status"];
  return Object.keys(patch).some((key) => auditedFields.includes(key)) ? "edited" : null;
}

function auditSummaryForPatch(previous: Transaction, patch: Partial<Transaction>) {
  const changes = Object.entries(patch)
    .filter(([key]) => key !== "audit")
    .map(([key, value]) => `${movementFieldLabel(key)}: ${formatAuditValue(previous[key as keyof Transaction])} -> ${formatAuditValue(value)}`)
    .slice(0, 4);
  return changes.length ? changes.join("; ") : "Movimiento actualizado.";
}

function movementFieldLabel(key: string) {
  const labels: Record<string, string> = {
    description: "Descripcion",
    date: "Fecha",
    merchant: "Comercio/persona",
    categoryId: "Categoria",
    subcategory: "Subcategoria",
    accountId: "Cuenta",
    transferAccountId: "Cuenta destino",
    linkedTransactionId: "Movimiento vinculado",
    linkKind: "Tipo de vinculo",
    status: "Estado",
    tags: "Tags",
    note: "Nota",
    splits: "Splits",
    type: "Tipo",
    amountCents: "Monto",
  };
  return labels[key] ?? key;
}

function formatAuditValue(value: unknown) {
  if (Array.isArray(value)) return `${value.length} item(s)`;
  if (value === undefined || value === null || value === "") return "vacio";
  if (typeof value === "object") return "objeto";
  return String(value);
}

function splitCategorySummary(state: AppState, transaction: Transaction) {
  return (transaction.splits ?? [])
    .map((split) => categoryById(state.categories, split.categoryId)?.name ?? "Categoria")
    .join(" + ");
}

function currentWorkspaceMember(state: AppState) {
  return state.members.find((member) => member.id === state.user.currentMemberId) ?? state.members[0];
}

function canEditWorkspace(state: AppState) {
  const member = currentWorkspaceMember(state);
  return state.user.status === "signed_in" && Boolean(member && member.role !== "viewer");
}

function createFamilyComment(state: AppState, targetType: FamilyComment["targetType"], targetId: string, body: string): FamilyComment {
  const member = currentWorkspaceMember(state);
  return {
    id: `comment-${targetType}-${Date.now()}`,
    targetType,
    targetId,
    authorMemberId: member?.id ?? state.user.currentMemberId,
    authorName: member?.name ?? state.user.name,
    body,
    createdAt: new Date().toISOString(),
  };
}

function commentsForTarget(state: AppState, targetType: FamilyComment["targetType"], targetId: string) {
  return state.comments.filter((comment) => comment.targetType === targetType && comment.targetId === targetId);
}

// Resolve a comment's target to a human-readable label ("Movimiento · 2026-06-07 Super"
// or "Categoría · Comida"), never the raw targetType/targetId enum codes.
function commentTargetLabel(state: AppState, comment: FamilyComment, transactionWord: string, categoryWord: string) {
  if (comment.targetType === "transaction") {
    const transaction = state.transactions.find((item) => item.id === comment.targetId);
    return `${transactionWord} · ${transaction ? `${transaction.date} ${transaction.description}` : comment.targetId}`;
  }
  const category = categoryById(state.categories, comment.targetId);
  return `${categoryWord} · ${category?.name ?? comment.targetId}`;
}

const notificationLabels: Record<NotificationKind, string> = {
  daily_capture: "Registrar gasto diario",
  recurring: "Recurrente pendiente",
  budget_risk: "Categoria en riesgo",
  month_close: "Cierre de mes",
  balance_confirm: "Confirmar saldos",
  debt_payment: "Pago de deuda",
  goal_progress: "Meta de ahorro",
  movement_review: "Movimiento pendiente",
  receipts: "Recibos y adjuntos",
};

function labelForUseCase(value: string) {
  if (value === "personal") return "Personal";
  if (value === "familia") return "Pareja o familia";
  if (value === "negocio") return "Negocio personal";
  return "Prueba";
}

function subscriptionUsage(state: AppState) {
  return {
    spacesUsed: state.spaces.filter((space) => !space.archived).length,
    spacesLimit: state.subscription.spacesLimit,
    membersUsed: state.members.length,
    membersLimit: state.subscription.membersLimit,
    aiUsed: state.subscription.aiCreditsUsed,
    aiLimit: state.subscription.aiCreditsLimit,
    storageUsed: state.subscription.storageMbUsed,
    storageLimit: state.subscription.storageMbLimit,
  };
}

function contentTypeFromFileName(fileName: string) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".pdf")) return "application/pdf";
  return "application/octet-stream";
}

function buildNotifications(state: AppState, t: (es: string, en: string) => string): AppNotification[] {
  const notifications: AppNotification[] = [];
  const enabled = (kind: NotificationKind) => state.notificationSettings[kind] ?? true;
  const pendingReview = state.review.length;
  const pendingReceipts = state.receipts.filter((receipt) => ["uploaded", "processing", "needs_review", "error"].includes(receipt.status)).length;
  const exceeded = categoryUsage(state).filter((category) => category.ratio > 1);
  const dueRecurring = state.recurringRules.filter((rule) => rule.active && rule.nextDate <= endOfMonth(state.activeMonth)).length;
  const activeMonthClosed = state.monthClosings.some((closing) => closing.month === state.activeMonth);
  const monthTransactions = transactionsForMonth(state, state.activeMonth);
  const today = new Date().toISOString().slice(0, 10);
  const currentMonthIsActive = today.startsWith(state.activeMonth);
  const hasMovementToday = state.transactions.some((transaction) => transaction.date === today);
  const unconfirmedAccounts = state.accounts.filter((account) => !account.archived && !account.lastConfirmedAt?.startsWith(state.activeMonth));
  const openDebts = state.debts.filter((debt) => debt.balanceCents > 0);
  const debtPaymentThisMonth = monthTransactions.some((transaction) => transaction.type === "debt_payment" && transaction.status === "approved");
  const activeGoals = state.goals.filter((goal) => goal.savedCents < goal.targetCents);
  const goalContributionThisMonth = monthTransactions.some((transaction) => transaction.type === "saving" && transaction.status === "approved");

  if (enabled("movement_review") && pendingReview > 0) {
    notifications.push({
      id: "review",
      kind: "movement_review",
      label: t("Revisión", "Review"),
      title: t(`${pendingReview} movimientos necesitan decisión`, `${pendingReview} transactions need a decision`),
      subtitle: t("Hay movimientos sugeridos, duplicados, ajustes o recibos pendientes.", "There are suggested transactions, duplicates, adjustments, or pending receipts."),
      action: t("Abrir", "Open"),
      view: "review",
      tone: "danger",
    });
  }

  if (enabled("receipts") && pendingReceipts > 0) {
    notifications.push({
      id: "receipts",
      kind: "receipts",
      label: t("Recibos", "Receipts"),
      title: t(`${pendingReceipts} comprobantes sin cerrar`, `${pendingReceipts} receipts still open`),
      subtitle: t("Tienes comprobantes pendientes.", "You have pending receipts."),
      action: t("Ver", "View"),
      view: "receipts",
    });
  }

  if (enabled("daily_capture") && currentMonthIsActive && !hasMovementToday) {
    notifications.push({
      id: "daily-capture",
      kind: "daily_capture",
      label: t("Captura", "Capture"),
      title: t("Hoy no hay movimientos registrados", "No transactions logged today"),
      subtitle: t("Añade gastos, ingresos o ajustes antes de que se pierda el detalle real.", "Add expenses, income, or adjustments before the real detail is lost."),
      action: t("Añadir", "Add"),
      view: "add",
    });
  }

  if (enabled("budget_risk") && exceeded.length > 0) {
    notifications.push({
      id: "budget",
      kind: "budget_risk",
      label: t("Presupuesto", "Budget"),
      title: t(`${exceeded.length} categorias excedidas`, `${exceeded.length} categories over budget`),
      subtitle: exceeded.slice(0, 3).map((category) => category.name).join(", "),
      action: t("Corregir", "Fix"),
      view: "plan",
      tone: "danger",
    });
  }

  if (enabled("balance_confirm") && unconfirmedAccounts.length > 0) {
    notifications.push({
      id: "balance-confirm",
      kind: "balance_confirm",
      label: t("Saldos", "Balances"),
      title: t(`${unconfirmedAccounts.length} cuentas sin confirmar`, `${unconfirmedAccounts.length} accounts unconfirmed`),
      subtitle: unconfirmedAccounts.slice(0, 3).map((account) => account.name).join(", "),
      action: t("Confirmar", "Confirm"),
      view: "accounts",
    });
  }

  if (enabled("debt_payment") && openDebts.length > 0 && !debtPaymentThisMonth) {
    notifications.push({
      id: "debt-payment",
      kind: "debt_payment",
      label: t("Deudas", "Debts"),
      title: t("No hay pago de deuda aprobado este mes", "No approved debt payment this month"),
      subtitle: t(`${openDebts.length} deuda(s) siguen abiertas; registra pago mínimo o decisión.`, `${openDebts.length} debt(s) still open; log a minimum payment or a decision.`),
      action: t("Pagar", "Pay"),
      view: "debts",
    });
  }

  if (enabled("goal_progress") && activeGoals.length > 0 && !goalContributionThisMonth) {
    notifications.push({
      id: "goal-progress",
      kind: "goal_progress",
      label: t("Metas", "Goals"),
      title: t("No hay aporte a metas este mes", "No goal contribution this month"),
      subtitle: activeGoals.slice(0, 3).map((goal) => goal.name).join(", "),
      action: t("Aportar", "Contribute"),
      view: "goals",
    });
  }

  if (enabled("recurring") && dueRecurring > 0) {
    notifications.push({
      id: "recurring",
      kind: "recurring",
      label: t("Recurrentes", "Recurring"),
      title: t(`${dueRecurring} reglas recurrentes vencen este mes`, `${dueRecurring} recurring rules are due this month`),
      subtitle: t("Genera los movimientos pendientes y confirma monto, fecha y tasa.", "Generate the pending transactions and confirm amount, date, and rate."),
      action: t("Generar", "Generate"),
      view: "rules",
    });
  }

  if (enabled("month_close") && !activeMonthClosed) {
    notifications.push({
      id: "closing",
      kind: "month_close",
      label: t("Cierre", "Close"),
      title: t(`${state.activeMonth} no está cerrado`, `${state.activeMonth} isn't closed`),
      subtitle: t("Guarda snapshot de ingresos, egresos, remanente, ahorro y patrimonio.", "Save a snapshot of income, spending, remainder, savings, and net worth."),
      action: t("Cerrar", "Close"),
      view: "reports",
    });
  }

  return notifications;
}

function inferReviewTargetId(item: AppState["review"][number], state: AppState) {
  if (item.targetId) return item.targetId;
  if (item.id.startsWith("review-")) {
    const id = item.id.replace("review-", "");
    if (state.transactions.some((transaction) => transaction.id === id) || state.receipts.some((receipt) => receipt.id === id)) return id;
  }
  const transaction = state.transactions.find((candidate) => candidate.description === item.title || candidate.merchant === item.title);
  if (transaction) return transaction.id;
  const receipt = state.receipts.find((candidate) => candidate.fileName === item.title || candidate.merchant === item.title);
  return receipt?.id;
}

function createStarterCategories(plan: { income: number; housing: number; food: number; transport: number }): AppState["categories"] {
  return [
    { id: "salary", group: "income", name: "Ingresos", subcategories: ["Salario", "Variable", "Otros"], plannedCents: plan.income, source: "starter" },
    { id: "housing", group: "essentials", name: "Hogar", subcategories: ["Renta", "Electricidad", "Agua", "Internet"], plannedCents: plan.housing, source: "starter" },
    { id: "food", group: "essentials", name: "Comida", subcategories: ["Supermercado", "Colmado", "Comida fuera"], plannedCents: plan.food, source: "starter" },
    { id: "transport", group: "essentials", name: "Transporte", subcategories: ["Gasolina", "Uber", "Mantenimiento"], plannedCents: plan.transport, source: "starter" },
    { id: "subscriptions", group: "discretionary", name: "Suscripciones", subcategories: ["Apps", "Software", "IA"], plannedCents: 0, source: "starter" },
    { id: "leisure", group: "discretionary", name: "Ocio e imprevistos", subcategories: ["Salidas", "Restaurantes", "Compras especificas"], plannedCents: 0, source: "starter" },
    { id: "debt", group: "debt", name: "Deudas", subcategories: ["Tarjeta", "Prestamo", "Carro"], plannedCents: 0, source: "starter" },
    { id: "savings", group: "savings", name: "Ahorro", subcategories: ["Emergencia", "Viaje", "Futuro"], plannedCents: 0, source: "starter" },
    { id: "investments", group: "investments", name: "Inversiones", subcategories: ["Retiro", "Bolsa", "Negocio"], plannedCents: 0, source: "starter" },
  ];
}

function initialsForName(name: string) {
  const parts = name.split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : name.slice(0, 2)).toUpperCase();
}

function toCsv(headers: string[], rows: Array<Array<string | number>>) {
  return [headers, ...rows]
    .map((row) => row.map((value) => csvCell(String(value))).join(","))
    .join("\n");
}

function csvCell(value: string) {
  const escaped = value.replace(/"/g, '""');
  return /[",\n]/.test(escaped) ? `"${escaped}"` : escaped;
}

function downloadText(fileName: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  downloadBlob(fileName, blob);
}

function downloadBlob(fileName: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
