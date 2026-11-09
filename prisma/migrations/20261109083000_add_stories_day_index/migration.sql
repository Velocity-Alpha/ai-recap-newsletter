-- #82: the ticker, the board and the jobs filter stories by day. About 7k rows, so the build takes milliseconds.
CREATE INDEX "stories_day_idx" ON "newsletter"."stories"("day");
