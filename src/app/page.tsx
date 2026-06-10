import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CalendarCheck, Coins, Landmark, Scale, Sparkles, Target, Wallet } from "lucide-react";

export const metadata: Metadata = {
  title: "RindoMes — Planea, registra y haz que te rinda el mes",
  description:
    "App de finanzas personales y familiares manual-first. Sin bancos conectados: registra efectivo, transferencias, deudas y recibos; compara lo planeado contra lo real y cierra el mes con claridad.",
};

const features = [
  {
    icon: Wallet,
    title: "Manual-first, sin bancos",
    body: "Tu dinero real: efectivo, transferencias informales, pagos familiares, recibos e imprevistos. No dependes de sincronización bancaria.",
  },
  {
    icon: Scale,
    title: "Plan vs. real",
    body: "Define cómo quieres gastar y compáralo contra lo que realmente pasó. Detecta categorías en riesgo antes de que se te vaya de las manos.",
  },
  {
    icon: CalendarCheck,
    title: "Cierra y prepara el mes",
    body: "Cierre mensual guiado: pendientes, saldos, aprendizaje del mes, y arranca el siguiente periodo en un clic.",
  },
  {
    icon: Coins,
    title: "Multi-moneda",
    body: "Registra en la moneda que sea; se fija el cambio del día y siempre sabes en qué moneda ingresaste el dinero.",
  },
];

const modes = [
  { title: "Tracker", body: "Registra ingresos y gastos a medida que ocurren, sin presupuestos predefinidos." },
  { title: "Plan mensual", body: "Establece un presupuesto al inicio del mes y compara tu progreso real contra lo planeado.", recommended: true },
  { title: "Base cero", body: "Asigna una función específica a cada centavo que ingresa, antes de que comience el mes." },
];

export default function Landing() {
  return (
    <div className="grain mesh-bg min-h-screen text-[var(--ink)]">
      <header className="sticky top-0 z-40 border-b border-white/40 bg-[rgba(254,248,245,0.8)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4 md:px-8">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-full border border-white/80 bg-[var(--lime)] text-xs font-bold shadow-sm">RM</span>
            <span className="serif text-2xl font-bold italic tracking-tight">RindoMes</span>
          </div>
          <Link className="rounded-full bg-[var(--ink)] px-5 py-2 text-sm font-semibold text-white transition hover:opacity-90" href="/app">
            Entrar
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 md:px-8">
        {/* Hero */}
        <section className="flex flex-col items-center pt-16 pb-12 text-center md:pt-24">
          <span className="inline-flex items-center gap-2 rounded-full border border-[var(--lime)] bg-[rgba(204,255,0,0.18)] px-4 py-1.5 text-xs font-semibold text-[var(--primary)]">
            <Sparkles className="h-4 w-4" /> Manual-first · Funciona perfecto sin IA
          </span>
          <h1 className="serif mt-6 max-w-3xl text-5xl font-bold leading-[1.05] tracking-tight md:text-7xl">
            Planea, registra y haz que te rinda el mes.
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-slate-600 md:text-xl">
            La app de finanzas personales y familiares para quienes no quieren depender de bancos conectados ni de hojas
            de cálculo. Registra lo que realmente pasó, compara contra tu plan, y corrige a tiempo.
          </p>
          <div className="mt-9 flex flex-col items-center gap-3 sm:flex-row">
            <Link className="inline-flex items-center justify-center gap-2 rounded-full bg-[var(--lime)] px-7 py-4 text-base font-bold text-black shadow-sm transition hover:brightness-95" href="/app">
              Empezar gratis <ArrowRight className="h-5 w-5" />
            </Link>
            <Link className="inline-flex items-center justify-center rounded-full border border-black/15 bg-white/60 px-7 py-4 text-base font-semibold text-slate-700 transition hover:bg-white" href="/app">
              Explorar la app
            </Link>
          </div>
          <p className="mt-4 text-sm text-slate-500">Sin tarjeta. Tus datos viven en tu hogar financiero.</p>
        </section>

        {/* Hero metric strip */}
        <section className="glass mx-auto grid max-w-4xl grid-cols-1 gap-px overflow-hidden rounded-3xl text-center sm:grid-cols-3">
          {[
            { value: "5 seg", label: "para registrar un gasto" },
            { value: "0 bancos", label: "conectados — efectivo incluido" },
            { value: "Plan vs real", label: "en cada categoría, cada mes" },
          ].map((stat) => (
            <div className="bg-white/40 px-6 py-8" key={stat.label}>
              <p className="serif text-3xl font-bold text-[var(--primary)]">{stat.value}</p>
              <p className="mt-1 text-sm text-slate-600">{stat.label}</p>
            </div>
          ))}
        </section>

        {/* Features */}
        <section className="py-20">
          <h2 className="serif text-center text-4xl font-bold tracking-tight md:text-5xl">
            Tu dinero real, organizado.
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-center text-slate-600">
            Efectivo, transferencias, deudas, recibos e imprevistos. RindoMes convierte el desorden en un mes claro.
          </p>
          <div className="mt-12 grid gap-6 md:grid-cols-2">
            {features.map((feature) => {
              const Icon = feature.icon;
              return (
                <div className="glass rounded-3xl p-7" key={feature.title}>
                  <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[rgba(204,255,0,0.25)] text-[var(--primary)]">
                    <Icon className="h-6 w-6" />
                  </span>
                  <h3 className="serif mt-5 text-2xl font-bold">{feature.title}</h3>
                  <p className="mt-2 text-slate-600">{feature.body}</p>
                </div>
              );
            })}
          </div>
        </section>

        {/* Modes */}
        <section className="pb-20">
          <h2 className="serif text-center text-4xl font-bold tracking-tight md:text-5xl">A tu ritmo de control.</h2>
          <p className="mx-auto mt-4 max-w-2xl text-center text-slate-600">Elige tu enfoque y cámbialo cuando quieras.</p>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {modes.map((mode) => (
              <div
                className={`rounded-3xl p-7 ${mode.recommended ? "border-2 border-[var(--lime)] bg-[rgba(204,255,0,0.1)]" : "glass"}`}
                key={mode.title}
              >
                {mode.recommended && (
                  <span className="mb-3 inline-block rounded-full bg-[var(--lime)] px-3 py-0.5 text-[10px] font-bold uppercase tracking-wider text-black">Recomendado</span>
                )}
                <Landmark className="h-7 w-7 text-[var(--primary)]" />
                <h3 className="serif mt-4 text-2xl font-bold">{mode.title}</h3>
                <p className="mt-2 text-slate-600">{mode.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Final CTA */}
        <section className="pb-24">
          <div className="glass relative overflow-hidden rounded-[2rem] px-8 py-16 text-center">
            <Target className="mx-auto h-10 w-10 text-[var(--primary)]" />
            <h2 className="serif mt-5 text-4xl font-bold tracking-tight md:text-5xl">Empieza tu primer mes hoy.</h2>
            <p className="mx-auto mt-4 max-w-xl text-slate-600">
              Configura tu hogar, define tu plan y registra tu primer movimiento en minutos.
            </p>
            <Link className="mt-8 inline-flex items-center justify-center gap-2 rounded-full bg-[var(--lime)] px-8 py-4 text-base font-bold text-black shadow-sm transition hover:brightness-95" href="/app">
              Crear mi primer mes <ArrowRight className="h-5 w-5" />
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/40 py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-5 text-sm text-slate-500 md:flex-row md:px-8">
          <div className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-full bg-[var(--lime)] text-[10px] font-bold">RM</span>
            <span className="font-semibold text-slate-700">RindoMes</span>
          </div>
          <p>Hecho para que tu dinero rinda. © {new Date().getFullYear()}</p>
          <Link className="font-semibold text-[var(--primary)] hover:underline" href="/app">Entrar a la app →</Link>
        </div>
      </footer>
    </div>
  );
}
