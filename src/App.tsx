import Navbar from './components/Navbar';
import Hero from './components/Hero';
import InteractivePipeline from './components/InteractivePipeline';
import DroneSimulation from './components/DroneSimulation';
import ResearchPlayground from './components/ResearchPlayground';
import InteractiveArchitecture from './components/InteractiveArchitecture';
import BenchmarkDashboard from './components/BenchmarkDashboard';
import FlightReplay from './components/FlightReplay';
import GitHubExplorer from './components/GitHubExplorer';
import CTA from './components/CTA';
import Footer from './components/Footer';
import OcclusionRecovery from './components/OcclusionRecovery';
export default function App() {
  return (
    <div className="min-h-screen bg-[#06080d] text-white selection:bg-cyan-500/20 selection:text-cyan-100">
      <Navbar />
      <main>
        <Hero />

        {/* ── Interactive Lab Modules ── */}
        <InteractivePipeline />
        <DroneSimulation />
        <ResearchPlayground />
        <OcclusionRecovery />
        <InteractiveArchitecture />
        <BenchmarkDashboard />
        <FlightReplay />
        <GitHubExplorer />

        <CTA />
      </main>
      <Footer />
    </div>
  );
}
