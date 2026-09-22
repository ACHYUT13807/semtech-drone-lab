import { GitHubIcon } from './icons';

const footerLinks = {
  'Lab Modules': [
    { label: 'Interactive Pipeline', href: '#pipeline' },
    { label: '3D Simulation', href: '#simulation' },
    { label: 'Research Playground', href: '#playground' },
    { label: 'Architecture Explorer', href: '#architecture' },
    { label: 'Flight Replay', href: '#flight-replay' },
  ],
  Data: [
    { label: 'Benchmark Dashboard', href: '#benchmarks' },
    { label: 'GitHub Explorer', href: '#github-explorer' },
    { label: 'Interactive Pipeline', href: '#pipeline' },
    { label: 'Research Playground', href: '#playground' },
  ],
  Research: [
    { label: 'Architecture Explorer', href: '#architecture' },
    { label: 'Flight Replay', href: '#flight-replay' },
    { label: 'Benchmarks', href: '#benchmarks' },
    { label: 'Source Repository', href: 'https://github.com/ACHYUT13807/semantic-drone-architecture' },
  ],
  Community: [
    { label: 'GitHub', href: 'https://github.com/ACHYUT13807/semantic-drone-architecture' },
  ],
};

export default function Footer() {
  return (
    <footer className="relative border-t border-white/[0.04] bg-[#050709]">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Main footer */}
        <div className="py-16 grid grid-cols-2 md:grid-cols-6 gap-8 lg:gap-12">
          {/* Brand column */}
          <div className="col-span-2">
            <a href="#pipeline" className="flex items-center gap-2.5 mb-5">
              <div className="relative w-8 h-8 flex items-center justify-center">
                <div className="absolute inset-0 bg-gradient-to-br from-cyan-400 to-blue-500 rounded-lg opacity-20" />
                <svg viewBox="0 0 32 32" className="w-5 h-5 relative z-10" fill="none">
                  <path d="M16 4L28 10V22L16 28L4 22V10L16 4Z" stroke="url(#logo-grad-footer)" strokeWidth="1.5" fill="none"/>
                  <circle cx="16" cy="16" r="3" fill="url(#logo-grad-footer)"/>
                  <defs>
                    <linearGradient id="logo-grad-footer" x1="4" y1="4" x2="28" y2="28">
                      <stop stopColor="#22d3ee"/>
                      <stop offset="1" stopColor="#3b82f6"/>
                    </linearGradient>
                  </defs>
                </svg>
              </div>
              <span className="text-base font-bold tracking-tight">
                <span className="text-white">Semtech</span>
                <span className="gradient-text-warm ml-0.5">Drone</span>
                <span className="text-gray-600 text-xs font-normal ml-1.5">Lab</span>
              </span>
            </a>
            <p className="text-sm text-gray-500 leading-relaxed mb-6 max-w-xs">
              Browser-based robotics lab for AI-powered autonomous drone navigation. Run algorithms, explore architecture, benchmark models — no install needed.
            </p>
            <div className="flex items-center gap-3">
              <a
                href="https://github.com/ACHYUT13807/semantic-drone-architecture"
                target="_blank"
                rel="noopener noreferrer"
                className="w-9 h-9 flex items-center justify-center rounded-lg border border-white/[0.06] bg-white/[0.02] text-gray-500 hover:text-white hover:border-white/15 transition-all duration-200"
                aria-label="GitHub"
              >
                <GitHubIcon className="w-4 h-4" />
              </a>

            </div>
          </div>

          {/* Link columns */}
          {Object.entries(footerLinks).map(([title, links]) => (
            <div key={title}>
              <h4 className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-4">{title}</h4>
              <ul className="space-y-2.5">
                {links.map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      target={link.href.startsWith('http') ? '_blank' : undefined}
                      rel={link.href.startsWith('http') ? 'noopener noreferrer' : undefined}
                      className="text-sm text-gray-600 hover:text-gray-300 transition-colors duration-200"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom bar */}
        <div className="py-6 border-t border-white/[0.04] flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-xs text-gray-600">
            © {new Date().getFullYear()} Semtech Drone Lab. Open source under MIT License. All algorithms run client-side.
          </p>
          <div className="text-xs text-gray-600">
            Client-side demo; no account or server-side processing required.
          </div>
        </div>
      </div>
    </footer>
  );
}
