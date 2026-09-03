import { AetherIcon } from "@/components/ui/aether-icon";
import { PLANS, type PlanTier } from "@aether/shared";
import { cn } from "@/lib/utils";

/**
 * A tabela de comparacao.
 *
 * OS NUMEROS VEM DE `packages/shared/plans.ts`, e nao de uma lista aqui.
 *
 * A versao anterior desta tela trazia a propria lista, e ela ja divergia do
 * resto do sistema: prometia 500 MB onde o plano da 250, e "ate 4K/60fps" onde
 * o plano da 1080p. Isso nao e detalhe de texto — e a diferenca entre o que a
 * pessoa compra e o que ela recebe, e quem descobre a diferenca descobre
 * depois de pagar.
 *
 * Por isso a tabela agora LE a mesma fonte que o servidor vai usar para
 * barrar. Se um dia divergirem, terao divergido no lugar certo: um so.
 */

/**
 * O que ainda NAO existe.
 *
 * Fica separado dos numeros de verdade de proposito. Sao coisas que queremos
 * construir, e mistura-las com o que ja funciona transformaria a tabela numa
 * promessa — a pessoa pagaria hoje por emoji animado que nao existe.
 */
export interface RecursoPlanejado {
  nome: string;
  /** o plano a partir do qual entra, quando existir */
  a_partir_de: PlanTier;
}

export const RECURSOS_PLANEJADOS: RecursoPlanejado[] = [
  { nome: "Selo no perfil", a_partir_de: "PLUS" },
  { nome: "Avatar animado", a_partir_de: "PLUS" },
  { nome: "Banner de perfil", a_partir_de: "PLUS" },
  { nome: "Molduras de avatar", a_partir_de: "PRO" },
  { nome: "Emojis animados em qualquer servidor", a_partir_de: "PLUS" },
  { nome: "Acesso antecipado a novidades", a_partir_de: "PRO" },
];

const COLUNAS: PlanTier[] = ["FREE", "PLUS", "PRO"];

function formatarBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${Math.round(mb / 1024)} GB` : `${Math.round(mb)} MB`;
}

export function ComparisonTable({
  tierAtual,
  className,
}: {
  tierAtual?: PlanTier;
  className?: string;
}) {
  const linhas: { nome: string; valor: (t: PlanTier) => string }[] = [
    {
      nome: "Qualidade da tela",
      valor: (t) => `${PLANS[t].alturaMax}p / ${PLANS[t].quadrosMax}fps`,
    },
    {
      nome: "Bitrate da transmissão",
      valor: (t) =>
        `${(PLANS[t].bitrateMax / 1_000_000).toLocaleString("pt-BR")} Mbps`,
    },
    {
      nome: "Telas ao mesmo tempo",
      valor: (t) => String(PLANS[t].telasSimultaneas),
    },
    {
      nome: "Envio de arquivo",
      valor: (t) => formatarBytes(PLANS[t].uploadMaxBytes),
    },
  ];

  return (
    <div
      className={cn(
        "w-full overflow-hidden rounded-lg border border-line bg-base-900/70",
        className,
      )}
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[460px] text-left text-[13px] text-ink-200">
          <thead>
            <tr className="border-b border-line bg-base-850/80 text-[11px] font-semibold uppercase tracking-wider text-ink-400">
              <th className="px-4 py-3">Recurso</th>
              {COLUNAS.map((t) => (
                <th
                  key={t}
                  className={cn(
                    "w-32 px-4 py-3 text-center",
                    t === "FREE" ? "text-ink-400" : "text-amber-300",
                  )}
                >
                  {PLANS[t].rotulo}
                  {t === tierAtual ? (
                    <span className="ml-1 normal-case text-accent-300">
                      (seu)
                    </span>
                  ) : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {linhas.map((linha) => (
              <tr
                key={linha.nome}
                className="transition-colors hover:bg-base-800/50"
              >
                <td className="px-4 py-3 font-medium text-ink-100">
                  {linha.nome}
                </td>
                {COLUNAS.map((t) => (
                  <td
                    key={t}
                    className={cn(
                      "px-4 py-3 text-center",
                      t === tierAtual
                        ? "font-medium text-ink-100"
                        : t === "FREE"
                          ? "text-ink-400"
                          : "text-ink-200",
                    )}
                  >
                    {linha.valor(t)}
                  </td>
                ))}
              </tr>
            ))}

            {/*
              A partir daqui e o que NAO existe, e a tabela diz isso em vez de
              deixar a pessoa supor. Uma linha de separacao com o aviso custa
              menos que um pedido de reembolso.
            */}
            <tr className="bg-base-850/60">
              <td
                colSpan={COLUNAS.length + 1}
                className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-ink-500"
              >
                Em construção — ainda não disponível
              </td>
            </tr>
            {RECURSOS_PLANEJADOS.map((recurso) => (
              <tr key={recurso.nome} className="opacity-60">
                <td className="px-4 py-3 text-ink-300">{recurso.nome}</td>
                {COLUNAS.map((t) => (
                  <td key={t} className="px-4 py-3 text-center">
                    {PLANS[t].tier !== "FREE" &&
                    (recurso.a_partir_de === "PLUS" || t === "PRO") ? (
                      <AetherIcon
                        name="check"
                        className="mx-auto h-4 w-4 text-ink-500"
                      />
                    ) : (
                      <span className="text-ink-600">—</span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
