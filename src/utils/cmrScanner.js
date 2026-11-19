import {
  DEFAULT_CROP_CORNERS,
  computeHomography,
  detectDocumentCornersFromRgba,
  estimateRectifiedSize,
  isAxisAlignedRect,
} from './cmrGeometry';

/**
 * Monta o nome padronizado exigido: CMR_AAAA-MM-DD_[NumeroCarga].pdf
 */
export function buildCmrFileName(dateStr, loadNumber) {
  const safeDate = /^\d{4}-\d{2}-\d{2}$/.test(dateStr || '')
    ? dateStr
    : new Date().toISOString().slice(0, 10);

  const cleanedLoad = String(loadNumber || 'SEM_CARGA')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  const finalLoad = cleanedLoad || 'SEM_CARGA';
  return `CMR_${safeDate}_${finalLoad}.pdf`;
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
  maxDim = 1500
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
 * Processa a foto do CMR via HTML5 Canvas:
 * - Redimensiona para no máximo 1500px (economia máxima de dados em roaming)
 * - Aplica filtro Scanner ('color' | 'normal' | 'high' | 'ultra')
 * - Gera também uma miniatura leve para o histórico
 */
export async function processCmrImageToCanvas(imageSource, mode = 'high') {
  const img = await loadImage(imageSource);

  const MAX_DIM = 1500;
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

  if (mode !== 'color') {
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;

    const config =
      mode === 'ultra'
        ? { contrast: 2.35, whiteThreshold: 195, blackThreshold: 65 }
        : mode === 'normal'
        ? { contrast: 1.35, whiteThreshold: 232, blackThreshold: 20 }
        : { contrast: 1.85, whiteThreshold: 212, blackThreshold: 40 };

    for (let i = 0; i < data.length; i += 4) {
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      let enhanced = (lum - 128) * config.contrast + 128;

      if (enhanced >= config.whiteThreshold) {
        enhanced = 255;
      } else if (enhanced <= config.blackThreshold) {
        enhanced = 0;
      } else {
        enhanced = Math.max(0, Math.min(255, enhanced));
      }

      data[i] = enhanced;
      data[i + 1] = enhanced;
      data[i + 2] = enhanced;
    }

    ctx.putImageData(imageData, 0, 0);
  }

  const scanDataUrl = canvas.toDataURL(
    'image/jpeg',
    mode === 'color' ? 0.78 : 0.72
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
  const fileName = buildCmrFileName(metadata.date, metadata.loadNumber);

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

/**
 * Aciona imediatamente a Web Share API (navigator.share) para enviar o PDF direto no WhatsApp.
 * Em navegadores desktop sem suporte a share de arquivos, baixa o PDF e retorna fallback para WhatsApp Web.
 */
export async function shareOrDownloadCmrPdf(pdfBlob, fileName, metadata = {}) {
  const file = new File([pdfBlob], fileName, { type: 'application/pdf' });
  const shareText = `CMR Carga ${metadata.loadNumber || ''} (${metadata.date || ''}) — Enviado via TruckFlow EU`;

  if (
    typeof navigator !== 'undefined' &&
    typeof navigator.share === 'function' &&
    typeof navigator.canShare === 'function' &&
    navigator.canShare({ files: [file] })
  ) {
    try {
      await navigator.share({
        title: fileName,
        text: shareText,
        files: [file],
      });
      return { method: 'shared', fileName };
    } catch (err) {
      if (err?.name === 'AbortError') {
        return { method: 'cancelled', fileName };
      }
    }
  }

  triggerPdfDownload(pdfBlob, fileName);
  return { method: 'downloaded', fileName, shareText };
}
