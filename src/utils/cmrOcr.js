/**
 * Extração automática de campos do documento CMR via OCR (TextDetector nativo ou Tesseract.js lazy)
 * com reconhecimento zonal + página inteira e heurística de presença de assinatura/carimbo.
 */

export const CMR_STATUS_OPTIONS = [
  { id: 'received', label: 'Recebido' },
  { id: 'signed', label: 'Assinado' },
  { id: 'scanned', label: 'Escaneado' },
  { id: 'sent', label: 'Enviado' },
];

const BOILERPLATE_ONLY_RE =
  /^(?:exemplar|ejemplar|copy\s+for|carta\s+de\s+porte|lettre\s+de\s+voiture|international\s+consignment|c\.?\s*m\.?\s*r\.?|nombre|nome|domicilio|domic[íi]lio|adresse|address|pa[íi]s|pays|country|local\s+de|lugar\s+de|place\s+of|assinatura|firma|stamp|sello|carimbo|\d{1,2}[.\s-]*)$/i;

const PARTY_PREFIX_RE =
  /^(?:\d{1,2}[.\s-]*)?(?:(?:remitente|remetente|expedidor|exp[ée]diteur|sender|absender|consignat[áa]rio|destinat[áa]rio|destinataire|consignee|empf[äa]nger)\s*(?:\([^)]*\))?\s*[:./-]*\s*)+/i;

const META_SUBLABEL_RE =
  /^(?:\([^)]*\)\s*|(?:nombre|nome|name|domicilio|domic[íi]lio|adresse|address|pa[íi]s|pays|country)[\s,/():.-]*)+$/i;

function sanitizeExtractedLine(raw) {
  return String(raw || '')
    .replace(/[|[\]{}]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanPartyCandidate(line) {
  let cleaned = sanitizeExtractedLine(line);
  if (!cleaned) return '';

  cleaned = cleaned.replace(PARTY_PREFIX_RE, '').trim();
  cleaned = cleaned
    .replace(/\((?:nombre|nome|name|domicilio|address|pa[íi]s|country)[^)]*\)/gi, '')
    .trim();

  if (!cleaned || cleaned.length < 3) return '';
  if (BOILERPLATE_ONLY_RE.test(cleaned) || META_SUBLABEL_RE.test(cleaned)) {
    return '';
  }
  if (/^(?:nombre|domicilio|pa[íi]s|name,\s*address)/i.test(cleaned)) {
    return '';
  }
  // Exige pelo menos 3 letras para não capturar números de quadro isolados
  if ((cleaned.match(/[a-zA-ZÀ-ÿ]/g) || []).length < 3) return '';
  return cleaned.slice(0, 120);
}

function extractPartyFromZone(zoneText, fullText, partyType) {
  if (zoneText) {
    const lines = String(zoneText).split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const candidate = cleanPartyCandidate(lines[i]);
      if (candidate) return candidate;
    }
  }

  if (fullText) {
    const markerRe =
      partyType === 'sender'
        ? /(?:^|\b)1[.\s-]+(?:remetente|remitente|expedidor|exp[ée]diteur|sender)/i
        : /(?:^|\b)2[.\s-]+(?:destinat[áa]rio|consignat[áa]rio|destinataire|consignee)/i;
    const stopRe =
      partyType === 'sender'
        ? /(?:^|\b)2[.\s-]+(?:destinat[áa]rio|consignat[áa]rio|destinataire|consignee)/i
        : /(?:^|\b)3[.\s-]+(?:local|lugar|place|lieu)/i;

    const lines = String(fullText).split(/\r?\n/);
    let inSection = false;
    let scannedLines = 0;

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (!inSection) {
        if (markerRe.test(line)) {
          inSection = true;
          const inlineCandidate = cleanPartyCandidate(line);
          if (inlineCandidate) return inlineCandidate;
        }
        continue;
      }

      if (stopRe.test(line) || scannedLines >= 6) break;
      scannedLines += 1;
      const candidate = cleanPartyCandidate(line);
      if (candidate) return candidate;
    }
  }

  return '';
}

function extractCmrNumber(topRightText, fullText) {
  const sources = [topRightText, fullText].filter(Boolean);
  for (let s = 0; s < sources.length; s += 1) {
    const src = sources[s];
    const labelRe =
      /(?:C\.?\s*M\.?\s*R\.?\s*(?:N[º°o.]?|NO\.?|N[ÚU]M\.?|#|:)|(?:^|\s)N[.º°o]{1,2}\.?\s*[:.-]?)\s*([A-Z0-9][A-Z0-9/-]{2,15})/gi;
    let match;
    while ((match = labelRe.exec(src)) !== null) {
      const candidate = match[1].trim().toUpperCase();
      if (
        /\d/.test(candidate) &&
        !/^(?:20\d{2}-\d{2}|CMR|CARGA|LOAD|SELO|SEAL)$/i.test(candidate)
      ) {
        return candidate;
      }
    }
  }

  if (topRightText) {
    const numRe = /\b(\d{4,8})\b/g;
    let match;
    while ((match = numRe.exec(topRightText)) !== null) {
      const digits = match[1];
      const numVal = Number(digits);
      // Evita confundir ano (ex: 2026) com número do formulário CMR
      if (digits.length === 4 && numVal >= 2015 && numVal <= 2040) continue;
      return digits;
    }
  }

  return '';
}

function extractLoadNumber(fullText, cmrNumber) {
  if (!fullText) return '';
  const explicitRe =
    /(?:N[º°o.]?\s*(?:DE\s+)?CARGA|CARGA\s*(?:N[º°o.]?|NO\.?|#|:)|LOAD\s*(?:N[º°o.]?|NO\.?|#|ID|:)|REF(?:ER[ÊE]NCIA|\.?)\s*(?:N[º°o.]?|NO\.?|#|:)?|ORDER\s*(?:N[º°o.]?|NO\.?|#|:)|PEDIDO\s*(?:N[º°o.]?|NO\.?|#|:)|EXPEDI[ÇC][ÃA]O\s*(?:N[º°o.]?|NO\.?|#|:)?|SHIPMENT\s*(?:ID|NO\.?|#|:)?)\s*[:.-]?\s*([A-Z0-9][A-Z0-9/_-]{2,19})/gi;

  let match;
  while ((match = explicitRe.exec(fullText)) !== null) {
    const candidate = match[1].trim().toUpperCase();
    if (/\d/.test(candidate) && candidate !== cmrNumber) {
      return candidate;
    }
  }

  const standaloneDigits = fullText.match(/\b(\d{5,10})\b/g) || [];
  for (let i = 0; i < standaloneDigits.length; i += 1) {
    const code = standaloneDigits[i];
    if (code !== cmrNumber && !/^20\d{6}$/.test(code)) {
      return code;
    }
  }

  return '';
}

function normalizePlate(raw) {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function isValidPlateCandidate(plate) {
  if (!plate || plate.length < 5 || plate.length > 14) return false;
  return /[A-Z]/.test(plate) && /\d/.test(plate);
}

function extractTrailerPlate(fullText) {
  if (!fullText) return '';

  const labeledRe =
    /(?:MATR[ÍI]CULA\s*(?:DO\s+|DEL\s+)?(?:REBOQUE|REMOLQUE)?|REBOQUE|REMOLQUE|TRAILER|SEMI(?:RREBOQUE|-?REMORQUE)?)\s*(?:[:.-]|\s)\s*([A-Z]{1,3}[-\s]?\d{2,4}[-\s]?[A-Z0-9]{1,3}|[A-Z0-9-]{5,12})/gi;
  let match;
  while ((match = labeledRe.exec(fullText)) !== null) {
    const normalized = normalizePlate(match[1]);
    if (isValidPlateCandidate(normalized)) {
      return normalized;
    }
  }

  const upper = fullText.toUpperCase();
  const platePatterns = [
    /\b([RLC]-\d{4}-[B-DF-HJ-NP-TV-Z]{2,3})\b/g,
    /\b([A-Z]{1,3}-\d{2,4}-[A-Z]{2,3})\b/g,
    /\b([A-Z]{2}-[A-Z]{2}-\d{2,4})\b/g,
    /\b(\d{2}-[A-Z]{2}-\d{2})\b/g,
    /\b([A-Z]{2}-\d{2}-[A-Z]{2})\b/g,
    /\b(\d{4}[-\s][B-DF-HJ-NP-TV-Z]{3})\b/g,
  ];

  const found = [];
  for (let i = 0; i < platePatterns.length; i += 1) {
    const pat = platePatterns[i];
    let pMatch;
    while ((pMatch = pat.exec(upper)) !== null) {
      const normalized = normalizePlate(pMatch[1]);
      if (isValidPlateCandidate(normalized) && !found.includes(normalized)) {
        found.push(normalized);
      }
    }
  }

  return found[0] || '';
}

function extractSealNumber(fullText) {
  if (!fullText) return '';

  const labeledRe =
    /(?:N[º°o.]?\s*(?:DO\s+|DEL\s+)?(?:SELO|LACRE|PRECINTO)|SELO|LACRE|PRECINTO|SEAL|PLOMB)\s*(?:N[º°o.]?|NO\.?|#|:)?\s*[:.-]?\s*([A-Z0-9][A-Z0-9-]{2,19})/gi;
  let match;
  while ((match = labeledRe.exec(fullText)) !== null) {
    const candidate = match[1].trim().toUpperCase();
    if (/\d/.test(candidate)) {
      return candidate;
    }
  }

  const standaloneSeal = fullText.match(/\b(SEAL-[A-Z0-9-]{3,16})\b/i);
  if (standaloneSeal && /\d/.test(standaloneSeal[1])) {
    return standaloneSeal[1].toUpperCase();
  }

  return '';
}

/**
 * Interpreta o texto reconhecido por OCR (zonas + página completa) e score de assinatura
 * retornando os campos estruturados do CMR e status sugerido.
 */
export function parseCmrOcrText({
  fullText = '',
  topRightText = '',
  box1Text = '',
  box2Text = '',
  signatureScore = 0,
} = {}) {
  const cmrNumber = extractCmrNumber(topRightText, fullText);
  const loadNumber = extractLoadNumber(fullText, cmrNumber);
  const sender = extractPartyFromZone(box1Text, fullText, 'sender');
  const recipient = extractPartyFromZone(box2Text, fullText, 'recipient');
  const trailerPlate = extractTrailerPlate(fullText);
  const sealNumber = extractSealNumber(fullText);

  const hasSignatureKeywords =
    /(?:entregue\s+conforme|mercadoria\s+recebida|firma\s+y\s+sello|assinado|carimbo|signed\s+by|received\s+in\s+good)/i.test(
      fullText
    );
  const suggestedStatus =
    Number(signatureScore) >= 0.018 || hasSignatureKeywords
      ? 'signed'
      : 'scanned';

  const fields = [
    cmrNumber,
    loadNumber,
    sender,
    recipient,
    trailerPlate,
    sealNumber,
  ];
  const detectedCount = fields.filter(Boolean).length;

  return {
    cmrNumber,
    loadNumber,
    sender,
    recipient,
    trailerPlate,
    sealNumber,
    suggestedStatus,
    detectedCount,
    rawText: String(fullText || '').trim(),
  };
}

/**
 * Mede a densidade de tinta (caneta azul/preta ou carimbo) nos quadros inferiores (22–24)
 * para detectar se o CMR já contém assinatura ou carimbo físico.
 */
export function estimateSignaturePresenceFromCanvas(canvas) {
  if (!canvas || canvas.width < 20 || canvas.height < 20) return 0;
  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return 0;

    const sx = Math.floor(canvas.width * 0.08);
    const sy = Math.floor(canvas.height * 0.82);
    const sw = Math.max(10, Math.floor(canvas.width * 0.84));
    const sh = Math.max(10, Math.floor(canvas.height * 0.13));

    const { data } = ctx.getImageData(sx, sy, sw, sh);
    let inkPixels = 0;
    const total = sw * sh;

    for (let i = 0; i < total; i += 1) {
      const p = i * 4;
      const r = data[p];
      const g = data[p + 1];
      const b = data[p + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      const sat = Math.max(r, g, b) - Math.min(r, g, b);
      if (lum < 150 || sat >= 38) {
        inkPixels += 1;
      }
    }

    return total > 0 ? inkPixels / total : 0;
  } catch {
    return 0;
  }
}

function loadCanvasImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Falha ao carregar imagem para OCR.'));
    img.src = src;
  });
}

function cropRegionToCanvas(sourceCanvas, xFrac, yFrac, wFrac, hFrac) {
  const sx = Math.max(0, Math.floor(sourceCanvas.width * xFrac));
  const sy = Math.max(0, Math.floor(sourceCanvas.height * yFrac));
  const sw = Math.max(16, Math.floor(sourceCanvas.width * wFrac));
  const sh = Math.max(16, Math.floor(sourceCanvas.height * hFrac));

  const sub = document.createElement('canvas');
  sub.width = sw;
  sub.height = sh;
  sub.getContext('2d').drawImage(sourceCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
  return sub;
}

async function detectWithNativeTextDetector(canvas) {
  if (typeof window === 'undefined' || typeof window.TextDetector !== 'function') {
    return null;
  }
  try {
    const detector = new window.TextDetector();
    const blocks = await detector.detect(canvas);
    if (!Array.isArray(blocks) || blocks.length === 0) return '';
    return blocks
      .map((b) => String(b?.rawValue || '').trim())
      .filter(Boolean)
      .join('\n');
  } catch {
    return null;
  }
}

/**
 * Executa OCR zonal + completo sobre o scan recortado do CMR usando TextDetector nativo
 * (quando suportado) com fallback automático para Tesseract.js carregado sob demanda.
 */
export async function extractCmrFieldsViaOcr(imageSource, onProgress) {
  if (!imageSource) {
    return parseCmrOcrText({});
  }

  const report = (pct) => {
    if (typeof onProgress === 'function') {
      onProgress(Math.max(0, Math.min(100, Math.round(pct))));
    }
  };

  report(5);
  const img = await loadCanvasImage(imageSource);
  const MAX_OCR_DIM = 1400;
  let w = img.naturalWidth || img.width || 1000;
  let h = img.naturalHeight || img.height || 1400;
  if (w > h && w > MAX_OCR_DIM) {
    h = Math.max(32, Math.round((h * MAX_OCR_DIM) / w));
    w = MAX_OCR_DIM;
  } else if (h >= w && h > MAX_OCR_DIM) {
    w = Math.max(32, Math.round((w * MAX_OCR_DIM) / h));
    h = MAX_OCR_DIM;
  }

  const fullCanvas = document.createElement('canvas');
  fullCanvas.width = w;
  fullCanvas.height = h;
  fullCanvas.getContext('2d', { willReadFrequently: true }).drawImage(img, 0, 0, w, h);

  const signatureScore = estimateSignaturePresenceFromCanvas(fullCanvas);
  const topRightCanvas = cropRegionToCanvas(fullCanvas, 0.56, 0.01, 0.42, 0.19);
  const box1Canvas = cropRegionToCanvas(fullCanvas, 0.04, 0.03, 0.48, 0.16);
  const box2Canvas = cropRegionToCanvas(fullCanvas, 0.04, 0.19, 0.48, 0.15);

  report(15);
  const nativeFull = await detectWithNativeTextDetector(fullCanvas);
  if (nativeFull && nativeFull.trim().length > 20) {
    report(55);
    const [topRightText, box1Text, box2Text] = await Promise.all([
      detectWithNativeTextDetector(topRightCanvas),
      detectWithNativeTextDetector(box1Canvas),
      detectWithNativeTextDetector(box2Canvas),
    ]);
    report(100);
    return parseCmrOcrText({
      fullText: nativeFull,
      topRightText: topRightText || '',
      box1Text: box1Text || '',
      box2Text: box2Text || '',
      signatureScore,
    });
  }

  const tesseractMod = await import('tesseract.js');
  const createWorker =
    tesseractMod.createWorker || tesseractMod.default?.createWorker;
  if (typeof createWorker !== 'function') {
    throw new Error('Motor de OCR indisponível neste navegador.');
  }

  report(25);
  let worker;
  try {
    worker = await createWorker('por+eng', 1, {
      logger: (m) => {
        if (m?.status === 'recognizing text' && typeof m.progress === 'number') {
          report(35 + m.progress * 60);
        }
      },
    });
  } catch {
    worker = await createWorker('eng', 1, {
      logger: (m) => {
        if (m?.status === 'recognizing text' && typeof m.progress === 'number') {
          report(35 + m.progress * 60);
        }
      },
    });
  }

  try {
    report(35);
    const topRightRes = await worker.recognize(topRightCanvas);
    report(50);
    const box1Res = await worker.recognize(box1Canvas);
    report(65);
    const box2Res = await worker.recognize(box2Canvas);
    report(80);
    const fullRes = await worker.recognize(fullCanvas);

    report(100);
    return parseCmrOcrText({
      fullText: fullRes?.data?.text || '',
      topRightText: topRightRes?.data?.text || '',
      box1Text: box1Res?.data?.text || '',
      box2Text: box2Res?.data?.text || '',
      signatureScore,
    });
  } finally {
    await worker.terminate().catch(() => {});
  }
}
