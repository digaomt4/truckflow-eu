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
import { buildCmrFileName } from '../utils/cmrScanner';

const CMRS_STORAGE_KEY = 'truckflow_cmrs_v1';
const MAX_LOCAL_HISTORY = 15;

function readLocalCmrs() {
  try {
    const raw = localStorage.getItem(CMRS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocalCmrs(records) {
  try {
    localStorage.setItem(
      CMRS_STORAGE_KEY,
      JSON.stringify(records.slice(0, MAX_LOCAL_HISTORY))
    );
  } catch (err) {
    // Se exceder espaço por causa da imagem base64, guarda mantendo apenas a miniatura nos antigos
    try {
      const trimmed = records.slice(0, 6).map((item, idx) =>
        idx === 0 ? item : { ...item, scanDataUrl: '' }
      );
      localStorage.setItem(CMRS_STORAGE_KEY, JSON.stringify(trimmed));
    } catch {
      console.warn('[TruckFlow EU] Espaço local insuficiente para histórico de CMR:', err);
    }
  }
}

function sortDescending(records) {
  return [...records].sort((a, b) =>
    String(b.createdAt || b.date || '').localeCompare(
      String(a.createdAt || a.date || '')
    )
  );
}

function createCmrId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `cmr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function subscribeCmrRecords(userId, callback) {
  const local = sortDescending(readLocalCmrs());
  callback(local);

  if (!isFirebaseConfigured || !db || !userId) {
    return () => {};
  }

  const colRef = collection(db, 'users', userId, 'cmrs');
  const q = query(colRef, orderBy('createdAt', 'desc'));
  let migrationChecked = false;

  return onSnapshot(
    q,
    (snapshot) => {
      const remote = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      if (!migrationChecked) {
        migrationChecked = true;
        const currentLocal = readLocalCmrs();
        if (remote.length === 0 && currentLocal.length > 0) {
          currentLocal.forEach((rec) => {
            setDoc(doc(db, 'users', userId, 'cmrs', rec.id), rec, {
              merge: true,
            }).catch(() => {});
          });
          return;
        }
      }
      const sorted = sortDescending(remote);
      writeLocalCmrs(sorted);
      callback(sorted);
    },
    () => {}
  );
}

export async function saveCmrRecord(userId, cmrData) {
  const id = cmrData.id || createCmrId();
  const fileName = buildCmrFileName(cmrData.date, cmrData.loadNumber);

  const normalized = {
    id,
    date: cmrData.date,
    loadNumber: String(cmrData.loadNumber || '').trim(),
    fileName,
    notes: String(cmrData.notes || '').trim(),
    sizeKb: Number(cmrData.sizeKb) || 0,
    thumbDataUrl: cmrData.thumbDataUrl || '',
    scanDataUrl: cmrData.scanDataUrl || '',
    createdAt: cmrData.createdAt || new Date().toISOString(),
  };

  const current = readLocalCmrs();
  const updated = sortDescending([
    normalized,
    ...current.filter((item) => item.id !== id),
  ]);
  writeLocalCmrs(updated);

  if (isFirebaseConfigured && db && userId) {
    // Limite de 1MB por documento Firestore: envia metadados + thumb (+ scan se < 450KB)
    const firestorePayload =
      normalized.scanDataUrl.length < 450000
        ? normalized
        : { ...normalized, scanDataUrl: '' };

    await setDoc(doc(db, 'users', userId, 'cmrs', id), firestorePayload, {
      merge: true,
    });
  }

  return { record: normalized, records: updated };
}

export async function deleteCmrRecord(userId, recordId) {
  const updated = sortDescending(
    readLocalCmrs().filter((item) => item.id !== recordId)
  );
  writeLocalCmrs(updated);

  if (isFirebaseConfigured && db && userId) {
    await deleteDoc(doc(db, 'users', userId, 'cmrs', recordId));
  }

  return updated;
}
