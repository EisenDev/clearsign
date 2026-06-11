'use client';

import { ChangeEvent, DragEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';

interface RemoveBackgroundRequest {
  image_url: string;
  user_id: string;
}

interface RemoveBackgroundAcceptedResponse {
  job_id: string;
  status: JobStatus;
}

type JobStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

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
}

interface BackgroundRemoverProps {
  apiBaseUrl?: string;
  userId: string;
  uploadToR2?: (file: File) => Promise<string>;
}

function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

export default function BackgroundRemover({
  apiBaseUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000',
  userId,
  uploadToR2,
}: BackgroundRemoverProps) {
  const [items, setItems] = useState<BatchItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [isProcessingAll, setIsProcessingAll] = useState<boolean>(false);
  const [isZipping, setIsZipping] = useState<boolean>(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [showAllDone, setShowAllDone] = useState<boolean>(false);
  const [history, setHistory] = useState<JobStatusResponse[]>([]);
  const [historyLoading, setHistoryLoading] = useState<boolean>(true);
  // Background toggle state: transparent, white, black
  const [bgMode, setBgMode] = useState<'transparent' | 'white' | 'black'>('transparent');

  // Split slider workspace state
  const [sliderPosition, setSliderPosition] = useState<number>(50);
  const [isDraggingSlider, setIsDraggingSlider] = useState<boolean>(false);
  
  const sliderRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Clean up object URLs to prevent memory leaks
  useEffect(() => {
    return () => {
      items.forEach((item) => {
        URL.revokeObjectURL(item.localPreviewUrl);
      });
    };
  }, []);

  const selectedItem = useMemo(() => {
    return items.find((i) => i.id === selectedId) || null;
  }, [items, selectedId]);

  const historyItems = useMemo(() => {
    return history.filter((job) => job.status === 'COMPLETED' || job.status === 'FAILED');
  }, [history]);

  const stats = useMemo(() => {
    const total = items.length;
    const completed = items.filter((i) => i.status === 'COMPLETED').length;
    const processing = items.filter((i) => i.status === 'PROCESSING' || i.status === 'UPLOADING').length;
    const pending = items.filter((i) => i.status === 'PENDING').length;
    const failed = items.filter((i) => i.status === 'FAILED').length;
    return { total, completed, processing, pending, failed };
  }, [items]);

  const uploadSourceImage = useCallback(
    async (file: File): Promise<string> => {
      if (uploadToR2) {
        return uploadToR2(file);
      }

      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch(`${apiBaseUrl}/api/media/uploads`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Failed to upload source image (${response.status}).`);
      }

      const payload = (await response.json()) as { image_url: string };
      return payload.image_url;
    },
    [apiBaseUrl, uploadToR2],
  );

  const fetchHistory = useCallback(async (): Promise<void> => {
    setHistoryLoading(true);
    try {
      const response = await fetch(
        `${apiBaseUrl}/api/media/history?user_id=${encodeURIComponent(userId)}&limit=24`,
        {
          method: 'GET',
          headers: { Accept: 'application/json' },
          cache: 'no-store',
        },
      );

      if (!response.ok) {
        throw new Error(`History error (${response.status})`);
      }

      const payload = (await response.json()) as JobHistoryResponse;
      setHistory(payload.jobs);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load history.';
      setGlobalError(message);
    } finally {
      setHistoryLoading(false);
    }
  }, [apiBaseUrl, userId]);

  useEffect(() => {
    void fetchHistory();
  }, [fetchHistory]);

  const processItem = useCallback(
    async (itemId: string, file: File): Promise<void> => {
      setItems((prev) =>
        prev.map((i) => (i.id === itemId ? { ...i, status: 'UPLOADING', error: null, progress: 15 } : i)),
      );

      try {
        const uploadedUrl = await uploadSourceImage(file);
        setItems((prev) =>
          prev.map((i) => (i.id === itemId ? { ...i, status: 'PROCESSING', progress: 40 } : i)),
        );

        const response = await fetch(`${apiBaseUrl}/api/media/remove-background`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            image_url: uploadedUrl,
            user_id: userId,
          } satisfies RemoveBackgroundRequest),
        });

        if (!response.ok) {
          throw new Error(`Queue error (${response.status})`);
        }

        const payload = (await response.json()) as RemoveBackgroundAcceptedResponse;
        setItems((prev) =>
          prev.map((i) => (i.id === itemId ? { ...i, jobId: payload.job_id, progress: 60 } : i)),
        );

        // Start polling
        let status = payload.status;
        let finalJob: JobStatusResponse | null = null;
        let attempts = 0;
        const maxAttempts = 60; // 2 minutes

        while ((status === 'PENDING' || status === 'PROCESSING') && attempts < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          attempts++;

          const jobResponse = await fetch(`${apiBaseUrl}/api/media/jobs/${payload.job_id}`, {
            method: 'GET',
            headers: { Accept: 'application/json' },
            cache: 'no-store',
          });

          if (!jobResponse.ok) {
            throw new Error(`Status error (${jobResponse.status})`);
          }

          finalJob = (await jobResponse.json()) as JobStatusResponse;
          status = finalJob.status;

          setItems((prev) =>
            prev.map((i) =>
              i.id === itemId
                ? {
                    ...i,
                    status: status === 'PROCESSING' ? 'PROCESSING' : i.status,
                    progress: status === 'PROCESSING' ? 80 : 70,
                  }
                : i,
            ),
          );
        }

        if (finalJob && finalJob.status === 'COMPLETED' && finalJob.output_url) {
          setItems((prev) =>
            prev.map((i) =>
              i.id === itemId
                ? {
                    ...i,
                    status: 'COMPLETED',
                    outputUrl: finalJob!.output_url,
                    progress: 100,
                  }
                : i,
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
          prev.map((i) =>
            i.id === itemId
              ? {
                  ...i,
                  status: 'FAILED',
                  error: message,
                  progress: 100,
                }
              : i,
          ),
        );
        await fetchHistory();
      }
    },
    [apiBaseUrl, fetchHistory, uploadSourceImage, userId],
  );

  const addFiles = useCallback((files: File[]): void => {
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
    }));

    setItems((prev) => [...prev, ...newItems]);
    setSelectedId((current) => current ?? newItems[0].id);
    setGlobalError(null);
  }, []);

  const handleFileChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>): void => {
      if (event.target.files) {
        addFiles(Array.from(event.target.files));
      }
    },
    [addFiles],
  );

  const onDragOver = useCallback((e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const onDragLeave = useCallback((): void => {
    setIsDragging(false);
  }, []);

  const onDrop = useCallback(
    (e: DragEvent<HTMLDivElement>): void => {
      e.preventDefault();
      setIsDragging(false);
      if (e.dataTransfer.files) {
        addFiles(Array.from(e.dataTransfer.files));
      }
    },
    [addFiles],
  );

  const handleProcessItem = useCallback(
    async (itemId: string, file: File): Promise<void> => {
      await processItem(itemId, file);
    },
    [processItem],
  );

  const handleProcessAll = useCallback(
    async (currentItems: BatchItem[]): Promise<void> => {
      setIsProcessingAll(true);
      const targets = currentItems.filter((i) => i.status === 'PENDING' || i.status === 'FAILED');
      for (const item of targets) {
        await processItem(item.id, item.file);
      }
      setIsProcessingAll(false);
      
      const hasCompleted = currentItems.some((i) => i.status === 'COMPLETED') || targets.length > 0;
      if (hasCompleted) {
        setShowAllDone(true);
        setTimeout(() => {
          setShowAllDone(false);
        }, 2000);
      }
    },
    [processItem],
  );

  const handleDelete = useCallback((itemId: string): void => {
    setItems((prev) => {
      const target = prev.find((i) => i.id === itemId);
      if (target) {
        URL.revokeObjectURL(target.localPreviewUrl);
      }
      const filtered = prev.filter((i) => i.id !== itemId);
      setSelectedId((current) => {
        if (current === itemId) {
          return filtered.length > 0 ? filtered[0].id : null;
        }
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

  const handleDownload = useCallback(
    async (item: BatchItem): Promise<void> => {
      if (!item.outputUrl) return;
      try {
        const response = await fetch(item.outputUrl);
        if (!response.ok) throw new Error(`HTTP error ${response.status}`);
        const blob = await response.blob();
        saveAs(blob, item.file.name);
      } catch (err) {
        console.error('Download failed via fetch, trying fallback', err);
        try {
          saveAs(item.outputUrl, item.file.name);
        } catch (fallbackErr) {
          setGlobalError(`Failed to download ${item.file.name}`);
        }
      }
    },
    [],
  );

  const handleDownloadAll = useCallback(
    async (currentItems: BatchItem[]): Promise<void> => {
      const completed = currentItems.filter((i) => i.status === 'COMPLETED' && i.outputUrl);
      if (completed.length === 0) return;

      setIsZipping(true);
      try {
        const zip = new JSZip();
        for (const item of completed) {
          if (!item.outputUrl) continue;
          try {
            const response = await fetch(item.outputUrl);
            if (!response.ok) throw new Error(`HTTP error ${response.status}`);
            const blob = await response.blob();
            zip.file(item.file.name, blob);
          } catch (fetchErr) {
            console.error(`Failed to fetch ${item.file.name} for ZIP`, fetchErr);
            throw fetchErr;
          }
        }

        const zipBlob = await zip.generateAsync({ type: 'blob' });
        saveAs(zipBlob, 'clearsign-exports.zip');
      } catch (err) {
        console.error('ZIP generation failed', err);
        setGlobalError('Failed to create ZIP export.');
      } finally {
        setIsZipping(false);
      }
    },
    [],
  );

  const formatHistoryDate = useCallback((value: string | null): string => {
    if (!value) {
      return 'Recently';
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return 'Recently';
    }
    return parsed.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }, []);

  // Slider Mouse/Touch Handlers
  const handleMove = useCallback((clientX: number) => {
    if (!sliderRef.current) return;
    const rect = sliderRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const percentage = Math.max(0, Math.min(100, (x / rect.width) * 100));
    setSliderPosition(percentage);
  }, []);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDraggingSlider) return;
      handleMove(e.clientX);
    },
    [isDraggingSlider, handleMove],
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!isDraggingSlider) return;
      if (e.touches[0]) {
        handleMove(e.touches[0].clientX);
      }
    },
    [isDraggingSlider, handleMove],
  );

  useEffect(() => {
    const handleMouseUp = () => setIsDraggingSlider(false);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('touchend', handleMouseUp);
    return () => {
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('touchend', handleMouseUp);
    };
  }, []);

  // Compute preview background CSS classes based on bgMode toggle
  const previewBgClass = useMemo(() => {
    if (bgMode === 'white') return 'bg-white';
    if (bgMode === 'black') return 'bg-[#111111]';
    return 'bg-checkerboard-classic';
  }, [bgMode]);

  return (
    <section className="flex w-full flex-col text-[#111111] min-h-screen pb-12 bg-[#FAFAFA]">
      {/* Header bar: full-width, sticky */}
      <header className="sticky top-0 z-50 flex h-[56px] items-center justify-between border-b border-[#E5E5E5] bg-white px-6 w-full">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between">
          <div className="flex items-center gap-2">
            {/* Logo Mark: 2x2 grid where bottom-right is cut out */}
            <div className="grid grid-cols-2 gap-[2px] w-[14px] h-[14px] shrink-0">
              <div className="w-[6px] h-[6px] bg-[#111111] rounded-[1px]"></div>
              <div className="w-[6px] h-[6px] bg-[#111111] rounded-[1px]"></div>
              <div className="w-[6px] h-[6px] bg-[#111111] rounded-[1px]"></div>
              <div className="w-[6px] h-[6px] border border-dashed border-[#D4D4D4] rounded-[1px]"></div>
            </div>
            <h1 className="app-title text-[#111111] leading-none select-none">
              ClearSign
            </h1>
          </div>
          <div className="flex items-center gap-3">
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
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={handleFileChange}
            />
          </div>
        </div>
      </header>

      {/* Main content wrapper */}
      <div className="mx-auto w-full max-w-7xl px-6 mt-6 flex flex-col gap-6">
        {/* Global Error Banner */}
        {globalError && (
          <div className="flex items-center gap-3 bg-[#DC2626]/10 border border-[#DC2626]/20 text-[#DC2626] px-4 py-3 rounded-[6px] text-[14px]">
            <svg className="h-4 w-4 shrink-0 text-[#DC2626]" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd" />
            </svg>
            {globalError}
          </div>
        )}

        {items.length === 0 ? (
          /* Empty Upload Zone */
          <div className="flex flex-col items-center justify-center py-20">
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
                {/* Cloud upload icon */}
                <svg className="h-8 w-8 text-[#A3A3A3] mb-1" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z" />
                </svg>
                <h3 className="text-[16px] font-medium text-[#111111]">Drop your files here</h3>
                <p className="text-[13px] text-[#A3A3A3]">PNG, JPG or WebP</p>
                <span className="text-[12px] text-[#C0C0C0] my-0.5">or</span>
                <span className="text-[13px] text-[#2563EB] hover:underline font-medium">Browse files</span>
              </div>
            </div>

            {/* Feature hints */}
            <div className="flex items-center gap-6 mt-8">
              <div className="flex items-center gap-1.5 text-[12px] text-[#A3A3A3] font-medium">
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
                <span>Batch processing</span>
              </div>
              <span className="text-[#E5E5E5]">|</span>
              <div className="flex items-center gap-1.5 text-[12px] text-[#A3A3A3] font-medium">
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1V5z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 4v16M15 4v16M4 9h16M4 15h16" />
                </svg>
                <span>Transparent PNG output</span>
              </div>
              <span className="text-[#E5E5E5]">|</span>
              <div className="flex items-center gap-1.5 text-[12px] text-[#A3A3A3] font-medium">
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 21l-1.813-5.096L2.091 14 7.187 12.096 8 7l1.813 5.096L14.909 14l-5.096 1.904zM18.813 5.904L18 9l-1.813-3.096L13.091 5 16.187 3.906 17 1l1.813 2.906L21.909 5l-3.096.904z" />
                </svg>
                <span>AI-powered precision</span>
              </div>
            </div>
          </div>
        ) : (
          /* Dashboard Layout */
          <div className="grid gap-6 lg:grid-cols-12 items-start">
            {/* Left panel: Batch list (5 columns) */}
            <div className="lg:col-span-5 flex flex-col gap-4 bg-white border border-[#E5E5E5] rounded-[12px] p-5">
              {/* Panel Header */}
              <div className="flex flex-col gap-0.5">
                <span className="text-[13px] uppercase tracking-[0.08em] font-medium text-[#737373]">
                  Files
                </span>
                <span className="text-[12px] text-[#A3A3A3]">
                  {stats.completed} of {stats.total} processed
                </span>
              </div>

              {/* Action Bar */}
              <div className="flex items-center justify-between border-b border-[#F0F0F0] pb-4 gap-2">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleProcessAll(items)}
                    disabled={isProcessingAll || stats.pending + stats.failed === 0}
                    className={`inline-flex h-8 items-center justify-center rounded-[6px] px-3 text-[13px] font-medium text-white transition-colors duration-100 disabled:opacity-30 disabled:cursor-not-allowed ${
                      showAllDone 
                        ? 'bg-[#16A34A] hover:bg-[#15803D]' 
                        : 'bg-[#111111] hover:bg-[#222222]'
                    }`}
                  >
                    {isProcessingAll ? (
                      <span className="flex items-center gap-1.5">
                        <svg className="animate-spin h-3.5 w-3.5 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        {`Processing ${items.filter(i => i.status === 'PROCESSING' || i.status === 'UPLOADING').length || 1} of ${stats.total}...`}
                      </span>
                    ) : showAllDone ? (
                      'All done ✓'
                    ) : (
                      'Remove backgrounds'
                    )}
                  </button>
                  {stats.completed > 0 && (
                    <button
                      type="button"
                      onClick={() => void handleDownloadAll(items)}
                      disabled={isZipping}
                      className="inline-flex h-8 items-center justify-center rounded-[6px] border border-[#E5E5E5] bg-transparent px-3 text-[13px] font-medium text-[#111111] transition-colors duration-100 hover:bg-[#F5F5F5] disabled:opacity-50"
                    >
                      {isZipping ? (
                        <span className="flex items-center gap-1.5">
                          <svg className="animate-spin h-3.5 w-3.5 text-[#111111]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                          Preparing zip...
                        </span>
                      ) : (
                        'Download all'
                      )}
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

              {/* List Container */}
              <div className="flex flex-col max-h-[500px] overflow-y-auto pr-1">
                {items.map((item, index) => {
                  const isSelected = item.id === selectedId;
                  const nextItem = items[index + 1];
                  const nextIsSelected = nextItem?.id === selectedId;
                  const showDivider = !isSelected && !nextIsSelected;
                  
                  return (
                    <div
                      key={item.id}
                      onClick={() => setSelectedId(item.id)}
                      className={`group relative flex items-center justify-between gap-3 h-[52px] px-3 transition-colors duration-100 cursor-pointer ${
                        isSelected
                          ? 'bg-[#F7F7F7] border-l-2 border-[#2563EB]'
                          : 'hover:bg-[#FAFAFA]'
                      } ${showDivider ? 'border-b border-[#F0F0F0]' : ''}`}
                    >
                      {/* Left side: Thumbnail */}
                      <div className="relative h-8 w-8 shrink-0 rounded-md overflow-hidden bg-[#FAFAFA] border border-[#E5E5E5] flex items-center justify-center">
                        <img
                          src={item.localPreviewUrl}
                          alt="Thumbnail"
                          className="h-full w-full object-contain pointer-events-none"
                        />
                        {item.status === 'COMPLETED' && (
                          <div className="absolute inset-0 bg-checkerboard-classic opacity-20 pointer-events-none" />
                        )}
                      </div>

                      {/* Middle: Details */}
                      <div className="flex-1 min-w-0 flex flex-col justify-center">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[14px] font-medium text-[#111111] truncate pr-1">
                            {item.file.name}
                          </span>
                          <span className="text-[12px] text-[#A3A3A3] shrink-0 font-medium">
                            {formatBytes(item.file.size)}
                          </span>
                        </div>

                        {/* Progress bar or status pill */}
                        {(item.status === 'PROCESSING' || item.status === 'UPLOADING') ? (
                          <div className="w-full bg-[#E5E5E5] h-[2px] mt-1 overflow-hidden rounded-full">
                            <div
                              className="progress-shimmer h-full transition-all duration-300"
                              style={{ width: `${item.progress}%` }}
                            />
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 mt-0.5 transition-opacity duration-150">
                            {item.status === 'PENDING' && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#F4F4F4] text-[#737373]">
                                Ready
                              </span>
                            )}
                            {item.status === 'COMPLETED' && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#F0FDF4] text-[#16A34A]">
                                <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                </svg>
                                Done
                              </span>
                            )}
                            {item.status === 'FAILED' && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#FEF2F2] text-[#DC2626]">
                                <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                                Failed
                              </span>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Right side Actions on Hover */}
                      <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-100">
                        {item.status === 'PENDING' && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleProcessItem(item.id, item.file);
                            }}
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
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleProcessItem(item.id, item.file);
                            }}
                            className="h-7 w-7 rounded-[6px] text-[#737373] hover:text-[#111111] flex items-center justify-center transition-colors"
                            title="Retry process"
                          >
                            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 6.57M16 8h5V3" />
                            </svg>
                          </button>
                        )}
                        {item.status === 'COMPLETED' && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleDownload(item);
                            }}
                            className="h-7 w-7 rounded-[6px] text-[#737373] hover:text-[#111111] flex items-center justify-center transition-colors"
                            title="Download PNG"
                          >
                            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                            </svg>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(item.id);
                          }}
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

            {/* Right panel: Workspace detailing the active item (7 columns) */}
            <div className="lg:col-span-7 bg-white border border-[#E5E5E5] rounded-[12px] p-5 flex flex-col gap-4">
              {selectedItem ? (
                <>
                  {/* Details header */}
                  <div className="flex items-center justify-between border-b border-[#E5E5E5] pb-3 gap-2">
                    <div className="min-w-0">
                      <h3 className="text-[15px] font-medium text-[#111111] truncate">
                        {selectedItem.file.name}
                      </h3>
                      <p className="text-[12px] text-[#A3A3A3] mt-0.5">
                        {formatBytes(selectedItem.file.size)}
                      </p>
                    </div>
                    
                    <div className="flex items-center gap-3">
                      {/* Background Color Toggle */}
                      <div className="flex items-center border border-[#E5E5E5] rounded-[6px] p-0.5 bg-[#F4F4F4]">
                        <button
                          type="button"
                          onClick={() => setBgMode('transparent')}
                          className={`h-[28px] w-[28px] rounded-[4px] flex items-center justify-center transition-colors duration-100 ${
                            bgMode === 'transparent' ? 'bg-white shadow-[0_1px_3px_rgba(0,0,0,0.1)] text-[#111111]' : 'text-[#737373] hover:text-[#111111]'
                          }`}
                          title="Transparent checkerboard"
                        >
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <rect width="18" height="18" x="3" y="3" rx="2" />
                            <path d="M9 3v18M15 3v18M3 9h18M3 15h18" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          onClick={() => setBgMode('white')}
                          className={`h-[28px] w-[28px] rounded-[4px] flex items-center justify-center transition-colors duration-100 ${
                            bgMode === 'white' ? 'bg-white shadow-[0_1px_3px_rgba(0,0,0,0.1)] text-[#111111]' : 'text-[#737373] hover:text-[#111111]'
                          }`}
                          title="White background"
                        >
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <circle cx="12" cy="12" r="4" />
                            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          onClick={() => setBgMode('black')}
                          className={`h-[28px] w-[28px] rounded-[4px] flex items-center justify-center transition-colors duration-100 ${
                            bgMode === 'black' ? 'bg-white shadow-[0_1px_3px_rgba(0,0,0,0.1)] text-[#111111]' : 'text-[#737373] hover:text-[#111111]'
                          }`}
                          title="Black background"
                        >
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
                          </svg>
                        </button>
                      </div>

                      {selectedItem.status === 'COMPLETED' && selectedItem.outputUrl && (
                        <button
                          type="button"
                          onClick={() => void handleDownload(selectedItem)}
                          className="inline-flex h-8 items-center justify-center rounded-[6px] bg-[#111111] px-4 text-[13px] font-medium text-white transition hover:bg-[#222222]"
                        >
                          Download
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Workspace body */}
                  <div className="flex flex-col gap-4">
                    {/* PENDING view */}
                    {selectedItem.status === 'PENDING' && (
                      <div className="relative w-full h-[380px] bg-[#FAFAFA] rounded-[8px] overflow-hidden border border-[#D4D4D4] flex items-center justify-center">
                        <img
                          src={selectedItem.localPreviewUrl}
                          alt="Preview Source"
                          className="max-h-[90%] max-w-[90%] object-contain rounded-lg"
                        />
                        <div className="absolute inset-0 bg-white/60 flex flex-col items-center justify-center p-6 text-center">
                          <button
                            type="button"
                            onClick={() => void handleProcessItem(selectedItem.id, selectedItem.file)}
                            className="h-12 w-12 rounded-full bg-[#111111] flex items-center justify-center text-white transition hover:scale-105 active:scale-95"
                          >
                            <svg className="h-5 w-5 fill-current" viewBox="0 0 24 24">
                              <path d="M8 5v14l11-7z" />
                            </svg>
                          </button>
                          <h4 className="text-[14px] font-medium text-[#111111] mt-3">Ready to process</h4>
                        </div>
                      </div>
                    )}

                    {/* UPLOADING or PROCESSING view */}
                    {(selectedItem.status === 'UPLOADING' || selectedItem.status === 'PROCESSING') && (
                      <div className="relative w-full h-[380px] bg-[#FAFAFA] rounded-[8px] overflow-hidden border border-[#D4D4D4] flex items-center justify-center">
                        <img
                          src={selectedItem.localPreviewUrl}
                          alt="Preview Source"
                          className="max-h-[90%] max-w-[90%] object-contain rounded-lg opacity-40 pointer-events-none"
                        />
                        
                        {/* Laser scanner element */}
                        <div className="absolute left-[5%] right-[5%] top-0 h-[1px] bg-[#2563EB] scanner-line pointer-events-none" />

                        <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center bg-white/25">
                          <div className="flex h-6 w-6 animate-spin rounded-full border-2 border-[#E5E5E5] border-t-[#2563EB]" />
                          <h4 className="text-[14px] font-medium text-[#111111] mt-3">
                            Processing...
                          </h4>
                        </div>
                      </div>
                    )}

                    {/* FAILED view */}
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
                          onClick={() => void handleProcessItem(selectedItem.id, selectedItem.file)}
                          className="mt-4 inline-flex h-8 items-center justify-center rounded-[6px] border border-[#E5E5E5] px-4 text-[13px] font-medium text-[#111111] transition bg-transparent hover:bg-[#F5F5F5]"
                        >
                          Retry
                        </button>
                      </div>
                    )}

                    {/* COMPLETED view (interactive split slider) */}
                    {selectedItem.status === 'COMPLETED' && selectedItem.outputUrl && (
                      <div className="flex flex-col gap-2">
                        <div 
                          ref={sliderRef}
                          className={`relative w-full h-[380px] rounded-[8px] overflow-hidden border border-[#D4D4D4] select-none transition-all duration-200 ${previewBgClass}`}
                          onMouseMove={handleMouseMove}
                          onTouchMove={handleTouchMove}
                          onMouseDown={() => setIsDraggingSlider(true)}
                          onTouchStart={() => setIsDraggingSlider(true)}
                        >
                          {/* Processed Result (After) */}
                          <div className="absolute inset-0 w-full h-full flex items-center justify-center">
                            <img 
                              src={selectedItem.outputUrl} 
                              alt="Processed Result" 
                              className="max-h-[85%] max-w-[85%] object-contain pointer-events-none"
                            />
                          </div>

                          {/* Original Image (Before) clipped by sliderPosition */}
                          <div 
                            className="absolute inset-0 w-full h-full bg-[#FAFAFA] flex items-center justify-center pointer-events-none"
                            style={{ clipPath: `inset(0 ${100 - sliderPosition}% 0 0)` }}
                          >
                            <img 
                              src={selectedItem.localPreviewUrl} 
                              alt="Original Source" 
                              className="max-h-[85%] max-w-[85%] object-contain pointer-events-none"
                            />
                          </div>

                          {/* Slider Divider Line */}
                          <div 
                            className="absolute top-0 bottom-0 w-[2px] bg-white shadow-[0_0_8px_rgba(0,0,0,0.4)] pointer-events-none"
                            style={{ left: `${sliderPosition}%` }}
                          >
                            {/* Drag Indicator Button */}
                            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white border border-[#E5E5E5] shadow-[0_2px_8px_rgba(0,0,0,0.15)] flex items-center justify-center text-[#737373] text-[11px] font-bold select-none cursor-grab active:cursor-grabbing pointer-events-none">
                              ←→
                            </div>
                          </div>

                          {/* Interactive floating badges */}
                          <div className="absolute bottom-3 left-3 bg-white px-2 py-0.5 rounded-[4px] text-[11px] font-medium text-[#111111] shadow-sm pointer-events-none select-none">
                            Original
                          </div>
                          <div className="absolute bottom-3 right-3 bg-white px-2 py-0.5 rounded-[4px] text-[11px] font-medium text-[#111111] shadow-sm pointer-events-none select-none">
                            Processed
                          </div>
                        </div>
                        
                        {/* Comparison Label */}
                        <p className="text-[12px] text-[#A3A3A3] text-center select-none mt-1 font-medium">
                          Drag to compare ←→
                        </p>
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

        <section className="bg-white border border-[#E5E5E5] rounded-[12px] p-5">
          <div className="flex items-center justify-between gap-3 border-b border-[#F0F0F0] pb-4">
            <div>
              <h2 className="text-[15px] font-medium text-[#111111]">History</h2>
              <p className="text-[12px] text-[#A3A3A3] mt-0.5">Past background removals for this workspace user.</p>
            </div>
            <button
              type="button"
              onClick={() => void fetchHistory()}
              className="inline-flex h-8 items-center justify-center rounded-[6px] border border-[#E5E5E5] bg-transparent px-3 text-[13px] font-medium text-[#111111] transition-colors duration-100 hover:bg-[#F5F5F5]"
            >
              Refresh
            </button>
          </div>

          {historyLoading ? (
            <div className="grid gap-4 pt-4 sm:grid-cols-2 xl:grid-cols-4">
              {Array.from({ length: 4 }).map((_, index) => (
                <div
                  key={index}
                  className="overflow-hidden rounded-[10px] border border-[#E5E5E5] bg-[#FCFCFC]"
                >
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
            <div className="grid gap-4 pt-4 sm:grid-cols-2 xl:grid-cols-4">
              {historyItems.map((job) => (
                <article
                  key={job.job_id}
                  className="overflow-hidden rounded-[10px] border border-[#E5E5E5] bg-[#FCFCFC]"
                >
                  <div className="relative aspect-[4/3] overflow-hidden border-b border-[#EFEFEF] bg-checkerboard-classic">
                    {job.status === 'COMPLETED' && job.output_url ? (
                      <img
                        src={job.output_url}
                        alt="Processed history result"
                        className="h-full w-full object-contain"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-[#FEF2F2] text-[#DC2626]">
                        <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m0 3.75h.008v.008H12v-.008Zm8.25-.75a8.25 8.25 0 1 1-16.5 0 8.25 8.25 0 0 1 16.5 0Z" />
                        </svg>
                      </div>
                    )}
                    <span
                      className={`absolute left-3 top-3 inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        job.status === 'COMPLETED'
                          ? 'bg-[#F0FDF4] text-[#16A34A]'
                          : 'bg-[#FEF2F2] text-[#DC2626]'
                      }`}
                    >
                      {job.status === 'COMPLETED' ? 'Completed' : 'Failed'}
                    </span>
                  </div>

                  <div className="space-y-3 p-3">
                    <div className="space-y-1">
                      <p className="truncate text-[13px] font-medium text-[#111111]">
                        {job.input_url.split('/').pop() ?? job.job_id}
                      </p>
                      <p className="text-[12px] text-[#A3A3A3]">{formatHistoryDate(job.updated_at ?? job.created_at)}</p>
                    </div>

                    {job.status === 'FAILED' && job.error ? (
                      <p className="line-clamp-2 text-[12px] text-[#DC2626]">{job.error}</p>
                    ) : null}

                    <div className="flex items-center gap-2">
                      {job.output_url ? (
                        <a
                          href={job.output_url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex h-8 items-center justify-center rounded-[6px] bg-[#111111] px-3 text-[12px] font-medium text-white transition hover:bg-[#222222]"
                        >
                          Open PNG
                        </a>
                      ) : null}
                      <a
                        href={job.input_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex h-8 items-center justify-center rounded-[6px] border border-[#E5E5E5] px-3 text-[12px] font-medium text-[#111111] transition hover:bg-[#F5F5F5]"
                      >
                        Source
                      </a>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
