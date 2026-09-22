// ============================================================
// Occlusion-Recovery Playground
// Original theory: altitude-increase + heading-continuity
// bridging when the road disappears from frame.
// Proposed at Dr. Mishra's Q&A session.
//
// The user drags a black "occlusion" rectangle over the costmap.
// A* treats occluded cells as "unknown" (moderate traversal cost)
// instead of "obstacle" (impassable), using last-known heading
// to bias exploration through the occluded region.
// ============================================================

import { useState, useRef, useCallback, useEffect } from 'react';
import { Eye, EyeOff, RotateCcw, Play, Info, Lightbulb } from 'lucide-react';
import AnimatedSection from './AnimatedSection';
import {
  heuristicSegmentation,
  extractRoadMask,
  generateCostmap,
  renderCostmap,
  renderPath,
  renderExplored,
  generateSampleAerial,
  ROAD_CLASS,
  type SegmentationResult,
  type CostmapResult,
  type PathResult,
  type Point,
} from '../engine/algorithms';
interface OcclusionRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const OW = 360;
const OH = 270;

// Cost assigned to occluded ("unknown") cells — traversable but penalized
const UNKNOWN_COST = 0.35;

export default function OcclusionRecovery() {
  const [occlusion, setOcclusion] = useState<OcclusionRect>({
    x: OW * 0.3, y: OH * 0.35, w: OW * 0.35, h: OH * 0.2,
  });
  const [isDragging, setIsDragging] = useState(false);
  const [dragMode, setDragMode] = useState<'move' | 'resize'>('move');
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [headingBias, setHeadingBias] = useState(0.6);
  const [altitudeGain, setAltitudeGain] = useState(10);
  const [unknownCost, setUnknownCost] = useState(UNKNOWN_COST);
  const [showOcclusion, setShowOcclusion] = useState(true);
  const [occlusionEnabled, setOcclusionEnabled] = useState(true);

  const [, setPathWithOcclusion] = useState<PathResult | null>(null);
  const [, setPathWithout] = useState<PathResult | null>(null);
  const [stats, setStats] = useState({
    nodesExploredWith: 0,
    nodesExploredWithout: 0,
    pathLenWith: 0,
    pathLenWithout: 0,
    costWith: 0,
    costWithout: 0,
    recovered: false,
    headingDeviation: 0,
  });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const segRef = useRef<SegmentationResult | null>(null);
  const costRef = useRef<CostmapResult | null>(null);
  const imageRef = useRef<ImageData | null>(null);

  // Initialize
  const initScene = useCallback(() => {
    const imgData = generateSampleAerial(OW, OH);
    imageRef.current = imgData;
    const seg = heuristicSegmentation(imgData, 0.5);
    segRef.current = seg;
    const roadMask = extractRoadMask(seg);
    const cm = generateCostmap(roadMask, OW, OH, 5);
    costRef.current = cm;
  }, []);

  useEffect(() => { initScene(); }, [initScene]);

  // ── Run A* with and without occlusion ──────────────────────
  const runComparison = useCallback(() => {
    if (!segRef.current || !costRef.current) return;
    const seg = segRef.current;
    const baseCost = costRef.current;

    // Find start/end
    const start = findRoad(seg, 'bottom');
    const end = findRoad(seg, 'top');

    // 1. Path WITHOUT occlusion (baseline)
    const baseline = astarWithHeadingBias(baseCost, start, end, 0, null);
    setPathWithout(baseline);

    // 2. Create modified costmap with occlusion zone
    const occCosts = new Float32Array(baseCost.costs);
    if (occlusionEnabled) {
      const ox = Math.round(occlusion.x);
      const oy = Math.round(occlusion.y);
      const ow = Math.round(occlusion.w);
      const oh = Math.round(occlusion.h);

      for (let dy = 0; dy < oh; dy++) {
        for (let dx = 0; dx < ow; dx++) {
          const px = ox + dx;
          const py = oy + dy;
          if (px >= 0 && px < OW && py >= 0 && py < OH) {
            // Mark as "unknown" — NOT as obstacle
            occCosts[py * OW + px] = unknownCost;
          }
        }
      }
    }
    const occCostmap: CostmapResult = { costs: occCosts, width: OW, height: OH };

    // 3. Path WITH occlusion — using heading-continuity bias
    const withOcc = astarWithHeadingBias(
      occCostmap, start, end, headingBias, baseline.path.length > 5 ? baseline.path : null
    );
    setPathWithOcclusion(withOcc);

    // 4. Compute stats
    const recovered = withOcc.path.length > 0;
    let headingDev = 0;
    if (recovered && baseline.path.length > 0) {
      const midBaseline = baseline.path[Math.floor(baseline.path.length / 2)];
      const midOcc = withOcc.path[Math.floor(withOcc.path.length / 2)];
      headingDev = Math.sqrt((midBaseline.x - midOcc.x) ** 2 + (midBaseline.y - midOcc.y) ** 2);
    }

    setStats({
      nodesExploredWith: withOcc.explored.length,
      nodesExploredWithout: baseline.explored.length,
      pathLenWith: withOcc.path.length,
      pathLenWithout: baseline.path.length,
      costWith: withOcc.cost,
      costWithout: baseline.cost,
      recovered,
      headingDeviation: headingDev,
    });

    // 5. Render
    renderScene(occCostmap, baseline, withOcc, start, end);
  }, [occlusion, headingBias, unknownCost, occlusionEnabled, showOcclusion]);

  useEffect(() => {
    runComparison();
  }, [runComparison]);

  // ── Render ─────────────────────────────────────────────────
  const renderScene = useCallback((
    costmap: CostmapResult, baseline: PathResult, withOcc: PathResult,
    start: Point, end: Point
  ) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    canvas.width = OW;
    canvas.height = OH;

    // Draw costmap
    renderCostmap(ctx, costmap);

    // Draw occlusion zone
    if (showOcclusion && occlusionEnabled) {
      const ox = Math.round(occlusion.x);
      const oy = Math.round(occlusion.y);
      const ow = Math.round(occlusion.w);
      const oh = Math.round(occlusion.h);

      // Occluded area with scan lines
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(ox, oy, ow, oh);

      // Scan-line hatching
      ctx.strokeStyle = 'rgba(255, 100, 100, 0.25)';
      ctx.lineWidth = 0.5;
      for (let i = 0; i < ow + oh; i += 4) {
        ctx.beginPath();
        ctx.moveTo(ox + i, oy);
        ctx.lineTo(ox, oy + i);
        ctx.stroke();
      }

      // Border
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.6)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(ox, oy, ow, oh);
      ctx.setLineDash([]);

      // Label
      ctx.fillStyle = 'rgba(239, 68, 68, 0.8)';
      ctx.font = '9px "JetBrains Mono", monospace';
      ctx.fillText('OCCLUDED', ox + 4, oy + 12);
      ctx.fillStyle = 'rgba(239, 68, 68, 0.5)';
      ctx.fillText(`cost=${unknownCost.toFixed(2)}`, ox + 4, oy + 22);

      // Resize handle
      ctx.fillStyle = 'rgba(239, 68, 68, 0.5)';
      ctx.fillRect(ox + ow - 8, oy + oh - 8, 8, 8);
    }

    // Draw explored cells for occluded path (faint)
    if (withOcc.explored.length > 0) {
      renderExplored(ctx, withOcc.explored, withOcc.explored.length, 'rgba(6,182,212,0.06)');
    }

    // Draw baseline path (dimmer, dashed)
    if (baseline.path.length > 1) {
      ctx.strokeStyle = 'rgba(156, 163, 175, 0.4)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(baseline.path[0].x, baseline.path[0].y);
      for (let i = 1; i < baseline.path.length; i++) {
        ctx.lineTo(baseline.path[i].x, baseline.path[i].y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Draw recovery path (bright cyan)
    renderPath(ctx, withOcc.path, '#22d3ee', 2.5);

    // Heading-continuity arrows in occlusion zone
    if (occlusionEnabled && withOcc.path.length > 2) {
      const enterIdx = withOcc.path.findIndex(
        p => p.x >= occlusion.x && p.x <= occlusion.x + occlusion.w &&
             p.y >= occlusion.y && p.y <= occlusion.y + occlusion.h
      );
      if (enterIdx > 0) {
        const pre = withOcc.path[enterIdx - 1];
        const at = withOcc.path[enterIdx];
        const heading = Math.atan2(at.y - pre.y, at.x - pre.x);

        // Draw heading arrow
        ctx.save();
        ctx.translate(at.x, at.y);
        ctx.rotate(heading);
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(15, 0);
        ctx.lineTo(12, -3);
        ctx.moveTo(15, 0);
        ctx.lineTo(12, 3);
        ctx.stroke();
        ctx.restore();

        // Label
        ctx.fillStyle = '#f59e0b';
        ctx.font = '8px "JetBrains Mono", monospace';
        ctx.fillText(`heading: ${(heading * 180 / Math.PI).toFixed(0)}°`, at.x + 18, at.y + 3);
      }
    }

    // Start / End markers
    ctx.fillStyle = '#22c55e';
    ctx.beginPath();
    ctx.arc(start.x, start.y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.arc(end.x, end.y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Altitude-increase indicator
    if (occlusionEnabled && altitudeGain > 0) {
      ctx.fillStyle = 'rgba(96, 165, 250, 0.7)';
      ctx.font = '8px "JetBrains Mono", monospace';
      ctx.fillText(`↑ ALT +${altitudeGain}m (expand FoV)`, OW - 130, 12);
    }
  }, [occlusion, showOcclusion, occlusionEnabled, unknownCost, altitudeGain]);

  // ── Mouse handlers for dragging occlusion rect ─────────────
  const getCanvasPos = (e: React.MouseEvent): { x: number; y: number } => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (OW / rect.width),
      y: (e.clientY - rect.top) * (OH / rect.height),
    };
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    const pos = getCanvasPos(e);
    const ox = occlusion.x;
    const oy = occlusion.y;
    const ow = occlusion.w;
    const oh = occlusion.h;

    // Check if near resize handle (bottom-right corner)
    if (pos.x >= ox + ow - 12 && pos.y >= oy + oh - 12 && pos.x <= ox + ow + 4 && pos.y <= oy + oh + 4) {
      setDragMode('resize');
    } else if (pos.x >= ox && pos.x <= ox + ow && pos.y >= oy && pos.y <= oy + oh) {
      setDragMode('move');
    } else {
      return;
    }
    setIsDragging(true);
    setDragStart({ x: pos.x - ox, y: pos.y - oy });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    const pos = getCanvasPos(e);

    if (dragMode === 'move') {
      setOcclusion(prev => ({
        ...prev,
        x: Math.max(0, Math.min(OW - prev.w, pos.x - dragStart.x)),
        y: Math.max(0, Math.min(OH - prev.h, pos.y - dragStart.y)),
      }));
    } else {
      setOcclusion(prev => ({
        ...prev,
        w: Math.max(20, Math.min(OW - prev.x, pos.x - prev.x)),
        h: Math.max(15, Math.min(OH - prev.y, pos.y - prev.y)),
      }));
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  return (
    <section id="occlusion" className="relative py-24 sm:py-32">
      <div className="absolute inset-0 grid-bg opacity-30" />
      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-12">
          <AnimatedSection>
            <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-amber-400 mb-4">
              <Lightbulb className="w-3.5 h-3.5" />
              Original Research — Proposed at Dr. Mishra's Q&A
            </span>
          </AnimatedSection>
          <AnimatedSection delay={0.1}>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight mb-4">
              <span className="text-white">Occlusion </span>
              <span className="gradient-text">Recovery</span>
            </h2>
          </AnimatedSection>
          <AnimatedSection delay={0.2}>
            <p className="text-lg text-gray-400">
              When the road disappears from the camera frame, the drone doesn't stop.
              It increases altitude to expand field-of-view and bridges the gap using{' '}
              <span className="text-amber-400 font-medium">heading-continuity</span> — treating
              occluded regions as "unknown" instead of "obstacle." Drag the black rectangle to simulate
              occlusion and watch A* recover in real-time.
            </p>
          </AnimatedSection>
        </div>

        <AnimatedSection delay={0.3}>
          <div className="glass rounded-2xl border border-white/10 overflow-hidden">
            <div className="p-4 sm:p-6 lg:p-8">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Canvas */}
                <div className="lg:col-span-2">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                    <span className="text-xs font-mono text-gray-400">Occlusion Recovery Costmap</span>
                    <span className="ml-auto text-[10px] text-gray-600">
                      Drag the red rectangle · Resize from bottom-right corner
                    </span>
                  </div>
                  <div
                    className="relative rounded-xl overflow-hidden border border-white/[0.06] bg-black cursor-crosshair select-none"
                    style={{ aspectRatio: `${OW}/${OH}` }}
                  >
                    <canvas
                      ref={canvasRef}
                      width={OW}
                      height={OH}
                      className="w-full h-full"
                      style={{ imageRendering: 'auto' }}
                      onMouseDown={handleMouseDown}
                      onMouseMove={handleMouseMove}
                      onMouseUp={handleMouseUp}
                      onMouseLeave={handleMouseUp}
                    />
                  </div>

                  {/* Legend */}
                  <div className="flex flex-wrap items-center gap-4 mt-3 text-[10px] text-gray-500">
                    <span className="flex items-center gap-1.5">
                      <span className="w-3 h-1 rounded bg-gray-400 opacity-50" style={{ borderTop: '1px dashed #9ca3af' }} />
                      Baseline path
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="w-3 h-1 rounded bg-cyan-400" />
                      Recovery path
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="w-3 h-1 rounded bg-red-500 opacity-60" style={{ border: '1px dashed #ef4444' }} />
                      Occlusion zone
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-amber-500" />
                      Heading arrow
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-green-500" />
                      Start
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-red-500" />
                      Goal
                    </span>
                  </div>
                </div>

                {/* Controls & Stats */}
                <div className="space-y-4">
                  {/* Theory card */}
                  <div className="p-4 rounded-xl border border-amber-500/20 bg-amber-500/[0.04]">
                    <div className="flex items-start gap-2 mb-2">
                      <Info className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
                      <div>
                        <h4 className="text-xs font-semibold text-amber-300 mb-1">Recovery Theory</h4>
                        <p className="text-[10px] text-gray-400 leading-relaxed">
                          When the segmentation model loses road visibility (e.g. tree canopy, shadow, sensor failure),
                          the system: <strong className="text-amber-300">①</strong> increases altitude by{' '}
                          <span className="text-amber-300">{altitudeGain}m</span> to expand camera FoV,{' '}
                          <strong className="text-amber-300">②</strong> treats occluded pixels as "unknown"
                          (cost={unknownCost.toFixed(2)}) instead of "obstacle" (cost=1.0),{' '}
                          <strong className="text-amber-300">③</strong> biases A* search toward last-known heading
                          (bias={headingBias.toFixed(2)}).
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Toggles */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => setOcclusionEnabled(!occlusionEnabled)}
                      className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 text-xs font-medium rounded-lg border transition-all ${
                        occlusionEnabled
                          ? 'border-red-500/40 bg-red-500/10 text-red-300'
                          : 'border-white/[0.06] text-gray-500'
                      }`}
                    >
                      {occlusionEnabled ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      {occlusionEnabled ? 'Occluding' : 'No Occl.'}
                    </button>
                    <button
                      onClick={() => setShowOcclusion(!showOcclusion)}
                      className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 text-xs font-medium rounded-lg border transition-all ${
                        showOcclusion
                          ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300'
                          : 'border-white/[0.06] text-gray-500'
                      }`}
                    >
                      <Eye className="w-3.5 h-3.5" />
                      Overlay
                    </button>
                  </div>

                  {/* Parameters */}
                  <div className="space-y-3">
                    <ParamRow
                      label="Heading Bias"
                      value={headingBias}
                      min={0} max={1.5} step={0.05}
                      onChange={setHeadingBias}
                      format={v => v.toFixed(2)}
                      help="How strongly A* favors last-known heading in occlusion"
                    />
                    <ParamRow
                      label="Unknown Cost"
                      value={unknownCost}
                      min={0.05} max={0.8} step={0.05}
                      onChange={setUnknownCost}
                      format={v => v.toFixed(2)}
                      help="Traversal cost for occluded cells (0=free, 1=blocked)"
                    />
                    <ParamRow
                      label="Altitude Gain"
                      value={altitudeGain}
                      min={0} max={50} step={5}
                      onChange={setAltitudeGain}
                      format={v => `+${v}m`}
                      help="Altitude increase to expand FoV when occlusion detected"
                    />
                  </div>

                  {/* Action buttons */}
                  <div className="flex gap-2">
                    <button
                      onClick={runComparison}
                      className="btn-primary flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold text-white rounded-lg"
                    >
                      <span className="relative z-10 flex items-center gap-2">
                        <Play className="w-3.5 h-3.5" />
                        Replan
                      </span>
                    </button>
                    <button
                      onClick={() => {
                        initScene();
                        setOcclusion({ x: OW * 0.3, y: OH * 0.35, w: OW * 0.35, h: OH * 0.2 });
                        setHeadingBias(0.6);
                        setUnknownCost(UNKNOWN_COST);
                        setAltitudeGain(10);
                      }}
                      className="px-3 py-2.5 text-xs text-gray-500 hover:text-gray-300 border border-white/[0.06] rounded-lg hover:border-white/10 transition-all"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Comparison Stats */}
                  <div className="p-4 rounded-xl border border-white/[0.06] bg-white/[0.02] space-y-2">
                    <h5 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-2">
                      Recovery Analysis
                      {stats.recovered && (
                        <span className="text-green-400 normal-case font-normal">✓ Path recovered</span>
                      )}
                      {!stats.recovered && occlusionEnabled && (
                        <span className="text-red-400 normal-case font-normal">✗ No path found</span>
                      )}
                    </h5>
                    <StatRow label="Baseline path" value={`${stats.pathLenWithout} nodes`} />
                    <StatRow label="Recovery path" value={`${stats.pathLenWith} nodes`} color={stats.recovered ? '#22d3ee' : '#ef4444'} />
                    <StatRow label="Baseline cost" value={stats.costWithout.toFixed(1)} />
                    <StatRow label="Recovery cost" value={stats.costWith === Infinity ? '∞' : stats.costWith.toFixed(1)} color={stats.recovered ? '#22d3ee' : '#ef4444'} />
                    <StatRow label="Cost overhead" value={stats.costWithout > 0 ? `+${((stats.costWith / stats.costWithout - 1) * 100).toFixed(1)}%` : 'N/A'} color="#f59e0b" />
                    <StatRow label="Heading deviation" value={`${stats.headingDeviation.toFixed(1)}px`} />
                    <StatRow label="Nodes explored" value={`${stats.nodesExploredWith} vs ${stats.nodesExploredWithout}`} />
                    <div className="pt-2 border-t border-white/5">
                      <StatRow
                        label="Altitude response"
                        value={occlusionEnabled ? `↑ ${altitudeGain}m` : 'None'}
                        color="#60a5fa"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </AnimatedSection>
      </div>
    </section>
  );
}

// ── A* with Heading-Continuity Bias ──────────────────────────
// Modified A* that biases expansion toward last-known heading
// when traversing unknown (occluded) cells
function astarWithHeadingBias(
  costmap: CostmapResult,
  start: Point,
  end: Point,
  headingBiasWeight: number,
  baselinePath: Point[] | null
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
  fScore.set(startKey, heuristic(start, end));

  const openSet: number[] = [startKey];
  const inOpen = new Set<number>([startKey]);
  const closed = new Set<number>();

  const dirs = [
    [-1, 0], [1, 0], [0, -1], [0, 1],
    [-1, -1], [-1, 1], [1, -1], [1, 1],
  ];

  // Compute baseline heading at each point (for heading-continuity bias)
  let baselineHeadings: Map<number, number> | null = null;
  if (baselinePath && baselinePath.length > 1) {
    baselineHeadings = new Map();
    for (let i = 0; i < baselinePath.length - 1; i++) {
      const p = baselinePath[i];
      const next = baselinePath[i + 1];
      const heading = Math.atan2(next.y - p.y, next.x - p.x);
      baselineHeadings.set(key(p.x, p.y), heading);
    }
  }

  while (openSet.length > 0) {
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

    // Get heading from parent for continuity
    let parentHeading: number | null = null;
    const parentKey = cameFrom.get(current);
    if (parentKey !== undefined) {
      const px = parentKey % width;
      const py = Math.floor(parentKey / width);
      parentHeading = Math.atan2(cy - py, cx - px);
    }

    for (const [dx, dy] of dirs) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;

      const nk = key(nx, ny);
      if (closed.has(nk)) continue;

      const cellCost = costs[ny * width + nx];
      if (cellCost >= 0.95) continue; // impassable obstacle

      const moveCost = Math.abs(dx) + Math.abs(dy) > 1 ? 1.414 : 1.0;

      // Base cost
      let edgeCost = moveCost * (1 + cellCost * 5);

      // Heading-continuity bias: reduce cost for cells that continue
      // the last-known heading direction through unknown zones
      const isUnknown = cellCost > 0.15 && cellCost < 0.5;
      if (isUnknown && parentHeading !== null && headingBiasWeight > 0) {
        const moveHeading = Math.atan2(dy, dx);
        const headingDiff = Math.abs(angleDiff(moveHeading, parentHeading));

        // If moving in a direction consistent with last heading → reward
        // If perpendicular or opposite → penalty
        const headingReward = Math.cos(headingDiff); // +1 for same, -1 for opposite
        edgeCost *= (1 - headingReward * headingBiasWeight * 0.5);
      }

      // Also check baseline heading alignment
      if (isUnknown && baselineHeadings && headingBiasWeight > 0) {
        const bh = baselineHeadings.get(nk);
        if (bh !== undefined) {
          const moveHeading = Math.atan2(dy, dx);
          const alignment = Math.cos(angleDiff(moveHeading, bh));
          edgeCost *= (1 - alignment * headingBiasWeight * 0.3);
        }
      }

      const tentG = (gScore.get(current) ?? Infinity) + edgeCost;

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

function heuristic(a: Point, b: Point): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function angleDiff(a: number, b: number): number {
  let diff = a - b;
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;
  return diff;
}

function findRoad(seg: { mask: Uint8Array; width: number; height: number }, pos: 'top' | 'bottom') {
  const { mask, width, height } = seg;
  const startY = pos === 'bottom' ? height - 1 : 0;
  const endY = pos === 'bottom' ? Math.floor(height * 0.5) : Math.floor(height * 0.5);
  const step = pos === 'bottom' ? -1 : 1;
  for (let y = startY; pos === 'bottom' ? y >= endY : y <= endY; y += step) {
    for (let x = Math.floor(width * 0.2); x < Math.floor(width * 0.8); x++) {
      if (mask[y * width + x] === ROAD_CLASS) return { x, y };
    }
  }
  return pos === 'bottom' ? { x: Math.floor(width * 0.45), y: height - 5 } : { x: Math.floor(width * 0.45), y: 5 };
}

// ── Sub-components ───────────────────────────────────────────
function ParamRow({ label, value, min, max, step, onChange, format, help }: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; format: (v: number) => string; help: string;
}) {
  return (
    <div>
      <div className="flex justify-between items-center mb-1">
        <label className="text-xs text-gray-500" title={help}>{label}</label>
        <span className="text-xs text-amber-400 font-mono">{format(value)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))} className="w-full" />
    </div>
  );
}

function StatRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex justify-between text-xs">
      <span className="text-gray-500">{label}</span>
      <span className="font-mono" style={{ color: color || '#e5e7eb' }}>{value}</span>
    </div>
  );
}
