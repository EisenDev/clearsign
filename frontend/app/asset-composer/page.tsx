'use client';

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import Link from 'next/link';
import jsPDF from 'jspdf';
import Header from '../../components/Header';
import { addRecentActivity } from '../../utils/recentActivities';

// ─── Types ─────────────────────────────────────────────────────────────────────
interface CanvasObj {
  id: string;
  name: string;
  src: string;
  pageId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rot: number;
  opacity: number;
  visible: boolean;
  locked: boolean;
  z: number;
  
  // Text specific properties
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  fontColor?: string;
  fontWeight?: string;
  fontStyle?: string;
  align?: 'left' | 'center' | 'right';
  
  // Shape specific properties
  shapeType?: 'rect' | 'circle';
  color?: string;
  borderColor?: string;
  borderWidth?: number;
}

interface Page {
  id: string;
  name: string;
}

interface Asset {
  id: string;
  name: string;
  src: string;
  ow: number;
  oh: number;
}

type RHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

interface Drag {
  kind: 'move' | 'resize' | 'rotate';
  rh?: RHandle;
  oid: string;
  pageId: string;
  smx: number;
  smy: number;
  sox: number;
  soy: number;
  sow: number;
  soh: number;
  srot: number;
  cx: number;
  cy: number;
  sa: number;
  // Multi-select offsets
  startOffsets?: Record<string, { x: number; y: number }>;
}

interface HistorySnapshot {
  pages: Page[];
  objects: CanvasObj[];
}

interface ContextMenu {
  x: number;
  y: number;
  visible: boolean;
  objectId: string | null;
  pageId: string;
}

// ─── Constants ─────────────────────────────────────────────────────────────────
const RHANDLES: { id: RHandle; l: string; t: string; cur: string }[] = [
  { id: 'nw', l: '-4px',             t: '-4px',             cur: 'nw-resize' },
  { id: 'n',  l: 'calc(50% - 4px)',  t: '-4px',             cur: 'n-resize'  },
  { id: 'ne', l: 'calc(100% - 4px)', t: '-4px',             cur: 'ne-resize' },
  { id: 'e',  l: 'calc(100% - 4px)', t: 'calc(50% - 4px)',  cur: 'e-resize'  },
  { id: 'se', l: 'calc(100% - 4px)', t: 'calc(100% - 4px)', cur: 'se-resize' },
  { id: 's',  l: 'calc(50% - 4px)',  t: 'calc(100% - 4px)', cur: 's-resize'  },
  { id: 'sw', l: '-4px',             t: 'calc(100% - 4px)', cur: 'sw-resize' },
  { id: 'w',  l: '-4px',             t: 'calc(50% - 4px)',  cur: 'w-resize'  },
];

let _n = 0;
const uid = () => `o${++_n}_${Date.now()}`;

const PRESETS = [
  { id: 'A4', name: 'A4 Portrait', w: 794, h: 1123, desc: '210 × 297 mm' },
  { id: 'A4-land', name: 'A4 Landscape', w: 1123, h: 794, desc: '297 × 210 mm' },
  { id: 'Letter', name: 'Letter Portrait', w: 816, h: 1056, desc: '8.5 × 11 in' },
  { id: 'Letter-land', name: 'Letter Landscape', w: 1056, h: 816, desc: '11 × 8.5 in' },
  { id: 'BusinessCard', name: 'Business Card', w: 1050, h: 600, desc: '3.5 × 2 in' },
  { id: 'EmailSig', name: 'Email Signature', w: 600, h: 200, desc: '600 × 200 px' },
  { id: 'Square', name: 'Square Post', w: 1080, h: 1080, desc: '1080 × 1080 px' },
];

export default function AssetComposerPage() {
  // ── State ──────────────────────────────────────────────────────────────────
  const [assets, setAssets] = useState<Asset[]>([]);
  const [pages, setPages] = useState<Page[]>([{ id: 'page-1', name: 'Page 1' }]);
  const [activePageId, setActivePageId] = useState<string>('page-1');
  const [objects, setObjects] = useState<CanvasObj[]>([]);
  const [selIds, setSelIds] = useState<string[]>([]);
  
  // Custom context menu state
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);

  // Editing page name state
  const [editingPageId, setEditingPageId] = useState<string | null>(null);
  const [tempPageName, setTempPageName] = useState('');

  // Dragging layer state
  const [draggedLayerId, setDraggedLayerId] = useState<string | null>(null);

  // Canvas Size States
  const [canvasWidth, setCanvasWidth] = useState(1200);
  const [canvasHeight, setCanvasHeight] = useState(600);
  const [isPaperBackground, setIsPaperBackground] = useState(false);
  const [isTransparent, setIsTransparent] = useState(false);

  // Pan & Zoom States
  const [zoom, setZoom] = useState(100);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(40);
  const [isPanning, setIsPanning] = useState(false);
  const [spacePressed, setSpacePressed] = useState(false);

  // Left Panel States
  const [leftIcon, setLeftIcon] = useState('assets');
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [assetSearch, setAssetSearch] = useState('');
  const [assetFilter, setAssetFilter] = useState('all');

  // Custom Size Input States
  const [customWidth, setCustomWidth] = useState('1200');
  const [customHeight, setCustomHeight] = useState('600');

  // Right Panel States
  const [rightTab, setRightTab] = useState<'properties' | 'canvas'>('properties');
  const [privacy, setPrivacy] = useState(false);
  
  // Download Modal States
  const [showDownloadModal, setShowDownloadModal] = useState(false);
  const [exFmt, setExFmt] = useState('PNG');
  const [exBg, setExBg] = useState('Transparent');
  const [exScale, setExScale] = useState(1);
  const [exQuality, setExQuality] = useState(100);
  const [downloadSelection, setDownloadSelection] = useState<'active' | 'all'>('active');

  // Background Removal State
  const [processingIds, setProcessingIds] = useState<Record<string, boolean>>({});

  // History Undo/Redo States
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  // ── Refs ───────────────────────────────────────────────────────────────────
  const workspaceRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const addRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const scaleRef = useRef(1.0);
  const objsRef = useRef<CanvasObj[]>([]);
  const pagesRef = useRef<Page[]>([]);
  const undoStack = useRef<HistorySnapshot[]>([]);
  const redoStack = useRef<HistorySnapshot[]>([]);
  const panStart = useRef({ x: 0, y: 0 });

  // Keep refs in sync
  scaleRef.current = zoom / 100;
  objsRef.current = objects;
  pagesRef.current = pages;

  // ── Prevent accidental reload ────────────────────────────────────────────────
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (objsRef.current.length > 0) {
        e.preventDefault();
        e.returnValue = '';
        return '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  // ── Load Google Fonts dynamically ──────────────────────────────────────────
  useEffect(() => {
    const link = document.createElement('link');
    link.href = 'https://fonts.googleapis.com/css2?family=Dancing+Script&family=Montserrat:wght@400;500;700&family=Playfair+Display:ital,wght@0,400;0,700;1,400&family=Inter:wght@400;500;700&family=Geist:wght@400;500;700&display=swap';
    link.rel = 'stylesheet';
    document.head.appendChild(link);
    return () => {
      document.head.removeChild(link);
    };
  }, []);

  // ── Derived ────────────────────────────────────────────────────────────────
  const ds = zoom / 100;
  const selId = selIds[0] || null;
  const selObj = useMemo(() => objects.find(o => o.id === selId) ?? null, [objects, selId]);
  
  const activePageObjects = useMemo(() => objects.filter(o => o.pageId === activePageId), [objects, activePageId]);
  const activePageSorted = useMemo(() => [...activePageObjects].sort((a, b) => a.z - b.z), [activePageObjects]);
  const filteredAssets = useMemo(() =>
    assets.filter(a => !assetSearch || a.name.toLowerCase().includes(assetSearch.toLowerCase())),
    [assets, assetSearch]
  );

  // ── History snap ───────────────────────────────────────────────────────────
  const snap = useCallback(() => {
    undoStack.current.push({
      pages: pagesRef.current.map(p => ({ ...p })),
      objects: objsRef.current.map(o => ({ ...o })),
    });
    redoStack.current = [];
    if (undoStack.current.length > 80) undoStack.current.shift();
    setCanUndo(true);
    setCanRedo(false);
  }, []);

  const undo = useCallback(() => {
    if (!undoStack.current.length) return;
    redoStack.current.push({
      pages: pagesRef.current.map(p => ({ ...p })),
      objects: objsRef.current.map(o => ({ ...o })),
    });
    const last = undoStack.current.pop()!;
    setPages(last.pages);
    setObjects(last.objects);
    setSelIds([]);
    setCanUndo(undoStack.current.length > 0);
    setCanRedo(true);
  }, []);

  const redo = useCallback(() => {
    if (!redoStack.current.length) return;
    undoStack.current.push({
      pages: pagesRef.current.map(p => ({ ...p })),
      objects: objsRef.current.map(o => ({ ...o })),
    });
    const next = redoStack.current.pop()!;
    setPages(next.pages);
    setObjects(next.objects);
    setCanRedo(redoStack.current.length > 0);
    setCanUndo(true);
  }, []);

  // ── Keyboard Panning Mode Detection ─────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA') return;
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

  // ── Workspace Wheel (Zoom and Pan) ──────────────────────────────────────────
  useEffect(() => {
    const ws = workspaceRef.current;
    if (!ws) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        // Zoom
        const zoomStep = 5;
        setZoom(z => {
          const nextZoom = e.deltaY < 0 ? z + zoomStep : z - zoomStep;
          return Math.max(10, Math.min(300, nextZoom));
        });
      } else {
        // Pan
        setPanX(px => px - e.deltaX);
        setPanY(py => py - e.deltaY);
      }
    };
    ws.addEventListener('wheel', handleWheel, { passive: false });
    return () => ws.removeEventListener('wheel', handleWheel);
  }, []);

  // ── Workspace Mouse Panning ──────────────────────────────────────────────────
  const onWorkspaceMouseDown = (e: React.MouseEvent) => {
    const isMiddleClick = e.button === 1;
    const isLeftClickWithSpace = e.button === 0 && spacePressed;
    const isLeftClickOnWorkspace = e.button === 0 && e.target === workspaceRef.current;

    if (isMiddleClick || isLeftClickWithSpace || isLeftClickOnWorkspace) {
      e.preventDefault();
      setIsPanning(true);
      panStart.current = { x: e.clientX - panX, y: e.clientY - panY };
    }
  };

  // ── File Upload to Backend Helper ────────────────────────────────────────────
  const uploadAndAddAsset = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) return;
    const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';
    try {
      const formData = new FormData();
      formData.append('file', file);
      
      const response = await fetch(`${apiBaseUrl}/api/media/uploads`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) throw new Error('Upload server failed');

      const data = await response.json();
      const imageSrc = data.image_url;

      const img = new Image();
      img.onload = () => {
        const asset = { id: uid(), name: file.name, src: imageSrc, ow: img.width, oh: img.height };
        setAssets(prev => [...prev, asset]);
        addToCanvas(asset);
      };
      img.src = imageSrc;
    } catch (err) {
      console.warn('Backend upload failed, falling back to local file reader:', err);
      const reader = new FileReader();
      reader.onload = ev => {
        const src = ev.target?.result as string;
        const img = new Image();
        img.onload = () => {
          const asset = { id: uid(), name: file.name, src, ow: img.width, oh: img.height };
          setAssets(prev => [...prev, asset]);
          addToCanvas(asset);
        };
        img.src = src;
      };
      reader.readAsDataURL(file);
    }
  }, [activePageId]);

  const loadFiles = useCallback((files: File[]) => {
    files.forEach(f => void uploadAndAddAsset(f));
  }, [uploadAndAddAsset]);

  // ── Add Asset to Canvas ────────────────────────────────────────────────────
  const addToCanvas = useCallback((asset: Asset, pageId?: string) => {
    const targetPageId = pageId || activePageId;
    const maxW = canvasWidth * 0.35;
    const s = Math.min(1, maxW / asset.ow);
    const w = Math.round(asset.ow * s);
    const h = Math.round(asset.oh * s);
    snap();
    
    const obj: CanvasObj = {
      id: uid(),
      name: asset.name,
      src: asset.src,
      pageId: targetPageId,
      x: Math.round((canvasWidth - w) / 2),
      y: Math.round((canvasHeight - h) / 2),
      w,
      h,
      rot: 0,
      opacity: 100,
      visible: true,
      locked: false,
      z: objects.filter(o => o.pageId === targetPageId).length,
    };
    setObjects(prev => [...prev, obj]);
    setSelIds([obj.id]);
  }, [activePageId, canvasWidth, canvasHeight, objects, snap]);

  // ── Canvas Coords ──────────────────────────────────────────────────────────
  const toCanvas = useCallback((cx: number, cy: number, pageId: string) => {
    const r = document.getElementById(`page-canvas-${pageId}`)?.getBoundingClientRect();
    if (!r) return { x: 0, y: 0 };
    return { x: (cx - r.left) / scaleRef.current, y: (cy - r.top) / scaleRef.current };
  }, []);

  // ── Start Drag ─────────────────────────────────────────────────────────────
  const startDrag = useCallback((
    e: React.MouseEvent, oid: string, pageId: string,
    kind: 'move' | 'resize' | 'rotate', rh?: RHandle
  ) => {
    e.preventDefault(); e.stopPropagation();
    const o = objsRef.current.find(x => x.id === oid);
    if (!o || o.locked) return;

    // Shift click toggles selection, normal click overrides unless dragging a group
    if (e.shiftKey) {
      setSelIds(prev => prev.includes(oid) ? prev.filter(id => id !== oid) : [...prev, oid]);
    } else {
      if (!selIds.includes(oid)) {
        setSelIds([oid]);
      }
    }
    setActivePageId(pageId);
    
    const { x: mx, y: my } = toCanvas(e.clientX, e.clientY, pageId);
    const cx = o.x + o.w / 2;
    const cy = o.y + o.h / 2;

    // Capture start offsets for all selected elements
    const targetSelIds = e.shiftKey
      ? (selIds.includes(oid) ? selIds : [...selIds, oid])
      : (selIds.includes(oid) ? selIds : [oid]);
      
    const offsets: Record<string, { x: number; y: number }> = {};
    targetSelIds.forEach(id => {
      const obj = objsRef.current.find(x => x.id === id);
      if (obj) {
        offsets[id] = { x: obj.x, y: obj.y };
      }
    });

    dragRef.current = {
      kind, rh, oid, pageId,
      smx: mx, smy: my, sox: o.x, soy: o.y, sow: o.w, soh: o.h,
      srot: o.rot, cx, cy, sa: Math.atan2(my - cy, mx - cx) * 180 / Math.PI,
      startOffsets: offsets,
    };
  }, [toCanvas, selIds]);

  // ── Global Mouse Move/Up ──────────────────────────────────────────────────
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (isPanning) {
        setPanX(e.clientX - panStart.current.x);
        setPanY(e.clientY - panStart.current.y);
        return;
      }

      const d = dragRef.current;
      if (!d) return;
      
      const { x: mx, y: my } = toCanvas(e.clientX, e.clientY, d.pageId);
      const dx = mx - d.smx;
      const dy = my - d.smy;
      const M = 10;
      
      setObjects(prev => prev.map(o => {
        if (o.id !== d.oid) {
          // If we are moving a selection group, offset them as well
          if (d.kind === 'move' && selIds.includes(o.id) && d.startOffsets?.[o.id]) {
            const startPos = d.startOffsets[o.id];
            return { ...o, x: Math.round(startPos.x + dx), y: Math.round(startPos.y + dy) };
          }
          return o;
        }
        
        if (d.kind === 'move') {
          const startPos = d.startOffsets?.[o.id] || { x: d.sox, y: d.soy };
          return { ...o, x: Math.round(startPos.x + dx), y: Math.round(startPos.y + dy) };
        }
        
        if (d.kind === 'rotate') {
          const a = Math.atan2(my - d.cy, mx - d.cx) * 180 / Math.PI;
          return { ...o, rot: Math.round(d.srot + a - d.sa) };
        }
        
        switch (d.rh) {
          case 'se': return { ...o, w: Math.max(M, Math.round(d.sow+dx)), h: Math.max(M, Math.round(d.soh+dy)) };
          case 's':  return { ...o, h: Math.max(M, Math.round(d.soh+dy)) };
          case 'e':  return { ...o, w: Math.max(M, Math.round(d.sow+dx)) };
          case 'sw': return { ...o, x: Math.round(d.sox+dx), w: Math.max(M, Math.round(d.sow-dx)), h: Math.max(M, Math.round(d.soh+dy)) };
          case 'w':  return { ...o, x: Math.round(d.sox+dx), w: Math.max(M, Math.round(d.sow-dx)) };
          case 'ne': return { ...o, y: Math.round(d.soy+dy), w: Math.max(M, Math.round(d.sow+dx)), h: Math.max(M, Math.round(d.soh-dy)) };
          case 'n':  return { ...o, y: Math.round(d.soy+dy), h: Math.max(M, Math.round(d.soh-dy)) };
          case 'nw': return { ...o, x: Math.round(d.sox+dx), y: Math.round(d.soy+dy), w: Math.max(M, Math.round(d.sow-dx)), h: Math.max(M, Math.round(d.soh-dy)) };
          default: return o;
        }
      }));
    };

    const onUp = () => {
      if (dragRef.current) {
        snap();
        dragRef.current = null;
      }
      setIsPanning(false);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [toCanvas, snap, isPanning, selIds]);

  // ── Update Object ──────────────────────────────────────────────────────────
  const upd = useCallback((id: string, u: Partial<CanvasObj>) => {
    setObjects(prev => prev.map(o => o.id === id ? { ...o, ...u } : o));
  }, []);

  // ── Align ──────────────────────────────────────────────────────────────────
  const doAlign = useCallback((type: string) => {
    if (selIds.length === 0) return;
    snap();
    selIds.forEach(id => {
      const o = objsRef.current.find(x => x.id === id);
      if (!o) return;
      const m: Record<string, Partial<CanvasObj>> = {
        'left':     { x: 0 },
        'right':    { x: canvasWidth - o.w },
        'top':      { y: 0 },
        'bottom':   { y: canvasHeight - o.h },
        'center-h': { x: Math.round((canvasWidth - o.w) / 2) },
        'center-v': { y: Math.round((canvasHeight - o.h) / 2) },
      };
      if (m[type]) upd(id, m[type]);
    });
  }, [selIds, snap, upd, canvasWidth, canvasHeight]);

  // ── Layer Z-Ordering Front/Back ───────────────────────────────────────────
  const bringToFront = (objectId: string) => {
    const o = objects.find(x => x.id === objectId);
    if (!o) return;
    const pageObjs = objects.filter(x => x.pageId === o.pageId);
    const maxZ = pageObjs.reduce((max, x) => x.z > max ? x.z : max, 0);
    snap();
    upd(objectId, { z: maxZ + 1 });
  };

  const sendToBack = (objectId: string) => {
    const o = objects.find(x => x.id === objectId);
    if (!o) return;
    const pageObjs = objects.filter(x => x.pageId === o.pageId);
    const minZ = pageObjs.reduce((min, x) => x.z < min ? x.z : min, 0);
    snap();
    
    upd(objectId, { z: minZ - 1 });
    
    // Normalize Z indices on page cleanly
    setTimeout(() => {
      setObjects(prev => {
        const pageObjs = prev.filter(x => x.pageId === o.pageId);
        const sorted = [...pageObjs].sort((a, b) => a.z - b.z);
        const other = prev.filter(x => x.pageId !== o.pageId);
        const normalized = sorted.map((x, idx) => ({ ...x, z: idx }));
        return [...other, ...normalized];
      });
    }, 0);
  };

  const bringFwd = useCallback(() => {
    if (!selId) return;
    const o = objsRef.current.find(x => x.id === selId);
    if (!o) return;
    const pageObjs = objsRef.current.filter(x => x.pageId === o.pageId);
    const s = [...pageObjs].sort((a, b) => a.z - b.z);
    const idx = s.findIndex(x => x.id === selId);
    if (idx >= s.length - 1) return;
    snap();
    const nextObj = s[idx+1];
    setObjects(prev => prev.map(x => {
      if (x.id === selId) return { ...x, z: nextObj.z };
      if (x.id === nextObj.id) return { ...x, z: o.z };
      return x;
    }));
  }, [selId, snap]);

  const sendBwd = useCallback(() => {
    if (!selId) return;
    const o = objsRef.current.find(x => x.id === selId);
    if (!o) return;
    const pageObjs = objsRef.current.filter(x => x.pageId === o.pageId);
    const s = [...pageObjs].sort((a, b) => a.z - b.z);
    const idx = s.findIndex(x => x.id === selId);
    if (idx <= 0) return;
    snap();
    const prevObj = s[idx-1];
    setObjects(prev => prev.map(x => {
      if (x.id === selId) return { ...x, z: prevObj.z };
      if (x.id === prevObj.id) return { ...x, z: o.z };
      return x;
    }));
  }, [selId, snap]);

  // ── Drag & Drop Layers List Reordering ────────────────────────────────────
  const handleLayerReorder = (draggedId: string, targetId: string) => {
    if (draggedId === targetId) return;
    snap();
    
    const pageObjs = objects.filter(o => o.pageId === activePageId);
    const otherObjs = objects.filter(o => o.pageId !== activePageId);
    
    // Sort displaying list (highest Z is shown first in active layers)
    const displayList = [...pageObjs].sort((a, b) => b.z - a.z);
    
    const dragIdx = displayList.findIndex(o => o.id === draggedId);
    const targetIdx = displayList.findIndex(o => o.id === targetId);
    if (dragIdx === -1 || targetIdx === -1) return;
    
    const item = displayList[dragIdx];
    displayList.splice(dragIdx, 1);
    displayList.splice(targetIdx, 0, item);
    
    const length = displayList.length;
    const updatedActive = displayList.map((o, idx) => ({
      ...o,
      z: length - 1 - idx
    }));
    
    setObjects([...otherObjs, ...updatedActive]);
  };

  const handleLayerDragStart = (e: React.DragEvent, id: string) => {
    setDraggedLayerId(id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleLayerDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault();
  };

  const handleLayerDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    if (!draggedLayerId || draggedLayerId === targetId) return;
    handleLayerReorder(draggedLayerId, targetId);
    setDraggedLayerId(null);
  };

  // ── Align, Group, Duplicate, Delete elements ──────────────────────────────
  const del = useCallback(() => {
    if (selIds.length === 0) return;
    snap();
    setObjects(prev => prev.filter(o => !selIds.includes(o.id)));
    setSelIds([]);
  }, [selIds, snap]);

  const dup = useCallback(() => {
    if (selIds.length === 0) return;
    snap();
    const newObjs: CanvasObj[] = [];
    const newIds: string[] = [];
    
    selIds.forEach(id => {
      const o = objsRef.current.find(x => x.id === id);
      if (!o) return;
      const newId = uid();
      newObjs.push({
        ...o,
        id: newId,
        x: o.x + 20,
        y: o.y + 20,
        z: objsRef.current.filter(x => x.pageId === o.pageId).length + newObjs.length
      });
      newIds.push(newId);
    });
    
    setObjects(prev => [...prev, ...newObjs]);
    setSelIds(newIds);
  }, [selIds, snap]);

  // ── Context Menu Triggers ──────────────────────────────────────────────────
  const handleContextMenu = (e: React.MouseEvent, pageId: string, objectId: string | null) => {
    e.preventDefault();
    e.stopPropagation();
    
    const wsRect = workspaceRef.current?.getBoundingClientRect();
    if (!wsRect) return;
    
    const x = e.clientX - wsRect.left;
    const y = e.clientY - wsRect.top;
    
    setContextMenu({
      x,
      y,
      visible: true,
      objectId,
      pageId
    });
    
    if (objectId && !selIds.includes(objectId)) {
      setSelIds([objectId]);
    }
  };

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  useEffect(() => {
    window.addEventListener('click', closeContextMenu);
    return () => window.removeEventListener('click', closeContextMenu);
  }, [closeContextMenu]);

  // ── Real Backend Background Removal ─────────────────────────────────────────
  const removeBackground = useCallback(async (objectId: string) => {
    const obj = objects.find(o => o.id === objectId);
    if (!obj || obj.src === '') return;

    setProcessingIds(prev => ({ ...prev, [objectId]: true }));
    const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

    try {
      let imageUrl = obj.src;

      if (imageUrl.startsWith('data:')) {
        const res = await fetch(imageUrl);
        const blob = await res.blob();
        const file = new File([blob], obj.name || 'upload.png', { type: blob.type });

        const formData = new FormData();
        formData.append('file', file);
        const uploadResponse = await fetch(`${apiBaseUrl}/api/media/uploads`, {
          method: 'POST',
          body: formData,
        });

        if (!uploadResponse.ok) throw new Error('Could not upload temporary image for background removal');
        const uploadData = await uploadResponse.json();
        imageUrl = uploadData.image_url;
      }

      let storedUserId = localStorage.getItem('cs_user_id');
      if (!storedUserId) {
        storedUserId = 'user_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
        localStorage.setItem('cs_user_id', storedUserId);
      }

      const payload = {
        image_url: imageUrl,
        user_id: storedUserId,
        mode: 'auto',
        alpha_matting: false,
        shadow_removal: false,
        edge_feather: 0,
        defringe: false,
      };

      const response = await fetch(`${apiBaseUrl}/api/media/remove-background`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) throw new Error(`Queue error (${response.status})`);
      const acceptPayload = await response.json();
      const jobId = acceptPayload.job_id;

      let jobStatus = acceptPayload.status;
      let finalJob = null;
      let attempts = 0;
      const maxAttempts = 60; // 2 minutes

      while ((jobStatus === 'PENDING' || jobStatus === 'PROCESSING') && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        attempts++;

        const jobResponse = await fetch(`${apiBaseUrl}/api/media/jobs/${jobId}`, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          cache: 'no-store',
        });
        if (!jobResponse.ok) throw new Error(`Status check error (${jobResponse.status})`);
        
        finalJob = await jobResponse.json();
        jobStatus = finalJob.status;
      }

      if (finalJob && finalJob.status === 'COMPLETED' && finalJob.output_url) {
        snap();
        setObjects(prev => prev.map(o => o.id === objectId ? { ...o, src: finalJob.output_url } : o));
      } else {
        throw new Error(finalJob?.error || 'Background removal server timeout or error');
      }
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : 'Background removal failed');
    } finally {
      setProcessingIds(prev => {
        const next = { ...prev };
        delete next[objectId];
        return next;
      });
    }
  }, [objects, snap]);

  // ── Text & Shape Insertion ──────────────────────────────────────────────────
  const addTextToCanvas = (type: 'heading' | 'subheading' | 'body') => {
    snap();
    const textStr = type === 'heading' ? 'Add Heading' : type === 'subheading' ? 'Add Subheading' : 'Add body text';
    const fontSize = type === 'heading' ? 36 : type === 'subheading' ? 24 : 16;
    const fontWeight = type === 'heading' ? 'bold' : type === 'subheading' ? '500' : 'normal';
    
    const obj: CanvasObj = {
      id: uid(),
      name: textStr,
      src: '',
      text: textStr,
      fontSize,
      fontWeight,
      fontFamily: 'Inter, sans-serif',
      fontColor: '#111111',
      align: 'center',
      pageId: activePageId,
      x: Math.round((canvasWidth - 250) / 2),
      y: Math.round((canvasHeight - 60) / 2),
      w: 250,
      h: 60,
      rot: 0,
      opacity: 100,
      visible: true,
      locked: false,
      z: objects.filter(o => o.pageId === activePageId).length,
    };
    setObjects(prev => [...prev, obj]);
    setSelIds([obj.id]);
  };

  const addShapeToCanvas = (shapeType: 'rect' | 'circle') => {
    snap();
    const obj: CanvasObj = {
      id: uid(),
      name: shapeType === 'rect' ? 'Rectangle' : 'Circle',
      src: '',
      shapeType,
      color: shapeType === 'rect' ? '#3B82F6' : '#10B981',
      pageId: activePageId,
      x: Math.round((canvasWidth - 120) / 2),
      y: Math.round((canvasHeight - 120) / 2),
      w: 120,
      h: 120,
      rot: 0,
      opacity: 100,
      visible: true,
      locked: false,
      z: objects.filter(o => o.pageId === activePageId).length,
    };
    setObjects(prev => [...prev, obj]);
    setSelIds([obj.id]);
  };

  // ── Preset Sizes ───────────────────────────────────────────────────────────
  const applyPreset = (w: number, h: number, isPaper: boolean) => {
    snap();
    setCanvasWidth(w);
    setCanvasHeight(h);
    setIsPaperBackground(isPaper);
    setIsTransparent(!isPaper);

    const fitZoom = Math.min(120, Math.floor((500 / Math.max(w, h)) * 100));
    setZoom(Math.max(25, fitZoom));
  };

  const applyCustomSize = () => {
    const w = parseInt(customWidth, 10);
    const h = parseInt(customHeight, 10);
    if (!isNaN(w) && !isNaN(h) && w > 0 && h > 0) {
      applyPreset(w, h, isPaperBackground);
    }
  };

  // ── Keyboard Shortcuts (Arrow Nudges, Undo/Redo) ───────────────────────────
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA') return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && !e.metaKey) del();
      if (e.key === 'Escape') setSelIds([]);
      if (e.key === 'd' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); dup(); }
      if (e.key === 'z' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      if (e.key === 'y' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); redo(); }
      
      if (selIds.length > 0) {
        const step = e.shiftKey ? 10 : 1;
        
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          snap();
          setObjects(prev => prev.map(o => {
            if (!selIds.includes(o.id)) return o;
            if (e.key === 'ArrowLeft')  return { ...o, x: o.x - step };
            if (e.key === 'ArrowRight') return { ...o, x: o.x + step };
            if (e.key === 'ArrowUp')    return { ...o, y: o.y - step };
            if (e.key === 'ArrowDown')  return { ...o, y: o.y + step };
            return o;
          }));
        }
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [del, dup, undo, redo, selIds]);

  // ── Page Management ────────────────────────────────────────────────────────
  const addPageAfter = (afterPageId: string) => {
    snap();
    const newPageId = `page-${Date.now()}`;
    const idx = pages.findIndex(p => p.id === afterPageId);
    const newPage = { id: newPageId, name: `Page ${pages.length + 1}` };
    const newPages = [...pages];
    newPages.splice(idx + 1, 0, newPage);
    setPages(newPages);
    setActivePageId(newPageId);
  };

  const duplicatePage = (pageId: string) => {
    snap();
    const sourcePage = pages.find(p => p.id === pageId);
    if (!sourcePage) return;

    const newPageId = `page-${Date.now()}`;
    const idx = pages.findIndex(p => p.id === pageId);
    const newPage = { id: newPageId, name: `${sourcePage.name} (Copy)` };
    const newPages = [...pages];
    newPages.splice(idx + 1, 0, newPage);

    const pageObjs = objects.filter(o => o.pageId === pageId);
    const copiedObjs = pageObjs.map(o => ({
      ...o,
      id: `o_${Math.random().toString(36).substr(2, 9)}_${Date.now()}`,
      pageId: newPageId,
      z: o.z + objects.length,
    }));

    setPages(newPages);
    setObjects(prev => [...prev, ...copiedObjs]);
    setActivePageId(newPageId);
  };

  const deletePage = (pageId: string) => {
    if (pages.length <= 1) return;
    snap();
    setPages(prev => prev.filter(p => p.id !== pageId));
    setObjects(prev => prev.filter(o => o.pageId !== pageId));
    setSelIds([]);
    
    const idx = pages.findIndex(p => p.id === pageId);
    const nextActive = pages[idx === 0 ? 1 : idx - 1];
    setActivePageId(nextActive.id);
  };

  // ── Export Canvas to Files ──────────────────────────────────────────────────
  const renderPageToCanvas = async (pageId: string, scale: number) => {
    const s = scale;
    const c = document.createElement('canvas');
    c.width = canvasWidth * s;
    c.height = canvasHeight * s;
    const ctx = c.getContext('2d')!;

    if (exBg === 'White' || exFmt === 'JPEG') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, c.width, c.height);
    }

    const pageObjs = objects.filter(o => o.pageId === pageId && o.visible);
    const sortedPageObjs = [...pageObjs].sort((a, b) => a.z - b.z);

    for (const o of sortedPageObjs) {
      if (o.text !== undefined) {
        ctx.save();
        ctx.globalAlpha = o.opacity / 100;
        ctx.translate((o.x + o.w / 2) * s, (o.y + o.h / 2) * s);
        ctx.rotate(o.rot * Math.PI / 180);

        const fontSize = (o.fontSize || 16) * s;
        const fontFamily = o.fontFamily || 'Inter, sans-serif';
        const fontWeight = o.fontWeight || 'normal';
        const fontStyle = o.fontStyle || 'normal';

        ctx.font = `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`;
        ctx.fillStyle = o.fontColor || '#111111';
        ctx.textAlign = o.align || 'center';
        ctx.textBaseline = 'middle';

        ctx.fillText(o.text, 0, 0);
        ctx.restore();
      } else if (o.shapeType === 'rect') {
        ctx.save();
        ctx.globalAlpha = o.opacity / 100;
        ctx.translate((o.x + o.w / 2) * s, (o.y + o.h / 2) * s);
        ctx.rotate(o.rot * Math.PI / 180);
        ctx.fillStyle = o.color || '#3b82f6';
        ctx.fillRect(-o.w / 2 * s, -o.h / 2 * s, o.w * s, o.h * s);
        if (o.borderWidth) {
          ctx.strokeStyle = o.borderColor || '#1e3a8a';
          ctx.lineWidth = o.borderWidth * s;
          ctx.strokeRect(-o.w / 2 * s, -o.h / 2 * s, o.w * s, o.h * s);
        }
        ctx.restore();
      } else if (o.shapeType === 'circle') {
        ctx.save();
        ctx.globalAlpha = o.opacity / 100;
        ctx.translate((o.x + o.w / 2) * s, (o.y + o.h / 2) * s);
        ctx.rotate(o.rot * Math.PI / 180);
        ctx.fillStyle = o.color || '#10b981';
        ctx.beginPath();
        ctx.arc(0, 0, Math.min(o.w, o.h) / 2 * s, 0, 2 * Math.PI);
        ctx.fill();
        if (o.borderWidth) {
          ctx.strokeStyle = o.borderColor || '#065f46';
          ctx.lineWidth = o.borderWidth * s;
          ctx.stroke();
        }
        ctx.restore();
      } else {
        await new Promise<void>(res => {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => {
            ctx.save();
            ctx.globalAlpha = o.opacity / 100;
            ctx.translate((o.x + o.w / 2) * s, (o.y + o.h / 2) * s);
            ctx.rotate(o.rot * Math.PI / 180);
            ctx.drawImage(img, -o.w / 2 * s, -o.h / 2 * s, o.w * s, o.h * s);
            ctx.restore();
            res();
          };
          img.onerror = () => res();
          img.src = o.src;
        });
      }
    }
    return c;
  };

  const handleDownload = async () => {
    const pagesToExport = downloadSelection === 'active' 
      ? [pages.find(p => p.id === activePageId)!]
      : pages;

    if (exFmt === 'PDF') {
      const pdf = new jsPDF({
        orientation: canvasWidth > canvasHeight ? 'landscape' : 'portrait',
        unit: 'px',
        format: [canvasWidth, canvasHeight]
      });

      for (let i = 0; i < pagesToExport.length; i++) {
        if (i > 0) pdf.addPage([canvasWidth, canvasHeight]);
        const c = await renderPageToCanvas(pagesToExport[i].id, exScale);
        const imgData = c.toDataURL('image/png');
        pdf.addImage(imgData, 'PNG', 0, 0, canvasWidth, canvasHeight);
      }
      pdf.save(`${pagesToExport[0].name.toLowerCase().replace(/\s+/g, '_')}${pagesToExport.length > 1 ? '_collection' : ''}.pdf`);
    } else {
      for (const page of pagesToExport) {
        const c = await renderPageToCanvas(page.id, exScale);
        const mime = exFmt === 'JPEG' ? 'image/jpeg' : exFmt === 'WEBP' ? 'image/webp' : 'image/png';
        const url = c.toDataURL(mime, exFmt === 'PNG' ? undefined : exQuality / 100);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${page.name.toLowerCase().replace(/\s+/g, '_')}.${exFmt.toLowerCase()}`;
        a.click();
      }
    }
    
    addRecentActivity({
      name: `Exported ${pagesToExport.length} page(s)`,
      tool: 'Asset Composer'
    });
    
    setShowDownloadModal(false);
  };

  // ── Drag & Drop on Canvas Page ──────────────────────────────────────────────
  const onWorkspaceDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const aid = e.dataTransfer.getData('assetId');
    if (aid) {
      const a = assets.find(x => x.id === aid);
      if (a) addToCanvas(a, activePageId);
      return;
    }
    if (e.dataTransfer.files.length) {
      loadFiles(Array.from(e.dataTransfer.files));
    }
  }, [assets, activePageId, addToCanvas, loadFiles]);

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-[#F5F5F5]"
      style={{ fontFamily: "'Inter','Geist',system-ui,-apple-system,sans-serif", color: '#111111' }}>

      {/* Hidden file inputs */}
      <input ref={fileRef} type="file" multiple accept="image/*" className="hidden"
        onChange={e => { loadFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
      <input ref={addRef} type="file" multiple accept="image/*" className="hidden"
        onChange={e => { loadFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }} />

      {/* ── GLOBAL HEADER ── */}
      <Header 
        activePage="asset-composer"
        rightContent={
          <div className="relative">
            <svg width="13" height="13" fill="none" stroke="#A3A3A3" strokeWidth="2" viewBox="0 0 24 24" className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input type="text" placeholder="Search tools..." className="w-[190px] h-[30px] pl-[26px] pr-3 text-[12px] bg-[#F4F4F4] rounded-full border border-transparent focus:border-[#D4D4D4] focus:bg-white focus:outline-none placeholder-[#A3A3A3] transition-all" />
          </div>
        }
      />

      {/* ── SUB-TOOLBAR ROW (Undo, Redo, Zoom, Page, Export) ── */}
      <div className="flex-none h-[44px] bg-white border-b border-[#E5E5E5] flex items-center px-4 justify-between z-40">
        <div className="flex items-center gap-3">
          <span className="text-[13px] font-bold text-[#111111] select-none">Asset Composer</span>
          <div className="w-px h-4 bg-[#E5E5E5]" />
          <span className="text-[12px] text-[#737373] bg-[#F5F5F5] px-2 py-0.5 rounded-[4px] font-semibold">{pages.length} {pages.length === 1 ? 'Page' : 'Pages'}</span>
        </div>

        {/* Center: Undo / Redo / Zoom / Export */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)"
            className="w-8 h-8 flex items-center justify-center rounded-[6px] text-[#525252] hover:bg-[#F5F5F5] disabled:opacity-25 transition">
            <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6M3 10l6-6" /></svg>
          </button>
          <button onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)"
            className="w-8 h-8 flex items-center justify-center rounded-[6px] text-[#525252] hover:bg-[#F5F5F5] disabled:opacity-25 transition">
            <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M21 10H11a8 8 0 00-8 8v2M21 10l-6 6M21 10l-6-6" /></svg>
          </button>
          <div className="w-px h-5 bg-[#E5E5E5] mx-0.5" />
          
          {/* Zoom controls */}
          <button onClick={() => setZoom(z => Math.max(10, z - 10))} className="w-7 h-7 flex items-center justify-center rounded text-[#525252] hover:bg-[#F5F5F5] transition">
            <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M5 12h14" /></svg>
          </button>
          <button className="flex items-center gap-1 h-7 px-2 text-[12px] font-semibold text-[#525252] hover:bg-[#F5F5F5] rounded transition min-w-[52px] justify-center"
            onClick={() => setZoom(100)}>
            {zoom}%
          </button>
          <button onClick={() => setZoom(z => Math.min(300, z + 10))} className="w-7 h-7 flex items-center justify-center rounded text-[#525252] hover:bg-[#F5F5F5] transition">
            <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
          </button>
          
          <div className="w-px h-5 bg-[#E5E5E5] mx-0.5" />
          
          {/* Page commands */}
          <button onClick={() => addPageAfter(pages[pages.length - 1].id)}
            className="flex items-center gap-1 h-8 px-2.5 border border-[#E5E5E5] rounded-[6px] text-[12px] font-semibold text-[#525252] bg-white hover:bg-[#F5F5F5] transition">
            <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
            Add Page
          </button>

          <div className="w-px h-5 bg-[#E5E5E5] mx-0.5" />

          {/* Export Action */}
          <div className="flex rounded-[7px] overflow-hidden border border-[#E5E5E5] shadow-sm">
            <button onClick={() => { setDownloadSelection('active'); setShowDownloadModal(true); }} className="flex items-center gap-1.5 h-8 px-3.5 bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-[12px] font-semibold transition-all">
              <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
              Download
            </button>
            <button onClick={() => { setDownloadSelection('all'); setShowDownloadModal(true); }} title="Download All Pages" className="w-8 h-8 flex items-center justify-center bg-[#1E40AF] hover:bg-[#1E3A8A] text-white transition-all border-l border-[#1D4ED8]">
              <span className="text-[10px] font-bold">ALL</span>
            </button>
          </div>
        </div>
      </div>

      {/* ── WORKSPACE AREA ── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* ── LEFT ICON RAIL ── */}
        <div className="flex-none w-[56px] bg-white border-r border-[#E5E5E5] flex flex-col items-center py-2 gap-0.5 z-30">
          {[
            { id: 'assets', label: 'Assets', icon: <><rect x="2" y="2" width="9" height="9" rx="1.5" /><rect x="13" y="2" width="9" height="9" rx="1.5" /><rect x="2" y="13" width="9" height="9" rx="1.5" /><rect x="13" y="13" width="9" height="9" rx="1.5" /></>, fill: true },
            { id: 'templates', label: 'Templates', icon: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" /></> },
            { id: 'text', label: 'Text', icon: <><path strokeLinecap="round" strokeLinejoin="round" d="M4 7V4h16v3M9 20h6M12 4v16" /></> },
            { id: 'elements', label: 'Elements', icon: <><circle cx="8" cy="8" r="4" /><path strokeLinecap="round" strokeLinejoin="round" d="M14 14h6v6h-6z" /><path strokeLinecap="round" strokeLinejoin="round" d="M17 3l-4 7h8l-4-7z" /></> },
            { id: 'uploads', label: 'Uploads', icon: <><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></> },
          ].map(({ id, label, icon, fill }) => (
            <button key={id} onClick={() => { setLeftIcon(id); setLeftCollapsed(false); }}
              className={`flex flex-col items-center justify-center w-12 h-12 rounded-[8px] gap-1 transition-all ${leftIcon === id && !leftCollapsed ? 'bg-[#EFF6FF] text-[#2563EB]' : 'text-[#737373] hover:bg-[#F4F4F5] hover:text-[#111111]'}`}>
              <svg width="18" height="18" fill={fill ? 'currentColor' : 'none'} stroke={fill ? undefined : 'currentColor'} strokeWidth="2" viewBox="0 0 24 24">{icon}</svg>
              <span className="text-[9px] font-medium leading-none">{label}</span>
            </button>
          ))}
          <div className="flex-1" />
        </div>

        {/* ── LEFT DRAWER PANEL (Tab-specific Content) ── */}
        {!leftCollapsed && (
          <div className="flex-none w-[260px] bg-white border-r border-[#E5E5E5] flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex-none px-4 py-3 flex items-center justify-between border-b border-[#F0F0F0]">
              <span className="text-[13px] font-bold text-[#111111] capitalize">{leftIcon}</span>
              <button onClick={() => setLeftCollapsed(true)} className="text-[#A3A3A3] hover:text-[#525252] transition">
                <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>
              </button>
            </div>

            {/* Content Switcher */}
            <div className="flex-1 overflow-y-auto">
              
              {/* Assets & Uploads Tab Content */}
              {(leftIcon === 'assets' || leftIcon === 'uploads') && (
                <div className="p-3 space-y-4">
                  {/* File Upload zone */}
                  <div
                    onClick={() => fileRef.current?.click()}
                    className="border-2 border-dashed border-[#D4D4D4] hover:border-[#2563EB] hover:bg-[#EFF6FF] rounded-[8px] p-4 text-center cursor-pointer transition group"
                  >
                    <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" className="text-[#C4C4C4] group-hover:text-[#2563EB] mx-auto mb-1.5 transition-colors">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                    </svg>
                    <p className="text-[11.5px] font-semibold text-[#525252] group-hover:text-[#2563EB]">Upload Image Asset</p>
                    <p className="text-[10px] text-[#A3A3A3] mt-0.5">Click to browse or drop files</p>
                  </div>

                  <div className="flex-none border-b border-[#E5E5E5] pb-2">
                    <div className="flex gap-1.5">
                      {['all','images','logos','signatures'].map(t => (
                        <button key={t} onClick={() => setAssetFilter(t)}
                          className={`px-2 py-1 text-[11px] font-semibold rounded-md transition-colors ${assetFilter === t ? 'bg-[#2563EB] text-white' : 'bg-[#F4F4F5] text-[#525252] hover:bg-[#E5E5E5]'}`}>
                          {t.charAt(0).toUpperCase() + t.slice(1)}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Assets Grid */}
                  <div>
                    <span className="text-[11px] font-bold text-[#737373] uppercase tracking-wider block mb-2">My Library</span>
                    {filteredAssets.length === 0 ? (
                      <p className="text-[11px] text-[#A3A3A3] text-center py-6">No image assets uploaded yet.</p>
                    ) : (
                      <div className="grid grid-cols-2 gap-2">
                        {filteredAssets.map(asset => (
                          <div key={asset.id} draggable
                            onDragStart={e => e.dataTransfer.setData('assetId', asset.id)}
                            onClick={() => addToCanvas(asset)}
                            className="cursor-pointer group relative"
                          >
                            <div className="h-[72px] rounded-[8px] border border-[#E5E5E5] group-hover:border-[#2563EB] overflow-hidden flex items-center justify-center bg-[#F9F9F9] transition"
                              style={{ backgroundImage: 'repeating-conic-gradient(#E8E8E8 0% 25%, #F4F4F5 0% 50%)', backgroundSize: '10px 10px' }}>
                              <img src={asset.src} alt={asset.name} className="max-w-full max-h-full object-contain p-1 pointer-events-none" />
                            </div>
                            <p className="mt-1 text-[10px] text-[#525252] truncate font-medium">{asset.name}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Templates Tab Content */}
              {leftIcon === 'templates' && (
                <div className="p-3 space-y-4">
                  <div>
                    <span className="text-[11px] font-bold text-[#737373] uppercase tracking-wider block mb-2.5">Preset Paper Sizes</span>
                    <div className="space-y-1.5">
                      {PRESETS.map(preset => (
                        <button
                          key={preset.id}
                          onClick={() => applyPreset(preset.w, preset.h, true)}
                          className="w-full text-left p-2.5 rounded-[8px] border border-[#E5E5E5] hover:border-[#2563EB] hover:bg-[#EFF6FF] transition flex items-center justify-between"
                        >
                          <div>
                            <p className="text-[12px] font-bold text-[#111111]">{preset.name}</p>
                            <p className="text-[10px] text-[#737373]">{preset.desc}</p>
                          </div>
                          <div className="w-5 h-6 border border-[#A3A3A3] rounded bg-white flex-none shrink-0 shadow-sm" />
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="border-t border-[#F0F0F0] pt-3">
                    <span className="text-[11px] font-bold text-[#737373] uppercase tracking-wider block mb-2.5">Custom Size</span>
                    <div className="space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] text-[#737373] font-medium block mb-1">Width (px)</label>
                          <input type="number" value={customWidth} onChange={e => setCustomWidth(e.target.value)} className="w-full h-8 px-2.5 text-[12px] bg-[#F4F4F5] border border-transparent rounded-[6px] focus:bg-white focus:border-[#2563EB] focus:outline-none font-semibold" />
                        </div>
                        <div>
                          <label className="text-[10px] text-[#737373] font-medium block mb-1">Height (px)</label>
                          <input type="number" value={customHeight} onChange={e => setCustomHeight(e.target.value)} className="w-full h-8 px-2.5 text-[12px] bg-[#F4F4F5] border border-transparent rounded-[6px] focus:bg-white focus:border-[#2563EB] focus:outline-none font-semibold" />
                        </div>
                      </div>
                      
                      <div className="flex items-center justify-between py-1">
                        <span className="text-[11.5px] text-[#525252] font-semibold">Solid White Background</span>
                        <button onClick={() => setIsPaperBackground(p => !p)} className={`relative w-8 h-4.5 rounded-full transition-colors ${isPaperBackground ? 'bg-[#2563EB]' : 'bg-[#D4D4D4]'}`}>
                          <span className={`absolute top-0.5 w-3.5 h-3.5 bg-white rounded-full shadow-sm transition-transform ${isPaperBackground ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
                        </button>
                      </div>

                      <button
                        onClick={applyCustomSize}
                        className="w-full h-9 bg-white hover:bg-[#F5F5F5] border border-[#D4D4D4] rounded-[8px] text-[12px] font-bold text-[#111111] transition-all"
                      >
                        Apply Size
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Text Tab Content */}
              {leftIcon === 'text' && (
                <div className="p-3 space-y-3">
                  <span className="text-[11px] font-bold text-[#737373] uppercase tracking-wider block mb-1.5">Add Text Box</span>
                  
                  <button onClick={() => addTextToCanvas('heading')}
                    className="w-full h-[52px] bg-white border border-[#E5E5E5] hover:border-[#2563EB] hover:bg-[#EFF6FF] rounded-[8px] text-left px-4 flex items-center transition">
                    <span className="text-[16px] font-bold text-[#111111]">Add a Heading</span>
                  </button>
                  
                  <button onClick={() => addTextToCanvas('subheading')}
                    className="w-full h-[46px] bg-white border border-[#E5E5E5] hover:border-[#2563EB] hover:bg-[#EFF6FF] rounded-[8px] text-left px-4 flex items-center transition">
                    <span className="text-[14px] font-semibold text-[#333333]">Add a Subheading</span>
                  </button>
                  
                  <button onClick={() => addTextToCanvas('body')}
                    className="w-full h-[40px] bg-white border border-[#E5E5E5] hover:border-[#2563EB] hover:bg-[#EFF6FF] rounded-[8px] text-left px-4 flex items-center transition">
                    <span className="text-[12px] text-[#525252]">Add body text</span>
                  </button>
                </div>
              )}

              {/* Elements Tab Content */}
              {leftIcon === 'elements' && (
                <div className="p-3 space-y-4">
                  <div>
                    <span className="text-[11px] font-bold text-[#737373] uppercase tracking-wider block mb-2">Shapes</span>
                    <div className="grid grid-cols-2 gap-2.5">
                      <button
                        onClick={() => addShapeToCanvas('rect')}
                        className="h-[72px] border border-[#E5E5E5] hover:border-[#2563EB] hover:bg-[#EFF6FF] rounded-[8px] flex flex-col items-center justify-center gap-1 bg-[#F9F9F9] transition"
                      >
                        <div className="w-8 h-8 bg-[#3B82F6] rounded-[4px]" />
                        <span className="text-[10px] font-semibold text-[#525252]">Square</span>
                      </button>

                      <button
                        onClick={() => addShapeToCanvas('circle')}
                        className="h-[72px] border border-[#E5E5E5] hover:border-[#2563EB] hover:bg-[#EFF6FF] rounded-[8px] flex flex-col items-center justify-center gap-1 bg-[#F9F9F9] transition"
                      >
                        <div className="w-8 h-8 bg-[#10B981] rounded-full" />
                        <span className="text-[10px] font-semibold text-[#525252]">Circle</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Drag & drop layer reordering in Active Page Layers panel */}
            <div className="flex-none border-t border-[#E5E5E5] max-h-[220px] flex flex-col min-h-[140px]">
              <div className="px-3 py-2 border-b border-[#F0F0F0] flex items-center justify-between select-none">
                <span className="text-[11.5px] font-bold text-[#111111]">Active Page Layers</span>
                <span className="text-[10px] text-[#737373] font-semibold">{activePageObjects.length} Layers</span>
              </div>
              <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
                {activePageObjects.length === 0 ? (
                  <p className="text-[10px] text-[#A3A3A3] text-center py-4">No layers on this page</p>
                ) : (
                  [...activePageSorted].reverse().map(obj => (
                    <div
                      key={obj.id}
                      onClick={() => setSelIds([obj.id])}
                      draggable
                      onDragStart={(e) => handleLayerDragStart(e, obj.id)}
                      onDragOver={(e) => handleLayerDragOver(e, obj.id)}
                      onDrop={(e) => handleLayerDrop(e, obj.id)}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded-[6px] group cursor-grab active:cursor-grabbing transition-colors ${
                        selIds.includes(obj.id) ? 'bg-[#EFF6FF]' : 'hover:bg-[#F4F4F5]'
                      } ${draggedLayerId === obj.id ? 'opacity-40' : ''}`}
                    >
                      <div className="w-6 h-6 rounded border border-[#E5E5E5] overflow-hidden flex items-center justify-center bg-white shrink-0">
                        {obj.text !== undefined ? (
                          <span className="text-[10px] font-bold text-[#2563EB]">T</span>
                        ) : obj.shapeType === 'rect' ? (
                          <div className="w-3.5 h-3.5 bg-[#3B82F6] rounded-[2px]" />
                        ) : obj.shapeType === 'circle' ? (
                          <div className="w-3.5 h-3.5 bg-[#10B981] rounded-full" />
                        ) : (
                          <img src={obj.src} className="max-w-full max-h-full object-contain" />
                        )}
                      </div>
                      
                      <span className="flex-1 text-[11px] font-semibold text-[#111111] truncate">{obj.name}</span>
                      
                      <button onClick={e => { e.stopPropagation(); upd(obj.id, { locked: !obj.locked }); }}
                        className={`shrink-0 transition-colors ${obj.locked ? 'text-[#2563EB]' : 'text-[#C4C4C4] opacity-0 group-hover:opacity-100'}`}>
                        <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2" /><path strokeLinecap="round" strokeLinejoin="round" d="M8 11V7a4 4 0 018 0v4" /></svg>
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* Collapsed Toggle Arrow */}
        {leftCollapsed && (
          <button onClick={() => setLeftCollapsed(false)}
            className="flex-none w-5 bg-white border-r border-[#E5E5E5] flex items-center justify-center text-[#A3A3A3] hover:text-[#525252] hover:bg-[#F4F4F5] transition-all">
            <svg width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
          </button>
        )}

        {/* ── CENTER EDITING WORKSPACE (Infinite Checkerboard) ── */}
        <div className="flex-1 min-w-0 flex flex-col bg-[#EFEFEF] overflow-hidden relative">
          
          {/* Active Element Contextual Toolbar */}
          <div className="flex-none h-[42px] bg-white border-b border-[#E5E5E5] flex items-center px-4 gap-1.5 overflow-x-auto select-none z-30">
            {selObj ? (
              <>
                <span className="text-[11.5px] font-bold text-[#111111] bg-[#F0F0F0] px-2 py-0.5 rounded mr-1">
                  Selected: {selIds.length > 1 ? `${selIds.length} items` : selObj.name}
                </span>
                
                {/* Background removal triggers only for single image selection */}
                {selIds.length === 1 && selObj.src !== '' && selObj.text === undefined && selObj.shapeType === undefined && (
                  <button
                    onClick={() => removeBackground(selObj.id)}
                    disabled={processingIds[selObj.id]}
                    className="flex items-center gap-1 h-7 px-3 bg-[#EFF6FF] border border-[#2563EB] text-[#2563EB] hover:bg-[#2563EB] hover:text-white rounded-[5px] text-[11px] font-bold transition disabled:opacity-40"
                  >
                    <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 21m0 0l-.813-5.096L3 15.094l5.096-.813L9 9l.813 5.281L15 15.094l-5.188.81z" />
                    </svg>
                    {processingIds[selObj.id] ? 'Removing Background...' : 'Remove Background'}
                  </button>
                )}

                {/* Font and Color Changer contextual tools when Text elements are selected */}
                {selIds.length === 1 && selObj.text !== undefined && (
                  <>
                    <div className="w-px h-5 bg-[#E5E5E5] mx-1" />
                    
                    {/* Font Family selector */}
                    <div className="relative shrink-0">
                      <select
                        value={selObj.fontFamily || 'Inter, sans-serif'}
                        onChange={e => {
                          upd(selObj.id, { fontFamily: e.target.value });
                          snap();
                        }}
                        className="appearance-none h-7 pl-2.5 pr-7 text-[11px] font-bold text-[#111111] bg-[#F4F4F5] border border-transparent rounded-[5px] focus:bg-white focus:border-[#2563EB] focus:outline-none cursor-pointer"
                      >
                        <option value="Inter, sans-serif">Inter (Sans)</option>
                        <option value="'Geist', sans-serif">Geist (Modern)</option>
                        <option value="'Playfair Display', serif">Playfair (Serif)</option>
                        <option value="Georgia, serif">Georgia (Classic)</option>
                        <option value="Montserrat, sans-serif">Montserrat (Geometric)</option>
                        <option value="'Courier New', monospace">Courier (Mono)</option>
                        <option value="'Brush Script MT', cursive">Brush Script (Cursive)</option>
                      </select>
                      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[#737373]"><svg width="7" height="7" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" /></svg></span>
                    </div>

                    {/* Font Size controls */}
                    <div className="flex items-center bg-[#F4F4F5] rounded-[5px] h-7 px-1">
                      <button
                        onClick={() => {
                          const newSize = Math.max(8, (selObj.fontSize || 16) - 1);
                          upd(selObj.id, { fontSize: newSize });
                          snap();
                        }}
                        className="w-5 h-5 flex items-center justify-center text-[12px] font-bold text-[#525252] hover:bg-white hover:text-black rounded transition"
                      >
                        -
                      </button>
                      <input
                        type="number"
                        value={selObj.fontSize || 16}
                        onChange={e => {
                          upd(selObj.id, { fontSize: Number(e.target.value) });
                        }}
                        onBlur={snap}
                        className="w-8 text-center text-[11px] font-bold bg-transparent border-none focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                      <button
                        onClick={() => {
                          const newSize = (selObj.fontSize || 16) + 1;
                          upd(selObj.id, { fontSize: newSize });
                          snap();
                        }}
                        className="w-5 h-5 flex items-center justify-center text-[12px] font-bold text-[#525252] hover:bg-white hover:text-black rounded transition"
                      >
                        +
                      </button>
                    </div>

                    {/* Color picker */}
                    <div className="flex items-center gap-1 bg-[#F4F4F5] rounded-[5px] h-7 px-1.5">
                      <input
                        type="color"
                        value={selObj.fontColor || '#111111'}
                        onChange={e => {
                          upd(selObj.id, { fontColor: e.target.value });
                        }}
                        onBlur={snap}
                        className="w-4.5 h-4.5 rounded border border-[#D4D4D4] cursor-pointer shrink-0"
                      />
                      <span className="text-[10px] font-mono text-[#525252] hidden sm:inline">{selObj.fontColor || '#111111'}</span>
                    </div>

                    {/* Bold styling */}
                    <button
                      onClick={() => {
                        upd(selObj.id, { fontWeight: selObj.fontWeight === 'bold' ? 'normal' : 'bold' });
                        snap();
                      }}
                      className={`w-7 h-7 flex items-center justify-center text-[11px] font-bold rounded-[5px] transition ${selObj.fontWeight === 'bold' ? 'bg-[#EFF6FF] text-[#2563EB] border border-[#2563EB]' : 'text-[#525252] hover:bg-[#F5F5F5]'}`}
                    >
                      B
                    </button>

                    {/* Italic styling */}
                    <button
                      onClick={() => {
                        upd(selObj.id, { fontStyle: selObj.fontStyle === 'italic' ? 'normal' : 'italic' });
                        snap();
                      }}
                      className={`w-7 h-7 flex items-center justify-center text-[11px] italic font-bold rounded-[5px] transition ${selObj.fontStyle === 'italic' ? 'bg-[#EFF6FF] text-[#2563EB] border border-[#2563EB]' : 'text-[#525252] hover:bg-[#F5F5F5]'}`}
                    >
                      I
                    </button>
                  </>
                )}

                <div className="w-px h-5 bg-[#E5E5E5] mx-1" />

                <button onClick={dup} className="flex items-center gap-1 h-7 px-2.5 hover:bg-[#F5F5F5] rounded text-[11px] text-[#525252] font-semibold transition">
                  <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2" /><path strokeLinecap="round" strokeLinejoin="round" d="M4 16V4a2 2 0 012-2h12" /></svg>
                  Duplicate
                </button>

                <button onClick={del} className="flex items-center gap-1 h-7 px-2.5 hover:bg-[#FEF2F2] hover:text-[#DC2626] rounded text-[11px] text-[#525252] font-semibold transition">
                  <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                  Delete
                </button>

                {selIds.length === 1 && (
                  <>
                    <button onClick={bringFwd} className="flex items-center gap-1 h-7 px-2.5 hover:bg-[#F5F5F5] rounded text-[11px] text-[#525252] font-semibold transition">
                      Forward
                    </button>
                    <button onClick={sendBwd} className="flex items-center gap-1 h-7 px-2.5 hover:bg-[#F5F5F5] rounded text-[11px] text-[#525252] font-semibold transition">
                      Backward
                    </button>
                  </>
                )}
              </>
            ) : (
              <span className="text-[11.5px] text-[#A3A3A3] font-medium italic">Click elements inside pages to select. Hold SHIFT + CLICK to select multiple. Right-click for menu.</span>
            )}
          </div>

          {/* Infinite Zoomable/Pannable Viewport */}
          <div
            ref={workspaceRef}
            onMouseDown={onWorkspaceMouseDown}
            onDragOver={e => e.preventDefault()}
            onDrop={onWorkspaceDrop}
            className="flex-1 overflow-hidden relative select-none"
            style={{
              cursor: isPanning ? 'grabbing' : spacePressed ? 'grab' : 'default',
              backgroundImage: 'repeating-conic-gradient(#D0D0D0 0% 25%, #E5E5E5 0% 50%)',
              backgroundSize: '20px 20px',
            }}
          >
            {/* Pages column container */}
            <div
              style={{
                position: 'absolute',
                left: '50%',
                top: '5%',
                transform: `translate(calc(-50% + ${panX}px), ${panY}px) scale(${zoom / 100})`,
                transformOrigin: 'top center',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '48px',
                transition: isPanning ? 'none' : 'transform 0.05s ease-out',
              }}
            >
              {pages.map((page) => {
                const pageObjs = objects.filter(o => o.pageId === page.id);
                const sortedPageObjs = [...pageObjs].sort((a, b) => a.z - b.z);
                const isActive = activePageId === page.id;
                
                return (
                  <div
                    key={page.id}
                    className={`relative flex flex-col items-center select-none ${isActive ? 'ring-2 ring-[#2563EB] ring-offset-4 rounded-[12px]' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setActivePageId(page.id);
                    }}
                    onContextMenu={(e) => handleContextMenu(e, page.id, null)}
                  >
                    {/* Page Floating Header Bar */}
                    <div className="flex items-center w-full justify-between mb-2.5 text-xs text-[#737373] px-2.5 font-medium bg-white h-9 rounded-[8px] border border-[#E5E5E5] shadow-sm select-none">
                      <div className="flex items-center gap-1.5">
                        {editingPageId === page.id ? (
                          <input
                            type="text"
                            value={tempPageName}
                            onChange={e => setTempPageName(e.target.value)}
                            onBlur={() => {
                              if (tempPageName.trim()) {
                                snap();
                                setPages(pages.map(p => p.id === page.id ? { ...p, name: tempPageName.trim() } : p));
                              }
                              setEditingPageId(null);
                            }}
                            onKeyDown={e => {
                              if (e.key === 'Enter') {
                                if (tempPageName.trim()) {
                                  snap();
                                  setPages(pages.map(p => p.id === page.id ? { ...p, name: tempPageName.trim() } : p));
                                }
                                setEditingPageId(null);
                              }
                            }}
                            className="h-6 px-1.5 text-[11px] font-bold text-[#111111] border border-[#2563EB] rounded focus:outline-none bg-white w-32"
                            autoFocus
                            onClick={e => e.stopPropagation()}
                          />
                        ) : (
                          <span
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingPageId(page.id);
                              setTempPageName(page.name);
                            }}
                            className="font-bold text-[#111111] cursor-pointer hover:bg-[#F5F5F5] px-1 rounded inline-block"
                            title="Double click to rename"
                          >
                            {page.name}
                          </span>
                        )}
                        <span className="text-[#A3A3A3] text-[10px]">({canvasWidth} × {canvasHeight} px)</span>
                      </div>
                      
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={(e) => { e.stopPropagation(); duplicatePage(page.id); }}
                          title="Duplicate Page"
                          className="px-1.5 py-0.5 hover:bg-[#F5F5F5] hover:text-[#111111] rounded transition flex items-center gap-1 text-[10px]"
                        >
                          <svg width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <rect x="8" y="8" width="12" height="12" rx="2" /><path d="M4 16V4a2 2 0 012-2h12" />
                          </svg>
                          Duplicate
                        </button>
                        
                        <button
                          onClick={(e) => { e.stopPropagation(); deletePage(page.id); }}
                          disabled={pages.length <= 1}
                          title="Delete Page"
                          className="px-1.5 py-0.5 hover:bg-[#FEF2F2] hover:text-[#DC2626] rounded transition disabled:opacity-20 flex items-center gap-1 text-[10px]"
                        >
                          <svg width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                          Delete
                        </button>

                        <button
                          onClick={(e) => { e.stopPropagation(); addPageAfter(page.id); }}
                          title="Add Page Below"
                          className="px-1.5 py-0.5 hover:bg-[#EFF6FF] hover:text-[#2563EB] rounded transition flex items-center gap-1 text-[10px]"
                        >
                          <svg width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                          </svg>
                          + Add Below
                        </button>
                      </div>
                    </div>

                    {/* Page Canvas Paper (Solid White) */}
                    <div
                      id={`page-canvas-${page.id}`}
                      className="relative flex-none shadow-lg border border-[#D4D4D4] rounded-[8px]"
                      style={{
                        width: `${canvasWidth * ds}px`,
                        height: `${canvasHeight * ds}px`,
                        backgroundImage: 'none',
                        backgroundSize: `${20 * ds}px ${20 * ds}px`,
                        backgroundColor: '#ffffff',
                        overflow: 'hidden',
                      }}
                      onClick={(e) => {
                        if (e.target === e.currentTarget) {
                          setSelIds([]);
                        }
                      }}
                    >
                      {/* Canvas Objects */}
                      {sortedPageObjs.map(obj => {
                        const isSelected = selIds.includes(obj.id);
                        const drawHandles = isSelected && selIds.length === 1 && !obj.locked;
                        const isProcessing = processingIds[obj.id];

                        return (
                          <div
                            key={obj.id}
                            style={{
                              position: 'absolute',
                              left: `${obj.x * ds}px`,
                              top: `${obj.y * ds}px`,
                              width: `${obj.w * ds}px`,
                              height: `${obj.h * ds}px`,
                              transform: `rotate(${obj.rot}deg)`,
                              opacity: obj.opacity / 100,
                              display: obj.visible ? 'block' : 'none',
                              cursor: obj.locked ? 'not-allowed' : 'move',
                              userSelect: 'none',
                              transformOrigin: 'center center',
                            }}
                            onMouseDown={e => startDrag(e, obj.id, page.id, 'move')}
                            onContextMenu={e => handleContextMenu(e, page.id, obj.id)}
                          >
                            {/* Object internal rendering */}
                            {obj.text !== undefined ? (
                              <div
                                style={{
                                  width: '100%',
                                  height: '100%',
                                  fontSize: `${(obj.fontSize || 16) * ds}px`,
                                  fontFamily: obj.fontFamily || 'Inter, sans-serif',
                                  color: obj.fontColor || '#111111',
                                  fontWeight: obj.fontWeight || 'normal',
                                  fontStyle: obj.fontStyle || 'normal',
                                  textAlign: obj.align || 'center',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  wordBreak: 'break-word',
                                  padding: '4px',
                                }}
                              >
                                {obj.text}
                              </div>
                            ) : obj.shapeType === 'rect' ? (
                              <div
                                style={{
                                  width: '100%',
                                  height: '100%',
                                  backgroundColor: obj.color || '#3B82F6',
                                  border: obj.borderWidth ? `${obj.borderWidth * ds}px solid ${obj.borderColor || '#1E3A8A'}` : 'none',
                                }}
                              />
                            ) : obj.shapeType === 'circle' ? (
                              <div
                                style={{
                                  width: '100%',
                                  height: '100%',
                                  borderRadius: '50%',
                                  backgroundColor: obj.color || '#10B981',
                                  border: obj.borderWidth ? `${obj.borderWidth * ds}px solid ${obj.borderColor || '#065F46'}` : 'none',
                                }}
                              />
                            ) : (
                              <img src={obj.src} alt={obj.name} draggable={false}
                                style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', pointerEvents: 'none' }} />
                            )}

                            {/* Processing Spinner Overlay */}
                            {isProcessing && (
                              <div className="absolute inset-0 bg-white/70 flex flex-col items-center justify-center rounded z-50">
                                <svg className="animate-spin h-5 w-5 text-[#2563EB]" fill="none" viewBox="0 0 24 24">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                </svg>
                                <span className="text-[9px] font-bold text-[#2563EB] mt-1">Removing Bg...</span>
                              </div>
                            )}

                            {/* Selector Bounds */}
                            {isSelected && (
                              <div style={{ position: 'absolute', inset: 0, border: obj.locked ? '1.5px solid #DC2626' : '1.5px dashed #2563EB', pointerEvents: 'none' }} />
                            )}

                            {/* Resize / Rotate handles only for single selection */}
                            {drawHandles && (
                              <>
                                {RHANDLES.map(h => (
                                  <div key={h.id}
                                    style={{
                                      position: 'absolute', left: h.l, top: h.t,
                                      width: '8px', height: '8px',
                                      background: 'white', border: '1.5px solid #2563EB',
                                      borderRadius: '2px', cursor: h.cur, zIndex: 10,
                                      boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
                                    }}
                                    onMouseDown={e => startDrag(e, obj.id, page.id, 'resize', h.id)}
                                  />
                                ))}
                                
                                <div style={{ position: 'absolute', left: '50%', top: '-22px', width: '1.5px', height: '22px', background: '#2563EB', transform: 'translateX(-50%)', pointerEvents: 'none' }} />
                                <div
                                  style={{
                                    position: 'absolute', left: '50%', top: '-30px',
                                    transform: 'translateX(-50%)',
                                    width: '10px', height: '10px',
                                    background: 'white', border: '1.5px solid #2563EB',
                                    borderRadius: '50%', cursor: 'crosshair', zIndex: 10,
                                    boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
                                  }}
                                  onMouseDown={e => startDrag(e, obj.id, page.id, 'rotate')}
                                />
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Custom Right-Click Context Menu popup */}
            {contextMenu && contextMenu.visible && (
              <div
                className="absolute bg-white border border-[#E5E5E5] rounded-[8px] shadow-lg py-1 z-50 text-[11.5px] font-semibold text-[#525252] w-48 shadow-xl"
                style={{ left: contextMenu.x, top: contextMenu.y }}
                onClick={e => e.stopPropagation()}
              >
                {contextMenu.objectId ? (
                  <>
                    <button onClick={() => { bringToFront(contextMenu.objectId!); closeContextMenu(); }} className="w-full text-left px-3.5 py-1.5 hover:bg-[#F5F5F5] hover:text-[#111111] flex items-center justify-between">
                      <span>Bring to Front</span>
                      <span className="text-[10px] text-[#A3A3A3]">Cmd + ]</span>
                    </button>
                    <button onClick={() => { bringFwd(); closeContextMenu(); }} className="w-full text-left px-3.5 py-1.5 hover:bg-[#F5F5F5] hover:text-[#111111]">
                      Bring Forward
                    </button>
                    <button onClick={() => { sendBwd(); closeContextMenu(); }} className="w-full text-left px-3.5 py-1.5 hover:bg-[#F5F5F5] hover:text-[#111111]">
                      Send Backward
                    </button>
                    <button onClick={() => { sendToBack(contextMenu.objectId!); closeContextMenu(); }} className="w-full text-left px-3.5 py-1.5 hover:bg-[#F5F5F5] hover:text-[#111111] flex items-center justify-between">
                      <span>Send to Back</span>
                      <span className="text-[10px] text-[#A3A3A3]">Cmd + [</span>
                    </button>
                    
                    <div className="h-px bg-[#E5E5E5] my-1" />
                    
                    <button onClick={() => { dup(); closeContextMenu(); }} className="w-full text-left px-3.5 py-1.5 hover:bg-[#F5F5F5] hover:text-[#111111] flex items-center justify-between">
                      <span>Duplicate Element</span>
                      <span className="text-[10px] text-[#A3A3A3]">Cmd + D</span>
                    </button>
                    
                    <button onClick={() => { del(); closeContextMenu(); }} className="w-full text-left px-3.5 py-1.5 hover:bg-[#FEF2F2] hover:text-[#DC2626] flex items-center justify-between">
                      <span>Delete Element</span>
                      <span className="text-[10px] text-[#A3A3A3]">Del</span>
                    </button>

                    {objects.find(o => o.id === contextMenu.objectId)?.src && (
                      <>
                        <div className="h-px bg-[#E5E5E5] my-1" />
                        <button onClick={() => { removeBackground(contextMenu.objectId!); closeContextMenu(); }} className="w-full text-left px-3.5 py-1.5 hover:bg-[#EFF6FF] hover:text-[#2563EB] flex items-center gap-1.5">
                          <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M9.813 15.904L9 21m0 0l-.813-5.096L3 15.094l5.096-.813L9 9l.813 5.281L15 15.094l-5.188.81z" /></svg>
                          <span>Remove Background</span>
                        </button>
                      </>
                    )}
                  </>
                ) : (
                  <>
                    <button onClick={() => { duplicatePage(contextMenu.pageId); closeContextMenu(); }} className="w-full text-left px-3.5 py-1.5 hover:bg-[#F5F5F5] hover:text-[#111111]">
                      Duplicate Page
                    </button>
                    <button onClick={() => { addPageAfter(contextMenu.pageId); closeContextMenu(); }} className="w-full text-left px-3.5 py-1.5 hover:bg-[#F5F5F5] hover:text-[#111111]">
                      Add New Page Below
                    </button>
                    <button onClick={() => { deletePage(contextMenu.pageId); closeContextMenu(); }} disabled={pages.length <= 1} className="w-full text-left px-3.5 py-1.5 hover:bg-[#FEF2F2] hover:text-[#DC2626] disabled:opacity-30">
                      Delete Page
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Zoom & Canvas Coordinates Footer Bar */}
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-white border border-[#E5E5E5] px-4 py-1.5 rounded-full flex items-center gap-3 text-[11px] font-semibold text-[#525252] shadow-md z-30 select-none">
            <span className="flex items-center gap-1.5">
              <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" /></svg>
              Canvas size: {canvasWidth} × {canvasHeight} px
            </span>
            <div className="w-px h-3 bg-[#E5E5E5]" />
            <button onClick={() => { setPanX(0); setPanY(40); setZoom(100); }} className="hover:text-black font-bold text-[#2563EB]">Reset View</button>
            <div className="w-px h-3 bg-[#E5E5E5]" />
            <span className="text-[10px] text-[#A3A3A3] hidden sm:inline">Spacebar + Drag to Pan | Shift + Click to select multiple</span>
          </div>
        </div>

        {/* ── RIGHT PANEL (Inspector / Properties Sidebar) ── */}
        <div className="flex-none w-[290px] bg-white border-l border-[#E5E5E5] flex flex-col overflow-hidden">
          {/* Right panel tabs */}
          <div className="flex-none flex border-b border-[#E5E5E5]">
            {(['properties','canvas'] as const).map(t => (
              <button key={t} onClick={() => setRightTab(t)}
                className={`flex-1 h-[42px] text-[12.5px] font-bold capitalize border-b-2 transition-colors ${rightTab===t ? 'text-[#111111] border-[#2563EB]' : 'text-[#737373] border-transparent hover:text-[#111111]'}`}>
                {t.charAt(0).toUpperCase()+t.slice(1)}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto">
            {rightTab === 'properties' && (
              <div className="p-4 space-y-5">
                
                {/* 1. Contextual Type properties styling */}
                {selObj ? (
                  <>
                    {/* Text Styling Options */}
                    {selObj.text !== undefined && (
                      <div className="space-y-3.5 border-b border-[#F0F0F0] pb-4">
                        <span className="text-[11px] font-bold text-[#737373] uppercase tracking-wider block">Text Properties</span>
                        
                        <div>
                          <label className="text-[10px] text-[#737373] font-medium block mb-1">Edit Text</label>
                          <textarea
                            value={selObj.text}
                            onChange={e => upd(selObj.id, { text: e.target.value, name: e.target.value })}
                            onBlur={snap}
                            className="w-full h-16 p-2 text-[12.5px] bg-[#F4F4F5] border border-transparent rounded-[6px] focus:bg-white focus:border-[#2563EB] focus:outline-none resize-none font-semibold text-[#111111]"
                          />
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-[10px] text-[#737373] font-medium block mb-1">Font Size (px)</label>
                            <input
                              type="number"
                              value={selObj.fontSize || 16}
                              onChange={e => upd(selObj.id, { fontSize: Number(e.target.value) })}
                              onBlur={snap}
                              className="w-full h-8 px-2 bg-[#F4F4F5] border border-transparent rounded-[6px] focus:bg-white focus:border-[#2563EB] focus:outline-none text-[12.5px] font-bold"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-[#737373] font-medium block mb-1">Font Color</label>
                            <div className="flex items-center gap-1.5">
                              <input
                                type="color"
                                value={selObj.fontColor || '#111111'}
                                onChange={e => upd(selObj.id, { fontColor: e.target.value })}
                                onBlur={snap}
                                className="w-8 h-8 rounded border border-[#E5E5E5] cursor-pointer shrink-0"
                              />
                              <input
                                type="text"
                                value={selObj.fontColor || '#111111'}
                                onChange={e => upd(selObj.id, { fontColor: e.target.value })}
                                onBlur={snap}
                                className="w-full h-8 px-2 bg-[#F4F4F5] border border-transparent rounded-[6px] text-[11px] font-mono focus:outline-none"
                              />
                            </div>
                          </div>
                        </div>

                        <div>
                          <label className="text-[10px] text-[#737373] font-medium block mb-1">Typography</label>
                          <div className="flex gap-1">
                            <button
                              onClick={() => upd(selObj.id, { fontWeight: selObj.fontWeight === 'bold' ? 'normal' : 'bold' })}
                              className={`w-8 h-8 rounded border text-xs font-bold transition ${selObj.fontWeight === 'bold' ? 'bg-[#EFF6FF] border-[#2563EB] text-[#2563EB]' : 'border-[#E5E5E5] text-[#525252] hover:bg-[#F5F5F5]'}`}
                            >
                              B
                            </button>
                            <button
                              onClick={() => upd(selObj.id, { fontStyle: selObj.fontStyle === 'italic' ? 'normal' : 'italic' })}
                              className={`w-8 h-8 rounded border text-xs italic font-bold transition ${selObj.fontStyle === 'italic' ? 'bg-[#EFF6FF] border-[#2563EB] text-[#2563EB]' : 'border-[#E5E5E5] text-[#525252] hover:bg-[#F5F5F5]'}`}
                            >
                              I
                            </button>
                            <div className="w-px h-6 bg-[#E5E5E5] mx-1 align-middle self-center" />
                            {([
                              { k: 'left', svg: <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12" /> },
                              { k: 'center', svg: <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" /> },
                              { k: 'right', svg: <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5M12 17.25h8.25" /> }
                            ] as const).map(a => (
                              <button
                                key={a.k}
                                onClick={() => upd(selObj.id, { align: a.k })}
                                className={`w-8 h-8 rounded border flex items-center justify-center transition ${selObj.align === a.k ? 'bg-[#EFF6FF] border-[#2563EB] text-[#2563EB]' : 'border-[#E5E5E5] text-[#525252] hover:bg-[#F5F5F5]'}`}
                              >
                                <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">{a.svg}</svg>
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Shape Styling Options */}
                    {selObj.shapeType !== undefined && (
                      <div className="space-y-3.5 border-b border-[#F0F0F0] pb-4">
                        <span className="text-[11px] font-bold text-[#737373] uppercase tracking-wider block">Shape Styles</span>
                        
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-[10px] text-[#737373] font-medium block mb-1">Fill Color</label>
                            <div className="flex items-center gap-1.5">
                              <input
                                type="color"
                                value={selObj.color || '#3B82F6'}
                                onChange={e => upd(selObj.id, { color: e.target.value })}
                                onBlur={snap}
                                className="w-8 h-8 rounded border border-[#E5E5E5] cursor-pointer shrink-0"
                              />
                              <input
                                type="text"
                                value={selObj.color || '#3B82F6'}
                                onChange={e => upd(selObj.id, { color: e.target.value })}
                                onBlur={snap}
                                className="w-full h-8 px-2 bg-[#F4F4F5] border border-transparent rounded-[6px] text-[11px] font-mono focus:outline-none"
                              />
                            </div>
                          </div>

                          <div>
                            <label className="text-[10px] text-[#737373] font-medium block mb-1">Border Color</label>
                            <div className="flex items-center gap-1.5">
                              <input
                                type="color"
                                value={selObj.borderColor || '#1E3A8A'}
                                onChange={e => upd(selObj.id, { borderColor: e.target.value })}
                                onBlur={snap}
                                className="w-8 h-8 rounded border border-[#E5E5E5] cursor-pointer shrink-0"
                              />
                              <input
                                type="text"
                                value={selObj.borderColor || '#1E3A8A'}
                                onChange={e => upd(selObj.id, { borderColor: e.target.value })}
                                onBlur={snap}
                                className="w-full h-8 px-2 bg-[#F4F4F5] border border-transparent rounded-[6px] text-[11px] font-mono focus:outline-none"
                              />
                            </div>
                          </div>
                        </div>

                        <div>
                          <label className="text-[10px] text-[#737373] font-medium block mb-1">Border Width (px)</label>
                          <div className="flex items-center gap-2">
                            <input
                              type="range"
                              min={0}
                              max={20}
                              value={selObj.borderWidth || 0}
                              onChange={e => upd(selObj.id, { borderWidth: Number(e.target.value) })}
                              onMouseUp={snap}
                              className="flex-1 h-1.5 bg-[#E5E5E5] rounded-full appearance-none cursor-pointer"
                            />
                            <span className="text-[11px] font-bold text-[#111111] w-6 text-right">{selObj.borderWidth || 0}px</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-center py-4 border-b border-[#F0F0F0] text-[11.5px] text-[#737373]">
                    No canvas element currently selected.
                  </div>
                )}

                {/* 2. Position & Size */}
                <div>
                  <p className="text-[11px] font-bold text-[#737373] uppercase tracking-wider mb-2.5">Position &amp; Size</p>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { l: 'X', v: selObj?.x ?? 0, k: 'x' },
                      { l: 'Y', v: selObj?.y ?? 0, k: 'y' },
                      { l: 'W', v: selObj?.w ?? 0, k: 'w' },
                      { l: 'H', v: selObj?.h ?? 0, k: 'h' },
                    ].map(({ l, v, k }) => (
                      <div key={l} className="relative">
                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-[#A3A3A3]">{l}</span>
                        <input type="number" value={Math.round(v)}
                          disabled={!selObj || selObj.locked}
                          onChange={e => selId && upd(selId, { [k]: Number(e.target.value) })}
                          onBlur={() => selId && snap()}
                          className="w-full h-8 pl-6 pr-2 text-[12.5px] font-semibold text-[#111111] bg-[#F4F4F5] rounded-[7px] border border-transparent focus:border-[#2563EB] focus:bg-white focus:outline-none transition-all disabled:opacity-40" />
                      </div>
                    ))}
                  </div>
                </div>

                {/* 3. Rotate & Opacity */}
                <div className="grid grid-cols-2 gap-3 border-b border-[#F0F0F0] pb-4">
                  <div>
                    <p className="text-[11px] font-bold text-[#737373] uppercase tracking-wider mb-2">Rotate</p>
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full border-2 border-[#D4D4D4] flex-none relative overflow-hidden">
                        <div style={{
                          position: 'absolute', bottom: '50%', left: '50%',
                          width: '2px', height: '9px',
                          background: '#525252', borderRadius: '1px',
                          transformOrigin: 'bottom center',
                          transform: `translateX(-50%) rotate(${selObj?.rot ?? 0}deg)`,
                        }} />
                        <div style={{ position: 'absolute', bottom: '50%', left: '50%', width: '3px', height: '3px', background: '#525252', borderRadius: '50%', transform: 'translate(-50%, 50%)' }} />
                      </div>
                      <input type="number" value={selObj?.rot ?? 0} disabled={!selObj || selObj.locked}
                        onChange={e => selId && upd(selId, { rot: Number(e.target.value) })}
                        onBlur={() => selId && snap()}
                        className="flex-1 h-8 px-2 text-[12px] font-semibold text-[#111111] bg-[#F4F4F5] rounded-[7px] border border-transparent focus:border-[#2563EB] focus:bg-white focus:outline-none transition-all disabled:opacity-40 min-w-0" />
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <p className="text-[11px] font-bold text-[#737373] uppercase tracking-wider">Opacity</p>
                      <span className="text-[11px] font-bold text-[#111111]">{selObj?.opacity ?? 100}%</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <input type="range" min={0} max={100} value={selObj?.opacity ?? 100} disabled={!selObj || selObj.locked}
                        onChange={e => selId && upd(selId, { opacity: Number(e.target.value) })}
                        onMouseUp={() => selId && snap()}
                        className="flex-1 h-1.5 rounded-full appearance-none cursor-pointer disabled:opacity-40"
                        style={{ background: `linear-gradient(to right, #2563EB ${selObj?.opacity ?? 100}%, #E5E5E5 ${selObj?.opacity ?? 100}%)` }} />
                    </div>
                  </div>
                </div>

                {/* 4. Align tools */}
                <div>
                  <p className="text-[11px] font-bold text-[#737373] uppercase tracking-wider mb-2">Align relative to Page</p>
                  <div className="flex gap-1.5 flex-wrap">
                    {[
                      { type: 'left',     title: 'Align Left',        svg: <><path d="M3 6h18M3 12h12M3 18h8"/><line x1="3" y1="2" x2="3" y2="22" strokeWidth="2.5"/></> },
                      { type: 'center-h', title: 'Center Horizontal',  svg: <><path d="M12 2v20"/><path strokeLinecap="round" d="M4 7h8M8 12h8M6 17h8"/></> },
                      { type: 'right',    title: 'Align Right',        svg: <><path d="M3 6h18M9 12h12M13 18h8"/><line x1="21" y1="2" x2="21" y2="22" strokeWidth="2.5"/></> },
                      { type: 'top',      title: 'Align Top',          svg: <><path d="M6 3v18M12 3v12M18 3v8"/><line x1="2" y1="3" x2="22" y2="3" strokeWidth="2.5"/></> },
                      { type: 'center-v', title: 'Center Vertical',    svg: <><path d="M2 12h20"/><path strokeLinecap="round" d="M7 5v8M12 8v8M17 5v8"/></> },
                      { type: 'bottom',   title: 'Align Bottom',       svg: <><path d="M6 3v18M12 9v12M18 13v8"/><line x1="2" y1="21" x2="22" y2="21" strokeWidth="2.5"/></> },
                    ].map(({ type, title, svg }) => (
                      <button key={type} title={title} onClick={() => doAlign(type)} disabled={selIds.length === 0 || selObj?.locked}
                        className="w-8 h-8 flex items-center justify-center rounded-[6px] border border-[#E5E5E5] text-[#525252] hover:border-[#2563EB] hover:text-[#2563EB] hover:bg-[#EFF6FF] disabled:opacity-30 disabled:cursor-not-allowed transition-all">
                        <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">{svg}</svg>
                      </button>
                    ))}
                  </div>
                </div>

                {/* 5. Quick Actions */}
                <div>
                  <p className="text-[11px] font-bold text-[#737373] uppercase tracking-wider mb-2">Quick Actions</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button onClick={() => selId && upd(selId, { locked: !selObj?.locked })} disabled={!selId}
                      className={`flex items-center gap-1.5 h-9 px-3 rounded-[7px] border text-[12px] font-semibold transition-all disabled:opacity-40 ${selObj?.locked ? 'border-[#2563EB] text-[#2563EB] bg-[#EFF6FF]' : 'border-[#E5E5E5] text-[#525252] hover:border-[#2563EB] hover:text-[#2563EB] hover:bg-[#EFF6FF] bg-white'}`}>
                      <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2" /><path strokeLinecap="round" strokeLinejoin="round" d="M8 11V7a4 4 0 018 0v4" /></svg>
                      {selObj?.locked ? 'Unlock' : 'Lock'}
                    </button>
                    <button onClick={dup} disabled={selIds.length === 0}
                      className="flex items-center gap-1.5 h-9 px-3 rounded-[7px] border border-[#E5E5E5] text-[12px] font-semibold text-[#525252] hover:border-[#2563EB] hover:text-[#2563EB] hover:bg-[#EFF6FF] bg-white disabled:opacity-40 transition-all">
                      <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2" /><path strokeLinecap="round" strokeLinejoin="round" d="M4 16V4a2 2 0 012-2h12" /></svg>
                      Duplicate
                    </button>
                  </div>
                  <button onClick={del} disabled={selIds.length === 0}
                    className="mt-1.5 w-full flex items-center justify-center gap-1.5 h-9 px-3 rounded-[7px] border border-[#E5E5E5] text-[12px] font-semibold text-[#525252] hover:border-[#DC2626] hover:text-[#DC2626] hover:bg-[#FEF2F2] bg-white disabled:opacity-30 transition-all">
                    <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    Delete Selected
                  </button>
                </div>
              </div>
            )}

            {rightTab === 'canvas' && (
              <div className="p-4 space-y-4">
                <p className="text-[11px] font-bold text-[#737373] uppercase tracking-wider">Canvas / Document Settings</p>
                
                <div>
                  <p className="text-[12px] text-[#525252] font-semibold mb-1.5">Preset Dimensions</p>
                  <div className="relative">
                    <select
                      onChange={e => {
                        const val = e.target.value;
                        if (val === 'Custom') return;
                        const p = PRESETS.find(x => x.id === val);
                        if (p) applyPreset(p.w, p.h, true);
                      }}
                      className="w-full appearance-none h-9 pl-3 pr-7 text-[12px] bg-[#F4F4F5] rounded-[8px] border border-transparent focus:border-[#2563EB] focus:outline-none font-bold"
                    >
                      <option value="Custom">Custom Size...</option>
                      {PRESETS.map(p => (
                        <option key={p.id} value={p.id}>{p.name} ({p.w} × {p.h} px)</option>
                      ))}
                    </select>
                    <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[#737373]"><svg width="9" height="9" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" /></svg></span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <p className="text-[11px] font-semibold text-[#737373] mb-1">Width (px)</p>
                    <input
                      type="number"
                      value={canvasWidth}
                      onChange={e => setCanvasWidth(Number(e.target.value))}
                      className="w-full h-8 px-3 text-[12px] bg-[#F4F4F5] rounded-[7px] border border-transparent focus:border-[#2563EB] focus:bg-white focus:outline-none font-semibold"
                    />
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold text-[#737373] mb-1">Height (px)</p>
                    <input
                      type="number"
                      value={canvasHeight}
                      onChange={e => setCanvasHeight(Number(e.target.value))}
                      className="w-full h-8 px-3 text-[12px] bg-[#F4F4F5] rounded-[7px] border border-transparent focus:border-[#2563EB] focus:bg-white focus:outline-none font-semibold"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Export page (pinned) */}
          <div className="flex-none p-3 border-t border-[#E5E5E5] flex flex-col gap-3">
            <div className="text-center">
              <span className="text-[10px] font-bold tracking-widest text-[#A3A3A3] uppercase">EisenDev | Arjay @ 2026</span>
            </div>
            <button onClick={() => { setDownloadSelection('active'); setShowDownloadModal(true); }}
              className="w-full flex items-center justify-center gap-2 h-10 bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-[13px] font-bold rounded-[8px] transition-all shadow-md">
              <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
              Download Canvas
            </button>
          </div>
        </div>
      </div>

      {/* ── DOWNLOAD MODAL ── */}
      {showDownloadModal && (
        <div className="fixed inset-0 bg-black/40 z-[100] flex items-center justify-center overflow-y-auto">
          <div className="bg-white w-[420px] rounded-[12px] shadow-2xl flex flex-col my-8">
            <div className="px-5 py-4 border-b border-[#F0F0F0] flex items-center justify-between">
              <h3 className="text-[16px] font-bold text-[#111111]">Download Asset</h3>
              <button onClick={() => setShowDownloadModal(false)} className="text-[#A3A3A3] hover:text-[#111111]">
                <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
              </button>
            </div>
            
            <div className="p-5 space-y-5">
              <div>
                <p className="text-[12px] font-semibold text-[#525252] mb-2">Pages to Download</p>
                <div className="flex gap-2">
                  <button onClick={() => setDownloadSelection('active')} className={`flex-1 h-9 rounded-[8px] text-[12px] font-bold border transition ${downloadSelection === 'active' ? 'bg-[#EFF6FF] border-[#2563EB] text-[#2563EB]' : 'border-[#E5E5E5] text-[#525252] hover:bg-[#F5F5F5]'}`}>Current Page</button>
                  <button onClick={() => setDownloadSelection('all')} className={`flex-1 h-9 rounded-[8px] text-[12px] font-bold border transition ${downloadSelection === 'all' ? 'bg-[#EFF6FF] border-[#2563EB] text-[#2563EB]' : 'border-[#E5E5E5] text-[#525252] hover:bg-[#F5F5F5]'}`}>All {pages.length} Pages</button>
                </div>
              </div>

              <div>
                <p className="text-[12px] font-semibold text-[#525252] mb-2">Format</p>
                <div className="relative">
                  <select value={exFmt} onChange={e => setExFmt(e.target.value)} className="w-full appearance-none h-10 pl-3 pr-8 text-[13px] font-bold text-[#111111] bg-[#F4F4F5] rounded-[8px] border border-transparent focus:border-[#2563EB] focus:outline-none cursor-pointer">
                    <option>PNG</option>
                    <option>JPEG</option>
                    <option>PDF</option>
                  </select>
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#737373]"><svg width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" /></svg></span>
                </div>
              </div>

              <div>
                <p className="text-[12px] font-semibold text-[#525252] mb-2">Background</p>
                <div className="relative">
                  <select value={exBg} onChange={e => setExBg(e.target.value)} disabled={exFmt === 'JPEG'} className="w-full appearance-none h-10 pl-3 pr-8 text-[13px] font-bold text-[#111111] bg-[#F4F4F5] rounded-[8px] border border-transparent focus:border-[#2563EB] focus:outline-none cursor-pointer disabled:opacity-50">
                    <option>Transparent</option>
                    <option>White</option>
                  </select>
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#737373]"><svg width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" /></svg></span>
                </div>
              </div>

              <div>
                <p className="text-[12px] font-semibold text-[#525252] mb-2">Resolution (Scale)</p>
                <div className="flex gap-2">
                  {([1, 2, 3] as const).map(s => (
                    <button key={s} onClick={() => setExScale(s)}
                      className={`flex-1 h-9 rounded-[8px] text-[12px] font-bold border transition ${exScale === s ? 'bg-[#EFF6FF] border-[#2563EB] text-[#2563EB]' : 'border-[#E5E5E5] text-[#525252] hover:bg-[#F5F5F5]'}`}>
                      {s}x ({canvasWidth * s} × {canvasHeight * s})
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="px-5 py-4 border-t border-[#F0F0F0] flex justify-end gap-3">
              <button onClick={() => setShowDownloadModal(false)} className="px-4 h-10 rounded-[8px] text-[13px] font-bold text-[#525252] hover:bg-[#F5F5F5] transition">Cancel</button>
              <button onClick={handleDownload} className="px-5 h-10 rounded-[8px] bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-[13px] font-bold shadow-md transition flex items-center gap-1.5">
                <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                Download
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
