import BackgroundRemover from '../components/BackgroundRemover';

export default function HomePage() {
  return (
    <main className="min-h-screen bg-[#FAFAFA]">
      <BackgroundRemover userId="local-dev-user" />
    </main>
  );
}
