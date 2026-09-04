"use client";

import { useEffect, useState } from "react";
import { AetherIcon } from "@/components/ui/aether-icon";
import { Modal } from "@/components/ui/modal";
import { useRealtimeStore } from "@/lib/stores/realtime-store";
import { copiarTexto } from "@/lib/clipboard";
import type { Amostra, MediaDebug } from "@/lib/voice/media-debug";
import { cn } from "@/lib/utils";

/**
 * Depuracao da midia — as estatisticas cruas da chamada, ao vivo.
 *
 * O QUE ESTE PAINEL SUBSTITUI: o botao "Depuracao" recarregava a pagina com
 * `?debug=media` e, com isso, DERRUBAVA A CALL. Recarregar para investigar uma
 * chamada destroi justamente o que se queria investigar.
 *
 * TODO NUMERO AQUI VEM DE `RTCPeerConnection.getStats()`. Nao ha campo
 * estimado nem inventado: o que o WebRTC nao expoe nao aparece. Alguns numeros
 * que outros aplicativos mostram (falhas de decifragem, atraso do pacer) sao
 * internos do proprio cliente deles e nao existem na API do navegador — nao da
 * para exibir sem inventar, entao nao exibimos.
 *
 * So mede enquanto esta aberto: `startMediaDebug` sobe no `useEffect` e cai no
 * fechamento. Le o relatorio inteiro das duas conexoes a cada segundo, o que e
 * caro demais para deixar rodando o tempo todo.
 */

type Aba = "transporte" | "saida";

export function MediaDebugPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const subscribe = useRealtimeStore(
    (state) => state.roomControls?.subscribeMediaDebug,
  );
  const [debug, setDebug] = useState<MediaDebug | null>(null);
  const [aba, setAba] = useState<Aba>("transporte");
  const [copiado, setCopiado] = useState(false);
  const [falhouCopiar, setFalhouCopiar] = useState(false);

  useEffect(() => {
    if (!open || !subscribe) return;
    return subscribe(setDebug);
  }, [open, subscribe]);

  async function copiar() {
    setFalhouCopiar(false);
    const texto = JSON.stringify(
      {
        geradoEm: new Date().toISOString(),
        userAgent: navigator.userAgent,
        debug,
      },
      null,
      2,
    );
    if (await copiarTexto(texto)) {
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
      return;
    }
    setFalhouCopiar(true);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Depuracao da midia"
      bare
      className="h-[min(720px,90vh)] w-[min(1000px,calc(100vw-2.5rem))] max-w-none overflow-hidden rounded-xl"
    >
      <div className="grid h-full grid-cols-[200px_1fr] max-[820px]:grid-cols-1">
        <nav className="flex flex-col gap-1 border-r border-line bg-base-900 p-3 max-[820px]:flex-row max-[820px]:border-b max-[820px]:border-r-0">
          <div className="px-2 pb-2 max-[820px]:hidden">
            <p className="truncate text-[13px] font-semibold text-ink-100">
              {debug?.regiao ?? "—"}
            </p>
            <p className="truncate font-mono text-[10px] text-ink-600">
              {debug?.servidor ?? "aguardando…"}
            </p>
          </div>
          {(
            [
              {
                id: "transporte" as const,
                rotulo: "Transporte",
                icone: "signal",
              },
              { id: "saida" as const, rotulo: "Saida", icone: "mic" },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setAba(t.id)}
              className={cn(
                "flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors",
                aba === t.id
                  ? "bg-accent-500/15 text-accent-300"
                  : "text-ink-300 hover:bg-base-800 hover:text-ink-100",
              )}
            >
              <AetherIcon name={t.icone} className="h-3.5 w-3.5 shrink-0" />
              {t.rotulo}
            </button>
          ))}
        </nav>

        <div className="flex min-h-0 flex-col">
          <div className="flex shrink-0 items-center gap-2 border-b border-line px-5 py-3">
            <h2 className="flex-1 font-brand text-[15px] text-ink-100">
              {aba === "transporte" ? "Transporte" : "Saida de audio"}
            </h2>
            <button
              type="button"
              onClick={() => void copiar()}
              className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-[11px] text-ink-300 transition-colors hover:bg-base-800 hover:text-ink-100"
            >
              <AetherIcon
                name={copiado ? "clipboard-check" : "copy"}
                className={cn("h-3 w-3", copiado && "text-accent-300")}
              />
              {copiado ? "Copiado" : "Copiar tudo"}
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar depuracao"
              className="grid h-7 w-7 place-items-center rounded-full border border-line text-ink-400 transition-colors hover:bg-base-800 hover:text-ink-100"
            >
              <AetherIcon name="x" className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            {falhouCopiar ? (
              <p className="mb-4 rounded-md border border-signal-dnd/40 bg-signal-dnd/10 px-3 py-2 text-[12px] text-signal-dnd">
                Nao consegui copiar. Selecione o texto dos campos a mao.
              </p>
            ) : null}

            {!subscribe ? (
              <Vazio texto="Entre numa chamada para ver as estatisticas." />
            ) : !debug ? (
              <Vazio texto="Coletando…" />
            ) : aba === "transporte" ? (
              <Transporte debug={debug} />
            ) : (
              <Saida debug={debug} />
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function Transporte({ debug }: { debug: MediaDebug }) {
  if (debug.transportes.length === 0) {
    return <Vazio texto="Nenhuma conexao ativa." />;
  }
  return (
    <div className="flex flex-col gap-6">
      {/*
        O ping so quer dizer alguma coisa junto com a PONTA do outro lado. Um
        ping alto com o no de midia em outro continente e distancia, nao defeito
        da rede de quem esta ligando — e a diferenca muda completamente o que
        fazer a respeito. Por isso a regiao fica aqui em cima do numero, e nao
        so escondida na coluna da esquerda.
      */}
      <section className="flex flex-col gap-2">
        <h3 className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-500">
          Servidor de midia
        </h3>
        <Grade>
          <Campo rotulo="Regiao" valor={debug.regiao ?? "—"} mono destaque />
          <Campo rotulo="No" valor={debug.servidor ?? "—"} mono />
        </Grade>
      </section>

      <Grafico titulo="Ping" serie={debug.historico.ping} unidade="ms" />

      {debug.transportes.map((t) => (
        <section key={t.conexao} className="flex flex-col gap-2">
          <h3 className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-500">
            {t.conexao === "publisher" ? "Envio" : "Recepcao"}
            {t.relay ? (
              <span className="rounded-sm bg-signal-idle/15 px-1.5 py-0.5 text-[9px] text-signal-idle">
                via relay (TURN)
              </span>
            ) : null}
          </h3>
          <Grade>
            <Campo rotulo="Ping" valor={ms(t.pingMs)} destaque />
            <Campo rotulo="Caminho" valor={t.caminho ?? "—"} mono />
            <Campo rotulo="Estado ICE" valor={t.estadoIce ?? "—"} mono />
            <Campo rotulo="Estado DTLS" valor={t.estadoDtls ?? "—"} mono />
            <Campo
              rotulo="Banda de saida disponivel"
              valor={
                t.bitrateSaidaDisponivelKbps != null
                  ? `${t.bitrateSaidaDisponivelKbps} Kbps`
                  : "—"
              }
            />
            <Campo
              rotulo="Pacotes enviados"
              valor={inteiro(t.pacotesEnviados)}
            />
            <Campo
              rotulo="Pacotes recebidos"
              valor={inteiro(t.pacotesRecebidos)}
            />
            <Campo rotulo="Bytes enviados" valor={bytes(t.bytesEnviados)} />
            <Campo rotulo="Bytes recebidos" valor={bytes(t.bytesRecebidos)} />
          </Grade>
        </section>
      ))}
    </div>
  );
}

function Saida({ debug }: { debug: MediaDebug }) {
  const s = debug.saida;
  if (!s) return <Vazio texto="Nenhuma faixa de audio publicada." />;
  return (
    <div className="flex flex-col gap-6">
      <Grafico
        titulo="Nivel de audio"
        serie={debug.historico.nivel}
        unidade="%"
      />
      <Grafico
        titulo="Bitrate"
        serie={debug.historico.bitrate}
        unidade="Kbps"
      />

      <Grade>
        <Campo rotulo="Codec" valor={s.codec ?? "—"} mono />
        <Campo rotulo="SSRC" valor={inteiro(s.ssrc)} mono />
        <Campo
          rotulo="Bitrate"
          valor={s.bitrateKbps != null ? `${s.bitrateKbps} Kbps` : "—"}
          destaque
        />
        <Campo
          rotulo="Bitrate alvo"
          valor={s.bitrateAlvoKbps != null ? `${s.bitrateAlvoKbps} Kbps` : "—"}
        />
        <Campo rotulo="Pacotes enviados" valor={inteiro(s.pacotesEnviados)} />
        <Campo
          rotulo="Pacotes perdidos"
          valor={inteiro(s.pacotesPerdidos)}
          alerta={(s.pacotesPerdidos ?? 0) > 0}
        />
        <Campo rotulo="Bytes enviados" valor={bytes(s.bytesEnviados)} />
        <Campo rotulo="Jitter" valor={ms(s.jitterMs)} />
        {/*
          O RTT do RTCP fica aqui, ao lado do ping de verdade, de proposito:
          foi ele que ja enganou este painel (mostrava ~117ms num caminho de
          ~5ms). Ver o par de numeros junto e o que deixa a diferenca obvia.
        */}
        <Campo rotulo="RTT do RTCP (nao e o ping)" valor={ms(s.rttRtcpMs)} />
      </Grade>
    </div>
  );
}

function Grade({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-0 max-[620px]:grid-cols-1">
      {children}
    </div>
  );
}

function Campo({
  rotulo,
  valor,
  mono,
  destaque,
  alerta,
}: {
  rotulo: string;
  valor: string;
  mono?: boolean;
  destaque?: boolean;
  alerta?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line-soft py-2">
      <span className="text-[12px] text-ink-500">{rotulo}</span>
      <span
        className={cn(
          "select-text text-right text-[13px]",
          mono && "font-mono text-[11px]",
          alerta
            ? "text-signal-dnd"
            : destaque
              ? "font-semibold text-ink-100"
              : "text-ink-200",
        )}
      >
        {valor}
      </span>
    </div>
  );
}

function Vazio({ texto }: { texto: string }) {
  return (
    <div className="grid h-32 place-items-center rounded-md border border-line bg-base-950 text-[12px] text-ink-600">
      {texto}
    </div>
  );
}

/** Grafico de linha, SVG puro — mesma abordagem do painel de Conexao. */
function Grafico({
  titulo,
  serie,
  unidade,
}: {
  titulo: string;
  serie: Amostra[];
  unidade: string;
}) {
  const W = 600;
  const H = 72;
  const valores = serie.map((a) => a.v).filter((v): v is number => v !== null);
  const atual = valores.length > 0 ? valores[valores.length - 1]! : null;

  return (
    <section>
      <div className="mb-1.5 flex items-baseline justify-between">
        <h3 className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-500">
          {titulo}
        </h3>
        <span className="text-[13px] font-semibold text-ink-100">
          {atual != null ? `${atual} ${unidade}` : "—"}
        </span>
      </div>
      {valores.length < 2 ? (
        <div className="grid h-[72px] place-items-center rounded-md bg-base-950 text-[10px] text-ink-600">
          coletando…
        </div>
      ) : (
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-[72px] w-full rounded-md bg-base-950"
          preserveAspectRatio="none"
          aria-hidden
        >
          <polyline
            points={serie
              .map((a, i) => {
                const teto = Math.max(1, ...valores);
                const x = (i / Math.max(1, serie.length - 1)) * W;
                const y = a.v == null ? H : H - (a.v / teto) * (H - 6) - 3;
                return `${x.toFixed(1)},${y.toFixed(1)}`;
              })
              .join(" ")}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            className="text-accent-400"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      )}
    </section>
  );
}

const ms = (v: number | null) => (v != null ? `${v} ms` : "—");
const inteiro = (v: number | null) =>
  v != null ? v.toLocaleString("pt-BR") : "—";

function bytes(v: number | null): string {
  if (v == null) return "—";
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
  return `${(v / (1024 * 1024)).toFixed(2)} MB`;
}
