import { doc, getDoc, onSnapshot, setDoc } from 'firebase/firestore';
import { db, isFirebaseConfigured } from './firebase';

export const CONTINUOUS_LIMIT_SEC = 4.5 * 3600; // 16.200s (04:30:00)
export const ALERT_30M_LEFT_SEC = 4 * 3600; // 14.400s conduzidos (30 min restantes)
export const ALERT_15M_LEFT_SEC = 4.25 * 3600; // 15.300s conduzidos (15 min restantes)
export const BREAK_FULL_SEC = 45 * 60; // 2.700s
export const BREAK_SPLIT_1_SEC = 15 * 60; // 900s
export const BREAK_SPLIT_2_SEC = 30 * 60; // 1.800s
export const DAILY_LIMIT_9H_SEC = 9 * 3600; // 32.400s
export const DAILY_LIMIT_10H_SEC = 10 * 3600; // 36.000s
export const MAX_WEEKLY_10H_EXTENSIONS = 2;
export const MAX_WEEKLY_REDUCED_RESTS = 3;

const TACHO_STORAGE_KEY = 'truckflow_tacho_v1';

/**
 * Calcula a data da segunda-feira (00:00:00 local) da semana atual em formato YYYY-MM-DD.
 * Usada para resetar automaticamente extensões de 10h e descansos reduzidos toda segunda-feira às 00:00.
 */
export function getCurrentMondayISO(now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const day = d.getDay(); // 0 = Domingo, 1 = Segunda, ...
  const diffToMonday = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diffToMonday);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dt = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dt}`;
}

export function createInitialTachoState() {
  return {
    status: 'idle', // 'idle' | 'driving' | 'break' | 'resting'
    lastUpdatedAt: Date.now(),
    continuousDriveSeconds: 0,
    dailyDriveSeconds: 0,
    dailyExtendedTo10h: false,
    currentBreakSeconds: 0,
    firstSplitBreakDone: false,
    dailyRestSeconds: 0,
    dailyRestTargetHours: 11,
    weekMondayISO: getCurrentMondayISO(),
    weekly10hExtensionsUsed: 0,
    weeklyReducedRestsUsed: 0,
    soundEnabled: true,
    alertsFired: {
      min30: false,
      min15: false,
      limit430: false,
      breakDone: false,
    },
    lastNotice: '',
    history: [],
  };
}

/**
 * Garante o reset semanal caso tenha passado da segunda-feira 00:00
 * e aplica o avanço de tempo caso o app estivesse fechado/em segundo plano.
 */
export function normalizeAndAdvanceTachoState(rawState, nowMs = Date.now()) {
  const base = {
    ...createInitialTachoState(),
    ...(rawState || {}),
    alertsFired: {
      ...createInitialTachoState().alertsFired,
      ...(rawState?.alertsFired || {}),
    },
    history: Array.isArray(rawState?.history) ? rawState.history : [],
  };

  const currentMonday = getCurrentMondayISO(new Date(nowMs));
  if (base.weekMondayISO !== currentMonday) {
    base.weekMondayISO = currentMonday;
    base.weekly10hExtensionsUsed = 0;
    base.weeklyReducedRestsUsed = 0;
  }

  const elapsedSec = Math.max(
    0,
    Math.floor((nowMs - (Number(base.lastUpdatedAt) || nowMs)) / 1000)
  );

  if (elapsedSec <= 0) {
    return { state: { ...base, lastUpdatedAt: nowMs }, events: [] };
  }

  return advanceTachoBySeconds(base, elapsedSec, nowMs);
}

/**
 * Avança os cronômetros do tacógrafo por N segundos, disparando eventos de alerta/conclusão.
 */
export function advanceTachoBySeconds(prevState, seconds, nowMs = Date.now()) {
  const s = {
    ...prevState,
    alertsFired: { ...prevState.alertsFired },
    history: [...(prevState.history || [])],
    lastUpdatedAt: nowMs,
  };
  const events = [];
  const delta = Math.max(0, Math.floor(seconds));

  if (s.status === 'driving' && delta > 0) {
    s.continuousDriveSeconds += delta;
    s.dailyDriveSeconds += delta;

    if (
      s.continuousDriveSeconds >= ALERT_30M_LEFT_SEC &&
      s.continuousDriveSeconds < ALERT_15M_LEFT_SEC &&
      !s.alertsFired.min30
    ) {
      s.alertsFired.min30 = true;
      events.push('warn30');
    }
    if (
      s.continuousDriveSeconds >= ALERT_15M_LEFT_SEC &&
      s.continuousDriveSeconds < CONTINUOUS_LIMIT_SEC &&
      !s.alertsFired.min15
    ) {
      s.alertsFired.min15 = true;
      s.alertsFired.min30 = true;
      events.push('warn15');
    }
    if (
      s.continuousDriveSeconds >= CONTINUOUS_LIMIT_SEC &&
      !s.alertsFired.limit430
    ) {
      s.alertsFired.limit430 = true;
      s.alertsFired.min15 = true;
      s.alertsFired.min30 = true;
      events.push('limit430');
    }
  } else if (s.status === 'break' && delta > 0) {
    s.currentBreakSeconds += delta;
    const requiredBreak = s.firstSplitBreakDone
      ? BREAK_SPLIT_2_SEC
      : BREAK_FULL_SEC;

    if (s.currentBreakSeconds >= requiredBreak && !s.alertsFired.breakDone) {
      const wasSplit = s.firstSplitBreakDone;
      s.alertsFired.breakDone = true;
      s.continuousDriveSeconds = 0;
      s.firstSplitBreakDone = false;
      s.alertsFired.min30 = false;
      s.alertsFired.min15 = false;
      s.alertsFired.limit430 = false;
      s.lastNotice = wasSplit
        ? '2.ª fração (30 min) concluída! Condução contínua zerada.'
        : 'Pausa de 45 min concluída! Condução contínua de 04:30:00 liberada.';
      events.push('breakDone');
    }
  } else if (s.status === 'resting' && delta > 0) {
    s.dailyRestSeconds += delta;
  }

  return { state: s, events };
}

export function formatHMS(totalSeconds) {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(
    s
  ).padStart(2, '0')}`;
}

export function formatHM(totalSeconds) {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  return `${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m`;
}

/**
 * Emite alerta sonoro nítido na cabine usando Web Audio API (sem arquivos MP3 externos).
 */
export function playCabinAlert(level = 'warn30') {
  try {
    const AudioCtx =
      window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    const beepPatterns = {
      warn30: [{ freq: 740, duration: 0.22, delay: 0 }],
      warn15: [
        { freq: 880, duration: 0.2, delay: 0 },
        { freq: 880, duration: 0.25, delay: 0.28 },
      ],
      limit430: [
        { freq: 987, duration: 0.22, delay: 0 },
        { freq: 784, duration: 0.22, delay: 0.26 },
        { freq: 987, duration: 0.35, delay: 0.52 },
      ],
      breakDone: [
        { freq: 523.25, duration: 0.16, delay: 0 },
        { freq: 659.25, duration: 0.16, delay: 0.18 },
        { freq: 783.99, duration: 0.28, delay: 0.36 },
      ],
    };

    const pattern = beepPatterns[level] || beepPatterns.warn30;
    const baseTime = ctx.currentTime;

    pattern.forEach(({ freq, duration, delay }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, baseTime + delay);

      gain.gain.setValueAtTime(0.001, baseTime + delay);
      gain.gain.exponentialRampToValueAtTime(0.28, baseTime + delay + 0.02);
      gain.gain.exponentialRampToValueAtTime(
        0.001,
        baseTime + delay + duration
      );

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(baseTime + delay);
      osc.stop(baseTime + delay + duration + 0.02);
    });

    setTimeout(() => {
      ctx.close().catch(() => {});
    }, 1500);
  } catch {
    // Ignora caso autoplay de áudio ainda não tenha interação prévia
  }
}

export function readLocalTachoState() {
  try {
    const raw = localStorage.getItem(TACHO_STORAGE_KEY);
    if (!raw) return normalizeAndAdvanceTachoState(null).state;
    return normalizeAndAdvanceTachoState(JSON.parse(raw)).state;
  } catch {
    return createInitialTachoState();
  }
}

export function writeLocalTachoState(state) {
  try {
    localStorage.setItem(TACHO_STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    console.warn('[TruckFlow EU] Falha ao guardar tacógrafo local:', err);
  }
}

export async function saveTachoState(userId, state) {
  writeLocalTachoState(state);
  if (!isFirebaseConfigured || !db || !userId) return;

  try {
    const ref = doc(db, 'users', userId, 'tachograph', 'state');
    await setDoc(ref, state, { merge: true });
  } catch (err) {
    console.warn('[TruckFlow EU] Erro ao sincronizar tacógrafo:', err);
  }
}

export function subscribeTachoState(userId, callback) {
  const local = readLocalTachoState();
  callback(local);

  if (!isFirebaseConfigured || !db || !userId) {
    return () => {};
  }

  const ref = doc(db, 'users', userId, 'tachograph', 'state');
  getDoc(ref)
    .then((snap) => {
      if (!snap.exists()) {
        setDoc(ref, local, { merge: true }).catch(() => {});
      }
    })
    .catch(() => {});

  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) return;
      const remote = snap.data();
      const { state } = normalizeAndAdvanceTachoState(remote);
      writeLocalTachoState(state);
      callback(state);
    },
    () => {}
  );
}
