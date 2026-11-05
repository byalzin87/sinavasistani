# Sınav Asistanı

Sınavlara hazırlanmak için yapay zeka destekli soru-cevap ve deneme yönetimi uygulaması. PDF, resim (PNG, JPG), metin (.txt) veya JSON formatındaki sınav belgelerini otomatik olarak okuyup dijital soru kitapçığına dönüştürür.

---

## 🚀 Vercel Dağıtımı ve Ortam Değişkenleri Kurulumu

GitHub üzerinden Vercel'e dağıtım yapıldığında, PDF ve görsel dosyaların yapay zeka ile taranabilmesi için Google Gemini API anahtarı eklenmelidir.

### 1. Ücretsiz Gemini API Anahtarı Alma (0 TL - Kredi Kartsız)
1. [Google AI Studio (aistudio.google.com/apikey)](https://aistudio.google.com/apikey) adresini açın.
2. Google hesabınızla giriş yapın.
3. **"Create API Key"** butonuna basarak yeni bir anahtar üretin ve kopyalayın. *(Tamamen ücretsizdir, faturalandırma veya kredi kartı gerekmez).*

### 2. Vercel'e Ortam Değişkenini Ekleme
1. [Vercel Dashboard](https://vercel.com/dashboard) üzerinde projenizi açın.
2. **Settings** > **Environment Variables** sekmesine gidin.
3. Aşağıdaki değişkeni ekleyin:
   - **Key**: `GEMINI_API_KEY`
   - **Value**: Google AI Studio'dan aldığınız anahtar
4. **Save** butonuna tıklayın.
5. **Deployments** sekmesine geçip aktif dağıtımınızın yanındaki `...` menüsünden **Redeploy** seçeneğine tıklayın.

---

## 💡 Ücretsiz Alternatif: API Anahtarsız Kullanım (.txt / .json)

API anahtarı kullanmak istemiyorsanız veya kotanız bittiyse:
- Sınav sorularınızı Not Defteri ile `.txt` dosyasına kaydedin.
- Örnek Format:
```txt
1. Türkiye'nin başkenti neresidir?
A) İstanbul
B) Ankara
C) İzmir
D) Bursa
Cevap: B

2. Aşağıdakilerden hangisi bir asal sayıdır?
A) 4
B) 6
C) 7
D) 9
Cevap: C

Cevap Anahtarı:
1-B, 2-C
```
- Bu `.txt` dosyasını doğrudan uygulamaya yüklediğinizde, yerel ayrıştırıcı motoru devreye girer ve **hiçbir API anahtarına ihtiyaç duymadan** sorularınızı hemen hazır hale getirir.
