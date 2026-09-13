-- Torna `AuditLog.serverId` opcional, pra acoes GLOBAIS da equipe (kill
-- switch, chave de plano, cosmetico, bloqueio de aplicacao) poderem entrar
-- na auditoria. Antes disto o campo era obrigatorio e essas acoes so tinham
-- rastro no log estruturado (`log.*`), nunca pesquisavel dentro do produto.
--
-- So DROP NOT NULL: a foreign key existente ja aceita NULL sem precisar ser
-- recriada (FK em Postgres so exige que um valor NAO-NULO corresponda a uma
-- linha existente; NULL nunca violou FK nenhuma). Nao ha dado a migrar —
-- toda linha ja existente tem `serverId` preenchido.

ALTER TABLE "AuditLog" ALTER COLUMN "serverId" DROP NOT NULL;

-- Consulta "so as acoes globais, mais recentes primeiro" (serverId IS NULL)
-- sem cair em scan sequencial conforme o catalogo de acoes globais cresce.
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
