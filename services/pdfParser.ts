import * as pdfjsLib from 'pdfjs-dist';
// @ts-ignore
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { cleanAndDescramblePdfText, preValidateAndSanitizeLines } from './textDescrambler';

// Configure worker using local bundled asset
if (typeof window !== 'undefined') {
  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
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
 * Checks if a collection of text items at the bottom of the page forms an answer key table.
 * Requires at least 5 sequential question numbers or an explicit header to avoid false positives.
 */
function extractBottomAnswerKeyTable(items: TextItemInfo[], pageHeight: number): {
  answerKeyItems: TextItemInfo[];
  bodyItems: TextItemInfo[];
  formattedAnswerKeyText: string | null;
} {
  if (items.length < 6) {
    return { answerKeyItems: [], bodyItems: items, formattedAnswerKeyText: null };
  }

  // Cluster items by Y coordinate
  const yTolerance = 4.0;
  const yClusters: { y: number; items: TextItemInfo[] }[] = [];

  for (const it of items) {
    let matched = yClusters.find((c) => Math.abs(it.y - c.y) <= yTolerance);
    if (matched) {
      matched.items.push(it);
      matched.y = (matched.y * (matched.items.length - 1) + it.y) / matched.items.length;
    } else {
      yClusters.push({ y: it.y, items: [it] });
    }
  }

  yClusters.sort((a, b) => b.y - a.y);

  // Look for adjacent pairs of lines where top line has numbers (1, 2, 3...) and bottom line has letters (A, B, C...)
  for (let i = 0; i < yClusters.length - 1; i++) {
    const numCluster = yClusters[i];
    const letterCluster = yClusters[i + 1];

    if (numCluster.y - letterCluster.y > 28 || numCluster.y - letterCluster.y < 6) continue;

    numCluster.items.sort((a, b) => a.x - b.x);
    letterCluster.items.sort((a, b) => a.x - b.x);

    const numTokens: { num: number; x: number }[] = [];
    for (const it of numCluster.items) {
      const parts = it.str.trim().split(/\s+/);
      for (const p of parts) {
        const val = parseInt(p, 10);
        if (!isNaN(val) && val >= 1 && val <= 100) {
          numTokens.push({ num: val, x: it.x });
        }
      }
    }

    const letterTokens: { letter: string; x: number }[] = [];
    for (const it of letterCluster.items) {
      const parts = it.str.trim().toUpperCase().split(/\s+/);
      for (const p of parts) {
        if (/^[A-E]$/.test(p)) {
          letterTokens.push({ letter: p, x: it.x });
        }
      }
    }

    // Must have at least 5 matched pairs or sequential numbers (1, 2, 3, 4, 5...)
    if (numTokens.length >= 5 && letterTokens.length >= 5) {
      numTokens.sort((a, b) => a.x - b.x);
      letterTokens.sort((a, b) => a.x - b.x);

      // Check for sequential ordering
      let isSequential = true;
      for (let s = 1; s < Math.min(5, numTokens.length); s++) {
        if (numTokens[s].num !== numTokens[s - 1].num + 1) {
          isSequential = false;
          break;
        }
      }

      if (isSequential) {
        const answerPairs: string[] = [];
        const count = Math.min(numTokens.length, letterTokens.length);
        for (let p = 0; p < count; p++) {
          answerPairs.push(`${numTokens[p].num}-${letterTokens[p].letter}`);
        }

        const answerKeyItems = [...numCluster.items, ...letterCluster.items];
        const answerKeySet = new Set(answerKeyItems);
        const bodyItems = items.filter((it) => !answerKeySet.has(it));

        return {
          answerKeyItems,
          bodyItems,
          formattedAnswerKeyText: `CEVAP ANAHTARI: ${answerPairs.join('  ')}`
        };
      }
    }
  }

  return { answerKeyItems: [], bodyItems: items, formattedAnswerKeyText: null };
}

/**
 * Detects whether a page has a 2-column question layout.
 * Enforces dividerX to remain strictly in the center gutter [0.47, 0.53] * pageWidth,
 * preventing column slicing of question stems and options.
 */
function detectTwoColumnLayout(items: TextItemInfo[], pageWidth: number): {
  isTwoColumn: boolean;
  dividerX: number;
} {
  if (items.length < 10) {
    return { isTwoColumn: false, dividerX: pageWidth / 2 };
  }

  // 1. Look for real question number markers (e.g. "10.", "11.", "12." or "Soru 10") in the right column
  // Strictly between 0.46 * pageWidth and 0.62 * pageWidth.
  // Never use option markers (A, B, C) because options in column 1 can wrap or be indented!
  const rightColumnStarts: number[] = [];
  const questionNumberRegex = /^(?:(?:Soru|SORU)\s*)?\(?\d{1,3}\)?[\.\)\-:]/i;

  for (const it of items) {
    const trimmed = it.str.trim();
    if (it.x >= pageWidth * 0.46 && it.x <= pageWidth * 0.62) {
      if (questionNumberRegex.test(trimmed)) {
        rightColumnStarts.push(it.x);
      }
    }
  }

  if (rightColumnStarts.length >= 2) {
    rightColumnStarts.sort((a, b) => a - b);
    const col2StartX = rightColumnStarts[0];
    const dividerX = Math.max(pageWidth * 0.46, Math.min(pageWidth * 0.54, col2StartX - 10));
    return { isTwoColumn: true, dividerX };
  }

  // 2. Center gutter / histogram check
  const leftCount = items.filter((it) => it.x < pageWidth * 0.45).length;
  const rightCount = items.filter((it) => it.x > pageWidth * 0.55).length;
  const gutterCount = items.filter((it) => it.x >= pageWidth * 0.47 && it.x <= pageWidth * 0.53).length;

  if (leftCount >= 10 && rightCount >= 10 && gutterCount <= 3) {
    return { isTwoColumn: true, dividerX: pageWidth / 2 };
  }

  return { isTwoColumn: false, dividerX: pageWidth / 2 };
}

/**
 * Groups and formats positioned text items into clean, reading-order lines.
 * Guarantees spaces between words, avoids concatenating adjacent items,
 * and preserves exact single-space justified text while supporting inline choices.
 */
function formatItemsIntoLines(items: TextItemInfo[]): string[] {
  if (items.length === 0) return [];

  const yTolerance = 3.5;
  const lineClusters: { y: number; items: TextItemInfo[] }[] = [];
  const sorted = [...items].sort((a, b) => b.y - a.y);

  for (const item of sorted) {
    let matchedCluster: { y: number; items: TextItemInfo[] } | null = null;
    for (const cluster of lineClusters) {
      if (Math.abs(item.y - cluster.y) <= yTolerance) {
        matchedCluster = cluster;
        break;
      }
    }

    if (matchedCluster) {
      matchedCluster.items.push(item);
      // Keep baseline stable without drifting downwards into the next line
    } else {
      lineClusters.push({ y: item.y, items: [item] });
    }
  }

  lineClusters.sort((a, b) => b.y - a.y);

  const lines: string[] = [];
  let prevClusterY: number | null = null;

  for (const cluster of lineClusters) {
    cluster.items.sort((a, b) => a.x - b.x);

    let lineStr = '';
    let prevItem: TextItemInfo | null = null;

    for (const item of cluster.items) {
      const text = item.str;
      if (!text) continue;

      if (prevItem !== null) {
        const prevEnd = prevItem.x + (prevItem.width > 0 ? prevItem.width : prevItem.str.length * 5.2);
        const gap = item.x - prevEnd;

        if (gap > 24 && /^\(?[A-Ea-e][\)\.\-:]/.test(text.trim())) {
          // Inline choices gap (e.g. A) ...   B) ...)
          lineStr += '   ' + text;
        } else if (
          gap >= 1.8 &&
          !lineStr.endsWith(' ') &&
          !text.startsWith(' ') &&
          !/^[\,\.\:\;\?\!\)\]\}\–\-]/.test(text) &&
          !/[\(\[\{\–\-]$/.test(lineStr)
        ) {
          // Standard single word spacing (prevents triple spaces in justified text like 'olarak kullanılan')
          lineStr += ' ' + text;
        } else {
          lineStr += text;
        }
      } else {
        lineStr += text;
      }

      prevItem = item;
    }

    const trimmedLine = lineStr.trim();
    if (trimmedLine) {
      if (prevClusterY !== null && prevClusterY - cluster.y > 18) {
        lines.push('');
      }
      lines.push(trimmedLine);
      prevClusterY = cluster.y;
    }
  }

  return lines;
}

/**
 * Extracts plain text from an uploaded PDF file directly in the browser.
 * Features:
 * - Local CMap & Standard Font resolution (fixes Turkish font glyph decoding).
 * - Automatic filtering of top headers (y > pageHeight - 55), footers (y < 35), and watermarks.
 * - Robust 2-Column layout parsing: Column 1 reads top-to-bottom, then Column 2 reads top-to-bottom.
 * - Accurate word spacing: prevents words from gluing together.
 * - Support for 20+ questions per page across multiple pages.
 */
export async function extractTextFromPdf(file: File): Promise<PdfTextExtractionResult> {
  const timeoutPromise = new Promise<PdfTextExtractionResult>((resolve) => {
    setTimeout(() => resolve({ text: '', isClean: false }), 25000);
  });

  const extractionPromise = (async (): Promise<PdfTextExtractionResult> => {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const baseUrl = ((import.meta as any)?.env?.BASE_URL as string) || '/';
      const normalizedBase = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';

      const loadingTask = pdfjsLib.getDocument({
        data: new Uint8Array(arrayBuffer),
        useSystemFonts: true,
        cMapUrl: `${normalizedBase}cmaps/`,
        cMapPacked: true,
        standardFontDataUrl: `${normalizedBase}standard_fonts/`
      });

      const pdf = await loadingTask.promise;
      const allPagesLines: string[] = [];
      const collectedAnswerKeys: string[] = [];

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

        // Filter out watermarks, rotated text, edge bleed, and header/footer regions
        const cleanItems: TextItemInfo[] = [];

        for (const item of rawItems) {
          const transform = item.transform || [1, 0, 0, 1, 0, 0];
          const x = transform[4] || 0;
          const y = transform[5] || 0;
          const width = item.width || 0;
          const height = item.height || 0;

          // 1. Watermark filter: ignore rotated or diagonal text (angle != 0)
          const isRotated = Math.abs(transform[1]) > 0.05 || Math.abs(transform[2]) > 0.05;
          if (isRotated) continue;

          // 2. Watermark filter: ignore unusually giant text spanning across the page
          if (height > 32 || (width > pageWidth * 0.75 && item.str.length < 35)) {
            continue;
          }

          // 3. Top Header filter: exclude top 48pt
          if (y >= pageHeight - 48) {
            continue;
          }

          // 4. Bottom Footer filter: exclude bottom 50pt (copyright and page numbers)
          if (y <= 50) {
            continue;
          }

          // 5. Margin bleed filter: ignore side-margin text (e.g. system disclaimers at x < 50)
          if ((x < 50 && item.str.length > 3 && !/^\(?\d{1,3}\)?[\.\)\-:]/.test(item.str.trim())) || x > pageWidth - 15) {
            continue;
          }

          cleanItems.push({
            str: item.str,
            x,
            y,
            width,
            height
          });
        }

        if (cleanItems.length === 0) continue;

        // 6. Check for tabular answer key table on this page
        const { bodyItems, formattedAnswerKeyText } = extractBottomAnswerKeyTable(cleanItems, pageHeight);
        if (formattedAnswerKeyText) {
          collectedAnswerKeys.push(formattedAnswerKeyText);
        }

        const itemsToProcess = bodyItems.length > 0 ? bodyItems : cleanItems;

        // 7. Check for 2-column layout
        const { isTwoColumn, dividerX } = detectTwoColumnLayout(itemsToProcess, pageWidth);

        let pageLines: string[] = [];

        if (isTwoColumn) {
          // Check for natural stream jump from Column 1 to Column 2
          let streamSplitIdx = -1;
          for (let i = 1; i < itemsToProcess.length; i++) {
            const prev = itemsToProcess[i - 1];
            const cur = itemsToProcess[i];
            if (cur.y > prev.y + 120 && cur.x >= dividerX - 25) {
              streamSplitIdx = i;
              break;
            }
          }

          let col1Items: TextItemInfo[];
          let col2Items: TextItemInfo[];

          if (streamSplitIdx !== -1) {
            col1Items = itemsToProcess.slice(0, streamSplitIdx);
            col2Items = itemsToProcess.slice(streamSplitIdx);
          } else {
            // Coordinate fallback: lines starting at x < dividerX remain in Column 1
            col1Items = itemsToProcess.filter((it) => it.x < dividerX);
            col2Items = itemsToProcess.filter((it) => it.x >= dividerX);
          }

          const col1Lines = formatItemsIntoLines(col1Items);
          const col2Lines = formatItemsIntoLines(col2Items);

          pageLines = [
            ...col1Lines,
            ...(col1Lines.length > 0 && col2Lines.length > 0 ? [''] : []),
            ...col2Lines
          ];
        } else {
          // Single column layout
          pageLines = formatItemsIntoLines(itemsToProcess);
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

      // Append detected tabular answer keys at the very end
      if (collectedAnswerKeys.length > 0) {
        allPagesLines.push('\n' + collectedAnswerKeys.join('\n'));
      }

      const rawCombined = allPagesLines.join('\n\n');

      // Pre-validate and sanitize inconsistent lines
      const sanitized = preValidateAndSanitizeLines(rawCombined);

      // Run intelligent descrambler
      const descrambled = cleanAndDescramblePdfText(sanitized);

      return descrambled;
    } catch (error) {
      console.error('Failed to extract text from PDF locally:', error);
      return { text: '', isClean: false };
    }
  })();

  return Promise.race([extractionPromise, timeoutPromise]);
}
