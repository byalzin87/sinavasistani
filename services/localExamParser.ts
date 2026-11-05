import { Question } from '../types';
import { cleanAndDescramblePdfText } from './textDescrambler';

export interface LocalParseResult {
  title: string;
  questions: Question[];
  detectedAnswerKeyRawContent?: string | null;
}

/**
 * Parses an exam from a plain text, markdown, or JSON string locally
 * without requiring any external AI API or server.
 * Handles both multiline and inline options (A, B, C, D, E) and tabular answer keys.
 * Automatically descrambles Caesar-shifted subset fonts and custom Turkish encodings.
 */
export function parseTextExamLocally(rawContent: string, fileName?: string): LocalParseResult {
  const cleaned = cleanAndDescramblePdfText(rawContent).text;
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
          detectedAnswerKeyRawContent: parsed.detectedAnswerKeyRawContent || 'JSON içerisinden okundu'
        };
      }
    } catch {
      // Continue to text parsing
    }
  }

  // 2. Parse plain text / markdown / PDF extracted text
  // Look for Answer Key block
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

  // Remove answer key section from questions body to avoid confusing question parsers
  let bodyWithoutKey = content;
  if (keyMatch && keyMatch.index !== undefined) {
    bodyWithoutKey = content.slice(0, keyMatch.index) + content.slice(keyMatch.index + keyMatch[0].length);
  }

  // Split into question blocks: match lines starting with "1.", "1)", "Soru 1:", "1 -", etc.
  const questionBlocks = bodyWithoutKey.split(/(?:^|\n)(?=(?:Soru\s*)?\d{1,3}[\.\)\-:]\s+)/i);

  const questions: Question[] = [];

  for (const block of questionBlocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    // Check if this block starts with a question number
    const headerMatch = trimmed.match(/^(?:Soru\s*)?(\d{1,3})[\.\)\-:]\s*([\s\S]+)$/i);
    if (!headerMatch) continue;

    const questionNumber = parseInt(headerMatch[1], 10);
    const fullContent = headerMatch[2].trim();

    // Find options inside this block
    // Supports both multiline (A) ... \n B) ...) and inline (A) ... B) ... C) ...)
    const optionRegex = /(?:^|\n|\s{2,})\(?([A-Ea-e])\)?[.\-:]\s+/g;
    const optIndices: { label: string; start: number; end: number }[] = [];

    let match: RegExpExecArray | null;
    while ((match = optionRegex.exec(fullContent)) !== null) {
      optIndices.push({
        label: match[1].toUpperCase(),
        start: match.index,
        end: match.index + match[0].length
      });
    }

    let questionText = fullContent;
    const options: { label: string; text: string }[] = [];

    if (optIndices.length >= 2) {
      // Must have at least 2 options to be recognized as options
      questionText = fullContent.substring(0, optIndices[0].start).trim();

      for (let i = 0; i < optIndices.length; i++) {
        const cur = optIndices[i];
        const next = optIndices[i + 1];
        let optText = next
          ? fullContent.substring(cur.end, next.start).trim()
          : fullContent.substring(cur.end).trim();

        // Remove trailing answer indicators like "Cevap: B", "Doğru: C"
        optText = optText.replace(/(?:Doğru\s*Cevap|Cevap|Yanıt)[\s:]*[A-Ea-e].*$/i, '').trim();

        options.push({
          label: cur.label,
          text: optText
        });
      }
    }

    // Look for an inline answer key in the question block: "Cevap: B", "Yanıt: A", "Doğru Cevap: C"
    let correctAnswerLabel: string | null = answerKeyMap[questionNumber] || null;
    if (!correctAnswerLabel) {
      const inlineKeyMatch = trimmed.match(/(?:Doğru\s*Cevap|Cevap|Yanıt)[\s:]*([A-Ea-e])/i);
      if (inlineKeyMatch) {
        correctAnswerLabel = inlineKeyMatch[1].toUpperCase();
      }
    }

    // Clean up question text if it still contains inline answer text
    questionText = questionText.replace(/(?:Doğru\s*Cevap|Cevap|Yanıt)[\s:]*[A-Ea-e].*$/i, '').trim();

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
