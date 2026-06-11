'use client';

import { ChangeEvent, DragEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import MaskRefiner from './MaskRefiner';


// ─── Types ────────────────────────────────────────────────────────────────────

type RemovalMode = 'auto' | 'portrait' | 'product' | 'logo' | 'signature' | 'anime';
type JobStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

interface RemoveBackgroundRequest {
  image_url: string;
  user_id: string;
  mode: RemovalMode;
  alpha_matting: boolean;
  shadow_removal: boolean;
  edge_feather: number;
  defringe: boolean;
}

interface RemoveBackgroundAcceptedResponse {
  job_id: string;
  status: JobStatus;
}

interface JobStatusResponse {
  job_id: string;
  user_id: string;
  status: JobStatus;
  input_url: string;
  output_url: string | null;
  error: string | null;
  created_at: string | null;
  updated_at: string | null;
}

interface JobHistoryResponse {
  jobs: JobStatusResponse[];
  total_jobs: number;
  total_pages: number;
  page: number;
  limit: number;
}

interface BatchItem {
  id: string;
  file: File;
  localPreviewUrl: string;
  jobId: string | null;
  status: 'PENDING' | 'UPLOADING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  outputUrl: string | null;
  error: string | null;
  progress: number;
  mode: RemovalMode;
}

interface BackgroundRemoverProps {
  apiBaseUrl?: string;
  userId: string;
  uploadToR2?: (file: File) => Promise<string>;
}

// ─── Mode definitions ─────────────────────────────────────────────────────────

interface ModeDefinition {
  id: RemovalMode;
  label: string;
  description: string;
  icon: React.ReactNode;
  badge?: string;
}

const MODES: ModeDefinition[] = [
  {
    id: 'auto',
    label: 'Auto',
    description: 'Smart detection for any image',
    icon: (
      <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
      </svg>
    ),
  },
  {
    id: 'portrait',
    label: 'Portrait',
    description: 'Optimized for people & hair',
    icon: (
      <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
      </svg>
    ),
  },
  {
    id: 'product',
    label: 'Product',
    description: 'E-commerce items & objects',
    icon: (
      <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9" />
      </svg>
    ),
  },
  {
    id: 'logo',
    label: 'Logo',
    description: 'Logos, icons & graphics',
    icon: (
      <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.53 16.122a3 3 0 00-5.78 1.128 2.25 2.25 0 01-2.4 2.245 4.5 4.5 0 008.4-2.245c0-.399-.078-.78-.22-1.128zm0 0a15.998 15.998 0 003.388-1.62m-5.043-.025a15.994 15.994 0 011.622-3.395m3.42 3.42a15.995 15.995 0 004.764-4.648l3.876-5.814a1.151 1.151 0 00-1.597-1.597L14.146 6.32a15.996 15.996 0 00-4.649 4.763m3.42 3.42a6.776 6.776 0 00-3.42-3.42" />
      </svg>
    ),
  },
  {
    id: 'signature',
    label: 'Signature',
    description: 'Ink on paper & handwriting',
    icon: (
      <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
      </svg>
    ),
    badge: 'Precise',
  },
  {
    id: 'anime',
    label: 'Illustration',
    description: 'Anime, drawings & art',
    icon: (
      <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
      </svg>
    ),
  },
];

// ─── Utilities ────────────────────────────────────────────────────────────────

function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

const getAverageHexColor = (c1: string, c2: string): string => {
  const parse = (hex: string) => {
    const clean = hex.replace(/^#/, '');
    const num = parseInt(clean, 16);
    return [
      (num >> 16) & 255,
      (num >> 8) & 255,
      num & 255
    ];
  };
  try {
    const rgb1 = parse(c1);
    const rgb2 = parse(c2);
    const r = Math.round((rgb1[0] + rgb2[0]) / 2);
    const g = Math.round((rgb1[1] + rgb2[1]) / 2);
    const b = Math.round((rgb1[2] + rgb2[2]) / 2);
    return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
  } catch {
    return '#888888';
  }
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function BackgroundRemover({
  apiBaseUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000',
  userId,
  uploadToR2,
}: BackgroundRemoverProps) {
  // Batch items state
  const [items, setItems] = useState<BatchItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [isProcessingAll, setIsProcessingAll] = useState<boolean>(false);
  const [isZipping, setIsZipping] = useState<boolean>(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [showAllDone, setShowAllDone] = useState<boolean>(false);
  const [history, setHistory] = useState<JobStatusResponse[]>([]);
  const [historyLoading, setHistoryLoading] = useState<boolean>(true);
  const [selectedJobIds, setSelectedJobIds] = useState<string[]>([]);
  const [retryingJobIds, setRetryingJobIds] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [totalJobs, setTotalJobs] = useState<number>(0);

  // Refinement editor state
  const [refineParams, setRefineParams] = useState<{
    jobId: string;
    originalUrl: string;
    processedUrl: string;
  } | null>(null);


  // Design Studio settings
  const [bgType, setBgType] = useState<'transparent' | 'color' | 'gradient' | 'image'>('transparent');
  const [bgColor, setBgColor] = useState<string>('#FFFFFF');
  const [gradientStartColor, setGradientStartColor] = useState<string>('#FF6B6B');
  const [gradientEndColor, setGradientEndColor] = useState<string>('#FF8E53');
  const [gradientAngle, setGradientAngle] = useState<number>(135);
  const [bgImage, setBgImage] = useState<string | null>(null);
  const [aspectRatio, setAspectRatio] = useState<'original' | '1:1' | '4:5' | '16:9' | '9:16' | '2:3'>('original');
  const [padding, setPadding] = useState<number>(0);
  const [privacyMode, setPrivacyMode] = useState<boolean>(false);
  const [edgeMode, setEdgeMode] = useState<'default' | 'sharp' | 'soft' | 'adaptive'>('default');
  const [activeAccordion, setActiveAccordion] = useState<'backdrop' | 'shadows' | 'layout'>('backdrop');

  const applyPresetGradient = useCallback((start: string, end: string) => {
    setGradientStartColor(start);
    setGradientEndColor(end);
    setGradientAngle(135);
  }, []);
  
  // Color Harmonization
  const [harmonizeAmount, setHarmonizeAmount] = useState<number>(0);
  
  // 3D Shadow Generator
  const [shadowType, setShadowType] = useState<'none' | 'drop' | 'contact'>('none');
  const [shadowAngle, setShadowAngle] = useState<number>(135);
  const [shadowDistance, setShadowDistance] = useState<number>(15);
  const [shadowBlur, setShadowBlur] = useState<number>(15);
  const [shadowOpacity, setShadowOpacity] = useState<number>(35);
  const [shadowColor, setShadowColor] = useState<string>('#000000');
  
  const [contactShadowScale, setContactShadowScale] = useState<number>(15);
  const [contactShadowBlur, setContactShadowBlur] = useState<number>(15);
  const [contactShadowOpacity, setContactShadowOpacity] = useState<number>(45);

  // Subject alignment preset
  const [alignSubject, setAlignSubject] = useState<'center' | 'bottom'>('center');

  // Split slider workspace state
  const [sliderPosition, setSliderPosition] = useState<number>(50);
  const [isDraggingSlider, setIsDraggingSlider] = useState<boolean>(false);

  // ── Global mode & precision controls (applied to all new jobs) ──────────────
  const [selectedMode, setSelectedMode] = useState<RemovalMode>('auto');

  const handleModeChange = useCallback((modeId: RemovalMode) => {
    setSelectedMode(modeId);
    if (selectedId) {
      setItems((prev) =>
        prev.map((item) =>
          item.id === selectedId && (item.status === 'PENDING' || item.status === 'FAILED')
            ? { ...item, mode: modeId }
            : item
        )
      );
    }
  }, [selectedId]);
  const [alphaMattingEnabled, setAlphaMattingEnabled] = useState<boolean>(false);
  const [shadowRemovalEnabled, setShadowRemovalEnabled] = useState<boolean>(false);
  const [edgeFeather, setEdgeFeather] = useState<number>(0);
  const [defringeEnabled, setDefringeEnabled] = useState<boolean>(false);
  const [showPrecisionPanel, setShowPrecisionPanel] = useState<boolean>(false);

  const sliderRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Clean up object URLs to prevent memory leaks
  useEffect(() => {
    return () => {
      items.forEach((item) => URL.revokeObjectURL(item.localPreviewUrl));
    };
  }, []);

  const selectedItem = useMemo(() => items.find((i) => i.id === selectedId) || null, [items, selectedId]);

  const historyItems = useMemo(
    () => history.filter((job) => job.status === 'COMPLETED' || job.status === 'FAILED'),
    [history],
  );

  const stats = useMemo(() => {
    const total = items.length;
    const completed = items.filter((i) => i.status === 'COMPLETED').length;
    const processing = items.filter((i) => i.status === 'PROCESSING' || i.status === 'UPLOADING').length;
    const pending = items.filter((i) => i.status === 'PENDING').length;
    const failed = items.filter((i) => i.status === 'FAILED').length;
    return { total, completed, processing, pending, failed };
  }, [items]);

  // Count how many precision options are enabled (for badge)
  const activePrecisionCount = useMemo(() => {
    let count = 0;
    if (alphaMattingEnabled) count++;
    if (shadowRemovalEnabled) count++;
    if (edgeFeather > 0) count++;
    if (defringeEnabled) count++;
    return count;
  }, [alphaMattingEnabled, shadowRemovalEnabled, edgeFeather, defringeEnabled]);

  // ─── API helpers ─────────────────────────────────────────────────────────────

  const uploadSourceImage = useCallback(
    async (file: File): Promise<string> => {
      if (uploadToR2) return uploadToR2(file);

      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch(`${apiBaseUrl}/api/media/uploads`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) throw new Error(`Failed to upload source image (${response.status}).`);

      const payload = (await response.json()) as { image_url: string };
      return payload.image_url;
    },
    [apiBaseUrl, uploadToR2],
  );

  const fetchHistory = useCallback(async (page: number = 1): Promise<void> => {
    setHistoryLoading(true);
    try {
      const response = await fetch(
        `${apiBaseUrl}/api/media/history?user_id=${encodeURIComponent(userId)}&page=${page}&limit=20`,
        { method: 'GET', headers: { Accept: 'application/json' }, cache: 'no-store' },
      );
      if (!response.ok) throw new Error(`History error (${response.status})`);
      const payload = (await response.json()) as JobHistoryResponse;
      setHistory(payload.jobs);
      setCurrentPage(payload.page);
      setTotalPages(payload.total_pages);
      setTotalJobs(payload.total_jobs);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load history.';
      setGlobalError(message);
    } finally {
      setHistoryLoading(false);
    }
  }, [apiBaseUrl, userId]);

  useEffect(() => { void fetchHistory(1); }, [fetchHistory]);

  const processItem = useCallback(
    async (itemId: string, file: File, itemMode?: RemovalMode): Promise<void> => {
      const mode = itemMode ?? selectedMode;

      if (privacyMode) {
        setItems((prev) =>
          prev.map((i) => (i.id === itemId ? { ...i, status: 'PROCESSING', error: null, progress: 10 } : i)),
        );
        try {
          // Dynamic import of browser-only background removal library with type assertion
          const imglyRemoveBackground = (await import('@imgly/background-removal')).default as any;
          
          setItems((prev) =>
            prev.map((i) => (i.id === itemId ? { ...i, progress: 30 } : i)),
          );

          const processedBlob = await imglyRemoveBackground(file, {
            progress: (key: string, current: number, total: number) => {
              const pct = Math.round((current / total) * 50) + 40; // 40% to 90%
              setItems((prev) =>
                prev.map((i) =>
                  i.id === itemId ? { ...i, progress: Math.min(95, pct) } : i
                )
              );
            }
          });

          const localUrl = URL.createObjectURL(processedBlob);
          setItems((prev) =>
            prev.map((i) =>
              i.id === itemId
                ? { ...i, status: 'COMPLETED', outputUrl: localUrl, progress: 100 }
                : i
            )
          );
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : 'Local privacy processing failed.';
          setItems((prev) =>
            prev.map((i) => (i.id === itemId ? { ...i, status: 'FAILED', error: message, progress: 100 } : i)),
          );
        }
        return;
      }

      setItems((prev) =>
        prev.map((i) => (i.id === itemId ? { ...i, status: 'UPLOADING', error: null, progress: 15 } : i)),
      );

      try {
        const uploadedUrl = await uploadSourceImage(file);
        setItems((prev) =>
          prev.map((i) => (i.id === itemId ? { ...i, status: 'PROCESSING', progress: 40 } : i)),
        );

        const requestPayload: RemoveBackgroundRequest = {
          image_url: uploadedUrl,
          user_id: userId,
          mode,
          alpha_matting: alphaMattingEnabled,
          shadow_removal: shadowRemovalEnabled,
          edge_feather: edgeFeather,
          defringe: defringeEnabled,
        };

        const response = await fetch(`${apiBaseUrl}/api/media/remove-background`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(requestPayload),
        });

        if (!response.ok) throw new Error(`Queue error (${response.status})`);

        const payload = (await response.json()) as RemoveBackgroundAcceptedResponse;
        setItems((prev) =>
          prev.map((i) => (i.id === itemId ? { ...i, jobId: payload.job_id, progress: 60 } : i)),
        );

        // Polling
        let jobStatus = payload.status;
        let finalJob: JobStatusResponse | null = null;
        let attempts = 0;
        const maxAttempts = 60; // 2 minutes

        while ((jobStatus === 'PENDING' || jobStatus === 'PROCESSING') && attempts < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          attempts++;

          const jobResponse = await fetch(`${apiBaseUrl}/api/media/jobs/${payload.job_id}`, {
            method: 'GET',
            headers: { Accept: 'application/json' },
            cache: 'no-store',
          });
          if (!jobResponse.ok) throw new Error(`Status error (${jobResponse.status})`);

          finalJob = (await jobResponse.json()) as JobStatusResponse;
          jobStatus = finalJob.status;

          setItems((prev) =>
            prev.map((i) =>
              i.id === itemId
                ? { ...i, status: jobStatus === 'PROCESSING' ? 'PROCESSING' : i.status, progress: jobStatus === 'PROCESSING' ? 80 : 70 }
                : i,
            ),
          );
        }

        if (finalJob && finalJob.status === 'COMPLETED' && finalJob.output_url) {
          setItems((prev) =>
            prev.map((i) =>
              i.id === itemId ? { ...i, status: 'COMPLETED', outputUrl: finalJob!.output_url, progress: 100 } : i,
            ),
          );
          await fetchHistory();
        } else {
          await fetchHistory();
          throw new Error(finalJob?.error || 'Processing timed out.');
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to remove background.';
        setItems((prev) =>
          prev.map((i) => (i.id === itemId ? { ...i, status: 'FAILED', error: message, progress: 100 } : i)),
        );
        await fetchHistory();
      }
    },
    [apiBaseUrl, fetchHistory, uploadSourceImage, userId, selectedMode, alphaMattingEnabled, shadowRemovalEnabled, edgeFeather, defringeEnabled, privacyMode],
  );

  const toggleSelectJob = useCallback((jobId: string) => {
    setSelectedJobIds((prev) =>
      prev.includes(jobId) ? prev.filter((id) => id !== jobId) : [...prev, jobId]
    );
  }, []);

  const toggleSelectAllJobs = useCallback(() => {
    setSelectedJobIds((prev) => {
      const currentPageIds = historyItems.map((job) => job.job_id);
      const allSelected = currentPageIds.every((id) => prev.includes(id));
      if (allSelected) {
        return prev.filter((id) => !currentPageIds.includes(id));
      } else {
        const newSelection = [...prev];
        currentPageIds.forEach((id) => {
          if (!newSelection.includes(id)) newSelection.push(id);
        });
        return newSelection;
      }
    });
  }, [historyItems]);

  const handleDeleteSelectedJobs = useCallback(async () => {
    if (selectedJobIds.length === 0) return;
    if (!confirm(`Are you sure you want to delete ${selectedJobIds.length} selected history item(s)?`)) return;

    try {
      const response = await fetch(`${apiBaseUrl}/api/media/jobs/batch-delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_ids: selectedJobIds }),
      });
      if (!response.ok) throw new Error('Failed to delete selected history items.');
      
      setSelectedJobIds([]);
      const remainingJobsOnPage = historyItems.filter((job) => !selectedJobIds.includes(job.job_id)).length;
      let targetPage = currentPage;
      if (remainingJobsOnPage === 0 && currentPage > 1) {
        targetPage = currentPage - 1;
      }
      await fetchHistory(targetPage);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to delete items.';
      setGlobalError(message);
    }
  }, [apiBaseUrl, selectedJobIds, currentPage, historyItems, fetchHistory]);

  const handleDeleteJob = useCallback(async (jobId: string) => {
    if (!confirm('Are you sure you want to delete this history item?')) return;
    try {
      const response = await fetch(`${apiBaseUrl}/api/media/jobs/${jobId}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error('Failed to delete history item.');
      
      setSelectedJobIds((prev) => prev.filter((id) => id !== jobId));
      const remainingJobsOnPage = historyItems.filter((job) => job.job_id !== jobId).length;
      let targetPage = currentPage;
      if (remainingJobsOnPage === 0 && currentPage > 1) {
        targetPage = currentPage - 1;
      }
      await fetchHistory(targetPage);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to delete item.';
      setGlobalError(message);
    }
  }, [apiBaseUrl, currentPage, historyItems, fetchHistory]);

  const handleRetry = useCallback(async (job: JobStatusResponse) => {
    setRetryingJobIds((prev) => [...prev, job.job_id]);
    try {
      const deleteRes = await fetch(`${apiBaseUrl}/api/media/jobs/${job.job_id}`, {
        method: 'DELETE',
      });
      if (!deleteRes.ok) throw new Error('Failed to delete old job from history');

      await fetchHistory(currentPage);

      const fileRes = await fetch(job.input_url);
      if (!fileRes.ok) throw new Error('Failed to retrieve original image');
      const blob = await fileRes.blob();
      const filename = job.input_url.split('/').pop() || 'image.png';
      const file = new File([blob], filename, { type: blob.type || 'image/png' });

      const newId = Math.random().toString(36).substring(7);
      const newItem: BatchItem = {
        id: newId,
        file,
        localPreviewUrl: URL.createObjectURL(file),
        jobId: null,
        status: 'PENDING' as const,
        outputUrl: null,
        error: null,
        progress: 0,
        mode: selectedMode,
      };

      setItems((prev) => [...prev, newItem]);
      setSelectedId(newId);
      
      void processItem(newId, file, selectedMode);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to retry job.';
      setGlobalError(message);
    } finally {
      setRetryingJobIds((prev) => prev.filter((id) => id !== job.job_id));
    }
  }, [apiBaseUrl, fetchHistory, currentPage, selectedMode, processItem]);

  const handleSaveRefinement = useCallback((newOutputUrl: string) => {
    if (!refineParams) return;
    const { jobId } = refineParams;

    // Update batch items
    setItems((prev) =>
      prev.map((item) =>
        item.jobId === jobId ? { ...item, outputUrl: newOutputUrl } : item
      )
    );

    // Update history
    setHistory((prev) =>
      prev.map((job) =>
        job.job_id === jobId ? { ...job, output_url: newOutputUrl } : job
      )
    );
  }, [refineParams]);

  const addFiles = useCallback(

    (files: File[]): void => {
      const validFiles = files.filter((f) => f.type.startsWith('image/'));
      if (validFiles.length === 0) return;

      const newItems = validFiles.map((file) => ({
        id: Math.random().toString(36).substring(7),
        file,
        localPreviewUrl: URL.createObjectURL(file),
        jobId: null,
        status: 'PENDING' as const,
        outputUrl: null,
        error: null,
        progress: 0,
        mode: selectedMode,
      }));

      setItems((prev) => [...prev, ...newItems]);
      setSelectedId((current) => current ?? newItems[0].id);
      setGlobalError(null);
    },
    [selectedMode],
  );

  const handleFileChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>): void => {
      if (event.target.files) addFiles(Array.from(event.target.files));
    },
    [addFiles],
  );

  const onDragOver = useCallback((e: DragEvent<HTMLDivElement>): void => { e.preventDefault(); setIsDragging(true); }, []);
  const onDragLeave = useCallback((): void => { setIsDragging(false); }, []);
  const onDrop = useCallback(
    (e: DragEvent<HTMLDivElement>): void => {
      e.preventDefault();
      setIsDragging(false);
      if (e.dataTransfer.files) addFiles(Array.from(e.dataTransfer.files));
    },
    [addFiles],
  );

  const handleProcessItem = useCallback(
    async (itemId: string, file: File, mode?: RemovalMode): Promise<void> => {
      await processItem(itemId, file, mode);
    },
    [processItem],
  );

  const handleProcessAll = useCallback(
    async (currentItems: BatchItem[]): Promise<void> => {
      setIsProcessingAll(true);
      const targets = currentItems.filter((i) => i.status === 'PENDING' || i.status === 'FAILED');
      for (const item of targets) await processItem(item.id, item.file, item.mode);
      setIsProcessingAll(false);
      if (targets.length > 0) {
        setShowAllDone(true);
        setTimeout(() => setShowAllDone(false), 2000);
      }
    },
    [processItem],
  );

  const handleDelete = useCallback((itemId: string): void => {
    setItems((prev) => {
      const target = prev.find((i) => i.id === itemId);
      if (target) URL.revokeObjectURL(target.localPreviewUrl);
      const filtered = prev.filter((i) => i.id !== itemId);
      setSelectedId((current) => {
        if (current === itemId) return filtered.length > 0 ? filtered[0].id : null;
        return current;
      });
      return filtered;
    });
  }, []);

  const handleClearAll = useCallback((): void => {
    items.forEach((item) => URL.revokeObjectURL(item.localPreviewUrl));
    setItems([]);
    setSelectedId(null);
    setGlobalError(null);
  }, [items]);

  const dropShadowFilterStyle = useMemo(() => {
    const angleRad = (shadowAngle * Math.PI) / 180;
    const dx = Math.round(shadowDistance * Math.cos(angleRad));
    const dy = Math.round(shadowDistance * Math.sin(angleRad));
    
    const hexToRgba = (hexStr: string, alphaVal: number): string => {
      const cleanHex = hexStr.replace(/^#/, '');
      const num = parseInt(cleanHex, 16);
      const r = (num >> 16) & 255;
      const g = (num >> 8) & 255;
      const b = num & 255;
      return `rgba(${r}, ${g}, ${b}, ${alphaVal})`;
    };

    const colorRgba = hexToRgba(shadowColor, shadowOpacity / 100);
    return `drop-shadow(${dx}px ${dy}px ${shadowBlur}px ${colorRgba})`;
  }, [shadowAngle, shadowDistance, shadowBlur, shadowColor, shadowOpacity]);

  const bgAverageColor = useMemo(() => {
    if (bgType === 'color') return bgColor;
    if (bgType === 'gradient') {
      return getAverageHexColor(gradientStartColor, gradientEndColor);
    }
    if (bgType === 'image') return '#D4D4D4'; // default neutral gray
    return 'transparent';
  }, [bgType, bgColor, gradientStartColor, gradientEndColor]);

  const handleDownload = useCallback(async (item: BatchItem): Promise<void> => {
    if (!item.outputUrl) return;

    // Fast-path: If transparent, no shadow, original aspect ratio, 0 padding, and 0 harmonization, download raw image
    if (bgType === 'transparent' && shadowType === 'none' && aspectRatio === 'original' && padding === 0 && harmonizeAmount === 0) {
      try {
        const response = await fetch(item.outputUrl);
        if (!response.ok) throw new Error(`HTTP error ${response.status}`);
        const blob = await response.blob();
        saveAs(blob, item.file.name.replace(/\.[^.]+$/, '') + '.png');
        return;
      } catch {
        try { saveAs(item.outputUrl, item.file.name); return; } catch { /* Fallback to canvas compositor below */ }
      }
    }

    setIsZipping(true);
    try {
      // 1. Load the processed subject image
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = item.outputUrl + (item.outputUrl.includes('?') ? '&' : '?') + `t=${Date.now()}`;
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });

      // 2. Load background image if custom image mode
      let bgImg: HTMLImageElement | null = null;
      if (bgType === 'image' && bgImage) {
        bgImg = new Image();
        bgImg.src = bgImage;
        await new Promise((resolve, reject) => {
          bgImg!.onload = resolve;
          bgImg!.onerror = reject;
        });
      }

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Could not create canvas context');

      // Determine canvas dimensions based on aspect ratio preset
      let canvasWidth = img.naturalWidth;
      let canvasHeight = img.naturalHeight;

      if (aspectRatio === '1:1') {
        const size = Math.max(canvasWidth, canvasHeight);
        canvasWidth = size;
        canvasHeight = size;
      } else if (aspectRatio === '4:5') {
        const targetAspect = 4 / 5;
        if (canvasWidth / canvasHeight > targetAspect) {
          canvasHeight = Math.round(canvasWidth / targetAspect);
        } else {
          canvasWidth = Math.round(canvasHeight * targetAspect);
        }
      } else if (aspectRatio === '16:9') {
        const targetAspect = 16 / 9;
        if (canvasWidth / canvasHeight > targetAspect) {
          canvasHeight = Math.round(canvasWidth / targetAspect);
        } else {
          canvasWidth = Math.round(canvasHeight * targetAspect);
        }
      } else if (aspectRatio === '9:16') {
        const targetAspect = 9 / 16;
        if (canvasWidth / canvasHeight > targetAspect) {
          canvasHeight = Math.round(canvasWidth / targetAspect);
        } else {
          canvasWidth = Math.round(canvasHeight * targetAspect);
        }
      } else if (aspectRatio === '2:3') {
        const targetAspect = 2 / 3;
        if (canvasWidth / canvasHeight > targetAspect) {
          canvasHeight = Math.round(canvasWidth / targetAspect);
        } else {
          canvasWidth = Math.round(canvasHeight * targetAspect);
        }
      }

      canvas.width = canvasWidth;
      canvas.height = canvasHeight;

      // 3. Draw background layer
      if (bgType === 'color') {
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);
      } else if (bgType === 'gradient') {
        // Draw custom gradient dynamically using trigonometry
        const angleRad = (gradientAngle * Math.PI) / 180;
        const cx = canvasWidth / 2;
        const cy = canvasHeight / 2;
        
        // Corner-to-corner length projection
        const d = (Math.abs(canvasWidth * Math.sin(angleRad)) + Math.abs(canvasHeight * Math.cos(angleRad))) / 2;
        
        const x0 = cx - d * Math.sin(angleRad);
        const y0 = cy + d * Math.cos(angleRad);
        const x1 = cx + d * Math.sin(angleRad);
        const y1 = cy - d * Math.cos(angleRad);
        
        const grad = ctx.createLinearGradient(x0, y0, x1, y1);
        grad.addColorStop(0, gradientStartColor);
        grad.addColorStop(1, gradientEndColor);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);
      } else if (bgType === 'image' && bgImg) {
        // Draw background image scaled cover
        const scaleFactor = Math.max(canvasWidth / bgImg.width, canvasHeight / bgImg.height);
        const w = bgImg.width * scaleFactor;
        const h = bgImg.height * scaleFactor;
        const x = (canvasWidth - w) / 2;
        const y = (canvasHeight - h) / 2;
        ctx.drawImage(bgImg, x, y, w, h);
      }

      // Calculate subject draw dimensions and positions based on padding
      const paddingPx = (padding / 100) * Math.min(canvasWidth, canvasHeight);
      const availableWidth = canvasWidth - paddingPx * 2;
      const availableHeight = canvasHeight - paddingPx * 2;
      const imgAspect = img.naturalWidth / img.naturalHeight;

      let drawWidth = availableWidth;
      let drawHeight = availableWidth / imgAspect;

      if (drawHeight > availableHeight) {
        drawHeight = availableHeight;
        drawWidth = availableHeight * imgAspect;
      }

      const drawX = (canvasWidth - drawWidth) / 2;
      let drawY = (canvasHeight - drawHeight) / 2;
      
      // Handle alignment: bottom vs center
      if (alignSubject === 'bottom') {
        drawY = canvasHeight - drawHeight - paddingPx;
      }

      // 4. Setup Contact Shadow (drawn UNDER the subject)
      if (shadowType === 'contact') {
        ctx.save();
        const subjectCenterX = drawX + drawWidth / 2;
        const subjectBottomY = drawY + drawHeight;
        const shadowWidth = drawWidth * 0.85;
        
        ctx.translate(subjectCenterX, subjectBottomY);
        ctx.scale(1, 0.15); // flat ellipse
        
        const shadowGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, shadowWidth / 2);
        const op = contactShadowOpacity / 100;
        shadowGrad.addColorStop(0, `rgba(0, 0, 0, ${op})`);
        shadowGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        
        ctx.fillStyle = shadowGrad;
        ctx.beginPath();
        ctx.arc(0, 0, shadowWidth / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // 5. Setup Drop Shadow parameters (drawn WITH the subject)
      if (shadowType === 'drop') {
        const angleRad = (shadowAngle * Math.PI) / 180;
        const dx = Math.round(shadowDistance * Math.cos(angleRad));
        const dy = Math.round(shadowDistance * Math.sin(angleRad));
        
        // Hex to RGBA inline helper
        const hexToRgba = (hexStr: string, alphaVal: number): string => {
          const cleanHex = hexStr.replace(/^#/, '');
          const num = parseInt(cleanHex, 16);
          const r = (num >> 16) & 255;
          const g = (num >> 8) & 255;
          const b = num & 255;
          return `rgba(${r}, ${g}, ${b}, ${alphaVal})`;
        };

        ctx.shadowColor = hexToRgba(shadowColor, shadowOpacity / 100);
        ctx.shadowBlur = shadowBlur;
        ctx.shadowOffsetX = dx;
        ctx.shadowOffsetY = dy;
      }

      // 6. Draw Subject
      ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);

      // Reset shadow parameters immediately
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;

      // 7. Apply Color Harmonization (drawn OVER the subject and masked)
      if (harmonizeAmount > 0) {
        const tintCanvas = document.createElement('canvas');
        tintCanvas.width = canvasWidth;
        tintCanvas.height = canvasHeight;
        const tintCtx = tintCanvas.getContext('2d');
        if (tintCtx) {
          tintCtx.drawImage(img, drawX, drawY, drawWidth, drawHeight);
          tintCtx.globalCompositeOperation = 'source-in';
          tintCtx.fillStyle = bgAverageColor;
          tintCtx.fillRect(0, 0, canvasWidth, canvasHeight);
          
          ctx.save();
          ctx.globalCompositeOperation = 'color';
          ctx.globalAlpha = (harmonizeAmount / 100) * 0.35;
          ctx.drawImage(tintCanvas, 0, 0);
          ctx.restore();
        }
      }

      canvas.toBlob((blob) => {
        if (blob) {
          saveAs(blob, item.file.name.replace(/\.[^.]+$/, '') + '-edited.png');
        } else {
          throw new Error('toBlob failed');
        }
      }, 'image/png');
    } catch (err: unknown) {
      console.error('Failed to create composite download', err);
      setGlobalError('Failed to create composite. Downloading raw transparent image.');
      try { saveAs(item.outputUrl, item.file.name); } catch { /* ignore */ }
    } finally {
      setIsZipping(false);
    }
  }, [bgType, bgColor, gradientStartColor, gradientEndColor, gradientAngle, bgImage, shadowType, shadowAngle, shadowDistance, shadowBlur, shadowOpacity, shadowColor, contactShadowBlur, contactShadowOpacity, contactShadowScale, aspectRatio, padding, alignSubject, harmonizeAmount, bgAverageColor]);

  const handleDownloadAll = useCallback(async (currentItems: BatchItem[]): Promise<void> => {
    const completed = currentItems.filter((i) => i.status === 'COMPLETED' && i.outputUrl);
    if (completed.length === 0) return;
    setIsZipping(true);
    try {
      const zip = new JSZip();
      for (const item of completed) {
        if (!item.outputUrl) continue;
        const response = await fetch(item.outputUrl);
        if (!response.ok) throw new Error(`HTTP error ${response.status}`);
        zip.file(item.file.name.replace(/\.[^.]+$/, '') + '.png', await response.blob());
      }
      saveAs(await zip.generateAsync({ type: 'blob' }), 'clearsign-exports.zip');
    } catch { setGlobalError('Failed to create ZIP export.'); }
    finally { setIsZipping(false); }
  }, []);

  const formatHistoryDate = useCallback((value: string | null): string => {
    if (!value) return 'Recently';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return 'Recently';
    return parsed.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }, []);

  // Slider handlers
  const handleMove = useCallback((clientX: number) => {
    if (!sliderRef.current) return;
    const rect = sliderRef.current.getBoundingClientRect();
    setSliderPosition(Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100)));
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => { if (isDraggingSlider) handleMove(e.clientX); }, [isDraggingSlider, handleMove]);
  const handleTouchMove = useCallback((e: React.TouchEvent) => { if (isDraggingSlider && e.touches[0]) handleMove(e.touches[0].clientX); }, [isDraggingSlider, handleMove]);

  useEffect(() => {
    const up = () => setIsDraggingSlider(false);
    window.addEventListener('mouseup', up);
    window.addEventListener('touchend', up);
    return () => { window.removeEventListener('mouseup', up); window.removeEventListener('touchend', up); };
  }, []);

  const previewBgStyle = useMemo(() => {
    if (bgType === 'color') return { backgroundColor: bgColor };
    if (bgType === 'gradient') return { backgroundImage: `linear-gradient(${gradientAngle}deg, ${gradientStartColor} 0%, ${gradientEndColor} 100%)` };
    if (bgType === 'image' && bgImage) {
      return { 
        backgroundImage: `url(${bgImage})`, 
        backgroundSize: 'cover', 
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat'
      };
    }
    return {};
  }, [bgType, bgColor, gradientStartColor, gradientEndColor, gradientAngle, bgImage]);



  const currentMode = useMemo(() => MODES.find((m) => m.id === selectedMode)!, [selectedMode]);

  // ─── Render ───────────────────────────────────────────────────────────────────

  return (
    <section className="flex w-full flex-col text-[#111111] min-h-screen pb-12 bg-[#FAFAFA]">
      {/* ── Header ── */}
      <header className="sticky top-0 z-50 flex h-[56px] items-center justify-between border-b border-[#E5E5E5] bg-white px-6 w-full">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="grid grid-cols-2 gap-[2px] w-[14px] h-[14px] shrink-0">
              <div className="w-[6px] h-[6px] bg-[#111111] rounded-[1px]" />
              <div className="w-[6px] h-[6px] bg-[#111111] rounded-[1px]" />
              <div className="w-[6px] h-[6px] bg-[#111111] rounded-[1px]" />
              <div className="w-[6px] h-[6px] border border-dashed border-[#D4D4D4] rounded-[1px]" />
            </div>
            <h1 className="app-title text-[#111111] leading-none select-none">ClearSign</h1>
          </div>
          <div className="flex items-center gap-3">
            {/* Zero-Cloud Privacy Mode Switch */}
            <div className="flex items-center gap-2 mr-2">
              <label htmlFor="privacy-toggle" className="text-[12px] font-semibold text-[#737373] flex items-center gap-1 cursor-pointer">
                <span>🔒 Privacy Mode</span>
              </label>
              <button
                type="button"
                id="privacy-toggle"
                onClick={() => setPrivacyMode(!privacyMode)}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  privacyMode ? 'bg-green-600' : 'bg-[#E5E5E5]'
                }`}
                role="switch"
                aria-checked={privacyMode}
              >
                <span
                  aria-hidden="true"
                  className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    privacyMode ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
            <span className="text-[12px] text-[#737373] bg-[#F4F4F4] px-2.5 py-1 rounded-full font-medium">
              {stats.total} {stats.total === 1 ? 'file' : 'files'} ready
            </span>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex h-8 items-center justify-center rounded-[6px] border border-[#E5E5E5] bg-transparent px-3 text-[13px] font-medium text-[#111111] transition-colors duration-100 hover:bg-[#F5F5F5]"
            >
              Add files
            </button>
            <input ref={fileInputRef} type="file" multiple accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handleFileChange} />
          </div>
        </div>
      </header>

      {/* ── Main content ── */}
      <div className="mx-auto w-full max-w-7xl px-6 mt-6 flex flex-col gap-6">

        {/* Global Error Banner */}
        {globalError && (
          <div className="flex items-center gap-3 bg-[#DC2626]/10 border border-[#DC2626]/20 text-[#DC2626] px-4 py-3 rounded-[6px] text-[14px]">
            <svg className="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd" />
            </svg>
            {globalError}
            <button onClick={() => setGlobalError(null)} className="ml-auto text-[#DC2626] hover:text-[#B91C1C]">✕</button>
          </div>
        )}

        {/* ── Removal Mode Selector ── */}
        <div className="bg-white border border-[#E5E5E5] rounded-[12px] p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-[14px] font-semibold text-[#111111]">Removal Mode</h2>
              <p className="text-[12px] text-[#A3A3A3] mt-0.5">Select the type of subject for best accuracy</p>
            </div>
            {/* Precision Controls Toggle */}
            <button
              type="button"
              id="precision-toggle-btn"
              onClick={() => setShowPrecisionPanel((v) => !v)}
              className={`inline-flex items-center gap-2 h-8 px-3 rounded-[6px] border text-[13px] font-medium transition-all duration-150 ${
                showPrecisionPanel
                  ? 'border-[#2563EB] bg-[#EFF6FF] text-[#2563EB]'
                  : 'border-[#E5E5E5] bg-white text-[#111111] hover:bg-[#F5F5F5]'
              }`}
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.343 3.94c.09-.542.56-.94 1.11-.94h1.093c.55 0 1.02.398 1.11.94l.149.894c.07.424.384.764.78.93.398.164.855.142 1.205-.108l.737-.527a1.125 1.125 0 011.45.12l.773.774c.39.389.44 1.002.12 1.45l-.527.737c-.25.35-.272.806-.107 1.204.165.397.505.71.93.78l.893.15c.543.09.94.56.94 1.109v1.094c0 .55-.397 1.02-.94 1.11l-.893.149c-.425.07-.765.383-.93.78-.165.398-.143.854.107 1.204l.527.738c.32.447.269 1.06-.12 1.45l-.774.773a1.125 1.125 0 01-1.449.12l-.738-.527c-.35-.25-.806-.272-1.203-.107-.397.165-.71.505-.781.929l-.149.894c-.09.542-.56.94-1.11.94h-1.094c-.55 0-1.019-.398-1.11-.94l-.148-.894c-.071-.424-.384-.764-.781-.93-.398-.164-.854-.142-1.204.108l-.738.527c-.447.32-1.06.269-1.45-.12l-.773-.774a1.125 1.125 0 01-.12-1.45l.527-.737c.25-.35.273-.806.108-1.204-.165-.397-.505-.71-.93-.78l-.894-.15c-.542-.09-.94-.56-.94-1.109v-1.094c0-.55.398-1.02.94-1.11l.894-.149c.424-.07.765-.383.93-.78.165-.398.143-.854-.108-1.204l-.526-.738a1.125 1.125 0 01.12-1.45l.773-.773a1.125 1.125 0 011.45-.12l.737.527c.35.25.807.272 1.204.107.397-.165.71-.505.78-.929l.15-.894z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Precision
              {activePrecisionCount > 0 && (
                <span className="inline-flex items-center justify-center h-4 min-w-[16px] px-1 rounded-full bg-[#2563EB] text-white text-[10px] font-bold">
                  {activePrecisionCount}
                </span>
              )}
            </button>
          </div>

          {/* Mode Cards */}
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            {MODES.map((mode) => (
              <button
                key={mode.id}
                type="button"
                id={`mode-btn-${mode.id}`}
                onClick={() => handleModeChange(mode.id)}
                className={`relative flex flex-col items-center gap-2 p-3 rounded-[10px] border text-center transition-all duration-150 hover:scale-[1.02] active:scale-[0.98] ${
                  selectedMode === mode.id
                    ? 'border-[#2563EB] bg-[#EFF6FF] text-[#2563EB] shadow-[0_0_0_2px_rgba(37,99,235,0.15)]'
                    : 'border-[#E5E5E5] bg-white text-[#525252] hover:border-[#D4D4D4] hover:bg-[#F9F9F9]'
                }`}
              >
                {mode.badge && (
                  <span className="absolute -top-1.5 -right-1.5 bg-[#16A34A] text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full leading-none">
                    {mode.badge}
                  </span>
                )}
                <span className={selectedMode === mode.id ? 'text-[#2563EB]' : 'text-[#737373]'}>{mode.icon}</span>
                <div>
                  <p className={`text-[12px] font-semibold leading-tight ${selectedMode === mode.id ? 'text-[#2563EB]' : 'text-[#111111]'}`}>
                    {mode.label}
                  </p>
                  <p className="text-[10px] text-[#A3A3A3] mt-0.5 leading-tight hidden sm:block">{mode.description}</p>
                </div>
              </button>
            ))}
          </div>

          {/* Precision Controls Panel */}
          {showPrecisionPanel && (
            <div className="mt-4 pt-4 border-t border-[#F0F0F0]">
              {/* Edge Profile Treatment Presets */}
              <div className="flex flex-col gap-2 mb-4">
                <span className="text-[12px] font-semibold text-[#737373] uppercase tracking-[0.08em]">Edge Profile Treatment</span>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {(['default', 'sharp', 'soft', 'adaptive'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => {
                        setEdgeMode(mode);
                        if (mode === 'sharp') {
                          setAlphaMattingEnabled(false);
                          setEdgeFeather(0);
                          setDefringeEnabled(true);
                        } else if (mode === 'soft') {
                          setAlphaMattingEnabled(true);
                          setEdgeFeather(2);
                          setDefringeEnabled(false);
                        } else if (mode === 'adaptive') {
                          setAlphaMattingEnabled(true);
                          setEdgeFeather(1);
                          setDefringeEnabled(true);
                        } else {
                          // default
                          setAlphaMattingEnabled(false);
                          setEdgeFeather(0);
                          setDefringeEnabled(false);
                        }
                      }}
                      className={`py-1.5 px-3 rounded-[6px] border text-[11px] font-semibold transition ${
                        edgeMode === mode
                          ? 'bg-blue-600 border-blue-600 text-white shadow-sm'
                          : 'bg-white border-[#E5E5E5] text-[#737373] hover:border-[#D4D4D4] hover:text-[#111111]'
                      }`}
                    >
                      {mode === 'default' ? 'Default' :
                       mode === 'sharp' ? 'Sharp / Solid' :
                       mode === 'soft' ? 'Fuzzy / Hair' : 'Adaptive AI'}
                    </button>
                  ))}
                </div>
              </div>

              <p className="text-[12px] font-semibold text-[#737373] uppercase tracking-[0.08em] mb-3">Advanced Precision Controls</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">

                {/* Alpha Matting */}
                <div
                  className={`flex flex-col gap-2 p-3 rounded-[8px] border cursor-pointer transition-all duration-150 ${
                    alphaMattingEnabled ? 'border-[#2563EB] bg-[#EFF6FF]' : 'border-[#E5E5E5] bg-[#FAFAFA] hover:border-[#D4D4D4]'
                  }`}
                  onClick={() => setAlphaMattingEnabled((v) => !v)}
                >
                  <div className="flex items-center justify-between">
                    <span className={`text-[12px] font-semibold ${alphaMattingEnabled ? 'text-[#2563EB]' : 'text-[#111111]'}`}>
                      Alpha Matting
                    </span>
                    <div className={`h-4 w-8 rounded-full transition-colors duration-200 flex items-center px-0.5 ${alphaMattingEnabled ? 'bg-[#2563EB]' : 'bg-[#D4D4D4]'}`}>
                      <div className={`h-3 w-3 rounded-full bg-white shadow transition-transform duration-200 ${alphaMattingEnabled ? 'translate-x-4' : 'translate-x-0'}`} />
                    </div>
                  </div>
                  <p className="text-[11px] text-[#A3A3A3] leading-snug">Recover fine hair, fur &amp; wispy edges</p>
                </div>

                {/* Shadow Removal */}
                <div
                  className={`flex flex-col gap-2 p-3 rounded-[8px] border cursor-pointer transition-all duration-150 ${
                    shadowRemovalEnabled ? 'border-[#2563EB] bg-[#EFF6FF]' : 'border-[#E5E5E5] bg-[#FAFAFA] hover:border-[#D4D4D4]'
                  }`}
                  onClick={() => setShadowRemovalEnabled((v) => !v)}
                >
                  <div className="flex items-center justify-between">
                    <span className={`text-[12px] font-semibold ${shadowRemovalEnabled ? 'text-[#2563EB]' : 'text-[#111111]'}`}>
                      Shadow Removal
                    </span>
                    <div className={`h-4 w-8 rounded-full transition-colors duration-200 flex items-center px-0.5 ${shadowRemovalEnabled ? 'bg-[#2563EB]' : 'bg-[#D4D4D4]'}`}>
                      <div className={`h-3 w-3 rounded-full bg-white shadow transition-transform duration-200 ${shadowRemovalEnabled ? 'translate-x-4' : 'translate-x-0'}`} />
                    </div>
                  </div>
                  <p className="text-[11px] text-[#A3A3A3] leading-snug">Detect &amp; erase drop-shadows &amp; halos</p>
                </div>

                {/* Defringe */}
                <div
                  className={`flex flex-col gap-2 p-3 rounded-[8px] border cursor-pointer transition-all duration-150 ${
                    defringeEnabled ? 'border-[#2563EB] bg-[#EFF6FF]' : 'border-[#E5E5E5] bg-[#FAFAFA] hover:border-[#D4D4D4]'
                  }`}
                  onClick={() => setDefringeEnabled((v) => !v)}
                >
                  <div className="flex items-center justify-between">
                    <span className={`text-[12px] font-semibold ${defringeEnabled ? 'text-[#2563EB]' : 'text-[#111111]'}`}>
                      Defringe
                    </span>
                    <div className={`h-4 w-8 rounded-full transition-colors duration-200 flex items-center px-0.5 ${defringeEnabled ? 'bg-[#2563EB]' : 'bg-[#D4D4D4]'}`}>
                      <div className={`h-3 w-3 rounded-full bg-white shadow transition-transform duration-200 ${defringeEnabled ? 'translate-x-4' : 'translate-x-0'}`} />
                    </div>
                  </div>
                  <p className="text-[11px] text-[#A3A3A3] leading-snug">Remove colour halos from old background</p>
                </div>

                {/* Edge Feather */}
                <div className={`flex flex-col gap-2 p-3 rounded-[8px] border transition-all duration-150 ${edgeFeather > 0 ? 'border-[#2563EB] bg-[#EFF6FF]' : 'border-[#E5E5E5] bg-[#FAFAFA]'}`}>
                  <div className="flex items-center justify-between">
                    <span className={`text-[12px] font-semibold ${edgeFeather > 0 ? 'text-[#2563EB]' : 'text-[#111111]'}`}>
                      Edge Feather
                    </span>
                    <span className={`text-[11px] font-mono font-bold px-1.5 py-0.5 rounded-[4px] ${edgeFeather > 0 ? 'bg-[#2563EB] text-white' : 'bg-[#E5E5E5] text-[#737373]'}`}>
                      {edgeFeather === 0 ? 'Off' : edgeFeather}
                    </span>
                  </div>
                  <p className="text-[11px] text-[#A3A3A3] leading-snug mb-1">Soften hard mask edges</p>
                  <input
                    type="range"
                    min={0}
                    max={10}
                    step={1}
                    value={edgeFeather}
                    onChange={(e) => setEdgeFeather(Number(e.target.value))}
                    onClick={(e) => e.stopPropagation()}
                    className="w-full h-1.5 accent-[#2563EB] cursor-pointer"
                  />
                </div>
              </div>

              {/* Active config summary pill */}
              {activePrecisionCount > 0 && (
                <div className="mt-3 flex items-center gap-2">
                  <span className="text-[11px] text-[#737373]">Active:</span>
                  <div className="flex flex-wrap gap-1.5">
                    {alphaMattingEnabled && <span className="text-[11px] bg-[#EFF6FF] border border-[#BFDBFE] text-[#2563EB] px-2 py-0.5 rounded-full font-medium">Alpha Matting</span>}
                    {shadowRemovalEnabled && <span className="text-[11px] bg-[#EFF6FF] border border-[#BFDBFE] text-[#2563EB] px-2 py-0.5 rounded-full font-medium">Shadow Removal</span>}
                    {defringeEnabled && <span className="text-[11px] bg-[#EFF6FF] border border-[#BFDBFE] text-[#2563EB] px-2 py-0.5 rounded-full font-medium">Defringe</span>}
                    {edgeFeather > 0 && <span className="text-[11px] bg-[#EFF6FF] border border-[#BFDBFE] text-[#2563EB] px-2 py-0.5 rounded-full font-medium">Feather: {edgeFeather}</span>}
                  </div>
                  <button
                    type="button"
                    onClick={() => { setAlphaMattingEnabled(false); setShadowRemovalEnabled(false); setDefringeEnabled(false); setEdgeFeather(0); }}
                    className="ml-auto text-[11px] text-[#737373] hover:text-[#DC2626] transition-colors"
                  >
                    Reset all
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {items.length === 0 ? (
          /* ── Empty Upload Zone ── */
          <div className="flex flex-col items-center justify-center py-16">
            <div
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`flex w-[480px] h-[220px] cursor-pointer flex-col items-center justify-center rounded-[12px] border-[1.5px] border-dashed transition-all duration-200 ${
                isDragging
                  ? 'border-[#2563EB] bg-[#F0F7FF]'
                  : 'border-[#D4D4D4] bg-white hover:border-[#2563EB] hover:bg-[#F0F7FF]'
              }`}
            >
              <div className="flex flex-col items-center gap-2 text-center px-6">
                <svg className="h-8 w-8 text-[#A3A3A3] mb-1" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z" />
                </svg>
                <h3 className="text-[16px] font-medium text-[#111111]">Drop your files here</h3>
                <p className="text-[13px] text-[#A3A3A3]">PNG, JPG or WebP</p>
                <span className="text-[12px] text-[#C0C0C0] my-0.5">or</span>
                <span className="text-[13px] text-[#2563EB] hover:underline font-medium">Browse files</span>
              </div>
            </div>

            {/* Active mode hint */}
            <div className="flex items-center gap-2 mt-5 px-3 py-2 bg-white border border-[#E5E5E5] rounded-full">
              <span className="text-[#2563EB]">{currentMode.icon}</span>
              <span className="text-[12px] font-medium text-[#111111]">{currentMode.label} mode</span>
              <span className="text-[#D4D4D4]">—</span>
              <span className="text-[12px] text-[#A3A3A3]">{currentMode.description}</span>
            </div>

            <div className="flex items-center gap-6 mt-6">
              <div className="flex items-center gap-1.5 text-[12px] text-[#A3A3A3] font-medium">
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
                <span>Batch processing</span>
              </div>
              <span className="text-[#E5E5E5]">|</span>
              <div className="flex items-center gap-1.5 text-[12px] text-[#A3A3A3] font-medium">
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 21l-1.813-5.096L2.091 14 7.187 12.096 8 7l1.813 5.096L14.909 14l-5.096 1.904zM18.813 5.904L18 9l-1.813-3.096L13.091 5 16.187 3.906 17 1l1.813 2.906L21.909 5l-3.096.904z" />
                </svg>
                <span>6 AI-powered modes</span>
              </div>
              <span className="text-[#E5E5E5]">|</span>
              <div className="flex items-center gap-1.5 text-[12px] text-[#A3A3A3] font-medium">
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1V5z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 4v16M15 4v16M4 9h16M4 15h16" />
                </svg>
                <span>Transparent PNG output</span>
              </div>
            </div>
          </div>
        ) : (
          /* ── Dashboard Layout ── */
          <div className="grid gap-6 lg:grid-cols-12 items-start">
            {/* Left panel: Batch list */}
            <div className="lg:col-span-5 flex flex-col gap-4 bg-white border border-[#E5E5E5] rounded-[12px] p-5">
              <div className="flex flex-col gap-0.5">
                <span className="text-[13px] uppercase tracking-[0.08em] font-medium text-[#737373]">Files</span>
                <span className="text-[12px] text-[#A3A3A3]">{stats.completed} of {stats.total} processed</span>
              </div>

              {/* Action Bar */}
              <div className="flex items-center justify-between border-b border-[#F0F0F0] pb-4 gap-2">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    id="process-all-btn"
                    onClick={() => void handleProcessAll(items)}
                    disabled={isProcessingAll || stats.pending + stats.failed === 0}
                    className={`inline-flex h-8 items-center justify-center rounded-[6px] px-3 text-[13px] font-medium text-white transition-colors duration-100 disabled:opacity-30 disabled:cursor-not-allowed ${
                      showAllDone ? 'bg-[#16A34A] hover:bg-[#15803D]' : 'bg-[#111111] hover:bg-[#222222]'
                    }`}
                  >
                    {isProcessingAll ? (
                      <span className="flex items-center gap-1.5">
                        <svg className="animate-spin h-3.5 w-3.5 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        Processing {items.filter(i => i.status === 'PROCESSING' || i.status === 'UPLOADING').length || 1} of {stats.total}...
                      </span>
                    ) : showAllDone ? 'All done ✓' : 'Remove backgrounds'}
                  </button>
                  {stats.completed > 0 && (
                    <button
                      type="button"
                      id="download-all-btn"
                      onClick={() => void handleDownloadAll(items)}
                      disabled={isZipping}
                      className="inline-flex h-8 items-center justify-center rounded-[6px] border border-[#E5E5E5] bg-transparent px-3 text-[13px] font-medium text-[#111111] transition-colors duration-100 hover:bg-[#F5F5F5] disabled:opacity-50"
                    >
                      {isZipping ? (
                        <span className="flex items-center gap-1.5">
                          <svg className="animate-spin h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                          Preparing zip...
                        </span>
                      ) : 'Download all'}
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  onClick={handleClearAll}
                  className="text-[#737373] hover:text-[#111111] text-[13px] font-medium transition-colors duration-100"
                >
                  Clear all
                </button>
              </div>

              {/* List */}
              <div className="flex flex-col max-h-[500px] overflow-y-auto pr-1">
                {items.map((item, index) => {
                  const isSelected = item.id === selectedId;
                  const nextItem = items[index + 1];
                  const nextIsSelected = nextItem?.id === selectedId;
                  const showDivider = !isSelected && !nextIsSelected;
                  const modeInfo = MODES.find((m) => m.id === item.mode);

                  return (
                    <div
                      key={item.id}
                      onClick={() => setSelectedId(item.id)}
                      className={`group relative flex items-center justify-between gap-3 h-[56px] px-3 transition-colors duration-100 cursor-pointer ${
                        isSelected ? 'bg-[#F7F7F7] border-l-2 border-[#2563EB]' : 'hover:bg-[#FAFAFA]'
                      } ${showDivider ? 'border-b border-[#F0F0F0]' : ''}`}
                    >
                      <div className="relative h-8 w-8 shrink-0 rounded-md overflow-hidden bg-[#FAFAFA] border border-[#E5E5E5] flex items-center justify-center">
                        <img src={item.localPreviewUrl} alt="Thumbnail" className="h-full w-full object-contain pointer-events-none" />
                        {item.status === 'COMPLETED' && <div className="absolute inset-0 bg-checkerboard-classic opacity-20 pointer-events-none" />}
                      </div>

                      <div className="flex-1 min-w-0 flex flex-col justify-center">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[13px] font-medium text-[#111111] truncate pr-1">{item.file.name}</span>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {/* Mode badge */}
                            <span className="text-[10px] font-medium text-[#737373] bg-[#F4F4F4] px-1.5 py-0.5 rounded-full">
                              {modeInfo?.label ?? 'Auto'}
                            </span>
                            <span className="text-[12px] text-[#A3A3A3] font-medium">{formatBytes(item.file.size)}</span>
                          </div>
                        </div>

                        {(item.status === 'PROCESSING' || item.status === 'UPLOADING') ? (
                          <div className="w-full bg-[#E5E5E5] h-[2px] mt-1 overflow-hidden rounded-full">
                            <div className="progress-shimmer h-full transition-all duration-300" style={{ width: `${item.progress}%` }} />
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 mt-0.5">
                            {item.status === 'PENDING' && <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#F4F4F4] text-[#737373]">Ready</span>}
                            {item.status === 'COMPLETED' && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#F0FDF4] text-[#16A34A]">
                                <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                                Done
                              </span>
                            )}
                            {item.status === 'FAILED' && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#FEF2F2] text-[#DC2626]">
                                <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                                Failed
                              </span>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Hover actions */}
                      <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-100">
                        {item.status === 'PENDING' && (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); void handleProcessItem(item.id, item.file, item.mode); }}
                            className="h-7 w-7 rounded-[6px] text-[#737373] hover:text-[#111111] flex items-center justify-center transition-colors"
                            title="Process image"
                          >
                            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                              <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                          </button>
                        )}
                        {item.status === 'FAILED' && (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); void handleProcessItem(item.id, item.file, item.mode); }}
                            className="h-7 w-7 rounded-[6px] text-[#737373] hover:text-[#111111] flex items-center justify-center transition-colors"
                            title="Retry"
                          >
                            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 6.57M16 8h5V3" />
                            </svg>
                          </button>
                        )}
                        {item.status === 'COMPLETED' && (
                          <div className="flex items-center gap-0.5">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setRefineParams({
                                  jobId: item.jobId!,
                                  originalUrl: item.localPreviewUrl,
                                  processedUrl: item.outputUrl!,
                                });
                              }}
                              className="h-7 w-7 rounded-[6px] text-[#737373] hover:text-[#111111] flex items-center justify-center transition-colors"
                              title="Refine Mask"
                            >
                              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                              </svg>
                            </button>
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); void handleDownload(item); }}
                              className="h-7 w-7 rounded-[6px] text-[#737373] hover:text-[#111111] flex items-center justify-center transition-colors"
                              title="Download PNG"
                            >
                              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                              </svg>
                            </button>
                          </div>
                        )}

                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); handleDelete(item.id); }}
                          className="h-7 w-7 rounded-[6px] text-[#737373] hover:text-[#DC2626] flex items-center justify-center transition-colors"
                          title="Remove file"
                        >
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Right panel: Workspace */}
            <div className="lg:col-span-7 bg-white border border-[#E5E5E5] rounded-[12px] p-5 flex flex-col gap-4">
              {selectedItem ? (
                <>
                  {/* Details header */}
                  <div className="flex items-center justify-between border-b border-[#E5E5E5] pb-3 gap-2">
                    <div className="min-w-0">
                      <h3 className="text-[15px] font-medium text-[#111111] truncate">{selectedItem.file.name}</h3>
                      <div className="flex items-center gap-2 mt-0.5">
                        <p className="text-[12px] text-[#A3A3A3]">{formatBytes(selectedItem.file.size)}</p>
                        <span className="text-[#E5E5E5]">·</span>
                        <span className="inline-flex items-center gap-1 text-[11px] text-[#2563EB] bg-[#EFF6FF] px-2 py-0.5 rounded-full font-medium">
                          {MODES.find((m) => m.id === selectedItem.mode)?.label ?? 'Auto'} mode
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      {selectedItem.status === 'COMPLETED' && selectedItem.outputUrl && (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              setRefineParams({
                                jobId: selectedItem.jobId!,
                                originalUrl: selectedItem.localPreviewUrl,
                                processedUrl: selectedItem.outputUrl!,
                              })
                            }
                            className="inline-flex h-8 items-center justify-center rounded-[6px] border border-[#E5E5E5] bg-white px-3 text-[13px] font-medium text-[#111111] transition hover:bg-[#F5F5F5]"
                          >
                            Refine / Clean
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDownload(selectedItem)}
                            className="inline-flex h-8 items-center justify-center rounded-[6px] bg-[#111111] px-4 text-[13px] font-medium text-white transition hover:bg-[#222222]"
                          >
                            Download
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Workspace body */}
                  <div className="flex flex-col gap-4">
                    
                    {/* Preview workspace - full width */}
                    <div className="flex flex-col gap-4">
                      {/* PENDING */}
                      {selectedItem.status === 'PENDING' && (
                        <div className="relative w-full h-[380px] bg-[#FAFAFA] rounded-[8px] overflow-hidden border border-[#D4D4D4] flex items-center justify-center">
                          <img src={selectedItem.localPreviewUrl} alt="Preview" className="max-h-[90%] max-w-[90%] object-contain rounded-lg" />
                          <div className="absolute inset-0 bg-white/60 flex flex-col items-center justify-center p-6 text-center">
                            <button
                              type="button"
                              id="process-selected-btn"
                              onClick={() => void handleProcessItem(selectedItem.id, selectedItem.file, selectedItem.mode)}
                              className="h-12 w-12 rounded-full bg-[#111111] flex items-center justify-center text-white transition hover:scale-105 active:scale-95"
                            >
                              <svg className="h-5 w-5 fill-current" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                            </button>
                            <h4 className="text-[14px] font-medium text-[#111111] mt-3">Ready to process</h4>
                            <p className="text-[12px] text-[#A3A3A3] mt-1">
                              Using <span className="font-semibold text-[#2563EB]">{MODES.find((m) => m.id === selectedItem.mode)?.label}</span> mode
                            </p>
                          </div>
                        </div>
                      )}

                      {/* UPLOADING / PROCESSING */}
                      {(selectedItem.status === 'UPLOADING' || selectedItem.status === 'PROCESSING') && (
                        <div className="relative w-full h-[380px] bg-[#FAFAFA] rounded-[8px] overflow-hidden border border-[#D4D4D4] flex items-center justify-center">
                          <img src={selectedItem.localPreviewUrl} alt="Preview" className="max-h-[90%] max-w-[90%] object-contain rounded-lg opacity-40 pointer-events-none" />
                          <div className="absolute left-[5%] right-[5%] top-0 h-[1px] bg-[#2563EB] scanner-line pointer-events-none" />
                          <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center bg-white/25">
                            <div className="flex h-6 w-6 animate-spin rounded-full border-2 border-[#E5E5E5] border-t-[#2563EB]" />
                            <h4 className="text-[14px] font-medium text-[#111111] mt-3">Processing...</h4>
                            <p className="text-[12px] text-[#A3A3A3] mt-1">
                              {MODES.find((m) => m.id === selectedItem.mode)?.label} mode
                              {alphaMattingEnabled && ' · Alpha Matting'}
                              {shadowRemovalEnabled && ' · Shadow Removal'}
                              {defringeEnabled && ' · Defringe'}
                              {edgeFeather > 0 && ` · Feather ${edgeFeather}`}
                            </p>
                          </div>
                        </div>
                      )}

                      {/* FAILED */}
                      {selectedItem.status === 'FAILED' && (
                        <div className="relative w-full h-[380px] bg-[#FAFAFA] rounded-[8px] overflow-hidden border border-[#D4D4D4] flex flex-col items-center justify-center p-6 text-center">
                          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#DC2626]/10 border border-[#DC2626]/20 text-[#DC2626]">
                            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                          </div>
                          <h4 className="text-[14px] font-medium text-[#111111] mt-3">Failed</h4>
                          <p className="text-[13px] text-[#DC2626] max-w-sm mt-2 p-3 bg-[#DC2626]/5 rounded-[6px] border border-[#DC2626]/10">
                            {selectedItem.error || 'Failed to remove background.'}
                          </p>
                          <button
                            type="button"
                            onClick={() => void handleProcessItem(selectedItem.id, selectedItem.file, selectedItem.mode)}
                            className="mt-4 inline-flex h-8 items-center justify-center rounded-[6px] border border-[#E5E5E5] px-4 text-[13px] font-medium text-[#111111] transition bg-transparent hover:bg-[#F5F5F5]"
                          >
                            Retry
                          </button>
                        </div>
                      )}

                      {/* COMPLETED — interactive split slider */}
                      {selectedItem.status === 'COMPLETED' && selectedItem.outputUrl && (
                        <div className="lg:col-span-2 flex flex-col gap-2">
                          <div
                            ref={sliderRef}
                            className={`relative w-full rounded-[8px] overflow-hidden border border-[#D4D4D4] select-none transition-all duration-200 ${
                              bgType === 'transparent' ? 'bg-checkerboard-classic' : ''
                            } ${
                              aspectRatio === '1:1' ? 'aspect-square h-auto max-h-[380px]' :
                              aspectRatio === '4:5' ? 'aspect-[4/5] h-auto max-h-[380px]' :
                              aspectRatio === '16:9' ? 'aspect-[16/9] h-auto max-h-[380px]' :
                              aspectRatio === '9:16' ? 'aspect-[9/16] h-auto max-h-[380px]' :
                              aspectRatio === '2:3' ? 'aspect-[2/3] h-auto max-h-[380px]' :
                              'h-[380px]'
                            }`}
                            style={previewBgStyle}
                            onMouseMove={handleMouseMove}
                            onTouchMove={handleTouchMove}
                            onMouseDown={() => setIsDraggingSlider(true)}
                            onTouchStart={() => setIsDraggingSlider(true)}
                          >
                            {/* ── Processed (After) layer — always full size, behind clip ── */}
                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                              <div
                                className="relative flex items-center justify-center"
                                style={{
                                  width: '85%',
                                  height: '85%',
                                  padding: padding > 0 ? `${padding}%` : undefined,
                                  alignItems: alignSubject === 'bottom' ? 'flex-end' : 'center',
                                }}
                              >
                                {/* Grid wrapper so harmonization overlay stacks exactly on img */}
                                <div
                                  style={{
                                    display: 'grid',
                                    gridTemplateColumns: '1fr',
                                    gridTemplateRows: '1fr',
                                    maxHeight: '100%',
                                    maxWidth: '100%',
                                  }}
                                >
                                  <img
                                    src={selectedItem.outputUrl}
                                    alt="Processed Result"
                                    className="max-h-full max-w-full h-auto w-auto object-contain"
                                    style={{
                                      gridArea: '1 / 1',
                                      filter: shadowType === 'drop' ? dropShadowFilterStyle : 'none',
                                    }}
                                  />
                                  {/* Color Harmonization overlay */}
                                  {harmonizeAmount > 0 && (
                                    <div
                                      className="pointer-events-none"
                                      style={{
                                        gridArea: '1 / 1',
                                        backgroundColor: bgAverageColor,
                                        mixBlendMode: 'color',
                                        opacity: (harmonizeAmount / 100) * 0.35,
                                        WebkitMaskImage: `url(${selectedItem.outputUrl})`,
                                        WebkitMaskSize: '100% 100%',
                                        WebkitMaskRepeat: 'no-repeat',
                                        maskImage: `url(${selectedItem.outputUrl})`,
                                        maskSize: '100% 100%',
                                        maskRepeat: 'no-repeat',
                                        width: '100%',
                                        height: '100%',
                                      }}
                                    />
                                  )}
                                </div>
                                {/* Contact Shadow */}
                                {shadowType === 'contact' && (
                                  <div
                                    className="absolute rounded-full pointer-events-none"
                                    style={{
                                      bottom: '0px',
                                      left: '50%',
                                      transform: 'translateX(-50%) scaleY(0.15)',
                                      width: '85%',
                                      height: `${contactShadowScale * 2}px`,
                                      background: `radial-gradient(ellipse at center, rgba(0,0,0,${contactShadowOpacity / 100}) 0%, rgba(0,0,0,0) 70%)`,
                                      filter: `blur(${contactShadowBlur}px)`,
                                    }}
                                  />
                                )}
                              </div>
                            </div>

                            {/* ── Original (Before) layer — same layout, clipped from right ── */}
                            <div
                              className="absolute inset-0 flex items-center justify-center pointer-events-none bg-[#FAFAFA]"
                              style={{ clipPath: `inset(0 ${100 - sliderPosition}% 0 0)` }}
                            >
                              <div
                                className="flex items-center justify-center"
                                style={{
                                  width: '85%',
                                  height: '85%',
                                  padding: padding > 0 ? `${padding}%` : undefined,
                                  alignItems: alignSubject === 'bottom' ? 'flex-end' : 'center',
                                }}
                              >
                                <img
                                  src={selectedItem.localPreviewUrl}
                                  alt="Original Source"
                                  className="max-h-full max-w-full h-auto w-auto object-contain"
                                />
                              </div>
                            </div>

                            {/* Divider handle */}
                            <div
                              className="absolute top-0 bottom-0 w-[2px] bg-white shadow-[0_0_8px_rgba(0,0,0,0.4)] pointer-events-none"
                              style={{ left: `${sliderPosition}%` }}
                            >
                              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white border border-[#E5E5E5] shadow-[0_2px_8px_rgba(0,0,0,0.15)] flex items-center justify-center text-[#737373] text-[11px] font-bold select-none cursor-grab active:cursor-grabbing pointer-events-none">
                                ←→
                              </div>
                            </div>
                            <div className="absolute bottom-3 left-3 bg-white px-2 py-0.5 rounded-[4px] text-[11px] font-medium text-[#111111] shadow-sm pointer-events-none select-none">Original</div>
                            <div className="absolute bottom-3 right-3 bg-white px-2 py-0.5 rounded-[4px] text-[11px] font-medium text-[#111111] shadow-sm pointer-events-none select-none">Processed</div>
                          </div>
                          <p className="text-[12px] text-[#A3A3A3] text-center select-none mt-1 font-medium">Drag to compare ←→</p>
                        </div>
                      )}
                    </div>

                    {/* Design Studio — horizontal tab panel below the preview */}
                    {selectedItem.status === 'COMPLETED' && (
                      <div className="bg-white border border-[#E5E5E5] rounded-[12px] shadow-sm text-neutral-800 overflow-hidden">
                        {/* Tab Bar */}
                        <div className="flex items-center border-b border-[#E5E5E5] bg-[#FAFAFA]">
                          <div className="flex">
                            {(['backdrop', 'shadows', 'layout'] as const).map((tab) => (
                              <button
                                key={tab}
                                type="button"
                                onClick={() => setActiveAccordion(tab)}
                                className={`px-5 py-2.5 text-[12px] font-semibold transition border-b-2 ${
                                  activeAccordion === tab
                                    ? 'border-blue-600 text-blue-600 bg-white'
                                    : 'border-transparent text-[#737373] hover:text-[#111111] hover:bg-white/60'
                                }`}
                              >
                                {tab === 'backdrop' ? '🎨 Backdrop' : tab === 'shadows' ? '🌑 Shadows' : '📐 Layout'}
                              </button>
                            ))}
                          </div>
                          {/* Current state summary */}
                          <div className="ml-auto px-4 flex items-center gap-2 text-[11px] text-[#A3A3A3]">
                            {bgType !== 'transparent' && (
                              <span className="bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full font-medium capitalize">{bgType}</span>
                            )}
                            {shadowType !== 'none' && (
                              <span className="bg-neutral-100 text-neutral-600 px-2 py-0.5 rounded-full font-medium capitalize">{shadowType} shadow</span>
                            )}
                            {harmonizeAmount > 0 && (
                              <span className="bg-purple-50 text-purple-600 px-2 py-0.5 rounded-full font-medium">Harmonize {harmonizeAmount}%</span>
                            )}
                          </div>
                        </div>

                        {/* Tab Content */}
                        <div className="p-4">

                          {/* ── Backdrop Tab ── */}
                          {activeAccordion === 'backdrop' && (
                            <div className="flex flex-wrap gap-x-6 gap-y-4 items-start">
                              {/* Column 1: BG Type + Color/Gradient/Image */}
                              <div className="flex flex-col gap-2 min-w-[200px]">
                                <label className="text-[11px] font-bold text-[#737373] uppercase tracking-wider">Background</label>
                                <div className="flex p-0.5 rounded-[8px] bg-[#E5E5E5]/50 border border-[#E5E5E5] text-[11px]">
                                  {(['transparent', 'color', 'gradient', 'image'] as const).map((type) => (
                                    <button
                                      key={type}
                                      type="button"
                                      onClick={() => setBgType(type)}
                                      className={`flex-1 py-1.5 rounded-[6px] font-medium transition ${
                                        bgType === type ? 'bg-white text-[#111111] shadow-sm font-semibold' : 'text-[#737373] hover:text-[#111111]'
                                      }`}
                                    >
                                      {type === 'transparent' ? 'Clear' : type === 'color' ? 'Solid' : type === 'gradient' ? 'Gradient' : 'Image'}
                                    </button>
                                  ))}
                                </div>

                                {/* Solid color */}
                                {bgType === 'color' && (
                                  <div className="flex items-center gap-2 flex-wrap">
                                    {['#FFFFFF', '#111111', '#F3F4F6', '#E8ECE9', '#E0F2FE', '#FAF0E6'].map((color) => (
                                      <button
                                        key={color}
                                        type="button"
                                        onClick={() => setBgColor(color)}
                                        className={`h-6 w-6 rounded-full border border-black/10 transition-transform ${bgColor === color ? 'scale-110 ring-2 ring-blue-500' : 'hover:scale-105'}`}
                                        style={{ backgroundColor: color }}
                                        title={color}
                                      />
                                    ))}
                                    <div className="flex items-center gap-1.5 ml-1">
                                      <input
                                        type="text"
                                        value={bgColor}
                                        onChange={(e) => setBgColor(e.target.value)}
                                        className="w-20 px-2 py-1 border border-[#E5E5E5] rounded text-[11px] font-mono uppercase bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                                      />
                                      <div className="relative h-6 w-6 rounded border border-black/15 overflow-hidden shrink-0">
                                        <input type="color" value={bgColor} onChange={(e) => setBgColor(e.target.value)} className="absolute inset-[-4px] w-[32px] h-[32px] cursor-pointer" />
                                      </div>
                                    </div>
                                  </div>
                                )}

                                {/* Gradient */}
                                {bgType === 'gradient' && (
                                  <div className="flex flex-wrap items-center gap-3">
                                    {/* Presets */}
                                    <div className="flex items-center gap-1.5">
                                      {[
                                        { start: '#FF6B6B', end: '#FF8E53', name: 'Sunset' },
                                        { start: '#0575E6', end: '#00F260', name: 'Northern Lights' },
                                        { start: '#DA4453', end: '#89216B', name: 'Royal Plum' },
                                        { start: '#11998e', end: '#38ef7d', name: 'Emerald Sea' },
                                        { start: '#F953C6', end: '#B91D73', name: 'Cyberpunk' }
                                      ].map((p, idx) => (
                                        <button
                                          key={idx}
                                          type="button"
                                          onClick={() => applyPresetGradient(p.start, p.end)}
                                          className={`h-6 w-6 rounded-full border border-black/10 transition-transform ${gradientStartColor === p.start && gradientEndColor === p.end ? 'scale-110 ring-2 ring-blue-500' : 'hover:scale-105'}`}
                                          style={{ backgroundImage: `linear-gradient(135deg, ${p.start} 0%, ${p.end} 100%)` }}
                                          title={p.name}
                                        />
                                      ))}
                                    </div>
                                    <div className="flex items-center gap-2 text-[11px]">
                                      <span className="text-[#737373]">From:</span>
                                      <div className="relative h-5 w-5 rounded border border-black/15 overflow-hidden shrink-0">
                                        <input type="color" value={gradientStartColor} onChange={(e) => setGradientStartColor(e.target.value)} className="absolute inset-[-4px] w-[28px] h-[28px] cursor-pointer" />
                                      </div>
                                      <span className="text-[#737373]">To:</span>
                                      <div className="relative h-5 w-5 rounded border border-black/15 overflow-hidden shrink-0">
                                        <input type="color" value={gradientEndColor} onChange={(e) => setGradientEndColor(e.target.value)} className="absolute inset-[-4px] w-[28px] h-[28px] cursor-pointer" />
                                      </div>
                                      <span className="text-[#737373] ml-1">{gradientAngle}°</span>
                                      <input
                                        type="range"
                                        min="0"
                                        max="360"
                                        value={gradientAngle}
                                        onChange={(e) => setGradientAngle(Number(e.target.value))}
                                        className="w-20 h-1 accent-blue-600 cursor-pointer"
                                      />
                                    </div>
                                  </div>
                                )}

                                {/* Image */}
                                {bgType === 'image' && (
                                  <div>
                                    {bgImage ? (
                                      <div className="flex items-center gap-2 text-[11px]">
                                        <div className="h-8 w-8 rounded border border-[#E5E5E5] bg-cover bg-center shrink-0" style={{ backgroundImage: `url(${bgImage})` }} />
                                        <button type="button" onClick={() => setBgImage(null)} className="font-semibold text-[#DC2626] hover:underline">Remove</button>
                                      </div>
                                    ) : (
                                      <label className="inline-flex items-center gap-2 cursor-pointer border border-dashed border-[#D4D4D4] hover:border-blue-500 px-3 py-2 rounded-[6px] text-[11px] text-[#737373] hover:text-blue-600 transition">
                                        <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14M14 8h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                                        Upload backdrop
                                        <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) setBgImage(URL.createObjectURL(f)); }} />
                                      </label>
                                    )}
                                  </div>
                                )}
                              </div>

                              {/* Column 2: Color Harmonization */}
                              <div className="flex flex-col gap-2 min-w-[180px] flex-1">
                                <label className="text-[11px] font-bold text-[#737373] uppercase tracking-wider">Color Harmonization</label>
                                <p className="text-[10px] text-[#A3A3A3] leading-snug">Blends subject edges with the backdrop color.</p>
                                <div className="flex items-center gap-3">
                                  <input
                                    type="range"
                                    min="0"
                                    max="100"
                                    value={harmonizeAmount}
                                    onChange={(e) => setHarmonizeAmount(Number(e.target.value))}
                                    className="flex-1 h-1.5 accent-blue-600 cursor-pointer"
                                  />
                                  <span className="text-[12px] font-bold text-blue-600 w-10 text-right">{harmonizeAmount}%</span>
                                </div>
                              </div>
                            </div>
                          )}

                          {/* ── Shadows Tab ── */}
                          {activeAccordion === 'shadows' && (
                            <div className="flex flex-wrap gap-x-6 gap-y-4 items-start">
                              {/* Shadow Type */}
                              <div className="flex flex-col gap-2">
                                <label className="text-[11px] font-bold text-[#737373] uppercase tracking-wider">Shadow Style</label>
                                <div className="flex p-0.5 rounded-[8px] bg-[#E5E5E5]/50 border border-[#E5E5E5] text-[11px]">
                                  {(['none', 'drop', 'contact'] as const).map((type) => (
                                    <button
                                      key={type}
                                      type="button"
                                      onClick={() => setShadowType(type)}
                                      className={`px-4 py-1.5 rounded-[6px] font-medium transition ${
                                        shadowType === type ? 'bg-white text-[#111111] shadow-sm font-semibold' : 'text-[#737373] hover:text-[#111111]'
                                      }`}
                                    >
                                      {type === 'none' ? 'None' : type === 'drop' ? 'Drop Shadow' : 'Contact Shadow'}
                                    </button>
                                  ))}
                                </div>
                              </div>

                              {/* Drop shadow controls inline */}
                              {shadowType === 'drop' && (
                                <div className="flex flex-wrap gap-4 items-end text-[11px]">
                                  {[
                                    { label: 'Angle', val: shadowAngle, set: setShadowAngle, min: 0, max: 360, unit: '°' },
                                    { label: 'Distance', val: shadowDistance, set: setShadowDistance, min: 0, max: 50, unit: 'px' },
                                    { label: 'Blur', val: shadowBlur, set: setShadowBlur, min: 0, max: 80, unit: 'px' },
                                    { label: 'Opacity', val: shadowOpacity, set: setShadowOpacity, min: 0, max: 100, unit: '%' },
                                  ].map((ctrl) => (
                                    <div key={ctrl.label} className="flex flex-col gap-1 min-w-[100px]">
                                      <div className="flex items-center justify-between">
                                        <span className="text-[#737373] font-medium">{ctrl.label}</span>
                                        <span className="font-bold text-blue-600 font-mono">{ctrl.val}{ctrl.unit}</span>
                                      </div>
                                      <input type="range" min={ctrl.min} max={ctrl.max} value={ctrl.val}
                                        onChange={(e) => ctrl.set(Number(e.target.value))}
                                        className="w-full h-1 accent-blue-600 cursor-pointer"
                                      />
                                    </div>
                                  ))}
                                  <div className="flex flex-col gap-1">
                                    <span className="text-[#737373] font-medium">Color</span>
                                    <input type="color" value={shadowColor} onChange={(e) => setShadowColor(e.target.value)}
                                      className="h-7 w-10 rounded cursor-pointer border border-[#E5E5E5] p-0.5" />
                                  </div>
                                </div>
                              )}

                              {/* Contact shadow controls inline */}
                              {shadowType === 'contact' && (
                                <div className="flex flex-wrap gap-4 items-end text-[11px]">
                                  {[
                                    { label: 'Blur', val: contactShadowBlur, set: setContactShadowBlur, min: 0, max: 80, unit: 'px' },
                                    { label: 'Opacity', val: contactShadowOpacity, set: setContactShadowOpacity, min: 0, max: 100, unit: '%' },
                                    { label: 'Flatness', val: contactShadowScale, set: setContactShadowScale, min: 5, max: 30, unit: '%' },
                                  ].map((ctrl) => (
                                    <div key={ctrl.label} className="flex flex-col gap-1 min-w-[100px]">
                                      <div className="flex items-center justify-between">
                                        <span className="text-[#737373] font-medium">{ctrl.label}</span>
                                        <span className="font-bold text-blue-600 font-mono">{ctrl.val}{ctrl.unit}</span>
                                      </div>
                                      <input type="range" min={ctrl.min} max={ctrl.max} value={ctrl.val}
                                        onChange={(e) => ctrl.set(Number(e.target.value))}
                                        className="w-full h-1 accent-blue-600 cursor-pointer"
                                      />
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}

                          {/* ── Layout Tab ── */}
                          {activeAccordion === 'layout' && (
                            <div className="flex flex-wrap gap-x-6 gap-y-4 items-start">
                              {/* Aspect Ratio */}
                              <div className="flex flex-col gap-2">
                                <label className="text-[11px] font-bold text-[#737373] uppercase tracking-wider">Aspect Ratio</label>
                                <div className="flex gap-1 p-0.5 rounded-[8px] bg-[#E5E5E5]/50 border border-[#E5E5E5] text-[11px]">
                                  {(['original', '1:1', '4:5', '16:9', '9:16', '2:3'] as const).map((aspect) => (
                                    <button
                                      key={aspect}
                                      type="button"
                                      onClick={() => setAspectRatio(aspect)}
                                      className={`px-2 py-1.5 rounded-[6px] font-medium transition whitespace-nowrap ${
                                        aspectRatio === aspect ? 'bg-white text-[#111111] shadow-sm font-semibold' : 'text-[#737373] hover:text-[#111111]'
                                      }`}
                                    >
                                      {aspect === 'original' ? 'Original' : aspect}
                                    </button>
                                  ))}
                                </div>
                              </div>

                              {/* Subject Alignment */}
                              <div className="flex flex-col gap-2">
                                <label className="text-[11px] font-bold text-[#737373] uppercase tracking-wider">Alignment</label>
                                <div className="flex gap-1 p-0.5 rounded-[8px] bg-[#E5E5E5]/50 border border-[#E5E5E5] text-[11px]">
                                  {(['center', 'bottom'] as const).map((align) => (
                                    <button
                                      key={align}
                                      type="button"
                                      onClick={() => setAlignSubject(align)}
                                      className={`px-4 py-1.5 rounded-[6px] font-medium transition capitalize ${
                                        alignSubject === align ? 'bg-white text-[#111111] shadow-sm font-semibold' : 'text-[#737373] hover:text-[#111111]'
                                      }`}
                                    >
                                      {align}
                                    </button>
                                  ))}
                                </div>
                              </div>

                              {/* Padding */}
                              <div className="flex flex-col gap-2">
                                <label className="text-[11px] font-bold text-[#737373] uppercase tracking-wider">Padding</label>
                                <div className="flex gap-1 p-0.5 rounded-[8px] bg-[#E5E5E5]/50 border border-[#E5E5E5] text-[11px]">
                                  {([0, 10, 20, 30] as const).map((pad) => (
                                    <button
                                      key={pad}
                                      type="button"
                                      onClick={() => setPadding(pad)}
                                      className={`px-3 py-1.5 rounded-[6px] font-medium transition ${
                                        padding === pad ? 'bg-white text-[#111111] shadow-sm font-semibold' : 'text-[#737373] hover:text-[#111111]'
                                      }`}
                                    >
                                      {pad === 0 ? 'None' : `${pad}%`}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center justify-center min-h-[350px] text-center p-6 border border-dashed border-[#E5E5E5] rounded-[12px] bg-white">
                  <svg className="h-8 w-8 text-[#737373]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <h4 className="text-[14px] font-medium text-[#111111] mt-3">No image selected</h4>
                  <p className="text-[13px] text-[#737373] mt-1">Select an image from the files list to preview it here.</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── History ── */}
        <section className="bg-white border border-[#E5E5E5] rounded-[12px] p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#F0F0F0] pb-4">
            <div>
              <h2 className="text-[15px] font-medium text-[#111111]">History</h2>
              <p className="text-[12px] text-[#A3A3A3] mt-0.5">Past background removals for this workspace user.</p>
            </div>
            <button
              type="button"
              onClick={() => void fetchHistory(currentPage)}
              className="inline-flex h-8 items-center justify-center rounded-[6px] border border-[#E5E5E5] bg-transparent px-3 text-[13px] font-medium text-[#111111] transition-colors duration-100 hover:bg-[#F5F5F5]"
            >
              Refresh
            </button>
          </div>

          {/* Selection Control Bar */}
          {!historyLoading && historyItems.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#F0F0F0] py-3 bg-[#FAFAFA] px-5 -mx-5 mb-4 text-[13px]">
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 font-medium text-[#555] cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={historyItems.length > 0 && historyItems.every((job) => selectedJobIds.includes(job.job_id))}
                    onChange={toggleSelectAllJobs}
                    className="h-4 w-4 rounded border-[#D1D5DB] text-[#111111] focus:ring-0 cursor-pointer accent-[#111111]"
                  />
                  Select All
                </label>
                {selectedJobIds.length > 0 && (
                  <span className="text-[#737373] font-medium">({selectedJobIds.length} selected)</span>
                )}
              </div>
              {selectedJobIds.length > 0 && (
                <button
                  type="button"
                  onClick={handleDeleteSelectedJobs}
                  className="inline-flex h-7.5 items-center justify-center rounded-[6px] bg-[#DC2626] px-3 text-[12px] font-medium text-white transition hover:bg-[#B91C1C]"
                >
                  Delete Selected
                </button>
              )}
            </div>
          )}

          {historyLoading ? (
            <div className="grid gap-4 pt-2 sm:grid-cols-2 xl:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="overflow-hidden rounded-[10px] border border-[#E5E5E5] bg-[#FCFCFC]">
                  <div className="aspect-[4/3] animate-pulse bg-[#F3F4F6]" />
                  <div className="space-y-2 p-3">
                    <div className="h-3 w-2/3 animate-pulse rounded bg-[#F3F4F6]" />
                    <div className="h-3 w-1/2 animate-pulse rounded bg-[#F3F4F6]" />
                  </div>
                </div>
              ))}
            </div>
          ) : historyItems.length === 0 ? (
            <div className="flex min-h-[160px] items-center justify-center text-center">
              <div>
                <p className="text-[14px] font-medium text-[#111111]">No history yet</p>
                <p className="mt-1 text-[12px] text-[#A3A3A3]">Processed images will appear here after completion.</p>
              </div>
            </div>
          ) : (
            <>
              <div className="grid gap-4 pt-2 sm:grid-cols-2 xl:grid-cols-4">
                {historyItems.map((job) => (
                  <article key={job.job_id} className="relative overflow-hidden rounded-[10px] border border-[#E5E5E5] bg-[#FCFCFC]">
                    {/* Card Checkbox */}
                    <div className="absolute right-3 top-3 z-10">
                      <input
                        type="checkbox"
                        checked={selectedJobIds.includes(job.job_id)}
                        onChange={() => toggleSelectJob(job.job_id)}
                        className="h-4.5 w-4.5 rounded border-[#C2C2C2] text-[#111111] focus:ring-0 bg-white/95 shadow-sm cursor-pointer accent-[#111111]"
                      />
                    </div>

                    <div className="relative aspect-[4/3] overflow-hidden border-b border-[#EFEFEF] bg-checkerboard-classic">
                      {job.status === 'COMPLETED' && job.output_url ? (
                        <img src={job.output_url} alt="Processed result" className="h-full w-full object-contain" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-[#FEF2F2] text-[#DC2626]">
                          <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m0 3.75h.008v.008H12v-.008Zm8.25-.75a8.25 8.25 0 1 1-16.5 0 8.25 8.25 0 0 1 16.5 0Z" />
                          </svg>
                        </div>
                      )}
                      <span className={`absolute left-3 top-3 inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${job.status === 'COMPLETED' ? 'bg-[#F0FDF4] text-[#16A34A]' : 'bg-[#FEF2F2] text-[#DC2626]'}`}>
                        {job.status === 'COMPLETED' ? 'Completed' : 'Failed'}
                      </span>
                    </div>

                    <div className="space-y-3 p-3">
                      <div className="space-y-1">
                        <p className="truncate text-[13px] font-medium pr-6 text-[#111111]">
                          {job.input_url.split('/').pop() ?? job.job_id}
                        </p>
                        <p className="text-[12px] text-[#A3A3A3]">{formatHistoryDate(job.updated_at ?? job.created_at)}</p>
                      </div>
                      {job.status === 'FAILED' && job.error && (
                        <p className="line-clamp-2 text-[12px] text-[#DC2626]">{job.error}</p>
                      )}
                      
                      <div className="flex items-center justify-between gap-2 border-t border-[#EFEFEF] pt-3 mt-3">
                        <div className="flex items-center gap-1.5">
                          {job.output_url && (
                            <>
                              <button
                                type="button"
                                onClick={() =>
                                  setRefineParams({
                                    jobId: job.job_id,
                                    originalUrl: job.input_url,
                                    processedUrl: job.output_url!,
                                  })
                                }
                                className="inline-flex h-8 items-center justify-center rounded-[6px] bg-[#111111] px-2.5 text-[12px] font-medium text-white transition hover:bg-[#222222]"
                              >
                                Refine
                              </button>
                              <a
                                href={job.output_url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex h-8 items-center justify-center rounded-[6px] border border-[#E5E5E5] px-2.5 text-[12px] font-medium text-[#111111] transition hover:bg-[#F5F5F5]"
                              >
                                Open PNG
                              </a>
                            </>
                          )}
                          {!job.output_url && (
                            <a
                              href={job.input_url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex h-8 items-center justify-center rounded-[6px] border border-[#E5E5E5] px-2.5 text-[12px] font-medium text-[#111111] transition hover:bg-[#F5F5F5]"
                            >
                              Source
                            </a>
                          )}
                        </div>

                        
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            disabled={retryingJobIds.includes(job.job_id)}
                            onClick={() => void handleRetry(job)}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-[6px] border border-[#E5E5E5] bg-white text-[#555] hover:text-[#111] hover:bg-[#F5F5F5] disabled:opacity-50 transition"
                            title="Retry background removal with current settings"
                          >
                            {retryingJobIds.includes(job.job_id) ? (
                              <svg className="animate-spin h-3.5 w-3.5 text-[#555]" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                              </svg>
                            ) : (
                              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
                              </svg>
                            )}
                          </button>

                          <button
                            type="button"
                            onClick={() => void handleDeleteJob(job.job_id)}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-[6px] border border-[#FEE2E2] bg-white text-[#DC2626] hover:bg-[#FEF2F2] transition"
                            title="Delete history entry"
                          >
                            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    </div>
                  </article>
                ))}
              </div>

              {/* Pagination controls */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between border-t border-[#F0F0F0] pt-4 mt-6">
                  <p className="text-[13px] text-[#737373]">
                    Showing page <span className="font-medium text-[#111]">{currentPage}</span> of{' '}
                    <span className="font-medium text-[#111]">{totalPages}</span> ({totalJobs} items)
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={currentPage <= 1 || historyLoading}
                      onClick={() => void fetchHistory(currentPage - 1)}
                      className="inline-flex h-8 items-center justify-center rounded-[6px] border border-[#E5E5E5] bg-white px-3 text-[13px] font-medium text-[#111111] transition hover:bg-[#F5F5F5] disabled:opacity-50 disabled:pointer-events-none"
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      disabled={currentPage >= totalPages || historyLoading}
                      onClick={() => void fetchHistory(currentPage + 1)}
                      className="inline-flex h-8 items-center justify-center rounded-[6px] border border-[#E5E5E5] bg-white px-3 text-[13px] font-medium text-[#111111] transition hover:bg-[#F5F5F5] disabled:opacity-50 disabled:pointer-events-none"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      </div>

      {refineParams && (
        <MaskRefiner
          isOpen={!!refineParams}
          onClose={() => setRefineParams(null)}
          originalImageUrl={refineParams.originalUrl}
          processedImageUrl={refineParams.processedUrl}
          jobId={refineParams.jobId}
          apiBaseUrl={apiBaseUrl}
          onSave={handleSaveRefinement}
        />
      )}
    </section>
  );
}

