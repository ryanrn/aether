/**
 * Verificacao da ponte TikTok -> Roblox.
 *
 * Mesmo espirito dos `scripts/verify-phase*.mjs` do monorepo: exercita o
 * caminho de verdade, nao uma reimplementacao dele. A parte de API sobe o
 * processo real e fala HTTP com ele.
 *
 * Nao precisa de live, nem de `npm install`, nem do Roblox aberto:
 *
 *   node verify.mjs
 */
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { normalize, parseEvent, sanitizeText } from "./server/src/commands.ts";
import { createQueue } from "./server/src/queue.ts";
import { createCooldown, createDedupe, createTokenBucket } from "./server/src/rate-limit.ts";

let passed = 0;
let failed = 0;

function check(label, ok, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`  ok    ${label}`);
  } else {
    failed += 1;
    console.log(`  FALHA ${label}${detail ? ` - ${detail}` : ""}`);
  }
}

function section(name) {
  console.log(`\n${name}`);
}

const viewer = {
  id: "tiktok:1",
  handle: "fulano",
  nickname: "Fulano",
  avatarUrl: null,
  robloxUserId: null,
};
const chat = (text) => ({ source: "chat", viewer, text });
const OPEN = { profile: "default", spawnOnAnyComment: true };
const STRICT = { profile: "default", spawnOnAnyComment: false };

/** Escrito assim, e nao colado, porque caractere invisivel em codigo-fonte
 *  desaparece em qualquer diff e ninguem consegue revisar. */
const CONTROLE = String.fromCharCode(7);
const LARGURA_ZERO = String.fromCharCode(0x200b);

// ---------------------------------------------------------------- dicionario
section("dicionario de comandos");
check("normalize tira espaco e minusculiza", normalize("  PULAR ") === "pular");
check("normalize tira o prefixo de comando", normalize("!pular") === "pular");
check("normalize tira acento", normalize("Dança") === "danca");
check('"pular" vira jump', parseEvent(chat("pular"), OPEN)?.kind === "jump");
check('"BOMBA agora" vira bomb', parseEvent(chat("BOMBA agora"), OPEN)?.kind === "bomb");
check(
  '"cor vermelho" vira color com argumento',
  (() => {
    const parsed = parseEvent(chat("cor vermelho"), OPEN);
    return parsed?.kind === "color" && parsed.params.arg === "vermelho";
  })(),
);
check('"cor" sozinho nao vira acao', parseEvent(chat("cor"), OPEN) === null);
check("comentario solto vira spawn quando permitido", parseEvent(chat("oi gente"), OPEN)?.kind === "spawn");
check("comentario solto e ignorado quando nao permitido", parseEvent(chat("oi gente"), STRICT) === null);
check("comentario vazio nao vira acao", parseEvent(chat("   "), OPEN) === null);
check(
  "presente vira acao sem passar por dicionario",
  parseEvent({ source: "gift", viewer, text: "", params: { diamonds: 5 } }, STRICT)?.kind === "gift",
);
check("sanitizeText tira caractere de controle", sanitizeText(`a${CONTROLE}b`) === "ab");
check("sanitizeText tira largura zero", sanitizeText(`a${LARGURA_ZERO}b`) === "ab");
check("sanitizeText corta no limite", sanitizeText("x".repeat(80)).length === 40);

// ---------------------------------------------------------------------- fila
section("fila (cursor, prazo, capacidade)");
{
  let clock = 1_000;
  const queue = createQueue({ capacity: 5, ttlMs: 10_000, now: () => clock });
  const push = (kind) =>
    queue.push({ at: clock, kind, keyword: null, source: "chat", viewer, params: {} });

  push("spawn");
  push("jump");
  push("bomb");

  const first = queue.pull(0, 40);
  check("pull(0) traz tudo", first.actions.length === 3 && first.cursor === 3);
  check("nada foi perdido", first.dropped === 0);

  const second = queue.pull(first.cursor, 40);
  check("pull no cursor nao repete acao", second.actions.length === 0);
  check("cursor nao anda sozinho", second.cursor === 3);

  push("sphere");
  const third = queue.pull(first.cursor, 40);
  check(
    "acao nova aparece depois do cursor",
    third.actions.length === 1 && third.actions[0].kind === "sphere",
  );

  const cap = createQueue({ capacity: 3, ttlMs: 10_000, now: () => clock });
  for (let i = 0; i < 6; i += 1) {
    cap.push({ at: clock, kind: `k${i}`, keyword: null, source: "chat", viewer, params: {} });
  }
  const overflow = cap.pull(0, 40);
  check("capacidade estourada guarda so as mais novas", overflow.actions.length === 3);
  check("as mais VELHAS sao as descartadas", overflow.actions[0].kind === "k3");
  check("o descarte e reportado", overflow.dropped === 3, `dropped=${overflow.dropped}`);

  clock += 30_000;
  const expired = queue.pull(0, 40);
  check("acao vencida nao e entregue", expired.actions.length === 0);

  const rewind = queue.pull(999, 40);
  check("cursor de outra encarnacao nao trava o jogo", rewind.cursor >= 0 && rewind.actions.length === 0);
  queue.stop();
}

{
  const queue = createQueue({ capacity: 10, ttlMs: 10_000 });
  const startedAt = Date.now();
  const waiting = queue.wait(0, 1_000);
  queue.push({ at: Date.now(), kind: "spawn", keyword: null, source: "chat", viewer, params: {} });
  await waiting;
  check("long polling acorda na hora que chega acao", Date.now() - startedAt < 200);

  const idleAt = Date.now();
  await queue.wait(99, 250);
  check("long polling respeita o teto de espera", Date.now() - idleAt >= 200);
  queue.stop();
}

// ------------------------------------------------------------------- limites
section("limites por espectador");
{
  let clock = 0;
  const bucket = createTokenBucket({ capacity: 2, refillPerSecond: 1, now: () => clock });
  check("primeira passa", bucket.take("a"));
  check("segunda passa", bucket.take("a"));
  check("terceira e recusada", !bucket.take("a"));
  check("outra pessoa nao e afetada", bucket.take("b"));
  clock += 1_000;
  check("o balde enche com o tempo", bucket.take("a"));
  bucket.stop();

  const dedupe = createDedupe({ windowMs: 1_000, now: () => clock });
  check("primeiro comentario passa", dedupe.accept("x"));
  check("o mesmo comentario repetido nao", !dedupe.accept("x"));
  clock += 2_000;
  check("depois da janela passa de novo", dedupe.accept("x"));
  dedupe.stop();

  const cooldown = createCooldown({ now: () => clock });
  check("primeiro uso do comando passa", cooldown.ready("a|bomb", 5_000));
  check("uso seguido e recusado", !cooldown.ready("a|bomb", 5_000));
  check("outro comando da mesma pessoa passa", cooldown.ready("a|jump", 5_000));
  cooldown.stop();
}

// ----------------------------------------------------------------------- API
section("API HTTP (processo de verdade)");

const dir = mkdtempSync(join(tmpdir(), "ponte-"));
const KEY = "chave-de-verificacao-1";
writeFileSync(
  join(dir, "games.json"),
  JSON.stringify({
    games: [
      { id: "jogoa", name: "Jogo A", key: KEY, tiktok: "@a", spawnOnAnyComment: true },
      { id: "jogob", name: "Jogo B", key: "chave-de-verificacao-2", tiktok: "@a" },
    ],
  }),
);

const running = [];

/** Sobe uma ponte de verdade e espera ela responder. */
async function startBridge(extraEnv) {
  const port = 8100 + Math.floor(Math.random() * 800);
  const child = spawn(process.execPath, ["server/src/index.ts", "--source=simulator"], {
    env: {
      ...process.env,
      BRIDGE_PORT: String(port),
      BRIDGE_GAMES_FILE: join(dir, "games.json"),
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  running.push(child);

  let log = "";
  child.stdout.on("data", (chunk) => (log += chunk));
  child.stderr.on("data", (chunk) => (log += chunk));

  const base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await sleep(100);
    const alive = await fetch(`${base}/health`)
      .then((response) => response.ok)
      .catch(() => false);
    if (alive) return { base, up: true, log: () => log };
  }
  return { base, up: false, log: () => log };
}

const auth = { "x-bridge-key": KEY };

try {
  // Ponte movimentada: o simulador despeja um evento a cada 250ms.
  const busy = await startBridge({ SIM_INTERVAL_MS: "250" });
  const get = (path, headers = {}) => fetch(`${busy.base}${path}`, { headers });

  check("o processo subiu", busy.up, busy.log().slice(-400));
  if (busy.up) {
    check("/health responde sem chave", (await get("/health")).ok);

    check("pull sem chave e 404", (await get("/v1/games/jogoa/pull")).status === 404);
    check(
      "pull com chave errada e 404 (nao 403)",
      (await get("/v1/games/jogoa/pull", { "x-bridge-key": "errada-errada" })).status === 404,
    );
    check(
      "jogo inexistente responde igual a chave errada",
      (await get("/v1/games/naoexiste/pull", { "x-bridge-key": KEY })).status === 404,
    );
    check(
      "a chave de um jogo nao abre o outro",
      (await get("/v1/games/jogob/pull", { "x-bridge-key": KEY })).status === 404,
    );

    await sleep(1_200);

    const first = await (await get("/v1/games/jogoa/pull?since=0&max=40", auth)).json();
    check("pull autenticado responde", first.ok === true);
    check("chegou acao do simulador", first.acoes.length > 0, JSON.stringify(first).slice(0, 200));
    check(
      "toda acao tem seq, kind e espectador",
      first.acoes.every(
        (action) => typeof action.seq === "number" && action.kind && action.viewer?.id,
      ),
    );

    const second = await (
      await get(`/v1/games/jogoa/pull?since=${first.cursor}&max=40`, auth)
    ).json();
    check("nada repete depois do cursor", second.acoes.every((action) => action.seq > first.cursor));

    const capped = await (await get("/v1/games/jogoa/pull?since=0&max=999", auth)).json();
    check("o lote e limitado a 40 acoes", capped.acoes.length <= 40);

    // Esta e a propriedade que interessa ao vivo: com long polling, a acao sai
    // da fila para o jogo em milissegundos, nao no proximo tique do loop.
    const wokeAt = Date.now();
    const woke = await (
      await get(`/v1/games/jogoa/pull?since=${capped.cursor}&wait=5000`, auth)
    ).json();
    const latency = Date.now() - wokeAt;
    check("long polling entrega assim que chega acao", woke.acoes.length > 0 && latency < 1_500, `${latency}ms`);

    const beat = await fetch(`${busy.base}/v1/games/jogoa/heartbeat`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ jogadores: 1, bonecos: 12 }),
    });
    check("heartbeat aceito", beat.status === 200);
    const health = await (await get("/health")).json();
    const jogoa = health.jogos.find((game) => game.id === "jogoa");
    check("o health registra o sinal de vida do jogo", jogoa?.ultimoSinalDeVidaMs !== null);
    check("o health nao vaza a chave", !JSON.stringify(health).includes(KEY));
  }

  // Ponte parada: sem evento nenhum, da para exercitar o fim do long polling.
  // O teto de espera cai para 1,5s so aqui: com o padrao de 20s este bloco
  // sozinho levaria meio minuto para verificar uma regra de uma linha.
  const quiet = await startBridge({ SIM_INTERVAL_MS: "600000", LONG_POLL_MAX_MS: "1500" });
  check("a ponte parada subiu", quiet.up, quiet.log().slice(-400));
  if (quiet.up) {
    const heldAt = Date.now();
    const response = await fetch(`${quiet.base}/v1/games/jogoa/pull?since=0&wait=1000`, {
      headers: auth,
    });
    const held = await response.json();
    const elapsed = Date.now() - heldAt;
    check("long polling segura a conexao ate o teto", elapsed >= 900 && elapsed < 3_000, `${elapsed}ms`);
    check("long polling vencido responde vazio, e nao erro", held.ok === true && held.acoes.length === 0);
    check("o cursor volta valido mesmo sem acao", typeof held.cursor === "number");

    // O teto do servidor vale mesmo se o jogo pedir mais.
    const cappedWaitAt = Date.now();
    await fetch(`${quiet.base}/v1/games/jogoa/pull?since=0&wait=999999`, { headers: auth });
    const cappedWait = Date.now() - cappedWaitAt;
    check(
      "espera pedida acima do teto e cortada pelo servidor",
      cappedWait < 4_000,
      `${cappedWait}ms`,
    );
  }
} finally {
  for (const child of running) child.kill("SIGTERM");
}

console.log(`\n${passed} ok, ${failed} falha(s)`);
process.exit(failed === 0 ? 0 : 1);
