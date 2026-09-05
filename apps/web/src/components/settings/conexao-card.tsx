"use client";

import { useState } from "react";
import { AetherIcon } from "@/components/ui/aether-icon";
import { Switch } from "@/components/ui/switch";
import {
  desconectarConexaoAction,
  definirVisibilidadeConexaoAction,
} from "@/server/actions/conexoes";

/**
 * O cartao de UMA conexao — ligada ou nao.
 *
 * GENERICO de proposito: era o `spotify-section.tsx`, e quase tudo nele ja
 * servia qualquer provedor (conectar, desconectar, duas chaves). O que era
 * do Spotify (o icone, o texto, o caminho de conectar) virou `props`. Steam,
 * Twitch e Riot vao renderizar por aqui sem cartao proprio.
 *
 * Funciona no navegador E no desktop. Quem descobre a atividade e o provedor,
 * via o que a pessoa autorizou — nao a maquina dela.
 */

export interface ProviderMeta {
  id: string;
  nome: string;
  /** frase curta que explica o que a conexao mostra */
  descricao: string;
  /**
   * O provedor produz atividade ao vivo (Spotify)? Se sim, mostra a segunda
   * chave "exibir como status"; se e so um cracha (Twitch por ora, Riot),
   * so a primeira chave faz sentido.
   */
  temAtividade: boolean;
  /** rotulo da segunda chave, so usado quando `temAtividade` */
  rotuloStatus?: string;
  /** para onde o "Conectar" aponta */
  caminhoConectar: string;
  icone: React.ReactNode;
}

export interface EstadoDaConexao {
  displayName: string | null;
  showOnProfile: boolean;
  showAsStatus: boolean;
}

export function ConexaoCard({
  meta,
  conexao,
  aoMudar,
}: {
  meta: ProviderMeta;
  /** `null` = nao conectado */
  conexao: EstadoDaConexao | null;
  /** avisa a aba para recarregar o estado real */
  aoMudar: () => void;
}) {
  const [salvando, setSalvando] = useState(false);
  const [otimista, setOtimista] = useState<EstadoDaConexao | null>(conexao);

  // A prop e a fonte da verdade; o estado local so cobre o intervalo entre
  // clicar e o `aoMudar` trazer o valor confirmado.
  const atual = otimista ?? conexao;

  /**
   * Shell de desktop velho demais para este provedor.
   *
   * A ponte generica (`conexoes.conectar`) chegou na fase 3, mas o shell so a
   * ganha numa RELEASE. Sem ela, so o Spotify tem caminho seguro (canal
   * `spotify.conectar`, hardcoded). Qualquer outro provedor cairia no
   * `window.location.href` da janela principal — que o `will-navigate` do
   * Electron intercepta e joga no NAVEGADOR do sistema. Melhor um aviso
   * honesto do que um botao que expulsa a pessoa do app.
   */
  const precisaAtualizarDesktop =
    !atual && ehDesktopSemPonteGenerica() && meta.id !== "SPOTIFY";

  function conectar() {
    const bridge = (
      window as {
        aetherDesktop?: {
          conexoes?: { conectar?: (caminho: string) => Promise<void> };
          // shell 0.1.21..0.1.23: so tinha o do Spotify
          spotify?: { conectar?: () => Promise<void> };
        };
      }
    ).aetherDesktop;

    /**
     * Desktop com a janela dedicada de OAuth: o processo principal abre uma
     * BrowserWindow filha que COMPARTILHA a sessao. A janela principal nao
     * navega, entao a call de voz nao pisca.
     */
    if (bridge?.conexoes?.conectar) {
      void bridge.conexoes.conectar(meta.caminhoConectar).then(aoMudar);
      return;
    }
    // Shell 0.1.23 so tem o canal do Spotify — usa quando for o caso.
    if (bridge?.spotify?.conectar && meta.id === "SPOTIFY") {
      void bridge.spotify.conectar().then(aoMudar);
      return;
    }
    if (bridge) {
      // Shell antigo, sem janela dedicada: navega a principal. A call volta
      // sozinha no reload.
      window.location.href = meta.caminhoConectar;
      return;
    }
    // Navegador: popup. O callback (aberto por `window.open`) se fecha sozinho
    // e a aba re-checa quando recupera o foco.
    window.open(
      meta.caminhoConectar,
      `aether-conexao-${meta.id}`,
      "width=480,height=720",
    );
  }

  async function alternar(patch: {
    showOnProfile?: boolean;
    showAsStatus?: boolean;
  }) {
    if (!atual) return;
    setSalvando(true);
    setOtimista({ ...atual, ...patch });
    await definirVisibilidadeConexaoAction(meta.id, patch);
    setOtimista(null); // solta o otimismo; `aoMudar` traz o confirmado
    aoMudar();
    setSalvando(false);
  }

  async function desconectar() {
    setSalvando(true);
    await desconectarConexaoAction(meta.id);
    setOtimista(null);
    aoMudar();
    setSalvando(false);
  }

  return (
    <div className="pt-1">
      <h3 className="text-[13px] font-medium text-ink-100">{meta.nome}</h3>
      <p className="mt-1 text-[12px] leading-relaxed text-ink-400">
        {meta.descricao}
      </p>

      {precisaAtualizarDesktop ? (
        <p className="mt-3 rounded-md border border-line bg-base-900 p-3 text-[12px] leading-relaxed text-ink-400">
          Atualize o aplicativo para conectar a {meta.nome}. Feche e reabra o
          Aether — a versao nova baixa sozinha.
        </p>
      ) : !atual ? (
        <div className="mt-3 space-y-2">
          <button
            type="button"
            onClick={conectar}
            className="inline-flex items-center gap-2 rounded-md border border-line-strong px-3 py-1.5 text-[12px] text-ink-100 transition-colors hover:bg-base-800"
          >
            {meta.icone}
            Conectar {meta.nome}
          </button>
          <p className="text-[11px] text-ink-500">
            Abre numa janela separada. Ao terminar, feche-a e volte aqui — o
            estado atualiza sozinho.
          </p>
        </div>
      ) : (
        <div className="mt-3 rounded-lg border border-line bg-base-900 p-3">
          <div className="flex items-center gap-2.5">
            {meta.icone}
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-ink-100">
                {atual.displayName ?? `Conta ${meta.nome}`}
              </p>
              <p className="text-[11px] text-ink-500">{meta.nome}</p>
            </div>
            <button
              type="button"
              aria-label={`Desconectar ${meta.nome}`}
              disabled={salvando}
              onClick={() => void desconectar()}
              className="shrink-0 rounded-md p-1 text-ink-500 transition-colors hover:bg-base-800 hover:text-ink-200 disabled:opacity-50"
            >
              <AetherIcon name="x" className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-3 space-y-3">
            <LinhaDeChave
              rotulo="Exibir no perfil"
              ligada={atual.showOnProfile}
              disabled={salvando}
              onChange={(v) => void alternar({ showOnProfile: v })}
            />
            {meta.temAtividade ? (
              <LinhaDeChave
                rotulo={meta.rotuloStatus ?? `Exibir ${meta.nome} como status`}
                ligada={atual.showAsStatus}
                disabled={salvando}
                onChange={(v) => void alternar({ showAsStatus: v })}
              />
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

function LinhaDeChave({
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
    <div className="flex items-center justify-between gap-3">
      <span className="text-[13px] text-ink-200">{rotulo}</span>
      <Switch
        checked={ligada}
        disabled={disabled}
        onCheckedChange={onChange}
        label={rotulo}
      />
    </div>
  );
}

/** Estamos num shell de desktop que ainda nao tem a ponte de conexoes generica? */
function ehDesktopSemPonteGenerica(): boolean {
  const d = (
    window as {
      aetherDesktop?: { conexoes?: { conectar?: unknown } };
    }
  ).aetherDesktop;
  return d != null && d.conexoes?.conectar == null;
}
