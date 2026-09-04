import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Suite unitaria do monorepo (fase 7a).
 *
 * Uma suite so, na raiz, e nao uma por workspace: a logica que mais importa
 * aqui atravessa pacotes — o bitfield vive em @aether/shared, a hierarquia em
 * @aether/access, os rate limits em apps/. Um runner unico tambem e o que o CI
 * da fase 7e vai chamar, com um comando.
 *
 * Os @aether/* NAO precisam de alias: o npm workspaces ja liga
 * node_modules/@aether/x para packages/x, e o `main` de cada um aponta para a
 * fonte TypeScript. O teste importa exatamente o modulo que roda em producao,
 * sem passo de build no meio que possa divergir.
 */

const stub = (name: string) =>
  fileURLToPath(new URL(`./tests/stubs/${name}.ts`, import.meta.url));

/** O `@/` do app web — mesmo alias do tsconfig de `apps/web`. */
const webSrc = fileURLToPath(new URL("./apps/web/src", import.meta.url));

export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    /** scrypt com N=16384 leva dezenas de ms por hash; o padrao de 5s aperta. */
    testTimeout: 20_000,
  },
  resolve: {
    alias: [
      /**
       * O rate limit do app web declara `server-only` e le `next/headers`.
       * A funcao sob teste (`rateLimit`) e pura — os dois imports existem por
       * causa de `clientKey`, que depende do escopo de request do Next e nao e
       * testavel fora dele. Substituir por stub deixa o modulo carregar sem
       * arrastar o runtime do Next para dentro da suite.
       */
      { find: "server-only", replacement: stub("server-only") },
      { find: "next/headers", replacement: stub("next-headers") },
      // O `@/` do app web, igual ao tsconfig de apps/web.
      { find: /^@\//, replacement: `${webSrc}/` },
    ],
  },
});
