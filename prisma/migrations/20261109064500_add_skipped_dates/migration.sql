-- CreateTable
CREATE TABLE "newsletter"."skipped_dates" (
    "date" DATE NOT NULL,
    "note" TEXT,
    "created_by" TEXT NOT NULL DEFAULT 'approval',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "skipped_dates_pkey" PRIMARY KEY ("date")
);
