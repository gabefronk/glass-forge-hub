import { useState } from "react";
import { Bot } from "lucide-react";
import { agentMascotFor } from "@/lib/agentMascots";

export default function Portrait({ id }) {
  const [missing, setMissing] = useState(false);
  const mascot = agentMascotFor(id);
  if (missing) {
    return <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border border-[#DDE3EC] bg-[#172438] text-white shadow-sm"><Bot aria-label={mascot.alt} className="h-7 w-7" /></div>;
  }
  return <img src={mascot.src} alt={mascot.alt} className="h-16 w-16 shrink-0 rounded-full border border-[#DDE3EC] object-cover shadow-sm" onError={() => setMissing(true)} />;
}