-- CreateIndex
CREATE INDEX CONCURRENTLY activities_feed_idx ON activities (team_id, created_at DESC, id DESC);
