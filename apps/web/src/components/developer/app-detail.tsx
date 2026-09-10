"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AetherIcon, type AetherIconName } from "@/components/ui/aether-icon";
import { cn, initials, colorFromId } from "@/lib/utils";
import { copiarTexto } from "@/lib/clipboard";
import {
  apagarAppAction,
  atualizarAppAction,
  gerarTokenAction,
  habilitarBotAction,
} from "@/server/actions/developer";
import { PortalFrame } from "./portal-frame";

interface AppDetalhe {
  id: string;
  name: string;
  descricao: string | null;
  avatarUrl: string | null;
  bloqueada: boolean;
  bot: {
    userId: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
  } | null;
  tokens: Array<{
    id: string;
    prefixo: string;
    lastUsedAt: string | null;
    createdAt: string;
    revokedAt: string | null;
  }>;
  instalacoes: number;
}

const INPUT =
  "w-full rounded-md border border-line-strong bg-base-900 px-3 py-2 text-[13px] text-ink-100 outline-none focus:border-accent-500";
const BTN =
  "inline-flex h-9 items-center justify-center gap-2 rounded-md bg-accent-500 px-4 text-[13px] font-bold text-white transition-colors hover:bg-accent-400 disabled:opacity-60";
const BTN_DANGER =
  "inline-flex h-9 items-center rounded-md bg-signal-dnd px-4 text-[13px] font-bold text-white transition-colors hover:opacity-90 disabled:opacity-60";
const BTN_DANGER_OUT =
  "inline-flex h-9 items-center rounded-md border border-signal-dnd/40 px-4 text-[13px] font-bold text-signal-dnd transition-colors hover:bg-signal-dnd/10";

type Aba = "geral" | "bot" | "instalacao";

const ABAS: { id: Aba; label: string; icone: AetherIconName }[] = [
  { id: "geral", label: "Informações gerais", icone: "settings" },
  { id: "bot", label: "Bot", icone: "message" },
  { id: "instalacao", label: "Instalação", icone: "download" },
];

export function AppDetail({
  app,
  linkInstalacao,
}: {
  app: AppDetalhe;
  linkInstalacao: string;
}) {
  const [aba, setAba] = useState<Aba>("geral");

  return (
    <PortalFrame
      voltar={{ href: "/app/developers", texto: "Aplicativos" }}
      aside={
        <nav className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2 px-2 pb-3 pt-1">
            <span
              className="grid h-7 w-7 shrink-0 place-items-center overflow-hidden rounded-lg text-[11px] font-semibold text-ink-100"
              style={
                app.avatarUrl
                  ? undefined
                  : { backgroundColor: colorFromId(app.id) }
              }
            >
              {app.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={app.avatarUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                initials(app.name)
              )}
            </span>
            <span className="min-w-0 truncate text-[13px] font-semibold text-ink-100">
              {app.name}
            </span>
          </div>
          {ABAS.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => setAba(a.id)}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium transition-colors",
                aba === a.id
                  ? "bg-accent-500/12 text-accent-300"
                  : "text-ink-300 hover:bg-base-800 hover:text-ink-100",
              )}
            >
              <AetherIcon name={a.icone} className="h-4 w-4 shrink-0" />
              {a.label}
            </button>
          ))}
        </nav>
      }
    >
      {app.bloqueada ? (
        <div className="mb-5 rounded-md border border-signal-dnd/30 bg-signal-dnd/10 px-3 py-2.5 text-[13px] text-signal-dnd">
          Este aplicativo foi bloqueado pela equipe do AETHER.
        </div>
      ) : null}

      {aba === "geral" ? (
        <Geral app={app} />
      ) : aba === "bot" ? (
        <Bot app={app} />
      ) : (
        <Instalacao app={app} link={linkInstalacao} />
      )}
    </PortalFrame>
  );
}

/* ---------------------------------------------------------------- Geral --- */

function Geral({ app }: { app: AppDetalhe }) {
  const router = useRouter();
  const [name, setName] = useState(app.name);
  const [descricao, setDescricao] = useState(app.descricao ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [pedeApagar, setPedeApagar] = useState(false);

  const mudou = name !== app.name || descricao !== (app.descricao ?? "");

  function salvar() {
    setMsg(null);
    setErro(null);
    start(async () => {
      const r = await atualizarAppAction({ appId: app.id, name, descricao });
      if (r.ok) {
        setMsg("Salvo.");
        router.refresh();
      } else setErro(r.error);
    });
  }

  function apagar() {
    setErro(null);
    start(async () => {
      const r = await apagarAppAction(app.id);
      if (r.ok) router.replace("/app/developers");
      else {
        setErro(r.error);
        setPedeApagar(false);
      }
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <Secao titulo="Informações gerais" sub="Como o app se chama e o que ele faz.">
        <Campo label="Nome">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={48}
            className={INPUT}
          />
        </Campo>
        <Campo label="Descrição (máx. 400)">
          <textarea
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            maxLength={400}
            rows={3}
            placeholder="Aparece no perfil do bot."
            className={cn(INPUT, "resize-y")}
          />
        </Campo>
        <div className="flex items-center gap-3">
          <button type="button" onClick={salvar} disabled={pending || !mudou} className={BTN}>
            {pending ? "Salvando…" : "Salvar"}
          </button>
          {msg ? <span className="text-[12px] text-signal-online">{msg}</span> : null}
          {erro ? <span className="text-[12px] text-signal-dnd">{erro}</span> : null}
        </div>
      </Secao>

      <Secao titulo="ID do aplicativo" sub="Vai no link de instalação.">
        <Copiavel valor={app.id} />
      </Secao>

      <Secao
        titulo="Excluir aplicativo"
        sub="Não tem volta. Desinstale o bot de todos os servidores antes."
      >
        {pedeApagar ? (
          <div className="flex items-center gap-2">
            <button type="button" onClick={apagar} disabled={pending} className={BTN_DANGER}>
              Confirmar exclusão
            </button>
            <button
              type="button"
              onClick={() => setPedeApagar(false)}
              className="text-[12px] text-ink-400 hover:text-ink-200"
            >
              Cancelar
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => setPedeApagar(true)} className={BTN_DANGER_OUT}>
            Excluir aplicativo
          </button>
        )}
      </Secao>
    </div>
  );
}

/* ------------------------------------------------------------------ Bot --- */

function Bot({ app }: { app: AppDetalhe }) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState(app.name);
  const [erro, setErro] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [tokenNovo, setTokenNovo] = useState<string | null>(null);

  function habilitar() {
    setErro(null);
    start(async () => {
      const r = await habilitarBotAction({ appId: app.id, username, displayName });
      if (r.ok) router.refresh();
      else setErro(r.error);
    });
  }

  function gerarToken() {
    setErro(null);
    start(async () => {
      const r = await gerarTokenAction(app.id);
      if (r.ok) {
        setTokenNovo(r.data.token);
        router.refresh();
      } else setErro(r.error);
    });
  }

  if (!app.bot) {
    return (
      <Secao
        titulo="Habilitar bot"
        sub="Cria a identidade do bot — o nome que aparece no servidor."
      >
        <Campo label="Nome de usuário (@)">
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="aether-music"
            maxLength={24}
            className={INPUT}
          />
        </Campo>
        <Campo label="Nome de exibição">
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={32}
            className={INPUT}
          />
        </Campo>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={habilitar}
            disabled={pending || !username.trim() || !displayName.trim()}
            className={BTN}
          >
            {pending ? "Habilitando…" : "Habilitar bot"}
          </button>
          {erro ? <span className="text-[12px] text-signal-dnd">{erro}</span> : null}
        </div>
      </Secao>
    );
  }

  const vivos = app.tokens.filter((t) => !t.revokedAt);

  return (
    <div className="flex flex-col gap-6">
      <Secao titulo="Bot" sub="A identidade do bot nos servidores.">
        <div className="flex items-center gap-3 rounded-md border border-line bg-base-900 px-3 py-2.5">
          <span
            className="grid h-9 w-9 place-items-center overflow-hidden rounded-full text-[12px] font-semibold text-ink-100"
            style={{ backgroundColor: colorFromId(app.bot.userId) }}
          >
            {initials(app.bot.displayName)}
          </span>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold text-ink-100">
              {app.bot.displayName}
              <span className="ml-1.5 rounded-[4px] border border-ink-500/40 bg-ink-500/12 px-1 py-[1px] text-[9px] font-bold uppercase text-ink-300">
                Bot
              </span>
            </p>
            <p className="text-[12px] text-ink-500">@{app.bot.username}</p>
          </div>
        </div>
      </Secao>

      <Secao
        titulo="Token"
        sub="Credencial secreta do bot. Aparece uma vez — copie e guarde. Gerar de novo invalida o anterior."
      >
        {tokenNovo ? (
          <div className="rounded-md border border-accent-500/40 bg-accent-500/[0.06] p-3">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-accent-300">
              Copie agora — não dá para ver de novo
            </p>
            <Copiavel valor={tokenNovo} mono />
          </div>
        ) : null}

        <button type="button" onClick={gerarToken} disabled={pending} className={BTN}>
          {pending
            ? "Gerando…"
            : vivos.length > 0
              ? "Gerar novo token"
              : "Gerar token"}
        </button>
        {erro ? <p className="text-[12px] text-signal-dnd">{erro}</p> : null}

        {app.tokens.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {app.tokens.map((t) => (
              <li
                key={t.id}
                className="flex items-center justify-between rounded-md border border-line bg-base-900 px-3 py-2 text-[12px]"
              >
                <span className="font-mono text-ink-300">{t.prefixo}…</span>
                <span className="text-ink-500">
                  {t.revokedAt
                    ? "revogado"
                    : t.lastUsedAt
                      ? `último uso ${new Date(t.lastUsedAt).toLocaleDateString("pt-BR")}`
                      : "nunca usado"}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </Secao>
    </div>
  );
}

/* ---------------------------------------------------------- Instalação --- */

function Instalacao({ app, link }: { app: AppDetalhe; link: string }) {
  return (
    <div className="flex flex-col gap-6">
      <Secao
        titulo="Link de instalação"
        sub="Abra este link (ou mande para quem administra o servidor) para adicionar o bot."
      >
        {app.bot ? (
          <Copiavel valor={link} />
        ) : (
          <p className="rounded-md border border-line bg-base-900 px-3 py-2.5 text-[13px] text-ink-400">
            Habilite o bot na aba <strong>Bot</strong> primeiro.
          </p>
        )}
      </Secao>

      <Secao titulo="Servidores" sub="Onde este bot está instalado agora.">
        <p className="text-[13px] text-ink-200">
          {app.instalacoes === 0
            ? "Nenhum servidor."
            : app.instalacoes === 1
              ? "1 servidor."
              : `${app.instalacoes} servidores.`}
        </p>
      </Secao>
    </div>
  );
}

/* --------------------------------------------------------------- peças --- */

function Secao({
  titulo,
  sub,
  children,
}: {
  titulo: string;
  sub: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2.5">
      <div>
        <h2 className="font-brand text-[15px] font-semibold text-ink-100">{titulo}</h2>
        <p className="mt-0.5 text-[12px] text-ink-400">{sub}</p>
      </div>
      {children}
    </section>
  );
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-300">
      {label}
      {children}
    </label>
  );
}

function Copiavel({ valor, mono }: { valor: string; mono?: boolean }) {
  const [estado, setEstado] = useState<"parado" | "copiado" | "falhou">("parado");
  const codeRef = useRef<HTMLElement>(null);

  async function copiar() {
    if (await copiarTexto(valor)) {
      setEstado("copiado");
      setTimeout(() => setEstado("parado"), 1500);
      return;
    }
    /**
     * Os dois caminhos de `copiarTexto` falharam (acontece no app de desktop e
     * quando a janela perde o foco). Em vez de mentir "Copiado", seleciona o
     * valor na tela para o usuario dar Ctrl+C na mao.
     */
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
          className={cn(
            "min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-md border border-line bg-base-900 px-3 py-2 text-[12px] text-ink-200",
            mono && "font-mono",
          )}
        >
          {valor}
        </code>
        <button
          type="button"
          onClick={() => void copiar()}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-line-strong bg-base-800 px-3 text-[12px] font-medium text-ink-200 transition-colors hover:bg-base-700"
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
          Nao foi possivel copiar automaticamente. O valor esta selecionado —
          use Ctrl+C.
        </p>
      ) : null}
    </div>
  );
}
