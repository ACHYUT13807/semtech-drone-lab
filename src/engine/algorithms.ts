// ============================================================
// Semtech Drone — Core Algorithm Engine
// Pure TypeScript implementations of segmentation, costmap,
// skeletonization, and pathfinding for browser-side execution
// ============================================================

export interface GridCell {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface SegmentationResult {
  mask: Uint8Array; // class index per pixel — see CLASS_NAMES
  width: number;
  height: number;
}

export interface CostmapResult {
  costs: Float32Array;
  width: number;
  height: number;
}

export interface PathResult {
  path: Point[];
  explored: Point[];
  cost: number;
}

// ── 12-class semantic taxonomy ────────────────────────────────
// NOTE: this assumes the standard Aeroscapes-style class ordering
// (background/person/bike/car/drone/boat/animal/obstacle/construction/
// vegetation/road/sky). If road_seg.onnx was trained with a different
// class->index mapping, change ROAD_CLASS to match — that single
// constant is what everything downstream (costmap, skeleton, renderer)
// keys off of.
export const NUM_CLASSES = 12;
export const ROAD_CLASS = 10;

export const CLASS_NAMES: Record<number, string> = {
  0: 'Background',
  1: 'Person',
  2: 'Bike',
  3: 'Car',
  4: 'Drone',
  5: 'Boat',
  6: 'Animal',
  7: 'Obstacle',
  8: 'Construction',
  9: 'Vegetation',
  10: 'Road / Navigable',
  11: 'Sky',
};

export const CLASS_COLORS: Record<number, [number, number, number]> = {
  0: [20, 20, 25],
  1: [220, 80, 140],
  2: [90, 200, 90],
  3: [130, 130, 140],
  4: [200, 60, 60],
  5: [40, 90, 200],
  6: [200, 140, 40],
  7: [180, 40, 40],       // obstacle — red
  8: [150, 90, 190],      // construction
  9: [34, 139, 34],       // vegetation — green
  10: [100, 60, 180],     // road — purple
  11: [135, 206, 235],    // sky — light blue
};

// ── Real model decode: argmax over per-pixel class logits ────
// Call this on the raw ONNX output tensor (a Float32Array of logits/
// probabilities), NOT on ImageData. Handles both NHWC ([1,H,W,C]) and
// NCHW ([1,C,H,W]) layouts.
export function decodeSegmentationOutput(
  outputData: Float32Array,
  width: number,
  height: number,
  numClasses: number,
  isNCHW: boolean
): SegmentationResult {
  const mask = new Uint8Array(width * height);
  const hw = width * height;

  for (let pixelIdx = 0; pixelIdx < hw; pixelIdx++) {
    let bestClass = 0;
    let bestScore = -Infinity;

    for (let c = 0; c < numClasses; c++) {
      const idx = isNCHW ? c * hw + pixelIdx : pixelIdx * numClasses + c;
      const score = outputData[idx];
      if (score > bestScore) {
        bestScore = score;
        bestClass = c;
      }
    }
    mask[pixelIdx] = bestClass;
  }

  return { mask, width, height };
}

// ── Extract a binary road/free-space mask from any segmentation ──
// result (real model or heuristic demo). This is what costmap
// generation, skeletonization, and the binary renderer all consume.
export function extractRoadMask(
  seg: SegmentationResult,
  roadClass: number = ROAD_CLASS
): Uint8Array {
  const bin = new Uint8Array(seg.width * seg.height);
  for (let i = 0; i < bin.length; i++) {
    bin[i] = seg.mask[i] === roadClass ? 1 : 0;
  }
  return bin;
}

// ── Pick A* start/end from the SAME connected road region ────────
// Previous approach picked "nearest road pixel to a bottom anchor" and
// "nearest road pixel to a top anchor" independently. On a real photo
// (unlike the synthetic demo, which is one single blob by construction)
// the road mask can have several disconnected blobs -- a big correctly-
// detected main road plus small isolated misclassification noise
// elsewhere in frame. Picking start/end independently can land them in
// two DIFFERENT blobs with solid obstacle between them, which A* then
// correctly reports as unreachable -- not a pathfinding bug, a wrong-
// endpoint bug. Flood-fill the road mask into connected components,
// take the largest (near-certainly the real road), and pick both
// endpoints from within that one component so a path can always exist
// between them (barring obstacle inflation severing it, a separate,
// much rarer case).
export function findConnectedRoadEndpoints(
  seg: SegmentationResult,
  roadClass: number = ROAD_CLASS
): { start: Point; end: Point; skeletonPath?: Point[] } {
  const { mask, width, height } = seg;
  const n = width * height;
  const visited = new Uint8Array(n);

  let bestPixels: Int32Array | null = null;
  let bestSize = 0;

  for (let i = 0; i < n; i++) {
    if (mask[i] !== roadClass || visited[i]) continue;

    // BFS flood fill (4-connectivity) over this component.
    const queue = new Int32Array(n);
    let qHead = 0;
    let qTail = 0;
    queue[qTail++] = i;
    visited[i] = 1;

    while (qHead < qTail) {
      const cur = queue[qHead++];
      const cx = cur % width;
      const cy = (cur / width) | 0;

      if (cx > 0) {
        const nb = cur - 1;
        if (!visited[nb] && mask[nb] === roadClass) { visited[nb] = 1; queue[qTail++] = nb; }
      }
      if (cx < width - 1) {
        const nb = cur + 1;
        if (!visited[nb] && mask[nb] === roadClass) { visited[nb] = 1; queue[qTail++] = nb; }
      }
      if (cy > 0) {
        const nb = cur - width;
        if (!visited[nb] && mask[nb] === roadClass) { visited[nb] = 1; queue[qTail++] = nb; }
      }
      if (cy < height - 1) {
        const nb = cur + width;
        if (!visited[nb] && mask[nb] === roadClass) { visited[nb] = 1; queue[qTail++] = nb; }
      }
    }

    if (qTail > bestSize) {
      bestSize = qTail;
      bestPixels = queue.slice(0, qTail);
    }
  }

  if (!bestPixels || bestSize === 0) {
    // No road detected anywhere -- nothing better to do than the old
    // fixed guess; A* will correctly report no path.
    return {
      start: { x: Math.floor(width * 0.45), y: height - 5 },
      end: { x: Math.floor(width * 0.45), y: 5 },
    };
  }

  // Skeleton-based selection, ported from v10ultra's
  // build_waypoint_chain(). Thin the connected component to a centerline,
  // project the drone position onto the longest centerline, split there,
  // then follow the upward/forward branch.
  //
  // Anchoring to the skeleton instead of the raw mask is what keeps
  // start on the MIDDLE of the road: "closest road pixel to bottom-
  // center" among ALL road pixels (the old approach, still used below
  // as a fallback) is very often a corner/edge pixel of the road
  // polygon rather than its midline -- a skeleton pixel is by
  // construction equidistant from both road edges.
  const compMask = new Uint8Array(n);
  for (let k = 0; k < bestPixels.length; k++) compMask[bestPixels[k]] = 1;
  const skel = skeletonize(compMask, width, height);

  const mainPath = skeletonMainBranch(skel, width, height);
  if (mainPath.length >= 2) {
    // Browser equivalent of v10-ultra's start_rc projection. The browser
    // demo has no live pose, so the image bottom-centre is its pose anchor;
    // the selected point is nevertheless always on the road skeleton.
    const anchor = { x: width * 0.5, y: height - 1 };
    let splitIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < mainPath.length; i++) {
      const p = mainPath[i];
      const d = (p.x - anchor.x) ** 2 + (p.y - anchor.y) ** 2;
      if (d < bestDist) { bestDist = d; splitIdx = i; }
    }

    // Exact v10-ultra branch split, with prefer='up' for this forward-facing
    // camera: choose the branch whose far endpoint is highest in the image.
    const branchA = mainPath.slice(0, splitIdx + 1).reverse();
    const branchB = mainPath.slice(splitIdx);
    const candidates = [branchA, branchB].filter(path => path.length >= 2);
    const chosenPath = candidates.length === 1
      ? candidates[0]
      : candidates.reduce((best, path) =>
          path[path.length - 1].y < best[best.length - 1].y ? path : best);
    const start = chosenPath[0];
    const end = chosenPath[chosenPath.length - 1];
    return { start, end, skeletonPath: chosenPath };
  }

  // Degenerate skeleton (e.g. component too small/thin to thin cleanly)
  // -- fall back to nearest-pixel-to-anchor rather than returning nothing.
  const bottomAnchorX = width * 0.5, bottomAnchorY = height;
  const topAnchorX = width * 0.5, topAnchorY = 0;

  let start: Point = { x: bestPixels[0] % width, y: (bestPixels[0] / width) | 0 };
  let end: Point = { ...start };
  let bestStartDist = Infinity;
  let bestEndDist = Infinity;

  for (let k = 0; k < bestPixels.length; k++) {
    const idx = bestPixels[k];
    const x = idx % width;
    const y = (idx / width) | 0;

    const dStart = (x - bottomAnchorX) ** 2 + (y - bottomAnchorY) ** 2;
    if (dStart < bestStartDist) { bestStartDist = dStart; start = { x, y }; }

    const dEnd = (x - topAnchorX) ** 2 + (y - topAnchorY) ** 2;
    if (dEnd < bestEndDist) { bestEndDist = dEnd; end = { x, y }; }
  }

  return { start, end };
}

// ── Heuristic RGB-based classifier ────────────────────────────
// Used ONLY for the synthetic demo image (generateSampleAerial) when
// no real model is loaded. Outputs into the same 12-class taxonomy
// above so ROAD_CLASS works uniformly regardless of source.
export function heuristicSegmentation(
  imageData: ImageData,
  sensitivity: number = 0.5
): SegmentationResult {
  const { data, width, height } = imageData;
  const mask = new Uint8Array(width * height);
  const thresh = 1.0 - sensitivity;

  for (let i = 0; i < width * height; i++) {
    const idx = i * 4;
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];

    const brightness = (r + g + b) / 3;
    const rNorm = r / 255;
    const gNorm = g / 255;
    const bNorm = b / 255;

    // Classify based on color features
    if (brightness > 180 && bNorm > 0.6 && bNorm > rNorm) {
      mask[i] = 11; // sky
    } else if (gNorm > rNorm * (1.0 + thresh * 0.3) && gNorm > bNorm && g > 50) {
      mask[i] = 9; // vegetation
    } else if (brightness < 80 * (1 + thresh * 0.5)) {
      mask[i] = 7; // obstacle
    } else if (
      Math.abs(rNorm - gNorm) < 0.15 + thresh * 0.1 &&
      Math.abs(gNorm - bNorm) < 0.15 + thresh * 0.1 &&
      brightness > 60 && brightness < 200
    ) {
      mask[i] = ROAD_CLASS; // road
    } else if (rNorm > gNorm && rNorm > bNorm * 0.9 && brightness > 80) {
      mask[i] = 8; // construction/building
    } else if (brightness < 120) {
      mask[i] = 7; // obstacle
    } else {
      mask[i] = ROAD_CLASS; // default to road
    }
  }

  return { mask, width, height };
}

// ── Morphological Operations ─────────────────────────────────
export function dilate(mask: Uint8Array, w: number, h: number, kernelSize: number, targetClass: number): Uint8Array {
  const result = new Uint8Array(mask);
  const half = Math.floor(kernelSize / 2);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x] === targetClass) {
        for (let dy = -half; dy <= half; dy++) {
          for (let dx = -half; dx <= half; dx++) {
            const ny = y + dy;
            const nx = x + dx;
            if (ny >= 0 && ny < h && nx >= 0 && nx < w) {
              result[ny * w + nx] = targetClass;
            }
          }
        }
      }
    }
  }
  return result;
}

export function erode(mask: Uint8Array, w: number, h: number, kernelSize: number, targetClass: number): Uint8Array {
  const result = new Uint8Array(mask);
  const half = Math.floor(kernelSize / 2);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x] === targetClass) {
        let allMatch = true;
        for (let dy = -half; dy <= half && allMatch; dy++) {
          for (let dx = -half; dx <= half && allMatch; dx++) {
            const ny = y + dy;
            const nx = x + dx;
            if (ny < 0 || ny >= h || nx < 0 || nx >= w || mask[ny * w + nx] !== targetClass) {
              allMatch = false;
            }
          }
        }
        if (!allMatch) result[y * w + x] = 0;
      }
    }
  }
  return result;
}

// ── Costmap / Occupancy Grid ─────────────────────────────────
// Built directly from a binary road mask (1 = free/road, 0 = everything
// else = obstacle) rather than a per-class cost table. Get the mask via
// extractRoadMask(seg) first.
export function generateCostmap(
  roadMask: Uint8Array,
  width: number,
  height: number,
  inflation: number = 5
): CostmapResult {
  const costs = new Float32Array(width * height);

  for (let i = 0; i < width * height; i++) {
    costs[i] = roadMask[i] === 1 ? 0.0 : 1.0;
  }

  // Inflate obstacles
  if (inflation > 0) {
    const inflated = new Float32Array(costs);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (costs[y * width + x] >= 0.9) {
          for (let dy = -inflation; dy <= inflation; dy++) {
            for (let dx = -inflation; dx <= inflation; dx++) {
              const ny = y + dy;
              const nx = x + dx;
              if (ny >= 0 && ny < height && nx >= 0 && nx < width) {
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist <= inflation) {
                  const penalty = 1.0 - dist / (inflation + 1);
                  const idx = ny * width + nx;
                  inflated[idx] = Math.max(inflated[idx], penalty * 0.8);
                }
              }
            }
          }
        }
      }
    }
    return { costs: inflated, width, height };
  }

  return { costs, width, height };
}

// ── Skeletonization (Zhang-Suen thinning) ────────────────────
// Operates directly on a binary road mask (1 = road, 0 = not-road) —
// get one via extractRoadMask(seg). No class lookup here; whatever
// binary mask you pass in is what gets thinned.
export function skeletonize(
  binaryMask: Uint8Array,
  w: number,
  h: number,
  thickness: number = 1
): Uint8Array {
  let img = new Uint8Array(binaryMask);

  // Zhang-Suen iterations
  let changed = true;
  while (changed) {
    changed = false;

    // Sub-iteration 1
    const toRemove1: number[] = [];
    // Match v10-ultra's padded Zhang-Suen implementation: boundary pixels
    // must be eligible for removal. Skipping the image border leaves a road
    // that touches the frame attached to its boundary instead of thinning
    // to its centerline.
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (img[y * w + x] !== 1) continue;
        const p = getNeighbors(img, x, y, w);
        const B = countNonZero(p);
        const A = transitions(p);
        if (B >= 2 && B <= 6 && A === 1 &&
          p[0] * p[2] * p[4] === 0 &&
          p[2] * p[4] * p[6] === 0) {
          toRemove1.push(y * w + x);
          changed = true;
        }
      }
    }
    for (const idx of toRemove1) img[idx] = 0;

    // Sub-iteration 2
    const toRemove2: number[] = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (img[y * w + x] !== 1) continue;
        const p = getNeighbors(img, x, y, w);
        const B = countNonZero(p);
        const A = transitions(p);
        if (B >= 2 && B <= 6 && A === 1 &&
          p[0] * p[2] * p[6] === 0 &&
          p[0] * p[4] * p[6] === 0) {
          toRemove2.push(y * w + x);
          changed = true;
        }
      }
    }
    for (const idx of toRemove2) img[idx] = 0;
  }

  // Apply thickness by dilation
  if (thickness > 1) {
    const thickened = dilateRaw(img, w, h, thickness);
    return thickened as unknown as Uint8Array;
  }

  return img;
}

function getNeighbors(img: Uint8Array, x: number, y: number, w: number): number[] {
  const h = img.length / w;
  const at = (nx: number, ny: number): number =>
    nx >= 0 && nx < w && ny >= 0 && ny < h ? img[ny * w + nx] : 0;
  return [
    at(x, y - 1),     // P2
    at(x + 1, y - 1), // P3
    at(x + 1, y),     // P4
    at(x + 1, y + 1), // P5
    at(x, y + 1),     // P6
    at(x - 1, y + 1), // P7
    at(x - 1, y),     // P8
    at(x - 1, y - 1), // P9
  ];
}

function countNonZero(p: number[]): number {
  return p.reduce((s, v) => s + (v ? 1 : 0), 0);
}

function transitions(p: number[]): number {
  let count = 0;
  for (let i = 0; i < 8; i++) {
    if (p[i] === 0 && p[(i + 1) % 8] === 1) count++;
  }
  return count;
}

function dilateRaw(img: Uint8Array, w: number, h: number, radius: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (img[y * w + x] === 1) {
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            const ny = y + dy, nx = x + dx;
            if (ny >= 0 && ny < h && nx >= 0 && nx < w) {
              out[ny * w + nx] = 1;
            }
          }
        }
      }
    }
  }
  return out;
}

// ── Skeleton longest-path (tree diameter via double-BFS) ─────
// Mirrors v10ultra core/skeleton_goal.py's main_branch(): find the
// point farthest from an arbitrary skeleton pixel, then the point
// farthest from THAT one -- the two ends of the tree diameter -- then
// walk the parent chain back between them. This gives the full-length
// centerline path through the road, not just a nearest-pixel guess.
export function skeletonMainBranch(skel: Uint8Array, w: number, _h: number): Point[] {
  const ptSet = new Set<number>();
  let first = -1;
  for (let i = 0; i < skel.length; i++) {
    if (skel[i] === 1) {
      ptSet.add(i);
      if (first === -1) first = i;
    }
  }
  if (first === -1) return [];

  const offs = [-w - 1, -w, -w + 1, -1, 1, w - 1, w, w + 1];

  function bfsFarthest(src: number): { last: number; parent: Map<number, number> } {
    const parent = new Map<number, number>();
    parent.set(src, -1);
    const queue: number[] = [src];
    let qh = 0;
    let last = src;
    while (qh < queue.length) {
      const cur = queue[qh++];
      last = cur;
      const cx = cur % w;
      for (const off of offs) {
        const nb = cur + off;
        if (!ptSet.has(nb) || parent.has(nb)) continue;
        const nx = nb % w;
        if (Math.abs(nx - cx) > 1) continue; // guard against row wraparound
        parent.set(nb, cur);
        queue.push(nb);
      }
    }
    return { last, parent };
  }

  const { last: a } = bfsFarthest(first);
  const { last: b, parent } = bfsFarthest(a);

  const path: Point[] = [];
  let cur = b;
  while (cur !== -1) {
    path.push({ x: cur % w, y: Math.floor(cur / w) });
    cur = parent.get(cur)!;
  }
  return path;
}

// ── A* Pathfinding ───────────────────────────────────────────
export function astar(
  costmap: CostmapResult,
  start: Point,
  end: Point,
  onExplore?: (p: Point) => void
): PathResult {
  const { costs, width, height } = costmap;
  const explored: Point[] = [];

  const key = (x: number, y: number) => y * width + x;
  const gScore = new Map<number, number>();
  const fScore = new Map<number, number>();
  const cameFrom = new Map<number, number>();

  const startKey = key(start.x, start.y);
  const endKey = key(end.x, end.y);

  gScore.set(startKey, 0);
  fScore.set(startKey, heuristic(start, end)); // was set on endKey -- inert (never read before being
                                                // overwritten on real expansion) but wrong as written

  // Simple priority queue (array-based for clarity)
  const openSet: number[] = [startKey];
  const inOpen = new Set<number>([startKey]);
  const closed = new Set<number>();

  const dirs = [
    [-1, 0], [1, 0], [0, -1], [0, 1],
    [-1, -1], [-1, 1], [1, -1], [1, 1],
  ];

  while (openSet.length > 0) {
    // Find node with lowest fScore
    let bestIdx = 0;
    let bestF = fScore.get(openSet[0]) ?? Infinity;
    for (let i = 1; i < openSet.length; i++) {
      const f = fScore.get(openSet[i]) ?? Infinity;
      if (f < bestF) { bestF = f; bestIdx = i; }
    }

    const current = openSet[bestIdx];
    openSet.splice(bestIdx, 1);
    inOpen.delete(current);

    const cx = current % width;
    const cy = Math.floor(current / width);

    if (current === endKey) {
      // Reconstruct path
      const path: Point[] = [];
      let cur = endKey;
      while (cur !== startKey) {
        path.push({ x: cur % width, y: Math.floor(cur / width) });
        cur = cameFrom.get(cur)!;
      }
      path.push(start);
      path.reverse();

      let totalCost = 0;
      for (const p of path) totalCost += costs[p.y * width + p.x];

      return { path, explored, cost: totalCost };
    }

    closed.add(current);
    explored.push({ x: cx, y: cy });
    if (onExplore) onExplore({ x: cx, y: cy });

    for (const [dx, dy] of dirs) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;

      const nk = key(nx, ny);
      if (closed.has(nk)) continue;

      const moveCost = Math.abs(dx) + Math.abs(dy) > 1 ? 1.414 : 1.0;
      const cellCost = costs[ny * width + nx];
      if (cellCost >= 0.95) continue; // impassable

      const tentG = (gScore.get(current) ?? Infinity) + moveCost * (1 + cellCost * 5);

      if (tentG < (gScore.get(nk) ?? Infinity)) {
        cameFrom.set(nk, current);
        gScore.set(nk, tentG);
        fScore.set(nk, tentG + heuristic({ x: nx, y: ny }, end));

        if (!inOpen.has(nk)) {
          openSet.push(nk);
          inOpen.add(nk);
        }
      }
    }
  }

  return { path: [], explored, cost: Infinity };
}

// ── Dijkstra Pathfinding ─────────────────────────────────────
export function dijkstra(
  costmap: CostmapResult,
  start: Point,
  end: Point
): PathResult {
  const { costs, width, height } = costmap;
  const explored: Point[] = [];
  const key = (x: number, y: number) => y * width + x;

  const dist = new Map<number, number>();
  const cameFrom = new Map<number, number>();
  const startKey = key(start.x, start.y);
  const endKey = key(end.x, end.y);

  dist.set(startKey, 0);
  const openSet: number[] = [startKey];
  const visited = new Set<number>();

  const dirs = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]];

  while (openSet.length > 0) {
    let bestIdx = 0;
    let bestD = dist.get(openSet[0]) ?? Infinity;
    for (let i = 1; i < openSet.length; i++) {
      const d = dist.get(openSet[i]) ?? Infinity;
      if (d < bestD) { bestD = d; bestIdx = i; }
    }

    const current = openSet[bestIdx];
    openSet.splice(bestIdx, 1);

    if (visited.has(current)) continue;
    visited.add(current);

    const cx = current % width;
    const cy = Math.floor(current / width);
    explored.push({ x: cx, y: cy });

    if (current === endKey) {
      const path: Point[] = [];
      let cur = endKey;
      while (cur !== startKey) {
        path.push({ x: cur % width, y: Math.floor(cur / width) });
        cur = cameFrom.get(cur)!;
      }
      path.push(start);
      path.reverse();
      let totalCost = 0;
      for (const p of path) totalCost += costs[p.y * width + p.x];
      return { path, explored, cost: totalCost };
    }

    for (const [dx, dy] of dirs) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const nk = key(nx, ny);
      if (visited.has(nk)) continue;
      const cellCost = costs[ny * width + nx];
      if (cellCost >= 0.95) continue;
      const moveCost = Math.abs(dx) + Math.abs(dy) > 1 ? 1.414 : 1.0;
      const tentD = (dist.get(current) ?? Infinity) + moveCost * (1 + cellCost * 5);
      if (tentD < (dist.get(nk) ?? Infinity)) {
        dist.set(nk, tentD);
        cameFrom.set(nk, current);
        openSet.push(nk);
      }
    }
  }
  return { path: [], explored, cost: Infinity };
}

function heuristic(a: Point, b: Point): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

// ── Rendering Helpers ────────────────────────────────────────
export function renderSegmentation(
  ctx: CanvasRenderingContext2D,
  seg: SegmentationResult,
  alpha: number = 0.7
): void {
  const imgData = ctx.createImageData(seg.width, seg.height);
  for (let i = 0; i < seg.width * seg.height; i++) {
    const cls = seg.mask[i];
    const [r, g, b] = CLASS_COLORS[cls] || [128, 128, 128];
    imgData.data[i * 4] = r;
    imgData.data[i * 4 + 1] = g;
    imgData.data[i * 4 + 2] = b;
    imgData.data[i * 4 + 3] = Math.round(alpha * 255);
  }
  ctx.putImageData(imgData, 0, 0);
}

// Renders a binary road/free-space mask (from extractRoadMask), as
// opposed to renderSegmentation which paints the full 12-class palette.
export function renderBinaryMask(
  ctx: CanvasRenderingContext2D,
  binaryMask: Uint8Array,
  width: number,
  height: number,
  roadColor: [number, number, number] = [100, 60, 180],
  alpha: number = 0.75
): void {
  const imgData = ctx.createImageData(width, height);
  for (let i = 0; i < width * height; i++) {
    const isRoad = binaryMask[i] === 1;
    const [r, g, b] = isRoad ? roadColor : [15, 15, 20];
    imgData.data[i * 4] = r;
    imgData.data[i * 4 + 1] = g;
    imgData.data[i * 4 + 2] = b;
    imgData.data[i * 4 + 3] = Math.round((isRoad ? alpha : alpha * 0.4) * 255);
  }
  ctx.putImageData(imgData, 0, 0);
}

export function renderCostmap(
  ctx: CanvasRenderingContext2D,
  costmap: CostmapResult
): void {
  const imgData = ctx.createImageData(costmap.width, costmap.height);
  for (let i = 0; i < costmap.width * costmap.height; i++) {
    const c = costmap.costs[i];
    // Cool gradient: blue(free) -> yellow(moderate) -> red(obstacle)
    let r: number, g: number, b: number;
    if (c < 0.5) {
      const t = c * 2;
      r = Math.round(t * 255);
      g = Math.round(t * 200);
      b = Math.round((1 - t) * 180);
    } else {
      const t = (c - 0.5) * 2;
      r = Math.round(200 + t * 55);
      g = Math.round(200 * (1 - t));
      b = 0;
    }
    imgData.data[i * 4] = r;
    imgData.data[i * 4 + 1] = g;
    imgData.data[i * 4 + 2] = b;
    imgData.data[i * 4 + 3] = 230;
  }
  ctx.putImageData(imgData, 0, 0);
}

export function renderSkeleton(
  ctx: CanvasRenderingContext2D,
  skeleton: Uint8Array,
  w: number,
  h: number,
  color: string = '#22d3ee'
): void {
  ctx.fillStyle = color;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (skeleton[y * w + x] === 1) {
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
}

export function renderPath(
  ctx: CanvasRenderingContext2D,
  path: Point[],
  color: string = '#22d3ee',
  lineWidth: number = 2
): void {
  if (path.length < 2) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(path[0].x, path[0].y);
  for (let i = 1; i < path.length; i++) {
    ctx.lineTo(path[i].x, path[i].y);
  }
  ctx.stroke();
}

export function renderExplored(
  ctx: CanvasRenderingContext2D,
  explored: Point[],
  maxCount: number = explored.length,
  color: string = 'rgba(6, 182, 212, 0.15)'
): void {
  ctx.fillStyle = color;
  const count = Math.min(maxCount, explored.length);
  for (let i = 0; i < count; i++) {
    ctx.fillRect(explored[i].x, explored[i].y, 1, 1);
  }
}

// ── Generate sample aerial image on canvas ───────────────────
export function generateSampleAerial(w: number, h: number): ImageData {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  // Sky gradient (top)
  const skyGrad = ctx.createLinearGradient(0, 0, 0, h * 0.35);
  skyGrad.addColorStop(0, '#87CEEB');
  skyGrad.addColorStop(1, '#B0D4E8');
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, w, h * 0.35);

  // Ground base
  ctx.fillStyle = '#6B7B3A';
  ctx.fillRect(0, h * 0.3, w, h * 0.7);

  // Road (main path)
  ctx.fillStyle = '#888888';
  ctx.beginPath();
  ctx.moveTo(w * 0.4, h);
  ctx.lineTo(w * 0.55, h);
  ctx.lineTo(w * 0.5, h * 0.35);
  ctx.lineTo(w * 0.42, h * 0.35);
  ctx.fill();

  // Road curve
  ctx.beginPath();
  ctx.moveTo(w * 0.42, h * 0.4);
  ctx.quadraticCurveTo(w * 0.2, h * 0.45, w * 0.1, h * 0.55);
  ctx.lineTo(0, h * 0.55);
  ctx.lineTo(0, h * 0.48);
  ctx.quadraticCurveTo(w * 0.15, h * 0.38, w * 0.45, h * 0.35);
  ctx.fill();

  // Secondary road
  ctx.fillStyle = '#7a7a7a';
  ctx.beginPath();
  ctx.moveTo(w * 0.5, h * 0.5);
  ctx.lineTo(w, h * 0.6);
  ctx.lineTo(w, h * 0.67);
  ctx.lineTo(w * 0.48, h * 0.56);
  ctx.fill();

  // Buildings
  const buildings = [
    { x: 0.05, y: 0.55, bw: 0.12, bh: 0.15 },
    { x: 0.7, y: 0.35, bw: 0.15, bh: 0.12 },
    { x: 0.8, y: 0.7, bw: 0.1, bh: 0.18 },
    { x: 0.15, y: 0.7, bw: 0.08, bh: 0.1 },
    { x: 0.6, y: 0.75, bw: 0.12, bh: 0.08 },
  ];
  for (const b of buildings) {
    ctx.fillStyle = `rgb(${160 + Math.random() * 40}, ${120 + Math.random() * 30}, ${80 + Math.random() * 20})`;
    ctx.fillRect(b.x * w, b.y * h, b.bw * w, b.bh * h);
    // Roof line
    ctx.fillStyle = `rgb(${100 + Math.random() * 30}, ${80 + Math.random() * 20}, ${60 + Math.random() * 20})`;
    ctx.fillRect(b.x * w, b.y * h, b.bw * w, 3);
  }

  // Trees (circles of green)
  const treePositions = [
    [0.25, 0.6], [0.3, 0.65], [0.35, 0.75], [0.65, 0.5],
    [0.58, 0.42], [0.08, 0.42], [0.9, 0.5], [0.75, 0.55],
    [0.4, 0.8], [0.2, 0.85], [0.55, 0.85], [0.85, 0.9],
    [0.3, 0.45], [0.7, 0.48], [0.12, 0.38],
  ];
  for (const [tx, ty] of treePositions) {
    const radius = 6 + Math.random() * 8;
    const gVal = 80 + Math.random() * 60;
    ctx.fillStyle = `rgb(${20 + Math.random() * 30}, ${gVal}, ${15 + Math.random() * 20})`;
    ctx.beginPath();
    ctx.arc(tx * w, ty * h, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  // Dark obstacles
  ctx.fillStyle = '#2a2a30';
  ctx.fillRect(w * 0.32, h * 0.62, 12, 12);
  ctx.fillRect(w * 0.62, h * 0.38, 8, 8);

  // Add some noise
  const imgData = ctx.getImageData(0, 0, w, h);
  for (let i = 0; i < imgData.data.length; i += 4) {
    const noise = (Math.random() - 0.5) * 12;
    imgData.data[i] = Math.max(0, Math.min(255, imgData.data[i] + noise));
    imgData.data[i + 1] = Math.max(0, Math.min(255, imgData.data[i + 1] + noise));
    imgData.data[i + 2] = Math.max(0, Math.min(255, imgData.data[i + 2] + noise));
  }

  return imgData;
}

// ── Flight telemetry generation ──────────────────────────────
export interface TelemetryFrame {
  t: number;
  altitude: number;
  speed: number;
  battery: number;
  lat: number;
  lng: number;
  heading: number;
  roll: number;
  pitch: number;
  mode: string;
  decision: string;
}

export function generateFlightLog(path: Point[], duration: number = 120): TelemetryFrame[] {
  const frames: TelemetryFrame[] = [];
  const fps = 10;
  const totalFrames = duration * fps;
  const modes = ['GUIDED', 'AUTO', 'LOITER', 'RTL'];
  const decisions = [
    'Following planned path',
    'Obstacle detected — rerouting',
    'Clear corridor ahead',
    'Descending to waypoint altitude',
    'Crosswind compensation active',
    'Terrain following engaged',
    'GPS signal strong — 12 sats',
    'Visual odometry active',
  ];

  for (let i = 0; i < totalFrames; i++) {
    const t = i / fps;
    const progress = i / totalFrames;
    const pathIdx = Math.min(Math.floor(progress * path.length), path.length - 1);
    const pos = path[pathIdx] || { x: 0, y: 0 };

    frames.push({
      t,
      altitude: 50 + Math.sin(t * 0.1) * 5 + Math.random() * 2,
      speed: 8 + Math.sin(t * 0.3) * 3 + Math.random(),
      battery: 100 - progress * 35 + Math.random() * 0.5,
      lat: 37.7749 + pos.y * 0.0001,
      lng: -122.4194 + pos.x * 0.0001,
      heading: (Math.atan2(
        (path[Math.min(pathIdx + 1, path.length - 1)]?.y ?? pos.y) - pos.y,
        (path[Math.min(pathIdx + 1, path.length - 1)]?.x ?? pos.x) - pos.x
      ) * 180 / Math.PI + 360) % 360,
      roll: Math.sin(t * 0.5) * 5 + Math.random() * 2,
      pitch: Math.cos(t * 0.3) * 3 + Math.random(),
      mode: modes[Math.floor(progress * 3) % modes.length],
      decision: decisions[Math.floor(t * 0.5) % decisions.length],
    });
  }

  return frames;
}
