import {
  formatEuro,
  formatKm,
  formatRate,
} from './salaryCalculator';
import { calculateShiftDurationLabel } from './locationHelper';
import { SALARY_EXTRA_CATEGORIES } from '../services/salaryExtrasService';
import { readLocalSettings } from '../services/shiftsService';
import { getActiveCoupledTrailerPlate } from '../services/trailerService';
import { resolveExpenseReceipt } from '../services/expensesService';

const EXTRA_CATEGORY_MAP = Object.fromEntries(
  SALARY_EXTRA_CATEGORIES.map((c) => [c.id, c.label])
);

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function shareOrDownloadFile(blob, fileName, title, text) {
  const file = new File([blob], fileName, { type: blob.type });
  if (
    typeof navigator !== 'undefined' &&
    typeof navigator.share === 'function' &&
    typeof navigator.canShare === 'function' &&
    navigator.canShare({ files: [file] })
  ) {
    try {
      await navigator.share({ title, text, files: [file] });
      return { method: 'shared', fileName };
    } catch (err) {
      if (err?.name === 'AbortError') {
        return { method: 'cancelled', fileName };
      }
    }
  }
  downloadBlob(blob, fileName);
  return { method: 'downloaded', fileName };
}

function escapeCsv(val) {
  const s = String(val ?? '');
  return `"${s.replace(/"/g, '""')}"`;
}

function sortShiftsAscending(shifts = []) {
  return [...shifts].sort((a, b) => {
    const cmp = String(a.startDate || a.date || '').localeCompare(
      String(b.startDate || b.date || '')
    );
    if (cmp !== 0) return cmp;
    return String(a.startTime || '').localeCompare(String(b.startTime || ''));
  });
}

function buildDriverHeaderInfo(profile = {}) {
  const saved = readLocalSettings();
  const driverName = String(saved.driverName || profile.driverName || '').trim();
  const tractorPlate = String(saved.tractorPlate || profile.tractorPlate || '').trim();
  const trailerPlate = String(profile.trailerPlate || getActiveCoupledTrailerPlate() || '').trim();
  const companyName = String(saved.companyName || profile.companyName || '').trim();
  const userEmail = String(profile.userEmail || '').trim();

  const parts = [];
  if (driverName) parts.push(`Motorista: ${driverName}`);
  else if (userEmail) parts.push(`Conta: ${userEmail}`);
  if (tractorPlate) parts.push(`Trator: ${tractorPlate}`);
  if (trailerPlate) parts.push(`Reboque: ${trailerPlate}`);
  if (companyName) parts.push(`Empresa: ${companyName}`);

  return {
    driverName,
    line: parts.join('  ·  '),
  };
}

function renderPdfCorporateHeader(doc, { title, subtitle, driverLine, margin, pageW }) {
  doc.setFillColor(23, 105, 210);
  doc.rect(0, 0, pageW, 4, 'F');

  doc.setFontSize(16);
  doc.setTextColor(32, 41, 56);
  doc.text(title, margin, 15);

  doc.setFontSize(9);
  doc.setTextColor(102, 112, 133);
  doc.text(subtitle, margin, 20.5);

  if (driverLine) {
    doc.setFillColor(243, 245, 248);
    doc.roundedRect(margin, 23, pageW - margin * 2, 8.5, 1.8, 1.8, 'F');
    doc.setFontSize(8.5);
    doc.setTextColor(32, 41, 56);
    doc.text(driverLine, margin + 3, 28.5, { maxWidth: pageW - margin * 2 - 6 });
    return 36;
  }

  return 27;
}

function renderDriverSignatureBlock(doc, { y, pageH, margin, pageW, driverName }) {
  let cursorY = y;
  if (cursorY + 26 > pageH - 14) {
    doc.addPage();
    cursorY = 16;
  }

  cursorY += 8;
  doc.setDrawColor(148, 163, 184);
  doc.line(margin, cursorY + 8, margin + 84, cursorY + 8);
  doc.line(pageW - margin - 46, cursorY + 8, pageW - margin, cursorY + 8);

  doc.setFontSize(8);
  doc.setTextColor(102, 112, 133);
  doc.text(
    driverName ? `Assinatura do Motorista — ${driverName}` : 'Assinatura do Motorista',
    margin,
    cursorY + 13
  );
  doc.text('Data / Conferência', pageW - margin - 46, cursorY + 13);
}

function addPdfPageNumbers(doc, footerPrefix, margin, pageH) {
  const pageCount = doc.internal.getNumberOfPages();
  for (let p = 1; p <= pageCount; p += 1) {
    doc.setPage(p);
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text(`${footerPrefix} · Página ${p}/${pageCount}`, margin, pageH - 7);
  }
}

function loadReceiptImageForPdf(src) {
  return new Promise((resolve) => {
    if (!src) {
      resolve(null);
      return;
    }
    const img = new Image();
    img.onload = () => {
      const width = img.naturalWidth || img.width || 800;
      const height = img.naturalHeight || img.height || 1000;
      if (src.startsWith('data:image/jpeg') || src.startsWith('data:image/jpg')) {
        resolve({ dataUrl: src, format: 'JPEG', width, height });
        return;
      }
      if (src.startsWith('data:image/png')) {
        resolve({ dataUrl: src, format: 'PNG', width, height });
        return;
      }
      try {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve({
          dataUrl: canvas.toDataURL('image/jpeg', 0.85),
          format: 'JPEG',
          width,
          height,
        });
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/**
 * Exporta o fechamento mensal (salário, turnos e extras) em PDF A4 carregando jsPDF sob demanda.
 */
export async function exportMonthlyReportPdf({
  monthKey,
  monthLabel,
  shifts = [],
  stats = {},
  extras = [],
  shiftValuesMap = new Map(),
  driverProfile = {},
}) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 12;

  const { driverName, line: driverLine } = buildDriverHeaderInfo(driverProfile);
  let y = renderPdfCorporateHeader(doc, {
    title: `TruckFlow EU — Fechamento ${monthLabel}`,
    subtitle: `Gerado em ${new Date().toLocaleDateString('pt-PT')} · Período: ${monthKey}`,
    driverLine,
    margin,
    pageW,
  });

  const checkPageBreak = (needed = 12) => {
    if (y + needed > pageH - 14) {
      doc.addPage();
      y = 16;
    }
  };

  // Bloco Resumo Financeiro
  doc.setFillColor(241, 245, 249);
  doc.roundedRect(margin, y, pageW - margin * 2, 34, 2, 2, 'F');
  doc.setTextColor(15, 23, 42);
  doc.setFontSize(10);

  const kmModeLabel = stats.thresholdReached
    ? stats.retroactiveBonus
      ? `Retroativo ${formatRate(stats.rateBonus)}/km`
      : `Escalonado ${formatRate(stats.rateStandard)} / ${formatRate(stats.rateBonus)}`
    : `Padrão ${formatRate(stats.rateStandard)}/km`;

  doc.text(`Ordenado Base: ${formatEuro(stats.baseSalary)}`, margin + 4, y + 7);
  doc.text(
    `Quilometragem (${formatKm(stats.totalKm)} km · ${kmModeLabel}): ${formatEuro(
      stats.kmEarnings
    )}`,
    margin + 4,
    y + 13
  );
  doc.text(
    `Fins de Semana (${stats.weekendsCount}× × ${formatEuro(
      stats.weekendBonusValue
    )}): ${formatEuro(stats.weekendEarnings)}`,
    margin + 4,
    y + 19
  );
  doc.text(
    `Extras do Mês (${extras.length}): ${formatEuro(stats.extrasTotal)}`,
    margin + 4,
    y + 25
  );

  doc.setFontSize(12);
  doc.setTextColor(4, 120, 87);
  doc.text(
    `SALÁRIO TOTAL ESTIMADO: ${formatEuro(stats.estimatedSalary)}`,
    margin + 4,
    y + 31.5
  );
  y += 42;

  // Tabela de Turnos
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text(`Turnos Registrados (${shifts.length})`, margin, y);
  y += 5;

  doc.setFillColor(30, 41, 59);
  doc.rect(margin, y, pageW - margin * 2, 7, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(8);
  doc.text('Data', margin + 2, y + 4.8);
  doc.text('Rota / Locais', margin + 26, y + 4.8);
  doc.text('Odômetro', margin + 96, y + 4.8);
  doc.text('Distância', margin + 134, y + 4.8);
  doc.text('FDS', margin + 158, y + 4.8);
  doc.text('Valor (€)', margin + 170, y + 4.8);
  y += 8.5;

  const ordered = sortShiftsAscending(shifts);
  doc.setTextColor(30, 41, 59);

  if (ordered.length === 0) {
    doc.setFontSize(9);
    doc.text('Nenhum turno registrado neste mês.', margin + 2, y + 4);
    y += 10;
  } else {
    ordered.forEach((s, idx) => {
      checkPageBreak(10);
      if (idx % 2 === 1) {
        doc.setFillColor(248, 250, 252);
        doc.rect(margin, y - 3.5, pageW - margin * 2, 7.5, 'F');
      }
      const sDate = s.startDate || s.date || '--';
      const dist =
        typeof s.distanceKm === 'number'
          ? s.distanceKm
          : Math.max(0, (Number(s.kmFinal) || 0) - (Number(s.kmInicial) || 0));
      const val = shiftValuesMap.get(s.id) ?? 0;
      const dur =
        s.status !== 'open'
          ? calculateShiftDurationLabel(
              sDate,
              s.startTime,
              s.endDate || sDate,
              s.endTime
            )
          : 'Aberto';
      const routeText = [s.startLocation, s.endLocation, s.notes]
        .filter(Boolean)
        .join(' -> ')
        .slice(0, 38);

      doc.setFontSize(8);
      doc.text(`${sDate.slice(5)}${dur ? ` (${dur})` : ''}`, margin + 2, y);
      doc.text(routeText || '-', margin + 26, y);
      doc.text(
        `${formatKm(s.kmInicial)}-${s.status === 'open' ? '?' : formatKm(s.kmFinal)}`,
        margin + 96,
        y
      );
      doc.text(
        s.status === 'open' ? '--' : `${formatKm(dist)} km`,
        margin + 134,
        y
      );
      doc.text(s.weekendOut ? 'Sim' : '-', margin + 158, y);
      doc.text(
        s.status === 'open' ? '--' : formatEuro(val),
        margin + 170,
        y
      );
      y += 7;
    });
  }

  // Seção de Extras
  if (extras.length > 0) {
    checkPageBreak(18);
    y += 4;
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text(`Extras Adicionais (${extras.length})`, margin, y);
    y += 6;
    doc.setFontSize(8.5);
    extras.forEach((item) => {
      checkPageBreak(7);
      const cat = EXTRA_CATEGORY_MAP[item.category] || 'Extra';
      doc.text(
        `• ${cat}: ${item.label} — ${formatEuro(item.amount)}`,
        margin + 2,
        y
      );
      y += 5.5;
    });
  }

  renderDriverSignatureBlock(doc, { y, pageH, margin, pageW, driverName });
  addPdfPageNumbers(
    doc,
    `TruckFlow EU · Fechamento ${monthKey}`,
    margin,
    pageH
  );

  const fileName = `TruckFlow_Fechamento_${monthKey}.pdf`;
  const pdfBlob = doc.output('blob');
  return shareOrDownloadFile(
    pdfBlob,
    fileName,
    `Fechamento ${monthLabel}`,
    `Relatório salarial TruckFlow EU — ${monthLabel}: ${formatEuro(
      stats.estimatedSalary
    )}`
  );
}

/**
 * Exporta turnos, extras e totais do mês em CSV compatível com Excel (UTF-8 BOM + ';').
 */
export function exportMonthlyReportCsv({
  monthKey,
  shifts = [],
  stats = {},
  extras = [],
  shiftValuesMap = new Map(),
}) {
  const lines = [
    [
      'Data Início',
      'Hora Início',
      'Local Início',
      'Data Fim',
      'Hora Fim',
      'Local Fim',
      'KM Inicial',
      'KM Final',
      'Distância (km)',
      'FDS Fora',
      'Valor KM (€)',
      'Notas',
    ].join(';'),
  ];

  const ordered = sortShiftsAscending(shifts);
  ordered.forEach((s) => {
    const dist =
      typeof s.distanceKm === 'number'
        ? s.distanceKm
        : Math.max(0, (Number(s.kmFinal) || 0) - (Number(s.kmInicial) || 0));
    const val = shiftValuesMap.get(s.id) ?? 0;
    lines.push(
      [
        escapeCsv(s.startDate || s.date),
        escapeCsv(s.startTime || ''),
        escapeCsv(s.startLocation || ''),
        escapeCsv(s.endDate || ''),
        escapeCsv(s.endTime || ''),
        escapeCsv(s.endLocation || ''),
        s.kmInicial ?? 0,
        s.kmFinal ?? 0,
        dist,
        s.weekendOut ? 'Sim' : 'Não',
        val.toFixed(2).replace('.', ','),
        escapeCsv(s.notes || ''),
      ].join(';')
    );
  });

  if (extras.length > 0) {
    lines.push('');
    lines.push('Extras Salariais;Categoria;Descrição;Valor (€)');
    extras.forEach((item) => {
      lines.push(
        [
          escapeCsv(item.monthKey),
          escapeCsv(EXTRA_CATEGORY_MAP[item.category] || item.category),
          escapeCsv(item.label),
          Number(item.amount || 0).toFixed(2).replace('.', ','),
        ].join(';')
      );
    });
  }

  lines.push('');
  lines.push(`Ordenado Base;${Number(stats.baseSalary || 0).toFixed(2).replace('.', ',')}`);
  lines.push(`Total KM;${Math.round(stats.totalKm || 0)}`);
  lines.push(`Ganhos KM;${Number(stats.kmEarnings || 0).toFixed(2).replace('.', ',')}`);
  lines.push(`Fins de Semana (${stats.weekendsCount || 0});${Number(stats.weekendEarnings || 0).toFixed(2).replace('.', ',')}`);
  lines.push(`Extras;${Number(stats.extrasTotal || 0).toFixed(2).replace('.', ',')}`);
  lines.push(`Salário Estimado Total;${Number(stats.estimatedSalary || 0).toFixed(2).replace('.', ',')}`);

  const fileName = `TruckFlow_Fechamento_${monthKey}.csv`;
  const blob = new Blob([`\uFEFF${lines.join('\r\n')}`], {
    type: 'text/csv;charset=utf-8;',
  });
  downloadBlob(blob, fileName);
  return { fileName };
}

/**
 * Exporta relatório mensal de despesas/reembolsos em PDF A4 (com fotos dos recibos anexadas).
 */
export async function exportExpensesReportPdf({
  monthKey,
  monthLabel,
  expenses = [],
  totals = {},
  categoryLabels = {},
  driverProfile = {},
}) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 12;

  const { driverName, line: driverLine } = buildDriverHeaderInfo(driverProfile);
  let y = renderPdfCorporateHeader(doc, {
    title: `TruckFlow EU — Despesas ${monthLabel}`,
    subtitle: `Gerado em ${new Date().toLocaleDateString('pt-PT')} · Período: ${monthKey}`,
    driverLine,
    margin,
    pageW,
  });

  doc.setFillColor(241, 245, 249);
  doc.roundedRect(margin, y, pageW - margin * 2, 22, 2, 2, 'F');
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  doc.text(`Total Geral: ${formatEuro(totals.total)}`, margin + 4, y + 7);
  doc.text(`Reembolsável (Empresa): ${formatEuro(totals.reimbursable)}`, margin + 4, y + 13);
  doc.text(`Pessoal: ${formatEuro(totals.personal)}`, margin + 4, y + 19);
  y += 28;

  doc.setFillColor(30, 41, 59);
  doc.rect(margin, y, pageW - margin * 2, 7, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(8);
  doc.text('Data', margin + 2, y + 4.8);
  doc.text('Categoria', margin + 28, y + 4.8);
  doc.text('Descrição', margin + 62, y + 4.8);
  doc.text('Tipo', margin + 142, y + 4.8);
  doc.text('Valor (€)', margin + 170, y + 4.8);
  y += 8.5;

  const ordered = [...expenses].sort((a, b) =>
    String(a.date || '').localeCompare(String(b.date || ''))
  );
  doc.setTextColor(30, 41, 59);
  ordered.forEach((exp, idx) => {
    if (y > pageH - 16) {
      doc.addPage();
      y = 16;
    }
    if (idx % 2 === 1) {
      doc.setFillColor(248, 250, 252);
      doc.rect(margin, y - 3.5, pageW - margin * 2, 7, 'F');
    }
    doc.text(exp.date || '--', margin + 2, y);
    doc.text(categoryLabels[exp.category] || exp.category || '-', margin + 28, y);
    doc.text(String(exp.description || '-').slice(0, 42), margin + 62, y);
    doc.text(exp.reimbursable ? 'Reembolsável' : 'Pessoal', margin + 142, y);
    doc.text(formatEuro(exp.amount), margin + 170, y);
    y += 7;
  });

  renderDriverSignatureBlock(doc, { y, pageH, margin, pageW, driverName });

  // Anexo automático com as fotos dos recibos (4 por página em grade 2x2)
  const resolvedReceipts = await Promise.all(
    ordered.map(async (exp, idx) => {
      const rawSrc = await resolveExpenseReceipt(exp);
      if (!rawSrc) return null;
      const imgInfo = await loadReceiptImageForPdf(rawSrc);
      if (!imgInfo) return null;
      return { index: idx + 1, exp, imgInfo };
    })
  );
  const attachedReceipts = resolvedReceipts.filter(Boolean);

  if (attachedReceipts.length > 0) {
    const colGap = 6;
    const rowGap = 6;
    const cellW = (pageW - margin * 2 - colGap) / 2;
    const topStart = 24;
    const cellH = (pageH - topStart - 16 - rowGap) / 2;

    for (let i = 0; i < attachedReceipts.length; i += 4) {
      doc.addPage();
      doc.setFillColor(23, 105, 210);
      doc.rect(0, 0, pageW, 4, 'F');

      doc.setFontSize(13);
      doc.setTextColor(32, 41, 56);
      doc.text(
        `Anexo — Comprovantes e Recibos (${attachedReceipts.length})`,
        margin,
        16
      );

      const batch = attachedReceipts.slice(i, i + 4);
      batch.forEach((entry, slot) => {
        const col = slot % 2;
        const row = Math.floor(slot / 2);
        const cx = margin + col * (cellW + colGap);
        const cy = topStart + row * (cellH + rowGap);

        doc.setDrawColor(203, 213, 225);
        doc.setFillColor(248, 250, 252);
        doc.roundedRect(cx, cy, cellW, cellH, 2, 2, 'FD');

        const { index, exp, imgInfo } = entry;
        const cat = categoryLabels[exp.category] || exp.category || 'Recibo';
        doc.setFontSize(8.5);
        doc.setTextColor(32, 41, 56);
        doc.text(
          `#${index} · ${exp.date || '--'} · ${cat} · ${formatEuro(exp.amount)}`,
          cx + 3,
          cy + 6
        );

        doc.setFontSize(7.5);
        doc.setTextColor(102, 112, 133);
        const metaLine = `${exp.reimbursable ? 'Reembolsável' : 'Pessoal'}${
          exp.description ? ` · ${exp.description}` : ''
        }`.slice(0, 52);
        doc.text(metaLine, cx + 3, cy + 11);

        const boxX = cx + 3;
        const boxY = cy + 14;
        const boxW = cellW - 6;
        const boxH = cellH - 17;
        const ratio = imgInfo.width / imgInfo.height;
        let renderW = boxW;
        let renderH = renderW / ratio;
        if (renderH > boxH) {
          renderH = boxH;
          renderW = renderH * ratio;
        }
        const ix = boxX + (boxW - renderW) / 2;
        const iy = boxY + (boxH - renderH) / 2;

        doc.addImage(
          imgInfo.dataUrl,
          imgInfo.format,
          ix,
          iy,
          renderW,
          renderH,
          undefined,
          'FAST'
        );
      });
    }
  }

  addPdfPageNumbers(
    doc,
    `TruckFlow EU · Despesas ${monthKey}`,
    margin,
    pageH
  );

  const fileName = `TruckFlow_Despesas_${monthKey}.pdf`;
  const pdfBlob = doc.output('blob');
  return shareOrDownloadFile(
    pdfBlob,
    fileName,
    `Despesas ${monthLabel}`,
    `Relatório de despesas TruckFlow EU — ${monthLabel}: ${formatEuro(totals.reimbursable)} reembolsável`
  );
}

/**
 * Exporta despesas do mês em CSV.
 */
export function exportExpensesReportCsv({
  monthKey,
  expenses = [],
  totals = {},
  categoryLabels = {},
}) {
  const lines = ['Data;Categoria;Descrição;Tipo;Valor (€)'];
  const ordered = [...expenses].sort((a, b) =>
    String(a.date || '').localeCompare(String(b.date || ''))
  );
  ordered.forEach((exp) => {
    lines.push(
      [
        escapeCsv(exp.date),
        escapeCsv(categoryLabels[exp.category] || exp.category),
        escapeCsv(exp.description || ''),
        exp.reimbursable ? 'Reembolsável' : 'Pessoal',
        Number(exp.amount || 0).toFixed(2).replace('.', ','),
      ].join(';')
    );
  });
  lines.push('');
  lines.push(`Total Reembolsável;${Number(totals.reimbursable || 0).toFixed(2).replace('.', ',')}`);
  lines.push(`Total Pessoal;${Number(totals.personal || 0).toFixed(2).replace('.', ',')}`);
  lines.push(`Total Geral;${Number(totals.total || 0).toFixed(2).replace('.', ',')}`);

  const fileName = `TruckFlow_Despesas_${monthKey}.csv`;
  const blob = new Blob([`\uFEFF${lines.join('\r\n')}`], {
    type: 'text/csv;charset=utf-8;',
  });
  downloadBlob(blob, fileName);
  return { fileName };
}
