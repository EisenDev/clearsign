import Link from 'next/link';
import { ReactNode } from 'react';

interface HeaderProps {
  activePage: 'home' | 'background-remover' | 'p12-generator' | 'asset-composer';
  rightContent?: ReactNode;
}

export default function Header({ activePage, rightContent }: HeaderProps) {
  return (
    <header className="sticky top-0 w-full flex-none h-14 bg-white/95 backdrop-blur-md border-b border-[#E5E5E5] flex items-center justify-between px-4 z-[50] shadow-sm transition-all">
      <div className="flex items-center gap-8">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 bg-[#111111] rounded-[6px] flex items-center justify-center">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><path d="M3 9h18M9 21V9" /></svg>
          </div>
          <h1 className="text-[14px] font-bold tracking-tight text-[#111111]">Infosoft Utility Tools</h1>
        </div>
        <nav className="flex items-center gap-6">
          <div className="relative">
            <Link href="/" className={`text-[13px] font-semibold flex items-center gap-1.5 py-4 ${activePage === 'home' ? 'text-[#2563EB] font-bold' : 'text-[#737373] hover:text-[#111111] transition-colors'}`}>
              <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
              Home
            </Link>
            {activePage === 'home' && <div className="absolute bottom-0 left-0 w-full h-[3px] bg-[#2563EB] rounded-t-md" />}
          </div>
          <div className="relative">
            <Link href="/bg-remover" className={`text-[13px] font-semibold flex items-center gap-1.5 py-4 ${activePage === 'background-remover' ? 'text-[#2563EB] font-bold' : 'text-[#737373] hover:text-[#111111] transition-colors'}`}>
              <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" /></svg>
              Background Remover
            </Link>
            {activePage === 'background-remover' && <div className="absolute bottom-0 left-0 w-full h-[3px] bg-[#2563EB] rounded-t-md" />}
          </div>
          <div className="relative">
            <Link href="/p12-generator" className={`text-[13px] font-semibold flex items-center gap-1.5 py-4 ${activePage === 'p12-generator' ? 'text-[#2563EB] font-bold' : 'text-[#737373] hover:text-[#111111] transition-colors'}`}>
              <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
              P12 Generator
            </Link>
            {activePage === 'p12-generator' && <div className="absolute bottom-0 left-0 w-full h-[3px] bg-[#2563EB] rounded-t-md" />}
          </div>
          <div className="relative">
            <Link href="/asset-composer" className={`text-[13px] font-semibold flex items-center gap-1.5 py-4 ${activePage === 'asset-composer' ? 'text-[#2563EB] font-bold' : 'text-[#737373] hover:text-[#111111] transition-colors'}`}>
              <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
              Asset Composer
            </Link>
            {activePage === 'asset-composer' && <div className="absolute bottom-0 left-0 w-full h-[3px] bg-[#2563EB] rounded-t-md" />}
          </div>
        </nav>
      </div>
      <div className="flex items-center gap-4">
        {rightContent}
      </div>
    </header>
  );
}
