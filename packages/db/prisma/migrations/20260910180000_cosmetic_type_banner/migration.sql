-- Reconcilia o enum `CosmeticType` do banco com o schema.
--
-- O schema declara `DECORATION` e `BANNER`. O banco de PRODUCAO tem
-- `DECORATION, FRAME, EFFECT, BADGE, OUTRO` — drift de um `db push` de um plano
-- mais amplo (as 5 categorias do mock da loja) que nunca virou migracao. Sem
-- `BANNER`, qualquer query de catalogo de banner estoura com `22P02` e derruba
-- a pagina da Loja.
--
-- Aqui so ADICIONA `BANNER` (idempotente). Os valores extras ficam onde estao,
-- sem uso — cada categoria nova (FRAME/EFFECT/BADGE) entra formalmente no
-- schema no seu proprio estagio. `ADD VALUE` e aditivo e nao reescreve linha.

ALTER TYPE "CosmeticType" ADD VALUE IF NOT EXISTS 'BANNER';
