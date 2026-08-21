import { PrismaClient } from "@prisma/client";

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
