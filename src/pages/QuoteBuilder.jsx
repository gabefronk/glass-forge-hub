import { useMemo, useState } from "react";
import { Plus, Trash2, Calculator, Save, Loader2 } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const DEBRIS_OPTIONS = ["None", "Inside", "Outside", "Both"];

const emptyForm = {
  vendor: "AMSCO",
  product_or_series: "",
  width_inches: "",
  height_inches: "",
  qty: 1,
  ext_color: "White",
  description: "",
  tempered: false,
  debris: "None",
  grille_igai: 0,
};

function confidenceBadge(conf) {
  const map = {
    high: { bg: "var(--ready-bg)", color: "var(--ready)", label: "High" },
    medium: { bg: "var(--review-bg)", color: "var(--review)", label: "Medium" },
    low: { bg: "var(--error-bg)", color: "var(--error)", label: "Low" },
  };
  const s = map[conf] || { bg: "var(--muted)", color: "var(--muted-foreground)", label: conf || "—" };
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap" style={{ backgroundColor: s.bg, color: s.color }}>
      {s.label}
    </span>
  );
}

function money(n) {
  if (n == null || Number.isNaN(n)) return "—";
  return `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function QuoteBuilder() {
  const [form, setForm] = useState(emptyForm);
  const [lines, setLines] = useState([]);
  const [pricing, setPricing] = useState(null);
  const [pricingBusy, setPricingBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [error, setError] = useState("");

  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const canAddLine = useMemo(() => {
    return (
      form.vendor &&
      String(form.product_or_series).trim() &&
      Number(form.width_inches) > 0 &&
      Number(form.height_inches) > 0 &&
      Number(form.qty) > 0
    );
  }, [form]);

  const handleAddLine = () => {
    if (!canAddLine) return;
    setLines((prev) => [
      ...prev,
      {
        id: `ln-${Date.now()}-${prev.length}`,
        vendor: form.vendor,
        product_or_series: String(form.product_or_series).trim(),
        width_inches: Number(form.width_inches),
        height_inches: Number(form.height_inches),
        qty: Number(form.qty) || 1,
        ext_color: form.ext_color || "White",
        description: form.description || "",
        tempered: !!form.tempered,
        debris: form.debris || "None",
        grille_igai: Number(form.grille_igai) || 0,
      },
    ]);
    setForm((f) => ({ ...emptyForm, vendor: f.vendor }));
  };

  const handleDeleteLine = (id) => {
    setLines((prev) => prev.filter((l) => l.id !== id));
    setPricing(null);
    setError("");
  };

  const buildPayload = () =>
    lines.map((l) => {
      const base = {
        vendor: l.vendor,
        description: l.description,
        width: l.width_inches,
        height: l.height_inches,
        qty: l.qty,
        ext_color: l.ext_color,
        tempered: l.tempered,
        debris: l.debris,
        grille_igai: l.grille_igai,
      };
      if (l.vendor === "AMSCO") base.product = l.product_or_series;
      else base.series = l.product_or_series;
      return base;
    });

  const handlePrice = async () => {
    if (!lines.length) return;
    setPricingBusy(true);
    setError("");
    setSaveMsg("");
    try {
      const res = await base44.functions.invoke("quoteEngine", { lines: buildPayload() });
      const data = res?.data || {};
      if (data.ok === false) throw new Error(data.error || "quoteEngine failed");
      setPricing(data.results || []);
    } catch (e) {
      setError(e?.message || "Pricing failed.");
      setPricing(null);
    } finally {
      setPricingBusy(false);
    }
  };

  const priced = pricing || [];
  const totalList = priced.reduce((s, r) => {
    const v = r.pricing?.line_list ?? r.pricing?.line_list_estimated ?? 0;
    return s + (Number(v) || 0);
  }, 0);
  const hasPriced = priced.length > 0;

  const handleSaveDraft = async () => {
    if (!hasPriced) return;
    setSaving(true);
    setSaveMsg("");
    setError("");
    try {
      const me = await base44.auth.me().catch(() => null);
      const email = me?.email || "quote-builder";
      const now = new Date();
      const request_id = `qe-${now.getTime()}`;
      const title = `Quote Builder draft (${now.toLocaleDateString("en-US")})`;
      await base44.entities.QuoteRequests.create({
        request_id,
        title,
        requester_email: email,
        worker_status: "draft",
        sales_status: "open",
        input_revision: 1,
        state_version: 0,
        source: { type: "quote_engine" },
        lines,
        result: { ok: true, results: priced },
      });
      setSaveMsg(`Saved as draft ${request_id}.`);
    } catch (e) {
      setError(`Save failed: ${e?.message || "unknown error"}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-[1100px] px-5 sm:px-6 lg:px-8 py-6 pb-24">
      <div className="mb-5">
        <h1 className="font-heading text-[26px] font-semibold leading-tight" style={{ color: "var(--foreground)", letterSpacing: "-0.02em" }}>Quote Builder</h1>
        <p className="text-[13px] mt-1" style={{ color: "var(--muted-foreground)" }}>Window &amp; door quoting worksheet. Lines are held on this page until you save a draft.</p>
      </div>

      {/* Line entry form */}
      <div className="rounded-[12px] p-4 mb-5" style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", boxShadow: "0 1px 2px rgba(24,36,34,.04), 0 4px 12px -8px rgba(24,36,34,.10)" }}>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          <div className="col-span-1">
            <Label className="text-[12px] mb-1" style={{ color: "var(--muted-foreground)" }}>Vendor</Label>
            <Select value={form.vendor} onValueChange={(v) => setField("vendor", v)}>
              <SelectTrigger className="h-9 text-[13px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="AMSCO">AMSCO</SelectItem>
                <SelectItem value="Pella">Pella</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-1 sm:col-span-2 lg:col-span-2">
            <Label className="text-[12px] mb-1" style={{ color: "var(--muted-foreground)" }}>{form.vendor === "AMSCO" ? "Product / series" : "Series"}</Label>
            <Input value={form.product_or_series} onChange={(e) => setField("product_or_series", e.target.value)} placeholder={form.vendor === "AMSCO" ? "e.g. Studio" : "e.g. 250 Series"} className="h-9 text-[13px]" />
          </div>
          <div className="col-span-1">
            <Label className="text-[12px] mb-1" style={{ color: "var(--muted-foreground)" }}>Width (in)</Label>
            <Input type="number" value={form.width_inches} onChange={(e) => setField("width_inches", e.target.value)} placeholder="0" className="h-9 text-[13px]" />
          </div>
          <div className="col-span-1">
            <Label className="text-[12px] mb-1" style={{ color: "var(--muted-foreground)" }}>Height (in)</Label>
            <Input type="number" value={form.height_inches} onChange={(e) => setField("height_inches", e.target.value)} placeholder="0" className="h-9 text-[13px]" />
          </div>
          <div className="col-span-1">
            <Label className="text-[12px] mb-1" style={{ color: "var(--muted-foreground)" }}>Qty</Label>
            <Input type="number" value={form.qty} onChange={(e) => setField("qty", e.target.value)} placeholder="1" className="h-9 text-[13px]" />
          </div>
          <div className="col-span-1">
            <Label className="text-[12px] mb-1" style={{ color: "var(--muted-foreground)" }}>Ext. color</Label>
            <Input value={form.ext_color} onChange={(e) => setField("ext_color", e.target.value)} placeholder="White" className="h-9 text-[13px]" />
          </div>
          <div className="col-span-1">
            <Label className="text-[12px] mb-1" style={{ color: "var(--muted-foreground)" }}>Debris</Label>
            <Select value={form.debris} onValueChange={(v) => setField("debris", v)}>
              <SelectTrigger className="h-9 text-[13px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {DEBRIS_OPTIONS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-1">
            <Label className="text-[12px] mb-1" style={{ color: "var(--muted-foreground)" }}>Grille IGAI</Label>
            <Input type="number" value={form.grille_igai} onChange={(e) => setField("grille_igai", e.target.value)} placeholder="0" className="h-9 text-[13px]" />
          </div>
          <div className="col-span-2 sm:col-span-3 lg:col-span-2">
            <Label className="text-[12px] mb-1" style={{ color: "var(--muted-foreground)" }}>Description (Pella)</Label>
            <Input value={form.description} onChange={(e) => setField("description", e.target.value)} placeholder="Configuration / option notes" className="h-9 text-[13px]" />
          </div>
          <div className="col-span-1 flex items-end gap-2 pb-0.5">
            <Checkbox id="tempered" checked={form.tempered} onCheckedChange={(v) => setField("tempered", !!v)} className="h-4 w-4" />
            <Label htmlFor="tempered" className="text-[13px] cursor-pointer" style={{ color: "var(--foreground)" }}>Tempered</Label>
          </div>
          <div className="col-span-1 flex items-end">
            <Button onClick={handleAddLine} disabled={!canAddLine} className="h-9 w-full text-[13px]">
              <Plus className="h-4 w-4 mr-1" />Add line
            </Button>
          </div>
        </div>
      </div>

      {/* Lines table */}
      <div className="rounded-[12px] overflow-hidden mb-5" style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", boxShadow: "0 1px 2px rgba(24,36,34,.04), 0 4px 12px -8px rgba(24,36,34,.10)" }}>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr style={{ backgroundColor: "var(--muted)", color: "var(--muted-foreground)" }}>
                <th className="text-left font-semibold px-3 py-2 whitespace-nowrap">Vendor</th>
                <th className="text-left font-semibold px-3 py-2 whitespace-nowrap">Product / Series</th>
                <th className="text-right font-semibold px-3 py-2 whitespace-nowrap">W×H</th>
                <th className="text-right font-semibold px-3 py-2 whitespace-nowrap">Qty</th>
                <th className="text-left font-semibold px-3 py-2 whitespace-nowrap">Color</th>
                <th className="text-left font-semibold px-3 py-2 whitespace-nowrap">Options</th>
                <th className="text-right font-semibold px-3 py-2 whitespace-nowrap">Delete</th>
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-8 text-[13px]" style={{ color: "var(--muted-foreground)" }}>No lines yet. Add one above.</td>
                </tr>
              ) : (
                lines.map((l) => (
                  <tr key={l.id} style={{ borderTop: "1px solid var(--border)" }}>
                    <td className="px-3 py-2 whitespace-nowrap">{l.vendor}</td>
                    <td className="px-3 py-2">{l.product_or_series}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap font-mono-num">{l.width_inches}×{l.height_inches}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">{l.qty}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{l.ext_color}</td>
                    <td className="px-3 py-2 text-[12px]" style={{ color: "var(--muted-foreground)" }}>
                      {[
                        l.tempered ? "Tempered" : null,
                        l.debris && l.debris !== "None" ? `Debris ${l.debris}` : null,
                        Number(l.grille_igai) ? `Grille ${l.grille_igai}` : null,
                      ].filter(Boolean).join(" · ") || "—"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button onClick={() => handleDeleteLine(l.id)} className="inline-flex items-center justify-center h-7 w-7 rounded-md transition-colors" style={{ color: "var(--destructive)" }} aria-label="Delete line">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <Button onClick={handlePrice} disabled={!lines.length || pricingBusy} className="h-9 text-[13px]">
          {pricingBusy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Calculator className="h-4 w-4 mr-1" />}
          Price quote
        </Button>
        <Button onClick={handleSaveDraft} disabled={!hasPriced || saving} variant="outline" className="h-9 text-[13px]">
          {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
          Save as draft
        </Button>
        {saveMsg && <span className="text-[12px]" style={{ color: "var(--ready)" }}>{saveMsg}</span>}
        {error && <span className="text-[12px] break-words" style={{ color: "var(--destructive)" }}>{error}</span>}
      </div>

      {/* Priced results */}
      {hasPriced && (
        <div className="rounded-[12px] overflow-hidden" style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", boxShadow: "0 1px 2px rgba(24,36,34,.04), 0 4px 12px -8px rgba(24,36,34,.10)" }}>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr style={{ backgroundColor: "var(--muted)", color: "var(--muted-foreground)" }}>
                  <th className="text-left font-semibold px-3 py-2 whitespace-nowrap">Vendor</th>
                  <th className="text-left font-semibold px-3 py-2 whitespace-nowrap">Dims</th>
                  <th className="text-right font-semibold px-3 py-2 whitespace-nowrap">Qty</th>
                  <th className="text-right font-semibold px-3 py-2 whitespace-nowrap">Unit list</th>
                  <th className="text-right font-semibold px-3 py-2 whitespace-nowrap">Unit dealer</th>
                  <th className="text-right font-semibold px-3 py-2 whitespace-nowrap">Line list</th>
                  <th className="text-left font-semibold px-3 py-2 whitespace-nowrap">Confidence</th>
                  <th className="text-left font-semibold px-3 py-2 whitespace-nowrap">Evidence</th>
                </tr>
              </thead>
              <tbody>
                {priced.map((r, i) => {
                  const p = r.pricing || {};
                  const unitList = p.unit_list ?? p.unit_list_estimated;
                  const lineList = p.line_list ?? p.line_list_estimated;
                  return (
                    <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
                      <td className="px-3 py-2 align-top whitespace-nowrap">{p.vendor || r.vendor}</td>
                      <td className="px-3 py-2 align-top whitespace-nowrap font-mono-num">{r.width}×{r.height}</td>
                      <td className="px-3 py-2 align-top text-right whitespace-nowrap">{r.qty}</td>
                      <td className="px-3 py-2 align-top text-right whitespace-nowrap font-mono-num">{money(unitList)}{p.estimated ? "*" : ""}</td>
                      <td className="px-3 py-2 align-top text-right whitespace-nowrap font-mono-num">{p.unit_dealer != null ? money(p.unit_dealer) : "—"}</td>
                      <td className="px-3 py-2 align-top text-right whitespace-nowrap font-mono-num-bold">{money(lineList)}</td>
                      <td className="px-3 py-2 align-top">{p.error ? <span className="text-[12px]" style={{ color: "var(--destructive)" }}>{p.error}</span> : confidenceBadge(p.confidence)}</td>
                      <td className="px-3 py-2 align-top text-[12px]" style={{ color: "var(--muted-foreground)" }}>{p.evidence || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: "2px solid var(--border)", backgroundColor: "var(--muted)" }}>
                  <td colSpan={5} className="px-3 py-2 text-right font-semibold" style={{ color: "var(--foreground)" }}>Total line list</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap font-mono-num-bold" style={{ color: "var(--foreground)" }}>{money(totalList)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
          {/* Per-line notes (anchor conflicts) */}
          {priced.some((r) => r.pricing?.anchor_conflict) && (
            <div className="px-3 py-2 space-y-1" style={{ borderTop: "1px solid var(--border)" }}>
              {priced.map((r, i) => {
                const c = r.pricing?.anchor_conflict;
                if (!c) return null;
                return (
                  <div key={i} className="text-[12px] break-words" style={{ color: "var(--review)" }}>
                    Line {i + 1} ({r.width}×{r.height}): {c.note} (range {money(c.min)}–{money(c.max)}, {c.count} anchors)
                  </div>
                );
              })}
            </div>
          )}
          {priced.some((r) => r.pricing?.estimated) && (
            <div className="px-3 py-2 text-[11px]" style={{ borderTop: "1px solid var(--border)", color: "var(--muted-foreground)" }}>
              * Estimated by interpolation from the nearest empirical anchor.
            </div>
          )}
        </div>
      )}
    </div>
  );
}