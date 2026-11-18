import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  Camera,
  Trash2,
  AlertCircle,
  CheckCircle2,
  X,
} from 'lucide-react';
import {
  compressSealPhoto,
  deleteTrailerRecord,
  saveTrailerRecord,
  subscribeTrailerRecords,
} from '../../services/trailerService';

const COUNTRY_CHIPS = ['PT', 'ES', 'FR', 'DE', 'BE', 'NL', 'IT', 'LU', 'PL'];

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
  const [checks, setChecks] = useState({
    fifthWheelLocked: false,
    airAndAbsConnected: false,
    tirCableIntact: false,
    sealVerified: false,
  });
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [saving, setSaving] = useState(false);

  const fileInputRef = useRef(null);

  useEffect(() => {
    const unsub = subscribeTrailerRecords(user?.uid || null, (list) => {
      setRecords(list);
    });
    return () => unsub();
  }, [user?.uid]);

  const toggleCheck = (key) => {
    setError('');
    setSuccessMsg('');
    setChecks((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const allChecked =
    checks.fifthWheelLocked &&
    checks.airAndAbsConnected &&
    checks.tirCableIntact &&
    checks.sealVerified;

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
        checks,
      });
      setRecords(updated);
      setPlate('');
      setLocation('');
      setSealNumber('');
      setSealPhotoDataUrl('');
      setDateTime(getLocalDateTimeValue());
      setChecks({
        fifthWheelLocked: false,
        airAndAbsConnected: false,
        tirCableIntact: false,
        sealVerified: false,
      });
      setSuccessMsg('Checklist de reboque guardado com sucesso!');
    } catch (err) {
      setError(err.message || 'Erro ao salvar registro de reboque.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Apagar este registro de reboque?')) return;
    const updated = await deleteTrailerRecord(user?.uid || null, id);
    setRecords(updated);
  };

  const checklistItems = [
    {
      key: 'fifthWheelLocked',
      label: 'Quinta-roda travada e verificada',
      hint: 'Pino-rei encaixado e trava fechada',
    },
    {
      key: 'airAndAbsConnected',
      label: 'Mangueiras de ar e cabos ABS',
      hint: 'Vermelha/amarela conectadas e luzes OK',
    },
    {
      key: 'tirCableIntact',
      label: 'Cabo TIR passado e íntegro',
      hint: 'Sem cortes ou lonas soltas',
    },
    {
      key: 'sealVerified',
      label: 'Lacre / Selo conferido',
      hint: 'Numeração física batida com documento',
    },
  ];

  return (
    <div className="space-y-4 pb-6">
      <form onSubmit={handleSubmit} className="ios-card space-y-4 p-5">
        <div>
          <h2 className="text-[20px] font-bold tracking-tight">
            Troca de Reboque
          </h2>
          <p className="text-[13px] text-[var(--ios-label-secondary)]">
            Checklist rápido de engate e desengate
          </p>
        </div>

        {/* Controle Segmentado iOS */}
        <div className="ios-segmented grid-cols-2">
          <button
            type="button"
            aria-selected={actionType === 'couple'}
            onClick={() => setActionType('couple')}
            className="ios-segmented-item"
          >
            Engate
          </button>
          <button
            type="button"
            aria-selected={actionType === 'uncouple'}
            onClick={() => setActionType('uncouple')}
            className="ios-segmented-item"
          >
            Desengate
          </button>
        </div>

        {/* Matrícula e Data/Hora agrupados */}
        <div className="ios-fill overflow-hidden rounded-[16px]">
          <label className="flex min-h-[52px] items-center justify-between gap-3 border-b ios-sep-border px-4">
            <span className="text-[14px] font-medium text-[var(--ios-label-secondary)]">
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
              className="text-[14px] font-semibold text-[var(--ios-blue)]"
            >
              Data / Hora
            </button>
            <input
              type="datetime-local"
              value={dateTime}
              onChange={(e) => setDateTime(e.target.value)}
              className="bg-transparent text-right text-[14px] font-medium outline-none"
            />
          </label>

          <label className="flex min-h-[50px] items-center justify-between gap-3 px-4">
            <span className="text-[14px] font-medium text-[var(--ios-label-secondary)]">
              Local
            </span>
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Zaragoza, Plataforma..."
              className="flex-1 bg-transparent text-right text-[14px] outline-none placeholder:text-[var(--ios-label-tertiary)]"
            />
          </label>
        </div>

        {/* Chips de País estilo iOS Pills */}
        <div className="flex flex-wrap gap-1.5">
          {COUNTRY_CHIPS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCountry(c)}
              className={`min-h-[36px] min-w-[40px] rounded-full px-3 text-[12px] font-semibold transition ${
                country === c
                  ? 'bg-[var(--ios-blue)] text-white'
                  : 'ios-fill text-[var(--ios-label-secondary)]'
              }`}
            >
              {c}
            </button>
          ))}
        </div>

        {/* Checklist estilo Lembretes (Apple Reminders) */}
        <div>
          <span className="mb-1.5 block px-1 text-[12px] font-semibold uppercase tracking-wider text-[var(--ios-label-secondary)]">
            Verificação Obrigatória ({Object.values(checks).filter(Boolean).length}/4)
          </span>

          <div className="ios-fill overflow-hidden rounded-[16px]">
            {checklistItems.map((item, idx) => {
              const checked = checks[item.key];
              return (
                <button
                  key={item.key}
                  type="button"
                  role="checkbox"
                  aria-checked={checked}
                  onClick={() => toggleCheck(item.key)}
                  className={`flex min-h-[56px] w-full items-center gap-3.5 px-4 py-2.5 text-left transition active:opacity-75 ${
                    idx > 0 ? 'border-t ios-sep-border' : ''
                  }`}
                >
                  <div
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition ${
                      checked
                        ? 'border-[var(--ios-blue)] bg-[var(--ios-blue)] text-white'
                        : 'border-[var(--ios-label-tertiary)] bg-transparent text-transparent'
                    }`}
                  >
                    <Check className="h-3.5 w-3.5 stroke-[3]" aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p
                      className={`text-[15px] font-medium ${
                        checked
                          ? 'text-[var(--ios-label)]'
                          : 'text-[var(--ios-label)]'
                      }`}
                    >
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

        {/* Selo + Foto */}
        <div className="ios-fill overflow-hidden rounded-[16px]">
          <label className="flex min-h-[52px] items-center justify-between gap-3 border-b ios-sep-border px-4">
            <span className="text-[14px] font-medium text-[var(--ios-label-secondary)]">
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
              className="inline-flex min-h-[42px] items-center gap-2 text-[15px] font-semibold text-[var(--ios-blue)]"
            >
              <Camera className="h-5 w-5" aria-hidden="true" />
              {sealPhotoDataUrl ? 'Trocar Foto do Selo' : 'Tirar Foto do Selo'}
            </button>

            {sealPhotoDataUrl && (
              <div className="relative">
                <img
                  src={sealPhotoDataUrl}
                  alt="Preview do lacre"
                  className="h-12 w-12 rounded-[10px] object-cover"
                />
                <button
                  type="button"
                  aria-label="Remover foto do selo"
                  onClick={() => setSealPhotoDataUrl('')}
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--ios-red)] text-white"
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              </div>
            )}
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-[14px] bg-[var(--ios-red)]/15 p-3 text-[13px] font-medium text-[var(--ios-red)]">
            <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        {successMsg && (
          <div className="flex items-center gap-2 rounded-[14px] bg-[var(--ios-green)]/15 p-3 text-[13px] font-medium text-[var(--ios-green)]">
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{successMsg}</span>
          </div>
        )}

        <button
          type="submit"
          disabled={saving || !allChecked}
          className={`min-h-[54px] w-full rounded-[14px] px-4 text-[16px] font-semibold transition active:scale-[0.98] ${
            allChecked
              ? 'bg-[var(--ios-blue)] text-white'
              : 'ios-fill cursor-not-allowed text-[var(--ios-label-tertiary)]'
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
      <section className="space-y-2.5">
        <h3 className="px-2 text-[13px] font-semibold uppercase tracking-wider text-[var(--ios-label-secondary)]">
          Histórico ({records.length})
        </h3>

        {records.length === 0 ? (
          <div className="ios-card p-6 text-center text-[13px] text-[var(--ios-label-secondary)]">
            Nenhum engate ou desengate registrado ainda.
          </div>
        ) : (
          records.map((rec) => (
            <article key={rec.id} className="ios-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                        rec.actionType === 'couple'
                          ? 'bg-[var(--ios-orange)]/15 text-[var(--ios-orange)]'
                          : 'bg-[var(--ios-blue)]/15 text-[var(--ios-blue)]'
                      }`}
                    >
                      {rec.actionType === 'couple' ? 'Engate' : 'Desengate'}
                    </span>
                    <span className="text-[16px] font-bold">{rec.plate}</span>
                    {rec.country && (
                      <span className="ios-fill rounded-full px-2 py-0.5 text-[11px] font-semibold text-[var(--ios-label-secondary)]">
                        {rec.country}
                      </span>
                    )}
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
                </div>

                <div className="flex items-center gap-2">
                  {rec.sealPhotoDataUrl && (
                    <img
                      src={rec.sealPhotoDataUrl}
                      alt={`Foto selo ${rec.plate}`}
                      className="h-12 w-12 rounded-[10px] object-cover"
                    />
                  )}
                  <button
                    type="button"
                    aria-label="Apagar registro de reboque"
                    onClick={() => handleDelete(rec.id)}
                    className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-full bg-[var(--ios-red)]/15 text-[var(--ios-red)]"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </div>
            </article>
          ))
        )}
      </section>
    </div>
  );
}
