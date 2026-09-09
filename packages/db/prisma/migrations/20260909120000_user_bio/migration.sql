-- Bio do perfil global (redesign do chat, etapa 4).
--
-- Texto curto que a pessoa escreve sobre si, mostrado no cartao de perfil que
-- abre ao clicar no avatar/nome no chat. Nulo = nunca preencheu. A validacao
-- de tamanho (190) mora em `@aether/shared::bioSchema`; a coluna e TEXT solto
-- porque o teto pode mudar sem migracao.
--
-- Nao entra no `PublicUser`: seria bytes em toda mensagem, todo membro. O
-- cartao busca sob demanda (`perfilParaCartao`).

ALTER TABLE "User" ADD COLUMN "bio" TEXT;
