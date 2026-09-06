/**
 * O gateway consegue CARREGAR o que ele importa?
 *
 * POR QUE ISTO EXISTE: `npm run typecheck` e `next build` passaram enquanto o
 * gateway em producao subia e morria em laco. A causa era resolucao de
 * modulo, nao tipo:
 *
 *   Error [ERR_UNSUPPORTED_DIR_IMPORT]:
 *   Directory import '/app/packages/access/src/conexoes' is not supported
 *
 * O `apps/web` roda no bundler do Next, que resolve `./pasta` procurando um
 * `index` dentro. O `apps/realtime` roda TypeScript DIRETO com `tsx`, em ESM
 * puro — e o Node ESM nao resolve import de diretorio, nem com `index.ts`
 * dentro. Duas resolucoes diferentes para o mesmo codigo: o que passa numa
 * pode quebrar na outra, e o `tsc` nao ve nenhuma das duas.
 *
 * Este script fecha essa fresta: importa os pacotes com o MESMO carregador do
 * gateway. Se resolver, imprime os exports; se nao, sai com codigo 1 antes de
 * alguem descobrir pelo `fly logs`.
 *
 * Nao abre conexao com nada: o `PrismaClient` so fala com o banco na primeira
 * consulta, e aqui nao ha consulta.
 *
 *   npx tsx scripts/checa-esm.ts
 */
import * as access from "@aether/access";
import * as shared from "@aether/shared";
import * as sharedLog from "@aether/shared/log";
import * as db from "@aether/db";

/** Exports que o gateway usa de verdade — some um, quebra em producao. */
const OBRIGATORIOS: Record<string, string[]> = {
  "@aether/access": [
    "guardarConexao",
    "segredos",
    "desconectar",
    "estadoSpotify",
    "tokenDeAcesso",
    "buscarTocandoAgora",
    "spotifyConfigurado",
  ],
  "@aether/shared": ["safeMusicActivity"],
  // Subpath separado: usa `node:async_hooks`, entao NAO entra no barrel — mas
  // o gateway o importa como `@aether/shared/log`, e o loader ESM tem que
  // resolver esse subpath tanto quanto o pacote raiz.
  "@aether/shared/log": ["log", "capturarFalhasDoProcesso", "comContexto"],
  "@aether/db": ["prisma", "cifrar", "decifrar"],
};

const modulos: Record<string, object> = {
  "@aether/access": access,
  "@aether/shared": shared,
  "@aether/shared/log": sharedLog,
  "@aether/db": db,
};

let faltando = 0;
for (const [nome, esperados] of Object.entries(OBRIGATORIOS)) {
  const presentes = Object.keys(modulos[nome] ?? {});
  const ausentes = esperados.filter((e) => !presentes.includes(e));
  if (ausentes.length > 0) {
    console.error(`✖ ${nome}: falta ${ausentes.join(", ")}`);
    faltando += ausentes.length;
  } else {
    console.log(`✓ ${nome} — ${presentes.length} exports`);
  }
}

if (faltando > 0) process.exit(1);
console.log("\n✓ o gateway consegue carregar os pacotes que importa.");
