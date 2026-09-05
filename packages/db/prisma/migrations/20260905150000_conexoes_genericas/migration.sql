-- `SpotifyAccount` -> `Connection` generica.
--
-- POR QUE: a tabela antiga tinha `userId` como chave primaria — formato de
-- "Spotify", nao de "conexao". Somar Steam, Twitch e Riot exigiria mais tres
-- tabelas quase iguais.
--
-- SEM PERDA DE DADO: a linha de cada pessoa e COPIADA antes de a tabela velha
-- cair, no mesmo transacao. Os tokens ja vem cifrados da aplicacao e sao
-- movidos como estao — nao ha decifra aqui.

CREATE TYPE "ConnectionProvider" AS ENUM ('SPOTIFY', 'STEAM', 'TWITCH', 'RIOT');

CREATE TABLE "Connection" (
    "id"            TEXT NOT NULL,
    "userId"        TEXT NOT NULL,
    "provider"      "ConnectionProvider" NOT NULL,
    "externalId"    TEXT,
    "displayName"   TEXT,
    "accessToken"   TEXT,
    "refreshToken"  TEXT,
    "expiresAt"     TIMESTAMP(3),
    "scope"         TEXT,
    "showOnProfile" BOOLEAN NOT NULL DEFAULT true,
    "showAsStatus"  BOOLEAN NOT NULL DEFAULT true,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Connection_pkey" PRIMARY KEY ("id")
);

-- Uma conta por servico, por pessoa.
CREATE UNIQUE INDEX "Connection_userId_provider_key"
  ON "Connection"("userId", "provider");

-- IMPEDE DUAS CONTAS DO AETHER REIVINDICAREM O MESMO PERFIL EXTERNO.
-- Sem isto, alguem liga o Steam de outra pessoa e se passa por ela no perfil.
-- `NULL` nao colide com `NULL` no Postgres, entao as linhas migradas (que nao
-- tem `externalId`, porque a tabela velha so guardava o nome) convivem ate
-- serem preenchidas na proxima reconexao.
CREATE UNIQUE INDEX "Connection_provider_externalId_key"
  ON "Connection"("provider", "externalId");

CREATE INDEX "Connection_provider_idx" ON "Connection"("provider");

ALTER TABLE "Connection" ADD CONSTRAINT "Connection_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Mesma postura da tabela que ela substitui: nada de acesso direto pelas
-- roles publicas do Supabase. Quem le e escreve e a aplicacao.
ALTER TABLE "Connection" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "Connection" FROM anon, authenticated;

-- Copia o que ja existe. `gen_random_uuid()` serve de id: o formato do id nao
-- e lido por ninguem, so precisa ser unico.
INSERT INTO "Connection" (
    "id", "userId", "provider", "displayName",
    "accessToken", "refreshToken", "expiresAt", "scope",
    "showOnProfile", "showAsStatus", "createdAt", "updatedAt"
)
SELECT
    gen_random_uuid()::text,
    "userId",
    'SPOTIFY'::"ConnectionProvider",
    "spotifyName",
    "accessToken",
    "refreshToken",
    "expiresAt",
    "scope",
    "showOnProfile",
    "showAsStatus",
    "createdAt",
    "updatedAt"
FROM "SpotifyAccount";

DROP TABLE "SpotifyAccount";
