import React, { useEffect, useRef, useState } from 'react';
import {
  Play,
  Coffee,
  Moon,
  Volume2,
  VolumeX,
  AlertTriangle,
  CheckCircle2,
  RotateCcw,
  Plus,
  Minus,
  Zap,
  History,
} from 'lucide-react';
import {
  ALERT_15M_LEFT_SEC,
  ALERT_30M_LEFT_SEC,
  BREAK_FULL_SEC,
  BREAK_SPLIT_1_SEC,
  BREAK_SPLIT_2_SEC,
  CONTINUOUS_LIMIT_SEC,
  DAILY_LIMIT_10H_SEC,
  DAILY_LIMIT_9H_SEC,
  MAX_WEEKLY_10H_EXTENSIONS,
  MAX_WEEKLY_REDUCED_RESTS,
  advanceTachoBySeconds,
  createInitialTachoState,
  formatHM,
  formatHMS,
  playCabinAlert,
  readLocalTachoState,
  saveTachoState,
  subscribeTachoState,
} from '../../services/tachographService';

export default function TachographModule({ user }) {
  const [tacho, setTacho] = useState(() => readLocalTachoState());
  const [restChoiceHours, setRestChoiceHours] = useState(11);
  const stateRef = useRef(tacho);
  stateRef.current = tacho;

  useEffect(() => {
    const unsub = subscribeTachoState(user?.uid || null, (loaded) => {
      setTacho(loaded);
    });
    return () => unsub();
  }, [user?.uid]);

  useEffect(() => {
    if (tacho.status === 'idle') return;

    const timer = setInterval(() => {
      const current = stateRef.current;
      const { state: next, events } = advanceTachoBySeconds(
        current,
        1,
        Date.now()
      );
      setTacho(next);

      if (events.length > 0) {
        if (next.soundEnabled) {
          events.forEach((ev) => playCabinAlert(ev));
        }
        saveTachoState(user?.uid || null, next);
      } else if (next.lastUpdatedAt % 10000 < 1000) {
        saveTachoState(user?.uid || null, next);
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [tacho.status, user?.uid]);

  const commitState = (nextState) => {
    const stamped = {
      ...nextState,
      lastUpdatedAt: Date.now(),
    };
    setTacho(stamped);
    saveTachoState(user?.uid || null, stamped);
  };

  const pushHistory = (history, type, label) => [
    {
      id: `ev_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type,
      label,
      timestamp: new Date().toLocaleTimeString('pt-PT', {
        hour: '2-digit',
        minute: '2-digit',
      }),
    },
    ...(history || []).slice(0, 11),
  ];

  const handleStartDriving = () => {
    const prev = stateRef.current;
    let continuous = prev.continuousDriveSeconds;
    let firstSplitDone = prev.firstSplitBreakDone;
    let alerts = { ...prev.alertsFired };
    let notice = 'Condução iniciada. Boa viagem!';
    let history = prev.history || [];

    if (prev.status === 'break') {
      const pausedSec = prev.currentBreakSeconds;
      if (prev.alertsFired?.breakDone) {
        continuous = 0;
        firstSplitDone = false;
        alerts = { min30: false, min15: false, limit430: false, breakDone: false };
        notice = 'Pausa concluída! Condução contínua de 04:30:00 liberada.';
        history = pushHistory(history, 'drive', 'Condução retomada após pausa válida');
      } else if (pausedSec >= BREAK_FULL_SEC) {
        continuous = 0;
        firstSplitDone = false;
        alerts = { min30: false, min15: false, limit430: false, breakDone: false };
        notice = 'Pausa única de 45 min válida! Condução contínua zerada.';
        history = pushHistory(history, 'break', 'Pausa 45 min concluída · Zerado');
      } else if (firstSplitDone) {
        if (pausedSec >= BREAK_SPLIT_2_SEC) {
          continuous = 0;
          firstSplitDone = false;
          alerts = { min30: false, min15: false, limit430: false, breakDone: false };
          notice = '2.ª fração (30 min) válida! Condução contínua zerada.';
          history = pushHistory(history, 'break', 'Pausa 30 min (2.ª fração) · Zerado');
        } else {
          notice = `Pausa interrompida com ${Math.floor(
            pausedSec / 60
          )} min. A 2.ª fração exige mínimo de 30 min!`;
        }
      } else {
        if (pausedSec >= BREAK_SPLIT_1_SEC) {
          firstSplitDone = true;
          notice =
            '1.ª fração (≥ 15 min) registrada! Próxima pausa exige pelo menos 30 min.';
          history = pushHistory(history, 'split', '1.ª fração (15 min) validada');
        } else if (pausedSec > 10) {
          notice = `Pausa de ${Math.floor(
            pausedSec / 60
          )} min (< 15 min) não conta para fracionamento CE 561/2006.`;
        }
      }
    } else if (prev.status === 'resting') {
      alerts = { min30: false, min15: false, limit430: false, breakDone: false };
      history = pushHistory(history, 'drive', 'Nova jornada diária iniciada');
      commitState({
        ...prev,
        status: 'driving',
        continuousDriveSeconds: 0,
        dailyDriveSeconds: 0,
        dailyExtendedTo10h: false,
        currentBreakSeconds: 0,
        firstSplitBreakDone: false,
        dailyRestSeconds: 0,
        alertsFired: alerts,
        lastNotice: 'Nova jornada diária iniciada após descanso.',
        history,
      });
      return;
    } else {
      history = pushHistory(history, 'drive', 'Condução iniciada');
    }

    commitState({
      ...prev,
      status: 'driving',
      continuousDriveSeconds: continuous,
      currentBreakSeconds: 0,
      firstSplitBreakDone: firstSplitDone,
      alertsFired: alerts,
      lastNotice: notice,
      history,
    });
  };

  const handleStartBreak = () => {
    const prev = stateRef.current;
    const notice = prev.firstSplitBreakDone
      ? 'Pausa iniciada (2.ª fração obrigatória: mínimo 30:00).'
      : 'Pausa iniciada (45:00 completa ou mínimo 15:00 para 1.ª fração).';

    commitState({
      ...prev,
      status: 'break',
      currentBreakSeconds: 0,
      alertsFired: { ...prev.alertsFired, breakDone: false },
      lastNotice: notice,
      history: pushHistory(prev.history, 'break', 'Pausa iniciada'),
    });
  };

  const handleEndShiftRest = (hours = restChoiceHours) => {
    const prev = stateRef.current;
    const isReduced = hours === 9;

    if (isReduced && prev.weeklyReducedRestsUsed >= MAX_WEEKLY_REDUCED_RESTS) {
      commitState({
        ...prev,
        lastNotice:
          'Limite atingido: Você já utilizou os 3 descansos reduzidos (9h) nesta semana.',
      });
      return;
    }

    const nextReducedCount = isReduced
      ? Math.min(MAX_WEEKLY_REDUCED_RESTS, prev.weeklyReducedRestsUsed + 1)
      : prev.weeklyReducedRestsUsed;

    commitState({
      ...prev,
      status: 'resting',
      continuousDriveSeconds: 0,
      dailyDriveSeconds: 0,
      dailyExtendedTo10h: false,
      currentBreakSeconds: 0,
      firstSplitBreakDone: false,
      dailyRestSeconds: 0,
      dailyRestTargetHours: hours,
      weeklyReducedRestsUsed: nextReducedCount,
      alertsFired: { min30: false, min15: false, limit430: false, breakDone: false },
      lastNotice: isReduced
        ? `Descanso reduzido (9h) iniciado (${nextReducedCount}/3 na semana).`
        : 'Descanso diário regular (11h) iniciado.',
      history: pushHistory(
        prev.history,
        'rest',
        `Fim de jornada · Descanso ${hours}h`
      ),
    });
  };

  const handleQuickBreakComplete = (minutes) => {
    const prev = stateRef.current;
    if (minutes === 15) {
      if (prev.firstSplitBreakDone) {
        commitState({
          ...prev,
          lastNotice:
            'A 1.ª fração de 15 min já foi feita! A 2.ª fração exige 30 min.',
        });
        return;
      }
      commitState({
        ...prev,
        status: 'idle',
        currentBreakSeconds: 0,
        firstSplitBreakDone: true,
        lastNotice: '1.ª fração (15 min) validada! Próxima pausa exige 30 min.',
        history: pushHistory(prev.history, 'split', '1.ª fração 15 min registrada'),
      });
      return;
    }

    if (minutes === 30) {
      if (!prev.firstSplitBreakDone) {
        commitState({
          ...prev,
          lastNotice:
            'Registre primeiro a 1.ª fração de 15 min ou faça pausa de 45 min.',
        });
        return;
      }
      if (prev.soundEnabled) playCabinAlert('breakDone');
      commitState({
        ...prev,
        status: 'idle',
        continuousDriveSeconds: 0,
        currentBreakSeconds: 0,
        firstSplitBreakDone: false,
        alertsFired: { min30: false, min15: false, limit430: false, breakDone: false },
        lastNotice: 'Pausa fracionada (15m + 30m) concluída! Zerado.',
        history: pushHistory(prev.history, 'break', '2.ª fração 30 min · Zerado'),
      });
      return;
    }

    if (minutes === 45) {
      if (prev.soundEnabled) playCabinAlert('breakDone');
      commitState({
        ...prev,
        status: 'idle',
        continuousDriveSeconds: 0,
        currentBreakSeconds: 0,
        firstSplitBreakDone: false,
        alertsFired: { min30: false, min15: false, limit430: false, breakDone: false },
        lastNotice: 'Pausa completa de 45 min registrada! Zerado.',
        history: pushHistory(prev.history, 'break', 'Pausa 45 min · Zerado'),
      });
    }
  };

  const handleToggle10hExtension = () => {
    const prev = stateRef.current;
    if (prev.dailyExtendedTo10h) {
      commitState({
        ...prev,
        dailyExtendedTo10h: false,
        weekly10hExtensionsUsed: Math.max(0, prev.weekly10hExtensionsUsed - 1),
        lastNotice: 'Extensão de 10h revertida.',
      });
      return;
    }

    if (prev.weekly10hExtensionsUsed >= MAX_WEEKLY_10H_EXTENSIONS) {
      commitState({
        ...prev,
        lastNotice:
          'Limite atingido: Você já usou 2 extensões de 10h nesta semana.',
      });
      return;
    }

    commitState({
      ...prev,
      dailyExtendedTo10h: true,
      weekly10hExtensionsUsed: prev.weekly10hExtensionsUsed + 1,
      lastNotice: `Extensão de 10h ativada (${prev.weekly10hExtensionsUsed + 1}/2).`,
      history: pushHistory(prev.history, 'ext', 'Extensão diária 10h ativada'),
    });
  };

  const handleSimulateDriveSeconds = (targetSeconds) => {
    const prev = stateRef.current;
    const { state: next, events } = advanceTachoBySeconds(
      {
        ...prev,
        status: 'driving',
        continuousDriveSeconds: targetSeconds,
        dailyDriveSeconds: Math.max(prev.dailyDriveSeconds, targetSeconds),
        alertsFired: { min30: false, min15: false, limit430: false, breakDone: false },
      },
      1,
      Date.now()
    );
    next.continuousDriveSeconds = targetSeconds;
    if (targetSeconds >= ALERT_30M_LEFT_SEC && targetSeconds < ALERT_15M_LEFT_SEC) {
      next.alertsFired.min30 = true;
      if (next.soundEnabled) playCabinAlert('warn30');
      next.lastNotice = 'ALERTA 04:00:00 — Restam apenas 30 min de condução!';
    } else if (targetSeconds >= ALERT_15M_LEFT_SEC && targetSeconds < CONTINUOUS_LIMIT_SEC) {
      next.alertsFired.min30 = true;
      next.alertsFired.min15 = true;
      if (next.soundEnabled) playCabinAlert('warn15');
      next.lastNotice = 'ALERTA URGENTE 04:15:00 — Restam 15 min! Procure parada.';
    } else if (events.length > 0 && next.soundEnabled) {
      playCabinAlert(events[0]);
    }
    commitState(next);
  };

  const handleResetBlock = () => {
    const fresh = createInitialTachoState();
    commitState({
      ...fresh,
      weekly10hExtensionsUsed: tacho.weekly10hExtensionsUsed,
      weeklyReducedRestsUsed: tacho.weeklyReducedRestsUsed,
      soundEnabled: tacho.soundEnabled,
      lastNotice: 'Contadores da jornada reiniciados.',
    });
  };

  const remainingContinuous = Math.max(
    0,
    CONTINUOUS_LIMIT_SEC - tacho.continuousDriveSeconds
  );
  const continuousPct = Math.min(
    100,
    (tacho.continuousDriveSeconds / CONTINUOUS_LIMIT_SEC) * 100
  );

  const isWarn30 =
    tacho.continuousDriveSeconds >= ALERT_30M_LEFT_SEC &&
    tacho.continuousDriveSeconds < ALERT_15M_LEFT_SEC;
  const isWarn15 =
    tacho.continuousDriveSeconds >= ALERT_15M_LEFT_SEC &&
    tacho.continuousDriveSeconds < CONTINUOUS_LIMIT_SEC;
  const isLimitReached = tacho.continuousDriveSeconds >= CONTINUOUS_LIMIT_SEC;

  const dailyLimitSec = tacho.dailyExtendedTo10h
    ? DAILY_LIMIT_10H_SEC
    : DAILY_LIMIT_9H_SEC;
  const remainingDaily = Math.max(0, dailyLimitSec - tacho.dailyDriveSeconds);
  const dailyPct = Math.min(100, (tacho.dailyDriveSeconds / dailyLimitSec) * 100);

  const requiredBreakSec = tacho.firstSplitBreakDone
    ? BREAK_SPLIT_2_SEC
    : BREAK_FULL_SEC;
  const remainingBreakSec = Math.max(
    0,
    requiredBreakSec - tacho.currentBreakSeconds
  );

  const restTargetSec = tacho.dailyRestTargetHours * 3600;
  const remainingRestSec = Math.max(0, restTargetSec - tacho.dailyRestSeconds);

  return (
    <div className="space-y-4 pb-6">
      {(isWarn30 || isWarn15 || isLimitReached) && (
        <div
          role="alert"
          className={`flex items-start gap-3 rounded-[18px] p-4 ${
            isLimitReached || isWarn15
              ? 'bg-[var(--ios-red)]/15 text-[var(--ios-red)]'
              : 'bg-[var(--ios-orange)]/15 text-[var(--ios-orange)]'
          }`}
        >
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-[14px] font-bold">
              {isLimitReached
                ? 'Limite de 04:30:00 atingido — Pare o veículo!'
                : isWarn15
                ? '04:15:00 conduzidos — Restam 15 minutos!'
                : '04:00:00 conduzidos — Restam 30 minutos'}
            </p>
            <p className="mt-0.5 text-[12px] opacity-90">
              {isLimitReached
                ? 'Inicie uma pausa de 45 min (ou 30 min se já fez 15 min).'
                : 'Prepare uma parada segura conforme CE 561/2006.'}
            </p>
          </div>
        </div>
      )}

      {/* Relógio Principal estilo iPhone Clock */}
      <section className="ios-card p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{
                backgroundColor:
                  tacho.status === 'driving'
                    ? 'var(--ios-orange)'
                    : tacho.status === 'break'
                    ? 'var(--ios-green)'
                    : tacho.status === 'resting'
                    ? 'var(--ios-blue)'
                    : 'var(--ios-label-tertiary)',
              }}
            />
            <span className="text-[13px] font-semibold text-[var(--ios-label-secondary)]">
              {tacho.status === 'driving'
                ? 'Condução Ativa'
                : tacho.status === 'break'
                ? 'Em Pausa'
                : tacho.status === 'resting'
                ? `Descanso (${tacho.dailyRestTargetHours}h)`
                : 'Em Espera'}
            </span>
          </div>

          <button
            type="button"
            onClick={() =>
              commitState({ ...tacho, soundEnabled: !tacho.soundEnabled })
            }
            aria-label={tacho.soundEnabled ? 'Desativar som' : 'Ativar som'}
            className="ios-fill flex min-h-[38px] items-center gap-1.5 rounded-full px-3 text-[12px] font-semibold"
          >
            {tacho.soundEnabled ? (
              <>
                <Volume2 className="h-4 w-4 text-[var(--ios-green)]" aria-hidden="true" />
                <span>Som</span>
              </>
            ) : (
              <>
                <VolumeX className="h-4 w-4 text-[var(--ios-label-secondary)]" aria-hidden="true" />
                <span>Mudo</span>
              </>
            )}
          </button>
        </div>

        {/* Display Tipografia Fina iOS Clock */}
        <div className="my-5 text-center">
          {tacho.status === 'break' ? (
            <>
              <p className="text-[12px] font-semibold uppercase tracking-wider text-[var(--ios-green)]">
                {tacho.firstSplitBreakDone
                  ? '2.ª Fração · Meta 30:00'
                  : 'Pausa · Meta 45:00 ou 15:00'}
              </p>
              <p className="tabular-nums mt-1 text-[56px] font-light tracking-tight text-[var(--ios-green)] leading-none">
                {formatHMS(tacho.currentBreakSeconds)}
              </p>
              <p className="tabular-nums mt-2 text-[13px] text-[var(--ios-label-secondary)]">
                Faltam {formatHMS(remainingBreakSec)} para zerar condução
              </p>
            </>
          ) : tacho.status === 'resting' ? (
            <>
              <p className="text-[12px] font-semibold uppercase tracking-wider text-[var(--ios-blue)]">
                Descanso Diário ({tacho.dailyRestTargetHours}h)
              </p>
              <p className="tabular-nums mt-1 text-[56px] font-light tracking-tight text-[var(--ios-blue)] leading-none">
                {formatHMS(tacho.dailyRestSeconds)}
              </p>
              <p className="tabular-nums mt-2 text-[13px] text-[var(--ios-label-secondary)]">
                Restam {formatHMS(remainingRestSec)}
              </p>
            </>
          ) : (
            <>
              <p className="text-[12px] font-semibold uppercase tracking-wider text-[var(--ios-label-secondary)]">
                Tempo Restante (04:30:00)
              </p>
              <p
                className="tabular-nums mt-1 text-[56px] font-light tracking-tight leading-none sm:text-[64px]"
                style={{
                  color:
                    isLimitReached || isWarn15
                      ? 'var(--ios-red)'
                      : isWarn30
                      ? 'var(--ios-orange)'
                      : 'var(--ios-label)',
                }}
              >
                {formatHMS(remainingContinuous)}
              </p>
              <p className="tabular-nums mt-2 text-[13px] text-[var(--ios-label-secondary)]">
                Conduzido: {formatHMS(tacho.continuousDriveSeconds)} / 04:30:00
              </p>
            </>
          )}
        </div>

        {/* Barra de progresso */}
        <div className="ios-fill h-2 w-full overflow-hidden rounded-full">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${continuousPct}%`,
              backgroundColor:
                isLimitReached || isWarn15
                  ? 'var(--ios-red)'
                  : isWarn30
                  ? 'var(--ios-orange)'
                  : 'var(--ios-green)',
            }}
          />
        </div>
        <div className="mt-1.5 flex justify-between text-[11px] font-medium text-[var(--ios-label-tertiary)]">
          <span>00:00</span>
          <span className="text-[var(--ios-orange)]">04:00</span>
          <span className="text-[var(--ios-red)]">04:15</span>
          <span>04:30</span>
        </div>

        {/* Botões Principais iOS */}
        <div className="mt-5 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          <button
            type="button"
            onClick={handleStartDriving}
            disabled={tacho.status === 'driving'}
            className="flex min-h-[52px] items-center justify-center gap-2 rounded-[14px] bg-[var(--ios-green)] px-4 text-[15px] font-semibold text-white transition active:scale-95 disabled:opacity-50"
          >
            <Play className="h-4 w-4 fill-current" aria-hidden="true" />
            {tacho.status === 'driving' ? 'Conduzindo' : 'Iniciar Condução'}
          </button>

          <button
            type="button"
            onClick={handleStartBreak}
            disabled={tacho.status === 'break'}
            className="flex min-h-[52px] items-center justify-center gap-2 rounded-[14px] bg-[var(--ios-orange)]/15 px-4 text-[15px] font-semibold text-[var(--ios-orange)] transition active:scale-95 disabled:opacity-50"
          >
            <Coffee className="h-4 w-4" aria-hidden="true" />
            {tacho.status === 'break' ? 'Em Pausa' : 'Iniciar Pausa'}
          </button>

          <button
            type="button"
            onClick={() => handleEndShiftRest(restChoiceHours)}
            className="flex min-h-[52px] items-center justify-center gap-2 rounded-[14px] bg-[var(--ios-indigo)]/15 px-4 text-[15px] font-semibold text-[var(--ios-indigo)] transition active:scale-95"
          >
            <Moon className="h-4 w-4" aria-hidden="true" />
            Fim de Jornada
          </button>
        </div>

        {tacho.lastNotice && (
          <p className="ios-fill mt-3.5 rounded-[12px] px-3.5 py-2.5 text-[13px] text-[var(--ios-label-secondary)]">
            {tacho.lastNotice}
          </p>
        )}
      </section>

      {/* Pausa Fracionada 15m + 30m ou 45m */}
      <section className="ios-card p-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-[15px] font-semibold">
              Pausa Obrigatória (CE 561/2006)
            </h3>
            <p className="text-[12px] text-[var(--ios-label-secondary)]">
              45 min contínuos ou 15 min + 30 min fracionados
            </p>
          </div>
          {tacho.firstSplitBreakDone && (
            <span className="inline-flex items-center gap-1 rounded-full bg-[var(--ios-green)]/15 px-2.5 py-1 text-[11px] font-semibold text-[var(--ios-green)]">
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
              15m OK
            </span>
          )}
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => handleQuickBreakComplete(15)}
            className={`min-h-[48px] rounded-[12px] px-2 text-[13px] font-semibold transition active:scale-95 ${
              tacho.firstSplitBreakDone
                ? 'bg-[var(--ios-green)]/20 text-[var(--ios-green)]'
                : 'ios-fill text-[var(--ios-label)]'
            }`}
          >
            15 min
            <span className="block text-[11px] font-normal text-[var(--ios-label-secondary)]">
              1.ª fração
            </span>
          </button>

          <button
            type="button"
            onClick={() => handleQuickBreakComplete(30)}
            className={`min-h-[48px] rounded-[12px] px-2 text-[13px] font-semibold transition active:scale-95 ${
              tacho.firstSplitBreakDone
                ? 'bg-[var(--ios-blue)]/20 text-[var(--ios-blue)]'
                : 'ios-fill text-[var(--ios-label-tertiary)]'
            }`}
          >
            30 min
            <span className="block text-[11px] font-normal opacity-80">
              2.ª fração
            </span>
          </button>

          <button
            type="button"
            onClick={() => handleQuickBreakComplete(45)}
            className="min-h-[48px] rounded-[12px] bg-[var(--ios-green)]/15 px-2 text-[13px] font-semibold text-[var(--ios-green)] transition active:scale-95"
          >
            45 min
            <span className="block text-[11px] font-normal opacity-80">
              Completa
            </span>
          </button>
        </div>
      </section>

      {/* Grid Diário e Descanso */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <section className="ios-card p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-[12px] font-semibold uppercase tracking-wider text-[var(--ios-label-secondary)]">
              Diária ({tacho.dailyExtendedTo10h ? '10h' : '9h'})
            </h3>
            <span className="tabular-nums rounded-full bg-[var(--ios-orange)]/15 px-2.5 py-0.5 text-[11px] font-semibold text-[var(--ios-orange)]">
              10h: {tacho.weekly10hExtensionsUsed}/{MAX_WEEKLY_10H_EXTENSIONS}
            </span>
          </div>

          <p className="tabular-nums mt-2 text-[24px] font-bold">
            {formatHM(tacho.dailyDriveSeconds)}{' '}
            <span className="text-[13px] font-medium text-[var(--ios-label-secondary)]">
              / {tacho.dailyExtendedTo10h ? '10h 00m' : '09h 00m'}
            </span>
          </p>
          <p className="tabular-nums text-[12px] text-[var(--ios-label-secondary)]">
            Restante hoje: {formatHM(remainingDaily)}
          </p>

          <div className="ios-fill mt-2.5 h-2 w-full overflow-hidden rounded-full">
            <div
              className="h-full rounded-full bg-[var(--ios-orange)] transition-all"
              style={{ width: `${dailyPct}%` }}
            />
          </div>

          <button
            type="button"
            onClick={handleToggle10hExtension}
            className={`mt-3 flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-[12px] px-3 text-[13px] font-semibold transition active:scale-95 ${
              tacho.dailyExtendedTo10h
                ? 'bg-[var(--ios-orange)] text-white'
                : 'ios-fill text-[var(--ios-blue)]'
            }`}
          >
            <Zap className="h-4 w-4" aria-hidden="true" />
            {tacho.dailyExtendedTo10h
              ? 'Extensão 10h Ativa'
              : 'Usar Extensão 10h'}
          </button>
        </section>

        <section className="ios-card p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-[12px] font-semibold uppercase tracking-wider text-[var(--ios-label-secondary)]">
              Descanso Reduzido (9h)
            </h3>
            <span className="tabular-nums rounded-full bg-[var(--ios-blue)]/15 px-2.5 py-0.5 text-[11px] font-semibold text-[var(--ios-blue)]">
              {tacho.weeklyReducedRestsUsed}/{MAX_WEEKLY_REDUCED_RESTS} sem.
            </span>
          </div>

          <div className="ios-segmented mt-3 grid-cols-2">
            <button
              type="button"
              aria-selected={restChoiceHours === 11}
              onClick={() => setRestChoiceHours(11)}
              className="ios-segmented-item"
            >
              11h Regular
            </button>
            <button
              type="button"
              aria-selected={restChoiceHours === 9}
              onClick={() => setRestChoiceHours(9)}
              className="ios-segmented-item"
            >
              9h Reduzido
            </button>
          </div>

          <div className="ios-fill mt-3 flex items-center justify-between rounded-[12px] px-3 py-1.5">
            <span className="text-[12px] font-medium text-[var(--ios-label-secondary)]">
              9h usados na semana
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                aria-label="Diminuir descansos reduzidos"
                onClick={() =>
                  commitState({
                    ...tacho,
                    weeklyReducedRestsUsed: Math.max(
                      0,
                      tacho.weeklyReducedRestsUsed - 1
                    ),
                  })
                }
                className="ios-card flex h-8 w-8 items-center justify-center rounded-full"
              >
                <Minus className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <span className="tabular-nums w-5 text-center text-[14px] font-bold">
                {tacho.weeklyReducedRestsUsed}
              </span>
              <button
                type="button"
                aria-label="Aumentar descansos reduzidos"
                onClick={() =>
                  commitState({
                    ...tacho,
                    weeklyReducedRestsUsed: Math.min(
                      MAX_WEEKLY_REDUCED_RESTS,
                      tacho.weeklyReducedRestsUsed + 1
                    ),
                  })
                }
                className="ios-card flex h-8 w-8 items-center justify-center rounded-full"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>

          <p className="mt-1.5 text-[11px] text-[var(--ios-label-tertiary)]">
            Reset toda segunda-feira 00:00 ({tacho.weekMondayISO})
          </p>
        </section>
      </div>

      {/* Atalhos de Simulação / Sincronização */}
      <section className="ios-card p-4">
        <div className="mb-2.5 flex items-center justify-between">
          <span className="text-[12px] font-semibold uppercase tracking-wider text-[var(--ios-label-secondary)]">
            Ajustar / Testar Alertas
          </span>
          <button
            type="button"
            onClick={handleResetBlock}
            className="inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--ios-red)]"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            Zerar Bloco
          </button>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() =>
              commitState({
                ...tacho,
                continuousDriveSeconds: tacho.continuousDriveSeconds + 900,
                dailyDriveSeconds: tacho.dailyDriveSeconds + 900,
              })
            }
            className="ios-fill min-h-[42px] rounded-[12px] text-[12px] font-semibold"
          >
            +15 min
          </button>
          <button
            type="button"
            onClick={() => handleSimulateDriveSeconds(ALERT_30M_LEFT_SEC)}
            className="min-h-[42px] rounded-[12px] bg-[var(--ios-orange)]/15 text-[12px] font-semibold text-[var(--ios-orange)]"
          >
            Ir p/ 04:00
          </button>
          <button
            type="button"
            onClick={() => handleSimulateDriveSeconds(ALERT_15M_LEFT_SEC)}
            className="min-h-[42px] rounded-[12px] bg-[var(--ios-red)]/15 text-[12px] font-semibold text-[var(--ios-red)]"
          >
            Ir p/ 04:15
          </button>
        </div>
      </section>

      {tacho.history?.length > 0 && (
        <section className="ios-card p-4">
          <h3 className="mb-2.5 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wider text-[var(--ios-label-secondary)]">
            <History className="h-3.5 w-3.5 text-[var(--ios-blue)]" aria-hidden="true" />
            Eventos Recentes
          </h3>
          <ul className="ios-fill overflow-hidden rounded-[12px] text-[13px]">
            {tacho.history.slice(0, 5).map((item, idx) => (
              <li
                key={item.id}
                className={`flex items-center justify-between px-3.5 py-2.5 ${
                  idx > 0 ? 'border-t ios-sep-border' : ''
                }`}
              >
                <span>{item.label}</span>
                <span className="tabular-nums text-[12px] text-[var(--ios-label-secondary)]">
                  {item.timestamp}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
