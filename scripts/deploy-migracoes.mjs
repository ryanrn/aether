/**
 * `prisma migrate deploy` COM CONFIRMACAO.
 *
 * POR QUE EXISTE: uma migracao aplicada em producao e irreversivel (o Prisma
 * nao tem "down"). Durante a fase pre-beta, um processo automatizado rodou
 * `db:deploy` sozinho, minutos depois de cada commit — as migracoes entraram
 * em producao antes de qualquer revisao. Este wrapper transforma isso num
 * passo deliberado: mostra o que esta pendente e ESPERA a pessoa digitar
 * `APLICAR`.
 *
 * Num processo automatizado (sem TTY, ou `CI=1`, ou `--sim`) ele NAO aplica —
 * sai com codigo 2 e explica. E o comportamento desejado: deploy de schema em
 * producao e decisao de gente.
 *
 * Uso (via `npm run db:deploy`, que ja injeta o .env):
 *   npm run db:deploy            # mostra e pergunta
 *   npm run db:deploy -- --sim   # aplica sem perguntar (use com cuidado)
 */
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline";

const SCHEMA = "packages/db/prisma/schema.prisma";
const semPergunta =
  process.argv.includes("--sim") ||
  process.env.CI === "1" ||
  process.env.CI === "true";

function prisma(args) {
  return spawnSync("npx", ["prisma", ...args, "--schema", SCHEMA], {
    encoding: "utf8",
    shell: process.platform === "win32",
  });
}

const status = prisma(["migrate", "status"]);
const saida = `${status.stdout ?? ""}${status.stderr ?? ""}`;
process.stdout.write(saida);

if (/Database schema is up to date/i.test(saida)) {
  console.log("\nNada pendente. Nenhuma migracao aplicada.");
  process.exit(0);
}

const pendentes = saida.match(/have not yet been applied|following migrations? .*pending/i);
if (!pendentes && status.status !== 0) {
  console.error("\nNao consegui ler o status das migracoes (erro acima). Abortei.");
  process.exit(1);
}

console.log("\n⚠  Ha migracao PENDENTE para o banco de PRODUCAO (ver acima).");
console.log("   Isso e irreversivel — o Prisma nao desfaz migracao.");

if (semPergunta && !process.argv.includes("--sim")) {
  console.error(
    "\nAmbiente nao-interativo (CI / sem terminal). NAO apliquei.\n" +
      "Rode a mao com um terminal, ou passe `--sim` de propósito.",
  );
  process.exit(2);
}

async function confirmar() {
  if (process.argv.includes("--sim")) return true;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const resposta = await new Promise((r) =>
    rl.question('\nDigite "APLICAR" para rodar `prisma migrate deploy`: ', r),
  );
  rl.close();
  return resposta.trim() === "APLICAR";
}

if (!(await confirmar())) {
  console.log("Cancelado. Nada foi aplicado.");
  process.exit(1);
}

console.log("\nAplicando…\n");
const deploy = prisma(["migrate", "deploy"]);
process.stdout.write(`${deploy.stdout ?? ""}${deploy.stderr ?? ""}`);
process.exit(deploy.status ?? 1);
