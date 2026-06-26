'use client';

import { useState, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Header from '../../components/Header';
import { addRecentActivity } from '../../utils/recentActivities';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

interface FormData {
  fileBaseName: string;
  password: string;
  commonName: string;
  emailAddress: string;
  organization: string;
  organizationalUnit: string;
  locality: string;
  state: string;
  country: string;
  validityDays: string;
}

const DEFAULT_FORM: FormData = {
  fileBaseName: '',
  password: '',
  commonName: '',
  emailAddress: '',
  organization: '',
  organizationalUnit: '',
  locality: '',
  state: '',
  country: '',
  validityDays: '3650',
};

export default function P12GeneratorPage() {
  const pathname = usePathname();
  const isBgRemover = pathname === '/' || pathname === '';
  const isP12 = pathname === '/p12-generator';

  const [form, setForm] = useState<FormData>(DEFAULT_FORM);
  const [showPassword, setShowPassword] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const downloadRef = useRef<HTMLAnchorElement | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
    setError(null);
    setSuccess(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsGenerating(true);
    setError(null);
    setSuccess(false);

    try {
      const payload = {
        fileBaseName: form.fileBaseName,
        password: form.password,
        commonName: form.commonName,
        emailAddress: form.emailAddress,
        organization: form.organization,
        organizationalUnit: form.organizationalUnit,
        locality: form.locality,
        state: form.state,
        country: form.country.toUpperCase(),
        validityDays: parseInt(form.validityDays, 10),
      };

      const res = await fetch(`${API_BASE}/api/p12/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData?.message ?? `Server error (${res.status})`);
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${form.fileBaseName}.p12`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setSuccess(true);
      
      addRecentActivity({
        name: `Generated ${form.fileBaseName}.p12`,
        tool: 'P12 Generator'
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate certificate.');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <section className="flex w-full flex-col text-[#111111] min-h-screen bg-[#FAFAFA]">
      {/* ── Header ── */}
      <Header 
        activePage="p12-generator"
        rightContent={
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
              className="h-8 w-full pl-8 pr-3 text-[12px] bg-[#F4F4F5] border border-transparent rounded-[8px] focus:outline-none focus:bg-white focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] transition-all placeholder:text-[#A3A3A3] font-medium"
            />
          </div>
        }
      />

      {/* ── Page Content ── */}
      <main className="flex-1 w-full">
        {/* Hero */}
        <div className="text-center pt-14 pb-8 px-4">
          <h2 className="text-[34px] font-bold text-[#111111] tracking-tight leading-tight">
            P12 Certificate Generator
          </h2>
          <p className="mt-3 text-[14px] text-[#737373] max-w-md mx-auto leading-relaxed">
            Generate password-protected PKCS#12 (.p12) certificates instantly using a secure,
            in-memory process. Replaces manual multi-step OpenSSL CLI workflows.
          </p>
        </div>

        {/* Form Card */}
        <div className="max-w-[620px] w-full mx-auto px-4 pb-16">
          <form
            onSubmit={handleSubmit}
            className="bg-white border border-[#E5E5E5] rounded-[16px] shadow-[0_4px_24px_-4px_rgba(0,0,0,0.06)] overflow-hidden"
          >
            <div className="p-8 grid grid-cols-2 gap-5">

              {/* File Base Name */}
              <div className="flex flex-col gap-1.5">
                <label className="flex items-center gap-1.5 text-[10px] font-bold tracking-widest text-[#737373] uppercase">
                  <svg className="h-3.5 w-3.5 text-blue-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  File Base Name
                </label>
                <input
                  id="fileBaseName"
                  name="fileBaseName"
                  value={form.fileBaseName}
                  onChange={handleChange}
                  required
                  maxLength={64}
                  placeholder="e.g. mundog"
                  className="h-11 px-4 rounded-[8px] border border-[#E5E5E5] bg-white text-[14px] text-[#111111] placeholder-[#C4C4C4] focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition"
                />
              </div>

              {/* P12 Password */}
              <div className="flex flex-col gap-1.5">
                <label className="flex items-center gap-1.5 text-[10px] font-bold tracking-widest text-[#737373] uppercase">
                  <svg className="h-3.5 w-3.5 text-blue-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  P12 Password
                </label>
                <div className="relative">
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    value={form.password}
                    onChange={handleChange}
                    required
                    minLength={6}
                    maxLength={128}
                    placeholder="••••••••"
                    className="w-full h-11 pl-4 pr-10 rounded-[8px] border border-[#E5E5E5] bg-white text-[14px] text-[#111111] placeholder-[#C4C4C4] focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#A3A3A3] hover:text-[#525252] transition"
                    tabIndex={-1}
                  >
                    {showPassword ? (
                      <svg style={{ width: '18px', height: '18px' }} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                      </svg>
                    ) : (
                      <svg style={{ width: '18px', height: '18px' }} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              {/* Common Name */}
              <div className="flex flex-col gap-1.5">
                <label className="flex items-center gap-1.5 text-[10px] font-bold tracking-widest text-[#737373] uppercase">
                  <svg className="h-3.5 w-3.5 text-blue-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0" />
                  </svg>
                  Common Name / Full Name
                </label>
                <input id="commonName" name="commonName" value={form.commonName} onChange={handleChange} required maxLength={64} placeholder="e.g. Juan Dela Cruz"
                  className="h-11 px-4 rounded-[8px] border border-[#E5E5E5] bg-white text-[14px] text-[#111111] placeholder-[#C4C4C4] focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition" />
              </div>

              {/* Email */}
              <div className="flex flex-col gap-1.5">
                <label className="flex items-center gap-1.5 text-[10px] font-bold tracking-widest text-[#737373] uppercase">
                  <svg className="h-3.5 w-3.5 text-blue-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  Email Address
                </label>
                <input id="emailAddress" name="emailAddress" type="email" value={form.emailAddress} onChange={handleChange} required placeholder="e.g. juan@email.com"
                  className="h-11 px-4 rounded-[8px] border border-[#E5E5E5] bg-white text-[14px] text-[#111111] placeholder-[#C4C4C4] focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition" />
              </div>

              {/* Organization */}
              <div className="flex flex-col gap-1.5">
                <label className="flex items-center gap-1.5 text-[10px] font-bold tracking-widest text-[#737373] uppercase">
                  <svg className="h-3.5 w-3.5 text-blue-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                  </svg>
                  Organization
                </label>
                <input id="organization" name="organization" value={form.organization} onChange={handleChange} required maxLength={64} placeholder="e.g. Infosoft Studio"
                  className="h-11 px-4 rounded-[8px] border border-[#E5E5E5] bg-white text-[14px] text-[#111111] placeholder-[#C4C4C4] focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition" />
              </div>

              {/* Organizational Unit */}
              <div className="flex flex-col gap-1.5">
                <label className="flex items-center gap-1.5 text-[10px] font-bold tracking-widest text-[#737373] uppercase">
                  <svg className="h-3.5 w-3.5 text-blue-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
                  </svg>
                  Organizational Unit
                </label>
                <input id="organizationalUnit" name="organizationalUnit" value={form.organizationalUnit} onChange={handleChange} required maxLength={64} placeholder="e.g. IT Department"
                  className="h-11 px-4 rounded-[8px] border border-[#E5E5E5] bg-white text-[14px] text-[#111111] placeholder-[#C4C4C4] focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition" />
              </div>

              {/* Locality */}
              <div className="flex flex-col gap-1.5">
                <label className="flex items-center gap-1.5 text-[10px] font-bold tracking-widest text-[#737373] uppercase">
                  <svg className="h-3.5 w-3.5 text-blue-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  Locality / City
                </label>
                <input id="locality" name="locality" value={form.locality} onChange={handleChange} required maxLength={64} placeholder="e.g. Davao"
                  className="h-11 px-4 rounded-[8px] border border-[#E5E5E5] bg-white text-[14px] text-[#111111] placeholder-[#C4C4C4] focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition" />
              </div>

              {/* State */}
              <div className="flex flex-col gap-1.5">
                <label className="flex items-center gap-1.5 text-[10px] font-bold tracking-widest text-[#737373] uppercase">
                  <svg className="h-3.5 w-3.5 text-blue-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                  </svg>
                  State / Province
                </label>
                <input id="state" name="state" value={form.state} onChange={handleChange} required maxLength={64} placeholder="e.g. Davao del Sur"
                  className="h-11 px-4 rounded-[8px] border border-[#E5E5E5] bg-white text-[14px] text-[#111111] placeholder-[#C4C4C4] focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition" />
              </div>

              {/* Country */}
              <div className="flex flex-col gap-1.5">
                <label className="flex items-center gap-1.5 text-[10px] font-bold tracking-widest text-[#737373] uppercase">
                  <svg className="h-3.5 w-3.5 text-blue-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9" />
                  </svg>
                  Country Code (2 Chars)
                </label>
                <input id="country" name="country" value={form.country} onChange={handleChange} required maxLength={2} minLength={2} placeholder="e.g. PH"
                  className="h-11 px-4 rounded-[8px] border border-[#E5E5E5] bg-white text-[14px] text-[#111111] placeholder-[#C4C4C4] focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition uppercase" />
              </div>

              {/* Validity Days */}
              <div className="flex flex-col gap-1.5">
                <label className="flex items-center gap-1.5 text-[10px] font-bold tracking-widest text-[#737373] uppercase">
                  <svg className="h-3.5 w-3.5 text-blue-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16 2v4M8 2v4M3 10h18" />
                  </svg>
                  Validity Days
                </label>
                <input id="validityDays" name="validityDays" type="number" min={1} max={18250} value={form.validityDays} onChange={handleChange} required placeholder="e.g. 3650"
                  className="h-11 px-4 rounded-[8px] border border-[#E5E5E5] bg-white text-[14px] text-[#111111] placeholder-[#C4C4C4] focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition" />
              </div>

            </div>

            {/* Error / Success */}
            {error && (
              <div className="mx-8 mb-4 px-4 py-3 bg-[#FEF2F2] border border-[#FECACA] rounded-[8px] text-[13px] text-[#991B1B] font-medium flex items-center gap-2">
                <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {error}
              </div>
            )}
            {success && (
              <div className="mx-8 mb-4 px-4 py-3 bg-[#F0FDF4] border border-[#BBF7D0] rounded-[8px] text-[13px] text-[#166534] font-medium flex items-center gap-2">
                <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Certificate generated and downloaded successfully!
              </div>
            )}

            {/* Submit */}
            <div className="px-8 pb-8">
              <button
                type="submit"
                disabled={isGenerating}
                id="generate-p12-btn"
                className="w-full h-[52px] rounded-[10px] bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:opacity-60 disabled:cursor-not-allowed text-white text-[15px] font-bold tracking-wide transition flex items-center justify-center gap-2.5 shadow-lg shadow-blue-600/25"
              >
                {isGenerating ? (
                  <>
                    <div className="h-5 w-5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                    Generating Certificate...
                  </>
                ) : (
                  <>
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Generate &amp; Download .P12
                  </>
                )}
              </button>
            </div>
          </form>

          {/* Form note */}
          <p className="mt-6 text-center text-[12px] text-[#A3A3A3] leading-relaxed">
            This utility is for internal use. Form inputs are processed purely in-memory and are never stored on disk.
          </p>
        </div>
      </main>

      {/* ── Footer ── */}
      <footer className="w-full border-t border-[#E5E5E5] bg-white py-4 text-center">
        <p className="text-[12px] text-[#A3A3A3] font-medium tracking-wide select-none">
          EisenDev | Arjay E. &copy; 2026
        </p>
      </footer>

      <a ref={downloadRef} className="hidden" aria-hidden="true" />
    </section>
  );
}
