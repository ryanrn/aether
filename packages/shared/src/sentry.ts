/**
 * Sink do log para o Sentry — por `fetch` cru, sem o SDK.
 *
 * POR QUE SEM `@sentry/node` / `@sentry/nextjs`: a mesma escolha do `redis.ts`
 * e do `email.ts` (Resend por REST). O SDK do Sentry arrasta
 * auto-instrumentacao de OpenTelemetry, que e peso e atrito com o runtime do
 * Next; a API de ingestao ("envelope") e estavel e documentada, e um POST
 * resolve o que um beta precisa: erro agrupado, com stack, contado.
 *
 * O QUE ELE MANDA: so registros `error` e `warn`. `info`/`debug` ficam no
 * stdout — mandar tudo para o Sentry gasta cota e afoga o que importa.
 *
 * COMO SE LIGA: `SENTRY_DSN` no ambiente. Ausente = `criarSinkSentry` devolve
 * `null` e nada acontece (dev, ou producao antes de a conta existir). O DSN e
 * `https://<chave>@<host>/<projeto>` — sem secret, formato novo.
 *
 * NUNCA BLOQUEIA, NUNCA LANCA: o `fetch` e fire-and-forget com `.catch`
 * vazio. Uma dedupe simples evita mandar o mesmo erro mil vezes num laco.
 */

import type { NivelDeLog, RegistroDeLog, SinkDeLog } from "./log";
import { serializarErro } from "./log";

interface DsnPartes {
  host: string;
  projeto: string;
  chave: string;
  urlEnvelope: string;
}

/** `https://<chave>@<host>/<path>/<projeto>` -> partes, ou `null` se malformado. */
export function parseDsn(dsn: string): DsnPartes | null {
  try {
    const u = new URL(dsn);
    const chave = u.username;
    // O id do projeto e o ultimo segmento do caminho; pode haver prefixo.
    const segmentos = u.pathname.split("/").filter(Boolean);
    const projeto = segmentos.pop();
    if (!chave || !projeto) return null;
    const prefixo = segmentos.length ? `/${segmentos.join("/")}` : "";
    return {
      host: u.host,
      projeto,
      chave,
      urlEnvelope: `${u.protocol}//${u.host}${prefixo}/api/${projeto}/envelope/`,
    };
  } catch {
    return null;
  }
}

const NIVEL_SENTRY: Record<NivelDeLog, string> = {
  debug: "debug",
  info: "info",
  warn: "warning",
  error: "error",
};

/** id de evento do Sentry: 32 hex, sem hifen. */
function idDeEvento(): string {
  // `randomUUID` existe em todo runtime que nos importa (Node 22, Edge, browser).
  return crypto.randomUUID().replace(/-/g, "");
}

const RE_FRAME_COM_FUNC = /^\s*at\s+(.+?)\s+\((.+?):(\d+):(\d+)\)\s*$/;
const RE_FRAME_SEM_FUNC = /^\s*at\s+(.+?):(\d+):(\d+)\s*$/;

interface FrameSentry {
  function?: string;
  filename: string;
  lineno: number;
  colno: number;
  in_app: boolean;
}

/**
 * Stack de V8 -> frames do Sentry. Best-effort: linha que nao casa e ignorada.
 * A ordem do Sentry e a INVERSA da do stack (frame de origem por ultimo).
 */
function framesDoStack(stack: string | undefined): FrameSentry[] {
  if (!stack) return [];
  const frames: FrameSentry[] = [];
  for (const linha of stack.split("\n")) {
    const comFunc = RE_FRAME_COM_FUNC.exec(linha);
    if (comFunc) {
      const [, fn, arquivo, ln, col] = comFunc;
      frames.push({
        function: fn,
        filename: arquivo!,
        lineno: Number(ln),
        colno: Number(col),
        in_app: !arquivo!.includes("node_modules"),
      });
      continue;
    }
    const semFunc = RE_FRAME_SEM_FUNC.exec(linha);
    if (semFunc) {
      const [, arquivo, ln, col] = semFunc;
      frames.push({
        filename: arquivo!,
        lineno: Number(ln),
        colno: Number(col),
        in_app: !arquivo!.includes("node_modules"),
      });
    }
  }
  return frames.reverse();
}

/** Campos do registro que NAO viram tag/contexto (ja tem lugar proprio). */
const CAMPOS_RESERVADOS = new Set(["ts", "nivel", "evento", "msg", "err"]);

export interface OpcoesSentry {
  dsn?: string;
  ambiente?: string;
  /** Nome do processo — "gateway" ou "web". Vira `server_name`. */
  servico?: string;
  release?: string;
  /** Trocavel em teste. Padrao: `fetch` global, fire-and-forget. */
  enviar?: (url: string, corpo: string, headers: Record<string, string>) => void;
}

/**
 * Cria o sink. `null` quando nao ha DSN — quem chama passa para
 * `configurarLog({ sink })` so se nao for nulo.
 */
export function criarSinkSentry(opcoes: OpcoesSentry = {}): SinkDeLog | null {
  const dsn = opcoes.dsn ?? process.env.SENTRY_DSN;
  if (!dsn) return null;

  const partes = parseDsn(dsn);
  if (!partes) return null;

  const ambiente =
    opcoes.ambiente ?? process.env.NODE_ENV ?? "development";
  const release = opcoes.release ?? process.env.SENTRY_RELEASE;
  const servico = opcoes.servico;

  const enviar =
    opcoes.enviar ??
    ((url, corpo, headers) => {
      void fetch(url, { method: "POST", headers, body: corpo }).catch(() => {
        // Sentry fora do ar nao pode virar problema do caminho de erro.
      });
    });

  const authHeader =
    `Sentry sentry_version=7, sentry_client=aether-raw/1.0, ` +
    `sentry_key=${partes.chave}`;

  // Dedupe: no maximo um evento por (evento+mensagem) a cada 10s. Um laco que
  // dispara o mesmo erro nao pode sozinho estourar a cota.
  const visto = new Map<string, number>();
  const JANELA_DEDUPE_MS = 10_000;

  return (registro: RegistroDeLog, erroOriginal?: unknown) => {
    if (registro.nivel !== "error" && registro.nivel !== "warn") return;

    const assinatura = `${registro.evento}|${registro.msg}`;
    const agora = Date.now();
    const ultimo = visto.get(assinatura);
    if (ultimo && agora - ultimo < JANELA_DEDUPE_MS) return;
    visto.set(assinatura, agora);
    if (visto.size > 500) visto.clear(); // teto bobo, mas suficiente

    const eventId = idDeEvento();

    const tags: Record<string, string> = { evento: registro.evento };
    const contexto: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(registro)) {
      if (CAMPOS_RESERVADOS.has(k)) continue;
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
        tags[k] = String(v);
      } else {
        contexto[k] = v;
      }
    }

    const erro = registro.err
      ? registro.err
      : erroOriginal !== undefined
        ? serializarErro(erroOriginal)
        : null;

    const evento: Record<string, unknown> = {
      event_id: eventId,
      timestamp: agora / 1000,
      platform: "node",
      level: NIVEL_SENTRY[registro.nivel],
      logger: registro.evento,
      message: { formatted: registro.msg },
      environment: ambiente,
      ...(release ? { release } : {}),
      ...(servico ? { server_name: servico } : {}),
      tags,
      ...(Object.keys(contexto).length ? { extra: contexto } : {}),
    };

    if (erro) {
      const stack =
        erro.stack ??
        (erroOriginal instanceof Error ? erroOriginal.stack : undefined);
      const frames = framesDoStack(stack);
      evento.exception = {
        values: [
          {
            type: erro.nome,
            value: erro.mensagem,
            ...(frames.length ? { stacktrace: { frames } } : {}),
          },
        ],
      };
    }

    const corpo =
      JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString() }) +
      "\n" +
      JSON.stringify({ type: "event" }) +
      "\n" +
      JSON.stringify(evento);

    enviar(partes.urlEnvelope, corpo, {
      "content-type": "application/x-sentry-envelope",
      "x-sentry-auth": authHeader,
    });
  };
}
