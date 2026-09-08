-- Fixes a real idempotency bug found in the full-app audit: Meta's leadgen
-- webhook can arrive with no form_id, and processLeadgenChange only ever
-- created a lead_ad_submissions row `if (form)` — so a formless lead's
-- meta_leadgen_id dedup check (`findUnique` in processLeadgenChange) never
-- had a row to find, meaning every webhook redelivery (which Meta does
-- routinely) re-created a duplicate Contact/Lead/LeadActivity for the same
-- submission. form_id is now nullable so a submission row is always
-- created, closing the dedup gap regardless of whether a form was resolved.
ALTER TABLE lead_ad_submissions
  ALTER COLUMN form_id DROP NOT NULL;
