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

console.log(`App Fly:  ${flyApp}`);
console.log(`Origem liberada no CORS:  ${payload.NEXT_PUBLIC_APP_URL}`);
if (bumped) console.log("connection_limit ajustado para 5 na URL de producao.");
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
