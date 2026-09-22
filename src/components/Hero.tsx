import { motion } from 'framer-motion';
import { ArrowRight, Sparkles, Cpu, Eye, Route, BarChart3, FlaskConical, Play } from 'lucide-react';
import { GitHubIcon } from './icons';
import AnimatedSection from './AnimatedSection';

const labModules = [
  { icon: Eye, label: 'Interactive Pipeline', desc: 'Camera → Segmentation → Planner → PX4', color: '#8b5cf6' },
  { icon: Route, label: '3D Simulation', desc: 'Fly a virtual drone across views', color: '#22d3ee' },
  { icon: FlaskConical, label: 'Research Playground', desc: 'Tweak parameters in real-time', color: '#22c55e' },
  { icon: Cpu, label: 'Architecture Explorer', desc: 'Click any module to inspect', color: '#f59e0b' },
  { icon: BarChart3, label: 'Benchmark Dashboard', desc: 'Compare models & hardware', color: '#ef4444' },
  { icon: Play, label: 'Flight Log Replay', desc: 'Replay missions with telemetry', color: '#60a5fa' },
];

export default function Hero() {
  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden pt-20">
      {/* Background layers */}
      <div className="absolute inset-0 grid-bg" />
      <div className="absolute inset-0 radial-glow-top" />
      
      {/* Animated orbs */}
      <motion.div
        animate={{ x: [0, 30, 0], y: [0, -20, 0], scale: [1, 1.1, 1] }}
        transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }}
        className="absolute top-1/4 left-1/4 w-96 h-96 bg-cyan-500/5 rounded-full blur-[100px]"
      />
      <motion.div
        animate={{ x: [0, -20, 0], y: [0, 30, 0], scale: [1, 1.15, 1] }}
        transition={{ duration: 15, repeat: Infinity, ease: 'easeInOut' }}
        className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-blue-500/5 rounded-full blur-[100px]"
      />
      <motion.div
        animate={{ x: [0, 15, 0], y: [0, -15, 0] }}
        transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
        className="absolute top-1/3 right-1/3 w-64 h-64 bg-purple-500/[0.04] rounded-full blur-[80px]"
      />

      <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12 md:py-20">
        <div className="text-center max-w-5xl mx-auto">
          {/* Badge */}
          <AnimatedSection delay={0.1}>
            <motion.div
              whileHover={{ scale: 1.02 }}
              className="inline-flex items-center gap-2 px-4 py-2 mb-8 rounded-full glass border border-cyan-500/20 text-sm"
            >
              <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
              <span className="text-cyan-300 font-medium">Browser-Based Robotics Lab</span>
              <span className="w-px h-3.5 bg-white/10" />
              <span className="text-gray-400">Everything runs client-side</span>
            </motion.div>
          </AnimatedSection>

          {/* Heading */}
          <AnimatedSection delay={0.2}>
            <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight leading-[1.08] mb-6">
              <span className="text-white">Semtech </span>
              <span className="gradient-text">Drone Lab</span>
            </h1>
          </AnimatedSection>

          {/* Subheading */}
          <AnimatedSection delay={0.35}>
            <p className="text-lg sm:text-xl text-gray-400 max-w-3xl mx-auto mb-10 leading-relaxed">
              Don't just read about autonomous drone navigation —{' '}
              <span className="text-white font-medium">experiment with it</span>. Upload images, run real 
              segmentation and path planning algorithms, fly a virtual drone, tweak parameters, and explore 
              benchmarks — all live in your browser.
            </p>
          </AnimatedSection>

          {/* CTA Buttons */}
          <AnimatedSection delay={0.5}>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16">
              <motion.a
                href="#pipeline"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="btn-primary flex items-center gap-3 px-8 py-4 text-base font-semibold text-white rounded-xl w-full sm:w-auto justify-center"
              >
                <span className="relative z-10 flex items-center gap-3">
                  <FlaskConical className="w-5 h-5" />
                  Launch the Lab
                  <ArrowRight className="w-4 h-4" />
                </span>
              </motion.a>
              <motion.a
                href="https://github.com/ACHYUT13807/semantic-drone-architecture"
                target="_blank"
                rel="noopener noreferrer"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="flex items-center gap-3 px-8 py-4 text-base font-medium text-gray-300 hover:text-white border border-white/10 hover:border-white/20 rounded-xl transition-all duration-300 hover:bg-white/5 w-full sm:w-auto justify-center"
              >
                <GitHubIcon className="w-5 h-5" />
                View Source Code
              </motion.a>
            </div>
          </AnimatedSection>

          {/* Stats row */}
          <AnimatedSection delay={0.6}>
            <div className="flex flex-wrap items-center justify-center gap-8 sm:gap-12 mb-16">
              {[
                { value: '99.2%', label: 'Obstacle Avoidance' },
                { value: '< 50ms', label: 'Inference Latency' },
                { value: '2.4k+', label: 'GitHub Stars' },
                { value: '6', label: 'Interactive Modules' },
              ].map((stat) => (
                <div key={stat.label} className="text-center">
                  <div className="text-2xl sm:text-3xl font-bold text-white mb-1">{stat.value}</div>
                  <div className="text-xs sm:text-sm text-gray-500">{stat.label}</div>
                </div>
              ))}
            </div>
          </AnimatedSection>

          {/* Lab module cards */}
          <AnimatedSection delay={0.75}>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 max-w-5xl mx-auto">
              {labModules.map((mod, i) => (
                <motion.a
                  key={mod.label}
                  href={`#${mod.label.toLowerCase().replace(/\s+/g, '-').replace('3d-', '')}`}
                  whileHover={{ y: -4, scale: 1.02 }}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.8 + i * 0.08, duration: 0.4 }}
                  className="group p-4 rounded-xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] hover:border-white/10 transition-all duration-300 text-center"
                >
                  <div className="w-8 h-8 rounded-lg mx-auto mb-2 flex items-center justify-center"
                    style={{ backgroundColor: mod.color + '15' }}>
                    <mod.icon className="w-4 h-4" style={{ color: mod.color }} />
                  </div>
                  <div className="text-xs font-medium text-gray-300 mb-1">{mod.label}</div>
                  <div className="text-[10px] text-gray-600 leading-tight">{mod.desc}</div>
                </motion.a>
              ))}
            </div>
          </AnimatedSection>
        </div>
      </div>

      {/* Bottom gradient fade */}
      <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-[#06080d] to-transparent" />
    </section>
  );
}
