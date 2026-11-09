import { Question } from '../types';
import { parseTextExamLocally } from './localExamParser';
import { autoRepairText, enforceUtf8AndNormalize, preValidateQuestionStructure } from './textDescrambler';

export interface ParseExamResponse {
  title: string;
  questions: Question[];
  detectedAnswerKeyRawContent?: string | null;
  errorMessage?: string;
  isMissingApiKey?: boolean;
}

/**
 * Sends the exam document (PDF, image, or text) to the server-side Gemini endpoint
 * to extract questions, multiple-choice options, and map the answer key.
 * If server-side API key is missing or server fails, automatically falls back to
 * zero-cost client-side local parser.
 * Applies UTF-8 enforcement and normalization across all platforms.
 */
export const parseExamFile = async (
  data: string,
  mimeType: string,
  fileName?: string,
  fallbackText?: string
): Promise<ParseExamResponse> => {
  const isText =
    mimeType.startsWith('text/') ||
    mimeType === 'application/json' ||
    mimeType === 'text/plain' ||
    mimeType === 'text/markdown' ||
    mimeType === 'text/csv';

  const normalizedData = isText ? enforceUtf8AndNormalize(data) : data;
  const normalizedFallback = enforceUtf8AndNormalize(fallbackText || '');
  const textToFallback = isText ? normalizedData : normalizedFallback;

  const endpointsToTry = ['/api/parse-exam'];
  if (typeof window !== 'undefined' && (window.location.hostname.includes('github.io') || window.location.protocol === 'file:')) {
    endpointsToTry.push('https://sinavasistani-two.vercel.app/api/parse-exam');
  }

  let lastResponseStatus = 0;
  let lastRawText = '';

  for (const endpoint of endpointsToTry) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8'
        },
        body: JSON.stringify({
          data: normalizedData,
          mimeType,
          fileName: fileName || 'Sınav Dosyası'
        })
      });

      lastResponseStatus = response.status;
      lastRawText = await response.text();

      if (response.status === 404 && endpoint !== endpointsToTry[endpointsToTry.length - 1]) {
        // Try next endpoint (e.g. Vercel backend when on GitHub Pages)
        continue;
      }

      let result: any = null;
      try {
        result = lastRawText ? JSON.parse(lastRawText) : {};
      } catch {
        // Continue to fallback or error
      }

      if (response.ok && result && Array.isArray(result.questions) && result.questions.length > 0) {
        const questions: Question[] = result.questions.map((q: any, idx: number) => {
          const rawQ: Question = {
            id: typeof q.id === 'number' ? q.id : idx + 1,
            text: enforceUtf8AndNormalize(q.text || 'Soru metni okunamadı'),
            options: Array.isArray(q.options)
              ? q.options.map((opt: any) => ({
                  label: String(opt.label || '').trim().toUpperCase(),
                  text: enforceUtf8AndNormalize(String(opt.text || '').trim())
                }))
              : [],
            correctAnswerLabel: q.correctAnswerLabel ? String(q.correctAnswerLabel).trim().toUpperCase() : null,
            userSelection: null
          };

          const preValidated = preValidateQuestionStructure(rawQ);
          return {
            ...preValidated,
            text: autoRepairText(preValidated.text),
            options: preValidated.options.map(opt => ({
              label: opt.label,
              text: autoRepairText(opt.text)
            }))
          };
        });

        return {
          title: enforceUtf8AndNormalize(result.title || fileName || 'Yeni Sınav'),
          questions,
          detectedAnswerKeyRawContent: result.detectedAnswerKeyRawContent ? enforceUtf8AndNormalize(result.detectedAnswerKeyRawContent) : null
        };
      }

      if (!response.ok) {
        const errorMsg = result?.error || `Sunucu hatası (${response.status})`;
        const isMissingKey =
          result?.code === 'MISSING_GEMINI_API_KEY' ||
          String(errorMsg).includes('GEMINI_API_KEY') ||
          String(errorMsg).includes('ortam değişkeni');

        if (isMissingKey || response.status >= 400) {
          // If server reported missing API key or error, try local parser fallback
          if (textToFallback && textToFallback.trim().length > 0) {
            const local = parseTextExamLocally(textToFallback, fileName);
            if (local.questions.length > 0) {
              return local;
            }
          }
        }
      }
    } catch (endpointErr) {
      console.warn(`Endpoint ${endpoint} failed:`, endpointErr);
      if (endpoint !== endpointsToTry[endpointsToTry.length - 1]) {
        continue;
      }
    }
  }

  // Fallback to local parser if server endpoints failed or returned no questions
  if (textToFallback && textToFallback.trim().length > 0) {
    const local = parseTextExamLocally(textToFallback, fileName);
    if (local.questions.length > 0) {
      return local;
    }
  }

  // Final graceful fallback: return an editable exam structure with the file name
  const safeTitle = fileName ? fileName.replace(/\.[^/.]+$/, '') : 'Yeni Sınav';
  return {
    title: safeTitle,
    questions: [
      {
        id: 1,
        text: `${safeTitle} - Soru 1`,
        options: [
          { label: 'A', text: '' },
          { label: 'B', text: '' },
          { label: 'C', text: '' },
          { label: 'D', text: '' }
        ],
        correctAnswerLabel: null,
        userSelection: null
      }
    ],
    errorMessage: lastRawText && lastRawText.length < 200 ? lastRawText : undefined
  };
};