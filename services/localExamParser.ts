import { Question, Option } from '../types';
import { cleanAndDescramblePdfText, autoRepairText, normalizeTextEncoding } from './textDescrambler';

export interface LocalParseResult {
  title: string;
  questions: Question[];
  detectedAnswerKeyRawContent?: string | null;
}

/**
 * Standard option order for multiple-choice questions.
 */
const STANDARD_OPTION_ORDER = ['A', 'B', 'C', 'D', 'E'];

/**
 * Extracts multiple-choice options (A, B, C, D, E) from a question text block.
 * Supports:
 * - Multiline options: A) ... \n B) ...
 * - Inline options on same line: A) ...   B) ...   C) ...
 * - Various separators: A), A., A:, A-, (A), [A]
 * - Both uppercase (A-E) and lowercase (a-e)
 * - Shifted subset font options (F, G, H, I, J -> A, B, C, D, E)
 * Guarantees options are sorted in clean alphabetical order (A -> B -> C -> D -> E).
 */
export function extractOptionsFromText(block: string): { questionText: string; options: Option[] } {
  if (!block || !block.trim()) {
    return { questionText: '', options: [] };
  }

  // Regex to match option markers:
  // Option marker must be preceded by start of line or at least one whitespace
  // Format: A), (A), [A], A., A:, A-
  const optRegex = /(?:^|\n|\s+)(?:\(|\[)?([A-Ja-j])(?:\)|\]|[\.\:\-])\s+/g;

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

    // Handle Caesar +5 shifted options (F, G, H, I, J)
    if (['F', 'G', 'H', 'I', 'J'].includes(rawChar)) {
      norm = String.fromCharCode(rawChar.charCodeAt(0) - 5);
    }

    // Only accept valid question options (A through E)
    if (['A', 'B', 'C', 'D', 'E'].includes(norm)) {
      matches.push({
        rawLabel: rawChar,
        normalizedLabel: norm,
        startIndex: m.index,
        textStartIndex: m.index + m[0].length
      });
    }
  }

  // Look for the best sequence of options that starts with 'A'
  // A valid multiple-choice question must have at least 2 distinct options
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

  // If no sequence starting with 'A' was found, try any sequence with at least 2 distinct sequential letters
  if (bestSequence.length < 2 && matches.length >= 2) {
    // Check if unique labels >= 2
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
    // No valid option set found in this block
    return {
      questionText: block.trim(),
      options: []
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

    // Clean up trailing answer notes like "Cevap: C", "Doğru Seçenek: B", etc.
    optContent = optContent.replace(/(?:Doğru\s*Cevap|Cevap|Yanıt|Doğru\s*Seçenek)[\s:]*[A-Ea-e].*$/i, '').trim();

    // Remove trailing column separators
    optContent = optContent.replace(/--- Sütun \d+ ---/g, '').trim();

    optionsMap.set(cur.normalizedLabel, autoRepairText(optContent));
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

  // Clean question stem of any trailing inline answer indications
  questionStem = questionStem.replace(/(?:Doğru\s*Cevap|Cevap|Yanıt|Doğru\s*Seçenek)[\s:]*[A-Ea-e].*$/i, '').trim();
  questionStem = questionStem.replace(/--- Sütun \d+ ---/g, '').trim();

  return {
    questionText: autoRepairText(questionStem),
    options: sortedOptions
  };
}

/**
 * Parses an exam from a plain text, markdown, or PDF-extracted text locally.
 * Solves:
 * - Strange/shifted characters (integrated auto-descrambler)
 * - Wrong option ordering (deterministic A -> B -> C -> D -> E sorting)
 * - Inconsistent question blocks (smart sequential numbering & premise protection)
 * - Answer key extraction (tabular, list, and inline formats)
 */
export function parseTextExamLocally(rawContent: string, fileName?: string): LocalParseResult {
  const normalized = normalizeTextEncoding(rawContent);
  const cleaned = cleanAndDescramblePdfText(normalized).text;
  const content = cleaned.trim();
  const defaultTitle = fileName ? fileName.replace(/\.[^/.]+$/, '') : 'Yeni Sınav';

  if (!content) {
    return { title: defaultTitle, questions: [] };
  }

  // 1. Try parsing as JSON first
  if (content.startsWith('{') || content.startsWith('[')) {
    try {
      const parsed = JSON.parse(content);
      const title = parsed.title || defaultTitle;
      const rawQuestions = Array.isArray(parsed) ? parsed : (parsed.questions || []);

      if (Array.isArray(rawQuestions) && rawQuestions.length > 0) {
        const questions: Question[] = rawQuestions.map((q: any, idx: number) => ({
          id: typeof q.id === 'number' ? q.id : idx + 1,
          text: autoRepairText(q.text || q.question || 'Soru metni'),
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
            : [],
          correctAnswerLabel: q.correctAnswerLabel || q.answer || q.correctAnswer
            ? String(q.correctAnswerLabel || q.answer || q.correctAnswer).trim().toUpperCase()
            : null,
          userSelection: null
        }));

        return {
          title,
          questions,
          detectedAnswerKeyRawContent: parsed.detectedAnswerKeyRawContent || 'JSON içerisinden okundu'
        };
      }
    } catch {
      // Continue to text parsing
    }
  }

  // 2. Extract Answer Key section
  let detectedAnswerKeyRawContent: string | null = null;
  const answerKeyMap: Record<number, string> = {};

  const answerKeyRegex = /(?:cevap\s*anahtar[ıi]|yan[ıi]t\s*anahtar[ıi]|yan[ıi]tlar|answer\s*key)[\s:]*([\s\S]+?)(?=$|\n\s*\n\s*\n)/i;
  const keyMatch = content.match(answerKeyRegex);
  if (keyMatch) {
    detectedAnswerKeyRawContent = keyMatch[0].trim();
    // Match "1-A", "1.A", "1: A", "1) A", "1 A"
    const keyPairs = keyMatch[1].matchAll(/(\d{1,3})[\s\.\-\):]+([A-Ea-e])\b/g);
    for (const kp of keyPairs) {
      answerKeyMap[parseInt(kp[1], 10)] = kp[2].toUpperCase();
    }
  }

  // Remove answer key section from questions body
  let body = content;
  if (keyMatch && keyMatch.index !== undefined) {
    body = content.slice(0, keyMatch.index) + content.slice(keyMatch.index + keyMatch[0].length);
  }

  // Remove common headers and column markers
  body = body.replace(/--- Sütun \d+ ---/g, '');
  body = body.replace(/^(?:Sayfa\s*\d+|\d+\s*\/\s*\d+|Page\s*\d+)\s*$/gim, '');

  // 3. Segment into Question Blocks
  // Split on lines that clearly introduce a new question:
  // e.g. "1.", "Soru 1:", "1)", "1 -", "1:"
  const rawBlocks = body.split(/(?:^|\n)(?=(?:Soru\s*)?\d{1,3}[\.\)\-:]\s+)/i);

  const parsedQuestions: Question[] = [];
  let nextExpectedQuestionId = 1;

  for (const block of rawBlocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    const headerMatch = trimmed.match(/^(?:Soru\s*)?(\d{1,3})[\.\)\-:]\s*([\s\S]+)$/i);
    if (!headerMatch) {
      // If this block doesn't start with a number but we have a previous question,
      // it might be an orphaned option or continuation
      if (parsedQuestions.length > 0 && trimmed.length > 0) {
        const lastQ = parsedQuestions[parsedQuestions.length - 1];
        if (lastQ.options.length === 0) {
          const reExtracted = extractOptionsFromText(lastQ.text + '\n' + trimmed);
          if (reExtracted.options.length > 0) {
            lastQ.text = reExtracted.questionText;
            lastQ.options = reExtracted.options;
          }
        }
      }
      continue;
    }

    const questionNumber = parseInt(headerMatch[1], 10);
    const contentAfterNumber = headerMatch[2].trim();

    // Extract question text and options
    const { questionText, options } = extractOptionsFromText(contentAfterNumber);

    // Look for inline answer key
    let correctAnswerLabel: string | null = answerKeyMap[questionNumber] || null;
    if (!correctAnswerLabel) {
      const inlineMatch = trimmed.match(/(?:Doğru\s*Cevap|Cevap|Yanıt|Doğru\s*Seçenek)[\s:]*([A-Ea-e])/i);
      if (inlineMatch) {
        correctAnswerLabel = inlineMatch[1].toUpperCase();
      }
    }

    // Determine final question ID
    const qId = questionNumber || nextExpectedQuestionId;
    nextExpectedQuestionId = qId + 1;

    parsedQuestions.push({
      id: qId,
      text: autoRepairText(questionText || `Soru ${qId}`),
      options,
      correctAnswerLabel,
      userSelection: null
    });
  }

  // Post-process: If any questions ended up with 0 options because options were placed at the bottom,
  // ensure everything is clean and properly formatted
  const finalQuestions = parsedQuestions.filter(q => q.text.trim().length > 0 || q.options.length > 0);

  return {
    title: defaultTitle,
    questions: finalQuestions,
    detectedAnswerKeyRawContent
  };
}
