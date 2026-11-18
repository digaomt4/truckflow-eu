import React, { useEffect, useRef, useState } from 'react';
import {
  Gauge,
  Sun,
  Moon,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { formatKm } from '../../utils/salaryCalculator';

export default function SettingsModal({
  isOpen,
  onClose,
  settings,
  onUpdateSettings,
}) {
  const dialogRef = useRef(null);
  const [odometerInput, setOdometerInput] = useState('');
  const [theme, setTheme] = useState(settings.theme === 'light' ? 'light' : 'dark');
  const [retroactiveBonus, setRetroactiveBonus] = useState(
    settings.retroactiveBonus !== false
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
    setTheme(settings.theme === 'light' ? 'light' : 'dark');
    setRetroactiveBonus(settings.retroactiveBonus !== false);
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

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSavedMsg('');

    const parsedOdo = odometerInput.trim() === '' ? 0 : Number(odometerInput);
    if (!Number.isFinite(parsedOdo) || parsedOdo < 0) {
      setError('Informe um valor válido de odômetro (0 ou maior).');
      return;
    }

    setSaving(true);
    try {
      await onUpdateSettings({
        ...settings,
        initialOdometer: Math.round(parsedOdo),
        theme,
        retroactiveBonus,
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

        {/* Cabeçalho estilo Ajustes do iPhone */}
        <div className="mb-5 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] text-[16px] font-medium text-[var(--ios-blue)]"
          >
            Cancelar
          </button>
          <h2 id="settings-modal-title" className="text-[17px] font-semibold">
            Ajustes
          </h2>
          <button
            type="button"
            disabled={saving}
            onClick={handleSubmit}
            className="min-h-[44px] text-[16px] font-bold text-[var(--ios-blue)]"
          >
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Seção 1: Odômetro Inicial */}
          <div>
            <span className="mb-1.5 block px-3 text-[12px] font-medium uppercase tracking-wider text-[var(--ios-label-secondary)]">
              Odômetro do Caminhão
            </span>
            <div className="ios-fill rounded-[16px] p-4">
              <label className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-[15px] font-medium">
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
                  className="tabular-nums w-40 bg-transparent text-right text-[20px] font-bold text-[var(--ios-label)] outline-none placeholder:text-[var(--ios-label-tertiary)]"
                />
              </label>
            </div>
            <p className="mt-1.5 px-3 text-[12px] leading-relaxed text-[var(--ios-label-secondary)]">
              Define o quilômetro inicial para preencher automaticamente o 1.º
              turno na tela de início.
              {Number(settings.initialOdometer) > 0 && (
                <span className="ml-1 font-semibold text-[var(--ios-green)]">
                  (Base atual: {formatKm(settings.initialOdometer)} km)
                </span>
              )}
            </p>
          </div>

          {/* Seção 2: Aparência (Segmented Control iOS) */}
          <div>
            <span className="mb-1.5 block px-3 text-[12px] font-medium uppercase tracking-wider text-[var(--ios-label-secondary)]">
              Aparência
            </span>
            <div className="ios-segmented grid-cols-2">
              <button
                type="button"
                aria-selected={theme === 'dark'}
                onClick={() => handleSelectTheme('dark')}
                className="ios-segmented-item flex items-center justify-center gap-2"
              >
                <Moon className="h-4 w-4" aria-hidden="true" />
                Escuro
              </button>
              <button
                type="button"
                aria-selected={theme === 'light'}
                onClick={() => handleSelectTheme('light')}
                className="ios-segmented-item flex items-center justify-center gap-2"
              >
                <Sun className="h-4 w-4" aria-hidden="true" />
                Claro
              </button>
            </div>
          </div>

          {/* Seção 3: Regra Salarial com Switch nativo do iPhone */}
          <div>
            <span className="mb-1.5 block px-3 text-[12px] font-medium uppercase tracking-wider text-[var(--ios-label-secondary)]">
              Cálculo Salarial (&gt; 16.000 km)
            </span>
            <div className="ios-fill flex items-center justify-between gap-3 rounded-[16px] p-4">
              <div className="space-y-0.5">
                <p className="text-[15px] font-medium">
                  0,12 € retroativo a todo o mês
                </p>
                <p className="text-[12px] text-[var(--ios-label-secondary)]">
                  {retroactiveBonus
                    ? 'Todos os KM do mês sobem para 0,12 €'
                    : 'Modo escalonado: 0,12 € apenas acima de 16k'}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={retroactiveBonus}
                aria-label="Aplicar 0,12€ retroativo a todo o mês"
                onClick={handleToggleRetroactive}
                className="ios-switch"
              >
                <span className="ios-switch-thumb" />
              </button>
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-[14px] bg-[var(--ios-red)]/15 p-3 text-[13px] font-medium text-[var(--ios-red)]">
              <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          {savedMsg && (
            <div className="flex items-center gap-2 rounded-[14px] bg-[var(--ios-green)]/15 p-3 text-[13px] font-medium text-[var(--ios-green)]">
              <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{savedMsg}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={saving}
            className="min-h-[52px] w-full rounded-[14px] bg-[var(--ios-blue)] px-4 text-[16px] font-semibold text-white transition active:scale-[0.98] disabled:opacity-50"
          >
            {saving ? 'Salvando...' : 'Confirmar Ajustes'}
          </button>
        </form>
      </div>
    </dialog>
  );
}
