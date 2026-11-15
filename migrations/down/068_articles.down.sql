-- Undoes migrations/068_articles.sql (run by hand, then delete its row from schema_migrations). Every article written in Admin, published
-- or not, is lost: export them first if they are needed.
DROP TABLE IF EXISTS articles;
