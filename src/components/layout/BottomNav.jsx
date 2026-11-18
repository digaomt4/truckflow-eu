import React from 'react';
import { Wallet, Timer, Container, FileScan } from 'lucide-react';

const NAV_ITEMS = [
  {
    id: 'dashboard',
    label: 'Resumo',
    icon: Wallet,
  },
  {
    id: 'tachograph',
    label: 'Tacógrafo',
    icon: Timer,
  },
  {
    id: 'trailer',
    label: 'Reboque',
    icon: Container,
  },
  {
    id: 'cmr',
    label: 'CMR',
    icon: FileScan,
  },
];

export default function BottomNav({ activeTab, onChangeTab }) {
  return (
    <nav
      aria-label="Navegação Principal"
      className="ios-glass safe-bottom fixed bottom-0 left-0 right-0 z-40 border-t ios-sep-border"
    >
      <div className="mx-auto grid max-w-2xl grid-cols-4 px-2 pt-1">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onChangeTab(item.id)}
              aria-current={isActive ? 'page' : undefined}
              className={`flex min-h-[54px] flex-col items-center justify-center gap-0.5 px-1 py-1 transition active:scale-95 ${
                isActive
                  ? 'text-[var(--ios-blue)]'
                  : 'text-[var(--ios-label-secondary)]'
              }`}
            >
              <Icon
                className={`h-6 w-6 ${isActive ? 'stroke-[2.2]' : 'stroke-[1.7]'}`}
                aria-hidden="true"
              />
              <span className="text-[11px] font-semibold tracking-tight leading-none">
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
