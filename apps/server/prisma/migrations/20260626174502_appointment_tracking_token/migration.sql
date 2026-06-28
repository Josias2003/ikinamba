-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN "trackingToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Appointment_trackingToken_key" ON "Appointment"("trackingToken");

