import React from 'react';
import {
  Truck,
  UserCircle2,
  SlidersHorizontal,
} from 'lucide-react';

export default function Header({
  isOnline,
  user,
  isFirebaseConfigured,
  onOpenAuth,
  onOpenSettings,
}) {
  const statusDotColor = isOnline
    ? user && isFirebaseConfigured
      ? 'bg-[var(--ios-green)]'
      : 'bg-[var(--ios-blue)]'
    : 'bg-[var(--ios-orange)]';

  const statusText = isOnline
    ? user && isFirebaseConfigured
      ? 'iCloud / Nuvem ativa'
      : 'Online · Local'
    : 'Modo Offline';

  return (
    <header className="ios-glass sticky top-0 z-30 border-b ios-sep-border">
      <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 py-2.5">
        {/* Identidade estilo App Icon do iOS */}
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] bg-[var(--ios-blue)] text-white shadow-sm">
            <Truck className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="leading-tight">
            <h1 className="text-[17px] font-bold tracking-tight text-[var(--ios-label)]">
              TruckFlow <span className="text-[var(--ios-blue)]">EU</span>
            </h1>
            <div className="mt-0.5 flex items-center gap-1.5 text-[11px] font-medium text-[var(--ios-label-secondary)]">
              <span className={`inline-block h-2 w-2 rounded-full ${statusDotColor}`} />
              <span>{statusText}</span>
            </div>
          </div>
        </div>

        {/* Botões de ação estilo iOS */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onOpenSettings}
            aria-label="Ajustes"
            className="ios-fill flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-[var(--ios-blue)] transition active:scale-95"
          >
            <SlidersHorizontal className="h-5 w-5" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={onOpenAuth}
            aria-label="Conta e Sincronização"
            className="ios-fill flex min-h-[44px] items-center gap-1.5 rounded-full px-3.5 text-[14px] font-semibold text-[var(--ios-blue)] transition active:scale-95"
          >
            <UserCircle2 className="h-5 w-5 shrink-0" aria-hidden="true" />
            <span className="hidden xs:inline sm:inline">
              {user ? (user.displayName?.split(' ')[0] || 'Conta') : 'Entrar'}
            </span>
          </button>
        </div>
      </div>
    </header>
  );
}
