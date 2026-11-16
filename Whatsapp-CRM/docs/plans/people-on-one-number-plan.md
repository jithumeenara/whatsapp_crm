# Plan: several people on one phone number

Status: **plan only — nothing built.** Written 2026-11-16 after a hospital
(SP) complaint. Works for any business (a parent booking for two children
at a school, a family at a clinic, a company number for several staff).

## The complaint

> "I need to book two patients on the same number. With New lead I enter
> the second patient's name; the number is the same. Only one of them can
> be saved. When I do save both and then change a name, both get the same
> name — I cannot give them different names."

## Why it happens (checked in the code)

1. A phone number is one contact. `contacts` is unique on
   (account, phone_normalized) — one WhatsApp chat per number, which is
   right for the chat.
2. A lead has **no name of its own.** Its person is `lead.contact`.
3. New lead with a number that already exists: `findOrCreateContact`
   finds the existing contact and **drops the new name**; the duplicate box
   then offers "Create anyway", which adds a second lead **on the same
   contact**.
4. So both leads show the contact's name, and editing the name edits the
   one contact — both leads change.
5. Age, gender and address were moved onto the contact (migration 148),
   so they have the same problem: two patients cannot have two ages.

## What we build: "people" on a contact

The contact stays the **number** (its WhatsApp chat, its owner). A new,
small record holds each **person** booked through that number.

- **Table `contact_people`** (migration 168, safe to run twice):
  `id, account_id, contact_id, name, age, gender, address, relation
  (optional: "son", "mother"…), created_by, created_at, updated_at`.
  Indexed on (account_id, contact_id). Every read and write is scoped by
  `account_id`.
- **`leads.person_id`** (nullable, → contact_people, ON DELETE SET NULL).
  A lead with no person behaves exactly as today — **existing leads and
  data are untouched; no data is moved.**
- **What a lead shows:** the person's name/age/gender/address when it has
  a person; otherwise the contact's, as now.

### New lead form
After the number is picked or typed and it already exists:
**"Who is this for?"** — the number's owner (as today), one of the people
already on this number, or **Add a person** (name required; age, gender,
address, relation optional). A new number works as today.

### Duplicate check
Per **person**, not per number. A second patient on the same number is not
a duplicate and saves straight away. The same person with an open lead
still gets the "already here" box.

### Lead page
"Lead details" edits **this lead's person** (name, age, gender, address)
and never the other people on the number. "Edit contact" still edits the
number's owner. A small "Person" line shows who the lead is for and offers
"Change person" (pick another person on the number, or add one).

### Leads list and search
Shows the person's name (with the number owner's name small, when they
differ). Search finds people by name too.

### Contact page and Inbox sidebar (phase 3)
"People on this number" — list, add, rename, remove (remove is refused
while any lead points at the person; they can be renamed instead).

### Not changed
WhatsApp chat, the AI, broadcasts and the 24-hour window stay per number.
The AI's "my registrations" lookup by the customer's own number is
unaffected. Reports keep counting leads; "people" is not a new report.

## Phases (each: tests first, then code, full suite, one commit)

1. **Data and API** — migration 168 (dry-run twice in BEGIN/ROLLBACK on
   crm_prod_copy), Prisma model, `/api/contacts/[id]/people` (GET, POST,
   PATCH, DELETE with the guard above), `person_id` / `new_person` on lead
   create and update, duplicate check per person. Tests: two people on one
   number both save; renaming one leaves the other; another account's
   person id is refused; the duplicate box only for the same person.
2. **Screens** — New lead "Who is this for?", lead page person editing,
   list and search. Checked in a browser at 360 px and desktop.
3. **Contact page and Inbox sidebar** — people list and editing.
4. **Deploy** — migration 168 + `prisma generate` on each server (the
   update script does both).

About 2–3 working sessions for phases 1–2; phase 3 one more.

## Decisions needed before building

1. **The word on screen** — "Person" everywhere (any industry), or a word
   the business sets in Settings (e.g. "Patient", "Student")?
   *Suggested: a setting, default "Person".*
2. **Existing double bookings** — leave old leads as they are, or offer a
   one-time "split" screen for contacts that already have several open
   leads? *Suggested: leave them; a lead can be given a person by hand.*
3. **Age/gender/address on the contact** — when a lead has a person, the
   person's values only (suggested), or fall back to the contact's when the
   person's are empty?
4. **Phase 3 now or later** — build the contact page / Inbox people list
   together with phases 1–2, or after the hospital has tried 1–2?
   *Suggested: after.*
