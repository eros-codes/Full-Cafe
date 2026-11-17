-- CreateEnum
CREATE TYPE "WaiterCallKind" AS ENUM ('WAITER', 'BILL');

-- CreateEnum
CREATE TYPE "WaiterCallStatus" AS ENUM ('OPEN', 'DONE', 'CANCELLED');

-- CreateTable
CREATE TABLE "TableCallCode" (
    "tableId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TableCallCode_pkey" PRIMARY KEY ("tableId")
);

-- CreateTable
CREATE TABLE "WaiterCall" (
    "id" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "kind" "WaiterCallKind" NOT NULL,
    "status" "WaiterCallStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "handledAt" TIMESTAMP(3),
    "handledById" TEXT,

    CONSTRAINT "WaiterCall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TableCallCode_token_key" ON "TableCallCode"("token");

-- CreateIndex
CREATE INDEX "WaiterCall_status_createdAt_idx" ON "WaiterCall"("status", "createdAt");

-- CreateIndex
CREATE INDEX "WaiterCall_tableId_createdAt_idx" ON "WaiterCall"("tableId", "createdAt");

-- AddForeignKey
ALTER TABLE "TableCallCode" ADD CONSTRAINT "TableCallCode_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "CafeTable"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiterCall" ADD CONSTRAINT "WaiterCall_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "CafeTable"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiterCall" ADD CONSTRAINT "WaiterCall_handledById_fkey" FOREIGN KEY ("handledById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

