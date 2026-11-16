# Plan: Instagram, fully connected

Status: **research + plan only — nothing built.** Written 2026-11-16.
Checked against Meta's own pages that day: Instagram Platform changelog
(newest entry 30 Jul 2026), Instagram Messaging changelog (updated 28 Oct
2026), "Instagram API with Instagram Login" overview and "Business Login
for Instagram". Works for any business with an Instagram professional
(Business or Creator) account.

## 1. What Meta allows today (facts)

### Update (checked again 2026-11-16): Meta now lists THREE setups
From Meta's Instagram Platform overview:
| Setup | Meta says | Login | Token | Host | Facebook Page |
|---|---|---|---|---|---|
| **Instagram API with Unified Login** | **"recommended for new integrations"** | Instagram or Facebook credentials, through Facebook Login for Business | Business Integration System User token — "defaults to never expire" (60-day option exists) | graph.facebook.com | Not required (business portfolio required) |
| Instagram API with Instagram Login | for "existing Instagram Login integrations" | Business Login for Instagram | Instagram user token, 60 days, refreshable | graph.instagram.com | Not required |
| Instagram API with Facebook Login | for "existing Page-linked integrations" | Facebook | User or Page token | graph.facebook.com | Required |

Unified Login uses the `instagram_*` permissions (`instagram_basic`,
`instagram_manage_messages`, `instagram_manage_comments`,
`instagram_content_publish`, `instagram_manage_insights`,
`instagram_manage_contents`, `instagram_manage_engagement`) and supports
hashtag search, product tagging and partnership ads. For system-user
configurations Facebook Login for Business uses a `config_id` instead of
`scope`, `response_type=code` and `override_default_response_type=true`.
Meta's pages give **no retirement date** for the other two setups.
Developer reports (not Meta) say Meta apps created since late Oct 2026 can
only use Unified Login.

**Revised recommendation:** Phase 1 connects with **Unified Login** (one
button, no Page, never-expiring token, all features). Tokens already pasted
today keep working: the CRM picks the host by token type
(Instagram-login tokens → graph.instagram.com, the rest → graph.facebook.com),
so a Business Manager **System User token** also works.

### Two ways in (original section)
| | Instagram Login (Business Login) | Facebook Login |
|---|---|---|
| Needs a Facebook Page | No | Yes |
| Messages, comments, mentions, publishing, insights | Yes | Yes |
| Ads, product tagging | **No** | Yes |
| saved_count, shares_count, reposts_count (Apr 2026) | No | Yes |
| Story `link_clicks` (Jun 2026), Audio API | No | Yes |

**Recommendation:** Instagram Login for everything a business needs day to
day (no Page required, simpler for the customer). Facebook Login only later,
if someone needs ads data or the share/save counts.

### Permissions (Instagram Login)
- `instagram_business_basic` — profile, media, followers count
- `instagram_business_manage_messages` — DMs
- `instagram_business_manage_comments` — read/reply/hide/delete comments, mentions
- `instagram_business_content_publish` — publish posts, reels, stories, carousels
- Insights — Meta says media insights are available with Instagram Login (the
  scope name is not printed on those pages; confirm in the App Dashboard)
- `instagram_manage_engagement` — **new (Apr 2026)**: like media and comments
- `instagram_manage_contents` — **new (Dec 2025)**: delete a post/reel/story
- The old `business_*` scope names stopped working on 27 Jan 2025.

Serving other businesses' accounts needs **Advanced Access** for each
permission (Meta App Review + business verification). Accounts the app owner
manages work with Standard Access for testing.

### Connect flow (Business Login)
1. Send the owner to `https://www.instagram.com/oauth/authorize` with
   `client_id, redirect_uri, response_type=code, scope, state`.
2. The code (valid 1 hour, once) → POST `https://api.instagram.com/oauth/access_token`
   → short-lived token + `user_id` + granted permissions.
3. → GET `https://graph.instagram.com/access_token?grant_type=ig_exchange_token`
   → **long-lived token, 60 days** (server side only).
4. Refresh with `grant_type=ig_refresh_token` once the token is 24 h old and
   before it expires; each refresh gives 60 more days. A token left 60 days
   unrefreshed dies and the owner must connect again.
5. Subscribe the account to webhooks (`POST /me/subscribed_apps` with the
   fields below).

### Webhook fields
`messages`, `messaging_postbacks`, `messaging_seen`, `message_reactions`,
`message_edit` (Sep 2025), `comments`, `live_comments`, `mentions`,
`story_insights` (sent 1 hour after a story expires). Comments and mentions
arrive only for **public** accounts, and comments need Advanced Access.

### Followers — the important limit
Meta gives the **number** of followers (`followers_count`, `follows_count`)
and follower **demographics** (age, gender, city, country) — **never the list
of follower names.** No official API returns that list; scraping tools break
Instagram's terms and can get the account banned. So the CRM shows follower
count, daily growth and demographics, and turns people who *interact*
(comment, DM, mention, story reply) into contacts.

### Recent changes that matter
- Insights: `impressions`, `plays`, `video_views` removed (2024–25); **`views`
  is the main metric** now. Dec 2025 added `reposts`, `reels_skip_rate`,
  `crossposted_views`, `facebook_views`; Apr 2026 added `total_views`,
  `total_likes`, `total_comments`.
- Messaging: send reactions (Dec 2025); typing indicator and mark-seen (Sep
  2025); multi-image messages out of beta (May 2026); Handover Protocol
  replaced by Conversation Routing (Oct 2025); `handoff_reason` (Oct 2026);
  share attachments removed (Feb–Apr 2026).
- Like API (Apr 2026), delete media (Dec 2025), collaboration invites (Dec 2025).

## 2. What the CRM has today

| Feature | Today |
|---|---|
| Connect | **Paste an access token by hand** — no "Connect with Instagram" button, no automatic token refresh (token dies after 60 days) |
| DMs in Inbox | Yes (text, story replies, postbacks), AI and flows |
| Ice breakers, persistent menu | Yes |
| Comments | Webhook received; comment-to-DM automation built but switched off until Meta approval |
| Mentions | Built, switched off until approval |
| Profile + posts | Social page: profile, followers count, posts with likes/comments |
| Insights | Per post: asks for `video_views` — **removed by Meta in Jan 2025**, so video/reel insights likely fail and show 0 (bug) |
| Comments inbox, reply, hide, delete, like | No |
| Publishing / scheduling | No |
| Account insights, follower growth, demographics | No |
| Message reactions, typing, edits, multi-image | No |
| API version | v21.0 everywhere — must move before 21 Jan 2027 |

## 3. Plan (each phase: tests first, full suite, browser check, one commit)

**Phase 1 — One-click connect (foundation).**
"Connect with Instagram" button in Settings → Channels → Instagram (owner
only): Business Login with a signed `state`, server-side token exchange,
long-lived token sealed like the other secrets, granted permissions saved
and shown ("Messages ✓ Comments ✓ Publishing ✗ — needs Meta approval").
Daily sweep refreshes tokens with less than 10 days left; the owner is
alerted if a refresh fails. Webhooks subscribed automatically. Disconnect
button. Manual token paste stays as a fallback. Fix the `video_views` bug.

**Phase 2 — Comments inbox.**
New "Comments" view (Social → Comments): every post's comments and replies,
newest first, live from the webhook (stored in a new table, migration).
Per comment: reply publicly, **reply privately by DM** (Meta allows one
private reply within 7 days), hide/unhide, delete, like, assign to an agent,
AI-suggested reply, "make lead". The commenter becomes a contact (IG id +
username). Filters: unanswered, questions, negative, by post.

**Phase 3 — Profile, followers and insights.**
Profile card (picture, bio, website, followers, following, posts). Daily
follower snapshot → **growth chart** (new follows / unfollows). Account
insights for 7/30/90 days: views, reach, accounts engaged, interactions,
profile link taps, follows and unfollows. **Audience**: age, gender, top
cities and countries. Post insights with the current metrics (views, reach,
likes, comments, saves, shares, interactions; reels skip rate). Story
insights kept from the webhook. Best time to post from the data.

**Phase 4 — Publishing and scheduling.**
Create a post, carousel (up to 10), reel or story from the file manager,
caption with hashtags, publish now or schedule (sweep; respects Meta's
publishing limit per 24 h and polls the container status). Calendar of
planned and published posts. Delete a published post.

**Phase 5 — Messaging upgrades.**
Send and show reactions, typing indicator and mark-seen, edited-message
updates, several images in one message, human-agent replies up to 7 days
where Meta allows, Conversation Routing and `handoff_reason` handled.

**Phase 6 — Mentions and tags.**
Posts where the business was tagged or @mentioned, with reply; story
mentions into the Inbox (needs approval).

**Phase 7 — API version.** Move Instagram (and the rest of messaging) off
v21.0 before 21 Jan 2027 (part of the Meta messaging move already planned).

Optional later (Facebook Login only): shares/saves counts, hashtag search,
competitor stats (Business Discovery), Instagram ads data.

## 4. What the business must do on Meta's side
1. Instagram account set to **Professional** (Business or Creator) and public.
2. A Meta app with the "Instagram API with Instagram Login" product, the
   CRM's redirect URL and webhook URL added.
3. **App Review** for each permission above (screen recordings of the CRM
   using it) and Meta business verification — needed before other
   businesses' accounts can connect. Until then only accounts added as
   testers on the app work.

## 5. Security
Owner-only connect/disconnect; `state` signed and checked (no CSRF);
tokens sealed at rest, never sent to the browser; webhook signature checked;
every comment/post/insight read scoped by `account_id`; rate limits on
publishing and AI replies; audit log entries for connect, disconnect,
publish, delete, hide.

## 6. Decisions needed
1. Order: suggested 1 → 2 → 3, then 4–6. Different order?
2. Publishing (phase 4): needed now, or later?
3. Comments: should the AI ever reply to comments by itself, or only suggest?
4. One Meta app for all servers (we pass App Review once) or each business
   its own app? (ties to the deployment / super-admin plan)
