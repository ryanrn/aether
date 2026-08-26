-- Reacao de uma pessoa a uma mensagem.
--
-- O indice unico e o coracao do modelo: ele faz "uma reacao por pessoa, por
-- emoji, por mensagem" ser garantia do BANCO. Sem ele, dois cliques rapidos —
-- ou dois aparelhos da mesma pessoa ao mesmo tempo — criariam linhas
-- repetidas, e a contagem passaria a mentir sem nada quebrar visivelmente.
--
-- Ele tambem torna o ALTERNAR barato: em vez de "contar, decidir, gravar", da
-- para tentar criar e tratar a colisao como "ja existia, entao remova".
--
-- O emoji e guardado como TEXTO (o proprio caractere), e nao como id de um
-- catalogo nosso. Catalogo envelhece — emoji novo entra no Unicode todo ano —
-- e um id proprio obrigaria a manter uma tabela de-para para sempre.
CREATE TABLE "Reaction" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Reaction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Reaction_messageId_userId_emoji_key"
  ON "Reaction"("messageId", "userId", "emoji");
-- Carregar as reacoes de uma pagina de mensagens percorre por messageId.
CREATE INDEX "Reaction_messageId_idx" ON "Reaction"("messageId");

ALTER TABLE "Reaction" ADD CONSTRAINT "Reaction_messageId_fkey"
  FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Reaction" ADD CONSTRAINT "Reaction_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Teto de tamanho no BANCO, e nao so no validador.
--
-- O `emoji` chega do cliente. O validador em `@aether/shared` ja recusa o que
-- nao for emoji, mas ele mora no caminho normal de escrita — e uma segunda
-- porta futura (script de migracao, correcao manual) nao passaria por la. 32
-- bytes cobrem folgado a maior sequencia composta (familia com tom de pele
-- passa de 20), e barram o campo virar deposito de texto.
ALTER TABLE "Reaction" ADD CONSTRAINT "Reaction_emoji_curto"
  CHECK (length("emoji") BETWEEN 1 AND 32);

ALTER TABLE "Reaction" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "Reaction" FROM anon, authenticated;
