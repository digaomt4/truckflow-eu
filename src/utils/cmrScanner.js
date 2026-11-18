import { jsPDF } from 'jspdf';

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
 * Processa a foto do CMR via HTML5 Canvas:
 * - Redimensiona para no máximo 1500px (economia máxima de dados em roaming)
 * - Converte para Grayscale + Alto Contraste estilo scanner
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

  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  // Parâmetros por nível de contraste do scanner
  const config =
    mode === 'ultra'
      ? { contrast: 2.35, whiteThreshold: 195, blackThreshold: 65 }
      : mode === 'normal'
      ? { contrast: 1.35, whiteThreshold: 232, blackThreshold: 20 }
      : { contrast: 1.85, whiteThreshold: 212, blackThreshold: 40 };

  for (let i = 0; i < data.length; i += 4) {
    // Luminância perceptual
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];

    // Ajuste linear de contraste em torno do ponto médio
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

  // Compressão JPEG leve (ideal para WhatsApp em roaming)
  const scanDataUrl = canvas.toDataURL('image/jpeg', 0.72);

  // Miniatura compacta para listagem de histórico
  const THUMB_MAX = 260;
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
  const thumbDataUrl = thumbCanvas.toDataURL('image/jpeg', 0.55);

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

  // Fundo estilo papel com leve textura cinza
  ctx.fillStyle = '#edeae2';
  ctx.fillRect(0, 0, 1000, 1400);

  // Moldura principal CMR
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 4;
  ctx.strokeRect(50, 50, 900, 1300);

  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 34px sans-serif';
  ctx.fillText('CMR - CARTA DE PORTE INTERNACIONAL', 80, 115);

  ctx.font = 'bold 24px monospace';
  ctx.fillText(`CARGA Nº: ${loadNumber || '84920'}`, 640, 115);
  ctx.fillText(`DATA: ${dateStr}`, 640, 155);

  // Blocos do CMR
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

  // Carimbo simulado
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
 * Gera um arquivo PDF A4 leve contendo o CMR digitalizado via jsPDF.
 */
export async function generateCmrPdf(processedDataUrl, metadata) {
  const fileName = buildCmrFileName(metadata.date, metadata.loadNumber);
  const img = await loadImage(processedDataUrl);

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true,
  });

  const pageW = doc.internal.pageSize.getWidth(); // 210mm
  const pageH = doc.internal.pageSize.getHeight(); // 297mm
  const margin = 8;
  const maxW = pageW - margin * 2;
  const maxH = pageH - margin * 2 - 10;

  const imgRatio = (img.naturalWidth || img.width) / (img.naturalHeight || img.height);
  let renderW = maxW;
  let renderH = renderW / imgRatio;

  if (renderH > maxH) {
    renderH = maxH;
    renderW = renderH * imgRatio;
  }

  const x = (pageW - renderW) / 2;
  const y = margin;

  doc.addImage(processedDataUrl, 'JPEG', x, y, renderW, renderH, undefined, 'FAST');

  doc.setFontSize(8);
  doc.setTextColor(90, 90, 90);
  doc.text(
    `TruckFlow EU · ${fileName}${metadata.notes ? ` · ${metadata.notes}` : ''}`,
    margin,
    pageH - 4
  );

  const pdfBlob = doc.output('blob');
  const sizeKb = Math.max(1, Math.round(pdfBlob.size / 1024));

  return {
    pdfBlob,
    fileName,
    sizeKb,
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

  // Fallback seguro quando Web Share de arquivo não está disponível (ex: Desktop)
  triggerPdfDownload(pdfBlob, fileName);
  return { method: 'downloaded', fileName, shareText };
}
