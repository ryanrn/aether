"use client";

import { useEffect, useState, useTransition } from "react";
import { AetherIcon, type AetherIconName } from "@/components/ui/aether-icon";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils";
import type { PublicUser } from "@aether/shared";
import { logoutAction } from "@/server/actions/auth";
import { podeAtualizar } from "@/lib/desktop/update";
import { AccountTab } from "./account-tab";
import { ActivityTab } from "./activity-tab";
import { AparenciaTab } from "./aparencia-tab";
import { AcessibilidadeTab } from "./acessibilidade-tab";
import { ConexoesTab } from "./conexoes-tab";
import { EsteComputadorTab } from "./este-computador-tab";
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
 *
 * Layout do redesign v2: modal de altura cheia, coluna lateral com grupos
 * ("Usuario" / "Assinatura") e um cabecalho que troca por aba.
 */

export type Tab =
  | "conta"
  | "voz"
  | "aparencia"
  | "acessibilidade"
  | "atividade"
  | "conexoes"
  | "computador"
  | "plano";

const TABS: {
  id: Tab;
  label: string;
  icon: AetherIconName;
  grupo: "Usuario" | "Apps conectados" | "Aplicativo" | "Assinatura";
  titulo: string;
  sub: string;
  /**
   * Aba que so existe no aplicativo de desktop. No navegador ela nem e
   * montada — melhor nao existir do que existir vazia.
   */
  soNoDesktop?: boolean;
}[] = [
  {
    id: "conta",
    label: "Minha conta",
    icon: "user",
    grupo: "Usuario",
    titulo: "Minha conta",
    sub: "Sua conta e seus dispositivos.",
  },
  {
    id: "voz",
    label: "Voz e video",
    icon: "mic",
    grupo: "Usuario",
    titulo: "Voz e video",
    sub: "Microfone, fones e o teste de som.",
  },
  {
    id: "aparencia",
    label: "Aparencia",
    icon: "palette",
    grupo: "Usuario",
    titulo: "Aparencia",
    sub: "Como o chat se parece — densidade, fonte, espacamento.",
  },
  {
    id: "acessibilidade",
    label: "Acessibilidade",
    icon: "activity",
    grupo: "Usuario",
    titulo: "Acessibilidade",
    sub: "Escala da interface, contraste e movimento.",
  },
  {
    id: "atividade",
    label: "Atividade",
    icon: "gamepad",
    grupo: "Usuario",
    titulo: "Atividade",
    sub: "O que os amigos veem que voce esta fazendo.",
  },
  {
    id: "conexoes",
    label: "Conexoes",
    icon: "link",
    grupo: "Apps conectados",
    titulo: "Apps conectados",
    sub: "Contas de outros servicos ligadas a sua.",
  },
  {
    id: "computador",
    label: "Este computador",
    icon: "monitor",
    grupo: "Aplicativo",
    titulo: "Este computador",
    sub: "O que vale so nesta maquina.",
    soNoDesktop: true,
  },
  {
    id: "plano",
    label: "Plano",
    icon: "sparkle",
    grupo: "Assinatura",
    titulo: "Plano",
    sub: "Sua assinatura e o que ela libera.",
  },
];

export function AppSettingsModal({
  open,
  onClose,
  user,
  server,
  abaInicial,
}: {
  open: boolean;
  onClose: () => void;
  user: PublicUser & {
    allowServerDms: boolean;
    allowServerFriendRequests: boolean;
  };
  /**
   * O servidor aberto, so para o campo "apelido neste servidor". `null` quando
   * as configuracoes sao abertas de fora de um servidor (trilha lateral) — ai
   * o apelido some e o resto (que e tudo global) continua igual.
   */
  server: { id: string; memberId: string; nickname: string | null } | null;
  /** aba a abrir quando o modal e mostrado (ex.: volta do OAuth do Spotify) */
  abaInicial?: Tab;
}) {
  const [active, setActive] = useState<Tab>("conta");
  const [saindo, sairTransition] = useTransition();

  useEffect(() => {
    if (open && abaInicial) setActive(abaInicial);
  }, [open, abaInicial]);

  /**
   * Abas visiveis AQUI.
   *
   * `podeAtualizar()` toca `window.aetherDesktop`, que nao existe no
   * servidor — por isso so depois de montar, senao a marcacao do servidor e a
   * do cliente divergem e o React reclama de hidratacao.
   */
  const [noDesktop, setNoDesktop] = useState(false);
  useEffect(() => setNoDesktop(podeAtualizar()), []);
  const visiveis = TABS.filter((t) => !t.soNoDesktop || noDesktop);

  const atual = visiveis.find((t) => t.id === active) ?? visiveis[0]!;
  // Grupo sem nenhuma aba visivel nao rende cabecalho solto.
  const grupos = (
    ["Usuario", "Apps conectados", "Aplicativo", "Assinatura"] as const
  ).filter(
    (g) => visiveis.some((t) => t.grupo === g),
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Configuracoes"
      bare
      className="h-[min(760px,92vh)] w-[min(980px,calc(100vw-2.5rem))] max-w-none overflow-hidden rounded-xl"
    >
      <div className="grid h-full grid-cols-[232px_1fr] max-[900px]:grid-cols-1">
        {/*
          Coluna lateral — grupos e abas. Vira uma fileira rolavel no celular.
        */}
        <nav
          role="tablist"
          aria-label="Secoes das configuracoes"
          className="flex min-h-0 flex-col overflow-y-auto border-r border-line bg-base-850 px-3 py-5 max-[900px]:flex-row max-[900px]:overflow-x-auto max-[900px]:border-b max-[900px]:border-r-0 max-[900px]:py-3"
        >
          <p className="px-3 pb-3 font-brand text-[11px] font-bold uppercase tracking-[0.14em] text-ink-400 max-[900px]:hidden">
            Configuracoes
          </p>
          {grupos.map((g) => (
            <div key={g} className="max-[900px]:contents">
              <p className="px-3 pb-2 pt-4 font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-400 max-[900px]:hidden">
                {g}
              </p>
              {visiveis.filter((t) => t.grupo === g).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active === tab.id}
                  onClick={() => setActive(tab.id)}
                  className={cn(
                    "flex h-[38px] shrink-0 items-center gap-3 rounded-sm px-3 text-[14px] font-medium transition-colors max-[900px]:whitespace-nowrap",
                    active === tab.id
                      ? "bg-accent-500/12 text-accent-300"
                      : "text-ink-300 hover:bg-base-750 hover:text-ink-200",
                  )}
                >
                  <AetherIcon
                    name={tab.icon}
                    className="h-[17px] w-[17px] shrink-0"
                  />
                  {tab.label}
                </button>
              ))}
            </div>
          ))}

          <hr className="my-3 border-0 border-t border-line-soft max-[900px]:hidden" />
          <button
            type="button"
            onClick={() => sairTransition(() => logoutAction())}
            disabled={saindo}
            className="flex h-[38px] shrink-0 items-center gap-3 rounded-sm px-3 text-[14px] font-medium text-ink-300 transition-colors hover:bg-signal-dnd/15 hover:text-signal-dnd disabled:opacity-50 max-[900px]:whitespace-nowrap"
          >
            <AetherIcon name="logout" className="h-[17px] w-[17px] shrink-0" />
            Sair
          </button>
        </nav>

        {/* Painel */}
        <div className="flex min-h-0 flex-col bg-base-800">
          <div className="flex items-center justify-between gap-4 border-b border-line px-6 py-5">
            <div className="min-w-0">
              <p className="truncate font-brand text-[20px] font-semibold text-ink-100">
                {atual.titulo}
              </p>
              <p className="mt-0.5 truncate text-[12px] text-ink-300">
                {atual.sub}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar configuracoes"
              className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-full border border-line text-ink-300 transition-colors hover:border-line-strong hover:bg-base-750 hover:text-ink-100"
            >
              <AetherIcon name="x" className="h-4 w-4" />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-6">
            {active === "conta" ? (
              <AccountTab user={user} server={server} />
            ) : active === "voz" ? (
              <VoiceTab />
            ) : active === "aparencia" ? (
              <AparenciaTab user={user} />
            ) : active === "acessibilidade" ? (
              <AcessibilidadeTab />
            ) : active === "conexoes" ? (
              <ConexoesTab />
            ) : active === "computador" ? (
              <EsteComputadorTab />
            ) : active === "plano" ? (
              <PlanoTab />
            ) : (
              <ActivityTab />
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
