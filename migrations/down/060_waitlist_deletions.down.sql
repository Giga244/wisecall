-- Undoes 060_waitlist_deletions.sql. (The log of deleted waiting-list addresses is lost; the deletions themselves stay done.)
DROP TABLE IF EXISTS waitlist_deletions;
