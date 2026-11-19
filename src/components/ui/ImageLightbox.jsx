import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, X } from 'lucide-react';

/**
 * Visualizador fullscreen para fotos de selos, avarias, recibos e páginas de CMR.
 */
export default function ImageLightbox({
  isOpen,
  images = [],
  initialIndex = 0,
  onClose,
}) {
  const dialogRef = useRef(null);
  const [index, setIndex] = useState(initialIndex);

  useEffect(() => {
    if (isOpen) {
      const clamped = Math.max(0, Math.min(initialIndex, Math.max(0, images.length - 1)));
      setIndex(clamped);
    }
  }, [isOpen, initialIndex, images.length]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen && !dialog.open) {
      dialog.showModal();
    } else if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  const current = images[index] || null;
  const hasMultiple = images.length > 1;

  const handleDownload = () => {
    if (!current?.src) return;
    const a = document.createElement('a');
    a.href = current.src;
    a.download = `${(current.label || 'imagem').replace(/[^a-zA-Z0-9_-]+/g, '_')}.jpg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <dialog
      ref={dialogRef}
      onCancel={(e) => {
        e.preventDefault();
        onClose?.();
      }}
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose?.();
      }}
      className="cab-dialog !max-w-3xl"
      aria-label="Visualização de imagem em tela cheia"
    >
      <div className="flex max-h-[92dvh] flex-col overflow-hidden rounded-[20px] border border-white/15 bg-slate-950 text-white shadow-2xl">
        <div className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold">
              {current?.label || 'Visualização'}
            </p>
            {hasMultiple && (
              <p className="tabular-nums text-[12px] text-white/60">
                {index + 1} / {images.length}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2">
            {current?.src && (
              <button
                type="button"
                onClick={handleDownload}
                aria-label="Baixar imagem"
                className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition active:scale-95"
              >
                <Download className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar visualização"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white transition active:scale-95"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="relative flex min-h-[280px] flex-1 items-center justify-center overflow-auto bg-black p-3">
          {current?.src ? (
            <img
              src={current.src}
              alt={current.label || 'Imagem'}
              className="max-h-[75dvh] w-auto max-w-full rounded-[10px] object-contain"
            />
          ) : (
            <p className="text-sm text-white/60">Imagem indisponível.</p>
          )}

          {hasMultiple && (
            <>
              <button
                type="button"
                aria-label="Imagem anterior"
                onClick={() =>
                  setIndex((prev) => (prev - 1 + images.length) % images.length)
                }
                className="absolute left-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/70 text-white backdrop-blur-md transition active:scale-90"
              >
                <ChevronLeft className="h-6 w-6" aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label="Próxima imagem"
                onClick={() => setIndex((prev) => (prev + 1) % images.length)}
                className="absolute right-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/70 text-white backdrop-blur-md transition active:scale-90"
              >
                <ChevronRight className="h-6 w-6" aria-hidden="true" />
              </button>
            </>
          )}
        </div>
      </div>
    </dialog>
  );
}
