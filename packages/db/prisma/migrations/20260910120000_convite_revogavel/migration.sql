-- Convite revogavel.
--
-- Soft delete: um convite revogado tem de continuar distinguivel de um que
-- nunca existiu, senao a pagina de convite responde "invalido" para os dois
-- casos e o Cenario 6 (mensagens distintas) fica impossivel. A linha tambem
-- fica para o log de auditoria (`invite.revoke`) e para "quem revogou".
--
-- Coluna nullable, sem default: todo convite existente continua ativo
-- (`revokedAt IS NULL`). Nenhuma reescrita de linha.

ALTER TABLE "Invite" ADD COLUMN "revokedAt" TIMESTAMP(3);
