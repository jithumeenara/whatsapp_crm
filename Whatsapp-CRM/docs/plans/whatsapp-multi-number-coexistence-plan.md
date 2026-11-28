# WhatsApp: ഒന്നിലധികം നമ്പറുകൾ + Coexistence (phone app-ഉം CRM-ഉം ഒരുമിച്ച്)

തീയതി: 2026-11-28 · നില: **ഘട്ടം 1 build ചെയ്യുന്നു** · എല്ലാ industry-ക്കും

ഗവേഷണം: 3 agents (മറ്റ് apps-ന്റെ multi-number രീതി, Meta coexistence docs, 2025–26 Meta പുതുമകൾ). ഉറവിടങ്ങൾ അവസാനം.

---

## 1. ഇപ്പോൾ ഉള്ളത്

- ഒരു workspace-ൽ പല നമ്പറുകൾ (Finding #14): ഓരോ നമ്പറിനും സ്വന്തം conversation, broadcast-ൽ "Send from".
- Settings → Channels → WhatsApp: pill switcher. **പോരായ്മകൾ:** നമ്പർ കാണിക്കുന്നില്ല (phone_number_id ആണ് കാണിക്കുന്നത്), "Set as default" hover-ൽ മാത്രം (phone-ൽ കാണില്ല), health ഇല്ല, Inbox-ൽ ഏത് നമ്പർ എന്ന് filter ഇല്ല.
- Coexistence: connect മാത്രം (be544ad). History/contacts sync, phone-ൽ നിന്ന് അയച്ച മറുപടികൾ Inbox-ൽ — ഇല്ല.
- `messaging_limit_tier` (Meta deprecate ചെയ്തു) ഇപ്പോഴും meta-api.ts-ൽ.

## 2. Meta-യുടെ പ്രധാന നിയമങ്ങൾ (2025–26) — design ഇതനുസരിച്ച്

| നിയമം | നമുക്കുള്ള അർത്ഥം |
|---|---|
| Messaging limit **business portfolio-ക്ക് മൊത്തം** (7 Oct 2025) | നമ്പർ കൂട്ടിയാൽ broadcast ശേഷി കൂടില്ല. ഒരു "portfolio limit meter" മാത്രം. നമ്പർ മാറ്റി limit മറികടക്കൽ ഇല്ല. |
| Throughput നമ്പറിന്: 80 mps → 1000 mps (തനിയെ), **coexistence 20 mps** | വലിയ broadcast-ന് വേഗം കാണിക്കുക; coexistence നമ്പറിൽ മുന്നറിയിപ്പ്. |
| Embedded Signup v5 (20 Oct 2026): coexistence default; event-ൽ `messaging_account_ids`, `phone_number_id`, `is_on_biz_app` | button v4 (`featureType`) + v5 രൂപം രണ്ടും മനസ്സിലാക്കണം. |
| Coexistence sync: `POST /{phone_number_id}/smb_app_data` — contacts, പിന്നെ history; **ഓരോന്നും ഒരിക്കൽ മാത്രം, 24 മണിക്കൂറിനകം** | connect കഴിഞ്ഞ ഉടൻ server തന്നെ വിളിക്കും; request_id സൂക്ഷിക്കും. |
| History: 6 മാസം, phases 0/1/2, `chunk_order`, `progress` 100 = തീർന്നു; groups ഇല്ല; media 14 ദിവസത്തേത് മാത്രം; 2593109 = business share ചെയ്തില്ല | raw payload ആദ്യം സൂക്ഷിക്കുക, പിന്നെ process; AI/automation/unread ഇല്ല. |
| `smb_message_echoes`: phone app-ൽ നിന്ന് അയച്ചവ (text/image/video/document/revoke/edit) | Inbox-ൽ "Sent from phone" ആയി കാണിക്കുക; ഒരാൾ phone-ൽ മറുപടി കൊടുത്താൽ AI മാറിനിൽക്കണം. |
| App-ൽ നിന്നുള്ള messages സൗജന്യം; API messages-ന് Cloud API നിരക്ക്; app messages 24h window തുറക്കില്ല | window customer message-ൽ നിന്ന് മാത്രം (ഇപ്പോഴത്തെ രീതി ശരി). |
| `account_update`: PARTNER_REMOVED (`disconnection_info.reason`: ACCOUNT_DISCONNECTED, PRIMARY_INACTIVITY…), ACCOUNT_OFFBOARDED → കുറച്ചു മിനിറ്റിൽ ACCOUNT_RECONNECTED | PARTNER_REMOVED മാത്രം disconnect; OFFBOARDED = "reconnecting" അറിയിപ്പ് മാത്രം. |
| Phone 14 ദിവസം app തുറന്നില്ലെങ്കിൽ disconnect | UI-ൽ ഓർമ്മപ്പെടുത്തൽ. |
| BSUID / usernames (2026): `to` ഇല്ലാതെ `user_id` മാത്രം വരാം | ഘട്ടം 3: phone ഇല്ലാത്ത contact. ഘട്ടം 1-ൽ phone ഇല്ലാത്തത് log ചെയ്ത് വിടും. |
| Utility templates window-നുള്ളിലും വീണ്ടും പണം (1 Oct 2026, ഓരോ നമ്പറിനും മാസം 1,000 സൗജന്യം); ഇന്ത്യ INR billing 31 Dec 2026-നകം | ഘട്ടം 2: ചെലവ് per number. ACSTI/Hospital INR billing ഉറപ്പാക്കണം. |

## 3. മറ്റ് apps — നമ്മൾ മുന്നിലെത്തുന്നിടം

Wati (25 നമ്പർ, team per number), Freshchat (bot per number), Chatwoot (Account Health tab), Twilio (sender pools, failover API), Periskope (alerts), Kommo (SalesBot per number).
**ആർക്കും ഇല്ലാത്തത്:** live health alerts (WhatsApp/Telegram), ഒരു contact-ന്റെ എല്ലാ നമ്പറുകളിലെയും chats ഒരിടത്ത്, CRM-നുള്ളിൽ failover, AI per number + smart sender.

## 4. ഘട്ടങ്ങൾ

### ഘട്ടം 1 — Coexistence മുഴുവൻ + Numbers section v2 (ഇപ്പോൾ)
1. **"WhatsApp Business app നമ്പർ connect ചെയ്യുക"** button (v4 `featureType: whatsapp_business_app_onboarding`); v5 event രൂപവും. Checklist copy (app 2.24.17+, phone തുറന്നുവയ്ക്കുക, WhatsApp Web വീണ്ടും link ചെയ്യണം, broadcast lists read-only, disappearing/view-once off). Meta error codes (3441042 region, 4563015 update app, 3441075 2-step…) പ്ലെയിൻ വാക്കുകളിൽ.
2. Connect കഴിഞ്ഞ് server: `smb_app_data` contacts → history; request_id-ഉം നിലയും `whatsapp_coexistence_syncs`-ൽ (migration 183).
3. Webhook: `smb_message_echoes`, `history`, `smb_app_state_sync` — raw ആദ്യം സൂക്ഷിച്ച് (`whatsapp_history_chunks`, mig 183), wamid വച്ച് dedupe, AI/automation/unread ഇല്ല; echo = ഒരാൾ മറുപടി കൊടുത്തു (sender_type agent, bot_source `phone_app`). revoke/edit.
4. History നില screen-ൽ: "6 മാസത്തെ chats import ചെയ്യുന്നു… 55%", declined, done.
5. `account_update`: PARTNER_REMOVED-ന്റെ reason പ്ലെയിൻ വാക്കുകളിൽ; OFFBOARDED = reconnecting അറിയിപ്പ്, disconnect ഇല്ല.
6. **Numbers section v2:** ഓരോ നമ്പറിനും card — നമ്പർ, verified name + name status, quality (പച്ച/മഞ്ഞ/ചുവപ്പ്), throughput, Cloud API / Business app (coexistence) badge, connection, default (എപ്പോഴും കാണുന്ന button), label rename; മുകളിൽ portfolio limit meter (`whatsapp_business_manager_messaging_limit`). `messaging_limit_tier` മാറ്റുക.
7. Inbox: conversation-ൽ ഏത് നമ്പർ എന്ന chip + നമ്പർ filter.

### ഘട്ടം 2 — Health, routing, ചെലവ്
- Live alerts: quality മാറ്റം, THROUGHPUT_UPGRADE, ACCOUNT_RESTRICTION/VIOLATION → admin-ന് WhatsApp/Telegram.
- ഓരോ നമ്പറിനും team, agent access, working hours, auto-assign, AI persona/knowledge.
- Composer-ൽ "Reply from" + window മുന്നറിയിപ്പ്.
- ചെലവും volume-ഉം per number (`pricing_analytics` with `PHONE` dimension); per-number reports.
- Webhook/token self-check per number (subscribed_apps, debug_token expiry).

### ഘട്ടം 3 — Futuristic
- Contact identity graph: phone + BSUID (`user_id`, `parent_user_id`, username), `user_changed_number` merge; phone ഇല്ലാത്ത contact; BSUID-ലേക്ക് send.
- Smart sender selection (last thread, ഭാഷ, quality, window, same-portfolio).
- Failover: restricted/disconnected നമ്പറിന്റെ automations/broadcasts backup നമ്പറിലേക്ക് (thread/opt-in ഉള്ളവർക്ക് മാത്രം).
- Broadcast spreading by mps (sticky sender, 130429 back-off) — വേഗം മാത്രം, limit അല്ല.
- Predictive quality alerts (block/STOP/"who is this" നിരക്ക്), anomaly detector (delivered/read താഴ്ച).
- Calling API per number, username manager, Groups (8 പേർ), daily AI brief per number.

## 5. സുരക്ഷ
- History 6 മാസത്തെ സ്വകാര്യ chats: AI knowledge-ലേക്ക് പോകില്ല (people-data guard), raw payload account-ന് മാത്രം, audit.
- Echo/history ഒരിക്കലും AI reply, automation, 24h window തുടങ്ങില്ല.
- Coexistence connect: token ലിസ്റ്റ് ചെയ്യുന്ന WABA-യിലെ ഒരേയൊരു `is_on_biz_app` നമ്പർ മാത്രം (be544ad).
- Webhook signature പഴയതുപോലെ; പുതിയ fields Meta App-ൽ subscribe ചെയ്യണം (server owner): `smb_message_echoes`, `history`, `smb_app_state_sync`, `account_update`.

## ഉറവിടങ്ങൾ
- Meta: onboarding-business-app-users, embedded-signup/version-5, versions, errors, webhooks/reference (account_update, smb_message_echoes, history), reconnect-offboarded-coexistence-clients, throughput, upcoming-messaging-limits-changes, business-scoped-user-ids, pricing, manage-phone-numbers, pricing_analytics — developers.facebook.com/documentation/business-messaging/whatsapp/…
- respond.io, Wati, 360dialog, DoubleTick, Chakra, Telnyx, Chatwoot, SleekFlow, Twilio sender pools (agents-ന്റെ reports-ൽ URL-കൾ).
