"use client";

import { useState } from "react";
import { AetherIcon } from "@/components/ui/aether-icon";
import { CreateServerModal } from "@/components/servers/create-server-modal";

/**
 * Primeira tela de quem ainda nao participa de nenhum servidor.
 *
 * Antes havia so um texto dizendo "use o botao + na barra lateral" — o que
 * transforma o primeiro minuto do produto numa caca ao botao. As duas coisas
 * que a pessoa pode fazer agora sao acoes de verdade, no centro da tela.
 *
 * Nao cria servidor sozinho para ninguem: criar e uma das opcoes, entrar por
 * convite e a outra, e quem escolhe e o usuario.
 */
export function WelcomeCard({ displayName }: { displayName: string }) {
  const [modal, setModal] = useState<"create" | "join" | null>(null);

  return (
    <>
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-[440px] animate-rise rounded-xl border border-line bg-base-900 p-7">
          <div
            aria-hidden
            className="mb-5 h-px w-16"
            style={{
              background:
                "linear-gradient(to right, transparent, var(--color-accent-600), transparent)",
            }}
          />

          <h1 className="text-balance text-lg font-semibold text-ink-100">
            Boas-vindas, {displayName}
          </h1>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-400">
            Voce ainda nao participa de nenhum servidor. Crie o seu ou entre em
            um com o codigo que alguem te enviou.
          </p>

          <div className="mt-6 flex flex-col gap-2">
            <button
              type="button"
              onClick={() => setModal("create")}
              className="flex items-center gap-3 rounded-lg border border-accent-600/50 bg-accent-600/10 px-4 py-3 text-left transition-colors hover:bg-accent-600/20"
            >
              <AetherIcon
                name="plus"
                className="h-4 w-4 shrink-0 text-accent-300"
              />
              <span className="min-w-0">
                <span className="block text-[13px] font-medium text-accent-200">
                  Criar um servidor
                </span>
                <span className="block text-[12px] leading-snug text-ink-500">
                  Voce vira o dono, com canais de voz e texto ja prontos
                </span>
              </span>
            </button>

            <button
              type="button"
              onClick={() => setModal("join")}
              className="flex items-center gap-3 rounded-lg border border-line px-4 py-3 text-left transition-colors hover:bg-base-850"
            >
              <AetherIcon
                name="ticket"
                className="h-4 w-4 shrink-0 text-ink-400"
              />
              <span className="min-w-0">
                <span className="block text-[13px] font-medium text-ink-100">
                  Entrar com um convite
                </span>
                <span className="block text-[12px] leading-snug text-ink-500">
                  Cole o codigo ou o link que voce recebeu
                </span>
              </span>
            </button>
          </div>
        </div>
      </div>

      <CreateServerModal
        open={modal !== null}
        initialTab={modal ?? "create"}
        onClose={() => setModal(null)}
      />
    </>
  );
}
