/**
 * Intelligent text cleaner and descrambler for PDF font encoding anomalies.
 * Fixes Caesar-shifted subset fonts and custom Turkish glyph encodings.
 * Handles mixed documents (normal headers + shifted question bodies or choices).
 */

const SPECIAL_GLYPHS: Record<string, string> = {
  '¾': 'Ü',
  'ġ': 'Ş',
  'ó': 'I',
  'á': 'Ğ',
  '½': 'Ö',
  'þ': 'Ş',
  'ý': 'I',
  'ð': 'Ğ',
  '^': 'Y',
  '[': 'V',
  ']': 'X',
  '\\': 'W',
  '_': 'Z'
};

const COMMON_REPAIR_MAP: Record<string, string> = {
  IMYASAL: 'KİMYASAL',
  KIMYASAL: 'KİMYASAL',
  NEDENIYLE: 'NEDENİYLE',
  GÜVENLI: 'GÜVENLİ',
  GUVENLI: 'GÜVENLİ',
  BIR: 'BİR',
  SEKILDE: 'ŞEKİLDE',
  ŞEKILDE: 'ŞEKİLDE',
  URUNLERIN: 'ÜRÜNLERİN',
  ÜRÜNLERIN: 'ÜRÜNLERİN',
  SAGLAMASI: 'SAĞLAMASI',
  SAĞLAMASI: 'SAĞLAMASI',
  SAKLANMASINI: 'SAKLANMASINI',
  MADDELERE: 'MADDELERE',
  DAYANIKLI: 'DAYANIKLI',
  OLMASI: 'OLMASI',
  KARŞI: 'KARŞI'
};

/**
 * Checks if a token/word has characteristics of a shifted subset font:
 * - Special glyphs like ^, [, ], \, _, ¾, ġ, ó, á, ½, þ, ý, ð
 * - Non-Turkish alphabet characters Q, W, X inside Turkish exam text
 * - Repetitive unusual patterns like JJ (e.g. RFIIJQJWJ -> MADDELERE)
 */
export const SHIFTED_INDICATOR = /[\^\[\]\\_¾ġóá½þýð]|(?:\b[A-Za-z]*[QWXqwx][A-Za-z]*\b)|[jJ]{2}/;

/**
 * Descrambles an individual word shifted by a linear offset (default: +5).
 */
export function descrambleWord(word: string, shift = 5): string {
  let res = '';
  for (let i = 0; i < word.length; i++) {
    const c = word[i];
    const code = word.charCodeAt(i);

    if (SPECIAL_GLYPHS[c]) {
      res += SPECIAL_GLYPHS[c];
      continue;
    }

    // Shift uppercase A-Z (and characters 91-95: [, \, ], ^, _ which were V, W, X, Y, Z)
    if (code >= 65 && code <= (90 + shift)) {
      const shifted = code - shift;
      if (shifted >= 65 && shifted <= 90) {
        res += String.fromCharCode(shifted);
        continue;
      }
    }

    // Shift lowercase a-z (and characters 123-126: {, |, }, ~)
    if (code >= 97 && code <= (122 + shift)) {
      const shifted = code - shift;
      if (shifted >= 97 && shifted <= 122) {
        res += String.fromCharCode(shifted);
        continue;
      }
    }

    res += c;
  }

  // Check dictionary normalization for common exam terms
  if (COMMON_REPAIR_MAP[res]) {
    return COMMON_REPAIR_MAP[res];
  }

  return res;
}

/**
 * Cleans text line-by-line and token-by-token.
 * Unshifted lines (headers, normal questions) remain intact.
 * Shifted lines and tokens are precisely descrambled into proper Turkish.
 */
export function cleanAndDescramblePdfText(rawText: string): { text: string; isClean: boolean; shiftApplied?: number } {
  if (!rawText || rawText.trim().length === 0) {
    return { text: '', isClean: false };
  }

  let anyShiftedFound = false;

  const lines = rawText.split('\n').map((line) => {
    // 1. Shifted options check: If a line starts with F) G) H) I) J), shift back to A) B) C) D) E)
    let processedLine = line.replace(/^([F-Jf-j])([\.\)\-\:])/g, (m, opt, sep) => {
      anyShiftedFound = true;
      const origOpt = String.fromCharCode(opt.toUpperCase().charCodeAt(0) - 5);
      return origOpt + sep;
    });

    // Also handle inline shifted options: " F) ... G) ... H) ..."
    processedLine = processedLine.replace(/(\s+)([F-Jf-j])([\.\)\-\:])(\s+)/g, (m, sp1, opt, sep, sp2) => {
      anyShiftedFound = true;
      const origOpt = String.fromCharCode(opt.toUpperCase().charCodeAt(0) - 5);
      return sp1 + origOpt + sep + sp2;
    });

    // 2. Token-by-token descramble if shifted indicators exist on this line
    if (SHIFTED_INDICATOR.test(processedLine)) {
      anyShiftedFound = true;
      return processedLine.replace(/[^\s]+/g, (token) => {
        // Preserve standalone numbers, symbols or punctuation
        if (/^[\d\.,\(\)\-\:\;\?\!]+$/.test(token)) {
          return token;
        }

        if (SHIFTED_INDICATOR.test(token)) {
          return descrambleWord(token, 5);
        }

        return token;
      });
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
 * Automatically repairs any garbled/shifted text in a question object or text string.
 */
export function autoRepairText(str: string): string {
  if (!str) return '';
  if (SHIFTED_INDICATOR.test(str)) {
    return cleanAndDescramblePdfText(str).text;
  }
  return str;
}
