# AI Knowledge Base: തിരുത്തലുകൾ, കൃത്യത, വേഗം, Google Maps — പ്ലാൻ

തീയതി: 2026-11-21 · നില: **പ്ലാൻ മാത്രം, build ചെയ്തിട്ടില്ല** · എല്ലാ industry-ക്കും

അടിസ്ഥാനം: രണ്ട് ഏജന്റുകൾ. (1) നമ്മുടെ knowledge base കോഡിന്റെ പൂർണ്ണ പരിശോധന.
(2) Intercom Fin, Zendesk, Freshdesk, HubSpot, Salesforce, Voiceflow, Dify, Botpress,
Chatbase, OpenAI, Google Vertex, Wati, AiSensy, Interakt, Yellow.ai, Haptik — ഇവരുടെ രീതികളും
Google Maps API-കളും (ഉറവിടങ്ങൾ ഏറ്റവും താഴെ).

---

## 1. നിങ്ങളുടെ ചോദ്യങ്ങൾക്ക് ഉത്തരം

**Edit-ൽ Text/Notes-ന്റെ ഉള്ളടക്കം വരാത്തത് എന്തുകൊണ്ട്?**
ഇത് **പാതിയിൽ നിർത്തിയ feature** ആണ്, ഡിസൈനല്ല. Edit dialog (`training-tab.tsx` EditContentDialog)
Q&A-യ്ക്ക് മാത്രമേ ഉള്ളടക്കം കാണിക്കൂ. Text/Notes, Document എന്നിവയ്ക്ക് Content ബോക്സ് ഇല്ല;
list API ഉള്ളടക്കം അയക്കുന്നുമില്ല. പക്ഷേ server-ലെ PATCH ഇപ്പോൾത്തന്നെ content സ്വീകരിക്കുന്നു,
മാറ്റിയാൽ "Not trained" ആക്കി വീണ്ടും chunk + embed ചെയ്യുന്നു. അതിനാൽ തിരുത്തൽ പ്രധാനമായും UI-ൽ.
Create, Edit dialog-കളുടെ ഘടനയും വ്യത്യസ്തമാണ് (Create-ൽ cards, Edit-ൽ dropdown) — ഒന്നാക്കും.

**എല്ലാ knowledge base-ഉം ശരിയായി വരുന്നുണ്ടോ?** ഇല്ല, ഈ പിഴവുകൾ കണ്ടു:

| # | പിഴവ് | ഗൗരവം |
|---|---|---|
| 1 | Text/Notes, Document ഉള്ളടക്കം edit ചെയ്യാൻ കഴിയില്ല; chatbot source "remote" ആയി കണക്കാക്കുന്നില്ല | ഉയർന്നത് |
| 2 | Training കഴിയുമ്പോൾ pending/failed **എല്ലാം** "Trained" ആക്കുന്നു, `last_error` മായ്ക്കുന്നു — sheet/website sync പരാജയം 10 മിനിറ്റിനകം മറയുന്നു; ഭാവി തീയതിയുള്ളവയ്ക്ക് vector ഇല്ലാതെ "Trained" | ഉയർന്നത് |
| 3 | **Google Sheet വരികൾ 800 അക്ഷരത്തിൽ മുറിയുന്നു**, header വിട്ടുപോകുന്നു (വരികൾ ഒറ്റ `\n`-ൽ ചേർത്തതിനാൽ) — "fees എത്ര" പോലുള്ള ചോദ്യത്തിന് തെറ്റായ/പാതി ഉത്തരം | ഉയർന്നത് |
| 4 | പുതിയ entry ഉണ്ടാക്കുമ്പോൾ **മുഴുവൻ ഉള്ളടക്കവും audit log-ൽ** എഴുതുന്നു (നയത്തിന് എതിര്) | ഇടത്തരം |
| 5 | Sheet/website-ന് content PATCH സ്വീകരിക്കുന്നു (അടുത്ത sync മായ്ക്കും); വലിപ്പ പരിധിയില്ല | ഇടത്തരം |
| 6 | 200k അക്ഷരത്തിൽ കൂടിയാൽ **ഒന്നും പറയാതെ മുറിക്കുന്നു**; PDF OCR പാതിയിൽ നിന്നാൽ അറിയില്ല; sheet-ന് പരിധിയില്ല | ഇടത്തരം |
| 7 | Sheet/website refresh-ന് മണിക്കൂറിൽ **എല്ലാ account-നും കൂടി 20 മാത്രം** — account കൂടുമ്പോൾ പുതുക്കൽ വൈകും | ഇടത്തരം |
| 8 | "Train now" ഓരോ chunk-ഉം ഒന്നൊന്നായി, HTTP request-നുള്ളിൽ — വലിയ KB timeout ആകാം | ഇടത്തരം |
| 9 | Sheet/table "What this is for" മാറ്റിയാൽ അടുത്ത sync വരെ ബാധിക്കില്ല | കുറഞ്ഞത് |
| 10 | "Semantic only" mode "Auto" തന്നെ; പഴയ കമന്റ് | കുറഞ്ഞത് |
| 11 | **DOCX, ചിത്രം upload ഇല്ല** (PDF, TXT, MD, CSV, JSON, HTML മാത്രം) | കുറഞ്ഞത് |

**Google Sheet connect ശരിയാണോ?** ബന്ധിപ്പിക്കൽ ശരി: Google sign-in വഴി സ്വകാര്യ sheet-ഉം,
അല്ലെങ്കിൽ public link വഴി CSV-ഉം; SSRF സുരക്ഷ ഉണ്ട്; 55 മിനിറ്റ് കൂടുമ്പോൾ പുതുക്കുന്നു,
മാറിയ/നീക്കിയ വരികൾ ശരിയായി മാറ്റുന്നു. **പ്രശ്നം** മുകളിലെ #2, #3, #7: വരികൾ മുറിയുന്നു,
പരാജയം മറയുന്നു, വലിയ സെർവറിൽ വൈകുന്നു. ഒപ്പം sheet-ന് "വരി തിരയൽ" (exact filter) ഇല്ല —
Data Store table-ന് മാത്രം ഉണ്ട്.

**പുതിയ feature വന്നിട്ടുണ്ടോ?** കഴിഞ്ഞ 80 commit-ൽ knowledge base-ൽ പുതിയതൊന്നുമില്ല (reports,
ads, audit ജോലി). മുമ്പ് ചെയ്തവ (വീണ്ടും ചെയ്യില്ല): hybrid search (RRF), edit-ന് 1 മിനിറ്റിനകം
പുതുക്കൽ, Gemini Embedding 2, ഓരോ മറുപടിക്കും Sources, table വരി തിരയൽ, ചെറിയ table മുഴുവൻ,
people-data guard, സ്വകാര്യ sheet, sheet chooser, accuracy rules, Q&A edit, validity dates,
audience, auto-train.

---

## 2. ലോകത്തെ AI ആപ്പുകൾ എന്ത് ചെയ്യുന്നു (ചുരുക്കം)

- **ഇന്ത്യൻ WhatsApp CRM-കൾ (Wati, AiSensy, Interakt, Gallabox) ദുർബലം:** PDF/URL upload മാത്രം,
  sync ഇല്ല, ടെസ്റ്റ് ഇല്ല, gap റിപ്പോർട്ട് ഇല്ല. Wati-യിൽ മാറ്റാൻ മുഴുവൻ PDF വീണ്ടും upload.
- **Intercom Fin:** audiences, 250 "guidance" നിയമങ്ങൾ, ഉത്തരം കിട്ടാത്ത ചോദ്യങ്ങൾ വിഷയം
  തിരിച്ച് ആഴ്ചതോറും "ഇത് ചേർക്കൂ" നിർദ്ദേശം, batch test.
- **HubSpot:** പരിഹരിച്ച ചാറ്റുകളിൽ നിന്ന് Q&A സ്വയം ഉണ്ടാക്കി owner അംഗീകരിക്കുന്നു.
- **Zendesk:** article-കൾ ticket-കളുമായി താരതമ്യം ചെയ്ത് coverage %.
- **Dify / OpenAI / Voiceflow:** parent-child chunks, hybrid + rerank, metadata filter, score threshold.
- **Botpress:** മാറിയ ഫയൽ മാത്രം വീണ്ടും (hash), website recrawl schedule.
- **Google Vertex:** ഉത്തരം എഴുതിയ ശേഷം "grounding check" — ഓരോ വാചകവും ഉറവിടത്തിൽ ഉണ്ടോ.
- **Anthropic contextual retrieval:** ഓരോ chunk-നും 1–2 വാചക സന്ദർഭം ചേർത്ത് index ചെയ്യുമ്പോൾ
  തിരയൽ പരാജയം 35%, keyword കൂടി 49%, rerank കൂടി **67% കുറഞ്ഞു**.

നമുക്ക് Indian മത്സരാർത്ഥികളേക്കാൾ വളരെ മുന്നിലെത്താം — Intercom/HubSpot-ന്റെ രീതികൾ
മലയാളം/Manglish-ന് യോജിപ്പിച്ച്.

---

## 3. ഘട്ടങ്ങൾ

### ഘട്ടം 1 — പിഴവുകൾ തിരുത്തൽ (ആദ്യം, ചെറുത്)
- **Edit ശരിയാക്കൽ:** Create-ഉം Edit-ഉം ഒരേ ഘടകം. Text/Notes, Document: Title + Content ബോക്സ്
  (തുറക്കുമ്പോൾ server-ൽ നിന്ന് മുഴുവൻ ഉള്ളടക്കം). Q&A: ചോദ്യം + ഉത്തരം. Website/Sheet/Table/
  Chatbot: ഉള്ളടക്കം വായിക്കാൻ മാത്രം + "Re-fetch now"; Sheet-ന് "Change link"; Document-ന്
  "Replace file". Audience cards, "When is this true?" രണ്ടിലും ഒരുപോലെ.
- Server: content trim + 200k പരിധി; remote തരങ്ങൾക്ക് content നിരസിക്കുക; description
  മാറിയാൽ sheet/table ഉടൻ വീണ്ടും serialize.
- **Training നില സത്യസന്ധമാക്കുക (#2):** embed ചെയ്തവ മാത്രം "Trained"; sync പരാജയം
  "Failed — reason" ആയി നിലനിൽക്കും; ഭാവി തീയതിയുള്ളവ "Scheduled".
- **Sheet വരികൾ (#3):** ഓരോ വരിയും സ്വന്തം chunk, header സഹിതം ("Course: MDP | Fee: 10,400 …");
  table header PARTIAL ആകുമ്പോഴും നിലനിൽക്കും. (എല്ലാ sheet-ഉം ഒരിക്കൽ വീണ്ടും embed ആകും.)
- Audit log-ൽ ഉള്ളടക്കം വേണ്ട (#4); 200k കവിഞ്ഞാൽ വ്യക്തമായ സന്ദേശം, OCR പാതിയിൽ നിന്നാൽ
  "Partly read" (#6); refresh പരിധി account തിരിച്ച് (#7); Train now പിന്നിൽ, 5 chunk ഒരുമിച്ച്,
  പുരോഗതി കാണിക്കും (#8).
- ടെസ്റ്റുകൾ ആദ്യം (ചുവപ്പ് → പച്ച): training നില, sheet chunking, PATCH content നിയമങ്ങൾ.

### ഘട്ടം 2 — കൃത്യത (ഏറ്റവും വലിയ നേട്ടം)
1. **Manglish/മലയാളം ചോദ്യം മാറ്റിയെഴുതൽ:** ഒരു ചെറിയ Flash വിളി — ചോദ്യം (a) English,
   (b) മലയാളം ലിപി, (c) പേരുകൾ/സംഖ്യകൾ; മൂന്നും വെച്ച് തിരയൽ. ("fees ethra" → "fee amount" + "ഫീസ്")
2. **Keyword തിരയൽ ശക്തമാക്കൽ:** Postgres `simple` + `pg_trgm` (മലയാളത്തിന് stemmer ഇല്ലാത്തതിനാൽ)
   — course code, പേര്, വില പോലുള്ളവ embedding വിട്ടാലും കിട്ടും.
3. **Contextual chunks:** train ചെയ്യുമ്പോൾ ഓരോ chunk-നും "ഇത് ACSTI 2026 MDP fee പട്ടികയിൽ നിന്ന്"
   പോലുള്ള 1 വാചകം. ഒരിക്കലുള്ള ചെലവ്, മാറിയ chunk-ന് മാത്രം.
4. **Rerank:** 30–50 സ്ഥാനാർത്ഥികളിൽ നിന്ന് മികച്ച 5–8 (Gemini scorer; Cohere ഓപ്ഷണൽ).
5. **ഘടന അനുസരിച്ച് chunking:** heading-ൽ മുറിക്കൽ, Q&A ഒറ്റ chunk, parent-child (ചെറിയ
   വാചകം കണ്ടെത്തി അതിന്റെ മുഴുവൻ ഭാഗം അയക്കൽ), വാക്കിന് നടുവിൽ മുറിക്കില്ല, overlap.
6. **"അറിയില്ല" എന്ന് പറയാൻ:** rerank score താഴെയെങ്കിൽ ഊഹിക്കാതെ വ്യക്ത ചോദ്യം/handover
   (ഭാഷ തിരിച്ച് threshold).
7. **Grounding check:** ഉത്തരത്തിലെ ഓരോ വിലയും തീയതിയും ഉറവിടത്തിൽ ഉണ്ടോ; ഇല്ലെങ്കിൽ ഒരിക്കൽ
   വീണ്ടും, പിന്നെ handover (accuracy rules-ന്റെ വിപുലീകരണം).
8. Sheet-നും "വരി തിരയൽ" (exact filter/count) — Data Store table പോലെ.
9. Gemini embedding-ന് `RETRIEVAL_DOCUMENT` / `RETRIEVAL_QUERY` task type.

### ഘട്ടം 3 — വേഗം, ചെലവ്
- Prompt caching (static system prompt ആദ്യം); ആവർത്തിക്കുന്ന FAQ-ന് ഉത്തര cache (KB version
  മാറിയാൽ മായും; വ്യക്തിപരമായ ഉത്തരം ഒരിക്കലും cache ചെയ്യില്ല).
- മാറിയ chunk മാത്രം വീണ്ടും embed; vector 768/1536 dimension; ANN index (HNSW).
- ചോദ്യം മാറ്റിയെഴുതലും തിരയലും ഒരുമിച്ച് (parallel); ഉത്തരത്തിന് thinking കുറവ്.
- ലക്ഷ്യം: ഒരു മറുപടി 2.5 സെക്കൻഡിൽ താഴെ (ai-latency log-ൽ അളക്കും).

### ഘട്ടം 4 — owner-ന് സഹായിക്കുന്ന feature-കൾ
1. **Content-gap inbox:** ഉത്തരം കിട്ടാത്ത/handover ആയ ചോദ്യങ്ങൾ ആഴ്ചതോറും വിഷയം തിരിച്ച് —
   "ഇതിന് Q&A ചേർക്കൂ" ഒറ്റ click.
2. **ചാറ്റുകളിൽ നിന്ന് Q&A:** staff നന്നായി മറുപടി നൽകിയ ചാറ്റുകളിൽ നിന്ന് AI Q&A draft →
   owner അംഗീകരിക്കും.
3. **Batch test:** യഥാർത്ഥ ചോദ്യങ്ങൾ (ചാറ്റിൽ നിന്ന്) pass/fail; ഉള്ളടക്കം മാറുമ്പോൾ സ്വയം ഓടും.
4. **Chunk preview + inline edit + version/rollback.**
5. **Website/Sheet/Drive sync schedule**, "last synced", എന്ത് മാറി എന്ന diff.
6. **Validity തീയതി കഴിയാറാകുമ്പോൾ owner-ന് alert** ("ഫീസ് പട്ടിക 31 മാർച്ചിന് കാലഹരണപ്പെടും").
7. **Contradiction/duplicate കണ്ടെത്തൽ** (രണ്ട് ഉറവിടത്തിൽ രണ്ട് ഫീസ്).
8. Inbox-ലെ Sources-ൽ "ഈ ഉത്തരം തെറ്റ്" → ശരിയായ ഉറവിടത്തോടെ തിരുത്തൽ.
9. **Knowledge health dashboard:** resolution %, handover % വിഷയം തിരിച്ച്, ഉപയോഗിക്കാത്ത ഉറവിടം.
10. DOCX + ചിത്രം (OCR) upload.

### ഘട്ടം 5 — Google Maps (ഉപയോഗപ്രദമായ "ഓട്ടോമാറ്റിക് കണ്ടെത്തലുകൾ")

| # | ആശയം | API | ചെലവ് (India, പരിശോധിക്കണം) | ശ്രദ്ധിക്കേണ്ടത് |
|---|---|---|---|---|
| M1 | **WhatsApp location pin → district/area സ്വയം** (lead form-ൽ) | Geocoding | 70k/മാസം സൗജന്യം, പിന്നെ $1.50/1000 | lat/lng 30 ദിവസം മാത്രം; customer സ്ഥിരീകരിച്ച district പേര് സൂക്ഷിക്കുക |
| M2 | **ഏറ്റവും അടുത്ത branch** (യാത്രാസമയം സഹിതം) AI മറുപടിയിൽ | Route Matrix | 70k സൗജന്യം | branch സ്ഥാനം നമ്മുടെ ഡാറ്റ |
| M3 | **Map link / location** WhatsApp മറുപടിയിൽ | Maps URL / location message | സൗജന്യം | — |
| M4 | **Address check** form-ൽ | Places Autocomplete | session സൗജന്യം | India Address Validation ഇപ്പോഴും preview |
| M5 | **Google review alert + AI draft മറുപടി** (സ്വന്തം business) | Business Profile API | സൗജന്യം (Google അംഗീകാരം ~14 ദിവസം) | **ഏറ്റവും നല്ല ആശയം** |
| M6 | **വിൽപ്പനയ്ക്ക്/സന്ദർശനത്തിന് ശേഷം review ചോദിക്കൽ** (WhatsApp-ൽ review link) | place_id link | സൗജന്യം | സന്തുഷ്ടരോട് മാത്രം ചോദിക്കരുത് (Google നയം) |
| M7 | **Google profile-ലെ സമയം/വിലാസം/സേവനങ്ങൾ knowledge base-ലേക്ക് sync** | Business Profile API | സൗജന്യം | Q&A API 2025-ൽ നിർത്തി |
| M8 | **സമീപത്തെ business കണ്ടെത്തൽ (lead discovery)** | Places Text/Nearby Search | 35k സൗജന്യം, പിന്നെ $9.60/1000 | ⚠️ **Google നയം: പേര്, വിലാസം, review പകർത്തി സൂക്ഷിക്കാൻ പാടില്ല** — തത്സമയം കാണിക്കൽ മാത്രം; lead staff കൈകൊണ്ട്. നിയമോപദേശം ആവശ്യം |

ശുപാർശ: M1, M2, M3, M5, M6, M7 ആദ്യം. M8 നിയമപരമായ അപകടസാധ്യതയുള്ളതിനാൽ അവസാനം,
നിങ്ങൾ ഉറപ്പിച്ചാൽ മാത്രം.

---

## 4. ക്രമവും വലിപ്പവും

| ഘട്ടം | വലിപ്പം | Migration |
|---|---|---|
| 1. പിഴവുകൾ | ഇടത്തരം | വേണ്ടിവരില്ല (training നില column ഉണ്ടെങ്കിൽ) |
| 2. കൃത്യത | വലുത് | `pg_trgm` index, chunk context column |
| 3. വേഗം | ഇടത്തരം | ANN index |
| 4. Owner feature-കൾ | വലുത് (പല ഭാഗം) | gap/version table-കൾ |
| 5. Google Maps | ഇടത്തരം | branch സ്ഥാനങ്ങൾ, review table |

ഓരോ ഘട്ടവും: ടെസ്റ്റ് ആദ്യം, 10 bug നിയമങ്ങൾ, data safety, `crm-ui-review`, 360px ബ്രൗസർ
പരിശോധന, eval suite-ൽ മുമ്പും ശേഷവും കൃത്യത അളക്കൽ (മലയാളം/Manglish യഥാർത്ഥ ചോദ്യങ്ങൾ).

## 5. നിങ്ങളുടെ തീരുമാനം വേണ്ടവ

1. ഘട്ടം 1 (പിഴവുകൾ) ഉടൻ തുടങ്ങട്ടേ?
2. Rerank-ന് Gemini മാത്രം (അധിക ചെലവ് കുറവ്) അതോ Cohere (കൂടുതൽ കൃത്യത, പുതിയ key)?
3. Google Maps: ഏത് ആശയങ്ങൾ (M1–M8)? Google Maps API key ഓരോ business-ന്റേതോ നിങ്ങളുടേതോ?
4. M8 (business കണ്ടെത്തൽ) വേണോ — Google നയം കാരണം "കാണിക്കൽ മാത്രം" രീതിയിൽ?
5. Content-gap, ചാറ്റിൽ നിന്ന് Q&A എന്നിവ owner-ന് മാത്രമോ supervisor-നും?

---
ഉറവിടങ്ങൾ: Intercom Fin audiences / guidance / content suggestions / batch testing / pricing;
Zendesk knowledge copilot; Freshdesk knowledge sources; HubSpot customer agent sources; Salesforce
Agentforce RAG; Voiceflow KB metadata/LLM chunking; Dify parent-child + retrieval docs; Botpress ADK
knowledge; Chatbase data sources; OpenAI file search guide; Google Vertex check-grounding; Anthropic
contextual retrieval; Wati KnowBot; AiSensy AI agent; Google Maps India pricing, Places policies,
Business Profile FAQ, Address Validation coverage; Meta WhatsApp location request messages.
വിലകളും സൗജന്യ പരിധികളും Google billing console-ൽ ഉറപ്പാക്കണം (പരിശോധിക്കാത്തവ റിപ്പോർട്ടിൽ
"(unverified)" ആയി രേഖപ്പെടുത്തിയിട്ടുണ്ട്).
