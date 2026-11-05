import * as pdfjsLib from 'pdfjs-dist';
import { cleanAndDescramblePdfText } from './textDescrambler';

// Configure worker using CDN fallback
if (typeof window !== 'undefined') {
  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
  } catch (err) {
    console.warn('PDF.js worker initialization warning:', err);
  }
}

export interface PdfTextExtractionResult {
  text: string;
  isClean: boolean;
  shiftApplied?: number;
}

/**
 * Extracts plain text from an uploaded PDF file directly in the browser.
 * Configured with CMap fonts and automatic font encoding descrambler.
 * Protected with a timeout to prevent UI freezes.
 */
export async function extractTextFromPdf(file: File): Promise<PdfTextExtractionResult> {
  const timeoutPromise = new Promise<PdfTextExtractionResult>((resolve) => {
    setTimeout(() => resolve({ text: '', isClean: false }), 10000);
  });

  const extractionPromise = (async (): Promise<PdfTextExtractionResult> => {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const loadingTask = pdfjsLib.getDocument({
        data: new Uint8Array(arrayBuffer),
        useSystemFonts: true,
        cMapUrl: `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/cmaps/`,
        cMapPacked: true,
        standardFontDataUrl: `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/standard_fonts/`
      });

      const pdf = await loadingTask.promise;
      const pageTexts: string[] = [];

      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const textContent = await page.getTextContent();

        const items = (textContent.items as any[]).filter(
          (item: any) => item && typeof item.str === 'string' && item.str.trim()
        );

        let lastY: number | null = null;
        let pageLines: string[] = [];
        let currentLine = '';

        for (const item of items) {
          const itemY = item.transform ? Math.round(item.transform[5]) : 0;
          if (lastY === null || Math.abs(itemY - lastY) > 5) {
            if (currentLine.trim()) {
              pageLines.push(currentLine.trim());
            }
            currentLine = item.str;
            lastY = itemY;
          } else {
            currentLine += (currentLine.endsWith(' ') || item.str.startsWith(' ') ? '' : ' ') + item.str;
          }
        }
        if (currentLine.trim()) {
          pageLines.push(currentLine.trim());
        }

        pageTexts.push(pageLines.join('\n'));
      }

      const rawCombined = pageTexts.join('\n\n');

      // Run intelligent descrambler to fix Caesar-shifted subset fonts and custom encodings
      const descrambled = cleanAndDescramblePdfText(rawCombined);

      return descrambled;
    } catch (error) {
      console.error('Failed to extract text from PDF locally:', error);
      return { text: '', isClean: false };
    }
  })();

  return Promise.race([extractionPromise, timeoutPromise]);
}
