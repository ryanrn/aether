-- Login com Google (OIDC via Arctic).
--
-- `googleId` guarda o `sub` da conta Google — o identificador estavel que o
-- Google nunca muda, ao contrario do e-mail (que a pessoa pode trocar la).
-- `@unique` impede duas contas AETHER reivindicarem o mesmo Google.
ALTER TABLE "User"
  ADD COLUMN "googleId" TEXT;

CREATE UNIQUE INDEX "User_googleId_key" ON "User"("googleId");

-- Ponte entre "o login Google terminou no navegador do sistema" e "a janela
-- do app desktop precisa da sessao" — o Google recusa OAuth dentro de uma
-- webview embutida (Electron cai nisso), entao o fluxo desktop tem que abrir
-- no navegador padrao, e o cookie de sessao nasce la. O `aether://login-
-- callback/<codigo>` traz esse codigo de volta pra janela do Electron trocar
-- por uma sessao de verdade.
--
-- Mesma doutrina do PasswordReset/VerificacaoEmail: o codigo em claro nunca e
-- gravado, so o sha256; uso unico (`usedAt`); vida de 60s (a janela inteira do
-- redirecionamento do navegador, nao mais que isso).
CREATE TABLE "CodigoLoginDesktop" (
    "id"        TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "codeHash"  TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt"    TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CodigoLoginDesktop_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CodigoLoginDesktop_codeHash_key" ON "CodigoLoginDesktop"("codeHash");
CREATE INDEX "CodigoLoginDesktop_userId_idx" ON "CodigoLoginDesktop"("userId");
CREATE INDEX "CodigoLoginDesktop_expiresAt_idx" ON "CodigoLoginDesktop"("expiresAt");

ALTER TABLE "CodigoLoginDesktop" ADD CONSTRAINT "CodigoLoginDesktop_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CodigoLoginDesktop" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "CodigoLoginDesktop" FROM anon, authenticated;
