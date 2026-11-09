-- 161: which team each member belongs to, for the Spending report's "by team".
--
-- A table of its own on purpose: profiles is read whole by Prisma in dozens of
-- places, so a new column there would break all of them on any server where
-- this file has not been applied yet. A person is in at most one team; a
-- member with no row is "No team".
--
-- Safe to run twice. Additive only: no column, row or table is removed.

CREATE TABLE IF NOT EXISTS member_teams (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL,
  team       text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, user_id)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'member_teams_team_length') THEN
    ALTER TABLE member_teams ADD CONSTRAINT member_teams_team_length
      CHECK (char_length(team) BETWEEN 1 AND 60);
  END IF;
  -- Links to users never delete business data (migration 132).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'member_teams_user_id_fkey') THEN
    ALTER TABLE member_teams ADD CONSTRAINT member_teams_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS member_teams_account_team ON member_teams (account_id, team);
