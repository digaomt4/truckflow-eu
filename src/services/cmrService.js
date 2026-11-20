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
export const VALID_CMR_STATUSES = ['received', 'signed', 'scanned', 'sent'];

function normalizeCmrStatus(val, fallback = 'scanned') {
  return VALID_CMR_STATUSES.includes(val) ? val : fallback;
}

function sanitizeSendHistory(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((item) => item && typeof item === 'object')
    .slice(-15)
    .map((item, idx) => ({
      id: String(item.id || `evt_${Date.now()}_${idx}`).slice(0, 64),
      timestamp: String(item.timestamp || new Date().toISOString()).slice(0, 40),
      action: String(item.action || 'shared').slice(0, 40),
      note: String(item.note || '').trim().slice(0, 200),
    }));
}

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
  const current = readLocalCmrs();
  const existing = current.find((item) => item.id === id);

  const cmrNumber = String(cmrData.cmrNumber ?? existing?.cmrNumber ?? '')
    .trim()
    .slice(0, 100);
  const resolvedLoadNumber = String(
    cmrData.loadNumber || existing?.loadNumber || cmrNumber || 'SEM-CARGA'
  )
    .trim()
    .slice(0, 100);

  const fileName = buildCmrFileName(cmrData.date, resolvedLoadNumber, cmrNumber);

  const rawPages =
    Array.isArray(cmrData.pages) && cmrData.pages.length > 0
      ? cmrData.pages.slice(0, 10)
      : existing && Array.isArray(existing.pages) && existing.pages.length > 0
      ? existing.pages
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
    if (page.mediaKey && !page.scanDataUrl) {
      savedPages.push({
        id: String(page.id || `p_${i}`).slice(0, 64),
        thumbDataUrl: String(page.thumbDataUrl || '').slice(0, 75000),
        mediaKey: String(page.mediaKey || '').slice(0, 200),
        url: String(page.url || '').slice(0, 1000),
      });
      continue;
    }
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
    cmrData.thumbDataUrl || firstPage.thumbDataUrl || existing?.thumbDataUrl || ''
  );
  const firstScan = String(
    cmrData.scanDataUrl || firstPage.scanDataUrl || existing?.scanDataUrl || ''
  );

  const nowIso = new Date().toISOString();
  const baseHistory = sanitizeSendHistory(
    cmrData.sendHistory ?? existing?.sendHistory ?? []
  );
  if (cmrData.appendEvent) {
    baseHistory.push({
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: nowIso,
      action: String(cmrData.appendEvent.action || 'shared').slice(0, 40),
      note: String(cmrData.appendEvent.note || '').trim().slice(0, 200),
    });
  }

  const normalized = {
    id,
    date: String(cmrData.date || existing?.date || '').slice(0, 10),
    cmrNumber,
    loadNumber: resolvedLoadNumber,
    sender: String(cmrData.sender ?? existing?.sender ?? '')
      .trim()
      .slice(0, 200),
    recipient: String(cmrData.recipient ?? existing?.recipient ?? '')
      .trim()
      .slice(0, 200),
    trailerPlate: String(cmrData.trailerPlate ?? existing?.trailerPlate ?? '')
      .trim()
      .toUpperCase()
      .slice(0, 40),
    sealNumber: String(cmrData.sealNumber ?? existing?.sealNumber ?? '')
      .trim()
      .toUpperCase()
      .slice(0, 64),
    status: normalizeCmrStatus(
      cmrData.status ?? existing?.status,
      'scanned'
    ),
    sendHistory: baseHistory.slice(-15),
    fileName: fileName.slice(0, 150),
    notes: String(cmrData.notes ?? existing?.notes ?? '')
      .trim()
      .slice(0, 500),
    sizeKb: Number(cmrData.sizeKb ?? existing?.sizeKb) || 0,
    pageCount: Math.max(1, Math.min(10, savedPages.length || 1)),
    thumbDataUrl: firstThumb.length <= 145000 ? firstThumb : '',
    scanDataUrl: firstScan,
    scanMediaKey: (firstSaved.mediaKey || existing?.scanMediaKey || '').slice(0, 200),
    scanUrl: (firstSaved.url || existing?.scanUrl || '').slice(0, 1000),
    pages: savedPages,
    createdAt: cmrData.createdAt || existing?.createdAt || nowIso,
    updatedAt: nowIso,
  };

  const updated = sortDescending([
    normalized,
    ...current.filter((item) => item.id !== id),
  ]);
  writeLocalCmrs(updated);

  if (isFirebaseConfigured && db && userId) {
    // Limite de segurança Firestore: evita payload base64 grande no doc (HD fica garantido no IndexedDB)
    const firestorePayload =
      normalized.pageCount === 1 && normalized.scanDataUrl.length < 160000
        ? normalized
        : { ...normalized, scanDataUrl: '' };

    try {
      await setDoc(doc(db, 'users', userId, 'cmrs', id), firestorePayload, {
        merge: true,
      });
    } catch (err) {
      console.warn('[TruckFlow EU] Aviso ao sincronizar CMR no Firestore:', err);
    }
  }

  return { record: normalized, records: updated };
}

/**
 * Registra evento no histórico de envio/confirmação manual de um CMR existente
 * e atualiza seu status quando informado.
 */
export async function appendCmrSendEvent(
  userId,
  recordId,
  { action = 'shared', note = '', nextStatus = '' } = {}
) {
  const current = readLocalCmrs();
  const target = current.find((item) => item.id === recordId);
  if (!target) return { record: null, records: current };

  const nowIso = new Date().toISOString();
  const history = sanitizeSendHistory(target.sendHistory);
  history.push({
    id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    timestamp: nowIso,
    action: String(action || 'shared').slice(0, 40),
    note: String(note || '').trim().slice(0, 200),
  });

  const updatedRecord = {
    ...target,
    status: nextStatus
      ? normalizeCmrStatus(nextStatus, target.status || 'scanned')
      : normalizeCmrStatus(target.status, 'scanned'),
    sendHistory: history.slice(-15),
    updatedAt: nowIso,
  };

  const updatedList = sortDescending(
    current.map((item) => (item.id === recordId ? updatedRecord : item))
  );
  writeLocalCmrs(updatedList);

  if (isFirebaseConfigured && db && userId) {
    const firestorePayload =
      updatedRecord.pageCount === 1 &&
      (updatedRecord.scanDataUrl || '').length < 160000
        ? updatedRecord
        : { ...updatedRecord, scanDataUrl: '' };

    try {
      await setDoc(doc(db, 'users', userId, 'cmrs', recordId), firestorePayload, {
        merge: true,
      });
    } catch (err) {
      console.warn('[TruckFlow EU] Aviso ao sincronizar CMR no Firestore:', err);
    }
  }

  return { record: updatedRecord, records: updatedList };
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
