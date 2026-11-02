-- Reservation / payment cleanup (review of the reservation section).

-- ─── 1. Reservation statuses that no code ever set ──────────────────────────
-- DRAFT and PAYMENT_PENDING were never written by the server; a leftover row (from an old version) is a hold
-- that is long over, so it is closed as expired.
UPDATE "Reservation" SET "status" = 'EXPIRED' WHERE "status" IN ('DRAFT', 'PAYMENT_PENDING');

CREATE TYPE "ReservationStatus_new" AS ENUM ('HOLD', 'PAYMENT_REVIEW', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW', 'EXPIRED');
ALTER TABLE "Reservation" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Reservation" ALTER COLUMN "status" TYPE "ReservationStatus_new" USING ("status"::text::"ReservationStatus_new");
ALTER TYPE "ReservationStatus" RENAME TO "ReservationStatus_old";
ALTER TYPE "ReservationStatus_new" RENAME TO "ReservationStatus";
DROP TYPE "ReservationStatus_old";
ALTER TABLE "Reservation" ALTER COLUMN "status" SET DEFAULT 'HOLD';

-- ─── 2. The mock payments of the first version ──────────────────────────────
-- Every payment is either Zarinpal or recorded by staff. A MOCK row can only come from the first prototype; it is
-- kept as a manual payment so the café's history stays complete.
UPDATE "Payment" SET "method" = 'MANUAL' WHERE "method" = 'MOCK';

CREATE TYPE "PaymentMethod_new" AS ENUM ('ZARINPAL', 'MANUAL');
ALTER TABLE "Payment" ALTER COLUMN "method" DROP DEFAULT;
ALTER TABLE "Payment" ALTER COLUMN "method" TYPE "PaymentMethod_new" USING ("method"::text::"PaymentMethod_new");
ALTER TYPE "PaymentMethod" RENAME TO "PaymentMethod_old";
ALTER TYPE "PaymentMethod_new" RENAME TO "PaymentMethod";
DROP TYPE "PaymentMethod_old";
ALTER TABLE "Payment" ALTER COLUMN "method" SET DEFAULT 'ZARINPAL';

ALTER TABLE "Payment" ALTER COLUMN "provider" SET DEFAULT 'zarinpal';
ALTER TABLE "Payment" DROP COLUMN "isMock";

-- ─── 3. Looking payments up by their gateway authority ──────────────────────
-- The payment callback finds the payment by Zarinpal's authority; without an index that read the whole table.
CREATE INDEX "Payment_authority_idx" ON "Payment"("authority");
