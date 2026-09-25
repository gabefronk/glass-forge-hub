import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ExternalLink, RotateCcw, CheckCircle2, AlertCircle, Phone } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { C } from "@/lib/feeUI";
import NodeMetaPanel from "./NodeMetaPanel";
import PhotoSlot from "./PhotoSlot";
import { SUMMIT_CARD_SHADOW } from "./summitData";

const SYSTEM_TYPES = ["Multi-slide", "Bi-parting", "Pocketing", "Stacking", "Pivot", "90-Degree Cornerless", "Lift & Slide", "Tilt-Up Awning Window", "Not sure"];
const MOTORS = ["Peak", "Sierra", "Everest", "Tahoe", "Not sure"];
const CONTROLS = ["3-in-1 buttons", "6-in-1 buttons", "9-in-1 touchscreen", "12-in-1 touchscreen", "RF fob only", "Not sure"];

const CONTEXT_STEPS = [
  { key: "system_type", title: "What system are you working on?", prompt: "Pick the door or system type. Not sure skips this filter.", options: SYSTEM_TYPES },
  { key: "motor", title: "Which motor is it?", prompt: "Pick the motor model if you can see it. Not sure skips this filter.", options: MOTORS },
  { key: "control_type", title: "What's on the wall?", prompt: "Pick the wall control you're using. Not sure skips this filter.", options: CONTROLS },
];

// Real-hardware photo to show on a given node (wiring / sensor / control reference).
const NODE_PHOTOS = {
  peak_9in1: "motor_hub_ports",
  flashing_3: "motor_hub_ports",
  flashing_4: "motion_sensor",
  sym_reverse: "motion_sensor",
};

// Interactive decision tree driven by TroubleshootNode records.
// Starts with a 3-step system-context picker, then walks the tree.
export default function Troubleshooter() {
  const [nodes, setNodes] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [ctxStep, setCtxStep] = useState(0); // 0..2 context, 3 = in tree
  const [context, setContext] = useState({ system_type: "", motor: "", control_type: "" });
  const [path, setPath] = useState([]); // stack of node_ids (tree only)
  const [resolution, setResolution] = useState("");
  const [notes, setNotes] = useState("");
  const [techSupportAnswer, setTechSupportAnswer] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const rows = await base44.entities.TroubleshootNode.list("order", 500);
        if (!live) return;
        setNodes(rows || []);
      } catch (e) {
        if (live) setLoadError(e?.message || "Could not load troubleshooter data.");
      }
    })();
    return () => { live = false; };
  }, []);

  const byId = useMemo(() => {
    const m = new Map();
    for (const n of nodes || []) if (n.node_id) m.set(n.node_id, n);
    return m;
  }, [nodes]);

  const root = byId.get("root");
  const inTree = ctxStep >= 3;
  const current = inTree ? (path.length ? byId.get(path[path.length - 1]) : root) : null;

  const startFresh = () => {
    setContext({ system_type: "", motor: "", control_type: "" });
    setCtxStep(0);
    setPath([]);
    setResolution("");
    setNotes("");
    setTechSupportAnswer("");
    setSavedMsg("");
  };

  // Enter the tree once context is done and root is loaded.
  useEffect(() => {
    if (inTree && root && path.length === 0) setPath(["root"]);
  }, [inTree, root]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loadError) {
    return (
      <div className="rounded-[12px] p-4" style={{ border: `1px solid ${C.border}`, backgroundColor: C.card }}>
        <p className="text-[13px]" style={{ color: "#A43432" }}>{loadError}</p>
      </div>
    );
  }
  if (!nodes) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-7 h-7 border-2 rounded-full animate-spin" style={{ borderColor: C.border, borderTopColor: C.accent }} />
      </div>
    );
  }
  if (inTree && !current) {
    return (
      <div className="rounded-[12px] p-4" style={{ border: `1px solid ${C.border}`, backgroundColor: C.card }}>
        <p className="text-[13px]" style={{ color: C.textMuted }}>No troubleshooter nodes found. Seed the tree to begin.</p>
      </div>
    );
  }

  const pickContext = (key, value) => {
    setContext((c) => ({ ...c, [key]: value }));
    setCtxStep((s) => s + 1);
  };
  const ctxBack = () => setCtxStep((s) => Math.max(0, s - 1));

  // Pivot systems: blink-code table / DIP switches do not apply → escalate instead.
  const resolveOption = (opt) => {
    if (opt.next_node_id === "flashing_root" && context.system_type === "Pivot") {
      return { ...opt, next_node_id: "pivot_escalation" };
    }
    return opt;
  };

  const choose = (nextId) => {
    if (!nextId) return;
    setPath((p) => [...p, nextId]);
    setResolution("");
    setSavedMsg("");
  };

  const back = () => setPath((p) => p.slice(0, -1));
  const restart = startFresh;

  const symptom = root && path.length > 1 ? (byId.get(path[1])?.title || "") : "";

  const logSession = async (res) => {
    setSaving(true);
    setSavedMsg("");
    try {
      await base44.entities.TroubleshootSession.create({
        symptom,
        node_path: path,
        resolution: res,
        notes: notes.trim(),
        tech_support_answer: techSupportAnswer.trim(),
        system_type: context.system_type || "",
        motor: context.motor || "",
        control_type: context.control_type || "",
      });
      setSavedMsg("Walkthrough logged.");
    } catch (e) {
      setSavedMsg("Could not log walkthrough: " + (e?.message || "unknown error"));
    } finally {
      setSaving(false);
    }
  };

  const stepNum = inTree ? 3 + path.length : ctxStep + 1;
  const canGoBack = inTree ? path.length > 1 : ctxStep > 0;
  const showRestart = inTree ? path.length > 1 : ctxStep > 0;

  const chips = [
    { label: "System", value: context.system_type },
    { label: "Motor", value: context.motor },
    { label: "Control", value: context.control_type },
  ].filter((c) => c.value);

  const isTouchscreenControl = context.control_type === "9-in-1 touchscreen" || context.control_type === "12-in-1 touchscreen";
  const nodePhotoKey = inTree && current
    ? (current === root && isTouchscreenControl ? "touchscreen" : NODE_PHOTOS[current.node_id])
    : null;

  return (
    <div className="flex flex-col gap-4">
      {/* Breadcrumb / back */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {canGoBack ? (
            <button
              onClick={inTree ? back : ctxBack}
              className="inline-flex items-center gap-1.5 rounded-full px-3.5 min-h-[40px] text-[13px] font-medium"
              style={{ border: `1px solid ${C.border}`, backgroundColor: C.card, color: C.textSecondary }}
            >
              <ArrowLeft className="h-4 w-4" /> Back
            </button>
          ) : (
            <span className="text-[12px] font-mono uppercase tracking-[0.1em]" style={{ color: C.textMuted }}>Step {stepNum}</span>
          )}
        </div>
        {showRestart && (
          <button
            onClick={restart}
            className="inline-flex items-center gap-1.5 rounded-full px-3.5 min-h-[40px] text-[13px] font-medium"
            style={{ border: `1px solid ${C.border}`, backgroundColor: C.card, color: C.textSecondary }}
          >
            <RotateCcw className="h-4 w-4" /> Start over
          </button>
        )}
      </div>

      {/* Context chips — shown on every screen once a value exists */}
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <span
              key={c.label}
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-medium"
              style={{ border: `1px solid ${C.border}`, backgroundColor: C.cardAlt, color: C.textSecondary }}
            >
              <span className="font-mono uppercase tracking-[0.08em]" style={{ color: C.textMuted }}>{c.label}</span>
              <span style={{ color: C.text }}>{c.value}</span>
            </span>
          ))}
        </div>
      )}

      {/* Context selection screens (before the tree) */}
      {!inTree && (() => {
        const step = CONTEXT_STEPS[ctxStep];
        if (!step) return null;
        return (
          <div className="rounded-[14px] p-5" style={{ border: `1px solid ${C.border}`, backgroundColor: C.card, boxShadow: SUMMIT_CARD_SHADOW }}>
            <h3 className="font-heading text-[19px] font-bold leading-tight" style={{ color: C.text, letterSpacing: "-0.02em" }}>{step.title}</h3>
            {step.prompt && (
              <p className="text-[14px] mt-1.5 leading-snug" style={{ color: C.textSecondary }}>{step.prompt}</p>
            )}
            <div className="mt-3" style={{ height: 2, background: "linear-gradient(90deg, var(--gf-brass-400), transparent)", borderRadius: 2 }} />
            <div className="mt-4 flex flex-col gap-2.5">
              {step.options.map((opt) => {
                const active = context[step.key] === opt;
                return (
                  <button
                    key={opt}
                    onClick={() => pickContext(step.key, opt)}
                    className="flex items-center justify-between gap-3 rounded-[12px] px-4 min-h-[56px] text-left transition-colors"
                    style={{ border: `1px solid ${active ? C.accent : C.border}`, backgroundColor: active ? C.accent18 : C.cardAlt, color: C.text }}
                    onMouseEnter={(e) => { if (!active) e.currentTarget.style.backgroundColor = C.rowHover; }}
                    onMouseLeave={(e) => { if (!active) e.currentTarget.style.backgroundColor = C.cardAlt; }}
                  >
                    <span className="text-[15px] font-medium leading-snug">{opt}</span>
                    {active
                      ? <CheckCircle2 className="h-4 w-4 shrink-0" style={{ color: C.accent }} />
                      : <ArrowLeft className="h-4 w-4 shrink-0 rotate-180" style={{ color: C.textMuted }} />}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Tree node card */}
      {inTree && current && (
        <>
          <div className="rounded-[14px] p-5" style={{ border: `1px solid ${C.border}`, backgroundColor: C.card, boxShadow: SUMMIT_CARD_SHADOW }}>
            <h3 className="font-heading text-[19px] font-bold leading-tight" style={{ color: C.text, letterSpacing: "-0.02em" }}>{current.title}</h3>
            {current.prompt && (
              <p className="text-[14px] mt-1.5 leading-snug" style={{ color: C.textSecondary }}>{current.prompt}</p>
            )}
            <div className="mt-3" style={{ height: 2, background: "linear-gradient(90deg, var(--gf-brass-400), transparent)", borderRadius: 2 }} />
            {nodePhotoKey && (
              <div className="mt-4">
                <PhotoSlot photoKey={nodePhotoKey} />
              </div>
            )}

            {current.placeholder && (
              <div className="mt-4 rounded-[10px] px-4 py-3" style={{ border: `1px dashed ${C.borderStrong}`, backgroundColor: C.amberLight }}>
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" style={{ color: C.amber }} />
                  <span className="text-[12.5px] font-semibold" style={{ color: C.amber }}>Content coming</span>
                </div>
                <p className="text-[12.5px] mt-1.5 leading-snug" style={{ color: C.textSecondary }}>
                  {current.escalation_note || "This procedure is being finalized. Do not attempt until content is published."}
                </p>
              </div>
            )}

            {/* Branch options */}
            {current.options && current.options.length > 0 && (
              <div className="mt-4 flex flex-col gap-2.5">
                {current.options.map((opt, i) => {
                  const resolved = resolveOption(opt);
                  return (
                    <button
                      key={i}
                      onClick={() => choose(resolved.next_node_id)}
                      className="flex items-center justify-between gap-3 rounded-[12px] px-4 min-h-[56px] text-left transition-colors"
                      style={{ border: `1px solid ${C.border}`, backgroundColor: C.cardAlt, color: C.text }}
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = C.rowHover)}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = C.cardAlt)}
                    >
                      <span className="text-[15px] font-medium leading-snug">{resolved.label}</span>
                      <ArrowLeft className="h-4 w-4 shrink-0 rotate-180" style={{ color: C.textMuted }} />
                    </button>
                  );
                })}
              </div>
            )}

            {/* Leaf content */}
            {current.node_type === "leaf" && !current.placeholder && (
              <div className="mt-4 flex flex-col gap-4">
                {current.likely_cause && (
                  <div>
                    <div className="font-mono text-[10px] font-bold uppercase tracking-[0.13em] mb-1" style={{ color: C.textMuted }}>Likely cause</div>
                    <p className="text-[14px] leading-snug" style={{ color: C.text }}>{current.likely_cause}</p>
                  </div>
                )}
                {current.field_fix && current.field_fix.length > 0 && (
                  <div>
                    <div className="font-mono text-[10px] font-bold uppercase tracking-[0.13em] mb-1.5" style={{ color: C.textMuted }}>Field fix</div>
                    <ol className="space-y-2">
                      {current.field_fix.map((step, i) => (
                        <li key={i} className="flex gap-2.5">
                          <span className="flex items-center justify-center rounded-full font-mono-num text-[12px] font-bold shrink-0" style={{ width: "22px", height: "22px", backgroundColor: C.accent, color: C.accentDark }}>{i + 1}</span>
                          <span className="text-[14px] leading-snug pt-0.5" style={{ color: C.text }}>{step}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
                {current.escalation_note && (
                  <div className="rounded-[10px] px-3.5 py-3" style={{ border: `1px solid ${C.border}`, backgroundColor: C.cardAlt }}>
                    <div className="flex items-center gap-2 mb-1">
                      <Phone className="h-3.5 w-3.5" style={{ color: C.textMuted }} />
                      <span className="font-mono text-[10px] font-bold uppercase tracking-[0.13em]" style={{ color: C.textMuted }}>Escalation</span>
                    </div>
                    <p className="text-[13px] leading-snug" style={{ color: C.textSecondary }}>{current.escalation_note}</p>
                  </div>
                )}
                {current.doc_links && current.doc_links.length > 0 && (
                  <div>
                    <div className="font-mono text-[10px] font-bold uppercase tracking-[0.13em] mb-1.5" style={{ color: C.textMuted }}>Reference docs</div>
                    <div className="flex flex-col gap-2">
                      {current.doc_links.map((d, i) => (
                        <a
                          key={i}
                          href={d.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 rounded-[10px] px-3.5 min-h-[44px] text-[13px] font-medium transition-colors"
                          style={{ border: `1px solid ${C.border}`, backgroundColor: C.cardAlt, color: C.accentText }}
                        >
                          <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                          <span className="break-words">{d.label}</span>
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Meta panel — on every node */}
            <NodeMetaPanel node={current} />
          </div>

          {/* Session log — only at a leaf */}
          {current.node_type === "leaf" && (
            <div className="rounded-[14px] p-5" style={{ border: `1px solid ${C.border}`, backgroundColor: C.card, boxShadow: SUMMIT_CARD_SHADOW }}>
              <h4 className="font-heading text-[15px] font-bold" style={{ color: C.text }}>Log this walkthrough</h4>
              <p className="text-[12px] mt-0.5" style={{ color: C.textMuted }}>Records the path taken so the team can spot recurring faults.</p>

              <div className="mt-3 flex flex-col gap-3">
                <div className="flex flex-wrap gap-2">
                  {[
                    { v: "resolved", label: "Resolved", icon: CheckCircle2, color: C.accent },
                    { v: "escalated", label: "Escalated", icon: Phone, color: C.amber },
                    { v: "abandoned", label: "Abandoned", icon: AlertCircle, color: "#A43432" },
                  ].map(({ v, label, icon: Icon, color }) => {
                    const active = resolution === v;
                    return (
                      <button
                        key={v}
                        onClick={() => setResolution(v)}
                        className="inline-flex items-center gap-1.5 rounded-full px-4 min-h-[44px] text-[13px] font-semibold transition-colors"
                        style={{
                          border: `1px solid ${active ? color : C.border}`,
                          backgroundColor: active ? color : C.cardAlt,
                          color: active ? C.accentDark : C.textSecondary,
                        }}
                      >
                        <Icon className="h-4 w-4" /> {label}
                      </button>
                    );
                  })}
                </div>

                <label className="flex flex-col gap-1.5">
                  <span className="text-[12px] font-medium" style={{ color: C.textSecondary }}>Notes (optional)</span>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={3}
                    placeholder="What you found, what you tried…"
                    className="rounded-[10px] px-3.5 py-2.5 text-[14px] focus:outline-none"
                    style={{ border: `1px solid ${C.border}`, backgroundColor: C.cardAlt, color: C.text }}
                  />
                </label>

                <label className="flex flex-col gap-1.5">
                  <span className="text-[12px] font-medium" style={{ color: C.textSecondary }}>Summit tech support answer (verbatim, optional)</span>
                  <textarea
                    value={techSupportAnswer}
                    onChange={(e) => setTechSupportAnswer(e.target.value)}
                    rows={2}
                    placeholder="Paste the exact answer from tech support…"
                    className="rounded-[10px] px-3.5 py-2.5 text-[14px] focus:outline-none"
                    style={{ border: `1px solid ${C.border}`, backgroundColor: C.cardAlt, color: C.text }}
                  />
                </label>

                <button
                  onClick={() => logSession(resolution || "abandoned")}
                  disabled={!resolution || saving}
                  className="inline-flex items-center justify-center gap-2 rounded-full min-h-[48px] px-5 text-[14px] font-semibold disabled:opacity-50"
                  style={{ backgroundColor: C.accent, color: C.accentDark }}
                >
                  {saving ? "Saving…" : "Save walkthrough"}
                </button>
                {savedMsg && <p className="text-[12.5px]" style={{ color: C.textMuted }}>{savedMsg}</p>}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}