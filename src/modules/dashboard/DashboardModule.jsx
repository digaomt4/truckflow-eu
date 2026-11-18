import React, { useMemo, useState } from 'react';
import {
  Plus,
  ChevronLeft,
  ChevronRight,
  Trash2,
  Pencil,
  Route,
  CheckCircle2,
  Minus,
  Play,
  Flag,
  MapPin,
  Clock,
} from 'lucide-react';
import {
  BASE_SALARY,
  KM_THRESHOLD,
  RATE_BONUS,
  RATE_STANDARD,
  WEEKEND_BONUS_VALUE,
  calculateMonthlySalary,
  formatEuro,
  formatKm,
  formatMonthLabel,
  formatRate,
  getLocalDateISO,
  getMonthKey,
  shiftMonthKey,
} from '../../utils/salaryCalculator';
import { calculateShiftDurationLabel } from '../../utils/locationHelper';
import ShiftModal from './ShiftModal';

function formatShiftDate(dateStr) {
  if (!dateStr) return '--';
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return dateStr;
  const dt = new Date(y, m - 1, d);
  return new Intl.DateTimeFormat('pt-PT', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  }).format(dt);
}

function formatShortDate(dateStr) {
  if (!dateStr) return '--';
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return dateStr;
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
}

export default function DashboardModule({
  shifts,
  settings,
  onSaveShift,
  onDeleteShift,
  onToggleShiftWeekend,
  onUpdateSettings,
  onLoadDemoData,
}) {
  const currentMonthKey = getMonthKey(new Date());
  const [selectedMonth, setSelectedMonth] = useState(currentMonthKey);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingShift, setEditingShift] = useState(null);

  const monthShifts = useMemo(
    () =>
      shifts.filter((shift) => getMonthKey(shift.date) === selectedMonth),
    [shifts, selectedMonth]
  );

  const activeOpenShift = useMemo(
    () => shifts.find((shift) => shift.status === 'open') || null,
    [shifts]
  );

  const extraWeekends = settings.extraWeekendsByMonth?.[selectedMonth] || 0;
  const retroactiveBonus = settings.retroactiveBonus !== false;
  const baseOdometer = Number(settings.initialOdometer) || 0;

  const stats = useMemo(
    () =>
      calculateMonthlySalary(monthShifts, {
        retroactiveBonus,
        extraWeekends,
      }),
    [monthShifts, retroactiveBonus, extraWeekends]
  );

  const monthOdometerRange = useMemo(() => {
    if (monthShifts.length === 0) return null;
    let minStart = Infinity;
    let maxEnd = -Infinity;
    for (const s of monthShifts) {
      const start = Number(s.kmInicial) || 0;
      const end = Number(s.kmFinal) || 0;
      if (start < minStart) minStart = start;
      if (end > maxEnd) maxEnd = end;
    }
    return { minStart, maxEnd };
  }, [monthShifts]);

  const suggestedStartKm = useMemo(() => {
    if (monthShifts.length > 0) return monthShifts[0].kmFinal;
    if (shifts.length > 0) return shifts[0].kmFinal;
    if (baseOdometer > 0) return baseOdometer;
    return null;
  }, [monthShifts, shifts, baseOdometer]);

  const handleOpenCreate = () => {
    setEditingShift(null);
    setIsModalOpen(true);
  };

  const handleOpenEdit = (shift) => {
    setEditingShift(shift);
    setIsModalOpen(true);
  };

  const handleAdjustExtraWeekends = (delta) => {
    const nextValue = Math.max(0, extraWeekends + delta);
    onUpdateSettings({
      ...settings,
      extraWeekendsByMonth: {
        ...(settings.extraWeekendsByMonth || {}),
        [selectedMonth]: nextValue,
      },
    });
  };

  return (
    <div className="space-y-4 pb-6">
      {/* Seletor de Mês estilo Navegação iOS */}
      <section
        aria-label="Seleção do Mês"
        className="ios-card flex items-center justify-between gap-2 px-2 py-1.5"
      >
        <button
          type="button"
          onClick={() => setSelectedMonth((m) => shiftMonthKey(m, -1))}
          aria-label="Mês anterior"
          className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-[var(--ios-blue)] transition active:scale-90"
        >
          <ChevronLeft className="h-6 w-6" aria-hidden="true" />
        </button>

        <div className="flex flex-col items-center text-center">
          <span className="text-[17px] font-semibold tracking-tight">
            {formatMonthLabel(selectedMonth)}
          </span>
          {selectedMonth !== currentMonthKey && (
            <button
              type="button"
              onClick={() => setSelectedMonth(currentMonthKey)}
              className="text-[12px] font-medium text-[var(--ios-blue)]"
            >
              Voltar ao mês atual
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => setSelectedMonth((m) => shiftMonthKey(m, 1))}
          aria-label="Próximo mês"
          className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-[var(--ios-blue)] transition active:scale-90"
        >
          <ChevronRight className="h-6 w-6" aria-hidden="true" />
        </button>
      </section>

      {/* Banner de Turno em Andamento (Aberto) */}
      {activeOpenShift && (
        <section
          aria-label="Turno em Andamento"
          className="ios-card p-4"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--ios-green)]/15 px-2.5 py-1 text-[11px] font-semibold text-[var(--ios-green)]">
                <Play className="h-3 w-3 fill-current" aria-hidden="true" />
                Turno em Andamento
              </span>
              <p className="tabular-nums mt-2 text-[15px] font-semibold">
                {formatShortDate(activeOpenShift.startDate || activeOpenShift.date)} às{' '}
                {activeOpenShift.startTime || '--:--'} · KM {formatKm(activeOpenShift.kmInicial)}
              </p>
              {activeOpenShift.startLocation && (
                <p className="mt-0.5 flex items-center gap-1 text-[13px] text-[var(--ios-label-secondary)]">
                  <MapPin className="h-3.5 w-3.5 shrink-0 text-[var(--ios-blue)]" aria-hidden="true" />
                  {activeOpenShift.startLocation}
                </p>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={() => handleOpenEdit(activeOpenShift)}
            className="mt-3 flex min-h-[50px] w-full items-center justify-center gap-2 rounded-[14px] bg-[var(--ios-green)] px-4 text-[16px] font-semibold text-white transition active:scale-[0.98]"
          >
            <Flag className="h-5 w-5" aria-hidden="true" />
            Finalizar Turno Agora
          </button>
        </section>
      )}

      {/* Card Principal estilo Apple Wallet / Saúde */}
      <section aria-label="Resumo Salarial do Mês" className="ios-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[13px] font-semibold uppercase tracking-wide text-[var(--ios-label-secondary)]">
            Salário Estimado
          </span>

          <span
            className={`rounded-full px-3 py-1 text-[12px] font-semibold ${
              stats.thresholdReached
                ? 'bg-[var(--ios-green)]/15 text-[var(--ios-green)]'
                : 'bg-[var(--ios-orange)]/15 text-[var(--ios-orange)]'
            }`}
          >
            {stats.thresholdReached
              ? `${formatRate(RATE_BONUS)}/km (> 16k)`
              : `${formatRate(RATE_STANDARD)}/km`}
          </span>
        </div>

        <p className="tabular-nums mt-1.5 text-[40px] font-bold tracking-tight text-[var(--ios-label)] sm:text-[44px]">
          {formatEuro(stats.estimatedSalary)}
        </p>

        {/* Lista Agrupada iOS das 3 Parcelas */}
        <div className="ios-fill mt-4 overflow-hidden rounded-[14px]">
          <div className="flex items-center justify-between border-b ios-sep-border px-3.5 py-2.5">
            <span className="text-[14px] text-[var(--ios-label-secondary)]">
              Ordenado Base
            </span>
            <span className="tabular-nums text-[15px] font-semibold">
              {formatEuro(BASE_SALARY)}
            </span>
          </div>

          <div className="flex items-center justify-between border-b ios-sep-border px-3.5 py-2.5">
            <div>
              <span className="block text-[14px] text-[var(--ios-label-secondary)]">
                Quilometragem ({formatKm(stats.totalKm)} km)
              </span>
              {monthOdometerRange ? (
                <span className="tabular-nums text-[11px] text-[var(--ios-label-tertiary)]">
                  Odômetro: {formatKm(monthOdometerRange.minStart)} →{' '}
                  {formatKm(monthOdometerRange.maxEnd)}
                </span>
              ) : (
                baseOdometer > 0 && (
                  <span className="tabular-nums text-[11px] text-[var(--ios-blue)]">
                    Odômetro base: {formatKm(baseOdometer)} km
                  </span>
                )
              )}
            </div>
            <div className="text-right">
              <span className="tabular-nums block text-[15px] font-semibold text-[var(--ios-orange)]">
                {formatEuro(stats.kmEarnings)}
              </span>
              <span className="tabular-nums text-[11px] text-[var(--ios-label-secondary)]">
                {stats.thresholdReached && !retroactiveBonus
                  ? '0,11 / 0,12 €'
                  : formatRate(stats.activeRate)}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between px-3.5 py-2.5">
            <div>
              <span className="block text-[14px] text-[var(--ios-label-secondary)]">
                Fins de Semana ({stats.weekendsCount}×)
              </span>
              <span className="text-[11px] text-[var(--ios-label-tertiary)]">
                +{formatEuro(WEEKEND_BONUS_VALUE)} cada
              </span>
            </div>

            <div className="flex items-center gap-2.5">
              <span className="tabular-nums text-[15px] font-semibold text-[var(--ios-blue)]">
                {formatEuro(stats.weekendEarnings)}
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => handleAdjustExtraWeekends(-1)}
                  disabled={extraWeekends <= 0}
                  aria-label="Remover fim de semana avulso"
                  className="ios-card flex h-7 w-7 items-center justify-center rounded-full disabled:opacity-35"
                >
                  <Minus className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => handleAdjustExtraWeekends(1)}
                  aria-label="Adicionar fim de semana avulso (+100€)"
                  className="flex h-7 items-center justify-center rounded-full bg-[var(--ios-blue)]/15 px-2.5 text-[12px] font-semibold text-[var(--ios-blue)]"
                >
                  +1
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Barra de Progresso estilo Apple Fitness */}
        <div className="mt-4">
          <div className="mb-1.5 flex items-center justify-between text-[12px] font-medium">
            <span className="text-[var(--ios-label-secondary)]">
              Meta {formatKm(KM_THRESHOLD)} km
            </span>
            <span
              className={`tabular-nums font-semibold ${
                stats.thresholdReached
                  ? 'text-[var(--ios-green)]'
                  : 'text-[var(--ios-blue)]'
              }`}
            >
              {formatKm(stats.totalKm)} / {formatKm(KM_THRESHOLD)} km (
              {Math.round(stats.progressPercentage)}%)
            </span>
          </div>

          <div
            className="ios-fill h-2.5 w-full overflow-hidden rounded-full"
            role="progressbar"
            aria-valuenow={Math.min(stats.totalKm, KM_THRESHOLD)}
            aria-valuemin={0}
            aria-valuemax={KM_THRESHOLD}
            aria-label="Progresso de quilometragem até 16.000 km"
          >
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${Math.max(
                  stats.totalKm > 0 ? 3 : 0,
                  stats.progressPercentage
                )}%`,
                backgroundColor: stats.thresholdReached
                  ? 'var(--ios-green)'
                  : 'var(--ios-blue)',
              }}
            />
          </div>

          <p className="mt-2 text-[12px] leading-relaxed text-[var(--ios-label-secondary)]">
            {stats.thresholdReached ? (
              <span className="font-medium text-[var(--ios-green)]">
                Meta atingida (+{formatKm(stats.kmAboveGoal)} km acima).{' '}
                {retroactiveBonus
                  ? `Bônus retroativo de +${formatEuro(
                      stats.retroactiveJumpValue
                    )} aplicado!`
                  : 'Modo escalonado ativo.'}
              </span>
            ) : (
              <span>
                Faltam{' '}
                <strong className="tabular-nums text-[var(--ios-label)]">
                  {formatKm(stats.remainingKmForGoal)} km
                </strong>{' '}
                para desbloquear os <strong>0,12 €/km</strong>.
              </span>
            )}
          </p>
        </div>
      </section>

      {/* Botão Principal Azul Apple */}
      <button
        type="button"
        onClick={handleOpenCreate}
        className="flex min-h-[54px] w-full items-center justify-center gap-2 rounded-[14px] bg-[var(--ios-blue)] px-5 text-[17px] font-semibold text-white shadow-sm transition active:scale-[0.98]"
      >
        <Plus className="h-5 w-5 stroke-[2.5]" aria-hidden="true" />
        Registrar Turno / KM
      </button>

      {/* Histórico de Turnos (Inset Grouped iOS) */}
      <section aria-label="Turnos Registrados no Mês" className="space-y-2.5">
        <div className="flex items-center justify-between px-2 pt-1">
          <h2 className="text-[13px] font-semibold uppercase tracking-wider text-[var(--ios-label-secondary)]">
            Turnos · {formatMonthLabel(selectedMonth)} ({monthShifts.length})
          </h2>

          {monthShifts.length === 0 && (
            <button
              type="button"
              onClick={() => onLoadDemoData(selectedMonth)}
              className="text-[13px] font-semibold text-[var(--ios-blue)]"
            >
              Simular Mês
            </button>
          )}
        </div>

        {monthShifts.length === 0 ? (
          <div className="ios-card p-6 text-center">
            <Route
              className="mx-auto h-9 w-9 text-[var(--ios-label-tertiary)]"
              aria-hidden="true"
            />
            <p className="mt-2.5 text-[15px] font-semibold">
              Nenhum turno neste mês
            </p>
            <p className="mt-1 text-[13px] text-[var(--ios-label-secondary)]">
              Defina o KM inicial nos Ajustes (topo direito) e toque em
              &ldquo;Registrar Turno / KM&rdquo;.
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {monthShifts.map((shift) => {
              const isOpen = shift.status === 'open';
              const sDate = shift.startDate || shift.date;
              const eDate = shift.endDate || '';
              const crossesDays = Boolean(eDate && sDate && eDate !== sDate);
              const duration = !isOpen
                ? calculateShiftDurationLabel(
                    sDate,
                    shift.startTime,
                    eDate || sDate,
                    shift.endTime
                  )
                : null;

              const distance =
                typeof shift.distanceKm === 'number'
                  ? shift.distanceKm
                  : Math.max(
                      0,
                      (Number(shift.kmFinal) || 0) -
                        (Number(shift.kmInicial) || 0)
                    );
              const shiftKmValue = distance * stats.activeRate;

              return (
                <article key={shift.id} className="ios-card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[16px] font-semibold capitalize">
                          {formatShiftDate(sDate)}
                        </span>
                        {isOpen && (
                          <span className="rounded-full bg-[var(--ios-green)]/15 px-2 py-0.5 text-[11px] font-semibold text-[var(--ios-green)]">
                            Em andamento
                          </span>
                        )}
                        {duration && (
                          <span className="ios-fill inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium text-[var(--ios-blue)]">
                            <Clock className="h-3 w-3" aria-hidden="true" />
                            {duration}
                          </span>
                        )}
                        {shift.notes && (
                          <span className="ios-fill truncate rounded-full px-2 py-0.5 text-[11px] font-medium text-[var(--ios-label-secondary)]">
                            {shift.notes}
                          </span>
                        )}
                      </div>

                      <div className="mt-2 space-y-0.5 text-[13px] text-[var(--ios-label-secondary)]">
                        {(shift.startTime || shift.startLocation) && (
                          <p>
                            <span className="font-semibold text-[var(--ios-green)]">
                              Início:{' '}
                            </span>
                            {formatShortDate(sDate)}
                            {shift.startTime ? ` ${shift.startTime}` : ''}
                            {shift.startLocation
                              ? ` · ${shift.startLocation}`
                              : ''}
                          </p>
                        )}

                        {!isOpen &&
                          (shift.endTime || shift.endLocation || crossesDays) && (
                            <p>
                              <span className="font-semibold text-[var(--ios-orange)]">
                                Fim:{' '}
                              </span>
                              {formatShortDate(eDate || sDate)}
                              {shift.endTime ? ` ${shift.endTime}` : ''}
                              {shift.endLocation
                                ? ` · ${shift.endLocation}`
                                : ''}
                            </p>
                          )}

                        <p className="tabular-nums pt-0.5 text-[12px] text-[var(--ios-label-tertiary)]">
                          Odômetro: {formatKm(shift.kmInicial)} →{' '}
                          {isOpen ? 'aberto' : `${formatKm(shift.kmFinal)} km`}
                        </p>
                      </div>
                    </div>

                    <div className="shrink-0 text-right">
                      <p className="tabular-nums text-[16px] font-bold">
                        {isOpen ? '--' : `+${formatKm(distance)} km`}
                      </p>
                      <p className="tabular-nums text-[13px] font-semibold text-[var(--ios-green)]">
                        {isOpen ? 'Aberto' : formatEuro(shiftKmValue)}
                      </p>
                    </div>
                  </div>

                  {/* Rodapé de ações estilo iOS */}
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t ios-sep-border pt-2.5">
                    <button
                      type="button"
                      onClick={() => onToggleShiftWeekend(shift)}
                      className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-full px-3 text-[12px] font-semibold transition active:scale-95 ${
                        shift.weekendOut
                          ? 'bg-[var(--ios-green)]/15 text-[var(--ios-green)]'
                          : 'ios-fill text-[var(--ios-label-secondary)]'
                      }`}
                    >
                      <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                      {shift.weekendOut
                        ? 'FDS Fora (+100 €)'
                        : 'Marcar FDS (+100 €)'}
                    </button>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleOpenEdit(shift)}
                        aria-label={isOpen ? 'Finalizar turno' : 'Editar turno'}
                        className={`flex min-h-[40px] items-center justify-center gap-1.5 rounded-full px-3 text-[12px] font-semibold transition active:scale-95 ${
                          isOpen
                            ? 'bg-[var(--ios-green)]/15 text-[var(--ios-green)]'
                            : 'ios-fill min-w-[40px] text-[var(--ios-blue)]'
                        }`}
                      >
                        {isOpen ? (
                          <>
                            <Flag className="h-3.5 w-3.5" aria-hidden="true" />
                            Finalizar
                          </>
                        ) : (
                          <Pencil className="h-4 w-4" aria-hidden="true" />
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          if (
                            window.confirm(
                              'Deseja apagar este registro de turno?'
                            )
                          ) {
                            onDeleteShift(shift.id);
                          }
                        }}
                        aria-label="Apagar turno"
                        className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-full bg-[var(--ios-red)]/15 text-[var(--ios-red)] transition active:scale-95"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <ShiftModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSave={onSaveShift}
        editingShift={editingShift}
        suggestedStartKm={suggestedStartKm}
        monthShifts={monthShifts}
        retroactiveBonus={retroactiveBonus}
        extraWeekends={extraWeekends}
        defaultDate={
          selectedMonth === currentMonthKey
            ? getLocalDateISO()
            : `${selectedMonth}-01`
        }
      />
    </div>
  );
}
