/**
 * Maquete decorativa do app na landing — puro markup, sem imagem nem dado
 * real. `aria-hidden` no elemento pai; nao e navegavel.
 *
 * Reconstruida do OpenDesign com os tokens do `@theme`. As duas animacoes
 * (respiro do avatar, equalizador) vêm de `globals.css` (`.vc-breathe`,
 * `.vc-eq`) e ja respeitam `prefers-reduced-motion`.
 */

const MENSAGENS = [
  { nome: "Marina", hora: "22:14", texto: "entrei na mesa 1, sobe quem quiser" },
  { nome: "Téo", hora: "22:15", texto: "compartilha a tela que eu revejo o round" },
  {
    nome: "Rafa",
    hora: "22:16",
    texto: "deixo o clipe no canal depois — o histórico não some quando a call cai",
  },
];

export function AppMockup() {
  return (
    <div className="relative" aria-hidden="true">
      <div className="grid h-[340px] grid-cols-[54px_176px_1fr] overflow-hidden rounded-lg border border-line bg-base-800 text-[13px] shadow-[0_40px_90px_-28px_rgba(0,0,0,0.7)] max-[920px]:grid-cols-[46px_1fr]">
        {/* trilho de servidores */}
        <div className="flex flex-col items-center gap-2.5 border-r border-line bg-base-950 py-3">
          <div className="grid h-8 w-8 place-items-center rounded-[11px] bg-accent-500/25 font-brand text-xs font-semibold text-ink-100 shadow-[0_0_0_2px_var(--color-accent-500)]">
            A
          </div>
          {["LB", "VZ"].map((s) => (
            <div
              key={s}
              className="grid h-8 w-8 place-items-center rounded-[11px] bg-white/[0.06] font-brand text-xs font-semibold text-ink-400"
            >
              {s}
            </div>
          ))}
          <div className="grid h-8 w-8 place-items-center rounded-[11px] bg-white/[0.06] text-ink-500">
            +
          </div>
        </div>

        {/* sidebar de canais */}
        <div className="border-r border-line bg-base-900 p-3 max-[920px]:hidden">
          <div className="border-b border-line px-1.5 pb-3 font-brand text-[13px] font-semibold text-ink-100">
            Squad da madrugada
          </div>
          <p className="mx-1.5 mb-1.5 mt-4 font-mono text-[9.5px] uppercase tracking-[0.12em] text-ink-400">
            Texto
          </p>
          {[
            ["geral", true],
            ["clipes", false],
            ["estratégia", false],
          ].map(([nome, ativo]) => (
            <div
              key={nome as string}
              className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs ${
                ativo ? "bg-white/[0.07] text-ink-100" : "text-ink-400"
              }`}
            >
              <span className="text-ink-500">#</span>
              {nome}
            </div>
          ))}
          <p className="mx-1.5 mb-1.5 mt-4 font-mono text-[9.5px] uppercase tracking-[0.12em] text-ink-400">
            Voz
          </p>
          <div className="mt-1 rounded-lg bg-accent-500/10 px-2 py-1.5">
            {[
              ["Marina", true],
              ["Téo", false],
              ["Rafa", false],
            ].map(([nome, live]) => (
              <div
                key={nome as string}
                className={`flex items-center gap-1.5 px-1.5 py-[3px] text-[11.5px] ${
                  live ? "text-ink-100" : "text-ink-400"
                }`}
              >
                <span
                  className={`h-4 w-4 flex-none rounded-full bg-white/[0.07] ${
                    live
                      ? "shadow-[0_0_0_2px_color-mix(in_oklch,var(--color-accent-500)_60%,transparent)]"
                      : ""
                  }`}
                />
                {nome}
              </div>
            ))}
          </div>
        </div>

        {/* chat */}
        <div className="flex min-w-0 flex-col">
          <div className="border-b border-line px-4 py-3 font-brand text-[13px] font-semibold text-ink-100">
            # geral
          </div>
          <div className="flex flex-1 flex-col gap-4 overflow-hidden p-4">
            {MENSAGENS.map((m) => (
              <div key={m.nome} className="grid grid-cols-[30px_1fr] gap-2.5">
                <div className="h-[30px] w-[30px] rounded-full bg-gradient-to-br from-accent-500/40 to-base-750" />
                <div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-xs font-semibold text-ink-100">
                      {m.nome}
                    </span>
                    <span className="font-mono text-[9.5px] text-ink-400">
                      {m.hora}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs leading-relaxed text-ink-400">
                    {m.texto}
                  </p>
                </div>
              </div>
            ))}
          </div>
          <div className="mx-4 mb-4 rounded-[10px] border border-line px-3 py-2.5 text-xs text-ink-500">
            Mensagem em #geral
          </div>
        </div>
      </div>

      {/* card de voz flutuante */}
      <div className="absolute bottom-10 right-[-28px] w-[210px] rounded-lg border border-line bg-base-750 p-4 shadow-[0_30px_60px_-18px_rgba(0,0,0,0.65)] max-[920px]:bottom-[-26px] max-[920px]:right-1.5 max-[920px]:w-[190px] max-[460px]:hidden">
        <div className="flex items-center gap-3">
          <div className="vc-breathe h-[42px] w-[42px] flex-none rounded-full bg-gradient-to-br from-accent-500/60 to-base-800" />
          <div>
            <div className="text-[13px] font-semibold text-ink-100">Marina</div>
            <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.06em] text-accent-300">
              Falando · Mesa 1
            </div>
          </div>
        </div>
        <div className="vc-eq mt-3 flex h-[22px] items-end gap-[3px]">
          {Array.from({ length: 7 }).map((_, i) => (
            <i
              key={i}
              className="flex-1 rounded-[2px] bg-accent-500/60"
              style={{ height: "45%" }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
