import type { Metadata } from "next";
import { Landing } from "./_landing/landing";

export const metadata: Metadata = {
  title: "RindoMes — Registra en segundos y entiende en qué se va tu plata",
  description:
    "Finanzas del hogar sin hojas de cálculo. Registra un gasto en segundos: RindoMes entiende exactamente qué fue y te dice, en lenguaje claro, en qué se va tu dinero. Sin bancos conectados, efectivo incluido.",
};

export default function Page() {
  return <Landing />;
}
