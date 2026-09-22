import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Camera, Brain, Route, Cpu, Shield, Radio, ChevronRight, X, Code2, Gauge, BarChart3 } from 'lucide-react';
import AnimatedSection from './AnimatedSection';

interface ArchModule {
  id: string;
  name: string;
  icon: typeof Camera;
  color: string;
  fps: string;
  metric: string;
  metricLabel: string;
  description: string;
  inputs: string[];
  outputs: string[];
  codeSnippet: string;
  details: string[];
}

const modules: ArchModule[] = [
  {
    id: 'camera',
    name: 'Camera Input',
    icon: Camera,
    color: '#9ca3af',
    fps: '30',
    metric: '1280×720',
    metricLabel: 'Resolution',
    description: 'Captures RGB frames from the onboard monocular or stereo camera system at configurable resolution and frame rate.',
    inputs: ['Raw sensor data', 'Camera intrinsics'],
    outputs: ['RGB frame (H×W×3)', 'Timestamp', 'Camera pose'],
    codeSnippet: `class CameraInput:\n    def __init__(self, device="/dev/video0"):\n        self.cap = cv2.VideoCapture(device)\n        self.K = load_intrinsics()\n\n    def capture(self) -> Frame:\n        ret, frame = self.cap.read()\n        return Frame(rgb=frame, t=time.time())`,
    details: ['Supports USB, CSI, and IP cameras', 'Auto-exposure compensation', 'Frame synchronization with IMU'],
  },
  {
    id: 'segmentation',
    name: 'Semantic Segmentation',
    icon: Brain,
    color: '#8b5cf6',
    fps: '28',
    metric: '92.4%',
    metricLabel: 'mIoU',
    description: 'U-Net encoder-decoder architecture with EfficientNet-B3 backbone, trained on SemtechNav dataset with 5 semantic classes.',
    inputs: ['RGB frame (H×W×3)'],
    outputs: ['Segmentation mask (H×W)', 'Class probabilities (H×W×C)', 'Confidence map'],
    codeSnippet: `class SemanticSegmentor(nn.Module):\n    def __init__(self, num_classes=5):\n        self.encoder = EfficientNetB3(pretrained=True)\n        self.decoder = UNetDecoder(channels=[40,80,160])\n        self.head = nn.Conv2d(40, num_classes, 1)\n\n    def forward(self, x: Tensor) -> Tensor:\n        features = self.encoder(x)\n        decoded = self.decoder(features)\n        return self.head(decoded)`,
    details: ['TensorRT INT8 quantized for edge', 'Multi-scale feature fusion', 'Online adaptation with 10% head fine-tuning'],
  },
  {
    id: 'costmap',
    name: 'Costmap Generator',
    icon: Route,
    color: '#f59e0b',
    fps: '30',
    metric: '< 3ms',
    metricLabel: 'Latency',
    description: 'Converts semantic segmentation into a 2D navigation cost grid with configurable obstacle inflation for safe clearance margins.',
    inputs: ['Segmentation mask', 'Inflation radius', 'Class cost weights'],
    outputs: ['Cost grid (H×W)', 'Binary occupancy', 'Inflated obstacle map'],
    codeSnippet: `def generate_costmap(\n    seg_mask: np.ndarray,\n    inflation: int = 5,\n    costs: dict = CLASS_COSTS\n) -> np.ndarray:\n    base = np.vectorize(costs.get)(seg_mask)\n    kernel = disk(inflation)\n    obstacles = (base >= 0.9).astype(float)\n    inflated = cv2.dilate(obstacles, kernel)\n    return np.maximum(base, inflated * 0.8)`,
    details: ['Configurable per-class cost weights', 'Distance-based inflation falloff', 'GPU-accelerated with CUDA kernels'],
  },
  {
    id: 'planner',
    name: 'Path Planner',
    icon: Cpu,
    color: '#22d3ee',
    fps: '20',
    metric: '1.04×',
    metricLabel: 'Path Optimality',
    description: 'A* search with custom heuristics on the cost grid. Finds globally optimal paths in real-time with configurable cost functions.',
    inputs: ['Cost grid', 'Start position', 'Goal position', 'Heuristic weights'],
    outputs: ['Waypoint sequence', 'Total path cost', 'Explored node set'],
    codeSnippet: `def plan_path(\n    costmap: np.ndarray,\n    start: Tuple[int, int],\n    goal: Tuple[int, int]\n) -> List[Tuple[int, int]]:\n    open_set = PriorityQueue()\n    open_set.put((0, start))\n    g_score = {start: 0}\n    # 8-connected A* with diagonal cost\n    while not open_set.empty():\n        _, current = open_set.get()\n        if current == goal:\n            return reconstruct(came_from, current)`,
    details: ['8-connected grid search', 'Diagonal movement with √2 cost', 'Fallback to Dijkstra if A* fails'],
  },
  {
    id: 'safety',
    name: 'Safety Monitor',
    icon: Shield,
    color: '#22c55e',
    fps: '100',
    metric: '99.2%',
    metricLabel: 'Avoidance Rate',
    description: 'Control barrier functions ensure formal safety constraints. Monitors all planned actions and vetoes unsafe commands.',
    inputs: ['Planned trajectory', 'Current state', 'Obstacle map', 'Battery level'],
    outputs: ['Safe/unsafe flag', 'Modified trajectory', 'Emergency stop signal'],
    codeSnippet: `class SafetyMonitor:\n    def check(self, trajectory, state, obstacles):\n        for wp in trajectory:\n            cbf = self.barrier_fn(wp, obstacles)\n            if cbf < self.margin:\n                return SafeAction.REROUTE\n        if state.battery < 15:\n            return SafeAction.RTL\n        return SafeAction.PROCEED`,
    details: ['Control Barrier Functions (CBF)', 'Geofence enforcement', 'Graceful degradation to hover mode'],
  },
  {
    id: 'px4',
    name: 'PX4 Controller',
    icon: Radio,
    color: '#ef4444',
    fps: '400',
    metric: 'MAVLink',
    metricLabel: 'Protocol',
    description: 'Translates planned waypoints into low-level motor commands via PX4 autopilot over MAVLink protocol.',
    inputs: ['Waypoint sequence', 'Safety flags', 'PID gains'],
    outputs: ['Motor PWM signals', 'Telemetry stream', 'Flight mode'],
    codeSnippet: `class PX4Controller:\n    def __init__(self, connection="udp://127.0.0.1:14540"):\n        self.vehicle = connect(connection)\n        self.vehicle.mode = VehicleMode("GUIDED")\n\n    def fly_to(self, waypoints):\n        for wp in waypoints:\n            cmd = LocationGlobalRelative(\n                wp.lat, wp.lng, wp.alt)\n            self.vehicle.simple_goto(cmd)`,
    details: ['MAVLink v2 protocol', 'PID + Neural adaptive control', 'Supports PX4 and ArduPilot'],
  },
];

export default function InteractiveArchitecture() {
  const [selectedModule, setSelectedModule] = useState<string | null>(null);
  const selected = modules.find(m => m.id === selectedModule);

  return (
    <section id="architecture" className="relative py-24 sm:py-32">
      <div className="absolute inset-0 radial-glow-center" />
      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-3xl mx-auto mb-12">
          <AnimatedSection>
            <span className="inline-block text-xs font-semibold uppercase tracking-widest text-cyan-400 mb-4">
              Interactive Architecture
            </span>
          </AnimatedSection>
          <AnimatedSection delay={0.1}>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight mb-4">
              <span className="text-white">Click any module to </span>
              <span className="gradient-text">explore</span>
            </h2>
          </AnimatedSection>
          <AnimatedSection delay={0.2}>
            <p className="text-lg text-gray-400">
              Every component is interactive. Click to see model architecture, I/O specs, performance metrics, and live code.
            </p>
          </AnimatedSection>
        </div>

        <AnimatedSection delay={0.3}>
          {/* Pipeline flow */}
          <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3 mb-8">
            {modules.map((mod, i) => (
              <div key={mod.id} className="flex items-center gap-2 sm:gap-3">
                <motion.button
                  whileHover={{ scale: 1.05, y: -2 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => setSelectedModule(selectedModule === mod.id ? null : mod.id)}
                  className={`flex items-center gap-2 px-3 sm:px-4 py-2.5 sm:py-3 rounded-xl border transition-all duration-300 ${
                    selectedModule === mod.id
                      ? 'bg-white/[0.06] shadow-lg'
                      : 'border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] hover:border-white/10'
                  }`}
                  style={{
                    borderColor: selectedModule === mod.id ? mod.color + '50' : undefined,
                    boxShadow: selectedModule === mod.id ? `0 0 20px ${mod.color}15` : undefined,
                  }}
                >
                  <mod.icon className="w-4 h-4" style={{ color: mod.color }} />
                  <span className="text-xs sm:text-sm font-medium text-gray-300 hidden sm:inline">{mod.name}</span>
                  <span className="text-xs sm:text-sm font-medium text-gray-300 sm:hidden">{mod.name.split(' ')[0]}</span>
                </motion.button>
                {i < modules.length - 1 && (
                  <ChevronRight className="w-3.5 h-3.5 text-gray-700 hidden sm:block" />
                )}
              </div>
            ))}
          </div>

          {/* Module detail panel */}
          <AnimatePresence mode="wait">
            {selected && (
              <motion.div
                key={selected.id}
                initial={{ opacity: 0, y: 20, height: 0 }}
                animate={{ opacity: 1, y: 0, height: 'auto' }}
                exit={{ opacity: 0, y: -10, height: 0 }}
                transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
                className="overflow-hidden"
              >
                <div className="glass rounded-2xl border border-white/10 p-6 sm:p-8">
                  {/* Header */}
                  <div className="flex items-start justify-between mb-6">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                        style={{ backgroundColor: selected.color + '15' }}>
                        <selected.icon className="w-5 h-5" style={{ color: selected.color }} />
                      </div>
                      <div>
                        <h3 className="text-lg font-semibold text-white">{selected.name}</h3>
                        <p className="text-sm text-gray-500">{selected.description}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => setSelectedModule(null)}
                      className="p-2 text-gray-600 hover:text-gray-300 transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Metrics */}
                    <div className="space-y-4">
                      <div className="grid grid-cols-3 gap-3">
                        <MetricCard icon={Gauge} label={selected.metricLabel} value={selected.metric} color={selected.color} />
                        <MetricCard icon={BarChart3} label="FPS" value={selected.fps} color={selected.color} />
                        <MetricCard icon={Code2} label="Lines" value={`~${200 + modules.indexOf(selected) * 150}`} color={selected.color} />
                      </div>

                      {/* I/O */}
                      <div className="p-4 rounded-xl border border-white/[0.06] bg-white/[0.02]">
                        <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Inputs</h4>
                        <ul className="space-y-1.5 mb-4">
                          {selected.inputs.map(inp => (
                            <li key={inp} className="flex items-center gap-2 text-xs text-gray-500">
                              <div className="w-1 h-1 rounded-full bg-green-500" />
                              {inp}
                            </li>
                          ))}
                        </ul>
                        <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Outputs</h4>
                        <ul className="space-y-1.5">
                          {selected.outputs.map(out => (
                            <li key={out} className="flex items-center gap-2 text-xs text-gray-500">
                              <div className="w-1 h-1 rounded-full bg-blue-500" />
                              {out}
                            </li>
                          ))}
                        </ul>
                      </div>

                      {/* Details */}
                      <div className="p-4 rounded-xl border border-white/[0.06] bg-white/[0.02]">
                        <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Key Details</h4>
                        <ul className="space-y-1.5">
                          {selected.details.map(d => (
                            <li key={d} className="flex items-start gap-2 text-xs text-gray-500">
                              <div className="w-1 h-1 rounded-full mt-1.5 flex-shrink-0" style={{ backgroundColor: selected.color }} />
                              {d}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>

                    {/* Code snippet */}
                    <div className="lg:col-span-2">
                      <div className="rounded-xl border border-white/[0.06] bg-[#0a0c10] overflow-hidden h-full">
                        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/[0.04] bg-white/[0.02]">
                          <div className="flex gap-1">
                            <div className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
                            <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
                            <div className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
                          </div>
                          <span className="text-[10px] text-gray-600 font-mono">{selected.id}.py</span>
                        </div>
                        <pre className="p-4 sm:p-6 text-xs sm:text-sm font-mono text-gray-400 leading-relaxed overflow-x-auto whitespace-pre">
                          {highlightPython(selected.codeSnippet)}
                        </pre>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Prompt if nothing selected */}
          {!selected && (
            <div className="text-center py-8 text-gray-600 text-sm">
              ↑ Click any module above to explore its architecture, metrics, and code
            </div>
          )}
        </AnimatedSection>
      </div>
    </section>
  );
}

function MetricCard({ icon: Icon, label, value, color }: { icon: typeof Gauge; label: string; value: string; color: string }) {
  return (
    <div className="p-3 rounded-xl border border-white/[0.06] bg-white/[0.02] text-center">
      <Icon className="w-4 h-4 mx-auto mb-1.5" style={{ color }} />
      <div className="text-sm font-bold text-white">{value}</div>
      <div className="text-[10px] text-gray-600">{label}</div>
    </div>
  );
}

function highlightPython(code: string): React.ReactNode {
  const lines = code.split('\n');

  return (
    <>
      {lines.map((line, i) => {
        // Comment
        if (line.trim().startsWith('#')) {
          return <div key={i}><span className="text-gray-600">{line}</span></div>;
        }

        let result = line;
        // Very basic highlighting
        let colored = result
          .replace(/(["'])(.*?)\1/g, '<str>$1$2$1</str>')
          .replace(/\b(class|def|import|from|return|for|in|if|while|not|self|True|False|None)\b/g, '<kw>$1</kw>');

        const parts: React.ReactNode[] = [];
        let remaining = colored;
        let key = 0;
        while (remaining.length > 0) {
          const kwMatch = remaining.match(/<kw>(.*?)<\/kw>/);
          const strMatch = remaining.match(/<str>(.*?)<\/str>/);

          const kwIdx = kwMatch ? remaining.indexOf(kwMatch[0]) : Infinity;
          const strIdx = strMatch ? remaining.indexOf(strMatch[0]) : Infinity;

          if (kwIdx === Infinity && strIdx === Infinity) {
            parts.push(<span key={key++}>{cleanTags(remaining)}</span>);
            break;
          }

          if (kwIdx < strIdx && kwMatch) {
            parts.push(<span key={key++}>{cleanTags(remaining.slice(0, kwIdx))}</span>);
            parts.push(<span key={key++} className="text-purple-400">{kwMatch[1]}</span>);
            remaining = remaining.slice(kwIdx + kwMatch[0].length);
          } else if (strMatch) {
            parts.push(<span key={key++}>{cleanTags(remaining.slice(0, strIdx))}</span>);
            parts.push(<span key={key++} className="text-green-400">{strMatch[1]}</span>);
            remaining = remaining.slice(strIdx + strMatch[0].length);
          }
        }

        return <div key={i}>{parts}</div>;
      })}
    </>
  );
}

function cleanTags(s: string): string {
  return s.replace(/<\/?(?:kw|str)>/g, '');
}
