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

    const result = await response.json();

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