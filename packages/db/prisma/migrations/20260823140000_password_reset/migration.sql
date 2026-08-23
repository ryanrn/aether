-- Pedido de redefinicao de senha.
--
-- `tokenHash` guarda o SHA-256 do token que foi para o e-mail, nunca o token.
-- Se o banco vazar — ou o dump de backup, que carrega esta tabela — token
-- legivel deixaria qualquer um redefinir qualquer conta.
--
-- `usedAt` e o que torna o token de USO UNICO: redefinir carimba, e um segundo
-- uso e recusado mesmo dentro da validade.

CREATE TABLE "PasswordReset" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordReset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PasswordReset_tokenHash_key" ON "PasswordReset"("tokenHash");
CREATE INDEX "PasswordReset_userId_idx" ON "PasswordReset"("userId");
CREATE INDEX "PasswordReset_expiresAt_idx" ON "PasswordReset"("expiresAt");

ALTER TABLE "PasswordReset" ADD CONSTRAINT "PasswordReset_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A tabela nasce fechada para a API REST publica, como as demais.
-- Ver a migracao 20260823000000_rls_e_revoke.
ALTER TABLE "PasswordReset" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "PasswordReset" FROM anon, authenticated;
