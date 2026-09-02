"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Activity, Bug, ClipboardCheck, Copy, Lock } from "lucide-react";
import { useRealtimeStore } from "@/lib/stores/realtime-store";
import type { ConnectionStats } from "@/lib/voice/connection-stats";
import { cn } from "@/lib/utils";

/**
 * Painel de "Conexao" — ping, perda de pacotes e regiao da sessao de voz.
 *
 * Nao mede nada enquanto fechado: a assinatura em `subscribeConnectionStats`
 * so comeca no `useEffect` deste componente, que so monta quando o painel
 * abre. Fechou, para de medir.
 *
 * Renderizado num PORTAL com posicao fixa, ancorado ao botao — o palco tem
 * `overflow-y-auto` e recortaria um dropdown normal.
 *
 * O rodape diz "conexao criptografada", NAO "de ponta a ponta": a midia e
 * cifrada no transporte (DTLS-SRTP) mas o SFU a decifra para reencaminhar.
 * Copiar o texto do Discord aqui seria mentira.
 */

const LARGURA = 300;
const GAP = 8;

export function ConnectionPanel({
  anchorEl,
  onClose,
}: {
  anchorEl: HTMLElement;
  onClose: () => void;
}) {
  const subscribe = useRealtimeStore(
    (state) => state.roomControls?.subscribeConnectionStats,
  );
  const [stats, setStats] = useState<ConnectionStats | null>(null);
  const [copiado, setCopiado] = useState(false);
  const painelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    if (!subscribe) return;
    return subscribe(setStats);
  }, [subscribe]);

  useLayoutEffect(() => {
    const anchor = anchorEl.getBoundingClientRect();
    const altura = painelRef.current?.offsetHeight ?? 220;
    let left = anchor.right - LARGURA;
    left = Math.max(GAP, Math.min(left, window.innerWidth - LARGURA - GAP));
    let top = anchor.bottom + GAP;
    if (top + altura > window.innerHeight - GAP) {
      top = Math.max(GAP, anchor.top - altura - GAP);
    }
    setPos({ left, top });
  }, [anchorEl, stats]);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      const alvo = e.target as Node;
      // O proprio botao de sinal ja alterna aberto/fechado no onClick dele —
      // fechar aqui tambem faria o clique reabrir logo em seguida.
      if (
        !painelRef.current?.contains(alvo) &&
        !anchorEl.contains(alvo)
      ) {
        onClose();
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    // `setTimeout` para o clique que ABRIU o painel nao o fechar no mesmo tick.
    const t = setTimeout(() => document.addEventListener("mousedown", onDown));
    document.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose, anchorEl]);

  function copiarDiagnostico() {
    const dump = {
      geradoEm: new Date().toISOString(),
      userAgent: navigator.userAgent,
      stats,
    };
    void navigator.clipboard
      ?.writeText(JSON.stringify(dump, null, 2))
      .then(() => {
        setCopiado(true);
        setTimeout(() => setCopiado(false), 2000);
      })
      .catch(() => undefined);
  }

  function ligarDepuracao() {
    const url = new URL(window.location.href);
    url.searchParams.set("debug", "media");
    window.location.href = url.toString();
  }

  const rtt = stats?.rttMs ?? null;
  const loss = stats?.lossPct ?? null;
  const ruim =
    (rtt !== null && rtt >= 250) || (loss !== null && loss >= 10);

  return createPortal(
    <div
      ref={painelRef}
      role="dialog"
      aria-label="Conexao"
      className={cn(
        "fixed z-50 rounded-lg border border-base-700 bg-base-900 p-3 text-[12px] text-ink-200 shadow-xl",
        pos ? "opacity-100" : "pointer-events-none opacity-0",
      )}
      style={{ width: LARGURA, left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}
    >
      <div className="mb-2 flex items-center gap-2 text-ink-100">
        <Activity className="h-3.5 w-3.5 text-accent-300" />
        <span className="font-medium">Conexao</span>
        <span
          className={cn(
            "ml-auto rounded-sm px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em]",
            qualidadeClasse(stats?.quality),
          )}
        >
          {stats?.quality ?? "…"}
        </span>
      </div>

      <Sparkline history={stats?.history ?? []} />

      <div className="mt-2 space-y-1">
        <Linha rotulo="Regiao" valor={stats?.region ?? "—"} mono />
        <Linha
          rotulo="Ping medio"
          valor={stats?.rttMediaMs != null ? `${stats.rttMediaMs} ms` : "—"}
        />
        <Linha
          rotulo="Ultimo ping"
          valor={rtt != null ? `${rtt} ms` : "—"}
        />
        <Linha
          rotulo="Perda de pacotes enviados"
          valor={loss != null ? `${loss.toFixed(1)}%` : "—"}
          alerta={loss != null && loss >= 10}
        />
      </div>

      {ruim ? (
        <p className="mt-2 rounded-sm bg-signal-idle/10 px-2 py-1.5 text-[11px] leading-snug text-signal-idle">
          Ping acima de 250 ms ou perda acima de 10% deixam a voz robotica ou
          com atraso. Se persistir, desconecte e entre de novo.
        </p>
      ) : null}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={ligarDepuracao}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-base-700 px-2 py-1.5 text-[11px] transition-colors hover:bg-base-800"
        >
          <Bug className="h-3 w-3" />
          Depuracao
        </button>
        <button
          type="button"
          onClick={copiarDiagnostico}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-base-700 px-2 py-1.5 text-[11px] transition-colors hover:bg-base-800"
        >
          {copiado ? (
            <ClipboardCheck className="h-3 w-3 text-accent-300" />
          ) : (
            <Copy className="h-3 w-3" />
          )}
          {copiado ? "Copiado" : "Copiar diagnostico"}
        </button>
      </div>

      <p className="mt-2.5 flex items-center gap-1.5 text-[10px] text-ink-500">
        <Lock className="h-3 w-3" />
        Conexao criptografada (DTLS-SRTP) ate o servidor de midia.
      </p>
    </div>,
    document.body,
  );
}

function Linha({
  rotulo,
  valor,
  mono,
  alerta,
}: {
  rotulo: string;
  valor: string;
  mono?: boolean;
  alerta?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-ink-500">{rotulo}</span>
      <span
        className={cn(
          mono && "font-mono text-[11px]",
          alerta ? "text-signal-dnd" : "text-ink-100",
        )}
      >
        {valor}
      </span>
    </div>
  );
}

function qualidadeClasse(q: ConnectionStats["quality"] | undefined): string {
  switch (q) {
    case "excelente":
    case "boa":
      return "bg-signal-online/15 text-signal-online";
    case "ruim":
      return "bg-signal-dnd/15 text-signal-dnd";
    default:
      return "bg-base-800 text-ink-500";
  }
}

/** Gráfico de ping das últimas amostras. SVG puro, sem dependência. */
function Sparkline({ history }: { history: ConnectionStats["history"] }) {
  const W = 276;
  const H = 44;
  const pings = history.map((h) => h.rttMs).filter((v): v is number => v !== null);
  if (pings.length < 2) {
    return (
      <div className="grid h-11 place-items-center rounded-sm bg-base-950 text-[10px] text-ink-600">
        coletando…
      </div>
    );
  }
  const max = Math.max(60, ...pings);
  const pontos = history
    .map((h, i) => {
      const x = (i / (history.length - 1)) * W;
      const y = h.rttMs == null ? H : H - (h.rttMs / max) * H;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-11 w-full rounded-sm bg-base-950"
      preserveAspectRatio="none"
      aria-hidden
    >
      <polyline
        points={pontos}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        className="text-accent-400"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
