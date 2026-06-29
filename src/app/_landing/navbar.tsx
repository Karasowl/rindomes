"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu } from "lucide-react";
import { Logo } from "./logo";
import { MobileMenu } from "./mobile-menu";

export const NAV_LINKS = [
  { label: "Captura", href: "#captura" },
  { label: "Insights", href: "#insights" },
  { label: "Precios", href: "#precios" },
  { label: "Ayuda", href: "#ayuda" },
];

export function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-white/40 bg-[rgba(254,248,245,0.72)] backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-[1280px] items-center justify-between px-5 py-4 sm:px-8 sm:py-5">
        {/* Izquierda: logo (vuelve al inicio) */}
        <a href="#top" className="flex items-center">
          <Logo />
        </a>

        {/* Centro (solo desktop): links a secciones */}
        <nav className="hidden items-center gap-8 md:flex">
          {NAV_LINKS.map((link) => (
            <a key={link.href} href={link.href} className="text-sm font-medium transition-colors hover:text-[var(--text-muted)]" style={{ color: "#1d1b1a" }}>
              {link.label}
            </a>
          ))}
        </nav>

        {/* Derecha (solo desktop): CTAs a la app */}
        <div className="hidden items-center gap-3 md:flex">
          <Link href="/app" className="rounded-full px-5 py-2.5 text-sm font-semibold transition-opacity hover:opacity-90" style={{ background: "#ccff00", color: "#1d1b1a" }}>
            Empezar gratis
          </Link>
          <Link href="/app" className="rounded-full px-5 py-2.5 text-sm font-semibold transition-opacity hover:opacity-80" style={{ background: "#F4EEE6", color: "#1d1b1a" }}>
            Iniciar sesión
          </Link>
        </div>

        {/* Móvil: hamburguesa */}
        <button className="rounded-full p-2 transition-colors hover:bg-[var(--surface-muted)] md:hidden" onClick={() => setMenuOpen(true)} type="button" aria-label="Abrir menú">
          <Menu color="#1d1b1a" />
        </button>
      </div>

      <MobileMenu open={menuOpen} links={NAV_LINKS} onClose={() => setMenuOpen(false)} />
    </header>
  );
}
