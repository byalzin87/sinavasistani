import { Question, Option } from '../types';
import { cleanAndDescramblePdfText, autoRepairText, normalizeTextEncoding, preValidateAndSanitizeLines, preValidateQuestionStructure } from './textDescrambler';

export interface LocalParseResult {
  title: string;
  questions: Question[];
  detectedAnswerKeyRawContent?: string | null;
}

const STANDARD_OPTION_ORDER = ['A', 'B', 'C', 'D', 'E'];

/**
 * Extracts multiple-choice options (A, B, C, D, E) from a question text block.
 * Supports:
 * - Vertical options: A) ... \n B) ... \n C) ... \n D) ... \n E) ...
 * - Inline options on same line: A) ...   B) ...   C) ...   D) ...   E) ...
 * - Two-by-two grid options: A) ... B) ... \n C) ... D) ... \n E) ...
 * - Separators: A), A., A:, A-, (A), [A]
 * - Missing whitespace: A)Metin
 * - Preserves Roman numerals (I., II., III., IV., V.) in question stems without treating them as options
 */
export function extractOptionsFromText(block: string): { questionText: string; options: Option[] } {
  if (!block || !block.trim()) {
    return { questionText: '', options: [] };
  }

  // Regex to match option markers:
  // Starts at line start or preceded by whitespace / punctuation
  // Marker is strictly A, B, C, D, E (or F, G, H, I, J for Caesar shifted)
  // Followed by ), ., :, -, or enclosed in () or []
  const optRegex = /(?:^|\n|\s+)(?:\(|\[)?([A-Ja-j])(?:\)|\]|[\.\:\-])(?:\s*)/g;

  interface RawOptMatch {
    rawLabel: string;
    normalizedLabel: string;
    startIndex: number;
    textStartIndex: number;
  }

  const matches: RawOptMatch[] = [];
  let m: RegExpExecArray | null;

  while ((m = optRegex.exec(block)) !== null) {
    const rawChar = m[1].toUpperCase();
    let norm = rawChar;

    // Handle Caesar +5 shifted options (F, G, H, I, J -> A, B, C, D, E)
    if (['F', 'G', 'H', 'I', 'J'].includes(rawChar)) {
      norm = String.fromCharCode(rawChar.charCodeAt(0) - 5);
    }

    if (['A', 'B', 'C', 'D', 'E'].includes(norm)) {
      matches.push({
        rawLabel: rawChar,
        normalizedLabel: norm,
        startIndex: m.index,
        textStartIndex: m.index + m[0].length
      });
    }
  }

  // Find candidate sequence starting with 'A'
  let bestSequence: RawOptMatch[] = [];

  for (let i = 0; i < matches.length; i++) {
    if (matches[i].normalizedLabel === 'A') {
      const candidate: RawOptMatch[] = [matches[i]];
      let expectedNextIdx = 1; // Expecting 'B'

      for (let j = i + 1; j < matches.length; j++) {
        const nextOpt = matches[j];
        if (expectedNextIdx < STANDARD_OPTION_ORDER.length && nextOpt.normalizedLabel === STANDARD_OPTION_ORDER[expectedNextIdx]) {
          candidate.push(nextOpt);
          expectedNextIdx++;
        }
      }

      if (candidate.length >= 2 && candidate.length > bestSequence.length) {
        bestSequence = candidate;
      }
    }
  }

  // If no sequence starting with 'A' was found, try unique labels >= 2
  if (bestSequence.length < 2 && matches.length >= 2) {
    const unique = new Map<string, RawOptMatch>();
    for (const match of matches) {
      if (!unique.has(match.normalizedLabel)) {
        unique.set(match.normalizedLabel, match);
      }
    }
    const sorted = Array.from(unique.values()).sort((a, b) => a.startIndex - b.startIndex);
    if (sorted.length >= 2) {
      bestSequence = sorted;
    }
  }

  if (bestSequence.length < 2) {
    return {
      questionText: block.trim(),
      options: [
        { label: 'A', text: '' },
        { label: 'B', text: '' },
        { label: 'C', text: '' },
        { label: 'D', text: '' }
      ]
    };
  }

  // Question text is everything before the first recognized option
  const firstOptStart = bestSequence[0].startIndex;
  let questionStem = block.substring(0, firstOptStart).trim();

  // Extract each option's text
  const optionsMap = new Map<string, string>();

  for (let i = 0; i < bestSequence.length; i++) {
    const cur = bestSequence[i];
    const next = bestSequence[i + 1];

    let optContent = next
      ? block.substring(cur.textStartIndex, next.startIndex).trim()
      : block.substring(cur.textStartIndex).trim();

    // Clean up trailing answer notes like "Cevap: C", "Doğru Seçenek: B"
    optContent = optContent.replace(/(?:Doğru\s*Cevap|Cevap|Yanıt|Doğru\s*Seçenek)[\s:]*[A-Ea-e].*$/i, '').trim();
    optContent = optContent.replace(/--- Sütun \d+ ---/g, '').replace(/\bSütun \d+\b/g, '').trim();
    optContent = preValidateAndSanitizeLines(optContent);

    let cleanOpt = autoRepairText(optContent)
      .replace(/\r?\n/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    optionsMap.set(cur.normalizedLabel, cleanOpt);
  }

  // Sort options strictly by label: A, B, C, D, E
  const sortedOptions: Option[] = [];
  for (const label of STANDARD_OPTION_ORDER) {
    if (optionsMap.has(label)) {
      sortedOptions.push({
        label,
        text: optionsMap.get(label)!
      });
    }
  }

  questionStem = questionStem.replace(/(?:Doğru\s*Cevap|Cevap|Yanıt|Doğru\s*Seçenek)[\s:]*[A-Ea-e].*$/i, '').trim();
  questionStem = questionStem.replace(/--- Sütun \d+ ---/g, '').replace(/\bSütun \d+\b/g, '').trim();
  questionStem = autoRepairText(
    questionStem
      .replace(/\r?\n/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
  questionStem = preValidateAndSanitizeLines(questionStem);

  return {
    questionText: autoRepairText(questionStem),
    options: sortedOptions
  };
}

/**
 * Robust Answer Key Table Parser for Turkish Exam documents.
 * Recognizes:
 * 1. Horizontal 2-Row Tables:
 *    Row 1: 1  2  3  4  5  6  7  8  9 10 11 12 13 14 15 16 17 18 19 20
 *    Row 2: A  C  D  B  E  A  B  C  D  E  A  B  C  D  E  A  B  C  D  E
 * 2. Key-value pairs: 1-A 2-C 3-D 4-B ... or 1. A  2. C ...
 * 3. Section headers: "CEVAP ANAHTARI", "YANITLAR", "ANSWER KEY"
 */
function parseAnswerKeyTable(content: string): {
  answerKeyMap: Record<number, string>;
  detectedRawKey: string | null;
  cleanedContent: string;
} {
  const answerKeyMap: Record<number, string> = {};
  let detectedRawKey: string | null = null;
  let cleanedContent = content;

  // 1. Look for explicit "CEVAP ANAHTARI" or "YANIT ANAHTARI" or "YANITLAR" block
  const headerRegex = /(?:CEVAP\s*ANAHTARI|YANIT\s*ANAHTARI|YANITLAR|ANSWER\s*KEY)[\s:]*([\s\S]+?)(?=$|\n\s*\n\s*\n)/i;
  const headerMatch = content.match(headerRegex);

  if (headerMatch && headerMatch.index !== undefined) {
    detectedRawKey = headerMatch[0].trim();
    const rawKeyBody = headerMatch[1].trim();

    // Try parsing horizontal 2-row table inside header block
    const lines = rawKeyBody.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    for (let i = 0; i < lines.length - 1; i++) {
      const line1 = lines[i];
      const line2 = lines[i + 1];

      const nums = line1.split(/[\s,\t|]+/).map(n => parseInt(n, 10)).filter(n => !isNaN(n));
      const letters = line2.split(/[\s,\t|]+/).map(l => l.toUpperCase().trim()).filter(l => /^[A-E]$/.test(l));

      if (nums.length >= 3 && letters.length >= 3 && Math.abs(nums.length - letters.length) <= 2) {
        const pairCount = Math.min(nums.length, letters.length);
        for (let p = 0; p < pairCount; p++) {
          answerKeyMap[nums[p]] = letters[p];
        }
      }
    }

    // Also match inline pairs like 1-A, 1.A, 1:A, 1 A
    const pairs = rawKeyBody.matchAll(/(\d{1,3})[\s\.\-\):]+([A-Ea-e])\b/g);
    for (const kp of pairs) {
      answerKeyMap[parseInt(kp[1], 10)] = kp[2].toUpperCase();
    }

    // Cut out answer key from content
    cleanedContent = content.slice(0, headerMatch.index) + content.slice(headerMatch.index + headerMatch[0].length);
  }

  // 2. Look for two consecutive lines at the bottom of the document that form a horizontal numbers & letters table
  // Even if there is no explicit "CEVAP ANAHTARI" header
  const allLines = cleanedContent.split('\n');
  const tailStart = Math.max(0, allLines.length - 12);
  for (let i = tailStart; i < allLines.length - 1; i++) {
    const lineA = allLines[i].trim();
    const lineB = allLines[i + 1].trim();

    const nums = lineA.split(/[\s,\t|]+/).map(n => parseInt(n, 10)).filter(n => !isNaN(n));
    const letters = lineB.split(/[\s,\t|]+/).map(l => l.toUpperCase().trim()).filter(l => /^[A-E]$/.test(l));

    if (nums.length >= 4 && letters.length >= 4 && Math.abs(nums.length - letters.length) <= 2) {
      // Check if nums are sequential (e.g. 1, 2, 3...)
      let isSequential = true;
      for (let s = 1; s < Math.min(5, nums.length); s++) {
        if (nums[s] !== nums[s - 1] + 1) {
          isSequential = false;
          break;
        }
      }

      if (isSequential) {
        const pairCount = Math.min(nums.length, letters.length);
        const pairs: string[] = [];
        for (let p = 0; p < pairCount; p++) {
          answerKeyMap[nums[p]] = letters[p];
          pairs.push(`${nums[p]}-${letters[p]}`);
        }
        detectedRawKey = detectedRawKey || `Cevap Anahtarı Tablosu: ${pairs.join(' ')}`;
        allLines.splice(i, 2);
        cleanedContent = allLines.join('\n');
        break;
      }
    }
  }

  return { answerKeyMap, detectedRawKey, cleanedContent };
}

/**
 * Parses an exam from plain text, markdown, Word, Excel, or PDF-extracted text locally.
 * Guarantees questions are extracted and formatted cleanly for instant exam-taking.
 * Accurately supports 20+ questions per page, 2-column layout, and bottom tabular answer key.
 */
export function parseTextExamLocally(rawContent: string, fileName?: string): LocalParseResult {
  const normalized = normalizeTextEncoding(rawContent);
  const cleaned = cleanAndDescramblePdfText(normalized).text;
  const content = cleaned.trim();
  const defaultTitle = fileName ? fileName.replace(/\.[^/.]+$/, '') : 'Yeni Sınav';

  if (!content) {
    return {
      title: defaultTitle,
      questions: [
        {
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
        }
      ]
    };
  }

  // 1. JSON check
  if (content.startsWith('{') || content.startsWith('[')) {
    try {
      const parsed = JSON.parse(content);
      const title = parsed.title || defaultTitle;
      const rawQuestions = Array.isArray(parsed) ? parsed : (parsed.questions || []);

      if (Array.isArray(rawQuestions) && rawQuestions.length > 0) {
        const questions: Question[] = rawQuestions.map((q: any, idx: number) => ({
          id: typeof q.id === 'number' ? q.id : idx + 1,
          text: autoRepairText(q.text || q.question || `Soru ${idx + 1}`),
          options: Array.isArray(q.options)
            ? q.options.map((opt: any, oIdx: number) => {
                if (typeof opt === 'string') {
                  const labelMatch = opt.match(/^([A-Ea-e])[\.\)\-\:]\s*(.*)$/);
                  if (labelMatch) {
                    return { label: labelMatch[1].toUpperCase(), text: autoRepairText(labelMatch[2].trim()) };
                  }
                  return { label: STANDARD_OPTION_ORDER[oIdx] || 'A', text: autoRepairText(opt.trim()) };
                }
                return {
                  label: String(opt.label || STANDARD_OPTION_ORDER[oIdx] || 'A').toUpperCase(),
                  text: autoRepairText(String(opt.text || opt.value || '').trim())
                };
              })
            : [
                { label: 'A', text: '' },
                { label: 'B', text: '' },
                { label: 'C', text: '' },
                { label: 'D', text: '' }
              ],
          correctAnswerLabel: q.correctAnswerLabel || q.answer || q.correctAnswer
            ? String(q.correctAnswerLabel || q.answer || q.correctAnswer).trim().toUpperCase()
            : null,
          userSelection: null
        }));

        return {
          title,
          questions: questions.map(preValidateQuestionStructure),
          detectedAnswerKeyRawContent: parsed.detectedAnswerKeyRawContent || 'JSON formatından yüklendi'
        };
      }
    } catch {
      // Continue to text parsing
    }
  }

  // 2. Extract and parse Answer Key table from the bottom or anywhere in the document
  const { answerKeyMap, detectedRawKey, cleanedContent } = parseAnswerKeyTable(content);

  // Pre-validate and sanitize inconsistent lines (headers, footers, watermarks)
  let body = preValidateAndSanitizeLines(cleanedContent);

  // 3. Segment into Question Blocks
  // Regex to detect Turkish question headers:
  // "1.", "1)", "1 -", "1:", "Soru 1:", "SORU 1.", "(1)", "[1]"
  // Crucially: Does NOT match Roman numerals like "I.", "II.", "III." or option markers "A)", "B)"
  const questionDelimiterRegex = /(?:^|\n)(?=(?:(?:Soru|SORU)\s*)?\(?\d{1,3}\)?[\.\)\-:]\s*)/;
  const rawBlocks = body.split(questionDelimiterRegex);

  const parsedQuestions: Question[] = [];
  let nextExpectedQuestionId = 1;

  for (const block of rawBlocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    const headerMatch = trimmed.match(/^(?:(?:Soru|SORU)\s*)?\(?(\d{1,3})\)?[\.\)\-:]\s*([\s\S]*)$/i);
    if (!headerMatch) {
      // Check if this continuation block should be appended to the previous question
      if (parsedQuestions.length > 0 && trimmed.length > 0) {
        const lastQ = parsedQuestions[parsedQuestions.length - 1];
        if (lastQ.options.every(o => !o.text.trim())) {
          const reExtracted = extractOptionsFromText(lastQ.text + '\n' + trimmed);
          if (reExtracted.options.some(o => o.text.trim().length > 0)) {
            lastQ.text = reExtracted.questionText;
            lastQ.options = reExtracted.options;
          }
        }
      }
      continue;
    }

    const questionNumber = parseInt(headerMatch[1], 10);
    const contentAfterNumber = (headerMatch[2] || '').trim();

    // Extract question text and options
    const { questionText, options } = extractOptionsFromText(contentAfterNumber);

    // Look for answer in answerKeyMap first, then inline "Cevap: B"
    let correctAnswerLabel: string | null = answerKeyMap[questionNumber] || null;
    if (!correctAnswerLabel) {
      const inlineMatch = trimmed.match(/(?:Doğru\s*Cevap|Cevap|Yanıt|Doğru\s*Seçenek)[\s:]*([A-Ea-e])/i);
      if (inlineMatch) {
        correctAnswerLabel = inlineMatch[1].toUpperCase();
      }
    }

    const qId = questionNumber || nextExpectedQuestionId;
    nextExpectedQuestionId = qId + 1;

    const rawQuestion: Question = {
      id: qId,
      text: autoRepairText(questionText || `Soru ${qId}`),
      options,
      correctAnswerLabel,
      userSelection: null
    };

    const structuredQuestion = preValidateQuestionStructure(rawQuestion);
    parsedQuestions.push(structuredQuestion);
  }

  // Fallback if no questions could be segmented with numbers
  if (parsedQuestions.length === 0 && body.length > 20) {
    const paragraphs = body.split(/\n\s*\n+/).filter(p => p.trim().length > 15);
    if (paragraphs.length > 0) {
      paragraphs.forEach((p, idx) => {
        const { questionText, options } = extractOptionsFromText(p);
        parsedQuestions.push(
          preValidateQuestionStructure({
            id: idx + 1,
            text: autoRepairText(questionText || p.trim()),
            options,
            correctAnswerLabel: answerKeyMap[idx + 1] || null,
            userSelection: null
          })
        );
      });
    } else {
      parsedQuestions.push(
        preValidateQuestionStructure({
          id: 1,
          text: autoRepairText(body),
          options: [
            { label: 'A', text: '' },
            { label: 'B', text: '' },
            { label: 'C', text: '' },
            { label: 'D', text: '' }
          ],
          correctAnswerLabel: null,
          userSelection: null
        })
      );
    }
  }

  // Ensure sequential IDs (1, 2, 3...)
  const finalQuestions = parsedQuestions.map((q, idx) => ({
    ...q,
    id: idx + 1,
    correctAnswerLabel: q.correctAnswerLabel || answerKeyMap[idx + 1] || null
  }));

  return {
    title: defaultTitle,
    questions: finalQuestions,
    detectedAnswerKeyRawContent: detectedRawKey
  };
}
