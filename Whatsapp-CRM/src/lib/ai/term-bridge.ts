/**
 * English words customers write in Malayalam script, and the months.
 *
 * Kerala businesses keep their data in English — "Training", "Fee",
 * "Doctor", "October" — and their customers ask in Malayalam, very often
 * with the same English word spelt in Malayalam letters: "ട്രെയിനിങ്",
 * "ഫീസ്", "ഡോക്ടർ", "ഒക്ടോബർ". Matching words cannot bridge two scripts,
 * so a Malayalam question found none of the English knowledge whenever
 * the search by meaning was unavailable. This is the bridge: a short,
 * general list — not any one business's vocabulary.
 *
 * Entries are word starts (stems): Malayalam adds its endings to the word
 * itself, so "ട്രെയിനിങ്" also covers "ട്രെയിനിങ്ങിൽ".
 */

const TERMS: ReadonlyArray<readonly [readonly string[], readonly string[]]> = [
  // Learning and events
  [['ട്രെയിനിങ്', 'ട്രെയിനിംഗ്', 'പരിശീലന'], ['training']],
  [['പ്രോഗ്രാം'], ['programme', 'program']],
  [['കോഴ്സ്'], ['course']],
  [['ക്ലാസ്', 'ക്ലാസ്സ്'], ['class']],
  [['ബാച്ച്'], ['batch']],
  [['സിലബസ്'], ['syllabus']],
  [['പരീക്ഷ', 'എക്സാം'], ['exam', 'examination']],
  [['സർട്ടിഫിക്കറ്റ്'], ['certificate']],
  [['അഡ്മിഷൻ', 'പ്രവേശന'], ['admission']],
  [['സീറ്റ്'], ['seat']],
  [['വർക്ക്ഷോപ്പ്', 'ശില്പശാല'], ['workshop']],
  [['സെമിനാർ'], ['seminar']],
  [['ഹോസ്റ്റൽ', 'താമസ'], ['hostel', 'accommodation']],
  // Registration and money
  [['രജിസ്ട്രേഷൻ', 'രജിസ്റ്റർ'], ['registration', 'register']],
  [['ഫീസ്', 'ഫീ'], ['fee', 'fees']],
  [['വില'], ['price', 'rate', 'cost']],
  [['പേയ്മെന്റ്', 'പേമെന്റ്', 'പണമട'], ['payment', 'pay']],
  [['ഡിസ്കൗണ്ട്', 'കിഴിവ്'], ['discount']],
  [['ഓഫർ'], ['offer']],
  [['റീഫണ്ട്'], ['refund']],
  [['ബിൽ'], ['bill', 'invoice']],
  [['അക്കൗണ്ട്'], ['account']],
  // Time and place
  [['തീയതി', 'തിയതി', 'ഡേറ്റ്'], ['date']],
  [['സമയ', 'ടൈം', 'ടൈമിങ്'], ['time', 'timing', 'hours']],
  [['മാസ'], ['month']],
  [['ആഴ്ച'], ['week']],
  [['ഷെഡ്യൂൾ'], ['schedule']],
  [['വിലാസ', 'അഡ്രസ്', 'അഡ്രസ്സ്'], ['address']],
  [['ലൊക്കേഷൻ', 'സ്ഥല'], ['location', 'venue']],
  [['ബ്രാഞ്ച്', 'ശാഖ'], ['branch']],
  [['ഓഫീസ്'], ['office']],
  [['മാപ്പ്'], ['map']],
  [['ഫോൺ', 'നമ്പർ'], ['phone', 'number', 'contact']],
  [['ഇമെയിൽ', 'ഈമെയിൽ'], ['email']],
  [['വെബ്സൈറ്റ്'], ['website']],
  // Health
  [['ഡോക്ടർ'], ['doctor']],
  [['ഹോസ്പിറ്റൽ', 'ആശുപത്രി'], ['hospital']],
  [['ക്ലിനിക്'], ['clinic']],
  [['അപ്പോയിന്റ്മെന്റ്', 'അപ്പോയ്ന്റ്മെന്റ്', 'ബുക്കിങ്', 'ബുക്കിംഗ്'], ['appointment', 'booking']],
  [['ഒപി', 'ഒ.പി'], ['op', 'opd', 'outpatient']],
  [['ടെസ്റ്റ്', 'പരിശോധന'], ['test']],
  [['സ്കാൻ'], ['scan']],
  [['മരുന്ന്', 'മെഡിസിൻ'], ['medicine']],
  [['ഡിപ്പാർട്ട്മെന്റ്', 'വിഭാഗ'], ['department', 'category']],
  // Shops and services
  [['പ്രോഡക്റ്റ്', 'ഉൽപ്പന്ന', 'സാധന'], ['product', 'item']],
  [['സ്റ്റോക്ക്'], ['stock']],
  [['ഡെലിവറി'], ['delivery']],
  [['ഓർഡർ'], ['order']],
  [['സർവീസ്', 'സേവന'], ['service']],
  [['വാറന്റി', 'ഗ്യാരന്റി'], ['warranty', 'guarantee']],
  [['ലോൺ', 'വായ്പ'], ['loan']],
  [['ഗോൾഡ്', 'സ്വർണ'], ['gold']],
  [['ജോലി', 'ജോബ്', 'ഒഴിവ്'], ['job', 'vacancy']],
  [['സ്റ്റാഫ്', 'ജീവനക്കാർ'], ['staff', 'employee']],
]

/**
 * Malayalam as it is actually typed, made comparable: older keyboards
 * write a chillu as consonant + virama + zero-width joiner (ര + ് + zero-width joiner) where
 * newer ones use one letter ("ർ"); both become the one letter, and any
 * other zero-width joiner is dropped.
 */
export function normalizeMalayalam(text: string): string {
  return text
    .normalize('NFC')
    .replace(/\u0D23\u0D4D\u200D/g, '\u0D7A')
    .replace(/\u0D28\u0D4D\u200D/g, '\u0D7B')
    .replace(/\u0D30\u0D4D\u200D/g, '\u0D7C')
    .replace(/\u0D32\u0D4D\u200D/g, '\u0D7D')
    .replace(/\u0D33\u0D4D\u200D/g, '\u0D7E')
    .replace(/\u0D15\u0D4D\u200D/g, '\u0D7F')
    .replace(/[\u200C\u200D]/g, '')
}

/** Month number (1–12) → exact names, and Malayalam word starts that
 *  also cover the month with an ending ("ഒക്ടോബറിൽ", "ഏപ്രിലിൽ"). May
 *  has no word start: "മെയിൽ" is mail. */
const MONTHS: ReadonlyArray<{ names: readonly string[]; stems: readonly string[] }> = [
  { names: ['january', 'jan', 'ജനുവരി'], stems: ['ജനുവരി'] },
  { names: ['february', 'feb', 'ഫെബ്രുവരി'], stems: ['ഫെബ്രുവരി'] },
  { names: ['march', 'mar', 'മാർച്ച്'], stems: ['മാർച്ച'] },
  { names: ['april', 'apr', 'ഏപ്രിൽ'], stems: ['ഏപ്രി'] },
  { names: ['may', 'മേയ്', 'മെയ്'], stems: [] },
  { names: ['june', 'jun', 'ജൂൺ'], stems: ['ജൂണ'] },
  { names: ['july', 'jul', 'ജൂലൈ'], stems: ['ജൂലൈ'] },
  { names: ['august', 'aug', 'ഓഗസ്റ്റ്', 'ആഗസ്റ്റ്', 'ആഗസ്ത്'], stems: ['ഓഗസ്റ്റ', 'ആഗസ്റ്റ', 'ആഗസ്ത'] },
  { names: ['september', 'sep', 'sept', 'സെപ്റ്റംബർ', 'സെപ്തംബർ'], stems: ['സെപ്റ്റംബ', 'സെപ്തംബ'] },
  { names: ['october', 'oct', 'ഒക്ടോബർ', 'ഒക്റ്റോബർ'], stems: ['ഒക്ടോബ', 'ഒക്റ്റോബ'] },
  { names: ['november', 'nov', 'നവംബർ'], stems: ['നവംബ'] },
  { names: ['december', 'dec', 'ഡിസംബർ'], stems: ['ഡിസംബ'] },
]

/** The English name of each month, January first. */
export const MONTH_ENGLISH: readonly string[] = MONTHS.map((m) => m.names[0])

/** The month (1–12) a word names, in English or Malayalam, or null. */
export function monthOf(word: string): number | null {
  const w = normalizeMalayalam(word).toLowerCase().trim()
  if (!w) return null
  for (let i = 0; i < MONTHS.length; i++) {
    if (MONTHS[i].names.includes(w)) return i + 1
    if (MONTHS[i].stems.some((st) => w.startsWith(st))) return i + 1
  }
  return null
}

/** A final chillu becomes its full letter when an ending is added:
 *  "ഡോക്ടർ" → "ഡോക്ടറെ", "ഫോൺ" → "ഫോണിൽ", "ഹോസ്പിറ്റൽ" → "ഹോസ്പിറ്റലിൽ". */
const CHILLU_FULL: Record<string, readonly string[]> = {
  'ൺ': ['ണ'],
  'ൻ': ['ന', 'റ'],
  'ർ': ['റ', 'ര'],
  'ൽ': ['ല'],
  'ൾ': ['ള'],
  'ൿ': ['ക'],
}

/** A word and the forms it takes before an ending. */
export function wordStarts(word: string): string[] {
  const chars = Array.from(word)
  const full = CHILLU_FULL[chars[chars.length - 1]]
  if (!full || chars.length < 3) return [word]
  const base = chars.slice(0, -1).join('')
  return [word, ...full.map((f) => base + f)]
}

/** A word matches a stem when it starts with it (an ending was added),
 *  or is the stem missing at most its last letter. */
function termMatches(token: string, stem: string): boolean {
  if (wordStarts(stem).some((s) => token.startsWith(s))) return true
  const t = Array.from(token).length
  return t >= 2 && stem.startsWith(token) && t >= Array.from(stem).length - 1
}

/** English words a (lower-cased) token stands for — empty when none. */
export function englishFor(token: string): string[] {
  if (!/[\u0D00-\u0D7F]/.test(token)) return []
  const out: string[] = []
  for (const [ml, en] of TERMS) {
    if (ml.some((m) => termMatches(token, m))) out.push(...en)
  }
  const month = monthOf(token)
  if (month) out.push(MONTH_ENGLISH[month - 1])
  return out
}
