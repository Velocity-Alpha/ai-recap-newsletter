-- Additive: a new table only. n8n never reads it.

-- CreateTable
CREATE TABLE "newsletter"."rate_limits" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "window_started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rate_limits_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "rate_limits_window_started_at_idx" ON "newsletter"."rate_limits"("window_started_at");
