-- Fixes a real gap found in the full-app audit: the Razorpay payments
-- webhook route required a `?ref=<whatsapp_payment_id>` query param that
-- nothing ever actually supplied (createRazorpayPaymentLink never wired
-- a per-payment callback/webhook URL — Razorpay doesn't support one
-- separate from the account-wide Dashboard webhook setting anyway).
--
-- The real fix: Razorpay's webhook payload already echoes back whatever
-- `reference_id` was set at payment-link-creation time
-- (payload.payment_link.entity.reference_id) — this app already sets
-- that to WhatsAppPayment.reference_id when creating the link, so the
-- webhook route can look the payment up directly from the payload,
-- needing no query param and no per-tenant webhook URL at all. Requires
-- reference_id to be unique for that lookup to be safe.
ALTER TABLE whatsapp_payments
  ADD CONSTRAINT whatsapp_payments_reference_id_key UNIQUE (reference_id);
