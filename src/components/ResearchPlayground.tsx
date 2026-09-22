import { useState, useRef, useCallback, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Sliders, Play, RefreshCw } from 'lucide-react';
import AnimatedSection from './AnimatedSection';
import { onnxSegmentation } from '../engine/onnx-segmentation';
import {
  heuristicSegmentation, extractRoadMask, generateCostmap, skeletonize, astar, dijkstra,
  renderSegmentation, renderCostmap, renderSkeleton, renderPath, renderExplored,
  generateSampleAerial, findConnectedRoadEndpoints,
  type SegmentationResult, type CostmapResult, type PathResult,
} from '../engine/algorithms';

interface Params {
  sensitivity: number;
  morphKernel: number;
  inflation: number;
  skeletonThickness: number;
  planner: 'astar' | 'dijkstra';
  cameraHeight: number;
  segmentationEngine: 'heuristic' | 'onnx';
}

const defaultParams: Params = {
  sensitivity: 0.5,
  morphKernel: 3,
  inflation: 5,
  skeletonThickness: 2,
  planner: 'astar',
  cameraHeight: 50,
  segmentationEngine: 'heuristic',
};

const CW = 280;
const CH = 210;

export default function ResearchPlayground() {
  const [params, setParams] = useState<Params>(defaultParams);
  const [results, setResults] = useState<{
    seg: SegmentationResult | null;
    costmap: CostmapResult | null;
    path: PathResult | null;
    segTime: number;
    costTime: number;
    pathTime: number;
  }>({ seg: null, costmap: null, path: null, segTime: 0, costTime: 0, pathTime: 0 });

  const segCanvasRef = useRef<HTMLCanvasElement>(null);
  const costCanvasRef = useRef<HTMLCanvasElement>(null);
  const skelCanvasRef = useRef<HTMLCanvasElement>(null);
  const pathCanvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<ImageData | null>(null);

  const runPipeline = useCallback(async () => {
    if (!imageRef.current) {
      imageRef.current = generateSampleAerial(CW, CH);
    }
    const imgData = imageRef.current;

    // Segmentation
    const t0 = performance.now();
    const seg =
      params.segmentationEngine === 'onnx'
        ? await onnxSegmentation(imgData)
        : heuristicSegmentation(imgData, params.sensitivity);

    const segTime = performance.now() - t0;

    // Binary road mask — everything downstream (costmap, skeleton) keys
    // off this rather than the raw multi-class mask.
    const roadMask = extractRoadMask(seg);

    // Costmap
    const t1 = performance.now();
    const cm = generateCostmap(roadMask, CW, CH, params.inflation);
    const costTime = performance.now() - t1;

    // Skeleton
    const skel = skeletonize(roadMask, CW, CH, params.skeletonThickness);

    // Path -- start/end chosen from the same connected road blob, see
    // findConnectedRoadEndpoints in algorithms.ts.
    const { start, end } = findConnectedRoadEndpoints(seg);
    const t2 = performance.now();
    const pathResult = params.planner === 'astar'
      ? astar(cm, start, end)
      : dijkstra(cm, start, end);
    const pathTime = performance.now() - t2;

    setResults({ seg, costmap: cm, path: pathResult, segTime, costTime, pathTime });

    // Render segmentation
    const segCtx = segCanvasRef.current?.getContext('2d');
    if (segCtx) {
      segCanvasRef.current!.width = CW;
      segCanvasRef.current!.height = CH;
      renderSegmentation(segCtx, seg, 0.85);
    }

    // Render costmap
    const costCtx = costCanvasRef.current?.getContext('2d');
    if (costCtx) {
      costCanvasRef.current!.width = CW;
      costCanvasRef.current!.height = CH;
      renderCostmap(costCtx, cm);
    }

    // Render skeleton
    const skelCtx = skelCanvasRef.current?.getContext('2d');
    if (skelCtx) {
      skelCanvasRef.current!.width = CW;
      skelCanvasRef.current!.height = CH;
      skelCtx.fillStyle = '#0d1117';
      skelCtx.fillRect(0, 0, CW, CH);
      renderSegmentation(skelCtx, seg, 0.3);
      renderSkeleton(skelCtx, skel, CW, CH, '#22d3ee');
    }

    // Render path
    const pathCtx = pathCanvasRef.current?.getContext('2d');
    if (pathCtx) {
      pathCanvasRef.current!.width = CW;
      pathCanvasRef.current!.height = CH;
      renderCostmap(pathCtx, cm);
      renderExplored(pathCtx, pathResult.explored, pathResult.explored.length, 'rgba(6,182,212,0.1)');
      renderPath(pathCtx, pathResult.path, '#22d3ee', 2);
      if (pathResult.path.length > 0) {
        pathCtx.fillStyle = '#22c55e';
        pathCtx.beginPath();
        pathCtx.arc(start.x, start.y, 3, 0, Math.PI * 2);
        pathCtx.fill();
        pathCtx.fillStyle = '#ef4444';
        pathCtx.beginPath();
        pathCtx.arc(end.x, end.y, 3, 0, Math.PI * 2);
        pathCtx.fill();
      }
    }
  }, [params]);

  useEffect(() => {
    runPipeline();
  }, [runPipeline]);

  const updateParam = <K extends keyof Params>(key: K, value: Params[K]) => {
    setParams(prev => ({ ...prev, [key]: value }));
  };

  return (
    <section id="playground" className="relative py-24 sm:py-32">
      <div className="absolute inset-0 radial-glow-center" />
      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-3xl mx-auto mb-12">
          <AnimatedSection>
            <span className="inline-block text-xs font-semibold uppercase tracking-widest text-cyan-400 mb-4">
              Research Playground
            </span>
          </AnimatedSection>
          <AnimatedSection delay={0.1}>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight mb-4">
              <span className="text-white">Tweak parameters, </span>
              <span className="gradient-text">see results instantly</span>
            </h2>
          </AnimatedSection>
          <AnimatedSection delay={0.2}>
            <p className="text-lg text-gray-400">
              Adjust the perception sensitivity, morphology kernel, obstacle inflation, planner algorithm,
              and more. Every result updates in real-time.
            </p>
          </AnimatedSection>
        </div>

        <AnimatedSection delay={0.3}>
          <div className="glass rounded-2xl border border-white/10 overflow-hidden">
            <div className="p-4 sm:p-6 lg:p-8">
              <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
                {/* Controls panel */}
                <div className="xl:col-span-1 space-y-4">
                  <div className="flex items-center gap-2 mb-4">
                    <Sliders className="w-4 h-4 text-cyan-400" />
                    <span className="text-sm font-semibold text-white">Parameters</span>
                  </div>

                  <ParamSlider
                    label="Sensitivity"
                    value={params.sensitivity}
                    min={0.1} max={1.0} step={0.05}
                    onChange={v => updateParam('sensitivity', v)}
                    format={v => v.toFixed(2)}
                  />
                  <ParamSlider
                    label="Morph. Kernel"
                    value={params.morphKernel}
                    min={1} max={9} step={2}
                    onChange={v => updateParam('morphKernel', v)}
                    format={v => `${v}×${v}`}
                  />
                  <ParamSlider
                    label="Obstacle Inflation"
                    value={params.inflation}
                    min={0} max={15} step={1}
                    onChange={v => updateParam('inflation', v)}
                    format={v => `${v}px`}
                  />
                  <ParamSlider
                    label="Skeleton Thickness"
                    value={params.skeletonThickness}
                    min={1} max={5} step={1}
                    onChange={v => updateParam('skeletonThickness', v)}
                    format={v => `${v}px`}
                  />
                  <ParamSlider
                    label="Camera Height"
                    value={params.cameraHeight}
                    min={10} max={200} step={10}
                    onChange={v => updateParam('cameraHeight', v)}
                    format={v => `${v}m`}
                  />

                  {/* Segmentation Engine */}
                  <div>
                    <label className="text-xs text-gray-500 mb-2 block">Segmentation Engine</label>
                    <div className="flex gap-2">
                      {(['heuristic','onnx'] as const).map(engine => (
                        <button
                          key={engine}
                          onClick={() => updateParam('segmentationEngine', engine)}
                          className={`flex-1 px-3 py-2 text-xs font-medium rounded-lg border transition-all ${
                            params.segmentationEngine === engine
                              ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300'
                              : 'border-white/[0.06] text-gray-500 hover:text-gray-300 hover:border-white/10'
                          }`}
                        >
                          {engine === 'onnx' ? 'ONNX AI' : 'Heuristic'}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Planner select */}
                  <div>
                    <label className="text-xs text-gray-500 mb-2 block">Planner Algorithm</label>
                    <div className="flex gap-2">
                      {(['astar', 'dijkstra'] as const).map(p => (
                        <button
                          key={p}
                          onClick={() => updateParam('planner', p)}
                          className={`flex-1 px-3 py-2 text-xs font-medium rounded-lg border transition-all ${params.planner === p
                              ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300'
                              : 'border-white/[0.06] text-gray-500 hover:text-gray-300 hover:border-white/10'
                            }`}
                        >
                          {p === 'astar' ? 'A*' : 'Dijkstra'}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex gap-2 pt-2">
                    <button
                      onClick={runPipeline}
                      className="btn-primary flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold text-white rounded-lg"
                    >
                      <span className="relative z-10 flex items-center gap-2">
                        <Play className="w-3.5 h-3.5" />
                        Run
                      </span>
                    </button>
                    <button
                      onClick={() => {
                        setParams(defaultParams);
                        imageRef.current = generateSampleAerial(CW, CH);
                      }}
                      className="px-3 py-2.5 text-xs text-gray-500 hover:text-gray-300 border border-white/[0.06] rounded-lg hover:border-white/10 transition-all"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Timing results */}
                  <div className="p-3 rounded-lg border border-white/[0.06] bg-white/[0.02] space-y-1.5">
                    <h5 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Timing</h5>
                    <div className="flex justify-between text-xs"><span className="text-gray-500">Engine</span><span className="text-cyan-400">{params.segmentationEngine === 'onnx' ? 'ONNX AI' : 'Heuristic'}</span></div>
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-500">Segmentation</span>
                      <span className="text-cyan-400 font-mono">{results.segTime.toFixed(1)}ms</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-500">Costmap</span>
                      <span className="text-cyan-400 font-mono">{results.costTime.toFixed(1)}ms</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-500">{params.planner === 'astar' ? 'A*' : 'Dijkstra'}</span>
                      <span className="text-cyan-400 font-mono">{results.pathTime.toFixed(1)}ms</span>
                    </div>
                    {results.path && (
                      <div className="flex justify-between text-xs pt-1 border-t border-white/5">
                        <span className="text-gray-500">Path nodes</span>
                        <span className="text-green-400 font-mono">{results.path.path.length}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Result panels */}
                <div className="xl:col-span-3 grid grid-cols-2 gap-3">
                  <CanvasPanel
                    ref={segCanvasRef}
                    title="Semantic Segmentation"
                    subtitle="Class prediction per pixel"
                    w={CW} h={CH}
                  />
                  <CanvasPanel
                    ref={costCanvasRef}
                    title="Occupancy / Costmap"
                    subtitle="Navigation cost grid"
                    w={CW} h={CH}
                  />
                  <CanvasPanel
                    ref={skelCanvasRef}
                    title="Road Skeleton"
                    subtitle="Thinned centerline"
                    w={CW} h={CH}
                  />
                  <CanvasPanel
                    ref={pathCanvasRef}
                    title={`${params.planner === 'astar' ? 'A*' : 'Dijkstra'} Planned Path`}
                    subtitle="Optimal trajectory"
                    w={CW} h={CH}
                  />
                </div>
              </div>
            </div>
          </div>
        </AnimatedSection>
      </div>
    </section>
  );
}

// ── Reusable slider component ────────────────────────────────
function ParamSlider({
  label, value, min, max, step, onChange, format,
}: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; format: (v: number) => string;
}) {
  return (
    <div>
      <div className="flex justify-between items-center mb-1.5">
        <label className="text-xs text-gray-500">{label}</label>
        <span className="text-xs text-cyan-400 font-mono">{format(value)}</span>
      </div>
      <input
        type="range"
        min={min} max={max} step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full"
      />
    </div>
  );
}

// ── Canvas display panel ─────────────────────────────────────
import { forwardRef } from 'react';

const CanvasPanel = forwardRef<HTMLCanvasElement, {
  title: string; subtitle: string; w: number; h: number;
}>(({ title, subtitle, w, h }, ref) => (
  <motion.div
    whileHover={{ scale: 1.01 }}
    className="rounded-xl border border-white/[0.06] bg-black/30 overflow-hidden group"
  >
    <canvas
      ref={ref}
      width={w}
      height={h}
      className="w-full"
      style={{ aspectRatio: `${w}/${h}`, imageRendering: 'auto' }}
    />
    <div className="px-3 py-2 border-t border-white/[0.04]">
      <div className="text-xs font-medium text-gray-300">{title}</div>
      <div className="text-[10px] text-gray-600">{subtitle}</div>
    </div>
  </motion.div>
));

// findRoad was replaced by findConnectedRoadEndpoints (algorithms.ts) --
// see InteractivePipeline.tsx's comment for why.