-- Bloqueio de uma pessoa por outra.
--
-- DIRECIONAL, uma linha por sentido: "A bloqueou B" e um fato diferente de
-- "B bloqueou A", os dois podem existir juntos, e desfazer um nao desfaz o
-- outro. E por isso que aqui NAO ha par ordenado como em DmChannel — ordenar
-- perderia justamente a informacao de quem bloqueou quem.
--
-- Quem CONSULTA, no entanto, olha os dois sentidos (ver `haBloqueio` em
-- packages/access/src/block.ts): checar so um deixaria quem bloqueou seguir
-- mandando mensagem para quem bloqueou, que e o oposto do que isto serve.
CREATE TABLE "Block" (
    "id" TEXT NOT NULL,
    "blockerId" TEXT NOT NULL,
    "blockedId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Block_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Block_blockerId_blockedId_key" ON "Block"("blockerId", "blockedId");
CREATE INDEX "Block_blockedId_idx" ON "Block"("blockedId");

ALTER TABLE "Block" ADD CONSTRAINT "Block_blockerId_fkey"
  FOREIGN KEY ("blockerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Block" ADD CONSTRAINT "Block_blockedId_fkey"
  FOREIGN KEY ("blockedId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Ninguem bloqueia a si mesmo. Barrado no BANCO porque a consulta olha as duas
-- colunas: uma linha assim faria a pessoa deixar de poder falar consigo mesma
-- em toda checagem, sem nunca ter pedido isso.
ALTER TABLE "Block" ADD CONSTRAINT "Block_nao_e_si_mesmo"
  CHECK ("blockerId" <> "blockedId");

ALTER TABLE "Block" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "Block" FROM anon, authenticated;
