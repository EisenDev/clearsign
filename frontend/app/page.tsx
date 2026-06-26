"use client";

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Header from '../components/Header';
import { getRecentActivities, RecentActivity } from '../utils/recentActivities';

export default function LandingPage() {
  const [recentActs, setRecentActs] = useState<RecentActivity[]>([]);

  useEffect(() => {
    setRecentActs(getRecentActivities().slice(0, 4));
  }, []);

  const timeAgo = (ts: number) => {
    const diff = Math.floor((Date.now() - ts) / 1000);
    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)} minutes ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`;
    return `${Math.floor(diff / 86400)} days ago`;
  };
  return (
    <div className="min-h-screen bg-[#F8F9FA] flex flex-col font-sans text-[#111111]">
      <Header activePage="home" />
      
      <main className="flex-1 w-full max-w-[1280px] mx-auto px-6 py-12 flex flex-col gap-12">
        {/* HERO SECTION */}
        <section className="flex flex-col lg:flex-row items-center gap-12 lg:gap-24">
          <div className="flex-1 flex flex-col items-start">
            <span className="text-[12px] font-bold text-[#2563EB] tracking-widest uppercase mb-4">Internal Workspace</span>
            <h1 className="text-[48px] lg:text-[56px] font-extrabold leading-[1.1] tracking-tight mb-6">
              Everything you need.<br/>
              <span className="text-[#2563EB]">One simple workflow.</span>
            </h1>
            <p className="text-[16px] text-[#525252] leading-relaxed mb-8 max-w-[480px]">
              Generate secure certificates, remove image backgrounds, and compose professional assets — all in one place.
            </p>
            <div className="flex items-center gap-4 mb-10">
              <Link href="/p12-generator" className="h-12 px-6 bg-[#2563EB] hover:bg-[#1D4ED8] text-white rounded-[8px] font-semibold flex items-center gap-2 transition-colors shadow-lg shadow-blue-500/20">
                Start Workflow
                <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
              </Link>
              <Link href="/bg-remover" className="h-12 px-6 bg-white border border-[#E5E5E5] hover:border-[#D4D4D4] hover:bg-[#F5F5F5] text-[#111111] rounded-[8px] font-semibold flex items-center gap-2 transition-colors shadow-sm">
                <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /></svg>
                Open Any Tool
              </Link>
            </div>
            <div className="flex items-center gap-6 text-[12px] font-semibold text-[#737373] flex-wrap">
              <div className="flex items-center gap-1.5">
                <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2" /><path strokeLinecap="round" strokeLinejoin="round" d="M8 11V7a4 4 0 018 0v4" /></svg>
                Secure & Private
              </div>
              <div className="flex items-center gap-1.5">
                <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                No Installation
              </div>
              <div className="flex items-center gap-1.5">
                <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                Fast & Efficient
              </div>
              <div className="flex items-center gap-1.5">
                <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
                Internal Use Only
              </div>
            </div>
          </div>
          
          <div className="flex-1 relative w-full aspect-[4/3] max-w-[600px] flex items-center justify-center">
            {/* Mockup visual representation */}
            <div className="absolute w-[80%] h-[70%] bg-white rounded-[16px] shadow-xl border border-[#E5E5E5] right-0 bottom-0 z-10 flex flex-col overflow-hidden">
              <div className="h-10 border-b border-[#F0F0F0] flex items-center px-4 gap-2 bg-[#FAFAFA]">
                <div className="w-2.5 h-2.5 rounded-full bg-[#E5E5E5]" />
                <div className="w-2.5 h-2.5 rounded-full bg-[#E5E5E5]" />
                <div className="w-2.5 h-2.5 rounded-full bg-[#E5E5E5]" />
              </div>
              <div className="flex-1 flex p-4 gap-4 bg-[#F8F9FA]">
                <div className="flex-1 bg-white border border-[#E5E5E5] rounded-[8px] shadow-sm flex items-center justify-center relative overflow-hidden">
                  {/* Fake Signature & Logo */}
                  <div className="w-16 h-16 bg-[#111111] rounded-[8px] flex items-center justify-center -rotate-12 absolute left-8 top-12 shadow-md">
                     <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" /></svg>
                  </div>
                  <div className="absolute right-8 bottom-12 w-32 h-16 border-2 border-dashed border-[#2563EB] rounded-[4px] bg-blue-50/50 flex items-center justify-center">
                    <span className="font-['Dancing_Script'] text-2xl text-[#111] -rotate-3">John Smith</span>
                  </div>
                </div>
                <div className="w-16 flex flex-col gap-2">
                  <div className="w-full h-8 bg-[#E5E5E5] rounded-[4px]" />
                  <div className="w-full h-8 bg-[#E5E5E5] rounded-[4px]" />
                  <div className="w-full h-8 bg-white border border-[#E5E5E5] rounded-[4px]" />
                </div>
              </div>
            </div>

            <div className="absolute w-[45%] h-[55%] bg-white rounded-[16px] shadow-2xl border border-[#E5E5E5] left-0 top-[10%] z-20 flex flex-col p-5">
              <div className="w-10 h-10 bg-blue-50 text-[#2563EB] rounded-[8px] flex items-center justify-center mb-4">
                <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
              </div>
              <div className="h-4 w-16 bg-[#E5E5E5] rounded-full mb-6" />
              <div className="flex-1 flex flex-col gap-3 justify-center">
                <div className="h-2 w-full bg-[#F4F4F5] rounded-full" />
                <div className="h-2 w-[80%] bg-[#F4F4F5] rounded-full" />
                <div className="h-2 w-[60%] bg-[#F4F4F5] rounded-full" />
              </div>
              <div className="mt-4 flex justify-end">
                <div className="w-8 h-8 rounded-full bg-[#2563EB] shadow-md border-[3px] border-white -mr-2" />
              </div>
            </div>

            <div className="absolute w-[35%] aspect-square bg-white rounded-[16px] shadow-2xl border border-[#E5E5E5] left-[25%] bottom-[-5%] z-30 p-2 overflow-hidden">
               <div className="w-full h-full bg-[repeating-conic-gradient(#E5E5E5_0%_25%,#FFFFFF_0%_50%)] bg-[length:16px_16px] rounded-[10px] flex items-center justify-center relative">
                 <div className="absolute inset-0 bg-gradient-to-tr from-blue-500 to-blue-400 opacity-90" style={{ clipPath: 'polygon(0 100%, 100% 100%, 100% 40%, 60% 70%, 30% 20%)' }} />
                 <svg width="24" height="24" viewBox="0 0 24 24" fill="white" className="absolute top-3 right-3 drop-shadow-md"><path d="M5 12h14M12 5v14" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg>
               </div>
            </div>
          </div>
        </section>

        {/* WORKFLOW STEPS */}
        <section className="bg-white rounded-[16px] border border-[#E5E5E5] p-8 shadow-sm">
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-[16px] font-bold text-[#111111]">Your Workflow in 3 Simple Steps</h2>
            <Link href="#" className="text-[12px] font-bold text-[#2563EB] hover:underline flex items-center gap-1">
              View Workflow Guide
              <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>
            </Link>
          </div>
          
          <div className="flex flex-col md:flex-row items-center gap-4 relative">
            {/* Step 1 */}
            <div className="flex-1 w-full bg-[#FAFAFA] border border-[#F0F0F0] rounded-[12px] p-5 flex gap-4 relative">
              <div className="absolute -top-3 -left-3 w-6 h-6 rounded-full bg-[#2563EB] text-white flex items-center justify-center text-[11px] font-bold shadow-md border-2 border-white">1</div>
              <div className="w-12 h-12 bg-white rounded-[8px] shadow-sm flex items-center justify-center text-[#2563EB] shrink-0 border border-[#F0F0F0]">
                <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
              </div>
              <div>
                <h3 className="text-[14px] font-bold text-[#111111] mb-1">P12 Generator</h3>
                <p className="text-[12px] text-[#737373] leading-relaxed">Generate password-protected PKCS#12 (.p12) certificates instantly and securely.</p>
              </div>
            </div>
            
            {/* Arrow 1 */}
            <div className="hidden md:flex w-12 h-px bg-dashed border-t-2 border-dashed border-[#D4D4D4] relative items-center justify-center">
              <div className="w-6 h-6 rounded-full bg-[#2563EB] text-white flex items-center justify-center absolute shadow-sm">
                <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
              </div>
            </div>

            {/* Step 2 */}
            <div className="flex-1 w-full bg-[#FAFAFA] border border-[#F0F0F0] rounded-[12px] p-5 flex gap-4 relative">
              <div className="absolute -top-3 -left-3 w-6 h-6 rounded-full bg-[#059669] text-white flex items-center justify-center text-[11px] font-bold shadow-md border-2 border-white">2</div>
              <div className="w-12 h-12 bg-white rounded-[8px] shadow-sm flex items-center justify-center text-[#059669] shrink-0 border border-[#F0F0F0]">
                <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></svg>
              </div>
              <div>
                <h3 className="text-[14px] font-bold text-[#111111] mb-1">Background Remover</h3>
                <p className="text-[12px] text-[#737373] leading-relaxed">Remove backgrounds from images automatically using AI for clean, transparent results.</p>
              </div>
            </div>
            
            {/* Arrow 2 */}
            <div className="hidden md:flex w-12 h-px bg-dashed border-t-2 border-dashed border-[#D4D4D4] relative items-center justify-center">
              <div className="w-6 h-6 rounded-full bg-[#2563EB] text-white flex items-center justify-center absolute shadow-sm">
                <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
              </div>
            </div>

            {/* Step 3 */}
            <div className="flex-1 w-full bg-[#FAFAFA] border border-[#F0F0F0] rounded-[12px] p-5 flex gap-4 relative">
              <div className="absolute -top-3 -left-3 w-6 h-6 rounded-full bg-[#7C3AED] text-white flex items-center justify-center text-[11px] font-bold shadow-md border-2 border-white">3</div>
              <div className="w-12 h-12 bg-white rounded-[8px] shadow-sm flex items-center justify-center text-[#7C3AED] shrink-0 border border-[#F0F0F0]">
                <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 2l9 4.5L12 11l-9-4.5L12 2zM12 22l9-4.5M12 22l-9-4.5M12 22v-9.5M21 17.5v-11M3 17.5v-11" /></svg>
              </div>
              <div>
                <h3 className="text-[14px] font-bold text-[#111111] mb-1">Asset Composer</h3>
                <p className="text-[12px] text-[#737373] leading-relaxed">Combine logos, signatures, stamps, and other elements. Export in multiple formats.</p>
              </div>
            </div>
          </div>
        </section>

        {/* BOTTOM WIDGETS */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Recent Activity */}
          <div className="bg-white rounded-[16px] border border-[#E5E5E5] p-6 shadow-sm flex flex-col">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-[14px] font-bold text-[#111111]">Recent Activity</h3>
                <p className="text-[12px] text-[#737373] mt-0.5">Continue where you left off.</p>
              </div>
              <button className="text-[12px] font-bold text-[#2563EB] px-2 py-1 hover:bg-blue-50 transition rounded flex items-center justify-center">
                <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
              </button>
            </div>
            <div className="flex flex-col gap-4">
              {recentActs.length === 0 ? (
                <div className="text-[12px] text-[#A3A3A3] italic py-4">No recent activity yet.</div>
              ) : recentActs.map((item) => (
                <div key={item.id} className="flex items-center gap-3 group cursor-pointer">
                  {item.tool === 'Asset Composer' && <div className="w-10 h-6 bg-[#F8F9FA] rounded-[4px] border border-[#E5E5E5] flex items-center justify-center text-[#2563EB] font-['Dancing_Script'] text-xs shrink-0 font-bold">Sign</div>}
                  {item.tool === 'Background Remover' && <div className="w-10 h-6 bg-[#F8F9FA] rounded-[4px] border border-[#E5E5E5] flex items-center justify-center text-green-600 shrink-0"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/></svg></div>}
                  {item.tool === 'P12 Generator' && <div className="w-10 h-6 bg-[#F8F9FA] rounded-[4px] border border-[#E5E5E5] text-amber-500 flex items-center justify-center shrink-0"><svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></div>}
                  
                  <div className="flex-1 overflow-hidden">
                    <h4 className="text-[13px] font-bold text-[#111111] leading-tight truncate">{item.name}</h4>
                    <p className="text-[11px] text-[#737373] mt-0.5 truncate">{item.tool}</p>
                  </div>
                  <svg className="text-[#A3A3A3] group-hover:text-[#111111] transition shrink-0" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                </div>
              ))}
            </div>
          </div>

          {/* My Workspace */}
          <div className="bg-white rounded-[16px] border border-[#E5E5E5] p-6 shadow-sm flex flex-col">
             <div className="mb-6">
                <h3 className="text-[14px] font-bold text-[#111111]">My Workspace</h3>
                <p className="text-[12px] text-[#737373] mt-0.5">Quick access to your tools and files.</p>
              </div>
              <div className="grid grid-cols-2 gap-3 h-full">
                <Link href="/p12-generator" className="bg-[#F4F7FF] hover:bg-[#EBEFFF] p-4 rounded-[12px] transition-colors border border-transparent flex flex-col justify-center gap-2 group">
                  <div className="w-10 h-10 bg-white rounded-[8px] shadow-sm flex items-center justify-center text-[#2563EB]">
                    <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
                  </div>
                  <div>
                    <h4 className="text-[13px] font-bold text-[#111] group-hover:text-[#2563EB] transition-colors">P12 Generator</h4>
                    <p className="text-[11px] text-[#525252] mt-0.5">Create certificates</p>
                  </div>
                </Link>
                <Link href="/bg-remover" className="bg-[#F0FDF4] hover:bg-[#E5F9EB] p-4 rounded-[12px] transition-colors border border-transparent flex flex-col justify-center gap-2 group">
                  <div className="w-10 h-10 bg-white rounded-[8px] shadow-sm flex items-center justify-center text-[#059669]">
                    <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></svg>
                  </div>
                  <div>
                    <h4 className="text-[13px] font-bold text-[#111] group-hover:text-[#059669] transition-colors">Background Remover</h4>
                    <p className="text-[11px] text-[#525252] mt-0.5">Remove backgrounds</p>
                  </div>
                </Link>
                <Link href="/asset-composer" className="bg-[#FAF5FF] hover:bg-[#F3E8FF] p-4 rounded-[12px] transition-colors border border-transparent flex flex-col justify-center gap-2 group">
                  <div className="w-10 h-10 bg-white rounded-[8px] shadow-sm flex items-center justify-center text-[#7C3AED]">
                    <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 2l9 4.5L12 11l-9-4.5L12 2zM12 22l9-4.5M12 22l-9-4.5M12 22v-9.5M21 17.5v-11M3 17.5v-11" /></svg>
                  </div>
                  <div>
                    <h4 className="text-[13px] font-bold text-[#111] group-hover:text-[#7C3AED] transition-colors">Asset Composer</h4>
                    <p className="text-[11px] text-[#525252] mt-0.5">Compose & export</p>
                  </div>
                </Link>
                <button className="bg-[#F8F9FA] hover:bg-[#F1F3F5] p-4 rounded-[12px] transition-colors border border-[#E5E5E5] border-dashed flex flex-col justify-center gap-2 group text-left">
                  <div className="w-10 h-10 bg-white rounded-[8px] shadow-sm flex items-center justify-center text-[#111] border border-[#E5E5E5]">
                    <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                  </div>
                  <div>
                    <h4 className="text-[13px] font-bold text-[#111]">Upload Files</h4>
                    <p className="text-[11px] text-[#525252] mt-0.5">Import files to get started</p>
                  </div>
                </button>
              </div>
          </div>

          {/* Quick Actions */}
          <div className="bg-white rounded-[16px] border border-[#E5E5E5] p-6 shadow-sm flex flex-col">
             <div className="mb-6">
                <h3 className="text-[14px] font-bold text-[#111111]">Quick Actions</h3>
                <p className="text-[12px] text-[#737373] mt-0.5">Common tasks to speed up your workflow.</p>
              </div>
              <div className="flex flex-col gap-1.5 h-full justify-between">
                <Link href="/bg-remover" className="flex items-center justify-between p-3 rounded-[10px] hover:bg-[#F8F9FA] transition-all group">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-[#ECFDF5] text-[#059669] flex items-center justify-center shrink-0">
                      <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></svg>
                    </div>
                    <div>
                       <h4 className="text-[13px] font-bold text-[#111111]">Remove Background</h4>
                       <p className="text-[11px] text-[#737373]">Upload an image and remove background</p>
                    </div>
                  </div>
                  <svg className="text-[#A3A3A3] group-hover:text-[#111] transition" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                </Link>
                <Link href="/p12-generator" className="flex items-center justify-between p-3 rounded-[10px] hover:bg-[#F8F9FA] transition-all group">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-[#EFF6FF] text-[#2563EB] flex items-center justify-center shrink-0">
                      <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
                    </div>
                    <div>
                       <h4 className="text-[13px] font-bold text-[#111111]">Generate P12 Certificate</h4>
                       <p className="text-[11px] text-[#737373]">Create a new .p12 certificate</p>
                    </div>
                  </div>
                  <svg className="text-[#A3A3A3] group-hover:text-[#111] transition" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                </Link>
                <Link href="/asset-composer" className="flex items-center justify-between p-3 rounded-[10px] hover:bg-[#F8F9FA] transition-all group">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-[#FAF5FF] text-[#7C3AED] flex items-center justify-center shrink-0">
                      <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 2l9 4.5L12 11l-9-4.5L12 2zM12 22l9-4.5M12 22l-9-4.5M12 22v-9.5M21 17.5v-11M3 17.5v-11" /></svg>
                    </div>
                    <div>
                       <h4 className="text-[13px] font-bold text-[#111111]">Compose New Asset</h4>
                       <p className="text-[11px] text-[#737373]">Open the asset composer</p>
                    </div>
                  </div>
                  <svg className="text-[#A3A3A3] group-hover:text-[#111] transition" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                </Link>
                <button className="flex items-center justify-between p-3 rounded-[10px] hover:bg-[#F8F9FA] transition-all group text-left">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-[#F4F4F5] text-[#111] flex items-center justify-center shrink-0 border border-[#E5E5E5]">
                      <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                    </div>
                    <div>
                       <h4 className="text-[13px] font-bold text-[#111111]">Upload Files</h4>
                       <p className="text-[11px] text-[#737373]">Browse or drag & drop files</p>
                    </div>
                  </div>
                  <svg className="text-[#A3A3A3] group-hover:text-[#111] transition" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                </button>
              </div>
          </div>
        </div>

      </main>

      {/* FOOTER */}
      <footer className="w-full mt-12 border-t border-[#E5E5E5] bg-[#F8F9FA] py-5">
        <div className="max-w-[1280px] mx-auto px-6 flex flex-col md:flex-row items-center justify-between">
          <p className="text-[12px] font-medium text-[#6B7280]">© 2026 Infosoft Utility Tools. Internal Use Only.</p>
          <div className="flex items-center gap-1.5 text-[12px] font-medium text-[#6B7280] mt-4 md:mt-0">
            <svg className="text-[#6B7280]" width="14" height="14" fill="currentColor" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
            <span>Crafted with care by <span className="text-[#3B82F6] font-semibold">EisenDev | Arjay</span></span>
          </div>
          <div className="flex items-center gap-4 mt-4 md:mt-0 text-[12px] font-medium text-[#6B7280]">
            <Link href="#" className="hover:text-[#111]">Documentation</Link>
            <span className="text-[#E5E7EB]">|</span>
            <Link href="#" className="hover:text-[#111]">Support</Link>
            <span className="text-[#E5E7EB]">|</span>
            <Link href="#" className="hover:text-[#111]">Report an Issue</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
