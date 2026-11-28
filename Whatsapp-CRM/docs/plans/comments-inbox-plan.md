# Comments (Instagram + Facebook) — പുതിയ triage screen പ്ലാൻ

തീയതി: 2026-11-28 · നില: **പ്ലാൻ മാത്രം — build ചെയ്തിട്ടില്ല** · എല്ലാ industry-ക്കും

ഗവേഷണം: 2 agents — (1) 17 apps-ന്റെ comment UX (Agorapulse, Sprout, Hootsuite, Statusbrew, NapoleonCat, Emplifi, Sprinklr, Zoho Social, Buffer, ManyChat, Meta Business Suite…), (2) Meta IG/FB API (2026). User തന്ന 2 reference designs: (A) KPI cards + right rail, (B) calm two-pane triage.

---

## 1. ഇപ്പോൾ ഉള്ളത് (d4 build ചെയ്തത്, mig 171–172)
ഒറ്റ column cards; To answer / Done / All; channel select; Reply, Private reply (7 ദിവസം, ഒരിക്കൽ), Done, Make lead (contact ഉണ്ടെങ്കിൽ മാത്രം), Comments off (IG), Hide, Delete, AI Suggest; 30 സെ. poll; comment-to-DM automation trigger ഉണ്ട്.
**ഇല്ല:** post ചിത്രം, commenter username, ad flag, sentiment/intent/ഭാഷ, assign, collision lock, first-response സമയം, search, saved replies, rules, bulk, keyboard.

## 2. Meta നിയമങ്ങൾ (design ഇതനുസരിച്ച് — സത്യസന്ധമായി)
| കാര്യം | കിട്ടുമോ |
|---|---|
| Comment ചെയ്ത ആളുടെ followers, ഫോട്ടോ, സ്ഥലം, "since" | **ഇല്ല** — IG comment-ൽ `from{id, username}` മാത്രം. DM ചെയ്ത ശേഷം മാത്രം IG User Profile API: `name, username, profile_pic, follower_count, is_user_follow_business, is_business_follow_user, is_verified_user` (consent വേണം; pic URL കുറച്ചു ദിവസം മാത്രം). Business/creator accounts-ന് Business Discovery വഴി followers. |
| Messenger (PSID) | DM ചെയ്ത ശേഷം `name, first_name, last_name, profile_pic` (Business Asset User Profile Access); locale/timezone/gender പ്രത്യേക permission. |
| ഒരിക്കലും കിട്ടാത്തത് | phone, email, സ്ഥലം, private ആളുടെ bio/posts/followers, പ്രായം. |
| Post വിവരം | IG: caption, media_url/thumbnail_url (Jul 2026 മുതൽ media_url optional), like_count, comments_count, permalink, is_comment_enabled; insights: views, reach, saved, shares (impressions നീക്കി). FB: message, full_picture, reactions/comments summary, shares; `post_media_view` (post_impressions നീക്കി). |
| Private reply | ഒരു **ആൾക്ക്** ഒന്ന് (comment-ന് അല്ല), 7 ദിവസത്തിനകം. |
| Like a comment | IG: പുതിയ `instagram_manage_engagement` (Apr 2026). |
| Hidden words / Meta keyword filter API | ഇല്ല — നമ്മുടെ rules engine വേണം. |

## 3. ഇപ്പോഴത്തെ code-ൽ കണ്ട bugs (ആദ്യം ശരിയാക്കണം)
1. **IG comments നഷ്ടപ്പെടാം [high]:** `instagram/webhook/route.ts:266` `comment.id` ഇല്ലെങ്കിൽ skip — Facebook-Login payload-ൽ `comment_id` ആണ് (Meta example). യഥാർത്ഥ payload log നോക്കി `id ?? comment_id`.
2. IG Login-ൽ mentions `comments`-ൽ വരുന്നു → നമ്മുടേതല്ലാത്ത post-ൽ hide/delete/comments-off ശ്രമിക്കും.
3. Ad comment വിവരം (`media.ad_id`, `ad_title`, `media_product_type`) വായിക്കുന്നില്ല.
4. Private reply lock comment-ന് — Meta-യുടെ നിയമം ആൾക്ക്.
5. IG comment-ന് timestamp ഇല്ല → retry കഴിഞ്ഞാൽ സമയം തെറ്റ്; 7-ദിവസ check-നെ ബാധിക്കും.
6. Backfill ഇല്ല (disconnect സമയത്തെ comments വരില്ല).
7. Post details ഒരിക്കൽ cache — counts മാറില്ല; ചിത്രം ഇല്ല.

## 4. പുതിയ screen — design (B-യുടെ ശാന്തമായ two-pane + A-യിലെ ശരിയായ data മാത്രം)
DESIGN.md tokens (bg-background, white panels, Inter + Anek Malayalam, sentence case). Serif title / warm off-white ഇല്ല (5 dark themes തകരും).

**1280px:** `grid-cols-[380px_1fr_300px]`
- Header: "Comments" · "Live · 2 channels" (അല്ലെങ്കിൽ "Not connected" + link) · search (`/`).
- KPI strip (7-ദിവസ sparkline, text equivalent): Awaiting reply (ഏറ്റവും പഴയ കാത്തിരിപ്പ്) · Median first response (business hours) · Open questions · Hidden this week (rules n · team n) · (AI on ആണെങ്കിൽ) Negative this week.
- **ഇടത് list:** tabs To answer · Done · Hidden · All (counts); chips Instagram · Facebook · Questions · Ads · Mine · Unassigned; sort Newest / Oldest waiting. Row: avatar, പേര്, ML/EN tag, snippet, "On ‹post›", "?" chip, "Ad" chip, കാത്തിരിപ്പ് സമയം (target-ന്റെ 50% കഴിഞ്ഞാൽ amber, കഴിഞ്ഞാൽ rose), lock ഉള്ള ആളുടെ avatar. Virtualised.
- **നടുവ്:** post card (thumbnail, caption + Full caption, likes/comments, Open post, ഈ post-ലെ എല്ലാ comments) · commenter + "3h waiting" · "02 / 37" · sentiment/intent chips · comment 16px · Translate (ML↔EN) · മുമ്പത്തെ replies ആര് അയച്ചു എന്നതോടെ.
- **Composer:** Public reply / Private message toggle ("1 left · 5 ദിവസം കൂടി"), saved-reply chips രണ്ട് ഭാഷയിലും (Thank you · നന്ദി · Registration · രജിസ്ട്രേഷൻ), Suggest (AI, comment-ന്റെ ഭാഷയിൽ), "Reply as ‹Page›", character counter, "Mark done after sending" (default on), ⌘/Ctrl+Enter.
- **വലത് rail:** commenter card (പേര്, @handle, നമ്മുടെ posts-ൽ എത്ര comments, contact/lead link, Add contact / Make lead — contact ഇല്ലെങ്കിലും), DM ചെയ്തിട്ടുണ്ടെങ്കിൽ മാത്രം followers/verified; AI read card (sentiment, intent, ഭാഷ, confidence, ഒരു വരി കാരണം, "Wrong? Change"); moderation history ("Hidden by rule 'Scam links' · Undo").
- Hide/Delete/Comments off overflow menu-ൽ; Delete/Comments off → useConfirm; Hide → undo toast.

**360px:** list മാത്രം; KPI ഒരു scroll row; chips "Filters" sheet-ൽ; row തൊട്ടാൽ full-screen detail (`?c=<id>`, Back പ്രവർത്തിക്കും); sticky composer (safe-area); Reply · Private · Done 44px; ബാക്കി "More".

**States:** skeleton; "All caught up"; connect checklist; "Couldn't load · Try again"; Meta-യിൽ delete ചെയ്തത് → "Removed on Instagram"; "Anu is replying…" (supervisor-ന് Take over).

**Keyboard** (`?` ലിസ്റ്റ്; Settings-ൽ off ആക്കാം — WCAG 2.1.4): j/k, r, p, e (done → അടുത്തത്), h, l, a, x / shift+x, s, t, /, ⌘Enter, Esc.

## 5. സവിശേഷതകൾ
- **AI read on arrival (opt-in):** sentiment, intent (question, price, registration/lead, complaint, praise, spam, abuse), ഭാഷ (ml/en/Manglish), confidence — ഒരിക്കൽ, സൂക്ഷിക്കും; AI spend cap-ൽ എണ്ണും. Public auto-post ഇല്ല (rule പറഞ്ഞാൽ മാത്രം).
- **Moderation rules** (Settings → Comments → Rules): condition — channel, organic/ad, post, keyword (ML/Manglish variants), link/phone ഉണ്ട്, AI intent/sentiment, ആദ്യ comment; action — hide, done, label, assign, public reply (1–3 variants rotate), private DM, make lead. Templates: scam/crypto links, abuse (EN+ML), "price?" → DM. Condition ഇല്ലാതെ hide/delete ഇല്ല; എല്ലാം log + Hidden tab-ൽ undo; ആദ്യ ആഴ്ച "Observe only".
- **Comment-to-DM** ഇവിടേക്ക്: post picker, optional public reply ("Sent you a message 📩"), ഒരാൾക്ക് ഒരു post-ൽ ആദ്യ comment മാത്രം + ദിവസം ഒന്ന് + 7 ദിവസ window; counts: matched, DM sent, replied, lead.
- **Collision lock + assign:** composer തുറക്കുമ്പോൾ conditional `updateMany` (claimed_by/at, 120 സെ., 30 സെ. heartbeat), shared socket വഴി; മറ്റൊരാളുടെ lock ഉണ്ടെങ്കിൽ server reply നിരസിക്കും; `assigned_to`, Mine chip.
- **SLA:** workspace target (default 2 business hours), working hours-ൽ മാത്രം; first public/private reply-ൽ നിൽക്കും; alert ഓപ്ഷൻ.
- Bulk (Done/Hide/Assign/Label; Delete supervisor+), labels, translate, search (debounce + loadSeq), backfill sync, post stats refresh, like (IG).

## 6. Data (ഒരു migration, രണ്ടുതവണ run ചെയ്താലും സുരക്ഷിതം)
`social_comments` + `assigned_to, claimed_by, claimed_at, first_response_at, first_response_by, sentiment, intent, lang, ai_confidence, is_ad, ad_id, from_username, post_media_url, hidden_by_rule_id, labels`; പുതിയ tables `comment_rules`, `saved_replies`, `comment_rule_runs`. users links `ON DELETE RESTRICT`.

## 7. Inbox-ൽ IG/FB contact profile (user ചോദിച്ചത്)
DM ചെയ്ത IG ആൾക്ക്: ഫോട്ടോ, username, followers, verified, "നിങ്ങളെ follow ചെയ്യുന്നു / നിങ്ങൾ follow ചെയ്യുന്നു" — contact sidebar-ൽ (live വായിക്കും, ഫോട്ടോ URL സ്ഥിരമായി സൂക്ഷിക്കില്ല). Messenger: ഫോട്ടോ, പേര് (+ locale/timezone permission ഉണ്ടെങ്കിൽ). Phone/email/സ്ഥലം Meta തരില്ല — UI അത് പറയും.

## 8. ഘട്ടങ്ങൾ
1. **Bugs** (§3: comment_id, mentions, ad fields, private-reply per person, timestamps) + Inbox IG/FB profile (§7).
2. **Two-pane screen** + keyboard + search + counts + post thumbnail/stats + commenter card + 360px.
3. **SLA + collision lock + assign + saved replies + bulk.**
4. **AI read + Questions + translate.**
5. **Rules engine + comment-to-DM ഇവിടേക്ക് + Hidden tab undo + observe mode + KPI strip.**
6. Backfill, like, labels, analytics.

## 9. തീരുമാനങ്ങൾ (നിങ്ങളുടേത്)
1. ഘട്ടം 1 മുതൽ ക്രമത്തിൽ തുടങ്ങട്ടെ?
2. SLA target (default 2 business hours)?
3. AI read എല്ലാ comments-നും (ചെലവ്) അതോ "To answer"-ന് മാത്രം?
4. Rules ആദ്യ ആഴ്ച observe-only — ശരി?
5. Saved replies: workspace-ന് പൊതു മാത്രം, അതോ ഓരോ agent-നും സ്വന്തം കൂടി?

ഉറവിടങ്ങൾ: agents-ന്റെ reports (Agorapulse, Sprout, Hootsuite, Statusbrew, NapoleonCat, Emplifi, Sprinklr, Khoros, Zoho, Buffer, ManyChat, Meta docs: IG User Profile, Messenger User Profile, IG comments/webhooks/private replies, IG media + insights, Pages comments, changelogs).
