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
import {
  deleteMediaAsset,
  resolveMediaAsset,
  saveMediaAsset,
} from './mediaStorage';
import { compressSealPhoto, createMiniThumb } from './trailerService';
import { getMonthKey } from '../utils/salaryCalculator';

const EXPENSES_STORAGE_KEY = 'truckflow_expenses_v1';

export const EXPENSE_CATEGORIES = [
  { id: 'parking', label: 'Estacionamento' },
  { id: 'toll', label: 'Pedágio' },
  { id: 'wash', label: 'Lavagem' },
  { id: 'food', label: 'Alimentação' },
  { id: 'fuel', label: 'Combustível / AdBlue' },
  { id: 'other', label: 'Outros' },
];

const VALID_CATEGORIES = new Set(EXPENSE_CATEGORIES.map((c) => c.id));

function readLocalExpenses() {
  try {
    const raw = localStorage.getItem(EXPENSES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocalExpenses(items) {
  try {
    localStorage.setItem(EXPENSES_STORAGE_KEY, JSON.stringify(items));
  } catch (err) {
    console.warn('[TruckFlow EU] Falha ao guardar despesas locais:', err);
  }
}

function sortDescending(items) {
  return [...items].sort((a, b) => {
    const dateCmp = String(b.date || '').localeCompare(String(a.date || ''));
    if (dateCmp !== 0) return dateCmp;
    return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
  });
}

function createExpenseId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `exp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export async function compressReceiptPhoto(file) {
  const fullDataUrl = await compressSealPhoto(file, 1000, 0.72);
  const thumbDataUrl = await createMiniThumb(fullDataUrl, 240, 0.55);
  return { fullDataUrl, thumbDataUrl };
}

export function subscribeExpenses(userId, callback) {
  const local = sortDescending(readLocalExpenses());
  callback(local);

  if (!isFirebaseConfigured || !db || !userId) {
    return () => {};
  }

  const colRef = collection(db, 'users', userId, 'expenses');
  const q = query(colRef, orderBy('date', 'desc'));
  let migrationChecked = false;

  return onSnapshot(
    q,
    (snapshot) => {
      const remote = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      if (!migrationChecked) {
        migrationChecked = true;
        const currentLocal = readLocalExpenses();
        if (remote.length === 0 && currentLocal.length > 0) {
          currentLocal.forEach((item) => {
            setDoc(doc(db, 'users', userId, 'expenses', item.id), item, {
              merge: true,
            }).catch(() => {});
          });
          return;
        }
      }
      const sorted = sortDescending(remote);
      writeLocalExpenses(sorted);
      callback(sorted);
    },
    (err) => {
      console.warn('[TruckFlow EU] Erro ao sincronizar despesas:', err);
    }
  );
}

export async function saveExpense(userId, expenseData) {
  const id = expenseData.id || createExpenseId();
  const category = VALID_CATEGORIES.has(expenseData.category)
    ? expenseData.category
    : 'other';
  const amount = Math.round((Number(expenseData.amount) || 0) * 100) / 100;
  const date = String(expenseData.date || new Date().toISOString().slice(0, 10)).slice(
    0,
    10
  );
  const monthKey = getMonthKey(date);

  let receiptMediaKey = String(expenseData.receiptMediaKey || '');
  let receiptUrl = String(expenseData.receiptUrl || '');
  let receiptThumbDataUrl = String(expenseData.receiptThumbDataUrl || '');

  if (expenseData.receiptFullDataUrl) {
    const asset = await saveMediaAsset(
      userId,
      `expenses/${id}_receipt`,
      expenseData.receiptFullDataUrl
    );
    receiptMediaKey = asset.mediaKey;
    receiptUrl = asset.url;
  }

  if (receiptThumbDataUrl.length > 145000) {
    receiptThumbDataUrl = await createMiniThumb(receiptThumbDataUrl, 240, 0.55);
  }

  const normalized = {
    id,
    date,
    monthKey,
    category,
    description: String(expenseData.description || '').trim().slice(0, 200),
    amount,
    reimbursable: expenseData.reimbursable !== false,
    receiptThumbDataUrl,
    receiptMediaKey,
    receiptUrl,
    createdAt: expenseData.createdAt || new Date().toISOString(),
  };

  const current = readLocalExpenses();
  const updated = sortDescending([
    normalized,
    ...current.filter((item) => item.id !== id),
  ]);
  writeLocalExpenses(updated);

  if (isFirebaseConfigured && db && userId) {
    await setDoc(doc(db, 'users', userId, 'expenses', id), normalized, {
      merge: true,
    });
  }

  return { expense: normalized, expenses: updated };
}

export async function resolveExpenseReceipt(expense) {
  if (!expense) return '';
  return resolveMediaAsset({
    mediaKey: expense.receiptMediaKey,
    url: expense.receiptUrl,
    fallbackDataUrl: expense.receiptThumbDataUrl,
  });
}

export async function deleteExpense(userId, expenseId) {
  const current = readLocalExpenses();
  const target = current.find((item) => item.id === expenseId);

  const updated = sortDescending(current.filter((item) => item.id !== expenseId));
  writeLocalExpenses(updated);

  if (target?.receiptMediaKey) {
    deleteMediaAsset(userId, target.receiptMediaKey).catch(() => {});
  }

  if (isFirebaseConfigured && db && userId) {
    await deleteDoc(doc(db, 'users', userId, 'expenses', expenseId));
  }

  return updated;
}
