/**
 * Log estruturado do Aether — uma linha JSON por evento, para stdout.
 *
 * POR QUE JSON PARA stdout, e nao um arquivo nem uma biblioteca:
 *  - Os dois lugares onde o codigo roda em producao capturam stdout sozinhos:
 *    a Vercel (o `console.*` das funcoes vai para o painel e para o log drain)
 *    e o Fly (`fly logs`, e tambem drain). Nenhum dos dois quer um arquivo; os
 *    dois consomem melhor NDJSON — uma linha, um objeto.
 *  - Mesma casa de estilo do `redis.ts`: o projeto ja fala com servico externo
 *    por `fetch` cru. Uma dependencia a menos para auditar, e a regra de "uma
 *    copia so" vale para a FORMA do log tambem — o runbook de incidente
 *    depende de `grep` achar o mesmo formato nos dois processos.
 *
 * POR QUE MORA EM @aether/shared: o app web e o gateway precisam emitir
 * exatamente a mesma forma, pela mesma razao que levou o `redis.ts` para ca.
 *
 * POR QUE NAO ENTRA NO BARREL (`index.ts`): este modulo usa
 * `node:async_hooks`, que o bundler do Next recusa em codigo de cliente. O
 * barrel `@aether/shared` e importado por componente de cliente; por isso o
 * acesso e so pelo subpath `@aether/shared/log`, do lado servidor.
 *
 * O QUE ISTO NAO E: nao e o Sentry. O Sentry e um SDK que engancha em
 * `captureException`. Este modulo expoe `configurarLog({ sink })` para o
 * Sentry (ou qualquer outro destino) se anexar depois SEM que o log passe a
 * depender dele.
 */

import { AsyncLocalStorage } from "node:async_hooks";

export type NivelDeLog = "debug" | "info" | "warn" | "error";

const ORDEM: Record<NivelDeLog, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/**
 * Campos que identificam DE ONDE o evento veio. Tudo opcional: um log de boot
 * nao tem usuario, um log de request nao tem socket. Chaves livres alem
 * dessas sao aceitas — mas passam pela redacao como qualquer outra.
 */
export interface ContextoDeLog {
  /** id do usuario autenticado */
  userId?: string;
  /** servidor (guild) em jogo */
  serverId?: string;
  /** canal em jogo */
  canalId?: string;
  /** correlaciona todas as linhas de uma mesma requisicao HTTP / server action */
  requisicaoId?: string;
  /** socket do gateway */
  socketId?: string;
  /** rota ou nome da action */
  rota?: string;
  [campo: string]: unknown;
}

/** Erro ja reduzido ao que cabe num log — sem referencia circular, sem ruido. */
export interface ErroSerializado {
  nome: string;
  mensagem: string;
  stack?: string;
  /** `code` de erros de Node/Prisma quando existe */
  codigo?: string;
}

export interface RegistroDeLog extends ContextoDeLog {
  ts: string;
  nivel: NivelDeLog;
  /** chave estavel de maquina: `gateway.voice.join`, `action.erro` */
  evento: string;
  msg: string;
  err?: ErroSerializado;
}

/** Extra opcional passado numa chamada de log. `err` recebe tratamento especial. */
export interface DadosDeLog {
  err?: unknown;
  [campo: string]: unknown;
}

/** Para onde a linha final vai. Trocavel em teste; padrao escreve no console. */
export type DestinoDeLog = (registro: RegistroDeLog) => void;
/**
 * Efeito colateral por registro — o Sentry se anexa aqui. Nunca deve lancar.
 *
 * O segundo argumento e o erro ORIGINAL, antes de `serializarErro`: o sink do
 * Sentry quer o `Error` de verdade (com o stack navegavel), nao a copia
 * achatada que vai na linha de log.
 */
export type SinkDeLog = (
  registro: RegistroDeLog,
  erroOriginal?: unknown,
) => void;

// ─────────────────────────────────────────────────────────────────────────────
// Redacao
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Chaves cujo VALOR nunca pode aparecer em texto claro num log. A comparacao e
 * por igualdade exata em minusculas — nao por "contem" — para nao redigir
 * `tokenExpiresAt` ou `emailVerified` sem necessidade. Cobre as duas linguas
 * porque o codebase mistura as duas em nomes de campo.
 */
const CHAVES_SENSIVEIS = new Set([
  "password",
  "senha",
  "token",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "secret",
  "segredo",
  "authorization",
  "cookie",
  "set-cookie",
  "session",
  "sessao",
  "sessão",
  "email",
  "e-mail",
  "content",
  "conteudo",
  "conteúdo",
  "body",
  "senhahash",
  "passwordhash",
]);

const PLACEHOLDER = "[redigido]";
const MAX_STRING = 2_000;
const MAX_PROFUNDIDADE = 4;
const MAX_ITENS_ARRAY = 50;

/**
 * Reduz um valor arbitrario a algo seguro de serializar: corta string longa,
 * limita profundidade e tamanho de array, redige chave sensivel, e quebra
 * qualquer ciclo. NAO e para performance de caminho quente — e para o caminho
 * de erro, onde alguem passou um objeto inteiro do Prisma sem pensar.
 */
function sanear(valor: unknown, profundidade = 0, vistos = new WeakSet<object>()): unknown {
  if (valor == null) return valor;

  if (typeof valor === "string") {
    return valor.length > MAX_STRING ? `${valor.slice(0, MAX_STRING)}… (+${valor.length - MAX_STRING})` : valor;
  }
  if (typeof valor === "number" || typeof valor === "boolean") return valor;
  if (typeof valor === "bigint") return `${valor}n`;
  if (typeof valor === "function") return `[Function ${valor.name || "anônima"}]`;
  if (typeof valor === "symbol") return valor.toString();

  if (valor instanceof Error) return serializarErro(valor);
  if (valor instanceof Date) return valor.toISOString();

  if (typeof valor === "object") {
    if (vistos.has(valor)) return "[circular]";
    if (profundidade >= MAX_PROFUNDIDADE) return "[profundo demais]";
    vistos.add(valor);

    if (Array.isArray(valor)) {
      const corte = valor.slice(0, MAX_ITENS_ARRAY).map((v) => sanear(v, profundidade + 1, vistos));
      if (valor.length > MAX_ITENS_ARRAY) corte.push(`… (+${valor.length - MAX_ITENS_ARRAY})`);
      return corte;
    }

    const saida: Record<string, unknown> = {};
    for (const [chave, v] of Object.entries(valor as Record<string, unknown>)) {
      saida[chave] = CHAVES_SENSIVEIS.has(chave.toLowerCase())
        ? PLACEHOLDER
        : sanear(v, profundidade + 1, vistos);
    }
    return saida;
  }

  return String(valor);
}

/**
 * Qualquer coisa lancavel -> forma fixa. `stack` fica: e nosso codigo, e e
 * exatamente o que se quer num log de erro. Um valor que nao e `Error` (um
 * `throw "string"`, um `reject(objeto)`) tambem tem que virar algo util.
 */
export function serializarErro(erro: unknown): ErroSerializado {
  if (erro instanceof Error) {
    const cod = (erro as { code?: unknown }).code;
    return {
      nome: erro.name,
      mensagem: erro.message,
      ...(erro.stack ? { stack: erro.stack } : {}),
      ...(typeof cod === "string" || typeof cod === "number" ? { codigo: String(cod) } : {}),
    };
  }
  if (erro && typeof erro === "object") {
    return { nome: "NaoErro", mensagem: JSON.stringify(sanear(erro)) };
  }
  return { nome: "NaoErro", mensagem: String(erro) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Estado do modulo
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Destino padrao: `console.error` para warn/error (vai para stderr, que os
 * dois provedores marcam como severidade alta), `console.log` para o resto.
 * Uma linha, JSON compacto.
 */
const destinoPadrao: DestinoDeLog = (registro) => {
  const linha = JSON.stringify(registro);
  if (registro.nivel === "error" || registro.nivel === "warn") console.error(linha);
  else console.log(linha);
};

function nivelInicial(): NivelDeLog {
  const bruto = process.env.LOG_LEVEL?.toLowerCase();
  if (bruto === "debug" || bruto === "info" || bruto === "warn" || bruto === "error") {
    return bruto;
  }
  return process.env.NODE_ENV === "production" ? "info" : "debug";
}

interface EstadoDoLog {
  nivelMinimo: NivelDeLog;
  destino: DestinoDeLog;
  sinks: SinkDeLog[];
}

const estado: EstadoDoLog = {
  nivelMinimo: nivelInicial(),
  destino: destinoPadrao,
  sinks: [],
};

const armazenamentoDeContexto = new AsyncLocalStorage<ContextoDeLog>();

// ─────────────────────────────────────────────────────────────────────────────
// Emissao
// ─────────────────────────────────────────────────────────────────────────────

function emitir(
  nivel: NivelDeLog,
  bindings: ContextoDeLog,
  evento: string,
  msg: string,
  dados?: DadosDeLog,
): void {
  if (ORDEM[nivel] < ORDEM[estado.nivelMinimo]) return;

  const { err, ...extra } = dados ?? {};

  const registro: RegistroDeLog = {
    ts: new Date().toISOString(),
    nivel,
    evento,
    msg,
    // ambiente < binding do filho < campos da chamada: o mais especifico ganha
    ...(sanear(armazenamentoDeContexto.getStore() ?? {}) as ContextoDeLog),
    ...(sanear(bindings) as ContextoDeLog),
    ...(sanear(extra) as ContextoDeLog),
    ...(err !== undefined ? { err: serializarErro(err) } : {}),
  };

  try {
    estado.destino(registro);
  } catch {
    // Um destino que quebra nao pode derrubar quem so quis logar.
  }
  for (const sink of estado.sinks) {
    try {
      sink(registro, err);
    } catch {
      // idem: o Sentry fora do ar nao pode propagar para o caminho de erro.
    }
  }
}

export interface Logger {
  debug(evento: string, msg: string, dados?: DadosDeLog): void;
  info(evento: string, msg: string, dados?: DadosDeLog): void;
  warn(evento: string, msg: string, dados?: DadosDeLog): void;
  error(evento: string, msg: string, dados?: DadosDeLog): void;
  /** Um logger novo com `bindings` fixos em toda linha (empilha com o pai). */
  filho(bindings: ContextoDeLog): Logger;
}

function criarLogger(bindings: ContextoDeLog): Logger {
  return {
    debug: (evento, msg, dados) => emitir("debug", bindings, evento, msg, dados),
    info: (evento, msg, dados) => emitir("info", bindings, evento, msg, dados),
    warn: (evento, msg, dados) => emitir("warn", bindings, evento, msg, dados),
    error: (evento, msg, dados) => emitir("error", bindings, evento, msg, dados),
    filho: (mais) => criarLogger({ ...bindings, ...mais }),
  };
}

/** O logger raiz. Sem bindings; herda so o contexto ambiente de cada chamada. */
export const log: Logger = criarLogger({});

/**
 * Roda `fn` com `ctx` no contexto ambiente — toda linha de log emitida la
 * dentro (inclusive em funcao chamada em profundidade) carrega esses campos,
 * sem ninguem precisar passar o logger como parametro.
 *
 * No app web: envolve o corpo de uma server action com `{ requisicaoId, rota,
 * userId }`. No gateway: envolve o handler de um evento com `{ socketId,
 * userId, rota: nome-do-evento }`.
 */
export function comContexto<T>(ctx: ContextoDeLog, fn: () => T): T {
  const atual = armazenamentoDeContexto.getStore() ?? {};
  return armazenamentoDeContexto.run({ ...atual, ...ctx }, fn);
}

/** Le o contexto ambiente atual (para repassar a um trabalho assincrono solto). */
export function contextoAtual(): ContextoDeLog {
  return { ...(armazenamentoDeContexto.getStore() ?? {}) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Configuracao
// ─────────────────────────────────────────────────────────────────────────────

export interface OpcoesDeLog {
  nivelMinimo?: NivelDeLog;
  /** Substitui o destino (teste captura em vez de escrever no console). */
  destino?: DestinoDeLog;
  /** Adiciona um efeito por registro (Sentry). Nao substitui o destino. */
  sink?: SinkDeLog;
}

/**
 * Ajusta o log em tempo de boot. Chamar uma vez, cedo. `sink` ACUMULA — dois
 * `configurarLog({ sink })` deixam os dois ativos.
 */
export function configurarLog(opcoes: OpcoesDeLog): void {
  if (opcoes.nivelMinimo) estado.nivelMinimo = opcoes.nivelMinimo;
  if (opcoes.destino) estado.destino = opcoes.destino;
  if (opcoes.sink) estado.sinks.push(opcoes.sink);
}

/** Volta tudo ao padrao. So para teste — producao configura uma vez e para. */
export function _resetarLogParaTeste(): void {
  estado.nivelMinimo = nivelInicial();
  estado.destino = destinoPadrao;
  estado.sinks = [];
  capturaInstalada = false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Captura de falha no nivel do processo
// ─────────────────────────────────────────────────────────────────────────────

let capturaInstalada = false;

/** So o que `capturarFalhasDoProcesso` toca do `process` — trocavel em teste. */
interface AlvoDeProcesso {
  on(evento: "unhandledRejection", ouvinte: (motivo: unknown) => void): unknown;
  on(evento: "uncaughtException", ouvinte: (erro: Error) => void): unknown;
}

/**
 * Registra os handlers que faltavam: uma `Promise` rejeitada sem `catch` e uma
 * excecao que escapou de todo `try` hoje somem no gateway sem deixar linha
 * nenhuma. Depois desta chamada, viram um log de `error` com evento estavel.
 *
 * `uncaughtException` ENCERRA o processo (padrao): a recomendacao do Node e
 * que o estado fica indefinido depois de uma dessas, e continuar rodando so
 * acumula corrupcao. O Fly reinicia a maquina limpa. Em `unhandledRejection`
 * nao encerramos — a maioria e erro de I/O recuperavel, e derrubar o gateway
 * inteiro por causa de um `fetch` que falhou seria pior que o problema.
 *
 * Idempotente: chamar duas vezes nao empilha handler.
 */
export function capturarFalhasDoProcesso(
  opcoes: {
    sairNoUncaught?: boolean;
    alvo?: AlvoDeProcesso;
    aoSair?: () => void;
  } = {},
): void {
  if (capturaInstalada) return;
  capturaInstalada = true;

  const alvo = opcoes.alvo ?? process;
  const sairNoUncaught = opcoes.sairNoUncaught ?? true;
  const aoSair =
    opcoes.aoSair ??
    (() => {
      // Uma folga para a linha sair antes do processo morrer.
      setTimeout(() => process.exit(1), 100).unref();
    });

  alvo.on("unhandledRejection", (motivo: unknown) => {
    log.error("processo.promessa_nao_tratada", "Promise rejeitada sem catch", {
      err: motivo,
    });
  });

  alvo.on("uncaughtException", (erro: Error) => {
    log.error("processo.excecao_nao_capturada", "exceção escapou de todo try", {
      err: erro,
    });
    if (sairNoUncaught) aoSair();
  });
}
