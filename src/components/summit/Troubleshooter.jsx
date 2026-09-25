import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, RotateCcw, CheckCircle2, Phone } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { C } from "@/lib/feeUI";
import NodeMetaPanel from "./NodeMetaPanel";
import PhotoSlot from "./PhotoSlot";
import DiagramSlot from "./DiagramSlot";
import { SUMMIT_CARD_SHADOW, SUMMIT_META, diagramKeyForSystemType } from "./summitData";

const SYSTEM_TYPES = ["Multi-slide", "Bi-parting", "Pocketing", "Stacking", "Pivot", "90-Degree Cornerless", "Lift & Slide", "Tilt-Up Awning Window", "Not sure"];
const MOTORS = ["Peak", "Sierra", "Everest", "Tahoe", "Not sure"];
const CONTROLS = ["3-in-1 buttons", "6-in-1 buttons", "9-in-1 touchscreen", "12-in-1 touchscreen", "RF fob only", "Not sure"];

const CONTEXT_STEPS = [
  { key: "system_type", title: "What system are you working on?", prompt: "Pick the door or system type. Not sure skips this filter.", options: SYSTEM_TYPES },
  { key: "motor", title: "Which motor is it?", prompt: "Pick the motor model if you can see it. Not sure skips this filter.", options: MOTORS },
  { key: "control_type", title: "What's on the wall?", prompt: "Pick the wall control you're using. Not sure skips this filter.", options: CONTROLS },
];

// Real-hardware photo on relevant nodes (wiring / sensor / touchscreen reference).
const NODE_PHOTOS = {
  wiring_chain: "motor_hub_ports",
  blink3_encoder: "motor_hub_ports",
  blink4_motion: "motion_sensor",
  mech_check: "motion_sensor",
  ts_dead: "touchscreen",
};

const PHONE = SUMMIT_META.summit_tech_phone;

const SYMPTOM_LABELS = {
  door_symptom: "Sliding door (button keypad)",
  ts_symptom: "Sliding door (12-in-1 touchscreen)",
  awn_symptom: "Awning / tilt-up window",
  call_summit_general: "Pivot — call Summit",
};

function ProvenanceBadge({ source }) {
  if (!source) return null;
  const s = source.toLowerCase();
  let tone = "factory";
  if (s.includes("field_verified")) tone = "field";
  else if (s.includes("unconfirmed")) tone = "amber";
  const styles = {
    factory: { bg: C.accent18, text: C.accentText, border: C.border },
    field: { bg: C.tagBillable.bg, text: C.tagBillable.text, border: C.tagBillable.border },
    amber: { bg: C.amberLight, text: C.amber, border: C.borderStrong },
  };
  const st = styles[tone];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium mt-2 break-words"
      style={{ border: `1px solid ${st.border}`, backgroundColor: st.bg, color: st.text }}
    >
      <span className="font-mono uppercase tracking-[0.08em] text-[9.5px]" style={{ opacity: 0.7 }}>Source</span>
      {source}
    </span>
  );
}

export default function Troubleshooter() {
  const [nodes, setNodes] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [ctxStep, setCtxStep] = useState(0); // 0..2 context, 3 = in tree
  const [context, setContext] = useState({ system_type: "", motor: "", control_type: "" });
  const [path, setPath] = useState([]); // stack of node_ids (tree only)
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

  const inTree = ctxStep >= 3;
  const current = inTree ? (path.length ? byId.get(path[path.length - 1]) : null) : null;

  const routeStart = () => {
    if (context.system_type === "Pivot") return "call_summit_general";
    if (context.system_type === "Tilt-Up Awning Window") return "awn_symptom";
    if (context.control_type === "12-in-1 touchscreen") return "ts_symptom";
    return "door_symptom";
  };

  const startFresh = () => {
    setContext({ system_type: "", motor: "", control_type: "" });
    setCtxStep(0);
    setPath([]);
    setNotes("");
    setTechSupportAnswer("");
    setSavedMsg("");
  };

  // Enter the tree once context is done.
  useEffect(() => {
    if (inTree && path.length === 0) setPath([routeStart()]);
  }, [inTree]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const choose = (nextId) => {
    if (!nextId) return;
    setPath((p) => [...p, nextId]);
    setNotes("");
    setTechSupportAnswer("");
    setSavedMsg("");
  };
  const back = () => setPath((p) => p.slice(0, -1));
  const restart = startFresh;

  const logSession = async (resolution, answer = "") => {
    setSaving(true);
    setSavedMsg("");
    try {
      await base44.entities.TroubleshootSession.create({
        system_type: context.system_type || "",
        motor: context.motor || "",
        control_type: context.control_type || "",
        symptom: SYMPTOM_LABELS[path[0]] || path[0] || "",
        node_path: path,
        resolution,
        notes: notes.trim(),
        tech_support_answer: answer.trim(),
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

  const nodePhotoKey = inTree && current ? NODE_PHOTOS[current.node_id] : null;
  const headerDiagramKey = inTree && path.length === 1 ? diagramKeyForSystemType(context.system_type) : null;

  const renderOptions = (opts) => opts && opts.length > 0 && (
    <div className="mt-4 flex flex-col gap-2.5">
      {opts.map((opt, i) => (
        <button
          key={i}
          onClick={() => choose(opt.next)}
          className="flex items-center justify-between gap-3 rounded-[12px] px-4 min-h-[56px] text-left transition-colors"
          style={{ border: `1px solid ${C.border}`, backgroundColor: C.cardAlt, color: C.text }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = C.rowHover)}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = C.cardAlt)}
        >
          <span className="text-[15px] font-medium leading-snug">{opt.label}</span>
          <ArrowLeft className="h-4 w-4 shrink-0 rotate-180" style={{ color: C.textMuted }} />
        </button>
      ))}
    </div>
  );

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

      {/* Context chips */}
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

      {/* Context selection screens */}
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
                const dKey = step.key === "system_type" ? diagramKeyForSystemType(opt) : null;
                return (
                  <button
                    key={opt}
                    onClick={() => pickContext(step.key, opt)}
                    className="flex items-center gap-3 rounded-[12px] px-3 min-h-[56px] text-left transition-colors"
                    style={{ border: `1px solid ${active ? C.accent : C.border}`, backgroundColor: active ? C.accent18 : C.cardAlt, color: C.text }}
                    onMouseEnter={(e) => { if (!active) e.currentTarget.style.backgroundColor = C.rowHover; }}
                    onMouseLeave={(e) => { if (!active) e.currentTarget.style.backgroundColor = C.cardAlt; }}
                  >
                    {step.key === "system_type" && <DiagramSlot variant="thumb" diagramKey={dKey} />}
                    <span className="text-[15px] font-medium leading-snug flex-1">{opt}</span>
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
          {headerDiagramKey && (
            <DiagramSlot diagramKey={headerDiagramKey} />
          )}

          <div className="rounded-[14px] p-5" style={{ border: `1px solid ${C.border}`, backgroundColor: C.card, boxShadow: SUMMIT_CARD_SHADOW }}>
            {/* question */}
            {current.type === "question" && (
              <>
                <h3 className="font-heading text-[19px] font-bold leading-tight" style={{ color: C.text, letterSpacing: "-0.02em" }}>{current.text}</h3>
                <ProvenanceBadge source={current.source} />
                {renderOptions(current.options)}
              </>
            )}

            {/* steps */}
            {current.type === "steps" && (
              <>
                <h3 className="font-heading text-[19px] font-bold leading-tight" style={{ color: C.text, letterSpacing: "-0.02em" }}>{current.title}</h3>
                <ProvenanceBadge source={current.source} />
                {current.steps && current.steps.length > 0 && (
                  <ol className="mt-4 space-y-2">
                    {current.steps.map((step, i) => (
                      <li key={i} className="flex gap-2.5">
                        <span className="flex items-center justify-center rounded-full font-mono-num text-[12px] font-bold shrink-0" style={{ width: "22px", height: "22px", backgroundColor: C.accent, color: C.accentDark }}>{i + 1}</span>
                        <span className="text-[14px] leading-snug pt-0.5" style={{ color: C.text }}>{step}</span>
                      </li>
                    ))}
                  </ol>
                )}
                {current.question && (
                  <p className="text-[15px] font-semibold mt-4 leading-snug" style={{ color: C.text }}>{current.question}</p>
                )}
                {renderOptions(current.options)}
              </>
            )}

            {/* info */}
            {current.type === "info" && (
              <>
                <h3 className="font-heading text-[19px] font-bold leading-tight" style={{ color: C.text, letterSpacing: "-0.02em" }}>{current.title}</h3>
                <ProvenanceBadge source={current.source} />
                {current.text && <p className="text-[14px] mt-2 leading-snug" style={{ color: C.textSecondary }}>{current.text}</p>}
                {renderOptions(current.options)}
              </>
            )}

            {/* resolved */}
            {current.type === "resolved" && (
              <div className="flex flex-col gap-4">
                <div className="flex items-center gap-2.5">
                  <CheckCircle2 className="h-6 w-6 shrink-0" style={{ color: C.accent }} />
                  <h3 className="font-heading text-[19px] font-bold leading-tight" style={{ color: C.text, letterSpacing: "-0.02em" }}>{current.resolution}</h3>
                </div>
                {current.log_prompt && (
                  <div className="rounded-[10px] px-4 py-3" style={{ border: `1px solid ${C.tagBillable.border}`, backgroundColor: C.tagBillable.bg }}>
                    <div className="font-mono text-[10px] font-bold uppercase tracking-[0.13em] mb-1" style={{ color: C.tagBillable.text }}>Log it</div>
                    <p className="text-[13.5px] leading-snug" style={{ color: C.text }}>{current.log_prompt}</p>
                  </div>
                )}
              </div>
            )}

            {/* call */}
            {current.type === "call" && (
              <div className="flex flex-col gap-4">
                <div className="flex items-center gap-2.5">
                  <Phone className="h-6 w-6 shrink-0" style={{ color: C.amber }} />
                  <h3 className="font-heading text-[19px] font-bold leading-tight" style={{ color: C.text, letterSpacing: "-0.02em" }}>Call Summit tech support</h3>
                </div>
                {current.script && (
                  <div className="rounded-[10px] px-4 py-3.5" style={{ border: `1px solid ${C.border}`, backgroundColor: C.cardAlt }}>
                    <div className="font-mono text-[10px] font-bold uppercase tracking-[0.13em] mb-1.5" style={{ color: C.textMuted }}>Read this to Summit</div>
                    <p className="text-[13.5px] leading-snug" style={{ color: C.text }}>{current.script}</p>
                  </div>
                )}
                <a
                  href={`tel:${PHONE}`}
                  className="inline-flex items-center justify-center gap-2 rounded-full min-h-[52px] px-5 text-[15px] font-semibold"
                  style={{ backgroundColor: C.accent, color: C.accentDark }}
                >
                  <Phone className="h-4 w-4" /> Call {PHONE}
                </a>
              </div>
            )}

            {/* Node photo (wiring / sensor / touchscreen reference) */}
            {nodePhotoKey && (current.type === "steps" || current.type === "question" || current.type === "info") && (
              <div className="mt-4">
                <PhotoSlot photoKey={nodePhotoKey} />
              </div>
            )}

            {/* Reference panel — on question / steps / info nodes */}
            <NodeMetaPanel node={current} />
          </div>

          {/* Session log — at resolved / call nodes */}
          {(current.type === "resolved" || current.type === "call") && (
            <div className="rounded-[14px] p-5" style={{ border: `1px solid ${C.border}`, backgroundColor: C.card, boxShadow: SUMMIT_CARD_SHADOW }}>
              <h4 className="font-heading text-[15px] font-bold" style={{ color: C.text }}>
                {current.type === "call" ? "Record Summit's answer" : "Log this walkthrough"}
              </h4>
              <p className="text-[12px] mt-0.5" style={{ color: C.textMuted }}>
                {current.type === "call" ? "Paste the exact answer from tech support." : "Records the path taken so the team can spot recurring faults."}
              </p>

              <div className="mt-3 flex flex-col gap-3">
                {current.type === "call" ? (
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[12px] font-medium" style={{ color: C.textSecondary }}>Summit tech support answer (verbatim)</span>
                    <textarea
                      value={techSupportAnswer}
                      onChange={(e) => setTechSupportAnswer(e.target.value)}
                      rows={3}
                      placeholder="Paste the exact answer from tech support…"
                      className="rounded-[10px] px-3.5 py-2.5 text-[14px] focus:outline-none"
                      style={{ border: `1px solid ${C.border}`, backgroundColor: C.cardAlt, color: C.text }}
                    />
                  </label>
                ) : (
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
                )}

                <button
                  onClick={() => logSession(current.type === "call" ? "Escalated to Summit" : current.resolution, current.type === "call" ? techSupportAnswer : "")}
                  disabled={saving}
                  className="inline-flex items-center justify-center gap-2 rounded-full min-h-[48px] px-5 text-[14px] font-semibold disabled:opacity-50"
                  style={{ backgroundColor: C.accent, color: C.accentDark }}
                >
                  {saving ? "Saving…" : current.type === "call" ? "Save call record" : "Save walkthrough"}
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