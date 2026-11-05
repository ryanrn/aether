-- Hub global "AETHER · Grupos" (fase 2, estagio 4b-1).
--
-- O hub e um servidor de verdade, marcado. Reaproveita tudo que um servidor
-- ja tem — permissao de voz pelo `@aether/access`, `Ban`, salas efemeras —
-- em vez de uma segunda regra de autorizacao para "sala sem membro".
--
-- No maximo UM hub: indice unico PARCIAL (so as linhas com `hub = true`
-- entram nele). O Prisma nao declara indice parcial, por isso so existe aqui.
-- Sem ele, dois servidores marcados por engano dividiriam a tela de Grupos e
-- ninguem saberia qual e o oficial.

ALTER TABLE "Server" ADD COLUMN "hub" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "Server_hub_unico" ON "Server" ("hub") WHERE "hub" = true;
