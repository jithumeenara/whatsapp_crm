# Reports: All report + ഓരോ വിഷയത്തിനും വേറിട്ട reports. പ്ലാൻ

തയ്യാറാക്കിയത്: 15 നവംബർ 2026 (രണ്ടാം പതിപ്പ്) · അവസ്ഥ: **പ്ലാൻ മാത്രം, നിർമ്മിച്ചിട്ടില്ല**

ആധാരം: മൂന്ന് ഗവേഷണങ്ങൾ.
1. 15 CRM-കളുടെ report ഘടന: HubSpot, Salesforce, Zoho, Pipedrive, Freshsales, Kommo, LeadSquared, Bitrix24, respond.io, WATI, Interakt, AiSensy, Gallabox, Trengo, Zoko.
2. Report UX-ലെ മികച്ച രീതികൾ: NN/g, Baymard, Shopify, Linear, Tableau, Power BI, Geckoboard.
3. നമ്മുടെ ഇപ്പോഴത്തെ code-ഉം database-ഉം.

രണ്ടാം പതിപ്പിലെ മാറ്റം: owner പറഞ്ഞത് "All report-ൽ ഓരോ ഭാഗവും കുറച്ചേ ഉൾപ്പെടുത്താൻ പറ്റൂ; Agent report, Lead report, Ad report, Comparison report, Performance guide report എന്നിങ്ങനെ വേറിട്ട reports വേണം" എന്നാണ്. അതനുസരിച്ച് ഘടന രണ്ട് തലത്തിലാക്കി.

---

## 1. ഇപ്പോഴത്തെ പ്രശ്നം

- Reports ഒറ്റ നീണ്ട പേജാണ് (13 ഭാഗങ്ങൾ). ഒരു വിഷയം ആഴത്തിൽ നോക്കാൻ പറ്റില്ല.
- Download ചെയ്യുന്ന PDF-ഉം slides-ഉം "എല്ലാം കുറച്ച്" ആണ്. ഒരു agent-ന്റെയോ ഒരു പരസ്യത്തിന്റെയോ മുഴുവൻ വിവരം അതിലില്ല.
- രണ്ട് കാലയളവോ, രണ്ട് agents-ഓ, രണ്ട് പരസ്യങ്ങളോ തമ്മിൽ താരതമ്യം ചെയ്യാൻ സംവിധാനമില്ല.
- "എവിടെയാണ് പ്രകടനം കുറഞ്ഞത്, എന്താണ് ചെയ്യേണ്ടത്" എന്ന് പറയുന്ന report ഇല്ല.
- ഡാറ്റ database-ൽ ഉണ്ടായിട്ടും report ഇല്ലാത്തവ:
  - calls-ന്റെ answer rate, സംസാര സമയം
  - follow-up കൃത്യത
  - chat മറുപടി വേഗം
  - deal വേഗം
  - broadcasts (എല്ലാം ഒരുമിച്ച്)
  - templates
  - bot flow drop-off
  - AI കൈമാറ്റം

## 2. ലോകത്തെ CRM-കളിൽ നിന്ന് പഠിച്ചത് (ചുരുക്കം)

- **പൊതു ഘടന:** Overview → Leads → Deals → ടീം/Activities → Forecast/Goals → Marketing.
- **WhatsApp ഉപകരണങ്ങൾ ചേർക്കുന്നത്:**
  - chat മറുപടി വേഗം
  - broadcast/template funnel
  - bot drop-off (Gallabox)
  - message ചെലവ് (Kommo)
  - automation വരുമാനം (Zoko)
- **Salesforce-ന്റെ "dynamic dashboard":** ഒരേ report, agent-ന് സ്വന്തം ഡാറ്റ, manager-ന് ടീമിന്റേത്.
- **Power BI, Tableau Pulse:** code എഴുതുന്ന വാചകങ്ങൾ (സംഖ്യകളോടെ). AI വാചകം അടയാളപ്പെടുത്തി, സംഖ്യകൾ അടുത്ത് കാണിക്കും. പ്രശ്നം വരുമ്പോൾ alert.
- **ആരും ചെയ്യാത്തത്, നമ്മുടെ മേൽക്കൈ:**
  1. പരസ്യച്ചെലവ് → lead → call → deal → പണം, രൂപയിൽ, ഒറ്റ കാഴ്ചയിൽ.
  2. Call centre ഉത്തരവാദിത്തം.
  3. AI-ക്ക് ഉത്തരം അറിയാത്ത ചോദ്യങ്ങൾ.
  4. Owner-ന് WhatsApp-ൽ, സ്വന്തം ഭാഷയിൽ.
  5. **"എവിടെ കുറഞ്ഞു, എന്ത് ചെയ്യണം" എന്ന് പറയുന്ന performance guide.** ഗവേഷണത്തിൽ കണ്ട ഒരു SMB CRM-ഉം ഇത് ചെയ്യുന്നില്ല.

**UX നിയമങ്ങൾ:**
- ആദ്യം ഉത്തരം (ഒറ്റ വാചകം + പ്രധാന സംഖ്യ), പിന്നെ chart, പിന്നെ പട്ടിക.
- ഓരോ സംഖ്യയ്ക്കും താരതമ്യം വേണം: മുമ്പത്തെ സംഖ്യ, ലക്ഷ്യം, ശരാശരി.
- Bars, lines, പട്ടിക മാത്രം. "എണ്ണം വളരെ കുറവ്", "ഈ തീയതി മുതൽ" എന്ന കുറിപ്പുകൾ.
- Agent-ന് റാങ്ക് ഇല്ല. Filter URL-ൽ. ഓരോ report-ഉം വേറെ load ചെയ്യും.

---

## 3. പുതിയ ഘടന: രണ്ട് തലം

```
Reports
│
├─ ★ All report (ഒറ്റനോട്ടം)   എല്ലാ വിഷയത്തിൽ നിന്നും പ്രധാനപ്പെട്ടത് മാത്രം
│
├─ വിഷയം തിരിച്ചുള്ള reports (ഓരോന്നും ആഴത്തിൽ)
│   ├─ 1. Lead report
│   ├─ 2. Agent report
│   ├─ 3. Ad report
│   ├─ 4. Conversation report (chat മറുപടി)
│   ├─ 5. Sales & Pipeline report
│   ├─ 6. Campaign report (broadcasts, templates)
│   ├─ 7. AI & Automation report
│   └─ 8. Spending & ROI report
│
└─ 10. Performance guide  (എവിടെ കുറഞ്ഞു, എന്തുകൊണ്ട്, എന്ത് ചെയ്യണം. AI സഹായത്തോടെ)
```

**താരതമ്യം ഓരോ report-ന്റെ അകത്ത് ഒരു tab ആയി** (owner നിർദ്ദേശം). വേറിട്ട "Comparison report" side menu-വിൽ ഇല്ല. ഓരോ report പേജിലും മുകളിൽ രണ്ട് tab:

```
Agent report
[ റിപ്പോർട്ട് ]  [ താരതമ്യം ]
```

- **റിപ്പോർട്ട് tab:** ആ report. ഓരോ സംഖ്യയ്ക്കും "മുമ്പ്" സ്വയം (§5).
- **താരതമ്യം tab:** ആ report-ലെ കാര്യങ്ങൾ തമ്മിൽ. കാലയളവ് vs കാലയളവ് എല്ലാ report-ലും ഉണ്ടാകും, ഒപ്പം ആ report-ന് ചേരുന്നവ:

| Report | താരതമ്യം tab-ൽ |
|---|---|
| Lead report | കാലയളവ്, source vs source, category vs category, WhatsApp നമ്പർ/ശാഖ |
| Agent report | കാലയളവ്, agent vs agent (2–4 പേർ) |
| Ad report | കാലയളവ്, പരസ്യം vs പരസ്യം, campaign vs campaign, Facebook vs Instagram |
| Conversation | കാലയളവ്, ചാനൽ vs ചാനൽ, നമ്പർ vs നമ്പർ |
| Sales & Pipeline | കാലയളവ്, category, agent |
| Campaign | കാലയളവ്, broadcast vs broadcast, template vs template |
| AI & Automation | കാലയളവ്, flow vs flow |
| Spending & ROI | കാലയളവ്, ചാനൽ vs ചാനൽ |

Filter-കൾ രണ്ട് tab-ലും ഒന്നുതന്നെ, URL-ൽ (`?tab=compare&a=…&b=…`). അതിനാൽ ഒരു താരതമ്യം link ആയി അയക്കാം. താരതമ്യം tab-ന്റെ PDF/Excel ആ report-ന്റെ download ബട്ടണിൽ തന്നെ.

**ഓരോ report-നും ഒരേ രൂപം:**
- സ്വന്തം പേജ്: `/reports/<പേര്>`.
- സ്വന്തം filters.
- സ്വന്തം downloads: PDF (ആ വിഷയം മാത്രം, എല്ലാ വിശദാംശങ്ങളോടെ), Excel (എല്ലാ വരികളും), വേണമെങ്കിൽ slides.
- Schedule ചെയ്ത് WhatsApp/email-ൽ അയയ്ക്കാം.

**All report**-ൽ ഓരോ വിഷയത്തിന്റെയും 2–3 പ്രധാന സംഖ്യയും ഒരു chart-ഉം മാത്രം. ഓരോ ഭാഗത്തും "വിശദമായി കാണുക →" link, അതേ filter-ോടെ ആ report തുറക്കും. ഇപ്പോഴുള്ള 6 പേജ് PDF-ഉം slides-ഉം ഇതിന്റെ download ആയി തുടരും.

---

## 4. ഓരോ report-ലും എന്ത്

### ★ All report (owner-ന്റെ ഒറ്റനോട്ടം)
- ഒറ്റ വാചകം: "ഈ ആഴ്ച 160 leads, 12 നേടി, ₹1.2 ലക്ഷം; 10 പേരെ ഇനിയും വിളിച്ചിട്ടില്ല."
- 8 card-കൾ, ഓരോന്നും അതിന്റെ report തുറക്കും:
  - Leads
  - നേടിയത്
  - വരുമാനം
  - Pipeline
  - ആദ്യ മറുപടി വേഗം
  - Call attend %
  - ഒരു lead-ന് പരസ്യച്ചെലവ്
  - AI കൈകാര്യം ചെയ്തത്
- Performance guide-ൽ നിന്ന് ഏറ്റവും പ്രധാനപ്പെട്ട 3 കാര്യങ്ങൾ.
- ഇപ്പോൾ ചെയ്യേണ്ടത്.

### 1. Lead report
- Leads ദിവസം/ആഴ്ച/മാസം തിരിച്ച്, മുൻ കാലയളവുമായി.
- Source, category (Speciality/Course), ചാനൽ, WhatsApp നമ്പർ, ജില്ല/സ്ഥലം.
- Category × ദിവസം പട്ടിക (ആശുപത്രി slides പോലെ).
- Funnel: സ്വന്തം ഘട്ടങ്ങൾ, ഓരോ ഘട്ടത്തിലേക്കും %, ഓരോ ഘട്ടത്തിലും എത്ര ദിവസം നിൽക്കുന്നു.
- നഷ്ടപ്പെട്ടതിന്റെ കാരണങ്ങൾ: source, category, agent തിരിച്ച്.
- **Lead വന്ന് ആദ്യ call/മറുപടി വരെയുള്ള സമയം**, അതിന്റെ വിതരണം, ജോലി സമയം കണക്കാക്കി.
- ആരും വിളിക്കാത്തവർ, അനങ്ങാത്ത leads (X ദിവസമായി ഘട്ടം മാറിയില്ല), ആവർത്തിച്ച് വന്നവർ.
- Download: PDF (എല്ലാ പട്ടികകളും charts-ഉം), Excel (ഓരോ lead-ഉം ഒരു വരി, customer വിവരം supervisor-ന് മാത്രം).

### 2. Agent report
**ടീം കാഴ്ച (supervisor/owner):**
- ഓരോ agent-ഉം: leads, calls, attend %, ഓരോ ഘട്ടവും, നേടിയത്, വരുമാനം, ആദ്യ മറുപടി വേഗം, follow-up കൃത്യത %, ജോലി ചെയ്ത ദിവസം/online സമയം.
- **ന്യായമായ താരതമ്യം:** ഒരേ source-ൽ നിന്നുള്ള leads-ൽ conversion. പരസ്യ leads കിട്ടുന്നയാളെ അതില്ലാത്തയാളുമായി നേരിട്ട് താരതമ്യം ചെയ്യില്ല. ചെറിയ എണ്ണങ്ങൾ മങ്ങിച്ച് കാണിക്കും.

**ഒരു agent-ന്റെ വിശദ report ("Agent report card"):**
- ആ ആളുടെ ആഴ്ച/മാസം: ദിവസം തിരിച്ചുള്ള calls, attend %, ഏത് മണിക്കൂറിൽ ആളുകൾ എടുക്കുന്നു.
- Funnel, നഷ്ടപ്പെട്ടതിന്റെ കാരണങ്ങൾ, വൈകിയ follow-ups.
- സ്വന്തം പഴയ കാലയളവുമായും ലക്ഷ്യവുമായും താരതമ്യം.
- **ഈ agent-ന് മാത്രമുള്ള മെച്ചപ്പെടുത്തൽ നിർദ്ദേശങ്ങൾ** (Performance guide-ൽ നിന്ന്).

**ആർക്ക്:** Agent-ന് സ്വന്തം report card മാത്രം, റാങ്കില്ല, മറ്റാരുടെയും പേരില്ല. Supervisor-ന് എല്ലാവരുടേതും, PDF ആയി download ചെയ്ത് agent-മായി ചർച്ച ചെയ്യാം.

### 3. Ad report
- **ഓരോ പരസ്യവും:**
  - campaign, ad set
  - Facebook/Instagram (ഉറപ്പുള്ളപ്പോൾ)
  - ചാനൽ (WhatsApp, Messenger, IG Direct, Lead form)
  - വന്നവർ, leads, നേടിയത്, വരുമാനം, ചെലവ്
  - ഒരു lead-ന് ചെലവ്, ഒരു വിജയത്തിന് ചെലവ്, ROAS
- Campaign തിരിച്ച് ചുരുക്കം.
- **പണം പാഴാകുന്ന പരസ്യങ്ങൾ** (ചെലവുണ്ട്, lead ഇല്ല). Leads ഉണ്ട്, വിജയം ഇല്ല.
- ദിവസം തിരിച്ച് ചെലവ് vs conversations. ആഴ്ചയിലെ ഏത് ദിവസം/മണിക്കൂർ പരസ്യം നന്നായി പ്രവർത്തിക്കുന്നു.
- **ഏത് പരസ്യത്തിൽ നിന്ന് വന്ന lead ഏത് agent നേടി** (പരസ്യം × agent).
- Reach, impressions, CTR, frequency (Meta connection ഉള്ളപ്പോൾ).
- Download: PDF (പരസ്യത്തിന്റെ ചിത്രം സഹിതം), Excel.
- ഇപ്പോൾ Ads പേജിലുള്ള "From click to sale" ഇതിന്റെ അടിസ്ഥാനം.

### 4. Conversation report (chat മറുപടി)
- പുതിയ chat-കൾ: ചാനൽ, WhatsApp നമ്പർ, ദിവസം, മണിക്കൂർ തിരിച്ച്.
- ആദ്യ മറുപടി വേഗം: median, ലക്ഷ്യം പാലിച്ച %, ജോലി സമയം മാത്രം. Agent, നമ്പർ തിരിച്ച്.
- മറുപടി കിട്ടാതെ പോയ chat-കൾ, 24 മണിക്കൂർ window നഷ്ടപ്പെട്ടവ.
- ഉപഭോക്തൃ സംതൃപ്തി (rating).
- ഇതിന് migration വേണം (§6 കാണുക).

### 5. Sales & Pipeline report
- നേടിയ വരുമാനം, നഷ്ടപ്പെട്ട തുക, category, agent തിരിച്ച്.
- Pipeline ഘട്ടം തിരിച്ച്.
- **Deal വേഗം:** ഓരോ ഘട്ടത്തിലും എത്ര ദിവസം, ഘട്ടം-ഘട്ടം conversion, ശരാശരി deal ദൈർഘ്യം.
- Forecast (പ്രതീക്ഷിക്കുന്ന close തീയതി അനുസരിച്ച്), പഴകിയ deals.

### 6. Campaign report (broadcasts, templates)
- എല്ലാ broadcasts-ഉം ഒരുമിച്ച്: അയച്ചു → എത്തി → വായിച്ചു → മറുപടി → പരാജയം. ചെലവ്, ഒരു മറുപടിക്ക് ചെലവ്.
- Broadcast വഴി വന്ന leads, നേടിയത്, വരുമാനം.
- Templates: ഉപയോഗം, ഗുണനിലവാരം, നിരസിച്ചവ, ചെലവ്.
- Opt-in / opt-out (STOP) ട്രെൻഡ്.

### 7. AI & Automation report
- AI/bot മറുപടി നൽകിയ chat-കൾ, മനുഷ്യനില്ലാതെ തീർന്നത് %.
- **കൈമാറ്റം (handover):** എത്ര, എന്തുകൊണ്ട്, ജോലി സമയത്തിന് പുറത്ത് എത്ര. ഇതിന് migration വേണം.
- **AI-ക്ക് ഉത്തരം അറിയാത്ത ചോദ്യങ്ങൾ.** ഒരു click-ൽ AI training-ലേക്ക് ചേർക്കാം.
- Bot flow-കൾ: തുടങ്ങിയത്, പൂർത്തിയാക്കിയത്, ഏത് ഘട്ടത്തിൽ നിന്നുപോയി.
- AI കണ്ടെത്തിയ leads, മനുഷ്യൻ ശരിവെച്ചത് %.

### 8. Spending & ROI report
- ഇപ്പോഴുള്ള Spending: WhatsApp, AI, പരസ്യം. Category, നമ്പർ, ആൾ, ടീം തിരിച്ച്.
- **ROI:** വരുമാനം − (പരസ്യം + WhatsApp + AI) ÷ ചെലവ്. ചാനൽ, campaign, broadcast തിരിച്ച്.

### 9. താരതമ്യം tab (ഓരോ report-ന്റെയും അകത്ത്)
വേറിട്ട report അല്ല. ഓരോ report-ലെയും "താരതമ്യം" tab ഒരേ പൊതു ഘടകം (component) ഉപയോഗിക്കും. ഏത് report-ൽ ആണോ, അതിന് ചേരുന്ന കാര്യങ്ങൾ മാത്രം തിരഞ്ഞെടുക്കാൻ കാണിക്കും (§3-ലെ പട്ടിക). എല്ലാ സാധ്യതകളും:

| എന്ത് താരതമ്യം | ഉദാഹരണം |
|---|---|
| കാലയളവ് vs കാലയളവ് | ഈ മാസം vs കഴിഞ്ഞ മാസം, ഈ വർഷം നവംബർ vs കഴിഞ്ഞ വർഷം |
| Agent vs agent | Parvathy vs Ananya |
| Source vs source | WhatsApp പരസ്യം vs Lead form vs നേരിട്ടുള്ള call |
| പരസ്യം/campaign vs പരസ്യം | Diwali offer vs Free demo |
| Category vs category | Varicose Vein vs Robotic TKR |
| WhatsApp നമ്പർ / ശാഖ vs ശാഖ | Kozhikode നമ്പർ vs Kochi നമ്പർ |

**രൂപം:**
- രണ്ട് (പരമാവധി 4) കാര്യങ്ങൾ തിരഞ്ഞെടുക്കാം. ഒരേ സംഖ്യകൾ അടുത്തടുത്ത് കാണിക്കും: leads, ഓരോ ഘട്ടം, conversion, വരുമാനം, മറുപടി വേഗം, ചെലവ്.
- വ്യത്യാസം സംഖ്യയായും %-ആയും. മുമ്പത്തെ സംഖ്യ എപ്പോഴും കാണിക്കും.
- Charts: രണ്ട് വരകൾ ഒരേ chart-ൽ (ദിവസം തിരിച്ച്), ഘട്ടം തിരിച്ച് bars അടുത്തടുത്ത്.
- ഒറ്റ വാചകം (code എഴുതുന്നത്): "Ananya-യുടെ attend % Parvathy-യേക്കാൾ 14 പോയിന്റ് കുറവ്; പ്രധാന വ്യത്യാസം Appointment ഘട്ടത്തിൽ."

**ന്യായം ഉറപ്പാക്കാൻ:**
- ഓടിക്കൊണ്ടിരിക്കുന്ന കാലയളവ് മുൻ കാലയളവിന്റെ അതേ ദിവസങ്ങളുമായി മാത്രം.
- ചെറിയ എണ്ണം വരുമ്പോൾ "താരതമ്യത്തിന് എണ്ണം കുറവ്" എന്ന് കാണിക്കും.
- Agent താരതമ്യത്തിൽ ഒരേ source mix-ഉം കാണിക്കും.

**ആർക്ക്:** supervisor/owner. Agent-ന് "ഞാൻ ഈ മാസം vs കഴിഞ്ഞ മാസം" മാത്രം.

Download: താരതമ്യം PDF/Excel ആയി.

### 10. Performance guide (എവിടെ കുറഞ്ഞു, എന്ത് ചെയ്യണം)
ഏറ്റവും മൂല്യമുള്ള പുതിയ report. രണ്ട് പാളി:

**പാളി 1: Code കണ്ടെത്തൽ (AI ഇല്ലാതെ, എപ്പോഴും):**
എല്ലാ report-ലെയും സംഖ്യകൾ പരിശോധിച്ച് "പ്രശ്നം → തെളിവ് → എന്ത് ചെയ്യാം" എന്ന card-കൾ ഉണ്ടാക്കും.

| പരിശോധന | ഉദാഹരണം |
|---|---|
| മുൻ കാലയളവിനെ അപേക്ഷിച്ച് കുറവ് | "Leads 22% കുറഞ്ഞു. അതിൽ 80% കുറവും Instagram പരസ്യങ്ങളിൽ നിന്ന്." |
| എവിടെയാണ് കുറവ് (കാരണം തേടൽ) | കുറവ് source, agent, category, ചാനൽ, ദിവസം, മണിക്കൂർ എന്നിവയിൽ വിഭജിച്ച്, ഏറ്റവും വലിയ പങ്കുള്ളത് കണ്ടെത്തും |
| Funnel-ൽ ചോർച്ച | "Appointment → Visited ഈ ആഴ്ച 88%-ൽ നിന്ന് 61%-ലേക്ക്." |
| മറുപടി വേഗം | "ശനിയാഴ്ച വൈകിട്ട് വന്ന leads-ന് ആദ്യ മറുപടിക്ക് ശരാശരി 14 മണിക്കൂർ." |
| Agent-തല | "Anugraha-യുടെ attend % 33%, ടീം ശരാശരി 56%. Not attended calls കൂടുതലും രാവിലെ 10–12." |
| Follow-up | "വൈകിയ follow-ups 3-ൽ നിന്ന് 19-ലേക്ക്." |
| പരസ്യം | "'Old banner' ₹2,000 ചെലവാക്കി, lead ഇല്ല." |
| AI | "AI ഈ ആഴ്ച 31 തവണ fees ചോദ്യത്തിന് ഉത്തരം അറിയാതെ കൈമാറി." |

ഓരോ card-ലും:
- **ഗൗരവം:** ചുവപ്പ്, മഞ്ഞ, പച്ച. നിറത്തിനൊപ്പം ചിഹ്നവും വാക്കും ഉണ്ടാകും.
- **തെളിവ്:** സംഖ്യകളും ചെറിയ chart-ഉം. ആ report-ലേക്കുള്ള link.
- **നിർദ്ദേശം:** നിയമങ്ങളിൽ നിന്ന്. ഉദാ: "ശനി വൈകിട്ട് ഒരാളെ on-call ആക്കുക", "Old banner നിർത്തുക", "fees വിവരം AI training-ൽ ചേർക്കുക".
- **ചെയ്യാനുള്ള ബട്ടൺ** (ഉള്ളിടത്ത്): ആ leads assign ചെയ്യുക, follow-up ഉണ്ടാക്കുക, AI training തുറക്കുക.
- ചെറിയ എണ്ണങ്ങളിൽ നിന്ന് നിഗമനം ഇല്ല. "എണ്ണം കുറവ്" എന്ന് പറയും.

**പാളി 2: AI നിർദ്ദേശങ്ങൾ (business ഓൺ ചെയ്താൽ മാത്രം):**
- പാളി 1 കണ്ടെത്തിയ വസ്തുതകൾ മാത്രം AI-ക്ക് കൊടുക്കും: സംഖ്യകൾ, ഘട്ടങ്ങളുടെ പേര്, agent-ന്റെ പേര്. Customer-ന്റെ പേരോ നമ്പറോ chat-കളോ ഒരിക്കലും കൊടുക്കില്ല ("people data never to AI" നിയമം).
- AI business-ന്റെ ഭാഷയിൽ (മലയാളം ഉൾപ്പെടെ) വിശദീകരണവും 3–5 പ്രവർത്തന നിർദ്ദേശങ്ങളും എഴുതും.
- **AI എഴുതിയത്** എന്ന് അടയാളപ്പെടുത്തും.
- AI എഴുതുന്ന ഓരോ സംഖ്യയും code പരിശോധിക്കും. Screen-ലെ സംഖ്യയുമായി ചേരാത്ത വാചകം കാണിക്കില്ല (ഇപ്പോഴുള്ള AI accuracy rules പോലെ).
- "കാരണം ഇതാണ്" എന്ന ഉറപ്പ് ഒഴിവാക്കും. "ബന്ധപ്പെട്ടിരിക്കുന്നു", "പരിശോധിക്കുക" എന്ന രീതിയിൽ മാത്രം.
- AI പരാജയപ്പെട്ടാലോ ഓഫ് ആണെങ്കിലോ പാളി 1 മാത്രം കാണിക്കും.
- ചെലവ് ആഴ്ചയിൽ ഒരിക്കൽ (cache), ചോദിക്കുമ്പോൾ മാത്രം വീണ്ടും.

**പിന്നീട്:** ഓരോ നിർദ്ദേശവും "ചെയ്തു / വേണ്ട" എന്ന് അടയാളപ്പെടുത്താം. അടുത്ത ആഴ്ച ആ സംഖ്യ മെച്ചപ്പെട്ടോ എന്ന് guide തന്നെ പറയും.

**ആർക്ക്:** Owner, supervisor: ടീമിന്റെ guide. Agent: സ്വന്തം guide മാത്രം ("നിങ്ങളുടെ attend % രാവിലെ കുറവ്").

Download: PDF. തിങ്കളാഴ്ച WhatsApp brief-ൽ guide-ലെ ആദ്യ 3 കാര്യങ്ങൾ ചേർക്കും.

---

## 5. എല്ലാ report-നും പൊതുവായത്

### Layout: Settings പേജ് പോലെ സ്വന്തം side menu, main menu മറയും (owner ആവശ്യപ്പെട്ടത്)

```
┌──────┬────────────────────┬──────────────────────────────────────────┐
│ main │ REPORTS            │  Lead report            [filters] [⬇]   │
│ menu │ ★ All report       │                                          │
│ (ചുരു│ ── വിഷയങ്ങൾ ──     │   ഒറ്റ വാചകം + പ്രധാന സംഖ്യകൾ           │
│ ക്കി,│   Lead report  ◀   │   charts                                 │
│ icon │   Agent report     │   പട്ടികകൾ                               │
│ മാത്ര│   Ad report        │                                          │
│ ം)   │   Conversations    │                                          │
│      │   Sales & Pipeline │                                          │
│      │   Campaigns        │                                          │
│      │   AI & Automation  │                                          │
│      │   Spending & ROI   │                                          │
│      │ ── വിശകലനം ──      │                                          │
│      │   Performance guide│                                          │
│      │ ── ──               │                                          │
│      │ ⬇ Export           │                                          │
│      │   [PDF] PDF        │                                          │
│      │   [XLS] Excel      │                                          │
│      │   [PPT] PowerPoint │                                          │
│      │   ⏰ Scheduled      │                                          │
└──────┴────────────────────┴──────────────────────────────────────────┘
```

### Export: side menu-വിൽ, ഓരോ report-നും മൂന്നും (owner ആവശ്യപ്പെട്ടത്)
- **എല്ലാ report-നും PDF, Excel, PowerPoint മൂന്നും.** Performance guide ഉൾപ്പെടെ, ഒഴിവില്ല (§5 Downloads പട്ടിക).
- Side menu-വിന്റെ താഴെ **"⬇ Export"** എന്ന തലക്കെട്ട്, icon സഹിതം. അതിന് താഴെ മൂന്ന് വരികൾ, ഓരോന്നിനും **യഥാർത്ഥ ഫയൽ-തരം icon:**
  - **PDF:** ചുവപ്പ് document icon, അകത്ത് "PDF".
  - **Excel:** പച്ച document icon, അകത്ത് "XLS".
  - **PowerPoint:** ഓറഞ്ച് document icon, അകത്ത് "PPT".
- Icons സ്വന്തം SVG ആയി, ഫയൽ-തരത്തിന്റെ പരിചിതമായ നിറത്തിലും ആകൃതിയിലും. Microsoft-ന്റെയോ Adobe-ന്റെയോ logo നേരിട്ട് ഉപയോഗിക്കില്ല, അവ അവരുടെ trademark ആണ്.
- **ഇപ്പോൾ തുറന്നിരിക്കുന്ന report** ആണ് export ആകുന്നത്, അതേ filters, കാലയളവ്, tab എന്നിവയോടെ. താരതമ്യം tab-ൽ ആണെങ്കിൽ താരതമ്യം export ആകും. All report-ൽ ആണെങ്കിൽ മുഴുവൻ report.
- ഫയലിന്റെ പേര്: report-ന്റെ പേരും തീയതിയും. ഉദാ: `agent-report-2026-11-01-to-2026-11-15.pdf`.
- ഒരു click-ൽ download. Export നടക്കുമ്പോൾ ആ വരിയിൽ "തയ്യാറാക്കുന്നു…" എന്നും spinner-ഉം കാണിക്കും. അത് കഴിയുന്നതുവരെ വീണ്ടും click ചെയ്യാൻ പറ്റില്ല (bug നിയമം 6). പരാജയപ്പെട്ടാൽ ലളിതമായ സന്ദേശം (നിയമം 3, 7).
- **അനുമതി:** export supervisor-നും മുകളിലുള്ളവർക്കും മാത്രം. അനുമതിയില്ലാത്തവർക്ക് Export ഭാഗം side menu-വിൽ തന്നെ ഉണ്ടാകില്ല. Agent-ന് സ്വന്തം report card PDF മാത്രം, owner തീരുമാനിച്ചാൽ (§8).
- **ഫോണിൽ:** report തുറന്നാൽ മുകളിൽ ഒരു ⬇ ബട്ടൺ, തൊട്ടാൽ PDF / Excel / PowerPoint എന്ന sheet.
- ഓരോ export-ഉം audit log-ൽ (കണക്കുകൾ ഇല്ലാതെ). Rate limit, പൊതുവായ PDF slot എന്നിവയും.

- **Reports തുറക്കുമ്പോൾ main menu സ്വയം ചുരുങ്ങും** (icon മാത്രം). Reports-ന്റെ സ്വന്തം side menu കാണിക്കും. Reports-ൽ നിന്ന് പുറത്തുപോകുമ്പോൾ main menu തിരികെ തുറക്കും.
- ഇത് Settings-ൽ ഇതിനകം പ്രവർത്തിക്കുന്ന അതേ സംവിധാനമാണ്: `src/components/layout-v2/dashboard-shell-v2.tsx`-ലെ `isCompactPage()`-ൽ `/reports` ചേർക്കുക, settings/page.tsx-ലെ side menu രീതി (`useSidebarCollapse`, "Collapse/Expand main menu" ബട്ടൺ) ഉപയോഗിക്കുക. പുതിയ സംവിധാനം വേണ്ട.
- Side menu-വിൽ ആ ആൾക്ക് അനുമതിയുള്ള reports മാത്രം കാണിക്കും (agent-ന് കുറവ്).
- Side menu-വിന് മുകളിൽ "Reports-ൽ തിരയുക" (Settings-ലെ പോലെ), താഴെ "Scheduled reports".
- **ഫോണിൽ:** Settings-ലെ പോലെ drill-down. ആദ്യം reports-ന്റെ പട്ടിക, ഒന്ന് തൊട്ടാൽ ആ report, മുകളിൽ "← Reports" ബട്ടൺ.
- തിരഞ്ഞെടുത്ത report URL-ൽ (`/reports/agents`), അതിനാൽ link അയക്കാം, back ബട്ടൺ പ്രവർത്തിക്കും.

### ഓരോ report-ലും മുമ്പത്തേതുമായി താരതമ്യം, അകത്ത് തന്നെ (owner ആവശ്യപ്പെട്ടത്; നിർബന്ധം)

ഒരു സംഖ്യ മാത്രം കണ്ടാൽ അത് നല്ലതാണോ മോശമാണോ എന്ന് മനസ്സിലാകില്ല. അതിനാൽ **എല്ലാ report-ലും, ഓരോ section-ലും** മുമ്പത്തെ കാലയളവ് സ്വയം കാണിക്കും. പ്രത്യേകം ചോദിക്കേണ്ട.

| എവിടെ | എങ്ങനെ |
|---|---|
| **സംഖ്യാ card-കൾ** | ഇപ്പോഴത്തെ സംഖ്യ, അതിന് താഴെ "മുമ്പ്: 105 · +35%". ശതമാനം മാത്രമല്ല, മുമ്പത്തെ സംഖ്യയും കാണിക്കും. നല്ലത് പച്ച, മോശം ചുവപ്പ്, ഒപ്പം +/- ചിഹ്നവും. ചെലവ്, മറുപടി സമയം പോലുള്ളവ കുറയുന്നതാണ് നല്ലത്, അതിനാൽ നിറം തിരിച്ചാകും |
| **Charts** | ഇപ്പോഴത്തെ കാലയളവ് കടുത്ത നിറത്തിൽ. മുമ്പത്തേത് മങ്ങിയ/കുത്തുവരയിൽ അതേ chart-ൽ (Shopify രീതി) |
| **പട്ടികകൾ** | ഓരോ വരിയിലും "ഇപ്പോൾ", "മുമ്പ്", "മാറ്റം" columns. ഉദാ: Agent report-ൽ ഓരോ agent-ന്റെയും attend % ഇപ്പോൾ vs മുമ്പ് |
| **Funnel** | ഓരോ ഘട്ടത്തിലേക്കുമുള്ള % ഇപ്പോൾ vs മുമ്പ്. ഏറ്റവും കുറഞ്ഞ ഘട്ടം അടയാളപ്പെടുത്തും |
| **ഒറ്റ വാചകം** | "കഴിഞ്ഞ ആഴ്ചയേക്കാൾ 35% കൂടുതൽ leads; പക്ഷേ Appointment 25.7%-ൽ നിന്ന് 23.9%-ലേക്ക് കുറഞ്ഞു" |
| **PDF / Excel / slides** | Downloads-ലും അതേ താരതമ്യം. Excel-ൽ "മുമ്പ്", "മാറ്റം" columns |

**"മുമ്പ്" എന്താണ് (filter bar-ൽ മാറ്റാം):**
- Default: **തൊട്ടുമുമ്പത്തെ അതേ നീളമുള്ള കാലയളവ്.** ഈ ആഴ്ച vs കഴിഞ്ഞ ആഴ്ച, ഈ മാസം vs കഴിഞ്ഞ മാസം.
- **കഴിഞ്ഞ വർഷം ഇതേ സമയം.** സീസൺ ഉള്ള business-ന്: ഉത്സവ കാലം, admission കാലം.
- **താരതമ്യം വേണ്ട** (ഓഫ് ചെയ്യാം).

**ന്യായം:**
- ഓടിക്കൊണ്ടിരിക്കുന്ന കാലയളവ് മുമ്പത്തേതിന്റെ അതേ ദിവസങ്ങളുമായി മാത്രം താരതമ്യം ചെയ്യും. ഈ മാസം 15 വരെ vs കഴിഞ്ഞ മാസം 15 വരെ. ഇത് ഇപ്പോഴത്തെ Reports-ൽ ഇതിനകം ചെയ്യുന്നുണ്ട് (`period.ts`).
- മുമ്പത്തെ കാലയളവിൽ ഡാറ്റ ഇല്ലെങ്കിൽ (ഉദാ: ആ feature വന്നിട്ടില്ലായിരുന്നു) "താരതമ്യത്തിന് മുമ്പത്തെ ഡാറ്റ ഇല്ല" എന്ന് കാണിക്കും. 0-ൽ നിന്ന് ∞% എന്ന് കാണിക്കില്ല.
- എണ്ണം വളരെ കുറവാണെങ്കിൽ ("3-ൽ നിന്ന് 6, +100%") അത് മങ്ങിച്ച്, "എണ്ണം കുറവ്" എന്ന് കാണിക്കും.

**സാങ്കേതികം:**
- ഓരോ report-ന്റെയും function ഒരേ filter-ോടെ രണ്ടുതവണ വിളിക്കും: ഇപ്പോഴത്തെ കാലയളവിനും മുമ്പത്തെ കാലയളവിനും.
- രണ്ടും ഒരേ API മറുപടിയിൽ (`current`, `previous`) വരും. പുതിയ SQL വേണ്ട.
- ഓരോ report-ലെയും "താരതമ്യം" tab (§4.9) ഇതിന്റെ വിപുലീകരണമാണ്: "മുമ്പ്" എന്നതിന് പകരം ഏത് കാര്യവും (agent, പരസ്യം, ശാഖ) തിരഞ്ഞെടുക്കാം.

### Filter bar (URL-ൽ)
- **കാലയളവ്, എല്ലാ report-ലും ഒന്നുതന്നെ** (owner ഉറപ്പാക്കിയത്):
  - **പ്രധാന ബട്ടണുകൾ, എപ്പോഴും കാണുന്നവ:** ഇന്ന് (Today) · ഈ ആഴ്ച (This week) · ഈ മാസം (This month) · തീയതികൾ (Dates).
  - **"കൂടുതൽ" എന്നതിൽ, പൂർത്തിയായ കാലയളവുകൾ:** ഇന്നലെ · കഴിഞ്ഞ ആഴ്ച · കഴിഞ്ഞ മാസം · കഴിഞ്ഞ 7 ദിവസം · കഴിഞ്ഞ 30 ദിവസം · ഈ വർഷം. ആഴ്ചതോറുമുള്ള meeting-ൽ "കഴിഞ്ഞ ആഴ്ച" മുഴുവനായി കാണാൻ.
  - Default: ഈ ആഴ്ച (ഇപ്പോഴത്തെ പോലെ).
  - തിരഞ്ഞെടുത്ത കാലയളവ് report-ൽ നിന്ന് report-ലേക്ക് പോകുമ്പോഴും, Export-ലും, താരതമ്യം tab-ലും അതേപടി തുടരും.
  - ആഴ്ച തിങ്കളാഴ്ച തുടങ്ങും. എല്ലാം business-ന്റെ time zone-ൽ (ഇപ്പോഴത്തെ `period.ts` പോലെ).
  - ഫോണിൽ നാല് പ്രധാന ബട്ടണുകൾ ഒറ്റ വരിയിൽ.
- താരതമ്യം: മുൻ കാലയളവ് / കഴിഞ്ഞ വർഷം.
- ടീം, agent, ചാനൽ, WhatsApp നമ്പർ, source, category.
- നീക്കാവുന്ന chips. ഫോണിൽ ഒരു sheet-ൽ.
- Report-ൽ നിന്ന് report-ലേക്ക് പോകുമ്പോൾ filter അതേപടി തുടരും.
- Server role അനുസരിച്ച് filter മുറിക്കും.

### Downloads
| | PDF | Excel | Slides |
|---|---|---|---|
| All report | ✅ ഇപ്പോഴുള്ള 6 പേജ് | ✅ | ✅ ഇപ്പോഴുള്ളത് |
| ഓരോ വിഷയ report-ഉം (8) | ✅ ആ വിഷയം മുഴുവൻ | ✅ എല്ലാ വരികളും | ✅ |
| ഓരോ report-ന്റെയും താരതമ്യം tab | ✅ | ✅ | ✅ |
| Performance guide | ✅ | ✅ (കണ്ടെത്തലുകളുടെ പട്ടിക) | ✅ (ഓരോ കണ്ടെത്തലും ഒരു slide) |
| Agent report card (ഒരാൾ) | ✅ | ✅ | ✅ |

**എല്ലാ report-നും മൂന്നും: ഒഴിവില്ല** (owner ആവശ്യപ്പെട്ടത്). ഇത് സാധ്യമാക്കാൻ ഓരോ report-ഉം ഒരു പൊതു "report രൂപം" (cards, charts, പട്ടികകൾ, കുറിപ്പുകൾ) ആയി ഡാറ്റ തിരികെ തരും. മൂന്ന് പൊതു builders ആ രൂപത്തിൽ നിന്ന് PDF, Excel, PowerPoint ഉണ്ടാക്കും. അതിനാൽ ഓരോ report-നും ഓരോ ഫയൽ-തരത്തിനും വേറെ code എഴുതേണ്ട. ഇപ്പോഴുള്ള `report-pdf.ts`, `excel.ts`, `presentation-pptx.ts` എന്നിവ ഈ പൊതു builders ആയി മാറ്റും.

എല്ലാം supervisor-നും മുകളിലുള്ളവർക്കും മാത്രം. Agent-ന് സ്വന്തം report card PDF മാത്രം (owner തീരുമാനിക്കണം, §8).

Audit, rate limit, പൊതുവായ PDF slot, business-ന്റെ നിറവും logo-യും ഭാഷയും എന്നിവ ഇപ്പോഴത്തെ പോലെ.

### Schedule ചെയ്ത് അയയ്ക്കൽ: WhatsApp, Telegram, Email (owner ആവശ്യപ്പെട്ടത്)
- ഏത് report, ഏത് ആവൃത്തി (ദിവസം/ആഴ്ച/മാസം), ആർക്ക് (owner, ശാഖാ മാനേജർ), എവിടേക്ക്.
- **മൂന്ന് വഴികൾ:**
  - **WhatsApp:** ചെറിയ ചുരുക്കം + PDF document.
  - **Telegram:** ചുരുക്കം + PDF (account-ന്റെ Telegram bot വഴി). 24 മണിക്കൂർ പരിധിയില്ല.
  - **Email:** ചുരുക്കം + PDF/Excel attachment (SendGrid അല്ലെങ്കിൽ ബന്ധിപ്പിച്ച Microsoft mailbox വഴി).
- ഒരേ schedule ഒന്നിലധികം വഴികളിലേക്കും ഒന്നിലധികം ആളുകൾക്കും അയയ്ക്കാം.
- ലഭിക്കുന്നവർ: CRM അംഗങ്ങൾ മാത്രം (owner, admin, supervisor). ആ ആൾക്ക് അനുമതിയുള്ള ഡാറ്റ മാത്രമേ report-ൽ വരൂ. Role മാറിയാൽ അടുത്ത തവണ മുതൽ അത് പാലിക്കും. പുറത്തുള്ള email വിലാസങ്ങൾ admin പ്രത്യേകം അനുവദിച്ചാൽ മാത്രം.
- ഓരോ അയയ്ക്കലും രേഖപ്പെടുത്തും (എപ്പോൾ, ആർക്ക്, വിജയിച്ചോ). പരാജയപ്പെട്ടാൽ ലളിതമായ കാരണവും.
- Dev machine-ൽ (`APP_ENV=development`) ഒന്നും അയയ്ക്കില്ല (send guard).

### WhatsApp report templates: Templates section-ൽ തയ്യാറായവ (owner ആവശ്യപ്പെട്ടത്)
- WhatsApp-ൽ ആൾ 24 മണിക്കൂറിനുള്ളിൽ message അയച്ചിട്ടില്ലെങ്കിൽ, Meta അംഗീകരിച്ച template വഴി മാത്രമേ report അയയ്ക്കാൻ പറ്റൂ.
- **Templates section-ൽ "Report templates" എന്ന തയ്യാറായ കൂട്ടം:**
  - **Weekly report:** ആഴ്ചയുടെ ചുരുക്കം + PDF.
  - **Daily report:** ദിവസത്തിന്റെ ചുരുക്കം + PDF.
  - **Monthly report:** മാസത്തിന്റെ ചുരുക്കം + PDF.
  - **Alert:** "ഇന്ന് 15 leads-നെ ആരും വിളിച്ചിട്ടില്ല" പോലുള്ളവ, PDF ഇല്ലാതെ.
- ഓരോന്നും **Utility** വിഭാഗം, **Document header** (PDF), body-യിൽ variables ({{1}} പേര്, {{2}} കാലയളവ്, {{3}} ചുരുക്കം). Malayalam, English പതിപ്പുകൾ.
- Business **ഒരു click-ൽ** Meta-ക്ക് അംഗീകാരത്തിന് അയയ്ക്കാം. അംഗീകാരത്തിന്റെ നില (Pending / Approved / Rejected) അവിടെ കാണിക്കും.
- Report schedule ചെയ്യുമ്പോൾ അംഗീകരിച്ച template സ്വയം തിരഞ്ഞെടുക്കും. ഇല്ലെങ്കിൽ "Templates-ൽ Weekly report അംഗീകാരത്തിന് അയയ്ക്കുക" എന്ന് ലളിതമായി പറയും.
- 24 മണിക്കൂറിനുള്ളിലാണെങ്കിൽ template ഇല്ലാതെ സാധാരണ message + PDF.
- ഇപ്പോഴുള്ള template സംവിധാനം (alert templates, AI template kit) തന്നെ ഉപയോഗിക്കും.

**Meta-യുടെ പുതിയ നിയമങ്ങൾ (15 നവംബർ 2026-ന് പരിശോധിച്ചത്):**
- **1 ഒക്ടോബർ 2026 മുതൽ** utility template 24 മണിക്കൂർ window-ന്റെ ഉള്ളിൽ അയച്ചാലും പണം ഈടാക്കും. സാധാരണ service message ഓരോ നമ്പറിനും മാസം 1,000 വരെ സൗജന്യമാണ്. അതിനാൽ:
  - ആൾ 24 മണിക്കൂറിനുള്ളിൽ message അയച്ചിട്ടുണ്ടെങ്കിൽ → സാധാരണ message + PDF (സൗജന്യ പരിധിക്കുള്ളിൽ).
  - ഇല്ലെങ്കിൽ മാത്രം → utility template.
  - Status webhook-ലെ `pricing.category`, `pricing.type` സൂക്ഷിക്കും, Spending report-ൽ ശരിയായ ചെലവ് വരാൻ.
- **Template utility ആയി തന്നെ നിൽക്കണം.** Meta ഇപ്പോൾ category സ്വയം മാറ്റും. "Marketing" ആയാൽ കൂടുതൽ ചെലവും ആളുകൾക്കുള്ള അയയ്ക്കൽ പരിധിയും വരും. അതിനാൽ:
  - വാചകം പൂർണ്ണമായും വിവരം മാത്രം: "{{1}} എന്ന സ്ഥാപനത്തിന്റെ ഈ ആഴ്ചത്തെ report ചേർത്തിരിക്കുന്നു."
  - "grow", "boost", "offer" പോലുള്ള വാക്കുകൾ ഇല്ല. Sales പേജിലേക്കുള്ള ബട്ടൺ ഇല്ല.
  - Report ആവശ്യപ്പെട്ട (schedule ചെയ്ത) staff-ന് മാത്രം.
  - Template-ന്റെ category മാറിയാൽ (webhook) admin-നെ അറിയിക്കും.
  - Error 131049 വന്നാൽ (marketing പരിധി) 24 മണിക്കൂർ വീണ്ടും ശ്രമിക്കില്ല.
- Document (PDF) header utility template-ൽ അനുവദനീയമാണ്.
- India: INR billing-ലേക്കുള്ള മാറ്റം 31 ഡിസംബർ 2026-നകം.

**Meta API version (അടിയന്തരം):**
- **Marketing API v21.0-ന്റെ കാലാവധി കഴിഞ്ഞു.** പരസ്യ ഡാറ്റ, ചെലവ്, lead form, CAPI എന്നിവ v27.0-ലേക്ക് മാറ്റി (`src/lib/meta/versions.ts`). ഇത് ഘട്ടം A-യിൽ ചെയ്തു.
- **WhatsApp, Messenger, Instagram calls v21.0 → 2027 ജനുവരി 21-നകം മാറ്റണം.** വേറിട്ട ജോലി, ഡിസംബറിൽ.
- **Reach / frequency** 13 മാസത്തിലധികം പഴയ ഡാറ്റയ്ക്കോ പരിധി കഴിഞ്ഞാലോ Meta അയക്കില്ല. അപ്പോൾ "—" കാണിക്കും, 0 അല്ല. ദിവസേനയുള്ള reach കൂട്ടി കാലയളവിന്റെ reach ആക്കില്ല.
- **Meta-യുടെ സ്വന്തം "messaging conversations started" എണ്ണം** (`onsite_conversion.messaging_conversation_started_7d`) CRM-ൽ യഥാർത്ഥത്തിൽ വന്ന chat-കളുടെ എണ്ണത്തിനടുത്ത് കാണിക്കും (ഘട്ടം D). രണ്ടും വ്യത്യസ്തമായിരിക്കും, ഏതാണ് ഏതെന്ന് വ്യക്തമാക്കും.
- **WhatsApp പരസ്യ click-ൽ `ctwa_clid` ഇല്ലെങ്കിൽ** അത് WhatsApp Status പരസ്യമാണ്. Ad report-ൽ അങ്ങനെ കാണിക്കും.
- **Instagram/Messenger പരസ്യം വഴി വന്ന chat-കൾക്ക് 28 സെപ്റ്റംബർ 2026 മുതൽ 7 ദിവസത്തെ window.** Conversation report-ൽ ഇത് കണക്കിലെടുക്കും.
- **Conversions API:** QualifiedLead, Purchase events Meta-യിലേക്ക് തിരികെ അയച്ചാൽ പരസ്യങ്ങൾ മെച്ചപ്പെടും (ഘട്ടം D, event_id വെച്ച് ആവർത്തനം തടയും).
- **Alert:** Performance guide-ൽ ചുവപ്പ് വന്നാൽ schedule കാക്കാതെ അറിയിക്കും (Tableau Pulse രീതി). ഉദാ: "ഇന്ന് 2 മണി വരെ 15 leads-നെ ആരും വിളിച്ചിട്ടില്ല."

### ആർക്ക് എന്ത്
| Report | Agent | Supervisor | Admin / Owner |
|---|---|---|---|
| All report | സ്വന്തം | ടീം | എല്ലാം |
| Lead | സ്വന്തം leads | ✅ | ✅ |
| Agent | സ്വന്തം report card മാത്രം | ✅ എല്ലാവരും | ✅ |
| Ad, Campaign, Spending & ROI | — | admin അനുവദിച്ചാൽ | ✅ |
| Conversation | സ്വന്തം | ✅ | ✅ |
| Sales & Pipeline | സ്വന്തം deals | ✅ | ✅ |
| AI & Automation | — | ✅ | ✅ |
| താരതമ്യം tab | "ഞാൻ ഇപ്പോൾ vs ഞാൻ മുമ്പ്" മാത്രം | ✅ | ✅ |
| Performance guide | സ്വന്തം guide | ടീം | എല്ലാം |

ഓരോ report-നും Settings → Members-ൽ വേറെ അനുമതി. `PAGE_SECTIONS`-ൽ path ചേർത്താൽ സ്വയം വരും.

### സാങ്കേതികം
- ഓരോ report-നും സ്വന്തം API: `/api/reports/<പേര്>`. Server-ൽ role check, account scope, rate limit.
- ഒരേ കണക്കുകൂട്ടൽ രണ്ടിടത്ത് എഴുതില്ല. All report വിഷയ reports-ന്റെ അതേ functions ഉപയോഗിക്കും (ഇപ്പോൾ dashboard `buildSummary` പങ്കിടുന്ന പോലെ).
- താരതമ്യം tab: ആ report-ന്റെ function രണ്ടുതവണ (രണ്ട് filter-ോടെ) വിളിച്ച് വ്യത്യാസം കണക്കാക്കും. പുതിയ SQL വേണ്ട.
- Performance guide: എല്ലാ report-ന്റെയും ഫലത്തിൽ നിന്ന് pure functions. ഓരോ നിയമത്തിനും test.
- Skeleton, `loadSeq`, ചെറിയ cache, "ഈ സമയം വരെ".
- എല്ലാ വ്യവസായത്തിനും: category പേര്, ഘട്ടങ്ങൾ business-ന്റേത്.

---

## 6. പുതിയ ഡാറ്റ വേണ്ടവ (migrations)
1. **Conversation report:** `conversations`-ൽ ആദ്യ customer message, ആദ്യ മറുപടി, ആര് മറുപടി നൽകി എന്നിവയ്ക്കുള്ള columns. `leads.first_response_at` പോലെ.
2. **AI handover:** ഓരോ കൈമാറ്റവും ഒരു വരി: എപ്പോൾ, കാരണം, ജോലി സമയത്തിന് പുറത്താണോ, ആര് ഏറ്റെടുത്തു.
3. **ലക്ഷ്യങ്ങൾ (goals):** ആർക്ക്, എന്ത് അളവ്, എത്ര, ഏത് കാലയളവ്.
4. **Schedule ചെയ്ത reports:** ഏത് report, filter, ആർക്ക്, എപ്പോൾ.
5. **Performance guide നിർദ്ദേശങ്ങൾ:** "ചെയ്തു / വേണ്ട" രേഖ.

എല്ലാം ഇരട്ടിയായി ഓടിയാലും സുരക്ഷിതം. crm_prod_copy-ൽ dry-run. പഴയ ഡാറ്റ "ഈ തീയതി മുതൽ" എന്ന് അടയാളപ്പെടുത്തും.

---

## 7. നിർമ്മാണ ഘട്ടങ്ങൾ

| ഘട്ടം | എന്ത് | പുതിയ ഡാറ്റ |
|---|---|---|
| **A. ചട്ടക്കൂട്** | Settings പോലെ Reports-ന് സ്വന്തം side menu, main menu സ്വയം ചുരുങ്ങും (`isCompactPage`-ൽ `/reports`), ഫോണിൽ drill-down; side menu-വിൽ Export (PDF, Excel, PowerPoint icons സഹിതം), പൊതു report രൂപവും മൂന്ന് പൊതു builders-ഉം; പൊതു filter bar, ഇപ്പോഴുള്ളത് മാറ്റൽ (Lead, Agent ടീം കാഴ്ച, Sales, Spending, Ad report ← Ads പേജ്), Settings-ൽ brand നിറം/category പേര്, ഓരോ report-നും അനുമതി | ഇല്ല |
| **B. Agent + Lead ആഴത്തിൽ** | Agent report card (ഒരാൾ), calls answer rate/സംസാര സമയം/മണിക്കൂർ, follow-up കൃത്യത, lead → ആദ്യ call സമയം, അനങ്ങാത്ത leads. ഓരോന്നിനും PDF, Excel | ഇല്ല |
| **C. താരതമ്യം tab + Performance guide (പാളി 1)** | എല്ലാ report-ലും താരതമ്യം tab (ഒരേ ഘടകം), code കണ്ടെത്തൽ card-കൾ, ചെയ്യാനുള്ള ബട്ടണുകൾ, All report-ൽ ആദ്യ 3 | ഇല്ല |
| **D. Ad + Campaign + ROI** | Ad report PDF/Excel, പരസ്യം × agent, എല്ലാ broadcasts-ഉം, templates, ROI | ഇല്ല |
| **E. Conversation + AI & Automation** | chat മറുപടി വേഗം, സംതൃപ്തി, handover, ഉത്തരം കിട്ടാത്ത ചോദ്യങ്ങൾ, flow drop-off | 1, 2 |
| **F. Performance guide AI (പാളി 2) + അയയ്ക്കൽ + ലക്ഷ്യങ്ങൾ** | AI നിർദ്ദേശങ്ങൾ (ഓൺ/ഓഫ്), schedule (WhatsApp, Telegram, Email), Templates-ൽ തയ്യാറായ report templates, ചുവപ്പ് alert, goals, നിർദ്ദേശങ്ങളുടെ ഫലം | 3, 4, 5 |

**ക്രമത്തിന്റെ കാരണം:**
- A–D-ക്ക് migration വേണ്ട. ഡാറ്റ ഇതിനകം ഉണ്ട്, വേഗം ഫലം കിട്ടും.
- Agent, Lead, താരതമ്യം, Performance guide എന്നിവയാണ് owner ആദ്യം ചോദിച്ചത്.
- AI പാളി ഏറ്റവും അവസാനം. Code കണ്ടെത്തൽ ശരിയാണെന്ന് ഉറപ്പായ ശേഷമേ AI-ക്ക് വസ്തുതകൾ കൊടുക്കൂ.

**ഓരോ ഘട്ടത്തിലും:**
- 10 bug നിയമങ്ങൾ, AGENTS.md സുരക്ഷ.
- "ആര് എന്ത് കാണും" tests (agent മറ്റൊരാളുടെ id കൊടുത്താലും കിട്ടരുത്).
- Production copy-ൽ SQL പരിശോധന.
- crm-ui-review, 360px ഫോൺ പരിശോധന.
- PDF/slides കണ്ണുകൊണ്ട് പരിശോധിക്കും.

---

## 8. നിങ്ങൾ തീരുമാനിക്കേണ്ടത്

1. **Report പട്ടിക ശരിയാണോ?** All report + 8 വിഷയ reports (ഓരോന്നിലും താരതമ്യം tab) + Performance guide. ചേർക്കാനോ ഒഴിവാക്കാനോ ഉണ്ടോ? (ഉദാ: "Branch report" വേണോ, ഒന്നിലധികം ശാഖകളുള്ള business-ന്?)
2. **Agent-ന് സ്വന്തം report card PDF download ചെയ്യാമോ?** ഇപ്പോൾ agent-ന് ഒരു export-ഉം ഇല്ല.
3. **Performance guide-ലെ AI പാളി:** ഓരോ business-ഉം Settings-ൽ ഓൺ ചെയ്യണോ (നിർദ്ദേശം: അതെ, default ഓഫ്)?
4. **ലക്ഷ്യങ്ങൾ (goals) വേണോ?** ആര് സജ്ജമാക്കും: owner മാത്രം, supervisor-ഉം?
5. **Ads പേജ്:** Reports → Ad report-ലേക്ക് പൂർണ്ണമായി മാറ്റണോ, രണ്ടിടത്തും വേണോ?
6. **ചുവപ്പ് alert:** schedule കാക്കാതെ WhatsApp-ൽ അറിയിക്കണോ? ആർക്ക്?
7. **ആദ്യം ഏത്?** നിർദ്ദേശം: **A → B → C** (ചട്ടക്കൂട്, Agent/Lead ആഴത്തിൽ, താരതമ്യം tab + Performance guide).

---

## 9. ഗവേഷണത്തിന്റെ പരിധികൾ
- ചില vendor പേജുകൾ തുറക്കാൻ കഴിഞ്ഞില്ല: Salesforce Help, HubSpot dashboard filters, AiSensy FAQ, Pipedrive scheduled reports, respond.io agent access.
- Leaderboard ഗവേഷണം Wharton ചുരുക്കത്തിൽ നിന്ന്.
- "എവിടെ കുറഞ്ഞു" കണ്ടെത്തൽ (contribution analysis) വലിയ account-ൽ വേഗം പരീക്ഷിച്ചിട്ടില്ല. ഘട്ടം C-യിൽ production copy-ൽ അളക്കും.
