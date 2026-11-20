import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  Share2,
  Download,
  Trash2,
  FileText,
  AlertCircle,
  CheckCircle2,
  MessageCircle,
  Crop,
  Image as ImageIcon,
  Search,
  ChevronLeft,
  ChevronRight,
  X,
  Plus,
  Eye,
  ScanText,
  History,
  Check,
  RotateCcw,
  Loader2,
  Truck,
  Clock,
} from 'lucide-react';
import {
  buildCmrFileName,
  buildCmrShareSummary,
  createCmrPdfFile,
  detectDocumentCornersFromImage,
  generateCmrPdf,
  processCmrImageToCanvas,
  readFileAsDataUrl,
  shareOrDownloadCmrPdf,
  triggerPdfDownload,
} from '../../utils/cmrScanner';
import {
  CMR_STATUS_OPTIONS,
  extractCmrFieldsViaOcr,
} from '../../utils/cmrOcr';
import { DEFAULT_CROP_CORNERS } from '../../utils/cmrGeometry';
import {
  appendCmrSendEvent,
  deleteCmrRecord,
  resolveCmrPages,
  saveCmrRecord,
  subscribeCmrRecords,
} from '../../services/cmrService';
import { getActiveCoupledTrailerInfo } from '../../services/trailerService';
import {
  formatMonthLabel,
  getLocalDateISO,
  getMonthKey,
} from '../../utils/salaryCalculator';
import ConfirmModal from '../../components/ui/ConfirmModal';
import ImageLightbox from '../../components/ui/ImageLightbox';
import CmrCropModal from './CmrCropModal';

const CONTRAST_MODES = [
  { id: 'color', label: 'Cor Limpa' },
  { id: 'normal', label: 'Normal' },
  { id: 'high', label: 'Contraste' },
  { id: 'ultra', label: 'Ultra P&B' },
];

const MAX_PAGES_PER_PDF = 10;

const STATUS_BADGE_CLASSES = {
  received: 'bg-slate-500/12 text-slate-700 dark:text-slate-300',
  signed: 'bg-[var(--ios-blue)]/12 text-[var(--ios-blue)]',
  scanned: 'bg-[var(--ios-orange)]/15 text-[#B45309] dark:text-[#F59E0B]',
  sent: 'bg-[var(--ios-green)]/15 text-[var(--ios-green)]',
};

const ACTION_LABELS = {
  shared: 'Compartilhamento do dispositivo aberto',
  downloaded: 'PDF baixado no dispositivo',
  whatsapp_opened: 'WhatsApp aberto com dados do CMR',
  confirmed_manual: 'Envio confirmado manualmente',
  status_change: 'Status atualizado',
};

function getStatusLabel(statusId) {
  return (
    CMR_STATUS_OPTIONS.find((opt) => opt.id === statusId)?.label || 'Escaneado'
  );
}

function formatEventTime(isoStr) {
  if (!isoStr) return '--';
  const dt = new Date(isoStr);
  if (Number.isNaN(dt.getTime())) return String(isoStr).slice(0, 16);
  return new Intl.DateTimeFormat('pt-PT', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(dt);
}

export default function CmrModule({ user }) {
  const [records, setRecords] = useState([]);
  const [cmrNumber, setCmrNumber] = useState('');
  const [loadNumber, setLoadNumber] = useState('');
  const [sender, setSender] = useState('');
  const [recipient, setRecipient] = useState('');
  const [trailerPlate, setTrailerPlate] = useState('');
  const [sealNumber, setSealNumber] = useState('');
  const [status, setStatus] = useState('received');
  const [date, setDate] = useState(getLocalDateISO);
  const [notes, setNotes] = useState('');
  const [contrastMode, setContrastMode] = useState('high');

  const [pages, setPages] = useState([]);
  const [selectedPageIdx, setSelectedPageIdx] = useState(0);
  const [cropSession, setCropSession] = useState(null);
  const [activeDraftRecordId, setActiveDraftRecordId] = useState(null);

  const [processing, setProcessing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [ocrRunning, setOcrRunning] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [ocrMessage, setOcrMessage] = useState('');

  const [preparedPdf, setPreparedPdf] = useState(null);
  const [readyCardPdf, setReadyCardPdf] = useState(null);

  const [statusMessage, setStatusMessage] = useState('');
  const [pendingConfirmRecordId, setPendingConfirmRecordId] = useState(null);
  const [lastSharePayload, setLastSharePayload] = useState(null);
  const [error, setError] = useState('');

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [monthFilter, setMonthFilter] = useState('all');
  const [expandedHistoryIds, setExpandedHistoryIds] = useState({});

  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [lightboxState, setLightboxState] = useState({
    isOpen: false,
    images: [],
    initialIndex: 0,
  });

  const cameraInputRef = useRef(null);
  const galleryInputRef = useRef(null);
  const contrastModeRef = useRef(contrastMode);
  contrastModeRef.current = contrastMode;

  const ocrRunSeqRef = useRef(0);
  const fieldsRef = useRef({});
  fieldsRef.current = {
    cmrNumber,
    loadNumber,
    sender,
    recipient,
    trailerPlate,
    sealNumber,
    status,
  };

  useEffect(() => {
    const unsub = subscribeCmrRecords(user?.uid || null, (list) => {
      setRecords(list);
    });
    return () => unsub();
  }, [user?.uid]);

  const coupledTrailer = useMemo(
    () => getActiveCoupledTrailerInfo(),
    [records, trailerPlate, sealNumber]
  );

  const previewFileName = buildCmrFileName(
    date,
    loadNumber || (cmrNumber ? '' : '00000'),
    cmrNumber
  );

  const currentPrepKey = useMemo(() => {
    const pageSig = pages
      .map((p) => `${p.id}:${p.processedScan?.scanDataUrl?.length || 0}`)
      .join('|');
    return `${date}|${cmrNumber.trim()}|${loadNumber.trim()}|${notes.trim()}|${pageSig}`;
  }, [pages, date, cmrNumber, loadNumber, notes]);

  // Pré-gera o arquivo PDF em memória sempre que houver páginas prontas para garantir
  // abertura da folha de compartilhamento logo no 1º toque (preservando gesto do usuário).
  useEffect(() => {
    if (pages.length === 0 || (!loadNumber.trim() && !cmrNumber.trim())) {
      setPreparedPdf(null);
      return undefined;
    }

    const scanUrls = pages
      .map((p) => p.processedScan?.scanDataUrl)
      .filter(Boolean);
    if (scanUrls.length === 0) {
      setPreparedPdf(null);
      return undefined;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const result = await generateCmrPdf(scanUrls, {
          date,
          loadNumber,
          cmrNumber,
          notes,
        });
        if (cancelled) return;
        const file = createCmrPdfFile(result.pdfBlob, result.fileName);
        setPreparedPdf({
          key: currentPrepKey,
          ...result,
          file,
        });
      } catch {
        if (!cancelled) setPreparedPdf(null);
      }
    }, 180);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [pages, date, loadNumber, cmrNumber, notes, currentPrepKey]);

  const runOcrOnImage = async (scanDataUrl, { overwriteEmptyOnly = true } = {}) => {
    if (!scanDataUrl) return;
    const seq = ++ocrRunSeqRef.current;
    setOcrRunning(true);
    setOcrProgress(0);
    setOcrMessage('Lendo campos via OCR...');

    try {
      const ocr = await extractCmrFieldsViaOcr(scanDataUrl, (pct) => {
        if (ocrRunSeqRef.current === seq) {
          setOcrProgress(pct);
        }
      });
      if (ocrRunSeqRef.current !== seq) return;

      const cur = fieldsRef.current;
      let filledCount = 0;

      if ((!overwriteEmptyOnly || !cur.cmrNumber) && ocr.cmrNumber) {
        setCmrNumber(ocr.cmrNumber);
        filledCount += 1;
      }
      if ((!overwriteEmptyOnly || !cur.loadNumber) && ocr.loadNumber) {
        setLoadNumber(ocr.loadNumber);
        filledCount += 1;
      }
      if ((!overwriteEmptyOnly || !cur.sender) && ocr.sender) {
        setSender(ocr.sender);
        filledCount += 1;
      }
      if ((!overwriteEmptyOnly || !cur.recipient) && ocr.recipient) {
        setRecipient(ocr.recipient);
        filledCount += 1;
      }
      if ((!overwriteEmptyOnly || !cur.trailerPlate) && ocr.trailerPlate) {
        setTrailerPlate(ocr.trailerPlate);
        filledCount += 1;
      }
      if ((!overwriteEmptyOnly || !cur.sealNumber) && ocr.sealNumber) {
        setSealNumber(ocr.sealNumber);
        filledCount += 1;
      }

      if (cur.status !== 'sent') {
        setStatus((prev) =>
          prev === 'sent' ? 'sent' : ocr.suggestedStatus || 'scanned'
        );
      }

      setOcrMessage(
        filledCount > 0
          ? `OCR: ${filledCount} campo${filledCount > 1 ? 's' : ''} preenchido${
              filledCount > 1 ? 's' : ''
            } — confira abaixo`
          : 'OCR concluído — complete ou confira os campos manualmente'
      );
    } catch {
      if (ocrRunSeqRef.current === seq) {
        setOcrMessage('OCR indisponível nesta imagem — preencha manualmente');
      }
    } finally {
      if (ocrRunSeqRef.current === seq) {
        setOcrRunning(false);
      }
    }
  };

  const handleResetDraft = () => {
    ocrRunSeqRef.current += 1;
    setPages([]);
    setSelectedPageIdx(0);
    setActiveDraftRecordId(null);
    setPendingConfirmRecordId(null);
    setLastSharePayload(null);
    setPreparedPdf(null);
    setCmrNumber('');
    setLoadNumber('');
    setSender('');
    setRecipient('');
    setTrailerPlate('');
    setSealNumber('');
    setNotes('');
    setStatus('received');
    setOcrRunning(false);
    setOcrProgress(0);
    setOcrMessage('');
    setStatusMessage('');
    setError('');
  };

  const handleContrastChange = async (nextMode) => {
    if (nextMode === contrastMode) return;
    setContrastMode(nextMode);
    if (pages.length === 0) return;

    setProcessing(true);
    setError('');
    try {
      const updated = await Promise.all(
        pages.map(async (p) => {
          const processedScan = await processCmrImageToCanvas(
            p.croppedImageUrl,
            nextMode
          );
          return { ...p, processedScan };
        })
      );
      setPages(updated);
    } catch (err) {
      setError(err.message || 'Erro ao aplicar filtro scanner.');
    } finally {
      setProcessing(false);
    }
  };

  const handleFileSelected = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    setStatusMessage('');

    if (pages.length >= MAX_PAGES_PER_PDF) {
      setError(`Limite de ${MAX_PAGES_PER_PDF} páginas por PDF atingido.`);
      e.target.value = '';
      return;
    }

    try {
      const dataUrl = await readFileAsDataUrl(file);
      const { detected, corners } = await detectDocumentCornersFromImage(
        dataUrl
      );
      setCropSession({
        mode: 'add',
        pageId: `pg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        rawImageUrl: dataUrl,
        corners,
        autoDetected: detected,
      });
    } catch (err) {
      setError(err.message || 'Erro ao abrir imagem selecionada.');
    } finally {
      e.target.value = '';
    }
  };

  const handleApplyCrop = async ({
    croppedDataUrl,
    currentRawDataUrl,
    corners,
  }) => {
    const session = cropSession;
    setCropSession(null);
    if (!session) return;

    setProcessing(true);
    setError('');
    try {
      const processedScan = await processCmrImageToCanvas(
        croppedDataUrl,
        contrastModeRef.current
      );

      let isFirstPage = false;
      if (session.mode === 'edit') {
        isFirstPage = pages[0]?.id === session.pageId;
        setPages((prev) =>
          prev.map((p) =>
            p.id === session.pageId
              ? {
                  ...p,
                  rawImageUrl: currentRawDataUrl,
                  croppedImageUrl: croppedDataUrl,
                  corners,
                  processedScan,
                }
              : p
          )
        );
      } else {
        isFirstPage = pages.length === 0;
        setPages((prev) => {
          const next = [
            ...prev,
            {
              id: session.pageId,
              rawImageUrl: currentRawDataUrl,
              croppedImageUrl: croppedDataUrl,
              corners,
              processedScan,
            },
          ];
          setSelectedPageIdx(next.length - 1);
          return next;
        });
      }

      if (status === 'received') {
        setStatus('scanned');
      }

      if (isFirstPage && processedScan?.scanDataUrl) {
        runOcrOnImage(processedScan.scanDataUrl, { overwriteEmptyOnly: true });
      }
    } catch (err) {
      setError(err.message || 'Erro ao processar recorte do CMR.');
    } finally {
      setProcessing(false);
    }
  };

  const handleMovePage = (idx, dir) => {
    const targetIdx = idx + dir;
    if (targetIdx < 0 || targetIdx >= pages.length) return;
    setPages((prev) => {
      const next = [...prev];
      const tmp = next[idx];
      next[idx] = next[targetIdx];
      next[targetIdx] = tmp;
      return next;
    });
    setSelectedPageIdx(targetIdx);
  };

  const handleRemovePage = (idx) => {
    setPages((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      setSelectedPageIdx((curr) =>
        Math.max(0, Math.min(curr, next.length - 1))
      );
      return next;
    });
  };

  const handleApplyCoupledTrailer = () => {
    if (!coupledTrailer) return;
    if (!trailerPlate.trim()) setTrailerPlate(coupledTrailer.formattedPlate);
    if (!sealNumber.trim() && coupledTrailer.sealNumber) {
      setSealNumber(coupledTrailer.sealNumber);
    }
  };

  const activePage = pages[selectedPageIdx] || pages[0] || null;
  const totalApproxKb = pages.reduce(
    (sum, p) => sum + (p.processedScan?.approxKb || 0),
    0
  );

  const handleGenerateAndShare = async () => {
    setError('');
    setStatusMessage('');

    if (pages.length === 0) {
      setError('Tire uma foto do CMR ou selecione da galeria primeiro.');
      return;
    }

    if (!loadNumber.trim() && !cmrNumber.trim()) {
      setError('Informe o Número do CMR ou da Carga para nomear o arquivo PDF.');
      return;
    }

    setGenerating(true);
    try {
      const meta = {
        date,
        cmrNumber,
        loadNumber: loadNumber || cmrNumber,
        sender,
        recipient,
        trailerPlate,
        sealNumber,
        notes,
      };

      const isPrebuiltReady =
        preparedPdf && preparedPdf.key === currentPrepKey && preparedPdf.file;

      let pdfResult = isPrebuiltReady ? preparedPdf : null;
      let shareOutcome;

      // Toque 1: se o File já estiver pré-gerado, aciona navigator.share ANTES de qualquer await
      if (isPrebuiltReady) {
        shareOutcome = await shareOrDownloadCmrPdf(
          pdfResult.pdfBlob,
          pdfResult.fileName,
          meta,
          pdfResult.file
        );
      } else {
        const scanUrls = pages
          .map((p) => p.processedScan?.scanDataUrl)
          .filter(Boolean);
        pdfResult = await generateCmrPdf(scanUrls, meta);
        shareOutcome = await shareOrDownloadCmrPdf(
          pdfResult.pdfBlob,
          pdfResult.fileName,
          meta
        );
      }

      const eventAction =
        shareOutcome.method === 'shared'
          ? 'shared'
          : shareOutcome.method === 'cancelled'
          ? 'status_change'
          : 'downloaded';
      const eventNote =
        shareOutcome.method === 'shared'
          ? 'Folha de compartilhamento do dispositivo aberta'
          : shareOutcome.method === 'cancelled'
          ? 'Compartilhamento cancelado pelo usuário'
          : 'PDF baixado no dispositivo (fallback sem share nativo)';

      const nextSaveStatus = status === 'received' ? 'scanned' : status;
      const { record: savedRec, records: updated } = await saveCmrRecord(
        user?.uid || null,
        {
          id: activeDraftRecordId || undefined,
          date,
          cmrNumber,
          loadNumber: meta.loadNumber,
          sender,
          recipient,
          trailerPlate,
          sealNumber,
          status: nextSaveStatus,
          notes,
          sizeKb: pdfResult.sizeKb,
          thumbDataUrl: pages[0]?.processedScan?.thumbDataUrl || '',
          scanDataUrl: pages[0]?.processedScan?.scanDataUrl || '',
          pages: pages.map((p) => ({
            id: p.id,
            scanDataUrl: p.processedScan?.scanDataUrl || '',
            thumbDataUrl: p.processedScan?.thumbDataUrl || '',
          })),
          appendEvent: {
            action: eventAction,
            note: eventNote,
          },
        }
      );

      setRecords(updated);
      setActiveDraftRecordId(savedRec.id);
      setPendingConfirmRecordId(savedRec.id);
      setStatus(savedRec.status);
      setLastSharePayload({
        recordId: savedRec.id,
        pdfBlob: pdfResult.pdfBlob,
        fileName: pdfResult.fileName,
        shareText: shareOutcome.shareText || buildCmrShareSummary(meta),
      });

      const pageInfo =
        pdfResult.pageCount > 1 ? ` · ${pdfResult.pageCount} págs` : '';
      if (shareOutcome.method === 'shared') {
        setStatusMessage(
          `PDF ${pdfResult.fileName} (${pdfResult.sizeKb} KB${pageInfo}) entregue ao compartilhamento do dispositivo. Após enviar no WhatsApp, toque em Confirmar Envio.`
        );
      } else if (shareOutcome.method === 'cancelled') {
        setStatusMessage(
          `PDF ${pdfResult.fileName} salvo no histórico. Toque para compartilhar ou confirmar quando enviar.`
        );
      } else {
        setStatusMessage(
          `PDF ${pdfResult.fileName} (${pdfResult.sizeKb} KB${pageInfo}) baixado! Envie o arquivo no WhatsApp e confirme abaixo.`
        );
      }
    } catch (err) {
      setError(err.message || 'Falha ao gerar ou compartilhar o PDF do CMR.');
    } finally {
      setGenerating(false);
    }
  };

  const handleConfirmManualSent = async (recordId) => {
    if (!recordId) return;
    setError('');
    const { record: updatedRec, records: updatedList } =
      await appendCmrSendEvent(user?.uid || null, recordId, {
        action: 'confirmed_manual',
        note: 'Envio confirmado manualmente pelo motorista',
        nextStatus: 'sent',
      });
    setRecords(updatedList);
    if (activeDraftRecordId === recordId) {
      setStatus('sent');
    }
    if (pendingConfirmRecordId === recordId) {
      setPendingConfirmRecordId(null);
    }
    if (updatedRec) {
      setStatusMessage(
        `Envio de ${updatedRec.fileName} confirmado manualmente (status: Enviado).`
      );
    }
  };

  const handleQuickStatusChange = async (rec, nextStatus) => {
    if (!rec || rec.status === nextStatus) return;
    setError('');
    const { records: updatedList } = await appendCmrSendEvent(
      user?.uid || null,
      rec.id,
      {
        action: nextStatus === 'sent' ? 'confirmed_manual' : 'status_change',
        note: `Status alterado para ${getStatusLabel(nextStatus)}`,
        nextStatus,
      }
    );
    setRecords(updatedList);
    if (activeDraftRecordId === rec.id) {
      setStatus(nextStatus);
    }
  };

  const handleReshareRecord = async (rec, mode = 'share') => {
    setError('');
    try {
      if (mode === 'share' && readyCardPdf?.recordId === rec.id) {
        const res = await shareOrDownloadCmrPdf(
          readyCardPdf.pdfBlob,
          readyCardPdf.fileName,
          rec,
          readyCardPdf.file
        );
        setReadyCardPdf(null);
        const { records: updatedList } = await appendCmrSendEvent(
          user?.uid || null,
          rec.id,
          {
            action: res.method === 'shared' ? 'shared' : 'downloaded',
            note:
              res.method === 'shared'
                ? 'Reenviado via compartilhamento do dispositivo'
                : 'PDF baixado para envio',
          }
        );
        setRecords(updatedList);
        setPendingConfirmRecordId(rec.id);
        setLastSharePayload({
          recordId: rec.id,
          pdfBlob: readyCardPdf.pdfBlob,
          fileName: readyCardPdf.fileName,
          shareText: res.shareText || buildCmrShareSummary(rec),
        });
        return;
      }

      const pageUrls = await resolveCmrPages(rec);
      if (pageUrls.length === 0) {
        setError('Imagem completa não disponível para reenvio neste registro.');
        return;
      }
      const { pdfBlob, fileName } = await generateCmrPdf(pageUrls, {
        date: rec.date,
        loadNumber: rec.loadNumber,
        cmrNumber: rec.cmrNumber,
        notes: rec.notes,
      });

      if (mode === 'download') {
        triggerPdfDownload(pdfBlob, fileName);
        const { records: updatedList } = await appendCmrSendEvent(
          user?.uid || null,
          rec.id,
          {
            action: 'downloaded',
            note: 'PDF baixado novamente',
          }
        );
        setRecords(updatedList);
        setStatusMessage(`PDF ${fileName} baixado novamente.`);
      } else {
        const file = createCmrPdfFile(pdfBlob, fileName);
        const res = await shareOrDownloadCmrPdf(pdfBlob, fileName, rec, file);
        const { records: updatedList } = await appendCmrSendEvent(
          user?.uid || null,
          rec.id,
          {
            action:
              res.method === 'shared'
                ? 'shared'
                : res.method === 'cancelled'
                ? 'status_change'
                : 'downloaded',
            note:
              res.method === 'shared'
                ? 'Folha de compartilhamento do dispositivo aberta'
                : res.method === 'cancelled'
                ? 'Compartilhamento cancelado pelo usuário'
                : 'PDF baixado para envio manual no WhatsApp',
          }
        );
        setRecords(updatedList);
        setPendingConfirmRecordId(rec.id);
        setLastSharePayload({
          recordId: rec.id,
          pdfBlob,
          fileName,
          shareText: res.shareText || buildCmrShareSummary(rec),
        });
        if (res.method === 'downloaded') {
          setReadyCardPdf({ recordId: rec.id, pdfBlob, fileName, file });
          setStatusMessage(
            `PDF ${fileName} baixado. Use WhatsApp abaixo ou toque em Confirmar Envio após enviar.`
          );
        }
      }
    } catch (err) {
      setError(err.message || 'Erro ao reabrir PDF.');
    }
  };

  const handleOpenRecordLightbox = async (rec) => {
    const pageUrls = await resolveCmrPages(rec);
    if (pageUrls.length === 0) return;
    setLightboxState({
      isOpen: true,
      images: pageUrls.map((src, idx) => ({
        src,
        label: `${rec.fileName} (${idx + 1}/${pageUrls.length})`,
      })),
      initialIndex: 0,
    });
  };

  const handleConfirmDelete = async () => {
    if (!confirmDeleteId) return;
    const id = confirmDeleteId;
    setConfirmDeleteId(null);
    const updated = await deleteCmrRecord(user?.uid || null, id);
    setRecords(updated);
    if (activeDraftRecordId === id) setActiveDraftRecordId(null);
    if (pendingConfirmRecordId === id) setPendingConfirmRecordId(null);
  };

  const availableMonths = useMemo(() => {
    const set = new Set();
    records.forEach((r) => {
      if (r.date && r.date.length >= 7) set.add(getMonthKey(r.date));
    });
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [records]);

  const filteredRecords = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return records.filter((rec) => {
      const recStatus = rec.status || 'scanned';
      if (statusFilter !== 'all' && recStatus !== statusFilter) {
        return false;
      }
      if (monthFilter !== 'all' && getMonthKey(rec.date) !== monthFilter) {
        return false;
      }
      if (!q) return true;
      return (
        String(rec.cmrNumber || '').toLowerCase().includes(q) ||
        String(rec.loadNumber || '').toLowerCase().includes(q) ||
        String(rec.sender || '').toLowerCase().includes(q) ||
        String(rec.recipient || '').toLowerCase().includes(q) ||
        String(rec.trailerPlate || '').toLowerCase().includes(q) ||
        String(rec.sealNumber || '').toLowerCase().includes(q) ||
        String(rec.fileName || '').toLowerCase().includes(q) ||
        String(rec.notes || '').toLowerCase().includes(q)
      );
    });
  }, [records, searchTerm, statusFilter, monthFilter]);

  const shareButtonReady =
    preparedPdf && preparedPdf.key === currentPrepKey && !generating;

  return (
    <div className="space-y-4 pb-6">
      <section className="ios-card space-y-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[20px] font-bold tracking-tight text-[var(--ios-label)]">
              Scanner de CMR
            </h2>
            <p className="text-[13px] text-[var(--ios-label-secondary)]">
              OCR automático, recorte HD e compartilhamento em 2 toques
            </p>
          </div>
          {(pages.length > 0 || activeDraftRecordId) && (
            <button
              type="button"
              onClick={handleResetDraft}
              className="inline-flex min-h-[36px] shrink-0 items-center gap-1 rounded-xl border ios-sep-border bg-[var(--ios-fill)] px-2.5 text-[12px] font-semibold text-[var(--ios-label-secondary)] transition hover:text-[var(--ios-label)]"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              Novo
            </button>
          )}
        </div>

        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleFileSelected}
          className="hidden"
        />
        <input
          ref={galleryInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileSelected}
          className="hidden"
        />

        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => cameraInputRef.current?.click()}
            className="col-span-2 flex min-h-[52px] items-center justify-center gap-2 rounded-xl bg-[var(--ios-blue)] px-4 text-[15px] font-semibold text-white shadow-sm transition hover:bg-[var(--ios-blue-hover)] active:scale-[0.99]"
          >
            {pages.length > 0 ? (
              <Plus className="h-5 w-5" aria-hidden="true" />
            ) : (
              <Camera className="h-5 w-5" aria-hidden="true" />
            )}
            {pages.length > 0 ? 'Add Página (Câmera)' : 'Novo CMR (Câmera)'}
          </button>

          <button
            type="button"
            onClick={() => galleryInputRef.current?.click()}
            className="flex min-h-[52px] items-center justify-center gap-1.5 rounded-xl border ios-sep-border bg-[var(--ios-card)] px-3 text-[13px] font-semibold text-[var(--ios-label)] shadow-sm transition hover:bg-[var(--ios-fill)] active:scale-95"
          >
            <ImageIcon className="h-4 w-4 text-[var(--ios-blue)]" aria-hidden="true" />
            Galeria
          </button>
        </div>

        {(ocrRunning || ocrMessage) && (
          <div
            className={`flex items-center justify-between gap-2 rounded-xl border px-3.5 py-2.5 text-[12px] font-semibold ${
              ocrRunning
                ? 'border-[var(--ios-blue)]/25 bg-[var(--ios-blue)]/8 text-[var(--ios-blue)]'
                : 'border-[var(--ios-green)]/25 bg-[var(--ios-green)]/8 text-[var(--ios-green)]'
            }`}
          >
            <div className="flex items-center gap-2">
              {ocrRunning ? (
                <Loader2 className="h-4 w-4 animate-spin shrink-0" aria-hidden="true" />
              ) : (
                <ScanText className="h-4 w-4 shrink-0" aria-hidden="true" />
              )}
              <span>
                {ocrRunning
                  ? `Lendo campos via OCR${ocrProgress > 0 ? ` (${ocrProgress}%)` : '...'}`
                  : ocrMessage}
              </span>
            </div>
          </div>
        )}

        {/* Campos Estruturados do CMR */}
        <div className="cp-inset overflow-hidden">
          <div className="grid grid-cols-1 border-b ios-sep-border sm:grid-cols-2">
            <label className="flex min-h-[50px] items-center justify-between gap-3 border-b ios-sep-border px-4 sm:border-b-0 sm:border-r">
              <span className="text-[13px] font-semibold text-[var(--ios-label-secondary)]">
                N.º do CMR
              </span>
              <input
                type="text"
                maxLength={100}
                value={cmrNumber}
                onChange={(e) => setCmrNumber(e.target.value)}
                placeholder="45614"
                className="w-36 bg-transparent text-right text-[15px] font-bold outline-none placeholder:text-[var(--ios-label-tertiary)]"
              />
            </label>

            <label className="flex min-h-[50px] items-center justify-between gap-3 px-4">
              <span className="text-[13px] font-semibold text-[var(--ios-label-secondary)]">
                N.º da Carga
              </span>
              <input
                type="text"
                maxLength={100}
                value={loadNumber}
                onChange={(e) => setLoadNumber(e.target.value)}
                placeholder="84920"
                className="w-36 bg-transparent text-right text-[15px] font-bold outline-none placeholder:text-[var(--ios-label-tertiary)]"
              />
            </label>
          </div>

          <label className="flex min-h-[50px] items-center justify-between gap-3 border-b ios-sep-border px-4">
            <span className="shrink-0 text-[13px] font-semibold text-[var(--ios-label-secondary)]">
              Remetente
            </span>
            <input
              type="text"
              maxLength={200}
              value={sender}
              onChange={(e) => setSender(e.target.value)}
              placeholder="Empresa expedidora (Quadro 1)"
              className="flex-1 bg-transparent text-right text-[14px] font-semibold outline-none placeholder:text-[var(--ios-label-tertiary)]"
            />
          </label>

          <label className="flex min-h-[50px] items-center justify-between gap-3 border-b ios-sep-border px-4">
            <span className="shrink-0 text-[13px] font-semibold text-[var(--ios-label-secondary)]">
              Destinatário
            </span>
            <input
              type="text"
              maxLength={200}
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="Empresa recebedora (Quadro 2)"
              className="flex-1 bg-transparent text-right text-[14px] font-semibold outline-none placeholder:text-[var(--ios-label-tertiary)]"
            />
          </label>

          <div className="grid grid-cols-1 border-b ios-sep-border sm:grid-cols-2">
            <label className="flex min-h-[50px] items-center justify-between gap-3 border-b ios-sep-border px-4 sm:border-b-0 sm:border-r">
              <span className="text-[13px] font-semibold text-[var(--ios-label-secondary)]">
                Reboque
              </span>
              <input
                type="text"
                maxLength={40}
                value={trailerPlate}
                onChange={(e) => setTrailerPlate(e.target.value.toUpperCase())}
                placeholder="L-1234-BBB"
                className="w-36 bg-transparent text-right text-[14px] font-bold uppercase outline-none placeholder:text-[var(--ios-label-tertiary)]"
              />
            </label>

            <label className="flex min-h-[50px] items-center justify-between gap-3 px-4">
              <span className="text-[13px] font-semibold text-[var(--ios-label-secondary)]">
                N.º do Selo
              </span>
              <input
                type="text"
                maxLength={64}
                value={sealNumber}
                onChange={(e) => setSealNumber(e.target.value.toUpperCase())}
                placeholder="Opcional"
                className="w-36 bg-transparent text-right text-[14px] font-bold uppercase outline-none placeholder:text-[var(--ios-label-tertiary)]"
              />
            </label>
          </div>

          <div className="grid grid-cols-1 border-b ios-sep-border sm:grid-cols-2">
            <label className="flex min-h-[50px] items-center justify-between gap-3 border-b ios-sep-border px-4 sm:border-b-0 sm:border-r">
              <span className="text-[13px] font-semibold text-[var(--ios-label-secondary)]">
                Data
              </span>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="bg-transparent text-right text-[14px] font-semibold outline-none"
              />
            </label>

            <label className="flex min-h-[50px] items-center justify-between gap-3 px-4">
              <span className="shrink-0 text-[13px] font-semibold text-[var(--ios-label-secondary)]">
                Nota
              </span>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Descarga OK"
                className="flex-1 bg-transparent text-right text-[14px] outline-none placeholder:text-[var(--ios-label-tertiary)]"
              />
            </label>
          </div>

          {/* Sugestão rápida do engate ativo quando Reboque/Selo estiverem vazios */}
          {coupledTrailer && (!trailerPlate.trim() || !sealNumber.trim()) && (
            <div className="flex items-center justify-between gap-2 bg-[var(--ios-blue)]/[0.05] px-4 py-2 text-[12px]">
              <span className="flex items-center gap-1.5 text-[var(--ios-label-secondary)]">
                <Truck className="h-3.5 w-3.5 text-[var(--ios-blue)]" aria-hidden="true" />
                Engate ativo: <strong>{coupledTrailer.formattedPlate}</strong>
                {coupledTrailer.sealNumber ? ` · Selo ${coupledTrailer.sealNumber}` : ''}
              </span>
              <button
                type="button"
                onClick={handleApplyCoupledTrailer}
                className="shrink-0 rounded-lg bg-[var(--ios-blue)]/12 px-2.5 py-1 text-[11px] font-bold text-[var(--ios-blue)]"
              >
                Preencher
              </button>
            </div>
          )}
        </div>

        {/* Fluxo de 4 Status do Documento */}
        <div className="space-y-1.5">
          <span className="block px-1 text-[11px] font-bold uppercase tracking-wider text-[var(--ios-label-secondary)]">
            Status do CMR
          </span>
          <div className="ios-segmented grid-cols-4">
            {CMR_STATUS_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                aria-selected={status === opt.id}
                onClick={() => setStatus(opt.id)}
                className="ios-segmented-item text-[12px]"
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="cp-inset flex items-center justify-between gap-2 px-3.5 py-2.5 text-[12px]">
          <div className="min-w-0 truncate">
            <span className="font-medium text-[var(--ios-label-secondary)]">
              Arquivo:{' '}
            </span>
            <code className="font-semibold text-[var(--ios-blue)]">
              {previewFileName}
            </code>
          </div>
          {pages.length > 0 && (
            <span className="shrink-0 rounded-full bg-[var(--ios-green)]/12 px-2 py-0.5 font-bold text-[var(--ios-green)]">
              {pages.length}/{MAX_PAGES_PER_PDF} pág.
            </span>
          )}
        </div>

        {pages.length > 0 && (
          <div className="cp-inset space-y-3 p-3.5">
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-bold uppercase tracking-wider text-[var(--ios-label-secondary)]">
                Filtro Scanner
              </span>
              <span className="tabular-nums rounded-full bg-[var(--ios-green)]/12 px-2.5 py-0.5 text-[11px] font-bold text-[var(--ios-green)]">
                ~{totalApproxKb} KB total
              </span>
            </div>

            <div className="ios-segmented grid-cols-4">
              {CONTRAST_MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  aria-selected={contrastMode === m.id}
                  onClick={() => handleContrastChange(m.id)}
                  className="ios-segmented-item"
                >
                  {m.label}
                </button>
              ))}
            </div>

            {/* Faixa de miniaturas multipágina */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              {pages.map((p, idx) => (
                <div
                  key={p.id}
                  className={`relative shrink-0 rounded-xl border-2 p-0.5 transition ${
                    idx === selectedPageIdx
                      ? 'border-[var(--ios-blue)] bg-[var(--ios-card)] shadow-sm'
                      : 'border-transparent opacity-70'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedPageIdx(idx)}
                    aria-label={`Selecionar página ${idx + 1}`}
                    className="block overflow-hidden rounded-lg"
                  >
                    <img
                      src={p.processedScan?.thumbDataUrl || p.croppedImageUrl}
                      alt={`Página ${idx + 1}`}
                      className="h-16 w-12 object-cover"
                    />
                  </button>
                  <span className="pointer-events-none absolute bottom-1 left-1 rounded bg-slate-900/80 px-1 text-[10px] font-bold text-white">
                    {idx + 1}
                  </span>
                  <button
                    type="button"
                    aria-label={`Remover página ${idx + 1}`}
                    onClick={() => handleRemovePage(idx)}
                    className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--ios-red)] text-white shadow-sm"
                  >
                    <X className="h-3 w-3" aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>

            {/* Controles da página selecionada */}
            {activePage && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setCropSession({
                          mode: 'edit',
                          pageId: activePage.id,
                          rawImageUrl: activePage.rawImageUrl,
                          corners: activePage.corners || DEFAULT_CROP_CORNERS,
                        })
                      }
                      className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-[var(--ios-blue)]/25 bg-[var(--ios-blue)]/10 px-3 text-[12px] font-bold text-[var(--ios-blue)]"
                    >
                      <Crop className="h-3.5 w-3.5" aria-hidden="true" />
                      Recortar / Girar Pág. {selectedPageIdx + 1}
                    </button>

                    <button
                      type="button"
                      disabled={ocrRunning || processing}
                      onClick={() =>
                        runOcrOnImage(activePage.processedScan?.scanDataUrl, {
                          overwriteEmptyOnly: false,
                        })
                      }
                      className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-[var(--ios-green)]/30 bg-[var(--ios-green)]/10 px-3 text-[12px] font-bold text-[var(--ios-green)] disabled:opacity-50"
                    >
                      <ScanText className="h-3.5 w-3.5" aria-hidden="true" />
                      Ler Campos (OCR)
                    </button>
                  </div>

                  {pages.length > 1 && (
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={selectedPageIdx === 0}
                        onClick={() => handleMovePage(selectedPageIdx, -1)}
                        aria-label="Mover página para trás"
                        className="flex h-8 w-8 items-center justify-center rounded-lg border ios-sep-border bg-[var(--ios-card)] disabled:opacity-35"
                      >
                        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        disabled={selectedPageIdx >= pages.length - 1}
                        onClick={() => handleMovePage(selectedPageIdx, 1)}
                        aria-label="Mover página para frente"
                        className="flex h-8 w-8 items-center justify-center rounded-lg border ios-sep-border bg-[var(--ios-card)] disabled:opacity-35"
                      >
                        <ChevronRight className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  )}
                </div>

                <div className="overflow-hidden rounded-xl border ios-sep-border bg-slate-900 p-2">
                  {processing ? (
                    <div className="flex h-56 items-center justify-center text-xs text-slate-300">
                      Aplicando recorte e filtro...
                    </div>
                  ) : (
                    activePage.processedScan && (
                      <img
                        src={activePage.processedScan.scanDataUrl}
                        alt={`Preview página ${selectedPageIdx + 1}`}
                        className="mx-auto max-h-96 w-auto rounded object-contain"
                      />
                    )
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 rounded-xl border border-[var(--ios-red)]/25 bg-[var(--ios-red)]/10 p-3 text-[13px] font-medium text-[var(--ios-red)]">
            <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        {(statusMessage || pendingConfirmRecordId) && (
          <div className="space-y-2.5 rounded-xl border border-[var(--ios-green)]/25 bg-[var(--ios-green)]/10 p-3.5 text-[13px] font-medium text-[var(--ios-label)]">
            {statusMessage && (
              <div className="flex items-start gap-2 text-[var(--ios-green)]">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{statusMessage}</span>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {pendingConfirmRecordId && (
                <button
                  type="button"
                  onClick={() => handleConfirmManualSent(pendingConfirmRecordId)}
                  className="inline-flex min-h-[42px] flex-1 items-center justify-center gap-1.5 rounded-xl bg-[var(--ios-green)] px-3 text-[13px] font-bold text-white shadow-sm"
                >
                  <Check className="h-4 w-4" aria-hidden="true" />
                  Confirmar Envio Realizado
                </button>
              )}

              {lastSharePayload && (
                <>
                  <a
                    href={`https://wa.me/?text=${encodeURIComponent(
                      lastSharePayload.shareText
                    )}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => {
                      if (lastSharePayload.recordId) {
                        appendCmrSendEvent(user?.uid || null, lastSharePayload.recordId, {
                          action: 'whatsapp_opened',
                          note: 'WhatsApp aberto pelo botão de apoio',
                        }).then(({ records: updatedList }) =>
                          setRecords(updatedList)
                        );
                      }
                    }}
                    className="inline-flex min-h-[42px] items-center justify-center gap-1.5 rounded-xl border border-[var(--ios-green)]/30 bg-[var(--ios-card)] px-3 text-[13px] font-semibold text-[var(--ios-green)]"
                  >
                    <MessageCircle className="h-4 w-4" aria-hidden="true" />
                    Abrir WhatsApp
                  </a>

                  {lastSharePayload.pdfBlob && (
                    <button
                      type="button"
                      onClick={() => {
                        triggerPdfDownload(
                          lastSharePayload.pdfBlob,
                          lastSharePayload.fileName
                        );
                        if (lastSharePayload.recordId) {
                          appendCmrSendEvent(user?.uid || null, lastSharePayload.recordId, {
                            action: 'downloaded',
                            note: 'PDF baixado pelo botão rápido',
                          }).then(({ records: updatedList }) =>
                            setRecords(updatedList)
                          );
                        }
                      }}
                      className="inline-flex min-h-[42px] items-center justify-center gap-1.5 rounded-xl border ios-sep-border bg-[var(--ios-card)] px-3 text-[13px] font-semibold text-[var(--ios-blue)]"
                    >
                      <Download className="h-4 w-4" aria-hidden="true" />
                      Baixar PDF
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        <button
          type="button"
          disabled={generating || processing || pages.length === 0}
          onClick={handleGenerateAndShare}
          className={`flex min-h-[52px] w-full items-center justify-center gap-2 rounded-xl px-4 text-[15px] font-semibold transition active:scale-[0.99] ${
            pages.length > 0
              ? 'bg-[var(--ios-green)] text-white shadow-sm'
              : 'border ios-sep-border bg-[var(--ios-fill)] cursor-not-allowed text-[var(--ios-label-tertiary)]'
          }`}
        >
          <Share2 className="h-5 w-5" aria-hidden="true" />
          {generating
            ? 'Gerando e Abrindo...'
            : shareButtonReady
            ? `1º Toque: Compartilhar PDF${pages.length > 1 ? ` (${pages.length} págs)` : ''}`
            : `Gerar PDF${pages.length > 1 ? ` (${pages.length} págs)` : ''} e Compartilhar`}
        </button>

        <p className="text-center text-[11px] text-[var(--ios-label-secondary)]">
          Usa o compartilhamento do dispositivo (1º toque abre o menu, 2º toque escolhe o WhatsApp). Depois confirme o envio manualmente.
        </p>
      </section>

      {/* Consulta & Histórico de CMRs */}
      <section className="space-y-2.5 pt-1">
        <h3 className="px-1 text-[12px] font-bold uppercase tracking-wider text-[var(--ios-label-secondary)]">
          CMRs Digitalizados ({filteredRecords.length}
          {filteredRecords.length !== records.length ? ` de ${records.length}` : ''})
        </h3>

        {records.length > 0 && (
          <div className="space-y-2">
            <div className="ios-card flex items-center gap-2 px-3.5 py-2">
              <Search
                className="h-4 w-4 shrink-0 text-[var(--ios-label-secondary)]"
                aria-hidden="true"
              />
              <input
                type="search"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Buscar por CMR, carga, remetente, destinatário, reboque ou selo..."
                className="min-h-[36px] w-full bg-transparent text-[14px] outline-none placeholder:text-[var(--ios-label-tertiary)]"
              />
              {searchTerm && (
                <button
                  type="button"
                  aria-label="Limpar busca"
                  onClick={() => setSearchTerm('')}
                  className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--ios-fill)] text-[var(--ios-label-secondary)]"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              )}
            </div>

            {/* Filtro por Status */}
            <div className="flex gap-1.5 overflow-x-auto pb-0.5">
              {[{ id: 'all', label: 'Todos Status' }, ...CMR_STATUS_OPTIONS].map(
                (st) => (
                  <button
                    key={st.id}
                    type="button"
                    onClick={() => setStatusFilter(st.id)}
                    className={`min-h-[32px] shrink-0 rounded-xl px-3 text-[12px] font-semibold transition ${
                      statusFilter === st.id
                        ? 'bg-[var(--ios-blue)] text-white shadow-sm'
                        : 'border ios-sep-border bg-[var(--ios-card)] text-[var(--ios-label-secondary)]'
                    }`}
                  >
                    {st.label}
                  </button>
                )
              )}
            </div>

            {availableMonths.length > 1 && (
              <div className="flex gap-1.5 overflow-x-auto pb-1">
                <button
                  type="button"
                  onClick={() => setMonthFilter('all')}
                  className={`min-h-[32px] shrink-0 rounded-xl px-3 text-[12px] font-semibold transition ${
                    monthFilter === 'all'
                      ? 'bg-[var(--ios-blue)] text-white shadow-sm'
                      : 'border ios-sep-border bg-[var(--ios-card)] text-[var(--ios-label-secondary)]'
                  }`}
                >
                  Todos Meses
                </button>
                {availableMonths.map((mk) => (
                  <button
                    key={mk}
                    type="button"
                    onClick={() => setMonthFilter(mk)}
                    className={`min-h-[32px] shrink-0 rounded-xl px-3 text-[12px] font-semibold transition ${
                      monthFilter === mk
                        ? 'bg-[var(--ios-blue)] text-white shadow-sm'
                        : 'border ios-sep-border bg-[var(--ios-card)] text-[var(--ios-label-secondary)]'
                    }`}
                  >
                    {formatMonthLabel(mk)}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {filteredRecords.length === 0 ? (
          <div className="ios-card p-8 text-center text-[13px] text-[var(--ios-label-secondary)]">
            <FileText
              className="mx-auto mb-2 h-8 w-8 text-[var(--ios-label-tertiary)]"
              aria-hidden="true"
            />
            {records.length === 0
              ? 'Nenhum CMR digitalizado ainda.'
              : 'Nenhum CMR encontrado com este filtro.'}
          </div>
        ) : (
          filteredRecords.map((rec) => {
            const pCount = rec.pageCount || rec.pages?.length || 1;
            const recStatus = rec.status || 'scanned';
            const sendEvents = Array.isArray(rec.sendHistory)
              ? [...rec.sendHistory].reverse()
              : [];
            const isHistoryExpanded = Boolean(expandedHistoryIds[rec.id]);
            const isReadyReshare = readyCardPdf?.recordId === rec.id;

            return (
              <article key={rec.id} className="ios-card p-4">
                <div className="flex items-start gap-3.5">
                  {rec.thumbDataUrl && (
                    <button
                      type="button"
                      onClick={() => handleOpenRecordLightbox(rec)}
                      aria-label={`Visualizar ${rec.fileName}`}
                      className="shrink-0 overflow-hidden rounded-lg border ios-sep-border bg-[var(--ios-fill)] shadow-sm"
                    >
                      <img
                        src={rec.thumbDataUrl}
                        alt={rec.fileName}
                        className="h-16 w-12 object-cover"
                      />
                    </button>
                  )}

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="truncate text-[14px] font-bold text-[var(--ios-label)]">
                        {rec.fileName}
                      </p>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          STATUS_BADGE_CLASSES[recStatus] ||
                          STATUS_BADGE_CLASSES.scanned
                        }`}
                      >
                        {getStatusLabel(recStatus)}
                      </span>
                      {pCount > 1 && (
                        <span className="rounded-full bg-[var(--ios-blue)]/10 px-2 py-0.5 text-[10px] font-bold text-[var(--ios-blue)]">
                          {pCount} págs
                        </span>
                      )}
                    </div>

                    <p className="mt-1 text-[12px] text-[var(--ios-label-secondary)]">
                      {rec.cmrNumber && (
                        <>
                          CMR:{' '}
                          <strong className="text-[var(--ios-label)]">
                            {rec.cmrNumber}
                          </strong>{' '}
                          ·{' '}
                        </>
                      )}
                      Carga:{' '}
                      <strong className="text-[var(--ios-label)]">
                        {rec.loadNumber}
                      </strong>{' '}
                      · {rec.date} · {rec.sizeKb} KB PDF
                    </p>

                    {(rec.sender || rec.recipient) && (
                      <p className="mt-0.5 truncate text-[12px] text-[var(--ios-label-secondary)]">
                        {rec.sender || '--'} → {rec.recipient || '--'}
                      </p>
                    )}

                    {(rec.trailerPlate || rec.sealNumber) && (
                      <p className="mt-0.5 text-[11px] font-medium text-[var(--ios-label-secondary)]">
                        {rec.trailerPlate ? `Reboque: ${rec.trailerPlate}` : ''}
                        {rec.trailerPlate && rec.sealNumber ? ' · ' : ''}
                        {rec.sealNumber ? `Selo: ${rec.sealNumber}` : ''}
                      </p>
                    )}

                    {rec.notes && (
                      <p className="mt-0.5 truncate text-[12px] text-[var(--ios-label-tertiary)]">
                        {rec.notes}
                      </p>
                    )}
                  </div>
                </div>

                {/* Troca rápida dos 4 Status + Confirmação manual */}
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t ios-sep-border pt-2.5">
                  <div className="flex flex-wrap gap-1">
                    {CMR_STATUS_OPTIONS.map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => handleQuickStatusChange(rec, opt.id)}
                        className={`rounded-lg px-2 py-1 text-[11px] font-semibold transition ${
                          recStatus === opt.id
                            ? 'bg-[var(--ios-blue)] text-white'
                            : 'bg-[var(--ios-fill)] text-[var(--ios-label-secondary)] hover:text-[var(--ios-label)]'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>

                  {recStatus !== 'sent' && (
                    <button
                      type="button"
                      onClick={() => handleConfirmManualSent(rec.id)}
                      className="inline-flex items-center gap-1 rounded-lg bg-[var(--ios-green)]/15 px-2.5 py-1 text-[11px] font-bold text-[var(--ios-green)]"
                    >
                      <Check className="h-3.5 w-3.5" aria-hidden="true" />
                      Confirmar Envio
                    </button>
                  )}
                </div>

                {/* Histórico de Envio & Confirmação Manual */}
                {sendEvents.length > 0 && (
                  <div className="mt-2.5 rounded-xl bg-[var(--ios-fill)] px-3 py-2 text-[11px]">
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedHistoryIds((prev) => ({
                          ...prev,
                          [rec.id]: !prev[rec.id],
                        }))
                      }
                      className="flex w-full items-center justify-between gap-2 font-semibold text-[var(--ios-label-secondary)]"
                    >
                      <span className="flex items-center gap-1.5 truncate">
                        <History className="h-3.5 w-3.5 shrink-0 text-[var(--ios-blue)]" aria-hidden="true" />
                        Histórico ({sendEvents.length}):{' '}
                        <span className="truncate font-normal text-[var(--ios-label)]">
                          {ACTION_LABELS[sendEvents[0].action] || sendEvents[0].action}{' '}
                          ({formatEventTime(sendEvents[0].timestamp)})
                        </span>
                      </span>
                      <span className="shrink-0 text-[var(--ios-blue)]">
                        {isHistoryExpanded ? 'Ocultar' : 'Detalhes'}
                      </span>
                    </button>

                    {isHistoryExpanded && (
                      <ul className="mt-2 space-y-1 border-t ios-sep-border pt-2">
                        {sendEvents.map((evt) => (
                          <li
                            key={evt.id}
                            className="flex items-start justify-between gap-2 text-[var(--ios-label-secondary)]"
                          >
                            <span>
                              <strong className="text-[var(--ios-label)]">
                                {ACTION_LABELS[evt.action] || evt.action}
                              </strong>
                              {evt.note ? ` — ${evt.note}` : ''}
                            </span>
                            <span className="inline-flex shrink-0 items-center gap-1 tabular-nums text-[10px]">
                              <Clock className="h-3 w-3" aria-hidden="true" />
                              {formatEventTime(evt.timestamp)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t ios-sep-border pt-2.5">
                  <div className="flex flex-1 gap-2">
                    <button
                      type="button"
                      onClick={() => handleOpenRecordLightbox(rec)}
                      className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl border ios-sep-border bg-[var(--ios-fill)] px-3 text-[12px] font-semibold text-[var(--ios-label)]"
                    >
                      <Eye className="h-4 w-4 text-[var(--ios-blue)]" aria-hidden="true" />
                      Ver
                    </button>

                    <button
                      type="button"
                      onClick={() => handleReshareRecord(rec, 'share')}
                      className="inline-flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-xl bg-[var(--ios-green)]/12 px-3 text-[13px] font-semibold text-[var(--ios-green)]"
                    >
                      <Share2 className="h-4 w-4" aria-hidden="true" />
                      {isReadyReshare ? 'Compartilhar Agora' : 'Compartilhar PDF'}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleReshareRecord(rec, 'download')}
                      aria-label="Baixar PDF"
                      className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-xl border ios-sep-border bg-[var(--ios-fill)] px-3 text-[var(--ios-blue)]"
                    >
                      <Download className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>

                  <button
                    type="button"
                    aria-label="Apagar CMR"
                    onClick={() => setConfirmDeleteId(rec.id)}
                    className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-xl bg-[var(--ios-red)]/10 text-[var(--ios-red)]"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </article>
            );
          })
        )}
      </section>

      <CmrCropModal
        isOpen={Boolean(cropSession)}
        imageSrc={cropSession?.rawImageUrl}
        initialCorners={cropSession?.corners}
        autoDetected={Boolean(cropSession?.autoDetected)}
        onCancel={() => setCropSession(null)}
        onApply={handleApplyCrop}
      />

      <ConfirmModal
        isOpen={Boolean(confirmDeleteId)}
        title="Apagar CMR do histórico?"
        message="O registro e as imagens digitalizadas associadas serão removidos."
        confirmLabel="Apagar"
        destructive
        onConfirm={handleConfirmDelete}
        onCancel={() => setConfirmDeleteId(null)}
      />

      <ImageLightbox
        isOpen={lightboxState.isOpen}
        images={lightboxState.images}
        initialIndex={lightboxState.initialIndex}
        onClose={() =>
          setLightboxState((prev) => ({ ...prev, isOpen: false }))
        }
      />
    </div>
  );
}
