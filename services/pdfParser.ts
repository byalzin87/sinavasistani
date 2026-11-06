import * as pdfjsLib from 'pdfjs-dist';
// @ts-ignore
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { cleanAndDescramblePdfText } from './textDescrambler';

// Configure worker using local bundled asset with CDN fallback
if (typeof window !== 'undefined') {
  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      pdfWorkerUrl || `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
  } catch (err) {
    console.warn('PDF.js worker initialization warning:', err);
  }
}

export interface PdfTextExtractionResult {
  text: string;
  isClean: boolean;
  shiftApplied?: number;
}

interface TextItemInfo {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Groups and formats positioned text items into clean, reading-order lines.
 * Handles item spacing and vertical gaps.
 */
function formatItemsIntoLines(items: TextItemInfo[]): string[] {
  if (items.length === 0) return [];

  // Sort items: Primary sort by Y descending (top to bottom).
  // Items within 4px vertical distance are considered on the same line.
  // Secondary sort on same line: X ascending (left to right).
  items.sort((a, b) => {
    const yDiff = b.y - a.y;
    if (Math.abs(yDiff) > 4) {
      return yDiff;
    }
    return a.x - b.x;
  });

  const lines: string[] = [];
  let currentLineItems: TextItemInfo[] = [];
  let currentLineY: number | null = null;

  const flushLine = () => {
    if (currentLineItems.length === 0) return;
    // Sort horizontally just in case
    currentLineItems.sort((a, b) => a.x - b.x);

    let lineStr = '';
    let prevEndX: number | null = null;

    for (const item of currentLineItems) {
      const text = item.str;
      if (!text) continue;

      if (prevEndX !== null) {
        const gap = item.x - prevEndX;
        if (gap > 22) {
          // Significant horizontal gap (e.g. between inline choices: A) ...    B) ...)
          lineStr += '   ' + text;
        } else if (gap > 2 && !lineStr.endsWith(' ') && !text.startsWith(' ')) {
          lineStr += ' ' + text;
        } else {
          lineStr += text;
        }
      } else {
        lineStr += text;
      }

      prevEndX = item.x + Math.max(item.width, text.length * 5);
    }

    if (lineStr.trim()) {
      lines.push(lineStr.trim());
    }
    currentLineItems = [];
  };

  let lastFlushedY: number | null = null;

  for (const item of items) {
    if (currentLineY === null || Math.abs(item.y - currentLineY) > 4) {
      if (currentLineY !== null) {
        lastFlushedY = currentLineY;
      }
      flushLine();
      // If there's a large vertical gap (> 16px) between lines, add an empty line separator
      if (lastFlushedY !== null && lastFlushedY - item.y > 16) {
        lines.push('');
      }
      currentLineY = item.y;
    }
    currentLineItems.push(item);
  }
  flushLine();

  return lines;
}

/**
 * Extracts plain text from an uploaded PDF file directly in the browser.
 * Fully column-aware: detects two-column exam layouts to prevent interleaved questions.
 * Handles 2D visual layout sorting, Turkish character glyphs, and Caesar subset fonts.
 */
export async function extractTextFromPdf(file: File): Promise<PdfTextExtractionResult> {
  const timeoutPromise = new Promise<PdfTextExtractionResult>((resolve) => {
    setTimeout(() => resolve({ text: '', isClean: false }), 15000);
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
      const allPagesLines: string[] = [];

      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale: 1.0 });
        const pageWidth = viewport.width;
        const pageHeight = viewport.height;

        const textContent = await page.getTextContent();
        const rawItems = (textContent.items as any[]).filter(
          (item: any) => item && typeof item.str === 'string' && item.str.trim()
        );

        if (rawItems.length === 0) continue;

        const textItems: TextItemInfo[] = rawItems.map((item: any) => ({
          str: item.str,
          x: item.transform ? item.transform[4] : 0,
          y: item.transform ? item.transform[5] : 0,
          width: item.width || 0,
          height: item.height || 0
        }));

        // Determine if page has a 2-column layout
        // Check items in middle body (excluding top header and bottom footer)
        const bodyItems = textItems.filter(
          (it) => it.y < pageHeight - 50 && it.y > 45
        );

        const dividerX = pageWidth / 2;
        const leftItems = bodyItems.filter((it) => it.x < dividerX - 15);
        const rightItems = bodyItems.filter((it) => it.x > dividerX + 15);

        const isTwoColumn =
          pageWidth > 450 &&
          leftItems.length >= 6 &&
          rightItems.length >= 6;

        let pageLines: string[] = [];

        if (isTwoColumn) {
          // 1. Top header items spanning across the page (y >= pageHeight - 50)
          const headerItems = textItems.filter((it) => it.y >= pageHeight - 50);
          // 2. Left column items (y between 45 and pageHeight - 50, x < dividerX)
          const col1Items = textItems.filter(
            (it) => it.y < pageHeight - 50 && it.y >= 45 && it.x < dividerX
          );
          // 3. Right column items (y between 45 and pageHeight - 50, x >= dividerX)
          const col2Items = textItems.filter(
            (it) => it.y < pageHeight - 50 && it.y >= 45 && it.x >= dividerX
          );
          // 4. Bottom footer items (y < 45)
          const footerItems = textItems.filter((it) => it.y < 45);

          const headerLines = formatItemsIntoLines(headerItems);
          const col1Lines = formatItemsIntoLines(col1Items);
          const col2Lines = formatItemsIntoLines(col2Items);
          const footerLines = formatItemsIntoLines(footerItems);

          pageLines = [
            ...headerLines,
            ...(headerLines.length > 0 && col1Lines.length > 0 ? [''] : []),
            ...col1Lines,
            ...(col1Lines.length > 0 && col2Lines.length > 0 ? ['', '--- Sütun 2 ---', ''] : []),
            ...col2Lines,
            ...(col2Lines.length > 0 && footerLines.length > 0 ? [''] : []),
            ...footerLines
          ];
        } else {
          // Single column layout
          pageLines = formatItemsIntoLines(textItems);
        }

        // Fix line-ending hyphenated words (e.g. "aşağıda- \n kilerden" -> "aşağıdakilerden")
        const mergedLines: string[] = [];
        for (let i = 0; i < pageLines.length; i++) {
          let line = pageLines[i];
          if (line.endsWith('-') && i + 1 < pageLines.length && pageLines[i + 1].trim()) {
            const nextLine = pageLines[i + 1].trim();
            const firstNextWord = nextLine.split(/\s+/)[0];
            const restOfNext = nextLine.slice(firstNextWord.length).trim();
            line = line.slice(0, -1) + firstNextWord;
            pageLines[i + 1] = restOfNext;
          }
          if (line.trim() || (mergedLines.length > 0 && mergedLines[mergedLines.length - 1] !== '')) {
            mergedLines.push(line);
          }
        }

        allPagesLines.push(mergedLines.join('\n'));
      }

      const rawCombined = allPagesLines.join('\n\n');

      // Run intelligent descrambler to fix Caesar-shifted subset fonts and Turkish encoding anomalies
      const descrambled = cleanAndDescramblePdfText(rawCombined);

      return descrambled;
    } catch (error) {
      console.error('Failed to extract text from PDF locally:', error);
      return { text: '', isClean: false };
    }
  })();

  return Promise.race([extractionPromise, timeoutPromise]);
}
