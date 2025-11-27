-- AlterTable
ALTER TABLE "Rfp" ADD COLUMN     "aspectosGenerales" TEXT,
ADD COLUMN     "calendarioPrevisto" TEXT,
ADD COLUMN     "companyName" TEXT,
ADD COLUMN     "content" TEXT,
ADD COLUMN     "dolores" TEXT,
ADD COLUMN     "elementosPrevios" TEXT,
ADD COLUMN     "integraciones" TEXT,
ADD COLUMN     "introFormal" TEXT,
ADD COLUMN     "necesidadesCuantificadas" TEXT,
ADD COLUMN     "objetivos" TEXT,
ADD COLUMN     "volumen" TEXT,
ALTER COLUMN "dataJson" SET DEFAULT '{}';
