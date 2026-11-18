import {
  collection,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
} from 'firebase/firestore';
import { db, isFirebaseConfigured } from './firebase';

const SHIFTS_STORAGE_KEY = 'truckflow_shifts_v1';
const SETTINGS_STORAGE_KEY = 'truckflow_settings_v1';

const DEFAULT_SETTINGS = {
  retroactiveBonus: true, // Padrão: Aplicar 0,12€ retroativo a todo o mês ao cruzar 16.000 km
  extraWeekendsByMonth: {}, // Ajustes rápidos manuais por mês (ex: { "2026-11": 1 })
  initialOdometer: 0, // Quilômetro inicial base do odômetro do caminhão
  theme: 'dark', // 'dark' | 'light'
};

function readLocalShifts() {
  try {
    const raw = localStorage.getItem(SHIFTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocalShifts(shifts) {
  try {
    localStorage.setItem(SHIFTS_STORAGE_KEY, JSON.stringify(shifts));
  } catch (err) {
    console.warn('[TruckFlow EU] Falha ao salvar turnos no localStorage:', err);
  }
}

function normalizeSettings(raw) {
  const initialOdometer = Math.max(0, Number(raw?.initialOdometer) || 0);
  const theme = raw?.theme === 'light' ? 'light' : 'dark';
  return {
    ...DEFAULT_SETTINGS,
    ...(raw || {}),
    retroactiveBonus: raw?.retroactiveBonus !== false,
    extraWeekendsByMonth: raw?.extraWeekendsByMonth || {},
    initialOdometer,
    theme,
  };
}

export function readLocalSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return normalizeSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function writeLocalSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch (err) {
    console.warn('[TruckFlow EU] Falha ao salvar configurações no localStorage:', err);
  }
}

function sortShiftsDescending(shifts) {
  return [...shifts].sort((a, b) => {
    const dateCompare = String(b.date || '').localeCompare(String(a.date || ''));
    if (dateCompare !== 0) return dateCompare;
    return Number(b.kmFinal || 0) - Number(a.kmFinal || 0);
  });
}

function createShiftId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `shift_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Inscreve em atualizações de turnos.
 * Emite imediatamente os dados locais e, se houver usuário + Firestore ativo,
 * sincroniza em tempo real via onSnapshot (com suporte offline IndexedDB).
 */
export function subscribeShifts(userId, callback) {
  const localShifts = sortShiftsDescending(readLocalShifts());
  callback(localShifts);

  if (!isFirebaseConfigured || !db || !userId) {
    return () => {};
  }

  const shiftsRef = collection(db, 'users', userId, 'shifts');
  const q = query(shiftsRef, orderBy('date', 'desc'));
  let initialLocalMigrationChecked = false;

  return onSnapshot(
    q,
    (snapshot) => {
      const remoteShifts = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data(),
      }));

      // Apenas na primeira carga: se a nuvem estiver vazia mas houver turnos offline locais, envia para o Firestore
      if (!initialLocalMigrationChecked) {
        initialLocalMigrationChecked = true;
        const currentLocal = readLocalShifts();
        if (remoteShifts.length === 0 && currentLocal.length > 0) {
          currentLocal.forEach((shift) => {
            const ref = doc(db, 'users', userId, 'shifts', shift.id);
            setDoc(ref, shift, { merge: true }).catch(() => {});
          });
          return;
        }
      }

      const sorted = sortShiftsDescending(remoteShifts);
      writeLocalShifts(sorted);
      callback(sorted);
    },
    (err) => {
      console.warn('[TruckFlow EU] Erro na sincronização Firestore, mantendo local:', err);
    }
  );
}

/**
 * Cria ou atualiza um turno/viagem local e no Cloud Firestore.
 */
export async function saveShift(userId, shiftData) {
  const id = shiftData.id || createShiftId();
  const current = readLocalShifts();
  const existing = current.find((item) => item.id === id);

  const status = shiftData.status === 'open' ? 'open' : 'completed';
  const kmInicial = Number(shiftData.kmInicial) || 0;
  const rawKmFinal = Number(shiftData.kmFinal);
  const kmFinal =
    status === 'open'
      ? Math.max(kmInicial, Number.isFinite(rawKmFinal) ? rawKmFinal : kmInicial)
      : Number.isFinite(rawKmFinal)
      ? rawKmFinal
      : 0;
  const distanceKm = Math.max(0, kmFinal - kmInicial);

  const startDate = String(shiftData.startDate || shiftData.date || '').slice(0, 10);
  const endDate = String(shiftData.endDate || '').slice(0, 10);

  const normalizedShift = {
    id,
    date: startDate,
    startDate,
    startTime: String(shiftData.startTime || '').slice(0, 10),
    startLocation: String(shiftData.startLocation || '').trim().slice(0, 300),
    endDate,
    endTime: String(shiftData.endTime || '').slice(0, 10),
    endLocation: String(shiftData.endLocation || '').trim().slice(0, 300),
    status,
    kmInicial,
    kmFinal,
    distanceKm,
    weekendOut: Boolean(shiftData.weekendOut),
    notes: String(shiftData.notes || '').trim(),
    updatedAt: new Date().toISOString(),
    createdAt:
      shiftData.createdAt || existing?.createdAt || new Date().toISOString(),
  };

  const existsIndex = current.findIndex((item) => item.id === id);
  const updatedList =
    existsIndex >= 0
      ? current.map((item) => (item.id === id ? normalizedShift : item))
      : [normalizedShift, ...current];

  const sorted = sortShiftsDescending(updatedList);
  writeLocalShifts(sorted);

  if (isFirebaseConfigured && db && userId) {
    const docRef = doc(db, 'users', userId, 'shifts', id);
    await setDoc(docRef, normalizedShift, { merge: true });
  }

  return { shift: normalizedShift, shifts: sorted };
}

/**
 * Remove um turno local e no Cloud Firestore.
 */
export async function deleteShift(userId, shiftId) {
  const current = readLocalShifts();
  const updatedList = sortShiftsDescending(
    current.filter((item) => item.id !== shiftId)
  );
  writeLocalShifts(updatedList);

  if (isFirebaseConfigured && db && userId) {
    const docRef = doc(db, 'users', userId, 'shifts', shiftId);
    await deleteDoc(docRef);
  }

  return updatedList;
}

/**
 * Alterna rapidamente a marcação de Fim de Semana fora (+100€) em um turno.
 */
export async function toggleShiftWeekend(userId, shift) {
  return saveShift(userId, {
    ...shift,
    weekendOut: !shift.weekendOut,
  });
}

/**
 * Carrega configurações salariais (retroactiveBonus e ajustes manuais de FDS).
 */
export async function getSalarySettings(userId) {
  const localSettings = readLocalSettings();

  if (!isFirebaseConfigured || !db || !userId) {
    return localSettings;
  }

  try {
    const settingsRef = doc(db, 'users', userId, 'settings', 'salary');
    const snap = await getDoc(settingsRef);
    if (snap.exists()) {
      const merged = normalizeSettings(snap.data());
      writeLocalSettings(merged);
      return merged;
    }
  } catch (err) {
    console.warn('[TruckFlow EU] Erro ao ler configurações remotas:', err);
  }

  return localSettings;
}

/**
 * Salva configurações salariais localmente e no Cloud Firestore.
 */
export async function saveSalarySettings(userId, settings) {
  const merged = {
    ...normalizeSettings(settings),
    updatedAt: new Date().toISOString(),
  };

  writeLocalSettings(merged);

  if (isFirebaseConfigured && db && userId) {
    const settingsRef = doc(db, 'users', userId, 'settings', 'salary');
    await setDoc(settingsRef, merged, { merge: true });
  }

  return merged;
}
