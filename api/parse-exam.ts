import { GoogleGenAI, Type } from '@google/genai';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '25mb'
    }
  },
  maxDuration: 60
};

const SYSTEM_INSTRUCTION = `
Sen optik karakter tanıma (OCR) ve soru-cevap anahtarı eşleştirmede uzman bir Sınav Sayısallaştırıcısısın.
Görevin yüklenen sınav belgesini (PDF, resim veya metin) incelemek ve yapılandırılmış dijital sınava dönüştürmektir.

AŞAMA 1: CEVAP ANAHTARINI BUL VE ÇIKAR
1. Belgenin son sayfalarını, en alt kısımlarını veya sayfaların alt/yan kenarlarındaki cevap anahtarlarını kontrol et.
2. "Cevap Anahtarı", "Yanıtlar", "Key" gibi başlıkları ve 1-A, 2-C veya tablo halindeki eşleştirmeleri ara.
3. Bulduğun ham cevap anahtarını 'detectedAnswerKeyRawContent' alanına yaz.

AŞAMA 2: SORULARI VE ŞIKLARI ÇIKAR
1. Soruları sırayla (1, 2, 3...) çıkar.
2. Her sorunun metnini, soru kökünü tam olarak koru.
3. Seçenekleri (A, B, C, D, E...) ayıkla.
4. Tespit ettiğin cevap anahtarına göre her sorunun 'correctAnswerLabel' (doğru cevap şıkkı) bilgisini eşleştir.
5. Cevap anahtarı belgede yoksa veya soru için tespit edilemediyse 'correctAnswerLabel' değerini null veya boş bırak.

AŞAMA 3: DİKKAT EDİLECEK HUSUSLAR
- Tüm soruları eksiksiz çıkarmaya çalış.
- Başlık alanına sınavın adını (örnek: "TYT Türkçe Deneme Sınavı", "Matematik Testi 1") yaz.
`;

async function parseExamWithGemini(input: { data: string; mimeType: string; fileName?: string }) {
  const { data, mimeType, fileName } = input;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY ortam değişkeni bulunamadı. Vercel üzerinde kullanıyorsanız Vercel Dashboard > Project Settings > Environment Variables bölümüne GEMINI_API_KEY eklediğinizden emin olun.'
    );
  }

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build'
      }
    }
  });

  const isText = mimeType.startsWith('text/') || mimeType === 'application/json';
  const parts: any[] = [];

  if (isText) {
    parts.push({
      text: `Dosya Adı: ${fileName || 'Belirtilmedi'}\n\nİçerik:\n${data}`
    });
  } else {
    parts.push({
      inlineData: {
        mimeType: mimeType,
        data: data
      }
    });
  }

  parts.push({
    text: `Belge adı: ${fileName || 'Sınav Dosyası'}. Lütfen bu belgedeki tüm soruları, seçenekleri ve cevap anahtarını eksiksiz olarak çıkar ve JSON formatında döndür.`
  });

  const generateWithRetry = async () => {
    const models = ['gemini-3.8-flash', 'gemini-2.5-flash'];
    let lastError: any = null;

    for (const model of models) {
      try {
        return await ai.models.generateContent({
          model,
          contents: {
            parts: parts
          },
          config: {
            systemInstruction: SYSTEM_INSTRUCTION,
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                title: {
                  type: Type.STRING,
                  description: 'Sınavın başlığı veya konusu'
                },
                detectedAnswerKeyRawContent: {
                  type: Type.STRING,
                  description: 'Belgeden tespit edilen ham cevap anahtarı metni'
                },
                questions: {
                  type: Type.ARRAY,
                  description: 'Sınavdaki soruların listesi',
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      id: {
                        type: Type.INTEGER,
                        description: 'Soru numarası (1, 2, 3...)'
                      },
                      text: {
                        type: Type.STRING,
                        description: 'Soru metni'
                      },
                      options: {
                        type: Type.ARRAY,
                        description: 'Sorunun seçenekleri',
                        items: {
                          type: Type.OBJECT,
                          properties: {
                            label: {
                              type: Type.STRING,
                              description: 'Seçenek etiketi: A, B, C, D veya E'
                            },
                            text: {
                              type: Type.STRING,
                              description: 'Seçenek içeriği'
                            }
                          },
                          required: ['label', 'text']
                        }
                      },
                      correctAnswerLabel: {
                        type: Type.STRING,
                        description: 'Doğru seçenek harfi: A, B, C, D, E veya null'
                      }
                    },
                    required: ['id', 'text', 'options']
                  }
                }
              },
              required: ['title', 'questions']
            }
          }
        });
      } catch (err: any) {
        lastError = err;
        const errStr = String(err?.message || err);
        console.warn(`Model ${model} hatası:`, errStr.slice(0, 100));
        const isTransient =
          errStr.includes('503') || errStr.includes('UNAVAILABLE') || errStr.includes('high demand');
        if (isTransient) {
          continue;
        }
        throw err;
      }
    }
    throw lastError;
  };

  let response: any;
  try {
    response = await generateWithRetry();
  } catch (err: any) {
    let errorMessage = err?.message || 'Yapay zeka modeliyle iletişim kurulurken bir hata oluştu.';
    try {
      const parsed = JSON.parse(errorMessage);
      if (parsed?.error?.message) {
        if (parsed.error.code === 429 || parsed.error.status === 'RESOURCE_EXHAUSTED') {
          errorMessage = 'Dakika başına istek kotası aşıldı. Lütfen 15-20 saniye bekleyip tekrar deneyiniz.';
        } else if (parsed.error.code === 503 || parsed.error.status === 'UNAVAILABLE') {
          errorMessage = 'Yapay zeka sunucuları geçici olarak yoğun. Lütfen birkaç saniye sonra tekrar deneyiniz.';
        } else {
          errorMessage = parsed.error.message;
        }
      }
    } catch {
      // not JSON string
    }
    throw new Error(errorMessage);
  }

  let rawText = response.text || '';
  rawText = rawText.replace(/^```json\s*/gi, '').replace(/^```\s*/gi, '').replace(/```\s*$/gi, '').trim();

  if (!rawText) {
    throw new Error('Yapay zeka modelinden boş yanıt alındı.');
  }

  let parsedData: any;
  try {
    parsedData = JSON.parse(rawText);
  } catch (parseErr) {
    console.warn('JSON parse hatası, düzeltme deneniyor...', parseErr);
    const qStartIndex = rawText.indexOf('[');
    if (qStartIndex !== -1) {
      const lastBrace = rawText.lastIndexOf('}');
      if (lastBrace > qStartIndex) {
        const repaired = rawText.substring(0, lastBrace + 1) + ']}';
        try {
          parsedData = JSON.parse(repaired);
        } catch {}
      }
    }
    if (!parsedData) {
      throw new Error('Model çıktısı geçerli JSON formatına dönüştürülemedi.');
    }
  }

  const title = parsedData.title || fileName || 'Yeni Sınav';
  const questions = (parsedData.questions || []).map((q: any, idx: number) => ({
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
    title,
    questions,
    detectedAnswerKeyRawContent: parsedData.detectedAnswerKeyRawContent || null
  };
}

export default async function handler(req: any, res: any) {
  // CORS configuration
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Sadece POST istekleri desteklenmektedir.' });
  }

  try {
    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        // keep as is
      }
    }

    const { data, mimeType, fileName } = body || {};

    if (!data || !mimeType) {
      return res.status(400).json({ error: 'Dosya verisi (data) ve MIME türü (mimeType) gereklidir.' });
    }

    const result = await parseExamWithGemini({ data, mimeType, fileName });
    return res.status(200).json(result);
  } catch (err: any) {
    console.error('Vercel API parse-exam hatası:', err);
    return res.status(500).json({
      error: err?.message || 'Sınav dosyası işlenirken bir sunucu hatası oluştu.'
    });
  }
}
