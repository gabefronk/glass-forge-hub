// Only validated numeric geometry is rendered; exported XML/SVG markup is never inserted.
export default function ImportedAmscoDrawing({drawing,label}) {
  const {width,height,paths}=drawing;
  const pad=Math.max(width,height)*.13;
  const colors={White:"#fff",Black:"#222",Gray:"#aaa",LightGreen:"#b4dbac",Red:"#e9aaaa"};
  const sorted=[...paths].sort((a,b)=>(a.layer==="glass"?-1:0)-(b.layer==="glass"?-1:0));
  return <svg role="img" aria-label={label} viewBox={[-pad,-pad,width+2*pad,height+2*pad].join(" ")} className="mx-auto max-h-64 w-full max-w-64">
    <g transform={"translate(0 "+height+") scale(1 -1)"}>{sorted.map((p,i)=>{
      const fill=colors[p.fill]||(p.layer==="glass"?"#e3f4f8":p.layer==="grille"?"#fff":"none");
      const props={points:p.points.map(pt=>pt.join(",")).join(" "),fill,stroke:"#596a74",strokeWidth:0.7,vectorEffect:"non-scaling-stroke",strokeLinejoin:"round"};
      return p.closed?<polygon key={i} {...props}/>:<polyline key={i} {...props}/>;
    })}</g>
    <path d={"M 0 "+(height+pad*.28)+" H "+width} fill="none" stroke="#657784" strokeWidth=".5" vectorEffect="non-scaling-stroke"/>
    <text x={width/2} y={height+pad*.85} fill="#486475" fontSize={pad*.42} textAnchor="middle">{width} × {height} in</text>
  </svg>;
}
