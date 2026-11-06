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
 * - Repetitive unusual patterns like JJ or any J in uppercase words (E shifted to J)
 */
export const SHIFTED_INDICATOR = /[\^\[\]\\_¾ġóá½þýð]|[QWXqwx]|[jJ]{2}|(?:[A-Z]{2,}[J][A-Z]*)|(?:[A-Z]*[J][A-Z]{2,})/;

/**
 * Checks if a line or token looks shifted.
 */
export function isShifted(text: string): boolean {
  if (!text) return false;
  return SHIFTED_INDICATOR.test(text) || /\b[F-Jf-j][\.\)\-\:]\s+/.test(text);
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
 * Unshifted lines (standard headers) remain intact.
 * Shifted lines are completely descrambled word-by-word into proper Turkish.
 */
export function cleanAndDescramblePdfText(rawText: string): { text: string; isClean: boolean; shiftApplied?: number } {
  if (!rawText || rawText.trim().length === 0) {
    return { text: '', isClean: false };
  }

  const rawLines = rawText.split('\n');

  // Count shifted indicators across the whole document
  let totalShiftedLines = 0;
  for (const line of rawLines) {
    if (isShifted(line)) {
      totalShiftedLines++;
    }
  }

  const isDocumentPrimarilyShifted = totalShiftedLines >= 2 || (totalShiftedLines > 0 && totalShiftedLines / Math.max(1, rawLines.length) > 0.15);

  let anyShiftedFound = false;

  const lines = rawLines.map((line) => {
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

    const lineIsShifted = isShifted(processedLine) || (isDocumentPrimarilyShifted && !/^(?:T\.C\.|MİLLİ|BAKANLIĞI|SINAV|SAYFA|PAGE|\d+)/i.test(processedLine.trim()));

    // 2. Descramble words if line is shifted
    if (lineIsShifted) {
      anyShiftedFound = true;
      return processedLine.replace(/[^\s]+/g, (token) => {
        // Preserve standalone numbers, symbols, question numbers or punctuation (e.g. "1.", "(A)", "---", "50%")
        if (/^[\d\.,\(\)\-\:\;\?\!\%\/]+$/.test(token)) {
          return token;
        }

        // Descramble the word token
        return descrambleWord(token, 5);
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
  if (isShifted(str)) {
    return cleanAndDescramblePdfText(str).text;
  }
  return str;
}
