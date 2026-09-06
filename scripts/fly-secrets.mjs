/**
 * Envia os secrets do gateway para o Fly.io lendo o .env local.
 *
 * Por que existe: digitar `fly secrets set AUTH_SECRET="..."` deixa o segredo
 * no historico do terminal e, dependendo do shell, em arquivo no disco. Este
 * script passa os valores pela entrada padrao do flyctl — eles nunca aparecem
 * na tela nem no historico.
 *
 * Uso:
 *   node scripts/fly-secrets.mjs https://SEU-APP.vercel.app [nome-do-app-fly]
 *
 * O primeiro argumento e a URL publica do app web. Ela vira a ORIGEM LIBERADA
 * no CORS do gateway — se estiver errada, o navegador recusa toda conexao.
 */
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";

/** So o que o gateway precisa. DIRECT_URL, por exemplo, e so para migrations. */
const REQUIRED = [
  "AUTH_SECRET",
  "DATABASE_URL",
  "LIVEKIT_URL",
  "LIVEKIT_API_KEY",
  "LIVEKIT_API_SECRET",
];

/**
 * O nome do app sai do fly.toml. O `fly launch` gera um nome proprio e
 * ignora o `--name`, entao digitar o nome a mao aqui e convite a errar e
 * mandar secret para o app errado.
 */
function appNameFromFlyToml() {
  try {
    const toml = readFileSync("fly.toml", "utf8");
    const match = toml.match(/^app\s*=\s*['"]([^'"]+)['"]/m);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

const appUrl = process.argv[2];
const flyApp = process.argv[3] ?? appNameFromFlyToml() ?? "aether-gateway";

if (!appUrl || !/^https?:\/\//.test(appUrl)) {
  console.error(
    "Informe a URL publica do app web.\n" +
      "  node scripts/fly-secrets.mjs https://SEU-APP.vercel.app [nome-do-app-fly]",
  );
  process.exit(1);
}

/** Parser minimo de .env: ignora comentario, espaco e aspas. */
function parseEnv(text) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

let env;
try {
  env = parseEnv(readFileSync(".env", "utf8"));
} catch {
  console.error("Nao encontrei o .env na raiz. Rode este script da raiz do repositorio.");
  process.exit(1);
}

const missing = REQUIRED.filter((key) => !env[key]);
if (missing.length > 0) {
  console.error(`Faltando no .env: ${missing.join(", ")}`);
  process.exit(1);
}

/**
 * O pooler do Supabase vem com connection_limit=1, o que serializa as
 * consultas — e o gateway faz uma por mensagem enviada. Corrigimos aqui porque
 * e o tipo de detalhe que se esquece e so aparece como "o chat esta lento".
 */
let databaseUrl = env.DATABASE_URL;
let bumped = false;
if (/[?&]connection_limit=1(&|$)/.test(databaseUrl)) {
  databaseUrl = databaseUrl.replace(/([?&]connection_limit=)1(&|$)/, "$15$2");
  bumped = true;
} else if (!/connection_limit=/.test(databaseUrl)) {
  databaseUrl += (databaseUrl.includes("?") ? "&" : "?") + "connection_limit=5";
  bumped = true;
}

const payload = {
  AUTH_SECRET: env.AUTH_SECRET,
  DATABASE_URL: databaseUrl,
  LIVEKIT_URL: env.LIVEKIT_URL,
  LIVEKIT_API_KEY: env.LIVEKIT_API_KEY,
  LIVEKIT_API_SECRET: env.LIVEKIT_API_SECRET,
  // No gateway esta variavel nao e sobre o Next: e a origem liberada no CORS.
  NEXT_PUBLIC_APP_URL: appUrl.replace(/\/$/, ""),
  NODE_ENV: "production",
};

/**
 * Redis (fase 7c). Opcional e em par: o gateway usa para o consumo UNICO de
 * ticket valer entre instancias. Sem ele, a lembranca fica na memoria do
 * processo — correto com uma maquina, e a segunda reabriria a janela de
 * replay de ticket.
 */
const REDIS_KEYS = ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"];
const redisMissing = REDIS_KEYS.filter((key) => !env[key]);
if (redisMissing.length === 0) {
  for (const key of REDIS_KEYS) payload[key] = env[key];
}

/**
 * Redis, mas o OUTRO Redis (fase 7c-2). `REDIS_URL` e uma conexao TCP
 * (`rediss://...`), da aba "Redis Connect" do Upstash — diferente do par
 * REST acima, que vem da aba "REST API" e nao serve aqui: presenca, voz e o
 * adapter do Socket.IO precisam de pub/sub e de HSET/SADD numa conexao
 * persistente, que a API REST nao oferece. Sozinha, e sozinha de proposito:
 * sem ela o gateway sobe com presenca e voz em memoria, exatamente como
 * sempre foi — so uma segunda maquina passa a exigi-la.
 */
if (env.REDIS_URL) payload.REDIS_URL = env.REDIS_URL;

/**
 * IGDB, via Twitch (capa de jogo na atividade). Opcional e em par.
 *
 * Vai para o GATEWAY, e so para ele: e o gateway que recebe o nome do jogo e
 * resolve a capa. O `TWITCH_CLIENT_SECRET` nao vai para a Vercel nem para o
 * Electron — o app desktop carrega conteudo remoto, e segredo la e segredo
 * publicado.
 *
 * Sem o par, a atividade funciona igual: nome do jogo e icone do executavel,
 * so sem capa.
 */
const TWITCH_KEYS = ["TWITCH_CLIENT_ID", "TWITCH_CLIENT_SECRET"];
const twitchMissing = TWITCH_KEYS.filter((key) => !env[key]);
if (twitchMissing.length === 0) {
  for (const key of TWITCH_KEYS) payload[key] = env[key];
}

/**
 * R2, e SO a URL publica (anexo no chat).
 *
 * O gateway nao envia nem assina nada: ele so monta o endereco publico do
 * arquivo ao serializar a mensagem. As credenciais de escrita ficam na Vercel,
 * onde a assinatura acontece — mandar chave secreta para ca seria ampliar o
 * alcance de um vazamento sem ganhar nada.
 *
 * Sem ela a mensagem chega sem o link do anexo, e o arquivo fica invisivel
 * para quem recebe pelo tempo real.
 */
if (env.R2_PUBLIC_URL) {
  payload.R2_PUBLIC_URL = env.R2_PUBLIC_URL;
} else {
  console.log(
    "aviso: R2_PUBLIC_URL ausente no .env — mensagem com anexo chega sem o" +
      "\n       link do arquivo para quem recebe pelo tempo real.",
  );
}

/**
 * Fase pre-beta. Todas OPCIONAIS e sozinhas:
 *  - SENTRY_DSN: erros do gateway vao para o Sentry (sem ela, so stdout);
 *  - LOG_LEVEL: ausente = `info` em producao;
 *  - MAX_SOCKETS_POR_USUARIO: ausente = 8; `0` desliga o teto.
 */
for (const key of ["SENTRY_DSN", "LOG_LEVEL", "MAX_SOCKETS_POR_USUARIO"]) {
  if (env[key]) payload[key] = env[key];
}

console.log(`App Fly:  ${flyApp}`);
console.log(`Origem liberada no CORS:  ${payload.NEXT_PUBLIC_APP_URL}`);
if (bumped) console.log("connection_limit ajustado para 5 na URL de producao.");
if (twitchMissing.length > 0) {
  console.log(
    `IGDB nao configurado (falta ${twitchMissing.join(", ")}) — a atividade` +
      " segue com nome e icone do executavel, sem capa de jogo.",
  );
}
if (redisMissing.length > 0) {
  console.log(
    `Redis nao configurado (falta ${redisMissing.join(", ")}) — o consumo unico`
      + " de ticket ficara em memoria (ok com UMA maquina de gateway).",
  );
}
console.log(`\nEnviando ${Object.keys(payload).length} secrets (valores nao sao exibidos):`);
for (const key of Object.keys(payload)) console.log(`  - ${key}`);

const child = spawn("fly", ["secrets", "import", "--app", flyApp], {
  stdio: ["pipe", "inherit", "inherit"],
  shell: process.platform === "win32",
});

child.on("error", (error) => {
  console.error(`\nNao consegui executar o flyctl: ${error.message}`);
  console.error('Confira se "fly version" funciona neste terminal.');
  process.exit(1);
});

for (const [key, value] of Object.entries(payload)) {
  child.stdin.write(`${key}=${value}\n`);
}
child.stdin.end();

child.on("exit", (code) => {
  if (code === 0) {
    console.log("\nSecrets enviados. O Fly reinicia a maquina sozinho.");
  }
  process.exit(code ?? 1);
});
