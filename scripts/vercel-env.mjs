/**
 * Envia as variaveis de ambiente do app web para a Vercel lendo o .env local.
 *
 * Mesmo motivo do scripts/fly-secrets.mjs: digitar segredo em linha de comando
 * deixa rastro no historico do terminal. Aqui os valores vao pela entrada
 * padrao do CLI da Vercel e nunca aparecem na tela.
 *
 * Uso (depois de `vercel link`):
 *   node scripts/vercel-env.mjs https://SEU-GATEWAY.fly.dev
 *
 * O argumento e o endereco publico do gateway. Ele vira NEXT_PUBLIC_REALTIME_URL,
 * que o navegador usa para abrir o WebSocket. Como variaveis NEXT_PUBLIC_* sao
 * embutidas no bundle EM TEMPO DE BUILD, ela precisa existir antes do deploy —
 * definir depois nao muda nada ate um novo build.
 */
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";

/**
 * O app web NAO usa NEXT_PUBLIC_APP_URL: quem le essa variavel e o gateway,
 * para saber qual origem liberar no CORS. Por isso ela nao esta aqui.
 */
const FROM_ENV = ["AUTH_SECRET", "DATABASE_URL", "DIRECT_URL"];
const TARGETS = ["production", "preview", "development"];

const gatewayUrl = process.argv[2];

if (!gatewayUrl || !/^https?:\/\//.test(gatewayUrl)) {
  console.error(
    "Informe o endereco publico do gateway.\n" +
      "  node scripts/vercel-env.mjs https://SEU-GATEWAY.fly.dev",
  );
  process.exit(1);
}

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
  console.error("Nao encontrei o .env na raiz. Rode da raiz do repositorio.");
  process.exit(1);
}

const missing = FROM_ENV.filter((key) => !env[key]);
if (missing.length > 0) {
  console.error(`Faltando no .env: ${missing.join(", ")}`);
  process.exit(1);
}

/**
 * O pooler do Supabase vem com connection_limit=1, o que serializa as
 * consultas. As Server Actions tambem falam com o banco a cada acao.
 */
let databaseUrl = env.DATABASE_URL;
let bumped = false;
if (/[?&]connection_limit=1(&|$)/.test(databaseUrl)) {
  databaseUrl = databaseUrl.replace(/([?&]connection_limit=)1(&|$)/, "$15$2");
  bumped = true;
}

const payload = {
  AUTH_SECRET: env.AUTH_SECRET,
  DATABASE_URL: databaseUrl,
  DIRECT_URL: env.DIRECT_URL,
  NEXT_PUBLIC_REALTIME_URL: gatewayUrl.replace(/\/$/, ""),
};

/** Uma variavel por invocacao do CLI; o valor vai pela entrada padrao. */
function addVar(name, value, target) {
  return new Promise((resolve) => {
    const child = spawn(
      "vercel",
      ["env", "add", name, target, "--force"],
      {
        stdio: ["pipe", "ignore", "pipe"],
        shell: process.platform === "win32",
      },
    );

    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    child.on("error", (error) => resolve({ ok: false, error: error.message }));
    child.stdin.write(`${value}\n`);
    child.stdin.end();
    child.on("exit", (code) =>
      resolve(code === 0 ? { ok: true } : { ok: false, error: stderr.trim() }),
    );
  });
}

console.log(`Gateway: ${payload.NEXT_PUBLIC_REALTIME_URL}`);
if (bumped) console.log("connection_limit ajustado para 5.");
console.log("\nEnviando (valores nao sao exibidos):");

let failed = 0;
for (const [name, value] of Object.entries(payload)) {
  for (const target of TARGETS) {
    const result = await addVar(name, value, target);
    if (result.ok) {
      console.log(`  ok     ${name} (${target})`);
    } else {
      failed += 1;
      console.log(`  FALHA  ${name} (${target}) — ${result.error.split("\n")[0]}`);
    }
  }
}

if (failed > 0) {
  console.log(
    "\nSe a falha for 'command not found', rode `npx vercel login` e `npx vercel link` antes.",
  );
  process.exit(1);
}

console.log(
  "\nPronto. Variaveis NEXT_PUBLIC_* entram no bundle em tempo de build," +
    "\nentao rode o deploy DEPOIS deste passo:  npx vercel --prod",
);
