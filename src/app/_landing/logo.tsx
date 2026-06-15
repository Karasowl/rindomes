/** Marca RindoMes: el badge "RM" en lima + el wordmark serif itálico, igual que en la app. */
export function Logo() {
  return (
    <span className="flex items-center gap-2.5">
      <span className="grid h-9 w-9 place-items-center rounded-full border border-white/80 bg-[#ccff00] text-xs font-bold text-[#1d1b1a] shadow-sm">
        RM
      </span>
      <span className="serif text-2xl font-bold italic tracking-tight text-[#1d1b1a]">RindoMes</span>
    </span>
  );
}
