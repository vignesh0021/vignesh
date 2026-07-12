import React, { useEffect, useState } from "react";
import { TN_STANDARD, parseFeet, formatFeet, savePrefs } from "./standards.js";

// Hoisted so it isn't recreated each render (which would remount inputs and drop focus).
function Num({ label, value, onChange, step = "0.5" }) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[11px] text-slate-500">{label}</span>
      <input
        type="number" step={step} value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
        className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-amber-500 outline-none"
      />
    </label>
  );
}

// Accepts feet-inch text (10'6") or decimal; shows the parsed value as a hint.
function FeetField({ label, value, onChange }) {
  const [txt, setTxt] = useState(formatFeet(value));
  useEffect(() => setTxt(formatFeet(value)), [value]);
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[11px] text-slate-500">{label}</span>
      <input
        value={txt}
        onChange={(e) => setTxt(e.target.value)}
        onBlur={() => { const f = parseFeet(txt); if (f !== "") onChange(f); }}
        placeholder={"10'-6\""}
        className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-amber-500 outline-none"
      />
    </label>
  );
}

// The Verify & Edit gate. Extraction only produces a DRAFT; the model renders
// strictly from what the user approves here. This is what makes the output exact.
export default function SpecEditor({ spec, onApply, busy }) {
  const [draft, setDraft] = useState(spec);
  const [json, setJson] = useState("");
  const [jsonErr, setJsonErr] = useState(null);
  const [showJson, setShowJson] = useState(false);
  const [saved, setSaved] = useState(false);
  const [std, setStd] = useState(() => ({ ...TN_STANDARD }));

  useEffect(() => {
    setDraft(spec);
    setJson(JSON.stringify(spec, null, 2));
    setStd((s) => ({
      ...s,
      floor_height: spec.floor_height ?? s.floor_height,
      plinth: spec.plinth ?? s.plinth,
      parapet: spec.parapet ?? s.parapet,
      lintel: spec.lintel ?? s.lintel,
    }));
  }, [spec]);

  const setStdK = (k, v) => setStd((s) => ({ ...s, [k]: v }));

  const applyStandard = () => {
    const d = {
      ...draft,
      floor_height: std.floor_height, plinth: std.plinth,
      parapet: std.parapet, lintel: std.lintel, standard: std.id,
      floors: (draft.floors || []).map((f, i) => ({
        ...f,
        height: i === 0 ? std.stilt_height : std.floor_height,
        openings: (f.openings || []).map((o) => ({
          ...o,
          sill: o.kind === "window" ? std.window_sill
            : o.kind === "ventilator" ? std.vent_sill
            : o.kind === "door" ? 0 : o.sill,
        })),
      })),
    };
    setDraft(d);
    onApply(d);
  };

  const saveDefault = () => { savePrefs(std); setSaved(true); setTimeout(() => setSaved(false), 2000); };

  const n = (v) => (v === "" || v === null ? "" : Number(v));
  const setTop = (k, v) => setDraft((d) => ({ ...d, [k]: v }));
  const setFloor = (i, k, v) =>
    setDraft((d) => ({ ...d, floors: d.floors.map((f, j) => (j === i ? { ...f, [k]: v } : f)) }));

  const applyForm = () => { setJsonErr(null); onApply(draft); };
  const applyJson = () => {
    try { const p = JSON.parse(json); setJsonErr(null); setDraft(p); onApply(p); }
    catch (e) { setJsonErr(e.message); }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800">
        <b>Review every number.</b> The 3D model and all views are built <i>only</i> from the values
        below — nothing is inferred by AI at render time. Correct anything the extractor got wrong,
        set the real storey heights (plans have no vertical dimensions), then press
        <b> Apply &amp; re-render</b>.
      </div>

      {/* building-level */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <label className="flex flex-col gap-0.5 col-span-2 sm:col-span-1">
          <span className="text-[11px] text-slate-500">Project</span>
          <input value={draft.project || ""} onChange={(e) => setTop("project", e.target.value)}
            className="rounded-md border border-slate-300 px-2 py-1 text-sm outline-none focus:border-amber-500" />
        </label>
        <Num label="Plot width (ft)" value={n(draft.plot_width)} onChange={(v) => setTop("plot_width", v)} />
        <Num label="Plot depth (ft)" value={n(draft.plot_depth)} onChange={(v) => setTop("plot_depth", v)} />
        <Num label="Default floor ht (ft)" value={n(draft.floor_height)} onChange={(v) => setTop("floor_height", v)} />
        <Num label="Parapet (ft)" value={n(draft.parapet)} onChange={(v) => setTop("parapet", v)} />
      </div>

      {/* Tamil Nadu height standard */}
      <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-emerald-800">🏗️ Height standard — {std.name}</p>
          <span className="text-[10px] text-emerald-700">editable · feet-inch ok (10'-6")</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <FeetField label="Floor-to-floor" value={std.floor_height} onChange={(v) => setStdK("floor_height", v)} />
          <FeetField label="Ground / stilt" value={std.stilt_height} onChange={(v) => setStdK("stilt_height", v)} />
          <FeetField label="Plinth" value={std.plinth} onChange={(v) => setStdK("plinth", v)} />
          <FeetField label="Parapet" value={std.parapet} onChange={(v) => setStdK("parapet", v)} />
          <FeetField label="Lintel (door/window head)" value={std.lintel} onChange={(v) => setStdK("lintel", v)} />
          <FeetField label="Window sill" value={std.window_sill} onChange={(v) => setStdK("window_sill", v)} />
        </div>
        <p className="text-[10px] text-emerald-700">{std.note}</p>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={applyStandard} disabled={busy}
            className="rounded-lg bg-emerald-600 text-white px-3 py-1.5 text-xs font-semibold hover:bg-emerald-500 disabled:opacity-60">
            Apply to all floors &amp; re-render
          </button>
          <button onClick={saveDefault}
            className="rounded-lg border border-emerald-300 text-emerald-800 px-3 py-1.5 text-xs font-medium hover:bg-emerald-100">
            {saved ? "✓ Saved as your default" : "Save as my default"}
          </button>
        </div>
      </div>

      {/* per-floor */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-slate-600">Floors — footprint &amp; height (per-floor overrides)</p>
        {(draft.floors || []).map((f, i) => (
          <div key={i} className="rounded-lg border border-slate-200 p-2.5">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <label className="flex flex-col gap-0.5">
                <span className="text-[11px] text-slate-500">Name</span>
                <input value={f.name || ""} onChange={(e) => setFloor(i, "name", e.target.value)}
                  className="rounded-md border border-slate-300 px-2 py-1 text-sm outline-none focus:border-amber-500" />
              </label>
              <Num label="Area (sqft)" value={n(f.area_sqft)} onChange={(v) => setFloor(i, "area_sqft", v)} step="1" />
              <Num label="Width fw (ft)" value={n(f.fw)} onChange={(v) => setFloor(i, "fw", v)} />
              <Num label="Depth fd (ft)" value={n(f.fd)} onChange={(v) => setFloor(i, "fd", v)} />
              <Num label="Offset fx (ft)" value={n(f.fx)} onChange={(v) => setFloor(i, "fx", v)} />
              <Num label="Offset fy (ft)" value={n(f.fy)} onChange={(v) => setFloor(i, "fy", v)} />
              <Num label="Floor height (ft)" value={n(f.height)} onChange={(v) => setFloor(i, "height", v)} />
              <div className="flex items-end text-[11px] text-slate-400">
                {(f.openings || []).length} openings · {(f.balconies || []).length} balc.
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <button onClick={applyForm} disabled={busy}
          className="rounded-lg bg-amber-600 text-white px-4 py-2 text-sm font-semibold hover:bg-amber-500 disabled:opacity-60">
          {busy ? "Applying…" : "✓ Apply & re-render"}
        </button>
        <button onClick={() => setShowJson((s) => !s)}
          className="text-xs px-3 py-2 rounded-lg border border-slate-200 text-slate-600 hover:border-slate-300">
          {showJson ? "Hide" : "Advanced: edit"} full spec (JSON)
        </button>
      </div>

      {showJson && (
        <div className="space-y-2">
          <p className="text-[11px] text-slate-500">
            Full control — edit windows, doors, balconies, cladding, open bays. Coordinates in feet;
            x across the front, y = depth from front. Apply validates via the server.
          </p>
          <textarea value={json} onChange={(e) => setJson(e.target.value)} spellCheck={false}
            className="w-full h-72 font-mono text-[11px] rounded-lg border border-slate-300 p-2 outline-none focus:border-amber-500" />
          {jsonErr && <p className="text-xs text-red-600">JSON error: {jsonErr}</p>}
          <button onClick={applyJson} disabled={busy}
            className="rounded-lg bg-slate-900 text-white px-4 py-2 text-sm font-semibold hover:bg-slate-700 disabled:opacity-60">
            Apply JSON &amp; re-render
          </button>
        </div>
      )}
    </div>
  );
}
