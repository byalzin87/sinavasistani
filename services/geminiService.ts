import { Question } from '../types';

export interface ParseExamResponse {
  title: string;
  questions: Question[];
  detectedAnswerKeyRawContent?: string | null;
  errorMessage?: string;
}

/**
 * Sends the exam document (PDF, image, or text) to the server-side Gemini endpoint
 * to extract questions, multiple-choice options, and map the answer key.
 */
export const parseExamFile = async (
  data: string,
  mimeType: string,
  fileName?: string
): Promise<ParseExamResponse> => {
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
      // Server returned HTML or plain text (e.g., Vercel 404 or proxy error)
      console.error('Non-JSON response from /api/parse-exam:', rawText);
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
      console.error('Parse exam server error:', errorMsg);
      return {
        title: 'Hata: Dosya Okunamadı',
        questions: [],
        errorMessage: errorMsg
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
    return {
      title: 'Hata: Bağlantı Kurulamadı',
      questions: [],
      errorMessage: error?.message || 'Sunucuya bağlanırken bir ağ hatası oluştu.'
    };
  }
};