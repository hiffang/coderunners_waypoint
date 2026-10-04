-- CreateEnum
CREATE TYPE "Brand" AS ENUM ('FRESH', 'STYLE', 'TECH');

-- CreateEnum
CREATE TYPE "VehicleType" AS ENUM ('TRUCK', 'VAN');

-- CreateEnum
CREATE TYPE "VehicleStatus" AS ENUM ('AVAILABLE', 'IN_WORKSHOP');

-- CreateEnum
CREATE TYPE "DockType" AS ENUM ('STREET', 'REAR_DOCK', 'MALL_BAY');

-- CreateEnum
CREATE TYPE "ParkingConstraint" AS ENUM ('NORMAL', 'VAN_ONLY', 'MALL_DOCK');

-- CreateEnum
CREATE TYPE "Temp" AS ENUM ('AMBIENT', 'CHILLED', 'FROZEN');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'DEFERRED', 'ALLOCATED', 'DELIVERED', 'PARTIALLY_DELIVERED', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "DecisionType" AS ENUM ('SERVED', 'DEFERRED');

-- CreateEnum
CREATE TYPE "DeferralReason" AS ENUM ('CAPACITY_WEIGHT', 'CAPACITY_VOLUME', 'NO_REFRIGERATED_VEHICLE', 'ACCESS_VAN_ONLY', 'ACCESS_MALL_WINDOW', 'DELIVERY_WINDOW', 'FUEL_QUOTA', 'TRIP_LIMIT', 'VEHICLE_UNAVAILABLE', 'DELIVERY_FAILED', 'OTHER');

-- CreateEnum
CREATE TYPE "TripState" AS ENUM ('PLANNED', 'LOADING', 'READY', 'IN_TRANSIT', 'COMPLETED');

-- CreateEnum
CREATE TYPE "StopState" AS ENUM ('PENDING', 'ARRIVED', 'DELIVERED', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "IssueType" AS ENUM ('SHORTFALL', 'DAMAGE', 'DELAY', 'ACCESS', 'RECEIPT', 'OTHER');

-- CreateEnum
CREATE TYPE "IssueSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "IssueStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "DeliveryOutcome" AS ENUM ('DELIVERED', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "ReceiptStatus" AS ENUM ('CONFIRMED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "FuelReservationState" AS ENUM ('RESERVED', 'CONSUMED', 'RELEASED');

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "clientAt" TIMESTAMP(3),
ADD COLUMN     "planRevision" INTEGER;

-- AlterTable
ALTER TABLE "User" DROP COLUMN "driverId",
ADD COLUMN     "vehicleId" TEXT;

-- CreateTable
CREATE TABLE "Depot" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Depot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Outlet" (
    "id" TEXT NOT NULL,
    "brand" "Brand" NOT NULL,
    "district" TEXT NOT NULL,
    "depotId" TEXT NOT NULL,
    "dockType" "DockType" NOT NULL,
    "parkingConstraint" "ParkingConstraint" NOT NULL,
    "windowOpen" TEXT NOT NULL,
    "windowClose" TEXT NOT NULL,
    "mallWindowOpen" TEXT,
    "mallWindowClose" TEXT,
    "raw" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Outlet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vehicle" (
    "id" TEXT NOT NULL,
    "depotId" TEXT NOT NULL,
    "type" "VehicleType" NOT NULL,
    "refrigerated" BOOLEAN NOT NULL,
    "weightCapKg" DECIMAL(10,2) NOT NULL,
    "volumeCapM3" DECIMAL(10,3) NOT NULL,
    "fuelType" TEXT NOT NULL,
    "kmPerLiter" DECIMAL(8,3) NOT NULL,
    "fuelLitersPerKm" DECIMAL(10,6) NOT NULL,
    "weeklyFuelQuotaLiters" DECIMAL(10,2) NOT NULL,
    "status" "VehicleStatus" NOT NULL DEFAULT 'AVAILABLE',
    "raw" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarDay" (
    "date" TEXT NOT NULL,
    "dow" INTEGER NOT NULL,
    "isWeekend" BOOLEAN NOT NULL,
    "isoYear" INTEGER NOT NULL,
    "isoWeek" INTEGER NOT NULL,
    "isPayday" BOOLEAN NOT NULL,
    "festival" TEXT,
    "festivalRamp" DECIMAL(4,2) NOT NULL,
    "isHoliday" BOOLEAN NOT NULL,
    "monsoon" BOOLEAN NOT NULL,
    "isOperating" BOOLEAN NOT NULL,

    CONSTRAINT "CalendarDay_pkey" PRIMARY KEY ("date")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "orderRef" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "depotId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "brand" "Brand" NOT NULL,
    "temp" "Temp" NOT NULL,
    "requestedDate" TEXT NOT NULL,
    "eligibleServiceDate" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "totalUnits" INTEGER NOT NULL,
    "totalWeightKg" DECIMAL(10,2) NOT NULL,
    "totalVolumeM3" DECIMAL(10,3) NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'CONFIRMED',
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "followUpOfId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderLine" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "orderedUnits" INTEGER NOT NULL,
    "unitWeightKg" DECIMAL(10,3) NOT NULL,
    "unitVolumeM3" DECIMAL(10,4) NOT NULL,

    CONSTRAINT "OrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "depotId" TEXT NOT NULL,
    "serviceDate" TEXT NOT NULL,
    "status" "PlanStatus" NOT NULL DEFAULT 'DRAFT',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "publishedAt" TIMESTAMP(3),
    "publishedById" TEXT,
    "createdById" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AllocationDecision" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "decision" "DecisionType" NOT NULL,
    "tripId" TEXT,
    "stopId" TEXT,
    "reasonCode" "DeferralReason",
    "reasonText" TEXT,
    "nextEligibleDate" TEXT,
    "priorityNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AllocationDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trip" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "depotId" TEXT NOT NULL,
    "serviceDate" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "assignedDriverId" TEXT,
    "tripNumber" INTEGER NOT NULL,
    "brand" "Brand" NOT NULL,
    "district" TEXT NOT NULL,
    "plannedDepartureAt" TIMESTAMP(3) NOT NULL,
    "plannedReturnAt" TIMESTAMP(3) NOT NULL,
    "distanceKm" DECIMAL(10,2) NOT NULL,
    "reservedFuelLiters" DECIMAL(10,2) NOT NULL,
    "state" "TripState" NOT NULL DEFAULT 'PLANNED',
    "planRevision" INTEGER NOT NULL,
    "loadingStartedAt" TIMESTAMP(3),
    "readyAt" TIMESTAMP(3),
    "departedAt" TIMESTAMP(3),
    "returnedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Trip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Stop" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "plannedArrivalAt" TIMESTAMP(3) NOT NULL,
    "etaAt" TIMESTAMP(3),
    "plannedServiceMin" INTEGER NOT NULL,
    "state" "StopState" NOT NULL DEFAULT 'PENDING',
    "actualArrivalAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Stop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StopOrder" (
    "stopId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,

    CONSTRAINT "StopOrder_pkey" PRIMARY KEY ("stopId","orderId")
);

-- CreateTable
CREATE TABLE "LoadingCheck" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "expectedUnits" INTEGER NOT NULL,
    "loadedUnits" INTEGER NOT NULL,
    "damageUnits" INTEGER NOT NULL,
    "note" TEXT,
    "planRevision" INTEGER NOT NULL,
    "checkedById" TEXT NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoadingCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Issue" (
    "id" TEXT NOT NULL,
    "type" "IssueType" NOT NULL,
    "severity" "IssueSeverity" NOT NULL,
    "blocking" BOOLEAN NOT NULL DEFAULT false,
    "orderId" TEXT,
    "tripId" TEXT,
    "stopId" TEXT,
    "orderLineId" TEXT,
    "reporterId" TEXT NOT NULL,
    "reporterRole" "Role" NOT NULL,
    "text" TEXT NOT NULL,
    "status" "IssueStatus" NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "resolvedById" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "clientAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Issue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProofOfDelivery" (
    "id" TEXT NOT NULL,
    "stopId" TEXT NOT NULL,
    "outcome" "DeliveryOutcome" NOT NULL,
    "recipientName" TEXT,
    "note" TEXT,
    "failureReason" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedById" TEXT NOT NULL,

    CONSTRAINT "ProofOfDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryLineOutcome" (
    "stopId" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "loadedUnitsSnapshot" INTEGER NOT NULL,
    "deliveredUnits" INTEGER NOT NULL,
    "damagedUnits" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryLineOutcome_pkey" PRIMARY KEY ("stopId","orderLineId")
);

-- CreateTable
CREATE TABLE "Receipt" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "storeUserId" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "status" "ReceiptStatus" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceiptLine" (
    "receiptId" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "receivedUnits" INTEGER NOT NULL,
    "damageUnits" INTEGER NOT NULL,

    CONSTRAINT "ReceiptLine_pkey" PRIMARY KEY ("receiptId","orderLineId")
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "clientFileId" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "proofId" TEXT,
    "issueId" TEXT,
    "receiptId" TEXT,
    "linkedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleWeekFuel" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "isoYear" INTEGER NOT NULL,
    "isoWeek" INTEGER NOT NULL,
    "quotaLiters" DECIMAL(10,2) NOT NULL,
    "reservedLiters" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "consumedLiters" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VehicleWeekFuel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripFuelReservation" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "fuelWeekId" TEXT NOT NULL,
    "liters" DECIMAL(10,2) NOT NULL,
    "state" "FuelReservationState" NOT NULL DEFAULT 'RESERVED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TripFuelReservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Depot_name_key" ON "Depot"("name");

-- CreateIndex
CREATE INDEX "Outlet_depotId_idx" ON "Outlet"("depotId");

-- CreateIndex
CREATE INDEX "Vehicle_depotId_idx" ON "Vehicle"("depotId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_orderRef_key" ON "Order"("orderRef");

-- CreateIndex
CREATE INDEX "Order_depotId_eligibleServiceDate_status_idx" ON "Order"("depotId", "eligibleServiceDate", "status");

-- CreateIndex
CREATE INDEX "Order_outletId_createdAt_idx" ON "Order"("outletId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "OrderLine_orderId_lineNo_key" ON "OrderLine"("orderId", "lineNo");

-- CreateIndex
CREATE UNIQUE INDEX "Plan_depotId_serviceDate_key" ON "Plan"("depotId", "serviceDate");

-- CreateIndex
CREATE INDEX "AllocationDecision_orderId_idx" ON "AllocationDecision"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "AllocationDecision_planId_orderId_key" ON "AllocationDecision"("planId", "orderId");

-- CreateIndex
CREATE INDEX "Trip_planId_idx" ON "Trip"("planId");

-- CreateIndex
CREATE INDEX "Trip_assignedDriverId_serviceDate_idx" ON "Trip"("assignedDriverId", "serviceDate");

-- CreateIndex
CREATE INDEX "Trip_depotId_serviceDate_idx" ON "Trip"("depotId", "serviceDate");

-- CreateIndex
CREATE UNIQUE INDEX "Trip_vehicleId_serviceDate_tripNumber_key" ON "Trip"("vehicleId", "serviceDate", "tripNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Stop_tripId_sequence_key" ON "Stop"("tripId", "sequence");

-- CreateIndex
CREATE INDEX "StopOrder_orderId_idx" ON "StopOrder"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "LoadingCheck_tripId_orderLineId_key" ON "LoadingCheck"("tripId", "orderLineId");

-- CreateIndex
CREATE INDEX "Issue_tripId_status_idx" ON "Issue"("tripId", "status");

-- CreateIndex
CREATE INDEX "Issue_orderId_idx" ON "Issue"("orderId");

-- CreateIndex
CREATE INDEX "Issue_status_createdAt_idx" ON "Issue"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProofOfDelivery_stopId_key" ON "ProofOfDelivery"("stopId");

-- CreateIndex
CREATE INDEX "DeliveryLineOutcome_orderLineId_idx" ON "DeliveryLineOutcome"("orderLineId");

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_orderId_key" ON "Receipt"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "Attachment_storageKey_key" ON "Attachment"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "Attachment_uploadedById_clientFileId_key" ON "Attachment"("uploadedById", "clientFileId");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleWeekFuel_vehicleId_isoYear_isoWeek_key" ON "VehicleWeekFuel"("vehicleId", "isoYear", "isoWeek");

-- CreateIndex
CREATE UNIQUE INDEX "TripFuelReservation_tripId_key" ON "TripFuelReservation"("tripId");

-- CreateIndex
CREATE UNIQUE INDEX "User_vehicleId_key" ON "User"("vehicleId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_depotId_fkey" FOREIGN KEY ("depotId") REFERENCES "Depot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Outlet" ADD CONSTRAINT "Outlet_depotId_fkey" FOREIGN KEY ("depotId") REFERENCES "Depot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_depotId_fkey" FOREIGN KEY ("depotId") REFERENCES "Depot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_depotId_fkey" FOREIGN KEY ("depotId") REFERENCES "Depot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_followUpOfId_fkey" FOREIGN KEY ("followUpOfId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Plan" ADD CONSTRAINT "Plan_depotId_fkey" FOREIGN KEY ("depotId") REFERENCES "Depot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Plan" ADD CONSTRAINT "Plan_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Plan" ADD CONSTRAINT "Plan_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllocationDecision" ADD CONSTRAINT "AllocationDecision_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllocationDecision" ADD CONSTRAINT "AllocationDecision_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllocationDecision" ADD CONSTRAINT "AllocationDecision_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllocationDecision" ADD CONSTRAINT "AllocationDecision_stopId_fkey" FOREIGN KEY ("stopId") REFERENCES "Stop"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_depotId_fkey" FOREIGN KEY ("depotId") REFERENCES "Depot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_assignedDriverId_fkey" FOREIGN KEY ("assignedDriverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stop" ADD CONSTRAINT "Stop_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stop" ADD CONSTRAINT "Stop_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StopOrder" ADD CONSTRAINT "StopOrder_stopId_fkey" FOREIGN KEY ("stopId") REFERENCES "Stop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StopOrder" ADD CONSTRAINT "StopOrder_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoadingCheck" ADD CONSTRAINT "LoadingCheck_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoadingCheck" ADD CONSTRAINT "LoadingCheck_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "OrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoadingCheck" ADD CONSTRAINT "LoadingCheck_checkedById_fkey" FOREIGN KEY ("checkedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_stopId_fkey" FOREIGN KEY ("stopId") REFERENCES "Stop"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProofOfDelivery" ADD CONSTRAINT "ProofOfDelivery_stopId_fkey" FOREIGN KEY ("stopId") REFERENCES "Stop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProofOfDelivery" ADD CONSTRAINT "ProofOfDelivery_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryLineOutcome" ADD CONSTRAINT "DeliveryLineOutcome_stopId_fkey" FOREIGN KEY ("stopId") REFERENCES "Stop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryLineOutcome" ADD CONSTRAINT "DeliveryLineOutcome_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "OrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_storeUserId_fkey" FOREIGN KEY ("storeUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptLine" ADD CONSTRAINT "ReceiptLine_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptLine" ADD CONSTRAINT "ReceiptLine_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "OrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_proofId_fkey" FOREIGN KEY ("proofId") REFERENCES "ProofOfDelivery"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleWeekFuel" ADD CONSTRAINT "VehicleWeekFuel_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripFuelReservation" ADD CONSTRAINT "TripFuelReservation_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripFuelReservation" ADD CONSTRAINT "TripFuelReservation_fuelWeekId_fkey" FOREIGN KEY ("fuelWeekId") REFERENCES "VehicleWeekFuel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
