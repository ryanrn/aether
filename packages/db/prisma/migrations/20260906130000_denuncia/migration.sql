-- Denuncia de abuso — a primeira ferramenta de moderacao alem de kick/ban por
-- dono de servidor.
--
-- `alvoId` e polimorfico (mensagem / usuario / servidor conforme `tipo`) e NAO
-- tem FK: o alvo pode ser apagado, e a denuncia precisa sobreviver a isso para
-- o historico e para medir reincidencia. `snapshot` guarda o que o alvo dizia
-- na hora, pelo mesmo motivo — a equipe nao pode revisar no escuro.

CREATE TYPE "AlvoDeDenuncia" AS ENUM ('MENSAGEM', 'USUARIO', 'SERVIDOR');
CREATE TYPE "StatusDeDenuncia" AS ENUM ('ABERTA', 'EM_ANALISE', 'RESOLVIDA', 'DESCARTADA');

CREATE TABLE "Denuncia" (
    "id"           TEXT NOT NULL,
    "tipo"         "AlvoDeDenuncia" NOT NULL,
    "alvoId"       TEXT NOT NULL,
    "motivo"       TEXT NOT NULL,
    "detalhe"      TEXT,
    "snapshot"     TEXT,
    "reporterId"   TEXT NOT NULL,
    "status"       "StatusDeDenuncia" NOT NULL DEFAULT 'ABERTA',
    "notaEquipe"   TEXT,
    "resolvidaPor" TEXT,
    "resolvidaEm"  TIMESTAMP(3),
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Denuncia_pkey" PRIMARY KEY ("id")
);

-- a fila e sempre "abertas, mais antigas primeiro"
CREATE INDEX "Denuncia_status_createdAt_idx" ON "Denuncia"("status", "createdAt");
-- "quantas denuncias sobre este alvo" — reincidencia
CREATE INDEX "Denuncia_tipo_alvoId_idx" ON "Denuncia"("tipo", "alvoId");
CREATE INDEX "Denuncia_reporterId_idx" ON "Denuncia"("reporterId");

ALTER TABLE "Denuncia" ADD CONSTRAINT "Denuncia_reporterId_fkey"
  FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Denuncia" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "Denuncia" FROM anon, authenticated;
