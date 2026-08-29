import { PrismaClient, type Prisma } from "@prisma/client";
import { SELECT_USUARIO_PUBLICO } from "@aether/shared";

/**
 * Cliente Prisma singleton.
 *
 * Em dev o Next recarrega modulos a cada alteracao; sem o cache global
 * cada reload abriria um novo pool de conexoes e estouraria o limite do Postgres.
 * O gateway realtime (fase 3) importa este mesmo modulo.
 */
const globalForPrisma = globalThis as unknown as {
  __aetherPrisma?: PrismaClient;
};

export const prisma =
  globalForPrisma.__aetherPrisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["warn", "error"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__aetherPrisma = prisma;
}

export * from "@prisma/client";
export { Prisma } from "@prisma/client";

/**
 * PROVA, EM TEMPO DE COMPILACAO, que o seletor compartilhado de usuario e um
 * `select` valido de `User`.
 *
 * Existe por causa de um defeito real: `SELECT_USUARIO_PUBLICO` e objeto
 * literal — `packages/shared` nao pode depender de Prisma, porque tambem roda
 * no navegador — e literal nenhum e conferido contra o schema. A primeira
 * versao pedia `subscription`, mas a relacao em `User` se chama `assinatura`.
 * Compilou limpo nos tres workspaces e so falharia em producao, como excecao
 * do Prisma na primeira lista de membros que alguem abrisse.
 *
 * Esta linha nao gera codigo: e uma atribuicao de tipo. Se o seletor voltar a
 * divergir do schema, o `npm run typecheck` para na hora, e nao o usuario.
 */
const _SELETOR_DE_USUARIO_CONFERE: Prisma.UserSelect = SELECT_USUARIO_PUBLICO;
void _SELETOR_DE_USUARIO_CONFERE;
