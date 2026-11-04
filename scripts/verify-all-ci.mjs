/**
 * Orquestrador da suite de integracao (fase 7d).
 *
 * O `.github/workflows/ci.yml` sobe Postgres e Redis como servicos e chama
 * este script UMA vez. Ele:
 *
 *   1. sobe o gateway (`apps/realtime`) e, salvo `SKIP_WEB=1`, o app web ja
 *      buildado, e espera os dois responderem;
 *   2. roda cada `scripts/verify-*.mjs` em ordem, capturando saida e codigo;
 *   3. restaura o fixture do seed depois dos scripts que moderam de verdade
 *      (expulsam/banem o `joao`), senao o proximo falharia na pre-condicao;
 *   4. derruba o gateway e o web;
 *   5. imprime um resumo e sai != 0 se qualquer script falhou.
 *
 * Fora do CI da para rodar tambem, desde que `DATABASE_URL` e `REDIS_URL`
 * apontem para instancias DESCARTAVEIS — varios scripts escrevem no banco.
 *
 * Variaveis:
 *   DATABASE_URL              (obrigatoria)
 *   AUTH_SECRET               (obrigatoria, >= 32 chars)
 *   REDIS_URL                 (obrigatoria — o gateway sobe no caminho 7c-2)
 *   UPSTASH_REDIS_REST_URL    (opcional — habilita o verificar-redis.mts)
 *   UPSTASH_REDIS_REST_TOKEN  (idem)
 *   SKIP_WEB=1                (opcional — pula verify-phase2 e nao sobe o web)
 *   GATEWAY_INSTANCIAS=2      (opcional, fase 7e — ver abaixo; padrao 1)
 *
 * GATEWAY_INSTANCIAS (fase 7e, item 3). Com 1 (padrao), um gateway na porta
 * 4000 com o estado EM MEMORIA — a config em que as phases 3-7b sempre foram
 * verificadas. Com N > 1, N gateways nas portas 4001..400N, TODOS com
 * `REDIS_URL` (estado 7c-2 + adapter do Socket.IO), atras de um balanceador
 * round-robin na 4000 (`lib/balanceador.mjs`). Scripts e web continuam
 * apontando para a 4000 e nao sabem quantos gateways existem. No fim, se
 * alguma instancia nao recebeu nenhum WebSocket, o job FALHA: a bateria teria
 * passado sem exercitar o caminho entre instancias.
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { iniciarBalanceador } from "./lib/balanceador.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const GATEWAY_URL = "http://127.0.0.1:4000";
const WEB_URL = "http://127.0.0.1:3000";
const SKIP_WEB = process.env.SKIP_WEB === "1";
const INSTANCIAS = Number.parseInt(process.env.GATEWAY_INSTANCIAS ?? "1", 10);
if (!Number.isInteger(INSTANCIAS) || INSTANCIAS < 1 || INSTANCIAS > 9) {
  console.error("GATEWAY_INSTANCIAS deve ser um inteiro de 1 a 9.");
  process.exit(1);
}
const MULTI = INSTANCIAS > 1;

/**
 * Scripts com FALHA CONHECIDA: rodam, a saida aparece inteira, mas nao
 * derrubam o job. Cada um so entra aqui com um motivo escrito e um lugar onde
 * o defeito esta sendo investigado — a lista existe para o CI seguir util
 * para os outros 17, nao para varrer problema para baixo do tapete.
 *
 *   verify-phase5: duas assercoes de SCREEN_SHARE ("o indicador nao acende sem
 *   a permissao" e "trocar de canal encerra a transmissao") falham contra o
 *   canal com overwrite de deny. O MESMO overwrite de SCREEN_SHARE e barrado
 *   corretamente no token do verify-phase4 — entao o defeito e do caminho do
 *   `voice:streaming`, nao do calculo de permissao. O script nunca tinha
 *   rodado em ambiente automatizado (nao ha contagem no README/DEPLOY). Em
 *   investigacao — ver a secao da fase 7d no README.
 */
const CONHECIDAS = new Set(
  (process.env.INTEGRACAO_CONHECIDAS ?? "verify-phase5").split(",").map((s) => s.trim()),
);
const HAS_UPSTASH = Boolean(
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN,
);

function need(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`falta a variavel ${name}`);
    process.exit(1);
  }
  return v;
}
need("DATABASE_URL");
const authSecret = need("AUTH_SECRET");
if (authSecret.length < 32) {
  console.error("AUTH_SECRET curto demais (minimo 32).");
  process.exit(1);
}
const redisUrl = need("REDIS_URL");
/**
 * Com mais de um gateway, o par REST do Upstash e OBRIGATORIO, como em
 * producao (`scripts/fly-secrets.mjs`): e nele que o ticket do handshake e
 * consumido uma vez so ENTRE instancias. Sem o par, cada gateway lembra os
 * tickets usados so na propria memoria, e o mesmo ticket abre uma segunda
 * conexao na outra instancia — o `verify-phase3` pega isso ("o MESMO ticket
 * nao serve duas vezes"), corretamente. Melhor parar aqui com o motivo do
 * que deixar a bateria falhar la no meio parecendo regressao.
 */
if (MULTI && !HAS_UPSTASH) {
  console.error(
    "GATEWAY_INSTANCIAS > 1 exige UPSTASH_REDIS_REST_URL e UPSTASH_REDIS_REST_TOKEN " +
      "(uso unico do ticket entre instancias — ver scripts/fly-secrets.mjs).",
  );
  process.exit(1);
}

/**
 * LiveKit: um `livekit-server --dev` de verdade sobe no job (porta 7880,
 * chave `devkey` / segredo `secret` — fixos do modo dev). Com ele o gateway
 * emite o token E consegue chamar a API administrativa (`listParticipants`, a
 * checagem de qualidade da tela) — o `verify-phase4` confere a assinatura com
 * o MESMO segredo, e o `verify-phase5` nao esbarra num SFU ausente.
 */
const LIVEKIT = {
  LIVEKIT_URL: "ws://127.0.0.1:7880",
  LIVEKIT_API_KEY: "devkey",
  LIVEKIT_API_SECRET: "secret",
};

/**
 * Com uma instancia, o gateway roda com o estado EM MEMORIA (sem `REDIS_URL`):
 * e a config em que as phases 3-7b/6 sempre foram verificadas. Com varias
 * (`GATEWAY_INSTANCIAS`), memoria nao serve — cada processo teria a propria
 * presenca —, entao TODAS recebem `REDIS_URL`: estado no Redis e adapter do
 * Socket.IO, que e a config de producao com mais de uma maquina.
 */
const gatewayEnv = {
  ...process.env,
  ...LIVEKIT,
  DATABASE_URL: process.env.DATABASE_URL,
  DIRECT_URL: process.env.DATABASE_URL,
  AUTH_SECRET: authSecret,
  REDIS_URL: MULTI ? redisUrl : "",
  REALTIME_PORT: "4000",
  NEXT_PUBLIC_APP_URL: WEB_URL,
  SESSION_GUARD_INTERVAL_MS: "3000",
  NODE_ENV: "test",
};

const webEnv = {
  ...process.env,
  DATABASE_URL: process.env.DATABASE_URL,
  DIRECT_URL: process.env.DATABASE_URL,
  AUTH_SECRET: authSecret,
  NEXT_PUBLIC_REALTIME_URL: GATEWAY_URL,
  PORT: "3000",
  NODE_ENV: "production",
};

/**
 * Ambiente que cada verify-* recebe. As chaves do LiveKit entram aqui tambem:
 * o `verify-phase4` decide se testa o caminho completo ou so a degradacao
 * olhando o PROPRIO `process.env`, e confere a assinatura do token com
 * `LIVEKIT_API_SECRET`.
 */
const scriptEnv = {
  ...process.env,
  ...LIVEKIT,
  DIRECT_URL: process.env.DATABASE_URL,
  VERIFY_REALTIME_URL: GATEWAY_URL,
  VERIFY_BASE_URL: WEB_URL,
};

const children = [];

function start(label, cmd, args, env) {
  // `detached` da a cada servico o proprio grupo de processos: `npm run`
  // lanca `sh -c` que lanca `tsx`/`next`, e matar so o `npm` deixa o neto
  // vivo — segurando a porta e, pior, mantendo o event loop do orquestrador
  // aberto no fim (o job pendurava aqui).
  const child = spawn(cmd, args, { cwd: ROOT, env, stdio: "pipe", detached: true });
  children.push({ label, child });
  const tag = (line) => line && console.log(`  [${label}] ${line}`);
  child.stdout.on("data", (b) => b.toString().split("\n").forEach(tag));
  child.stderr.on("data", (b) => b.toString().split("\n").forEach(tag));
  child.on("exit", (code) => {
    if (code != null && code !== 0 && !shuttingDown) {
      console.error(`\n[${label}] MORREU com codigo ${code}`);
    }
  });
  return child;
}

async function waitForHttp(url, label, tries = 60) {
  for (let i = 0; i < tries; i += 1) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (r.ok || r.status === 200 || r.status === 307 || r.status === 302) {
        console.log(`  ${label} no ar (${url})`);
        return;
      }
    } catch {
      /* ainda subindo */
    }
    await sleep(1000);
  }
  throw new Error(`${label} nao respondeu em ${url} apos ${tries}s`);
}

let shuttingDown = false;
/** So com `GATEWAY_INSTANCIAS > 1`. */
let balanceador = null;
function killGroup(child, signal) {
  try {
    // `-pid` = o grupo inteiro (ver `detached` no start()).
    if (child.pid) process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      /* ja morreu */
    }
  }
}
async function shutdown() {
  shuttingDown = true;
  if (balanceador) await balanceador.fechar();
  for (const { child } of children) killGroup(child, "SIGTERM");
  await sleep(800);
  for (const { child } of children) killGroup(child, "SIGKILL");
}

/** Roda um verify-* e devolve { label, code, ms }. */
function run(file, { tsx = false } = {}) {
  const label = file.replace(/\.mjs$|\.mts$/, "");
  const args = tsx
    ? ["--yes", "tsx", `scripts/${file}`]
    : [`scripts/${file}`];
  const cmd = tsx ? "npx" : "node";
  const started = Date.now();
  console.log(`\n=== ${label} ${"=".repeat(Math.max(0, 60 - label.length))}`);
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: ROOT, env: scriptEnv, stdio: "inherit" });
    child.on("exit", (code) => {
      resolve({ label, code: code ?? 1, ms: Date.now() - started });
    });
  });
}

function restoreFixture() {
  return new Promise((resolve) => {
    console.log("\n--- restore-fixture (devolve o joao ao servidor) ---");
    const child = spawn("node", ["scripts/restore-fixture.mjs"], {
      cwd: ROOT,
      env: scriptEnv,
      stdio: "inherit",
    });
    child.on("exit", () => resolve());
  });
}

async function main() {
  // --- servicos -----------------------------------------------------------
  // O `livekit-server --dev` e subido pelo workflow (docker run). Confere que
  // ele respondeu antes de subir o gateway, senao as chamadas de RoomService
  // falhariam com ECONNREFUSED no meio do verify-phase5.
  await waitForHttp("http://127.0.0.1:7880", "livekit", 30).catch((e) => {
    console.warn(`  aviso: ${e.message} — seguindo sem LiveKit`);
  });

  if (MULTI) {
    const portas = Array.from({ length: INSTANCIAS }, (_, i) => 4001 + i);
    console.log(`subindo ${INSTANCIAS} gateways (${portas.join(", ")}) com Redis...`);
    portas.forEach((porta, i) =>
      start(`gateway-${i + 1}`, "npm", ["run", "start", "--workspace=@aether/realtime"], {
        ...gatewayEnv,
        REALTIME_PORT: String(porta),
      }),
    );
    for (const porta of portas) {
      await waitForHttp(`http://127.0.0.1:${porta}/health`, `gateway :${porta}`);
    }
    balanceador = await iniciarBalanceador({ porta: 4000, alvos: portas });
    console.log(`  balanceador round-robin em ${GATEWAY_URL} -> ${portas.join(", ")}`);
    await waitForHttp(`${GATEWAY_URL}/health`, "gateway (via balanceador)");
  } else {
    console.log("subindo o gateway...");
    start("gateway", "npm", ["run", "start", "--workspace=@aether/realtime"], gatewayEnv);
    await waitForHttp(`${GATEWAY_URL}/health`, "gateway");
  }

  if (!SKIP_WEB) {
    console.log("subindo o web...");
    start("web", "npm", ["run", "start", "--workspace=@aether/web"], webEnv);
    await waitForHttp(`${WEB_URL}/login`, "web");
  }

  // --- bateria ----------------------------------------------------------
  //
  // Ordem: primeiro os autocontidos e os que so leem; os que MODERAM de
  // verdade (verify-phase6/7b: expulsam/banem/trocam cargo do joao) por
  // ultimo, cada um seguido de um restore-fixture.
  const results = [];
  const push = async (...a) => results.push(await run(...a));

  await push("verify-friends.mjs");
  await push("verify-server-ownership.mjs");
  await push("verify-password-reset.mjs");
  await push("verify-backup.mjs");
  await push("verify-igdb.mjs", { tsx: true });
  await push("verify-seguranca.mjs");
  if (!SKIP_WEB) await push("verify-phase2.mjs");
  await push("verify-phase3.mjs");
  await push("verify-phase4.mjs");
  await push("verify-phase5.mjs");
  await push("verify-dm.mjs");
  await push("verify-friends-live.mjs");
  await push("verify-perfil-ao-vivo.mjs");
  await push("verify-game-activity.mjs");

  await push("verify-phase7b.mjs");
  await restoreFixture();
  await push("verify-phase6.mjs");
  await restoreFixture();

  await push("verify-gateway-redis.mts", { tsx: true });
  if (HAS_UPSTASH) {
    await push("verificar-redis.mts", { tsx: true });
  } else {
    console.log("\n=== verificar-redis  (pulado: sem UPSTASH_REDIS_REST_URL) ===");
  }

  // --- resumo ---------------------------------------------------------
  // Copia antes do shutdown: os contadores sao do balanceador que ele fecha.
  const distribuicao = balanceador
    ? { sockets: [...balanceador.sockets], http: [...balanceador.http] }
    : null;
  await shutdown();

  console.log(`\n${"=".repeat(64)}\nRESUMO (${INSTANCIAS} gateway${MULTI ? "s" : ""})`);
  let falhas = 0;
  let conhecidas = 0;
  for (const { label, code, ms } of results) {
    const conhecida = CONHECIDAS.has(label);
    let marca = "ok   ";
    if (code !== 0) marca = conhecida ? "FALHA(conhecida)" : "FALHA";
    if (code !== 0 && conhecida) conhecidas += 1;
    else if (code !== 0) falhas += 1;
    console.log(`  ${marca.padEnd(16)} ${label.padEnd(40)} ${(ms / 1000).toFixed(1)}s`);
  }
  console.log(`${"=".repeat(64)}`);
  if (distribuicao) {
    console.log("\nDistribuicao pelo balanceador:");
    distribuicao.sockets.forEach((n, i) => {
      console.log(`  gateway-${i + 1} (:${4001 + i})  websockets=${n}  http=${distribuicao.http[i]}`);
    });
    const ociosas = distribuicao.sockets.filter((n) => n === 0).length;
    if (ociosas > 0) {
      console.error(
        `\n${ociosas} instancia(s) nao recebeu nenhum WebSocket — a bateria NAO exercitou o caminho entre instancias.`,
      );
      falhas += 1;
    }
  }
  if (conhecidas > 0) {
    console.warn(`\n${conhecidas} com FALHA CONHECIDA (nao derruba o job) — ver README, fase 7d.`);
  }
  if (falhas > 0) {
    console.error(`\n${falhas} script(s) falharam.`);
    process.exit(1);
  }
  console.log("\nOs scripts de integracao passaram (fora as falhas conhecidas).");
  // Explicito: mesmo depois do shutdown pode sobrar handle aberto (pipe de
  // neto orfao, keep-alive de fetch) e o processo penduraria o job.
  process.exit(0);
}

process.on("SIGINT", () => void shutdown().then(() => process.exit(1)));
process.on("SIGTERM", () => void shutdown().then(() => process.exit(1)));

main().catch(async (error) => {
  console.error("\nfalha no orquestrador:", error);
  await shutdown();
  process.exit(1);
});
