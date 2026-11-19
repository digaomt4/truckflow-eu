import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  Camera,
  Trash2,
  AlertCircle,
  CheckCircle2,
  X,
  LocateFixed,
  Loader2,
  Container,
  ArrowDownUp,
  ImagePlus,
} from 'lucide-react';
import {
  COUPLE_CHECKLIST_ITEMS,
  UNCOUPLE_CHECKLIST_ITEMS,
  compressSealPhoto,
  createChecklistState,
  createMiniThumb,
  deleteTrailerRecord,
  resolveTrailerGallery,
  saveTrailerRecord,
  subscribeTrailerRecords,
} from '../../services/trailerService';
import { fetchExactCurrentLocation } from '../../utils/locationHelper';
import ConfirmModal from '../../components/ui/ConfirmModal';
import ImageLightbox from '../../components/ui/ImageLightbox';

const COUNTRY_CHIPS = ['PT', 'ES', 'FR', 'DE', 'BE', 'NL', 'IT', 'LU', 'PL'];
const MAX_EXTRA_PHOTOS = 4;

function getLocalDateTimeValue() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${d}T${hh}:${mm}`;
}

function formatDisplayDateTime(dtStr) {
  if (!dtStr) return '--';
  const d = new Date(dtStr);
  if (Number.isNaN(d.getTime())) return dtStr;
  return new Intl.DateTimeFormat('pt-PT', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

export default function TrailerModule({ user }) {
  const [records, setRecords] = useState([]);
  const [actionType, setActionType] = useState('couple');
  const [plate, setPlate] = useState('');
  const [country, setCountry] = useState('ES');
  const [location, setLocation] = useState('');
  const [dateTime, setDateTime] = useState(getLocalDateTimeValue);
  const [sealNumber, setSealNumber] = useState('');
  const [sealPhotoDataUrl, setSealPhotoDataUrl] = useState('');
  const [extraPhotos, setExtraPhotos] = useState([]);
  const [checks, setChecks] = useState(() => createChecklistState('couple'));
  const [gpsLoading, setGpsLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [saving, setSaving] = useState(false);

  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [lightboxState, setLightboxState] = useState({
    isOpen: false,
    images: [],
    initialIndex: 0,
  });

  const formRef = useRef(null);
  const fileInputRef = useRef(null);
  const extraFileInputRef = useRef(null);

  useEffect(() => {
    const unsub = subscribeTrailerRecords(user?.uid || null, (list) => {
      setRecords(list);
    });
    return () => unsub();
  }, [user?.uid]);

  const currentCoupledTrailer =
    records[0]?.actionType === 'couple' ? records[0] : null;

  const checklistItems =
    actionType === 'uncouple'
      ? UNCOUPLE_CHECKLIST_ITEMS
      : COUPLE_CHECKLIST_ITEMS;

  const handleActionTypeChange = (nextType) => {
    if (nextType === actionType) return;
    setActionType(nextType);
    setChecks(createChecklistState(nextType));
    setError('');
    setSuccessMsg('');
  };

  const handleStartUncoupleCurrent = () => {
    if (!currentCoupledTrailer) return;
    setActionType('uncouple');
    setPlate(currentCoupledTrailer.plate || '');
    setCountry(currentCoupledTrailer.country || 'ES');
    setSealNumber(currentCoupledTrailer.sealNumber || '');
    setDateTime(getLocalDateTimeValue());
    setChecks(createChecklistState('uncouple'));
    setError('');
    setSuccessMsg('');
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleCaptureGps = async () => {
    setError('');
    setGpsLoading(true);
    try {
      const { label, countryCode } = await fetchExactCurrentLocation();
      setLocation(label);
      if (countryCode && COUNTRY_CHIPS.includes(countryCode)) {
        setCountry(countryCode);
      }
    } catch (err) {
      setError(err.message || 'Não foi possível capturar o GPS.');
    } finally {
      setGpsLoading(false);
    }
  };

  const toggleCheck = (key) => {
    setError('');
    setSuccessMsg('');
    setChecks((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const checkedCount = checklistItems.filter((item) => checks[item.key]).length;
  const checklistPercent = Math.round(
    (checkedCount / checklistItems.length) * 100
  );
  const allChecked = checkedCount === checklistItems.length;

  const handlePhotoChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    try {
      const compressed = await compressSealPhoto(file);
      setSealPhotoDataUrl(compressed);
    } catch (err) {
      setError(err.message || 'Erro ao processar a foto do selo.');
    } finally {
      e.target.value = '';
    }
  };

  const handleExtraPhotosChange = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setError('');
    const remainingSlots = MAX_EXTRA_PHOTOS - extraPhotos.length;
    const selected = files.slice(0, Math.max(0, remainingSlots));

    try {
      const processed = [];
      for (const file of selected) {
        const dataUrl = await compressSealPhoto(file, 900, 0.72);
        const thumbDataUrl = await createMiniThumb(dataUrl, 240, 0.55);
        processed.push({
          id: `ext_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          dataUrl,
          thumbDataUrl,
        });
      }
      setExtraPhotos((prev) => [...prev, ...processed].slice(0, MAX_EXTRA_PHOTOS));
    } catch (err) {
      setError(err.message || 'Erro ao processar foto extra.');
    } finally {
      e.target.value = '';
    }
  };

  const handleOpenRecordLightbox = async (record, startIdx = 0) => {
    const images = await resolveTrailerGallery(record);
    if (images.length === 0) return;
    setLightboxState({
      isOpen: true,
      images,
      initialIndex: startIdx,
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');

    if (!plate.trim()) {
      setError('Informe a matrícula do reboque (ex: L-1234-BBB).');
      return;
    }
    if (!allChecked) {
      setError(
        'Marque todos os 4 itens obrigatórios de verificação antes de salvar.'
      );
      return;
    }
    if (actionType === 'couple' && !sealNumber.trim()) {
      setError('Informe o número do lacre/selo para concluir o engate.');
      return;
    }

    setSaving(true);
    try {
      const updated = await saveTrailerRecord(user?.uid || null, {
        actionType,
        plate,
        country,
        location,
        dateTime,
        sealNumber,
        sealPhotoDataUrl,
        extraPhotos,
        checks,
      });
      setRecords(updated);
      setPlate('');
      setLocation('');
      setSealNumber('');
      setSealPhotoDataUrl('');
      setExtraPhotos([]);
      setDateTime(getLocalDateTimeValue());
      setChecks(createChecklistState(actionType));
      setSuccessMsg('Checklist de reboque guardado com sucesso!');
    } catch (err) {
      setError(err.message || 'Erro ao salvar registro de reboque.');
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!confirmDeleteId) return;
    const targetId = confirmDeleteId;
    setConfirmDeleteId(null);
    const updated = await deleteTrailerRecord(user?.uid || null, targetId);
    setRecords(updated);
  };

  return (
    <div className="space-y-4 pb-6">
      {/* Banner Reboque Engatado Agora */}
      {currentCoupledTrailer && (
        <section
          aria-label="Reboque Engatado Atualmente"
          className="ios-card border-l-4 border-l-[var(--ios-green)] p-4 sm:p-5"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--ios-green)]/12 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-[var(--ios-green)]">
                <Container className="h-3.5 w-3.5" aria-hidden="true" />
                Reboque Engatado Agora
              </span>

              {/* Matrícula estilo placa europeia */}
              <div className="mt-2.5 inline-flex items-stretch overflow-hidden rounded-lg border ios-sep-border bg-[var(--ios-card)] shadow-sm">
                <span className="flex items-center bg-[var(--ios-blue)] px-2 text-[11px] font-bold text-white">
                  {currentCoupledTrailer.country || 'EU'}
                </span>
                <span className="px-3 py-1 text-[18px] font-extrabold tracking-wider text-[var(--ios-label)]">
                  {currentCoupledTrailer.plate}
                </span>
              </div>

              <p className="mt-2 text-[12px] text-[var(--ios-label-secondary)]">
                {formatDisplayDateTime(currentCoupledTrailer.dateTime)}
                {currentCoupledTrailer.location
                  ? ` · ${currentCoupledTrailer.location}`
                  : ''}
              </p>
              {currentCoupledTrailer.sealNumber && (
                <p className="mt-0.5 text-[12px] font-semibold text-[#B45309] dark:text-[#F59E0B]">
                  Selo: {currentCoupledTrailer.sealNumber}
                </p>
              )}
            </div>

            {currentCoupledTrailer.sealPhotoDataUrl && (
              <button
                type="button"
                onClick={() =>
                  handleOpenRecordLightbox(currentCoupledTrailer, 0)
                }
                aria-label="Ampliar foto do selo atual"
                className="shrink-0 overflow-hidden rounded-xl border ios-sep-border shadow-sm"
              >
                <img
                  src={currentCoupledTrailer.sealPhotoDataUrl}
                  alt={`Selo ${currentCoupledTrailer.plate}`}
                  className="h-16 w-16 object-cover"
                />
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={handleStartUncoupleCurrent}
            className="mt-3.5 flex min-h-[46px] w-full items-center justify-center gap-2 rounded-xl border border-[var(--ios-blue)]/25 bg-[var(--ios-blue)]/10 px-4 text-[14px] font-semibold text-[var(--ios-blue)] transition active:scale-[0.99]"
          >
            <ArrowDownUp className="h-4 w-4" aria-hidden="true" />
            Desengatar este reboque
          </button>
        </section>
      )}

      <form
        ref={formRef}
        onSubmit={handleSubmit}
        className="ios-card space-y-4 p-5"
      >
        <div>
          <h2 className="text-[20px] font-bold tracking-tight text-[var(--ios-label)]">
            Troca de Reboque
          </h2>
          <p className="text-[13px] text-[var(--ios-label-secondary)]">
            Checklist rápido de engate e desengate
          </p>
        </div>

        {/* Controle Segmentado */}
        <div className="ios-segmented grid-cols-2">
          <button
            type="button"
            aria-selected={actionType === 'couple'}
            onClick={() => handleActionTypeChange('couple')}
            className="ios-segmented-item"
          >
            Engate
          </button>
          <button
            type="button"
            aria-selected={actionType === 'uncouple'}
            onClick={() => handleActionTypeChange('uncouple')}
            className="ios-segmented-item"
          >
            Desengate
          </button>
        </div>

        {/* Matrícula, Data/Hora e Local com GPS */}
        <div className="cp-inset overflow-hidden">
          <label className="flex min-h-[52px] items-center justify-between gap-3 border-b ios-sep-border px-4">
            <span className="text-[14px] font-semibold text-[var(--ios-label-secondary)]">
              Matrícula
            </span>
            <input
              type="text"
              required
              value={plate}
              onChange={(e) => setPlate(e.target.value.toUpperCase())}
              placeholder="L-1234-BBB"
              className="w-44 bg-transparent text-right text-[16px] font-bold uppercase tracking-wider outline-none placeholder:text-[var(--ios-label-tertiary)]"
            />
          </label>

          <label className="flex min-h-[52px] items-center justify-between gap-3 border-b ios-sep-border px-4">
            <button
              type="button"
              onClick={() => setDateTime(getLocalDateTimeValue())}
              className="text-[14px] font-semibold text-[var(--ios-blue)] hover:underline"
            >
              Data / Hora
            </button>
            <input
              type="datetime-local"
              value={dateTime}
              onChange={(e) => setDateTime(e.target.value)}
              className="bg-transparent text-right text-[14px] font-semibold outline-none"
            />
          </label>

          <div className="flex min-h-[54px] items-center gap-2 px-4 py-1.5">
            <span className="text-[14px] font-semibold text-[var(--ios-label-secondary)]">
              Local
            </span>
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Zaragoza, Plataforma..."
              className="min-w-0 flex-1 bg-transparent text-right text-[14px] outline-none placeholder:text-[var(--ios-label-tertiary)]"
            />
            <button
              type="button"
              disabled={gpsLoading}
              onClick={handleCaptureGps}
              className="inline-flex min-h-[40px] shrink-0 items-center gap-1 rounded-xl border border-[var(--ios-blue)]/25 bg-[var(--ios-blue)]/10 px-3 text-[12px] font-bold text-[var(--ios-blue)] active:scale-95 disabled:opacity-50"
            >
              {gpsLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <LocateFixed className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              GPS
            </button>
          </div>
        </div>

        {/* Chips de País */}
        <div>
          <span className="mb-1.5 block px-1 text-[11px] font-bold uppercase tracking-wider text-[var(--ios-label-secondary)]">
            País da Matrícula
          </span>
          <div className="flex flex-wrap gap-1.5">
            {COUNTRY_CHIPS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCountry(c)}
                className={`min-h-[40px] min-w-[44px] rounded-xl px-3 text-[13px] font-bold transition ${
                  country === c
                    ? 'bg-[var(--ios-blue)] text-white shadow-sm'
                    : 'border ios-sep-border bg-[var(--ios-card)] text-[var(--ios-label-secondary)] hover:bg-[var(--ios-fill)]'
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        {/* Progresso e Checklist Contextual */}
        <div>
          <div className="mb-2 flex items-center justify-between px-1">
            <span className="text-[12px] font-bold uppercase tracking-wider text-[var(--ios-label-secondary)]">
              {actionType === 'couple'
                ? 'Verificação de Engate'
                : 'Verificação de Desengate'}
            </span>
            <span
              className={`tabular-nums rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                allChecked
                  ? 'bg-[var(--ios-green)]/12 text-[var(--ios-green)]'
                  : 'bg-[var(--ios-blue)]/10 text-[var(--ios-blue)]'
              }`}
            >
              {checkedCount} de {checklistItems.length} concluídos
            </span>
          </div>

          <div
            className="mb-3 h-2 w-full overflow-hidden rounded-full bg-[var(--ios-fill-secondary)]"
            role="progressbar"
            aria-valuenow={checkedCount}
            aria-valuemin={0}
            aria-valuemax={checklistItems.length}
            aria-label="Progresso do checklist de reboque"
          >
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${checklistPercent}%`,
                backgroundColor: allChecked
                  ? 'var(--ios-green)'
                  : 'var(--ios-blue)',
              }}
            />
          </div>

          <div className="cp-inset overflow-hidden">
            {checklistItems.map((item, idx) => {
              const checked = Boolean(checks[item.key]);
              return (
                <button
                  key={item.key}
                  type="button"
                  role="checkbox"
                  aria-checked={checked}
                  onClick={() => toggleCheck(item.key)}
                  className={`flex min-h-[62px] w-full items-center gap-3.5 px-4 py-3 text-left transition active:opacity-80 ${
                    idx > 0 ? 'border-t ios-sep-border' : ''
                  } ${checked ? 'bg-[var(--ios-green)]/[0.07]' : ''}`}
                >
                  <div
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 transition ${
                      checked
                        ? 'border-[var(--ios-green)] bg-[var(--ios-green)] text-white'
                        : 'border-[var(--ios-label-tertiary)] bg-[var(--ios-card)] text-transparent'
                    }`}
                  >
                    <Check className="h-4 w-4 stroke-[3]" aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-semibold text-[var(--ios-label)]">
                      {item.label}
                    </p>
                    <p className="text-[12px] text-[var(--ios-label-secondary)]">
                      {item.hint}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Selo + Foto do Selo */}
        <div className="cp-inset overflow-hidden">
          <label className="flex min-h-[52px] items-center justify-between gap-3 border-b ios-sep-border px-4">
            <span className="text-[14px] font-semibold text-[var(--ios-label-secondary)]">
              N.º do Selo
            </span>
            <input
              type="text"
              value={sealNumber}
              onChange={(e) => setSealNumber(e.target.value.toUpperCase())}
              placeholder="SEAL-88412"
              className="w-44 bg-transparent text-right text-[15px] font-bold uppercase outline-none placeholder:text-[var(--ios-label-tertiary)]"
            />
          </label>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handlePhotoChange}
            className="hidden"
          />

          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex min-h-[42px] items-center gap-2 text-[14px] font-semibold text-[var(--ios-blue)]"
            >
              <Camera className="h-5 w-5" aria-hidden="true" />
              {sealPhotoDataUrl ? 'Trocar Foto do Selo' : 'Tirar Foto do Selo'}
            </button>

            {sealPhotoDataUrl && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() =>
                    setLightboxState({
                      isOpen: true,
                      images: [{ src: sealPhotoDataUrl, label: 'Foto do Selo' }],
                      initialIndex: 0,
                    })
                  }
                  aria-label="Visualizar foto do selo"
                  className="overflow-hidden rounded-xl border ios-sep-border"
                >
                  <img
                    src={sealPhotoDataUrl}
                    alt="Preview do lacre"
                    className="h-12 w-12 object-cover"
                  />
                </button>
                <button
                  type="button"
                  aria-label="Remover foto do selo"
                  onClick={() => setSealPhotoDataUrl('')}
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--ios-red)] text-white shadow-sm"
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Fotos Extras */}
        <div className="cp-inset p-3.5">
          <input
            ref={extraFileInputRef}
            type="file"
            accept="image/*"
            multiple
            capture="environment"
            onChange={handleExtraPhotosChange}
            className="hidden"
          />

          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-[14px] font-semibold text-[var(--ios-label)]">
                Fotos Extras ({extraPhotos.length}/{MAX_EXTRA_PHOTOS})
              </p>
              <p className="text-[11px] text-[var(--ios-label-secondary)]">
                Avarias, lona, pneus ou estado da carga
              </p>
            </div>
            <button
              type="button"
              disabled={extraPhotos.length >= MAX_EXTRA_PHOTOS}
              onClick={() => extraFileInputRef.current?.click()}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-[var(--ios-blue)]/25 bg-[var(--ios-blue)]/10 px-3 text-[12px] font-bold text-[var(--ios-blue)] disabled:opacity-40"
            >
              <ImagePlus className="h-4 w-4" aria-hidden="true" />
              Adicionar
            </button>
          </div>

          {extraPhotos.length > 0 && (
            <div className="mt-3 grid grid-cols-4 gap-2">
              {extraPhotos.map((photo, idx) => (
                <div key={photo.id} className="relative">
                  <button
                    type="button"
                    onClick={() =>
                      setLightboxState({
                        isOpen: true,
                        images: extraPhotos.map((p, i) => ({
                          src: p.dataUrl,
                          label: `Foto Extra ${i + 1}`,
                        })),
                        initialIndex: idx,
                      })
                    }
                    className="block w-full overflow-hidden rounded-xl border ios-sep-border"
                  >
                    <img
                      src={photo.thumbDataUrl}
                      alt={`Foto extra ${idx + 1}`}
                      className="aspect-square w-full object-cover"
                    />
                  </button>
                  <button
                    type="button"
                    aria-label={`Remover foto extra ${idx + 1}`}
                    onClick={() =>
                      setExtraPhotos((prev) =>
                        prev.filter((item) => item.id !== photo.id)
                      )
                    }
                    className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--ios-red)] text-white shadow-sm"
                  >
                    <X className="h-3 w-3" aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-xl border border-[var(--ios-red)]/25 bg-[var(--ios-red)]/10 p-3 text-[13px] font-medium text-[var(--ios-red)]">
            <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        {successMsg && (
          <div className="flex items-center gap-2 rounded-xl border border-[var(--ios-green)]/25 bg-[var(--ios-green)]/10 p-3 text-[13px] font-medium text-[var(--ios-green)]">
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{successMsg}</span>
          </div>
        )}

        <button
          type="submit"
          disabled={saving || !allChecked}
          className={`min-h-[52px] w-full rounded-xl px-4 text-[15px] font-semibold transition active:scale-[0.99] ${
            allChecked
              ? 'bg-[var(--ios-blue)] text-white shadow-sm hover:bg-[var(--ios-blue-hover)]'
              : 'border ios-sep-border bg-[var(--ios-fill)] cursor-not-allowed text-[var(--ios-label-tertiary)]'
          }`}
        >
          {saving
            ? 'Salvando...'
            : allChecked
            ? 'Salvar Checklist'
            : 'Marque os 4 itens acima'}
        </button>
      </form>

      {/* Histórico */}
      <section className="space-y-2.5 pt-1">
        <h3 className="px-1 text-[12px] font-bold uppercase tracking-wider text-[var(--ios-label-secondary)]">
          Histórico ({records.length})
        </h3>

        {records.length === 0 ? (
          <div className="ios-card p-6 text-center text-[13px] text-[var(--ios-label-secondary)]">
            Nenhum engate ou desengate registrado ainda.
          </div>
        ) : (
          records.map((rec) => {
            const hasSeal = Boolean(rec.sealPhotoDataUrl);
            const extrasList = Array.isArray(rec.extraPhotos)
              ? rec.extraPhotos
              : [];

            return (
              <article key={rec.id} className="ios-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                          rec.actionType === 'couple'
                            ? 'bg-[var(--ios-blue)]/10 text-[var(--ios-blue)]'
                            : 'bg-[var(--ios-orange)]/15 text-[#B45309] dark:text-[#F59E0B]'
                        }`}
                      >
                        {rec.actionType === 'couple' ? 'Engate' : 'Desengate'}
                      </span>

                      <span className="inline-flex items-center overflow-hidden rounded-md border ios-sep-border bg-[var(--ios-fill)]">
                        {rec.country && (
                          <span className="bg-[var(--ios-blue)] px-1.5 py-0.5 text-[10px] font-bold text-white">
                            {rec.country}
                          </span>
                        )}
                        <span className="px-2 py-0.5 text-[14px] font-bold tracking-wide text-[var(--ios-label)]">
                          {rec.plate}
                        </span>
                      </span>
                    </div>

                    <p className="text-[12px] text-[var(--ios-label-secondary)]">
                      {formatDisplayDateTime(rec.dateTime)}
                      {rec.location ? ` · ${rec.location}` : ''}
                    </p>

                    {rec.sealNumber && (
                      <p className="text-[12px] font-semibold text-[var(--ios-green)]">
                        Selo: {rec.sealNumber}
                      </p>
                    )}

                    {extrasList.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {extrasList.map((photo, idx) => (
                          <button
                            key={photo.id || idx}
                            type="button"
                            onClick={() =>
                              handleOpenRecordLightbox(
                                rec,
                                (hasSeal ? 1 : 0) + idx
                              )
                            }
                            aria-label={`Abrir foto extra ${idx + 1}`}
                            className="overflow-hidden rounded-lg border ios-sep-border"
                          >
                            <img
                              src={photo.thumbDataUrl || photo.url}
                              alt={`Foto extra ${idx + 1}`}
                              className="h-10 w-10 object-cover"
                            />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {hasSeal && (
                      <button
                        type="button"
                        onClick={() => handleOpenRecordLightbox(rec, 0)}
                        aria-label={`Ampliar foto do selo ${rec.plate}`}
                        className="overflow-hidden rounded-xl border ios-sep-border"
                      >
                        <img
                          src={rec.sealPhotoDataUrl}
                          alt={`Foto selo ${rec.plate}`}
                          className="h-12 w-12 object-cover"
                        />
                      </button>
                    )}
                    <button
                      type="button"
                      aria-label="Apagar registro de reboque"
                      onClick={() => setConfirmDeleteId(rec.id)}
                      className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-xl bg-[var(--ios-red)]/10 text-[var(--ios-red)]"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </article>
            );
          })
        )}
      </section>

      <ConfirmModal
        isOpen={Boolean(confirmDeleteId)}
        title="Apagar registro de reboque?"
        message="Este registro e suas fotos associadas serão removidos."
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
