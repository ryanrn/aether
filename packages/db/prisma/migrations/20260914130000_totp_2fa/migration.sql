-- Autenticacao de dois fatores (TOTP, RFC 6238), implementacao propria.
--
-- `totpSecretCifrado` guarda o segredo CIFRADO (AES-256-GCM via
-- `@aether/db/secret-box`, chave derivada de AUTH_SECRET) — precisa ser
-- decifrado a cada login pra recalcular o codigo, diferente de senha/codigo
-- de backup (que so precisam de hash, nunca de leitura de volta).
--
-- `totpHabilitadoEm` nulo com `totpSecretCifrado` preenchido = configuracao
-- pendente (QR mostrado, aguardando o codigo de confirmacao). So os dois
-- preenchidos e que o login passa a exigir o segundo fator.
--
-- `totpUltimoPassoUsado` bloqueia reuso do mesmo codigo dentro da propria
-- janela de tolerancia de 30s (RFC 6238 recomenda).
ALTER TABLE "User"
  ADD COLUMN "totpSecretCifrado"    TEXT,
  ADD COLUMN "totpHabilitadoEm"     TIMESTAMP(3),
  ADD COLUMN "totpUltimoPassoUsado" BIGINT;

-- Codigos de backup do 2FA — mesma doutrina do PlanKey: o codigo em claro so
-- existe no momento em que e gerado e mostrado pra pessoa; o banco guarda so
-- o hash (sha256 — o codigo tem entropia alta o bastante, nao e senha de
-- humano, dispensa hash lento). Gerar um lote novo apaga os antigos.
CREATE TABLE "TotpBackupCode" (
    "id"         TEXT NOT NULL,
    "userId"     TEXT NOT NULL,
    "codigoHash" TEXT NOT NULL,
    "usadoEm"    TIMESTAMP(3),
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TotpBackupCode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TotpBackupCode_codigoHash_key" ON "TotpBackupCode"("codigoHash");
CREATE INDEX "TotpBackupCode_userId_idx" ON "TotpBackupCode"("userId");

ALTER TABLE "TotpBackupCode" ADD CONSTRAINT "TotpBackupCode_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TotpBackupCode" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "TotpBackupCode" FROM anon, authenticated;
