import { useEffect, useRef, useState } from "react";
import { ExternalLink, FileText, X } from "lucide-react";
import { fileLabel, isPdfUrl } from "@/lib/fileLinks";

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
      const blob = await fetchWithToken(src);
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
      try { const res = await fetch(src); if (res.ok) blob = await res.blob(); } catch {}
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
export function AttachmentViewer({ src, onClose }) {
  const [pdf, setPdf] = useState(() => isPdfUrl(src));
  useEffect(() => { setPdf(isPdfUrl(src)); }, [src]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex flex-col p-4" style={{ backgroundColor: "rgba(0,0,0,.85)" }} onClick={onClose} role="dialog" aria-modal="true" aria-label="Attachment">
      <div className="mb-3 flex shrink-0 items-center justify-end gap-2">
        <a href={src} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-white/10 px-3.5 text-[12px] font-semibold text-white">
          <ExternalLink className="h-3.5 w-3.5" />Open in new tab
        </a>
        <button type="button" onClick={onClose} aria-label="Close attachment" className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center" onClick={pdf ? (e) => e.stopPropagation() : undefined}>
        {pdf ? <PdfFrame src={src} /> : <FeedImage src={src} alt="photo" className="max-w-full max-h-full rounded-[12px]" onNotImage={() => setPdf(true)} />}
      </div>
    </div>
  );
}
