/**
 * The "check your details" page's own words, in every language a business
 * can choose for it. The column headers are the business's and are shown
 * as written in its sheet.
 */

import type { FormLang } from '@/lib/data-store/form-i18n'

export interface VerifyStrings {
  title: string
  intro: string
  by: (date: string) => string
  allCorrect: string
  fix: string
  save: string
  cancel: string
  saving: string
  thanks: string
  thanksCorrected: string
  already: string
  correctAgain: string
  hidden: string
  editHint: (business: string) => string
  closed: (business: string) => string
  notFound: (business: string) => string
  error: string
  tooMany: string
  reload: string
  noChange: string
  needHelp: string
  call: string
  whatsapp: string
}

const en: VerifyStrings = {
  title: 'Check your details',
  intro: 'Please check that the details below are correct.',
  by: (d) => `Please check by ${d}`,
  allCorrect: 'Everything is correct',
  fix: 'Correct a mistake',
  save: 'Save corrections',
  cancel: 'Cancel',
  saving: 'Saving…',
  thanks: 'Thank you — your details are confirmed.',
  thanksCorrected: 'Thank you — your corrections are saved.',
  already: 'You have already confirmed these details.',
  correctAgain: 'Correct something',
  hidden: 'Hidden for your privacy',
  editHint: (b) => `Only the details with a box can be corrected here. For anything else, contact ${b}.`,
  closed: (b) => `This link has expired or is no longer active. Please contact ${b}.`,
  notFound: (b) => `We could not find your details. Please contact ${b}.`,
  error: 'Something went wrong. Please try again.',
  tooMany: 'Too many tries. Please wait a few minutes and try again.',
  reload: 'Reload',
  noChange: 'Nothing was changed. Edit a detail, or press “Everything is correct”.',
  needHelp: 'Need help?',
  call: 'Call',
  whatsapp: 'WhatsApp',
}

const ml: VerifyStrings = {
  title: 'നിങ്ങളുടെ വിവരങ്ങൾ പരിശോധിക്കുക',
  intro: 'താഴെയുള്ള വിവരങ്ങൾ ശരിയാണോ എന്ന് ദയവായി പരിശോധിക്കുക.',
  by: (d) => `${d}-നകം പരിശോധിക്കുക`,
  allCorrect: 'എല്ലാം ശരിയാണ്',
  fix: 'തെറ്റ് തിരുത്തുക',
  save: 'തിരുത്തലുകൾ സേവ് ചെയ്യുക',
  cancel: 'റദ്ദാക്കുക',
  saving: 'സേവ് ചെയ്യുന്നു…',
  thanks: 'നന്ദി — നിങ്ങളുടെ വിവരങ്ങൾ ഉറപ്പാക്കി.',
  thanksCorrected: 'നന്ദി — തിരുത്തലുകൾ സേവ് ചെയ്തു.',
  already: 'നിങ്ങൾ ഈ വിവരങ്ങൾ ഇതിനകം ഉറപ്പാക്കിയിട്ടുണ്ട്.',
  correctAgain: 'എന്തെങ്കിലും തിരുത്തുക',
  hidden: 'സ്വകാര്യതയ്ക്കായി മറച്ചിരിക്കുന്നു',
  editHint: (b) => `ബോക്സ് ഉള്ള വിവരങ്ങൾ മാത്രമേ ഇവിടെ തിരുത്താനാകൂ. മറ്റുള്ളവയ്ക്ക് ${b}-നെ ബന്ധപ്പെടുക.`,
  closed: (b) => `ഈ ലിങ്കിന്റെ സമയം കഴിഞ്ഞു അല്ലെങ്കിൽ ഇപ്പോൾ പ്രവർത്തിക്കുന്നില്ല. ${b}-നെ ബന്ധപ്പെടുക.`,
  notFound: (b) => `നിങ്ങളുടെ വിവരങ്ങൾ കണ്ടെത്താനായില്ല. ${b}-നെ ബന്ധപ്പെടുക.`,
  error: 'എന്തോ പിശക് സംഭവിച്ചു. വീണ്ടും ശ്രമിക്കുക.',
  tooMany: 'കൂടുതൽ ശ്രമങ്ങൾ. കുറച്ച് മിനിറ്റ് കഴിഞ്ഞ് വീണ്ടും ശ്രമിക്കുക.',
  reload: 'വീണ്ടും തുറക്കുക',
  noChange: 'ഒന്നും മാറ്റിയിട്ടില്ല. ഒരു വിവരം തിരുത്തുക, അല്ലെങ്കിൽ “എല്ലാം ശരിയാണ്” അമർത്തുക.',
  needHelp: 'സഹായം വേണോ?',
  call: 'വിളിക്കുക',
  whatsapp: 'WhatsApp',
}

const hi: VerifyStrings = {
  title: 'अपनी जानकारी जाँचें',
  intro: 'कृपया जाँचें कि नीचे दी गई जानकारी सही है।',
  by: (d) => `कृपया ${d} तक जाँचें`,
  allCorrect: 'सब कुछ सही है',
  fix: 'गलती सुधारें',
  save: 'सुधार सहेजें',
  cancel: 'रद्द करें',
  saving: 'सहेजा जा रहा है…',
  thanks: 'धन्यवाद — आपकी जानकारी की पुष्टि हो गई है।',
  thanksCorrected: 'धन्यवाद — आपके सुधार सहेज लिए गए हैं।',
  already: 'आप इस जानकारी की पुष्टि पहले ही कर चुके हैं।',
  correctAgain: 'कुछ सुधारें',
  hidden: 'आपकी गोपनीयता के लिए छिपाया गया',
  editHint: (b) => `यहाँ केवल बॉक्स वाली जानकारी सुधारी जा सकती है। बाकी के लिए ${b} से संपर्क करें।`,
  closed: (b) => `इस लिंक की समय-सीमा समाप्त हो गई है या यह अब सक्रिय नहीं है। कृपया ${b} से संपर्क करें।`,
  notFound: (b) => `हमें आपकी जानकारी नहीं मिली। कृपया ${b} से संपर्क करें।`,
  error: 'कुछ गड़बड़ हो गई। कृपया फिर से कोशिश करें।',
  tooMany: 'बहुत अधिक प्रयास। कुछ मिनट बाद फिर से कोशिश करें।',
  reload: 'फिर से खोलें',
  noChange: 'कुछ नहीं बदला। कोई जानकारी सुधारें, या “सब कुछ सही है” दबाएँ।',
  needHelp: 'मदद चाहिए?',
  call: 'कॉल करें',
  whatsapp: 'WhatsApp',
}

const ta: VerifyStrings = {
  title: 'உங்கள் விவரங்களைச் சரிபார்க்கவும்',
  intro: 'கீழே உள்ள விவரங்கள் சரியானவையா என்று சரிபார்க்கவும்.',
  by: (d) => `${d}-க்குள் சரிபார்க்கவும்`,
  allCorrect: 'அனைத்தும் சரி',
  fix: 'தவறைத் திருத்து',
  save: 'திருத்தங்களைச் சேமி',
  cancel: 'ரத்து செய்',
  saving: 'சேமிக்கிறது…',
  thanks: 'நன்றி — உங்கள் விவரங்கள் உறுதிசெய்யப்பட்டன.',
  thanksCorrected: 'நன்றி — உங்கள் திருத்தங்கள் சேமிக்கப்பட்டன.',
  already: 'இந்த விவரங்களை ஏற்கனவே உறுதிசெய்துவிட்டீர்கள்.',
  correctAgain: 'ஏதாவது திருத்து',
  hidden: 'உங்கள் தனியுரிமைக்காக மறைக்கப்பட்டது',
  editHint: (b) => `பெட்டி உள்ள விவரங்களை மட்டுமே இங்கு திருத்த முடியும். மற்றவற்றுக்கு ${b} ஐத் தொடர்பு கொள்ளவும்.`,
  closed: (b) => `இந்த இணைப்பின் காலம் முடிந்துவிட்டது அல்லது இப்போது செயலில் இல்லை. ${b} ஐத் தொடர்பு கொள்ளவும்.`,
  notFound: (b) => `உங்கள் விவரங்களைக் கண்டுபிடிக்க முடியவில்லை. ${b} ஐத் தொடர்பு கொள்ளவும்.`,
  error: 'ஏதோ தவறு நடந்தது. மீண்டும் முயற்சிக்கவும்.',
  tooMany: 'அதிக முயற்சிகள். சில நிமிடங்கள் கழித்து மீண்டும் முயற்சிக்கவும்.',
  reload: 'மீண்டும் திற',
  noChange: 'எதுவும் மாற்றப்படவில்லை. ஒரு விவரத்தைத் திருத்தவும், அல்லது “அனைத்தும் சரி” என்பதை அழுத்தவும்.',
  needHelp: 'உதவி வேண்டுமா?',
  call: 'அழைக்கவும்',
  whatsapp: 'WhatsApp',
}

const kn: VerifyStrings = {
  title: 'ನಿಮ್ಮ ವಿವರಗಳನ್ನು ಪರಿಶೀಲಿಸಿ',
  intro: 'ಕೆಳಗಿನ ವಿವರಗಳು ಸರಿಯಾಗಿವೆಯೇ ಎಂದು ದಯವಿಟ್ಟು ಪರಿಶೀಲಿಸಿ.',
  by: (d) => `${d} ರೊಳಗೆ ಪರಿಶೀಲಿಸಿ`,
  allCorrect: 'ಎಲ್ಲವೂ ಸರಿಯಾಗಿದೆ',
  fix: 'ತಪ್ಪು ಸರಿಪಡಿಸಿ',
  save: 'ತಿದ್ದುಪಡಿಗಳನ್ನು ಉಳಿಸಿ',
  cancel: 'ರದ್ದುಮಾಡಿ',
  saving: 'ಉಳಿಸಲಾಗುತ್ತಿದೆ…',
  thanks: 'ಧನ್ಯವಾದಗಳು — ನಿಮ್ಮ ವಿವರಗಳನ್ನು ದೃಢೀಕರಿಸಲಾಗಿದೆ.',
  thanksCorrected: 'ಧನ್ಯವಾದಗಳು — ನಿಮ್ಮ ತಿದ್ದುಪಡಿಗಳನ್ನು ಉಳಿಸಲಾಗಿದೆ.',
  already: 'ನೀವು ಈ ವಿವರಗಳನ್ನು ಈಗಾಗಲೇ ದೃಢೀಕರಿಸಿದ್ದೀರಿ.',
  correctAgain: 'ಏನಾದರೂ ಸರಿಪಡಿಸಿ',
  hidden: 'ನಿಮ್ಮ ಗೌಪ್ಯತೆಗಾಗಿ ಮರೆಮಾಡಲಾಗಿದೆ',
  editHint: (b) => `ಪೆಟ್ಟಿಗೆ ಇರುವ ವಿವರಗಳನ್ನು ಮಾತ್ರ ಇಲ್ಲಿ ಸರಿಪಡಿಸಬಹುದು. ಉಳಿದವಕ್ಕೆ ${b} ಅನ್ನು ಸಂಪರ್ಕಿಸಿ.`,
  closed: (b) => `ಈ ಲಿಂಕ್‌ನ ಅವಧಿ ಮುಗಿದಿದೆ ಅಥವಾ ಈಗ ಸಕ್ರಿಯವಾಗಿಲ್ಲ. ${b} ಅನ್ನು ಸಂಪರ್ಕಿಸಿ.`,
  notFound: (b) => `ನಿಮ್ಮ ವಿವರಗಳು ಸಿಗಲಿಲ್ಲ. ${b} ಅನ್ನು ಸಂಪರ್ಕಿಸಿ.`,
  error: 'ಏನೋ ತಪ್ಪಾಗಿದೆ. ದಯವಿಟ್ಟು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.',
  tooMany: 'ಹೆಚ್ಚು ಪ್ರಯತ್ನಗಳು. ಕೆಲವು ನಿಮಿಷಗಳ ನಂತರ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.',
  reload: 'ಮತ್ತೆ ತೆರೆಯಿರಿ',
  noChange: 'ಏನನ್ನೂ ಬದಲಿಸಿಲ್ಲ. ಒಂದು ವಿವರವನ್ನು ಸರಿಪಡಿಸಿ, ಅಥವಾ “ಎಲ್ಲವೂ ಸರಿಯಾಗಿದೆ” ಒತ್ತಿ.',
  needHelp: 'ಸಹಾಯ ಬೇಕೇ?',
  call: 'ಕರೆ ಮಾಡಿ',
  whatsapp: 'WhatsApp',
}

const te: VerifyStrings = {
  title: 'మీ వివరాలను సరిచూసుకోండి',
  intro: 'కింది వివరాలు సరైనవో కాదో దయచేసి సరిచూసుకోండి.',
  by: (d) => `${d} లోపు సరిచూసుకోండి`,
  allCorrect: 'అన్నీ సరైనవే',
  fix: 'పొరపాటు సరిచేయండి',
  save: 'సవరణలను సేవ్ చేయండి',
  cancel: 'రద్దు చేయండి',
  saving: 'సేవ్ చేస్తోంది…',
  thanks: 'ధన్యవాదాలు — మీ వివరాలు నిర్ధారించబడ్డాయి.',
  thanksCorrected: 'ధన్యవాదాలు — మీ సవరణలు సేవ్ అయ్యాయి.',
  already: 'మీరు ఈ వివరాలను ఇప్పటికే నిర్ధారించారు.',
  correctAgain: 'ఏదైనా సరిచేయండి',
  hidden: 'మీ గోప్యత కోసం దాచబడింది',
  editHint: (b) => `పెట్టె ఉన్న వివరాలను మాత్రమే ఇక్కడ సరిచేయవచ్చు. మిగతా వాటికి ${b}ని సంప్రదించండి.`,
  closed: (b) => `ఈ లింక్ గడువు ముగిసింది లేదా ఇప్పుడు పనిచేయడం లేదు. ${b}ని సంప్రదించండి.`,
  notFound: (b) => `మీ వివరాలు కనుగొనలేకపోయాం. ${b}ని సంప్రదించండి.`,
  error: 'ఏదో పొరపాటు జరిగింది. దయచేసి మళ్లీ ప్రయత్నించండి.',
  tooMany: 'చాలా ప్రయత్నాలు. కొన్ని నిమిషాల తర్వాత మళ్లీ ప్రయత్నించండి.',
  reload: 'మళ్లీ తెరవండి',
  noChange: 'ఏమీ మార్చలేదు. ఒక వివరాన్ని సరిచేయండి, లేదా “అన్నీ సరైనవే” నొక్కండి.',
  needHelp: 'సహాయం కావాలా?',
  call: 'కాల్ చేయండి',
  whatsapp: 'WhatsApp',
}

const ar: VerifyStrings = {
  title: 'تحقق من بياناتك',
  intro: 'يرجى التحقق من صحة البيانات أدناه.',
  by: (d) => `يرجى التحقق قبل ${d}`,
  allCorrect: 'كل شيء صحيح',
  fix: 'تصحيح خطأ',
  save: 'حفظ التصحيحات',
  cancel: 'إلغاء',
  saving: 'جارٍ الحفظ…',
  thanks: 'شكرًا لك — تم تأكيد بياناتك.',
  thanksCorrected: 'شكرًا لك — تم حفظ تصحيحاتك.',
  already: 'لقد أكدت هذه البيانات من قبل.',
  correctAgain: 'تصحيح شيء ما',
  hidden: 'مخفي لحماية خصوصيتك',
  editHint: (b) => `يمكن هنا تصحيح البيانات التي لها مربع فقط. لغير ذلك تواصل مع ${b}.`,
  closed: (b) => `انتهت صلاحية هذا الرابط أو لم يعد فعالًا. يرجى التواصل مع ${b}.`,
  notFound: (b) => `لم نتمكن من العثور على بياناتك. يرجى التواصل مع ${b}.`,
  error: 'حدث خطأ ما. يرجى المحاولة مرة أخرى.',
  tooMany: 'محاولات كثيرة. يرجى الانتظار بضع دقائق ثم المحاولة مجددًا.',
  reload: 'إعادة الفتح',
  noChange: 'لم يتغير شيء. صحّح أحد البيانات، أو اضغط «كل شيء صحيح».',
  needHelp: 'هل تحتاج إلى مساعدة؟',
  call: 'اتصل',
  whatsapp: 'واتساب',
}

export const VERIFY_STRINGS: Record<FormLang, VerifyStrings> = { en, ml, hi, ta, kn, te, ar }

export function verifyStrings(lang: string | null | undefined): VerifyStrings {
  return VERIFY_STRINGS[(lang ?? 'en') as FormLang] ?? en
}
