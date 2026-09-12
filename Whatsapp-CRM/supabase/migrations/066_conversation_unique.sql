-- Closes a TOCTOU race in findOrCreateConversation
-- (src/app/api/whatsapp/webhook/route.ts): a plain findFirst-then-create
-- with no DB backstop let two near-simultaneous inbound webhook
-- deliveries for the same contact both pass the findFirst check and both
-- insert, producing two permanent conversation threads for one contact.
-- Reported live (Sept 2026): contact "jithulr44" showing as both an
-- unassigned conversation and one assigned to agent Rahul. Same bug
-- class, same fix, as WhatsAppConfig.phone_number_id (migration 063).
--
-- A UNIQUE constraint can't be added while duplicates already exist, so
-- step 1 merges any existing duplicate groups first — for each group
-- sharing (account_id, contact_id, channel, whatsapp_config_id), the
-- OLDEST row survives (preserving whatever agent assignment/history it
-- already has), every message/reaction/deal/flow_run/scheduled_message/
-- catalog_order/whatsapp_payment on the newer duplicate(s) is re-pointed
-- onto it, and the duplicate row(s) are then deleted. Step 2 adds the
-- real, permanent fix: a DB-level unique constraint so this can't recur.

DO $$
DECLARE
  grp RECORD;
  survivor_id UUID;
  dup RECORD;
BEGIN
  FOR grp IN
    SELECT account_id, contact_id, channel, whatsapp_config_id
    FROM conversations
    GROUP BY account_id, contact_id, channel, whatsapp_config_id
    HAVING COUNT(*) > 1
  LOOP
    SELECT id INTO survivor_id
    FROM conversations
    WHERE account_id = grp.account_id
      AND contact_id = grp.contact_id
      AND channel = grp.channel
      AND whatsapp_config_id IS NOT DISTINCT FROM grp.whatsapp_config_id
    ORDER BY created_at ASC
    LIMIT 1;

    FOR dup IN
      SELECT id, unread_count, last_message_text, last_message_at
      FROM conversations
      WHERE account_id = grp.account_id
        AND contact_id = grp.contact_id
        AND channel = grp.channel
        AND whatsapp_config_id IS NOT DISTINCT FROM grp.whatsapp_config_id
        AND id <> survivor_id
    LOOP
      UPDATE messages           SET conversation_id = survivor_id WHERE conversation_id = dup.id;
      UPDATE message_reactions  SET conversation_id = survivor_id WHERE conversation_id = dup.id;
      UPDATE deals              SET conversation_id = survivor_id WHERE conversation_id = dup.id;
      UPDATE flow_runs          SET conversation_id = survivor_id WHERE conversation_id = dup.id;
      UPDATE scheduled_messages SET conversation_id = survivor_id WHERE conversation_id = dup.id;
      UPDATE catalog_orders     SET conversation_id = survivor_id WHERE conversation_id = dup.id;
      UPDATE whatsapp_payments  SET conversation_id = survivor_id WHERE conversation_id = dup.id;

      UPDATE conversations
      SET
        unread_count = unread_count + dup.unread_count,
        last_message_text = CASE
          WHEN dup.last_message_at IS NOT NULL
           AND (last_message_at IS NULL OR dup.last_message_at > last_message_at)
          THEN dup.last_message_text ELSE last_message_text END,
        last_message_at = GREATEST(last_message_at, dup.last_message_at)
      WHERE id = survivor_id;

      DELETE FROM conversations WHERE id = dup.id;
    END LOOP;
  END LOOP;
END $$;

ALTER TABLE conversations
  ADD CONSTRAINT conversations_natural_key_key
  UNIQUE (account_id, contact_id, channel, whatsapp_config_id);
