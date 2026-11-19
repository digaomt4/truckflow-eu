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

const TRAILERS_STORAGE_KEY = 'truckflow_trailers_v1';

export const COUPLE_CHECKLIST_ITEMS = [
  {
    key: 'fifthWheelLocked',
    label: 'Quinta-roda travada e verificada',
    hint: 'Pino-rei encaixado e trava fechada',
  },
  {
    key: 'airAndAbsConnected',
    label: 'Mangueiras de ar e cabos ABS',
    hint: 'Vermelha/amarela conectadas e luzes OK',
  },
  {
    key: 'tirCableIntact',
    label: 'Cabo TIR passado e íntegro',
    hint: 'Sem cortes ou lonas soltas',
  },
  {
    key: 'sealVerified',
    label: 'Lacre / Selo conferido',
    hint: 'Numeração física batida com documento',
  },
];

export const UNCOUPLE_CHECKLIST_ITEMS = [
  {
    key: 'landingGearDown',
    label: 'Pés de apoio baixados e firmes',
    hint: 'Base nivelada em piso estável antes de soltar',
  },
  {
    key: 'parkingBrakeEngaged',
    label: 'Travão de parque do reboque puxado',
    hint: 'Botão vermelho acionado e rodas travadas',
  },
  {
    key: 'linesDisconnected',
    label: 'Mangueiras de ar e cabos elétricos soltos',
    hint: 'Cabos guardados no suporte do trator',
  },
  {
    key: 'chocksAndDocsChecked',
    label: 'Calços posicionados e guia conferida',
    hint: 'Quinta-roda destravada após verificação final',
  },
];

export function createChecklistState(actionType = 'couple') {
  const items =
    actionType === 'uncouple' ? UNCOUPLE_CHECKLIST_ITEMS : COUPLE_CHECKLIST_ITEMS;
  return Object.fromEntries(items.map((item) => [item.key, false]));
}

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
 * Comprime foto do lacre/avaria via HTML5 Canvas (máx 800px, JPEG 0.7)
 * para economizar dados móveis e caber no Firestore/IndexedDB.
 */
export function compressSealPhoto(file, maxDim = 800, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Não foi possível ler a imagem.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Formato de imagem inválido.'));
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxDim) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else if (height >= width && height > maxDim) {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(dataUrl);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

export function createMiniThumb(dataUrl, maxDim = 240, quality = 0.55) {
  return new Promise((resolve) => {
    if (!dataUrl) {
      resolve('');
      return;
    }
    const img = new Image();
    img.onerror = () => resolve(dataUrl.slice(0, 75000));
    img.onload = () => {
      let { width, height } = img;
      if (width > height && width > maxDim) {
        height = Math.round((height * maxDim) / width);
        width = maxDim;
      } else if (height >= width && height > maxDim) {
        width = Math.round((width * maxDim) / height);
        height = maxDim;
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.src = dataUrl;
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
  const actionType = recordData.actionType === 'uncouple' ? 'uncouple' : 'couple';
  const checklistDefs =
    actionType === 'uncouple' ? UNCOUPLE_CHECKLIST_ITEMS : COUPLE_CHECKLIST_ITEMS;

  const checks = Object.fromEntries(
    checklistDefs.map((item) => [item.key, Boolean(recordData.checks?.[item.key])])
  );

  let sealPhotoMediaKey = String(recordData.sealPhotoMediaKey || '');
  let sealPhotoUrl = String(recordData.sealPhotoUrl || '');
  let sealPhotoDataUrl = String(recordData.sealPhotoDataUrl || '');

  if (sealPhotoDataUrl && sealPhotoDataUrl.startsWith('data:image/')) {
    const asset = await saveMediaAsset(
      userId,
      `trailers/${id}_seal`,
      sealPhotoDataUrl
    );
    sealPhotoMediaKey = asset.mediaKey;
    sealPhotoUrl = asset.url;
    if (sealPhotoDataUrl.length > 350000) {
      sealPhotoDataUrl = await createMiniThumb(sealPhotoDataUrl, 480, 0.65);
    }
  }

  const rawExtras = Array.isArray(recordData.extraPhotos)
    ? recordData.extraPhotos.slice(0, 4)
    : [];
  const extraPhotos = [];
  for (let i = 0; i < rawExtras.length; i += 1) {
    const item = rawExtras[i];
    const pId = String(item?.id || `p_${i}_${Date.now()}`).slice(0, 64);
    const fullSrc = item?.dataUrl || item?.thumbDataUrl || '';
    if (!fullSrc) continue;
    const asset = await saveMediaAsset(
      userId,
      item?.mediaKey || `trailers/${id}_extra_${pId}`,
      fullSrc
    );
    const thumbDataUrl = item?.thumbDataUrl
      ? item.thumbDataUrl
      : await createMiniThumb(fullSrc, 240, 0.55);
    extraPhotos.push({
      id: pId,
      thumbDataUrl: thumbDataUrl.length <= 75000 ? thumbDataUrl : '',
      mediaKey: asset.mediaKey,
      url: asset.url || String(item?.url || ''),
    });
  }

  const normalized = {
    id,
    actionType,
    plate: String(recordData.plate || '').trim().toUpperCase().slice(0, 30),
    country: String(recordData.country || '').trim().toUpperCase().slice(0, 10),
    location: String(recordData.location || '').trim().slice(0, 200),
    dateTime: String(
      recordData.dateTime || new Date().toISOString().slice(0, 16)
    ).slice(0, 40),
    sealNumber: String(recordData.sealNumber || '')
      .trim()
      .toUpperCase()
      .slice(0, 64),
    sealPhotoDataUrl,
    sealPhotoMediaKey: sealPhotoMediaKey.slice(0, 200),
    sealPhotoUrl: sealPhotoUrl.slice(0, 1000),
    extraPhotos,
    checks,
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

export async function resolveTrailerGallery(record) {
  if (!record) return [];
  const gallery = [];

  if (record.sealPhotoDataUrl || record.sealPhotoMediaKey || record.sealPhotoUrl) {
    const src = await resolveMediaAsset({
      mediaKey: record.sealPhotoMediaKey,
      url: record.sealPhotoUrl,
      fallbackDataUrl: record.sealPhotoDataUrl,
    });
    if (src) {
      gallery.push({
        src,
        label: `Selo ${record.sealNumber || record.plate || ''}`.trim(),
      });
    }
  }

  const extras = Array.isArray(record.extraPhotos) ? record.extraPhotos : [];
  for (let i = 0; i < extras.length; i += 1) {
    const item = extras[i];
    const src = await resolveMediaAsset({
      mediaKey: item.mediaKey,
      url: item.url,
      fallbackDataUrl: item.thumbDataUrl,
    });
    if (src) {
      gallery.push({
        src,
        label: `${record.plate} · Foto Extra ${i + 1}`,
      });
    }
  }

  return gallery;
}

export async function deleteTrailerRecord(userId, recordId) {
  const current = readLocalTrailers();
  const target = current.find((item) => item.id === recordId);

  const updated = sortDescending(current.filter((item) => item.id !== recordId));
  writeLocalTrailers(updated);

  if (target) {
    if (target.sealPhotoMediaKey) {
      deleteMediaAsset(userId, target.sealPhotoMediaKey).catch(() => {});
    }
    if (Array.isArray(target.extraPhotos)) {
      target.extraPhotos.forEach((p) => {
        if (p?.mediaKey) deleteMediaAsset(userId, p.mediaKey).catch(() => {});
      });
    }
  }

  if (isFirebaseConfigured && db && userId) {
    await deleteDoc(doc(db, 'users', userId, 'trailers', recordId));
  }

  return updated;
}
