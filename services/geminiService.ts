import { Question } from '../types';
import { parseTextExamLocally } from './localExamParser';
import { autoRepairText, enforceUtf8AndNormalize } from './textDescrambler';

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
        const questions: Question[] = result.questions.map((q: any, idx: number) => ({
          id: typeof q.id === 'number' ? q.id : idx + 1,
          text: enforceUtf8AndNormalize(autoRepairText(q.text || 'Soru metni okunamadı')),
          options: Array.isArray(q.options)
            ? q.options
                .map((opt: any) => ({
                  label: String(opt.label || '').trim().toUpperCase(),
                  text: enforceUtf8AndNormalize(autoRepairText(String(opt.text || '').trim()))
                }))
                .sort((a: any, b: any) => (a.label || '').localeCompare(b.label || ''))
            : [],
          correctAnswerLabel: q.correctAnswerLabel ? String(q.correctAnswerLabel).trim().toUpperCase() : null,
          userSelection: null
        }));

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

        if (isMissingKey) {
          // If server reported missing API key, try local parser fallback
          if (textToFallback && textToFallback.trim().length > 0) {
            const local = parseTextExamLocally(textToFallback, fileName);
            if (local.questions.length > 0) {
              return local;
            }
          }

          return {
            title: 'GEMINI_API_KEY Gerekli',
            questions: [],
            isMissingApiKey: true,
            errorMessage:
              'Vercel üzerinde GEMINI_API_KEY ortam değişkeni bulunamadı. Taranmış görsel PDF dosyalarını okumak için Google AI Studio üzerinden tamamen ücretsiz bir API anahtarı alıp Vercel Dashboard > Project Settings > Environment Variables bölümüne GEMINI_API_KEY olarak ekleyebilirsiniz.'
          };
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

  if (lastResponseStatus === 404) {
    return {
      title: 'Hata: API Uç Noktası Bulunamadı',
      questions: [],
      errorMessage:
        'Sunucu API uç noktasına ulaşılamadı. Vercel panonuzda (Settings > Environment Variables) GEMINI_API_KEY anahtarını eklediğinizden ve Vercel linkiniz üzerinden işlem yaptığınızdan emin olun.'
    };
  }

  return {
    title: 'Hata: Dosya Çözümlenemedi',
    questions: [],
    errorMessage:
      lastRawText && lastRawText.length < 200
        ? lastRawText
        : 'Dosyadan soru çıkarılamadı. Özel font içeren PDF dosyalarında görsel yapay zeka OCR modunun devreye girmesi için Vercel üzerinde GEMINI_API_KEY tanımlanmalıdır.'
  };
};