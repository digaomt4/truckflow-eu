import React from 'react';
import { Wallet, Container, FileScan, Receipt } from 'lucide-react';

const NAV_ITEMS = [
  {
    id: 'dashboard',
    label: 'Resumo',
    icon: Wallet,
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
  {
    id: 'expenses',
    label: 'Despesas',
    icon: Receipt,
  },
];

export default function BottomNav({ activeTab, onChangeTab }) {
  return (
    <nav
      aria-label="Navegação Principal"
      className="ios-glass safe-bottom fixed bottom-0 left-0 right-0 z-40 border-t ios-sep-border"
    >
      <div className="mx-auto grid max-w-3xl grid-cols-4 gap-1 px-2 pt-1.5 sm:px-6">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onChangeTab(item.id)}
              aria-current={isActive ? 'page' : undefined}
              className={`flex min-h-[54px] flex-col items-center justify-center gap-1 rounded-xl px-1 py-1.5 transition active:scale-95 ${
                isActive
                  ? 'text-[var(--ios-blue)]'
                  : 'text-[var(--ios-label-secondary)] hover:text-[var(--ios-label)]'
              }`}
            >
              <span
                className={`flex h-7 w-11 items-center justify-center rounded-full transition ${
                  isActive ? 'bg-[var(--ios-blue)]/10' : 'bg-transparent'
                }`}
              >
                <Icon
                  className="h-5 w-5"
                  strokeWidth={isActive ? 2.15 : 1.75}
                  aria-hidden="true"
                />
              </span>
              <span
                className={`text-[11px] tracking-tight leading-none ${
                  isActive ? 'font-bold' : 'font-medium'
                }`}
              >
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
