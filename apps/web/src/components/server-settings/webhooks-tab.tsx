"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AetherIcon } from "@/components/ui/aether-icon";
import { cn } from "@/lib/utils";
import { copiarTexto } from "@/lib/clipboard";
import {
  criarWebhookAction,
  regenerarWebhookTokenAction,
  revogarWebhookAction,
} from "@/server/actions/developer";

interface WebhookItem {
  id: string;
  name: string;
  channelId: string;
  createdAt: string;
  revogado: boolean;
}

/**
 * Webhooks de ENTRADA do servidor.
 *
 * Cada um é um link `POST /api/v1/webhooks/:id/:token` que publica no canal
 * escolhido. O token aparece UMA vez (na criação ou regeneração) — o painel
 * nunca o mostra depois.
 */
export function WebhooksTab({
  serverId,
  webhooks,
  canaisDeTexto,
}: {
  serverId: string;
  webhooks: WebhookItem[];
  canaisDeTexto: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  const [nome, setNome] = useState("");
  const [canal, setCanal] = useState(canaisDeTexto[0]?.id ?? "");
  const [tokenNovo, setTokenNovo] = useState<{ id: string; url: string } | null>(
    null,
  );

  const base =
    typeof window !== "undefined" ? window.location.origin : "";
  const nomeCanal = (id: string) =>
    canaisDeTexto.find((c) => c.id === id)?.name ?? "canal removido";

  function criar() {
    setErro(null);
    start(async () => {
      const r = await criarWebhookAction({ serverId, channelId: canal, name: nome });
      if (r.ok) {
        setTokenNovo({
          id: r.data.id,
          url: `${base}/api/v1/webhooks/${r.data.id}/${r.data.token}`,
        });
        setNome("");
        router.refresh();
      } else setErro(r.error);
    });
  }

  function regenerar(webhookId: string) {
    setErro(null);
    start(async () => {
      const r = await regenerarWebhookTokenAction({ serverId, webhookId });
      if (r.ok) {
        setTokenNovo({
          id: webhookId,
          url: `${base}/api/v1/webhooks/${webhookId}/${r.data.token}`,
        });
        router.refresh();
      } else setErro(r.error);
    });
  }

  function revogar(webhookId: string) {
    setErro(null);
    start(async () => {
      const r = await revogarWebhookAction({ serverId, webhookId });
      if (r.ok) {
        if (tokenNovo?.id === webhookId) setTokenNovo(null);
        router.refresh();
      } else setErro(r.error);
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-[15px] font-semibold text-ink-100">Webhooks</h2>
        <p className="mt-1 text-[13px] text-ink-400">
          Um serviço externo faz <code className="text-ink-300">POST</code> no
          link do webhook e a mensagem aparece no canal. Corpo:{" "}
          <code className="text-ink-300">{`{ "content": "..." }`}</code>.
        </p>
      </div>

      {tokenNovo ? (
        <div className="rounded-md border border-accent-500/40 bg-accent-500/[0.06] p-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-accent-300">
            Copie agora — o link não aparece de novo
          </p>
          <CaixaDeToken url={tokenNovo.url} />
        </div>
      ) : null}

      {/* criar */}
      {canaisDeTexto.length === 0 ? (
        <p className="rounded-md border border-line bg-base-900 px-3 py-2.5 text-[13px] text-ink-400">
          Crie um canal de texto primeiro.
        </p>
      ) : (
        <div className="flex flex-col gap-2.5 rounded-md border border-line bg-base-850 p-3">
          <p className="text-[12px] font-semibold text-ink-200">Novo webhook</p>
          <div className="flex flex-wrap gap-2">
            <input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Nome (ex.: Alertas)"
              maxLength={32}
              className="min-w-[160px] flex-1 rounded-md border border-line-strong bg-base-900 px-3 py-2 text-[13px] text-ink-100 outline-none focus:border-accent-500"
            />
            <select
              value={canal}
              onChange={(e) => setCanal(e.target.value)}
              className="rounded-md border border-line-strong bg-base-900 px-3 py-2 text-[13px] text-ink-100 outline-none focus:border-accent-500"
            >
              {canaisDeTexto.map((c) => (
                <option key={c.id} value={c.id}>
                  #{c.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={criar}
              disabled={pending || !nome.trim() || !canal}
              className="inline-flex h-9 items-center gap-2 rounded-md bg-accent-500 px-3.5 text-[13px] font-bold text-white transition-colors hover:bg-accent-400 disabled:opacity-60"
            >
              <AetherIcon name="plus" className="h-4 w-4" />
              Criar
            </button>
          </div>
        </div>
      )}

      {erro ? <p className="text-[12px] text-signal-dnd">{erro}</p> : null}

      {/* lista */}
      {webhooks.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {webhooks.map((w) => (
            <li
              key={w.id}
              className={cn(
                "flex items-center justify-between gap-3 rounded-md border border-line bg-base-900 px-3 py-2.5",
                w.revogado && "opacity-60",
              )}
            >
              <div className="min-w-0">
                <p className="truncate text-[13px] font-medium text-ink-100">
                  {w.name}
                  {w.revogado ? (
                    <span className="ml-2 text-[11px] text-ink-500">
                      revogado
                    </span>
                  ) : null}
                </p>
                <p className="text-[12px] text-ink-500">
                  #{nomeCanal(w.channelId)}
                </p>
              </div>
              {!w.revogado ? (
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => regenerar(w.id)}
                    disabled={pending}
                    className="text-[12px] text-ink-400 hover:text-ink-200"
                  >
                    Regenerar
                  </button>
                  <button
                    type="button"
                    onClick={() => revogar(w.id)}
                    disabled={pending}
                    className="text-[12px] text-signal-dnd hover:opacity-80"
                  >
                    Revogar
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-ink-500">Nenhum webhook ainda.</p>
      )}
    </div>
  );
}

/**
 * Link do webhook + botao de copiar. Usa `copiarTexto` (tem plano B para o app
 * de desktop e para a janela sem foco); se os dois caminhos falharem, seleciona
 * o link na tela em vez de fingir que copiou.
 */
function CaixaDeToken({ url }: { url: string }) {
  const [estado, setEstado] = useState<"parado" | "copiado" | "falhou">("parado");
  const codeRef = useRef<HTMLElement>(null);

  async function copiar() {
    if (await copiarTexto(url)) {
      setEstado("copiado");
      setTimeout(() => setEstado("parado"), 1500);
      return;
    }
    setEstado("falhou");
    const alvo = codeRef.current;
    if (alvo) {
      const range = document.createRange();
      range.selectNodeContents(alvo);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-stretch gap-2">
        <code
          ref={codeRef}
          className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-md border border-line bg-base-900 px-3 py-2 font-mono text-[12px] text-ink-200"
        >
          {url}
        </code>
        <button
          type="button"
          onClick={() => void copiar()}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-line-strong bg-base-800 px-3 text-[12px] font-medium text-ink-200 hover:bg-base-700"
        >
          <AetherIcon
            name={estado === "copiado" ? "check" : "copy"}
            className="h-3.5 w-3.5"
          />
          {estado === "copiado" ? "Copiado" : "Copiar"}
        </button>
      </div>
      {estado === "falhou" ? (
        <p className="text-[11px] text-signal-dnd">
          Nao foi possivel copiar automaticamente. O link esta selecionado — use
          Ctrl+C.
        </p>
      ) : null}
    </div>
  );
}
