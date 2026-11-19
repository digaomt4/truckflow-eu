import React, { Suspense, lazy, useEffect, useState } from 'react';
import { Loader2, Truck } from 'lucide-react';
import Header from './components/layout/Header';
import BottomNav from './components/layout/BottomNav';
import AuthModal from './components/layout/AuthModal';
import SettingsModal from './components/layout/SettingsModal';
import LoginScreen from './components/auth/LoginScreen';
import DashboardModule from './modules/dashboard/DashboardModule';

const TrailerModule = lazy(() => import('./modules/trailer/TrailerModule'));
const CmrModule = lazy(() => import('./modules/cmr/CmrModule'));
const ExpensesModule = lazy(() => import('./modules/expenses/ExpensesModule'));
import {
  isFirebaseConfigured,
  subscribeToAuthChanges,
} from './services/firebase';
import {
  deleteShift,
  getSalarySettings,
  readLocalSettings,
  saveSalarySettings,
  saveShift,
  subscribeShifts,
  toggleShiftWeekend,
} from './services/shiftsService';

const CLEAN_PRO_MIGRATION_KEY = 'truckflow_ui_clean_pro_v1';

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [user, setUser] = useState(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [allowOfflineGuest, setAllowOfflineGuest] = useState(false);
  const [shifts, setShifts] = useState([]);
  const [settings, setSettings] = useState(() => {
    const initial = readLocalSettings();
    try {
      if (!localStorage.getItem(CLEAN_PRO_MIGRATION_KEY)) {
        return { ...initial, theme: 'light' };
      }
    } catch {
      // Ignora indisponibilidade de localStorage
    }
    return initial;
  });
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);

  // Sincroniza o tema Claro / Escuro no elemento raiz <html> e meta theme-color
  useEffect(() => {
    const root = document.documentElement;
    const isLight = settings.theme !== 'dark';
    root.classList.toggle('light', isLight);
    root.classList.toggle('dark', !isLight);

    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) {
      themeMeta.setAttribute('content', isLight ? '#F3F5F8' : '#0F172A');
    }
  }, [settings.theme]);

  // Monitora status de conexão da cabine (online / offline)
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Monitora autenticação Firebase antes de liberar a tela inicial
  useEffect(() => {
    const unsubscribe = subscribeToAuthChanges((authUser) => {
      setUser(authUser);
      setAuthChecking(false);
    });
    return () => unsubscribe();
  }, []);

  // Assina turnos (localStorage + Firestore offline/online)
  useEffect(() => {
    if (authChecking || (!user && !allowOfflineGuest)) {
      return undefined;
    }

    const unsubscribe = subscribeShifts(user?.uid || null, (loadedShifts) => {
      setShifts(loadedShifts);
    });

    getSalarySettings(user?.uid || null).then((loadedSettings) => {
      try {
        if (!localStorage.getItem(CLEAN_PRO_MIGRATION_KEY)) {
          localStorage.setItem(CLEAN_PRO_MIGRATION_KEY, '1');
          if (loadedSettings.theme !== 'light') {
            const migrated = { ...loadedSettings, theme: 'light' };
            setSettings(migrated);
            saveSalarySettings(user?.uid || null, migrated).catch(() => {});
            return;
          }
        }
      } catch {
        // Ignora indisponibilidade de localStorage
      }
      setSettings(loadedSettings);
    });

    return () => unsubscribe();
  }, [authChecking, user, allowOfflineGuest]);

  const handleSaveShift = async (shiftData) => {
    const { shifts: updated } = await saveShift(user?.uid || null, shiftData);
    setShifts(updated);
  };

  const handleDeleteShift = async (shiftId) => {
    const updated = await deleteShift(user?.uid || null, shiftId);
    setShifts(updated);
  };

  const handleToggleShiftWeekend = async (shift) => {
    const { shifts: updated } = await toggleShiftWeekend(
      user?.uid || null,
      shift
    );
    setShifts(updated);
  };

  const handleUpdateSettings = async (nextSettings) => {
    const saved = await saveSalarySettings(user?.uid || null, nextSettings);
    setSettings(saved);
  };

  const handleLoadDemoData = async (monthKey) => {
    const sampleRoutes = [
      {
        day: '02',
        endDay: '02',
        startTime: '06:15',
        endTime: '17:40',
        startLocation: 'Porto, PT',
        endLocation: 'Bordeaux, FR',
        km: 2850,
        weekendOut: false,
        notes: 'PT -> ES -> FR',
      },
      {
        day: '06',
        endDay: '07',
        startTime: '21:10',
        endTime: '08:35',
        startLocation: 'Lyon, FR',
        endLocation: 'Frankfurt, DE',
        km: 3420,
        weekendOut: true,
        notes: 'FR -> DE (Noturno)',
      },
      {
        day: '11',
        endDay: '11',
        startTime: '05:50',
        endTime: '16:20',
        startLocation: 'Rotterdam, NL',
        endLocation: 'Antwerp, BE',
        km: 3180,
        weekendOut: false,
        notes: 'DE -> NL -> BE',
      },
      {
        day: '15',
        endDay: '16',
        startTime: '22:00',
        endTime: '09:15',
        startLocation: 'Brussels, BE',
        endLocation: 'Zaragoza, ES',
        km: 3650,
        weekendOut: true,
        notes: 'BE -> FR -> ES',
      },
      {
        day: '20',
        endDay: '20',
        startTime: '07:05',
        endTime: '18:30',
        startLocation: 'Barcelona, ES',
        endLocation: 'Milan, IT',
        km: 2950,
        weekendOut: false,
        notes: 'ES -> IT',
      },
    ];

    let odometer = Number(settings.initialOdometer) || 410000;
    for (const item of sampleRoutes) {
      const start = odometer;
      const end = odometer + item.km;
      odometer = end;
      await saveShift(user?.uid || null, {
        date: `${monthKey}-${item.day}`,
        startDate: `${monthKey}-${item.day}`,
        startTime: item.startTime,
        startLocation: item.startLocation,
        endDate: `${monthKey}-${item.endDay}`,
        endTime: item.endTime,
        endLocation: item.endLocation,
        status: 'completed',
        kmInicial: start,
        kmFinal: end,
        weekendOut: item.weekendOut,
        notes: item.notes,
      });
    }
  };

  // 1. Splash rápido enquanto o Firebase verifica se já existe sessão guardada
  if (authChecking) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center bg-[var(--ios-bg)] px-4 text-[var(--ios-label)]">
        <div className="flex h-16 w-16 items-center justify-center rounded-[18px] bg-[var(--ios-blue)] text-white shadow-md">
          <Truck className="h-8 w-8 animate-pulse" aria-hidden="true" />
        </div>
        <h1 className="mt-4 text-xl font-bold tracking-tight">
          TruckFlow <span className="text-[var(--ios-blue)]">EU</span>
        </h1>
        <p className="mt-1 text-xs font-medium text-[var(--ios-label-secondary)]">
          Verificando sessão...
        </p>
      </div>
    );
  }

  // 2. Tela de Login obrigatória antes da tela inicial (a menos que escolha Modo Offline)
  if (!user && !allowOfflineGuest) {
    return (
      <LoginScreen
        isOnline={isOnline}
        onContinueOffline={() => setAllowOfflineGuest(true)}
      />
    );
  }

  // 3. Tela Principal do Aplicativo
  return (
    <div className="min-h-dvh bg-[var(--ios-bg)] text-[var(--ios-label)]">
      <Header
        isOnline={isOnline}
        user={user}
        isFirebaseConfigured={isFirebaseConfigured}
        onOpenAuth={() => setIsAuthModalOpen(true)}
        onOpenSettings={() => setIsSettingsModalOpen(true)}
      />

      <main className="mx-auto max-w-3xl px-4 pb-28 pt-5 sm:px-6">
        {activeTab === 'dashboard' && (
          <DashboardModule
            user={user}
            shifts={shifts}
            settings={settings}
            onSaveShift={handleSaveShift}
            onDeleteShift={handleDeleteShift}
            onToggleShiftWeekend={handleToggleShiftWeekend}
            onUpdateSettings={handleUpdateSettings}
            onLoadDemoData={handleLoadDemoData}
          />
        )}

        <Suspense
          fallback={
            <div className="ios-card flex min-h-[200px] items-center justify-center gap-2 text-sm text-[var(--ios-label-secondary)]">
              <Loader2 className="h-5 w-5 animate-spin text-[var(--ios-blue)]" aria-hidden="true" />
              Carregando módulo...
            </div>
          }
        >
          {activeTab === 'trailer' && <TrailerModule user={user} />}

          {activeTab === 'cmr' && <CmrModule user={user} />}

          {activeTab === 'expenses' && <ExpensesModule user={user} />}
        </Suspense>
      </main>

      <BottomNav activeTab={activeTab} onChangeTab={setActiveTab} />

      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        user={user}
        onAfterLogout={() => setAllowOfflineGuest(false)}
      />

      <SettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
        settings={settings}
        onUpdateSettings={handleUpdateSettings}
      />
    </div>
  );
}
