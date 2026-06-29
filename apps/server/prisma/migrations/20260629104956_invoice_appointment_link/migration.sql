-- AlterTable
ALTER TABLE `Invoice` ADD COLUMN `appointmentId` VARCHAR(191) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `Invoice_appointmentId_key` ON `Invoice`(`appointmentId`);

-- AddForeignKey
ALTER TABLE `Invoice` ADD CONSTRAINT `Invoice_appointmentId_fkey` FOREIGN KEY (`appointmentId`) REFERENCES `Appointment`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
