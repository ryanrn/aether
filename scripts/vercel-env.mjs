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

/**
 * Storage do icone de servidor. OPCIONAIS de proposito: sem elas o app sobe
 * igual e so o upload de icone responde que nao esta configurado. Exigir aqui
 * quebraria o deploy de quem ainda nao criou o bucket.
 *
 * A service_role key ignora RLS por completo — por isso nao tem prefixo
 * NEXT_PUBLIC_ e nunca pode chegar ao bundle do navegador.
 */
const OPTIONAL_FROM_ENV = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];

/**
 * Redis do rate limit distribuido (fase 7c). Tambem opcionais e tambem em
 * par: sem os dois, o contador cai para memoria — que na Vercel serverless
 * significa quase nenhuma protecao contra forca bruta.
 */
const OPTIONAL_REDIS = ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"];

/**
 * Envio de e-mail (recuperacao de senha). Opcionais e em PAR: sem os dois, o
 * pedido de redefinicao responde igual — a resposta e constante de proposito,
 * para nao revelar quem tem conta — e o e-mail simplesmente nao sai.
 *
 * Foi exatamente esse o modo de falha em desenvolvimento: o servidor tinha
 * subido antes da chave existir no .env, e o pedido respondia "enviado" sem
 * enviar nada. Em producao a consequencia seria a mesma, e silenciosa.
 */
const OPTIONAL_EMAIL = ["RESEND_API_KEY", "EMAIL_FROM"];

/**
 * Vercel Cron (faxina diaria de anexos orfaos). OPCIONAL: sem ela, a rota
 * /api/cron/limpar-anexos responde 503 e os orfaos so se acumulam — nada
 * quebra, mas a conta do R2 cresce. O Vercel injeta
 * `Authorization: Bearer $CRON_SECRET` nas chamadas de cron QUANDO esta
 * variavel existe; pode repetir o valor do AUTH_SECRET.
 */
const OPTIONAL_CRON = ["CRON_SECRET"];

/**
 * Cloudflare R2 (anexo no chat). Opcionais e em BLOCO: as cinco andam juntas.
 *
 * Tres delas o next.config.ts le para montar o CSP, e isso acontece em TEMPO
 * DE BUILD — mesmo motivo das NEXT_PUBLIC_*. Definidas depois do deploy, o CSP
 * publicado sai sem o R2 e o navegador bloqueia o envio com "falha de rede",
 * sem status e sem dizer em lugar nenhum que foi CSP.
 *
 * Sem as cinco o app sobe igual e so o anexo responde que nao esta
 * configurado. Por isso opcionais, e nao obrigatorias.
 */
const OPTIONAL_R2 = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET",
  "R2_PUBLIC_URL",
];

/**
 * Sentry (fase pre-beta). OPCIONAL e sozinha: sem ela o log estruturado so vai
 * para o stdout (que a Vercel captura de qualquer jeito), com ela erros e
 * avisos tambem sobem para o Sentry. Lida em RUNTIME, entao definir depois do
 * deploy so exige um redeploy — nao um novo build.
 */
const OPTIONAL_SENTRY = ["SENTRY_DSN"];

/**
 * Cloudflare Turnstile (CAPTCHA no cadastro). OPCIONAIS e em PAR.
 *
 * `NEXT_PUBLIC_TURNSTILE_SITE_KEY` e embutida no bundle EM TEMPO DE BUILD —
 * como este script roda ANTES do `vercel --prod`, ela entra a tempo. Sem o
 * par, o widget nao aparece e o servidor pula a verificacao (os dois lados
 * degradam juntos).
 */
const OPTIONAL_TURNSTILE = [
  "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
  "TURNSTILE_SECRET_KEY",
];

/** Nivel minimo de log. OPCIONAL: ausente = `info` em producao. */
const OPTIONAL_LOG = ["LOG_LEVEL"];

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

// So sobe o par de Storage se os DOIS estiverem preenchidos: metade da
// configuracao falharia na hora do upload, longe da causa.
const storageMissing = OPTIONAL_FROM_ENV.filter((key) => !env[key]);
if (storageMissing.length === 0) {
  for (const key of OPTIONAL_FROM_ENV) payload[key] = env[key];
}

const redisMissing = OPTIONAL_REDIS.filter((key) => !env[key]);
if (redisMissing.length === 0) {
  for (const key of OPTIONAL_REDIS) payload[key] = env[key];
}

const r2Missing = OPTIONAL_R2.filter((key) => !env[key]);
if (r2Missing.length === 0) {
  for (const key of OPTIONAL_R2) payload[key] = env[key];
}

const emailMissing = OPTIONAL_EMAIL.filter((key) => !env[key]);
if (emailMissing.length === 0) {
  for (const key of OPTIONAL_EMAIL) payload[key] = env[key];
} else {
  console.log(
    `aviso: ${emailMissing.join(" e ")} ausente(s) no .env — a recuperacao de\n` +
      "       senha vai responder normalmente em producao e NAO enviar e-mail.",
  );
}

const cronMissing = OPTIONAL_CRON.filter((key) => !env[key]);
if (cronMissing.length === 0) {
  for (const key of OPTIONAL_CRON) payload[key] = env[key];
} else {
  console.log(
    "aviso: CRON_SECRET ausente no .env — a faxina diaria de anexos orfaos\n" +
      "       (/api/cron/limpar-anexos) vai responder 503 ate ela existir.\n" +
      "       Pode repetir o valor do AUTH_SECRET.",
  );
}

// Sentry, Turnstile e LOG_LEVEL: cada um entra se estiver no .env. Turnstile
// so entra se os DOIS estiverem (meia config falharia na hora do cadastro).
for (const key of OPTIONAL_SENTRY) if (env[key]) payload[key] = env[key];
for (const key of OPTIONAL_LOG) if (env[key]) payload[key] = env[key];
const turnstileMissing = OPTIONAL_TURNSTILE.filter((key) => !env[key]);
if (turnstileMissing.length === 0) {
  for (const key of OPTIONAL_TURNSTILE) payload[key] = env[key];
} else if (turnstileMissing.length === 1) {
  console.log(
    `aviso: ${turnstileMissing[0]} ausente no .env — o Turnstile precisa das`
      + "\n       DUAS chaves; com so uma, o CAPTCHA do cadastro fica desligado.",
  );
}

/**
 * Chamamos via `npx` porque o CLI da Vercel normalmente nao esta instalado
 * global. No Windows o alvo e um `.cmd`, e desde a correcao do CVE-2024-27980
 * o Node recusa executar `.cmd` sem `shell: true` (erro EINVAL).
 *
 * Passamos o comando como STRING UNICA em vez de string + array de argumentos:
 * com array, `shell: true` dispara o aviso DEP0190 porque os argumentos seriam
 * concatenados sem escape.
 *
 * Isso e seguro aqui porque nada vindo de fora entra na linha de comando — os
 * nomes e ambientes saem de listas fixas no topo deste arquivo, e os VALORES
 * (que sao os segredos) vao pela entrada padrao, nunca como argumento.
 */
function addVar(name, value, target) {
  return new Promise((resolve) => {
    const child = spawn(`npx --yes vercel env add ${name} ${target} --force`, {
      stdio: ["pipe", "ignore", "pipe"],
      shell: true,
    });

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
if (storageMissing.length > 0) {
  console.log(
    `Storage de icone nao configurado (falta ${storageMissing.join(", ")}) — pulando.`,
  );
}
if (redisMissing.length > 0) {
  console.log(
    `Redis nao configurado (falta ${redisMissing.join(", ")}) — o rate limit` +
      " ficara em memoria, que na Vercel serverless quase nao protege.",
  );
}
if (r2Missing.length > 0) {
  console.log(
    `R2 nao configurado (falta ${r2Missing.join(", ")}) — o anexo no chat vai` +
      "\n       responder que nao esta configurado, e o CSP subira sem o R2.",
  );
}
console.log("\nEnviando (valores nao sao exibidos):");

let failed = 0;
for (const [name, value] of Object.entries(payload)) {
  for (const target of TARGETS) {
    const result = await addVar(name, value, target);
    if (result.ok) {
      console.log(`  ok     ${name} (${target})`);
    } else {
      failed += 1;
      console.log(
        `  FALHA  ${name} (${target}) — ${result.error.split("\n")[0]}`,
      );
    }
  }
}

if (failed > 0) {
  console.log(
    "\nSe a falha mencionar autenticacao ou projeto, rode antes:" +
      "\n  npx vercel login" +
      "\n  npx vercel link",
  );
  process.exit(1);
}

console.log(
  "\nPronto. Variaveis NEXT_PUBLIC_* entram no bundle em tempo de build," +
    "\nentao rode o deploy DEPOIS deste passo:  npx vercel --prod",
);
