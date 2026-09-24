-- People who joined the waiting list while LAUNCH_MODE=prelaunch. When the site goes live they are told once that
-- mentors are available (see server/waitlist.js launchDay). People who join later are told when a mentor in their
-- field is listed, as before.
ALTER TABLE waitlist ADD COLUMN prelaunch boolean NOT NULL DEFAULT false;
