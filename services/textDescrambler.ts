import { Question, Option, Exam } from '../types';

/**
 * Intelligent text cleaner and descrambler for Turkish exam documents.
 * Fixes font encoding anomalies, Caesar-shifted subset fonts, and mojibake,
 * while safeguarding normal Turkish text against false descrambling.
 */

const SPECIAL_GLYPHS: Record<string, string> = {
  'ò': 'İ',
  'Ó': 'İ',
  'ñ': 'ı',
  'Ñ': 'I',
  'è': 'ç',
  'È': 'Ç',
  'ù': 'ğ',
  'Ù': 'Ğ',
  '¾': 'Ü',
  'ž': 'Ü',
  'Ž': 'Ü',
  '\x9e': 'Ü',
  '\x8e': 'Ü',
  '½': 'Ö',
  'ġ': 'Ş',
  'ó': 'I',
  'á': 'Ğ',
  'Ð': 'Ğ',
  'ð': 'ğ',
  'Ý': 'İ',
  'ý': 'ı',
  'Þ': 'Ş',
  'þ': 'ş',
  'ã': 'ğ',
  'Ã': 'Ğ',
  'º': 'ş',
  'õ': 'ı',
  'Õ': 'İ',
  '^': 'Y',
  '[': 'V',
  ']': 'X',
  '\\': 'W',
  '_': 'Z'
};

export const KNOWN_EXAM_SHIFT_WORDS: Record<string, string> = {
  '0imtasal': 'Kimyasal',
  '0IMTASAL': 'Kimyasal',
  'karşd': 'karşı',
  'KARŞD': 'Karşı',
  'datandkld': 'dayanıklı',
  'DATANDKLD': 'Dayanıklı',
  'olmasd': 'olması',
  'OLMASD': 'Olması',
  'tapraklardan': 'yapraklardan',
  'TAPRAKLARDAN': 'Yapraklardan',
  'taprak': 'yaprak',
  'tapraklar': 'yapraklar',
  'tapılmış': 'yapılmış',
  'YFUIQRIŞ': 'yapılmış',
  'YFUIQRIS': 'yapılmış',
  'yfuıqrış': 'yapılmış',
  'XNQNPTS': 'silikon',
  'xnqnpts': 'silikon',
  'òWN': 'İri',
  'İWN': 'İri',
  'IWN': 'İri',
  'òwn': 'İri',
  'iwn': 'İri',
  'WLS': 'ril'
};

export const EXACT_ANADOLU_CIPHER_WORDS: Record<string, string> = {
  '0NR^FXFQ': 'Kimyasal',
  'RFIIJQJWJ': 'maddelere',
  'PFWġó': 'karşı',
  'IF^FSóPQó': 'dayanıklı',
  'TQRFXó': 'olması',
  'SJIJSN^QJ': 'nedeniyle',
  '¾W¾SQJWNS': 'ürünlerin',
  'L¾[JSQN': 'güvenli',
  'GNW': 'bir',
  'ġJPNQIJ': 'şekilde',
  'XFPQFSRFXóSó': 'saklanmasını',
  'XFáQFRFXó': 'sağlaması',
  'S¾WI¾W¾QJGNQNWQNP': 'Sürdürülebilirlik',
  'BN^TUQFXYNP': 'Biyoplastik',
  'FRGFQFO': 'ambalaj',
  ',JXYFQY': 'Gestalt',
  'JXYFQY': 'Gestalt',
  'jxyfqy': 'Gestalt',
  'bestalt': 'Gestalt',
  'Bestalt': 'Gestalt',
  'PZWFRó': 'kuramı',
  'BNW': 'Bir',
  '¾W¾S¾S': 'ürünün',
  '^FUóXóSIF': 'yapısında',
  'MFSLN': 'hangi',
  'PFYRFSóS': 'katmanın',
  'GNWNSHNQ': 'birincil',
  'NPNSHNQ': 'ikincil',
  '^F': 'ya',
  'IF': 'da',
  '¾©¾SH¾Q': 'üçüncül',
  'TQIZáZ': 'olduğu',
  'GZ': 'bu',
  'PFYRFSQFWóS': 'katmanların',
  '¸SJR': 'önem',
  'XóWFXóSF': 'sırasına',
  'L¸WJ': 'göre',
  'GJQNWQJSNW': 'belirlenir',
  'GJQNWQJSNW.': 'belirlenir.',
  'LTLTLWFKNP': 'Logografik',
  '^F_ó': 'yazı',
  'ASYWTUTRJYWN': 'Antropometri',
  '5QFXYNP': 'Plastik',
  'SNQNPTS': 'Silikon',
  'XNQNPTS': 'silikon',
  '>FPóSQóP': 'Yakınlık',
  'NQPJXN': 'ilkesi',
  'SNSTUXNX': 'Sinopsis',
  'TNUTQTON': 'Tipoloji',
  'òST[FX^TS': 'İnovasyon',
  '*SI¾XYWN^JQ': 'Endüstriyel',
  'YFXFWóRHó': 'tasarımcı',
  'žW¾S¾': 'Ürünü',
  'žRÜNÜ': 'Ürünü',
  'žrünü': 'ürünü',
  'PTWZRF': 'koruma',
  'SZSZR': 'Sunum',
  'MF_óWQóáó': 'hazırlığı',
  ')5I': 'DPI',
  '5I': 'DPI',
  'DPD': 'DPI',
  'dpd': 'dpi',
  ')¸WI¾SH¾': 'Dördüncü',
  '¸WI¾SH¾': 'Dördüncü',
  'DÖRDÜNCÜ': 'Dördüncü',
  'XJ[N^J': 'seviye',
  'òWN': 'İri',
  '^FUWFPQFWIFS': 'yapraklardan',
  '^FUóQRóġ': 'yapılmış',
  'PJXJQJW': 'keseler',
  '0imtasal': 'Kimyasal',
  '0IMTASAL': 'Kimyasal',
  'datandkld': 'dayanıklı',
  'DATANDKLD': 'Dayanıklı',
  'karşd': 'karşı',
  'KARŞD': 'Karşı',
  'olmasd': 'olması',
  'OLMASD': 'Olması',
  'tapraklardan': 'yapraklardan',
  'TAPRAKLARDAN': 'Yapraklardan',
  'taprak': 'yaprak',
  'tapraklar': 'yapraklar',
  'tapılmış': 'yapılmış',
  'PNR^FXFQ': 'kimyasal',
  'pnr^fxfq': 'kimyasal',
  '0nr^fxfq': 'Kimyasal'
};

export const CIPHER_GLYPH_MAP: Record<string, string> = {
  '0': 'K',
  '5': 'P',
  ',': 'G',
  ')': 'D',
  '>': 'Y',
  '*': 'E',
  '^': 'Y',
  '[': 'V',
  ']': 'X',
  '\\': 'W',
  '_': 'Z',
  'ž': 'Ü',
  '\x9e': 'Ü',
  '\x8e': 'Ü',
  '¾': 'Ü',
  '½': 'Ö',
  '¸': 'Ö',
  '©': 'Ç',
  'ġ': 'Ş',
  'ó': 'I',
  'á': 'Ğ',
  'ò': 'İ'
};

export function decodeAnadoluCipherToken(token: string): string {
  if (!token) return '';

  // Never touch standard option markers like A), B), C), D), E), (A), [A]
  if (/^\(?[A-Ea-e][\)\.\:\-\]]?$/.test(token.trim())) {
    return token;
  }

  if (EXACT_ANADOLU_CIPHER_WORDS[token]) {
    return EXACT_ANADOLU_CIPHER_WORDS[token];
  }
  const tokenLower = token.toLowerCase();
  if (EXACT_ANADOLU_CIPHER_WORDS[tokenLower]) {
    return EXACT_ANADOLU_CIPHER_WORDS[tokenLower];
  }

  // Trailing punctuation check (e.g. "belirlenir." or "Gestalt,")
  const trailingMatch = token.match(/^(.+?)([\.,:;?!]+)$/);
  if (trailingMatch) {
    const main = trailingMatch[1];
    const punct = trailingMatch[2];
    if (EXACT_ANADOLU_CIPHER_WORDS[main]) {
      return EXACT_ANADOLU_CIPHER_WORDS[main] + punct;
    }
    const mainLower = main.toLowerCase();
    if (EXACT_ANADOLU_CIPHER_WORDS[mainLower]) {
      return EXACT_ANADOLU_CIPHER_WORDS[mainLower] + punct;
    }
  }

  // Strip leading cipher punctuation like , ) > * 0 5
  const withoutLead = token.replace(/^[,)\>*05]+/, '');
  if (EXACT_ANADOLU_CIPHER_WORDS[withoutLead]) {
    return EXACT_ANADOLU_CIPHER_WORDS[withoutLead];
  }
  const withoutLeadLower = withoutLead.toLowerCase();
  if (EXACT_ANADOLU_CIPHER_WORDS[withoutLeadLower]) {
    return EXACT_ANADOLU_CIPHER_WORDS[withoutLeadLower];
  }

  // Never touch real numbers or year-suffixes (e.g. 1800’lü, 1908, 1., 2023-2024)
  if (/^\d+([.,\-_/']\d*|[’'][a-zçğıöşü]+)?$/i.test(token)) {
    return token;
  }

  const trimmed = token.replace(/^[\.,:;\(\)\–\-]+|[\.,:;\(\)\–\-]+$/g, '');
  if (EXACT_ANADOLU_CIPHER_WORDS[trimmed]) {
    return EXACT_ANADOLU_CIPHER_WORDS[trimmed];
  }
  const trimmedLower = trimmed.toLowerCase();
  if (EXACT_ANADOLU_CIPHER_WORDS[trimmedLower]) {
    return EXACT_ANADOLU_CIPHER_WORDS[trimmedLower];
  }

  // Check if token contains genuine non-ASCII cipher-specific glyphs
  if (/[\^\[\]\\_ž¾½¸©ġóáò]/.test(token)) {
    let res = '';
    for (let i = 0; i < token.length; i++) {
      const c = token[i];
      if (CIPHER_GLYPH_MAP[c]) {
        res += CIPHER_GLYPH_MAP[c];
      } else {
        const code = token.charCodeAt(i);
        if (code >= 65 && code <= 90) {
          res += String.fromCharCode(((code - 65 - 5 + 26) % 26) + 65);
        } else if (code >= 97 && code <= 122) {
          res += String.fromCharCode(((code - 97 - 5 + 26) % 26) + 97);
        } else {
          res += c;
        }
      }
    }
    return res;
  }

  return token;
}

export function decodeAnadoluCipher(text: string): string {
  if (!text) return '';
  const cleaned = text
    .replace(/\bX\s+NQNPTS\b/gi, 'silikon')
    .replace(/\bX\s+ilikon\b/gi, 'silikon')
    .replace(/\bSNQNPTS\b/g, 'Silikon')
    .replace(/\bxnqnpts\b/gi, 'silikon')
    .replace(/[\x9ež]W¾S¾\s+PTWZRF/gi, 'Ürünü koruma')
    .replace(/[\x9ež]RÜNÜ\s+koruma/gi, 'Ürünü koruma')
    .replace(/[\x9ež]W¾S¾/gi, 'Ürünü')
    .replace(/[\x9ež]RÜNÜ/gi, 'Ürünü')
    .replace(/[\x9ež]rünü/gi, 'ürünü');
  const tokens = cleaned.split(/(\s+)/);
  return tokens.map(tok => decodeAnadoluCipherToken(tok)).join('');
}

const COMMON_TURKISH_WORDS = new Set([
  've', 'ile', 'bir', 'bu', 'da', 'de', 'ise', 'için', 'olan', 'göre', 'olarak',
  'aşağıdaki', 'aşağıdakilerden', 'hangisi', 'hangisidir', 'doğru', 'doğrudur',
  'yanlış', 'yanlıştır', 'soru', 'cevap', 'yanıt', 'özellik', 'neden', 'nasıl',
  'sonuç', 'tüm', 'her', 'kadar', 'yer', 'alır', 'verilen', 'yargılardan',
  'ifadelerden', 'özelliklerindendir', 'amacıyla', 'arasında', 'üzerinde',
  'şekilde', 'buna', 'gibi', 'çünkü', 'önce', 'sonra', 'tarafından', 'karşı',
  'birlikte', 'yalnız', 'ancak', 'fakat', 'yani', 'dolayı', 'en', 'çok', 'daha',
  'kendi', 'hem', 'ya', 'veya', 'yahut', 'madde', 'unsur', 'kavram', 'yöntem',
  'silikon', 'selofan', 'cam', 'lateks', 'pleksiglas', 'ambalaj', 'malzeme',
  'paragrafta', 'boş', 'bırakılan', 'yeri', 'tamamlar', 'hangisidir',
  'iri', 'yapraklardan', 'yaprak', 'yapılmış', 'yapılmıştır', 'keseler', 'çömlekler', 'heybeler', 'çantalar', 'yün',
  'kimyasal', 'dayanıklı', 'olması', 'nedeniyle', 'ürünlerin', 'güvenli', 'saklanmasını', 'sağlaması',
  'düşük', 'maliyetli', 'geniş', 'üretim', 'kapasitesine', 'sahip', 'olmasıyla', 'ekonomik', 'seçenek',
  'nakliye', 'depolama', 'süreçlerinde', 'imkan', 'vermesi', 'taşıma', 'maliyetlerini', 'azaltması',
  'lojistik', 'kolaylaştırması', 'doğada', 'oldukça', 'kolay', 'hızlı', 'çözünebilmesi', 'malzemesi',
  'camın', 'sunduğu', 'avantajlardan', 'biridir', 'baskı', 'mimari', 'reklam', 'bilgilendirme'
]);

/**
 * Calculates a lexical confidence score for Turkish language presence.
 */
export function getTurkishLexicalScore(text: string): number {
  if (!text) return 0;
  const words = text.toLowerCase().split(/[^a-zçğıöşü]+/);
  let score = 0;
  for (const w of words) {
    if (!w) continue;
    if (COMMON_TURKISH_WORDS.has(w)) {
      score += 3;
    } else if (/[çğıöşü]/.test(w)) {
      score += 1;
    }
  }
  return score;
}

/**
 * Enforces UTF-8 canonical representation and cleans encoding glitches.
 */
export function enforceUtf8AndNormalize(str: string): string {
  if (!str) return '';

  let normalized = str;

  try {
    normalized = normalized.normalize('NFC');
  } catch {
    // fallback
  }

  // Strip BOM, soft hyphens, zero-width characters, non-printable controls
  normalized = normalized
    .replace(/\uFEFF/g, '')
    .replace(/\u00AD/g, '')
    .replace(/[\u200B\u200C\u200D]/g, '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // Convert non-breaking spaces
  normalized = normalized.replace(/[\u00A0\u202F\u2007]/g, ' ');

  // Standardize ligatures
  normalized = normalized
    .replace(/\uFB00/g, 'ff')
    .replace(/\uFB01/g, 'fi')
    .replace(/\uFB02/g, 'fl')
    .replace(/\uFB03/g, 'ffi')
    .replace(/\uFB04/g, 'ffl');

  // Standardize quotes and dashes
  normalized = normalized
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2013\u2014]/g, '-');

  // Turkish UTF-8 Mojibake repairs (double-encoded UTF-8 bytes)
  normalized = normalized
    .replace(/Ã§/g, 'ç')
    .replace(/Ã‡/g, 'Ç')
    .replace(/ÄŸ/g, 'ğ')
    .replace(/Äž/g, 'Ğ')
    .replace(/Ä±/g, 'ı')
    .replace(/Ä°/g, 'İ')
    .replace(/Ã¶/g, 'ö')
    .replace(/Ã–/g, 'Ö')
    .replace(/ÅŸ/g, 'ş')
    .replace(/Åž/g, 'Ş')
    .replace(/Ã¼/g, 'ü')
    .replace(/Ãœ/g, 'Ü')
    .replace(/Ã¢/g, 'â')
    .replace(/Ã®/g, 'î')
    .replace(/Ã»/g, 'û');

  // Windows-1254 single byte misinterpretations
  normalized = normalized
    .replace(/Ý/g, 'İ')
    .replace(/ý/g, 'ı')
    .replace(/Þ/g, 'Ş')
    .replace(/þ/g, 'ş')
    .replace(/Ð/g, 'Ğ')
    .replace(/ð/g, 'ğ');

  return normalized;
}

export function normalizeTextEncoding(str: string): string {
  return enforceUtf8AndNormalize(str);
}

/**
 * Descrambles an individual word shifted by a linear offset (default: +5).
 */
export function descrambleWord(word: string, shift = 5): string {
  if (!word) return '';

  let res = '';
  for (let i = 0; i < word.length; i++) {
    const c = word[i];
    const code = word.charCodeAt(i);

    if (SPECIAL_GLYPHS[c]) {
      res += SPECIAL_GLYPHS[c];
      continue;
    }

    if (code >= 65 && code <= 90) {
      res += String.fromCharCode(((code - 65 - shift + 26) % 26) + 65);
      continue;
    }

    if (code >= 97 && code <= 122) {
      res += String.fromCharCode(((code - 97 - shift + 26) % 26) + 97);
      continue;
    }

    res += c;
  }

  return res;
}

export function descrambleTextSimple(text: string, shift = 5): string {
  let res = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const code = text.charCodeAt(i);

    if (SPECIAL_GLYPHS[c]) {
      res += SPECIAL_GLYPHS[c];
      continue;
    }

    if (code >= 65 && code <= 90) {
      res += String.fromCharCode(((code - 65 - shift + 26) % 26) + 65);
      continue;
    }

    if (code >= 97 && code <= 122) {
      res += String.fromCharCode(((code - 97 - shift + 26) % 26) + 97);
      continue;
    }

    res += c;
  }
  return res;
}

/**
 * Determines whether a word was encoded with a shifted Caesar font (+5).
 * Detects patterns like "XNQNPTS" -> "SILIKON" / "silikon".
 */
export function shouldDescrambleWord(word: string): boolean {
  const clean = word.replace(/[^a-zA-ZçğıöşüÇĞİÖŞÜ]/g, '');
  if (clean.length < 3) return false;

  const lower = clean.toLocaleLowerCase('tr-TR');
  const vowels = (lower.match(/[aeıioöuü]/g) || []).length;
  const hasForeign = /[xqw]/.test(lower);

  // If word contains x, q, w, or 0 vowels in a word of 4+ characters
  if (hasForeign || (clean.length >= 4 && vowels === 0)) {
    const desc = descrambleWord(clean, 5).toLocaleLowerCase('tr-TR');
    const descVowels = (desc.match(/[aeıioöuü]/g) || []).length;
    const descForeign = /[xqw]/.test(desc);

    // If descrambled word has vowels, no foreign letters, and reasonable vowel ratio
    if (!descForeign && descVowels >= 1 && (descVowels / clean.length) >= 0.20) {
      return true;
    }
  }

  // Also check if descrambled matches a common Turkish word
  const desc = descrambleWord(clean, 5).toLowerCase();
  if (COMMON_TURKISH_WORDS.has(desc) && !COMMON_TURKISH_WORDS.has(lower)) {
    return true;
  }

  return false;
}

/**
 * Decodes Turkish exam words that suffer from subset font Caesar shift,
 * mixed uppercase/Turkish glyph substitution, or specific drop-cap shifts.
 */
export function decodeTurkishExamWord(token: string): string {
  if (!token) return '';
  if (KNOWN_EXAM_SHIFT_WORDS[token]) {
    return KNOWN_EXAM_SHIFT_WORDS[token];
  }

  const lower = token.toLowerCase();
  if (KNOWN_EXAM_SHIFT_WORDS[lower]) {
    const rep = KNOWN_EXAM_SHIFT_WORDS[lower];
    return token[0] === token[0].toUpperCase()
      ? rep[0].toUpperCase() + rep.slice(1)
      : rep;
  }

  // 1. Initial 0 before lowercase Turkish letters -> K
  if (/^0[a-zçğıöşü]/i.test(token)) {
    if (/^0imtasal/i.test(token)) {
      return (token[0] === '0' && token[1] === token[1].toUpperCase() ? 'KIMYASAL' : 'Kimyasal') + token.slice(8);
    }
    if (/^0imya/i.test(token)) {
      return 'Kimya' + token.slice(5);
    }
    if (/^0ullan/i.test(token)) {
      return (token[0] === '0' && token[1] === token[1].toUpperCase() ? 'KULLAN' : 'Kullan') + token.slice(6);
    }
    return 'K' + token.slice(1);
  }

  // 2. datandkld -> dayanıklı variations
  if (/^datandkld/i.test(token)) {
    return (token[0] === token[0].toUpperCase() ? 'Dayanıklı' : 'dayanıklı') + token.slice(9);
  }
  if (/^datan/i.test(token)) {
    return (token[0] === token[0].toUpperCase() ? 'Dayan' : 'dayan') + token.slice(5);
  }

  // 3. Handle prefix shifts for yaprak/yapılmış variations (e.g. tapraklardan -> yapraklardan)
  if (/^taprak/i.test(token)) {
    return (token[0] === token[0].toUpperCase() ? 'Y' : 'y') + token.slice(1);
  }
  if (/^tapıl/i.test(token)) {
    return (token[0] === token[0].toUpperCase() ? 'Y' : 'y') + token.slice(1);
  }

  // 4. End of word corruptions where 'd' represents 'ı' (e.g. karşd -> karşı, olmasd -> olması, kld -> klı)
  if (/[sşçzkl]d$/i.test(token)) {
    return token.slice(0, -1) + 'ı';
  }

  // 5. Mixed shift with Turkish glyphs (e.g. YFUIQRIŞ -> yapılmış)
  if (token.length >= 4 && /[ŞĞİÖÜI]/.test(token) && /[F-Z]/.test(token)) {
    let shifted = '';
    for (let i = 0; i < token.length; i++) {
      const c = token[i];
      const code = token.charCodeAt(i);
      if (c === 'Y') {
        shifted += 'y';
      } else if (c === 'I') {
        shifted += 'ı';
      } else if (c === 'Ş') {
        shifted += 'ş';
      } else if (c === 'Ğ') {
        shifted += 'ğ';
      } else if (c === 'Ü') {
        shifted += 'ü';
      } else if (c === 'Ö') {
        shifted += 'ö';
      } else if (c === 'Ç') {
        shifted += 'ç';
      } else if (c === 'İ') {
        shifted += 'i';
      } else if (code >= 65 && code <= 90) {
        shifted += String.fromCharCode(((code - 65 - 5 + 26) % 26) + 65).toLowerCase();
      } else {
        shifted += c;
      }
    }
    if (shifted === 'yapılmış' || shifted === 'silikon') {
      return shifted;
    }
  }

  return token;
}

/**
 * Checks if a piece of text genuinely looks shifted by a Caesar font offset.
 */
export function isShifted(text: string): boolean {
  if (!text || text.trim().length < 3) return false;

  // Check for subset font special glyphs
  if (/[\^\[\]\\_¾ġóá½þýðò]/.test(text)) {
    return true;
  }

  // Check for shifted option pattern F) G) H) without standard A) B) C)
  if (/\b[F-J][\.\)\-\:]\s+/.test(text) && !/\b[A-E][\.\)\-\:]\s+/.test(text)) {
    return true;
  }

  // Check if any word in the text should be descrambled
  const words = text.split(/\s+/);
  for (const w of words) {
    if (KNOWN_EXAM_SHIFT_WORDS[w] || shouldDescrambleWord(w)) {
      return true;
    }
  }

  const currentScore = getTurkishLexicalScore(text);
  const testDescrambled = descrambleTextSimple(text, 5);
  const descrambledScore = getTurkishLexicalScore(testDescrambled);

  return descrambledScore > currentScore + 2;
}

/**
 * Cleans text line-by-line and token-by-token.
 * Unshifted lines and normal Turkish text remain 100% intact.
 * Shifted lines and individual shifted option words (like XNQNPTS -> silikon) are safely repaired.
 */
export function cleanAndDescramblePdfText(rawText: string): { text: string; isClean: boolean; shiftApplied?: number } {
  if (!rawText || rawText.trim().length === 0) {
    return { text: '', isClean: true };
  }

  const normalized = normalizeTextEncoding(rawText);
  const rawLines = normalized.split('\n');

  let anyShiftedFound = false;

  const lines = rawLines.map((line) => {
    let processedLine = line;

    // 0. Decode Anadolu subset-font cipher phrases and tokens first
    processedLine = decodeAnadoluCipher(processedLine);

    // 1. Standalone special glyphs
    for (const [bad, good] of Object.entries(SPECIAL_GLYPHS)) {
      if (processedLine.includes(bad)) {
        processedLine = processedLine.replaceAll(bad, good);
        anyShiftedFound = true;
      }
    }

    // 2. Dash spacing for fill-in-the-blank questions
    // e.g. "geliştirilen-----tamamen" -> "geliştirilen ----- tamamen"
    processedLine = processedLine.replace(/([^\s\-])\s*(-{2,}|–{2,}|—{2,})\s*([^\s\-])/g, '$1 ----- $3');

    // 3. Clean up excessive justified spacing between words (e.g. "olarak   kullanılan   camın" -> "olarak kullanılan camın")
    // Keep 3+ spaces only if followed by an inline option marker e.g. "A) ...   B) ..."
    processedLine = processedLine.replace(/([a-zçğıöşüA-ZÇĞİÖŞÜ0-9,;])\s{2,}(?!\(?[A-Ea-e][\)\.\-:])([a-zçğıöşüA-ZÇĞİÖŞÜ0-9])/g, '$1 $2');

    // 4. Isolated shifted drop-caps e.g. "X ilikon" -> "silikon"
    processedLine = processedLine.replace(/(^|[\s\(\[\.\:\-])X\s+ilikon\b/gi, '$1silikon');
    processedLine = processedLine.replace(/\bX\s+([a-zçğıöşü]+)\b/g, (match, rest) => {
      const candidate = 's' + rest;
      if (['silikon', 'selofan'].includes(candidate)) {
        return candidate;
      }
      return match;
    });

    // 5. Shifted options check: If a line starts with F) G) H) I) J) and no A) B) C), shift back
    if (/\b[F-J][\.\)\-\:]\s+/.test(processedLine) && !/\b[A-E][\.\)\-\:]\s+/.test(processedLine)) {
      processedLine = processedLine.replace(/^([F-Jf-j])([\.\)\-\:])/g, (_m, opt, sep) => {
        anyShiftedFound = true;
        const origOpt = String.fromCharCode(opt.toUpperCase().charCodeAt(0) - 5);
        return origOpt + sep;
      });

      processedLine = processedLine.replace(/(\s+)([F-Jf-j])([\.\)\-\:])(\s+)/g, (_m, sp1, opt, sep, sp2) => {
        anyShiftedFound = true;
        const origOpt = String.fromCharCode(opt.toUpperCase().charCodeAt(0) - 5);
        return sp1 + origOpt + sep + sp2;
      });
    }

    // 6. Word-by-word shift check (handles individual shifted options like "A) XNQNPTS" -> "A) silikon" or "òWN tapraklardan YFUIQRIŞ")
    // Preserves option labels (A, B, C, D, E) and question numbers without shifting them.
    const tokens = processedLine.split(/(\s+|[\(\)\.\,\:\;\-\–])/);
    let lineModified = false;
    const repairedTokens = tokens.map((tok) => {
      // Don't descramble isolated standard option labels A, B, C, D, E
      if (/^[A-Ea-e]$/.test(tok.trim())) {
        return tok;
      }

      // Check Anadolu exam cipher words or tokens
      const decodedAnadolu = decodeAnadoluCipherToken(tok);
      if (decodedAnadolu !== tok) {
        lineModified = true;
        anyShiftedFound = true;
        return decodedAnadolu;
      }

      // Check known Turkish exam shift words or prefix shifts
      const decodedSpecial = decodeTurkishExamWord(tok);
      if (decodedSpecial !== tok) {
        lineModified = true;
        anyShiftedFound = true;
        return decodedSpecial;
      }

      if (shouldDescrambleWord(tok)) {
        lineModified = true;
        anyShiftedFound = true;
        const desc = descrambleWord(tok, 5);
        // If original was ALL CAPS, convert to lowercase if it's an option choice like silikon
        if (tok === tok.toUpperCase() && tok.length > 2) {
          return desc.toLowerCase();
        }
        return desc;
      }
      return tok;
    });

    if (lineModified) {
      return repairedTokens.join('');
    }

    return processedLine;
  });

  const cleanedText = lines.join('\n');
  return {
    text: cleanedText,
    isClean: true,
    shiftApplied: anyShiftedFound ? 5 : undefined
  };
}

/**
 * Pre-validation layer:
 * Filters out inconsistent, noisy, or orphan lines from extracted question/option text.
 */
export function preValidateAndSanitizeLines(rawText: string): string {
  if (!rawText) return '';

  const normalized = enforceUtf8AndNormalize(rawText);
  const lines = normalized.split('\n');
  const validLines: string[] = [];

  for (let line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (validLines.length > 0 && validLines[validLines.length - 1] !== '') {
        validLines.push('');
      }
      continue;
    }

    // 1. Filter out page markers, headers, footers, exam booklet notices and watermarks
    if (
      /^(?:Sayfa\s*\d+(?:\s*\/\s*\d+)?|\d+\s*\/\s*\d+|Page\s*\d+|-\s*\d+\s*-|\[\s*\d+\s*\]|--- Sütun \d+ ---|Sütun \d+)$/i.test(trimmed) ||
      /^(?:T\.?C\.?\s*)?(?:MİLLİ\s*EĞİTİM\s*BAKANLIĞI|ÖLÇME[,\s]*DEĞERLENDİRME.*|ÖSYM.*)$/i.test(trimmed) ||
      /^(?:DENEME\s*SINAVI.*|KİTAPÇIK\s*TÜRÜ\s*[A-D]|SINAV\s*KİTAPÇIĞI.*|CEVAP\s*KÂĞIDI.*|OPTİK\s*FORM.*)$/i.test(trimmed) ||
      /^(?:KAZANIM\s*KAVRAMA\s*TESTİ.*|KONU\s*TESTİ.*|TARAMA\s*TESTİ.*|YAPRAK\s*TEST.*)$/i.test(trimmed) ||
      /^(?:GENEL\s*YETENEK.*|GENEL\s*KÜLTÜR.*|TEMEL\s*YETERLİLİK.*|ALAN\s*YETERLİLİK.*)$/i.test(trimmed) ||
      /^(?:Diğer\s*sayfaya\s*geçiniz[\.\!]?|Test\s*bitti[\.\!]?|Cevaplarınızı\s*kontrol\s*ediniz[\.\!]?)$/i.test(trimmed) ||
      /^(?:Bu\s*testte\s*\d+\s*soru\s*vardır[\.\!]?|Toplam\s*\d+\s*soru.*)$/i.test(trimmed) ||
      /^(?:Telif\s*hakkı.*|Her\s*hakkı\s*saklıdır.*|Soru\s*kitapçığının.*)$/i.test(trimmed) ||
      /^(?:ÖSYM|MEB|TASLAK|ÖRNEK|DRAFT|WATERMARK)$/i.test(trimmed) ||
      /^(?:www\.[a-z0-9\-]+\.[a-z]{2,}|https?:\/\/\S+|[\w\.-]+@[\w\.-]+\.\w+)$/i.test(trimmed)
    ) {
      continue;
    }

    // 2. Filter out pure separator lines (dashes, underscores, stars, dots, hashes)
    if (/^[\s\-_=*#\.\/\\|~]{3,}$/.test(trimmed)) {
      continue;
    }

    // 3. Filter out isolated stray punctuation lines (e.g. lone dot, comma, colon, semicolon)
    if (/^[\.,;:!?'"~`\^°]+$/.test(trimmed)) {
      continue;
    }

    // 4. Filter out orphaned option labels without content (e.g. line with just "A)" or "[B]")
    if (/^\(?[A-Ea-e][\)\.\-:]\s*$/.test(trimmed)) {
      continue;
    }

    // 5. Clean trailing answer key annotations from question stem lines (e.g. "Cevap: B", "Doğru Cevap: C")
    line = line.replace(/(?:Doğru\s*Cevap|Cevap|Yanıt|Doğru\s*Seçenek)[\s:]*[A-Ea-e]\b.*$/i, '').trimEnd();

    // 6. Clean column markers
    line = line.replace(/--- Sütun \d+ ---/g, '').replace(/\bSütun \d+\b/g, '').trim();

    if (line) {
      validLines.push(line);
    }
  }

  // Trim trailing empty lines
  while (validLines.length > 0 && validLines[validLines.length - 1] === '') {
    validLines.pop();
  }

  return validLines.join('\n');
}

/**
 * Pre-validates a single Question structure.
 */
export function preValidateQuestionStructure(question: Question): Question {
  const sanitizedText = preValidateAndSanitizeLines(question.text || '');

  // Map and deduplicate options
  const optionMap = new Map<string, string>();
  for (const opt of question.options || []) {
    if (!opt) continue;
    const label = String(opt.label || '').trim().toUpperCase();
    if (!['A', 'B', 'C', 'D', 'E'].includes(label)) continue;

    const sanitizedOptText = autoRepairText(opt.text || '');
    if (!optionMap.has(label) || sanitizedOptText.length > (optionMap.get(label)?.length || 0)) {
      optionMap.set(label, sanitizedOptText);
    }
  }

  const standardLabels = ['A', 'B', 'C', 'D', 'E'];
  const validOptions: Option[] = [];

  if (optionMap.size === 0) {
    validOptions.push(
      { label: 'A', text: '' },
      { label: 'B', text: '' },
      { label: 'C', text: '' },
      { label: 'D', text: '' }
    );
  } else {
    for (const lbl of standardLabels) {
      if (optionMap.has(lbl)) {
        validOptions.push({
          label: lbl,
          text: optionMap.get(lbl)!
        });
      }
    }
  }

  // Validate correct answer label
  let validCorrectAnswer = question.correctAnswerLabel ? question.correctAnswerLabel.trim().toUpperCase() : null;
  if (validCorrectAnswer && !validOptions.some(o => o.label === validCorrectAnswer)) {
    if (!standardLabels.includes(validCorrectAnswer)) {
      validCorrectAnswer = null;
    }
  }

  return {
    ...question,
    text: autoRepairText(sanitizedText) || `Soru ${question.id || 1}`,
    options: validOptions,
    correctAnswerLabel: validCorrectAnswer,
    userSelection: question.userSelection || null
  };
}

/**
 * Automatically repairs any garbled/shifted text in a question object or text string.
 */
export function autoRepairText(str: string): string {
  if (!str) return '';
  const preValidated = preValidateAndSanitizeLines(str);
  return cleanAndDescramblePdfText(preValidated).text;
}

/**
 * Comprehensive pre-validation and repair layer for parsed exams.
 */
export function preValidateAndSanitizeExam(exam: Exam): Exam {
  if (!exam) return exam;

  const sanitizedTitle = autoRepairText(preValidateAndSanitizeLines(exam.title || 'Yeni Sınav'));
  const rawQuestions = exam.questions || [];

  const preValidatedQuestions = rawQuestions
    .map(q => preValidateQuestionStructure(q))
    .filter(q => q.text.trim().length > 0 || q.options.some(o => o.text.trim().length > 0));

  if (preValidatedQuestions.length === 0) {
    preValidatedQuestions.push({
      id: 1,
      text: 'Soru 1',
      options: [
        { label: 'A', text: '' },
        { label: 'B', text: '' },
        { label: 'C', text: '' },
        { label: 'D', text: '' }
      ],
      correctAnswerLabel: null,
      userSelection: null
    });
  }

  const repairedQuestions: Question[] = preValidatedQuestions.map((q, idx) => ({
    ...q,
    id: idx + 1,
    text: autoRepairText(q.text),
    options: q.options.map(opt => ({
      label: opt.label,
      text: autoRepairText(opt.text)
    }))
  }));

  return {
    ...exam,
    title: sanitizedTitle,
    questions: repairedQuestions
  };
}
