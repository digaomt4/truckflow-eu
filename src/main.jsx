import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// Limpa registros/caches antigos do sw.js manual para evitar versões presas em cache;
// o Service Worker oficial de produção é registrado via /registerSW.js (workbox-sw.js).
if ('serviceWorker' in navigator) {
  const hadController = Boolean(navigator.serviceWorker.controller);
  let refreshing = false;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || refreshing) return;
    refreshing = true;
    window.location.reload();
  });

  window.addEventListener('load', async () => {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(
        registrations
          .filter((reg) => reg.active?.scriptURL?.endsWith('/sw.js'))
          .map((reg) => reg.unregister())
      );
      await Promise.all(
        registrations
          .filter(
            (reg) => reg.active && !reg.active.scriptURL?.endsWith('/sw.js')
          )
          .map((reg) => reg.update().catch(() => {}))
      );
      if ('caches' in window) {
        const cacheKeys = await caches.keys();
        await Promise.all(
          cacheKeys
            .filter((key) => key.startsWith('truckflow-eu-'))
            .map((key) => caches.delete(key))
        );
      }
    } catch {
      // Ignora caso não haja suporte
    }
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
