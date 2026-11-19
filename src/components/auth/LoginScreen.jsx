import React, { useState } from 'react';
import {
  Truck,
  WifiOff,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import {
  isFirebaseConfigured,
  loginWithEmail,
  loginWithGoogle,
  registerWithEmail,
} from '../../services/firebase';

function translateAuthError(err) {
  const code = err?.code || '';
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Email ou senha incorretos. Verifique os dados e tente novamente.';
    case 'auth/invalid-email':
      return 'Formato de email inválido.';
    case 'auth/email-already-in-use':
      return 'Este email já possui conta. Toque em "Já tem conta? Iniciar sessão".';
    case 'auth/weak-password':
      return 'A senha precisa ter pelo menos 6 caracteres.';
    case 'auth/popup-closed-by-user':
      return 'Janela de login do Google fechada antes de concluir.';
    case 'auth/popup-blocked':
      return 'O navegador bloqueou o pop-up do Google. Permita pop-ups ou entre com email e senha.';
    case 'auth/network-request-failed':
      return 'Sem ligação à internet. Verifique os dados móveis ou use o modo offline abaixo.';
    case 'auth/too-many-requests':
      return 'Muitas tentativas seguidas. Aguarde alguns instantes.';
    default:
      return err?.message || 'Não foi possível concluir a autenticação.';
  }
}

export default function LoginScreen({ onContinueOffline, isOnline }) {
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleGoogleLogin = async () => {
    setError('');
    setLoading(true);
    try {
      await loginWithGoogle();
    } catch (err) {
      setError(translateAuthError(err));
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
        await loginWithEmail(email.trim(), password);
      } else {
        await registerWithEmail(email.trim(), password);
      }
    } catch (err) {
      setError(translateAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-dvh flex-col justify-center bg-[var(--ios-bg)] px-4 py-8 text-[var(--ios-label)]">
      <div className="mx-auto w-full max-w-md space-y-6">
        {/* Identidade Clean Professional */}
        <div className="text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--ios-blue)] text-white shadow-md">
            <Truck className="h-8 w-8" strokeWidth={2} aria-hidden="true" />
          </div>
          <h1 className="mt-4 text-[26px] font-bold tracking-tight text-[var(--ios-label)]">
            TruckFlow <span className="text-[var(--ios-blue)]">EU</span>
          </h1>
          <p className="mt-1 text-[14px] text-[var(--ios-label-secondary)]">
            Inicie sessão para sincronizar turnos, reboques, CMRs e despesas
          </p>
        </div>

        <div className="ios-card p-5 sm:p-6">
          {isFirebaseConfigured ? (
            <div className="space-y-4">
              {/* Botão Google Clean */}
              <button
                type="button"
                disabled={loading}
                onClick={handleGoogleLogin}
                className="flex min-h-[50px] w-full items-center justify-center gap-3 rounded-xl border ios-sep-border bg-[var(--ios-card)] px-4 text-[15px] font-semibold text-[var(--ios-label)] shadow-sm transition hover:bg-[var(--ios-fill)] active:scale-[0.99] disabled:opacity-60"
              >
                {loading ? (
                  <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                ) : (
                  <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      fill="#4285F4"
                      d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
                    />
                  </svg>
                )}
                Continuar com Google
              </button>

              <div className="flex items-center gap-3 text-xs font-medium text-[var(--ios-label-secondary)]">
                <div className="h-px flex-1 border-b ios-sep-border" />
                <span>ou por Email</span>
                <div className="h-px flex-1 border-b ios-sep-border" />
              </div>

              <form onSubmit={handleEmailSubmit} className="space-y-3.5">
                <label className="block space-y-1.5">
                  <span className="block text-[12px] font-semibold uppercase tracking-wide text-[var(--ios-label-secondary)]">
                    Email
                  </span>
                  <input
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      setError('');
                    }}
                    placeholder="motorista@empresa.eu"
                    className="ios-input min-h-[48px] w-full px-3.5 text-[15px]"
                  />
                </label>

                <label className="block space-y-1.5">
                  <span className="block text-[12px] font-semibold uppercase tracking-wide text-[var(--ios-label-secondary)]">
                    Senha
                  </span>
                  <input
                    type="password"
                    required
                    minLength={6}
                    autoComplete={
                      mode === 'login' ? 'current-password' : 'new-password'
                    }
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      setError('');
                    }}
                    placeholder="Mínimo 6 caracteres"
                    className="ios-input min-h-[48px] w-full px-3.5 text-[15px]"
                  />
                </label>

                {error && (
                  <div
                    role="alert"
                    className="flex items-start gap-2 rounded-xl border border-[var(--ios-red)]/25 bg-[var(--ios-red)]/10 p-3 text-[13px] font-medium text-[var(--ios-red)]"
                  >
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>{error}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="min-h-[50px] w-full rounded-xl bg-[var(--ios-blue)] px-4 text-[15px] font-semibold text-white shadow-sm transition hover:bg-[var(--ios-blue-hover)] active:scale-[0.99] disabled:opacity-60"
                >
                  {loading
                    ? 'A iniciar sessão...'
                    : mode === 'login'
                    ? 'Iniciar Sessão'
                    : 'Criar Conta'}
                </button>
              </form>

              <button
                type="button"
                disabled={loading}
                onClick={() => {
                  setError('');
                  setMode((prev) => (prev === 'login' ? 'register' : 'login'));
                }}
                className="min-h-[40px] w-full text-center text-[14px] font-semibold text-[var(--ios-blue)] hover:underline"
              >
                {mode === 'login'
                  ? 'Criar nova conta gratuita'
                  : 'Já tem conta? Iniciar sessão'}
              </button>
            </div>
          ) : (
            <div className="py-2 text-center text-sm text-[var(--ios-label-secondary)]">
              Firebase não configurado neste ambiente. Utilize o modo offline abaixo.
            </div>
          )}
        </div>

        {/* Botão Modo Offline */}
        <div className="text-center">
          <button
            type="button"
            onClick={onContinueOffline}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border ios-sep-border bg-[var(--ios-card)] px-4 text-[13px] font-semibold text-[var(--ios-label-secondary)] shadow-sm transition hover:text-[var(--ios-label)] active:scale-95"
          >
            <WifiOff className="h-4 w-4 text-[var(--ios-orange)]" aria-hidden="true" />
            {isOnline
              ? 'Usar apenas neste aparelho (Offline)'
              : 'Sem internet · Usar apenas neste aparelho'}
          </button>
        </div>
      </div>
    </div>
  );
}
