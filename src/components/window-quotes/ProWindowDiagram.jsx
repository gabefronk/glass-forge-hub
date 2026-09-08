// Window Quote Pro's reusable style illustration. Not a fabrication drawing.
export default function WindowDiagram({ code, size = 80, gridPattern = "None", width = 0, height = 0, handing = null, forQuoteThumbnail = false }) {
  // Shared thumbnail frame sizing (76x104)
  const maxFrameWidth = 76;
  const maxFrameHeight = 104;
  
  // Calculate aspect ratio from actual dimensions
  const unitWidth = width > 0 ? width : 36;
  const unitHeight = height > 0 ? height : 60;
  const aspectRatio = unitWidth / unitHeight;
  
  // Calculate rendered size based on aspect ratio
  let renderWidth = maxFrameWidth;
  let renderHeight = renderWidth / aspectRatio;
  
  if (renderHeight > maxFrameHeight) {
    renderHeight = maxFrameHeight;
    renderWidth = renderHeight * aspectRatio;
  }
  
  // For non-thumbnail views
  let svgWidth = forQuoteThumbnail ? renderWidth : size;
  let svgHeight = forQuoteThumbnail ? renderHeight : Math.round(size * 1.4);
  
  if (!forQuoteThumbnail && width > 0 && height > 0) {
    const unitAspectRatio = height / width;
    svgHeight = Math.round(size * unitAspectRatio);
  }
  
  const F = 4;   // outer frame inset
  const S = 3;   // sash inset from frame
  const frame = "#1e293b";
  const sash  = "#334155";
  const dash  = "#334155";

  // Frame rect
  const fx1 = F, fy1 = F, fx2 = svgWidth - F, fy2 = svgHeight - F;
  // Sash rect (inside frame)
  const sx1 = fx1 + S, sy1 = fy1 + S, sx2 = fx2 - S, sy2 = fy2 - S;
  const sw = sx2 - sx1, sh = sy2 - sy1;
  const scx = sx1 + sw / 2, scy = sy1 + sh / 2;

  // Mirror the SVG for Left Hand handing
  const shouldFlip = handing === "Left Hand";
  
  return (
    <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} fill="none" strokeLinecap="round" strokeLinejoin="round"
      style={{ 
        width: `${svgWidth}px`, 
        height: `${svgHeight}px`, 
        display: "block",
        background: "white",
        transform: shouldFlip ? "scaleX(-1)" : "none"
      }}>

      {/* Frame */}
      <rect x={fx1} y={fy1} width={fx2 - fx1} height={fy2 - fy1} stroke={frame} strokeWidth="4" />

      {/* Glass (white) */}
      <rect x={sx1} y={sy1} width={sw} height={sh} fill="white" stroke={sash} strokeWidth="1" />

      {/* ── Double Hung ─── */}
      {(code === "DH" || code === "DH3") && <>
        <line x1={sx1} y1={scy} x2={sx2} y2={scy} stroke={sash} strokeWidth="1.5" />
      </>}

      {/* ── Single Hung ─── */}
      {code === "SH" && <>
        <line x1={sx1} y1={scy} x2={sx2} y2={scy} stroke={sash} strokeWidth="1.5" />
      </>}

      {/* ── Casement LH: hinge LEFT, dashes from right corners → left center ── */}
      {(code === "LH" || code === "LHP") && <>
        <line x1={sx2} y1={sy1} x2={sx1} y2={scy} stroke={dash} strokeWidth="1.5" strokeDasharray="5,3" />
        <line x1={sx2} y1={sy2} x2={sx1} y2={scy} stroke={dash} strokeWidth="1.5" strokeDasharray="5,3" />
      </>}

      {/* ── Casement RH: hinge RIGHT, dashes from left corners → right center ── */}
      {(code === "RH" || code === "RHP") && <>
        <line x1={sx1} y1={sy1} x2={sx2} y2={scy} stroke={dash} strokeWidth="1.5" strokeDasharray="5,3" />
        <line x1={sx1} y1={sy2} x2={sx2} y2={scy} stroke={dash} strokeWidth="1.5" strokeDasharray="5,3" />
      </>}

      {/* ── Fixed / Picture: X cross ── */}
      {(code === "FCL" || code === "FX") && <>
        <line x1={sx1} y1={sy1} x2={sx2} y2={sy2} stroke={dash} strokeWidth="1" strokeDasharray="4,3" />
        <line x1={sx2} y1={sy1} x2={sx1} y2={sy2} stroke={dash} strokeWidth="1" strokeDasharray="4,3" />
      </>}

      {/* ── Awning: hinge TOP, dashes from bottom corners → top center ── */}
      {(code === "AW" || code === "AW2") && <>
        <line x1={sx1} y1={sy2} x2={scx} y2={sy1} stroke={dash} strokeWidth="1.5" strokeDasharray="5,3" />
        <line x1={sx2} y1={sy2} x2={scx} y2={sy1} stroke={dash} strokeWidth="1.5" strokeDasharray="5,3" />
      </>}

      {/* ── Gliding XO: left slides, right fixed ── */}
      {(code === "XO" || code === "XO2") && <>
        <line x1={scx} y1={sy1} x2={scx} y2={sy2} stroke={sash} strokeWidth="1.5" />
        <line x1={sx1} y1={sy1} x2={scx} y2={sy2} stroke={dash} strokeWidth="1" strokeDasharray="4,3" />
        <line x1={sx1} y1={sy2} x2={scx} y2={sy1} stroke={dash} strokeWidth="1" strokeDasharray="4,3" />
      </>}

      {/* ── Gliding OX: right slides, left fixed ── */}
      {(code === "OX" || code === "OX2") && <>
        <line x1={scx} y1={sy1} x2={scx} y2={sy2} stroke={sash} strokeWidth="1.5" />
        <line x1={scx} y1={sy1} x2={sx2} y2={sy2} stroke={dash} strokeWidth="1" strokeDasharray="4,3" />
        <line x1={scx} y1={sy2} x2={sx2} y2={sy1} stroke={dash} strokeWidth="1" strokeDasharray="4,3" />
      </>}

      {/* ── 3-panel / Bay / Bow ── */}
      {(code === "XOX" || code === "MSL3" || code === "MSL" || code === "BAY3" || code === "BOW3" || code === "BOW4" || code === "BOW5") && <>
        <line x1={sx1 + Math.round(sw / 3)} y1={sy1} x2={sx1 + Math.round(sw / 3)} y2={sy2} stroke={sash} strokeWidth="1.5" />
        <line x1={sx1 + Math.round(2 * sw / 3)} y1={sy1} x2={sx1 + Math.round(2 * sw / 3)} y2={sy2} stroke={sash} strokeWidth="1.5" />
      </>}

      {/* ── Door ── */}
      {(code === "SD" || code === "SDSL") && <>
        <circle cx={sx2 - 7} cy={scy} r="2.5" fill={sash} />
        <line x1={sx1 + 3} y1={sy1 + sh * 0.1} x2={sx1 + 3} y2={sy1 + sh * 0.9} stroke={dash} strokeWidth="1" strokeDasharray="3,2" />
      </>}

      {/* ── Grid Overlay ── */}
      {gridPattern && gridPattern !== "None" && (() => {
        if (gridPattern === "Colonial") {
          const lines = [];
          for (let i = 1; i <= 2; i++) lines.push(<line key={`v${i}`} x1={sx1 + (sw / 3) * i} y1={sy1} x2={sx1 + (sw / 3) * i} y2={sy2} strokeWidth="1.5" stroke={sash} />);
          for (let i = 1; i <= 2; i++) lines.push(<line key={`h${i}`} x1={sx1} y1={sy1 + (sh / 3) * i} x2={sx2} y2={sy1 + (sh / 3) * i} strokeWidth="1.5" stroke={sash} />);
          return lines;
        }
        if (gridPattern === "Prairie") {
          const ins = Math.min(sw, sh) * 0.22;
          return [<rect key="pr" x={sx1 + ins} y={sy1 + ins} width={sw - ins * 2} height={sh - ins * 2} strokeWidth="1.5" stroke={sash} fill="none" />];
        }
        if (gridPattern === "Diamond") {
          return [
            <line key="d1" x1={sx1} y1={scy} x2={scx} y2={sy1} strokeWidth="1.2" stroke={sash} />,
            <line key="d2" x1={scx} y1={sy1} x2={sx2} y2={scy} strokeWidth="1.2" stroke={sash} />,
            <line key="d3" x1={sx2} y1={scy} x2={scx} y2={sy2} strokeWidth="1.2" stroke={sash} />,
            <line key="d4" x1={scx} y1={sy2} x2={sx1} y2={scy} strokeWidth="1.2" stroke={sash} />,
          ];
        }
        return [
          <line key="cv" x1={scx} y1={sy1} x2={scx} y2={sy2} strokeWidth="1.5" stroke={sash} />,
          <line key="ch" x1={sx1} y1={scy} x2={sx2} y2={scy} strokeWidth="1.5" stroke={sash} />,
        ];
      })()}
    </svg>
  );
}
