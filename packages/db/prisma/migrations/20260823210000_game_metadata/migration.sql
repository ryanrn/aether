-- Cache COMPARTILHADO de metadados de jogo (capa, genero, id do IGDB).
--
-- Compartilhado de proposito: o primeiro que abre Hollow Knight resolve a capa
-- para todos os outros. Cache por maquina faria cada pessoa pagar a mesma
-- consulta, e o IGDB limita a 4 por segundo.
--
-- NAO HA COLUNA DE USUARIO AQUI, e isso e deliberado. A tabela diz "Hollow
-- Knight tem esta capa", nunca "fulano jogou Hollow Knight". Guardar quem
-- consultou transformaria um cache de arte num historico de habitos de jogo —
-- o dado que a deteccao local justamente se recusa a mandar para o servidor.

CREATE TYPE "GameMetadataSource" AS ENUM ('IGDB', 'DETECTOR');

CREATE TABLE "GameMetadata" (
    "id" TEXT NOT NULL,
    "lookupKey" TEXT NOT NULL,
    "detectedName" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "igdbId" INTEGER,
    "coverUrl" TEXT,
    "genre" TEXT,
    "source" "GameMetadataSource" NOT NULL,
    "confidence" DOUBLE PRECISION,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameMetadata_pkey" PRIMARY KEY ("id")
);

-- A chave e o nome NORMALIZADO: e por ela que "ELDEN RING", "Elden Ring" e
-- "elden  ring" caem todos na mesma linha, em vez de virarem tres consultas.
CREATE UNIQUE INDEX "GameMetadata_lookupKey_key" ON "GameMetadata"("lookupKey");
-- Para varrer o que esta velho e merece nova consulta.
CREATE INDEX "GameMetadata_checkedAt_idx" ON "GameMetadata"("checkedAt");

-- A tabela nasce fechada para a API REST publica, como as demais.
-- Ver a migracao 20260823000000_rls_e_revoke.
ALTER TABLE "GameMetadata" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "GameMetadata" FROM anon, authenticated;
