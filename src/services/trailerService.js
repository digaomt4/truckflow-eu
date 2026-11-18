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

const TRAILERS_STORAGE_KEY = 'truckflow_trailers_v1';

function readLocalTrailers() {
  try {
    const raw = localStorage.getItem(TRAILERS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocalTrailers(records) {
  try {
    localStorage.setItem(TRAILERS_STORAGE_KEY, JSON.stringify(records));
  } catch (err) {
    console.warn('[TruckFlow EU] Falha ao guardar histórico de reboque:', err);
  }
}

function sortDescending(records) {
  return [...records].sort((a, b) =>
    String(b.dateTime || b.createdAt || '').localeCompare(
      String(a.dateTime || a.createdAt || '')
    )
  );
}

function createRecordId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `trl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Comprime foto do lacre/selo via HTML5 Canvas (máx 800px, JPEG 0.7)
 * para economizar dados móveis e caber no Firestore/localStorage.
 */
export function compressSealPhoto(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Não foi possível ler a imagem.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Formato de imagem inválido.'));
      img.onload = () => {
        const MAX_DIM = 800;
        let { width, height } = img;
        if (width > height && width > MAX_DIM) {
          height = Math.round((height * MAX_DIM) / width);
          width = MAX_DIM;
        } else if (height >= width && height > MAX_DIM) {
          width = Math.round((width * MAX_DIM) / height);
          height = MAX_DIM;
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
        resolve(dataUrl);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

export function subscribeTrailerRecords(userId, callback) {
  const local = sortDescending(readLocalTrailers());
  callback(local);

  if (!isFirebaseConfigured || !db || !userId) {
    return () => {};
  }

  const colRef = collection(db, 'users', userId, 'trailers');
  const q = query(colRef, orderBy('dateTime', 'desc'));
  let migrationChecked = false;

  return onSnapshot(
    q,
    (snapshot) => {
      const remote = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      if (!migrationChecked) {
        migrationChecked = true;
        const currentLocal = readLocalTrailers();
        if (remote.length === 0 && currentLocal.length > 0) {
          currentLocal.forEach((rec) => {
            setDoc(doc(db, 'users', userId, 'trailers', rec.id), rec, {
              merge: true,
            }).catch(() => {});
          });
          return;
        }
      }
      const sorted = sortDescending(remote);
      writeLocalTrailers(sorted);
      callback(sorted);
    },
    () => {}
  );
}

export async function saveTrailerRecord(userId, recordData) {
  const id = recordData.id || createRecordId();
  const normalized = {
    id,
    actionType: recordData.actionType === 'uncouple' ? 'uncouple' : 'couple',
    plate: String(recordData.plate || '').trim().toUpperCase(),
    country: String(recordData.country || '').trim().toUpperCase(),
    location: String(recordData.location || '').trim(),
    dateTime: recordData.dateTime || new Date().toISOString().slice(0, 16),
    sealNumber: String(recordData.sealNumber || '').trim().toUpperCase(),
    sealPhotoDataUrl: recordData.sealPhotoDataUrl || '',
    checks: {
      fifthWheelLocked: Boolean(recordData.checks?.fifthWheelLocked),
      airAndAbsConnected: Boolean(recordData.checks?.airAndAbsConnected),
      tirCableIntact: Boolean(recordData.checks?.tirCableIntact),
      sealVerified: Boolean(recordData.checks?.sealVerified),
    },
    createdAt: recordData.createdAt || new Date().toISOString(),
  };

  const current = readLocalTrailers();
  const updated = sortDescending([
    normalized,
    ...current.filter((item) => item.id !== id),
  ]);
  writeLocalTrailers(updated);

  if (isFirebaseConfigured && db && userId) {
    await setDoc(doc(db, 'users', userId, 'trailers', id), normalized, {
      merge: true,
    });
  }

  return updated;
}

export async function deleteTrailerRecord(userId, recordId) {
  const updated = sortDescending(
    readLocalTrailers().filter((item) => item.id !== recordId)
  );
  writeLocalTrailers(updated);

  if (isFirebaseConfigured && db && userId) {
    await deleteDoc(doc(db, 'users', userId, 'trailers', recordId));
  }

  return updated;
}
