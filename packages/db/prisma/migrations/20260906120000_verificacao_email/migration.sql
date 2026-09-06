-- Confirmacao de e-mail, aceite de termos e silenciamento global.
--
-- Tres assuntos numa migracao so porque os tres sao ALTER TABLE em "User" —
-- juntar evita tres locks separados na tabela mais quente do banco. Todas as
-- colunas sao NULLABLE: conta que ja existe fica com e-mail nao confirmado,
-- termos nao aceitos e sem silenciamento, e a aplicacao trata cada nulo.

ALTER TABLE "User"
  ADD COLUMN "emailVerificadoEm" TIMESTAMP(3),
  ADD COLUMN "aceitouTermosEm"   TIMESTAMP(3),
  ADD COLUMN "termosVersao"      TEXT,
  ADD COLUMN "silenciadoEm"      TIMESTAMP(3),
  ADD COLUMN "silenciadoAte"     TIMESTAMP(3),
  ADD COLUMN "silenciadoPor"     TEXT,
  ADD COLUMN "silenciadoMotivo"  TEXT;

-- Mesma forma do PasswordReset: so o sha256 do token, uso unico, validade curta.
CREATE TABLE "VerificacaoEmail" (
    "id"        TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt"    TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificacaoEmail_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VerificacaoEmail_tokenHash_key" ON "VerificacaoEmail"("tokenHash");
CREATE INDEX "VerificacaoEmail_userId_idx" ON "VerificacaoEmail"("userId");
CREATE INDEX "VerificacaoEmail_expiresAt_idx" ON "VerificacaoEmail"("expiresAt");

ALTER TABLE "VerificacaoEmail" ADD CONSTRAINT "VerificacaoEmail_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Como toda tabela do projeto: sem acesso direto pelas roles publicas.
ALTER TABLE "VerificacaoEmail" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "VerificacaoEmail" FROM anon, authenticated;
