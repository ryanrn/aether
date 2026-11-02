-- Mencoes (P1-2): quem cada mensagem chamou.
--
-- So ADICIONA. Mensagens antigas ficam sem mencao nenhuma.

-- `@everyone` valido. ADD COLUMN com DEFAULT constante nao reescreve a tabela
-- (Postgres 11+): e so metadado, instantaneo mesmo com muitas mensagens.
ALTER TABLE "Message" ADD COLUMN "mencionaTodos" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "MessageMention" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userId" TEXT,
    "roleId" TEXT,

    CONSTRAINT "MessageMention_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MessageMention_userId_idx" ON "MessageMention"("userId");

-- CreateIndex
CREATE INDEX "MessageMention_roleId_idx" ON "MessageMention"("roleId");

-- CreateIndex
CREATE UNIQUE INDEX "MessageMention_messageId_userId_key" ON "MessageMention"("messageId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "MessageMention_messageId_roleId_key" ON "MessageMention"("messageId", "roleId");

-- AddForeignKey
ALTER TABLE "MessageMention" ADD CONSTRAINT "MessageMention_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageMention" ADD CONSTRAINT "MessageMention_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageMention" ADD CONSTRAINT "MessageMention_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Uma pessoa OU um cargo, nunca os dois, nunca nenhum. Mesmo CHECK de
-- `ReadState` e `Message`: sem ele, uma linha vazia escaparia dos dois uniques.
ALTER TABLE "MessageMention" ADD CONSTRAINT "MessageMention_um_alvo_so"
  CHECK (("userId" IS NULL) <> ("roleId" IS NULL));

ALTER TABLE "MessageMention" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "MessageMention" FROM anon, authenticated;
