-- CreateTable
CREATE TABLE "PlanKey" (
    "id" TEXT NOT NULL,
    "codigoHash" TEXT NOT NULL,
    "prefixo" TEXT NOT NULL,
    "tier" "PlanTier" NOT NULL,
    "dias" INTEGER,
    "maxUsos" INTEGER NOT NULL DEFAULT 1,
    "usos" INTEGER NOT NULL DEFAULT 0,
    "expiraEm" TIMESTAMP(3),
    "revogadaEm" TIMESTAMP(3),
    "criadaPor" TEXT,
    "motivo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanKeyRedemption" (
    "id" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tierConcedido" "PlanTier" NOT NULL,
    "expiraEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanKeyRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlanKey_codigoHash_key" ON "PlanKey"("codigoHash");

-- CreateIndex
CREATE INDEX "PlanKey_revogadaEm_idx" ON "PlanKey"("revogadaEm");

-- CreateIndex
CREATE INDEX "PlanKeyRedemption_userId_idx" ON "PlanKeyRedemption"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PlanKeyRedemption_keyId_userId_key" ON "PlanKeyRedemption"("keyId", "userId");

-- AddForeignKey
ALTER TABLE "PlanKeyRedemption" ADD CONSTRAINT "PlanKeyRedemption_keyId_fkey" FOREIGN KEY ("keyId") REFERENCES "PlanKey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanKeyRedemption" ADD CONSTRAINT "PlanKeyRedemption_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
