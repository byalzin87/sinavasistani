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