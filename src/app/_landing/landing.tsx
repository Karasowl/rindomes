import Link from "next/link";
import { ArrowRight, Camera, Check, PenLine, PieChart, Repeat, ReceiptText, Sparkles, TrendingUp } from "lucide-react";
import { Hero } from "./hero";
import { Navbar } from "./navbar";

const CAPTURE_WAYS = [
  { icon: PenLine, title: "Escribir", body: "“súper 2,400 en Bravo”. En lenguaje natural; la app extrae monto, cuenta y categoría." },
  { icon: Sparkles, title: "Con IA", body: "Pega o dicta el gasto y la IA lo clasifica y lo deja listo para confirmar." },
  { icon: Camera, title: "Recibo", body: "Saca foto a la factura: la IA lee el detalle, incluso línea por línea." },
];

const INSIGHTS = [
  { icon: PieChart, title: "En qué se va", body: "Tus categorías por gasto real, con el detalle concreto de cada una —no etiquetas vagas." },
  { icon: TrendingUp, title: "Qué es inusual", body: "Avisos suaves cuando un gasto se sale de tu promedio o algo cambió este mes." },
  { icon: Repeat, title: "Qué se repite", body: "Detecta lo recurrente (suscripciones, cuotas, súper semanal) por ti." },
];

const FREE_FEATURES = ["Registro ilimitado", "Captura manual + reglas locales", "Insights del mes en lenguaje claro", "Efectivo y multi-moneda"];
const PRO_FEATURES = ["Todo lo de Gratis", "Lectura de recibos con IA", "Insights avanzados y tendencias", "Multi-espacio y miembros del hogar"];

const FAQ = [
  { q: "¿Necesito conectar mi banco?", a: "No. RindoMes es manual-first: registras tu dinero real, efectivo incluido, sin depender de sincronización bancaria." },
  { q: "¿Funciona sin IA?", a: "Sí. La captura manual y las reglas locales son gratis y siempre están disponibles; la IA es opcional (Pro)." },
  { q: "¿Tengo que presupuestar todo antes de empezar?", a: "No. Empiezas solo registrando. El presupuesto es opcional, para cuando lo quieras." },
  { q: "¿Mis datos están seguros?", a: "Viven en tu hogar financiero y tú controlas qué se sincroniza. Nada decorativo: son tus números reales." },
];

export function Landing() {
  return (
    <div className="relative w-full" style={{ color: "#1d1b1a" }}>
      <Navbar />

      <main>
        {/* HERO · pantalla completa con video de fondo */}
        <section id="top" className="relative min-h-screen w-full overflow-hidden">
          <div suppressHydrationWarning className="absolute inset-0 z-0 overflow-hidden">
            <video
              suppressHydrationWarning
              className="h-full w-full object-cover"
              autoPlay
              muted
              loop
              playsInline
              poster="/hero-poster.jpg"
              src="/hero-loop.mp4"
            />
            <div
              className="absolute inset-0"
              style={{
                background:
                  "linear-gradient(100deg, rgba(254,248,245,0.92) 0%, rgba(254,248,245,0.58) 40%, rgba(254,248,245,0.14) 72%, rgba(254,248,245,0.04) 100%)",
              }}
            />
          </div>
          <div className="relative z-10 mx-auto w-full max-w-[1280px] px-5 sm:px-8" style={{ paddingTop: "clamp(120px, 18vh, 200px)" }}>
            <Hero />
          </div>
        </section>

        {/* SECCIONES · fondo crema, scrollables y enlazadas desde el navbar */}
        <div className="relative mesh-bg">
          {/* Captura */}
          <section id="captura" className="mx-auto w-full max-w-[1280px] scroll-mt-24 px-5 py-24 sm:px-8">
            <p className="kicker">Captura</p>
            <h2 className="serif mt-3 max-w-3xl text-4xl font-bold tracking-tight md:text-5xl">Una sola entrada. Tú eliges cómo.</h2>
            <p className="mt-4 max-w-2xl text-slate-600">
              Escribe, dicta o saca foto al recibo. RindoMes guarda <strong className="text-[#1d1b1a]">exactamente qué fue</strong> cada gasto
              —no una etiqueta vaga— y lo clasifica solo. Tú solo confirmas y sigues.
            </p>
            <div className="mt-12 grid gap-6 md:grid-cols-3">
              {CAPTURE_WAYS.map((item) => {
                const Icon = item.icon;
                return (
                  <div className="glass rounded-[1.75rem] p-7" key={item.title}>
                    <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[rgba(204,255,0,0.25)] text-[var(--primary)]">
                      <Icon className="h-6 w-6" />
                    </span>
                    <h3 className="serif mt-5 text-2xl font-bold">{item.title}</h3>
                    <p className="mt-2 text-slate-600">{item.body}</p>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Insights */}
          <section id="insights" className="mx-auto w-full max-w-[1280px] scroll-mt-24 px-5 py-24 sm:px-8">
            <p className="kicker">Insights</p>
            <h2 className="serif mt-3 max-w-3xl text-4xl font-bold tracking-tight md:text-5xl">Inteligencia, no solo registros.</h2>
            <p className="mt-4 max-w-2xl text-slate-600">
              Tu Inicio te dice qué pasa con tu plata en lenguaje claro, sin que armes ni una tabla.
            </p>
            <div className="mt-12 grid gap-6 md:grid-cols-3">
              {INSIGHTS.map((item) => {
                const Icon = item.icon;
                return (
                  <div className="glass rounded-[1.75rem] p-7" key={item.title}>
                    <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[rgba(204,255,0,0.25)] text-[var(--primary)]">
                      <Icon className="h-6 w-6" />
                    </span>
                    <h3 className="serif mt-5 text-2xl font-bold">{item.title}</h3>
                    <p className="mt-2 text-slate-600">{item.body}</p>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Precios */}
          <section id="precios" className="mx-auto w-full max-w-[1280px] scroll-mt-24 px-5 py-24 sm:px-8">
            <p className="kicker">Precios</p>
            <h2 className="serif mt-3 max-w-3xl text-4xl font-bold tracking-tight md:text-5xl">Empieza gratis. Sube a Pro cuando quieras.</h2>
            <div className="mt-12 grid gap-6 md:grid-cols-2">
              {/* Gratis */}
              <div className="glass rounded-[1.75rem] p-8">
                <h3 className="serif text-2xl font-bold">Gratis</h3>
                <p className="mt-1 text-slate-600">Para llevar tu mes con claridad, sin pagar nada.</p>
                <ul className="mt-6 space-y-3">
                  {FREE_FEATURES.map((feat) => (
                    <li className="flex items-start gap-2.5 text-slate-700" key={feat}>
                      <Check className="mt-0.5 h-5 w-5 shrink-0 text-[var(--primary)]" /> {feat}
                    </li>
                  ))}
                </ul>
                <Link href="/app" className="mt-8 inline-flex rounded-full px-6 py-3 text-sm font-bold transition-opacity hover:opacity-80" style={{ background: "#F4EEE6", color: "#1d1b1a" }}>
                  Empezar gratis
                </Link>
              </div>
              {/* Pro */}
              <div className="rounded-[1.75rem] border-2 border-[var(--lime)] bg-[rgba(204,255,0,0.1)] p-8">
                <span className="mb-3 inline-block rounded-full bg-[var(--lime)] px-3 py-0.5 text-[10px] font-bold uppercase tracking-wider text-black">Recomendado</span>
                <h3 className="serif text-2xl font-bold">Pro</h3>
                <p className="mt-1 text-slate-600">Cuando quieres que la IA haga el trabajo pesado.</p>
                <ul className="mt-6 space-y-3">
                  {PRO_FEATURES.map((feat) => (
                    <li className="flex items-start gap-2.5 text-slate-700" key={feat}>
                      <Check className="mt-0.5 h-5 w-5 shrink-0 text-[var(--primary)]" /> {feat}
                    </li>
                  ))}
                </ul>
                <Link href="/app" className="mt-8 inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-bold transition-transform hover:-translate-y-0.5" style={{ background: "#ccff00", color: "#1d1b1a" }}>
                  Probar Pro <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
          </section>

          {/* Ayuda */}
          <section id="ayuda" className="mx-auto w-full max-w-[1280px] scroll-mt-24 px-5 py-24 sm:px-8">
            <p className="kicker">Ayuda</p>
            <h2 className="serif mt-3 max-w-3xl text-4xl font-bold tracking-tight md:text-5xl">¿Dudas? Resolvemos rápido.</h2>
            <div className="mt-10 grid gap-3">
              {FAQ.map((item) => (
                <details className="glass group rounded-2xl px-6 py-4" key={item.q}>
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold">
                    {item.q}
                    <span className="serif text-2xl text-[var(--primary)] transition-transform group-open:rotate-45">+</span>
                  </summary>
                  <p className="mt-3 text-slate-600">{item.a}</p>
                </details>
              ))}
            </div>

            {/* CTA final */}
            <div className="glass mt-16 overflow-hidden rounded-[2rem] px-8 py-16 text-center">
              <ReceiptText className="mx-auto h-10 w-10 text-[var(--primary)]" />
              <h2 className="serif mt-5 text-4xl font-bold tracking-tight md:text-5xl">
                Tu próximo mes empieza <span className="italic">con un gasto.</span>
              </h2>
              <p className="mx-auto mt-4 max-w-xl text-slate-600">Sin configurar hojas. Registra el primero y deja que la app haga la inteligencia.</p>
              <Link href="/app" className="group mt-8 inline-flex items-center justify-center gap-2 rounded-full px-9 py-4 text-base font-bold transition-transform hover:-translate-y-0.5" style={{ background: "#ccff00", color: "#1d1b1a", boxShadow: "0 10px 30px rgba(80,102,0,0.28)" }}>
                Empezar gratis <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
              </Link>
            </div>
          </section>

          <footer className="border-t border-white/40 py-10">
            <div className="mx-auto flex w-full max-w-[1280px] flex-col items-center justify-between gap-4 px-5 text-sm text-slate-500 sm:px-8 md:flex-row">
              <div className="flex items-center gap-2">
                <span className="grid h-7 w-7 place-items-center rounded-full bg-[var(--lime)] text-[10px] font-bold">RM</span>
                <span className="font-semibold text-slate-700">RindoMes</span>
              </div>
              <p>Hecho para que tu dinero rinda. © {new Date().getFullYear()}</p>
              <Link className="font-semibold text-[var(--primary)] hover:underline" href="/app">Entrar a la app →</Link>
            </div>
          </footer>
        </div>
      </main>
    </div>
  );
}
