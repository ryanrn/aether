-- Fecha a API REST publica do Supabase (PostgREST) para anon/authenticated.
--
-- POR QUE ESTA AQUI, e nao so no painel do Supabase:
-- esta correcao foi aplicada direto no banco em 23/08/2026, e ficou existindo
-- SO la. Um banco recriado do zero com `prisma migrate deploy` nasceria com o
-- buraco de volta — RLS desligado e `anon` com SELECT/INSERT/DELETE em tudo.
-- Backup nao serve de nada se restaurar devolve um estado inseguro.
--
-- O QUE ERA: o Supabase publica uma API REST na internet, aberta com a chave
-- `anon`, que e PUBLICA por design. Com RLS desligado, essa porta entregava
-- `passwordHash`, sessoes e mensagens — e aceitava DELETE em todas as tabelas.
-- Verificado de fora: `GET /rest/v1/User` respondia 200.
--
-- Este app nunca usa PostgREST: fala com o banco por Prisma, como `postgres`
-- (DONO das tabelas), que nao e afetado por RLS nem por grant.
--
-- Idempotente de proposito: em producao ja esta aplicado, e rodar de novo nao
-- pode quebrar.

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;

-- Tabela criada por migracao futura ja nasce sem grant.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;

-- RLS em toda tabela do schema public, inclusive as que vierem depois desta
-- migracao. Sem policy nenhuma: RLS ligado sem policy = NEGAR TUDO, que e
-- exatamente o desejado para quem nunca usa a API REST.
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;
