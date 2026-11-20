import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from 'firebase/auth';
import {
  getFirestore,
  enableIndexedDbPersistence,
} from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '',
};

/**
 * Indica se as variáveis reais do Firebase estão preenchidas no ambiente (.env).
 * Quando falso, o app opera normalmente no modo Offline Cabine (localStorage).
 */
export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey &&
    firebaseConfig.projectId &&
    firebaseConfig.appId
);

let app = null;
let auth = null;
let db = null;
let storage = null;
let googleProvider = null;
let persistenceStatus = isFirebaseConfigured ? 'pending' : 'local-only';

if (isFirebaseConfigured) {
  app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  auth = getAuth(app);
  googleProvider = new GoogleAuthProvider();
  googleProvider.setCustomParameters({ prompt: 'select_account' });

  db = getFirestore(app);
  if (
    firebaseConfig.storageBucket &&
    import.meta.env.VITE_FIREBASE_ENABLE_STORAGE === 'true'
  ) {
    try {
      storage = getStorage(app);
    } catch {
      storage = null;
    }
  }

  // Ativa cache offline persistente do Cloud Firestore no IndexedDB
  enableIndexedDbPersistence(db)
    .then(() => {
      persistenceStatus = 'indexeddb-active';
    })
    .catch((err) => {
      if (err.code === 'failed-precondition') {
        persistenceStatus = 'multi-tab-fallback';
        console.warn(
          '[TruckFlow EU] Persistência offline do Firestore limitada (múltiplas abas abertas).'
        );
      } else if (err.code === 'unimplemented') {
        persistenceStatus = 'unsupported';
        console.warn(
          '[TruckFlow EU] Navegador atual não suporta persistência IndexedDB do Firestore.'
        );
      }
    });
}

export function getFirebasePersistenceStatus() {
  return persistenceStatus;
}

export async function loginWithGoogle() {
  if (!auth || !googleProvider) {
    throw new Error(
      'Firebase ainda não configurado. Adicione as variáveis VITE_FIREBASE_* no arquivo .env.'
    );
  }
  const result = await signInWithPopup(auth, googleProvider);
  return result.user;
}

export async function loginWithEmail(email, password) {
  if (!auth) {
    throw new Error(
      'Firebase ainda não configurado. Adicione as variáveis VITE_FIREBASE_* no arquivo .env.'
    );
  }
  const result = await signInWithEmailAndPassword(auth, email, password);
  return result.user;
}

export async function registerWithEmail(email, password) {
  if (!auth) {
    throw new Error(
      'Firebase ainda não configurado. Adicione as variáveis VITE_FIREBASE_* no arquivo .env.'
    );
  }
  const result = await createUserWithEmailAndPassword(auth, email, password);
  return result.user;
}

export async function logoutUser() {
  if (!auth) return;
  await signOut(auth);
}

export function subscribeToAuthChanges(callback) {
  if (!auth) {
    callback(null);
    return () => {};
  }
  return onAuthStateChanged(auth, callback);
}

export { app, auth, db, storage, googleProvider };
