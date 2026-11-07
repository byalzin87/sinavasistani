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
- Türkçe karakter ve font kodlama bozulmalarını düzelt: Belgedeki harfler veya font kodlamaları kaymışsa (örnek: bozuk semboller veya şifreli gibi görünen harfler), görsel OCR ve bağlam bilgisiyle metinleri düzgün, temiz ve doğru Türkçe imla kurallarına (ç, ğ, ı, ö, ş, ü) uygun şekilde dönüştür.
`;

function getApiKey(): string {
  return (
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.VITE_GEMINI_API_KEY ||
    process.env.GOOGLE_GENAI_API_KEY ||
    process.env.GEMINI_KEY ||
    process.env.API_KEY ||
    ''
  ).trim();
}

const SPECIAL_GLYPHS: Record<string, string> = {
  '¾': 'Ü', 'ġ': 'Ş', 'ó': 'I', 'á': 'Ğ', '½': 'Ö', 'þ': 'Ş', 'ý': 'I', 'ð': 'Ğ',
  '^': 'Y', '[': 'V', ']': 'X', '\\': 'W', '_': 'Z'
};

const COMMON_REPAIR_MAP: Record<string, string> = {
  IMYASAL: 'KİMYASAL', KIMYASAL: 'KİMYASAL', NEDENIYLE: 'NEDENİYLE',
  GÜVENLI: 'GÜVENLİ', GUVENLI: 'GÜVENLİ', BIR: 'BİR', SEKILDE: 'ŞEKİLDE',
  ŞEKILDE: 'ŞEKİLDE', URUNLERIN: 'ÜRÜNLERİN', ÜRÜNLERIN: 'ÜRÜNLERİN',
  SAGLAMASI: 'SAĞLAMASI', SAĞLAMASI: 'SAĞLAMASI', SAKLANMASINI: 'SAKLANMASINI',
  MADDELERE: 'MADDELERE', DAYANIKLI: 'DAYANIKLI', OLMASI: 'OLMASI', KARŞI: 'KARŞI'
};

const SHIFTED_INDICATOR = /[\^\[\]\\_¾ġóá½þýð]|[QWXqwx]|[jJ]{2}|(?:[A-Z]{2,}[J][A-Z]*)|(?:[A-Z]*[J][A-Z]{2,})/;

function isShifted(text: string): boolean {
  if (!text) return false;
  return SHIFTED_INDICATOR.test(text) || /\b[F-Jf-j][\.\)\-\:]\s+/.test(text);
}

function descrambleWord(word: string, shift = 5): string {
  if (!word) return '';
  let res = '';
  for (let i = 0; i < word.length; i++) {
    const c = word[i];
    const code = word.charCodeAt(i);
    if (SPECIAL_GLYPHS[c]) { res += SPECIAL_GLYPHS[c]; continue; }
    if (code >= 65 && code <= (90 + shift)) {
      const shifted = code - shift;
      if (shifted >= 65 && shifted <= 90) { res += String.fromCharCode(shifted); continue; }
    }
    if (code >= 97 && code <= (122 + shift)) {
      const shifted = code - shift;
      if (shifted >= 97 && shifted <= 122) { res += String.fromCharCode(shifted); continue; }
    }
    res += c;
  }
  return COMMON_REPAIR_MAP[res] || res;
}

function cleanAndDescramblePdfText(rawText: string): string {
  if (!rawText) return '';
  const rawLines = rawText.split('\n');
  let totalShifted = 0;
  for (const line of rawLines) {
    if (isShifted(line)) totalShifted++;
  }
  const isDocShifted = totalShifted >= 2 || (totalShifted > 0 && totalShifted / Math.max(1, rawLines.length) > 0.15);

  return rawLines.map((line) => {
    let processed = line.replace(/^([F-Jf-j])([\.\)\-\:])/g, (m, opt, sep) => {
      return String.fromCharCode(opt.toUpperCase().charCodeAt(0) - 5) + sep;
    });
    processed = processed.replace(/(\s+)([F-Jf-j])([\.\)\-\:])(\s+)/g, (m, sp1, opt, sep, sp2) => {
      return sp1 + String.fromCharCode(opt.toUpperCase().charCodeAt(0) - 5) + sep + sp2;
    });
    const lineShifted = isShifted(processed) || (isDocShifted && !/^(?:T\.C\.|MİLLİ|BAKANLIĞI|SINAV|SAYFA|PAGE|\d+)/i.test(processed.trim()));
    if (lineShifted) {
      return processed.replace(/[^\s]+/g, (token) => {
        if (/^[\d\.,\(\)\-\:\;\?\!\%\/]+$/.test(token)) return token;
        return descrambleWord(token, 5);
      });
    }
    return processed;
  }).join('\n');
}

function autoRepairText(str: string): string {
  if (!str) return '';
  if (isShifted(str)) {
    return cleanAndDescramblePdfText(str);
  }
  return str;
}

/**
 * Free rule-based text/JSON parser used as offline / free alternative
 * when no Gemini API key is configured.
 */
function parseTextExamLocally(rawContent: string, fileName?: string) {
  const content = cleanAndDescramblePdfText(rawContent).trim();
  const defaultTitle = fileName ? fileName.replace(/\.[^/.]+$/, '') : 'Yeni Sınav';

  // 1. JSON check
  if (content.startsWith('{') || content.startsWith('[')) {
    try {
      const parsed = JSON.parse(content);
      const title = parsed.title || defaultTitle;
      const rawQuestions = Array.isArray(parsed) ? parsed : (parsed.questions || []);

      if (Array.isArray(rawQuestions) && rawQuestions.length > 0) {
        const questions = rawQuestions.map((q: any, idx: number) => ({
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
          detectedAnswerKeyRawContent: parsed.detectedAnswerKeyRawContent || 'JSON formatından yerel olarak okundu'
        };
      }
    } catch {
      // not valid JSON
    }
  }

  // 2. Plain text / Markdown
  let detectedAnswerKeyRawContent: string | null = null;
  const answerKeyMap: Record<number, string> = {};

  const keyMatch = content.match(/(?:cevap\s*anahtar[ıi]|yan[ıi]tlar|answer\s*key)[\s:]*([\s\S]+?)(?=$|\n\s*\n\s*\n)/i);
  if (keyMatch) {
    detectedAnswerKeyRawContent = keyMatch[0].trim();
    const keyPairs = keyMatch[1].matchAll(/(\d+)[\s\.\-\):]+([A-Ea-e])/g);
    for (const kp of keyPairs) {
      answerKeyMap[parseInt(kp[1], 10)] = kp[2].toUpperCase();
    }
  }

  let bodyWithoutKey = content;
  if (keyMatch && keyMatch.index !== undefined) {
    bodyWithoutKey = content.slice(0, keyMatch.index) + content.slice(keyMatch.index + keyMatch[0].length);
  }

  const questionBlocks = bodyWithoutKey.split(/(?:^|\n)(?=(?:Soru\s*)?\d+[\.\)\-:]\s+)/i);
  const questions: any[] = [];

  for (const block of questionBlocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    const headerMatch = trimmed.match(/^(?:Soru\s*)?(\d+)[\.\)\-:]\s*([\s\S]+)$/i);
    if (!headerMatch) continue;

    const questionNumber = parseInt(headerMatch[1], 10);
    const fullContent = headerMatch[2].trim();

    const optionMatches = [
      ...fullContent.matchAll(/(?:^|\n)\s*([A-Ea-e])[\.\)\-\:]\s*([^\n]+(?:\n(?!\s*[A-Ea-e][\.\)\-\:]|\s*(?:Cevap|Yanıt|Doğru)) [^\n]+)*)/g)
    ];

    let questionText = fullContent;
    const options: { label: string; text: string }[] = [];

    if (optionMatches.length > 0) {
      questionText = fullContent.substring(0, optionMatches[0].index ?? 0).trim();
      for (const m of optionMatches) {
        let optText = m[2].trim().replace(/(?:Cevap|Yanıt|Doğru)[\s:]*[A-Ea-e].*$/i, '').trim();
        options.push({ label: m[1].toUpperCase(), text: optText });
      }
    }

    let correctAnswerLabel: string | null = answerKeyMap[questionNumber] || null;
    if (!correctAnswerLabel) {
      const inlineKeyMatch = trimmed.match(/(?:Doğru\s*Cevap|Cevap|Yanıt)[\s:]*([A-Ea-e])/i);
      if (inlineKeyMatch) {
        correctAnswerLabel = inlineKeyMatch[1].toUpperCase();
      }
    }

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

async function parseExamWithGemini(input: { data: string; mimeType: string; fileName?: string }) {
  let { data, mimeType, fileName } = input;
  const isText = mimeType.startsWith('text/') || mimeType === 'application/json';

  if (isText && data) {
    data = cleanAndDescramblePdfText(data);
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    // If text file, try local parser fallback
    if (isText) {
      const localResult = parseTextExamLocally(data, fileName);
      if (localResult.questions.length > 0) {
        return localResult;
      }
    }

    const missingKeyError: any = new Error(
      'Vercel üzerinde GEMINI_API_KEY ortam değişkeni bulunamadı. PDF veya resim gibi sınav belgelerinin okunması için Google AI Studio üzerinden tamamen ÜCRETSİZ bir API anahtarı alıp Vercel Dashboard > Project Settings > Environment Variables bölümüne GEMINI_API_KEY olarak ekleyiniz.'
    );
    missingKeyError.code = 'MISSING_GEMINI_API_KEY';
    throw missingKeyError;
  }

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build'
      }
    }
  });

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
    const models = ['gemini-2.5-flash', 'gemini-2.0-flash'];
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
        console.warn(`Model ${model} uyarısı:`, errStr.slice(0, 100));

        if (errStr.includes('API key not valid') || errStr.includes('INVALID_ARGUMENT')) {
          throw new Error('Eklenen GEMINI_API_KEY anahtarı geçerli değil. Lütfen Google AI Studio üzerinden geçerli bir API anahtarı ekleyiniz.');
        }

        const isTransient =
          errStr.includes('503') || errStr.includes('UNAVAILABLE') || errStr.includes('high demand') || errStr.includes('429');
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
    // If text file and model failed, try local parser fallback
    if (isText && data) {
      const fallback = parseTextExamLocally(data, fileName);
      if (fallback.questions.length > 0) {
        return fallback;
      }
    }

    let errorMessage = err?.message || 'Yapay zeka modeliyle iletişim kurulurken bir hata oluştu.';
    try {
      const parsed = JSON.parse(errorMessage);
      if (parsed?.error?.message) {
        if (parsed.error.code === 400 && String(parsed.error.message).includes('API key not valid')) {
          errorMessage = 'Eklenen GEMINI_API_KEY geçerli değil. Lütfen Google AI Studio üzerinden aldığınız geçerli anahtarı ekleyiniz.';
        } else if (parsed.error.code === 429 || parsed.error.status === 'RESOURCE_EXHAUSTED') {
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
    text: autoRepairText(q.text || 'Soru metni okunamadı'),
    options: Array.isArray(q.options)
      ? q.options.map((opt: any) => ({
          label: String(opt.label || '').trim().toUpperCase(),
          text: autoRepairText(String(opt.text || '').trim())
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
    const isMissingKey = err?.code === 'MISSING_GEMINI_API_KEY' || String(err?.message).includes('GEMINI_API_KEY');
    return res.status(isMissingKey ? 400 : 500).json({
      error: err?.message || 'Sınav dosyası işlenirken bir sunucu hatası oluştu.',
      code: err?.code || (isMissingKey ? 'MISSING_GEMINI_API_KEY' : 'SERVER_ERROR')
    });
  }
}
