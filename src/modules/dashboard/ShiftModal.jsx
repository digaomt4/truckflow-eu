import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Sparkles,
  AlertCircle,
  LocateFixed,
  Play,
  Flag,
  Loader2,
} from 'lucide-react';
import {
  calculateMonthlySalary,
  formatEuro,
  formatKm,
  getLocalDateISO,
} from '../../utils/salaryCalculator';
import {
  calculateShiftDurationLabel,
  fetchExactCurrentLocation,
  getCurrentTimeHM,
  isEndBeforeStart,
} from '../../utils/locationHelper';

const QUICK_ADD_KMS = [500, 650, 800];

export default function ShiftModal({
  isOpen,
  onClose,
  onSave,
  editingShift,
  suggestedStartKm,
  monthShifts,
  retroactiveBonus,
  extraWeekends,
  defaultDate,
}) {
  const dialogRef = useRef(null);

  const [startDate, setStartDate] = useState(defaultDate || getLocalDateISO());
  const [startTime, setStartTime] = useState(getCurrentTimeHM);
  const [startLocation, setStartLocation] = useState('');
  const [kmInicial, setKmInicial] = useState('');

  const [endDate, setEndDate] = useState(defaultDate || getLocalDateISO());
  const [endTime, setEndTime] = useState(getCurrentTimeHM);
  const [endLocation, setEndLocation] = useState('');
  const [kmFinal, setKmFinal] = useState('');

  const [weekendOut, setWeekendOut] = useState(false);
  const [notes, setNotes] = useState('');
  const [gpsLoadingField, setGpsLoadingField] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const isFinishingOpenShift = editingShift?.status === 'open';

  useEffect(() => {
    if (!isOpen) return;
    setError('');
    setGpsLoadingField(null);

    const todayISO = getLocalDateISO();
    const nowHM = getCurrentTimeHM();

    if (editingShift) {
      const sDate = editingShift.startDate || editingShift.date || todayISO;
      setStartDate(sDate);
      setStartTime(editingShift.startTime || '08:00');
      setStartLocation(editingShift.startLocation || '');
      setKmInicial(String(editingShift.kmInicial ?? ''));

      if (editingShift.status === 'open') {
        setEndDate(todayISO);
        setEndTime(nowHM);
        setEndLocation('');
        setKmFinal('');
      } else {
        setEndDate(editingShift.endDate || sDate);
        setEndTime(editingShift.endTime || nowHM);
        setEndLocation(editingShift.endLocation || '');
        setKmFinal(String(editingShift.kmFinal ?? ''));
      }

      setWeekendOut(Boolean(editingShift.weekendOut));
      setNotes(editingShift.notes || '');
    } else {
      const initialDate = defaultDate || todayISO;
      setStartDate(initialDate);
      setStartTime(nowHM);
      setStartLocation('');
      setKmInicial(
        suggestedStartKm !== null && suggestedStartKm !== undefined
          ? String(suggestedStartKm)
          : ''
      );

      setEndDate(initialDate);
      setEndTime(nowHM);
      setEndLocation('');
      setKmFinal('');

      setWeekendOut(false);
      setNotes('');
    }
  }, [isOpen, editingShift, suggestedStartKm, defaultDate]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen && !dialog.open) {
      dialog.showModal();
    } else if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  const parsedStart = Number(kmInicial);
  const parsedEnd = Number(kmFinal);
  const hasValidNumbers =
    kmInicial !== '' &&
    kmFinal !== '' &&
    Number.isFinite(parsedStart) &&
    Number.isFinite(parsedEnd) &&
    parsedStart >= 0 &&
    parsedEnd > parsedStart;

  const shiftDistance = hasValidNumbers ? parsedEnd - parsedStart : 0;

  const durationLabel = useMemo(
    () => calculateShiftDurationLabel(startDate, startTime, endDate, endTime),
    [startDate, startTime, endDate, endTime]
  );

  const impactPreview = useMemo(() => {
    const baseShifts = editingShift
      ? monthShifts.filter((s) => s.id !== editingShift.id)
      : monthShifts;

    const beforeStats = calculateMonthlySalary(baseShifts, {
      retroactiveBonus,
      extraWeekends,
    });

    if (!hasValidNumbers && !weekendOut) {
      return null;
    }

    const simulatedShift = {
      id: editingShift?.id || 'preview',
      date: startDate,
      kmInicial: Number.isFinite(parsedStart) ? parsedStart : 0,
      kmFinal: Number.isFinite(parsedEnd) && parsedEnd > parsedStart ? parsedEnd : 0,
      distanceKm: shiftDistance,
      weekendOut,
    };

    const afterStats = calculateMonthlySalary([...baseShifts, simulatedShift], {
      retroactiveBonus,
      extraWeekends,
    });

    const salaryDelta =
      Math.round((afterStats.estimatedSalary - beforeStats.estimatedSalary) * 100) /
      100;

    const crossesThreshold =
      !beforeStats.thresholdReached && afterStats.thresholdReached;

    return {
      salaryDelta,
      crossesThreshold,
      afterTotalKm: afterStats.totalKm,
    };
  }, [
    editingShift,
    monthShifts,
    retroactiveBonus,
    extraWeekends,
    hasValidNumbers,
    weekendOut,
    startDate,
    parsedStart,
    parsedEnd,
    shiftDistance,
  ]);

  const handleCaptureGps = async (target) => {
    setError('');
    setGpsLoadingField(target);
    try {
      const { label } = await fetchExactCurrentLocation();
      if (target === 'start') {
        setStartLocation(label);
      } else {
        setEndLocation(label);
      }
    } catch (err) {
      setError(err.message || 'Não foi possível capturar o GPS.');
    } finally {
      setGpsLoadingField(null);
    }
  };

  const handleQuickAddKm = (delta) => {
    const base = Number(kmInicial) || 0;
    setKmFinal(String(base + delta));
    setError('');
  };

  const handleStartOpenShift = async () => {
    setError('');
    if (!startDate || !startTime) {
      setError('Preencha a data e a hora inicial do turno.');
      return;
    }
    if (kmInicial === '' || !Number.isFinite(parsedStart) || parsedStart < 0) {
      setError('Informe o KM Inicial do odômetro para iniciar o turno.');
      return;
    }

    setSaving(true);
    try {
      await onSave({
        id: editingShift?.id,
        createdAt: editingShift?.createdAt,
        date: startDate,
        startDate,
        startTime,
        startLocation,
        endDate: '',
        endTime: '',
        endLocation: '',
        status: 'open',
        kmInicial: parsedStart,
        kmFinal: parsedStart,
        weekendOut,
        notes,
      });
      onClose();
    } catch (err) {
      setError(err.message || 'Erro ao iniciar o turno.');
    } finally {
      setSaving(false);
    }
  };

  const handleCompleteSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!startDate || !startTime) {
      setError('Informe a data e a hora inicial do turno.');
      return;
    }
    if (!endDate || !endTime) {
      setError('Informe a data e a hora final do turno.');
      return;
    }
    if (isEndBeforeStart(startDate, startTime, endDate, endTime)) {
      setError(
        'A data e hora final do turno não podem ser anteriores à data e hora inicial.'
      );
      return;
    }
    if (kmInicial === '' || kmFinal === '') {
      setError('Preencha o KM Inicial e o KM Final do odômetro.');
      return;
    }
    if (!Number.isFinite(parsedStart) || parsedStart < 0) {
      setError('KM Inicial inválido.');
      return;
    }
    if (!Number.isFinite(parsedEnd) || parsedEnd <= parsedStart) {
      setError('O KM Final deve ser maior que o KM Inicial.');
      return;
    }

    setSaving(true);
    try {
      await onSave({
        id: editingShift?.id,
        createdAt: editingShift?.createdAt,
        date: startDate,
        startDate,
        startTime,
        startLocation,
        endDate,
        endTime,
        endLocation,
        status: 'completed',
        kmInicial: parsedStart,
        kmFinal: parsedEnd,
        weekendOut,
        notes,
      });
      onClose();
    } catch (err) {
      setError(err.message || 'Erro ao guardar o turno.');
    } finally {
      setSaving(false);
    }
  };

  const crossesMidnight = Boolean(startDate && endDate && endDate !== startDate);

  return (
    <dialog
      ref={dialogRef}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose();
      }}
      className="cab-dialog"
      aria-labelledby="shift-modal-title"
    >
      <div className="ios-sheet max-h-[92dvh] overflow-y-auto p-5">
        <div className="ios-grabber" />

        {/* Cabeçalho iOS Sheet */}
        <div className="mb-4 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] text-[16px] font-medium text-[var(--ios-blue)]"
          >
            Cancelar
          </button>
          <h2 id="shift-modal-title" className="text-[17px] font-semibold">
            {isFinishingOpenShift
              ? 'Finalizar Turno'
              : editingShift
              ? 'Editar Turno'
              : 'Novo Turno'}
          </h2>
          <button
            type="button"
            disabled={saving}
            onClick={handleCompleteSubmit}
            className="min-h-[44px] text-[16px] font-bold text-[var(--ios-blue)]"
          >
            {saving ? '...' : 'Concluir'}
          </button>
        </div>

        <form onSubmit={handleCompleteSubmit} className="space-y-4">
          {/* SEÇÃO 1: INÍCIO DO TURNO */}
          <div>
            <div className="mb-1.5 flex items-center justify-between px-2">
              <span className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wider text-[var(--ios-green)]">
                <Play className="h-3 w-3 fill-current" aria-hidden="true" />
                Início do Turno
              </span>
              <button
                type="button"
                onClick={() => {
                  setStartDate(getLocalDateISO());
                  setStartTime(getCurrentTimeHM());
                }}
                className="text-[12px] font-semibold text-[var(--ios-blue)]"
              >
                Agora
              </button>
            </div>

            <div className="ios-fill overflow-hidden rounded-[16px]">
              <div className="grid grid-cols-2 border-b ios-sep-border">
                <label className="border-r ios-sep-border px-3.5 py-2.5">
                  <span className="block text-[11px] font-medium text-[var(--ios-label-secondary)]">
                    Data Início
                  </span>
                  <input
                    type="date"
                    required
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="mt-0.5 w-full bg-transparent text-[15px] font-semibold outline-none"
                  />
                </label>

                <label className="px-3.5 py-2.5">
                  <span className="block text-[11px] font-medium text-[var(--ios-label-secondary)]">
                    Hora Início
                  </span>
                  <input
                    type="time"
                    required
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="tabular-nums mt-0.5 w-full bg-transparent text-[15px] font-semibold outline-none"
                  />
                </label>
              </div>

              <div className="flex items-center gap-2 border-b ios-sep-border px-3.5 py-2.5">
                <div className="flex-1">
                  <span className="block text-[11px] font-medium text-[var(--ios-label-secondary)]">
                    Localização Inicial Exata
                  </span>
                  <input
                    type="text"
                    maxLength={250}
                    value={startLocation}
                    onChange={(e) => setStartLocation(e.target.value)}
                    placeholder="Cidade, rodovia ou toque em GPS"
                    className="mt-0.5 w-full bg-transparent text-[15px] outline-none placeholder:text-[var(--ios-label-tertiary)]"
                  />
                </div>
                <button
                  type="button"
                  disabled={gpsLoadingField !== null}
                  onClick={() => handleCaptureGps('start')}
                  className="inline-flex min-h-[40px] shrink-0 items-center gap-1 rounded-full bg-[var(--ios-blue)]/15 px-3 text-[12px] font-semibold text-[var(--ios-blue)] active:scale-95 disabled:opacity-50"
                >
                  {gpsLoadingField === 'start' ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <LocateFixed className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  GPS
                </button>
              </div>

              <label className="flex min-h-[54px] items-center justify-between gap-3 px-3.5">
                <span className="text-[15px] font-medium">KM Inicial</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min="0"
                  step="1"
                  required
                  value={kmInicial}
                  onChange={(e) => {
                    setKmInicial(e.target.value);
                    setError('');
                  }}
                  placeholder="412500"
                  className="tabular-nums w-36 bg-transparent text-right text-[18px] font-bold outline-none placeholder:text-[var(--ios-label-tertiary)]"
                />
              </label>
            </div>
          </div>

          {!editingShift && (
            <button
              type="button"
              disabled={saving}
              onClick={handleStartOpenShift}
              className="flex min-h-[50px] w-full items-center justify-center gap-2 rounded-[14px] bg-[var(--ios-green)]/15 px-4 text-[15px] font-semibold text-[var(--ios-green)] transition active:scale-[0.98] disabled:opacity-50"
            >
              <Play className="h-4 w-4 fill-current" aria-hidden="true" />
              Iniciar Turno Agora (Finalizar Depois)
            </button>
          )}

          {/* SEÇÃO 2: FINAL DO TURNO */}
          <div>
            <div className="mb-1.5 flex items-center justify-between px-2">
              <span className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wider text-[var(--ios-orange)]">
                <Flag className="h-3 w-3" aria-hidden="true" />
                Final do Turno
              </span>
              <button
                type="button"
                onClick={() => {
                  setEndDate(getLocalDateISO());
                  setEndTime(getCurrentTimeHM());
                }}
                className="text-[12px] font-semibold text-[var(--ios-blue)]"
              >
                Agora
              </button>
            </div>

            <div className="ios-fill overflow-hidden rounded-[16px]">
              <div className="grid grid-cols-2 border-b ios-sep-border">
                <label className="border-r ios-sep-border px-3.5 py-2.5">
                  <span className="block text-[11px] font-medium text-[var(--ios-label-secondary)]">
                    Data Fim
                  </span>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="mt-0.5 w-full bg-transparent text-[15px] font-semibold outline-none"
                  />
                </label>

                <label className="px-3.5 py-2.5">
                  <span className="block text-[11px] font-medium text-[var(--ios-label-secondary)]">
                    Hora Fim
                  </span>
                  <input
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className="tabular-nums mt-0.5 w-full bg-transparent text-[15px] font-semibold outline-none"
                  />
                </label>
              </div>

              {crossesMidnight && (
                <div className="border-b ios-sep-border bg-[var(--ios-blue)]/10 px-3.5 py-2 text-[12px] font-medium text-[var(--ios-blue)]">
                  Turno entre datas diferentes: {startDate} → {endDate}
                </div>
              )}

              <div className="flex items-center gap-2 border-b ios-sep-border px-3.5 py-2.5">
                <div className="flex-1">
                  <span className="block text-[11px] font-medium text-[var(--ios-label-secondary)]">
                    Localização Final Exata
                  </span>
                  <input
                    type="text"
                    maxLength={250}
                    value={endLocation}
                    onChange={(e) => setEndLocation(e.target.value)}
                    placeholder="Cidade, rodovia ou toque em GPS"
                    className="mt-0.5 w-full bg-transparent text-[15px] outline-none placeholder:text-[var(--ios-label-tertiary)]"
                  />
                </div>
                <button
                  type="button"
                  disabled={gpsLoadingField !== null}
                  onClick={() => handleCaptureGps('end')}
                  className="inline-flex min-h-[40px] shrink-0 items-center gap-1 rounded-full bg-[var(--ios-blue)]/15 px-3 text-[12px] font-semibold text-[var(--ios-blue)] active:scale-95 disabled:opacity-50"
                >
                  {gpsLoadingField === 'end' ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <LocateFixed className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  GPS
                </button>
              </div>

              <label className="flex min-h-[54px] items-center justify-between gap-3 px-3.5">
                <span className="text-[15px] font-medium">KM Final</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min="0"
                  step="1"
                  value={kmFinal}
                  onChange={(e) => {
                    setKmFinal(e.target.value);
                    setError('');
                  }}
                  placeholder="413180"
                  className="tabular-nums w-36 bg-transparent text-right text-[18px] font-bold outline-none placeholder:text-[var(--ios-label-tertiary)]"
                />
              </label>
            </div>

            {kmInicial !== '' && Number(kmInicial) >= 0 && (
              <div className="mt-2 grid grid-cols-3 gap-2">
                {QUICK_ADD_KMS.map((delta) => (
                  <button
                    key={delta}
                    type="button"
                    onClick={() => handleQuickAddKm(delta)}
                    className="ios-fill tabular-nums min-h-[40px] rounded-full text-[13px] font-semibold text-[var(--ios-blue)] transition active:scale-95"
                  >
                    +{delta} km
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Observação + Fim de Semana */}
          <div className="ios-fill overflow-hidden rounded-[16px]">
            <label className="flex min-h-[50px] items-center gap-3 border-b ios-sep-border px-3.5">
              <span className="text-[14px] font-medium text-[var(--ios-label-secondary)]">
                Nota
              </span>
              <input
                type="text"
                maxLength={60}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Ex: ES -> FR -> DE"
                className="w-full bg-transparent text-[15px] outline-none placeholder:text-[var(--ios-label-tertiary)]"
              />
            </label>

            <div className="flex min-h-[58px] items-center justify-between gap-3 px-3.5 py-2">
              <div>
                <p className="text-[15px] font-medium">
                  Fim de Semana Passado Fora
                </p>
                <p className="text-[12px] text-[var(--ios-label-secondary)]">
                  Adiciona +100,00 € ao mês
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={weekendOut}
                aria-label="Fim de Semana Passado Fora"
                onClick={() => setWeekendOut((prev) => !prev)}
                className="ios-switch"
              >
                <span className="ios-switch-thumb" />
              </button>
            </div>
          </div>

          {/* Preview em tempo real */}
          {(impactPreview || durationLabel) && (
            <div className="ios-fill space-y-1.5 rounded-[16px] p-3.5 text-[14px]">
              {durationLabel && (
                <div className="flex justify-between">
                  <span className="text-[var(--ios-label-secondary)]">Duração</span>
                  <span className="tabular-nums font-semibold text-[var(--ios-blue)]">
                    {durationLabel}
                  </span>
                </div>
              )}
              {impactPreview && (
                <>
                  <div className="flex justify-between">
                    <span className="text-[var(--ios-label-secondary)]">Distância</span>
                    <span className="tabular-nums font-semibold">
                      {formatKm(shiftDistance)} km
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--ios-label-secondary)]">
                      Impacto Salarial
                    </span>
                    <span className="tabular-nums font-bold text-[var(--ios-green)]">
                      +{formatEuro(impactPreview.salaryDelta)}
                    </span>
                  </div>
                  {impactPreview.crossesThreshold && (
                    <div className="mt-2 flex items-start gap-2 rounded-[12px] bg-[var(--ios-green)]/15 p-2.5 text-[12px] font-semibold text-[var(--ios-green)]">
                      <Sparkles className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                      <span>
                        Meta de 16.000 km ultrapassada ({formatKm(impactPreview.afterTotalKm)} km)!
                        {retroactiveBonus
                          ? ' Tarifa sobe para 0,12 €/km em todo o mês!'
                          : ' Excedente acima de 16.000 km passa a 0,12 €/km.'}
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 rounded-[14px] bg-[var(--ios-red)]/15 p-3 text-[13px] font-medium text-[var(--ios-red)]">
              <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={saving}
            className={`min-h-[54px] w-full rounded-[14px] px-4 text-[16px] font-semibold text-white transition active:scale-[0.98] disabled:opacity-50 ${
              isFinishingOpenShift
                ? 'bg-[var(--ios-green)]'
                : 'bg-[var(--ios-blue)]'
            }`}
          >
            {saving
              ? 'Salvando...'
              : isFinishingOpenShift
              ? 'Finalizar Turno Agora'
              : editingShift
              ? 'Salvar Alterações'
              : 'Guardar Turno Concluído'}
          </button>
        </form>
      </div>
    </dialog>
  );
}
