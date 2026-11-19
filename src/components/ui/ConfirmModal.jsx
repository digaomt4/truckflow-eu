import React, { useEffect, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';

/**
 * Modal de confirmação nativo estilo iOS Sheet (substitui window.confirm).
 */
export default function ConfirmModal({
  isOpen,
  title = 'Confirmar ação',
  message,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  destructive = false,
  onConfirm,
  onCancel,
}) {
  const dialogRef = useRef(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen && !dialog.open) {
      dialog.showModal();
    } else if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  return (
    <dialog
      ref={dialogRef}
      onCancel={(e) => {
        e.preventDefault();
        onCancel?.();
      }}
      onClick={(e) => {
        if (e.target === dialogRef.current) onCancel?.();
      }}
      className="cab-dialog"
      aria-labelledby="confirm-modal-title"
    >
      <div className="ios-sheet p-5">
        <div className="ios-grabber" />

        <div className="flex flex-col items-center text-center">
          {destructive && (
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--ios-red)]/15 text-[var(--ios-red)]">
              <AlertTriangle className="h-6 w-6" aria-hidden="true" />
            </div>
          )}

          <h2 id="confirm-modal-title" className="text-[18px] font-bold tracking-tight">
            {title}
          </h2>

          {message && (
            <p className="mt-1.5 text-[14px] leading-relaxed text-[var(--ios-label-secondary)]">
              {message}
            </p>
          )}
        </div>

        <div className="mt-5 grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-[48px] rounded-xl border ios-sep-border bg-[var(--ios-fill)] px-4 text-[15px] font-semibold text-[var(--ios-label)] transition hover:bg-[var(--ios-fill-secondary)] active:scale-[0.98]"
          >
            {cancelLabel}
          </button>

          <button
            type="button"
            onClick={onConfirm}
            className={`min-h-[48px] rounded-xl px-4 text-[15px] font-semibold text-white shadow-sm transition active:scale-[0.98] ${
              destructive
                ? 'bg-[var(--ios-red)]'
                : 'bg-[var(--ios-blue)]'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
