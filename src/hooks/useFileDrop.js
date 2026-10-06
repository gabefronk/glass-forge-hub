import { useCallback, useRef, useState } from 'react';

// Depth-counted drag-and-drop for the conversation panel. A counter (not a boolean) keeps the
// overlay stable while the pointer moves between child elements — dragenter/dragleave fire on
// every child boundary, so a boolean flickers; a counter only clears when the pointer fully leaves.
export function useFileDrop({ onFiles, disabled }) {
  const [depth, setDepth] = useState(0);
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  const onFilesRef = useRef(onFiles);
  onFilesRef.current = onFiles;

  const hasFiles = (e) => !!(e && e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files'));

  const onDragEnter = useCallback((e) => {
    if (disabledRef.current || !hasFiles(e)) return;
    e.preventDefault();
    setDepth((d) => d + 1);
  }, []);

  const onDragOver = useCallback((e) => {
    if (disabledRef.current || !hasFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  }, []);

  const onDragLeave = useCallback((e) => {
    if (disabledRef.current) return;
    e.preventDefault();
    setDepth((d) => Math.max(0, d - 1));
  }, []);

  const onDrop = useCallback((e) => {
    if (disabledRef.current) return;
    e.preventDefault();
    setDepth(0);
    const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
    if (files.length && onFilesRef.current) onFilesRef.current(files);
  }, []);

  const reset = useCallback(() => setDepth(0), []);
  return { depth, isDragging: depth > 0, handlers: { onDragEnter, onDragOver, onDragLeave, onDrop }, reset };
}