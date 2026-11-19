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
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        {/* Identidade Clean Professional */}
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] bg-[var(--ios-blue)] text-white shadow-sm">
            <Truck className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
          </div>
          <div className="leading-tight">
            <div className="flex items-center gap-1.5">
              <h1 className="text-[17px] font-bold tracking-tight text-[var(--ios-label)]">
                TruckFlow
              </h1>
              <span className="rounded-md bg-[var(--ios-blue)]/10 px-1.5 py-0.5 text-[11px] font-bold tracking-wide text-[var(--ios-blue)]">
                EU
              </span>
            </div>
            <div className="mt-0.5 inline-flex items-center gap-1.5 text-[11px] font-medium text-[var(--ios-label-secondary)]">
              <span className={`inline-block h-2 w-2 rounded-full ${statusDotColor}`} />
              <span>{statusText}</span>
            </div>
          </div>
        </div>

        {/* Botões de ação */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onOpenSettings}
            aria-label="Ajustes"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border ios-sep-border bg-[var(--ios-card)] text-[var(--ios-label)] shadow-sm transition hover:bg-[var(--ios-fill)] active:scale-95"
          >
            <SlidersHorizontal className="h-[18px] w-[18px]" strokeWidth={1.9} aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={onOpenAuth}
            aria-label="Conta e Sincronização"
            className="flex min-h-[44px] items-center gap-2 rounded-xl border ios-sep-border bg-[var(--ios-card)] px-3.5 text-[13px] font-semibold text-[var(--ios-label)] shadow-sm transition hover:bg-[var(--ios-fill)] active:scale-95"
          >
            <UserCircle2 className="h-[18px] w-[18px] shrink-0 text-[var(--ios-blue)]" strokeWidth={1.9} aria-hidden="true" />
            <span className="hidden xs:inline sm:inline">
              {user ? (user.displayName?.split(' ')[0] || 'Conta') : 'Entrar'}
            </span>
          </button>
        </div>
      </div>
    </header>
  );
}
