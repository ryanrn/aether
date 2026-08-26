-- Conversa direta entre duas pessoas.
--
-- O PAR E ORDENADO: "userAId" guarda sempre o menor id e "userBId" o maior.
-- Assim o indice unico impede de verdade duas conversas para o mesmo par,
-- inclusive quando os dois lados abrem ao mesmo tempo — que e exatamente onde
-- uma checagem feita em codigo perde a corrida.
--
-- A `Friendship` indexa por DIRECAO, e essa diferenca e proposital: la o "quem
-- pediu" precisa sobreviver, porque e ele que decide de que lado o botao de
-- aceitar aparece. Numa conversa nao existe esse lado — trocar A por B nao
-- muda nada — entao da para ordenar e deixar o banco garantir o que a action
-- teria de lembrar de conferir.

CREATE TABLE "DmChannel" (
    "id" TEXT NOT NULL,
    "userAId" TEXT NOT NULL,
    "userBId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DmChannel_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DmChannel_userAId_userBId_key" ON "DmChannel"("userAId", "userBId");
-- "minhas conversas" olha as duas colunas; sem este indice metade da busca
-- sairia em varredura sequencial. Mesma razao dos dois indices em Friendship.
CREATE INDEX "DmChannel_userBId_idx" ON "DmChannel"("userBId");

ALTER TABLE "DmChannel" ADD CONSTRAINT "DmChannel_userAId_fkey"
  FOREIGN KEY ("userAId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DmChannel" ADD CONSTRAINT "DmChannel_userBId_fkey"
  FOREIGN KEY ("userBId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A ORDEM E OBRIGATORIA, e nao uma convencao que o codigo promete seguir.
-- Sem este CHECK, gravar o par invertido criaria uma segunda linha para as
-- mesmas duas pessoas sem violar o unique — e o unique passaria a nao garantir
-- nada. Ele tambem barra conversa consigo mesmo, que "<" ja exclui.
ALTER TABLE "DmChannel" ADD CONSTRAINT "DmChannel_par_ordenado"
  CHECK ("userAId" < "userBId");

ALTER TABLE "DmChannel" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "DmChannel" FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- Mensagem passa a ter DOIS pais possiveis: canal de servidor OU conversa.
--
-- As colunas nascem nulaveis porque uma mensagem preenche uma so. O que impede
-- os estados sem sentido — as duas preenchidas, ou nenhuma — e o CHECK abaixo,
-- e nao a disciplina de quem escreve o INSERT.

ALTER TABLE "Message" ADD COLUMN "dmChannelId" TEXT;

-- Toda mensagem que ja existe pertence a um canal de servidor. Tornar a coluna
-- nulavel DEPOIS de o backfill ser desnecessario e seguro: nenhuma linha atual
-- tem NULL, e o CHECK aceita todas elas.
ALTER TABLE "Message" ALTER COLUMN "channelId" DROP NOT NULL;

ALTER TABLE "Message" ADD CONSTRAINT "Message_dmChannelId_fkey"
  FOREIGN KEY ("dmChannelId") REFERENCES "DmChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Exatamente um pai. `<>` entre dois booleanos e "ou exclusivo": verdadeiro
-- so quando um lado e nulo e o outro nao.
ALTER TABLE "Message" ADD CONSTRAINT "Message_um_pai_so"
  CHECK (("channelId" IS NULL) <> ("dmChannelId" IS NULL));

CREATE INDEX "Message_dmChannelId_createdAt_idx" ON "Message"("dmChannelId", "createdAt");
