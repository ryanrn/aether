-- Uma decoracao de avatar pode ter DUAS camadas: a da frente (sobre o avatar,
-- ja em `assetKey`/`assetUrl`) e a de tras (atras do avatar), como uma coroa
-- cujo aro passa por tras da cabeca.
--
-- Aditivo e nulavel: banner e decoracao de uma camada so ficam com NULL, e a
-- migracao anterior (ja aplicada) nao muda.

ALTER TABLE "Cosmetic" ADD COLUMN "assetTrasKey" TEXT;
ALTER TABLE "Cosmetic" ADD COLUMN "assetTrasUrl" TEXT;
