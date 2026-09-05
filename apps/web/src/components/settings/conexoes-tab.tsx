"use client";

import { useCallback, useEffect, useState } from "react";
import { AetherIcon } from "@/components/ui/aether-icon";
import {
  ConexaoCard,
  type EstadoDaConexao,
  type ProviderMeta,
} from "./conexao-card";

/**
 * Conexoes — contas de outros servicos ligadas a sua.
 *
 * VIROU LISTA na fase 3. Antes era `<SpotifySection />` chumbado; agora a aba
 * pergunta ao servidor quais provedores existem e em que pe cada um esta, e
 * monta os cartoes. Quando o adaptador do Twitch (ou Steam, ou Riot) entrar
 * com os segredos no ambiente, o cartao dele aparece aqui sem tocar nesta
 * tela.
 *
 * Funciona no navegador E no desktop — OAuth e do lado do servidor.
 */

/** Icone de marca de cada provedor. So o Spotify tem um proprio hoje. */
const ICONE: Record<string, React.ReactNode> = {
  SPOTIFY: (
    <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" aria-hidden fill="#1DB954">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.586 14.424a.623.623 0 0 1-.857.207c-2.348-1.435-5.304-1.76-8.785-.964a.622.622 0 1 1-.277-1.215c3.809-.871 7.077-.496 9.712 1.115a.623.623 0 0 1 .207.857zm1.223-2.722a.78.78 0 0 1-1.072.257c-2.687-1.652-6.785-2.131-9.965-1.166a.779.779 0 1 1-.452-1.491c3.632-1.102 8.147-.568 11.234 1.329a.78.78 0 0 1 .257 1.072zm.105-2.835C14.692 8.95 9.375 8.775 6.297 9.71a.935.935 0 1 1-.542-1.79c3.532-1.072 9.404-.865 13.115 1.338a.936.936 0 0 1-.958 1.607z" />
    </svg>
  ),
  TWITCH: (
    <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" aria-hidden fill="#9146FF">
      <path d="M4.265 0L1 3.265v13.47h4.735V20l3.265-3.265h2.735L18.735 10V0H4.265zm12.47 9.265l-2.735 2.735h-2.735l-2.397 2.397v-2.397H4.735V1.735h12v7.53z" />
      <path d="M14.735 4.265h-1.735v4.735h1.735V4.265zM10 4.265H8.265v4.735H10V4.265z" />
    </svg>
  ),
  STEAM: (
    <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" aria-hidden fill="#c7d5e0">
      <path d="M11.98 0C5.67 0 .5 4.87.05 11.06l6.44 2.66a3.4 3.4 0 0 1 1.92-.59l2.87-4.15v-.06a4.53 4.53 0 1 1 4.53 4.53h-.1l-4.1 2.92c0 .05.01.1.01.15a3.4 3.4 0 0 1-6.75.55L.32 15.4A11.99 11.99 0 1 0 11.98 0zM7.53 18.21l-1.48-.61a2.56 2.56 0 0 0 4.7-1.02 2.56 2.56 0 0 0-2.56-2.56c-.35 0-.7.07-1 .2l1.53.63a1.88 1.88 0 1 1-1.19 3.36zm11.5-9.65a3.02 3.02 0 1 0-6.04 0 3.02 3.02 0 0 0 6.04 0zm-5.28 0a2.27 2.27 0 1 1 4.54 0 2.27 2.27 0 0 1-4.54 0z" />
    </svg>
  ),
};

/** Texto de cada provedor. O que a API nao sabe (e nao deve saber). */
const TEXTO: Record<
  string,
  { descricao: string; rotuloStatus?: string }
> = {
  SPOTIFY: {
    descricao:
      "Mostra a musica que voce esta ouvindo no seu cartao de atividade. So a faixa, o artista e a capa saem — nada de historico nem controle de playback.",
    rotuloStatus: "Exibir o Spotify como seu status",
  },
  TWITCH: {
    descricao:
      "Mostra seu canal da Twitch no perfil. Aparecer “ao vivo” automaticamente vem depois — por ora e so o link.",
  },
  STEAM: {
    descricao:
      "Mostra sua conta da Steam no perfil. Aparecer “jogando X” automaticamente vem depois — e vai depender do seu perfil estar publico.",
  },
  RIOT: {
    descricao:
      "Vai mostrar seu Riot ID no perfil. A Riot nao abre uma forma de ver a partida em andamento, entao fica so a identidade.",
  },
};

function iconeDe(id: string): React.ReactNode {
  return (
    ICONE[id] ?? (
      <span className="grid h-5 w-5 shrink-0 place-items-center rounded-[6px] border border-line text-ink-500">
        <AetherIcon name="link" className="h-3 w-3" />
      </span>
    )
  );
}

function caminhoConectar(id: string): string {
  // O Spotify mantem endereco proprio: o `redirect_uri` esta registrado no
  // painel dele. Os demais usam a rota generica.
  return id === "SPOTIFY"
    ? "/api/spotify/connect"
    : `/api/conexoes/${id.toLowerCase()}/connect`;
}

interface ProvedorConhecido {
  id: string;
  nome: string;
  implementado: boolean;
  configurado: boolean;
  temAtividade: boolean;
}

interface ConexaoVisivel {
  provider: string;
  displayName: string | null;
  showOnProfile: boolean;
  showAsStatus: boolean;
}

interface StateResposta {
  provedores: ProvedorConhecido[];
  conexoes: ConexaoVisivel[];
}

export function ConexoesTab() {
  const [dados, setDados] = useState<StateResposta | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const r = await fetch("/api/conexoes/state");
      if (!r.ok) {
        setErro(`HTTP ${r.status}`);
        return;
      }
      setErro(null);
      setDados(await r.json());
    } catch (e) {
      setErro(e instanceof Error ? e.message : "falha ao consultar");
    }
  }, []);

  useEffect(() => {
    void carregar();
    // O OAuth acontece fora do app; re-checa quando a janela volta ao foco.
    const aoFocar = () => void carregar();
    window.addEventListener("focus", aoFocar);
    return () => window.removeEventListener("focus", aoFocar);
  }, [carregar]);

  if (erro) {
    return (
      <section className="flex flex-col gap-4">
        <p className="text-[13px] text-signal-dnd">
          Nao consegui carregar as conexoes ({erro}).
        </p>
      </section>
    );
  }
  if (!dados) {
    return (
      <section className="flex flex-col gap-4">
        <p className="text-[13px] text-ink-500">Carregando…</p>
      </section>
    );
  }

  const conexaoDe = (id: string): EstadoDaConexao | null => {
    const c = dados.conexoes.find((x) => x.provider === id);
    return c
      ? {
          displayName: c.displayName,
          showOnProfile: c.showOnProfile,
          showAsStatus: c.showAsStatus,
        }
      : null;
  };

  /** Da para conectar agora: adaptador pronto E segredos no ambiente. */
  const ativos = dados.provedores.filter(
    (p) => p.implementado && p.configurado,
  );
  /** Previstos, mas ainda nao. */
  const emBreve = dados.provedores.filter(
    (p) => !p.implementado || !p.configurado,
  );

  return (
    <section className="flex flex-col divide-y divide-line">
      {ativos.map((p) => {
        const t = TEXTO[p.id] ?? { descricao: "" };
        const meta: ProviderMeta = {
          id: p.id,
          nome: p.nome,
          descricao: t.descricao,
          temAtividade: p.temAtividade,
          rotuloStatus:
            t.rotuloStatus ?? `Exibir ${p.nome} como seu status`,
          caminhoConectar: caminhoConectar(p.id),
          icone: iconeDe(p.id),
        };
        return (
          <div key={p.id} className="py-5 first:pt-1">
            <ConexaoCard
              meta={meta}
              conexao={conexaoDe(p.id)}
              aoMudar={() => void carregar()}
            />
          </div>
        );
      })}

      {emBreve.length > 0 ? (
        <div className="py-5">
          <div className="rounded-md border border-line bg-base-900 p-3">
            <p className="text-[11px] uppercase tracking-[0.1em] text-ink-500">
              Ainda nao disponivel
            </p>
            <ul className="mt-2 space-y-1.5">
              {emBreve.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center gap-2.5 text-[13px] text-ink-400"
                >
                  {iconeDe(p.id)}
                  <span>{p.nome}</span>
                  {p.implementado && !p.configurado ? (
                    <span className="text-[11px] text-ink-600">
                      — falta configurar neste servidor
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </section>
  );
}
