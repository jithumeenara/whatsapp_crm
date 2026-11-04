# WhatsApp CRM: factual summary

Prepared on 4 November 2026 from the source code at commit `ecd5305`, to support a proposal to the Director of ACSTI Kerala.

**How to read the labels**

- **WORKING NOW:** the feature is built and committed in the code.
- **IN PROGRESS:** partly built, or built but not yet set up on the servers.
- **PLANNED:** only mentioned in documents or project notes. No working feature exists.
- **UNSURE:** could not be confirmed from the code.

**Where the facts come from**

Most facts come from the code, and file paths are given as evidence. Some facts come from the developer's project notes. These are marked *(project notes)* and were not checked against the live server. "Working now" means the code exists. This review did not test each feature on the live ACSTI server.

**Names used in the code:** the software calls itself "WhatsApp CRM Pro" (`README.md`, `package.json`). Its current product name is "Lead Magnet CRM" *(project notes)*. "WhatsApp CRM SA" does not appear in the code files checked.

---

## Summary in 5 points

1. **It is a working system for managing customer conversations and registrations.** Staff use it to handle WhatsApp and other channels in one inbox, manage contacts, send bulk messages and run an AI assistant and chatbots.
2. **It uses the official WhatsApp Business Cloud API from Meta.** It does not use an unofficial WhatsApp Web library and no third-party provider sits in between.
3. **It sends to individual people only, not to WhatsApp groups.** A "batch" is handled as a list of people, each receiving their own message. The code has no way to post into a WhatsApp group.
4. **Another system can connect to it today, with one gap.** It can create scheduled bulk messages, add contacts and add data records using an API key. There is no simple "send this message to this phone number" endpoint yet. That would be a small addition.
5. **It already supports ACSTI's training enquiries and registrations, but it is not a training-management system.** It has no timetable, entry or exit test, attendance, certificate or honorarium module. Those would come from the proposed system.

---

## 1. What it is

It is a self-hosted customer management system (CRM) built around WhatsApp. Office staff use it to answer customer messages from one shared inbox, keep contact and lead records, send approved bulk messages, and collect registrations through forms, chatbots and an AI assistant. It solves the problem of many people's enquiries arriving on one WhatsApp number with no shared record, no follow-up tracking and no way to send information to many people in an orderly, permitted way. The code is written to work for any type of business, and each server runs for one customer.

## 2. Tech stack and where it runs

**In plain words:** it is a web application that runs on a rented cloud server (VPS), not on an office PC. Staff open it in a web browser. It must be reachable from the internet, because Meta delivers incoming WhatsApp messages to it over the internet.

- **Servers:** one server per customer *(project notes)*. ACSTI has its own server and a second customer has a separate one. Both were updated to commit `ecd5305` on 3 November 2026 (update output seen by the developer).
- **Public address:** project notes record the domain `acstikereala.online` for the ACSTI server. **UNSURE:** please confirm this is the current address.

### Technical detail

| Item | What is used | Evidence |
|---|---|---|
| Language and framework | TypeScript, Next.js 16, React 19 | `package.json` |
| Database | PostgreSQL 16, accessed through Prisma | `prisma/schema.prisma`, server check of 2 Nov 2026 |
| Live updates to screens | Socket.IO | `package.json`, `src/lib/realtime-server.ts` |
| Server setup | Ubuntu, nginx, PM2 | `docs/deploy/HARDENING.md` |
| Updating the server | A script that backs up the database, applies changes and restores the old code if the build fails | `docs/deploy/code-update.sh` |

**Environment variable names (names only).** `DATABASE_URL`, `AUTH_SECRET`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `ENCRYPTION_KEY`, `META_APP_SECRET`, `FLOWS_PRIVATE_KEY`, `AUTOMATION_CRON_SECRET`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `AUDIT_HEAD_TOKEN`, `AUDIT_PUBLIC_KEY`, `APP_ENV`. Other names exist in the code.

## 3. How it connects to WhatsApp

**Method: the official WhatsApp Business Cloud API from Meta, called directly.**

- All WhatsApp sending goes to Meta's own address, `graph.facebook.com/v21.0` (`src/lib/whatsapp/meta-api.ts`).
- A search of `src` and `package.json` found no use of `whatsapp-web.js`, Baileys, venom or wppconnect.
- `twilio` is listed in `package.json`, but WhatsApp messages do not go through it. **UNSURE:** what it is used for, if anything.
- A business connects its number through Meta's sign-up flow (`src/app/api/meta/embedded-signup/route.ts`). One account can hold more than one WhatsApp number (`src/app/api/whatsapp/config/set-default/route.ts`).

### What it can do

| Capability | Status | Notes and evidence |
|---|---|---|
| Send to one person | WORKING NOW | `src/app/api/whatsapp/send/route.ts` |
| Send to a WhatsApp group | **NOT POSSIBLE** | Sends use `recipient_type: 'individual'` (`meta-api.ts`). No group code was found |
| Send in bulk | WORKING NOW | Broadcasts: `src/app/api/broadcasts/route.ts`, `src/lib/broadcasts/run-broadcast.ts`. Each person gets a separate message |
| Send template messages | WORKING NOW | `sendTemplateMessage` in `meta-api.ts`. Templates can be submitted to Meta and synced from inside the app (`src/app/api/whatsapp/templates/`) |
| Send documents, PDFs, images, video | WORKING NOW | `sendMediaMessage` in `meta-api.ts`. A template can carry a document at the top (`template-send-builder.ts`) |
| Send links and link buttons | WORKING NOW | Links in text, and `sendCtaUrlButton` in `meta-api.ts` |
| Receive replies | WORKING NOW | `src/app/api/whatsapp/webhook/route.ts`, with signature checking in `webhook-signature.ts` |
| Track sent, delivered, read, replied | WORKING NOW | Counters on the `Broadcast` model in `prisma/schema.prisma` |
| Schedule messages | WORKING NOW | Broadcasts can be sent once at a set time or repeat. Single chats also have scheduled messages (`src/lib/scheduled-messages/sweep.ts`) |
| Reminders and follow-ups | WORKING NOW | Automatic follow-up broadcasts and event-based sends (`src/lib/broadcasts/auto-sweep.ts`), plus staff follow-ups (`src/app/api/follow-ups/route.ts`) |

### Message templates already set up

The code contains no fixed list of templates. Templates are stored per business and approved by Meta. The app offers an AI template drafting kit by purpose, such as staff alerts and customer utility messages (`src/lib/whatsapp/template-kit.ts`).

**UNSURE:** which templates are approved on ACSTI's number. This is stored on the live server, not in the code. It can be seen on the Templates screen.

### Known limits

| Limit | Details |
|---|---|
| 24-hour window (Meta rule) | Free-form messages can only go to a person who messaged within the last 24 hours. Outside that window only an approved template can be sent. The chat screen code refers to this window (`src/components/inbox/message-composer.tsx`) |
| Template approval (Meta rule) | Each template must be approved by Meta before it can be used |
| Daily sending limit (Meta rule) | Meta sets a limit for each number. The app reads and shows this tier (`messaging_limit_tier` in `meta-api.ts`). **UNSURE:** ACSTI's current tier |
| Limits inside this app | 60 single sends per minute. 60 API writes and 120 API reads per minute. 20 new broadcasts per minute (`src/lib/rate-limit.ts`). 10,000 rows per contact import or Excel list (`src/lib/contacts/csv-import.ts`) |
| File size | App uploads are limited to 16 MB (`src/app/api/upload/route.ts`). WhatsApp images are limited to 5 MB (`AGENTS.md`) |
| Risk of the number being banned | Lower than with unofficial tools, because this is Meta's official route. Meta can still lower the rating or limit a number if many people block or report it |
| Cost per message | Charged by Meta and not calculated in this code. See section 9 |

## 4. Features

| Feature | Status | What it does |
|---|---|---|
| Shared chat inbox | WORKING NOW | Staff read and answer all conversations in one place, with assignment to staff |
| Contacts | WORKING NOW | Contact records with tags, custom fields, notes, duplicate merge and archive |
| Contact lists | WORKING NOW | Named lists of contacts, usable as a broadcast audience |
| Segments | WORKING NOW | Saved groups of contacts based on conditions |
| WhatsApp groups | **NOT BUILT** | No feature exists. "Lists" are not WhatsApp groups |
| Campaigns (broadcasts) | WORKING NOW | Bulk template messages to all contacts, tags, a list, an Excel file or a data table. Can be scheduled, repeated or followed up automatically |
| Message templates | WORKING NOW | Create, submit to Meta, sync and draft with AI |
| Chatbot builder | WORKING NOW | Drag-and-drop conversation flows with buttons, questions, conditions and AI steps |
| WhatsApp Flows | WORKING NOW | Forms that open inside WhatsApp |
| Automations | WORKING NOW | Rules that act on events such as a tag being added |
| AI assistant | WORKING NOW | Replies from the business's own knowledge, can take registrations and hand over to staff. Needs an AI provider key |
| AI quality tools | WORKING NOW | Test cases, accuracy rules and a record of the sources behind each AI reply |
| Data Store | WORKING NOW | Custom tables, similar to a simple spreadsheet database |
| Public forms | WORKING NOW | Shareable registration forms with branding, languages, consent box and several people per form |
| Check details | WORKING NOW | Sends each person a private link to check and correct their row in a Google Sheet |
| Google connections | WORKING NOW | Sheets, Gmail, Calendar, Drive, Contacts and Forms. Each must be enabled by the business |
| Leads and follow-ups | WORKING NOW | Lead records, claiming, routing to staff, follow-ups and call outcomes |
| Pipelines and tasks | WORKING NOW | Sales stages, deals and staff tasks |
| Other channels | WORKING NOW | Email, SMS, Instagram, Facebook Messenger, Telegram and website chat. Each needs its own setup |
| Calls | PARTLY WORKING | Call history and routing *(project notes)*. Live call audio needs a separate media component (`src/lib/whatsapp/calling-api.ts`). **UNSURE:** whether calls can be fully answered today |
| RCS messaging | **UNSURE** | Code exists (`src/lib/messaging/channels/rcs.ts`). Live use not confirmed |
| Instagram comment-to-message | IN PROGRESS | Built but waiting on Meta app review *(project notes)* |
| Payments and catalogue | WORKING NOW | Product catalogue, orders, and Razorpay and PhonePe payment links. Each needs setup |
| Meta Ads | WORKING NOW | Lead form import and custom audiences |
| Reports | **IN PROGRESS** | The Reports page is deliberately empty while it is rebuilt (`src/app/(dashboard)/reports/page.tsx`). The old reports were removed on 2 November 2026 |
| Dashboard analytics | WORKING NOW | Dashboard and staff performance figures (`src/app/api/dashboard/`) |
| Users and roles | WORKING NOW | Owner, admin, supervisor, agent and viewer roles, with access per screen (`src/lib/auth/roles.ts`) |
| Opt-in and opt-out | WORKING NOW | Records consent. STOP and START messages and Meta's stop button are honoured by campaigns (`src/lib/broadcasts/opt-out.ts`) |
| Audit log | WORKING NOW | Tamper-evident record of who did what, visible to admins (`src/lib/audit/`) |
| Off-server audit copy | IN PROGRESS | Code is finished. Must still be set up on each server (`docs/deploy/audit-setup.md`) |
| Admin chat | WORKING NOW | Admins can query the system over WhatsApp or Telegram after a code check *(project notes)* |
| Encrypted backup to cloud storage | PLANNED | Proposed on 3 November 2026. Not built |
| Printable PDF for WhatsApp, public lookup by reference | PLANNED | Listed as unbuilt *(project notes)* |
| AI administrator assistant, AI report writing | PLANNED | Paused until the owner decides *(project notes)* |

## 5. Connecting an outside system

**Yes, it has an API, with one important gap.** The closest thing to "send a message to this number" requires an existing conversation.

### How an outside system signs in

- **API key:** sent as a bearer token in the `Authorization` header. Only the account owner can create one (`src/app/api/api-keys/route.ts`). A key acts at supervisor level, so it cannot change admin settings (`src/lib/auth/account.ts`).
- **Other methods** are noted in the table below.

### Endpoints an outside system can use today

| Method and path | Purpose | Main fields | Sign-in type |
|---|---|---|---|
| `POST /api/broadcasts` | Create a bulk or scheduled send. **This is the best route today** | `name`, `template_name`, `audience` (types include `csv`, `list`, `table`, `tags`), optional `header_media_url`, `schedule_type`, `scheduled_at`, `send_window` | API key |
| `POST /api/broadcasts/{id}/process` | Start or continue sending a broadcast | Broadcast id in the path | API key |
| `GET /api/broadcasts`, `GET /api/broadcasts/{id}` | Check broadcasts and their counts | None | API key |
| `POST /api/whatsapp/send` | Send text, media or a template in one chat | `conversation_id`, `message_type`, then `content_text`, `media_url`, `media_filename`, `template_name`, `template_language`, `template_params` as needed | API key |
| `POST /api/whatsapp/validate-contacts` | Check numbers | Numbers to check | API key |
| `GET`, `POST /api/contacts` | Read or add contacts | `phone`, `name`, `email`, `company` | API key |
| `GET`, `POST /api/contact-lists` | Read or create lists | `name`, `description` | API key |
| `GET`, `POST /api/data-tables/{id}/records` | Read or add rows in a Data Store table | `data` | API key |
| `PUT`, `DELETE /api/data-tables/{id}/records/{recordId}` | Change or remove a row | `data` | API key |
| `POST /api/integrations/{id}/ingest` | Push data in, one object or an array | The data itself | API key |
| `POST /api/external/webhook` | Add or update a contact and lead from outside | `external_id`, `contact`, `lead` | Secret value in the web address |
| `POST /api/mcp` | Read-only queries for AI assistants: search contacts, list leads and conversations | Standard MCP request | API key |

### Sending information out to another system

A business can register outgoing webhooks that notify another system when a Data Store row is created, updated or deleted (`src/lib/webhooks/deliver.ts`). This is how the training system could learn about new registrations. Registering a webhook needs a logged-in user, not an API key.

### Gaps an integrating team must know

1. **No direct "send to a phone number" endpoint.** `POST /api/whatsapp/send` needs a `conversation_id`. The route that starts a new chat from a number (`src/app/api/conversations/new-chat/route.ts`) accepts logged-in users only, not API keys.
2. **File upload needs a logged-in user.** `src/app/api/upload/route.ts` does not accept an API key. An outside system should give a public `https` link to its PDF instead. Broadcasts accept this in `header_media_url` (`src/lib/broadcasts/header-media.ts`).
3. **A key cannot be limited to certain actions.** A key has the same reach for everything it can do.
4. **The external webhook carries its secret in the web address.** Web addresses can appear in server logs, so an API key is the safer route.

### Smallest change to close the gap (not implemented)

Add one endpoint, for example `POST /api/external/send`, accepting an API key with a phone number, template name, values and an optional document link. It would find or create the contact and conversation, then use the existing send code. It should also accept a unique request id so a repeated call cannot send twice.

### Data coming in from outside

- **Contacts:** Excel or CSV import on screen (`src/app/api/contacts/import/route.ts`), or the API above.
- **Data Store tables:** file import on screen (`src/app/api/data-tables/[id]/import/route.ts`), from a Google Sheet (`src/app/api/data-tables/from-sheet/route.ts`), or the API above.
- **Google Sheets and Forms:** connected and synced (`src/lib/google/`).

## 6. Data and privacy

### Personal data stored (field names only)

| Where | Fields |
|---|---|
| Contacts | `phone`, `alternate_phone`, `name`, `email`, `company`, `gender`, `age`, `address`, `avatar_url`, `external_id`, platform ids |
| Conversations and messages | Message text, media files, delivery status |
| Leads | `title`, `source`, `status`, `district`, `place`, `notes`, `closing_remarks` |
| Data Store and forms | `data`: whatever fields the business defines |
| Staff users | `email`, `password_hash`, `mfa_phone`, `totp_secret`, `last_seen_at` |
| Audit log | Who acted, action, record id, changed field names, IP address, browser details |

All of this is held in the PostgreSQL database and upload folder on the customer's own server. Message content and some details also pass through Meta. Text sent to the AI provider leaves the server, depending on which provider is configured.

### Sensitive data to review

- Registration data may include **bank account numbers and Aadhaar**, depending on the form. By the owner's decision, bank account numbers are stored in full and shown masked in chat. Aadhaar numbers read from images are reduced to the last four digits *(project notes)*.
- **UNSURE:** whether Data Store rows are encrypted inside the database. Connection secrets are encrypted with AES-256-GCM (`src/lib/whatsapp/encryption.ts`), but this review did not find the same for Data Store rows. This should be reviewed for official use.
- Rules exist to keep people's data away from the customer-facing AI and to hide ID and bank columns in the Check details feature (`src/lib/verify/sheet-verify.ts`).

### Consent

- Each contact has `opt_in_status`, `opt_in_source`, `opt_in_at` and `opted_out_at` (`prisma/schema.prisma`).
- People who opted out are skipped when a campaign sends (`src/lib/broadcasts/send-skip.ts`). Replies to their own questions still work.
- Public forms have a consent box (`src/components/data/public-form-view.tsx`).
- A code comment on the `Contact` model says opt-out is "not built yet", but `src/lib/broadcasts/opt-out.ts` shows that it is. The comment is out of date.

### Backups

- A nightly backup script exists and keeps 14 days on the same server (`scripts/backup-db.sh`). **UNSURE:** whether its nightly schedule is installed on each server.
- Each code update takes a database backup first (`docs/deploy/code-update.sh`).
- **There is no off-server database backup yet.** If the server's disk is lost, same-disk backups are lost with it.
- Only the server owner can download a whole-database backup from the app (`src/app/api/database/backup/route.ts`).

### Login security

- Passwords are stored hashed with bcrypt (`src/auth.ts`).
- Two-step login is available by code or authenticator app (`src/lib/auth/mfa.ts`, `totp.ts`).
- Automatic logout when idle, a list of signed-in devices and sign-out everywhere (`src/lib/auth/session-guard.ts`, `device-session.ts`).
- Removed staff are switched off, not deleted, so business records stay intact (`src/lib/auth/deactivate-member.ts`).
- Every account's data is kept separate by `account_id`, and a code test requires new routes that change data to be logged or to have a stated exemption (`src/lib/audit/coverage.test.ts`).

## 7. Progress

| Measure | Count |
|---|---|
| Screens (pages) | 46 |
| API routes | 337 |
| Database tables | 110 modelled in Prisma, plus a few created directly in SQL |
| Database change files (migrations) | 157 |
| Automated test files | 346 |
| Git commits | 504 |
| First commit | 13 June 2026 |
| Latest commit | 3 November 2026 |

**Test result on 3 November 2026:** 343 of 345 test files that ran passed on the developer's Windows machine. The two failures relate to Windows file handling (a filename the system cannot create, and a file-permission check). They were not run on Linux in this review.

### Unfinished

- Reports screen is empty and awaiting a new design.
- Off-server audit copy, and the database permission change that protects the audit log, are not yet set up on the servers.
- No off-server database backup.
- Dark mode: the setting saves a choice but does not change the screens.
- Instagram comment-to-message is waiting on Meta review *(project notes)*.
- Editing a group of form registrations together is not built *(project notes)*.

## 8. Use in ACSTI training programmes

### 8.1 What the CRM does for ACSTI training today

The code is generic. It does not contain ACSTI-specific logic, so this describes how ACSTI uses general features. The items marked *(project notes)* come from the developer's notes and `ACSTI-system-prompt.md`, not from the live server.

| Activity | How it works | Evidence |
|---|---|---|
| Answering enquiries about programmes | The AI assistant answers on WhatsApp about dates, fees, seats and eligibility from the institute's own knowledge and tables, and is told never to invent these | `ACSTI-system-prompt.md`, `src/lib/ai/` |
| Registering a participant in chat | The assistant asks for the required details and saves the registration | `src/lib/ai/registration-tools.ts` |
| Registering from a photo or PDF | A person sends a nomination or a document. The assistant reads it, shows a summary and asks Yes or No before saving | `src/lib/ai/registration-draft.ts` |
| Public registration form | A shareable form where the training programme chosen fills related details such as dates. One society can register several participants in one submission | `src/components/data/public-form-view.tsx` *(project notes)* |
| Keeping the training sheet up to date | Registrations can be routed to the institute's Google Sheet | `src/lib/google/sheet-routing.ts` |
| "Check my registration" | A person can ask on WhatsApp, and the system looks up rows matching their own number | `src/lib/ai/registration-lookup.ts` |
| Checking participant details | Each participant gets a private link to confirm or correct their details, and changes go back to the sheet | `/data/verify`, `src/lib/verify/sheet-verify.ts` |
| Alerting staff | Staff are alerted about new registrations, and people needing help are handed to staff | `src/lib/data-store/record-events.ts`, `src/lib/ai/handover-consent.ts` |
| Training email | The training mailbox can be connected so email appears in the same inbox | `src/lib/email/` *(project notes)* |
| Bulk messages about programmes | Approved templates can go to lists, Excel files or registration tables | `src/lib/broadcasts/` |

**Not in the CRM today:** a search of the code for timetable, attendance, certificate and honorarium found no feature for them. It has no entry or exit tests either.

**UNSURE:** which of these are switched on at ACSTI today, how many registrations have gone through them, and the exact table and template names. This is stored on the live server. The Settings, Data Store and Templates screens will show it.

### 8.2 The six proposed uses

Every item below that starts a conversation needs a template approved by Meta. All sends go to individuals, each in their own chat.

| Use | Answer | What it takes |
|---|---|---|
| a) Timetable PDF to all participants of a batch | **Possible now** | A broadcast with a template that has a document at the top, sent to a list or Excel file of the batch. Goes to each person, not to a group |
| b) Test link to a batch group at a set time | **To a group: not possible. To each person: possible now** | A scheduled broadcast to the batch. Sending to a real WhatsApp group would need new development, and is **UNSURE** on Meta's side |
| c) Class reminder to guest faculty the day before | **Possible now by hand. Automatic needs a small change or integration** | Staff can schedule it. Automatic: the training system creates a scheduled broadcast through `POST /api/broadcasts` for each class |
| d) Certificate number and verification link to each participant | **Possible now, with setup** | A data table with phone, certificate number and link, sent with a template that uses those values (`run-broadcast.ts`). The verification page must come from the training system. **UNSURE:** not tested end to end for this use |
| e) Class video link after each session | **Possible now by hand. Automatic needs integration** | A broadcast per session, or the training system creates it through the API |
| f) Registration details or attendance replies | **Registration: possible now. Attendance: needs a small setup** | Registration is covered in 8.1. Attendance can be collected with a chatbot and buttons saving to a Data Store table. No attendance report exists |

**What the training system would add:** the smallest useful connection is the training system calling `POST /api/broadcasts` for sends and receiving outgoing webhooks for new registrations. The endpoint in section 5 would make single sends simpler.

## 9. Risks and requirements for official office use

Costs below are not from the code. They must be confirmed with each provider before use in a budget.

| Area | What is needed or at risk |
|---|---|
| Meta charges | Meta charges for template messages by category and country. Bulk reminders and notices would incur this. Confirm current rates on Meta's pricing page |
| Meta business verification | Needed for higher sending limits. **UNSURE:** ACSTI's current verification status |
| Phone number | A dedicated number registered to WhatsApp Business. Moving a number to or from another WhatsApp setup needs planning |
| Message rating | If many people block or report messages, Meta can limit the number. Consent lists and useful content reduce this |
| Internet | The server is in the cloud, so office staff need internet access. Messages received while the server is down depend on Meta's retries |
| Server cost and size | A monthly VPS fee. The ACSTI server has limited memory (about 2 GB, *project notes*), which constrains builds and growth |
| AI cost | Each AI reply uses a paid provider key. Usage is recorded (`AiUsageEvent` model) |
| Off-server protection | Off-server backup and off-server audit copy are not yet in place. **This should be done before official use is relied upon** |
| Sensitive data | Bank and ID details need a retention rule and a data protection review under India's DPDP Act. Backups contain the same data |
| Maintenance | Updates are run by hand on each server by the developer. Project notes suggest this depends heavily on one person. A support arrangement and written handover are advisable |
| API key handling | A key has wide reach, so it must be stored securely by the training system, and replaced if exposed |
| Source code visibility | **UNSURE:** project notes list making the code repository private as an open item. Check this before official use |
