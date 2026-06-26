'use client';

import { useRef, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface AppLayoutProps {
  children: ReactNode;
  /** Called when "+ Add files" button is clicked. Only relevant on the BG Remover page. */
  onAddFiles?: () => void;
  fileInputProps?: React.InputHTMLAttributes<HTMLInputElement>;
  fileInputRef?: React.RefObject<HTMLInputElement | null>;
}

export default function AppLayout({ children, onAddFiles, fileInputRef }: AppLayoutProps) {
  const pathname = usePathname();
  const isBgRemover = pathname === '/' || pathname === '';
  const isP12 = pathname === '/p12-generator';

  return (
    <section className="flex w-full flex-col text-[#111111] min-h-screen bg-[#FAFAFA]">
      {/* ── Header ── */}
      <header className="sticky top-0 z-50 flex h-[56px] items-center justify-between border-b border-[#E5E5E5] bg-white px-6 w-full">
        <div className="flex w-full items-center justify-between">
          {/* Left section: Logo + Tabs */}
          <div className="flex items-center gap-8">
            {/* Logo */}
            <div className="flex items-center gap-2">
              <svg
                style={{ width: '24px', height: '24px' }}
                className="h-6 w-6 text-[#111111] shrink-0"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
              >
                <path d="M21 12V8a5 5 0 0 0-5-5H8a5 5 0 0 0-5 5v8a5 5 0 0 0 5 5h4" />
                <path d="M12 21h4a5 5 0 0 0 5-5v-4" strokeDasharray="3 3" />
              </svg>
              <h1 className="text-[16px] font-bold text-[#111111] leading-none select-none tracking-tight">
                Infosoft Utility Tools
              </h1>
            </div>

            {/* Navigation Tabs */}
            <nav className="flex items-center h-[56px]">
              <Link
                href="/"
                className={`relative flex items-center gap-2 px-4 h-full text-[14px] font-semibold transition-colors ${
                  isBgRemover
                    ? 'text-[#111111] border-b-2 border-blue-600'
                    : 'text-[#737373] hover:text-[#111111] border-b-2 border-transparent'
                }`}
              >
                <svg
                  style={{ width: '16px', height: '16px' }}
                  className={`h-4 w-4 shrink-0 ${isBgRemover ? 'text-blue-600' : 'text-[#737373]'}`}
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <rect x="3" y="3" width="7" height="7" rx="1.5" />
                  <rect x="14" y="3" width="7" height="7" rx="1.5" />
                  <rect x="3" y="14" width="7" height="7" rx="1.5" />
                  <rect x="14" y="14" width="7" height="7" rx="1.5" />
                </svg>
                <span>Background Remover</span>
              </Link>
              <Link
                href="/p12-generator"
                className={`relative flex items-center gap-2 px-4 h-full text-[14px] font-semibold transition-colors ${
                  isP12
                    ? 'text-[#111111] border-b-2 border-blue-600'
                    : 'text-[#737373] hover:text-[#111111] border-b-2 border-transparent'
                }`}
              >
                <svg
                  style={{ width: '16px', height: '16px' }}
                  className={`h-4 w-4 shrink-0 ${isP12 ? 'text-blue-600' : 'text-[#737373]'}`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                  />
                </svg>
                <span>P12 Generator</span>
              </Link>
            </nav>
          </div>

          {/* Right section */}
          <div className="flex items-center gap-4">
            {/* Search Tools Input */}
            <div className="relative w-[180px] sm:w-[220px]">
              <svg
                style={{ width: '14px', height: '14px' }}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#A3A3A3]"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                placeholder="Search tools..."
                className="w-full h-8 pl-8 pr-3 text-[12px] bg-[#F4F4F4] hover:bg-[#EBEBEB] focus:bg-white border border-transparent focus:border-[#D4D4D4] rounded-full transition-all focus:outline-none placeholder-[#A3A3A3]"
              />
            </div>

            {/* Add Files Button — only shown on BG Remover page */}
            {onAddFiles && (
              <>
                <button
                  type="button"
                  onClick={onAddFiles}
                  className="inline-flex h-8 items-center justify-center rounded-[6px] border border-[#E5E5E5] bg-white px-3.5 text-[13px] font-semibold text-[#111111] hover:bg-[#F5F5F5] transition gap-1.5"
                >
                  <span>+ Add files</span>
                </button>
                {fileInputRef && (
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    id="app-layout-file-input"
                  />
                )}
              </>
            )}
          </div>
        </div>
      </header>

      {/* ── Page Content ── */}
      <main className="flex-1 w-full">
        {children}
      </main>

      {/* ── Footer ── */}
      <footer className="w-full border-t border-[#E5E5E5] bg-white py-4 text-center">
        <p className="text-[12px] text-[#A3A3A3] font-medium tracking-wide select-none">
          EisenDev | Arjay E. &copy; 2026
        </p>
      </footer>
    </section>
  );
}
