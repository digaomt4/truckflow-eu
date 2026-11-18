import React, { useEffect, useRef, useState } from 'react';
import {
  Camera,
  Share2,
  Download,
  Trash2,
  Sparkles,
  FileText,
  AlertCircle,
  CheckCircle2,
  MessageCircle,
} from 'lucide-react';
import {
  buildCmrFileName,
  createDemoCmrDataUrl,
  generateCmrPdf,
  processCmrImageToCanvas,
  readFileAsDataUrl,
  shareOrDownloadCmrPdf,
  triggerPdfDownload,
} from '../../utils/cmrScanner';
import {
  deleteCmrRecord,
  saveCmrRecord,
  subscribeCmrRecords,
} from '../../services/cmrService';
import { getLocalDateISO } from '../../utils/salaryCalculator';

const CONTRAST_MODES = [
  { id: 'normal', label: 'Normal' },
  { id: 'high', label: 'Contraste' },
  { id: 'ultra', label: 'Ultra P&B' },
];

export default function CmrModule({ user }) {
  const [records, setRecords] = useState([]);
  const [loadNumber, setLoadNumber] = useState('');
  const [date, setDate] = useState(getLocalDateISO);
  const [notes, setNotes] = useState('');
  const [contrastMode, setContrastMode] = useState('high');

  const [rawImageUrl, setRawImageUrl] = useState('');
  const [processedScan, setProcessedScan] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [whatsappFallbackText, setWhatsappFallbackText] = useState('');
  const [error, setError] = useState('');

  const cameraInputRef = useRef(null);

  useEffect(() => {
    const unsub = subscribeCmrRecords(user?.uid || null, (list) => {
      setRecords(list);
    });
    return () => unsub();
  }, [user?.uid]);

  useEffect(() => {
    if (!rawImageUrl) return;
    let cancelled = false;
    setProcessing(true);

    processCmrImageToCanvas(rawImageUrl, contrastMode)
      .then((res) => {
        if (!cancelled) setProcessedScan(res);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Erro ao aplicar filtro scanner.');
      })
      .finally(() => {
        if (!cancelled) setProcessing(false);
      });

    return () => {
      cancelled = true;
    };
  }, [rawImageUrl, contrastMode]);

  const handleFileSelected = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    setStatusMessage('');
    setWhatsappFallbackText('');
    try {
      const dataUrl = await readFileAsDataUrl(file);
      setRawImageUrl(dataUrl);
    } catch (err) {
      setError(err.message || 'Erro ao abrir imagem selecionada.');
    } finally {
      e.target.value = '';
    }
  };

  const handleCreateDemoCmr = () => {
    setError('');
    setStatusMessage('');
    setWhatsappFallbackText('');
    const demoLoad = loadNumber || '84920';
    if (!loadNumber) setLoadNumber(demoLoad);
    const demoUrl = createDemoCmrDataUrl(demoLoad, date);
    setRawImageUrl(demoUrl);
  };

  const previewFileName = buildCmrFileName(date, loadNumber || '00000');

  const handleGenerateAndShare = async () => {
    setError('');
    setStatusMessage('');
    setWhatsappFallbackText('');

    if (!processedScan?.scanDataUrl) {
      setError('Tire uma foto do CMR (ou gere um CMR de teste) primeiro.');
      return;
    }

    if (!loadNumber.trim()) {
      setError('Informe o Número da Carga para nomear o arquivo PDF.');
      return;
    }

    setGenerating(true);
    try {
      const { pdfBlob, fileName, sizeKb } = await generateCmrPdf(
        processedScan.scanDataUrl,
        { date, loadNumber, notes }
      );

      const { records: updated } = await saveCmrRecord(user?.uid || null, {
        date,
        loadNumber,
        notes,
        sizeKb,
        thumbDataUrl: processedScan.thumbDataUrl,
        scanDataUrl: processedScan.scanDataUrl,
      });
      setRecords(updated);

      const result = await shareOrDownloadCmrPdf(pdfBlob, fileName, {
        date,
        loadNumber,
      });

      if (result.method === 'shared') {
        setStatusMessage(
          `PDF ${fileName} (${sizeKb} KB) enviado com sucesso!`
        );
      } else if (result.method === 'cancelled') {
        setStatusMessage(
          `PDF ${fileName} (${sizeKb} KB) salvo no histórico.`
        );
      } else {
        setStatusMessage(
          `PDF leve ${fileName} (${sizeKb} KB) baixado! Anexe no WhatsApp abaixo.`
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
    if (!rec.scanDataUrl) {
      setError('Imagem completa não disponível para reenvio neste registro.');
      return;
    }
    setError('');
    try {
      const { pdfBlob, fileName } = await generateCmrPdf(rec.scanDataUrl, {
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

  const handleDelete = async (id) => {
    if (!window.confirm('Apagar este CMR do histórico?')) return;
    const updated = await deleteCmrRecord(user?.uid || null, id);
    setRecords(updated);
  };

  return (
    <div className="space-y-4 pb-6">
      <section className="ios-card space-y-4 p-5">
        <div>
          <h2 className="text-[20px] font-bold tracking-tight">
            Scanner de CMR
          </h2>
          <p className="text-[13px] text-[var(--ios-label-secondary)]">
            PDF preto e branco leve para enviar no WhatsApp
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

        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          <button
            type="button"
            onClick={() => cameraInputRef.current?.click()}
            className="flex min-h-[54px] items-center justify-center gap-2 rounded-[14px] bg-[var(--ios-blue)] px-4 text-[16px] font-semibold text-white transition active:scale-[0.98] sm:col-span-2"
          >
            <Camera className="h-5 w-5" aria-hidden="true" />
            Novo CMR (Câmera)
          </button>

          <button
            type="button"
            onClick={handleCreateDemoCmr}
            className="ios-fill flex min-h-[54px] items-center justify-center gap-1.5 rounded-[14px] px-3 text-[13px] font-semibold text-[var(--ios-blue)] transition active:scale-95"
          >
            <Sparkles className="h-4 w-4" aria-hidden="true" />
            Teste
          </button>
        </div>

        {/* Inputs agrupados iOS */}
        <div className="ios-fill overflow-hidden rounded-[16px]">
          <label className="flex min-h-[50px] items-center justify-between gap-3 border-b ios-sep-border px-4">
            <span className="text-[14px] font-medium text-[var(--ios-label-secondary)]">
              N.º da Carga
            </span>
            <input
              type="text"
              value={loadNumber}
              onChange={(e) => setLoadNumber(e.target.value)}
              placeholder="84920"
              className="w-40 bg-transparent text-right text-[15px] font-semibold outline-none placeholder:text-[var(--ios-label-tertiary)]"
            />
          </label>

          <label className="flex min-h-[50px] items-center justify-between gap-3 border-b ios-sep-border px-4">
            <span className="text-[14px] font-medium text-[var(--ios-label-secondary)]">
              Data
            </span>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="bg-transparent text-right text-[15px] font-medium outline-none"
            />
          </label>

          <label className="flex min-h-[50px] items-center justify-between gap-3 px-4">
            <span className="text-[14px] font-medium text-[var(--ios-label-secondary)]">
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

        <div className="ios-fill rounded-[12px] px-3.5 py-2 text-[12px]">
          <span className="text-[var(--ios-label-secondary)]">Arquivo: </span>
          <code className="font-semibold text-[var(--ios-blue)]">
            {previewFileName}
          </code>
        </div>

        {rawImageUrl && (
          <div className="ios-fill space-y-3 rounded-[16px] p-3.5">
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-semibold uppercase tracking-wider text-[var(--ios-label-secondary)]">
                Filtro Scanner P&B
              </span>
              {processedScan && (
                <span className="tabular-nums rounded-full bg-[var(--ios-green)]/15 px-2.5 py-0.5 text-[11px] font-semibold text-[var(--ios-green)]">
                  ~{processedScan.approxKb} KB
                </span>
              )}
            </div>

            <div className="ios-segmented grid-cols-3">
              {CONTRAST_MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  aria-selected={contrastMode === m.id}
                  onClick={() => setContrastMode(m.id)}
                  className="ios-segmented-item"
                >
                  {m.label}
                </button>
              ))}
            </div>

            <div className="overflow-hidden rounded-[12px] bg-black">
              {processing ? (
                <div className="flex h-56 items-center justify-center text-xs text-[var(--ios-label-secondary)]">
                  Aplicando filtro P&B...
                </div>
              ) : (
                processedScan && (
                  <img
                    src={processedScan.scanDataUrl}
                    alt="Preview do CMR digitalizado em P&B"
                    className="mx-auto max-h-96 w-auto object-contain"
                  />
                )
              )}
            </div>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 rounded-[14px] bg-[var(--ios-red)]/15 p-3 text-[13px] font-medium text-[var(--ios-red)]">
            <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        {statusMessage && (
          <div className="space-y-2 rounded-[14px] bg-[var(--ios-green)]/15 p-3 text-[13px] font-medium text-[var(--ios-green)]">
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
                className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-[12px] bg-[var(--ios-green)] px-3 text-[14px] font-semibold text-white"
              >
                <MessageCircle className="h-4 w-4" aria-hidden="true" />
                Abrir WhatsApp
              </a>
            )}
          </div>
        )}

        <button
          type="button"
          disabled={generating || processing || !processedScan}
          onClick={handleGenerateAndShare}
          className={`flex min-h-[54px] w-full items-center justify-center gap-2 rounded-[14px] px-4 text-[16px] font-semibold transition active:scale-[0.98] ${
            processedScan
              ? 'bg-[var(--ios-green)] text-white'
              : 'ios-fill cursor-not-allowed text-[var(--ios-label-tertiary)]'
          }`}
        >
          <Share2 className="h-5 w-5" aria-hidden="true" />
          {generating ? 'Gerando PDF...' : 'Gerar PDF e Enviar no WhatsApp'}
        </button>
      </section>

      {/* Histórico de CMRs */}
      <section className="space-y-2.5">
        <h3 className="px-2 text-[13px] font-semibold uppercase tracking-wider text-[var(--ios-label-secondary)]">
          CMRs Digitalizados ({records.length})
        </h3>

        {records.length === 0 ? (
          <div className="ios-card p-6 text-center text-[13px] text-[var(--ios-label-secondary)]">
            <FileText
              className="mx-auto mb-2 h-8 w-8 text-[var(--ios-label-tertiary)]"
              aria-hidden="true"
            />
            Nenhum CMR digitalizado ainda.
          </div>
        ) : (
          records.map((rec) => (
            <article key={rec.id} className="ios-card p-4">
              <div className="flex items-start gap-3">
                {rec.thumbDataUrl && (
                  <img
                    src={rec.thumbDataUrl}
                    alt={rec.fileName}
                    className="h-16 w-12 shrink-0 rounded-[8px] object-cover"
                  />
                )}

                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-semibold text-[var(--ios-blue)]">
                    {rec.fileName}
                  </p>
                  <p className="mt-0.5 text-[12px] text-[var(--ios-label-secondary)]">
                    Carga: <strong className="text-[var(--ios-label)]">{rec.loadNumber}</strong>{' '}
                    · {rec.sizeKb} KB PDF
                  </p>
                  {rec.notes && (
                    <p className="mt-0.5 truncate text-[12px] text-[var(--ios-label-tertiary)]">
                      {rec.notes}
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between gap-2 border-t ios-sep-border pt-2.5">
                <div className="flex flex-1 gap-2">
                  <button
                    type="button"
                    disabled={!rec.scanDataUrl}
                    onClick={() => handleReshareRecord(rec, 'share')}
                    className="inline-flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-full bg-[var(--ios-green)]/15 px-3 text-[13px] font-semibold text-[var(--ios-green)] disabled:opacity-40"
                  >
                    <Share2 className="h-4 w-4" aria-hidden="true" />
                    WhatsApp
                  </button>

                  <button
                    type="button"
                    disabled={!rec.scanDataUrl}
                    onClick={() => handleReshareRecord(rec, 'download')}
                    aria-label="Baixar PDF"
                    className="ios-fill inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-full px-3 text-[var(--ios-blue)] disabled:opacity-40"
                  >
                    <Download className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>

                <button
                  type="button"
                  aria-label="Apagar CMR"
                  onClick={() => handleDelete(rec.id)}
                  className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-full bg-[var(--ios-red)]/15 text-[var(--ios-red)]"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </article>
          ))
        )}
      </section>
    </div>
  );
}
