import React, { useEffect, useMemo, useState } from 'react';
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
  FileSpreadsheet,
  FileText,
  TrendingUp,
  Coins,
  X,
} from 'lucide-react';
import {
  calculateMonthlyProjection,
  calculateMonthlySalary,
  calculateShiftEffectiveValues,
  extractSalaryConfig,
  formatEuro,
  formatKm,
  formatMonthLabel,
  formatRate,
  getLocalDateISO,
  getMonthKey,
  shiftMonthKey,
} from '../../utils/salaryCalculator';
import { calculateShiftDurationLabel } from '../../utils/locationHelper';
import {
  SALARY_EXTRA_CATEGORIES,
  deleteSalaryExtra,
  saveSalaryExtra,
  subscribeSalaryExtras,
} from '../../services/salaryExtrasService';
import ConfirmModal from '../../components/ui/ConfirmModal';
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
  user,
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

  const [allExtras, setAllExtras] = useState([]);
  const [showExtraForm, setShowExtraForm] = useState(false);
  const [extraCategory, setExtraCategory] = useState('holiday');
  const [extraLabel, setExtraLabel] = useState('');
  const [extraAmount, setExtraAmount] = useState('');
  const [extraError, setExtraError] = useState('');
  const [savingExtra, setSavingExtra] = useState(false);

  const [exportStatus, setExportStatus] = useState('');
  const [exporting, setExporting] = useState(false);
  const [confirmState, setConfirmState] = useState(null);

  useEffect(() => {
    const unsub = subscribeSalaryExtras(user?.uid || null, (items) => {
      setAllExtras(items);
    });
    return () => unsub();
  }, [user?.uid]);

  const monthShifts = useMemo(
    () => shifts.filter((shift) => getMonthKey(shift.date) === selectedMonth),
    [shifts, selectedMonth]
  );

  const monthExtras = useMemo(
    () => allExtras.filter((item) => item.monthKey === selectedMonth),
    [allExtras, selectedMonth]
  );

  const extrasTotal = useMemo(
    () =>
      Math.round(
        monthExtras.reduce((acc, item) => acc + (Number(item.amount) || 0), 0) *
          100
      ) / 100,
    [monthExtras]
  );

  const activeOpenShift = useMemo(
    () => shifts.find((shift) => shift.status === 'open') || null,
    [shifts]
  );

  const extraWeekends = settings.extraWeekendsByMonth?.[selectedMonth] || 0;
  const salaryConfig = useMemo(() => extractSalaryConfig(settings), [settings]);
  const retroactiveBonus = salaryConfig.retroactiveBonus;
  const baseOdometer = Number(settings.initialOdometer) || 0;

  const stats = useMemo(
    () =>
      calculateMonthlySalary(monthShifts, {
        ...salaryConfig,
        extraWeekends,
        extrasTotal,
      }),
    [monthShifts, salaryConfig, extraWeekends, extrasTotal]
  );

  const shiftValuesMap = useMemo(
    () => calculateShiftEffectiveValues(monthShifts, stats, salaryConfig),
    [monthShifts, stats, salaryConfig]
  );

  const projection = useMemo(
    () =>
      calculateMonthlyProjection(monthShifts, selectedMonth, stats, {
        ...salaryConfig,
        extraWeekends,
        extrasTotal,
      }),
    [monthShifts, selectedMonth, stats, salaryConfig, extraWeekends, extrasTotal]
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

  const handleSaveExtra = async (e) => {
    e.preventDefault();
    setExtraError('');
    const parsedAmount = Number(extraAmount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0 || parsedAmount > 100000) {
      setExtraError('Informe um valor válido maior que 0 €.');
      return;
    }
    const defaultLabel =
      SALARY_EXTRA_CATEGORIES.find((c) => c.id === extraCategory)?.label ||
      'Extra';
    const finalLabel = extraLabel.trim() || defaultLabel;

    setSavingExtra(true);
    try {
      const { extras } = await saveSalaryExtra(user?.uid || null, {
        monthKey: selectedMonth,
        category: extraCategory,
        label: finalLabel,
        amount: parsedAmount,
      });
      setAllExtras(extras);
      setExtraLabel('');
      setExtraAmount('');
      setShowExtraForm(false);
    } catch (err) {
      setExtraError(err.message || 'Erro ao salvar extra salarial.');
    } finally {
      setSavingExtra(false);
    }
  };

  const handleExportPdf = async () => {
    setExporting(true);
    setExportStatus('');
    try {
      const { exportMonthlyReportPdf } = await import(
        '../../utils/monthlyReportExporter'
      );
      const res = await exportMonthlyReportPdf({
        monthKey: selectedMonth,
        monthLabel: formatMonthLabel(selectedMonth),
        shifts: monthShifts,
        stats,
        extras: monthExtras,
        shiftValuesMap,
        driverProfile: {
          driverName: settings?.driverName || user?.displayName || '',
          tractorPlate: settings?.tractorPlate || '',
          companyName: settings?.companyName || '',
          userEmail: user?.email || '',
        },
      });
      if (res.method === 'shared') {
        setExportStatus(`Relatório ${res.fileName} compartilhado.`);
      } else if (res.method === 'downloaded') {
        setExportStatus(`Relatório ${res.fileName} baixado!`);
      }
    } catch (err) {
      setExportStatus(err.message || 'Falha ao gerar PDF mensal.');
    } finally {
      setExporting(false);
    }
  };

  const handleExportCsv = async () => {
    setExporting(true);
    setExportStatus('');
    try {
      const { exportMonthlyReportCsv } = await import(
        '../../utils/monthlyReportExporter'
      );
      const res = exportMonthlyReportCsv({
        monthKey: selectedMonth,
        shifts: monthShifts,
        stats,
        extras: monthExtras,
        shiftValuesMap,
      });
      setExportStatus(`Planilha ${res.fileName} exportada!`);
    } catch (err) {
      setExportStatus(err.message || 'Falha ao exportar CSV.');
    } finally {
      setExporting(false);
    }
  };

  const categoryLabels = useMemo(
    () =>
      Object.fromEntries(SALARY_EXTRA_CATEGORIES.map((c) => [c.id, c.label])),
    []
  );

  return (
    <div className="space-y-4 pb-6">
      {/* Seletor de Mês Clean Professional */}
      <section
        aria-label="Seleção do Mês"
        className="ios-card flex items-center justify-between gap-2 px-2.5 py-2"
      >
        <button
          type="button"
          onClick={() => setSelectedMonth((m) => shiftMonthKey(m, -1))}
          aria-label="Mês anterior"
          className="flex min-h-[42px] min-w-[42px] items-center justify-center rounded-xl text-[var(--ios-blue)] transition hover:bg-[var(--ios-fill)] active:scale-90"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden="true" />
        </button>

        <div className="flex flex-col items-center text-center">
          <span className="text-[16px] font-bold tracking-tight text-[var(--ios-label)]">
            {formatMonthLabel(selectedMonth)}
          </span>
          {selectedMonth !== currentMonthKey && (
            <button
              type="button"
              onClick={() => setSelectedMonth(currentMonthKey)}
              className="mt-0.5 text-[12px] font-semibold text-[var(--ios-blue)] hover:underline"
            >
              Voltar ao mês atual
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => setSelectedMonth((m) => shiftMonthKey(m, 1))}
          aria-label="Próximo mês"
          className="flex min-h-[42px] min-w-[42px] items-center justify-center rounded-xl text-[var(--ios-blue)] transition hover:bg-[var(--ios-fill)] active:scale-90"
        >
          <ChevronRight className="h-5 w-5" aria-hidden="true" />
        </button>
      </section>

      {/* Banner de Turno em Andamento (Aberto) */}
      {activeOpenShift && (
        <section
          aria-label="Turno em Andamento"
          className="ios-card border-l-4 border-l-[var(--ios-green)] bg-[var(--ios-green)]/[0.04] p-4 sm:p-5"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--ios-green)]/15 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-[var(--ios-green)]">
                <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--ios-green)]" />
                Turno em Andamento
              </span>
              <p className="tabular-nums mt-2 text-[15px] font-bold text-[var(--ios-label)]">
                Início: {formatShortDate(activeOpenShift.startDate || activeOpenShift.date)} às{' '}
                {activeOpenShift.startTime || '--:--'} · Odômetro{' '}
                {formatKm(activeOpenShift.kmInicial)} km
              </p>
              {activeOpenShift.startLocation && (
                <p className="mt-1 flex items-center gap-1.5 text-[13px] text-[var(--ios-label-secondary)]">
                  <MapPin className="h-3.5 w-3.5 shrink-0 text-[var(--ios-blue)]" aria-hidden="true" />
                  {activeOpenShift.startLocation}
                </p>
              )}
            </div>

            <button
              type="button"
              onClick={() => handleOpenEdit(activeOpenShift)}
              className="flex min-h-[46px] shrink-0 items-center justify-center gap-2 rounded-xl bg-[var(--ios-green)] px-4 text-[14px] font-semibold text-white shadow-sm transition active:scale-[0.98]"
            >
              <Flag className="h-4 w-4" aria-hidden="true" />
              Finalizar Turno Agora
            </button>
          </div>
        </section>
      )}

      {/* Card Principal Financeiro */}
      <section aria-label="Resumo Salarial do Mês" className="ios-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[12px] font-bold uppercase tracking-wider text-[var(--ios-label-secondary)]">
            Salário Estimado do Mês
          </span>

          <span
            className={`rounded-full px-3 py-1 text-[12px] font-bold ${
              stats.thresholdReached
                ? 'bg-[var(--ios-green)]/12 text-[var(--ios-green)]'
                : 'bg-[var(--ios-orange)]/15 text-[#B45309] dark:text-[#F59E0B]'
            }`}
          >
            {stats.thresholdReached
              ? `${formatRate(salaryConfig.rateBonus)}/km (> ${Math.round(
                  salaryConfig.kmThreshold / 1000
                )}k)`
              : `${formatRate(salaryConfig.rateStandard)}/km`}
          </span>
        </div>

        <p className="tabular-nums mt-1.5 text-[38px] font-extrabold tracking-tight text-[var(--ios-label)] sm:text-[44px]">
          {formatEuro(stats.estimatedSalary)}
        </p>

        {/* Grade 2x2 de Parcelas */}
        <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <div className="cp-inset flex items-center justify-between px-3.5 py-3">
            <div>
              <span className="block text-[12px] font-semibold text-[var(--ios-label-secondary)]">
                Ordenado Base
              </span>
              <span className="text-[11px] text-[var(--ios-label-tertiary)]">
                Fixo mensal
              </span>
            </div>
            <span className="tabular-nums text-[16px] font-bold text-[var(--ios-label)]">
              {formatEuro(stats.baseSalary)}
            </span>
          </div>

          <div className="cp-inset flex items-center justify-between px-3.5 py-3">
            <div className="min-w-0 pr-2">
              <span className="block text-[12px] font-semibold text-[var(--ios-label-secondary)]">
                Quilometragem ({formatKm(stats.totalKm)} km)
              </span>
              {monthOdometerRange ? (
                <span className="tabular-nums block truncate text-[11px] text-[var(--ios-label-tertiary)]">
                  Odômetro: {formatKm(monthOdometerRange.minStart)} →{' '}
                  {formatKm(monthOdometerRange.maxEnd)}
                </span>
              ) : (
                baseOdometer > 0 && (
                  <span className="tabular-nums block text-[11px] text-[var(--ios-blue)]">
                    Base: {formatKm(baseOdometer)} km
                  </span>
                )
              )}
            </div>
            <div className="shrink-0 text-right">
              <span className="tabular-nums block text-[16px] font-bold text-[var(--ios-label)]">
                {formatEuro(stats.kmEarnings)}
              </span>
              <span className="tabular-nums text-[11px] font-medium text-[var(--ios-label-secondary)]">
                {stats.thresholdReached && !retroactiveBonus
                  ? `${formatRate(salaryConfig.rateStandard).replace(
                      ' €',
                      ''
                    )} / ${formatRate(salaryConfig.rateBonus)}`
                  : formatRate(stats.activeRate)}
              </span>
            </div>
          </div>

          <div className="cp-inset flex items-center justify-between px-3.5 py-3">
            <div>
              <span className="block text-[12px] font-semibold text-[var(--ios-label-secondary)]">
                Fins de Semana ({stats.weekendsCount}×)
              </span>
              <span className="text-[11px] text-[var(--ios-label-tertiary)]">
                +{formatEuro(stats.weekendBonusValue)} cada
              </span>
            </div>

            <div className="flex items-center gap-2">
              <span className="tabular-nums text-[16px] font-bold text-[var(--ios-blue)]">
                {formatEuro(stats.weekendEarnings)}
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => handleAdjustExtraWeekends(-1)}
                  disabled={extraWeekends <= 0}
                  aria-label="Remover fim de semana avulso"
                  className="flex h-8 w-8 items-center justify-center rounded-lg border ios-sep-border bg-[var(--ios-card)] text-[var(--ios-label)] disabled:opacity-35"
                >
                  <Minus className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => handleAdjustExtraWeekends(1)}
                  aria-label={`Adicionar fim de semana avulso (+${formatEuro(
                    stats.weekendBonusValue
                  )})`}
                  className="flex h-8 items-center justify-center rounded-lg bg-[var(--ios-blue)]/10 px-2.5 text-[12px] font-bold text-[var(--ios-blue)]"
                >
                  +1
                </button>
              </div>
            </div>
          </div>

          <div className="cp-inset flex items-center justify-between px-3.5 py-3">
            <div>
              <span className="block text-[12px] font-semibold text-[var(--ios-label-secondary)]">
                Extras do Mês ({monthExtras.length})
              </span>
              <span className="text-[11px] text-[var(--ios-label-tertiary)]">
                Feriados, pernoites, espera
              </span>
            </div>

            <div className="flex items-center gap-2">
              <span className="tabular-nums text-[16px] font-bold text-[var(--ios-green)]">
                {formatEuro(stats.extrasTotal)}
              </span>
              <button
                type="button"
                onClick={() => {
                  setExtraError('');
                  setShowExtraForm((prev) => !prev);
                }}
                className="flex h-8 items-center justify-center rounded-lg bg-[var(--ios-green)]/12 px-2.5 text-[12px] font-bold text-[var(--ios-green)]"
              >
                {showExtraForm ? 'Fechar' : '+ Extra'}
              </button>
            </div>
          </div>
        </div>

        {/* Mini-formulário & lista de Extras Salariais */}
        {(showExtraForm || monthExtras.length > 0) && (
          <div className="cp-inset mt-3 space-y-2.5 p-3.5">
            {showExtraForm && (
              <form onSubmit={handleSaveExtra} className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-[12px] font-semibold text-[var(--ios-label-secondary)]">
                    <Coins className="h-3.5 w-3.5 text-[var(--ios-green)]" aria-hidden="true" />
                    Adicionar Extra ({formatMonthLabel(selectedMonth)})
                  </span>
                  <button
                    type="button"
                    aria-label="Fechar formulário de extra"
                    onClick={() => setShowExtraForm(false)}
                    className="text-[var(--ios-label-secondary)]"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {SALARY_EXTRA_CATEGORIES.map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setExtraCategory(cat.id)}
                      className={`min-h-[36px] rounded-lg px-3 text-[12px] font-semibold transition ${
                        extraCategory === cat.id
                          ? 'bg-[var(--ios-blue)] text-white'
                          : 'border ios-sep-border bg-[var(--ios-card)] text-[var(--ios-label-secondary)]'
                      }`}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <input
                    type="text"
                    maxLength={100}
                    value={extraLabel}
                    onChange={(e) => setExtraLabel(e.target.value)}
                    placeholder="Descrição (ex: Feriado ES)"
                    className="ios-input min-h-[44px] px-3 text-[14px] sm:col-span-2"
                  />
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0.01"
                    step="0.01"
                    required
                    value={extraAmount}
                    onChange={(e) => setExtraAmount(e.target.value)}
                    placeholder="Valor (€)"
                    className="ios-input tabular-nums min-h-[44px] px-3 text-right text-[15px] font-bold"
                  />
                </div>

                {extraError && (
                  <p className="text-[12px] font-medium text-[var(--ios-red)]">
                    {extraError}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={savingExtra}
                  className="min-h-[44px] w-full rounded-xl bg-[var(--ios-green)] px-3 text-[14px] font-semibold text-white transition active:scale-[0.99] disabled:opacity-50"
                >
                  {savingExtra ? 'Salvando...' : 'Guardar Extra'}
                </button>
              </form>
            )}

            {monthExtras.length > 0 && (
              <div className="space-y-1.5">
                {monthExtras.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-2 rounded-xl border ios-sep-border bg-[var(--ios-card)] px-3 py-2 text-[13px]"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-[var(--ios-label)]">
                        {item.label}
                      </p>
                      <p className="text-[11px] text-[var(--ios-label-secondary)]">
                        {categoryLabels[item.category] || 'Extra'}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="tabular-nums font-bold text-[var(--ios-green)]">
                        +{formatEuro(item.amount)}
                      </span>
                      <button
                        type="button"
                        aria-label={`Apagar extra ${item.label}`}
                        onClick={() =>
                          setConfirmState({
                            title: 'Apagar extra salarial?',
                            message: `Remover "${item.label}" (${formatEuro(
                              item.amount
                            )}) deste mês?`,
                            confirmLabel: 'Apagar',
                            onConfirm: async () => {
                              setConfirmState(null);
                              const updated = await deleteSalaryExtra(
                                user?.uid || null,
                                item.id
                              );
                              setAllExtras(updated);
                            },
                          })
                        }
                        className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--ios-red)]/10 text-[var(--ios-red)]"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Barra de Progresso */}
        <div className="mt-4 border-t ios-sep-border pt-4">
          <div className="mb-1.5 flex items-center justify-between text-[12px] font-semibold">
            <span className="text-[var(--ios-label-secondary)]">
              Meta {formatKm(salaryConfig.kmThreshold)} km
            </span>
            <span
              className={`tabular-nums font-bold ${
                stats.thresholdReached
                  ? 'text-[var(--ios-green)]'
                  : 'text-[var(--ios-blue)]'
              }`}
            >
              {formatKm(stats.totalKm)} / {formatKm(salaryConfig.kmThreshold)} km (
              {Math.round(stats.progressPercentage)}%)
            </span>
          </div>

          <div
            className="h-2.5 w-full overflow-hidden rounded-full bg-[var(--ios-fill-secondary)]"
            role="progressbar"
            aria-valuenow={Math.min(stats.totalKm, salaryConfig.kmThreshold)}
            aria-valuemin={0}
            aria-valuemax={salaryConfig.kmThreshold}
            aria-label={`Progresso de quilometragem até ${formatKm(
              salaryConfig.kmThreshold
            )} km`}
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
              <span className="font-semibold text-[var(--ios-green)]">
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
                para desbloquear os{' '}
                <strong className="text-[var(--ios-label)]">
                  {formatRate(salaryConfig.rateBonus)}/km
                </strong>
                .
              </span>
            )}
          </p>
        </div>

        {/* Ritmo & Projeção */}
        {(projection.completedShiftsCount > 0 ||
          (projection.isCurrentMonth && !stats.thresholdReached)) && (
          <div className="cp-inset mt-3.5 p-3.5">
            <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-[var(--ios-label-secondary)]">
              <TrendingUp className="h-3.5 w-3.5 text-[var(--ios-blue)]" aria-hidden="true" />
              Ritmo &amp; Projeção
            </div>
            <div className="grid grid-cols-2 gap-3 text-[12px] sm:grid-cols-3">
              <div>
                <span className="block text-[11px] text-[var(--ios-label-secondary)]">
                  Média / Turno
                </span>
                <strong className="tabular-nums text-[14px] font-bold text-[var(--ios-label)]">
                  {formatKm(projection.avgKmPerShift)} km
                </strong>
              </div>

              {!stats.thresholdReached && projection.requiredKmPerDay > 0 && (
                <div>
                  <span className="block text-[11px] text-[var(--ios-label-secondary)]">
                    Para Meta ({projection.remainingDays}d)
                  </span>
                  <strong className="tabular-nums text-[14px] font-bold text-[#D97706] dark:text-[#F59E0B]">
                    {formatKm(projection.requiredKmPerDay)} km/dia
                  </strong>
                </div>
              )}

              {projection.isCurrentMonth && projection.projectedTotalKm > 0 && (
                <div className="col-span-2 sm:col-span-1">
                  <span className="block text-[11px] text-[var(--ios-label-secondary)]">
                    Projeção Fim do Mês
                  </span>
                  <strong className="tabular-nums text-[14px] font-bold text-[var(--ios-green)]">
                    {formatKm(projection.projectedTotalKm)} km ·{' '}
                    {formatEuro(projection.projectedSalary)}
                  </strong>
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      {/* Ação Principal + Fechamento Mensal */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={handleOpenCreate}
          className="flex min-h-[54px] w-full items-center justify-center gap-2 rounded-2xl bg-[var(--ios-blue)] px-5 text-[16px] font-semibold text-white shadow-sm transition hover:bg-[var(--ios-blue-hover)] active:scale-[0.99]"
        >
          <Plus className="h-5 w-5 stroke-[2.4]" aria-hidden="true" />
          Registrar Turno / KM
        </button>

        <section
          aria-label="Fechamento do Mês"
          className="ios-card flex flex-col justify-center px-4 py-2.5"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--ios-label-secondary)]">
              Fechamento
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={exporting}
                onClick={handleExportPdf}
                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl bg-[var(--ios-blue)]/10 px-3 text-[12px] font-bold text-[var(--ios-blue)] transition active:scale-95 disabled:opacity-50"
              >
                <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                PDF / WhatsApp
              </button>
              <button
                type="button"
                disabled={exporting}
                onClick={handleExportCsv}
                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border ios-sep-border bg-[var(--ios-fill)] px-3 text-[12px] font-bold text-[var(--ios-label)] transition active:scale-95 disabled:opacity-50"
              >
                <FileSpreadsheet className="h-3.5 w-3.5 text-[var(--ios-green)]" aria-hidden="true" />
                CSV
              </button>
            </div>
          </div>
          {exportStatus && (
            <p className="mt-1.5 text-[11px] font-semibold text-[var(--ios-green)]">
              {exportStatus}
            </p>
          )}
        </section>
      </div>

      {/* Histórico de Turnos */}
      <section aria-label="Turnos Registrados no Mês" className="space-y-2.5 pt-1">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-[12px] font-bold uppercase tracking-wider text-[var(--ios-label-secondary)]">
            Turnos · {formatMonthLabel(selectedMonth)} ({monthShifts.length})
          </h2>

          {monthShifts.length === 0 && (
            <button
              type="button"
              onClick={() => onLoadDemoData(selectedMonth)}
              className="text-[13px] font-semibold text-[var(--ios-blue)] hover:underline"
            >
              Simular Mês
            </button>
          )}
        </div>

        {monthShifts.length === 0 ? (
          <div className="ios-card p-8 text-center">
            <Route
              className="mx-auto h-9 w-9 text-[var(--ios-label-tertiary)]"
              aria-hidden="true"
            />
            <p className="mt-3 text-[15px] font-semibold text-[var(--ios-label)]">
              Nenhum turno neste mês
            </p>
            <p className="mt-1 text-[13px] text-[var(--ios-label-secondary)]">
              Defina os parâmetros ou KM inicial nos Ajustes (topo direito) e
              toque em &ldquo;Registrar Turno / KM&rdquo;.
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
              const shiftKmValue = shiftValuesMap.get(shift.id) ?? 0;

              return (
                <article
                  key={shift.id}
                  className={`ios-card p-4 transition ${
                    isOpen
                      ? 'border-l-4 border-l-[var(--ios-green)] bg-[var(--ios-green)]/[0.03]'
                      : ''
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[15px] font-bold capitalize text-[var(--ios-label)]">
                          {formatShiftDate(sDate)}
                        </span>
                        {isOpen ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-[var(--ios-green)]/15 px-2.5 py-0.5 text-[11px] font-bold text-[var(--ios-green)]">
                            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--ios-green)]" />
                            Em andamento
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full border ios-sep-border bg-[var(--ios-fill)] px-2 py-0.5 text-[11px] font-semibold text-[var(--ios-label-secondary)]">
                            Finalizado
                          </span>
                        )}
                        {duration && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-[var(--ios-blue)]/10 px-2 py-0.5 text-[11px] font-semibold text-[var(--ios-blue)]">
                            <Clock className="h-3 w-3" aria-hidden="true" />
                            {duration}
                          </span>
                        )}
                        {shift.notes && (
                          <span className="truncate rounded-full border ios-sep-border bg-[var(--ios-fill)] px-2 py-0.5 text-[11px] font-medium text-[var(--ios-label-secondary)]">
                            {shift.notes}
                          </span>
                        )}
                      </div>

                      <div className="mt-2.5 space-y-1 text-[13px] text-[var(--ios-label-secondary)]">
                        {(shift.startTime || shift.startLocation) && (
                          <p className="flex items-start gap-2">
                            <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[var(--ios-green)]" />
                            <span>
                              <strong className="font-semibold text-[var(--ios-label)]">
                                Início:{' '}
                              </strong>
                              {formatShortDate(sDate)}
                              {shift.startTime ? ` ${shift.startTime}` : ''}
                              {shift.startLocation
                                ? ` · ${shift.startLocation}`
                                : ''}
                            </span>
                          </p>
                        )}

                        {!isOpen &&
                          (shift.endTime || shift.endLocation || crossesDays) && (
                            <p className="flex items-start gap-2">
                              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[var(--ios-blue)]" />
                              <span>
                                <strong className="font-semibold text-[var(--ios-label)]">
                                  Fim:{' '}
                                </strong>
                                {formatShortDate(eDate || sDate)}
                                {shift.endTime ? ` ${shift.endTime}` : ''}
                                {shift.endLocation
                                  ? ` · ${shift.endLocation}`
                                  : ''}
                              </span>
                            </p>
                          )}

                        <p className="tabular-nums pt-0.5 text-[12px] text-[var(--ios-label-tertiary)]">
                          Odômetro: {formatKm(shift.kmInicial)} →{' '}
                          {isOpen ? 'aberto' : `${formatKm(shift.kmFinal)} km`}
                        </p>
                      </div>
                    </div>

                    <div className="shrink-0 text-right">
                      <p className="tabular-nums text-[16px] font-bold text-[var(--ios-label)]">
                        {isOpen ? '--' : `+${formatKm(distance)} km`}
                      </p>
                      <p
                        className={`tabular-nums text-[13px] font-bold ${
                          isOpen
                            ? 'text-[var(--ios-label-secondary)]'
                            : 'text-[var(--ios-green)]'
                        }`}
                      >
                        {isOpen ? 'Em curso' : formatEuro(shiftKmValue)}
                      </p>
                    </div>
                  </div>

                  {/* Rodapé de ações */}
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t ios-sep-border pt-2.5">
                    <button
                      type="button"
                      onClick={() => onToggleShiftWeekend(shift)}
                      className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-xl px-3 text-[12px] font-semibold transition active:scale-95 ${
                        shift.weekendOut
                          ? 'bg-[var(--ios-green)]/12 text-[var(--ios-green)]'
                          : 'border ios-sep-border bg-[var(--ios-fill)] text-[var(--ios-label-secondary)]'
                      }`}
                    >
                      <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                      {shift.weekendOut
                        ? `FDS Fora (+${formatEuro(
                            salaryConfig.weekendBonusValue
                          )})`
                        : `Marcar FDS (+${formatEuro(
                            salaryConfig.weekendBonusValue
                          )})`}
                    </button>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleOpenEdit(shift)}
                        aria-label={isOpen ? 'Finalizar turno' : 'Editar turno'}
                        className={`flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl px-3 text-[12px] font-semibold transition active:scale-95 ${
                          isOpen
                            ? 'bg-[var(--ios-green)] text-white shadow-sm'
                            : 'border ios-sep-border bg-[var(--ios-fill)] min-w-[40px] text-[var(--ios-blue)]'
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
                        onClick={() =>
                          setConfirmState({
                            title: 'Apagar turno?',
                            message: `Deseja apagar o registro do dia ${formatShortDate(
                              sDate
                            )}?`,
                            confirmLabel: 'Apagar',
                            onConfirm: () => {
                              setConfirmState(null);
                              onDeleteShift(shift.id);
                            },
                          })
                        }
                        aria-label="Apagar turno"
                        className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-xl bg-[var(--ios-red)]/10 text-[var(--ios-red)] transition active:scale-95"
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
        extrasTotal={extrasTotal}
        salaryConfig={salaryConfig}
        defaultDate={
          selectedMonth === currentMonthKey
            ? getLocalDateISO()
            : `${selectedMonth}-01`
        }
      />

      <ConfirmModal
        isOpen={Boolean(confirmState)}
        title={confirmState?.title}
        message={confirmState?.message}
        confirmLabel={confirmState?.confirmLabel}
        destructive
        onConfirm={confirmState?.onConfirm}
        onCancel={() => setConfirmState(null)}
      />
    </div>
  );
}
