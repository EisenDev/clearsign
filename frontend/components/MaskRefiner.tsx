import React, { useRef, useState, useEffect, useCallback } from 'react';

interface MaskRefinerProps {
  isOpen: boolean;
  onClose: () => void;
  originalImageUrl: string;
  processedImageUrl: string;
  jobId: string;
  apiBaseUrl: string;
  onSave: (newOutputUrl: string) => void;
}

export default function MaskRefiner({
  isOpen,
  onClose,
  originalImageUrl,
  processedImageUrl,
  jobId,
  apiBaseUrl,
  onSave,
}: MaskRefinerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const workspaceRef = useRef<HTMLDivElement | null>(null);

  const [brushMode, setBrushMode] = useState<'erase' | 'restore' | 'pan' | 'wand'>('erase');
  const [brushSize, setBrushSize] = useState<number>(20);
  const [wandTolerance, setWandTolerance] = useState<number>(30);
  const [wandAction, setWandAction] = useState<'erase' | 'restore'>('erase');
  const [underlayOpacity, setUnderlayOpacity] = useState<number>(0.35);
  const [isDrawing, setIsDrawing] = useState<boolean>(false);
  const [lastPos, setLastPos] = useState<{ x: number; y: number } | null>(null);
  const [canvasDimensions, setCanvasDimensions] = useState<{ width: number; height: number }>({ width: 0, height: 0 });

  // Brush cursor overlay position (display pixels offset)
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [showCursor, setShowCursor] = useState<boolean>(false);

  // Undo / Redo stacks
  const [undoStack, setUndoStack] = useState<string[]>([]);
  const [redoStack, setRedoStack] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Keep references to loaded images
  const originalImageRef = useRef<HTMLImageElement | null>(null);
  const processedImageRef = useRef<HTMLImageElement | null>(null);

  // Track if initial load is done
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Zoom and Pan States
  const [scale, setScale] = useState<number>(1);
  const [spacePressed, setSpacePressed] = useState<boolean>(false);
  const [isPanning, setIsPanning] = useState<boolean>(false);
  const [panStart, setPanStart] = useState<{ x: number; y: number; scrollLeft: number; scrollTop: number } | null>(null);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  // Initialize and load images
  useEffect(() => {
    if (!isOpen) return;

    setIsLoading(true);
    setError(null);
    setUndoStack([]);
    setRedoStack([]);
    setScale(1);
    setIsFullscreen(false);
    setSpacePressed(false);
    setIsPanning(false);

    const originalImg = new Image();
    const processedImg = new Image();

    let loadedCount = 0;
    const checkLoaded = () => {
      loadedCount++;
      if (loadedCount === 2) {
        originalImageRef.current = originalImg;
        processedImageRef.current = processedImg;
        setupCanvas(originalImg, processedImg);
      }
    };

    // Bind event handlers BEFORE setting src
    originalImg.onload = checkLoaded;
    originalImg.onerror = (e) => {
      console.error('Error loading original image', e);
      setError('Failed to load original image.');
      setIsLoading(false);
    };

    processedImg.onload = checkLoaded;
    processedImg.onerror = (e) => {
      console.error('Error loading processed image', e);
      setError('Failed to load processed output.');
      setIsLoading(false);
    };

    // Set crossOrigin and src configurations conditionally
    const cacheBuster = `t=${Date.now()}`;

    if (originalImageUrl.startsWith('blob:')) {
      originalImg.src = originalImageUrl;
    } else {
      originalImg.crossOrigin = 'anonymous';
      originalImg.src = originalImageUrl + (originalImageUrl.includes('?') ? '&' : '?') + cacheBuster;
    }

    if (processedImageUrl.startsWith('blob:')) {
      processedImg.src = processedImageUrl;
    } else {
      processedImg.crossOrigin = 'anonymous';
      processedImg.src = processedImageUrl + (processedImageUrl.includes('?') ? '&' : '?') + cacheBuster;
    }
  }, [isOpen, originalImageUrl, processedImageUrl]);

  // Listen for Spacebar key to enable panning
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        setSpacePressed(true);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setSpacePressed(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // Wheel scroll to zoom
  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return;

    const handleWheel = (e: WheelEvent) => {
      if (isLoading) return;
      e.preventDefault();
      const zoomFactor = 1.08;
      setScale((prevScale) => {
        let newScale = prevScale;
        if (e.deltaY < 0) {
          newScale = Math.min(6, prevScale * zoomFactor);
        } else {
          newScale = Math.max(0.4, prevScale / zoomFactor);
        }
        return newScale;
      });
    };

    workspace.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      workspace.removeEventListener('wheel', handleWheel);
    };
  }, [isLoading]);

  const getDisplayDimensions = useCallback((originalWidth: number, originalHeight: number, fullscreen: boolean) => {
    const containerWidth = fullscreen 
      ? window.innerWidth - 80 
      : Math.min(800, window.innerWidth - 60);
    const containerHeight = fullscreen 
      ? window.innerHeight - 240 
      : Math.min(500, window.innerHeight - 280);
    
    const aspectRatio = originalWidth / originalHeight;

    let width = containerWidth;
    let height = containerWidth / aspectRatio;

    if (height > containerHeight) {
      height = containerHeight;
      width = containerHeight * aspectRatio;
    }

    return {
      width: Math.round(width),
      height: Math.round(height),
    };
  }, []);

  // Recalculate display dimensions when fullscreen or window size changes
  useEffect(() => {
    if (!originalImageRef.current) return;
    
    const updateDimensions = () => {
      if (!originalImageRef.current) return;
      const dims = getDisplayDimensions(
        originalImageRef.current.naturalWidth || originalImageRef.current.width,
        originalImageRef.current.naturalHeight || originalImageRef.current.height,
        isFullscreen
      );
      setCanvasDimensions(dims);
    };

    updateDimensions();
    
    window.addEventListener('resize', updateDimensions);
    return () => {
      window.removeEventListener('resize', updateDimensions);
    };
  }, [isFullscreen, getDisplayDimensions]);

  const setupCanvas = (originalImg: HTMLImageElement, processedImg: HTMLImageElement) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Use full natural dimensions for high-resolution editing and saving
    const logicalWidth = processedImg.naturalWidth || processedImg.width;
    const logicalHeight = processedImg.naturalHeight || processedImg.height;

    canvas.width = logicalWidth;
    canvas.height = logicalHeight;

    // Clear and draw processed image
    ctx.clearRect(0, 0, logicalWidth, logicalHeight);
    ctx.drawImage(processedImg, 0, 0, logicalWidth, logicalHeight);

    // Calculate initial display dimensions
    const displayDims = getDisplayDimensions(
      originalImg.naturalWidth || originalImg.width,
      originalImg.naturalHeight || originalImg.height,
      isFullscreen
    );
    setCanvasDimensions(displayDims);

    // Save initial state to undo stack with try/catch to handle tainted canvas errors gracefully
    try {
      const initialState = canvas.toDataURL();
      setUndoStack([initialState]);
      setIsLoading(false);
    } catch (err: unknown) {
      console.error('Error getting canvas initial data URL (canvas might be tainted)', err);
      setError('Security constraint: Failed to load cross-origin assets into canvas. Please try again.');
      setIsLoading(false);
    }
  };

  const getCoordinates = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { logical: { x: 0, y: 0 }, display: { x: 0, y: 0 } };

    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e 
      ? (e.touches.length > 0 ? e.touches[0].clientX : 0)
      : e.clientX;
    const clientY = 'touches' in e 
      ? (e.touches.length > 0 ? e.touches[0].clientY : 0)
      : e.clientY;

    const displayX = clientX - rect.left;
    const displayY = clientY - rect.top;

    // Scale coordinates from rendered size to internal canvas logical size
    const logicalX = rect.width > 0 ? displayX * (canvas.width / rect.width) : 0;
    const logicalY = rect.height > 0 ? displayY * (canvas.height / rect.height) : 0;

    return {
      logical: { x: logicalX, y: logicalY },
      display: { x: displayX, y: displayY },
    };
  };

  const saveState = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const currentState = canvas.toDataURL();
      setUndoStack((prev) => [...prev, currentState]);
      setRedoStack([]); // Clear redo
    } catch (err: unknown) {
      console.error('Error saving canvas state', err);
    }
  }, []);

  const runMagicWand = useCallback((startX: number, startY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const originalImg = originalImageRef.current;
    if (!originalImg) return;

    const w = canvas.width;
    const h = canvas.height;

    const x = Math.floor(startX);
    const y = Math.floor(startY);
    if (x < 0 || x >= w || y < 0 || y >= h) return;

    // 1. Get original image pixels
    const offscreen = document.createElement('canvas');
    offscreen.width = w;
    offscreen.height = h;
    const offscreenCtx = offscreen.getContext('2d');
    if (!offscreenCtx) return;
    offscreenCtx.drawImage(originalImg, 0, 0, w, h);
    const origData = offscreenCtx.getImageData(0, 0, w, h);
    const origPixels = origData.data;

    // 2. Get current mask pixels
    const canvasData = ctx.getImageData(0, 0, w, h);
    const canvasPixels = canvasData.data;

    // 3. Flood fill using a flat Int32Array queue
    const startIdx = (y * w + x) * 4;
    const startR = origPixels[startIdx];
    const startG = origPixels[startIdx + 1];
    const startB = origPixels[startIdx + 2];

    const visited = new Uint8Array(w * h);
    const queue = new Int32Array(w * h * 2);
    let head = 0;
    let tail = 0;

    queue[tail++] = x;
    queue[tail++] = y;
    visited[y * w + x] = 1;

    const dx = [0, 0, 1, -1];
    const dy = [1, -1, 0, 0];
    const tolSq = wandTolerance * wandTolerance;

    while (head < tail) {
      const cx = queue[head++];
      const cy = queue[head++];
      const idx = cy * w + cx;
      const pixelIdx = idx * 4;

      const r = origPixels[pixelIdx];
      const g = origPixels[pixelIdx + 1];
      const b = origPixels[pixelIdx + 2];

      const dR = r - startR;
      const dG = g - startG;
      const dB = b - startB;
      const distSq = dR * dR + dG * dG + dB * dB;

      if (distSq <= tolSq * 3) {
        if (wandAction === 'erase') {
          canvasPixels[pixelIdx + 3] = 0;
        } else {
          canvasPixels[pixelIdx] = origPixels[pixelIdx];
          canvasPixels[pixelIdx + 1] = origPixels[pixelIdx + 1];
          canvasPixels[pixelIdx + 2] = origPixels[pixelIdx + 2];
          canvasPixels[pixelIdx + 3] = origPixels[pixelIdx + 3];
        }

        for (let i = 0; i < 4; i++) {
          const nx = cx + dx[i];
          const ny = cy + dy[i];
          if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
            const nIdx = ny * w + nx;
            if (!visited[nIdx]) {
              visited[nIdx] = 1;
              queue[tail++] = nx;
              queue[tail++] = ny;
            }
          }
        }
      }
    }

    ctx.putImageData(canvasData, 0, 0);
    saveState();
  }, [wandTolerance, wandAction, saveState]);

  const handleStartDraw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (isLoading || isSaving) return;
    
    // Prevent scrolling on mobile touch
    if (e.cancelable) {
      e.preventDefault();
    }

    const coords = getCoordinates(e);
    setCursorPos(coords.display);

    if (brushMode === 'wand') {
      runMagicWand(coords.logical.x, coords.logical.y);
      return;
    }

    const isPanActive = brushMode === 'pan' || spacePressed;
    if (isPanActive) {
      setIsPanning(true);
      setPanStart({
        x: 'touches' in e ? (e.touches[0]?.clientX ?? 0) : e.clientX,
        y: 'touches' in e ? (e.touches[0]?.clientY ?? 0) : e.clientY,
        scrollLeft: workspaceRef.current ? workspaceRef.current.scrollLeft : 0,
        scrollTop: workspaceRef.current ? workspaceRef.current.scrollTop : 0,
      });
      return;
    }

    setIsDrawing(true);
    setLastPos(coords.logical);
  };

  const handleDraw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || isLoading || isSaving) return;

    const coords = getCoordinates(e);
    setCursorPos(coords.display);

    if (isPanning && panStart && workspaceRef.current) {
      const clientX = 'touches' in e ? (e.touches[0]?.clientX ?? 0) : e.clientX;
      const clientY = 'touches' in e ? (e.touches[0]?.clientY ?? 0) : e.clientY;
      const dx = clientX - panStart.x;
      const dy = clientY - panStart.y;
      workspaceRef.current.scrollLeft = panStart.scrollLeft - dx;
      workspaceRef.current.scrollTop = panStart.scrollTop - dy;
      return;
    }

    if (brushMode === 'pan' || brushMode === 'wand') return;

    if (!isDrawing || !lastPos) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.save();
    
    if (brushMode === 'erase') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0, 0, 0, 1)';
      ctx.lineWidth = brushSize;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(lastPos.x, lastPos.y);
      ctx.lineTo(coords.logical.x, coords.logical.y);
      ctx.stroke();
    } else {
      // Restore Mode: sample from logical size original image
      const originalImg = originalImageRef.current;
      if (originalImg) {
        const offscreen = document.createElement('canvas');
        offscreen.width = canvas.width;
        offscreen.height = canvas.height;
        const offscreenCtx = offscreen.getContext('2d');
        if (offscreenCtx) {
          offscreenCtx.drawImage(originalImg, 0, 0, canvas.width, canvas.height);
          const pattern = ctx.createPattern(offscreen, 'no-repeat');
          if (pattern) {
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = pattern;
            ctx.lineWidth = brushSize;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();
            ctx.moveTo(lastPos.x, lastPos.y);
            ctx.lineTo(coords.logical.x, coords.logical.y);
            ctx.stroke();
          }
        }
      }
    }

    ctx.restore();
    setLastPos(coords.logical);
  };

  const handleEndDraw = () => {
    if (isPanning) {
      setIsPanning(false);
      setPanStart(null);
      return;
    }
    if (isDrawing) {
      setIsDrawing(false);
      setLastPos(null);
      saveState();
    }
  };

  const handleUndo = () => {
    if (undoStack.length <= 1) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const currentState = undoStack[undoStack.length - 1];
    const targetState = undoStack[undoStack.length - 2];

    const nextUndo = undoStack.slice(0, -1);
    setUndoStack(nextUndo);
    setRedoStack((prev) => [currentState, ...prev]);

    const img = new Image();
    img.src = targetState;
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    };
  };

  const handleRedo = () => {
    if (redoStack.length === 0) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const nextState = redoStack[0];
    const remainingRedo = redoStack.slice(1);

    setUndoStack((prev) => [...prev, nextState]);
    setRedoStack(remainingRedo);

    const img = new Image();
    img.src = nextState;
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    };
  };

  const handleReset = () => {
    if (undoStack.length === 0) return;
    if (!confirm('Are you sure you want to reset all manual refinements?')) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const initialState = undoStack[0];
    setUndoStack([initialState]);
    setRedoStack([]);

    const img = new Image();
    img.src = initialState;
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    };
  };

  const handleApply = () => {
    const canvas = canvasRef.current;
    if (!canvas || isSaving) return;

    setIsSaving(true);
    setError(null);

    canvas.toBlob(async (blob) => {
      if (!blob) {
        setError('Failed to generate image payload.');
        setIsSaving(false);
        return;
      }

      try {
        const formData = new FormData();
        formData.append('file', blob, 'refined.png');

        const response = await fetch(`${apiBaseUrl}/api/media/jobs/${jobId}/refine`, {
          method: 'POST',
          body: formData,
        });

        if (!response.ok) {
          throw new Error(`Server returned error (${response.status})`);
        }

        const data = await response.json();
        onSave(data.output_url);
        onClose();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to save refined image.';
        setError(message);
      } finally {
        setIsSaving(false);
      }
    }, 'image/png');
  };

  if (!isOpen) return null;

  const canvas = canvasRef.current;
  const displayBrushSize = canvas && canvas.width > 0
    ? brushSize * (canvas.getBoundingClientRect().width / canvas.width)
    : brushSize;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 backdrop-blur-md p-0 md:p-4 select-none">
      <div className={`relative bg-[#171717] overflow-hidden flex flex-col transition-all duration-200 ${
        isFullscreen 
          ? "w-screen h-screen" 
          : "w-full max-w-4xl rounded-[16px] border border-[#262626] shadow-[0_25px_50px_-12px_rgba(0,0,0,0.5)] max-h-[90vh]"
      }`}>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#262626] px-6 py-4">
          <div>
            <h3 className="text-[16px] font-semibold text-white">Manual Refinement Editor</h3>
            <p className="text-[12px] text-[#A3A3A3] mt-0.5">Brush to erase leftovers or restore original details.</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsFullscreen(!isFullscreen)}
              className="flex h-8 w-8 items-center justify-center rounded-full text-[#A3A3A3] hover:text-white hover:bg-[#262626] transition"
              title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
            >
              {isFullscreen ? (
                <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 3.75v4.5m0 0H4.5m4.5 0L3 3m12 .75v4.5m0 0h4.5m-4.5 0L21 3M9 20.25v-4.5m0 0H4.5m4.5 0L3 21m12-.75v-4.5m0 0h4.5m-4.5 0L21 21" />
                </svg>
              ) : (
                <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9V4.5m0 0h4.5m-4.5 0L9 9M20.25 9V4.5m0 0h-4.5m4.5 0L15 9M3.75 15v4.5m0 0h4.5m-4.5 0L9 15m11.25 0v4.5m0 0h-4.5m4.5 0L15 15" />
                </svg>
              )}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="flex h-8 w-8 items-center justify-center rounded-full text-[#A3A3A3] hover:text-white hover:bg-[#262626] transition disabled:opacity-30"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-2 bg-[#212121] border-b border-[#262626] px-4 py-2 text-[13px] text-white">
          {/* Left group: Tools + Size/Tolerance */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Edit Mode Tool Buttons */}
            <div className="flex p-0.5 rounded-[8px] bg-[#171717] border border-[#262626] shrink-0">
              {/* Erase */}
              <button
                type="button"
                onClick={() => setBrushMode('erase')}
                title="Erase (Remove) — E"
                className={`h-8 w-8 rounded-[6px] flex items-center justify-center transition ${
                  brushMode === 'erase'
                    ? 'bg-[#EF4444] text-white shadow-sm'
                    : 'text-[#A3A3A3] hover:text-white hover:bg-[#262626]'
                }`}
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
              {/* Restore */}
              <button
                type="button"
                onClick={() => setBrushMode('restore')}
                title="Restore (Reveal) — R"
                className={`h-8 w-8 rounded-[6px] flex items-center justify-center transition ${
                  brushMode === 'restore'
                    ? 'bg-[#22C55E] text-white shadow-sm'
                    : 'text-[#A3A3A3] hover:text-white hover:bg-[#262626]'
                }`}
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
              </button>
              {/* Magic Wand */}
              <button
                type="button"
                onClick={() => setBrushMode('wand')}
                title="Magic Wand — W"
                className={`h-8 w-8 rounded-[6px] flex items-center justify-center transition ${
                  brushMode === 'wand'
                    ? 'bg-purple-600 text-white shadow-sm'
                    : 'text-[#A3A3A3] hover:text-white hover:bg-[#262626]'
                }`}
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                </svg>
              </button>
              {/* Pan */}
              <button
                type="button"
                onClick={() => setBrushMode('pan')}
                title="Pan / Drag — Space"
                className={`h-8 w-8 rounded-[6px] flex items-center justify-center transition ${
                  brushMode === 'pan'
                    ? 'bg-[#3B82F6] text-white shadow-sm'
                    : 'text-[#A3A3A3] hover:text-white hover:bg-[#262626]'
                }`}
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7 11.5V14m0-2.5v-6a1.5 1.5 0 113 0m-3 6a1.5 1.5 0 00-3 0v2a7.5 7.5 0 0015 0v-5a1.5 1.5 0 00-3 0m-6-3V11m0-5.5v-1a1.5 1.5 0 013 0v1m0 0V11m0-5.5a1.5 1.5 0 013 0V11" />
                </svg>
              </button>
            </div>

            {/* Tool mode label */}
            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${
              brushMode === 'erase' ? 'bg-[#EF4444]/20 text-[#EF4444]' :
              brushMode === 'restore' ? 'bg-[#22C55E]/20 text-[#22C55E]' :
              brushMode === 'wand' ? 'bg-purple-500/20 text-purple-400' :
              'bg-[#3B82F6]/20 text-[#3B82F6]'
            }`}>
              {brushMode === 'erase' ? 'Erase' : brushMode === 'restore' ? 'Restore' : brushMode === 'wand' ? 'Wand' : 'Pan'}
            </span>

            {/* Separator */}
            <div className="w-px h-6 bg-[#262626] shrink-0" />

            {/* Brush Size / Wand Controls */}
            {brushMode === 'wand' ? (
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex p-0.5 rounded-[6px] bg-[#171717] border border-[#262626] text-[11px] shrink-0">
                  <button
                    type="button"
                    onClick={() => setWandAction('erase')}
                    className={`px-2 py-1 rounded-[4px] font-semibold transition ${
                      wandAction === 'erase' ? 'bg-[#EF4444] text-white shadow-sm' : 'text-[#A3A3A3] hover:text-white'
                    }`}
                  >
                    Erase
                  </button>
                  <button
                    type="button"
                    onClick={() => setWandAction('restore')}
                    className={`px-2 py-1 rounded-[4px] font-semibold transition ${
                      wandAction === 'restore' ? 'bg-[#22C55E] text-white shadow-sm' : 'text-[#A3A3A3] hover:text-white'
                    }`}
                  >
                    Restore
                  </button>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-[#A3A3A3] text-[11px] font-medium">Tol:</span>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={wandTolerance}
                    onChange={(e) => setWandTolerance(parseInt(e.target.value))}
                    className="w-20 h-1 bg-[#262626] rounded-lg appearance-none cursor-pointer accent-white"
                  />
                  <span className="font-bold tabular-nums text-[11px] text-white w-7 text-right">{wandTolerance}</span>
                </div>
              </div>
            ) : brushMode !== 'pan' ? (
              <div className="flex items-center gap-1.5 shrink-0">
                <svg className="h-3.5 w-3.5 text-[#A3A3A3]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="4" />
                </svg>
                <input
                  type="range"
                  min="1"
                  max="80"
                  value={brushSize}
                  onChange={(e) => setBrushSize(parseInt(e.target.value))}
                  className="w-20 h-1 bg-[#262626] rounded-lg appearance-none cursor-pointer accent-white"
                />
                <span className="font-bold tabular-nums text-[11px] text-white w-8 text-right">{brushSize}px</span>
              </div>
            ) : (
              <span className="text-[11px] text-[#737373]">Hold Space + drag to pan freely</span>
            )}

            {/* Separator */}
            <div className="w-px h-6 bg-[#262626] shrink-0" />

            {/* Zoom Controls */}
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => setScale((prev) => Math.max(0.4, prev / 1.15))}
                className="h-7 w-7 rounded-[6px] border border-[#262626] bg-[#171717] hover:bg-[#262626] transition flex items-center justify-center text-white font-bold"
                title="Zoom Out (scroll down)"
              >
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607zM13.5 10.5h-6" />
                </svg>
              </button>
              <span className="font-semibold tabular-nums text-[11px] w-10 text-center">{Math.round(scale * 100)}%</span>
              <button
                type="button"
                onClick={() => setScale((prev) => Math.min(6, prev * 1.15))}
                className="h-7 w-7 rounded-[6px] border border-[#262626] bg-[#171717] hover:bg-[#262626] transition flex items-center justify-center text-white font-bold"
                title="Zoom In (scroll up)"
              >
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607zM10.5 7.5v6m3-3h-6" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => setScale(1)}
                className="h-7 px-2 rounded-[6px] border border-[#262626] bg-[#171717] hover:bg-[#262626] transition text-[10px] text-[#A3A3A3] hover:text-white font-medium"
                title="Reset Zoom to 100%"
              >
                1:1
              </button>
            </div>
          </div>

          {/* Right group: Undo / Redo / Reset */}
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={handleUndo}
              disabled={undoStack.length <= 1 || isSaving}
              title="Undo"
              className="h-8 w-8 rounded-[6px] border border-[#262626] bg-[#171717] hover:bg-[#262626] transition flex items-center justify-center disabled:opacity-30 disabled:hover:bg-[#171717]"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
              </svg>
            </button>
            <button
              type="button"
              onClick={handleRedo}
              disabled={redoStack.length === 0 || isSaving}
              title="Redo"
              className="h-8 w-8 rounded-[6px] border border-[#262626] bg-[#171717] hover:bg-[#262626] transition flex items-center justify-center disabled:opacity-30 disabled:hover:bg-[#171717]"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 15l6-6m0 0l-6-6m6 6H9a6 6 0 000 12h3" />
              </svg>
            </button>
            <button
              type="button"
              onClick={handleReset}
              disabled={undoStack.length <= 1 || isSaving}
              className="h-8 px-3 rounded-[6px] border border-[#262626]/40 hover:bg-[#EF4444]/10 hover:border-[#EF4444]/30 hover:text-[#EF4444] transition disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-white"
              title="Reset Editor"
            >
              Reset
            </button>
          </div>
        </div>

        {/* Canvas Workspace */}
        <div 
          ref={workspaceRef}
          className="flex-1 bg-[#0A0A0A] p-6 overflow-auto min-h-[300px] relative flex"
        >
          {isLoading && (
            <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-[#0A0A0A] text-[#A3A3A3]">
              <div className="flex h-8 w-8 animate-spin rounded-full border-2 border-[#262626] border-t-white mb-3" />
              <span>Loading workspace assets...</span>
            </div>
          )}
          
          <div 
            className="m-auto flex flex-col items-center gap-4"
            style={{ 
              visibility: isLoading ? 'hidden' : 'visible',
              opacity: isLoading ? 0 : 1,
              pointerEvents: isLoading ? 'none' : 'auto'
            }}
          >
            {/* Canvas viewport container */}
            <div
              ref={containerRef}
              className={`relative bg-checkerboard-classic border border-[#262626] rounded-[8px] overflow-hidden shadow-2xl ${
                spacePressed ? (isPanning ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-none'
              }`}
              style={{
                width: canvasDimensions.width * scale,
                height: canvasDimensions.height * scale,
              }}
              onMouseEnter={() => setShowCursor(true)}
              onMouseLeave={() => {
                setShowCursor(false);
                handleEndDraw();
              }}
            >
              {/* 1. Underlay (Original source image at low opacity) */}
              <img
                src={originalImageUrl}
                alt="Original underlay"
                className="absolute inset-0 w-full h-full object-contain pointer-events-none select-none"
                style={{ opacity: underlayOpacity }}
              />

              {/* 2. Main interactive drawing canvas */}
              <canvas
                ref={canvasRef}
                onMouseDown={handleStartDraw}
                onMouseMove={handleDraw}
                onMouseUp={handleEndDraw}
                onTouchStart={handleStartDraw}
                onTouchMove={handleDraw}
                onTouchEnd={handleEndDraw}
                className="relative z-10 w-full h-full object-contain block bg-transparent"
              />

              {/* 3. Brush Size or Crosshair Hover Cursor */}
              {showCursor && !spacePressed && (
                brushMode === 'wand' ? (
                  <div
                    className="absolute z-20 pointer-events-none flex items-center justify-center"
                    style={{
                      left: cursorPos.x - 12,
                      top: cursorPos.y - 12,
                      width: 24,
                      height: 24,
                    }}
                  >
                    <div className="absolute h-4 w-0.5 bg-white shadow-md" />
                    <div className="absolute w-4 h-0.5 bg-white shadow-md" />
                    <div className="h-1.5 w-1.5 rounded-full bg-purple-500 shadow-md border border-white" />
                  </div>
                ) : (
                  <div
                    className="absolute z-20 rounded-full pointer-events-none transition-shadow border border-white shadow-[0_0_8px_rgba(0,0,0,0.6)]"
                    style={{
                      left: cursorPos.x - displayBrushSize / 2,
                      top: cursorPos.y - displayBrushSize / 2,
                      width: displayBrushSize,
                      height: displayBrushSize,
                      backgroundColor: brushMode === 'erase' ? 'rgba(239, 68, 68, 0.25)' : 'rgba(34, 197, 94, 0.25)',
                      borderColor: brushMode === 'erase' ? '#EF4444' : '#22C55E',
                    }}
                  />
                )
              )}
            </div>

            {/* Opacity Control slider and shortcuts below canvas */}
            <div className="flex flex-wrap items-center justify-between gap-4 w-full max-w-2xl bg-[#171717] px-4 py-2 border border-[#262626] rounded-[8px] text-[12px] text-white">
              <div className="flex items-center gap-3 flex-1 min-w-[200px]">
                <span className="text-[#A3A3A3] font-medium whitespace-nowrap">Original Image Underlay Opacity:</span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={Math.round(underlayOpacity * 100)}
                  onChange={(e) => setUnderlayOpacity(parseFloat(e.target.value) / 100)}
                  className="w-full h-1 bg-[#262626] rounded-lg appearance-none cursor-pointer accent-white"
                />
                <span className="font-semibold tabular-nums w-8 text-right">{Math.round(underlayOpacity * 100)}%</span>
              </div>
              <div className="text-[#A3A3A3] text-[11px] font-medium flex items-center gap-1 pl-4 border-l border-[#262626] h-5">
                <span>💡 Scroll to Zoom. Hold Space + Drag to Pan.</span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="border-t border-[#262626] px-6 py-4 flex items-center justify-between bg-[#111111]">
          <div className="text-[12px] text-[#EF4444] max-w-md font-medium">
            {error && `Error: ${error}`}
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="inline-flex h-9 items-center justify-center rounded-[6px] border border-[#262626] bg-transparent px-4 text-[13px] font-medium text-white transition hover:bg-[#262626] disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleApply}
              disabled={isLoading || isSaving}
              className="inline-flex h-9 items-center justify-center rounded-[6px] bg-[#EF4444] hover:bg-[#DC2626] px-5 text-[13px] font-semibold text-white transition shadow-lg shadow-[#EF4444]/15 disabled:opacity-40"
            >
              {isSaving ? (
                <>
                  <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-white" />
                  Saving...
                </>
              ) : (
                'Save Changes'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
