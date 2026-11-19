import React, { useEffect, useRef, useState } from 'react';
import {
  Gauge,
  Sun,
  Moon,
  CheckCircle2,
  AlertCircle,
  RotateCcw,
} from 'lucide-react';
import {
  BASE_SALARY,
  KM_THRESHOLD,
  RATE_BONUS,
  RATE_STANDARD,
  WEEKEND_BONUS_VALUE,
  formatKm,
  formatRate,
} from '../../utils/salaryCalculator';

export default function SettingsModal({
  isOpen,
  onClose,
  settings,
  onUpdateSettings,
}) {
  const dialogRef = useRef(null);
  const [odometerInput, setOdometerInput] = useState('');
  const [driverNameInput, setDriverNameInput] = useState('');
  const [tractorPlateInput, setTractorPlateInput] = useState('');
  const [companyNameInput, setCompanyNameInput] = useState('');
  const [theme, setTheme] = useState(settings.theme === 'dark' ? 'dark' : 'light');
  const [retroactiveBonus, setRetroactiveBonus] = useState(
    settings.retroactiveBonus !== false
  );
  const [baseSalaryInput, setBaseSalaryInput] = useState(String(BASE_SALARY));
  const [kmThresholdInput, setKmThresholdInput] = useState(String(KM_THRESHOLD));
  const [rateStandardInput, setRateStandardInput] = useState(String(RATE_STANDARD));
  const [rateBonusInput, setRateBonusInput] = useState(String(RATE_BONUS));
  const [weekendBonusInput, setWeekendBonusInput] = useState(
    String(WEEKEND_BONUS_VALUE)
  );
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setError('');
    setSavedMsg('');
    const currentOdo = Number(settings.initialOdometer) || 0;
    setOdometerInput(currentOdo > 0 ? String(currentOdo) : '');
    setDriverNameInput(settings.driverName || '');
    setTractorPlateInput(settings.tractorPlate || '');
    setCompanyNameInput(settings.companyName || '');
    setTheme(settings.theme === 'dark' ? 'dark' : 'light');
    setRetroactiveBonus(settings.retroactiveBonus !== false);
    setBaseSalaryInput(String(settings.baseSalary ?? BASE_SALARY));
    setKmThresholdInput(String(settings.kmThreshold ?? KM_THRESHOLD));
    setRateStandardInput(String(settings.rateStandard ?? RATE_STANDARD));
    setRateBonusInput(String(settings.rateBonus ?? RATE_BONUS));
    setWeekendBonusInput(String(settings.weekendBonusValue ?? WEEKEND_BONUS_VALUE));
  }, [isOpen, settings]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen && !dialog.open) {
      dialog.showModal();
    } else if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  const handleSelectTheme = async (nextTheme) => {
    setTheme(nextTheme);
    setError('');
    await onUpdateSettings({
      ...settings,
      theme: nextTheme,
    });
  };

  const handleToggleRetroactive = async () => {
    const next = !retroactiveBonus;
    setRetroactiveBonus(next);
    await onUpdateSettings({
      ...settings,
      retroactiveBonus: next,
    });
  };

  const handleRestoreDefaults = () => {
    setBaseSalaryInput(String(BASE_SALARY));
    setKmThresholdInput(String(KM_THRESHOLD));
    setRateStandardInput(String(RATE_STANDARD));
    setRateBonusInput(String(RATE_BONUS));
    setWeekendBonusInput(String(WEEKEND_BONUS_VALUE));
    setError('');
    setSavedMsg('');
  };

  const parsedThreshold = Number(kmThresholdInput);
  const displayThreshold =
    Number.isFinite(parsedThreshold) && parsedThreshold >= 0
      ? Math.round(parsedThreshold)
      : KM_THRESHOLD;
  const parsedRateBonus = Number(rateBonusInput);
  const displayRateBonus =
    Number.isFinite(parsedRateBonus) && parsedRateBonus >= 0
      ? parsedRateBonus
      : RATE_BONUS;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSavedMsg('');

    const parsedOdo = odometerInput.trim() === '' ? 0 : Number(odometerInput);
    const parsedBase = Number(baseSalaryInput);
    const parsedMeta = Number(kmThresholdInput);
    const parsedStd = Number(rateStandardInput);
    const parsedBonus = Number(rateBonusInput);
    const parsedFds = Number(weekendBonusInput);

    if (!Number.isFinite(parsedOdo) || parsedOdo < 0) {
      setError('Informe um valor válido de odômetro (0 ou maior).');
      return;
    }
    if (
      !Number.isFinite(parsedBase) ||
      parsedBase < 0 ||
      parsedBase > 100000
    ) {
      setError('Informe um ordenado base válido (entre 0 e 100.000 €).');
      return;
    }
    if (
      !Number.isFinite(parsedMeta) ||
      parsedMeta < 0 ||
      parsedMeta > 1000000
    ) {
      setError('Informe uma meta de KM válida (entre 0 e 1.000.000 km).');
      return;
    }
    if (
      !Number.isFinite(parsedStd) ||
      parsedStd < 0 ||
      parsedStd > 100 ||
      !Number.isFinite(parsedBonus) ||
      parsedBonus < 0 ||
      parsedBonus > 100
    ) {
      setError('Informe tarifas por KM válidas.');
      return;
    }
    if (!Number.isFinite(parsedFds) || parsedFds < 0 || parsedFds > 10000) {
      setError('Informe um valor de fim de semana válido.');
      return;
    }

    setSaving(true);
    try {
      await onUpdateSettings({
        ...settings,
        initialOdometer: Math.round(parsedOdo),
        driverName: driverNameInput.trim(),
        tractorPlate: tractorPlateInput.trim().toUpperCase(),
        companyName: companyNameInput.trim(),
        theme,
        retroactiveBonus,
        baseSalary: Math.round(parsedBase * 100) / 100,
        kmThreshold: Math.round(parsedMeta),
        rateStandard: Math.round(parsedStd * 1000) / 1000,
        rateBonus: Math.round(parsedBonus * 1000) / 1000,
        weekendBonusValue: Math.round(parsedFds * 100) / 100,
      });
      setSavedMsg('Ajustes salvos!');
      setTimeout(() => {
        onClose();
      }, 280);
    } catch (err) {
      setError(err.message || 'Erro ao guardar os ajustes.');
    } finally {
      setSaving(false);
    }
  };

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
      aria-labelledby="settings-modal-title"
    >
      <div className="ios-sheet max-h-[92dvh] overflow-y-auto p-5">
        <div className="ios-grabber" />

        <div className="mb-5 flex items-center justify-between border-b ios-sep-border pb-3">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] text-[15px] font-medium text-[var(--ios-label-secondary)] hover:text-[var(--ios-label)]"
          >
            Cancelar
          </button>
          <h2 id="settings-modal-title" className="text-[17px] font-bold">
            Ajustes
          </h2>
          <button
            type="button"
            disabled={saving}
            onClick={handleSubmit}
            className="min-h-[40px] text-[15px] font-bold text-[var(--ios-blue)]"
          >
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Seção 1: Odômetro Inicial */}
          <div>
            <span className="mb-1.5 block px-1 text-[12px] font-semibold uppercase tracking-wider text-[var(--ios-label-secondary)]">
              Odômetro do Caminhão
            </span>
            <div className="cp-inset p-3.5">
              <label className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-[14px] font-semibold">
                  <Gauge
                    className="h-5 w-5 text-[var(--ios-blue)]"
                    aria-hidden="true"
                  />
                  KM Inicial
                </span>
                <input
                  type="number"
                  inputMode="numeric"
                  min="0"
                  step="1"
                  value={odometerInput}
                  onChange={(e) => {
                    setOdometerInput(e.target.value);
                    setError('');
                    setSavedMsg('');
                  }}
                  placeholder="Ex: 412500"
                  className="tabular-nums w-40 rounded-lg border ios-sep-border bg-[var(--ios-card)] px-3 py-1.5 text-right text-[18px] font-bold text-[var(--ios-label)] outline-none focus:border-[var(--ios-blue)]"
                />
              </label>
            </div>
            <p className="mt-1.5 px-1 text-[12px] leading-relaxed text-[var(--ios-label-secondary)]">
              Define o quilômetro inicial para preencher automaticamente o 1.º
              turno na tela de início.
              {Number(settings.initialOdometer) > 0 && (
                <span className="ml-1 font-semibold text-[var(--ios-green)]">
                  (Base atual: {formatKm(settings.initialOdometer)} km)
                </span>
              )}
            </p>
          </div>

          {/* Seção 1B: Identificação nos Relatórios PDF */}
          <div>
            <span className="mb-1.5 block px-1 text-[12px] font-semibold uppercase tracking-wider text-[var(--ios-label-secondary)]">
              Identificação nos Relatórios PDF
            </span>
            <div className="cp-inset overflow-hidden">
              <label className="flex min-h-[50px] items-center justify-between gap-3 border-b ios-sep-border px-4">
                <span className="text-[14px] font-medium">Nome do Motorista</span>
                <input
                  type="text"
                  maxLength={80}
                  value={driverNameInput}
                  onChange={(e) => setDriverNameInput(e.target.value)}
                  placeholder="Ex: João Silva"
                  className="w-44 bg-transparent text-right text-[14px] font-semibold outline-none placeholder:text-[var(--ios-label-tertiary)]"
                />
              </label>

              <label className="flex min-h-[50px] items-center justify-between gap-3 border-b ios-sep-border px-4">
                <span className="text-[14px] font-medium">Matrícula do Trator</span>
                <input
                  type="text"
                  maxLength={24}
                  value={tractorPlateInput}
                  onChange={(e) => setTractorPlateInput(e.target.value.toUpperCase())}
                  placeholder="Ex: 00-AA-00"
                  className="w-44 bg-transparent text-right text-[14px] font-bold uppercase outline-none placeholder:text-[var(--ios-label-tertiary)]"
                />
              </label>

              <label className="flex min-h-[50px] items-center justify-between gap-3 px-4">
                <span className="text-[14px] font-medium">Empresa / Frota</span>
                <input
                  type="text"
                  maxLength={80}
                  value={companyNameInput}
                  onChange={(e) => setCompanyNameInput(e.target.value)}
                  placeholder="Ex: Transportes Ibéricos"
                  className="w-44 bg-transparent text-right text-[14px] font-semibold outline-none placeholder:text-[var(--ios-label-tertiary)]"
                />
              </label>
            </div>
            <p className="mt-1.5 px-1 text-[12px] leading-relaxed text-[var(--ios-label-secondary)]">
              Aparece automaticamente no cabeçalho dos PDFs de fechamento e despesas (junto com a matrícula do reboque engatado).
            </p>
          </div>

          {/* Seção 2: Aparência */}
          <div>
            <span className="mb-1.5 block px-1 text-[12px] font-semibold uppercase tracking-wider text-[var(--ios-label-secondary)]">
              Aparência
            </span>
            <div className="ios-segmented grid-cols-2">
              <button
                type="button"
                aria-selected={theme === 'light'}
                onClick={() => handleSelectTheme('light')}
                className="ios-segmented-item flex items-center justify-center gap-2"
              >
                <Sun className="h-4 w-4" aria-hidden="true" />
                Claro
              </button>
              <button
                type="button"
                aria-selected={theme === 'dark'}
                onClick={() => handleSelectTheme('dark')}
                className="ios-segmented-item flex items-center justify-center gap-2"
              >
                <Moon className="h-4 w-4" aria-hidden="true" />
                Escuro
              </button>
            </div>
          </div>

          {/* Seção 3: Parâmetros Salariais Configuráveis */}
          <div>
            <div className="mb-1.5 flex items-center justify-between px-1">
              <span className="text-[12px] font-semibold uppercase tracking-wider text-[var(--ios-label-secondary)]">
                Parâmetros Salariais
              </span>
              <button
                type="button"
                onClick={handleRestoreDefaults}
                className="inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--ios-blue)] hover:underline"
              >
                <RotateCcw className="h-3 w-3" aria-hidden="true" />
                Restaurar Padrão
              </button>
            </div>

            <div className="cp-inset overflow-hidden">
              <label className="flex min-h-[50px] items-center justify-between gap-3 border-b ios-sep-border px-4">
                <span className="text-[14px] font-medium">Ordenado Base (€)</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="1"
                  value={baseSalaryInput}
                  onChange={(e) => setBaseSalaryInput(e.target.value)}
                  className="tabular-nums w-28 bg-transparent text-right text-[16px] font-bold outline-none"
                />
              </label>

              <label className="flex min-h-[50px] items-center justify-between gap-3 border-b ios-sep-border px-4">
                <span className="text-[14px] font-medium">Meta Gatilho (KM)</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min="0"
                  step="100"
                  value={kmThresholdInput}
                  onChange={(e) => setKmThresholdInput(e.target.value)}
                  className="tabular-nums w-28 bg-transparent text-right text-[16px] font-bold outline-none"
                />
              </label>

              <label className="flex min-h-[50px] items-center justify-between gap-3 border-b ios-sep-border px-4">
                <span className="text-[14px] font-medium">
                  Tarifa até a Meta (€/km)
                </span>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={rateStandardInput}
                  onChange={(e) => setRateStandardInput(e.target.value)}
                  className="tabular-nums w-28 bg-transparent text-right text-[16px] font-bold outline-none"
                />
              </label>

              <label className="flex min-h-[50px] items-center justify-between gap-3 border-b ios-sep-border px-4">
                <span className="text-[14px] font-medium">
                  Tarifa acima da Meta (€/km)
                </span>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={rateBonusInput}
                  onChange={(e) => setRateBonusInput(e.target.value)}
                  className="tabular-nums w-28 bg-transparent text-right text-[16px] font-bold outline-none"
                />
              </label>

              <label className="flex min-h-[50px] items-center justify-between gap-3 px-4">
                <span className="text-[14px] font-medium">
                  Fim de Semana Fora (€)
                </span>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="5"
                  value={weekendBonusInput}
                  onChange={(e) => setWeekendBonusInput(e.target.value)}
                  className="tabular-nums w-28 bg-transparent text-right text-[16px] font-bold outline-none"
                />
              </label>
            </div>
          </div>

          {/* Seção 4: Regra Salarial */}
          <div>
            <span className="mb-1.5 block px-1 text-[12px] font-semibold uppercase tracking-wider text-[var(--ios-label-secondary)]">
              Cálculo Salarial (&gt; {formatKm(displayThreshold)} km)
            </span>
            <div className="cp-inset flex items-center justify-between gap-3 p-4">
              <div className="space-y-0.5">
                <p className="text-[14px] font-semibold">
                  {formatRate(displayRateBonus)} retroativo a todo o mês
                </p>
                <p className="text-[12px] text-[var(--ios-label-secondary)]">
                  {retroactiveBonus
                    ? `Todos os KM do mês sobem para ${formatRate(displayRateBonus)}`
                    : `Modo escalonado: ${formatRate(displayRateBonus)} apenas acima da meta`}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={retroactiveBonus}
                aria-label={`Aplicar ${formatRate(displayRateBonus)} retroativo a todo o mês`}
                onClick={handleToggleRetroactive}
                className="ios-switch"
              >
                <span className="ios-switch-thumb" />
              </button>
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-xl border border-[var(--ios-red)]/25 bg-[var(--ios-red)]/10 p-3 text-[13px] font-medium text-[var(--ios-red)]">
              <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          {savedMsg && (
            <div className="flex items-center gap-2 rounded-xl border border-[var(--ios-green)]/25 bg-[var(--ios-green)]/10 p-3 text-[13px] font-medium text-[var(--ios-green)]">
              <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{savedMsg}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={saving}
            className="min-h-[50px] w-full rounded-xl bg-[var(--ios-blue)] px-4 text-[15px] font-semibold text-white shadow-sm transition hover:bg-[var(--ios-blue-hover)] active:scale-[0.99] disabled:opacity-50"
          >
            {saving ? 'Salvando...' : 'Confirmar Ajustes'}
          </button>
        </form>
      </div>
    </dialog>
  );
}
