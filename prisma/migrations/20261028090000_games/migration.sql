-- CreateTable
CREATE TABLE "GameSetting" (
    "key" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GameSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "GameDeck" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "games" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GameDeck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameCard" (
    "id" SERIAL NOT NULL,
    "deckId" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "forbidden" TEXT[],
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "GameCard_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GameDeck_name_key" ON "GameDeck"("name");

-- CreateIndex
CREATE INDEX "GameCard_deckId_idx" ON "GameCard"("deckId");

-- CreateIndex
CREATE UNIQUE INDEX "GameCard_deckId_text_key" ON "GameCard"("deckId", "text");

-- AddForeignKey
ALTER TABLE "GameCard" ADD CONSTRAINT "GameCard_deckId_fkey" FOREIGN KEY ("deckId") REFERENCES "GameDeck"("id") ON DELETE CASCADE ON UPDATE CASCADE;

