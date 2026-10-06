-- Scale projection for the rehearsal: makes a restored copy look like a busy first year (run ONLY on a copy whose name contains "restore").
--   psql postgresql://.../wisecall_restore_scale -v ON_ERROR_STOP=1 -f scripts/rehearsal/inflate.sql
-- Adds 20,000 buyers and 100,000 answered questions (with receipts, payouts and 2 ratings in 3), spread over the 50 seeded mentors and a year.
DO $$ BEGIN IF current_database() NOT LIKE '%restore%' THEN RAISE EXCEPTION 'inflate.sql runs only on a restored copy'; END IF; END $$;
INSERT INTO users (name, email, password_hash, role, language, email_verified, username, adult_confirmed_at, created_at)
SELECT 'Scale User ' || g, 'scale.user' || g || '@example.test', (SELECT password_hash FROM users LIMIT 1), 'seeker', CASE WHEN g % 2 = 0 THEN 'ka' ELSE 'en' END,
       true, 'scale-user-' || g, now(), now() - make_interval(days => g % 365)
  FROM generate_series(1, 20000) g;
CREATE TEMP TABLE m AS SELECT id, row_number() OVER (ORDER BY email) - 1 AS i FROM users WHERE email LIKE 'rehearsal.mentor%';
CREATE TEMP TABLE s AS SELECT id, row_number() OVER (ORDER BY email) - 1 AS i FROM users WHERE email LIKE 'scale.user%';
INSERT INTO bookings (seeker_id, mentor_id, question, answer, amount, currency, platform_fee_percent, platform_fee_amount, mentor_net_amount,
                      status, provider, provider_order_id, paid_at, answered_at, answer_deadline, created_at)
SELECT s.id, m.id, 'Scale question ' || g || ' about careers, studies and the first job: what would you do in my place and why?',
       'Scale answer ' || g || ': a practical, detailed answer with the steps I would take and the mistakes I would avoid, long enough to be real.',
       a, 'gel', 20, round(a * 0.2), a - round(a * 0.2), 'answered', 'mock', 'scale-' || g,
       now() - make_interval(days => d), now() - make_interval(days => d) + interval '20 hours', now() - make_interval(days => d) + interval '7 days', now() - make_interval(days => d)
  FROM generate_series(1, 100000) g
  CROSS JOIN LATERAL (SELECT 500 + (g * 97) % 9500 AS a, 1 + g % 365 AS d) x
  JOIN m ON m.i = g % 50 JOIN s ON s.i = g % 20000;
INSERT INTO receipts (booking_id, kind, amount, currency) SELECT id, 'payment', amount, 'gel' FROM bookings WHERE provider_order_id LIKE 'scale-%';
INSERT INTO payouts (booking_id, mentor_id, amount, currency, status, payable_at)
SELECT id, mentor_id, mentor_net_amount, 'gel', CASE WHEN paid_at < now() - interval '30 days' THEN 'paid' ELSE 'pending' END, answered_at + interval '7 days'
  FROM bookings WHERE provider_order_id LIKE 'scale-%';
INSERT INTO ratings (booking_id, direction, rater_id, ratee_id, stars, review, submitted_at, revealed_at)
SELECT id, 'asker_to_mentor', seeker_id, mentor_id, 3 + (abs(hashtext(id::text)) % 3), 'Helpful.', answered_at + interval '1 day', answered_at + interval '1 day'
  FROM bookings WHERE provider_order_id LIKE 'scale-%' AND abs(hashtext(id::text)) % 3 <> 0;
ANALYZE;
SELECT (SELECT count(*) FROM users) AS users, (SELECT count(*) FROM bookings) AS bookings, (SELECT count(*) FROM ratings) AS ratings, pg_size_pretty(pg_database_size(current_database())) AS size;
