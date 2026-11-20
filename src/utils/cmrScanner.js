import {
  DEFAULT_CROP_CORNERS,
  computeHomography,
  detectDocumentCornersFromRgba,
  estimateRectifiedSize,
  isAxisAlignedRect,
} from './cmrGeometry';

/**
 * Monta o nome padronizado exigido:
 * - Apenas Carga: CMR_AAAA-MM-DD_[NumeroCarga].pdf
 * - Nº CMR + Carga: CMR_AAAA-MM-DD_[NumeroCMR]_[NumeroCarga].pdf
 */
export function buildCmrFileName(dateStr, loadNumber, cmrNumber = '') {
  const safeDate = /^\d{4}-\d{2}-\d{2}$/.test(dateStr || '')
    ? dateStr
    : new Date().toISOString().slice(0, 10);

  const sanitizePart = (raw) =>
    String(raw || '')
      .trim()
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '');

  const cleanedCmr = sanitizePart(cmrNumber);
  const cleanedLoad = sanitizePart(loadNumber);

  let codePart = 'SEM_CARGA';
  if (cleanedCmr && cleanedLoad && cleanedCmr !== cleanedLoad) {
    codePart = `${cleanedCmr}_${cleanedLoad}`;
  } else if (cleanedLoad) {
    codePart = cleanedLoad;
  } else if (cleanedCmr) {
    codePart = cleanedCmr;
  }

  return `CMR_${safeDate}_${codePart}.pdf`;
}

/**
 * Monta texto resumo estruturado para acompanhar o PDF ao enviar no WhatsApp.
 */
export function buildCmrShareSummary(metadata = {}) {
  const parts = [];
  if (metadata.cmrNumber) parts.push(`CMR Nº ${metadata.cmrNumber}`);
  if (metadata.loadNumber) parts.push(`Carga ${metadata.loadNumber}`);
  if (parts.length === 0) parts.push('CMR');

  const details = [];
  if (metadata.date) details.push(`Data: ${metadata.date}`);
  if (metadata.sender) details.push(`Remetente: ${metadata.sender}`);
  if (metadata.recipient) details.push(`Destinatário: ${metadata.recipient}`);
  if (metadata.trailerPlate) details.push(`Reboque: ${metadata.trailerPlate}`);
  if (metadata.sealNumber) details.push(`Selo: ${metadata.sealNumber}`);

  return `${parts.join(' · ')}${
    details.length > 0 ? ` | ${details.join(' · ')}` : ''
  } — TruckFlow EU`;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Falha ao carregar imagem do CMR.'));
    img.src = src;
  });
}

export function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Erro ao ler arquivo selecionado.'));
    reader.readAsDataURL(file);
  });
}

/**
 * Rotaciona uma imagem 90 graus no sentido horário usando HTML5 Canvas.
 */
export async function rotateImageDataUrl90(imageSource) {
  const img = await loadImage(imageSource);
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;

  const canvas = document.createElement('canvas');
  canvas.width = h;
  canvas.height = w;
  const ctx = canvas.getContext('2d');
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(img, -w / 2, -h / 2);

  return canvas.toDataURL('image/jpeg', 0.92);
}

/**
 * Detecta automaticamente os 4 cantos do documento CMR em uma imagem Data URL.
 */
export async function detectDocumentCornersFromImage(imageSource) {
  try {
    const img = await loadImage(imageSource);
    const MAX_DETECT_DIM = 320;
    let width = img.naturalWidth || img.width;
    let height = img.naturalHeight || img.height;

    if (width > height && width > MAX_DETECT_DIM) {
      height = Math.max(16, Math.round((height * MAX_DETECT_DIM) / width));
      width = MAX_DETECT_DIM;
    } else if (height >= width && height > MAX_DETECT_DIM) {
      width = Math.max(16, Math.round((width * MAX_DETECT_DIM) / height));
      height = MAX_DETECT_DIM;
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, width, height);
    const { data } = ctx.getImageData(0, 0, width, height);

    return detectDocumentCornersFromRgba(data, width, height);
  } catch {
    return { detected: false, corners: DEFAULT_CROP_CORNERS };
  }
}

/**
 * Recorta e aplica retificação de perspectiva (4 cantos) sobre a foto do CMR.
 */
export async function cropAndWarpCmrImage(
  imageSource,
  corners,
  maxDim = 1900
) {
  if (!Array.isArray(corners) || corners.length !== 4) {
    return imageSource;
  }

  const img = await loadImage(imageSource);
  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;
  const { width: dstW, height: dstH } = estimateRectifiedSize(
    corners,
    srcW,
    srcH,
    maxDim
  );

  // Fast-path para recorte retangular alinhado aos eixos
  if (isAxisAlignedRect(corners)) {
    const sx = Math.max(0, corners[0].x * srcW);
    const sy = Math.max(0, corners[0].y * srcH);
    const sw = Math.max(1, (corners[1].x - corners[0].x) * srcW);
    const sh = Math.max(1, (corners[3].y - corners[0].y) * srcH);

    const canvas = document.createElement('canvas');
    canvas.width = dstW;
    canvas.height = dstH;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, dstW, dstH);
    return canvas.toDataURL('image/jpeg', 0.92);
  }

  // Retificação por homografia 3x3 com interpolação bilinear
  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = srcW;
  srcCanvas.height = srcH;
  const srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true });
  srcCtx.drawImage(img, 0, 0, srcW, srcH);
  const srcData = srcCtx.getImageData(0, 0, srcW, srcH).data;

  const dstQuad = [
    { x: 0, y: 0 },
    { x: Math.max(1, dstW - 1), y: 0 },
    { x: Math.max(1, dstW - 1), y: Math.max(1, dstH - 1) },
    { x: 0, y: Math.max(1, dstH - 1) },
  ];
  const srcQuad = corners.map((c) => ({
    x: c.x * Math.max(1, srcW - 1),
    y: c.y * Math.max(1, srcH - 1),
  }));

  const H = computeHomography(dstQuad, srcQuad);
  if (!H) {
    return imageSource;
  }

  const dstCanvas = document.createElement('canvas');
  dstCanvas.width = dstW;
  dstCanvas.height = dstH;
  const dstCtx = dstCanvas.getContext('2d');
  const dstImgData = dstCtx.createImageData(dstW, dstH);
  const dstData = dstImgData.data;

  const [h0, h1, h2, h3, h4, h5, h6, h7] = H;
  const maxSx = srcW - 1;
  const maxSy = srcH - 1;

  for (let dy = 0; dy < dstH; dy += 1) {
    const rowOffset = dy * dstW * 4;
    for (let dx = 0; dx < dstW; dx += 1) {
      const denom = h6 * dx + h7 * dy + 1;
      const sx = Math.max(
        0,
        Math.min(maxSx, (h0 * dx + h1 * dy + h2) / (denom || 1))
      );
      const sy = Math.max(
        0,
        Math.min(maxSy, (h3 * dx + h4 * dy + h5) / (denom || 1))
      );

      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = Math.min(maxSx, x0 + 1);
      const y1 = Math.min(maxSy, y0 + 1);

      const wx = sx - x0;
      const wy = sy - y0;
      const invWx = 1 - wx;
      const invWy = 1 - wy;

      const idx00 = (y0 * srcW + x0) * 4;
      const idx10 = (y0 * srcW + x1) * 4;
      const idx01 = (y1 * srcW + x0) * 4;
      const idx11 = (y1 * srcW + x1) * 4;

      const w00 = invWx * invWy;
      const w10 = wx * invWy;
      const w01 = invWx * wy;
      const w11 = wx * wy;

      const outIdx = rowOffset + dx * 4;
      dstData[outIdx] =
        srcData[idx00] * w00 +
        srcData[idx10] * w10 +
        srcData[idx01] * w01 +
        srcData[idx11] * w11;
      dstData[outIdx + 1] =
        srcData[idx00 + 1] * w00 +
        srcData[idx10 + 1] * w10 +
        srcData[idx01 + 1] * w01 +
        srcData[idx11 + 1] * w11;
      dstData[outIdx + 2] =
        srcData[idx00 + 2] * w00 +
        srcData[idx10 + 2] * w10 +
        srcData[idx01 + 2] * w01 +
        srcData[idx11 + 2] * w11;
      dstData[outIdx + 3] = 255;
    }
  }

  dstCtx.putImageData(dstImgData, 0, 0);
  return dstCanvas.toDataURL('image/jpeg', 0.92);
}

/**
 * Aplica branqueamento adaptativo de fundo (remoção de sombras por iluminação local)
 * e máscara de nitidez (Unsharp Mask) via imagem integral O(1) por pixel.
 * No modo 'color' ("Cor Limpa"), deixa o papel branco uniforme preservando
 * e realçando a cor de carimbos e assinaturas.
 */
export function enhanceDocumentScanRgba(
  rgbaData,
  width,
  height,
  mode = 'high'
) {
  const w = Math.floor(Number(width) || 0);
  const h = Math.floor(Number(height) || 0);
  const total = w * h;
  if (!rgbaData || w < 4 || h < 4 || rgbaData.length < total * 4) {
    return rgbaData;
  }

  const lums = new Uint8Array(total);
  const iw = w + 1;
  const integral = new Uint32Array(iw * (h + 1));

  for (let y = 0; y < h; y += 1) {
    let rowSum = 0;
    const rowOff = y * w;
    const prevRowInt = y * iw;
    const currRowInt = (y + 1) * iw;

    for (let x = 0; x < w; x += 1) {
      const i = rowOff + x;
      const p = i * 4;
      const lum = Math.max(
        0,
        Math.min(
          255,
          Math.round(
            0.299 * rgbaData[p] +
              0.587 * rgbaData[p + 1] +
              0.114 * rgbaData[p + 2]
          )
        )
      );
      lums[i] = lum;
      rowSum += lum;
      integral[currRowInt + x + 1] = integral[prevRowInt + x + 1] + rowSum;
    }
  }

  const boxMean = (x, y, r) => {
    const x0 = Math.max(0, x - r);
    const y0 = Math.max(0, y - r);
    const x1 = Math.min(w - 1, x + r);
    const y1 = Math.min(h - 1, y + r);
    const sum =
      integral[(y1 + 1) * iw + (x1 + 1)] -
      integral[y0 * iw + (x1 + 1)] -
      integral[(y1 + 1) * iw + x0] +
      integral[y0 * iw + x0];
    return sum / ((x1 - x0 + 1) * (y1 - y0 + 1));
  };

  const bgRadius = Math.max(12, Math.round(Math.min(w, h) * 0.045));
  const config =
    mode === 'ultra'
      ? { contrast: 2.35, whiteThreshold: 195, blackThreshold: 70 }
      : mode === 'normal'
      ? { contrast: 1.4, whiteThreshold: 230, blackThreshold: 25 }
      : { contrast: 1.9, whiteThreshold: 215, blackThreshold: 45 };

  for (let y = 0; y < h; y += 1) {
    const rowOff = y * w;
    for (let x = 0; x < w; x += 1) {
      const i = rowOff + x;
      const p = i * 4;
      const lum = lums[i];
      const blur3 = boxMean(x, y, 1);
      const detail = lum - blur3;
      const bgMean = boxMean(x, y, bgRadius);
      const bgWhite = Math.max(70, Math.min(255, bgMean * 1.04));

      if (mode === 'color') {
        const r = rgbaData[p];
        const g = rgbaData[p + 1];
        const b = rgbaData[p + 2];
        const sat = Math.max(r, g, b) - Math.min(r, g, b);
        const scale = Math.min(2.6, 255 / bgWhite);

        let nr = Math.max(0, Math.min(255, r * scale + detail * 0.85));
        let ng = Math.max(0, Math.min(255, g * scale + detail * 0.85));
        let nb = Math.max(0, Math.min(255, b * scale + detail * 0.85));
        const normLum = 0.299 * nr + 0.587 * ng + 0.114 * nb;

        if (sat < 38 && normLum >= 195) {
          const t = Math.min(1, (normLum - 195) / 38);
          nr += (255 - nr) * t;
          ng += (255 - ng) * t;
          nb += (255 - nb) * t;
        } else if (sat < 35 && normLum < 165) {
          const factor = Math.max(0.45, normLum / 165);
          nr *= factor;
          ng *= factor;
          nb *= factor;
        } else if (sat >= 24) {
          const avg = (nr + ng + nb) / 3;
          const boost = 1.18;
          nr = Math.max(0, Math.min(255, avg + (nr - avg) * boost));
          ng = Math.max(0, Math.min(255, avg + (ng - avg) * boost));
          nb = Math.max(0, Math.min(255, avg + (nb - avg) * boost));
        }

        rgbaData[p] = Math.round(nr);
        rgbaData[p + 1] = Math.round(ng);
        rgbaData[p + 2] = Math.round(nb);
      } else {
        const normLum = Math.max(
          0,
          Math.min(255, ((lum + detail * 1.15) / bgWhite) * 255)
        );
        let enhanced = (normLum - 128) * config.contrast + 128;

        if (enhanced >= config.whiteThreshold) {
          enhanced = 255;
        } else if (enhanced <= config.blackThreshold) {
          enhanced = 0;
        } else {
          enhanced = Math.max(0, Math.min(255, Math.round(enhanced)));
        }

        rgbaData[p] = enhanced;
        rgbaData[p + 1] = enhanced;
        rgbaData[p + 2] = enhanced;
      }
    }
  }

  return rgbaData;
}

/**
 * Processa a foto do CMR via HTML5 Canvas:
 * - Redimensiona para no máximo 1900px (alta definição para leitura nítida dos quadros 1–24)
 * - Aplica filtro Scanner adaptativo ('color' | 'normal' | 'high' | 'ultra')
 * - Gera também uma miniatura leve para o histórico
 */
export async function processCmrImageToCanvas(imageSource, mode = 'high') {
  const img = await loadImage(imageSource);

  const MAX_DIM = 1900;
  let width = img.naturalWidth || img.width;
  let height = img.naturalHeight || img.height;

  if (width > height && width > MAX_DIM) {
    height = Math.round((height * MAX_DIM) / width);
    width = MAX_DIM;
  } else if (height >= width && height > MAX_DIM) {
    width = Math.round((width * MAX_DIM) / height);
    height = MAX_DIM;
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, width, height);

  const imageData = ctx.getImageData(0, 0, width, height);
  enhanceDocumentScanRgba(imageData.data, width, height, mode);
  ctx.putImageData(imageData, 0, 0);

  const scanDataUrl = canvas.toDataURL(
    'image/jpeg',
    mode === 'color' ? 0.8 : 0.75
  );

  // Miniatura compacta para listagem de histórico
  const THUMB_MAX = 240;
  let tW = width;
  let tH = height;
  if (tW > tH && tW > THUMB_MAX) {
    tH = Math.round((tH * THUMB_MAX) / tW);
    tW = THUMB_MAX;
  } else if (tH >= tW && tH > THUMB_MAX) {
    tW = Math.round((tW * THUMB_MAX) / tH);
    tH = THUMB_MAX;
  }
  const thumbCanvas = document.createElement('canvas');
  thumbCanvas.width = tW;
  thumbCanvas.height = tH;
  thumbCanvas.getContext('2d').drawImage(canvas, 0, 0, tW, tH);
  const thumbDataUrl = thumbCanvas.toDataURL('image/jpeg', 0.52);

  const approxKb = Math.round((scanDataUrl.length * 0.75) / 1024);

  return {
    scanDataUrl,
    thumbDataUrl,
    width,
    height,
    approxKb,
  };
}

/**
 * Gera uma imagem sintética de um documento CMR internacional para teste rápido sem câmera.
 */
export function createDemoCmrDataUrl(loadNumber = '84920', dateStr = '2026-11-17') {
  const canvas = document.createElement('canvas');
  canvas.width = 1000;
  canvas.height = 1400;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#edeae2';
  ctx.fillRect(0, 0, 1000, 1400);

  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 4;
  ctx.strokeRect(50, 50, 900, 1300);

  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 26px sans-serif';
  ctx.fillText('CMR - CARTA DE PORTE INTERNACIONAL', 75, 112);

  ctx.font = 'bold 21px monospace';
  ctx.fillText(`CARGA Nº: ${loadNumber || '84920'}`, 675, 108);
  ctx.fillText(`DATA: ${dateStr}`, 675, 142);

  ctx.lineWidth = 2;
  ctx.strokeRect(70, 185, 420, 180);
  ctx.strokeRect(510, 185, 420, 180);
  ctx.strokeRect(70, 385, 860, 260);
  ctx.strokeRect(70, 670, 860, 320);
  ctx.strokeRect(70, 1020, 420, 270);
  ctx.strokeRect(510, 1020, 420, 270);

  ctx.font = 'bold 18px sans-serif';
  ctx.fillText('1. REMETENTE (EXPEDIDOR)', 85, 215);
  ctx.fillText('2. DESTINATÁRIO (CONSIGNATÁRIO)', 525, 215);
  ctx.fillText('3. LOCAL DE DESCARGA / ENTREGA', 85, 415);
  ctx.fillText('6-12. DESCRIÇÃO DA MERCADORIA & PESO BRUTO', 85, 705);
  ctx.fillText('22. ASSINATURA TRANSPORTADOR', 85, 1055);
  ctx.fillText('24. MERCADORIA RECEBIDA (CARIMBO)', 525, 1055);

  ctx.font = '20px sans-serif';
  ctx.fillStyle = '#334155';
  ctx.fillText('LOGÍSTICA IBÉRICA S.A.', 85, 255);
  ctx.fillText('ZONA FRANCA - BARCELONA (ES)', 85, 290);

  ctx.fillText('EURODISTRIBUTION GMBH', 525, 255);
  ctx.fillText('INDUSTRIESTR. 44 - STUTTGART (DE)', 525, 290);

  ctx.fillText('PLATAFORMA STUTTGART NORD · PORTA 18', 85, 460);
  ctx.fillText('MATRÍCULA REBOQUE: L-1234-BBB · SELO: SEAL-88412', 85, 500);

  ctx.fillText('33 PALETES EUROPALLET · PEÇAS AUTOMOTIVAS', 85, 755);
  ctx.fillText('PESO BRUTO: 22.450 KG · LONA TIR OK', 85, 800);

  ctx.save();
  ctx.translate(715, 1185);
  ctx.rotate(-0.12);
  ctx.strokeStyle = '#1d4ed8';
  ctx.lineWidth = 4;
  ctx.strokeRect(-140, -55, 280, 110);
  ctx.fillStyle = '#1d4ed8';
  ctx.font = 'bold 22px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('ENTREGUE CONFORME', 0, -12);
  ctx.font = '18px monospace';
  ctx.fillText(dateStr, 0, 24);
  ctx.restore();

  return canvas.toDataURL('image/jpeg', 0.85);
}

/**
 * Calcula as dimensões da página do PDF (em mm) com exatamente a mesma proporção
 * da imagem recortada, eliminando qualquer borda ou faixa branca ao redor do CMR.
 */
export function computePdfPageSizeMm(imgWidth, imgHeight) {
  const safeW = Math.max(1, Number(imgWidth) || 1000);
  const safeH = Math.max(1, Number(imgHeight) || 1400);

  if (safeH >= safeW) {
    const pageW = 210;
    const pageH = Number(((210 * safeH) / safeW).toFixed(2));
    return { orientation: 'p', pageW, pageH };
  }

  const pageW = 297;
  const pageH = Number(((297 * safeH) / safeW).toFixed(2));
  return { orientation: 'l', pageW, pageH };
}

/**
 * Gera um arquivo PDF sem bordas brancas (1 ou múltiplas páginas), ajustando cada página
 * à proporção exata da foto recortada e carregando jsPDF sob demanda.
 */
export async function generateCmrPdf(pagesInput, metadata = {}) {
  const pages = Array.isArray(pagesInput)
    ? pagesInput.filter(Boolean)
    : [pagesInput].filter(Boolean);

  if (pages.length === 0) {
    throw new Error('Nenhuma página digitalizada para gerar o PDF.');
  }

  const [{ jsPDF }, loadedImages] = await Promise.all([
    import('jspdf'),
    Promise.all(pages.map((src) => loadImage(src))),
  ]);
  const fileName = buildCmrFileName(
    metadata.date,
    metadata.loadNumber,
    metadata.cmrNumber
  );

  const dimensions = loadedImages.map((img) =>
    computePdfPageSizeMm(img.naturalWidth || img.width, img.naturalHeight || img.height)
  );
  const firstDim = dimensions[0];

  const doc = new jsPDF({
    orientation: firstDim.orientation,
    unit: 'mm',
    format: [firstDim.pageW, firstDim.pageH],
    compress: true,
  });

  for (let i = 0; i < pages.length; i += 1) {
    const dim = dimensions[i];
    if (i > 0) {
      doc.addPage([dim.pageW, dim.pageH], dim.orientation);
    }

    doc.addImage(pages[i], 'JPEG', 0, 0, dim.pageW, dim.pageH, undefined, 'FAST');
  }

  const pdfBlob = doc.output('blob');
  const sizeKb = Math.max(1, Math.round(pdfBlob.size / 1024));

  return {
    pdfBlob,
    fileName,
    sizeKb,
    pageCount: pages.length,
  };
}

export function triggerPdfDownload(pdfBlob, fileName) {
  const url = URL.createObjectURL(pdfBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function createCmrPdfFile(pdfBlob, fileName) {
  return new File([pdfBlob], fileName, { type: 'application/pdf' });
}

export function canShareCmrPdfFile(file) {
  return (
    Boolean(file) &&
    typeof navigator !== 'undefined' &&
    typeof navigator.share === 'function' &&
    typeof navigator.canShare === 'function' &&
    navigator.canShare({ files: [file] })
  );
}

/**
 * Aciona imediatamente a Web Share API (navigator.share) para compartilhar o PDF no dispositivo (fluxo em 2 toques:
 * 1º toque abre a folha de compartilhamento do celular, 2º toque escolhe o contato no WhatsApp).
 * Em navegadores sem suporte a share de arquivos, baixa o PDF e retorna o texto para WhatsApp.
 */
export async function shareOrDownloadCmrPdf(
  pdfBlob,
  fileName,
  metadata = {},
  prebuiltFile = null
) {
  const file =
    prebuiltFile instanceof File
      ? prebuiltFile
      : createCmrPdfFile(pdfBlob, fileName);
  const shareText = buildCmrShareSummary(metadata);

  if (canShareCmrPdfFile(file)) {
    try {
      await navigator.share({
        title: fileName,
        text: shareText,
        files: [file],
      });
      return { method: 'shared', fileName, shareText };
    } catch (err) {
      if (err?.name === 'AbortError') {
        return { method: 'cancelled', fileName, shareText };
      }
    }
  }

  if (pdfBlob) {
    triggerPdfDownload(pdfBlob, fileName);
  }
  return { method: 'downloaded', fileName, shareText };
}
