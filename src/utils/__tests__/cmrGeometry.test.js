import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CROP_CORNERS,
  FULL_FRAME_CORNERS,
  applyHomography,
  computeConvexHull,
  computeHomography,
  detectDocumentCornersFromRgba,
  estimateRectifiedSize,
  isAxisAlignedRect,
  isConvexQuad,
  orderQuadCorners,
  rotateNormalizedCorners90,
  simplifyConvexHullToQuad,
} from '../cmrGeometry';
import { buildCmrFileName } from '../cmrScanner';

function pointInQuad(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    const intersect =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

describe('cmrGeometry, auto-detection & naming', () => {
  it('validates convex quads and rejects crossed/bowtie quads', () => {
    expect(isConvexQuad(FULL_FRAME_CORNERS)).toBe(true);
    expect(
      isConvexQuad([
        { x: 0.1, y: 0.1 },
        { x: 0.9, y: 0.15 },
        { x: 0.85, y: 0.9 },
        { x: 0.12, y: 0.85 },
      ])
    ).toBe(true);

    // Bowtie / crossed diagonal
    expect(
      isConvexQuad([
        { x: 0.1, y: 0.1 },
        { x: 0.9, y: 0.9 },
        { x: 0.9, y: 0.1 },
        { x: 0.1, y: 0.9 },
      ])
    ).toBe(false);
  });

  it('detects axis-aligned rectangles and estimates rectified sizes within maxDim', () => {
    expect(isAxisAlignedRect(FULL_FRAME_CORNERS)).toBe(true);
    expect(
      isAxisAlignedRect([
        { x: 0.1, y: 0.1 },
        { x: 0.92, y: 0.15 },
        { x: 0.9, y: 0.9 },
        { x: 0.1, y: 0.9 },
      ])
    ).toBe(false);

    const size = estimateRectifiedSize(FULL_FRAME_CORNERS, 3000, 4000, 1500);
    expect(size.height).toBe(1500);
    expect(size.width).toBe(1125);
  });

  it('computes accurate 3x3 homography mapping all 4 corners', () => {
    const dstQuad = [
      { x: 0, y: 0 },
      { x: 999, y: 0 },
      { x: 999, y: 1399 },
      { x: 0, y: 1399 },
    ];
    const srcQuad = [
      { x: 180, y: 120 },
      { x: 1120, y: 210 },
      { x: 1240, y: 1680 },
      { x: 95, y: 1590 },
    ];

    const H = computeHomography(dstQuad, srcQuad);
    expect(H).not.toBeNull();

    dstQuad.forEach((dstPt, idx) => {
      const mapped = applyHomography(H, dstPt.x, dstPt.y);
      expect(mapped.x).toBeCloseTo(srcQuad[idx].x, 4);
      expect(mapped.y).toBeCloseTo(srcQuad[idx].y, 4);
    });
  });

  it('rotates normalized corners 90 degrees clockwise', () => {
    const rotated = rotateNormalizedCorners90([
      { x: 0.1, y: 0.2 },
      { x: 0.8, y: 0.2 },
      { x: 0.8, y: 0.9 },
      { x: 0.1, y: 0.9 },
    ]);
    expect(rotated[0].x).toBeCloseTo(0.1, 6);
    expect(rotated[0].y).toBeCloseTo(0.1, 6);
    expect(rotated[1].x).toBeCloseTo(0.8, 6);
    expect(rotated[1].y).toBeCloseTo(0.1, 6);
  });

  it('orders quad corners, computes convex hull and simplifies to 4 corners', () => {
    const ordered = orderQuadCorners([
      { x: 0.8, y: 0.9 },
      { x: 0.1, y: 0.15 },
      { x: 0.2, y: 0.85 },
      { x: 0.85, y: 0.1 },
    ]);
    expect(ordered).toEqual([
      { x: 0.1, y: 0.15 },
      { x: 0.85, y: 0.1 },
      { x: 0.8, y: 0.9 },
      { x: 0.2, y: 0.85 },
    ]);

    const hull = computeConvexHull([
      { x: 0, y: 0 },
      { x: 50, y: 50 }, // interior
      { x: 100, y: 0 },
      { x: 101, y: 5 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ]);
    expect(hull.length).toBeGreaterThanOrEqual(4);
    const quad = simplifyConvexHullToQuad(hull);
    expect(quad).toHaveLength(4);
  });

  it('automatically detects a tilted white CMR paper over dark background', () => {
    const w = 200;
    const h = 260;
    const rgba = new Uint8ClampedArray(w * h * 4);

    const trueVertsNorm = [
      { x: 0.18, y: 0.12 },
      { x: 0.86, y: 0.16 },
      { x: 0.82, y: 0.88 },
      { x: 0.12, y: 0.82 },
    ];
    const polyPx = trueVertsNorm.map((p) => ({
      x: p.x * (w - 1),
      y: p.y * (h - 1),
    }));

    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const idx = (y * w + x) * 4;
        const isPaper = pointInQuad(x, y, polyPx);
        // Include simulated dark text inside document to test morphological closing
        const isPrintedLine =
          isPaper && y > 70 && y < 180 && y % 18 < 3 && x > 50 && x < 140;
        if (isPaper && !isPrintedLine) {
          rgba[idx] = 242;
          rgba[idx + 1] = 240;
          rgba[idx + 2] = 235;
        } else if (isPrintedLine) {
          rgba[idx] = 40;
          rgba[idx + 1] = 45;
          rgba[idx + 2] = 55;
        } else {
          rgba[idx] = 35;
          rgba[idx + 1] = 40;
          rgba[idx + 2] = 50;
        }
        rgba[idx + 3] = 255;
      }
    }

    const res = detectDocumentCornersFromRgba(rgba, w, h);
    expect(res.detected).toBe(true);
    expect(res.corners).toHaveLength(4);
    res.corners.forEach((corner, i) => {
      expect(Math.abs(corner.x - trueVertsNorm[i].x)).toBeLessThan(0.05);
      expect(Math.abs(corner.y - trueVertsNorm[i].y)).toBeLessThan(0.05);
    });
  });

  it('returns detected=false and default corners on uniform image', () => {
    const w = 100;
    const h = 100;
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i += 1) {
      rgba[i * 4] = 120;
      rgba[i * 4 + 1] = 122;
      rgba[i * 4 + 2] = 125;
      rgba[i * 4 + 3] = 255;
    }

    const res = detectDocumentCornersFromRgba(rgba, w, h);
    expect(res.detected).toBe(false);
    expect(res.corners).toEqual(DEFAULT_CROP_CORNERS);
  });

  it('builds sanitized CMR PDF filenames', () => {
    expect(buildCmrFileName('2026-11-18', ' 84920 / A ')).toBe(
      'CMR_2026-11-18_84920-A.pdf'
    );
  });
});
