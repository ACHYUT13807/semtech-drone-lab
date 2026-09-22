import { useState, useRef, useCallback, useEffect, useSyncExternalStore } from 'react';
import { motion } from 'framer-motion';
import { Play, Pause, RotateCcw, Eye } from 'lucide-react';
import AnimatedSection from './AnimatedSection';
import {
  heuristicSegmentation, extractRoadMask, generateCostmap, astar,
  renderSegmentation, renderCostmap, renderPath,
  generateSampleAerial, findConnectedRoadEndpoints,
} from '../engine/algorithms';
import { getPipelineSnapshot, subscribePipelineSnapshot, type PipelineSnapshot } from '../engine/pipelineStore';

type ViewMode = 'rgb' | 'segmentation' | 'costmap' | 'planner' | 'telemetry';

const viewModes: { id: ViewMode; label: string; color: string }[] = [
  { id: 'rgb', label: 'RGB Camera', color: '#9ca3af' },
  { id: 'segmentation', label: 'Segmentation', color: '#8b5cf6' },
  { id: 'costmap', label: 'Costmap', color: '#f59e0b' },
  { id: 'planner', label: 'Planner', color: '#22d3ee' },
  { id: 'telemetry', label: 'PX4 Telemetry', color: '#22c55e' },
];

const SW = 400;
const SH = 300;

export default function DroneSimulation() {
  const [activeView, setActiveView] = useState<ViewMode>('rgb');
  const [isPlaying, setIsPlaying] = useState(false);
  const [, setDronePos] = useState({ x: 0, y: 0 });
  const [frame, setFrame] = useState(0);
  const [speed, setSpeed] = useState(1);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const dataRef = useRef<{
    imgData: ImageData | null;
    seg: ReturnType<typeof heuristicSegmentation> | null;
    costmap: ReturnType<typeof generateCostmap> | null;
    path: ReturnType<typeof astar> | null;
  }>({ imgData: null, seg: null, costmap: null, path: null });

  // Whatever the Pipeline tab last solved (real upload + real path), if
  // anything. null until the user actually runs the Pipeline tab once.
  const pipelineSnapshot = useSyncExternalStore(subscribePipelineSnapshot, getPipelineSnapshot);

  // Loads a real Pipeline result directly -- no recomputation, it was
  // already fully solved there.
  const initializeFromPipeline = useCallback((snap: PipelineSnapshot) => {
    dataRef.current = {
      imgData: snap.imgData,
      seg: snap.seg,
      costmap: snap.costmap,
      path: snap.path,
    };
    setFrame(0);
    setDronePos(snap.path.path[0] ?? { x: 0, y: 0 });
    renderFrame(0);
  }, []);

  // Fallback: no real Pipeline result yet, generate the synthetic demo
  // scene so this section isn't empty for someone who lands here first.
  const initialize = useCallback(() => {
    const imgData = generateSampleAerial(SW, SH);
    const seg = heuristicSegmentation(imgData, 0.5);
    const roadMask = extractRoadMask(seg);
    const cm = generateCostmap(roadMask, SW, SH, 5);

    // start/end from the same connected road blob -- see
    // findConnectedRoadEndpoints in algorithms.ts.
    const { start, end, skeletonPath } = findConnectedRoadEndpoints(seg);
    const astarResult = astar(cm, start, end);
    const pathResult = skeletonPath && skeletonPath.length >= 2
      ? { ...astarResult, path: skeletonPath }
      : astarResult;

    dataRef.current = { imgData, seg, costmap: cm, path: pathResult };
    setFrame(0);
    setDronePos(start);
    renderFrame(0);
  }, []);

  const renderFrame = useCallback((f: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const { imgData, seg, costmap, path } = dataRef.current;
    if (!imgData || !seg || !costmap || !path) return;

    // Use the actual image's dimensions rather than fixed SW/SH -- a
    // real uploaded photo from the Pipeline tab won't necessarily be
    // 400x300 (it's 320x240), only the synthetic fallback scene is.
    const W = imgData.width;
    const H = imgData.height;
    canvas.width = W;
    canvas.height = H;

    const pathLen = path.path.length;
    const pathIdx = Math.min(f, pathLen - 1);
    const pos = path.path[pathIdx] || { x: W / 2, y: H / 2 };

    // fix: was always `f * 3` -- a fixed spin per frame with no relation
    // to the actual path, so the drone looked like it was spinning in
    // place instead of turning to face the direction it's flying.
    const headingDeg = computeHeadingDeg(path.path, pathIdx);

    switch (activeView) {
      case 'rgb':
        ctx.putImageData(imgData, 0, 0);
        drawPathOverlay(ctx, path.path, pathIdx);
        drawDrone(ctx, pos.x, pos.y, headingDeg);
        // HUD overlay
        drawHUD(ctx, pos, f, pathLen, 'RGB FEED');
        break;

      case 'segmentation':
        renderSegmentation(ctx, seg, 1.0);
        drawPathOverlay(ctx, path.path, pathIdx);
        drawDrone(ctx, pos.x, pos.y, headingDeg);
        drawHUD(ctx, pos, f, pathLen, 'SEMANTIC');
        break;

      case 'costmap':
        renderCostmap(ctx, costmap);
        drawPathOverlay(ctx, path.path, pathIdx);
        drawDrone(ctx, pos.x, pos.y, headingDeg);
        drawHUD(ctx, pos, f, pathLen, 'COSTMAP');
        break;

      case 'planner':
        renderCostmap(ctx, costmap);
        drawPathOverlay(ctx, path.path, pathIdx);
        drawDrone(ctx, pos.x, pos.y, headingDeg);
        drawHUD(ctx, pos, f, pathLen, 'PLANNER');
        break;

      case 'telemetry':
        ctx.fillStyle = '#0a0a0f';
        ctx.fillRect(0, 0, W, H);
        drawTelemetry(ctx, pos, f, pathLen, headingDeg);
        break;
    }

    setDronePos(pos);
  }, [activeView]);

  // Animation loop
  useEffect(() => {
    if (!isPlaying) {
      cancelAnimationFrame(animRef.current);
      return;
    }

    const pathLen = dataRef.current.path?.path.length || 1;
    let lastTime = 0;
    let accum = 0;

    const tick = (time: number) => {
      const dt = lastTime ? time - lastTime : 0;
      lastTime = time;
      accum += dt;

      if (accum > 50 / speed) {
        accum = 0;
        setFrame(prev => {
          const next = prev + 1;
          if (next >= pathLen) {
            setIsPlaying(false);
            return prev;
          }
          renderFrame(next);
          return next;
        });
      }

      animRef.current = requestAnimationFrame(tick);
    };

    animRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animRef.current);
  }, [isPlaying, speed, renderFrame]);

  // Re-render on view change
  useEffect(() => {
    renderFrame(frame);
  }, [activeView, frame, renderFrame]);

  // Load whenever a Pipeline result arrives/changes; otherwise fall back
  // to the synthetic demo scene. Runs on mount too (snapshot may already
  // exist from an earlier Pipeline run).
  useEffect(() => {
    if (pipelineSnapshot) {
      initializeFromPipeline(pipelineSnapshot);
    } else {
      initialize();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipelineSnapshot]);

  const pathLen = dataRef.current.path?.path.length || 1;
  const progress = pathLen > 1 ? (frame / (pathLen - 1)) * 100 : 0;

  return (
    <section id="simulation" className="relative py-24 sm:py-32">
      <div className="absolute inset-0 grid-bg opacity-30" />
      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-3xl mx-auto mb-12">
          <AnimatedSection>
            <span className="inline-block text-xs font-semibold uppercase tracking-widest text-cyan-400 mb-4">
              3D Simulation
            </span>
          </AnimatedSection>
          <AnimatedSection delay={0.1}>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight mb-4">
              <span className="text-white">Fly a </span>
              <span className="gradient-text">virtual drone</span>
            </h2>
          </AnimatedSection>
          <AnimatedSection delay={0.2}>
            <p className="text-lg text-gray-400">
              Watch the drone follow its planned path in real-time. Switch between RGB, segmentation,
              costmap, planner, and PX4 telemetry views.
            </p>
          </AnimatedSection>
        </div>

        <AnimatedSection delay={0.3}>
          <div className="glass rounded-2xl border border-white/10 overflow-hidden max-w-4xl mx-auto">
            {/* View mode tabs */}
            <div className="flex overflow-x-auto border-b border-white/5 bg-white/[0.02]">
              {viewModes.map(vm => (
                <button
                  key={vm.id}
                  onClick={() => setActiveView(vm.id)}
                  className={`flex items-center gap-2 px-4 py-3 text-xs font-medium whitespace-nowrap border-b-2 transition-all ${
                    activeView === vm.id
                      ? 'text-white bg-white/[0.03]'
                      : 'border-transparent text-gray-500 hover:text-gray-300'
                  }`}
                  style={{
                    borderBottomColor: activeView === vm.id ? vm.color : 'transparent',
                  }}
                >
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: vm.color }} />
                  {vm.label}
                </button>
              ))}
            </div>

            {/* Canvas */}
            <div className="relative bg-black">
              <canvas
                ref={canvasRef}
                width={SW}
                height={SH}
                className="w-full"
                style={{ aspectRatio: `${SW}/${SH}`, imageRendering: 'auto' }}
              />
              {activeView !== 'telemetry' && (
                <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyan-500/30 to-transparent" />
              )}
            </div>

            {/* Controls */}
            <div className="p-4 border-t border-white/5 bg-white/[0.02]">
              {/* Progress bar */}
              <div className="relative h-1.5 bg-white/[0.06] rounded-full mb-4 cursor-pointer"
                onClick={e => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const pct = (e.clientX - rect.left) / rect.width;
                  const newFrame = Math.floor(pct * (pathLen - 1));
                  setFrame(newFrame);
                  renderFrame(newFrame);
                }}
              >
                <motion.div
                  className="absolute top-0 left-0 h-full bg-gradient-to-r from-cyan-500 to-blue-500 rounded-full"
                  style={{ width: `${progress}%` }}
                />
                <div
                  className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-lg shadow-cyan-500/30"
                  style={{ left: `${progress}%`, transform: `translate(-50%, -50%)` }}
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setIsPlaying(!isPlaying)}
                    className="w-9 h-9 flex items-center justify-center rounded-lg border border-white/10 hover:border-cyan-500/30 hover:bg-cyan-500/5 text-gray-300 hover:text-cyan-300 transition-all"
                  >
                    {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={() => { setFrame(0); setIsPlaying(false); renderFrame(0); }}
                    className="w-9 h-9 flex items-center justify-center rounded-lg border border-white/10 hover:border-white/20 text-gray-500 hover:text-gray-300 transition-all"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>
                  <div className="flex items-center gap-1 ml-2">
                    {[0.5, 1, 2, 4].map(s => (
                      <button
                        key={s}
                        onClick={() => setSpeed(s)}
                        className={`px-2 py-1 text-[10px] font-mono rounded transition-all ${
                          speed === s
                            ? 'bg-cyan-500/10 text-cyan-300 border border-cyan-500/30'
                            : 'text-gray-600 hover:text-gray-400'
                        }`}
                      >
                        {s}×
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-4 text-xs text-gray-500 font-mono">
                  <span>Frame {frame}/{pathLen - 1}</span>
                  <span>{progress.toFixed(0)}%</span>
                  <div className="flex items-center gap-1">
                    <Eye className="w-3 h-3" />
                    <span>{viewModes.find(v => v.id === activeView)?.label}</span>
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

// ── Drawing helpers ──────────────────────────────────────────

// Heading (degrees) that points the drone's nose along its actual
// direction of travel, using the path points just before/after the
// current index. Replaces the old `f * 3` placeholder, which just spun
// a fixed amount every frame regardless of where the drone was
// actually going.
function computeHeadingDeg(path: { x: number; y: number }[], idx: number): number {
  const a = path[Math.max(0, idx - 1)];
  const b = path[Math.min(path.length - 1, idx + 1)];
  if (!a || !b || (a.x === b.x && a.y === b.y)) return 0;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  // drawDrone's nose points toward -y before rotation; canvas rotate()
  // is clockwise for positive angles, so this is the angle that lands
  // the nose on the (dx, dy) travel direction.
  return Math.atan2(dx, -dy) * (180 / Math.PI);
}

// Draws the planned route: remaining path dashed/dim, traveled path
// solid/bright, plus start (green) and end (red) markers. Previously
// only the 'planner' tab drew this; now every view shares it so the
// path is visible regardless of which layer (RGB, segmentation,
// costmap) you're looking at.
function drawPathOverlay(ctx: CanvasRenderingContext2D, fullPath: { x: number; y: number }[], pathIdx: number) {
  if (fullPath.length < 2) return;

  const traveled = fullPath.slice(0, pathIdx + 1);
  const remaining = fullPath.slice(pathIdx);

  if (remaining.length > 1) {
    ctx.strokeStyle = 'rgba(34, 211, 238, 0.35)';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(remaining[0].x, remaining[0].y);
    for (let i = 1; i < remaining.length; i++) {
      ctx.lineTo(remaining[i].x, remaining[i].y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  if (traveled.length > 1) {
    renderPath(ctx, traveled, '#22d3ee', 2.5);
  }

  ctx.fillStyle = '#22c55e';
  ctx.beginPath();
  ctx.arc(fullPath[0].x, fullPath[0].y, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ef4444';
  ctx.beginPath();
  ctx.arc(fullPath[fullPath.length - 1].x, fullPath[fullPath.length - 1].y, 4, 0, Math.PI * 2);
  ctx.fill();
}

function drawDrone(ctx: CanvasRenderingContext2D, x: number, y: number, heading: number) {
  // fix: was drawn at ~16px across on a canvas that's only 320-400px
  // wide, so it read as a tiny blurry speck once scaled up to the
  // large display size. SCALE makes it clearly visible without
  // changing any of the shape coordinates below.
  const SCALE = 1.9;

  // Ground shadow -- stays axis-aligned (doesn't rotate with the body)
  // like a real shadow would from an overhead sun, which is what gives
  // this a sense of the drone floating above the scene rather than
  // being flat-printed onto it.
  ctx.save();
  ctx.translate(x, y + 2 * SCALE);
  ctx.scale(SCALE, SCALE * 0.45);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.beginPath();
  ctx.arc(0, 0, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((heading * Math.PI) / 180);
  ctx.scale(SCALE, SCALE);

  // Glow
  ctx.shadowColor = '#22d3ee';
  ctx.shadowBlur = 12;

  // Body -- radial gradient instead of flat fill, so it reads as a
  // rounded shell catching light rather than a flat painted triangle.
  const bodyGrad = ctx.createRadialGradient(-1.5, -3, 0, 0, 0, 9);
  bodyGrad.addColorStop(0, 'rgba(165, 243, 252, 0.95)');
  bodyGrad.addColorStop(0.55, 'rgba(6, 182, 212, 0.9)');
  bodyGrad.addColorStop(1, 'rgba(8, 100, 122, 0.9)');
  ctx.fillStyle = bodyGrad;
  ctx.beginPath();
  ctx.moveTo(0, -8);
  ctx.lineTo(5, 6);
  ctx.lineTo(0, 3);
  ctx.lineTo(-5, 6);
  ctx.closePath();
  ctx.fill();

  // Arms
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-7, -3); ctx.lineTo(7, -3);
  ctx.moveTo(-7, 3); ctx.lineTo(7, 3);
  ctx.stroke();

  // Props -- small radial highlight so each looks like a disc catching
  // light rather than a flat dot, and a faint spin-blur ring around it.
  for (const [px, py] of [[-7, -3], [7, -3], [-7, 3], [7, 3]]) {
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 0.75;
    ctx.arc(px, py, 4.5, 0, Math.PI * 2);
    ctx.stroke();

    const propGrad = ctx.createRadialGradient(px, py, 0, px, py, 3);
    propGrad.addColorStop(0, 'rgba(255, 255, 255, 0.6)');
    propGrad.addColorStop(1, 'rgba(255, 255, 255, 0.15)');
    ctx.fillStyle = propGrad;
    ctx.beginPath();
    ctx.arc(px, py, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.shadowBlur = 0;
  ctx.restore();
}

function drawHUD(ctx: CanvasRenderingContext2D, pos: { x: number; y: number }, frame: number, total: number, mode: string) {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;

  // Top bar
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.fillRect(0, 0, w, 24);
  ctx.fillRect(0, h - 20, w, 20);

  ctx.font = '10px "JetBrains Mono", monospace';
  ctx.fillStyle = '#22d3ee';
  ctx.fillText(`● ${mode}`, 8, 16);

  ctx.fillStyle = '#9ca3af';
  ctx.textAlign = 'right';
  ctx.fillText(`ALT: ${(50 + Math.sin(frame * 0.1) * 5).toFixed(1)}m`, w - 8, 16);
  ctx.textAlign = 'left';

  // Bottom info
  ctx.fillStyle = '#6b7280';
  ctx.fillText(`POS: (${pos.x}, ${pos.y})  SPD: ${(8 + Math.sin(frame * 0.3) * 2).toFixed(1)} m/s  BATT: ${(100 - (frame / total) * 35).toFixed(0)}%`, 8, h - 6);

  // Crosshair
  ctx.strokeStyle = 'rgba(34, 211, 238, 0.3)';
  ctx.lineWidth = 0.5;
  ctx.setLineDash([2, 4]);
  ctx.beginPath();
  ctx.moveTo(w / 2, h / 2 - 15);
  ctx.lineTo(w / 2, h / 2 + 15);
  ctx.moveTo(w / 2 - 15, h / 2);
  ctx.lineTo(w / 2 + 15, h / 2);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawTelemetry(ctx: CanvasRenderingContext2D, pos: { x: number; y: number }, frame: number, total: number, headingDeg: number) {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const progress = frame / Math.max(total - 1, 1);

  ctx.font = '11px "JetBrains Mono", monospace';

  // Title
  ctx.fillStyle = '#22d3ee';
  ctx.fillText('PX4 TELEMETRY — MAVLINK STREAM', 16, 24);
  ctx.fillStyle = '#1e293b';
  ctx.fillRect(0, 32, w, 1);

  const rows: [string, string, string][] = [
    ['MODE', progress < 0.8 ? 'AUTO' : 'RTL', '#22c55e'],
    ['ARMED', 'YES', '#22c55e'],
    ['GPS', `37.7749°N, -122.4194°W`, '#9ca3af'],
    ['ALT (m)', `${(50 + Math.sin(frame * 0.1) * 5).toFixed(1)}`, '#60a5fa'],
    ['GND SPD (m/s)', `${(8 + Math.sin(frame * 0.3) * 2).toFixed(1)}`, '#60a5fa'],
    ['HEADING (°)', `${((headingDeg + 360) % 360).toFixed(0)}`, '#f59e0b'],
    ['ROLL (°)', `${(Math.sin(frame * 0.2) * 5).toFixed(1)}`, '#9ca3af'],
    ['PITCH (°)', `${(Math.cos(frame * 0.15) * 3).toFixed(1)}`, '#9ca3af'],
    ['BATTERY (%)', `${(100 - progress * 35).toFixed(0)}`, progress * 35 > 25 ? '#f59e0b' : '#ef4444'],
    ['SATS', '14', '#22c55e'],
    ['HDOP', '0.8', '#22c55e'],
    ['WAYPOINT', `${Math.floor(progress * 8) + 1}/8`, '#8b5cf6'],
    ['POS (px)', `(${pos.x}, ${pos.y})`, '#9ca3af'],
    ['AI DECISION', getDecision(frame), '#22d3ee'],
  ];

  let yy = 48;
  for (const [label, value, color] of rows) {
    ctx.fillStyle = '#4b5563';
    ctx.fillText(label, 16, yy);
    ctx.fillStyle = color;
    ctx.textAlign = 'right';
    ctx.fillText(value, w - 16, yy);
    ctx.textAlign = 'left';
    yy += 18;
  }

  // Mini altitude chart
  const chartY = h - 40;
  const chartH = 30;
  ctx.strokeStyle = 'rgba(96, 165, 250, 0.3)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < w - 32; i++) {
    const v = Math.sin((i + frame) * 0.05) * 0.3 + 0.5;
    const px = 16 + i;
    const py = chartY + chartH * (1 - v);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();

  // Current position marker
  const cursorX = 16 + ((frame * 2) % (w - 32));
  ctx.fillStyle = '#60a5fa';
  ctx.beginPath();
  ctx.arc(cursorX, chartY + chartH * 0.5, 2, 0, Math.PI * 2);
  ctx.fill();
}

function getDecision(frame: number): string {
  const decisions = [
    'Following path',
    'Clear ahead',
    'Obstacle → rerouting',
    'Terrain following',
    'Crosswind comp.',
    'Visual odom active',
  ];
  return decisions[Math.floor(frame * 0.3) % decisions.length];
}

// findRoad was replaced by findConnectedRoadEndpoints (algorithms.ts) --
// see InteractivePipeline.tsx's comment for why.
