-- Undoes migrations/067_match_runs.sql (run by hand, then delete its row from schema_migrations). The counts of matches made and the
-- answers signed-in people gave are lost.
DROP TABLE IF EXISTS match_runs;
