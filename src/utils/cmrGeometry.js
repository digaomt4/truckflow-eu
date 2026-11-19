/**
 * Utilitários matemáticos para recorte de 4 cantos, validação de polígono,
 * detecção automática de bordas do documento e correção de perspectiva (homografia 3x3).
 */

export const DEFAULT_CROP_CORNERS = [
  { x: 0.05, y: 0.05 }, // Topo-Esquerda
  { x: 0.95, y: 0.05 }, // Topo-Direita
  { x: 0.95, y: 0.95 }, // Base-Direita
  { x: 0.05, y: 0.95 }, // Base-Esquerda
];

export const FULL_FRAME_CORNERS = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

export function clampCorner(pt) {
  return {
    x: Math.max(0, Math.min(1, Number(pt?.x) || 0)),
    y: Math.max(0, Math.min(1, Number(pt?.y) || 0)),
  };
}

export function computeQuadArea(corners) {
  if (!Array.isArray(corners) || corners.length !== 4) return 0;
  let area2 = 0;
  for (let i = 0; i < 4; i += 1) {
    const p0 = corners[i];
    const p1 = corners[(i + 1) % 4];
    area2 += p0.x * p1.y - p1.x * p0.y;
  }
  return Math.abs(area2) * 0.5;
}

/**
 * Verifica se os 4 cantos formam um quadrilátero estritamente convexo e não-degenerado.
 */
export function isConvexQuad(corners) {
  if (!Array.isArray(corners) || corners.length !== 4) return false;

  let sign = 0;
  let area2 = 0;

  for (let i = 0; i < 4; i += 1) {
    const p0 = corners[i];
    const p1 = corners[(i + 1) % 4];
    const p2 = corners[(i + 2) % 4];

    const dx1 = p1.x - p0.x;
    const dy1 = p1.y - p0.y;
    const dx2 = p2.x - p1.x;
    const dy2 = p2.y - p1.y;

    const cross = dx1 * dy2 - dy1 * dx2;
    if (Math.abs(cross) < 1e-5) return false;

    const currentSign = cross > 0 ? 1 : -1;
    if (sign === 0) {
      sign = currentSign;
    } else if (sign !== currentSign) {
      return false;
    }

    area2 += p0.x * p1.y - p1.x * p0.y;
  }

  return Math.abs(area2) * 0.5 > 0.002;
}

/**
 * Verifica se os 4 cantos formam um retângulo alinhado aos eixos (permite recorte rápido sem homografia).
 */
export function isAxisAlignedRect(corners, eps = 0.002) {
  if (!Array.isArray(corners) || corners.length !== 4) return false;
  const [tl, tr, br, bl] = corners;
  return (
    Math.abs(tl.y - tr.y) <= eps &&
    Math.abs(bl.y - br.y) <= eps &&
    Math.abs(tl.x - bl.x) <= eps &&
    Math.abs(tr.x - br.x) <= eps &&
    tr.x > tl.x &&
    bl.y > tl.y
  );
}

/**
 * Estima as dimensões retificadas (largura x altura) em pixels para a imagem recortada,
 * respeitando o limite máximo de dimensão.
 */
export function estimateRectifiedSize(corners, srcW, srcH, maxDim = 1500) {
  const safeW = Math.max(1, Number(srcW) || 1);
  const safeH = Math.max(1, Number(srcH) || 1);
  const pts = corners.map((c) => ({ x: c.x * safeW, y: c.y * safeH }));

  const top = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
  const bottom = Math.hypot(pts[2].x - pts[3].x, pts[2].y - pts[3].y);
  const left = Math.hypot(pts[3].x - pts[0].x, pts[3].y - pts[0].y);
  const right = Math.hypot(pts[2].x - pts[1].x, pts[2].y - pts[1].y);

  let width = Math.max(1, Math.round(Math.max(top, bottom)));
  let height = Math.max(1, Math.round(Math.max(left, right)));

  const largest = Math.max(width, height);
  if (largest > maxDim) {
    const scale = maxDim / largest;
    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));
  }

  return { width, height };
}

/**
 * Resolve uma homografia 3x3 (em vetor plano de 9 posições, h8 = 1) que mapeia
 * os 4 pontos de destino `dstQuad` para os 4 pontos de origem `srcQuad`.
 */
export function computeHomography(dstQuad, srcQuad) {
  if (
    !Array.isArray(dstQuad) ||
    !Array.isArray(srcQuad) ||
    dstQuad.length !== 4 ||
    srcQuad.length !== 4
  ) {
    return null;
  }

  const A = [];
  for (let i = 0; i < 4; i += 1) {
    const x = dstQuad[i].x;
    const y = dstQuad[i].y;
    const u = srcQuad[i].x;
    const v = srcQuad[i].y;

    A.push([x, y, 1, 0, 0, 0, -x * u, -y * u, u]);
    A.push([0, 0, 0, x, y, 1, -x * v, -y * v, v]);
  }

  const n = 8;
  for (let col = 0; col < n; col += 1) {
    let maxRow = col;
    let maxVal = Math.abs(A[col][col]);
    for (let row = col + 1; row < n; row += 1) {
      const val = Math.abs(A[row][col]);
      if (val > maxVal) {
        maxVal = val;
        maxRow = row;
      }
    }

    if (maxVal < 1e-10) return null;

    if (maxRow !== col) {
      const tmp = A[col];
      A[col] = A[maxRow];
      A[maxRow] = tmp;
    }

    const pivot = A[col][col];
    for (let j = col; j <= n; j += 1) {
      A[col][j] /= pivot;
    }

    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const factor = A[row][col];
      if (Math.abs(factor) < 1e-12) continue;
      for (let j = col; j <= n; j += 1) {
        A[row][j] -= factor * A[col][j];
      }
    }
  }

  return [
    A[0][8],
    A[1][8],
    A[2][8],
    A[3][8],
    A[4][8],
    A[5][8],
    A[6][8],
    A[7][8],
    1,
  ];
}

/**
 * Aplica matriz de homografia 3x3 sobre um ponto (x, y).
 */
export function applyHomography(H, x, y) {
  const denom = H[6] * x + H[7] * y + H[8];
  if (Math.abs(denom) < 1e-10) {
    return { x: 0, y: 0 };
  }
  return {
    x: (H[0] * x + H[1] * y + H[2]) / denom,
    y: (H[3] * x + H[4] * y + H[5]) / denom,
  };
}

/**
 * Rotaciona cantos normalizados 90° no sentido horário mantendo a ordem [TL, TR, BR, BL].
 */
export function rotateNormalizedCorners90(corners) {
  if (!Array.isArray(corners) || corners.length !== 4) {
    return DEFAULT_CROP_CORNERS;
  }
  const rot = (p) => clampCorner({ x: 1 - p.y, y: p.x });
  return [rot(corners[3]), rot(corners[0]), rot(corners[1]), rot(corners[2])];
}

/**
 * Ordena 4 cantos na ordem canônica [TL, TR, BR, BL].
 */
export function orderQuadCorners(pts) {
  if (!Array.isArray(pts) || pts.length !== 4) return null;
  const byY = [...pts].sort((a, b) => a.y - b.y || a.x - b.x);
  const topPair = byY.slice(0, 2).sort((a, b) => a.x - b.x);
  const bottomPair = byY.slice(2, 4).sort((a, b) => b.x - a.x);
  return [topPair[0], topPair[1], bottomPair[0], bottomPair[1]];
}

/**
 * Calcula o envoltório convexo (Andrew's Monotone Chain) de um conjunto de pontos 2D.
 */
export function computeConvexHull(points) {
  if (!Array.isArray(points) || points.length < 3) return points || [];

  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o, a, b) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const lower = [];
  for (let i = 0; i < sorted.length; i += 1) {
    const p = sorted[i];
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0
    ) {
      lower.pop();
    }
    lower.push(p);
  }

  const upper = [];
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const p = sorted[i];
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0
    ) {
      upper.pop();
    }
    upper.push(p);
  }

  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/**
 * Simplifica um envoltório convexo até restarem exatamente 4 vértices,
 * removendo iterativamente o vértice de menor contribuição de área triangular.
 */
export function simplifyConvexHullToQuad(hull) {
  if (!Array.isArray(hull) || hull.length < 4) return null;
  const pts = hull.map((p) => ({ x: p.x, y: p.y }));

  while (pts.length > 4) {
    let minArea = Infinity;
    let minIdx = 0;
    const len = pts.length;

    for (let i = 0; i < len; i += 1) {
      const prev = pts[(i - 1 + len) % len];
      const curr = pts[i];
      const next = pts[(i + 1) % len];
      const area =
        Math.abs(
          prev.x * (curr.y - next.y) +
            curr.x * (next.y - prev.y) +
            next.x * (prev.y - curr.y)
        ) * 0.5;
      if (area < minArea) {
        minArea = area;
        minIdx = i;
      }
    }

    pts.splice(minIdx, 1);
  }

  return pts;
}

/**
 * Calcula o limiar ótimo de Otsu em um histograma de 256 níveis.
 */
export function otsuThreshold(histogram, totalPixels) {
  if (!histogram || totalPixels <= 0) return 128;

  let sumAll = 0;
  for (let i = 0; i < 256; i += 1) {
    sumAll += i * (histogram[i] || 0);
  }

  let sumBg = 0;
  let weightBg = 0;
  let maxVariance = -1;
  let bestThreshold = 128;

  for (let t = 0; t < 256; t += 1) {
    const count = histogram[t] || 0;
    weightBg += count;
    if (weightBg === 0) continue;

    const weightFg = totalPixels - weightBg;
    if (weightFg === 0) break;

    sumBg += t * count;
    const meanBg = sumBg / weightBg;
    const meanFg = (sumAll - sumBg) / weightFg;
    const diff = meanBg - meanFg;
    const betweenVar = weightBg * weightFg * diff * diff;

    if (betweenVar > maxVariance) {
      maxVariance = betweenVar;
      bestThreshold = t;
    }
  }

  return bestThreshold;
}

function boxBlur3x3(src, w, h) {
  const dst = new Uint8Array(w * h);
  for (let y = 0; y < h; y += 1) {
    const y0 = Math.max(0, y - 1);
    const y2 = Math.min(h - 1, y + 1);
    for (let x = 0; x < w; x += 1) {
      const x0 = Math.max(0, x - 1);
      const x2 = Math.min(w - 1, x + 1);
      let sum = 0;
      let count = 0;
      for (let ny = y0; ny <= y2; ny += 1) {
        const row = ny * w;
        for (let nx = x0; nx <= x2; nx += 1) {
          sum += src[row + nx];
          count += 1;
        }
      }
      dst[y * w + x] = Math.round(sum / count);
    }
  }
  return dst;
}

function morphDilate3x3(src, w, h) {
  const dst = new Uint8Array(w * h);
  for (let y = 0; y < h; y += 1) {
    const y0 = Math.max(0, y - 1);
    const y2 = Math.min(h - 1, y + 1);
    for (let x = 0; x < w; x += 1) {
      const x0 = Math.max(0, x - 1);
      const x2 = Math.min(w - 1, x + 1);
      let hit = 0;
      for (let ny = y0; ny <= y2 && !hit; ny += 1) {
        const row = ny * w;
        for (let nx = x0; nx <= x2; nx += 1) {
          if (src[row + nx]) {
            hit = 1;
            break;
          }
        }
      }
      dst[y * w + x] = hit;
    }
  }
  return dst;
}

function morphErode3x3(src, w, h) {
  const dst = new Uint8Array(w * h);
  for (let y = 0; y < h; y += 1) {
    const y0 = Math.max(0, y - 1);
    const y2 = Math.min(h - 1, y + 1);
    for (let x = 0; x < w; x += 1) {
      const idx = y * w + x;
      if (!src[idx]) continue;
      const x0 = Math.max(0, x - 1);
      const x2 = Math.min(w - 1, x + 1);
      let allOne = 1;
      for (let ny = y0; ny <= y2 && allOne; ny += 1) {
        const row = ny * w;
        for (let nx = x0; nx <= x2; nx += 1) {
          if (!src[row + nx]) {
            allOne = 0;
            break;
          }
        }
      }
      dst[idx] = allOne;
    }
  }
  return dst;
}

function normalizeAndValidateQuad(quadPts, w, h, minArea, maxArea) {
  if (!quadPts || quadPts.length !== 4) return null;
  const maxX = Math.max(1, w - 1);
  const maxY = Math.max(1, h - 1);
  const normalized = quadPts.map((p) =>
    clampCorner({ x: p.x / maxX, y: p.y / maxY })
  );
  const ordered = orderQuadCorners(normalized);
  if (!ordered || !isConvexQuad(ordered)) return null;
  const area = computeQuadArea(ordered);
  if (area < minArea || area > maxArea) return null;
  return ordered;
}

/**
 * Detecta automaticamente os 4 cantos de uma folha de CMR a partir de ImageData RGBA.
 * Retorna `{ detected: boolean, corners: Array<{ x, y }> }`.
 */
export function detectDocumentCornersFromRgba(rgbaData, width, height) {
  const w = Math.floor(Number(width) || 0);
  const h = Math.floor(Number(height) || 0);
  const total = w * h;

  if (!rgbaData || w < 16 || h < 16 || rgbaData.length < total * 4) {
    return { detected: false, corners: DEFAULT_CROP_CORNERS };
  }

  const paper = new Uint8Array(total);
  const gray = new Uint8Array(total);

  for (let i = 0; i < total; i += 1) {
    const p = i * 4;
    const r = rgbaData[p];
    const g = rgbaData[p + 1];
    const b = rgbaData[p + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const sat = Math.max(r, g, b) - Math.min(r, g, b);
    gray[i] = Math.max(0, Math.min(255, Math.round(lum)));
    paper[i] = Math.max(0, Math.min(255, Math.round(lum - 0.35 * sat)));
  }

  const smoothPaper = boxBlur3x3(paper, w, h);
  const hist = new Uint32Array(256);
  for (let i = 0; i < total; i += 1) {
    hist[smoothPaper[i]] += 1;
  }

  const threshold = otsuThreshold(hist, total);

  // Verifica separação mínima de contraste entre folha e fundo
  let sumBg = 0;
  let cntBg = 0;
  let sumFg = 0;
  let cntFg = 0;
  for (let i = 0; i < total; i += 1) {
    const val = smoothPaper[i];
    if (val >= threshold) {
      sumFg += val;
      cntFg += 1;
    } else {
      sumBg += val;
      cntBg += 1;
    }
  }

  if (cntFg > 0 && cntBg > 0 && sumFg / cntFg - sumBg / cntBg >= 18) {
    const rawMask = new Uint8Array(total);
    for (let i = 0; i < total; i += 1) {
      rawMask[i] = smoothPaper[i] >= threshold ? 1 : 0;
    }

    const closedMask = morphErode3x3(morphDilate3x3(rawMask, w, h), w, h);
    const visited = new Uint8Array(total);
    const queue = new Int32Array(total);

    let bestPixels = null;
    let bestCount = 0;
    const minComp = total * 0.12;
    const maxComp = total * 0.95;

    for (let start = 0; start < total; start += 1) {
      if (!closedMask[start] || visited[start]) continue;

      let head = 0;
      let tail = 0;
      queue[tail] = start;
      tail += 1;
      visited[start] = 1;

      while (head < tail) {
        const curr = queue[head];
        head += 1;
        const cx = curr % w;
        const cy = (curr - cx) / w;

        if (cx > 0) {
          const left = curr - 1;
          if (closedMask[left] && !visited[left]) {
            visited[left] = 1;
            queue[tail] = left;
            tail += 1;
          }
        }
        if (cx < w - 1) {
          const right = curr + 1;
          if (closedMask[right] && !visited[right]) {
            visited[right] = 1;
            queue[tail] = right;
            tail += 1;
          }
        }
        if (cy > 0) {
          const up = curr - w;
          if (closedMask[up] && !visited[up]) {
            visited[up] = 1;
            queue[tail] = up;
            tail += 1;
          }
        }
        if (cy < h - 1) {
          const down = curr + w;
          if (closedMask[down] && !visited[down]) {
            visited[down] = 1;
            queue[tail] = down;
            tail += 1;
          }
        }
      }

      if (tail >= minComp && tail <= maxComp && tail > bestCount) {
        bestCount = tail;
        bestPixels = queue.slice(0, tail);
      }
    }

    if (bestPixels) {
      const boundaryPts = [];
      for (let i = 0; i < bestPixels.length; i += 1) {
        const idx = bestPixels[i];
        const x = idx % w;
        const y = (idx - x) / w;
        if (
          x === 0 ||
          x === w - 1 ||
          y === 0 ||
          y === h - 1 ||
          !closedMask[idx - 1] ||
          !closedMask[idx + 1] ||
          !closedMask[idx - w] ||
          !closedMask[idx + w]
        ) {
          boundaryPts.push({ x, y });
        }
      }

      const hull = computeConvexHull(boundaryPts);
      const quad = simplifyConvexHullToQuad(hull);
      const valid = normalizeAndValidateQuad(quad, w, h, 0.12, 0.96);
      if (valid) {
        return { detected: true, corners: valid };
      }
    }
  }

  // Cue 2 (Fallback por gradiente Sobel para fundos claros ou baixo contraste)
  const smoothGray = boxBlur3x3(gray, w, h);
  const mx = Math.max(2, Math.floor(w * 0.02));
  const my = Math.max(2, Math.floor(h * 0.02));
  const innerW = w - mx * 2;
  const innerH = h - my * 2;

  if (innerW >= 8 && innerH >= 8) {
    const magHist = new Uint32Array(256);
    const mags = new Uint16Array(innerW * innerH);
    let maxMag = 0;

    for (let y = my; y < h - my; y += 1) {
      for (let x = mx; x < w - mx; x += 1) {
        const gx =
          -smoothGray[(y - 1) * w + (x - 1)] +
          smoothGray[(y - 1) * w + (x + 1)] -
          2 * smoothGray[y * w + (x - 1)] +
          2 * smoothGray[y * w + (x + 1)] -
          smoothGray[(y + 1) * w + (x - 1)] +
          smoothGray[(y + 1) * w + (x + 1)];
        const gy =
          -smoothGray[(y - 1) * w + (x - 1)] -
          2 * smoothGray[(y - 1) * w + x] -
          smoothGray[(y - 1) * w + (x + 1)] +
          smoothGray[(y + 1) * w + (x - 1)] +
          2 * smoothGray[(y + 1) * w + x] +
          smoothGray[(y + 1) * w + (x + 1)];

        const mag = Math.min(1020, Math.round(Math.hypot(gx, gy)));
        if (mag > maxMag) maxMag = mag;
        mags[(y - my) * innerW + (x - mx)] = mag;
        magHist[Math.min(255, mag >> 2)] += 1;
      }
    }

    if (maxMag >= 25) {
      const targetCount = Math.floor(innerW * innerH * 0.88);
      let acc = 0;
      let p88Bin = 255;
      for (let b = 0; b < 256; b += 1) {
        acc += magHist[b];
        if (acc >= targetCount) {
          p88Bin = b;
          break;
        }
      }
      const p88Threshold = Math.max(25, p88Bin << 2);

      const edgePts = [];
      for (let iy = 0; iy < innerH; iy += 1) {
        for (let ix = 0; ix < innerW; ix += 1) {
          if (mags[iy * innerW + ix] >= p88Threshold) {
            edgePts.push({ x: ix + mx, y: iy + my });
          }
        }
      }

      if (edgePts.length >= 12) {
        const hull = computeConvexHull(edgePts);
        const quad = simplifyConvexHullToQuad(hull);
        const valid = normalizeAndValidateQuad(quad, w, h, 0.15, 0.92);
        if (valid) {
          return { detected: true, corners: valid };
        }
      }
    }
  }

  return { detected: false, corners: DEFAULT_CROP_CORNERS };
}
