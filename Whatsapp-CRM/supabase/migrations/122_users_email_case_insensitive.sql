-- One account per email, whatever the capitals.
--
-- users.email was unique as typed, so "Anu@gmail.com" and
-- "anu@gmail.com" could be two accounts. Sign-in and sign-up now ignore
-- case; this makes the database agree.
--
-- If this fails with "could not create unique index", two accounts
-- already differ only by case. List them, merge by hand, run again:
--   SELECT lower(email), array_agg(email) FROM users
--   GROUP BY 1 HAVING count(*) > 1;
--
-- Safe to run again.

CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_key ON users (lower(email));
