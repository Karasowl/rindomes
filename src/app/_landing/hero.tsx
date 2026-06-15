import Link from "next/link";
import type { CSSProperties } from "react";
import { ArrowRightCircle, ReceiptText, Sparkles, Zap } from "lucide-react";

// Iconos en línea dentro del titular (mismo recurso del spec: icono pegado a la palabra).
const inlineIcon: CSSProperties = {
  display: "inline",
  verticalAlign: "middle",
  position: "relative",
  top: -2,
};

export function Hero() {
  return (
    <div style={{ maxWidth: 640 }}>
      {/* Heading · iconos inline + fade-up (delay 0) */}
      <h1
        className="hero-fade serif"
        style={{
          animationDelay: "0ms",
          fontSize: "clamp(2rem, 6vw, 4rem)",
          lineHeight: 1.04,
          letterSpacing: "-0.01em",
          color: "#1d1b1a",
          marginBottom: 22,
        }}
      >
        <Zap size={28} color="#506600" style={inlineIcon} /> Registra en segundos.{" "}
        <Sparkles size={28} color="#506600" style={inlineIcon} /> Entiende en qué se va tu{" "}
        <ReceiptText size={28} color="#506600" style={inlineIcon} /> plata.
      </h1>

      {/* Subtexto · el fade corre en el wrapper; el <p> conserva su opacidad de reposo 0.82 (delay 0.15s) */}
      <div className="hero-fade" style={{ animationDelay: "150ms" }}>
        <p
          style={{
            fontSize: "clamp(0.95rem, 2.5vw, 1.15rem)",
            lineHeight: 1.65,
            opacity: 0.82,
            maxWidth: 560,
            color: "#1d1b1a",
          }}
        >
          Sin hojas de cálculo. RindoMes guarda exactamente qué fue cada gasto y te dice, en
          lenguaje claro, en qué se va tu dinero —tú solo registras.
        </p>
      </div>

      {/* CTA · fade-up (delay 0.30s) */}
      <Link
        href="/app"
        className="hero-fade group mt-8 inline-flex items-center justify-between font-semibold transition-[transform,filter] hover:scale-[1.03] active:scale-95"
        style={{
          animationDelay: "300ms",
          background: "#ccff00",
          color: "#1d1b1a",
          borderRadius: 50,
          padding: "16px 26px",
          fontSize: "clamp(0.95rem, 2vw, 1.05rem)",
          boxShadow: "0 10px 30px rgba(80,102,0,0.28)",
          minWidth: 220,
          gap: 28,
        }}
      >
        Empezar gratis
        <ArrowRightCircle size={20} className="transition-transform group-hover:translate-x-1" />
      </Link>
    </div>
  );
}
