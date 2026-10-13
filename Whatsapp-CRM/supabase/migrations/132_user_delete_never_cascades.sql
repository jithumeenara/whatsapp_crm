-- Deleting a user must never delete the business's data.
--
-- Every link from a business table to users was ON DELETE CASCADE, so one
-- deleted staff user took with them every contact they had added (and,
-- through contacts, every conversation and message), their leads,
-- follow-ups, tasks, deals, broadcasts, flows, automations and even the
-- WhatsApp connection. Removing a member now switches them off instead
-- (src/lib/auth/deactivate-member.ts); this makes the database refuse the
-- old behaviour outright, whatever code asks for it.
--
-- Personal rows that mean nothing without the person keep cascading:
-- profiles, sessions, MFA challenges, email tokens, push subscriptions,
-- saved lead views.
--
-- Safe to run again: each constraint is rebuilt under its own name only
-- while it still cascades.

DO $$
DECLARE
  r record;
  cols text;
  refcols text;
BEGIN
  FOR r IN
    SELECT co.conname, co.conrelid::regclass AS child, co.conrelid, co.conkey, co.confkey
      FROM pg_constraint co
     WHERE co.contype = 'f'
       AND co.confrelid = 'public.users'::regclass
       AND co.confdeltype = 'c'
       AND co.conrelid::regclass::text NOT IN (
         'profiles', 'user_sessions', 'mfa_challenges', 'email_verification_tokens',
         'push_subscriptions', 'lead_views'
       )
  LOOP
    SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY k.ord) INTO cols
      FROM unnest(r.conkey) WITH ORDINALITY AS k(attnum, ord)
      JOIN pg_attribute a ON a.attrelid = r.conrelid AND a.attnum = k.attnum;
    SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY k.ord) INTO refcols
      FROM unnest(r.confkey) WITH ORDINALITY AS k(attnum, ord)
      JOIN pg_attribute a ON a.attrelid = 'public.users'::regclass AND a.attnum = k.attnum;
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.child, r.conname);
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY (%s) REFERENCES public.users (%s) ON DELETE RESTRICT',
                   r.child, r.conname, cols, refcols);
  END LOOP;
END $$;
