import JSZip from 'jszip';

export const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const result = reader.result as string || '';
      const commaIndex = result.indexOf(',');
      let encoded = commaIndex !== -1 ? result.substring(commaIndex + 1) : result;
      // Ensure proper base64 padding
      const remainder = encoded.length % 4;
      if (remainder > 0) {
        encoded += '='.repeat(4 - remainder);
      }
      resolve(encoded);
    };
    reader.onerror = (error) => reject(error);
  });
};

/**
 * Reads text files (txt, md, csv, html, json) with multi-encoding support (UTF-8, Windows-1254).
 */
export const fileToText = async (file: File): Promise<string> => {
  try {
    const buffer = await file.arrayBuffer();
    // Standard UTF-8 decoding
    const utf8Decoder = new TextDecoder('utf-8', { fatal: false });
    let text = utf8Decoder.decode(buffer);

    // If replacement character is present, attempt Windows-1254 (Turkish ANSI)
    if (text.includes('\uFFFD')) {
      try {
        const winDecoder = new TextDecoder('windows-1254', { fatal: false });
        const winText = winDecoder.decode(buffer);
        if (!winText.includes('\uFFFD')) {
          text = winText;
        }
      } catch {
        // fallback to utf8
      }
    }

    // Strip UTF-8 BOM if present
    if (text.charCodeAt(0) === 0xFEFF) {
      text = text.slice(1);
    }

    return text;
  } catch (err) {
    console.warn('fileToText buffer decoding fallback to FileReader:', err);
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsText(file, 'UTF-8');
      reader.onload = () => resolve(reader.result as string || '');
      reader.onerror = (error) => reject(error);
    });
  }
};

/**
 * Extracts pure text from Microsoft Word (.docx) files.
 * Word documents are ZIP archives containing XML in `word/document.xml`.
 * Extracts paragraphs, run text, tabs, and tables.
 */
export const extractTextFromDocx = async (file: File): Promise<string> => {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);

    // Find the main document file
    const docXmlFile = zip.file('word/document.xml');
    if (!docXmlFile) {
      throw new Error('Word belgesi geçersiz veya bozuk (word/document.xml bulunamadı).');
    }

    const xmlContent = await docXmlFile.async('text');
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlContent, 'application/xml');

    // Extract text paragraph by paragraph and row by row
    const lines: string[] = [];

    // Traverse body child elements (paragraphs w:p and tables w:tbl)
    const body = xmlDoc.getElementsByTagName('w:body')[0];
    if (!body) {
      return '';
    }

    const walkNode = (node: Element) => {
      if (node.nodeName === 'w:p') {
        let pText = '';
        const textNodes = node.querySelectorAll('w\\:t, t, w\\:tab, tab, w\\:br, br');
        textNodes.forEach((tn) => {
          if (tn.nodeName.includes('tab')) {
            pText += '   ';
          } else if (tn.nodeName.includes('br')) {
            pText += '\n';
          } else {
            pText += tn.textContent || '';
          }
        });
        if (pText.trim()) {
          lines.push(pText.trim());
        }
      } else if (node.nodeName === 'w:tbl') {
        // Handle tables (e.g. answer key tables or questions in tables)
        const rows = node.querySelectorAll('w\\:tr, tr');
        rows.forEach((row) => {
          const cells = row.querySelectorAll('w\\:tc, tc');
          const cellTexts: string[] = [];
          cells.forEach((cell) => {
            const pEls = cell.querySelectorAll('w\\:p, p');
            const cellParts: string[] = [];
            pEls.forEach((p) => {
              const t = p.textContent?.trim();
              if (t) cellParts.push(t);
            });
            cellTexts.push(cellParts.join(' '));
          });
          if (cellTexts.some((c) => c.length > 0)) {
            lines.push(cellTexts.join('   '));
          }
        });
      } else {
        for (let i = 0; i < node.children.length; i++) {
          walkNode(node.children[i]);
        }
      }
    };

    for (let i = 0; i < body.children.length; i++) {
      walkNode(body.children[i]);
    }

    return lines.join('\n');
  } catch (error) {
    console.error('DOCX metin çıkarma hatası:', error);
    throw error;
  }
};

/**
 * Extracts pure text from Microsoft Excel (.xlsx) files.
 * Excel documents are ZIP archives containing shared strings and sheet data.
 */
export const extractTextFromXlsx = async (file: File): Promise<string> => {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);

    // 1. Read shared strings
    const sharedStringsFile = zip.file('xl/sharedStrings.xml');
    const sharedStrings: string[] = [];

    if (sharedStringsFile) {
      const xmlStr = await sharedStringsFile.async('text');
      const parser = new DOMParser();
      const sstDoc = parser.parseFromString(xmlStr, 'application/xml');
      const siNodes = sstDoc.getElementsByTagName('si');

      for (let i = 0; i < siNodes.length; i++) {
        const si = siNodes[i];
        let str = '';
        const tNodes = si.getElementsByTagName('t');
        for (let j = 0; j < tNodes.length; j++) {
          str += tNodes[j].textContent || '';
        }
        sharedStrings.push(str.trim());
      }
    }

    // 2. Read sheet1.xml (or all sheets)
    const lines: string[] = [];
    const sheetFiles = Object.keys(zip.files).filter((name) => name.startsWith('xl/worksheets/sheet') && name.endsWith('.xml'));

    for (const sheetPath of sheetFiles) {
      const sheetFile = zip.file(sheetPath);
      if (!sheetFile) continue;

      const sheetXml = await sheetFile.async('text');
      const parser = new DOMParser();
      const sheetDoc = parser.parseFromString(sheetXml, 'application/xml');
      const rowNodes = sheetDoc.getElementsByTagName('row');

      for (let r = 0; r < rowNodes.length; r++) {
        const row = rowNodes[r];
        const cellNodes = row.getElementsByTagName('c');
        const rowValues: string[] = [];

        for (let c = 0; c < cellNodes.length; c++) {
          const cell = cellNodes[c];
          const type = cell.getAttribute('t');
          const valEl = cell.getElementsByTagName('v')[0];
          const val = valEl?.textContent || '';

          let cellText = val;
          if (type === 's') {
            // Shared string index
            const idx = parseInt(val, 10);
            if (!isNaN(idx) && sharedStrings[idx] !== undefined) {
              cellText = sharedStrings[idx];
            }
          } else if (type === 'inlineStr') {
            const inlineT = cell.getElementsByTagName('t')[0];
            cellText = inlineT?.textContent || '';
          }

          if (cellText.trim()) {
            rowValues.push(cellText.trim());
          }
        }

        if (rowValues.length > 0) {
          lines.push(rowValues.join('   '));
        }
      }
    }

    // If no sheets yielded text, fallback to joining shared strings
    if (lines.length === 0 && sharedStrings.length > 0) {
      return sharedStrings.join('\n');
    }

    return lines.join('\n');
  } catch (error) {
    console.error('XLSX metin çıkarma hatası:', error);
    throw error;
  }
};

export const getMimeType = (file: File): string => {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';

  // Explicit extension mappings
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'bmp') return 'image/bmp';
  if (ext === 'svg') return 'image/svg+xml';
  if (ext === 'ai') return 'application/pdf';
  if (ext === 'txt') return 'text/plain';
  if (ext === 'csv') return 'text/csv';
  if (ext === 'md' || ext === 'markdown') return 'text/markdown';
  if (ext === 'html' || ext === 'htm') return 'text/html';
  if (ext === 'json') return 'application/json';
  if (ext === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (ext === 'xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  // Fallback to browser detected type if valid
  if (file.type && file.type !== 'application/octet-stream') {
    return file.type;
  }

  return 'application/octet-stream';
};