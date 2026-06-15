"use client";

import Link from "next/link";
import { X } from "lucide-react";
import { Logo } from "./logo";

interface NavLink {
  label: string;
  href: string;
}

/**
 * Sheet móvil deslizante (réplica del comportamiento AnimatePresence del spec, sin Framer
 * Motion): siempre montado, entra/sale con transiciones CSS de transform/opacidad. Links y
 * CTAs entran escalonados vía transition-delay cuando `open` pasa a true.
 */
export function MobileMenu({ open, links, onClose }: { open: boolean; links: NavLink[]; onClose: () => void }) {
  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        aria-hidden={!open}
        className={`fixed inset-0 z-40 transition-opacity duration-300 md:hidden ${open ? "opacity-100" : "pointer-events-none opacity-0"}`}
        style={{ background: "rgba(40,40,30,0.35)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)" }}
      />

      {/* Sheet */}
      <aside
        className={`fixed right-0 top-0 z-50 flex flex-col md:hidden ${open ? "translate-x-0" : "translate-x-full"}`}
        style={{
          width: "min(88vw, 360px)",
          height: "100dvh",
          background: "#E7E1D6",
          boxShadow: "-12px 0 48px rgba(40,40,30,0.18)",
          transition: "transform 0.45s cubic-bezier(0.22,1,0.36,1)",
        }}
      >
        <div className="flex items-center justify-between px-6 py-5">
          <Logo />
          <button onClick={onClose} type="button" aria-label="Cerrar menú" className="rounded-full p-2 transition-opacity hover:opacity-70">
            <X color="#1d1b1a" />
          </button>
        </div>

        <div style={{ height: 1, background: "rgba(40,40,30,0.15)" }} />

        <nav className="flex flex-1 flex-col gap-1 px-6 pt-6">
          {links.map((link, i) => (
            <a
              key={link.href}
              href={link.href}
              onClick={onClose}
              className="py-3 text-2xl font-medium hover:opacity-60"
              style={{
                color: "#1d1b1a",
                opacity: open ? 1 : 0,
                transform: open ? "translateX(0)" : "translateX(24px)",
                transition: "opacity 0.45s cubic-bezier(0.22,1,0.36,1), transform 0.45s cubic-bezier(0.22,1,0.36,1)",
                transitionDelay: `${open ? 120 + i * 70 : 0}ms`,
              }}
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div
          className="flex flex-col gap-3 px-6 pb-8"
          style={{
            opacity: open ? 1 : 0,
            transform: open ? "translateY(0)" : "translateY(16px)",
            transition: "opacity 0.45s cubic-bezier(0.22,1,0.36,1), transform 0.45s cubic-bezier(0.22,1,0.36,1)",
            transitionDelay: `${open ? 120 + links.length * 70 : 0}ms`,
          }}
        >
          <Link href="/app" onClick={onClose} className="rounded-full px-5 py-3 text-center text-sm font-semibold" style={{ background: "#ccff00", color: "#1d1b1a" }}>
            Empezar gratis
          </Link>
          <Link href="/app" onClick={onClose} className="rounded-full px-5 py-3 text-center text-sm font-semibold" style={{ background: "#F4EEE6", color: "#1d1b1a" }}>
            Iniciar sesión
          </Link>
        </div>
      </aside>
    </>
  );
}
