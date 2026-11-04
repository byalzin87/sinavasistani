import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

// Set payload limits for handling PDFs and images
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

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

app.post('/api/parse-exam', async (req, res) => {
  try {
    const { data, mimeType, fileName } = req.body;

    if (!data || !mimeType) {
      return res.status(400).json({ error: 'Dosya verisi (data) ve MIME türü (mimeType) gereklidir.' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        error: 'Sunucuda GEMINI_API_KEY tanımlı değil. Lütfen geçerli bir API anahtarı sağlayın.'
      });
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
          const isTransient = errStr.includes('503') || errStr.includes('UNAVAILABLE') || errStr.includes('high demand');
          if (isTransient) {
            continue; // seamlessly try next model
          }
          throw err;
        }
      }
      throw lastError;
    };

    const response = await generateWithRetry();

    let rawText = response.text || '';
    rawText = rawText.replace(/^```json\s*/gi, '').replace(/^```\s*/gi, '').replace(/```\s*$/gi, '').trim();

    if (!rawText) {
      return res.status(500).json({ error: 'Yapay zeka modelinden yanıt alınamadı.' });
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
          parsedData = JSON.parse(repaired);
        }
      }
      if (!parsedData) {
        return res.status(500).json({ error: 'Model çıktısı geçerli JSON formatına dönüştürülemedi.' });
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

    return res.json({
      title,
      questions,
      detectedAnswerKeyRawContent: parsedData.detectedAnswerKeyRawContent || null
    });
  } catch (err: any) {
    console.error('Sınav ayrıştırma hatası:', err);
    let errorMessage = err?.message || 'Sınav dosyası işlenirken bir sunucu hatası oluştu.';
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
    return res.status(500).json({
      error: errorMessage
    });
  }
});

async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.use((_req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on port ${PORT}`);
  });
}

startServer();
