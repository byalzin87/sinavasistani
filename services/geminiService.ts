import { Question } from '../types';
import { parseTextExamLocally } from './localExamParser';

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
 * If server-side API key is missing, provides free offline text fallback.
 */
export const parseExamFile = async (
  data: string,
  mimeType: string,
  fileName?: string
): Promise<ParseExamResponse> => {
  const isText =
    mimeType.startsWith('text/') ||
    mimeType === 'application/json' ||
    mimeType === 'text/plain' ||
    mimeType === 'text/markdown' ||
    mimeType === 'text/csv';

  try {
    const response = await fetch('/api/parse-exam', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        data,
        mimeType,
        fileName: fileName || 'Sınav Dosyası'
      })
    });

    const rawText = await response.text();
    let result: any = null;

    try {
      result = rawText ? JSON.parse(rawText) : {};
    } catch {
      console.error('Non-JSON response from /api/parse-exam:', rawText);
      // If it's a text file and server returned error/HTML, run local parser
      if (isText) {
        const local = parseTextExamLocally(data, fileName);
        if (local.questions.length > 0) {
          return local;
        }
      }

      if (response.status === 404 || rawText.includes('The page could not be found')) {
        return {
          title: 'Hata: API Uç Noktası Bulunamadı',
          questions: [],
          errorMessage:
            'Sunucu API uç noktasına ulaşılamadı (404: /api/parse-exam). Vercel kullanıyorsanız projenizin Settings > Environment Variables bölümüne GEMINI_API_KEY eklediğinizden ve son güncellemeleri GitHub üzerinden yeniden dağıttığınızdan (Redeploy) emin olun.'
        };
      }
      return {
        title: 'Hata: Sunucu Yanıtı Geçersiz',
        questions: [],
        errorMessage: `Sunucudan geçersiz bir yanıt alındı (${response.status}): ${rawText.slice(0, 120)}`
      };
    }

    if (!response.ok) {
      const errorMsg = result?.error || `Sunucu hatası (${response.status})`;
      const isMissingKey =
        result?.code === 'MISSING_GEMINI_API_KEY' ||
        String(errorMsg).includes('GEMINI_API_KEY') ||
        String(errorMsg).includes('ortam değişkeni bulunamadı');

      // If it's a text file, try client-side local parser before giving up!
      if (isText) {
        const local = parseTextExamLocally(data, fileName);
        if (local.questions.length > 0) {
          return local;
        }
      }

      console.error('Parse exam server error:', errorMsg);
      return {
        title: isMissingKey ? 'GEMINI_API_KEY Gerekli' : 'Hata: Dosya Okunamadı',
        questions: [],
        isMissingApiKey: isMissingKey,
        errorMessage: isMissingKey
          ? 'Vercel üzerinde GEMINI_API_KEY ortam değişkeni bulunamadı. PDF veya resim gibi görsel belgeleri işlemek için Google AI Studio üzerinden tamamen ÜCRETSİZ bir API anahtarı ekleyebilir veya sınavınızı .txt formatında doğrudan yükleyebilirsiniz.'
          : errorMsg
      };
    }

    const questions: Question[] = (result.questions || []).map((q: any, idx: number) => ({
      id: typeof q.id === 'number' ? q.id : idx + 1,
      text: q.text || 'Soru metni okunamadı',
      options: Array.isArray(q.options)
        ? q.options.map((opt: any) => ({
            label: String(opt.label || '').trim().toUpperCase(),
            text: String(opt.text || '').trim()
          }))
        : [],
      correctAnswerLabel: q.correctAnswerLabel ? String(q.correctAnswerLabel).trim().toUpperCase() : null,
      userSelection: null
    }));

    return {
      title: result.title || fileName || 'Yeni Sınav',
      questions,
      detectedAnswerKeyRawContent: result.detectedAnswerKeyRawContent || null
    };
  } catch (error: any) {
    console.error('parseExamFile network error:', error);

    // If text file and network failed, run local parser
    if (isText) {
      const local = parseTextExamLocally(data, fileName);
      if (local.questions.length > 0) {
        return local;
      }
    }

    return {
      title: 'Hata: Bağlantı Kurulamadı',
      questions: [],
      errorMessage: error?.message || 'Sunucuya bağlanırken bir ağ hatası oluştu.'
    };
  }
};