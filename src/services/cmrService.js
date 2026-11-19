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
import {
  deleteMediaAsset,
  resolveMediaAsset,
  saveMediaAsset,
} from './mediaStorage';

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
    // Se exceder espaço por causa da imagem base64, guarda mantendo miniaturas/chaves de mídia
    try {
      const trimmed = records.slice(0, 8).map((item, idx) =>
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
            const payload =
              (rec.scanDataUrl || '').length < 450000
                ? rec
                : { ...rec, scanDataUrl: '' };
            setDoc(doc(db, 'users', userId, 'cmrs', rec.id), payload, {
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

  const rawPages = Array.isArray(cmrData.pages) && cmrData.pages.length > 0
    ? cmrData.pages.slice(0, 10)
    : cmrData.scanDataUrl
    ? [
        {
          id: 'p_0',
          scanDataUrl: cmrData.scanDataUrl,
          thumbDataUrl: cmrData.thumbDataUrl || '',
        },
      ]
    : [];

  const savedPages = [];
  for (let i = 0; i < rawPages.length; i += 1) {
    const page = rawPages[i];
    const pId = String(page.id || `p_${i}`).slice(0, 64);
    const asset = await saveMediaAsset(
      userId,
      `cmrs/${id}_p${i}`,
      page.scanDataUrl || page.thumbDataUrl || ''
    );
    const thumb = String(page.thumbDataUrl || '');
    savedPages.push({
      id: pId,
      thumbDataUrl: thumb.length <= 75000 ? thumb : '',
      mediaKey: asset.mediaKey,
      url: asset.url,
    });
  }

  const firstPage = rawPages[0] || {};
  const firstSaved = savedPages[0] || {};
  const firstThumb = String(
    cmrData.thumbDataUrl || firstPage.thumbDataUrl || ''
  );
  const firstScan = String(cmrData.scanDataUrl || firstPage.scanDataUrl || '');

  const normalized = {
    id,
    date: String(cmrData.date || '').slice(0, 10),
    loadNumber: String(cmrData.loadNumber || '').trim().slice(0, 100),
    fileName: fileName.slice(0, 150),
    notes: String(cmrData.notes || '').trim().slice(0, 500),
    sizeKb: Number(cmrData.sizeKb) || 0,
    pageCount: Math.max(1, Math.min(10, savedPages.length || 1)),
    thumbDataUrl: firstThumb.length <= 145000 ? firstThumb : '',
    scanDataUrl: firstScan,
    scanMediaKey: (firstSaved.mediaKey || '').slice(0, 200),
    scanUrl: (firstSaved.url || '').slice(0, 1000),
    pages: savedPages,
    createdAt: cmrData.createdAt || new Date().toISOString(),
  };

  const current = readLocalCmrs();
  const updated = sortDescending([
    normalized,
    ...current.filter((item) => item.id !== id),
  ]);
  writeLocalCmrs(updated);

  if (isFirebaseConfigured && db && userId) {
    // Limite de 1MB por documento Firestore: envia scan inline apenas se página única < 450KB
    const firestorePayload =
      normalized.pageCount === 1 && normalized.scanDataUrl.length < 450000
        ? normalized
        : { ...normalized, scanDataUrl: '' };

    await setDoc(doc(db, 'users', userId, 'cmrs', id), firestorePayload, {
      merge: true,
    });
  }

  return { record: normalized, records: updated };
}

/**
 * Resolve todas as páginas em resolução completa (via IndexedDB, Storage ou fallback inline).
 */
export async function resolveCmrPages(record) {
  if (!record) return [];

  if (Array.isArray(record.pages) && record.pages.length > 0) {
    const resolved = [];
    for (let i = 0; i < record.pages.length; i += 1) {
      const p = record.pages[i];
      const src = await resolveMediaAsset({
        mediaKey: p.mediaKey,
        url: p.url,
        fallbackDataUrl:
          (i === 0 ? record.scanDataUrl : '') || p.thumbDataUrl || '',
      });
      if (src) resolved.push(src);
    }
    if (resolved.length > 0) return resolved;
  }

  const single = await resolveMediaAsset({
    mediaKey: record.scanMediaKey,
    url: record.scanUrl,
    fallbackDataUrl: record.scanDataUrl || record.thumbDataUrl || '',
  });
  return single ? [single] : [];
}

export async function deleteCmrRecord(userId, recordId) {
  const current = readLocalCmrs();
  const target = current.find((item) => item.id === recordId);

  const updated = sortDescending(current.filter((item) => item.id !== recordId));
  writeLocalCmrs(updated);

  if (target) {
    if (target.scanMediaKey) {
      deleteMediaAsset(userId, target.scanMediaKey).catch(() => {});
    }
    if (Array.isArray(target.pages)) {
      target.pages.forEach((p) => {
        if (p?.mediaKey) deleteMediaAsset(userId, p.mediaKey).catch(() => {});
      });
    }
  }

  if (isFirebaseConfigured && db && userId) {
    await deleteDoc(doc(db, 'users', userId, 'cmrs', recordId));
  }

  return updated;
}
