import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  Maximize2,
  RotateCw,
  Wand2,
  X,
  Loader2,
} from 'lucide-react';
import {
  DEFAULT_CROP_CORNERS,
  FULL_FRAME_CORNERS,
  clampCorner,
  isConvexQuad,
  rotateNormalizedCorners90,
} from '../../utils/cmrGeometry';
import {
  cropAndWarpCmrImage,
  detectDocumentCornersFromImage,
  rotateImageDataUrl90,
} from '../../utils/cmrScanner';

const CORNER_LABELS = [
  'Canto superior esquerdo',
  'Canto superior direito',
  'Canto inferior direito',
  'Canto inferior esquerdo',
];

const CORNER_SHORT = ['Sup. Esq.', 'Sup. Dir.', 'Inf. Dir.', 'Inf. Esq.'];

function lerpPoint(p0, p1, t) {
  return {
    x: p0.x + (p1.x - p0.x) * t,
    y: p0.y + (p1.y - p0.y) * t,
  };
}

export default function CmrCropModal({
  isOpen,
  imageSrc,
  initialCorners,
  autoDetected = false,
  onCancel,
  onApply,
}) {
  const dialogRef = useRef(null);
  const stageRef = useRef(null);
  const imgRef = useRef(null);
  const loupeCanvasRef = useRef(null);
  const dragRef = useRef(null);

  const [currentSrc, setCurrentSrc] = useState(imageSrc || '');
  const [corners, setCorners] = useState(
    initialCorners || DEFAULT_CROP_CORNERS
  );
  const [cropMode, setCropMode] = useState('perspective'); // 'perspective' | 'rect'
  const [activeIdx, setActiveIdx] = useState(null);
  const [autoStatus, setAutoStatus] = useState('idle'); // 'idle' | 'detected' | 'not-found'
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setCurrentSrc(imageSrc || '');
    setCorners(initialCorners || DEFAULT_CROP_CORNERS);
    setCropMode('perspective');
    setActiveIdx(null);
    setAutoStatus(autoDetected ? 'detected' : 'idle');
    setBusy(false);
    dragRef.current = null;
  }, [isOpen, imageSrc, initialCorners, autoDetected]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) {
      dialog.showModal();
    } else if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  // Renderiza a lupa de precisão 2.5x enquanto um canto está sendo arrastado
  useEffect(() => {
    if (activeIdx === null) return;
    const canvas = loupeCanvasRef.current;
    const img = imgRef.current;
    const stageRect = stageRef.current?.getBoundingClientRect();
    if (!canvas || !img || !img.complete || !img.naturalWidth) return;

    const ctx = canvas.getContext('2d');
    const size = canvas.width; // 232px (retina 2x para 116px)
    const half = size / 2;
    const natW = img.naturalWidth;
    const natH = img.naturalHeight;
    const corner = corners[activeIdx];
    const cx = corner.x * natW;
    const cy = corner.y * natH;

    const dispW = stageRect?.width || 300;
    const dispH = stageRect?.height || 400;
    const zoom = 2.5;
    const rawPatchW = (116 / zoom) * (natW / dispW);
    const rawPatchH = (116 / zoom) * (natH / dispH);
    const patchW = Math.max(48, Math.min(natW * 0.65, rawPatchW));
    const patchH = Math.max(48, Math.min(natH * 0.65, rawPatchH));

    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#09090b';
    ctx.fillRect(0, 0, size, size);

    // Desenha recorte ampliado permitindo mostrar margem fora da borda se perto de 0 ou 1
    const srcX = cx - patchW / 2;
    const srcY = cy - patchH / 2;

    const clampSx = Math.max(0, srcX);
    const clampSy = Math.max(0, srcY);
    const clampEx = Math.min(natW, srcX + patchW);
    const clampEy = Math.min(natH, srcY + patchH);
    const validSw = clampEx - clampSx;
    const validSh = clampEy - clampSy;

    if (validSw > 0 && validSh > 0) {
      const dstX = ((clampSx - srcX) / patchW) * size;
      const dstY = ((clampSy - srcY) / patchH) * size;
      const dstW = (validSw / patchW) * size;
      const dstH = (validSh / patchH) * size;
      ctx.drawImage(img, clampSx, clampSy, validSw, validSh, dstX, dstY, dstW, dstH);
    }

    // Desenha as duas linhas de recorte adjacentes convergindo no centro da lupa
    const prevCorner = corners[(activeIdx + 3) % 4];
    const nextCorner = corners[(activeIdx + 1) % 4];
    ctx.strokeStyle = '#1769D2';
    ctx.lineWidth = 3;
    [prevCorner, nextCorner].forEach((neighbor) => {
      const nx = half + (((neighbor.x - corner.x) * natW) / patchW) * size;
      const ny = half + (((neighbor.y - corner.y) * natH) / patchH) * size;
      ctx.beginPath();
      ctx.moveTo(half, half);
      ctx.lineTo(nx, ny);
      ctx.stroke();
    });

    // Mira fina de precisão no centro exato da lupa
    ctx.strokeStyle = '#16A36A';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(half - 18, half);
    ctx.lineTo(half - 5, half);
    ctx.moveTo(half + 5, half);
    ctx.lineTo(half + 18, half);
    ctx.moveTo(half, half - 18);
    ctx.lineTo(half, half - 5);
    ctx.moveTo(half, half + 5);
    ctx.lineTo(half, half + 18);
    ctx.stroke();

    ctx.fillStyle = '#16A36A';
    ctx.beginPath();
    ctx.arc(half, half, 3, 0, Math.PI * 2);
    ctx.fill();
  }, [activeIdx, corners, currentSrc]);

  const handleModeChange = (nextMode) => {
    if (nextMode === cropMode) return;
    if (nextMode === 'rect') {
      const xs = corners.map((c) => c.x);
      const ys = corners.map((c) => c.y);
      const minX = Math.max(0, Math.min(...xs));
      const maxX = Math.min(1, Math.max(...xs));
      const minY = Math.max(0, Math.min(...ys));
      const maxY = Math.min(1, Math.max(...ys));
      setCorners([
        { x: minX, y: minY },
        { x: maxX, y: minY },
        { x: maxX, y: maxY },
        { x: minX, y: maxY },
      ]);
    }
    setCropMode(nextMode);
  };

  const applyDeltaDrag = (clientX, clientY) => {
    const drag = dragRef.current;
    const rect = stageRef.current?.getBoundingClientRect();
    if (!drag || !rect || rect.width < 10 || rect.height < 10) return;

    const dx = (clientX - drag.startClientX) / rect.width;
    const dy = (clientY - drag.startClientY) / rect.height;
    const idx = drag.idx;
    const base = drag.startCorners;

    const targetPt = clampCorner({
      x: base[idx].x + dx,
      y: base[idx].y + dy,
    });

    setCorners((prev) => {
      if (cropMode === 'rect') {
        const next = base.map((c) => ({ ...c }));
        const minGap = 0.06;

        if (idx === 0) {
          const x = Math.min(targetPt.x, next[1].x - minGap);
          const y = Math.min(targetPt.y, next[3].y - minGap);
          next[0] = { x, y };
          next[3].x = x;
          next[1].y = y;
        } else if (idx === 1) {
          const x = Math.max(targetPt.x, next[0].x + minGap);
          const y = Math.min(targetPt.y, next[2].y - minGap);
          next[1] = { x, y };
          next[2].x = x;
          next[0].y = y;
        } else if (idx === 2) {
          const x = Math.max(targetPt.x, next[3].x + minGap);
          const y = Math.max(targetPt.y, next[1].y + minGap);
          next[2] = { x, y };
          next[1].x = x;
          next[3].y = y;
        } else if (idx === 3) {
          const x = Math.min(targetPt.x, next[2].x - minGap);
          const y = Math.max(targetPt.y, next[0].y + minGap);
          next[3] = { x, y };
          next[0].x = x;
          next[2].y = y;
        }
        return next;
      }

      const candidate = prev.map((c, i) => (i === idx ? targetPt : c));
      return isConvexQuad(candidate) ? candidate : prev;
    });
  };

  const handlePointerDown = (idx, e) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragRef.current = {
      idx,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startCorners: corners.map((c) => ({ ...c })),
    };
    setActiveIdx(idx);
    setAutoStatus('idle');
  };

  const handlePointerMove = (idx, e) => {
    if (dragRef.current?.idx !== idx) return;
    e.preventDefault();
    applyDeltaDrag(e.clientX, e.clientY);
  };

  const handlePointerUp = (idx, e) => {
    if (dragRef.current?.idx === idx) {
      e.currentTarget.releasePointerCapture?.(e.pointerId);
      dragRef.current = null;
      setActiveIdx(null);
    }
  };

  const handleAutoDetect = async () => {
    if (!currentSrc || busy) return;
    setBusy(true);
    try {
      const { detected, corners: nextCorners } =
        await detectDocumentCornersFromImage(currentSrc);
      setCropMode('perspective');
      setCorners(nextCorners);
      setAutoStatus(detected ? 'detected' : 'not-found');
    } finally {
      setBusy(false);
    }
  };

  const handleRotate = async () => {
    if (!currentSrc || busy) return;
    setBusy(true);
    try {
      const rotated = await rotateImageDataUrl90(currentSrc);
      setCurrentSrc(rotated);
      setCorners((prev) => rotateNormalizedCorners90(prev));
      setAutoStatus('idle');
    } finally {
      setBusy(false);
    }
  };

  const handleApply = async () => {
    if (!currentSrc || busy) return;
    setBusy(true);
    try {
      const croppedDataUrl = await cropAndWarpCmrImage(
        currentSrc,
        corners,
        1900
      );
      await onApply({
        croppedDataUrl,
        currentRawDataUrl: currentSrc,
        corners,
      });
    } finally {
      setBusy(false);
    }
  };

  const svgPts = corners.map((c) => ({ x: c.x * 1000, y: c.y * 1000 }));
  const polyPoints = svgPts.map((p) => `${p.x},${p.y}`).join(' ');
  const maskPath = `M 0 0 H 1000 V 1000 H 0 Z M ${svgPts[0].x} ${svgPts[0].y} L ${svgPts[1].x} ${svgPts[1].y} L ${svgPts[2].x} ${svgPts[2].y} L ${svgPts[3].x} ${svgPts[3].y} Z`;

  const gridLines = [1 / 3, 2 / 3].flatMap((t) => {
    const top = lerpPoint(svgPts[0], svgPts[1], t);
    const bottom = lerpPoint(svgPts[3], svgPts[2], t);
    const left = lerpPoint(svgPts[0], svgPts[3], t);
    const right = lerpPoint(svgPts[1], svgPts[2], t);
    return [
      { x1: top.x, y1: top.y, x2: bottom.x, y2: bottom.y },
      { x1: left.x, y1: left.y, x2: right.x, y2: right.y },
    ];
  });

  const activeCorner = activeIdx !== null ? corners[activeIdx] : null;
  const loupeSideClass =
    activeCorner && activeCorner.x < 0.5 ? 'right-3 top-3' : 'left-3 top-3';

  return (
    <dialog
      ref={dialogRef}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onCancel?.();
      }}
      className="cab-dialog !max-w-xl"
      aria-labelledby="cmr-crop-title"
    >
      <div className="flex max-h-[94dvh] flex-col overflow-hidden rounded-[20px] border border-white/15 bg-zinc-950 text-white shadow-2xl">
        {/* Cabeçalho */}
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="inline-flex min-h-[40px] items-center gap-1 text-[15px] font-medium text-white/80"
          >
            <X className="h-4 w-4" aria-hidden="true" />
            Cancelar
          </button>

          <h2 id="cmr-crop-title" className="text-[16px] font-semibold">
            Recortar Documento
          </h2>

          <button
            type="button"
            disabled={busy}
            onClick={handleApply}
            className="inline-flex min-h-[40px] items-center gap-1 text-[15px] font-bold text-[#3B8BF5] disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Check className="h-4 w-4" aria-hidden="true" />
            )}
            Aplicar
          </button>
        </div>

        {/* Modo de recorte + status de detecção */}
        <div className="px-4 pt-3">
          <div className="grid grid-cols-2 gap-1 rounded-[12px] bg-white/10 p-1">
            <button
              type="button"
              onClick={() => handleModeChange('perspective')}
              className={`min-h-[36px] rounded-[9px] text-[12px] font-semibold transition ${
                cropMode === 'perspective'
                  ? 'bg-[#1769D2] text-white'
                  : 'text-white/70'
              }`}
            >
              4 Cantos (Perspectiva)
            </button>
            <button
              type="button"
              onClick={() => handleModeChange('rect')}
              className={`min-h-[36px] rounded-[9px] text-[12px] font-semibold transition ${
                cropMode === 'rect'
                  ? 'bg-[#1769D2] text-white'
                  : 'text-white/70'
              }`}
            >
              Retângulo
            </button>
          </div>

          <p
            className={`mt-1.5 text-center text-[11px] font-medium ${
              autoStatus === 'detected'
                ? 'text-[#22C584]'
                : autoStatus === 'not-found'
                ? 'text-[#F59E0B]'
                : 'text-white/65'
            }`}
          >
            {autoStatus === 'detected'
              ? 'Bordas detectadas automaticamente — arraste para ajuste fino'
              : autoStatus === 'not-found'
              ? 'Bordas automáticas incertas — ajuste manualmente os 4 cantos'
              : 'Deslize perto dos cantos — use a lupa de precisão acima'}
          </p>
        </div>

        {/* Palco de Recorte + Lupa Flutuante */}
        <div className="relative flex flex-1 items-center justify-center overflow-hidden p-7">
          {activeIdx !== null && (
            <div
              aria-hidden="true"
              className={`pointer-events-none absolute z-30 flex flex-col items-center gap-1 ${loupeSideClass}`}
            >
              <div className="overflow-hidden rounded-full border-2 border-[#16A36A] bg-black shadow-2xl">
                <canvas
                  ref={loupeCanvasRef}
                  width={232}
                  height={232}
                  className="block h-[116px] w-[116px]"
                />
              </div>
              <span className="rounded-full bg-black/80 px-2 py-0.5 text-[10px] font-bold text-[#22C584] ring-1 ring-white/15">
                {CORNER_SHORT[activeIdx]}
              </span>
            </div>
          )}

          {currentSrc && (
            <div
              ref={stageRef}
              className="relative inline-block select-none touch-none"
            >
              <img
                ref={imgRef}
                src={currentSrc}
                alt="Recorte do documento CMR"
                draggable={false}
                className="pointer-events-none block max-h-[50dvh] w-auto max-w-full select-none rounded-[4px]"
              />

              <svg
                viewBox="0 0 1000 1000"
                preserveAspectRatio="none"
                className="pointer-events-none absolute inset-0 h-full w-full"
              >
                <path
                  d={maskPath}
                  fill="rgba(0, 0, 0, 0.58)"
                  fillRule="evenodd"
                />
                {gridLines.map((line, i) => (
                  <line
                    key={i}
                    x1={line.x1}
                    y1={line.y1}
                    x2={line.x2}
                    y2={line.y2}
                    stroke="rgba(255, 255, 255, 0.35)"
                    strokeWidth="2"
                  />
                ))}
                <polygon
                  points={polyPoints}
                  fill="none"
                  stroke="#1769D2"
                  strokeWidth="4"
                />
              </svg>

              {corners.map((corner, idx) => {
                const isActive = activeIdx === idx;
                return (
                  <button
                    key={idx}
                    type="button"
                    aria-label={CORNER_LABELS[idx]}
                    onPointerDown={(e) => handlePointerDown(idx, e)}
                    onPointerMove={(e) => handlePointerMove(idx, e)}
                    onPointerUp={(e) => handlePointerUp(idx, e)}
                    onPointerCancel={(e) => handlePointerUp(idx, e)}
                    style={{
                      left: `${corner.x * 100}%`,
                      top: `${corner.y * 100}%`,
                    }}
                    className="absolute flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 touch-none items-center justify-center rounded-full focus:outline-none"
                  >
                    {/* Alça vazada com mira transparente para não tampar o canto */}
                    <span
                      className={`relative flex h-8 w-8 items-center justify-center rounded-full border-[2.5px] shadow-md transition-transform ${
                        isActive
                          ? 'scale-125 border-[#16A36A] bg-[#16A36A]/20'
                          : 'border-[#3B8BF5] bg-[#1769D2]/15'
                      }`}
                    >
                      <span
                        className={`h-3 w-[1.5px] ${
                          isActive ? 'bg-[#16A36A]' : 'bg-white'
                        }`}
                      />
                      <span
                        className={`absolute h-[1.5px] w-3 ${
                          isActive ? 'bg-[#16A36A]' : 'bg-white'
                        }`}
                      />
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Barra Inferior */}
        <div className="grid grid-cols-4 gap-2 border-t border-white/10 p-3">
          <button
            type="button"
            disabled={busy}
            onClick={handleAutoDetect}
            className="flex min-h-[46px] items-center justify-center gap-1 rounded-[12px] bg-[#16A36A]/20 px-1.5 text-[12px] font-bold text-[#22C584] ring-1 ring-[#16A36A]/40 transition active:scale-95 disabled:opacity-50"
          >
            <Wand2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Auto
          </button>

          <button
            type="button"
            disabled={busy}
            onClick={handleRotate}
            className="flex min-h-[46px] items-center justify-center gap-1 rounded-[12px] bg-white/10 px-1.5 text-[12px] font-semibold text-white transition active:scale-95 disabled:opacity-50"
          >
            <RotateCw className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Girar
          </button>

          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setCorners(FULL_FRAME_CORNERS);
              setAutoStatus('idle');
            }}
            className="flex min-h-[46px] items-center justify-center gap-1 rounded-[12px] bg-white/10 px-1.5 text-[12px] font-semibold text-white transition active:scale-95 disabled:opacity-50"
          >
            <Maximize2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Inteira
          </button>

          <button
            type="button"
            disabled={busy}
            onClick={handleApply}
            className="flex min-h-[46px] items-center justify-center gap-1 rounded-[12px] bg-[#1769D2] px-1.5 text-[12px] font-bold text-white transition active:scale-95 disabled:opacity-50"
          >
            {busy ? '...' : 'Confirmar'}
          </button>
        </div>
      </div>
    </dialog>
  );
}
