"use client";

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type Lang = "en" | "es";

const STORAGE_KEY = "rindomes.lang";

// Module-level mirror of the active language so non-React label helpers (e.g.
// src/lib/labels.ts) can read the current language without hooks. Kept in sync
// with the React state inside the provider. Defaults to "en" so the server and
// the first client render agree (no hydration mismatch) until detection runs.
let activeLang: Lang = "en";
export function getActiveLang(): Lang {
  return activeLang;
}

type I18nContextValue = {
  lang: Lang;
  setLang: (l: Lang) => void;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function readStoredLang(): Lang | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "en" || stored === "es") return stored;
  } catch {
    // localStorage can throw (private mode, blocked storage) — fall through to detection.
  }
  return null;
}

function detectLang(): Lang {
  if (typeof navigator === "undefined") return "en";
  const nav = navigator.language || (navigator.languages && navigator.languages[0]) || "";
  return nav.toLowerCase().startsWith("es") ? "es" : "en";
}

/**
 * Provides the active language to the tree. Renders "en" on the server and on the
 * first client render so server and client markup match (no hydration mismatch),
 * then resolves the real preference in an effect: a stored choice wins, otherwise
 * the browser language is detected. setLang persists the choice to localStorage.
 */
export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("en");

  useEffect(() => {
    const resolved = readStoredLang() ?? detectLang();
    activeLang = resolved; // keep the mirror correct immediately for label helpers
    // Legit external-preference sync (localStorage/navigator) resolved after mount —
    // not derived render state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLangState(resolved);
  }, []);

  const setLang = useCallback((next: Lang) => {
    activeLang = next; // keep the mirror correct immediately for label helpers
    setLangState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Persisting is best-effort; the in-memory choice still applies this session.
    }
  }, []);

  // Harmless idempotent mirror of the React state so non-React label helpers can
  // read the current language during render. Plain assignment (not setState), so
  // it never triggers a re-render and stays in sync on every render. It is purely
  // a read-cache for code outside the React tree, not render-derived state.
  // eslint-disable-next-line react-hooks/globals
  activeLang = lang;

  const value = useMemo<I18nContextValue>(() => ({ lang, setLang }), [lang, setLang]);

  return createElement(I18nContext.Provider, { value }, children);
}

/**
 * Returns the translation helper and language controls for the active context.
 * `t(es, en)` returns the string for the active language — Spanish is the first
 * argument (the existing literal), English the second. If a component is rendered
 * outside an <I18nProvider> it defaults to English so text never breaks.
 */
export function useT(): {
  t: (es: string, en: string) => string;
  lang: Lang;
  setLang: (l: Lang) => void;
} {
  const ctx = useContext(I18nContext);
  const lang = ctx?.lang ?? "en";
  const setLang = ctx?.setLang ?? (() => {});
  const t = useCallback((es: string, en: string) => (lang === "es" ? es : en), [lang]);
  return { t, lang, setLang };
}

/**
 * Compact EN/ES switch styled with the app tokens (rounded, glass-ish, lime active).
 * Drop it anywhere inside an <I18nProvider>.
 */
export function LanguageToggle() {
  const { lang, setLang } = useT();
  const options: Lang[] = ["en", "es"];
  return createElement(
    "div",
    {
      className:
        "inline-flex items-center rounded-full border border-white/70 bg-white/60 p-0.5 shadow-sm backdrop-blur-xl",
      role: "group",
      "aria-label": lang === "es" ? "Idioma" : "Language",
    },
    options.map((option) =>
      createElement(
        "button",
        {
          key: option,
          type: "button",
          onClick: () => setLang(option),
          "aria-pressed": lang === option,
          className: `rounded-full px-2.5 py-1 text-xs font-bold uppercase tracking-[0.08em] transition ${
            lang === option
              ? "bg-[var(--lime)] text-black shadow-sm"
              : "text-[var(--text-muted)] hover:text-[var(--foreground)]"
          }`,
        },
        option.toUpperCase()
      )
    )
  );
}
