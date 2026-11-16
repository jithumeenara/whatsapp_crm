# Plan: Facebook Messenger + Instagram, fully working (Meta rules Nov 2026)

Status: **plan only — nothing built.** Written 2026-11-16 from three
investigations: a full read of this repo's Messenger/Instagram code, and
two reads of Meta's official documentation (Messenger Platform, Instagram
Platform, Facebook Login for Business, Graph API changelogs). Supersedes
`instagram-full-connect-plan.md`. Works for any business, any industry.

Goal set by the owner: **a customer connects in one click with no
technical knowledge**, and a token paste stays available for technical
users. Every Messenger and Instagram feature Meta offers a CRM works.

---

## 1. Meta's rules that shape the plan (official, Nov 2026)

**Connect**
- Meta's recommended login for business tools: **Facebook Login for
  Business** (Business app, `config_id` instead of `scope`,
  `response_type=code`, `override_default_response_type=true`).
- It returns a **Business Integration System User token** that "defaults
  to never expire", belongs to the client's business portfolio and survives
  the person who logged in leaving. It stops if the client removes the app
  or moves the account — then they reconnect.
- **Instagram:** Meta lists three setups. "Instagram API with Unified Login"
  is "recommended for new integrations"; "New Instagram API features are
  released only for this setup"; **"New apps can't set up the Instagram API
  with Instagram Login."** Unified Login runs on `graph.facebook.com`,
  needs no Facebook Page (a business portfolio instead) and finds accounts
  with `GET /me/assigned_instagram_accounts`. Its account `id` equals the
  Instagram Login `user_id` = the webhook `entry.id`.
- **Messenger** permissions: `pages_show_list`, `pages_manage_metadata`,
  `pages_messaging`, `pages_read_engagement`, `business_management`
  (+ `pages_read_user_content`, `pages_manage_engagement` for comments,
  `read_insights` for insights, `leads_retrieval` for Lead Ads).
- **Instagram (Unified)** permissions: `instagram_basic`,
  `instagram_manage_messages` (required), `instagram_manage_comments`,
  `instagram_content_publish`, `instagram_manage_insights`.
- Other businesses can connect only after **Advanced Access** (App Review)
  and **business verification**. Until then only people with a role on the
  app (Instagram Testers) work. Real accounts only — test users are not
  supported for Instagram.

**API versions**
- Latest **v27.0** (4 Nov 2026). **v21.0 — every messaging call in this CRM —
  is removed on 21 Jan 2027.** v22.0 goes on 20 May 2027.

**Messaging policy**
- 24-hour window; conversations started from Click-to-Messenger /
  Click-to-Instagram ads: up to 7 days (thread control up to 30 days).
- **HUMAN_AGENT** tag: a person may reply up to 7 days (needs the Human
  Agent feature in App Review + business verification).
- Tags `CONFIRMED_EVENT_UPDATE`, `ACCOUNT_UPDATE`, `POST_PURCHASE_UPDATE`
  are gone (error 100 since 27 Apr 2026). Replacement on Messenger:
  **Utility templates** (`messaging_type=UTILITY`, approved in seconds).
- Messenger promotions outside the window: the paid **Marketing Messages
  API** (1 per person per Page per day, opt-in, India supported). Recurring
  Notifications and Sponsored Messages are discontinued.
- **Private replies** to a comment: within 7 days, one per commenter.
- Handover Protocol ended (Instagram 23 Oct 2025; Messenger migrated):
  **Conversation Routing**. When Meta Business AI owns a thread, the CRM
  gets `standby` and must not reply until `pass_thread_control`.

**Webhooks**
- Subscribe each Page / Instagram account with
  `POST /{id}/subscribed_apps?subscribed_fields=…`.
- Messenger fields: messages, message_echoes, message_reactions,
  message_reads, message_deliveries, message_edits, messaging_postbacks,
  messaging_referrals, messaging_optins, messaging_handovers, standby,
  feed (comments), leadgen.
- Instagram fields: messages, message_reactions, message_edit,
  messaging_postbacks, messaging_referral, messaging_seen, comments,
  live_comments, mentions, story_insights.
- Signed `X-Hub-Signature-256` with the **Meta app secret**. Meta retries
  for up to 36 hours and may resend — **de-duplicate**. After 1 hour of
  failures Meta disables the webhook.
- Comments arrive only for public accounts; the Instagram user must turn on
  **"Allow access to messages"** or sends fail with error #200.

**Features available**
- Send: text, images (Messenger 30 / Instagram 10 per message), audio,
  video, files/PDF, quick replies (IG max 13), button / generic / media
  templates, `reply_to`, reactions (react/unreact), typing, mark_seen,
  personas (Messenger), ice breakers (max 4), persistent menu, get started,
  greeting, Messenger calling.
- Comments: read, reply, hide/unhide, delete, turn comments on/off
  (IG and FB Page); Instagram Like API and media delete are Facebook-Login
  only.
- Instagram publishing: posts, reels, stories, carousels (up to 20), limit
  read from `content_publishing_limit`, status polling, collaborators,
  trial reels.
- Insights: Instagram `views, reach, accounts_engaged, total_interactions,
  follows_and_unfollows, profile_links_taps, follower_demographics …`;
  removed: `impressions, plays, video_views`. Facebook Page impression
  metrics removed by 15 Jun 2026 → `page_media_view`,
  `post_media_view`, `page_total_media_view_unique`.
- Followers: **count and demographics only — Meta offers no follower list.**

---

## 2. What the CRM does today (code read, HEAD e83ac4c)

Works: manual token paste for both; Instagram DMs in and out (only with an
Instagram Login `IGAA` token); Messenger DMs in and agent replies out;
Instagram bot/AI/flows; ice breakers; Lead Ads; ad attribution.

**Broken or missing (ranked):**
1. **Messenger bot, AI and automation sends do not exist** — `meta-send.ts`
   has no Facebook branch, so they fall into the WhatsApp path and fail.
   Messenger messages never fire Automations.
2. **Any `EAA` token on Instagram cannot send** (Embedded Signup, Page
   token, System User, Unified Login): every Instagram send is hardwired
   to `graph.instagram.com`. Embedded Signup creates exactly this state.
3. **Instagram Test Connection saves the wrong ID** (`/me` `id` instead of
   `user_id`), so real DMs can be dropped as "no config found".
4. **Duplicate messages:** no unique index on message id, so Meta's
   resends create duplicate messages and duplicate AI replies.
5. No one-click connect for Messenger/Instagram, no token refresh, no
   automatic webhook subscription; Embedded Signup takes the first Page
   blindly and skips the cross-workspace check.
6. Facebook Test Connection reports success for almost any error.
7. No 24-hour window check on the server, no HUMAN_AGENT tag; the composer
   greys out with no explanation.
8. Contact merge fails when an Instagram/Messenger contact is involved;
   sends use `contact.phone` instead of the Instagram/Messenger id.
9. Comment-to-DM cannot work even after approval (no private reply; may
   pick a WhatsApp chat).
10. Deprecated insight metrics → zeros (IG `video_views`; FB
    `post_impressions`, `post_engaged_users`).
11. Not handled: echoes (replies typed in the Instagram/Messenger app never
    reach the Inbox), reactions, edits, deletes, standby / Business AI,
    multi-image, comments inbox, publishing, account insights.
12. ~35 hardcoded `v21.0` messaging calls with no shared constant.
13. No tests for either webhook's POST handling, the send handlers, or
    token/host selection.

---

## 3. The plan (each phase: tests first, full suite, browser check, one commit, deploy)

### Phase 0 — Fix what is broken (no Meta approval needed) · 2–3 sessions
- Messenger sends for bot / AI / flows / automations (a Facebook branch
  everywhere Instagram has one); Messenger messages fire Automations; the
  chatbot builder warns about nodes Messenger cannot show.
- Instagram picks the host by token type (`IGAA` → graph.instagram.com,
  `EAA` → graph.facebook.com/{ig-id}); IDs taken from the token
  (`user_id` / `assigned_instagram_accounts`), never typed.
- De-duplicate on Meta's message id (check first + unique index, after
  checking existing rows on a copy of production).
- Sends use the Instagram/Messenger id; contact merge clears platform ids
  first.
- Facebook Test Connection really checks the Page; real Page name.
- 24-hour window enforced on the server with a clear banner ("This chat is
  closed — the customer must write first" / "Reply as agent within 7 days").
- Insights switched to current metrics.
- Echoes: replies sent from the phone apps appear in the Inbox.

### Phase 1 — API version v27 · 1 session · **deadline 21 Jan 2027**
One shared version constant for every Meta call; move all messaging calls
to v27.0; check payload changes (message id format, share → ig_post).

### Phase 2 — One-click connect (both channels) · 2–3 sessions
- **"Connect Facebook & Instagram"** button → Meta's own window (Facebook
  Login for Business with our `config_id`) → the customer ticks their Page
  and/or Instagram account → done.
- The CRM then, by itself: exchanges the code for the never-expiring token
  (sealed), lists Pages and Instagram accounts and lets the customer pick
  if they have several, refuses an account another workspace holds,
  subscribes every webhook field above, runs a health check and shows
  **what works** ("Messages ✓ Comments ✓ Insights ✓ Publishing — needs
  Meta approval") and **what to do** in plain words (e.g. "Turn on Allow
  access to messages in the Instagram app").
- Daily health sweep; if a token stops (app removed, account moved) the
  owner gets an alert and a **Reconnect** button.
- **Token paste stays** (advanced): any token type, auto-detected; IDs found
  from the token; Instagram app secret field for own-app setups.
- Existing pasted tokens keep working. Embedded Signup's Page step fixed.

### Phase 3 — Complete Inbox for both channels · 2 sessions
Reactions (send/receive), edits, deletes, `reply_to`, multi-image, typing
and seen, story replies and story mentions, quick replies and generic
templates in the bot builder for both channels, Messenger profile (get
started, greeting, ice breakers, persistent menu) beside Instagram's,
Conversation Routing: respect `standby` / Business AI, show
`handoff_reason`, HUMAN_AGENT 7-day replies once approved.

### Phase 4 — Comments (Instagram + Facebook Page) · 2 sessions
One Comments view: every post's comments live from webhooks; reply,
**private reply by DM** (7 days, once), hide/unhide, delete, turn comments
off on a post, reply to mentions, AI-suggested reply, assign, "make lead".
Comment-to-DM automation rebuilt on private replies (switched on when Meta
approves `instagram_manage_comments`).

### Phase 5 — Profile, followers, insights · 1–2 sessions
Instagram: profile card, daily follower snapshots → growth chart,
account insights (7/30/90 days), audience age / gender / cities, post and
reel insights, story insights from the webhook. Facebook Page: followers,
new media-view metrics, post insights. Clear note: follower *names* are not
available from Meta.

### Phase 6 — Publishing and scheduling · 2 sessions
Instagram post / reel / story / carousel (up to 20) and Facebook Page
posts from the file manager; publish now or schedule; calendar; Meta's
live publishing limit shown; status polling; collaborators.

### Phase 7 — Messenger outside the 24 hours · 1–2 sessions
Utility templates (replace the old tags: confirmations, reminders,
updates); Marketing Messages API for opt-in Messenger broadcasts (paid,
1/day/person); import recent conversation history (Conversations API);
personas. Messenger calling later.

Total: about 13–17 working sessions. Phases 0 and 1 first — they fix real
breakage and beat the 21 Jan 2027 deadline.

---

## 4. Meta-side checklist (what the owner does once)
1. A Meta **Business** app owned by our business portfolio, use cases
   "Engage with customers on Messenger" and "Manage messaging & content on
   Instagram", product **Facebook Login for Business**; one configuration
   (system-user token, never expire) → `config_id`.
2. Redirect URL and webhook URL (HTTPS) for the Page and Instagram objects.
3. **Business verification** of our portfolio.
4. **App Review** for each permission + the Human Agent feature, with
   screen recordings of the CRM using them (bot replies within 30 s, inbox
   send/reply/delete, comments, publishing, insights).
5. Until approved: customers' accounts added as Testers for pilot use.

## 5. Security (all phases)
Owner-only connect/disconnect; signed `state`; tokens sealed, never sent to
the browser; `appsecret_proof` on token-management calls; webhook signature
verified; every read/write scoped by `account_id`; one workspace per
Page/Instagram account; rate limits on sends, publishing and AI replies;
audit entries for connect, disconnect, publish, delete, hide.

## 6. Decisions needed before building
1. **One Meta app for every customer** (we pass App Review once; easiest for
   customers) or each customer's own app? *Suggested: one app — fits the
   super-admin plan; per-VPS servers use the same app id.*
2. Phase order: suggested 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7.
3. Should the AI ever answer **comments** by itself, or only suggest?
4. Marketing Messages (paid Messenger broadcasts): needed, or skip?

## 7. Decisions (owner, 2026-11-16)
- This becomes a SaaS product. **For now** ACSTI Kerala and SP Fort each use
  their **own verified business portfolio and Meta app**; app id, app secret
  and `config_id` are read per server/workspace from Settings, never hardcoded.
  After company registration (GST/PAN → business verification) one shared
  Meta app replaces them by changing those settings only.
- Customer easy connect must work; token paste stays.
- Build **all phases**, in order 0 → 7.
- AI on comments: **suggest only** (no automatic public replies).
- Marketing Messages (paid Messenger broadcasts): built behind a setting, off by default.
