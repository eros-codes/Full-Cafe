-- A table taken off the floor plan but kept, because past bookings point at it (src/services/floor-plan.service.ts).
ALTER TABLE "CafeTable" ADD COLUMN "retiredAt" TIMESTAMP(3);
