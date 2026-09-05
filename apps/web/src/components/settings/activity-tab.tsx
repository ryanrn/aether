"use client";

import { useEffect, useState } from "react";
import { AetherIcon } from "@/components/ui/aether-icon";
import { SwitchVisual } from "@/components/ui/switch";
import { AdicionarJogo } from "./adicionar-jogo";
import { SpotifySection } from "./spotify-section";
import {
  canDetectGames,
  currentGame,
  isGameDetectionEnabled,
  setGameDetectionEnabled,
  type DetectedGame,
} from "@/lib/desktop/game-activity";
import { cn } from "@/lib/utils";

/**
 * Atividade — o que os outros veem que voce esta fazendo.
 *
 * Aba propria, e nao um pedaco de "Voz e video": deteccao de jogo nao tem
 * nada a ver com microfone ou alto-falante. Estava la so porque foi onde
 * coube na hora, e "onde coube" nao e criterio de organizacao.
 *
 * Aqui e o lugar natural do que vier depois — status personalizado, esconder
 * atividade por servidor, o que mais entrar no cartao.
 */
export function ActivityTab() {
  const [noDesktop, setNoDesktop] = useState(false);
  const [ligada, setLigada] = useState(false);
  const [jogoAgora, setJogoAgora] = useState<DetectedGame | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    // `window.aetherDesktop` nao existe no servidor: so depois de montar.
    setNoDesktop(canDetectGames());
    void isGameDetectionEnabled().then(setLigada);
    void currentGame().then(setJogoAgora);
  }, []);

  async function alternar(desejado: boolean) {
    setSalvando(true);
    // O valor exibido e o que o processo principal CONFIRMOU, e nao o que a
    // caixa marcou: se salvar falhar, a tela nao pode dizer que esta ligado.
    const confirmado = await setGameDetectionEnabled(desejado);
    setLigada(confirmado);
    // Ligar deve mostrar o resultado agora, nao daqui a quinze segundos.
    setJogoAgora(confirmado ? await currentGame() : null);
    setSalvando(false);
  }

  return (
    <section className="flex flex-col gap-6">
      <div>
        <h3 className="text-[13px] font-medium text-ink-100">
          Jogo em execucao
        </h3>
        <p className="mt-1 text-[12px] leading-relaxed text-ink-400">
          {noDesktop
            ? "O app procura jogos abertos da Steam, Epic Games, Riot Games, Ubisoft, GOG e Xbox, e mostra o nome e a capa no seu cartao de atividade, junto do tempo de sessao."
            : "So funciona no app de desktop: o navegador nao consegue ver os programas abertos."}
        </p>
      </div>

      {noDesktop ? (
        <>
          <button
            type="button"
            role="switch"
            aria-checked={ligada}
            disabled={salvando}
            onClick={() => void alternar(!ligada)}
            className="grid grid-cols-[1fr_auto] items-start gap-3 rounded-md border border-line bg-base-900 p-3 text-left transition-colors hover:border-line-strong disabled:opacity-60"
          >
            <span className="min-w-0">
              <span className="block text-[13px] text-ink-100">
                Mostrar o jogo que estou jogando
              </span>
              <span className="mt-1 block text-[12px] leading-relaxed text-ink-500">
                Quem abrir seu perfil ve o nome do jogo e ha quanto tempo voce
                esta nele.
              </span>
            </span>
            <span className="pt-0.5">
              <SwitchVisual checked={ligada} disabled={salvando} />
            </span>
          </button>

          {/*
            Mostrar o que foi detectado AGORA e a unica forma honesta de dizer
            que a coisa funciona. Sem isto, so restaria confiar na caixa
            marcada — que e exatamente o estado em que um bug passa despercebido.
          */}
          {ligada ? (
            <div className="flex items-center gap-2.5 rounded-md border border-line bg-base-900 px-3 py-2.5">
              {jogoAgora?.icone ? (
                // eslint-disable-next-line @next/next/no-img-element -- data URL local, nao ha o que otimizar
                <img
                  src={jogoAgora.icone}
                  alt=""
                  className="h-7 w-7 shrink-0 rounded-[4px]"
                />
              ) : (
                <AetherIcon
                  name="gamepad"
                  className="h-4 w-4 shrink-0 text-accent-400"
                />
              )}
              <p className="min-w-0 flex-1 truncate text-[13px] text-ink-200">
                {jogoAgora ? (
                  <>
                    Detectado agora:{" "}
                    <span className="text-ink-100">{jogoAgora.nome}</span>
                  </>
                ) : (
                  <span className="text-ink-500">
                    Nenhum jogo aberto no momento.
                  </span>
                )}
              </p>
            </div>
          ) : null}

          {/*
            Fica sob a chave LIGADA de proposito: nao ha o que sugerir com a
            deteccao desligada, e o processo principal recusa responder nesse
            estado. Mostrar o link ali seria oferecer um caminho sem saida.
          */}
          {ligada ? <AdicionarJogo /> : null}

          {/*
            A privacidade nao fica escondida num aviso pequeno: e o motivo de
            esta chave existir desligada por padrao, e quem for ligar merece
            ler antes o que exatamente e lido.
          */}
          <div className="rounded-md border border-line bg-base-950 p-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-500">
              o que sai do seu computador
            </p>
            <p className="mt-1.5 text-[12px] leading-relaxed text-ink-400">
              Apenas o <span className="text-ink-200">nome do jogo</span>. A
              leitura dos programas abertos acontece so na sua maquina, e o que
              nao for jogo e descartado ali mesmo — o servidor nunca recebe a
              lista dos seus programas. O icone e lido do proprio arquivo do
              jogo, sem consultar nada na internet.
            </p>
          </div>

          <div className="rounded-md border border-line bg-base-900 p-3">
            <p className="text-[11px] uppercase tracking-[0.1em] text-ink-500">
              Ainda nao disponivel
            </p>
            <p className="mt-1.5 text-[13px] leading-relaxed text-ink-400">
              Jogos de outras lojas (GOG, Battle.net, Xbox, avulsos), status
              personalizado e esconder a atividade em servidores especificos.
            </p>
          </div>
        </>
      ) : null}

      {/* Spotify funciona nos dois: navegador e desktop. Fica fora do gate. */}
      <SpotifySection />
    </section>
  );
}

