-- CreateTable
CREATE TABLE "newsletter"."pipeline_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pipeline_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "newsletter"."pipeline_runs" (
    "id" BIGSERIAL NOT NULL,
    "job" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(6),
    "stats" JSONB,
    "error" TEXT,

    CONSTRAINT "pipeline_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "newsletter"."pipeline_events" (
    "id" BIGSERIAL NOT NULL,
    "run_id" BIGINT NOT NULL,
    "level" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "data" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pipeline_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "newsletter"."alerts" (
    "id" BIGSERIAL NOT NULL,
    "incident_key" TEXT NOT NULL,
    "open_incident_key" TEXT,
    "severity" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "first_seen" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notified_at" TIMESTAMPTZ(6),
    "resolved_at" TIMESTAMPTZ(6),
    "message" TEXT NOT NULL,
    "context" JSONB,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pipeline_runs_job_started_at_idx" ON "newsletter"."pipeline_runs"("job", "started_at" DESC);

-- CreateIndex
CREATE INDEX "pipeline_events_run_id_created_at_idx" ON "newsletter"."pipeline_events"("run_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "alerts_open_incident_key_key" ON "newsletter"."alerts"("open_incident_key");

-- CreateIndex
CREATE INDEX "alerts_incident_key_first_seen_idx" ON "newsletter"."alerts"("incident_key", "first_seen" DESC);

-- CreateIndex
CREATE INDEX "alerts_status_first_seen_idx" ON "newsletter"."alerts"("status", "first_seen");

-- AddForeignKey
ALTER TABLE "newsletter"."pipeline_events" ADD CONSTRAINT "pipeline_events_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "newsletter"."pipeline_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Hand-written CHECK constraints (Prisma does not model them; see the /// notes in schema.prisma).
ALTER TABLE "newsletter"."pipeline_runs" ADD CONSTRAINT "pipeline_runs_trigger_check" CHECK ("trigger" IN ('schedule', 'manual', 'event'));
ALTER TABLE "newsletter"."pipeline_runs" ADD CONSTRAINT "pipeline_runs_status_check" CHECK ("status" IN ('running', 'succeeded', 'failed'));
ALTER TABLE "newsletter"."pipeline_events" ADD CONSTRAINT "pipeline_events_level_check" CHECK ("level" IN ('debug', 'info', 'warn', 'error'));
ALTER TABLE "newsletter"."alerts" ADD CONSTRAINT "alerts_severity_check" CHECK ("severity" IN ('critical', 'warning', 'info'));
ALTER TABLE "newsletter"."alerts" ADD CONSTRAINT "alerts_status_check" CHECK ("status" IN ('open', 'resolved'));
-- One open alert per incident: open_incident_key is set exactly while the alert is open.
ALTER TABLE "newsletter"."alerts" ADD CONSTRAINT "alerts_open_incident_key_check" CHECK (
  ("status" = 'open' AND "open_incident_key" = "incident_key")
  OR ("status" = 'resolved' AND "open_incident_key" IS NULL)
);
