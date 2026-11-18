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

        <div className="mb-4 flex items-center justify-between">
          <span className="w-16" />
          <h2 id="auth-modal-title" className="text-[17px] font-semibold">
            Conta e Nuvem
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] w-16 text-right text-[16px] font-semibold text-[var(--ios-blue)]"
          >
            OK
          </button>
        </div>

        {/* Cartão de persistência offline */}
        <div className="ios-fill mb-4 flex items-start gap-3 rounded-[16px] p-3.5 text-[12px]">
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
          <div className="ios-fill space-y-2 rounded-[16px] p-4 text-sm">
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
            <div className="ios-fill flex items-center gap-3 rounded-[16px] p-4">
              <CheckCircle2
                className="h-7 w-7 shrink-0 text-[var(--ios-green)]"
                aria-hidden="true"
              />
              <div className="min-w-0">
                <p className="truncate text-[16px] font-semibold">
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
              className="ios-fill flex min-h-[52px] w-full items-center justify-center gap-2 rounded-[14px] px-4 text-[16px] font-semibold text-[var(--ios-red)] transition active:scale-[0.98] disabled:opacity-50"
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
              className="ios-fill flex min-h-[50px] w-full items-center justify-center gap-2 rounded-[14px] px-4 text-[15px] font-semibold transition active:scale-[0.98] disabled:opacity-50"
            >
              Continuar com Google
            </button>

            <form onSubmit={handleEmailSubmit} className="space-y-3">
              <div className="ios-fill overflow-hidden rounded-[14px]">
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Email"
                  className="min-h-[48px] w-full border-b ios-sep-border bg-transparent px-4 text-[15px] outline-none"
                />
                <input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Senha (mín. 6 caracteres)"
                  className="min-h-[48px] w-full bg-transparent px-4 text-[15px] outline-none"
                />
              </div>

              {error && (
                <p className="rounded-[12px] bg-[var(--ios-red)]/15 p-3 text-xs font-medium text-[var(--ios-red)]">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="min-h-[50px] w-full rounded-[14px] bg-[var(--ios-blue)] text-[16px] font-semibold text-white transition active:scale-[0.98] disabled:opacity-50"
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
              className="min-h-[44px] w-full text-center text-[14px] font-medium text-[var(--ios-blue)]"
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
