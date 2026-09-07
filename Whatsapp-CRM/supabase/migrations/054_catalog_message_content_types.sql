-- Widen messages.content_type to allow the four WhatsApp Catalog content
-- types added by migration 053 (CatalogConfig/Product/Order) — that
-- migration added the new tables and columns but missed this CHECK
-- constraint, which would otherwise reject every catalog/product/order
-- Message insert at the DB layer despite the app-level code being correct.
-- Same drop/re-add idiom as migrations 010_flows.sql and
-- 049_address_contacts_messages.sql.
ALTER TABLE messages
  DROP CONSTRAINT IF EXISTS messages_content_type_check;

ALTER TABLE messages
  ADD CONSTRAINT messages_content_type_check
  CHECK (content_type IN (
    'text', 'image', 'document', 'audio', 'video',
    'location', 'template', 'interactive', 'address', 'contacts',
    'order', 'catalog', 'single_product', 'multi_product'
  ));
