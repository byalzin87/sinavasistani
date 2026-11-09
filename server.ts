import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

// Set payload limits for handling PDFs and images
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const SYSTEM_INSTRUCTION = `
Sen optik karakter tanıma (OCR), sınav dizgisi çözümleme ve soru-cevap anahtarı eşleştirmede uzman bir Sınav Sayısallaştırıcısısın.
Görevin yüklenen sınav belgesini (PDF, resim, Word veya metin) incelemek ve yapılandırılmış dijital sınava dönüştürmektir.

DÜZEN VE OKUMA MANTIĞI:
1. İKİ SÜTUNLU SAYFA DÜZENİ: Sayfalar genellikle ortadan ikiye ayrılmış iki sütundan oluşur.
   - Önce SOL sütundaki sorular yukarıdan aşağıya sırayla (örnek: 1, 2, 3, 4...) okunur.
   - Ardından SAĞ sütundaki sorular yukarıdan aşağıya sırayla devam eder.
   - Kesinlikle sol ve sağ sütundaki satırları yan yana karıştırma!
2. SAYFA BAŞINA SORU SAYISI: Bir sayfada 20 veya 20'den fazla soru bulunabilir. Sayfadaki TÜM soruları ve şıklarını eksiksiz çıkar.
3. HARİÇ TUTULACAK KISIMLAR:
   - Sayfa üst bilgisi (T.C. MEB, ÖSYM, kurum logoları, konu başlıkları)
   - Sayfa alt bilgisi (sayfa numaraları, "Diğer sayfaya geçiniz", telif yazıları)
   - Filigranlar (arkaplandaki silik yazılar, çapraz metinler)
4. ŞIKLARIN YAPISI:
   - Şıklar her sorunun altında A), B), C), D), E) şeklinde alt alta veya bazı durumlarda yan yana (inline: A) ... B) ... C) ...) dizilmiştir.
   - Her seçeneğin etiketini (A, B, C, D, E) ve metnini ayıkla.
5. CEVAP ANAHTARI TABLOSU:
   - Cevap anahtarları genellikle sayfanın en altında veya belgenin sonunda yatay bir tablo şeklinde yer alır.
   - Üst satırda soru numaraları: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10...
   - Alt satırda soruların cevapları: A, C, D, B, E, A, B, C, D, E...
   - Bu tabloyu tespit et ve her soruya doğru cevap harfini (correctAnswerLabel) ata.
   - Ham cevap anahtarını 'detectedAnswerKeyRawContent' alanına yaz.
6. TÜRKÇE KARAKTER VE FONT ONARIMI:
   - Belgede font kodlama kaymaları veya bozuk karakterler varsa görsel OCR ve Türkçe bağlam ile düzgün, temiz Türkçe imla kurallarına (ç, ğ, ı, ö, ş, ü) uygun hale getir.
`;


function getApiKey(): string {
  return (
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.VITE_GEMINI_API_KEY ||
    process.env.GOOGLE_GENAI_API_KEY ||
    process.env.GEMINI_KEY ||
    process.env.API_KEY ||
    ''
  ).trim();
}

const SPECIAL_GLYPHS: Record<string, string> = {
  'ò': 'İ', 'Ó': 'İ', 'ñ': 'ı', 'Ñ': 'I', 'è': 'ç', 'È': 'Ç', 'ù': 'ğ', 'Ù': 'Ğ',
  '¾': 'Ü', 'ž': 'Ü', 'Ž': 'Ü', '\x9e': 'Ü', '\x8e': 'Ü', 'ġ': 'Ş', 'ó': 'I', 'á': 'Ğ', '½': 'Ö', 'þ': 'Ş', 'ý': 'ı', 'Ý': 'İ', 'ð': 'ğ', 'Ð': 'Ğ',
  '^': 'Y', '[': 'V', ']': 'X', '\\': 'W', '_': 'Z'
};

const KNOWN_EXAM_SHIFT_WORDS: Record<string, string> = {
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

const EXACT_ANADOLU_CIPHER_WORDS: Record<string, string> = {
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

const CIPHER_GLYPH_MAP: Record<string, string> = {
  '0': 'K', '5': 'P', ',': 'G', ')': 'D', '>': 'Y', '*': 'E', '^': 'Y',
  '[': 'V', ']': 'X', '\\': 'W', '_': 'Z', 'ž': 'Ü', 'Ž': 'Ü', '\x9e': 'Ü', '\x8e': 'Ü', '¾': 'Ü', '½': 'Ö',
  '¸': 'Ö', '©': 'Ç', 'ġ': 'Ş', 'ó': 'I', 'á': 'Ğ', 'ò': 'İ'
};

function decodeAnadoluCipherToken(token: string): string {
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
    return token.replace(trimmed, EXACT_ANADOLU_CIPHER_WORDS[trimmed]);
  }
  const trimmedLower = trimmed.toLowerCase();
  if (EXACT_ANADOLU_CIPHER_WORDS[trimmedLower]) {
    return token.replace(trimmed, EXACT_ANADOLU_CIPHER_WORDS[trimmedLower]);
  }
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

function decodeAnadoluCipher(text: string): string {
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
  'ifadelerden', 'özelliklerindendir', 'amacıyla', 'şekilde', 'buna', 'gibi',
  'silikon', 'selofan', 'cam', 'lateks', 'pleksiglas', 'ambalaj', 'malzeme',
  'iri', 'yapraklardan', 'yaprak', 'yapılmış', 'yapılmıştır', 'keseler', 'çömlekler', 'heybeler', 'çantalar', 'yün',
  'kimyasal', 'dayanıklı', 'olması', 'nedeniyle', 'ürünlerin', 'güvenli', 'saklanmasını', 'sağlaması',
  'düşük', 'maliyetli', 'geniş', 'üretim', 'kapasitesine', 'sahip', 'olmasıyla', 'ekonomik', 'seçenek',
  'nakliye', 'depolama', 'süreçlerinde', 'imkan', 'vermesi', 'taşıma', 'maliyetlerini', 'azaltması',
  'lojistik', 'kolaylaştırması', 'doğada', 'oldukça', 'kolay', 'hızlı', 'çözünebilmesi', 'malzemesi',
  'camın', 'sunduğu', 'avantajlardan', 'biridir', 'baskı', 'mimari', 'reklam', 'bilgilendirme'
]);

function getTurkishLexicalScore(text: string): number {
  if (!text) return 0;
  const words = text.toLowerCase().split(/[^a-zçğıöşü]+/);
  let score = 0;
  for (const w of words) {
    if (COMMON_TURKISH_WORDS.has(w)) score += 3;
    else if (/[çğıöşü]/.test(w)) score += 1;
  }
  return score;
}

function descrambleWord(word: string, shift = 5): string {
  if (!word) return '';
  let res = '';
  for (let i = 0; i < word.length; i++) {
    const c = word[i];
    const code = word.charCodeAt(i);
    if (SPECIAL_GLYPHS[c]) { res += SPECIAL_GLYPHS[c]; continue; }
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

function decodeTurkishExamWord(token: string): string {
  if (!token) return '';
  if (KNOWN_EXAM_SHIFT_WORDS[token]) {
    return KNOWN_EXAM_SHIFT_WORDS[token];
  }
  const lower = token.toLowerCase();
  if (KNOWN_EXAM_SHIFT_WORDS[lower]) {
    const rep = KNOWN_EXAM_SHIFT_WORDS[lower];
    return token[0] === token[0].toUpperCase() ? rep[0].toUpperCase() + rep.slice(1) : rep;
  }

  // 1. Initial 0 before lowercase -> K
  if (/^0[a-zçğıöşü]/i.test(token)) {
    if (/^0imtasal/i.test(token)) return (token[0] === '0' && token[1] === token[1].toUpperCase() ? 'KIMYASAL' : 'Kimyasal') + token.slice(8);
    if (/^0imya/i.test(token)) return 'Kimya' + token.slice(5);
    if (/^0ullan/i.test(token)) return (token[0] === '0' && token[1] === token[1].toUpperCase() ? 'KULLAN' : 'Kullan') + token.slice(6);
    return 'K' + token.slice(1);
  }

  // 2. datandkld -> dayanıklı
  if (/^datandkld/i.test(token)) return (token[0] === token[0].toUpperCase() ? 'Dayanıklı' : 'dayanıklı') + token.slice(9);
  if (/^datan/i.test(token)) return (token[0] === token[0].toUpperCase() ? 'Dayan' : 'dayan') + token.slice(5);

  // 3. Prefix shifts
  if (/^taprak/i.test(token)) return (token[0] === token[0].toUpperCase() ? 'Y' : 'y') + token.slice(1);
  if (/^tapıl/i.test(token)) return (token[0] === token[0].toUpperCase() ? 'Y' : 'y') + token.slice(1);

  // 4. End of word corruptions
  if (/[sşçzkl]d$/i.test(token)) return token.slice(0, -1) + 'ı';

  if (token.length >= 4 && /[ŞĞİÖÜI]/.test(token) && /[F-Z]/.test(token)) {
    let shifted = '';
    for (let i = 0; i < token.length; i++) {
      const c = token[i];
      const code = token.charCodeAt(i);
      if (c === 'Y') shifted += 'y';
      else if (c === 'I') shifted += 'ı';
      else if (c === 'Ş') shifted += 'ş';
      else if (c === 'Ğ') shifted += 'ğ';
      else if (c === 'Ü') shifted += 'ü';
      else if (c === 'Ö') shifted += 'ö';
      else if (c === 'Ç') shifted += 'ç';
      else if (c === 'İ') shifted += 'i';
      else if (code >= 65 && code <= 90) {
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

function shouldDescrambleWord(word: string): boolean {
  const clean = word.replace(/[^a-zA-ZçğıöşüÇĞİÖŞÜ]/g, '');
  if (clean.length < 3) return false;
  const lower = clean.toLowerCase();
  const vowels = (lower.match(/[aeıioöuü]/g) || []).length;
  const hasForeign = /[xqw]/.test(lower);
  if (hasForeign || (clean.length >= 4 && vowels === 0)) {
    const desc = descrambleWord(clean, 5).toLowerCase();
    const descVowels = (desc.match(/[aeıioöuü]/g) || []).length;
    const descForeign = /[xqw]/.test(desc);
    if (!descForeign && descVowels >= 1 && (descVowels / clean.length) >= 0.20) {
      return true;
    }
  }
  const desc = descrambleWord(clean, 5).toLowerCase();
  if (COMMON_TURKISH_WORDS.has(desc) && !COMMON_TURKISH_WORDS.has(lower)) {
    return true;
  }
  return false;
}

function cleanAndDescramblePdfText(rawText: string): string {
  if (!rawText) return '';
  const rawLines = rawText.split('\n');
  return rawLines.map((line) => {
    let processedLine = decodeAnadoluCipher(line);
    for (const [bad, good] of Object.entries(SPECIAL_GLYPHS)) {
      if (processedLine.includes(bad)) processedLine = processedLine.replaceAll(bad, good);
    }
    // Fill-in-the-blank dashes
    processedLine = processedLine.replace(/([^\s\-])\s*(-{2,}|–{2,}|—{2,})\s*([^\s\-])/g, '$1 ----- $3');
    // Justified spacing clean
    processedLine = processedLine.replace(/([a-zçğıöşüA-ZÇĞİÖŞÜ0-9,;])\s{2,}(?!\(?[A-Ea-e][\)\.\-:])([a-zçğıöşüA-ZÇĞİÖŞÜ0-9])/g, '$1 $2');
    // Drop-caps merge e.g. "X ilikon" -> "silikon"
    processedLine = processedLine.replace(/(^|[\s\(\[\.\:\-])X\s+ilikon\b/gi, '$1silikon');
    processedLine = processedLine.replace(/\bX\s+([a-zçğıöşü]+)\b/g, (match, rest) => {
      const candidate = 's' + rest;
      if (['silikon', 'selofan'].includes(candidate)) return candidate;
      return match;
    });

    if (/\b[F-J][\.\)\-\:]\s+/.test(processedLine) && !/\b[A-E][\.\)\-\:]\s+/.test(processedLine)) {
      processedLine = processedLine.replace(/^([F-Jf-j])([\.\)\-\:])/g, (_m, opt, sep) => {
        return String.fromCharCode(opt.toUpperCase().charCodeAt(0) - 5) + sep;
      });
    }
    const tokens = processedLine.split(/(\s+|[\(\)\.\,\:\;\-\–])/);
    let lineModified = false;
    const repaired = tokens.map((tok) => {
      if (/^[A-Ea-e]$/.test(tok.trim())) return tok;
      const decodedAnadolu = decodeAnadoluCipherToken(tok);
      if (decodedAnadolu !== tok) {
        lineModified = true;
        return decodedAnadolu;
      }
      const decodedSpecial = decodeTurkishExamWord(tok);
      if (decodedSpecial !== tok) {
        lineModified = true;
        return decodedSpecial;
      }
      if (shouldDescrambleWord(tok)) {
        lineModified = true;
        const desc = descrambleWord(tok, 5);
        if (tok === tok.toUpperCase() && tok.length > 2) return desc.toLowerCase();
        return desc;
      }
      return tok;
    });
    if (lineModified) return repaired.join('');
    return processedLine;
  }).join('\n');
}

function autoRepairText(str: string): string {
  if (!str) return '';
  return decodeAnadoluCipher(cleanAndDescramblePdfText(str));
}

/**
 * Free rule-based text/JSON parser used as offline / free alternative
 * when no Gemini API key is configured.
 */
function parseTextExamLocally(rawContent: string, fileName?: string) {
  const content = cleanAndDescramblePdfText(rawContent).trim();
  const defaultTitle = fileName ? fileName.replace(/\.[^/.]+$/, '') : 'Yeni Sınav';

  // 1. JSON check
  if (content.startsWith('{') || content.startsWith('[')) {
    try {
      const parsed = JSON.parse(content);
      const title = parsed.title || defaultTitle;
      const rawQuestions = Array.isArray(parsed) ? parsed : (parsed.questions || []);

      if (Array.isArray(rawQuestions) && rawQuestions.length > 0) {
        const questions = rawQuestions.map((q: any, idx: number) => ({
          id: typeof q.id === 'number' ? q.id : idx + 1,
          text: q.text || q.question || 'Soru metni',
          options: Array.isArray(q.options)
            ? q.options.map((opt: any, oIdx: number) => {
                if (typeof opt === 'string') {
                  const labelMatch = opt.match(/^([A-Ea-e])[\.\)\-\:]\s*(.*)$/);
                  if (labelMatch) {
                    return { label: labelMatch[1].toUpperCase(), text: labelMatch[2].trim() };
                  }
                  return { label: String.fromCharCode(65 + oIdx), text: opt.trim() };
                }
                return {
                  label: String(opt.label || String.fromCharCode(65 + oIdx)).toUpperCase(),
                  text: String(opt.text || opt.value || '').trim()
                };
              })
            : [],
          correctAnswerLabel: q.correctAnswerLabel || q.answer || q.correctAnswer
            ? String(q.correctAnswerLabel || q.answer || q.correctAnswer).trim().toUpperCase()
            : null,
          userSelection: null
        }));

        return {
          title,
          questions,
          detectedAnswerKeyRawContent: parsed.detectedAnswerKeyRawContent || 'JSON formatından yerel olarak okundu'
        };
      }
    } catch {
      // not valid JSON
    }
  }

  // 2. Plain text / Markdown
  let detectedAnswerKeyRawContent: string | null = null;
  const answerKeyMap: Record<number, string> = {};

  const keyMatch = content.match(/(?:cevap\s*anahtar[ıi]|yan[ıi]tlar|answer\s*key)[\s:]*([\s\S]+?)(?=$|\n\s*\n\s*\n)/i);
  if (keyMatch) {
    detectedAnswerKeyRawContent = keyMatch[0].trim();
    const keyPairs = keyMatch[1].matchAll(/(\d+)[\s\.\-\):]+([A-Ea-e])/g);
    for (const kp of keyPairs) {
      answerKeyMap[parseInt(kp[1], 10)] = kp[2].toUpperCase();
    }
  }

  let bodyWithoutKey = content;
  if (keyMatch && keyMatch.index !== undefined) {
    bodyWithoutKey = content.slice(0, keyMatch.index) + content.slice(keyMatch.index + keyMatch[0].length);
  }

  const questionBlocks = bodyWithoutKey.split(/(?:^|\n)(?=(?:Soru\s*)?\d+[\.\)\-:]\s+)/i);
  const questions: any[] = [];

  for (const block of questionBlocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    const headerMatch = trimmed.match(/^(?:Soru\s*)?(\d+)[\.\)\-:]\s*([\s\S]+)$/i);
    if (!headerMatch) continue;

    const questionNumber = parseInt(headerMatch[1], 10);
    const fullContent = headerMatch[2].trim();

    const optionMatches = [
      ...fullContent.matchAll(/(?:^|\n)\s*([A-Ea-e])[\.\)\-\:]\s*([^\n]+(?:\n(?!\s*[A-Ea-e][\.\)\-\:]|\s*(?:Cevap|Yanıt|Doğru))[^\n]+)*)/g)
    ];

    let questionText = fullContent;
    const options: { label: string; text: string }[] = [];

    if (optionMatches.length > 0) {
      questionText = fullContent.substring(0, optionMatches[0].index ?? 0).trim();
      for (const m of optionMatches) {
        let optText = m[2]
          .replace(/\r?\n/g, ' ')
          .replace(/\s+/g, ' ')
          .replace(/(?:Cevap|Yanıt|Doğru)[\s:]*[A-Ea-e].*$/i, '')
          .trim();
        optText = autoRepairText(optText);
        options.push({ label: m[1].toUpperCase(), text: optText });
      }
    }

    let correctAnswerLabel: string | null = answerKeyMap[questionNumber] || null;
    if (!correctAnswerLabel) {
      const inlineKeyMatch = trimmed.match(/(?:Doğru\s*Cevap|Cevap|Yanıt)[\s:]*([A-Ea-e])/i);
      if (inlineKeyMatch) {
        correctAnswerLabel = inlineKeyMatch[1].toUpperCase();
      }
    }

    questionText = autoRepairText(
      questionText
        .replace(/\r?\n/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/(?:Doğru\s*Cevap|Cevap|Yanıt)[\s:]*[A-Ea-e].*$/i, '')
        .trim()
    );

    if (questionText || options.length > 0) {
      questions.push({
        id: questionNumber || questions.length + 1,
        text: questionText || `Soru ${questionNumber}`,
        options,
        correctAnswerLabel,
        userSelection: null
      });
    }
  }

  return {
    title: defaultTitle,
    questions,
    detectedAnswerKeyRawContent
  };
}

async function parseExamWithGemini(input: { data: string; mimeType: string; fileName?: string }) {
  let { data, mimeType, fileName } = input;
  const isText = mimeType.startsWith('text/') || mimeType === 'application/json';

  if (isText && data) {
    data = cleanAndDescramblePdfText(data);
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    if (isText) {
      const localResult = parseTextExamLocally(data, fileName);
      if (localResult.questions.length > 0) {
        return localResult;
      }
    }

    const missingKeyError: any = new Error(
      'Sunucuda GEMINI_API_KEY ortam değişkeni tanımlı değil. PDF veya resim gibi görsel belgeleri işlemek için Google AI Studio üzerinden tamamen ÜCRETSİZ bir API anahtarı alıp ortam değişkenlerine GEMINI_API_KEY olarak ekleyiniz.'
    );
    missingKeyError.code = 'MISSING_GEMINI_API_KEY';
    throw missingKeyError;
  }

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build'
      }
    }
  });

  const parts: any[] = [];

  if (isText) {
    parts.push({
      text: `Dosya Adı: ${fileName || 'Belirtilmedi'}\n\nİçerik:\n${data}`
    });
  } else {
    parts.push({
      inlineData: {
        mimeType: mimeType,
        data: data
      }
    });
  }

  parts.push({
    text: `Belge adı: ${fileName || 'Sınav Dosyası'}. Lütfen bu belgedeki tüm soruları, seçenekleri ve cevap anahtarını eksiksiz olarak çıkar ve JSON formatında döndür.`
  });

  const generateWithRetry = async () => {
    const models = ['gemini-2.5-flash', 'gemini-2.0-flash'];
    let lastError: any = null;

    for (const model of models) {
      try {
        return await ai.models.generateContent({
          model,
          contents: {
            parts: parts
          },
          config: {
            systemInstruction: SYSTEM_INSTRUCTION,
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                title: {
                  type: Type.STRING,
                  description: 'Sınavın başlığı veya konusu'
                },
                detectedAnswerKeyRawContent: {
                  type: Type.STRING,
                  description: 'Belgeden tespit edilen ham cevap anahtarı metni'
                },
                questions: {
                  type: Type.ARRAY,
                  description: 'Sınavdaki soruların listesi',
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      id: {
                        type: Type.INTEGER,
                        description: 'Soru numarası (1, 2, 3...)'
                      },
                      text: {
                        type: Type.STRING,
                        description: 'Soru metni'
                      },
                      options: {
                        type: Type.ARRAY,
                        description: 'Sorunun seçenekleri',
                        items: {
                          type: Type.OBJECT,
                          properties: {
                            label: {
                              type: Type.STRING,
                              description: 'Seçenek etiketi: A, B, C, D veya E'
                            },
                            text: {
                              type: Type.STRING,
                              description: 'Seçenek içeriği'
                            }
                          },
                          required: ['label', 'text']
                        }
                      },
                      correctAnswerLabel: {
                        type: Type.STRING,
                        description: 'Doğru seçenek harfi: A, B, C, D, E veya null'
                      }
                    },
                    required: ['id', 'text', 'options']
                  }
                }
              },
              required: ['title', 'questions']
            }
          }
        });
      } catch (err: any) {
        lastError = err;
        const errStr = String(err?.message || err);
        console.warn(`Model ${model} uyarısı:`, errStr.slice(0, 100));

        if (errStr.includes('API key not valid') || errStr.includes('INVALID_ARGUMENT')) {
          throw new Error('Eklenen GEMINI_API_KEY anahtarı geçerli değil. Lütfen Google AI Studio üzerinden geçerli bir API anahtarı ekleyiniz.');
        }

        const isTransient =
          errStr.includes('503') || errStr.includes('UNAVAILABLE') || errStr.includes('high demand') || errStr.includes('429');
        if (isTransient) {
          continue;
        }
        throw err;
      }
    }
    throw lastError;
  };

  let response: any;
  try {
    response = await generateWithRetry();
  } catch (err: any) {
    if (isText && data) {
      const fallback = parseTextExamLocally(data, fileName);
      if (fallback.questions.length > 0) {
        return fallback;
      }
    }

    let errorMessage = err?.message || 'Yapay zeka modeliyle iletişim kurulurken bir hata oluştu.';
    try {
      const parsed = JSON.parse(errorMessage);
      if (parsed?.error?.message) {
        if (parsed.error.code === 400 && String(parsed.error.message).includes('API key not valid')) {
          errorMessage = 'Eklenen GEMINI_API_KEY geçerli değil. Lütfen Google AI Studio üzerinden aldığınız geçerli anahtarı ekleyiniz.';
        } else if (parsed.error.code === 429 || parsed.error.status === 'RESOURCE_EXHAUSTED') {
          errorMessage = 'Dakika başına istek kotası aşıldı. Lütfen 15-20 saniye bekleyip tekrar deneyiniz.';
        } else if (parsed.error.code === 503 || parsed.error.status === 'UNAVAILABLE') {
          errorMessage = 'Yapay zeka sunucuları geçici olarak yoğun. Lütfen birkaç saniye sonra tekrar deneyiniz.';
        } else {
          errorMessage = parsed.error.message;
        }
      }
    } catch {
      // not JSON string
    }
    throw new Error(errorMessage);
  }

  let rawText = response.text || '';
  rawText = rawText.replace(/^```json\s*/gi, '').replace(/^```\s*/gi, '').replace(/```\s*$/gi, '').trim();

  if (!rawText) {
    throw new Error('Yapay zeka modelinden boş yanıt alındı.');
  }

  let parsedData: any;
  try {
    parsedData = JSON.parse(rawText);
  } catch (parseErr) {
    console.warn('JSON parse hatası, düzeltme deneniyor...', parseErr);
    const qStartIndex = rawText.indexOf('[');
    if (qStartIndex !== -1) {
      const lastBrace = rawText.lastIndexOf('}');
      if (lastBrace > qStartIndex) {
        const repaired = rawText.substring(0, lastBrace + 1) + ']}';
        try {
          parsedData = JSON.parse(repaired);
        } catch {}
      }
    }
    if (!parsedData) {
      throw new Error('Model çıktısı geçerli JSON formatına dönüştürülemedi.');
    }
  }

  const title = parsedData.title || fileName || 'Yeni Sınav';
  const questions = (parsedData.questions || []).map((q: any, idx: number) => ({
    id: typeof q.id === 'number' ? q.id : idx + 1,
    text: autoRepairText(q.text || 'Soru metni okunamadı'),
    options: Array.isArray(q.options)
      ? q.options.map((opt: any) => ({
          label: String(opt.label || '').trim().toUpperCase(),
          text: autoRepairText(String(opt.text || '').trim())
        }))
      : [],
    correctAnswerLabel: q.correctAnswerLabel ? String(q.correctAnswerLabel).trim().toUpperCase() : null,
    userSelection: null
  }));

  return {
    title,
    questions,
    detectedAnswerKeyRawContent: parsedData.detectedAnswerKeyRawContent || null
  };
}

app.post('/api/parse-exam', async (req, res) => {
  try {
    const { data, mimeType, fileName } = req.body;

    if (!data || !mimeType) {
      return res.status(400).json({ error: 'Dosya verisi (data) ve MIME türü (mimeType) gereklidir.' });
    }

    const result = await parseExamWithGemini({ data, mimeType, fileName });
    return res.json(result);
  } catch (err: any) {
    console.error('Sınav ayrıştırma hatası:', err);
    const isMissingKey = err?.code === 'MISSING_GEMINI_API_KEY' || String(err?.message).includes('GEMINI_API_KEY');
    return res.status(isMissingKey ? 400 : 500).json({
      error: err?.message || 'Sınav dosyası işlenirken bir sunucu hatası oluştu.',
      code: err?.code || (isMissingKey ? 'MISSING_GEMINI_API_KEY' : 'SERVER_ERROR')
    });
  }
});

async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.use((_req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on port ${PORT}`);
  });
}

startServer();
