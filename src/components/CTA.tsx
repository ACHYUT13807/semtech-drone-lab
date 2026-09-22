import { motion } from 'framer-motion';
import { ArrowRight, Star } from 'lucide-react';
import { GitHubIcon } from './icons';
import AnimatedSection from './AnimatedSection';

export default function CTA() {
  return (
    <section id="cta" className="relative py-24 sm:py-32 overflow-hidden">
      {/* Background effects */}
      <div className="absolute inset-0">
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-cyan-500/[0.03] to-transparent" />
        <motion.div
          animate={{ scale: [1, 1.1, 1], opacity: [0.3, 0.5, 0.3] }}
          transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-cyan-500/5 rounded-full blur-[120px]"
        />
      </div>

      <div className="relative mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 text-center">
        <AnimatedSection>
          <div className="inline-flex items-center gap-2 px-4 py-2 mb-8 rounded-full glass border border-cyan-500/20 text-sm">
            <Star className="w-3.5 h-3.5 text-yellow-500 fill-yellow-500" />
            <span className="text-gray-400">Star us on GitHub — it helps a lot!</span>
          </div>
        </AnimatedSection>

        <AnimatedSection delay={0.1}>
          <h2 className="text-3xl sm:text-4xl lg:text-6xl font-bold tracking-tight mb-6">
            <span className="text-white">Ready to build </span>
            <span className="gradient-text">autonomous drones</span>
            <span className="text-white">?</span>
          </h2>
        </AnimatedSection>

        <AnimatedSection delay={0.2}>
          <p className="text-lg sm:text-xl text-gray-400 max-w-2xl mx-auto mb-10 leading-relaxed">
            You've run the algorithms, explored the architecture, and benchmarked the models.
            Now take Semtech Drone to your lab. Clone, customize, and fly.
          </p>
        </AnimatedSection>

        <AnimatedSection delay={0.3}>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-12">
            <motion.a
              href="https://github.com/ACHYUT13807/semantic-drone-architecture"
              target="_blank"
              rel="noopener noreferrer"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="btn-primary flex items-center gap-3 px-8 py-4 text-base font-semibold text-white rounded-xl w-full sm:w-auto justify-center"
            >
              <span className="relative z-10 flex items-center gap-3">
                <GitHubIcon className="w-5 h-5" />
                Clone the Repository
                <ArrowRight className="w-4 h-4" />
              </span>
            </motion.a>
            <div className="flex items-center gap-3 px-8 py-4 text-base font-medium text-gray-500 border border-white/10 rounded-xl w-full sm:w-auto justify-center">
              <span>Research paper link not published</span>
            </div>
          </div>
        </AnimatedSection>

        <AnimatedSection delay={0.4}>
          <p className="text-sm text-gray-500">
            Source code and project status are maintained in the linked GitHub repository.
          </p>
        </AnimatedSection>
      </div>
    </section>
  );
}
