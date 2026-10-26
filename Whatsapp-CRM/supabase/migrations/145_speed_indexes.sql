-- 145: indexes for the lead tables and the contact list.
--
-- leads, lead_activities, follow_ups and tasks were created without any
-- index beyond their primary key, so every Leads page load, every count
-- of a lead's activities/follow-ups/tasks and the dashboard's lead numbers
-- read the whole table. Indexes only: no data changes. Safe to run twice.

CREATE INDEX IF NOT EXISTS leads_account_created_idx ON leads (account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS leads_account_assignee_status_idx ON leads (account_id, assigned_to, status);
CREATE INDEX IF NOT EXISTS leads_contact_idx ON leads (contact_id);

CREATE INDEX IF NOT EXISTS lead_activities_lead_created_idx ON lead_activities (lead_id, created_at DESC);

CREATE INDEX IF NOT EXISTS follow_ups_lead_idx ON follow_ups (lead_id);
CREATE INDEX IF NOT EXISTS follow_ups_account_status_due_idx ON follow_ups (account_id, status, due_at);

CREATE INDEX IF NOT EXISTS tasks_lead_idx ON tasks (lead_id);
CREATE INDEX IF NOT EXISTS tasks_account_status_idx ON tasks (account_id, status);

-- The contact list orders by newest first within an account.
CREATE INDEX IF NOT EXISTS contacts_account_created_idx ON contacts (account_id, created_at DESC);

-- Sweeps (AI tagging, staff wait, idle close) look for recent activity
-- across accounts every minute.
CREATE INDEX IF NOT EXISTS conversations_last_msg_idx ON conversations (last_message_at);
CREATE INDEX IF NOT EXISTS conversations_account_status_last_idx ON conversations (account_id, status, last_message_at);
