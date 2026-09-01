import { notFound } from "next/navigation";
import { ehEquipe } from "@aether/access";
import { getSession } from "@/server/auth/session";
import { EquipePanel } from "@/components/equipe/equipe-panel";

/**
 * Painel da equipe — fora de `/app/s/[serverId]` pela mesma razao de
 * "Explorar comunidades": e trabalho que nao pertence a nenhum servidor
 * especifico, entao estar dentro de um nao faria sentido.
 *
 * SO A EQUIPE ENTRA. Responde 404, e nao 403 — a mesma regra de qualquer
 * outro recurso do projeto: acesso indevido nao confirma que o recurso
 * existe. Quem nao e equipe e quem chutar a URL recebem a mesma coisa.
 */
export const metadata = { title: "Painel da equipe" };

export default async function EquipePage() {
  const sessao = await getSession();
  if (!ehEquipe(sessao)) notFound();

  return <EquipePanel />;
}
