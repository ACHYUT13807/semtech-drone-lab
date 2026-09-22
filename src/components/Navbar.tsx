import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Menu, X, ExternalLink, Sparkles } from 'lucide-react';
import { GitHubIcon } from './icons';

const navLinks = [
  { label: 'Pipeline', href: '#pipeline' },
  { label: 'Simulation', href: '#simulation' },
  { label: 'Playground', href: '#playground' },
  { label: 'Architecture', href: '#architecture' },
  { label: 'Benchmarks', href: '#benchmarks' },
  { label: 'Explorer', href: '#github-explorer' },
];

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [mobileOpen]);

  return (
    <>
      <motion.nav
        initial={{ y: -100 }}
        animate={{ y: 0 }}
        transition={{ duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] }}
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 ${
          scrolled
            ? 'glass py-3 shadow-2xl shadow-black/20'
            : 'bg-transparent py-5'
        }`}
      >
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            {/* Logo */}
            <a href="#pipeline" className="flex items-center gap-2.5 group">
              <div className="relative w-9 h-9 flex items-center justify-center">
                <div className="absolute inset-0 bg-gradient-to-br from-cyan-400 to-blue-500 rounded-lg opacity-20 group-hover:opacity-30 transition-opacity" />
                <svg viewBox="0 0 32 32" className="w-6 h-6 relative z-10" fill="none">
                  <path d="M16 4L28 10V22L16 28L4 22V10L16 4Z" stroke="url(#logo-grad)" strokeWidth="1.5" fill="none"/>
                  <path d="M16 4V28M4 10L28 22M28 10L4 22" stroke="url(#logo-grad)" strokeWidth="1" opacity="0.4"/>
                  <circle cx="16" cy="16" r="3" fill="url(#logo-grad)"/>
                  <defs>
                    <linearGradient id="logo-grad" x1="4" y1="4" x2="28" y2="28">
                      <stop stopColor="#22d3ee"/>
                      <stop offset="1" stopColor="#3b82f6"/>
                    </linearGradient>
                  </defs>
                </svg>
              </div>
              <span className="text-lg font-bold tracking-tight">
                <span className="text-white">Semtech</span>
                <span className="gradient-text-warm ml-0.5">Drone</span>
              </span>
              <span className="hidden sm:inline-flex items-center gap-1 ml-2 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                <Sparkles className="w-2.5 h-2.5" />
                Lab
              </span>
            </a>

            {/* Desktop Nav */}
            <div className="hidden xl:flex items-center gap-1">
              {navLinks.map((link) => (
                <a
                  key={link.label}
                  href={link.href}
                  className="px-3 py-2 text-sm text-gray-400 hover:text-white transition-colors duration-200 rounded-lg hover:bg-white/5"
                >
                  {link.label}
                </a>
              ))}
            </div>

            {/* Desktop CTA */}
            <div className="hidden lg:flex items-center gap-3">
              <a
                href="https://github.com/ACHYUT13807/semantic-drone-architecture"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-4 py-2 text-sm text-gray-300 hover:text-white border border-white/10 hover:border-white/20 rounded-lg transition-all duration-200 hover:bg-white/5"
              >
                <GitHubIcon className="w-4 h-4" />
                <span>GitHub</span>
              </a>
              <a
                href="#pipeline"
                className="btn-primary flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white rounded-lg"
              >
                <span className="relative z-10 flex items-center gap-2">
                  Try It Now
                  <ExternalLink className="w-3.5 h-3.5" />
                </span>
              </a>
            </div>

            {/* Mobile Menu Button */}
            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              className="xl:hidden p-2 text-gray-400 hover:text-white transition-colors"
              aria-label="Toggle menu"
            >
              {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </motion.nav>

      {/* Mobile Menu Overlay */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-40 xl:hidden"
          >
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="absolute right-0 top-0 bottom-0 w-80 max-w-[85vw] bg-[#0d1117] border-l border-white/5 p-6 pt-20"
            >
              <div className="flex flex-col gap-1">
                {navLinks.map((link) => (
                  <a
                    key={link.label}
                    href={link.href}
                    onClick={() => setMobileOpen(false)}
                    className="px-4 py-3 text-base text-gray-300 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
                  >
                    {link.label}
                  </a>
                ))}
                <div className="mt-4 pt-4 border-t border-white/5 flex flex-col gap-3">
                  <a
                    href="https://github.com/ACHYUT13807/semantic-drone-architecture"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 px-4 py-3 text-sm text-gray-300 border border-white/10 rounded-lg"
                  >
                    <GitHubIcon className="w-4 h-4" />
                    View on GitHub
                  </a>
                  <a
                    href="#pipeline"
                    onClick={() => setMobileOpen(false)}
                    className="btn-primary flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium text-white rounded-lg"
                  >
                    <span className="relative z-10">Try It Now</span>
                  </a>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
