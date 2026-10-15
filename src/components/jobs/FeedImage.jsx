import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, FileText, X } from "lucide-react";
import { fileLabel, isPdfUrl } from "@/lib/fileLinks";
import { driveFileId } from "../../../base44/shared/eventAttachments.js";
import { appParams } from "@/lib/app-params";

// Photo file URLs hosted on base44.app / media.base44.com can return 403 to
// browsers that lack Base44 login cookies. Render the normal <img> first; on
// error, retry by fetching the URL with an Authorization: Bearer header using
// the app's stored access token, then show the fetched blob via an object URL.
function getAccessToken() {
  try {
    return localStorage.getItem("base44_access_token") || localStorage.getItem("token") || "";
  } catch {
    return "";
  }
}

async function fetchWithToken(src) {
  const token = getAccessToken();
  if (!token) return null;
  const res = await fetch(src, { headers: { Authorization: `Bearer ${token}` } });
  return res.ok ? res.blob() : null;
}

// Drive view links (drive.google.com/file/d/<id>/view) are HTML pages, not
// image bytes - they always break <img>. The driveThumb function streams the
// real bytes using the app's Drive connection (owner-gated server side).
const driveIdOf = (src) => driveFileId({ file_url: String(src || "") });
async function fetchDriveBlob(src, size) {
  const id = driveIdOf(src);
  const token = getAccessToken();
  if (!id || !token) return null;
  const res = await fetch(`${window.location.origin}/api/apps/${appParams.appId}/functions/driveThumb`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ file_id: id, size: size || "thumb" }),
  }).catch(() => null);
  if (!res || !res.ok) return null;
  const type = res.headers.get("content-type") || "";
  if (!type.startsWith("image/") && type !== "application/pdf" && type !== "application/octet-stream") return null;
  return res.blob();
}

// Tile shown instead of a broken image for PDFs and other non-image attachments
// (Probuild "file" attachments are stored alongside photos).
function FileTile({ src, className, style }) {
  return (
    <span className={`flex flex-col items-center justify-center gap-1.5 bg-[#F6F3EC] p-2 text-center ${className || ""}`} style={style}>
      <FileText className="h-6 w-6 shrink-0" style={{ color: "#566063" }} />
      <span className="max-w-full truncate text-[11px] font-medium" style={{ color: "#101617" }}>{isPdfUrl(src) ? fileLabel(src) : "Open file"}</span>
      <span className="text-[10px] uppercase tracking-[0.1em]" style={{ color: "#8F999B" }}>{isPdfUrl(src) ? "PDF" : "Attachment"}</span>
    </span>
  );
}

// ---------- Thumbnails ----------
// Crew photos are full-size phone shots (often 3000×4000). A visit with 8–12 of them is too
// much for a phone to decode at once — iOS gives up and the grid fell back to "Open file"
// tiles until each photo was opened on its own. Thumbnails are made one or two at a time,
// only when scrolled near, shrunk to ~480px on a canvas and cached for the session.
const IMG_EXT = /\.(jpe?g|png|heic|heif|webp|gif)(\?|$)/i;
const looksLikePhoto = (src) => IMG_EXT.test(String(src || ""));
// base44.app/api/apps/<app>/files/mp/public/<app>/<file> just redirects to the media host.
const directUrl = (src) => String(src || "").replace(/^https:\/\/base44\.app\/api\/apps\/[^/]+\/files\/mp\/public\/([^/]+)\/(.+)$/, "https://media.base44.com/images/public/$1/$2");
const thumbCache = new Map(); // src -> object URL
const queue = [];
let active = 0;
const MAX_ACTIVE = 2;
function runQueue() {
  while (active < MAX_ACTIVE && queue.length) {
    const job = queue.shift();
    active += 1;
    job().finally(() => { active -= 1; runQueue(); });
  }
}
function enqueue(fn) {
  return new Promise((resolve, reject) => { queue.push(() => fn().then(resolve, reject)); runQueue(); });
}
async function loadBlob(src) {
  if (driveIdOf(src)) return fetchDriveBlob(src, "thumb");
  try { const r = await fetch(directUrl(src)); if (r.ok) return await r.blob(); } catch { /* fall through */ }
  return fetchWithToken(src);
}
function drawThumb(source, w, h, max = 480) {
  const scale = Math.min(1, max / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  canvas.getContext("2d").drawImage(source, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((b) => { canvas.width = canvas.height = 0; b ? resolve(b) : reject(new Error("toBlob")); }, "image/jpeg", 0.78));
}
async function makeThumb(src) {
  if (thumbCache.has(src)) return thumbCache.get(src);
  return enqueue(async () => {
    if (thumbCache.has(src)) return thumbCache.get(src);
    const blob = await loadBlob(src);
    if (!blob) throw new Error("load");
    let out;
    if (typeof createImageBitmap === "function") {
      try {
        const bmp = await createImageBitmap(blob, { imageOrientation: "from-image" });
        out = await drawThumb(bmp, bmp.width, bmp.height);
        bmp.close?.();
      } catch { out = null; }
    }
    if (!out) {
      const url = URL.createObjectURL(blob);
      try {
        const img = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = url; });
        out = await drawThumb(img, img.naturalWidth, img.naturalHeight);
        img.src = "";
      } finally { URL.revokeObjectURL(url); }
    }
    const thumbUrl = URL.createObjectURL(out);
    thumbCache.set(src, thumbUrl);
    return thumbUrl;
  });
}

// Grid thumbnail. Falls back to the plain image, and never shows a photo as "Open file".
export function ThumbImage({ src, alt, className, style }) {
  const [thumb, setThumb] = useState(() => thumbCache.get(src) || null);
  const [failed, setFailed] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    setThumb(thumbCache.get(src) || null);
    setFailed(false);
    if (!src || thumbCache.has(src) || isPdfUrl(src)) return undefined;
    let alive = true;
    const start = () => makeThumb(src).then((u) => { if (alive) setThumb(u); }).catch(() => { if (alive) setFailed(true); });
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") { start(); return () => { alive = false; }; }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { io.disconnect(); start(); }
    }, { rootMargin: "400px" });
    io.observe(el);
    return () => { alive = false; io.disconnect(); };
  }, [src]);
  if (isPdfUrl(src) || (failed && !looksLikePhoto(src))) return <FeedImage src={src} alt={alt} className={className} style={style} loading="lazy" />;
  if (thumb) return <img src={thumb} alt={alt} className={className} style={style} />;
  if (failed) return <FeedImage src={directUrl(src)} alt={alt} className={className} style={style} loading="lazy" photo />;
  return <span ref={ref} className={`block animate-pulse ${className || ""}`} style={{ ...style, backgroundColor: "#e7e1d5" }} aria-hidden="true" />;
}

export default function FeedImage({ src, alt, className, style, loading, onNotImage, photo = false }) {
  const [resolvedSrc, setResolvedSrc] = useState(src);
  const [retried, setRetried] = useState(false);
  const [notImage, setNotImage] = useState(() => isPdfUrl(src));
  const objectUrlRef = useRef(null);

  // Reset when a different attachment is shown in the same slot.
  useEffect(() => { setResolvedSrc(src); setRetried(false); setNotImage(isPdfUrl(src)); }, [src]);
  useEffect(() => () => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
  }, []);
  useEffect(() => { if (notImage) onNotImage?.(); }, [notImage]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleError = async () => {
    if (!src) return;
    if (retried) { setNotImage(true); return; }
    setRetried(true);
    try {
      let blob = null;
      if (driveIdOf(src)) blob = await fetchDriveBlob(src, "full");
      if (!blob) blob = await fetchWithToken(src);
      // Storage may label photos as octet-stream; let <img> try those, and a second
      // decode failure (retried) turns the slot into a file tile.
      const generic = !blob?.type || blob.type === "application/octet-stream";
      if (!blob || (!generic && !blob.type.startsWith("image/"))) { setNotImage(true); return; }
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      const url = URL.createObjectURL(blob);
      objectUrlRef.current = url;
      setResolvedSrc(url);
    } catch {
      setNotImage(true);
    }
  };

  // A known photo that won't render inline still reads as a photo: tap opens it full size.
  if (notImage && (photo || looksLikePhoto(src)) && !isPdfUrl(src)) {
    return (
      <span className={`flex flex-col items-center justify-center gap-1 bg-[#F6F3EC] text-center ${className || ""}`} style={style}>
        <span className="text-[11px] font-semibold" style={{ color: "#101617" }}>Photo</span>
        <span className="text-[10px] uppercase tracking-[0.1em]" style={{ color: "#8F999B" }}>Tap to view</span>
      </span>
    );
  }
  if (notImage) return <FileTile src={src} className={className} style={style} />;
  return <img src={resolvedSrc} alt={alt} className={className} style={style} loading={loading} onError={handleError} />;
}

// Embedded PDF. Loads the file as a blob first (with the app token when the plain
// request is refused) so private Base44 files render; falls back to the raw URL.
function PdfFrame({ src }) {
  const [frameSrc, setFrameSrc] = useState(null);
  useEffect(() => {
    let active = true, objectUrl = null;
    (async () => {
      let blob = null;
      if (driveIdOf(src)) { try { blob = await fetchDriveBlob(src, "full"); } catch {} }
      if (!blob) { try { const res = await fetch(src); if (res.ok) blob = await res.blob(); } catch {} }
      if (!blob) { try { blob = await fetchWithToken(src); } catch {} }
      if (!active) return;
      if (blob) {
        // Storage often serves PDFs as octet-stream; only then label the blob as PDF.
        const generic = !blob.type || blob.type === "application/octet-stream";
        objectUrl = URL.createObjectURL(generic ? new Blob([blob], { type: "application/pdf" }) : blob);
        setFrameSrc(objectUrl);
      } else {
        setFrameSrc(src);
      }
    })();
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [src]);
  if (!frameSrc) return <div className="flex h-full items-center justify-center text-[13px] text-white/80">Loading document…</div>;
  return <iframe src={frameSrc} title={fileLabel(src)} className="h-full w-full rounded-[12px] bg-white" />;
}

// Full-screen viewer for job attachments: images as before, PDFs embedded.
// When the caller passes the grid's full photo list, the viewer gains
// previous/next arrows, arrow-key and swipe navigation, and a position counter.
export function AttachmentViewer({ src, photos, onClose, onNavigate }) {
  const [pdf, setPdf] = useState(() => isPdfUrl(src));
  useEffect(() => { setPdf(isPdfUrl(src)); }, [src]);
  const list = Array.isArray(photos) && photos.length > 1 ? photos : null;
  const idx = list ? list.indexOf(src) : -1;
  const canPrev = idx > 0;
  const canNext = list && idx >= 0 && idx < list.length - 1;
  const go = (delta) => {
    if (!list || idx < 0) return;
    const n = idx + delta;
    if (n >= 0 && n < list.length) onNavigate?.(list[n]);
  };
  const goRef = useRef(go);
  goRef.current = go;
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") goRef.current(-1);
      else if (e.key === "ArrowRight") goRef.current(1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  const touchX = useRef(null);
  const onTouchStart = (e) => { touchX.current = e.touches[0].clientX; };
  const onTouchEnd = (e) => {
    if (touchX.current == null) return;
    const dx = e.changedTouches[0].clientX - touchX.current;
    touchX.current = null;
    if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
  };
  const navBtn = "absolute top-1/2 z-10 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-white transition-colors hover:bg-white/25 active:bg-white/35";
  return (
    <div className="fixed inset-0 z-50 flex flex-col p-4" style={{ backgroundColor: "rgba(0,0,0,.85)" }} onClick={onClose} role="dialog" aria-modal="true" aria-label="Attachment" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <div className="mb-3 flex shrink-0 items-center justify-end gap-2">
        <a href={src} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-white/10 px-3.5 text-[12px] font-semibold text-white">
          <ExternalLink className="h-3.5 w-3.5" />Open in new tab
        </a>
        <button type="button" onClick={onClose} aria-label="Close attachment" className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center" onClick={pdf ? (e) => e.stopPropagation() : undefined}>
        {pdf ? <PdfFrame src={src} /> : <FeedImage src={src} alt="photo" className="max-w-full max-h-full rounded-[12px]" onNotImage={() => setPdf(true)} />}
        {canPrev ? (
          <button type="button" aria-label="Previous photo" onClick={(e) => { e.stopPropagation(); go(-1); }} className={`${navBtn} left-2`}>
            <ChevronLeft className="h-6 w-6" />
          </button>
        ) : null}
        {canNext ? (
          <button type="button" aria-label="Next photo" onClick={(e) => { e.stopPropagation(); go(1); }} className={`${navBtn} right-2`}>
            <ChevronRight className="h-6 w-6" />
          </button>
        ) : null}
        {list && idx >= 0 ? (
          <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/55 px-3 py-1 text-[12px] font-semibold text-white">{idx + 1} / {list.length}</div>
        ) : null}
      </div>
    </div>
  );
}
