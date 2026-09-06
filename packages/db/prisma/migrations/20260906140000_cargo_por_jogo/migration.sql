-- Cargo automatico por jogo (fase 2, estagio 2).
--
-- Tres colunas NULLABLE / com default, sem tabela nova: o cargo por jogo
-- reaproveita `Role` e `MemberRole` que ja existem. Servidor que ja existe
-- nasce com o recurso DESLIGADO (`cargoPorJogo` = false) e nenhum cargo
-- vinculado.
--
-- `jogoNormalizado` e a forma canonica de `jogoVinculado` (a mesma
-- `normalizarNome` que o gateway usa para casar o nome vindo do detector). O
-- indice `("serverId", "jogoNormalizado")` serve a consulta que o gateway faz
-- a cada troca de jogo: "quais cargos deste servidor estao vinculados a este
-- jogo".

ALTER TABLE "Server"
  ADD COLUMN "cargoPorJogo" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Role"
  ADD COLUMN "jogoVinculado"   TEXT,
  ADD COLUMN "jogoNormalizado" TEXT;

CREATE INDEX "Role_serverId_jogoNormalizado_idx" ON "Role"("serverId", "jogoNormalizado");
