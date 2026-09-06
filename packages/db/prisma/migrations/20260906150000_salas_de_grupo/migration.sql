-- Salas de voz efemeras + "Procurar grupo" (fase 2, estagio 3).
--
-- `Channel.isTemporary` ja existia como flag sem comportamento — o gateway
-- agora apaga o canal quando ele esvazia. `jogo` e `criadaPor` sao o que
-- transforma um canal temporario numa SALA DE GRUPO: o jogo que ela junta e
-- quem a abriu. Ambos NULL num canal comum.
--
-- `Server.salasDeGrupo` e o opt-in, mesma logica do `cargoPorJogo`: recurso
-- que qualquer membro aciona so entra em servidor que pediu.
--
-- Indice `("serverId", "isTemporary")` para a varredura periodica do gateway.

ALTER TABLE "Channel"
  ADD COLUMN "jogo"      TEXT,
  ADD COLUMN "criadaPor" TEXT;

ALTER TABLE "Server"
  ADD COLUMN "salasDeGrupo" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "Channel_serverId_isTemporary_idx" ON "Channel"("serverId", "isTemporary");
