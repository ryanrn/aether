-- A moldura ESCOLHIDA pela pessoa. Nula e aditiva: nenhuma linha existente
-- muda, e o app anterior a este deploy ignora a coluna sem erro.
ALTER TABLE "User" ADD COLUMN "molduraId" TEXT;
