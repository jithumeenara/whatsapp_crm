-- A filter somebody uses often enough to name.
--
-- "My hot leads in Malappuram" is three controls set the same way every
-- morning. Setting them again each time is not hard, which is exactly
-- why nobody does it — they settle for the default view and stop using
-- the filters at all.
--
-- Per person rather than per account, deliberately. That sentence is
-- about one agent's work; the same filter saved account-wide is wrong
-- for everybody else who opens it. An account-wide view is a different
-- feature with a different owner, and pretending one table can be both
-- is how a saved view becomes something people stop trusting.
--
-- The filters are stored loosely as JSON so a filter added next year
-- needs no migration, and a key the page no longer reads is ignored
-- rather than breaking the view.
CREATE TABLE IF NOT EXISTS lead_views (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       text NOT NULL,
  filters    jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- The only way this table is ever read: one person's views, in order.
CREATE INDEX IF NOT EXISTS lead_views_user_order_idx
  ON lead_views (user_id, sort_order);
