import VisitorCard from '../components/VisitorCard';
import StudioShell from '../components/StudioShell';

export default function Page() {
  return (
    <main className="page">
      <VisitorCard />
      <StudioShell />
      <noscript>Ative o JavaScript para usar o Blank PFP Studio.</noscript>
    </main>
  );
}
