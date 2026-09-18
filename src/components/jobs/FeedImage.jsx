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

export default function FeedImage({ src, alt, className, style, loading, onNotImage }) {
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
