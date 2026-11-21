# Lead പേജ്: Tags + AI ചാറ്റ് സംഗ്രഹം (Translate സഹിതം) — പ്ലാൻ

തീയതി: 2026-11-21 · നില: **പ്ലാൻ മാത്രം, build ചെയ്തിട്ടില്ല** · എല്ലാ industry-ക്കും (ACSTI-ക്ക് മാത്രമല്ല)

അടിസ്ഥാനം: രണ്ട് ഏജന്റുകളുടെ പഠനം. (1) 14 CRM-കളിൽ (HubSpot, Salesforce, Zoho,
Freshsales, Pipedrive, Kommo, Intercom, Zendesk, WATI, Interakt, AiSensy, Gallabox,
SleekFlow, LeadSquared) tags-ഉം AI summary-ഉം എങ്ങനെ എന്ന്. (2) നമ്മുടെ കോഡിൽ ഇപ്പോൾ
എന്ത് ഉണ്ട് എന്ന്.

---

## 1. ലക്ഷ്യം

Lead പേജിൽ (`/leads/[id]`):

1. **Tags** — lead-ന് tag ചേർക്കാനും നീക്കാനും, പുതിയ tag അവിടെത്തന്നെ ഉണ്ടാക്കാനും.
2. **AI സംഗ്രഹം** — ആ customer-ന്റെ ചാറ്റ് 2–3 വാചകത്തിൽ. ഡിഫോൾട്ട് **English**.
   വേണമെങ്കിൽ **ഒരു വിഷയം മാത്രം** ("fees", "admission date") സംഗ്രഹിക്കാം.
3. **Translate** — സംഗ്രഹം മലയാളം / ഹിന്ദി / തമിഴ് / ... ആക്കാൻ ഒരു click.

---

## 2. മറ്റ് CRM-കളിൽ നിന്ന് പഠിച്ചത് (ചുരുക്കം)

| കാര്യം | ആര് ചെയ്യുന്നു | നമ്മൾ |
|---|---|---|
| Summary **button അമർത്തുമ്പോൾ മാത്രം** (auto അല്ല) | Intercom, SleekFlow, Kommo, Zendesk | ✅ എടുക്കുന്നു — ചെലവ് നിയന്ത്രണം |
| ~100 വാക്കിൽ **നിശ്ചിത ഘടന**: എന്ത് വേണം, എന്ത് ചെയ്തു, ഇനി എന്ത് | Zendesk | ✅ 2–3 വാചകം, ഈ ഘടന |
| **"Save as note"** — ആൾ നോക്കി തിരുത്തിയ ശേഷം മാത്രം record-ൽ | Intercom, SleekFlow, Freshsales | ✅ |
| **Regenerate** + എപ്പോൾ ഉണ്ടാക്കി + "ഇതിനുശേഷം N പുതിയ സന്ദേശം" | HubSpot, Zendesk, SleekFlow | ✅ |
| തെറ്റായ summary-ക്ക് **feedback**; admin-ന് ഓഫ് ചെയ്യാം | Freshsales | ✅ |
| Translation **cache ചെയ്യുക** (Zendesk ഓരോ തവണയും വീണ്ടും translate ചെയ്യുന്നു, ഫലം മാറും) | Zendesk-ന്റെ തെറ്റ് | ✅ cache |
| **ഒരു വിഷയം മാത്രം** സംഗ്രഹിക്കാൻ ബട്ടൺ | **ആരും നൽകുന്നില്ല** (Salesforce/Zoho-യിൽ admin prompt മാത്രം) | ✅ നമ്മുടെ മേന്മ |
| ഇന്ത്യൻ ഭാഷകൾ | Kommo, Freshdesk, SleekFlow — ഇല്ല; Intercom — ഹിന്ദി മാത്രം | ✅ നമ്മുടെ മേന്മ — പക്ഷേ Manglish ടെസ്റ്റ് ചെയ്യണം |
| Tag: type ചെയ്ത് Enter, അല്ലെങ്കിൽ പഴയത് തിരഞ്ഞെടുക്കുക | WATI, Pipedrive, Kommo | ✅ (Inbox-ൽ ഇത് ഇപ്പോഴേ ഉണ്ട്) |
| നിറം preset palette-ൽ നിന്ന്; rename / merge | Zoho | ✅ (Settings → Tags ഇപ്പോഴേ ഉണ്ട്) |
| Tag filter AND/OR + എണ്ണം + "tag ഇല്ലാത്തവ" | Kommo, Zoho | ഘട്ടം 3 |

**ഒഴിവാക്കേണ്ട തെറ്റുകൾ:**
1. Bulk edit മുഴുവൻ tag set **മാറ്റിയെഴുതരുത്** — ഒറ്റ tag ചേർക്കുക/നീക്കുക മാത്രം (HubSpot-ൽ ഡാറ്റ പോയത് ഇങ്ങനെ).
2. ടെസ്റ്റ് ചെയ്യാത്ത ഭാഷ "support ചെയ്യുന്നു" എന്ന് പറയരുത്.
3. Tag delete ചെയ്യുമ്പോൾ "N leads-ൽ നിന്ന് നീങ്ങും" എന്ന് മുന്നറിയിപ്പ്.
4. Summary-യിൽ internal notes ഡിഫോൾട്ടായി വേണ്ട; Aadhaar / ബാങ്ക് നമ്പർ mask ചെയ്യുക.
5. പഴയ summary പുതിയതുപോലെ കാണിക്കരുത് — "പഴയത്" എന്ന് വ്യക്തമായി.

---

## 3. നമ്മുടെ കോഡിൽ ഇപ്പോൾ ഉള്ളത്

**Tags**
- `Tag` + `ContactTag` മാത്രം (`prisma/schema.prisma`). **Tags contact-ലാണ്, lead-ൽ അല്ല.**
  Lead-ന്റെ tags = അതിന്റെ contact-ന്റെ tags.
- API: `/api/tags` (ഉണ്ടാക്കാൻ agent), `/api/contacts/[id]/tags` (POST ഒന്ന് ചേർക്കുക,
  DELETE ഒന്ന് നീക്കുക — audit സഹിതം).
- `src/lib/contacts/tag-events.ts`: ചേർക്കുമ്പോൾ "Tag added" automations, AI ഒരിക്കൽ
  ആൾ നീക്കിയ tag വീണ്ടും ചേർക്കാതിരിക്കാനുള്ള `removed_by_person`.
- Inbox sidebar-ൽ (`contact-sidebar-v2.tsx`) picker + ഉണ്ടാക്കൽ + AI നിർദ്ദേശം ഇപ്പോഴേ ഉണ്ട്.
- Leads പട്ടികയിൽ `tag_id` filter ഇപ്പോഴേ ഉണ്ട്.

**AI**
- `generateAiReplyWithFallback` (account-ന്റെ provider + fallback), `recordAiUsage`,
  `checkRateLimit(RATE_LIMITS.aiCall)`, Gemini "thinking low".
- `/api/messages/translate` + `detectAndTranslate` ഇപ്പോഴേ ഉണ്ട്.
- 8 ഭാഷ: en, ml, hi, ta, te, kn, bn, ar.
- **Summary ഇതുവരെ എവിടെയും ഇല്ല**; സൂക്ഷിക്കാൻ column-ഉം ഇല്ല.
- ചാറ്റ് വായന: `/api/contacts/[id]/timeline` — agent-ന് **ഏൽപ്പിച്ച conversations മാത്രം**
  (അതേ നിയമം summary-ക്കും).

---

## 4. ഡിസൈൻ

### 4.1 Tags (lead പേജ്)

**എവിടെ:** contact card-ൽ പേരിന്/ഫോണിന് താഴെ ഒരു chip വരി.

```
N Ashokan                                  [📞] [✏] [History]
919446262385
[Fees enquiry ×] [December batch ×] [+ Add tag]
```

- `+ Add tag` → തിരയാവുന്ന പട്ടിക (account-ന്റെ tags, നിറം സഹിതം). ഇല്ലാത്ത പേര് type ചെയ്ത്
  Enter → പുതിയ tag ഉണ്ടാക്കി ചേർക്കും (palette-ൽ നിന്ന് നിറം).
- `×` → നീക്കും (ഉടൻ, undo toast 5 സെക്കൻഡ്).
- AI നിർദ്ദേശിച്ച tags (mig 144) ഉണ്ടെങ്കിൽ മങ്ങിയ chip ആയി "✨ Suggested: Hot lead  ✓ ✗".
- Inbox sidebar-ലെ picker ഒരു പങ്കിട്ട ഘടകമാക്കി (`components/tags/tag-picker.tsx`)
  രണ്ടിടത്തും ഉപയോഗിക്കും — രണ്ട് copy ഉണ്ടാകരുത്.

**ഡാറ്റ:** tags contact-ൽ തന്നെ (പുതിയ table വേണ്ട). കാരണം: ഒരാൾ ഒരിക്കൽ "VIP" ആണെങ്കിൽ
അവരുടെ എല്ലാ leads-ലും, Inbox-ലും, broadcast segment-ലും അത് വേണം. Contact ഇല്ലാത്ത lead-ൽ
"ആദ്യം ഫോൺ നമ്പർ ചേർക്കുക" എന്ന് കാണിക്കും.

> ❓ **തീരുമാനം T1:** tag **contact-ൽ** (Inbox, broadcast, എല്ലാ leads-ലും ഒന്ന്) — ശുപാർശ;
> അതോ **ഈ lead-ന് മാത്രം** (പുതിയ `lead_tags` table, migration)? രണ്ടാമത്തേത് "ഈ enquiry
> December batch-ന്" പോലുള്ളവയ്ക്ക് നല്ലതാണ്, പക്ഷേ Inbox-ൽ കാണില്ല.

**API:** നിലവിലുള്ള `/api/contacts/[id]/tags` (POST/DELETE) വീണ്ടും ഉപയോഗിക്കും. Lead GET-ൽ
`contact.tags` ചേർക്കും. Audit-ൽ lead-ന്റെ History-യിലും കാണാൻ `meta.lead_id`.
`TagSource`-ൽ `'lead'` ചേർത്ത് `removed_by_person` നിയമത്തിൽ ഉൾപ്പെടുത്തും.

**ആർക്ക്:** agent+ ചേർക്കാം/നീക്കാം (ഏൽപ്പിച്ച lead-ൽ മാത്രം agent). പുതിയ tag
ഉണ്ടാക്കൽ: ഇപ്പോൾ agent-ന് കഴിയും.

> ❓ **തീരുമാനം T2:** പുതിയ tag ഉണ്ടാക്കാൻ എല്ലാ agent-നും (ഇപ്പോഴത്തെ നില) അതോ admin
> മാത്രം (WATI, Kommo പോലെ — tag പട്ടിക വൃത്തിയായിരിക്കും)?

### 4.2 AI ചാറ്റ് സംഗ്രഹം

**എവിടെ:** contact card-നും Description-നും ഇടയിൽ ഒരു കാർഡ്. ചാറ്റ് panel header-ൽ
"✨ Summarise" ബട്ടണും (അതേ കാർഡിലേക്ക്).

```
┌ ✨ Chat summary ───────────────── English ▾  [↻] ┐
│ Customer asked for the December & January 2027   │
│ training schedule. We sent December's two        │
│ programmes with fees; January has none yet.      │
│ Next: tell them when January dates are out.      │
│                                                  │
│ Made 2 h ago · 3 new messages since  [Refresh]   │
│ [Save as note]  [👍] [👎]   Focus: [All ▾]        │
└──────────────────────────────────────────────────┘
```

**പ്രവർത്തനം**
1. ആദ്യം കാർഡിൽ "✨ Summarise this chat" ബട്ടൺ മാത്രം. അമർത്തുമ്പോൾ ഉണ്ടാക്കും
   (auto അല്ല — ചെലവ്). മുമ്പ് ഉണ്ടാക്കിയത് ഉണ്ടെങ്കിൽ അത് ഉടൻ കാണിക്കും.
2. **Focus (വിഷയം):** "All" ഡിഫോൾട്ട്. ദ്രുത ബട്ടണുകൾ: Fees / Dates & schedule /
   Documents / Complaint + സ്വന്തം വാക്ക് type ചെയ്യാം (60 അക്ഷരം വരെ). അപ്പോൾ ആ വിഷയം
   മാത്രം 2–3 വാചകത്തിൽ; ചാറ്റിൽ ആ വിഷയം ഇല്ലെങ്കിൽ "This chat does not mention fees."
   (ഊഹിക്കില്ല).
3. **ഘടന (prompt):** ഉപഭോക്താവ് എന്ത് ചോദിച്ചു/വേണം → നമ്മൾ എന്ത് മറുപടി/ചെയ്തു →
   ഇനി എന്ത് ബാക്കി. പരമാവധി 3 വാചകം, ~70 വാക്ക്. ചാറ്റിൽ ഇല്ലാത്തത് പറയില്ല.
   ആര്/ഏത് ചാനൽ: WhatsApp, Instagram, Messenger, Telegram, Website, Email — contact-ന്റെ
   എല്ലാ conversations-ഉം (agent-ന് ഏൽപ്പിച്ചവ മാത്രം).
4. **ഇൻപുട്ട്:** അവസാന 60 സന്ദേശം, ഓരോന്നും 500 അക്ഷരം വരെ, ആകെ ~8000 അക്ഷരം.
   `content_text || transcript` (voice note-ന്റെ എഴുത്തും), "Customer:" / "Us:" (bot ആണെങ്കിൽ
   "Bot:"). Delete ചെയ്തവ ഇല്ല. Internal notes ഇല്ല. Aadhaar / ബാങ്ക് / കാർഡ് നമ്പറുകൾ
   അയക്കുന്നതിന് മുമ്പ് mask (`image-reading`-ലെ masking വീണ്ടും ഉപയോഗിക്കുക).
5. **കുറഞ്ഞത്:** 3 സന്ദേശത്തിൽ കുറവാണെങ്കിൽ "Not enough chat to summarise yet."
6. **പഴയത്:** സംഗ്രഹത്തിന് ശേഷം വന്ന സന്ദേശങ്ങളുടെ എണ്ണം → "3 new messages since"
   + Refresh. Refresh പഴയതിനെ മാറ്റിസ്ഥാപിക്കും.
7. **Save as note:** text ബോക്സിൽ തിരുത്താം → lead-ന്റെ notes/timeline-ൽ "AI summary
   (checked by Anjali)" ആയി. AI ഒരിക്കലും സ്വയം record-ൽ എഴുതില്ല.
8. **👍/👎:** `ai_feedback`-ൽ (അടുത്ത prompt മെച്ചപ്പെടുത്താൻ, Reports-ൽ ഗുണനിലവാരം).

**ഭാഷ**
- സംഗ്രഹം എപ്പോഴും **English-ൽ** ഉണ്ടാക്കും (ചാറ്റ് മലയാളം/Manglish ആയാലും).
- `English ▾` മെനു: മലയാളം, हिन्दी, தமிழ், తెలుగు, ಕನ್ನಡ, বাংলা, العربية
  (നമ്മുടെ 8 ഭാഷ). തിരഞ്ഞെടുത്താൽ നിലവിലുള്ള `detectAndTranslate` വഴി → **cache**
  (summary-യുടെ version + ഭാഷ). അതേ ഭാഷ വീണ്ടും അമർത്തിയാൽ AI വിളിക്കില്ല.
- ആളുടെ `preferred_language` ഓർക്കും — അടുത്ത തവണ ആ ഭാഷ നേരിട്ട് (English-ഉം ഒരു
  click അകലെ).

> ❓ **തീരുമാനം S1:** ഡിഫോൾട്ട് English മാത്രം (നിങ്ങൾ പറഞ്ഞത്) — അതോ staff-ന്റെ സ്വന്തം
> ഭാഷ ഓർത്ത് അതിൽ തുറക്കണോ?

**സൂക്ഷിക്കൽ (migration 169 — build സമയത്ത് നമ്പർ ഉറപ്പാക്കും)**

പുതിയ `lead_summaries` table (lead-ൽ column ചേർക്കുന്നതിനേക്കാൾ നല്ലത് — focus ഓരോന്നിനും
ഒന്ന്, translations, ചരിത്രം):

| column | |
|---|---|
| id, account_id, lead_id | account_id എല്ലാ query-ലും |
| focus | `''` = All, അല്ലെങ്കിൽ വിഷയം (lowercase, trim) |
| text_en | English സംഗ്രഹം |
| translations | jsonb `{ "ml": "...", "hi": "..." }` |
| last_message_at, message_count | "N new since" കണക്കാക്കാൻ |
| model, created_by, created_at | |
| feedback | 'up' / 'down' / null |

`UNIQUE (lead_id, focus)` — Refresh അതേ വരി മാറ്റിയെഴുതും (ഇരട്ട ഇല്ല). Migration
രണ്ടുതവണ ഓടിയാലും സുരക്ഷിതം (`IF NOT EXISTS`), `crm_prod_copy`-ൽ `BEGIN…ROLLBACK`
dry run. Lead/user-ലേക്കുള്ള ലിങ്ക് `ON DELETE RESTRICT` / lead delete-ൽ cascade (data
safety നിയമം അനുസരിച്ച് തീരുമാനിക്കും).

**API**
- `GET /api/leads/[id]/summary?focus=` → സൂക്ഷിച്ചത് + "N new since".
- `POST /api/leads/[id]/summary` `{ focus }` → ഉണ്ടാക്കും/പുതുക്കും.
- `POST /api/leads/[id]/summary/translate` `{ focus, lang }` → cache ഉണ്ടെങ്കിൽ അത്.
- `POST /api/leads/[id]/summary/feedback` `{ focus, vote }`.
- എല്ലാത്തിനും: `requireRole('agent')` (viewer-ന് വായിക്കാം മാത്രം), `account_id`
  പരിശോധന, agent-ന് ഏൽപ്പിച്ച lead മാത്രം, `assertPageAccess('/leads')`,
  `checkRateLimit` (ആൾക്ക് 30/മിനിറ്റ് + **ഒരു lead-ന് 5/മണിക്കൂർ**), `recordAiUsage`
  (`feature: 'lead_summary'`, `'lead_summary_translate'`), audit (ഉണ്ടാക്കൽ, note save).
- AI ഓഫ് ആണെങ്കിൽ / key ഇല്ലെങ്കിൽ: "AI is not set up. An admin can turn it on in
  Settings → AI." (ബട്ടൺ മറയ്ക്കില്ല, കാരണം പറയും).
- Admin switch: Settings → AI → "Chat summary on lead page" (ഓൺ ഡിഫോൾട്ട്).

---

## 5. ഘട്ടങ്ങൾ

| ഘട്ടം | ഉള്ളടക്കം | Migration | വലിപ്പം |
|---|---|---|---|
| **1. Tags** | പങ്കിട്ട TagPicker (Inbox-ൽ നിന്ന്), lead പേജിൽ chip വരി, Lead GET-ൽ tags, `'lead'` source, audit, ടെസ്റ്റുകൾ, ബ്രൗസർ പരിശോധന | ഇല്ല (T1 = contact ആണെങ്കിൽ) | ചെറുത് |
| **2. AI സംഗ്രഹം** | `lib/ai/lead-summary.ts` (transcript + prompt + masking), API, കാർഡ്, focus, "N new since", Save as note, feedback, usage labels | 169 | ഇടത്തരം |
| **3. Translate** | ഭാഷ മെനു, cache, preferred_language | (169-ൽ തന്നെ) | ചെറുത് |
| **4. പിന്നീട്** | Leads പട്ടികയിൽ tag AND/OR + "tag ഇല്ലാത്തവ" + bulk add/remove (ഒറ്റ tag മാത്രം, മാറ്റിയെഴുതില്ല), tag delete മുന്നറിയിപ്പ്, Inbox-ലും summary | ഇല്ല | ഇടത്തരം |

ഓരോ ഘട്ടവും: ആദ്യം ടെസ്റ്റ് (ചുവപ്പ് → പച്ച), 10 bug നിയമങ്ങൾ, `crm-ui-review`,
360px + dark theme Playwright, `npm test` മുഴുവൻ.

## 6. ടെസ്റ്റുകൾ (പ്രധാനം)

- മറ്റൊരു account-ന്റെ lead/tag → 404; agent-ന് ഏൽപ്പിക്കാത്ത lead → 403.
- ഇരട്ട click → ഒരു tag, ഒരു summary വരി (`UNIQUE`, ബട്ടൺ lock).
- Transcript: 60 സന്ദേശ cap, Aadhaar mask, internal notes ഇല്ല, delete ചെയ്തവ ഇല്ല,
  agent-ന് ഏൽപ്പിച്ച conversations മാത്രം.
- Focus വിഷയം ചാറ്റിൽ ഇല്ല → "does not mention" (AI ഊഹിക്കരുത് — eval സെറ്റിൽ).
- Translate രണ്ടാം തവണ → AI വിളി 0 (cache).
- Rate limit: ഒരു lead-ന് മണിക്കൂറിൽ 6-ാമത്തേത് → 429 വ്യക്തമായ സന്ദേശത്തോടെ.
- **Manglish / മലയാളം ചാറ്റ്** 10 യഥാർത്ഥ ഉദാഹരണം (`crm_test_scratch`-ൽ) → English
  സംഗ്രഹം ശരിയോ എന്ന് കൈകൊണ്ട് പരിശോധിക്കുക.

## 7. ചെലവ് (ഏകദേശം, പരിശോധിച്ചിട്ടില്ല)

ഒരു സംഗ്രഹം ≈ 8000 അക്ഷരം ഇൻപുട്ട് + 100 വാക്ക് ഔട്ട്പുട്ട്, flash-lite മോഡലിൽ —
വളരെ ചെറിയ തുക; Translate അതിലും ചെറുത്. യഥാർത്ഥ തുക Spending report-ൽ
`lead_summary` ആയി കാണാം.

## 8. നിങ്ങളുടെ തീരുമാനം വേണ്ടവ

1. **T1** — tag contact-ൽ (ശുപാർശ) അതോ ഈ lead-ന് മാത്രം?
2. **T2** — പുതിയ tag ഉണ്ടാക്കാൻ എല്ലാ agent-നും അതോ admin മാത്രം?
3. **S1** — summary ഡിഫോൾട്ട് English മാത്രം, അതോ staff-ന്റെ ഭാഷ ഓർക്കണോ?
4. **S2** — Focus ദ്രുത ബട്ടണുകൾ: Fees / Dates / Documents / Complaint മതിയോ, അതോ
   admin-ന് Settings-ൽ സ്വന്തം വിഷയങ്ങൾ ചേർക്കാൻ കഴിയണോ (എല്ലാ industry-ക്കും നല്ലത്)?
5. **S3** — viewer-ന് summary കാണാൻ മാത്രം, ഉണ്ടാക്കാൻ കഴിയില്ല — ശരിയോ?

ഈ തീരുമാനങ്ങൾക്ക് ശേഷം "start" എന്ന് പറഞ്ഞാൽ ഘട്ടം 1 മുതൽ build ചെയ്യും.

---
ഉറവിടങ്ങൾ (പ്രധാനം): Zoho tagging KB, Kommo tags + conversation summary KB, Intercom
Copilot + translations KB, Zendesk summarise + translation KB, Freshsales Freddy summary KB,
SleekFlow smart summary KB, HubSpot record summary KB, WATI tags KB. HubSpot WhatsApp
inbox summary, WATI summary വിശദാംശങ്ങൾ, എല്ലാ വിലകളും — പരിശോധിക്കാൻ കഴിഞ്ഞില്ല.
