"use client";

import { useEffect, useState } from "react";
import { AetherIcon } from "@/components/ui/aether-icon";
import { SkeletonRows } from "@/components/ui/skeleton";
import { listarAuditoriaGlobalAction } from "@/server/actions/auditoria";
import type { EntradaDeAuditoriaGlobal } from "@/server/audit";

/**
 * Rastro pesquisavel das acoes GLOBAIS da equipe — a lacuna que outras abas
 * ja apontavam ("sem log de auditoria global ainda"). So mostra o que
 * aconteceu; nenhuma acao é disparada daqui.
 */

const ROTULO_ACAO: Record<string, string> = {
  "global.flag_alterada": "Kill switch alterado",
  "global.chave_criada": "Chave de plano gerada",
  "global.chave_revogada": "Chave de plano revogada",
  "global.cosmetico_criado": "Cosmético criado",
  "global.cosmetico_editado": "Cosmético editado",
  "global.cosmetico_excluido": "Cosmético excluído",
  "global.cosmetico_publicado": "Cosmético publicado/despublicado",
  "global.moedas_concedidas": "Moedas enviadas/retiradas",
  "global.aplicacao_bloqueada": "Aplicação bloqueada",
  "global.aplicacao_desbloqueada": "Aplicação desbloqueada",
  "global.usuario_silenciado": "Usuário silenciado",
  "global.silenciamento_removido": "Silenciamento removido",
  "global.mensagem_apagada_moderacao": "Mensagem apagada (moderação)",
};

/** Cor por classe de acao — destrutivo em vermelho, o resto neutro. */
const ACOES_DESTRUTIVAS = new Set([
  "global.chave_revogada",
  "global.cosmetico_excluido",
  "global.aplicacao_bloqueada",
  "global.usuario_silenciado",
  "global.mensagem_apagada_moderacao",
]);

export function AuditoriaTab() {
  const [itens, setItens] = useState<EntradaDeAuditoriaGlobal[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    void listarAuditoriaGlobalAction().then((r) => {
      if (r.ok) setItens(r.data);
      else setErro(r.error);
    });
  }, []);

  if (erro) return <p className="text-[13px] text-signal-dnd">{erro}</p>;
  if (itens === null) return <SkeletonRows count={6} />;
  if (itens.length === 0) {
    return (
      <p className="text-[13px] text-ink-500">
        Nenhuma ação global registrada ainda.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[12px] leading-snug text-ink-500">
        Ações da equipe que não pertencem a um servidor específico — kill
        switches, chaves de plano, cosméticos, bloqueio de aplicação,
        moderação de usuário/mensagem. Ações de servidor (canal, cargo,
        banimento) ficam no log de auditoria do próprio servidor.
      </p>
      <ul className="flex flex-col gap-1.5">
        {itens.map((item) => (
          <li
            key={item.id}
            className="flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-md border border-line bg-base-800 px-3 py-2 text-[12px]"
          >
            <AetherIcon
              name={ACOES_DESTRUTIVAS.has(item.action) ? "alert" : "shield-check"}
              className={
                "h-3.5 w-3.5 shrink-0 " +
                (ACOES_DESTRUTIVAS.has(item.action)
                  ? "text-signal-dnd"
                  : "text-ink-500")
              }
            />
            <span className="font-medium text-ink-100">
              {ROTULO_ACAO[item.action] ?? item.action}
            </span>
            <span className="text-ink-500">
              por {item.actorUsername ? `@${item.actorUsername}` : "conta removida"}
            </span>
            {item.targetId ? (
              <span className="font-mono text-[11px] text-ink-500">
                {item.targetType ?? "alvo"}:{item.targetId.slice(0, 12)}
              </span>
            ) : null}
            {item.metadata ? (
              <span className="font-mono text-[11px] text-ink-500">
                {Object.entries(item.metadata)
                  .filter(([, v]) => v !== null && v !== undefined)
                  .map(([k, v]) => `${k}=${String(v)}`)
                  .join(" · ")}
              </span>
            ) : null}
            <span className="ml-auto text-ink-500">
              {new Date(item.createdAt).toLocaleString("pt-BR", {
                day: "2-digit",
                month: "2-digit",
                year: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
