"use client";

import { useCallback, useEffect, useState } from "react";
import { AetherIcon, type AetherIconName } from "@/components/ui/aether-icon";
import { rotuloDeRevisoes, type RevisoesPendentes } from "@aether/shared";
import { contarRevisoesAction } from "@/server/actions/revisao";
import { cn } from "@/lib/utils";
import { JogosTab } from "./jogos-tab";
import { ComunidadesTab } from "./comunidades-tab";
import { ChavesTab } from "./chaves-tab";
import { FlagsTab } from "./flags-tab";
import { DenunciasTab } from "./denuncias-tab";
import { CosmeticosTab } from "./cosmeticos-tab";
import { AplicativosTab } from "./aplicativos-tab";
import { AuditoriaTab } from "./auditoria-tab";

type Aba =
  | "denuncias"
  | "jogos"
  | "comunidades"
  | "cosmeticos"
  | "chaves"
  | "flags"
  | "aplicativos"
  | "auditoria";

const ABAS: { id: Aba; rotulo: string; icone: AetherIconName }[] = [
  { id: "denuncias", rotulo: "Denúncias", icone: "shield-check" },
  { id: "jogos", rotulo: "Biblioteca de jogos", icone: "library" },
  { id: "comunidades", rotulo: "Comunidades", icone: "compass" },
  { id: "cosmeticos", rotulo: "Cosméticos", icone: "sparkle" },
  { id: "chaves", rotulo: "Chaves de plano", icone: "key" },
  { id: "flags", rotulo: "Kill switches", icone: "shield" },
  { id: "aplicativos", rotulo: "Aplicativos", icone: "lock" },
  { id: "auditoria", rotulo: "Auditoria global", icone: "shield-check" },
];

/**
 * Painel da equipe: pagina propria, e nao mais uma aba escondida dentro de
 * "Configuracoes".
 *
 * POR QUE MUDOU DE LUGAR: aprovar quem entra na vitrine ou o que vira jogo
 * reconhecido e trabalho de MODERACAO, nao ajuste de conta pessoal — e
 * morava junto porque foi onde coube na hora, nao porque fizesse sentido
 * estar la. Isolado numa aba de configuracoes pessoais, ninguem descobria
 * sem saber que ela existia; a primeira vez que isto foi medido de verdade,
 * havia quatro pedidos parados (tres jogos, um de vitrine) sem que ninguem
 * soubesse.
 *
 * A pagina em si (`/app/equipe/page.tsx`) e quem barra: sem `equipe`, ela
 * responde 404, como qualquer outro recurso que nao revelamos existir. Isto
 * aqui e so o desenho de dentro.
 */
/** Quantas dessas abas tem contador de pendencia. */
const COM_CONTADOR: Record<string, keyof RevisoesPendentes> = {
  denuncias: "denuncias",
  jogos: "jogos",
  comunidades: "comunidades",
};

export function EquipePanel() {
  const [aba, setAba] = useState<Aba>("denuncias");
  const [revisoes, setRevisoes] = useState<RevisoesPendentes | null>(null);

  const buscarContagem = useCallback(() => {
    contarRevisoesAction().then((r) => {
      if (r.ok) setRevisoes(r.data);
    });
  }, []);

  useEffect(() => {
    buscarContagem();
  }, [buscarContagem]);

  /** Atualiza uma das contagens sem apagar as outras. */
  const setContagem = useCallback(
    (chave: keyof RevisoesPendentes, n: number) =>
      setRevisoes((r) => ({
        jogos: 0,
        comunidades: 0,
        denuncias: 0,
        ...r,
        [chave]: n,
      })),
    [],
  );

  return (
    <div className="mx-auto flex h-full w-full max-w-[720px] flex-col gap-6 overflow-y-auto px-6 py-8">
      <div>
        <h1 className="text-lg font-semibold text-ink-100">Painel da equipe</h1>
        <p className="mt-1 text-[13px] text-ink-400">
          O que a comunidade sugeriu, esperando sua decisao.
        </p>
      </div>

      <div className="flex gap-1 border-b border-line pb-px">
        {ABAS.map((item) => {
          const nomeIcone = item.icone;
          const selected = aba === item.id;
          const chave = COM_CONTADOR[item.id];
          const esperando = chave ? (revisoes?.[chave] ?? 0) : 0;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setAba(item.id)}
              className={cn(
                "flex items-center gap-2 rounded-t-md px-3 py-2 text-[13px] transition-colors",
                selected
                  ? "border-b-2 border-accent-500 text-ink-100"
                  : "text-ink-400 hover:text-ink-200",
              )}
            >
              <AetherIcon name={nomeIcone} className="h-3.5 w-3.5" />
              {item.rotulo}
              {esperando > 0 ? (
                <span className="rounded-full bg-amber-400/15 px-1.5 text-[10px] font-semibold leading-[16px] text-amber-300">
                  {rotuloDeRevisoes(esperando)}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="min-h-0 flex-1">
        {aba === "denuncias" ? (
          <DenunciasTab onAbertas={(n) => setContagem("denuncias", n)} />
        ) : aba === "jogos" ? (
          <JogosTab onPendentes={(n) => setContagem("jogos", n)} />
        ) : aba === "comunidades" ? (
          <ComunidadesTab onPendentes={(n) => setContagem("comunidades", n)} />
        ) : aba === "cosmeticos" ? (
          <CosmeticosTab />
        ) : aba === "chaves" ? (
          <ChavesTab />
        ) : aba === "flags" ? (
          <FlagsTab />
        ) : aba === "aplicativos" ? (
          <AplicativosTab />
        ) : (
          <AuditoriaTab />
        )}
      </div>
    </div>
  );
}
