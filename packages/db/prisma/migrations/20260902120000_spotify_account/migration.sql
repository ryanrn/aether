-- Conta do Spotify que a pessoa autorizou, para mostrar o que esta ouvindo.
--
-- Uma linha por usuario (`userId` e a PK). Os tokens ficam CIFRADOS na
-- aplicacao (AES-256-GCM, chave derivada do AUTH_SECRET) antes de chegarem
-- aqui: o refresh token da acesso continuo a Spotify da pessoa e nao pode
-- ficar em claro no banco.

CREATE TABLE "SpotifyAccount" (
    "userId" TEXT NOT NULL,
    "spotifyName" TEXT,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "scope" TEXT NOT NULL,
    "showOnProfile" BOOLEAN NOT NULL DEFAULT true,
    "showAsStatus" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpotifyAccount_pkey" PRIMARY KEY ("userId")
);

ALTER TABLE "SpotifyAccount" ADD CONSTRAINT "SpotifyAccount_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SpotifyAccount" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "SpotifyAccount" FROM anon, authenticated;
