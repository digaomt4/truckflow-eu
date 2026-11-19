import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
} from 'firebase/firestore';
import { db, isFirebaseConfigured } from './firebase';

const SALARY_EXTRAS_STORAGE_KEY = 'truckflow_salary_extras_v1';

export const SALARY_EXTRA_CATEGORIES = [
  { id: 'holiday', label: 'Feriado Trabalhado' },
  { id: 'overnight', label: 'Pernoite / Diária' },
  { id: 'waiting', label: 'Hora de Espera' },
  { id: 'other', label: 'Outro Extra' },
];

const VALID_CATEGORIES = new Set(SALARY_EXTRA_CATEGORIES.map((c) => c.id));

function readLocalSalaryExtras() {
  try {
    const raw = localStorage.getItem(SALARY_EXTRAS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocalSalaryExtras(items) {
  try {
    localStorage.setItem(SALARY_EXTRAS_STORAGE_KEY, JSON.stringify(items));
  } catch (err) {
    console.warn('[TruckFlow EU] Falha ao salvar extras salariais:', err);
  }
}

function sortDescending(items) {
  return [...items].sort((a, b) =>
    String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
  );
}

function createExtraId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `extra_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function subscribeSalaryExtras(userId, callback) {
  const local = sortDescending(readLocalSalaryExtras());
  callback(local);

  if (!isFirebaseConfigured || !db || !userId) {
    return () => {};
  }

  const colRef = collection(db, 'users', userId, 'salaryExtras');
  const q = query(colRef, orderBy('createdAt', 'desc'));
  let migrationChecked = false;

  return onSnapshot(
    q,
    (snapshot) => {
      const remote = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      if (!migrationChecked) {
        migrationChecked = true;
        const currentLocal = readLocalSalaryExtras();
        if (remote.length === 0 && currentLocal.length > 0) {
          currentLocal.forEach((item) => {
            setDoc(doc(db, 'users', userId, 'salaryExtras', item.id), item, {
              merge: true,
            }).catch(() => {});
          });
          return;
        }
      }
      const sorted = sortDescending(remote);
      writeLocalSalaryExtras(sorted);
      callback(sorted);
    },
    (err) => {
      console.warn('[TruckFlow EU] Erro ao sincronizar extras salariais:', err);
    }
  );
}

export async function saveSalaryExtra(userId, extraData) {
  const id = extraData.id || createExtraId();
  const category = VALID_CATEGORIES.has(extraData.category)
    ? extraData.category
    : 'other';
  const amount = Math.round((Number(extraData.amount) || 0) * 100) / 100;
  const normalized = {
    id,
    monthKey: String(extraData.monthKey || '').slice(0, 7),
    category,
    label: String(extraData.label || '').trim().slice(0, 120),
    amount,
    createdAt: extraData.createdAt || new Date().toISOString(),
  };

  const current = readLocalSalaryExtras();
  const updated = sortDescending([
    normalized,
    ...current.filter((item) => item.id !== id),
  ]);
  writeLocalSalaryExtras(updated);

  if (isFirebaseConfigured && db && userId) {
    await setDoc(doc(db, 'users', userId, 'salaryExtras', id), normalized, {
      merge: true,
    });
  }

  return { extra: normalized, extras: updated };
}

export async function deleteSalaryExtra(userId, extraId) {
  const updated = sortDescending(
    readLocalSalaryExtras().filter((item) => item.id !== extraId)
  );
  writeLocalSalaryExtras(updated);

  if (isFirebaseConfigured && db && userId) {
    await deleteDoc(doc(db, 'users', userId, 'salaryExtras', extraId));
  }

  return updated;
}
