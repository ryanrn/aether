"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import {
  disconnectSpotifyAction,
  setSpotifyVisibilityAction,
} from "@/server/actions/spotify";
import { cn } from "@/lib/utils";

/**
 * Seccao "Spotify" da aba Atividade.
 *
 * Funciona no navegador E no desktop (diferente da deteccao de jogo, que so
 * roda no desktop): quem descobre a musica e o Spotify, via o token que a
 * pessoa autorizou — nao a maquina dela.
 *
 * Busca o proprio estado ao montar. O "Conectar" e um link normal
 * (`/api/spotify/connect`) porque termina fora do nosso dominio; a volta cai
 * em `/app` e, ao reabrir as configuracoes, esta seccao ja mostra conectado.
 */

interface Estado {
  disponivel: boolean;
  conta: {
    spotifyName: string | null;
    showOnProfile: boolean;
    showAsStatus: boolean;
  } | null;
}

const ICONE_SPOTIFY = (
  <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden fill="#1DB954">
    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.586 14.424a.623.623 0 0 1-.857.207c-2.348-1.435-5.304-1.76-8.785-.964a.622.622 0 1 1-.277-1.215c3.809-.871 7.077-.496 9.712 1.115a.623.623 0 0 1 .207.857zm1.223-2.722a.78.78 0 0 1-1.072.257c-2.687-1.652-6.785-2.131-9.965-1.166a.779.779 0 1 1-.452-1.491c3.632-1.102 8.147-.568 11.234 1.329a.78.78 0 0 1 .257 1.072zm.105-2.835C14.692 8.95 9.375 8.775 6.297 9.71a.935.935 0 1 1-.542-1.79c3.532-1.072 9.404-.865 13.115 1.338a.936.936 0 0 1-.958 1.607z" />
  </svg>
);

export function SpotifySection() {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [salvando, setSalvando] = useState(false);

  const [erro, setErro] = useState<string | null>(null);

  async function carregar() {
    try {
      const r = await fetch("/api/spotify/state");
      if (!r.ok) {
        setErro(`HTTP ${r.status}`);
        return;
      }
      setErro(null);
      setEstado(await r.json());
    } catch (e) {
      setErro(e instanceof Error ? e.message : "falha ao consultar");
    }
  }

  useEffect(() => {
    void carregar();
  }, []);

  const conta = estado?.conta ?? null;

  const cabecalho = (
    <>
      <h3 className="text-[13px] font-medium text-ink-100">Spotify</h3>
      <p className="mt-1 text-[12px] leading-relaxed text-ink-400">
        Mostra a musica que voce esta ouvindo no seu cartao de atividade. So a
        faixa, o artista e a capa saem — nada de historico nem controle de
        playback.
      </p>
    </>
  );

  if (erro) {
    return (
      <div className="border-t border-base-800 pt-5">
        {cabecalho}
        <p className="mt-2 text-[12px] text-signal-dnd">
          Nao consegui consultar o estado do Spotify ({erro}).
        </p>
      </div>
    );
  }
  if (!estado) {
    return (
      <div className="border-t border-base-800 pt-5">
        {cabecalho}
        <p className="mt-2 text-[12px] text-ink-500">Carregando…</p>
      </div>
    );
  }
  if (!estado.disponivel) {
    return (
      <div className="border-t border-base-800 pt-5">
        {cabecalho}
        <p className="mt-2 text-[12px] text-ink-500">
          A integracao com o Spotify nao esta configurada neste servidor.
        </p>
      </div>
    );
  }

  async function alternar(patch: {
    showOnProfile?: boolean;
    showAsStatus?: boolean;
  }) {
    if (!conta) return;
    setSalvando(true);
    // Otimista, mas confere no fim: recarrega o estado de verdade.
    setEstado((e) =>
      e && e.conta ? { ...e, conta: { ...e.conta, ...patch } } : e,
    );
    await setSpotifyVisibilityAction(patch);
    await carregar();
    setSalvando(false);
  }

  async function desconectar() {
    setSalvando(true);
    await disconnectSpotifyAction();
    await carregar();
    setSalvando(false);
  }

  return (
    <div className="border-t border-base-800 pt-5">
      {cabecalho}

      {!conta ? (
        <a
          href="/api/spotify/connect"
          className="mt-3 inline-flex items-center gap-2 rounded-md border border-base-600 px-3 py-1.5 text-[12px] text-ink-100 transition-colors hover:bg-base-800"
        >
          {ICONE_SPOTIFY}
          Conectar Spotify
        </a>
      ) : (
        <div className="mt-3 rounded-lg border border-base-700 bg-base-900 p-3">
          <div className="flex items-center gap-2.5">
            {ICONE_SPOTIFY}
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-ink-100">
                {conta.spotifyName ?? "Conta do Spotify"}
              </p>
              <p className="text-[11px] text-ink-500">Spotify</p>
            </div>
            <button
              type="button"
              aria-label="Desconectar o Spotify"
              disabled={salvando}
              onClick={() => void desconectar()}
              className="shrink-0 rounded-md p-1 text-ink-500 transition-colors hover:bg-base-800 hover:text-ink-200 disabled:opacity-50"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-3 space-y-2.5">
            <Chave
              rotulo="Exibir no perfil"
              ligada={conta.showOnProfile}
              disabled={salvando}
              onChange={(v) => void alternar({ showOnProfile: v })}
            />
            <Chave
              rotulo="Exibir o Spotify como seu status"
              ligada={conta.showAsStatus}
              disabled={salvando}
              onChange={(v) => void alternar({ showAsStatus: v })}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function Chave({
  rotulo,
  ligada,
  disabled,
  onChange,
}: {
  rotulo: string;
  ligada: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3">
      <span className="text-[13px] text-ink-200">{rotulo}</span>
      <button
        type="button"
        role="switch"
        aria-checked={ligada}
        disabled={disabled}
        onClick={() => onChange(!ligada)}
        className={cn(
          "relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors disabled:opacity-50",
          ligada ? "bg-accent-500" : "bg-base-700",
        )}
      >
        <span
          className={cn(
            "absolute top-[3px] h-4 w-4 rounded-full bg-white transition-[left]",
            ligada ? "left-[19px]" : "left-[3px]",
          )}
        />
      </button>
    </label>
  );
}
