import {
  deleteObject,
  getDownloadURL,
  ref,
  uploadString,
} from 'firebase/storage';
import { storage } from './firebase';

const DB_NAME = 'truckflow_media_v1';
const DB_VERSION = 1;
const STORE_NAME = 'media';

let storageUnavailable = false;
let dbPromise = null;

function openMediaDb() {
  if (typeof indexedDB === 'undefined') {
    return Promise.resolve(null);
  }
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });

  return dbPromise;
}

export async function saveLocalMedia(mediaKey, dataUrl) {
  if (!mediaKey || !dataUrl) return false;
  const db = await openMediaDb();
  if (!db) return false;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(dataUrl, mediaKey);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

export async function getLocalMedia(mediaKey) {
  if (!mediaKey) return null;
  const db = await openMediaDb();
  if (!db) return null;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(mediaKey);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function deleteLocalMedia(mediaKey) {
  if (!mediaKey) return false;
  const db = await openMediaDb();
  if (!db) return false;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(mediaKey);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

function withTimeout(promise, ms = 8000) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('storage-timeout')), ms)
    ),
  ]);
}

/**
 * Salva sempre no IndexedDB local e tenta upload no Firebase Storage com fallback silencioso.
 */
export async function saveMediaAsset(userId, mediaKey, dataUrl) {
  if (!mediaKey || !dataUrl) {
    return { mediaKey: mediaKey || '', url: '' };
  }

  await saveLocalMedia(mediaKey, dataUrl);

  const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
  if (!storage || !userId || !isOnline || storageUnavailable) {
    return { mediaKey, url: '' };
  }

  try {
    const fileRef = ref(storage, `users/${userId}/${mediaKey}`);
    await withTimeout(uploadString(fileRef, dataUrl, 'data_url'), 8000);
    const url = await withTimeout(getDownloadURL(fileRef), 8000);
    return { mediaKey, url };
  } catch (err) {
    const code = String(err?.code || '');
    if (
      code.includes('storage/unauthorized') ||
      code.includes('storage/unauthenticated') ||
      code.includes('storage/bucket-not-found') ||
      code.includes('storage/unknown') ||
      String(err?.message || '').includes('storage')
    ) {
      storageUnavailable = true;
    }
    return { mediaKey, url: '' };
  }
}

/**
 * Resolve uma mídia priorizando o cache offline IndexedDB, depois URL remota ou fallback inline.
 */
export async function resolveMediaAsset({ mediaKey, url, fallbackDataUrl } = {}) {
  if (mediaKey) {
    const local = await getLocalMedia(mediaKey);
    if (local) return local;
  }
  return url || fallbackDataUrl || '';
}

/**
 * Remove a mídia do IndexedDB e tenta remover do Firebase Storage em best-effort.
 */
export async function deleteMediaAsset(userId, mediaKey) {
  if (!mediaKey) return;
  await deleteLocalMedia(mediaKey);

  if (storage && userId && !storageUnavailable) {
    try {
      await deleteObject(ref(storage, `users/${userId}/${mediaKey}`));
    } catch {
      // Ignora erro caso o arquivo não exista no Storage ou bucket não esteja ativo
    }
  }
}
