import { Question } from '../types';

export interface LocalParseResult {
  title: string;
  questions: Question[];
  detectedAnswerKeyRawContent?: string | null;
}

/**
 * Parses an exam from a plain text, markdown, or JSON string locally
 * without requiring any external AI API or server.
 */
export function parseTextExamLocally(rawContent: string, fileName?: string): LocalParseResult {
  const content = rawContent.trim();
  const defaultTitle = fileName ? fileName.replace(/\.[^/.]+$/, '') : 'Yeni Sınav';

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
                  const defaultLabel = String.fromCharCode(65 + oIdx);
                  return { label: defaultLabel, text: opt.trim() };
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

  // 2. Parse plain text / markdown
  // Look for Answer Key block
  let detectedAnswerKeyRawContent: string | null = null;
  const answerKeyMap: Record<number, string> = {};

  const answerKeyRegex = /(?:cevap\s*anahtar[ıi]|yan[ıi]tlar|answer\s*key)[\s:]*([\s\S]+?)(?=$|\n\s*\n\s*\n)/i;
  const keyMatch = content.match(answerKeyRegex);
  if (keyMatch) {
    detectedAnswerKeyRawContent = keyMatch[0].trim();
    const keyPairs = keyMatch[1].matchAll(/(\d+)[\s\.\-\):]+([A-Ea-e])/g);
    for (const kp of keyPairs) {
      const qNum = parseInt(kp[1], 10);
      answerKeyMap[qNum] = kp[2].toUpperCase();
    }
  }

  // Remove answer key section from questions body to avoid confusion
  let bodyWithoutKey = content;
  if (keyMatch && keyMatch.index !== undefined) {
    bodyWithoutKey = content.slice(0, keyMatch.index) + content.slice(keyMatch.index + keyMatch[0].length);
  }

  // Split into question blocks: match lines starting with "1.", "1)", "Soru 1:", "1 -", etc.
  const questionBlocks = bodyWithoutKey.split(/(?:^|\n)(?=(?:Soru\s*)?\d+[\.\)\-:]\s+)/i);

  const questions: Question[] = [];

  for (const block of questionBlocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    // Check if this block starts with a question number
    const headerMatch = trimmed.match(/^(?:Soru\s*)?(\d+)[\.\)\-:]\s*([\s\S]+)$/i);
    if (!headerMatch) continue;

    const questionNumber = parseInt(headerMatch[1], 10);
    const fullQuestionContent = headerMatch[2].trim();

    // Find options inside this block (A), B), C), D), E) or A., B. etc.)
    const optionMatches = [
      ...fullQuestionContent.matchAll(/(?:^|\n)\s*([A-Ea-e])[\.\)\-\:]\s*([^\n]+(?:\n(?!\s*[A-Ea-e][\.\)\-\:]|\s*(?:Cevap|Yanıt|Doğru)) [^\n]+)*)/g)
    ];

    let questionText = fullQuestionContent;
    const options: { label: string; text: string }[] = [];

    if (optionMatches.length > 0) {
      // The text before the first option is the question text
      const firstOptIndex = optionMatches[0].index ?? 0;
      questionText = fullQuestionContent.substring(0, firstOptIndex).trim();

      for (const m of optionMatches) {
        const label = m[1].toUpperCase();
        let optText = m[2].trim();
        // Clean trailing answer indication if any
        optText = optText.replace(/(?:Cevap|Yanıt|Doğru)[\s:]*[A-Ea-e].*$/i, '').trim();
        options.push({ label, text: optText });
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
