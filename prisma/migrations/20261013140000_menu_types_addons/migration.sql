-- Phase 2
--   1. Menu types become an admin-managed table instead of the fixed cafe/restaurant/breakfast enum.
--      Existing categories keep their menu: cafe → «کافه», restaurant → «رستوران», breakfast → «صبحانه».
--   2. Shared product add-ons (one library, attached to any number of products).
--   3. The unused "change reservation" flow is removed (no UI ever reached it).
-- Everything runs in one transaction: either all of it is applied or nothing is.
BEGIN;

-- ─── 1. Menu types: enum → table, keeping every category in its menu ─────────
ALTER TYPE "MenuType" RENAME TO "MenuType_old";

CREATE TABLE "MenuType" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MenuType_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MenuType_name_key" ON "MenuType"("name");

-- Same three tabs, same order as the old menu page.
INSERT INTO "MenuType" ("name", "sortOrder", "updatedAt") VALUES
    ('کافه', 0, CURRENT_TIMESTAMP),
    ('رستوران', 1, CURRENT_TIMESTAMP),
    ('صبحانه', 2, CURRENT_TIMESTAMP);

ALTER TABLE "Category" ADD COLUMN "menuTypeId" INTEGER;
UPDATE "Category" AS c
SET "menuTypeId" = m."id"
FROM "MenuType" AS m
WHERE m."name" = CASE c."type"::text
    WHEN 'cafe' THEN 'کافه'
    WHEN 'restaurant' THEN 'رستوران'
    WHEN 'breakfast' THEN 'صبحانه'
END;
ALTER TABLE "Category" ALTER COLUMN "menuTypeId" SET NOT NULL;

DROP INDEX "Category_type_idx";
ALTER TABLE "Category" DROP COLUMN "type";
DROP TYPE "MenuType_old";

CREATE INDEX "Category_menuTypeId_idx" ON "Category"("menuTypeId");
ALTER TABLE "Category" ADD CONSTRAINT "Category_menuTypeId_fkey" FOREIGN KEY ("menuTypeId") REFERENCES "MenuType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── 2. Add-ons ──────────────────────────────────────────────────────────────
CREATE TABLE "AddOn" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AddOn_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductAddOn" (
    "productId" INTEGER NOT NULL,
    "addOnId" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProductAddOn_pkey" PRIMARY KEY ("productId","addOnId")
);
CREATE INDEX "ProductAddOn_addOnId_idx" ON "ProductAddOn"("addOnId");
ALTER TABLE "ProductAddOn" ADD CONSTRAINT "ProductAddOn_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductAddOn" ADD CONSTRAINT "ProductAddOn_addOnId_fkey" FOREIGN KEY ("addOnId") REFERENCES "AddOn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── 3. Remove the "change reservation" flow ────────────────────────────────
-- No code ever set CHANGE_PENDING; any such row would be a leftover, so it is closed.
UPDATE "Reservation" SET "status" = 'CANCELLED' WHERE "status" = 'CHANGE_PENDING';
ALTER TABLE "Reservation" DROP CONSTRAINT "Reservation_originalReservationId_fkey";
ALTER TABLE "Reservation" DROP COLUMN "originalReservationId";

CREATE TYPE "ReservationStatus_new" AS ENUM ('DRAFT', 'HOLD', 'PAYMENT_PENDING', 'PAYMENT_REVIEW', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW', 'EXPIRED');
ALTER TABLE "Reservation" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Reservation" ALTER COLUMN "status" TYPE "ReservationStatus_new" USING ("status"::text::"ReservationStatus_new");
ALTER TYPE "ReservationStatus" RENAME TO "ReservationStatus_old";
ALTER TYPE "ReservationStatus_new" RENAME TO "ReservationStatus";
DROP TYPE "ReservationStatus_old";
ALTER TABLE "Reservation" ALTER COLUMN "status" SET DEFAULT 'HOLD';

-- One-time codes are short-lived; codes for the removed purpose are simply dropped.
DELETE FROM "OtpCode" WHERE "purpose" = 'RESERVATION_CHANGE';
CREATE TYPE "OtpPurpose_new" AS ENUM ('LOGIN', 'GUEST_ACCESS');
ALTER TABLE "OtpCode" ALTER COLUMN "purpose" TYPE "OtpPurpose_new" USING ("purpose"::text::"OtpPurpose_new");
ALTER TYPE "OtpPurpose" RENAME TO "OtpPurpose_old";
ALTER TYPE "OtpPurpose_new" RENAME TO "OtpPurpose";
DROP TYPE "OtpPurpose_old";

-- SMS log rows of the removed type were change confirmations.
UPDATE "SmsLog" SET "type" = 'CONFIRMATION' WHERE "type" = 'CHANGE';
CREATE TYPE "SmsType_new" AS ENUM ('OTP', 'CONFIRMATION', 'REMINDER', 'CANCELLATION', 'NOT_CONFIRMED');
ALTER TABLE "SmsLog" ALTER COLUMN "type" TYPE "SmsType_new" USING ("type"::text::"SmsType_new");
ALTER TYPE "SmsType" RENAME TO "SmsType_old";
ALTER TYPE "SmsType_new" RENAME TO "SmsType";
DROP TYPE "SmsType_old";

COMMIT;
