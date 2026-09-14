-- Fecha o drift do enum `CosmeticType` apontado na auditoria pre-beta.
--
-- O banco de PRODUCAO tem `DECORATION, FRAME, EFFECT, BADGE, OUTRO, BANNER`
-- (os 4 do meio vieram do `db push` antigo documentado em
-- `20260910180000_cosmetic_type_banner`, e nunca tiveram uso). O schema so
-- declara `DECORATION` e `BANNER`. Enquanto o drift existisse, uma linha com
-- um desses 4 tipos passaria pelo Prisma sem erro na escrita mas quebraria
-- `catalogoParaUsuario` na leitura — o parse do tipo desconhecido falha e a
-- funcao engole o erro, sumindo a linha inteira da consulta sem aviso.
--
-- Verificado antes de escrever esta migracao (consulta direta, so leitura):
-- nenhuma linha de "Cosmetic" usa FRAME/EFFECT/BADGE/OUTRO em producao — so
-- DECORATION. Nada para migrar, so encolher o enum.
--
-- Postgres nao tem "ALTER TYPE ... DROP VALUE" (nem em versoes recentes, de
-- forma segura) — o padrao para encolher um enum e recriar o tipo:
--  1. renomeia o tipo atual para tirar do caminho;
--  2. cria o tipo novo, so com os valores do schema;
--  3. troca a coluna para o tipo novo (cast por texto);
--  4. apaga o tipo antigo.
-- O indice `Cosmetic_tipo_ativo_ordem_idx` e reconstruido automaticamente
-- pelo Postgres como parte do ALTER COLUMN TYPE, na mesma transacao.

ALTER TYPE "CosmeticType" RENAME TO "CosmeticType_old";

CREATE TYPE "CosmeticType" AS ENUM ('DECORATION', 'BANNER');

ALTER TABLE "Cosmetic"
  ALTER COLUMN "tipo" TYPE "CosmeticType"
  USING ("tipo"::text::"CosmeticType");

DROP TYPE "CosmeticType_old";
