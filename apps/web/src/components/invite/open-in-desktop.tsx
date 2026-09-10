"use client";

import { useEffect, useState } from "react";
import { AetherIcon } from "@/components/ui/aether-icon";
import { isDesktopApp } from "@/lib/voice/screen-share";

/**
 * "Abrir no AETHER Desktop".
 *
 * NAO da para confirmar do navegador se o app esta instalado — nenhum
 * mecanismo web faz isso de forma confiavel. Entao a pagina nunca DEPENDE
 * disto: o caminho Web (aceitar aqui mesmo) e sempre a acao principal, e este
 * botao e um extra.
 *
 * Ao clicar, navega para `aether://invite/<codigo>`. Se o protocolo estiver
 * registrado (app instalado), o Windows mostra "Abrir o Aether?" e encaminha.
 * Se nao estiver, o navegador nao faz nada visivel — por isso o texto de
 * apoio explica o que esperar.
 *
 * Escondido quando a pagina JA esta rodando dentro do app de desktop
 * (`window.aetherDesktop`): ali o link nativo nao faz sentido.
 */
export function OpenInDesktop({ code }: { code: string }) {
  const [noApp, setNoApp] = useState(false);
  useEffect(() => setNoApp(isDesktopApp()), []);

  if (noApp) return null;

  return (
    <div className="mt-3 border-t border-line-soft pt-3 text-center">
      <a
        href={`aether://invite/${code}`}
        className="inline-flex items-center gap-1.5 text-[12px] text-ink-400 transition-colors hover:text-ink-200"
      >
        <AetherIcon name="monitor" className="h-3.5 w-3.5" />
        Abrir no AETHER Desktop
      </a>
      <p className="mt-1 text-[11px] text-ink-500">
        Se voce tem o aplicativo instalado, ele abre direto no servidor.
      </p>
    </div>
  );
}
