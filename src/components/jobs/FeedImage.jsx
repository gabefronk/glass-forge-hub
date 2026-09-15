import { useEffect, useRef, useState } from "react";

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

export default function FeedImage({ src, alt, className, style, loading }) {
  const [resolvedSrc, setResolvedSrc] = useState(src);
  const [retried, setRetried] = useState(false);
  const objectUrlRef = useRef(null);

  useEffect(() => () => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
  }, []);

  const handleError = async () => {
    if (retried || !src) return;
    setRetried(true);
    const token = getAccessToken();
    if (!token) return;
    try {
      const res = await fetch(src, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return;
      const blob = await res.blob();
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      const url = URL.createObjectURL(blob);
      objectUrlRef.current = url;
      setResolvedSrc(url);
    } catch {
      // give up silently — the broken image is the fallback
    }
  };

  return <img src={resolvedSrc} alt={alt} className={className} style={style} loading={loading} onError={handleError} />;
}