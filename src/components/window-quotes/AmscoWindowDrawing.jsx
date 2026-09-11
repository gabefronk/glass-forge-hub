import { useId } from "react";
import { diagramPanels, colorParts } from "./amscoConfiguratorModel";
export default function WindowDrawing({ line, settings, grille }) {
  const { rows, kind, columns: baseColumns } = diagramPanels(line);
  const columns = kind === "hung" ? Math.min(6, Number(line.options?.number_wide) || 1) : baseColumns;
  const gradient = useId();
  const ratio = Math.min(2.6, Math.max(.35, (Number(line.width) || 36) / (Number(line.height) || 60)));
  const width = Math.min(236, 220 * ratio), height = width / ratio, x = (300 - width) / 2, y = 40;
  const pair = colorParts(line.options, settings), frame = /black/i.test(pair.exterior) ? "#272B2E" : /taupe/i.test(pair.exterior) ? "#AD9F8E" : "#FFF";
  const panels = Array.from({ length: columns * rows }, (_, index) => ({ x: x + 9 + index % columns * (width - 18) / columns, y: y + 9 + Math.floor(index / columns) * (height - 18) / rows, w: (width - 18) / columns, h: (height - 18) / rows, index }));
  return <svg role="img" aria-label={(line.style || "Window") + " illustration"} viewBox={"0 0 300 " + (height + 88)} className="mx-auto max-h-[460px] w-full max-w-[420px]" fill="none">
    <defs><linearGradient id={gradient} x1="0" y1="1" x2="1" y2="0"><stop offset="0" stopColor="#b8e1e8" /><stop offset=".6" stopColor="#f9fcff" /><stop offset="1" stopColor="#c9e6ed" /></linearGradient></defs>
    <rect x={x} y={y} width={width} height={height} fill={frame} stroke="#607786" strokeWidth="1.4" />
    {kind === "custom" ? <text x="150" y={y + height / 2} textAnchor="middle" fill="#526E7E" fontSize="12">Illustration pending</text> : panels.map(panel => {
      const grilleWide = grille.mode === "rectangular" ? Math.min(12, Number(grille.wide)) : 1;
      const grilleHigh = grille.mode === "rectangular" && grille.scope === "lite" ? Math.min(12, Number(grille.high)) : 1;
      const fixed = /fixed/i.test(line.options?.operation || "");
      const right = /^right|^rh$/i.test(line.options?.operation || "") || /left\s*\/\s*right/i.test(line.options?.operation || "") && panel.index % 2 === 1;
      return <g key={panel.index}>
        <rect x={panel.x + 3} y={panel.y + 3} width={panel.w - 6} height={panel.h - 6} fill={"url(#" + gradient + ")"} stroke="#627E8F" />
        {Array.from({ length: grilleWide - 1 }, (_, index) => <line key={"v" + index} x1={panel.x + panel.w * (index + 1) / grilleWide} x2={panel.x + panel.w * (index + 1) / grilleWide} y1={panel.y + 3} y2={panel.y + panel.h - 3} stroke={frame} strokeWidth="3" />)}
        {Array.from({ length: grilleHigh - 1 }, (_, index) => <line key={"h" + index} x1={panel.x + 3} x2={panel.x + panel.w - 3} y1={panel.y + panel.h * (index + 1) / grilleHigh} y2={panel.y + panel.h * (index + 1) / grilleHigh} stroke={frame} strokeWidth="3" />)}
        {kind === "casement" && !fixed && <polyline points={right ? [panel.x + 7, panel.y + 7, panel.x + panel.w - 7, panel.y + panel.h / 2, panel.x + 7, panel.y + panel.h - 7].join(" ") : [panel.x + panel.w - 7, panel.y + 7, panel.x + 7, panel.y + panel.h / 2, panel.x + panel.w - 7, panel.y + panel.h - 7].join(" ")} stroke="#6C8999" strokeDasharray="5 3" />}
        {kind === "awning" && !fixed && <polyline points={[panel.x + 7, panel.y + panel.h - 7, panel.x + panel.w / 2, panel.y + 7, panel.x + panel.w - 7, panel.y + panel.h - 7].join(" ")} stroke="#6C8999" strokeDasharray="5 3" />}
        {kind === "hung" && panel.index >= columns && <text x={panel.x + panel.w / 2} y={panel.y + panel.h / 2} fill="#526E7E" textAnchor="middle">↑</text>}
        {kind === "slider" && panel.index === (/^ox$/i.test(line.options?.operation || "") ? columns - 1 : 0) && <text x={panel.x + panel.w / 2} y={panel.y + panel.h / 2} fill="#526E7E" textAnchor="middle">{/^ox$/i.test(line.options?.operation || "") ? "←" : "→"}</text>}
      </g>;
    })}
    <line x1={x} x2={x + width} y1="24" y2="24" stroke="#91A4B0" />
    <text x="150" y="18" fill="#486475" fontSize="12" textAnchor="middle">{line.width || "—"} {line.units || "in"}</text>
    <text x="150" y={height + 66} fill="#486475" fontSize="12" textAnchor="middle">{line.width || "—"} × {line.height || "—"} {line.units || "in"} · {line.dimension_basis || "call"}</text>
  </svg>;
}
