import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { BarChart3, Cpu, Gauge, Battery, Timer, Layers } from 'lucide-react';
import AnimatedSection from './AnimatedSection';

interface BenchmarkEntry {
  model: string;
  hardware: string;
  roadIoU: number;
  fps: number;
  latency: number;
  cpuPercent: number;
  gpuPercent: number;
  batteryPerHour: number;
  pathOptimality: number;
}

const benchmarks: BenchmarkEntry[] = [
  { model: 'SemtechSeg-v3', hardware: 'Jetson Orin', roadIoU: 92.4, fps: 28, latency: 48, cpuPercent: 45, gpuPercent: 82, batteryPerHour: 18, pathOptimality: 1.04 },
  { model: 'SemtechSeg-v3', hardware: 'RTX 4090', roadIoU: 92.4, fps: 120, latency: 12, cpuPercent: 15, gpuPercent: 35, batteryPerHour: 0, pathOptimality: 1.04 },
  { model: 'SemtechSeg-v2', hardware: 'Jetson Orin', roadIoU: 89.1, fps: 22, latency: 62, cpuPercent: 52, gpuPercent: 78, batteryPerHour: 22, pathOptimality: 1.08 },
  { model: 'SemtechSeg-v2', hardware: 'Jetson Nano', roadIoU: 89.1, fps: 8, latency: 145, cpuPercent: 88, gpuPercent: 95, batteryPerHour: 30, pathOptimality: 1.08 },
  { model: 'DeepLabV3+', hardware: 'Jetson Orin', roadIoU: 86.2, fps: 15, latency: 85, cpuPercent: 60, gpuPercent: 88, batteryPerHour: 25, pathOptimality: 1.12 },
  { model: 'DeepLabV3+', hardware: 'RTX 4090', roadIoU: 86.2, fps: 95, latency: 18, cpuPercent: 12, gpuPercent: 28, batteryPerHour: 0, pathOptimality: 1.12 },
  { model: 'SegFormer-B2', hardware: 'Jetson Orin', roadIoU: 88.7, fps: 18, latency: 72, cpuPercent: 55, gpuPercent: 85, batteryPerHour: 24, pathOptimality: 1.09 },
  { model: 'BiSeNet-v2', hardware: 'Jetson Orin', roadIoU: 82.5, fps: 35, latency: 38, cpuPercent: 38, gpuPercent: 70, batteryPerHour: 15, pathOptimality: 1.15 },
  { model: 'BiSeNet-v2', hardware: 'Jetson Nano', roadIoU: 82.5, fps: 14, latency: 95, cpuPercent: 75, gpuPercent: 92, batteryPerHour: 28, pathOptimality: 1.15 },
];

type MetricKey = 'roadIoU' | 'fps' | 'latency' | 'cpuPercent' | 'gpuPercent' | 'batteryPerHour';

const metrics: { key: MetricKey; label: string; icon: typeof BarChart3; unit: string; color: string; higherBetter: boolean }[] = [
  { key: 'roadIoU', label: 'Road IoU', icon: Layers, unit: '%', color: '#8b5cf6', higherBetter: true },
  { key: 'fps', label: 'FPS', icon: Gauge, unit: '', color: '#22d3ee', higherBetter: true },
  { key: 'latency', label: 'Latency', icon: Timer, unit: 'ms', color: '#f59e0b', higherBetter: false },
  { key: 'cpuPercent', label: 'CPU Usage', icon: Cpu, unit: '%', color: '#ef4444', higherBetter: false },
  { key: 'gpuPercent', label: 'GPU Usage', icon: BarChart3, unit: '%', color: '#22c55e', higherBetter: false },
  { key: 'batteryPerHour', label: 'Battery/hr', icon: Battery, unit: '%', color: '#f97316', higherBetter: false },
];

export default function BenchmarkDashboard() {
  const [selectedMetric, setSelectedMetric] = useState<MetricKey>('roadIoU');
  const [filterModel, setFilterModel] = useState<string>('all');
  const [filterHardware, setFilterHardware] = useState<string>('all');

  const models = useMemo(() => [...new Set(benchmarks.map(b => b.model))], []);
  const hardware = useMemo(() => [...new Set(benchmarks.map(b => b.hardware))], []);

  const metric = metrics.find(m => m.key === selectedMetric)!;

  const filtered = useMemo(() => {
    return benchmarks.filter(b =>
      (filterModel === 'all' || b.model === filterModel) &&
      (filterHardware === 'all' || b.hardware === filterHardware)
    );
  }, [filterModel, filterHardware]);

  const maxVal = Math.max(...filtered.map(b => b[selectedMetric]));

  return (
    <section id="benchmarks" className="relative py-24 sm:py-32">
      <div className="absolute inset-0 radial-glow-center" />
      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-3xl mx-auto mb-12">
          <AnimatedSection>
            <span className="inline-block text-xs font-semibold uppercase tracking-widest text-cyan-400 mb-4">
              Benchmark Dashboard
            </span>
          </AnimatedSection>
          <AnimatedSection delay={0.1}>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight mb-4">
              <span className="text-white">Live </span>
              <span className="gradient-text">performance metrics</span>
            </h2>
          </AnimatedSection>
          <AnimatedSection delay={0.2}>
            <p className="text-lg text-gray-400">
              Compare models and hardware configurations across Road IoU, FPS, latency, CPU/GPU usage, and battery consumption.
            </p>
          </AnimatedSection>
        </div>

        <AnimatedSection delay={0.3}>
          <div className="glass rounded-2xl border border-white/10 overflow-hidden">
            <div className="p-4 sm:p-6 lg:p-8">
              {/* Controls */}
              <div className="flex flex-wrap items-center gap-4 mb-8">
                {/* Metric selector */}
                <div className="flex flex-wrap gap-1.5">
                  {metrics.map(m => (
                    <button
                      key={m.key}
                      onClick={() => setSelectedMetric(m.key)}
                      className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border transition-all ${
                        selectedMetric === m.key
                          ? 'border-opacity-40 bg-opacity-10 text-white'
                          : 'border-white/[0.06] text-gray-500 hover:text-gray-300 hover:border-white/10'
                      }`}
                      style={{
                        borderColor: selectedMetric === m.key ? m.color + '60' : undefined,
                        backgroundColor: selectedMetric === m.key ? m.color + '15' : undefined,
                        color: selectedMetric === m.key ? m.color : undefined,
                      }}
                    >
                      <m.icon className="w-3 h-3" />
                      <span className="hidden sm:inline">{m.label}</span>
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-2 ml-auto">
                  <select
                    value={filterModel}
                    onChange={e => setFilterModel(e.target.value)}
                    className="text-xs bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-gray-300 appearance-none cursor-pointer"
                  >
                    <option value="all">All Models</option>
                    {models.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                  <select
                    value={filterHardware}
                    onChange={e => setFilterHardware(e.target.value)}
                    className="text-xs bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-gray-300 appearance-none cursor-pointer"
                  >
                    <option value="all">All Hardware</option>
                    {hardware.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              </div>

              {/* Bar chart */}
              <div className="space-y-3 mb-8">
                {filtered.map((entry, i) => {
                  const val = entry[selectedMetric];
                  const pct = maxVal > 0 ? (val / maxVal) * 100 : 0;
                  const isBest = metric.higherBetter ? val === maxVal : val === Math.min(...filtered.map(b => b[selectedMetric]));

                  return (
                    <motion.div
                      key={`${entry.model}-${entry.hardware}`}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.05 }}
                      className={`group flex items-center gap-4 p-3 rounded-xl border transition-all hover:bg-white/[0.02] ${
                        isBest ? 'border-white/10 bg-white/[0.02]' : 'border-white/[0.04]'
                      }`}
                    >
                      <div className="w-32 sm:w-40 flex-shrink-0">
                        <div className="text-xs font-medium text-white truncate">{entry.model}</div>
                        <div className="text-[10px] text-gray-600">{entry.hardware}</div>
                      </div>

                      <div className="flex-1 relative h-6 bg-white/[0.04] rounded-full overflow-hidden">
                        <motion.div
                          className="absolute top-0 left-0 h-full rounded-full bar-animate"
                          style={{
                            width: `${pct}%`,
                            background: `linear-gradient(90deg, ${metric.color}40, ${metric.color})`,
                          }}
                          initial={{ scaleX: 0 }}
                          animate={{ scaleX: 1 }}
                          transition={{ duration: 0.6, delay: i * 0.05 }}
                        />
                        {isBest && (
                          <div className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] font-bold text-white/60">
                            BEST
                          </div>
                        )}
                      </div>

                      <div className="w-20 text-right flex-shrink-0">
                        <span className="text-sm font-bold font-mono" style={{ color: metric.color }}>
                          {val}
                        </span>
                        <span className="text-[10px] text-gray-600 ml-0.5">{metric.unit}</span>
                      </div>
                    </motion.div>
                  );
                })}
              </div>

              {/* Summary stats */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                {metrics.map(m => {
                  const bestEntry = filtered.reduce((best, cur) =>
                    m.higherBetter
                      ? (cur[m.key] > best[m.key] ? cur : best)
                      : (cur[m.key] < best[m.key] ? cur : best),
                    filtered[0]
                  );
                  const bestVal = bestEntry?.[m.key] ?? 0;

                  return (
                    <motion.div
                      key={m.key}
                      whileHover={{ scale: 1.03 }}
                      onClick={() => setSelectedMetric(m.key)}
                      className={`p-3 rounded-xl border cursor-pointer transition-all ${
                        selectedMetric === m.key
                          ? 'border-opacity-30 bg-opacity-5'
                          : 'border-white/[0.06] bg-white/[0.02] hover:border-white/10'
                      }`}
                      style={{
                        borderColor: selectedMetric === m.key ? m.color + '50' : undefined,
                        backgroundColor: selectedMetric === m.key ? m.color + '08' : undefined,
                      }}
                    >
                      <m.icon className="w-4 h-4 mb-1.5" style={{ color: m.color }} />
                      <div className="text-lg font-bold text-white font-mono">{bestVal}<span className="text-xs text-gray-500">{m.unit}</span></div>
                      <div className="text-[10px] text-gray-500">{m.label} (best)</div>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          </div>
        </AnimatedSection>
      </div>
    </section>
  );
}
