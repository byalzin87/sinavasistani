import * as pdfjsLib from 'pdfjs-dist';

// Configure worker using CDN fallback
if (typeof window !== 'undefined') {
  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
  } catch (err) {
    console.warn('PDF.js worker initialization warning:', err);
  }
}

/**
 * Extracts plain text from an uploaded PDF file directly in the browser.
 * Works completely offline without needing any AI server or API key!
 * Protected with a timeout to prevent UI freezes.
 */
export async function extractTextFromPdf(file: File): Promise<string> {
  const timeoutPromise = new Promise<string>((resolve) => {
    setTimeout(() => resolve(''), 10000);
  });

  const extractionPromise = (async () => {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const loadingTask = pdfjsLib.getDocument({
        data: new Uint8Array(arrayBuffer),
        useSystemFonts: true
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

      return pageTexts.join('\n\n');
    } catch (error) {
      console.error('Failed to extract text from PDF locally:', error);
      return '';
    }
  })();

  return Promise.race([extractionPromise, timeoutPromise]);
}
