"use client";

import { useState, useEffect } from 'react';
import BackgroundRemover from '../../components/BackgroundRemover';

export default function HomePage() {
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    let id = localStorage.getItem('cs_user_id');
    if (!id) {
      id = 'user_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
      localStorage.setItem('cs_user_id', id);
    }
    setUserId(id);
  }, []);

  if (!userId) return <main className="min-h-screen bg-[#FAFAFA]" />;

  return (
    <main className="min-h-screen bg-[#FAFAFA]">
      <BackgroundRemover userId={userId} />
    </main>
  );
}
