-- «انتخاب برای من» (menu recommender)
--   - Category.kind: drink / food / dessert (empty = not part of the recommender)
--   - Product.isAvailable: out-of-stock products stay on the menu, marked, but cannot be ordered or recommended
--   - Tag groups (questions) and their options; products and categories get options.
--     A product inherits its category's options per group unless it sets that group itself (ProductTagGroup).
-- Only additions: no existing data is changed. Everything runs in one transaction.

BEGIN;

-- CreateEnum
CREATE TYPE "CategoryKind" AS ENUM ('DRINK', 'FOOD', 'DESSERT');

-- CreateEnum
CREATE TYPE "TagStrictness" AS ENUM ('SOFT', 'HARD');

-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "kind" "CategoryKind";

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "isAvailable" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "TagGroup" (
    "id" SERIAL NOT NULL,
    "key" TEXT,
    "name" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "questionByKind" JSONB,
    "multi" BOOLEAN NOT NULL DEFAULT false,
    "strictness" "TagStrictness" NOT NULL DEFAULT 'SOFT',
    "importance" INTEGER NOT NULL DEFAULT 3,
    "kinds" "CategoryKind"[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TagGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TagOption" (
    "id" SERIAL NOT NULL,
    "groupId" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "key" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TagOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductTagGroup" (
    "productId" INTEGER NOT NULL,
    "groupId" INTEGER NOT NULL,

    CONSTRAINT "ProductTagGroup_pkey" PRIMARY KEY ("productId","groupId")
);

-- CreateTable
CREATE TABLE "ProductTagOption" (
    "productId" INTEGER NOT NULL,
    "optionId" INTEGER NOT NULL,

    CONSTRAINT "ProductTagOption_pkey" PRIMARY KEY ("productId","optionId")
);

-- CreateTable
CREATE TABLE "CategoryTagOption" (
    "categoryId" INTEGER NOT NULL,
    "optionId" INTEGER NOT NULL,

    CONSTRAINT "CategoryTagOption_pkey" PRIMARY KEY ("categoryId","optionId")
);

-- CreateIndex
CREATE UNIQUE INDEX "TagGroup_key_key" ON "TagGroup"("key");

-- CreateIndex
CREATE INDEX "TagOption_groupId_idx" ON "TagOption"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "TagOption_groupId_key_key" ON "TagOption"("groupId", "key");

-- CreateIndex
CREATE INDEX "ProductTagGroup_groupId_idx" ON "ProductTagGroup"("groupId");

-- CreateIndex
CREATE INDEX "ProductTagOption_optionId_idx" ON "ProductTagOption"("optionId");

-- CreateIndex
CREATE INDEX "CategoryTagOption_optionId_idx" ON "CategoryTagOption"("optionId");

-- AddForeignKey
ALTER TABLE "TagOption" ADD CONSTRAINT "TagOption_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "TagGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductTagGroup" ADD CONSTRAINT "ProductTagGroup_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductTagGroup" ADD CONSTRAINT "ProductTagGroup_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "TagGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductTagOption" ADD CONSTRAINT "ProductTagOption_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductTagOption" ADD CONSTRAINT "ProductTagOption_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "TagOption"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryTagOption" ADD CONSTRAINT "CategoryTagOption_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryTagOption" ADD CONSTRAINT "CategoryTagOption_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "TagOption"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
