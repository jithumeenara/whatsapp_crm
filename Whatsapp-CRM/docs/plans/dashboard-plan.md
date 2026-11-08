# Dashboard പുതിയ രൂപകൽപ്പന: Business owner-നുള്ള പ്ലാൻ

തീയതി: 8 നവംബർ 2026. സ്ഥിതി: **Phase 0 + Phase 1 നിർമ്മിച്ചു (branch `feature/owner-dashboard`, ലോക്കൽ commit-കൾ, push ചെയ്തിട്ടില്ല). ബാക്കി ഘട്ടങ്ങൾ പ്ലാൻ മാത്രം.**

## നിർമ്മാണ നില (8 നവംബർ 2026, വൈകുന്നേരം)

**നിർമ്മിച്ചത്:** Phase 0 (dashboard-ലെ സ്കോപ്പ്/ആക്സസ് തിരുത്തലുകൾ, ബിസിനസ് ദിവസ ജാലകം, പങ്കിട്ട UI ഘടകങ്ങൾ, 8 ചാർട്ട് നിറങ്ങൾ, ഉപയോഗമില്ലാത്ത 9 ഫയൽ നീക്കം). Phase 1 (ഉടമയുടെ dashboard "Classic | New (beta)" സ്വിച്ചിന് പിന്നിൽ; ഒറ്റ Task നിർവചനം; Leads പേജിലെ Tasks ടാബ്; `/follow-ups?due=`, `/calls?status=missed&day=today` ഫിൽറ്ററുകൾ). Commit-കൾ: `11e71ce` (UI ഘടകങ്ങൾ), `aabbfde` (ബാക്കെൻഡ്), `b635b4b` (സ്ക്രീനുകൾ).

**പരിശോധിച്ചത്:** `tsc` 0 പിഴവ്. `npm test`: 3,374 പാസ് (തുടക്കത്തിൽ 3,240); പരാജയപ്പെടുന്ന ഫയലുകൾ തുടക്കത്തിലുള്ള 5-ന്റെ ഉപവിഭാഗം (3 Windows-മാത്രം, 1 AI ടെസ്റ്റ് തിരക്കുള്ളപ്പോൾ മാത്രം സമയപരിധി കഴിയുന്നത്). `eslint`: നമ്മുടെ ഭാഗത്ത് 0 പിഴവ് (`queries.timezone.test.ts`-ലെ 2 പിഴവുകൾ നേരത്തെ ഉള്ളത്). മൂന്ന് സ്വതന്ത്ര അവലോകനങ്ങൾ (2 UI, 1 ബാക്കെൻഡ്): തടസ്സമുള്ള കണ്ടെത്തലുകൾ എല്ലാം തിരുത്തി. ബ്രൗസറിൽ (360px, 1360px, ലൈറ്റ്, ഡാർക്ക്) **ഉദാഹരണ ഡാറ്റ** ഉപയോഗിച്ച് കണ്ടു.

**പരിശോധിക്കാത്തത് (സത്യസന്ധമായി):**
- **യഥാർത്ഥ ഡാറ്റ:** ഒരു യഥാർത്ഥ ഡാറ്റാബേസുമായി സ്ക്രീൻ പ്രവർത്തിപ്പിച്ചിട്ടില്ല. ബാക്കെൻഡിലെ raw SQL (`medianFirstReply`, `cohort` മുതലായവ) യൂണിറ്റ് ടെസ്റ്റുകളിൽ mock ആണ്. ആദ്യം `crm_prod_copy`-ൽ നോക്കണം.
- Tasks ടാബിലെ ഗ്രൂപ്പ്-തോറുമുള്ള "Show more" യഥാർത്ഥ `/api/my-tasks`-മായി ബ്രൗസറിൽ ഓടിച്ചിട്ടില്ല. ഫോൺ കാഴ്ച ഡെവ് ഉദാഹരണ പേജിൽ മാത്രം.
- ചില ചെറിയ തിരുത്തലുകൾക്ക് (median, my-tasks query) ടെസ്റ്റും കോഡും ഒരുമിച്ച് എഴുതി ("ആദ്യം ചുവപ്പ്" കാണിച്ചിട്ടില്ല).

**അറിയപ്പെടുന്ന വ്യത്യാസങ്ങൾ / തീരുമാനങ്ങൾ:**
1. ഒരാളുടെ dashboard-ലെ "overdue", അയാളുടെ **Reports** പേജിലേതിനേക്കാൾ കൂടാം: dashboard "ഞാൻ ഉണ്ടാക്കി ആർക്കും ഏൽപ്പിക്കാത്ത follow-ups" കൂടി എണ്ണുന്നു (നിങ്ങളുടെ നിർവചനം), Reports ഏൽപ്പിച്ചവ മാത്രം. മുഴുവൻ account-ന്റെ സംഖ്യ ഒന്നുതന്നെ.
2. API key വഴി ഉണ്ടാക്കുന്ന leads ("source" നൽകാതെ) ഇപ്പോൾ ആ key-യുടെ ഉടമയുടെ "ഞാൻ കൈകൊണ്ട് ഉണ്ടാക്കിയത്" ആയി എണ്ണപ്പെടാം. പരിഹാരം `POST /api/leads`-ൽ: API key ഉപയോഗിച്ച് source നൽകാതെ ഉണ്ടാക്കിയാൽ "manual"-ന് പകരം "api" സൂക്ഷിക്കുക (ഇത് Reports-ലെ source പട്ടികയിൽ പുതിയ "api" ഇനം കൊണ്ടുവരും). ഒരു ടെസ്റ്റ് ഈ പരിമിതി രേഖപ്പെടുത്തുന്നു. **തീരുമാനം വേണം.**
3. `GET /api/leads`-ൽ `assertPageAccess` ഇല്ല (നേരത്തെ ഉള്ളത്): Leads പേജ് നിഷേധിച്ച ഏജന്റിന് API വഴി സ്വന്തം scope-ലെ leads വായിക്കാം.
4. ഒരു ടീം-വരി: "Team: … new leads waiting" എണ്ണത്തിൽ ആർക്കും ഏൽപ്പിക്കാത്ത pool leads ഇല്ല (അത് "Unassigned leads" ടൈലിൽ).
5. `WhatsAppQrButton`-ന് `aria-label` ഇല്ല (title മാത്രം): ആ ഘടകം ഈ ജോലിയുടെ പരിധിക്ക് പുറത്താണ്.
6. പഴയ കൈകൊണ്ടുള്ള to-do പേജ് (`/tasks`) ഇപ്പോൾ ക്ലാസിക് dashboard ടൈലിൽ നിന്നും Tasks ടാബിന്റെ താഴത്തെ ചെറിയ ലിങ്കിൽ നിന്നും മാത്രമേ എത്താൻ കഴിയൂ.
7. ഏകദേശം 35 database queries ഒരു cache-miss-ൽ (30 സെക്കൻഡ് cache + മിനിറ്റിൽ 30 അഭ്യർത്ഥന പരിധി കൊണ്ട് നിയന്ത്രിക്കുന്നു). 50k leads / 100k messages ഉള്ള `crm_prod_copy`-ൽ അളക്കുന്നതുവരെ വലിയ account-ന് ഉറപ്പ് പറയാൻ കഴിയില്ല.

**"Assigned only" സ്വിച്ച്:** ഇത് ഒരു ചോർച്ചയായിരുന്നില്ല (Inbox ഏജന്റുമാരെ റോൾ അനുസരിച്ച് തന്നെ പരിമിതപ്പെടുത്തുന്നു); സ്വിച്ച് ഒന്നും ചെയ്യുന്നില്ലായിരുന്നു. നിങ്ങൾ അത് നീക്കാൻ തീരുമാനിച്ചു; മറ്റേ സെഷൻ അത് ചെയ്യുന്നു. Dashboard ഇപ്പോഴും API ഫീൽഡ് (`restrict_to_assigned`) വായിച്ച് കർശനമായി സ്വന്തം scope നൽകുന്നു.

അടിസ്ഥാനം: നമ്മുടെ code വായിച്ചുള്ള പരിശോധന (ഇപ്പോഴത്തെ dashboard, പുതിയ Reports, ഡാറ്റ ലഭ്യത), 91Leads-ന്റെ dashboard-ഉം 15 Features പേജുകളും, WhatsApp CRM-കളുടെ (Kommo, TimelinesAI, Corefactors) analytics രേഖകൾ, dashboard ഡിസൈൻ ഗൈഡുകൾ, `dataviz` നിയമങ്ങൾ. ദൃശ്യ മാതൃക: `scratchpad\dashboard-mock\index.html` (ഈ ഫയലിന്റെ അവസാനം കാണുക).

**ഏത് വ്യവസായത്തിനും ചേരണം.** പരിശീലന സ്ഥാപനം, ആശുപത്രി, കട, real estate എന്നിവയ്ക്ക് ഒരേ dashboard. ഒരു customer-ന്റെ വാക്കുകൾ code-ൽ ഇല്ല. ഘട്ടങ്ങൾ (funnel) ഓരോ business-ന്റെയും സ്വന്തം `LeadSettings.funnel_stages` ആണ് (`DESIGN.md` §1, Reports plan §4).

---

## 1. ഇപ്പോഴത്തെ dashboard എന്താണ്, എന്താണ് തെറ്റ്

ഇത് **സന്ദേശ പ്രവർത്തനത്തിന്റെ** സ്ക്രീനാണ്. ഉടമ ചോദിക്കുന്നത് ഫലത്തെക്കുറിച്ചാണ്.

| ഇപ്പോൾ കാണിക്കുന്നത് | ഉടമയ്ക്ക് വേണ്ടത് |
|---|---|
| Active conversations, New contacts today, Messages sent today, Hot leads | പുതിയ leads, നേടിയത്, വരുമാനം, pipeline തുക |
| Conversation trend (വന്നത് vs പോയത്) | എവിടെയാണ് leads ചോർന്നുപോകുന്നത് |
| Recent activity (6 വരി) | ഇപ്പോൾ ആരെങ്കിലും ചെയ്യേണ്ട കാര്യങ്ങൾ |
| Team table (picked, calls, won, lost) | ഏത് agent-ന് സഹായം വേണം |
| പണം, പരസ്യം, പേയ്മെന്റ്, channel ആരോഗ്യം: **ഒന്നുമില്ല** | ഇവ ഓരോന്നും |

### കോഡ് പരിശോധനയിൽ കണ്ടത് (ഫയലും വരിയും സഹിതം)

| പ്രശ്നം | എവിടെ |
|---|---|
| **Reports-മായി 7 നിർവചനങ്ങളിൽ വിയോജിപ്പ്** (താഴെ 4-ാം ഭാഗം) | `lib/dashboard/queries.ts` vs `lib/reports/summary.ts` |
| Dashboard ഒരു lead "closed" എന്ന് മാത്രം കാണുന്നു; won/lost വേർതിരിവില്ല | `loadCRMStats` |
| Hidden, AI-suggested leads എണ്ണത്തിൽ കൂടുന്നു | `loadCRMStats` |
| Server clock ഉപയോഗം (ബഗ് നിയമം 10) | `loadCRMStats` (`new Date()`), `performance/route.ts:46` (`Date.now()`) |
| **എല്ലാ message-ഉം മെമ്മറിയിൽ എടുത്ത് JS-ൽ എണ്ണുന്നു** (100k message ഉള്ള account-ൽ പതുക്കെയാകും) | `loadConversationsSeries`, `loadResponseTime`, `loadSparks` |
| `restrict_to_assigned` dashboard code വായിക്കുന്നില്ല: ആ flag ഉള്ള, agent അല്ലാത്ത ഒരാൾ account-wide എണ്ണം കാണും | `api/dashboard/route.ts` (`agentId` = role "agent" ആകുമ്പോൾ മാത്രം) |
| Viewer-ന് account-wide എണ്ണങ്ങൾ കിട്ടുന്നു | അതേ route |
| Plain `fetch` (ബഗ് നിയമം 7), error ശൂന്യമായി മറയ്ക്കുന്നു (നിയമം 3) | `page.tsx:202, 331`, `TeamTable` |
| 👋 emoji, gradient പശ്ചാത്തലം, Title Case തലക്കെട്ടുകൾ, hex നിറങ്ങൾ: `DESIGN.md` §7 വിലക്കുന്നവ | `page.tsx:372, 380` |
| UI വാക്കുകൾ മുഴുവൻ ഇംഗ്ലീഷിൽ ഉറപ്പിച്ചത്; i18n ഇല്ല | മുഴുവൻ |
| **9 ഫയൽ ഉപയോഗിക്കുന്നില്ല** (`activity-feed`, `agent-dashboard`, `conversations-chart`, `metric-card`, `my-performance`, `quick-actions`, `response-time-chart`, `empty-state`, `skeleton`) | `components/dashboard/` |
| Auto-refresh ഇല്ല (പേജ് തുറന്നപ്പോഴത്തെ കണക്ക് മാത്രം) | `page.tsx` |
| UI kit-ൽ skeleton, empty state, spinner, chart ഘടകങ്ങൾ ഇല്ല; ഓരോ പേജും സ്വന്തമായി ഉണ്ടാക്കുന്നു | `components/ui` (24 ഫയൽ) |

ഇവയിൽ **restrict_to_assigned**, **viewer-ന് account-wide ഡാറ്റ** എന്നിവ സ്വകാര്യതയുടെ പ്രശ്നമാണ്. ഇവ ഡിസൈൻ പോലെ കാത്തിരിക്കാവുന്നതല്ല: Phase 0-ൽ തന്നെ ശരിയാക്കണം.

## 2. 91Leads-ൽ നിന്ന് എന്ത് പഠിക്കാം, എന്ത് ഒഴിവാക്കണം

നിങ്ങൾ അയച്ച dashboard ചിത്രത്തിൽ നിന്ന്. (15 Features പേജുകളുടെ സ്ക്രീൻഷോട്ട് വിശകലനം 11-ാം ഭാഗത്ത് ചേർക്കും.)

**എടുക്കാവുന്നത്:**
- മുകളിൽ ഒറ്റ നിരയിൽ 5 സംഖ്യകൾ: Follow-ups today, Total leads, Active pipeline, Won (win rate സഹിതം), Lost/Junk. ഓരോന്നിലും ഒരു വരി സന്ദർഭം ("94% of total", "4% win rate").
- Follow-ups: Overdue / Due today / Next 7 days + മാസ calendar, ഓരോ ദിവസത്തിലെ എണ്ണം, "ദിവസം അമർത്തിയാൽ തുറക്കും".
- Agent board: ഒരു വരിയിൽ ഒരാൾ.
- Source അനുസരിച്ച് leads.
- Light/Dark മാറ്റം.

**ഒഴിവാക്കേണ്ടത്:**

| അവരുടെ രീതി | എന്തുകൊണ്ട് മോശം | നമ്മൾ |
|---|---|---|
| 14 കഷണമുള്ള donut + 14 കാർഡ് | ഒരേ കാര്യം രണ്ടുതവണ; കഷണങ്ങൾ താരതമ്യം ചെയ്യാൻ പറ്റില്ല; 14 നിറം | ക്രമത്തിൽ അടുക്കിയ വരകൾ (bars), ഏറ്റവും വലിയ 6 + "മറ്റുള്ളവ" |
| 13 കഷണമുള്ള pie (source) | `dataviz`: 8 നിറത്തിൽ കൂടരുത്; WCAG 1.4.11-ന് 3:1 വേണം | അടുക്കിയ വരകൾ, നേരിട്ടുള്ള ലേബൽ |
| ഓരോ status-നും വേറെ നിറം (rainbow) | നിറം അർത്ഥം പറയണം, അലങ്കാരമല്ല | ഒരു നിറം, ഘട്ടം ക്രമത്തിൽ ഇരുണ്ടുവരുന്നു |
| "Top status: No Response • 201" | ഒന്നും ചെയ്യാനില്ല | "ഇത് ചെയ്യണം" എന്ന ഭാഗം |
| 247 overdue കാണിക്കുന്നു, തുറക്കാനുള്ള വഴിയില്ല | അലാറം മാത്രം, നടപടിയില്ല | ഓരോ സംഖ്യയും അമർത്തിയാൽ ആ പട്ടിക |
| **പണം ഇല്ല**, response time ഇല്ല | ഉടമയുടെ ആദ്യ ചോദ്യം | വരുമാനം, pipeline തുക, ആദ്യ മറുപടി സമയം |
| Agent table-ൽ "Duplicate", "Junk" കോളങ്ങൾ | ഉടമയ്ക്ക് ഒരു agent-നെക്കുറിച്ച് അറിയേണ്ടത് അതല്ല | Leads, calls, won, overdue, ആദ്യ മറുപടി |

**പകർത്തരുത്:** അവരുടെ ലോഗോ, നിറങ്ങൾ, ചിത്രങ്ങൾ, വാക്കുകൾ. ഘടനയിൽ നിന്നുള്ള ആശയങ്ങൾ മാത്രം. നമ്മുടെ രൂപം `DESIGN.md` തന്നെ.

## 3. ഉടമയുടെ ചോദ്യങ്ങൾ, Dashboard vs Reports

Reports plan-ലെ 5 ചോദ്യങ്ങൾ തന്നെ. ഇവ രണ്ടും കൂടിക്കലരാതിരിക്കാൻ ഒരു നിയമം:

| | Dashboard | Reports |
|---|---|---|
| ചോദ്യം | **ഇപ്പോൾ എന്ത് ചെയ്യണം?** | **ഈ കാലയളവ് എങ്ങനെ പോയി?** |
| സമയം | ഇന്ന്, ഈ മാസം ഇതുവരെ | ഏത് കാലയളവും, താരതമ്യം, Excel |
| ആഴം | ഒരു സ്ക്രീൻ, പരമാവധി ~9 കാഴ്ച | വിശദമായ ഭാഗങ്ങൾ |
| സംഖ്യ | Reports-ൽ നിന്നുള്ള **അതേ** സംഖ്യ | നിർവചനത്തിന്റെ ഉറവിടം |

**നിയമം: Dashboard ഒരു സംഖ്യയും സ്വന്തമായി കണക്കാക്കരുത്.** എല്ലാം `lib/reports/summary.ts`-ലെ അതേ ഫംഗ്ഷനുകളിൽ നിന്ന്. അല്ലെങ്കിൽ ഉടമ രണ്ട് സ്ക്രീനിൽ രണ്ട് "Won" കാണും.

## 4. നിർവചനങ്ങളുടെ വിയോജിപ്പ്: ആദ്യം തീർക്കേണ്ടത്

(ഡാറ്റ ഏജന്റിന്റെ പരിശോധന, `summary.ts` vs `queries.ts`.)

| വിഷയം | ഇപ്പോഴത്തെ Dashboard | Reports | തീരുമാനം (നിർദ്ദേശം) |
|---|---|---|---|
| Calls എണ്ണം | `stage_change` activity എണ്ണുന്നു | `lead_activities type='call'` + connected | Reports-ന്റേത് |
| ആദ്യ മറുപടി സമയം | 14 ദിവസത്തെ message ജോടികളുടെ ശരാശരി, bot മറുപടിയും എണ്ണും | Lead-ന്റെ `first_response_at` − `created_at`, **മനുഷ്യന്റെ** മറുപടി, median | Reports-ന്റേത്. Bot മറുപടി വേറെ കാഴ്ച |
| Hot lead | `score='hot'`, closed അല്ലാത്തത് | ഇല്ല | Dashboard-ൽ നിന്ന് നീക്കം. പകരം "ശ്രദ്ധ വേണ്ടത്" |
| Active / open | `conversations.status='open'` | Lead: `status <> 'closed'` | രണ്ടിനും പേര് വേർതിരിക്കും: "തുറന്ന chats", "തുറന്ന leads" |
| Won / lost | Raw `closed` എണ്ണം മാത്രം; hidden, AI-suggested ഉൾപ്പെടും | `outcomeOf`, `converted_at`/`lost_at`; hidden, AI-suggested **ഒഴിവാക്കും** | Reports-ന്റേത് |
| ആരുടെ പ്രവൃത്തി | `assigned_to` (നിലവിലെ ഉടമ) | `closed_by` | `closed_by` |
| കാത്തിരിക്കുന്ന chat | ഇല്ല | unread > 0, N മണിക്കൂറിൽ കൂടുതൽ | Reports-ന്റേത്, ക്രമീകരിക്കാവുന്ന പരിധി (`leakHours`) |

## 5. ഡിസൈൻ നിയമങ്ങൾ (ഗവേഷണത്തിൽ നിന്ന്)

**കണ്ടെത്തിയ കാര്യങ്ങൾ** (ഉറവിടങ്ങൾ 11-ാം ഭാഗത്ത്; മിക്കതും vendor blog-കളാണ്, സംഖ്യകൾക്ക് തെളിവ് ഇല്ല, ദിശയായി മാത്രം എടുക്കുക):
- KPI എണ്ണം: ഒരാൾക്ക് 3–5 (Plecto), മുഴുവൻ dashboard-ൽ 5–10 (SimpleKPI), ഒരു സ്ക്രീനിൽ പരമാവധി 9 കാഴ്ച, 20+ chart തെറ്റ്.
- "സംശയമുണ്ടെങ്കിൽ ഒഴിവാക്കുക", "ആരെങ്കിലും നടപടിയെടുക്കുന്നില്ലെങ്കിൽ ചേർക്കരുത്."
- സന്ദർഭം: എപ്പോഴും താരതമ്യം (കഴിഞ്ഞ മാസത്തോട്) അല്ലെങ്കിൽ ലക്ഷ്യം. ലക്ഷ്യം ദിവസക്കണക്കിൽ **അനുപാതത്തിൽ** (ഈ മാസം ലക്ഷ്യത്തിന്റെ 10 ദിവസത്തെ ഭാഗം), അല്ലെങ്കിൽ മാസത്തിലെ മിക്ക ദിവസവും ചുവപ്പായിരിക്കും (Plecto).
- Pie: trend-ന് ഉപയോഗിക്കരുത്; 3D വേണ്ട; trend-ന് line, താരതമ്യത്തിന് bar.
- Audience അനുസരിച്ച് വേർതിരിക്കുക: ഉടമ, മാനേജർ, agent.
- ചിത്ര ലഭ്യത: WCAG 1.4.11 (ചാർട്ട് ഭാഗങ്ങൾക്ക് 3:1), 1.4.1 (നിറം മാത്രം പോരാ), ഒരു ചാർട്ടിൽ ~6–8 നിറത്തിൽ കൂടരുത്.
- **Speed to lead:** 5 മിനിറ്റിനുള്ളിൽ ബന്ധപ്പെട്ടാൽ 30 മിനിറ്റിനുശേഷത്തേക്കാൾ ~21 മടങ്ങ് സാധ്യത (MIT/InsideSales, 2007); ഒരു മണിക്കൂറിനുള്ളിൽ ~7 മടങ്ങ് (HBR, 2011). പഴയതും പലപ്പോഴും തെറ്റായി ആരോപിക്കപ്പെടുന്നതുമായ പഠനങ്ങൾ. **ഉപഭോക്താക്കളോട് ഈ സംഖ്യ വാഗ്ദാനം ചെയ്യരുത്.** ദിശയായി മാത്രം; നമ്മുടെ പരിധി ക്രമീകരിക്കാവുന്നതാണ്.
- WhatsApp CRM-കളുടെ പൊതു കാതൽ (Kommo, TimelinesAI, Corefactors): സന്ദേശ/chat എണ്ണം, ആദ്യ മറുപടി സമയം, agent പ്രകടനം, conversion. **ഓരോ vendor-ഉം വ്യത്യസ്തമായി നിർവചിക്കുന്നു** ("response rate", "conversion", "unanswered" ഒരു പേജിലും നിർവചിച്ചിട്ടില്ല). നമുക്ക് അവസരം: ഓരോ സംഖ്യയ്ക്കും അതിന്റെ അർത്ഥം അമർത്തിയാൽ കാണിക്കുക.

**നമ്മുടെ നിയമങ്ങൾ:**
1. **ഓരോ സംഖ്യയും അമർത്താം** (Reports നിയമം 2): അതിന് പിന്നിലെ പട്ടിക തുറക്കും. ഇതിന് `/follow-ups`, `/tasks`, `/calls`, `/pipelines`, `/broadcasts` എന്നിവയ്ക്ക് URL filter വേണം (ഇപ്പോൾ `/leads?tab=` ഉം `/inbox?c=` ഉം മാത്രമേ ഉള്ളൂ).
2. ഓരോ സംഖ്യയ്ക്കും താരതമ്യം: കഴിഞ്ഞ കാലയളവിന്റെ അതേ ദിവസങ്ങളോട് ("1–8 ഒക്ടോബറിനോട്"). ഇതിൽ കുറവ് ഡാറ്റ ഉള്ളപ്പോൾ "മാറ്റം" കാണിക്കില്ല.
3. ചെറിയ എണ്ണം (20-ൽ താഴെ) മങ്ങിച്ച് എണ്ണം സഹിതം (Reports നിയമം 7).
4. Business സമയമേഖല മാത്രം. Server clock ഇല്ല.
5. നിറം: **അർത്ഥത്തിന് മാത്രം.** Status നിറങ്ങൾ (നല്ലത്/മുന്നറിയിപ്പ്/ഗുരുതരം) എപ്പോഴും ഐക്കൺ + വാക്കിനൊപ്പം, നിറം മാത്രം പോരാ.
6. ഒരു അക്ഷം മാത്രം. പണവും എണ്ണവും ഒരേ chart-ൽ വേണ്ട.
7. ഓരോ വിജറ്റിനും സ്വന്തം empty, loading, error അവസ്ഥ. ഒരു വിജറ്റ് പരാജയപ്പെട്ടാൽ പേജ് മുഴുവൻ തകരരുത്.
8. ഫോൺ ആദ്യം: ഉടമ ഫോണിൽ കാണുന്നു. 360px-ൽ ക്രമം: ശ്രദ്ധ → സംഖ്യകൾ → follow-ups → funnel → source → team.
9. **Emoji, gradient ഇല്ല** (`DESIGN.md` §7).
10. പ്രവേശനക്ഷമത: ചാർട്ടിന് പട്ടിക കാഴ്ച (table view), കീബോർഡ് ഫോക്കസ്, `prefers-reduced-motion`.

### ചാർട്ട് നിറങ്ങൾ: പരിശോധിച്ചത്

`dataviz` skill-ലെ പരിശോധന സ്ക്രിപ്റ്റ് നമ്മുടെ യഥാർത്ഥ പശ്ചാത്തലങ്ങളിൽ ഓടിച്ചു (ലൈറ്റ്: വെള്ള കാർഡ്; ഡാർക്ക്: ~`#181a1f`):
- **8 നിറക്കൂട്ട് ലൈറ്റിലും ഡാർക്കിലും വിജയിച്ചു** (CVD അടുത്തടുത്ത ജോഡി ΔE 9.1 / 8.4, സാധാരണ കാഴ്ച 19.6 / 19.3).
- **ഒരു മുന്നറിയിപ്പ് (ലൈറ്റ്):** aqua, മഞ്ഞ, magenta എന്നിവ വെള്ളയിൽ 3:1-ന് താഴെ. അതിനാൽ **നേരിട്ടുള്ള ലേബൽ നിർബന്ധം.**
- **ബ്രാൻഡ് പച്ച `#25D366` വെള്ളയിൽ ഏകദേശം 2:1 മാത്രം:** chart നിറമായോ ടെക്സ്റ്റ് നിറമായോ ഉപയോഗിക്കരുത്. ഇപ്പോഴത്തെ dashboard-ൽ `text-primary` (greeting) ഇതിൽ പെടുന്നു. ബട്ടണിൽ പച്ച പശ്ചാത്തലത്തിൽ **ഇരുണ്ട** ടെക്സ്റ്റ്.
- `globals.css`-ലെ `--chart-1..5` ഇപ്പോൾ ഒരിടത്തും ഉപയോഗിക്കുന്നില്ല. അവ 8 പരിശോധിച്ച നിറങ്ങളായി മാറ്റി, ഡാർക്ക് തീമുകൾക്ക് വേറെ ഘട്ടങ്ങളും (5 തീമിലും വീണ്ടും പരിശോധിക്കണം).

## 6. പുതിയ ലേഔട്ട് (ദൃശ്യ മാതൃക അനുസരിച്ച്)

```
┌──────────────────────────────────────────────────────────────────┐
│ Good morning, Anjali            [Today|7 days|This month|Custom] [Add lead] │
├──────────────────────────────────────────────────────────────────┤
│ 1  ഇപ്പോൾ ശ്രദ്ധ വേണ്ടത്  (4 കാർഡ്, ഓരോന്നും ഒരു പട്ടിക തുറക്കും)       │
│    Overdue follow-ups · Waiting for reply · New leads not contacted · Missed calls │
├──────────────────────────────────────────────────────────────────┤
│ 2  സംഖ്യകൾ (5):  New leads | Won + revenue | Open pipeline | Win rate | First reply (median) │
├────────────────────────────────┬─────────────────────────────────┤
│ 3  എവിടെ ചോരുന്നു (funnel)      │ 4  Source അനുസരിച്ച് leads + won % │
├────────────────────────────────┼─────────────────────────────────┤
│ 5  Follow-ups + മാസ calendar    │ 6  Team (supervisor, owner)       │
├────────────────────────────────┴─────────────────────────────────┤
│ 7  Revenue | Marketing (ad spend, cost/lead) | Channel health (owner, admin) │
└──────────────────────────────────────────────────────────────────┘
```

| ഭാഗം | ഉള്ളടക്കം | ഉറവിടം | ഇന്ന് ഉണ്ടോ |
|---|---|---|---|
| 1 ശ്രദ്ധ | Overdue follow-ups; Waiting for reply (N മിനിറ്റ്); New leads not contacted; Missed calls | Reports `leaks()`; calls table | ഭൂരിഭാഗവും ഉണ്ട് |
| 2 സംഖ്യകൾ | New leads; Won + വരുമാനം; Open pipeline (deals-ൽ തുകയില്ലാത്തവ എത്ര എന്ന് സഹിതം); Win rate; ആദ്യ മറുപടി median | `buildSummary` | ഉണ്ട് |
| 3 Funnel | ബിസിനസിന്റെ സ്വന്തം ഘട്ടങ്ങൾ, "ഒരിക്കലെങ്കിലും എത്തിയത്"; ഏറ്റവും വലിയ കുറവ് ഒരു വരിയിൽ | `countFunnel` | ഉണ്ട് |
| 4 Source | ഏറ്റവും വലിയ 6 + "മറ്റുള്ളവ", ഓരോന്നിനും won % | cohort by source | ഉണ്ട് (ദിവസ വിഭജനം ഇല്ല) |
| 5 Follow-ups | Overdue / Today / Next 7 days + calendar (ദിവസ എണ്ണം, അമർത്താം) | `follow_ups` | എണ്ണം ഉണ്ട്, **മാസ calendar helper ഇല്ല** |
| 6 Team | Leads, calls (reached), won, overdue, ആദ്യ മറുപടി; ഏറ്റവും വലിയ പ്രശ്നം ഒരു വരിയിൽ | Reports `agents()` | ഉണ്ട് |
| 7 പണം | വരുമാന trend (ഒരു വര); Ad spend, cost per lead, cost per won; Payments received | deals; Meta + manual spend; `whatsapp_payments` | ഭാഗികം |
| 7 Channel health | WhatsApp connection; quality rating; rejected templates; failed sends | `whatsapp_configs`, `message_templates` | **Quality rating ഇല്ല** |

**ഒഴിവാക്കിയത്/മാറ്റിയത്:** Conversation trend, Response-time chart, Recent activity, Hot leads, "Messages sent today". ഇവ Inbox/Reports-ലേക്കോ പിന്നീട് "Conversations" ടാബിലേക്കോ പോകും (തീരുമാനം D6).

### റോൾ അനുസരിച്ച്

| റോൾ | കാണുന്നത് |
|---|---|
| Owner, Admin | എല്ലാം, പണം ഉൾപ്പെടെ |
| Supervisor | 1–6 (team, ടീം മുഴുവൻ). പണം: തീരുമാനം D1 |
| Agent | **"എന്റെ ദിവസം"**: എന്റെ follow-ups, എന്റെ പുതിയ leads, എന്റെ waiting chats, എന്റെ സംഖ്യകൾ. Team ഇല്ല, പണം ഇല്ല |
| Viewer | തീരുമാനം D7 (നിർദ്ദേശം: സ്വന്തം scope, അല്ലെങ്കിൽ ഒന്നുമില്ല. ഇപ്പോൾ account-wide കാണുന്നത് തെറ്റ്) |

എല്ലായിടത്തും `restrict_to_assigned` ബഹുമാനിക്കും.

### Task എന്നാൽ എന്ത്: നിങ്ങൾ നിർവചിച്ചത് (8 നവംബർ 2026)

ഇതുവരെ Leads പേജിലെ "Tasks" ടാബ് നിർവചിച്ചിരുന്നില്ല: അത് കൈകൊണ്ട് എഴുതുന്ന പഴയ to-do മാത്രം കാണിച്ചിരുന്നു. പുതിയ നിർവചനം **ഒരിടത്ത് മാത്രം** (`lib/leads/my-tasks.ts`), Leads പേജും dashboard-ഉം ഒരേ സംഖ്യ കാണിക്കാൻ:

| വിഭാഗം | എന്താണ് | കുറിപ്പ് |
|---|---|---|
| **Overdue** (ചുവപ്പ്) | എന്റെ pending follow-ups, `due_at` കഴിഞ്ഞവ | Reports-ലെ "overdue follow-ups"-ന്റെ അതേ നിയമം (സമയം കഴിഞ്ഞാൽ), അതിനാൽ രണ്ടിടത്തും ഒരേ സംഖ്യ |
| **ഇന്ന് due** | ഇന്ന് ഇനി വരാനുള്ള pending follow-ups, സമയക്രമത്തിൽ | ഉപഭോക്താവ് "ഇന്ന് 4:30-ന് വിളിക്കൂ", "മറ്റന്നാൾ വിളിക്കൂ" എന്ന് പറഞ്ഞ് agent സെറ്റ് ചെയ്യുന്നവ; മുൻപേ ഇന്നത്തേക്ക് തീയതി വെച്ചവയും |
| **എനിക്ക് പുതിയത്** | status "new" ആയ എന്റെ leads: manager/admin ഏൽപ്പിച്ചവ, ഞാൻ pick ചെയ്തവ, ഞാൻ **കൈകൊണ്ട്** ഉണ്ടാക്കിയവ | ഓട്ടോമാറ്റിക് leads (Facebook, flows, AI) "ഞാൻ ഉണ്ടാക്കിയത്" ആയി എണ്ണില്ല: അവയുടെ `user_id` ഉടമയോ system-ഓ ആണ് |

- **ഇന്നത്തെ tasks** = ഇന്ന് due + എനിക്ക് പുതിയത്.
- **Pending** = വെവ്വേറെ രണ്ട് സംഖ്യ: എന്റെ തുറന്ന leads, എന്റെ pending follow-ups (ഒരു lead-ഉം അതിന്റെ follow-up-ഉം രണ്ടായി എണ്ണും: നിങ്ങളുടെ തീരുമാനം).
- **Manager, Admin, Owner:** സ്വന്തം list (ഇതേ നിർവചനം) + ടീമിന്റെ മൊത്തം സംഖ്യ ഒരു വരിയിൽ.
- പഴയ കൈകൊണ്ടുള്ള to-do (`/tasks` പേജ്) അതേപടി തുടരുന്നു; ഇതിൽ ചേരില്ല.

**എന്റെ അനുമാനങ്ങൾ (തിരുത്തണമെങ്കിൽ പറയുക):**
1. "Due ആയത്": സമയം കഴിഞ്ഞവ ചുവപ്പിൽ Overdue; ഇന്ന് ഇനി വരാനുള്ളവ "ഇന്ന് due". അതുകൊണ്ട് ദിവസം പോകുന്തോറും ചില task "ഇന്ന്" ൽ നിന്ന് "Overdue" ലേക്ക് മാറും. (Reports-മായി ഒരേ സംഖ്യ കിട്ടാൻ.)
2. "ഞാൻ ഉണ്ടാക്കിയ lead" = ആരുടെയും പേരിൽ ഏൽപ്പിക്കാതെ, കൈകൊണ്ട് ഉണ്ടാക്കിയ/import ചെയ്ത leads.
3. "Overdue" എന്നത് follow-ups മാത്രം. ദീർഘകാലം തൊടാത്ത leads ഇതിൽ ചേർത്തിട്ടില്ല.

## 7. ഡാറ്റയും API

- **ഒരു endpoint:** `GET /api/dashboard/owner` (റോൾ അനുസരിച്ച് ഭാഗങ്ങൾ). `requireRole` + `assertPageAccess('/dashboard')` + `checkRateLimit`. ഓരോ query-യിലും `account_id`.
- **Reports-ന്റെ `buildSummary` നേരിട്ട് വിളിക്കും.** (ആദ്യ പതിപ്പിൽ ഞാൻ എഴുതിയ "ഫംഗ്ഷനുകൾ export ചെയ്യണം" എന്നത് തെറ്റായ നിഗമനമായിരുന്നു: കോഡ് വായിച്ചപ്പോൾ `buildSummary` ഇതിനകം cohort, won/lost, വരുമാനം, pipeline, source, funnel, ചോർച്ച പട്ടികകൾ, team എന്നിവ തരുന്നു.) ഇത് കനത്ത വിളിയായതിനാൽ 30 സെക്കൻഡ് server cache. ടീമിന്റെ മൊത്തം ആദ്യ-മറുപടി median മാത്രം `summary.ts`-ൽ ചേർക്കുന്ന ഒരു ചെറിയ ഫംഗ്ഷൻ. Test: **ഒരേ ഡാറ്റയിൽ Dashboard സംഖ്യ = Report സംഖ്യ.**
- **ചെറിയ server cache** (account + scope അനുസരിച്ച്, 30–120 സെക്കൻഡ്). പേജ് `everyWhileVisible` കൊണ്ട് 60 സെക്കൻഡിൽ പുതുക്കും, "20 സെക്കൻഡ് മുൻപ് പുതുക്കി · Refresh" കാണിക്കും. `apiFetch` + `loadSeq`.
- **കനത്ത queries മാറ്റും:** message trend, response time, sparks ഇപ്പോൾ എല്ലാ message-ഉം എടുക്കുന്നു. SQL-ൽ group ചെയ്യുക, ആവശ്യമെങ്കിൽ ദിവസ rollup table.
- **Business സമയം:** `businessTimezone`, `dayStartIso`, `zoneForSql`. Task `due_date` തീയതി മാത്രം ആയതിനാൽ business തീയതിയുമായി താരതമ്യം.

### Migration ആവശ്യമുള്ള ഡാറ്റ വിടവുകൾ (വിവരണം മാത്രം, SQL എഴുതിയിട്ടില്ല)

| വിടവ് | എന്തിന് |
|---|---|
| `conversations.last_inbound_at`, `last_outbound_at` (+ index) | "N മിനിറ്റായി മറുപടി കാത്തിരിക്കുന്നു" കൃത്യമായി (`unread_count>0` അല്ല) |
| `whatsapp_configs`: quality rating, messaging tier, ആരോഗ്യ പരിശോധന സമയം | Channel health (ഇപ്പോൾ Meta-യുടെ webhook ഒരു push മാത്രമാണ്, സൂക്ഷിക്കുന്നില്ല) |
| ദിവസ-തോറും ad spend table | Cost per won lead; Meta ഓരോ page-view-വിലും വിളിക്കേണ്ട |
| Payments ഏകീകരണം | `whatsapp_payments` മാത്രമേ ഉള്ളൂ; PhonePe, Razorpay link-കൾ വേറെ |
| ആദ്യ മനുഷ്യ മറുപടി / bot-ഉം മനുഷ്യനും വേർതിരിവ് rollup | AI share, handover നിരക്ക് |
| `leads.first_response_at`, failed `messages` എന്നിവയ്ക്ക് index | വേഗം |

എല്ലാ migration-ഉം: രണ്ടുതവണ ഓടിച്ചാലും സുരക്ഷിതം, rollback സഹിതം, `crm_prod_copy`-ൽ `BEGIN … ROLLBACK` dry-run ആദ്യം (AGENTS.md).

## 8. നിർമ്മാണ ഘട്ടങ്ങൾ

ഓരോ ഘട്ടത്തിലും: ആദ്യം പരാജയപ്പെടുന്ന test, `npm test` പച്ച, `crm-ui-review` skill, 360px-ലും ഒരു dark theme-ലും Playwright നോട്ടം, `break-ui` (നീളമുള്ള മലയാളം പേരുകൾ, ശൂന്യ ഡാറ്റ, വലിയ സംഖ്യ).

### Phase 0: അടിത്തറ (ദൃശ്യ മാറ്റമില്ല)
- `restrict_to_assigned` ബഹുമാനിക്കുക; viewer-ന്റെ account-wide ഡാറ്റ അടയ്ക്കുക. **ആദ്യം test.**
- Dashboard-ലെ server clock മാറ്റുക (`loadCRMStats`, `performance/route.ts`).
- "Dashboard = Report" test (`buildSummary` നേരിട്ട് ഉപയോഗിക്കുന്നതിനാൽ export ആവശ്യമില്ല).
- ഉപയോഗിക്കാത്ത 9 ഫയൽ നീക്കുക.
- പങ്കുവെച്ച `Skeleton`, `EmptyState`, `ErrorBanner`, `Delta`, `InfoTip` ഘടകങ്ങൾ `components/ui`-ൽ.
- Chart നിറ tokens (8, ലൈറ്റ്/ഡാർക്ക്, 5 തീമിലും പരിശോധിച്ചത്).

### Phase 1: Owner dashboard കാതൽ (നിലവിലെ ഡാറ്റ കൊണ്ട്)
- ശ്രദ്ധ വേണ്ടത്, **നിങ്ങളുടെ Task ഭാഗം (Overdue, ഇന്ന് due, എനിക്ക് പുതിയത്, pending)**, 5 സംഖ്യകൾ, funnel, source, follow-ups (calendar ഇല്ലാതെ), Team.
- **Leads പേജിലെ "Tasks" ടാബ് പുതിയ നിർവചനത്തിൽ** (dashboard-ലെ അതേ ലൈബ്രറി, ഒരേ സംഖ്യ).
- `/follow-ups?due=overdue|today|next7`, `/calls?status=missed&day=today` എന്നീ filter-കൾ (dashboard-ൽ നിന്ന് അമർത്തുമ്പോൾ ശരിയായ പട്ടിക തുറക്കാൻ).
- "എന്റെ ദിവസം" (agent): എന്റെ follow-ups, പുതിയ leads, waiting chats, എന്റെ സംഖ്യകൾ, കൂടാതെ **"അടുത്തതായി ആരെ വിളിക്കണം/മറുപടി നൽകണം" എന്ന ഒറ്റ ക്യൂ** (91Leads Click-to-Call ആശയം). Drill-down URL filter-കൾ: `/follow-ups`, `/tasks`, `/calls`.
- Agent-ന് അല്ലാത്തവർക്ക് ഫോൺ നമ്പർ മറച്ചുകാണിക്കണോ എന്ന് (നിലവിലെ അനുമതി അനുസരിച്ച്) പരിശോധിക്കുക.
- പുതിയ dashboard **ഒരു switch-ന് പിന്നിൽ** ആദ്യം (തീരുമാനം D5).

### Phase 2: Calendar, response time, drill-down പൂർണ്ണം
- മാസ calendar + ദിവസ എണ്ണം (പുതിയ query), `conversations.last_inbound_at` migration, "കാത്തിരിക്കുന്ന chats" കൃത്യമായി.

### Phase 3: പണവും marketing
- Payments (ഏകീകൃത helper), ad spend table + cost per lead/won, broadcast ഫലങ്ങൾ.
- വരുമാനത്തിന് **ഈ മാസം / കഴിഞ്ഞ മാസം (അതേ ദിവസങ്ങൾ) / ഈ വർഷം** (91Leads Expense ആശയം).

### Phase 4: Channel health
- Quality rating, tier, failed sends, rejected templates; AI share.
- ഓരോ lead source-നും "connected · അവസാന lead 2 മിനിറ്റ് മുൻപ്" എന്ന ആരോഗ്യ വരി (91Leads Integrations ആശയം); നിശ്ശബ്ദമായി നിലച്ച source ഉടമ അറിയണം.

### Phase 5: വ്യക്തിഗതമാക്കൽ
- ലക്ഷ്യങ്ങൾ (മാസ ലക്ഷ്യത്തിന്റെ % അനുപാതത്തിൽ), വിജറ്റ് മറയ്ക്കൽ, saved views.

## 9. അപകടങ്ങൾ

| അപകടം | പരിഹാരം |
|---|---|
| ഉടമ പഴയ സംഖ്യയും പുതിയതും താരതമ്യം ചെയ്ത് ഞെട്ടും (Hot leads, Total leads മാറും) | സ്വിച്ച്, മാറ്റത്തിന്റെ കുറിപ്പ്, ഓരോ സംഖ്യയ്ക്കും അർത്ഥം |
| കനത്ത queries വേഗം കുറയ്ക്കും | cache, rollup, index, വിജറ്റ് തിരിച്ച് ലോഡ് |
| പണം ഡാറ്റ ശുദ്ധമല്ല (deals-ൽ തുക 0, `won_at` ഇല്ലാത്തവ) | "X deals-ന് തുകയില്ല" എന്ന് കാണിക്കുക (Reports-ലെ പോലെ) |
| Meta-യുടെ ആവർത്തന വിളികൾ പരാജയപ്പെടും | സൂക്ഷിച്ച ദിവസ ചെലവ്; പരാജയപ്പെട്ടാൽ "ഏറ്റവും പുതിയ കണക്ക് HH:MM" |
| ഇംഗ്ലീഷ് മാത്രം UI | D4 |
| വലിയ account-ൽ വേഗം | Phase 1-ന് മുൻപ് 50k leads / 100k message ഉള്ള `crm_prod_copy`-ൽ അളക്കുക |

## 10. നിങ്ങളുടെ തീരുമാനം വേണ്ടവ

| # | ചോദ്യം | എന്റെ നിർദ്ദേശം |
|---|---|---|
| D1 | പണം (വരുമാനം, pipeline, ad spend) ആർക്ക് കാണാം? | Owner, Admin മാത്രം. Supervisor-ന് എണ്ണം മാത്രം |
| D2 | ആദ്യ കാലയളവ് | "ശ്രദ്ധ വേണ്ടത്" എപ്പോഴും ഇന്നത്തേത്; സംഖ്യകൾ "ഈ മാസം ഇതുവരെ" |
| D3 | ലക്ഷ്യങ്ങൾ (മാസ leads/won/വരുമാനം, അനുപാതത്തിൽ) Settings → Reports-ൽ ചേർക്കണോ? | വേണം, ഐച്ഛികം, Phase 5 |
| D4 | UI ഭാഷ: ഇംഗ്ലീഷ് മാത്രം തുടരണോ? മലയാളം പരിഭാഷാ പാളി (i18n) ഇപ്പോൾ ഇല്ല | ഇപ്പോൾ ഇംഗ്ലീഷ്; വാക്കുകൾ ഒരിടത്ത് ശേഖരിച്ച് പിന്നീട് പരിഭാഷ എളുപ്പമാക്കുക |
| D5 | പഴയ dashboard ഉടൻ മാറ്റണോ? | ഒരു switch-ന് പിന്നിൽ 2 ആഴ്ച, ഒരു VPS-ൽ ആദ്യം |
| D6 | Conversation trend, response-time chart എവിടെ പോകണം? | "Conversations" എന്ന രണ്ടാം ടാബ് |
| D7 | Viewer-ന് എന്ത് കാണിക്കും? | സ്വന്തം scope മാത്രം; ഒന്നുമില്ലെങ്കിൽ ലളിതമായ സന്ദേശം |
| D8 | ആദ്യ ശ്രമം: Phase 0 + 1 മാത്രം ഇപ്പോൾ തുടങ്ങട്ടെ? | അതെ |

**നില (8 നവംബർ):** D8 = **അതെ**, നിർമ്മാണം തുടങ്ങി. D1–D7 നിങ്ങൾ ഇനിയും മാറ്റിയിട്ടില്ല, അതിനാൽ എന്റെ നിർദ്ദേശങ്ങൾ ഡിഫോൾട്ടായി (പണം Owner/Admin-ന് മാത്രം; ഒരു switch-ന് പിന്നിൽ; ഇംഗ്ലീഷ് UI; Viewer-ന് സ്വന്തം scope). Task-ന്റെ നിർവചനം (മുകളിൽ) നിങ്ങൾ നൽകിയത്.

## 11. ഗവേഷണ കുറിപ്പുകളും ഉറവിടങ്ങളും

**91Leads Features മെനുവിലെ 15 പേജുകൾ** (യഥാർത്ഥ ബ്രൗസറിൽ തുറന്ന് സ്ക്രീൻഷോട്ട് എടുത്തു, 8 നവംബർ 2026; പൊതു marketing പേജുകൾ മാത്രം, ലോഗിൻ ഇല്ല, ഫോം ഒന്നും സമർപ്പിച്ചിട്ടില്ല). പരിമിതികൾ: ഓരോ പേജിലും "Happy Diwali" modal ഹീറോയെ മറച്ചു, അതിനാൽ ഫോൺ കാഴ്ച ഭാഗികമായേ പരിശോധിക്കാനായുള്ളൂ; പല ചിത്രങ്ങളും സാമ്പിൾ ഡാറ്റ ഉള്ള ചിത്രീകരണങ്ങളാണ് (യഥാർത്ഥ app അല്ല, ഇത് അനുമാനം). യഥാർത്ഥ app-ന്റെ ചിത്രങ്ങൾ lead, task, inventory, expense, dashboard പേജുകളിൽ മാത്രം.

| പേജ് | കാണിക്കുന്ന UI | നമുക്ക് എടുക്കാവുന്നത് | ഒഴിവാക്കേണ്ടത് |
|---|---|---|---|
| Lead Management | "All Leads (584)", 14 നിറമുള്ള status ടൈൽ; Tabs: All/New/Followups/Untouched; table-ൽ status pill, അടുത്ത follow-up, agent | വരിയിൽ **മറച്ച ഫോൺ നമ്പർ** + **അടുത്ത follow-up** | 14 ടൈൽ list-ന് മുകളിൽ |
| CRM Dashboard | 5 KPI ടൈൽ; 14-കഷണം donut; agent table; 13-കഷണം pie; Overdue/Today/Next 7 + calendar | മൂന്ന് follow-up ബക്കറ്റ്, calendar-ൽ ദിവസ എണ്ണം | donut, pie, ഏകദേശം 8 നിറങ്ങൾ |
| Integrations | 11 കാർഡ് (WhatsApp, Facebook Lead Ads, IndiaMART, Justdial, Google Sheets, API/Webhooks...) | ഓരോ source-നും "connected, അവസാന lead 2 മിനിറ്റ് മുൻപ്" | യഥാർത്ഥ ലോഗോയ്ക്ക് പകരം നിറമുള്ള വൃത്തങ്ങൾ |
| Lead Follow-up | Overdue 248 / Today 1 / Next 7 days 1; calendar-ൽ "All Agents" ഫിൽറ്റർ, ചിപ്പിൽ ഉടമ | agent ഫിൽറ്റർ, ദിവസത്തിൽ ചുവന്ന എണ്ണം | എല്ലാ ചിപ്പും ഒരേ നിറം, സമയം ഇല്ല |
| Click to Call | "Who to call next" ക്യൂ, NEXT ചിപ്പ് | **ഫോണിൽ "അടുത്തതായി ആരെ വിളിക്കണം/മറുപടി നൽകണം" എന്ന ഒറ്റ ക്യൂ** | call log കാണിക്കുന്നില്ല |
| Lead Assignment | യഥാർത്ഥ screen ഇല്ല, ചിത്രീകരണം മാത്രം | ഓരോ assignment-ന് "എന്തുകൊണ്ട് ഈ agent" രേഖ | നിയമ സ്ക്രീനോ എണ്ണമോ ഇല്ല |
| Team Management | "My Team 8/10 seats", role ചിപ്പ് (Admin/Team Lead/Executive) + active dot | seat meter, role ചിപ്പ് | സംഖ്യകൾ അലങ്കാരം |
| Notifications | 5 channel (bell, browser, Android, email, WhatsApp), ഓരോന്നിലും യഥാർത്ഥ സന്ദേശ വാചകം | ഉടമയുടെ alert ഓരോ channel-ൽ എങ്ങനെ എന്ന preview | ഡോളറിലുള്ള പൊതു dashboard |
| WhatsApp CRM | ഇടത്ത് inbox, വലത്ത് lead table (Last message, Assigned To, status); താഴെ lead panel: Chat/Details/Notes/Tasks/Activity | Lead വരിയിൽ **അവസാന സന്ദേശ + ഉടമ + status** | ഹീറോയിൽ 3D അലങ്കാരം |
| Facebook Leads | Meta page → form → lead table (ഓരോ form-ലും lead എണ്ണം, Active ചിപ്പ്) | page → form → lead വരെ പിന്തുടരൽ | 2025 തീയതിയുള്ള mock ഡാറ്റ |
| Task Management | My 0 / Team 24 / My created 4; 6 kanban നിര; കാർഡിൽ ചുവന്ന "Overdue"; "No tasks" ശൂന്യ അവസ്ഥ | overdue കാർഡിൽ തന്നെ ചുവപ്പിൽ; ശൂന്യ അവസ്ഥ | 6 നിര ഫോണിൽ ഒതുങ്ങില്ല; "Completed" ആധിപത്യം |
| Inventory | 7 എണ്ണ ടൈൽ (Total, Active, Available ഒരേ സംഖ്യ); table, WhatsApp share (വരിയിലും കൂട്ടായും) | വരിയിൽ നിന്ന് WhatsApp share | ഒരേ സംഖ്യ 3 ടൈലിൽ; ഓരോ വരിയിലും ചുവന്ന trash |
| Invoice | ചിത്രം ഇല്ല (QR മാത്രം); വാചകത്തിൽ: Generated, Shared, Pending, Done ശൃംഖല | പേയ്മെന്റ് സ്ഥിതി ശൃംഖല | — |
| Expense | 4 പണ ടൈൽ: Total, This month, Last month, This year | **ഈ മാസം / കഴിഞ്ഞ മാസം / ഈ വർഷം** | പല കളങ്ങളിൽ "N/A", chart ഇല്ല |
| Attendance | Present 32 / Absent 5 / Leave 3 / Late 4, ഓരോന്നിലും ടീമിന്റെ %; ആകെ ടീമിൽ കൂടുന്ന ടൈലുകൾ | **ആകെയിലേക്ക് കൂടുന്ന ടൈലുകൾ** | stock അവതാറുകൾ |

**പൊതു കണ്ടെത്തലുകൾ:**
- എല്ലാ പേജും ഒരേ ഘടന: hero → 3–6 കാർഡ് → ഒരു ചിത്രം → FAQ → CTA. പല ലൈറ്റ്-പേസ്റ്റൽ നിറങ്ങൾ (8+), 12–16px വളവ്, ലേബലുള്ള icon rail.
- അവരുടെ സംഖ്യാ രീതി: KPI ടൈൽ (icon + ലേബൽ + വലിയ സംഖ്യ + "% of total"). Win rate (4%) ടൈലിന്റെ ചെറിയ വരിയിൽ ഒളിഞ്ഞുകിടക്കുന്നു.
- ടൈലിന്റെ നിറം അർത്ഥവുമായി യോജിക്കുന്നില്ല (ഉദാ. "Trial Started" ചുവപ്പ്, "Interested" ആമ്പർ); ഇത് ഓട്ടോ-നിറം നൽകലാണെന്ന് അനുമാനം.
- **ഒഴിവാക്കേണ്ട 8 തെറ്റുകൾ:** 13–14 കഷണ donut/pie; list-ന് മുൻപ് 14 status ടൈൽ; അർത്ഥമില്ലാത്ത പല നിറങ്ങൾ; ഒരേ സംഖ്യ 3 ടൈലിൽ; മിക്ക കളങ്ങളിലും "N/A"; ഫോണിൽ ഒതുങ്ങാത്ത 6 kanban നിര; ഓരോ പേജിലും മറയ്ക്കുന്ന promo modal; mock ഡാറ്റ യഥാർത്ഥ product ആയി കാണിക്കൽ.

**സ്ക്രീൻഷോട്ടുകൾ (ഞങ്ങളുടെ ഗവേഷണത്തിന് മാത്രം, പകർത്താനല്ല):** `C:\Users\User\AppData\Local\Temp\claude\91e633a949cb0d29\33b1bf4b-d751-4f9f-bb3f-3c2f1df16af2\scratchpad\91leads\` (`desktop\` 15 ഫയൽ, `mobile\` 6, `ui\` അവരുടെ പേജുകളിലെ പ്രൊഡക്ട് ചിത്രങ്ങൾ).

**ഉറവിടങ്ങൾ** (ഞാൻ വായിച്ചത്; സ്വതന്ത്രമായി സ്ഥിരീകരിക്കാത്തവ vendor അവകാശവാദങ്ങളാണ്):
- 91Leads: `91leads.com/team-management`, `/crm-dashboard`, മറ്റ് Features പേജുകൾ.
- Kommo: `support.kommo.com/docs/track-your-whatsapp-results-with-analytics`. TimelinesAI: `timelines.ai/top-7-metrics-for-whatsapp-crm-reports`. Corefactors: `corefactors.ai/whats-new/whatsapp-dashboard`.
- ഡിസൈൻ ഗൈഡുകൾ: insightsoftware (2019), Plecto, SimpleKPI (2026). (datapine ലിങ്ക് മറ്റൊരു സൈറ്റിലേക്ക് തിരിച്ചുവിട്ടു, uxdesign.cc 403, വായിച്ചില്ല.)
- Speed to lead: MIT/InsideSales (2007), HBR "The Short Life of Online Sales Leads" (2011): ദ്വിതീയ ഉറവിടങ്ങളിലൂടെ മാത്രം. ഉപഭോക്താവിനോട് പറയുന്നതിന് മുൻപ് യഥാർത്ഥ പേപ്പർ വായിക്കണം.
- ആക്സസിബിലിറ്റി: WCAG 1.4.11, 1.4.1; `dataviz` skill (നിറ പരിശോധന സ്ക്രിപ്റ്റ് ഓടിച്ചത്).

**ദൃശ്യ മാതൃക:** `C:\Users\User\AppData\Local\Temp\claude\91e633a949cb0d29\33b1bf4b-d751-4f9f-bb3f-3c2f1df16af2\scratchpad\dashboard-mock\index.html` (ഒരു മാതൃക മാത്രം: ഡാറ്റ ഉദാഹരണമാണ്, ഒന്നും നിർമ്മിച്ചിട്ടില്ല).
