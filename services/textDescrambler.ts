/**
 * Intelligent text cleaner and descrambler for PDF font encoding anomalies.
 * Fixes Caesar-shifted subset fonts and custom Turkish glyph encodings.
 */

const COMMON_TURKISH_WORDS = [
  've', 'bir', 'bu', 'da', 'de', 'ile', 'için', 'olan', 'olarak', 'hangi',
  'hangisi', 'hangisidir', 'soru', 'cevap', 'yanıt', 'aşağıdakilerden',
  'yukarıdaki', 'doğru', 'yanlış', 'göre', 'kadar', 'en', 'ise', 'daha',
  'madde', 'maddeler', 'kimyasal', 'şekilde', 'nedeniyle', 'sağlaması',
  'ürünlerin', 'güvenli', 'karşı', 'dayanıklı', 'olması', 'saklanmasını',
  'test', 'deneme', 'seçenek', 'bilgi', 'aşağıda', 'buna', 'verilen'
];

/**
 * Maps known special Turkish font substitution glyphs
 */
function normalizeTurkishSpecialGlyphs(str: string): string {
  return str
    .replace(/\^/g, 'Y')
    .replace(/¾/g, 'Ü')
    .replace(/ġ/g, 'Ş')
    .replace(/ó/g, 'I')
    .replace(/á/g, 'Ğ')
    .replace(/½/g, 'Ö')
    .replace(/þ/g, 'Ş')
    .replace(/ý/g, 'ı')
    .replace(/ð/g, 'ğ')
    .replace(/ı/g, 'I')
    .replace(/İ/g, 'I');
}

/**
 * Counts occurrences of common Turkish words in a string
 */
function scoreTurkishReadability(text: string): number {
  const normalized = text.toLowerCase();
  let score = 0;
  for (const word of COMMON_TURKISH_WORDS) {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    const matches = normalized.match(regex);
    if (matches) {
      score += matches.length * 2;
    }
  }
  return score;
}

/**
 * Applies a linear character code shift to ASCII characters
 */
function applyShift(text: string, shift: number): string {
  let result = '';
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const code = text.charCodeAt(i);

    // Shift uppercase A-Z (including characters 91-95: [, \, ], ^, _ when shifted by +shift)
    if (code >= 65 && code <= (90 + shift)) {
      const shifted = code - shift;
      if (shifted >= 65 && shifted <= 90) {
        result += String.fromCharCode(shifted);
      } else {
        result += char;
      }
    }
    // Shift lowercase a-z (including characters 123-126 when shifted by +shift)
    else if (code >= 97 && code <= (122 + shift)) {
      const shifted = code - shift;
      if (shifted >= 97 && shifted <= 122) {
        result += String.fromCharCode(shifted);
      } else {
        result += char;
      }
    }
    // Special Turkish font glyphs
    else if (char === '¾') {
      result += 'Ü';
    } else if (char === 'ġ') {
      result += 'Ş';
    } else if (char === 'ó') {
      result += 'I';
    } else if (char === 'á') {
      result += 'Ğ';
    } else {
      result += char;
    }
  }
  return result;
}

/**
 * Cleans and automatically descrambles PDF extracted text.
 * Returns the cleaned text and whether the result is clean and readable.
 */
export function cleanAndDescramblePdfText(rawText: string): { text: string; isClean: boolean; shiftApplied?: number } {
  if (!rawText || rawText.trim().length === 0) {
    return { text: '', isClean: false };
  }

  // 1. Check if raw text is already readable
  const rawScore = scoreTurkishReadability(rawText);
  if (rawScore >= 4) {
    return { text: rawText, isClean: true };
  }

  // 2. Test shifts from -8 to +8 (with special attention to shift +5)
  const candidateShifts = [5, 4, 3, 2, 1, 6, 7, -1, -2, -3, -4, -5];
  let bestShift = 0;
  let bestScore = rawScore;
  let bestText = rawText;

  for (const shift of candidateShifts) {
    const candidateText = applyShift(rawText, shift);
    const score = scoreTurkishReadability(candidateText);

    if (score > bestScore) {
      bestScore = score;
      bestShift = shift;
      bestText = candidateText;
    }
  }

  // If a shift produced significant readable Turkish words, use it!
  if (bestScore >= 4 && bestShift !== 0) {
    console.log(`[TextDescrambler] Successfully descrambled PDF text using shift -${bestShift} (score: ${bestScore})`);
    return { text: bestText, isClean: true, shiftApplied: bestShift };
  }

  // 3. If raw score is low, try normalizing Turkish special glyphs alone
  const normalized = normalizeTurkishSpecialGlyphs(rawText);
  const normScore = scoreTurkishReadability(normalized);
  if (normScore >= 4) {
    return { text: normalized, isClean: true };
  }

  // If even after shifting and normalization score is zero/very low, flag as garbled
  // so the caller knows to fall back to visual OCR
  const isClean = bestScore >= 3 || rawText.length < 100;
  return { text: bestText, isClean };
}
