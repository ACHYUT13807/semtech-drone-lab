import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Play, Pause, RotateCcw, Activity, Upload, Eye, ZoomIn, ZoomOut } from 'lucide-react';
import AnimatedSection from './AnimatedSection';
import {
  heuristicSegmentation, extractRoadMask, generateCostmap, astar,
  renderCostmap, renderPath, generateSampleAerial,
  generateFlightLog, type TelemetryFrame, ROAD_CLASS,
} from '../engine/algorithms';
import { parseULog, ulogToTelemetry } from '../engine/ulog-parser';

const FW = 360;
const FH = 200;

export default function FlightReplay() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackTime, setPlaybackTime] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);
  const [telemetry, setTelemetry] = useState<TelemetryFrame[]>([]);
  const [logSource, setLogSource] = useState<'generated' | 'ulog'>('generated');
  const [ulogFilename, setUlogFilename] = useState<string | null>(null);
  const [hoveredAltIdx, setHoveredAltIdx] = useState<number | null>(null);

  // Interactive 3D Camera Rotation & Zoom States
  const [rotAngle, setRotAngle] = useState(0.6);
  const [tiltAngle, setTiltAngle] = useState(0.55);
  const [zoomLevel, setZoomLevel] = useState(1.0);

  const isDraggingRef = useRef(false);
  const mousePosRef = useRef({ x: 0, y: 0 });

  const mapCanvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const rawCoordsRef = useRef<{ x: number; y: number; z: number }[]>([]);
  const ulogInputRef = useRef<HTMLInputElement>(null);
  
  // Cache the static 2D costmap to fix scaling and dramatically improve performance
  const staticMapCacheRef = useRef<HTMLCanvasElement | null>(null);

  const initialize = useCallback(() => {
    const canvas = mapCanvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 2;
    canvas.width = FW * dpr;
    canvas.height = FH * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Clear canvas before drawing
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    ctx.save();
    ctx.scale(dpr, dpr);

    const imgData = generateSampleAerial(FW, FH);
    const seg = heuristicSegmentation(imgData, 0.5);
    const roadMask = extractRoadMask(seg);
    const cm = generateCostmap(roadMask, FW, FH, 5);

    const start = findRoad(seg, 'bottom');
    const end = findRoad(seg, 'top');
    const result = astar(cm, start, end);
    const validPath = result.path.length > 0 ? result.path : [{ x: Math.floor(FW / 2), y: FH - 10 }, { x: Math.floor(FW / 2), y: 10 }];
    
    rawCoordsRef.current = validPath.map((p, i) => ({
      x: p.x - FW / 2,
      y: p.y - FH / 2,
      z: (Math.sin(i * 0.15) * 20) + 20,
    }));

    const log = generateFlightLog(validPath, 60);
    setTelemetry(log);
    setPlaybackTime(0);

    // Render unscaled map to an off-screen canvas to correctly map putImageData over Retina scaling
    const offscreen = document.createElement('canvas');
    offscreen.width = FW;
    offscreen.height = FH;
    const offCtx = offscreen.getContext('2d');
    if (offCtx) {
      renderCostmap(offCtx, cm);
      staticMapCacheRef.current = offscreen;
      ctx.drawImage(offscreen, 0, 0, FW, FH);
    }
    
    renderPath(ctx, validPath, 'rgba(34,211,238,0.3)', 1);
    ctx.restore();
  }, []);

  useEffect(() => { initialize(); }, [initialize]);

  // Real-time synchronization ticker with speed multiplier support
  useEffect(() => {
    if (!isPlaying || telemetry.length === 0) return;

    let lastTimestamp = performance.now();
    const maxDuration = telemetry[telemetry.length - 1]?.t || 60;

    const tick = (now: number) => {
      const delta = ((now - lastTimestamp) / 1000) * playbackSpeed;
      lastTimestamp = now;

      setPlaybackTime(prev => {
        const next = prev + delta;
        if (next >= maxDuration) {
          setIsPlaying(false);
          return maxDuration;
        }
        return next;
      });

      animRef.current = requestAnimationFrame(tick);
    };

    animRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animRef.current);
  }, [isPlaying, telemetry, playbackSpeed]);

  const frameIdx = useMemo(() => {
    if (telemetry.length === 0) return 0;
    let idx = 0;
    for (let i = 0; i < telemetry.length; i++) {
      if (telemetry[i].t >= playbackTime) {
        idx = i;
        break;
      }
      idx = i;
    }
    return idx;
  }, [playbackTime, telemetry]);

  useEffect(() => {
    const canvas = mapCanvasRef.current;
    if (!canvas || telemetry.length === 0 || rawCoordsRef.current.length === 0) return;

    const dpr = window.devicePixelRatio || 2;
    if (canvas.width !== FW * dpr || canvas.height !== FH * dpr) {
      canvas.width = FW * dpr;
      canvas.height = FH * dpr;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.save();
    ctx.scale(dpr, dpr);

    if (logSource === 'ulog') {
      const bgGrad = ctx.createRadialGradient(FW / 2, FH / 2, 20, FW / 2, FH / 2, FW * 0.8);
      bgGrad.addColorStop(0, '#0a1128');
      bgGrad.addColorStop(0.6, '#040817');
      bgGrad.addColorStop(1, '#02040a');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, FW, FH);

      const coords = rawCoordsRef.current;
      
      const cosR = Math.cos(rotAngle);
      const sinR = Math.sin(rotAngle);
      const cosT = Math.cos(tiltAngle);
      const sinT = Math.sin(tiltAngle);

      const project3D = (x: number, y: number, z: number) => {
        const x1 = x * cosR - y * sinR;
        const y1 = x * sinR + y * cosR;
        const z1 = z;

        const y2 = y1 * cosT + z1 * sinT;
        const z2 = y1 * sinT - z1 * cosT;

        const fov = 320 * zoomLevel;
        const camDist = z2 + 300;
        const scale = fov / Math.max(1, camDist);

        return {
          sx: FW / 2 + x1 * scale,
          sy: FH / 2 - y2 * scale,
          scale,
          depth: camDist,
        };
      };

      const groundZ = 0;
      ctx.lineWidth = 1;

      for (let gx = -120; gx <= 120; gx += 35) {
        const p1 = project3D(gx, -120, groundZ);
        const p2 = project3D(gx, 120, groundZ);
        ctx.beginPath();
        ctx.moveTo(p1.sx, p1.sy);
        ctx.lineTo(p2.sx, p2.sy);
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.12)';
        ctx.stroke();
      }
      for (let gy = -120; gy <= 120; gy += 35) {
        const p1 = project3D(-120, gy, groundZ);
        const p2 = project3D(120, gy, groundZ);
        ctx.beginPath();
        ctx.moveTo(p1.sx, p1.sy);
        ctx.lineTo(p2.sx, p2.sy);
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.12)';
        ctx.stroke();
      }

      ctx.beginPath();
      coords.forEach((c, i) => {
        const p = project3D(c.x, c.y, c.z);
        if (i === 0) ctx.moveTo(p.sx, p.sy);
        else ctx.lineTo(p.sx, p.sy);
      });
      ctx.strokeStyle = 'rgba(249, 115, 22, 0.2)';
      ctx.lineWidth = 3;
      ctx.stroke();

      const activeLimit = Math.min(frameIdx, coords.length - 1);
      if (activeLimit > 0) {
        for (let i = 0; i <= activeLimit; i += Math.max(1, Math.floor(activeLimit / 22))) {
          const c = coords[i];
          const p = project3D(c.x, c.y, c.z);
          const groundP = project3D(c.x, c.y, groundZ);

          ctx.beginPath();
          ctx.moveTo(p.sx, p.sy);
          ctx.lineTo(groundP.sx, groundP.sy);
          ctx.strokeStyle = 'rgba(34, 211, 238, 0.28)';
          ctx.lineWidth = 1.2;
          ctx.stroke();

          ctx.fillStyle = 'rgba(249, 115, 22, 0.75)';
          ctx.beginPath();
          ctx.arc(groundP.sx, groundP.sy, 2.2, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.beginPath();
        for (let i = 0; i <= activeLimit; i++) {
          const c = coords[i];
          const p = project3D(c.x, c.y, c.z);
          if (i === 0) ctx.moveTo(p.sx, p.sy);
          else ctx.lineTo(p.sx, p.sy);
        }
        ctx.strokeStyle = '#ff8a3d';
        ctx.lineWidth = 4;
        ctx.shadowColor = '#f97316';
        ctx.shadowBlur = 14;
        ctx.stroke();
        ctx.shadowBlur = 0;

        const cur = coords[activeLimit];
        const curP = project3D(cur.x, cur.y, cur.z);
        const groundCurP = project3D(cur.x, cur.y, groundZ);

        ctx.beginPath();
        ctx.moveTo(curP.sx, curP.sy);
        ctx.lineTo(groundCurP.sx, groundCurP.sy);
        ctx.strokeStyle = 'rgba(34, 211, 238, 0.6)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.strokeStyle = 'rgba(34, 211, 238, 0.4)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(curP.sx, curP.sy, 11 * curP.scale, 0, Math.PI * 2);
        ctx.stroke();

        ctx.shadowColor = '#22d3ee';
        ctx.shadowBlur = 20;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(curP.sx, curP.sy, 6.5 * curP.scale, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#22d3ee';
        ctx.beginPath();
        ctx.arc(curP.sx, curP.sy, 3.5 * curP.scale, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      ctx.save();
      ctx.translate(FW - 32, 32);
      ctx.rotate(-rotAngle);
      ctx.shadowColor = 'rgba(56, 189, 248, 0.5)';
      ctx.shadowBlur = 6;
      ctx.strokeStyle = '#38bdf8';
      ctx.fillStyle = '#38bdf8';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, -11);
      ctx.lineTo(3.5, 3.5);
      ctx.lineTo(0, 1.2);
      ctx.lineTo(-3.5, 3.5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#cbd5e1';
      ctx.font = 'bold 8px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('N', 0, -15);
      ctx.restore();

    } else {
      // Draw 2D Static Background correctly mapped over High-DPI context
      if (staticMapCacheRef.current) {
        ctx.drawImage(staticMapCacheRef.current, 0, 0, FW, FH);
      } else {
        // Fallback drawing if cache is empty
        const imgData = generateSampleAerial(FW, FH);
        const seg = heuristicSegmentation(imgData, 0.5);
        const roadMask = extractRoadMask(seg);
        const cm = generateCostmap(roadMask, FW, FH, 5);
        const offscreen = document.createElement('canvas');
        offscreen.width = FW;
        offscreen.height = FH;
        const offCtx = offscreen.getContext('2d');
        if (offCtx) {
          renderCostmap(offCtx, cm);
          ctx.drawImage(offscreen, 0, 0, FW, FH);
        }
      }
      
      const path = rawCoordsRef.current.map(c => ({ x: Math.round(c.x + FW / 2), y: Math.round(c.y + FH / 2) }));
      renderPath(ctx, path, 'rgba(34,211,238,0.25)', 1.2);

      const totalDur = telemetry[telemetry.length - 1]?.t || 60;
      const progress = totalDur > 0 ? playbackTime / totalDur : 0;
      const pathIdx = Math.min(Math.floor(progress * path.length), Math.max(0, path.length - 1));
      const traveled = path.slice(0, pathIdx + 1);
      
      renderPath(ctx, traveled, '#22d3ee', 2.5);

      const pos = path[pathIdx];
      if (pos) {
        ctx.shadowColor = '#22d3ee';
        ctx.shadowBlur = 14;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 5.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#22d3ee';
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }

    ctx.restore();
  }, [playbackTime, telemetry, logSource, frameIdx, rotAngle, tiltAngle, zoomLevel]);

  const altitudeStats = useMemo(() => {
    if (telemetry.length === 0) return { min: 0, max: 20 };
    const alts = telemetry.map(t => t.altitude);
    const min = Math.min(...alts);
    const max = Math.max(...alts);
    return { min, max: max - min < 2 ? min + 10 : max };
  }, [telemetry]);

  const sampledProfile = useMemo(() => {
    if (telemetry.length === 0) return [];
    const sampleCount = 50;
    const step = Math.max(1, Math.floor(telemetry.length / sampleCount));
    const samples = [];
    for (let i = 0; i < telemetry.length; i += step) {
      samples.push({ idx: i, altitude: telemetry[i].altitude, t: telemetry[i].t });
    }
    return samples;
  }, [telemetry]);

  const frame = telemetry[frameIdx] || telemetry[0] || {
    t: 0,
    mode: 'NAV_15',
    altitude: 15.0,
    speed: 4.5,
    heading: 45,
    battery: 85,
    roll: 0.0,
    pitch: 2.0,
    lat: 23.219404,
    lng: 72.701978,
    decision: 'Autonomous navigation corridor active',
  };

  const totalDuration = telemetry[telemetry.length - 1]?.t || 60;
  const progressPct = totalDuration > 0 ? (playbackTime / totalDuration) * 100 : 0;

  return (
    <section id="flight-replay" className="relative py-24 sm:py-32">
      <div className="absolute inset-0 grid-bg opacity-30" />
      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-3xl mx-auto mb-12">
          <AnimatedSection>
            <span className="inline-block text-xs font-semibold uppercase tracking-widest text-cyan-400 mb-4">
              Flight Log Replay
            </span>
          </AnimatedSection>
          <AnimatedSection delay={0.1}>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight mb-4">
              <span className="text-white">Replay a </span>
              <span className="gradient-text">mission log</span>
            </h2>
          </AnimatedSection>
          <AnimatedSection delay={0.2}>
            <p className="text-lg text-gray-400">
              Watch the drone replay its flight path with synchronized telemetry, AI decisions,
              and interactive 3D perspective controls.
            </p>
          </AnimatedSection>
        </div>

        <AnimatedSection delay={0.3}>
          <div className="glass rounded-2xl border border-white/10 overflow-hidden max-w-5xl mx-auto shadow-[0_0_50px_rgba(34,211,238,0.07)]">
            <div className="grid grid-cols-1 lg:grid-cols-3">
              {/* Map view */}
              <div className="lg:col-span-2 border-r border-white/[0.04]">
                <div className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse shadow-[0_0_8px_#22d3ee]" />
                      <span className="text-xs font-mono text-gray-300">
                        {logSource === 'ulog' ? '3D Tactical Flight Telemetry Map' : 'Mission Map'}
                      </span>
                    </div>

                    {logSource === 'ulog' && (
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => setZoomLevel(prev => Math.min(prev + 0.25, 3.0))}
                          className="p-1.5 rounded-lg border border-white/10 bg-white/5 hover:bg-cyan-500/20 hover:border-cyan-500/40 text-gray-300 hover:text-cyan-300 transition-all shadow-sm"
                          title="Zoom In"
                        >
                          <ZoomIn className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setZoomLevel(prev => Math.max(prev - 0.25, 0.4))}
                          className="p-1.5 rounded-lg border border-white/10 bg-white/5 hover:bg-cyan-500/20 hover:border-cyan-500/40 text-gray-300 hover:text-cyan-300 transition-all shadow-sm"
                          title="Zoom Out"
                        >
                          <ZoomOut className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => { setRotAngle(0.6); setTiltAngle(0.55); setZoomLevel(1.0); }}
                          className="text-[10px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1 px-2.5 py-1 rounded-lg border border-cyan-500/20 bg-cyan-500/10 hover:bg-cyan-500/20 transition-all shadow-sm"
                          title="Reset View"
                        >
                          <Eye className="w-3 h-3" /> Reset
                        </button>
                      </div>
                    )}
                  </div>

                  <div 
                    className="relative rounded-xl overflow-hidden border border-white/[0.08] bg-black cursor-grab active:cursor-grabbing select-none shadow-inner"
                    onMouseDown={(e) => {
                      isDraggingRef.current = true;
                      mousePosRef.current = { x: e.clientX, y: e.clientY };
                    }}
                    onMouseMove={(e) => {
                      if (!isDraggingRef.current) return;
                      const dx = e.clientX - mousePosRef.current.x;
                      const dy = e.clientY - mousePosRef.current.y;
                      mousePosRef.current = { x: e.clientX, y: e.clientY };
                      setRotAngle(prev => prev + dx * 0.012);
                      setTiltAngle(prev => Math.max(0.1, Math.min(Math.PI / 2 - 0.05, prev - dy * 0.012)));
                    }}
                    onMouseUp={() => { isDraggingRef.current = false; }}
                    onMouseLeave={() => { isDraggingRef.current = false; }}
                    onWheel={(e) => {
                      e.preventDefault();
                      setZoomLevel(prev => Math.max(0.4, Math.min(3.0, prev - e.deltaY * 0.0015)));
                    }}
                  >
                    <canvas
                      ref={mapCanvasRef}
                      className="w-full pointer-events-none block"
                      style={{ aspectRatio: `${FW}/${FH}`, imageRendering: 'auto' }}
                    />
                  </div>

                  {/* Unified Frosted-Glass Media Control Deck */}
                  <div className="mt-4 p-3 rounded-xl bg-white/[0.03] border border-white/[0.08] backdrop-blur-xl shadow-lg">
                    {/* Timeline Scrubber */}
                    <div
                      className="relative h-2.5 bg-black/60 rounded-full cursor-pointer overflow-visible group mb-3 border border-white/5"
                      onClick={e => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                        setPlaybackTime(pct * totalDuration);
                      }}
                    >
                      <div
                        className="absolute top-0 left-0 h-full bg-gradient-to-r from-cyan-500 via-blue-500 to-cyan-300 rounded-full shadow-[0_0_12px_rgba(34,211,238,0.7)]"
                        style={{ width: `${progressPct}%` }}
                      >
                        <div className="absolute right-0 top-1/2 -translate-y-1/2 w-4 h-4 bg-white rounded-full shadow-[0_0_10px_#22d3ee] border-2 border-cyan-400 scale-0 group-hover:scale-100 transition-transform" />
                      </div>
                    </div>

                    {/* Controls & Speed Multipliers Row */}
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setIsPlaying(!isPlaying)}
                          className="w-8 h-8 flex items-center justify-center rounded-lg border border-white/10 hover:border-cyan-500/40 text-gray-200 hover:text-cyan-300 transition-all bg-white/5 shadow-sm"
                        >
                          {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                        </button>
                        <button
                          onClick={() => { setPlaybackTime(0); setIsPlaying(false); }}
                          className="w-8 h-8 flex items-center justify-center rounded-lg border border-white/10 text-gray-400 hover:text-gray-200 transition-all bg-white/5 shadow-sm"
                          title="Reset Playback"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                        </button>

                        <div className="flex items-center bg-black/50 border border-white/10 rounded-lg p-0.5 shadow-inner">
                          {[1, 2, 5, 10].map((spd) => (
                            <button
                              key={spd}
                              onClick={() => setPlaybackSpeed(spd)}
                              className={`px-2 py-1 text-[10px] font-mono rounded-md transition-all ${
                                playbackSpeed === spd
                                  ? 'bg-cyan-500 text-black font-bold shadow-[0_0_10px_rgba(34,211,238,0.6)]'
                                  : 'text-gray-400 hover:text-gray-200'
                              }`}
                            >
                              {spd}x
                            </button>
                          ))}
                        </div>

                        <input
                          ref={ulogInputRef}
                          type="file"
                          accept=".ulg,.ulog"
                          className="hidden"
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            try {
                              const ulog = await parseULog(file);
                              const rawFrames = ulogToTelemetry(ulog);
                              
                              if (rawFrames.length > 0) {
                                const baseT = rawFrames[0]?.t || 0;
                                const initialAlt = rawFrames[0].altitude;
                                const minRawAlt = Math.min(...rawFrames.map(f => f.altitude));
                                const isInvertedNED = minRawAlt < -2 || (initialAlt < 0 && Math.abs(minRawAlt) > 2);

                                const frames: TelemetryFrame[] = rawFrames.map((f, idx) => {
                                  let correctedAlt = isInvertedNED ? -f.altitude : f.altitude;
                                  if (correctedAlt < 0) correctedAlt = Math.abs(correctedAlt);

                                  let calculatedSpeed = f.speed;
                                  if (idx > 0 && (calculatedSpeed === 0 || calculatedSpeed === undefined)) {
                                    const prev = rawFrames[idx - 1];
                                    const dt = (f.t - prev.t) || 0.1;
                                    const dLat = (f.lat - prev.lat) * 111000;
                                    const dLng = (f.lng - prev.lng) * 111000 * Math.cos(f.lat * Math.PI / 180);
                                    const dist = Math.sqrt(dLat * dLat + dLng * dLng);
                                    calculatedSpeed = Math.min(25, dist / dt);
                                  }

                                  const rawT = f.t !== undefined ? f.t : idx * 0.1;
                                  const normalizedT = Math.max(0, rawT - baseT);

                                  return {
                                    ...f,
                                    t: Number(normalizedT.toFixed(2)),
                                    altitude: Number(correctedAlt.toFixed(1)),
                                    speed: Number((calculatedSpeed || 0).toFixed(1)),
                                    roll: Number((f.roll || 0).toFixed(1)),
                                    pitch: Number((f.pitch || 0).toFixed(1)),
                                    heading: Number((f.heading || 0).toFixed(0)),
                                    battery: f.battery > 0 ? f.battery : Math.max(15, Math.floor(98 - (idx / rawFrames.length) * 20)),
                                    mode: f.mode || 'NAV_15',
                                    decision: f.decision || (calculatedSpeed > 1 ? 'Waypoints Navigation' : 'Hovering / Standby'),
                                  };
                                });

                                const lats = frames.map(f => f.lat).filter(l => !isNaN(l) && l !== 0);
                                const lngs = frames.map(f => f.lng).filter(l => !isNaN(l) && l !== 0);
                                const minAlt = Math.min(...frames.map(f => f.altitude));

                                if (lats.length > 0 && lngs.length > 0) {
                                  const minLat = Math.min(...lats);
                                  const maxLat = Math.max(...lats);
                                  const minLng = Math.min(...lngs);
                                  const maxLng = Math.max(...lngs);

                                  const centerLat = (minLat + maxLat) / 2;
                                  const centerLng = (minLng + maxLng) / 2;
                                  const cosLat = Math.cos((centerLat * Math.PI) / 180);

                                  const mapped = frames.map(f => ({
                                    ...f,
                                    mX: (f.lng - centerLng) * 111000 * cosLat,
                                    mY: (f.lat - centerLat) * 111000,
                                  }));

                                  const mXs = mapped.map(m => m.mX);
                                  const mYs = mapped.map(m => m.mY);
                                  const mMinX = Math.min(...mXs);
                                  const mMaxX = Math.max(...mXs);
                                  const mMinY = Math.min(...mYs);
                                  const mMaxY = Math.max(...mYs);

                                  const spanX = mMaxX - mMinX || 1;
                                  const spanY = mMaxY - mMinY || 1;
                                  const maxSpan = Math.max(spanX, spanY);

                                  const midX = (mMinX + mMaxX) / 2;
                                  const midY = (mMinY + mMaxY) / 2;

                                  rawCoordsRef.current = mapped.map(m => ({
                                    x: ((m.mX - midX) / maxSpan) * 120,
                                    y: -((m.mY - midY) / maxSpan) * 120,
                                    z: 10 + (m.altitude - minAlt) * 2.2,
                                  }));
                                } else {
                                  let currX = 0;
                                  let currY = 0;
                                  const tempCoords = frames.map((f, i) => {
                                    if (i > 0) {
                                      const prev = frames[i - 1];
                                      const dt = (f.t - prev.t) || 0.1;
                                      const headingRad = ((f.heading || 0) * Math.PI) / 180;
                                      const dist = (f.speed || 3) * dt;
                                      currX += Math.sin(headingRad) * dist * 3;
                                      currY -= Math.cos(headingRad) * dist * 3;
                                    }
                                    return { x: currX, y: currY, z: f.altitude };
                                  });
                                  const avgX = tempCoords.reduce((acc, c) => acc + c.x, 0) / tempCoords.length;
                                  const avgY = tempCoords.reduce((acc, c) => acc + c.y, 0) / tempCoords.length;

                                  rawCoordsRef.current = tempCoords.map((c, i) => ({
                                    x: c.x - avgX,
                                    y: c.y - avgY,
                                    z: 10 + (frames[i].altitude - minAlt) * 2.2,
                                  }));
                                }

                                setTelemetry(frames);
                                setLogSource('ulog');
                                setUlogFilename(file.name);
                                setPlaybackTime(0);
                                setIsPlaying(false);
                              }
                            } catch (err) {
                              console.error('Failed to parse ULog:', err);
                              alert('Failed to parse ULog file. Make sure it\'s a valid PX4 log.');
                            }
                          }}
                        />
                        <button
                          onClick={() => ulogInputRef.current?.click()}
                          className="flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-medium text-gray-300 border border-white/10 rounded-lg hover:text-white hover:border-cyan-500/40 transition-all bg-white/5 shadow-sm"
                          title="Upload PX4 .ulg flight log"
                        >
                          <Upload className="w-3 h-3 text-cyan-400" />
                          <span className="hidden sm:inline">Load .ulg</span>
                        </button>
                      </div>

                      <span className="text-xs text-cyan-400 font-mono font-semibold tracking-wide">
                        T+{playbackTime.toFixed(1)}s / T+{totalDuration.toFixed(1)}s
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Telemetry panel */}
              <div className="p-4 max-h-[500px] overflow-y-auto">
                <div className="flex items-center gap-2 mb-4">
                  <Activity className="w-4 h-4 text-cyan-400 animate-pulse" />
                  <span className="text-xs font-semibold text-white tracking-wide">Live Telemetry</span>
                  {logSource === 'ulog' && ulogFilename && (
                    <span className="text-[10px] text-cyan-400 px-2.5 py-0.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 truncate max-w-28 shadow-sm">
                      {ulogFilename}
                    </span>
                  )}
                </div>

                <div className="space-y-3">
                  <TelemetryRow label="Time" value={`T+${frame.t.toFixed(1)}s`} />
                  <TelemetryRow label="Mode" value={frame.mode} color={frame.mode === 'AUTO' || frame.mode === 'NAV_15' ? '#22d3ee' : '#f59e0b'} />
                  <TelemetryRow label="Altitude" value={`${frame.altitude.toFixed(1)} m`} />
                  <TelemetryRow label="Speed" value={`${frame.speed.toFixed(1)} m/s`} />
                  <TelemetryRow label="Heading" value={`${frame.heading.toFixed(0)}°`} />
                  <TelemetryRow label="Battery" value={`${frame.battery.toFixed(0)}%`} color={frame.battery > 70 ? '#22c55e' : frame.battery > 30 ? '#f59e0b' : '#ef4444'} />
                  <TelemetryRow label="Roll" value={`${frame.roll.toFixed(1)}°`} />
                  <TelemetryRow label="Pitch" value={`${frame.pitch.toFixed(1)}°`} />

                  <div className="pt-2 border-t border-white/10">
                    <TelemetryRow label="GPS Lat" value={frame.lat.toFixed(6)} />
                    <TelemetryRow label="GPS Lng" value={frame.lng.toFixed(6)} />
                  </div>

                  <div className="pt-2 border-t border-white/10">
                    <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">AI Decision</div>
                    <div className="text-xs text-cyan-300 font-mono p-2.5 rounded-xl bg-cyan-500/[0.07] border border-cyan-500/20 shadow-inner">
                      {frame.decision}
                    </div>
                  </div>

                  <div className="pt-2 border-t border-white/10">
                    <div className="flex justify-between items-center text-[10px] text-gray-400 mb-1.5 font-medium">
                      <span>Altitude Profile (Click to Jump)</span>
                      <span className="font-mono text-cyan-400 font-semibold">
                        {hoveredAltIdx !== null && sampledProfile[hoveredAltIdx]
                          ? `T+${sampledProfile[hoveredAltIdx].t.toFixed(1)}s : ${sampledProfile[hoveredAltIdx].altitude.toFixed(1)}m`
                          : `${frame.altitude.toFixed(1)} m`}
                      </span>
                    </div>
                    <div className="h-16 flex items-end gap-[2px] bg-black/60 p-1.5 rounded-xl border border-white/10 relative overflow-hidden shadow-inner">
                      {sampledProfile.map((sample, i) => {
                        const normalizedHeight = Math.max(
                          10,
                          ((sample.altitude - altitudeStats.min) / (altitudeStats.max - altitudeStats.min || 1)) * 100
                        );
                        const isActive = frameIdx >= sample.idx;

                        return (
                          <div
                            key={i}
                            onClick={() => {
                              setPlaybackTime(sample.t);
                            }}
                            onMouseEnter={() => setHoveredAltIdx(i)}
                            onMouseLeave={() => setHoveredAltIdx(null)}
                            className="flex-1 rounded-t-sm transition-all duration-150 cursor-pointer hover:bg-white"
                            style={{
                              height: `${normalizedHeight}%`,
                              backgroundColor: isActive ? '#22d3ee' : 'rgba(255, 255, 255, 0.12)',
                              boxShadow: isActive ? '0 0 8px rgba(34, 211, 238, 0.6)' : 'none',
                            }}
                          />
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

function TelemetryRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex justify-between items-center py-0.5">
      <span className="text-[10px] text-gray-400 uppercase tracking-wider font-medium">{label}</span>
      <span className="text-xs font-mono font-semibold" style={{ color: color || '#f3f4f6' }}>{value}</span>
    </div>
  );
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