import { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Upload, Play, Download, ChevronRight, Camera, Layers, Map, Route, Cpu, RotateCcw, ChevronDown, FileJson, MapPin, Globe, Plane } from 'lucide-react';
import AnimatedSection from './AnimatedSection';
import {
  heuristicSegmentation,
  extractRoadMask,
  generateCostmap,
  skeletonize,
  astar,
  renderSegmentation,
  renderCostmap,
  renderSkeleton,
  renderPath,
  renderExplored,
  generateSampleAerial,
  findConnectedRoadEndpoints,
  CLASS_COLORS,
  CLASS_NAMES,
  type SegmentationResult,
  type CostmapResult,
  type PathResult,
} from '../engine/algorithms';

import {
  loadRoadModel,
  onnxSegmentation,
} from '../engine/onnx-segmentation';

import { exportToQGC, exportToKML, exportToArduPilot, exportToGPX, exportToJSON, downloadFile } from '../engine/export';
import { setPipelineSnapshot } from '../engine/pipelineStore';

type Stage = 'upload' | 'segment' | 'costmap' | 'skeleton' | 'path';

const stages: { id: Stage; label: string; icon: typeof Camera; desc: string }[] = [
  { id: 'upload', label: 'Camera Input', icon: Camera, desc: 'Upload or generate aerial image' },
  { id: 'segment', label: 'Segmentation', icon: Layers, desc: 'Semantic class prediction' },
  { id: 'costmap', label: 'Occupancy Grid', icon: Map, desc: 'Cost-inflated navigation grid' },
  { id: 'skeleton', label: 'Skeleton', icon: Route, desc: 'Road skeleton extraction' },
  { id: 'path', label: 'A* Planner', icon: Cpu, desc: 'Optimal path computation' },
];

const CANVAS_W = 320;
const CANVAS_H = 240;

export default function InteractivePipeline() {
  const [activeStage, setActiveStage] = useState<Stage>('upload');
  const [isProcessing, setIsProcessing] = useState(false);
  const [hasImage, setHasImage] = useState(false);
  const [pipelineComplete, setPipelineComplete] = useState(false);
  const [animProgress, setAnimProgress] = useState(0);
  const [segmentationEngine, setSegmentationEngine] = useState<'heuristic' | 'onnx'>('heuristic');

  const [modelLoaded, setModelLoaded] = useState(false);
  const [modelLoading, setModelLoading] = useState(false);
  const [segmentationTime, setSegmentationTime] = useState(0);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Store computed data
  const imageDataRef = useRef<ImageData | null>(null);
  const segRef = useRef<SegmentationResult | null>(null);
  const costmapRef = useRef<CostmapResult | null>(null);
  const skeletonRef = useRef<Uint8Array | null>(null);
  const pathRef = useRef<PathResult | null>(null);

  const drawImage = useCallback((imgData: ImageData) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = imgData.width;
    canvas.height = imgData.height;
    const ctx = canvas.getContext('2d')!;
    ctx.putImageData(imgData, 0, 0);
  }, []);

  const clearOverlay = useCallback(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    const ctx = overlay.getContext('2d')!;
    ctx.clearRect(0, 0, overlay.width, overlay.height);
  }, []);

  const handleGenerateSample = useCallback(() => {
    const imgData = generateSampleAerial(CANVAS_W, CANVAS_H);
    imageDataRef.current = imgData;
    drawImage(imgData);
    clearOverlay();
    setHasImage(true);
    setActiveStage('upload');
    setPipelineComplete(false);
    segRef.current = null;
    costmapRef.current = null;
    skeletonRef.current = null;
    pathRef.current = null;
  }, [drawImage, clearOverlay]);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = CANVAS_W;
      canvas.height = CANVAS_H;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, CANVAS_W, CANVAS_H);
      const imgData = ctx.getImageData(0, 0, CANVAS_W, CANVAS_H);
      imageDataRef.current = imgData;
      drawImage(imgData);
      clearOverlay();
      setHasImage(true);
      setActiveStage('upload');
      setPipelineComplete(false);
      segRef.current = null;
      costmapRef.current = null;
      skeletonRef.current = null;
      pathRef.current = null;
    };
    img.src = URL.createObjectURL(file);
  }, [drawImage, clearOverlay]);

  // Generate sample on mount
  useEffect(() => {
    handleGenerateSample();
  }, [handleGenerateSample]);

  // Load ONNX Model on mount
  useEffect(() => {
    async function initModel() {
      try {
        setModelLoading(true);
        await loadRoadModel();
        setModelLoaded(true);
      } catch (err) {
        console.error("Failed to load ONNX model", err);
        setModelLoaded(false);
      } finally {
        setModelLoading(false);
      }
    }
    initModel();
  }, []);

  const runSegmentation = useCallback(async () => {
    if (!imageDataRef.current) return null;

    const t0 = performance.now();
    let seg: SegmentationResult;

    if (segmentationEngine === "onnx" && modelLoaded) {
      seg = await onnxSegmentation(imageDataRef.current);
    } else {
      seg = heuristicSegmentation(imageDataRef.current, 0.5);
    }

    setSegmentationTime(performance.now() - t0);
    return seg;
  }, [segmentationEngine, modelLoaded]);

  // Run a specific pipeline stage
  const runStage = useCallback(async (stage: Stage) => {
    if (!imageDataRef.current) return;
    setIsProcessing(true);
    setActiveStage(stage);

    try {
      const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    const overlay = overlayRef.current!;
    const octx = overlay.getContext('2d')!;
    overlay.width = CANVAS_W;
    overlay.height = CANVAS_H;

    // Small delay for visual effect
    await new Promise(r => setTimeout(r, 300));

    if (stage === 'segment') {
      const seg = await runSegmentation();
      if (seg) {
        segRef.current = seg;
        // Animate: draw original then overlay segmentation
        drawImage(imageDataRef.current);
        octx.clearRect(0, 0, CANVAS_W, CANVAS_H);
        renderSegmentation(octx, seg, 0.65);
      }
    } else if (stage === 'costmap') {
      if (!segRef.current) {
        const seg = await runSegmentation();
        if (seg) segRef.current = seg;
      }
      if (segRef.current) {
        const roadMask = extractRoadMask(segRef.current);
        const cm = generateCostmap(roadMask, CANVAS_W, CANVAS_H, 5);
        costmapRef.current = cm;
        octx.clearRect(0, 0, CANVAS_W, CANVAS_H);
        renderCostmap(ctx, cm);
        // Animate generation row by row
        setAnimProgress(0);
        for (let row = 0; row < CANVAS_H; row += 4) {
          setAnimProgress(row / CANVAS_H);
          await new Promise(r => setTimeout(r, 2));
        }
        setAnimProgress(1);
      }
    } else if (stage === 'skeleton') {
      if (!segRef.current) {
        const seg = await runSegmentation();
        if (seg) segRef.current = seg;
      }
      if (segRef.current) {
        // Show segmentation as base
        drawImage(imageDataRef.current);
        octx.clearRect(0, 0, CANVAS_W, CANVAS_H);
        renderSegmentation(octx, segRef.current, 0.4);

        const roadMask = extractRoadMask(segRef.current);
        const skel = skeletonize(roadMask, CANVAS_W, CANVAS_H, 2);
        skeletonRef.current = skel;
        renderSkeleton(octx, skel, CANVAS_W, CANVAS_H, '#22d3ee');
      }
    } else if (stage === 'path') {
      if (!segRef.current) {
        const seg = await runSegmentation();
        if (seg) segRef.current = seg;
      }
      if (!costmapRef.current && segRef.current) {
        const roadMask = extractRoadMask(segRef.current);
        costmapRef.current = generateCostmap(roadMask, CANVAS_W, CANVAS_H, 5);
      }

      if (costmapRef.current && segRef.current) {
        // Show costmap
        renderCostmap(ctx, costmapRef.current);
        octx.clearRect(0, 0, CANVAS_W, CANVAS_H);

        // Find start/end from within the SAME connected road region --
        // see findConnectedRoadEndpoints in algorithms.ts for why this
        // replaced picking start/end independently.
        const { start, end, skeletonPath } = findConnectedRoadEndpoints(segRef.current);

        // A* is still run to validate reachability and provide the explored
        // search cells, but a uniform road cost lets A* drift to a boundary.
        // The navigation route must remain on the ordered skeleton centerline.
        const astarResult = astar(costmapRef.current, start, end);
        const result = skeletonPath && skeletonPath.length >= 2
          ? {
              ...astarResult,
              path: skeletonPath,
              cost: skeletonPath.reduce((sum, p) => sum + costmapRef.current!.costs[p.y * costmapRef.current!.width + p.x], 0),
            }
          : astarResult;
        pathRef.current = result;

        // Animate explored cells
        const chunkSize = Math.max(1, Math.floor(result.explored.length / 60));
        for (let i = 0; i < result.explored.length; i += chunkSize) {
          renderExplored(octx, result.explored, i + chunkSize, 'rgba(6, 182, 212, 0.12)');
          setAnimProgress(i / result.explored.length);
          await new Promise(r => setTimeout(r, 10));
        }

        // Draw final path
        renderPath(octx, result.path, '#22d3ee', 2);

        // Start / end markers
        if (result.path.length > 0) {
          octx.fillStyle = '#22c55e';
          octx.beginPath();
          octx.arc(start.x, start.y, 4, 0, Math.PI * 2);
          octx.fill();
          octx.fillStyle = '#ef4444';
          octx.beginPath();
          octx.arc(end.x, end.y, 4, 0, Math.PI * 2);
          octx.fill();
        }

        setAnimProgress(1);
        setPipelineComplete(true);

        // Publish to the shared store so the Simulation tab can fly the
        // drone over THIS image/path instead of its own random scene.
        if (result.path.length > 0 && imageDataRef.current) {
          setPipelineSnapshot({
            imgData: imageDataRef.current,
            seg: segRef.current,
            costmap: costmapRef.current,
            path: result,
          });
        }
      }
    }

    } catch (error) {
      console.error(`Pipeline stage "${stage}" failed`, error);
      setPipelineComplete(false);
    } finally {
      setIsProcessing(false);
    }
  }, [drawImage, runSegmentation]);

  const runFullPipeline = useCallback(async () => {
    if (!imageDataRef.current) return;
    for (const stage of stages) {
      if (stage.id === 'upload') continue;
      await runStage(stage.id);
      await new Promise(r => setTimeout(r, 400));
    }
  }, [runStage]);

  const handleReset = useCallback(() => {
    setActiveStage('upload');
    setHasImage(false);
    setPipelineComplete(false);
    setAnimProgress(0);
    imageDataRef.current = null;
    segRef.current = null;
    costmapRef.current = null;
    skeletonRef.current = null;
    pathRef.current = null;
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d')!;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    clearOverlay();
  }, [clearOverlay]);

  const activeIdx = stages.findIndex(s => s.id === activeStage);

  return (
    <section id="pipeline" className="relative py-24 sm:py-32">
      <div className="absolute inset-0 grid-bg opacity-40" />
      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-12">
          <AnimatedSection>
            <span className="inline-block text-xs font-semibold uppercase tracking-widest text-cyan-400 mb-4">
              Interactive Pipeline
            </span>
          </AnimatedSection>
          <AnimatedSection delay={0.1}>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight mb-4">
              <span className="text-white">Run the algorithm </span>
              <span className="gradient-text">yourself</span>
            </h2>
          </AnimatedSection>
          <AnimatedSection delay={0.2}>
            <p className="text-lg text-gray-400">
              Upload an aerial image and watch each stage of the navigation pipeline execute in real-time.
              Every computation runs in your browser — no server needed.
            </p>
          </AnimatedSection>
        </div>

        <AnimatedSection delay={0.3}>
          <div className="glass rounded-2xl border border-white/10 overflow-hidden">
            {/* Pipeline stage tabs */}
            <div className="border-b border-white/5 bg-white/[0.02]">
              <div className="flex overflow-x-auto">
                {stages.map((stage, i) => {
                  const isActive = stage.id === activeStage;
                  const isComplete = i < activeIdx || (i === activeIdx && !isProcessing);
                  return (
                    <button
                      key={stage.id}
                      onClick={() => {
                        if (hasImage && stage.id !== 'upload') {
                          runStage(stage.id);
                        } else if (stage.id === 'upload') {
                          setActiveStage('upload');
                          if (imageDataRef.current) {
                            drawImage(imageDataRef.current);
                            clearOverlay();
                          }
                        }
                      }}
                      className={`flex items-center gap-2 px-4 sm:px-5 py-3.5 text-xs sm:text-sm font-medium whitespace-nowrap border-b-2 transition-all duration-300 ${isActive
                          ? 'border-cyan-400 text-cyan-300 bg-cyan-500/5'
                          : 'border-transparent text-gray-500 hover:text-gray-300 hover:bg-white/[0.02]'
                        }`}
                    >
                      <stage.icon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                      <span className="hidden sm:inline">{stage.label}</span>
                      {i < stages.length - 1 && (
                        <ChevronRight className="w-3 h-3 text-gray-700 ml-1 hidden lg:block" />
                      )}
                      {isComplete && i > 0 && i <= activeIdx && (
                        <div className="w-1.5 h-1.5 rounded-full bg-green-500 ml-1" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="p-4 sm:p-6 lg:p-8">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Canvas area */}
                <div className="lg:col-span-2">
                  <div className="relative bg-black/40 rounded-xl overflow-hidden border border-white/[0.06]" style={{ aspectRatio: `${CANVAS_W}/${CANVAS_H}` }}>
                    <canvas
                      ref={canvasRef}
                      width={CANVAS_W}
                      height={CANVAS_H}
                      className="w-full h-full lab-canvas"
                      style={{ imageRendering: 'auto' }}
                    />
                    <canvas
                      ref={overlayRef}
                      width={CANVAS_W}
                      height={CANVAS_H}
                      className="absolute inset-0 w-full h-full"
                      style={{ imageRendering: 'auto' }}
                    />

                    {/* Processing overlay */}
                    <AnimatePresence>
                      {isProcessing && (
                        <motion.div
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          className="absolute inset-0 bg-black/30 flex items-center justify-center"
                        >
                          <div className="text-center">
                            <div className="w-8 h-8 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                            <span className="text-sm text-cyan-300 font-mono">
                              Processing... {Math.round(animProgress * 100)}%
                            </span>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {/* Stage label */}
                    <div className="absolute top-3 left-3 glass rounded-lg px-3 py-1.5 text-xs font-mono text-cyan-300">
                      {stages[activeIdx]?.label}
                    </div>

                    {/* Upload prompt when no image */}
                    {!hasImage && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                        <div className="text-center">
                          <Upload className="w-10 h-10 text-gray-600 mx-auto mb-3" />
                          <p className="text-sm text-gray-400">Upload an image or generate a sample</p>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Engine Selection Toggle */}
                  <div className="mt-4 flex items-center justify-between p-3 bg-white/[0.02] border border-white/5 rounded-lg">
                    <span className="text-xs text-gray-400">Segmentation Engine</span>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setSegmentationEngine('heuristic')}
                        className={`px-3 py-1.5 text-xs font-medium rounded ${segmentationEngine === 'heuristic'
                            ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                            : 'text-gray-500 border border-transparent hover:text-gray-300'
                          }`}
                      >
                        Heuristic
                      </button>
                      <button
                        onClick={() => setSegmentationEngine('onnx')}
                        disabled={!modelLoaded || modelLoading}
                        className={`px-3 py-1.5 text-xs font-medium rounded ${segmentationEngine === 'onnx'
                            ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                            : 'text-gray-500 border border-transparent hover:text-gray-300'
                          } disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2`}
                      >
                        {modelLoading ? 'Loading Model...' : 'ONNX Model'}
                      </button>
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="flex flex-wrap items-center gap-3 mt-4">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleFileUpload}
                    />
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="flex items-center gap-2 px-4 py-2.5 text-xs font-medium text-gray-300 border border-white/10 rounded-lg hover:border-white/20 hover:bg-white/5 transition-all"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      Upload Image
                    </button>
                    <button
                      onClick={handleGenerateSample}
                      className="flex items-center gap-2 px-4 py-2.5 text-xs font-medium text-gray-300 border border-white/10 rounded-lg hover:border-white/20 hover:bg-white/5 transition-all"
                    >
                      <Camera className="w-3.5 h-3.5" />
                      Generate Sample
                    </button>
                    <button
                      onClick={runFullPipeline}
                      disabled={!hasImage || isProcessing}
                      className="btn-primary flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-white rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <span className="relative z-10 flex items-center gap-2">
                        <Play className="w-3.5 h-3.5" />
                        Run Full Pipeline
                      </span>
                    </button>
                    {pipelineComplete && (
                      <ExportDropdown pathResult={pathRef.current} />
                    )}
                    <button
                      onClick={handleReset}
                      className="flex items-center gap-2 px-3 py-2.5 text-xs text-gray-500 hover:text-gray-300 transition-colors ml-auto"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Info panel */}
                <div className="space-y-4">
                  {/* Stage details */}
                  <div className="p-4 rounded-xl border border-white/[0.06] bg-white/[0.02]">
                    <h4 className="text-sm font-semibold text-white mb-1">{stages[activeIdx]?.label}</h4>
                    <p className="text-xs text-gray-500 mb-3">{stages[activeIdx]?.desc}</p>
                    <StageDetails stage={activeStage} pathResult={pathRef.current} segmentationTime={segmentationTime} />
                  </div>

                  {/* Legend */}
                  {(activeStage === 'segment' || activeStage === 'skeleton') && (
                    <div className="p-4 rounded-xl border border-white/[0.06] bg-white/[0.02]">
                      <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Classes</h4>
                      <div className="space-y-2">
                        {Object.entries(CLASS_COLORS).map(([id, [r, g, b]]) => (
                          <div key={id} className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: `rgb(${r},${g},${b})` }} />
                            <span className="text-xs text-gray-400">{CLASS_NAMES[Number(id)]}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Pipeline progress */}
                  <div className="p-4 rounded-xl border border-white/[0.06] bg-white/[0.02]">
                    <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Pipeline Flow</h4>
                    <div className="space-y-2">
                      {stages.map((s, i) => {
                        const done = i < activeIdx || (i <= activeIdx && !isProcessing && i > 0 && i <= activeIdx);
                        const active = i === activeIdx && isProcessing;
                        return (
                          <div key={s.id} className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full ${done ? 'bg-green-500' : active ? 'bg-cyan-400 animate-pulse' : 'bg-gray-700'
                              }`} />
                            <span className={`text-xs ${done ? 'text-green-400' : active ? 'text-cyan-300' : 'text-gray-600'
                              }`}>{s.label}</span>
                          </div>
                        );
                      })}
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

function StageDetails({ stage, pathResult, segmentationTime }: { stage: Stage; pathResult: PathResult | null, segmentationTime: number }) {
  const details: Record<Stage, React.ReactNode> = {
    upload: (
      <div className="space-y-2 text-xs text-gray-500">
        <p>Upload an aerial photograph or generate a procedural sample scene.</p>
        <p>The image will be resized to {CANVAS_W}×{CANVAS_H} for processing.</p>
        <div className="mt-2 p-2 rounded bg-white/[0.03] font-mono text-[10px] text-gray-600">
          Supported: JPG, PNG, WebP
        </div>
      </div>
    ),
    segment: (
      <div className="space-y-2 text-xs text-gray-500">
        <p>Assigns each pixel into semantic categories using the active segmentation engine.</p>
        <div className="mt-2 p-2 rounded bg-white/[0.03] font-mono text-[10px] text-gray-600">
          <div>Model: SemtechSeg-v3 / ONNX</div>
          <div>Resolution: {CANVAS_W}×{CANVAS_H}</div>
          <div>Classes: {Object.keys(CLASS_NAMES).length} ({Object.values(CLASS_NAMES).join(', ')})</div>
          {segmentationTime > 0 && <div>Execution Time: {segmentationTime.toFixed(2)} ms</div>}
        </div>
      </div>
    ),
    costmap: (
      <div className="space-y-2 text-xs text-gray-500">
        <p>Converts segmentation into a navigation cost grid with obstacle inflation for safe clearance.</p>
        <div className="mt-2 p-2 rounded bg-white/[0.03] font-mono text-[10px] text-gray-600">
          <div>Blue = free space (low cost)</div>
          <div>Yellow = moderate cost</div>
          <div>Red = obstacle (impassable)</div>
        </div>
      </div>
    ),
    skeleton: (
      <div className="space-y-2 text-xs text-gray-500">
        <p>Zhang-Suen thinning algorithm extracts the road skeleton — the centerline of navigable space.</p>
        <div className="mt-2 p-2 rounded bg-white/[0.03] font-mono text-[10px] text-gray-600">
          <div>Algorithm: Zhang-Suen</div>
          <div>Target: Road class</div>
          <div>Cyan overlay: skeleton line</div>
        </div>
      </div>
    ),
    path: (
      <div className="space-y-2 text-xs text-gray-500">
        <p>A* search finds the optimal path from start (green) to goal (red), avoiding obstacles.</p>
        {pathResult && (
          <div className="mt-2 p-2 rounded bg-white/[0.03] font-mono text-[10px] text-gray-600">
            <div>Path length: {pathResult.path.length} nodes</div>
            <div>Cells explored: {pathResult.explored.length}</div>
            <div>Total cost: {pathResult.cost.toFixed(1)}</div>
            <div>Status: {pathResult.path.length > 0 ? '✓ Path found' : '✗ No path'}</div>
          </div>
        )}
      </div>
    ),
  };
  return <>{details[stage]}</>;
}

// findRoadPoint was replaced by findConnectedRoadEndpoints (algorithms.ts)
// -- picking start/end independently could land them in two different
// disconnected road blobs on a real photo. See that function's comment.


// ── Export Dropdown with multiple format options ─────────────
function ExportDropdown({ pathResult }: { pathResult: PathResult | null }) {
  const [isOpen, setIsOpen] = useState(false);

  if (!pathResult || pathResult.path.length === 0) return null;

  const exportFormats = [
    {
      label: 'JSON (Path Data)',
      icon: FileJson,
      action: () => {
        const json = exportToJSON(pathResult, { source: 'semtech-drone-lab' });
        downloadFile(json, 'semtech_path.json', 'application/json');
      },
    },
    {
      label: 'QGroundControl (.plan)',
      icon: Plane,
      action: () => {
        const plan = exportToQGC(pathResult.path);
        downloadFile(JSON.stringify(plan, null, 2), 'mission.plan', 'application/json');
      },
    },
    {
      label: 'ArduPilot Waypoints',
      icon: MapPin,
      action: () => {
        const wp = exportToArduPilot(pathResult.path);
        downloadFile(wp, 'mission.waypoints', 'text/plain');
      },
    },
    {
      label: 'KML (Google Earth)',
      icon: Globe,
      action: () => {
        const kml = exportToKML(pathResult.path);
        downloadFile(kml, 'mission.kml', 'application/vnd.google-earth.kml+xml');
      },
    },
    {
      label: 'GPX (GPS Exchange)',
      icon: Globe,
      action: () => {
        const gpx = exportToGPX(pathResult.path);
        downloadFile(gpx, 'mission.gpx', 'application/gpx+xml');
      },
    },
  ];

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-4 py-2.5 text-xs font-medium text-cyan-300 border border-cyan-500/30 rounded-lg hover:bg-cyan-500/10 transition-all"
      >
        <Download className="w-3.5 h-3.5" />
        Export Path
        <ChevronDown className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence>
        {isOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: -8, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.95 }}
              transition={{ duration: 0.15 }}
              className="absolute left-0 top-full mt-1 z-20 w-56 rounded-xl border border-white/10 bg-[#0d1117] shadow-xl overflow-hidden"
            >
              {exportFormats.map((format) => (
                <button
                  key={format.label}
                  onClick={() => {
                    format.action();
                    setIsOpen(false);
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3 text-xs text-gray-300 hover:text-white hover:bg-white/5 transition-colors text-left"
                >
                  <format.icon className="w-4 h-4 text-gray-500" />
                  {format.label}
                </button>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
