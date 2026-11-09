/**
 * The words of the Spending report PDF, in English: the default, and the
 * master every other language is checked against (a language file must give
 * every key, and the same {placeholders}: i18n.test.ts).
 */
export const en = {
  title: 'Spending report',
  period: 'Period',
  generatedOn: 'Generated {date}',
  taxId: 'GST / tax no. {id}',
  pageOf: 'Page {n} of {total}',
  nothing: 'Nothing in this period.',

  kTotal: 'Total spend',
  kWhatsapp: 'WhatsApp messages',
  kAi: 'AI (estimated)',
  kAds: 'Meta Ads',
  kCpl: 'Cost per lead',
  kCpw: 'Cost per won deal',
  subDelivered: '{n} delivered · {free} free',
  subCalls: 'Calls: {n}',
  subLeads: 'Leads: {n}',
  subWon: 'Deals won: {n}',
  notConnected: 'Not connected',
  notAvailable: 'Not available',

  secDaily: 'Spend by day',
  secCategory: 'WhatsApp by category',
  secNumber: 'WhatsApp by number',
  secPerson: 'WhatsApp by person',
  secTeam: 'By team',
  secChannel: 'By channel',
  secAiFeature: 'AI by feature',
  secAiPerson: 'AI by person',

  colName: 'Name',
  colCategory: 'Category',
  colMessages: 'Messages',
  colAmount: 'Amount',
  colPeople: 'People',
  colWhatsapp: 'WhatsApp',
  colAiUsd: 'AI (USD)',
  colCalls: 'Calls',
  colChannel: 'Channel',
  colTeam: 'Team',

  catMarketing: 'Marketing',
  catUtility: 'Utility',
  catAuthentication: 'Authentication',
  catAuthInternational: 'Authentication (international)',
  catService: 'Service',
  catFreeEntry: 'Free entry point',
  free: 'free',

  notAttributed: 'Not attributed',
  notRecorded: 'Not recorded',
  removedNumber: 'Removed number',
  formerMember: 'Former member',
  aiAssistant: 'AI assistant',
  system: 'System',
  noTeam: 'No team',

  legendWhatsapp: 'WhatsApp messages',
  legendAi: 'AI (estimated)',

  featChat: 'Customer chat replies',
  featTranslation: 'Translation',
  featPolish: 'Improve message',
  featJudgement: 'Hand-over judgement',
  featLeadDetect: 'Lead detection',
  featKnowledge: 'Knowledge training and search',
  featVoice: 'Voice notes and voice replies',
  featFiles: 'Reading images and files',
  featTemplates: 'Templates and sheet rules',
  featOther: 'Other AI work',

  noteEstimate: 'AI cost is an estimate from the provider’s own token counts. Amounts in different currencies are never added together.',
  noteExcluded: 'Some amounts are not in the total because they are in a different currency.',
  noteUnpriced: 'Some messages have no price yet: set the business currency in Settings.',
  notePending: 'Some messages are sent but not yet delivered, so they are not counted yet.',
  noteAdsError: 'Ad spend could not be read from Meta.',
} as const

export type Key = keyof typeof en
export type Dict = Record<Key, string>
