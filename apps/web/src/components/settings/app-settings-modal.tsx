"use client";

import { useState } from "react";
import { Compass, Gamepad2, Library, Mic, Sparkles, User } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils";
import type { PublicUser } from "@aether/shared";
import { AccountTab } from "./account-tab";
import { ActivityTab } from "./activity-tab";
import { ComunidadesTab } from "./comunidades-tab";
import { JogosTab } from "./jogos-tab";
import { PlanoTab } from "./plano-tab";
import { VoiceTab } from "./voice-tab";

/**
 * Configuracoes do APP — diferente das configuracoes do SERVIDOR.
 *
 * A distincao e o motivo de existir: antes havia duas engrenagens fazendo a
 * mesma coisa (as duas abriam as configuracoes do servidor), e nenhuma para o
 * proprio usuario. Agora a de cima, ao lado de "Convidar", e do servidor; a de
 * baixo, ao lado do seu nome, e sua.
 *
 * O que mora aqui vale para VOCE em qualquer servidor — foto, nome, microfone.
 * A unica excecao e o apelido, que e por servidor e por isso diz isso na
 * propria etiqueta.
 */

type Tab = "conta" | "voz" | "atividade" | "plano" | "jogos" | "comunidades";

const TABS: { id: Tab; label: string; icon: typeof User }[] = [
  { id: "conta", label: "Minha conta", icon: User },
  { id: "voz", label: "Voz e video", icon: Mic },
  /**
   * Atividade e aba propria porque deteccao de jogo nao tem relacao nenhuma
   * com microfone. Nasceu dentro de "Voz e video" so por ter sido onde coube
   * na hora — e "onde coube" nao e criterio de organizacao.
   */
  { id: "atividade", label: "Atividade", icon: Gamepad2 },
  /**
   * O plano fica por ULTIMO, e nao no topo.
   *
   * Vender e legitimo; empurrar nao. Quem abre as configuracoes quase sempre
   * vai trocar o microfone ou a foto, e a assinatura no primeiro item faria a
   * tela inteira parecer uma loja.
   */
  { id: "plano", label: "Plano", icon: Sparkles },
];

/**
 * A aba de revisao da biblioteca de jogos, que so a equipe ve.
 *
 * Fora da lista fixa de proposito: nao e uma aba que existe para todo mundo e
 * fica desabilitada — ela simplesmente nao e desenhada para quem nao revisa.
 * Isso e cortesia de interface, e nao seguranca: as actions da aba recusam
 * sozinhas, respondendo como se nao existissem.
 */
const ABAS_DA_EQUIPE = [
  { id: "jogos" as const, label: "Biblioteca", icon: Library },
  { id: "comunidades" as const, label: "Comunidades", icon: Compass },
];

export function AppSettingsModal({
  open,
  onClose,
  user,
  server,
}: {
  open: boolean;
  onClose: () => void;
  /**
   * O usuario publico mais as preferencias de contato. Como extensao de
   * `PublicUser`, e nao campo a campo: a copia repetida obrigava a mexer aqui
   * a cada campo novo do perfil, e foi assim que plano e moldura quase
   * ficaram de fora desta tela.
   */
  user: PublicUser & {
    allowServerDms: boolean;
    allowServerFriendRequests: boolean;
    /**
     * Administracao global. Governa apenas se a aba de revisao APARECE — quem
     * barra de verdade sao as actions, que recheam a regra no servidor.
     */
    equipe: boolean;
  };
  server: { id: string; memberId: string; nickname: string | null };
}) {
  const [active, setActive] = useState<Tab>("conta");

  const abas = user.equipe ? [...TABS, ...ABAS_DA_EQUIPE] : TABS;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Configuracoes"
      description="Sua conta e seus dispositivos."
      /**
       * `w-`, e nao `max-w-`: o Modal define largura FIXA de 440px, e
       * `max-width` so limita — nunca expande. Com `max-w-[760px]` a janela
       * continuava com 440px e o conteudo saia pela lateral, com barra de
       * rolagem horizontal.
       */
      className="w-[min(880px,calc(100vw-3rem))]"
    >
      {/* Altura limitada pela janela: em tela baixa o modal rola por dentro
          em vez de estourar para fora e cortar os botoes de salvar. */}
      <div className="flex h-[min(560px,calc(100vh-12rem))] gap-5">
        {/*
          Menu lateral, e nao abas no topo: a lista deve crescer (aparencia,
          atalhos, notificacoes) sem virar uma fileira apertada.
        */}
        <nav className="flex w-[168px] shrink-0 flex-col gap-0.5 border-r border-base-800 pr-3">
          {abas.map((tab) => {
            const Icon = tab.icon;
            const selected = active === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActive(tab.id)}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] transition-colors",
                  selected
                    ? "bg-base-800 text-ink-100"
                    : "text-ink-400 hover:bg-base-850 hover:text-ink-200",
                )}
              >
                <Icon
                  className={cn(
                    "h-3.5 w-3.5 shrink-0",
                    selected ? "text-accent-400" : "text-ink-500",
                  )}
                />
                {tab.label}
              </button>
            );
          })}
        </nav>

        <div className="min-w-0 flex-1 overflow-y-auto pr-1">
          {active === "conta" ? (
            <AccountTab user={user} server={server} />
          ) : active === "voz" ? (
            <VoiceTab />
          ) : active === "plano" ? (
            <PlanoTab />
          ) : active === "jogos" ? (
            <JogosTab />
          ) : active === "comunidades" ? (
            <ComunidadesTab />
          ) : (
            <ActivityTab />
          )}
        </div>
      </div>
    </Modal>
  );
}
