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
} from 'lucide-react';
import {
  buildCmrFileName,
  detectDocumentCornersFromImage,
  generateCmrPdf,
  processCmrImageToCanvas,
  readFileAsDataUrl,
  shareOrDownloadCmrPdf,
  triggerPdfDownload,
} from '../../utils/cmrScanner';
import { DEFAULT_CROP_CORNERS } from '../../utils/cmrGeometry';
import {
  deleteCmrRecord,
  resolveCmrPages,
  saveCmrRecord,
  subscribeCmrRecords,
} from '../../services/cmrService';
import { formatMonthLabel, getLocalDateISO, getMonthKey } from '../../utils/salaryCalculator';
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

export default function CmrModule({ user }) {
  const [records, setRecords] = useState([]);
  const [loadNumber, setLoadNumber] = useState('');
  const [date, setDate] = useState(getLocalDateISO);
  const [notes, setNotes] = useState('');
  const [contrastMode, setContrastMode] = useState('high');

  const [pages, setPages] = useState([]);
  const [selectedPageIdx, setSelectedPageIdx] = useState(0);
  const [cropSession, setCropSession] = useState(null);

  const [processing, setProcessing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [whatsappFallbackText, setWhatsappFallbackText] = useState('');
  const [error, setError] = useState('');

  const [searchTerm, setSearchTerm] = useState('');
  const [monthFilter, setMonthFilter] = useState('all');

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

  useEffect(() => {
    const unsub = subscribeCmrRecords(user?.uid || null, (list) => {
      setRecords(list);
    });
    return () => unsub();
  }, [user?.uid]);

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
    setWhatsappFallbackText('');

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

      if (session.mode === 'edit') {
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

  const activePage = pages[selectedPageIdx] || pages[0] || null;
  const totalApproxKb = pages.reduce(
    (sum, p) => sum + (p.processedScan?.approxKb || 0),
    0
  );
  const previewFileName = buildCmrFileName(date, loadNumber || '00000');

  const handleGenerateAndShare = async () => {
    setError('');
    setStatusMessage('');
    setWhatsappFallbackText('');

    if (pages.length === 0) {
      setError('Tire uma foto do CMR ou selecione da galeria primeiro.');
      return;
    }

    if (!loadNumber.trim()) {
      setError('Informe o Número da Carga para nomear o arquivo PDF.');
      return;
    }

    setGenerating(true);
    try {
      const scanUrls = pages
        .map((p) => p.processedScan?.scanDataUrl)
        .filter(Boolean);

      const { pdfBlob, fileName, sizeKb, pageCount } = await generateCmrPdf(
        scanUrls,
        { date, loadNumber, notes }
      );

      const { records: updated } = await saveCmrRecord(user?.uid || null, {
        date,
        loadNumber,
        notes,
        sizeKb,
        thumbDataUrl: pages[0]?.processedScan?.thumbDataUrl || '',
        scanDataUrl: pages[0]?.processedScan?.scanDataUrl || '',
        pages: pages.map((p) => ({
          id: p.id,
          scanDataUrl: p.processedScan?.scanDataUrl || '',
          thumbDataUrl: p.processedScan?.thumbDataUrl || '',
        })),
      });
      setRecords(updated);

      const result = await shareOrDownloadCmrPdf(pdfBlob, fileName, {
        date,
        loadNumber,
      });

      const pageInfo = pageCount > 1 ? ` · ${pageCount} págs` : '';
      if (result.method === 'shared') {
        setStatusMessage(
          `PDF ${fileName} (${sizeKb} KB${pageInfo}) enviado com sucesso!`
        );
      } else if (result.method === 'cancelled') {
        setStatusMessage(
          `PDF ${fileName} (${sizeKb} KB${pageInfo}) salvo no histórico.`
        );
      } else {
        setStatusMessage(
          `PDF leve ${fileName} (${sizeKb} KB${pageInfo}) baixado! Anexe no WhatsApp abaixo.`
        );
        setWhatsappFallbackText(result.shareText);
      }
    } catch (err) {
      setError(err.message || 'Falha ao gerar ou compartilhar o PDF do CMR.');
    } finally {
      setGenerating(false);
    }
  };

  const handleReshareRecord = async (rec, mode = 'share') => {
    setError('');
    try {
      const pageUrls = await resolveCmrPages(rec);
      if (pageUrls.length === 0) {
        setError('Imagem completa não disponível para reenvio neste registro.');
        return;
      }
      const { pdfBlob, fileName } = await generateCmrPdf(pageUrls, {
        date: rec.date,
        loadNumber: rec.loadNumber,
        notes: rec.notes,
      });
      if (mode === 'download') {
        triggerPdfDownload(pdfBlob, fileName);
        setStatusMessage(`PDF ${fileName} baixado novamente.`);
      } else {
        const res = await shareOrDownloadCmrPdf(pdfBlob, fileName, rec);
        if (res.method === 'downloaded') {
          setStatusMessage(`PDF ${fileName} baixado para envio no WhatsApp.`);
          setWhatsappFallbackText(res.shareText);
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
      if (monthFilter !== 'all' && getMonthKey(rec.date) !== monthFilter) {
        return false;
      }
      if (!q) return true;
      return (
        String(rec.loadNumber || '').toLowerCase().includes(q) ||
        String(rec.fileName || '').toLowerCase().includes(q) ||
        String(rec.notes || '').toLowerCase().includes(q)
      );
    });
  }, [records, searchTerm, monthFilter]);

  return (
    <div className="space-y-4 pb-6">
      <section className="ios-card space-y-4 p-5">
        <div>
          <h2 className="text-[20px] font-bold tracking-tight text-[var(--ios-label)]">
            Scanner de CMR
          </h2>
          <p className="text-[13px] text-[var(--ios-label-secondary)]">
            Recorte profissional, multipágina e PDF leve para WhatsApp
          </p>
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

        {/* Inputs agrupados */}
        <div className="cp-inset overflow-hidden">
          <div className="grid grid-cols-1 border-b ios-sep-border sm:grid-cols-2">
            <label className="flex min-h-[50px] items-center justify-between gap-3 border-b ios-sep-border px-4 sm:border-b-0 sm:border-r">
              <span className="text-[14px] font-semibold text-[var(--ios-label-secondary)]">
                N.º da Carga
              </span>
              <input
                type="text"
                value={loadNumber}
                onChange={(e) => setLoadNumber(e.target.value)}
                placeholder="84920"
                className="w-36 bg-transparent text-right text-[15px] font-bold outline-none placeholder:text-[var(--ios-label-tertiary)]"
              />
            </label>

            <label className="flex min-h-[50px] items-center justify-between gap-3 px-4">
              <span className="text-[14px] font-semibold text-[var(--ios-label-secondary)]">
                Data
              </span>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="bg-transparent text-right text-[15px] font-semibold outline-none"
              />
            </label>
          </div>

          <label className="flex min-h-[50px] items-center justify-between gap-3 px-4">
            <span className="text-[14px] font-semibold text-[var(--ios-label-secondary)]">
              Nota
            </span>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Descarga Stuttgart OK"
              className="flex-1 bg-transparent text-right text-[14px] outline-none placeholder:text-[var(--ios-label-tertiary)]"
            />
          </label>
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

        {statusMessage && (
          <div className="space-y-2 rounded-xl border border-[var(--ios-green)]/25 bg-[var(--ios-green)]/10 p-3 text-[13px] font-medium text-[var(--ios-green)]">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{statusMessage}</span>
            </div>
            {whatsappFallbackText && (
              <a
                href={`https://wa.me/?text=${encodeURIComponent(
                  whatsappFallbackText
                )}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-[var(--ios-green)] px-3 text-[14px] font-semibold text-white"
              >
                <MessageCircle className="h-4 w-4" aria-hidden="true" />
                Abrir WhatsApp
              </a>
            )}
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
            ? 'Gerando PDF...'
            : pages.length > 1
            ? `Gerar PDF (${pages.length} págs) e Enviar`
            : 'Gerar PDF e Enviar no WhatsApp'}
        </button>
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
                placeholder="Buscar por n.º da carga, arquivo ou nota..."
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

            {availableMonths.length > 1 && (
              <div className="flex gap-1.5 overflow-x-auto pb-1">
                <button
                  type="button"
                  onClick={() => setMonthFilter('all')}
                  className={`min-h-[34px] shrink-0 rounded-xl px-3 text-[12px] font-semibold transition ${
                    monthFilter === 'all'
                      ? 'bg-[var(--ios-blue)] text-white shadow-sm'
                      : 'border ios-sep-border bg-[var(--ios-card)] text-[var(--ios-label-secondary)]'
                  }`}
                >
                  Todos
                </button>
                {availableMonths.map((mk) => (
                  <button
                    key={mk}
                    type="button"
                    onClick={() => setMonthFilter(mk)}
                    className={`min-h-[34px] shrink-0 rounded-xl px-3 text-[12px] font-semibold transition ${
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
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-[14px] font-bold text-[var(--ios-label)]">
                        {rec.fileName}
                      </p>
                      {pCount > 1 && (
                        <span className="rounded-full bg-[var(--ios-blue)]/10 px-2 py-0.5 text-[10px] font-bold text-[var(--ios-blue)]">
                          {pCount} págs
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-[12px] text-[var(--ios-label-secondary)]">
                      Carga:{' '}
                      <strong className="text-[var(--ios-label)]">
                        {rec.loadNumber}
                      </strong>{' '}
                      · {rec.date} · {rec.sizeKb} KB PDF
                    </p>
                    {rec.notes && (
                      <p className="mt-0.5 truncate text-[12px] text-[var(--ios-label-tertiary)]">
                        {rec.notes}
                      </p>
                    )}
                  </div>
                </div>

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
                      WhatsApp
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
