-- Amizade entre duas contas.
--
-- UMA linha por par, nao duas. Duas linhas (uma por direcao) obrigariam a
-- manter as duas em acordo a cada mudanca, e duas verdades sobre a mesma
-- relacao e como uma delas fica para tras.
--
-- O indice unico e por DIRECAO. Impedir tambem o par invertido exigiria
-- ordenar os ids na gravacao, o que tornaria "quem pediu" irrecuperavel — e
-- quem pediu e justamente o que decide de que lado o botao "aceitar" aparece.
-- Quem checa os dois sentidos antes de criar e a action.

CREATE TYPE "FriendshipStatus" AS ENUM ('PENDING', 'ACCEPTED');

CREATE TABLE "Friendship" (
    "id" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "addresseeId" TEXT NOT NULL,
    "status" "FriendshipStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "Friendship_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Friendship_requesterId_addresseeId_key"
  ON "Friendship"("requesterId", "addresseeId");
-- Os dois indices existem porque TODA consulta de "meus amigos" olha as duas
-- colunas: depois de aceito nao ha mais lado, e sem o segundo indice metade
-- da lista sairia de varredura sequencial.
CREATE INDEX "Friendship_addresseeId_status_idx" ON "Friendship"("addresseeId", "status");
CREATE INDEX "Friendship_requesterId_status_idx" ON "Friendship"("requesterId", "status");

ALTER TABLE "Friendship" ADD CONSTRAINT "Friendship_requesterId_fkey"
  FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Friendship" ADD CONSTRAINT "Friendship_addresseeId_fkey"
  FOREIGN KEY ("addresseeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Ninguem e amigo de si mesmo. Barrado no BANCO e nao so na action: a lista de
-- amigos junta as duas colunas, e uma linha assim apareceria duas vezes.
ALTER TABLE "Friendship" ADD CONSTRAINT "Friendship_nao_e_si_mesmo"
  CHECK ("requesterId" <> "addresseeId");

-- A tabela nasce fechada para a API REST publica, como as demais.
-- Ver a migracao 20260823000000_rls_e_revoke.
ALTER TABLE "Friendship" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "Friendship" FROM anon, authenticated;
