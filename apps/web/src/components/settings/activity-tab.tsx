"use client";

import { useEffect, useState } from "react";
import { AetherIcon } from "@/components/ui/aether-icon";
import { SwitchVisual, ToggleRow } from "@/components/ui/switch";
import { AdicionarJogo } from "./adicionar-jogo";
import { SpotifySection } from "./spotify-section";
import {
  canDetectGames,
  iniciaComWindows,
  podeIniciarComWindows,
  setIniciarComWindows,
  currentGame,
  isGameDetectionEnabled,
  setGameDetectionEnabled,
  type DetectedGame,
} from "@/lib/desktop/game-activity";
import {
  aoMudarEstado,
  estadoDaAtualizacao,
  instalarAtualizacao,
  podeAtualizar,
  verificarAgora,
  type EstadoAtualizacao,
} from "@/lib/desktop/update";
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
  const [podeIniciar, setPodeIniciar] = useState(false);
  const [iniciaJunto, setIniciaJunto] = useState(false);
  const [salvandoInicio, setSalvandoInicio] = useState(false);
  const [atualizacao, setAtualizacao] = useState<EstadoAtualizacao | null>(
    null,
  );
  const [verificando, setVerificando] = useState(false);

  useEffect(() => {
    // `window.aetherDesktop` nao existe no servidor: so depois de montar.
    setNoDesktop(canDetectGames());
    void isGameDetectionEnabled().then(setLigada);
    void currentGame().then(setJogoAgora);
    setPodeIniciar(podeIniciarComWindows());
    void iniciaComWindows().then(setIniciaJunto);
    if (podeAtualizar()) {
      void estadoDaAtualizacao().then(setAtualizacao);
      return aoMudarEstado(setAtualizacao);
    }
  }, []);

  async function verificar() {
    setVerificando(true);
    setAtualizacao(await verificarAgora());
    setVerificando(false);
  }

  async function alternarInicio(desejado: boolean) {
    setSalvandoInicio(true);
    /**
     * Mostra o que o SISTEMA confirmou, e nao o que a caixa marcou. O Windows
     * pode recusar (politica de grupo, permissao), e a tela dizer "ligado"
     * enquanto o app nao abre no boot seria a pior forma de errar aqui.
     */
    setIniciaJunto(await setIniciarComWindows(desejado));
    setSalvandoInicio(false);
  }

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

          {podeIniciar ? (
            <div className="border-t border-line pt-4">
              <h3 className="text-[13px] font-medium text-ink-100">
                Ao ligar o computador
              </h3>
              <ToggleRow
                checked={iniciaJunto}
                disabled={salvandoInicio}
                onCheckedChange={alternarInicio}
                title="Abrir o Aether junto com o Windows"
                description="A janela abre normalmente, nao escondida. Quem manda nisto e a inicializacao do Windows: tirar o Aether de la pelo Gerenciador de Tarefas tambem desmarca esta chave."
              />
            </div>
          ) : null}

          {atualizacao ? (
            <div className="border-t border-line pt-5">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-[13px] font-medium text-ink-100">
                    Versao do app
                  </h3>
                  <p className="mt-1 text-[12px] text-ink-400">
                    {atualizacao.versaoAtual
                      ? `Voce esta na ${atualizacao.versaoAtual}.`
                      : "Casca do app."}{" "}
                    {textoDaAtualizacao(atualizacao)}
                  </p>
                </div>

                {/*
                  Botao de VERIFICAR, e nao so a checagem automatica.

                  A automatica roda 8s depois de abrir e de 6 em 6 horas, sem
                  dizer nada. Quando ela nao funciona — e nao funcionou — nao
                  ha como distinguir "ja estou atualizado" de "nem tentou".
                */}
                <button
                  type="button"
                  onClick={verificar}
                  disabled={verificando || atualizacao.fase === "baixando"}
                  className="flex shrink-0 items-center gap-1.5 rounded-md border border-line-strong px-3 py-1.5 text-[12px] text-ink-200 transition-colors hover:bg-base-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <AetherIcon
                    name="refresh"
                    className={cn("h-3.5 w-3.5", verificando && "animate-spin")}
                    strokeWidth={1.75}
                  />
                  Verificar
                </button>
              </div>

              {/*
                A BARRA DE PROGRESSO e o ponto principal desta secao. Sao 82 MB
                baixando; sem nada na tela, fechar o app no meio parece
                inofensivo — e descarta tudo, recomecando do zero na proxima
                abertura. Foi assim que a 0.1.10 nao chegou.
              */}
              {atualizacao.fase === "baixando" ? (
                <div className="mt-3">
                  <div className="h-1.5 overflow-hidden rounded-full bg-base-800">
                    <div
                      className="h-full rounded-full transition-[width] duration-300"
                      style={{
                        width: `${atualizacao.progresso}%`,
                        backgroundColor: "#68af64",
                      }}
                    />
                  </div>
                  <p className="mt-1.5 text-[11px] text-ink-500">
                    Deixe o app aberto ate terminar — fechar agora descarta o
                    que ja baixou.
                  </p>
                </div>
              ) : null}

              {atualizacao.fase === "pronta" ? (
                <button
                  type="button"
                  onClick={() => void instalarAtualizacao()}
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-md px-3 py-2 text-[12px] font-semibold text-white transition-opacity hover:opacity-90"
                  style={{ backgroundColor: "#68af64" }}
                >
                  <AetherIcon
                    name="download"
                    className="h-3.5 w-3.5"
                    strokeWidth={2.25}
                  />
                  Reiniciar e instalar a {atualizacao.versao}
                </button>
              ) : null}
            </div>
          ) : null}

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

/** A frase que descreve o estado, em portugues de gente. */
function textoDaAtualizacao(estado: EstadoAtualizacao): string {
  switch (estado.fase) {
    case "verificando":
      return "Procurando versao nova...";
    case "baixando":
      return `Baixando a ${estado.versao ?? "versao nova"} (${estado.progresso}%).`;
    case "pronta":
      return `A ${estado.versao ?? "versao nova"} esta pronta para instalar.`;
    case "atualizado":
      return "Esta e a versao mais recente.";
    case "erro":
      // A causa vai para o arquivo de log; aqui fica a versao curta.
      return "Nao consegui verificar agora.";
    default:
      return "";
  }
}
