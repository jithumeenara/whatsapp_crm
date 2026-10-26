-- 146: deleting a contact archives it.
--
-- A delete used to remove the customer's whole history: conversations,
-- messages, leads, deals, broadcast delivery rows (which also rewrote the
-- counts on past broadcasts). Now the contact is marked archived and
-- hidden from lists; everything else stays. When the customer writes
-- again, on any channel, the contact comes back by itself.
-- Safe to run twice.

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS archived_by uuid;

CREATE INDEX IF NOT EXISTS contacts_account_archived_idx
  ON contacts (account_id, archived_at) WHERE archived_at IS NOT NULL;

CREATE OR REPLACE FUNCTION contacts_unarchive_on_customer_message() RETURNS trigger AS $$
BEGIN
  IF NEW.sender_type = 'customer' THEN
    UPDATE contacts c
       SET archived_at = NULL, archived_by = NULL
      FROM conversations v
     WHERE v.id = NEW.conversation_id
       AND c.id = v.contact_id
       AND c.archived_at IS NOT NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS messages_unarchive_contact ON messages;
CREATE TRIGGER messages_unarchive_contact
  AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION contacts_unarchive_on_customer_message();
