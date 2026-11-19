import React, { useEffect, useRef, useState } from 'react';
import {
  HardDrive,
  LogOut,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import {
  isFirebaseConfigured,
  loginWithGoogle,
  loginWithEmail,
  registerWithEmail,
  logoutUser,
  getFirebasePersistenceStatus,
} from '../../services/firebase';

export default function AuthModal({ isOpen, onClose, user, onAfterLogout }) {
  const dialogRef = useRef(null);
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen && !dialog.open) {
      dialog.showModal();
    } else if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  const handleBackdropClick = (e) => {
    if (e.target === dialogRef.current) {
      onClose();
    }
  };

  const handleGoogleLogin = async () => {
    setError('');
    setLoading(true);
    try {
      await loginWithGoogle();
      onClose();
    } catch (err) {
      setError(err.message || 'Não foi possível entrar com o Google.');
    } finally {
      setLoading(false);
    }
  };

  const handleEmailSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (mode === 'login') {
        await loginWithEmail(email, password);
      } else {
        await registerWithEmail(email, password);
      }
      onClose();
    } catch (err) {
      setError(err.message || 'Erro ao autenticar com email.');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    setLoading(true);
    try {
      await logoutUser();
      onClose();
      if (onAfterLogout) onAfterLogout();
    } finally {
      setLoading(false);
    }
  };

  const persistence = getFirebasePersistenceStatus();

  return (
    <dialog
      ref={dialogRef}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={handleBackdropClick}
      className="cab-dialog"
      aria-labelledby="auth-modal-title"
    >
      <div className="ios-sheet max-h-[92dvh] overflow-y-auto p-5">
        <div className="ios-grabber" />

        <div className="mb-4 flex items-center justify-between border-b ios-sep-border pb-3">
          <span className="w-16" />
          <h2 id="auth-modal-title" className="text-[17px] font-bold">
            Conta e Nuvem
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] w-16 text-right text-[15px] font-semibold text-[var(--ios-blue)]"
          >
            OK
          </button>
        </div>

        {/* Cartão de persistência offline */}
        <div className="cp-inset mb-4 flex items-start gap-3 p-3.5 text-[12px]">
          <HardDrive
            className="mt-0.5 h-5 w-5 shrink-0 text-[var(--ios-green)]"
            aria-hidden="true"
          />
          <div className="space-y-0.5">
            <p className="font-semibold text-[var(--ios-label)]">
              Backup Offline Ativo ({persistence})
            </p>
            <p className="text-[var(--ios-label-secondary)]">
              Seus dados permanecem guardados na cabine mesmo sem internet e
              sincronizam ao reconectar.
            </p>
          </div>
        </div>

        {!isFirebaseConfigured ? (
          <div className="cp-inset space-y-2 p-4 text-sm">
            <div className="flex items-center gap-2 font-semibold text-[var(--ios-orange)]">
              <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden="true" />
              Firebase em modo local
            </div>
            <p className="text-xs text-[var(--ios-label-secondary)]">
              Configure as chaves do Firebase no arquivo .env para sincronizar em
              nuvem.
            </p>
          </div>
        ) : user ? (
          <div className="space-y-4">
            <div className="cp-inset flex items-center gap-3 p-4">
              <CheckCircle2
                className="h-7 w-7 shrink-0 text-[var(--ios-green)]"
                aria-hidden="true"
              />
              <div className="min-w-0">
                <p className="truncate text-[16px] font-bold">
                  {user.displayName || 'Motorista Conectado'}
                </p>
                <p className="truncate text-[13px] text-[var(--ios-label-secondary)]">
                  {user.email}
                </p>
              </div>
            </div>

            <button
              type="button"
              disabled={loading}
              onClick={handleLogout}
              className="flex min-h-[50px] w-full items-center justify-center gap-2 rounded-xl border border-[var(--ios-red)]/25 bg-[var(--ios-red)]/10 px-4 text-[15px] font-semibold text-[var(--ios-red)] transition active:scale-[0.99] disabled:opacity-50"
            >
              <LogOut className="h-5 w-5" aria-hidden="true" />
              Terminar Sessão
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <button
              type="button"
              disabled={loading}
              onClick={handleGoogleLogin}
              className="flex min-h-[50px] w-full items-center justify-center gap-2 rounded-xl border ios-sep-border bg-[var(--ios-card)] px-4 text-[15px] font-semibold text-[var(--ios-label)] shadow-sm transition hover:bg-[var(--ios-fill)] active:scale-[0.99] disabled:opacity-50"
            >
              Continuar com Google
            </button>

            <form onSubmit={handleEmailSubmit} className="space-y-3">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email"
                className="ios-input min-h-[48px] w-full px-3.5 text-[15px]"
              />
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Senha (mín. 6 caracteres)"
                className="ios-input min-h-[48px] w-full px-3.5 text-[15px]"
              />

              {error && (
                <p className="rounded-xl border border-[var(--ios-red)]/25 bg-[var(--ios-red)]/10 p-3 text-xs font-medium text-[var(--ios-red)]">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="min-h-[50px] w-full rounded-xl bg-[var(--ios-blue)] text-[15px] font-semibold text-white shadow-sm transition hover:bg-[var(--ios-blue-hover)] active:scale-[0.99] disabled:opacity-50"
              >
                {loading
                  ? 'Conectando...'
                  : mode === 'login'
                  ? 'Iniciar Sessão'
                  : 'Criar Conta'}
              </button>
            </form>

            <button
              type="button"
              onClick={() =>
                setMode((prev) => (prev === 'login' ? 'register' : 'login'))
              }
              className="min-h-[40px] w-full text-center text-[14px] font-semibold text-[var(--ios-blue)]"
            >
              {mode === 'login'
                ? 'Criar conta gratuita'
                : 'Já tem conta? Iniciar sessão'}
            </button>
          </div>
        )}
      </div>
    </dialog>
  );
}
