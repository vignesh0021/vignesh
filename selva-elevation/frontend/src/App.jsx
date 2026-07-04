import React, { useCallback, useEffect, useRef, useState } from "react";
import Building3D from "./Building3D.jsx";
import { THEMES, themeById } from "./themes.js";

const VIEWS = [
  { key: "model3d", label: "3D Elevation", hint: "Real-time 3D · drag to orbit · pick a theme" },
  { key: "elevation", label: "Elevation", hint: "Coloured presentation front" },
  { key: "front", label: "Front", hint: "Front line elevation" },
  { key: "rear", label: "Rear", hint: "Rear line elevation" },
  { key: "left", label: "Left side", hint: "Left side elevation" },
  { key: "right", label: "Right side", hint: "Right side elevation" },
  { key: "top", label: "Top / roof", hint: "Roof & setback plan" },
];

function svgToBlobUrl(svg) {
  return URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
}

async function downloadPng(svg, name) {
  const url = svgToBlobUrl(svg);
  const img = new Image();
  await new Promise((res, rej) => {
    img.onload = res;
    img.onerror = rej;
    img.src = url;
  });
  const scale = 2;
  const c = document.createElement("canvas");
  c.width = img.width * scale;
  c.height = img.height * scale;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(url);
  const a = document.createElement("a");
  a.href = c.toDataURL("image/png");
  a.download = `${name}.png`;
  a.click();
}

function downloadSvg(svg, name) {
  const a = document.createElement("a");
  a.href = svgToBlobUrl(svg);
  a.download = `${name}.svg`;
  a.click();
}

export default function App() {
  const [health, setHealth] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [active, setActive] = useState("model3d");
  const [themeId, setThemeId] = useState(THEMES[0].id);
  const [error, setError] = useState(null);
  const fileRef = useRef();

  useEffect(() => {
    fetch("/api/health").then((r) => r.json()).then(setHealth).catch(() => {});
  }, []);

  const loadExample = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/example");
      setResult(await r.json());
      setActive("model3d");
    } catch (e) { setError(String(e)); }
    setBusy(false);
  }, []);

  const upload = useCallback(async (file) => {
    if (!file) return;
    setBusy(true); setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/analyze", { method: "POST", body: fd });
      if (!r.ok) throw new Error(`server ${r.status}`);
      setResult(await r.json());
      setActive("model3d");
    } catch (e) { setError(String(e)); }
    setBusy(false);
  }, []);

  const onDrop = (e) => {
    e.preventDefault();
    upload(e.dataTransfer.files?.[0]);
  };

  const spec = result?.spec;
  const svg = result?.views?.[active];

  return (
    <div className="min-h-screen">
      {/* header */}
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-5 py-3 flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-amber-500 to-orange-700 grid place-items-center text-white font-extrabold">S</div>
          <div>
            <h1 className="font-extrabold text-lg leading-tight">SELVA Elevation Studio</h1>
            <p className="text-xs text-slate-500 leading-tight">Plan → line views → elevation · 100% plan-faithful</p>
          </div>
          <div className="ml-auto text-xs">
            {health?.llm && (
              <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-600">
                LLM: <b>{health.llm.provider}</b>{health.llm.configured ? "" : " (not configured)"}
              </span>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-5 py-6 grid lg:grid-cols-[320px_1fr] gap-6">
        {/* left: upload + info */}
        <section className="space-y-4">
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
            onClick={() => fileRef.current?.click()}
            className="cursor-pointer rounded-2xl border-2 border-dashed border-slate-300 hover:border-amber-500 hover:bg-amber-50/40 transition p-7 text-center"
          >
            <div className="text-4xl mb-2">📐</div>
            <p className="font-semibold">Drop your plan here</p>
            <p className="text-xs text-slate-500 mt-1">PDF, JPG or PNG · full sheet or floor-by-floor</p>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg"
              className="hidden"
              onChange={(e) => upload(e.target.files?.[0])}
            />
          </div>

          <button
            onClick={loadExample}
            className="w-full rounded-xl bg-slate-900 text-white py-2.5 text-sm font-semibold hover:bg-slate-700"
          >
            ✨ Load SELVA G+2 example
          </button>

          {busy && <p className="text-sm text-amber-700 animate-pulse">Analysing plan…</p>}
          {error && <p className="text-sm text-red-600">Error: {error}</p>}

          {result?.note && (
            <div className={`text-xs rounded-lg p-3 ${result.source === "llm" ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>
              <b>Source: {result.source}</b> — {result.note}
            </div>
          )}

          {spec && (
            <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">
              <h3 className="font-bold mb-2">{spec.project}</h3>
              <div className="text-slate-500 text-xs mb-3">
                Plot {spec.plot_width}×{spec.plot_depth} {spec.units} · floor ht {spec.floor_height} {spec.units}
              </div>
              <table className="w-full text-xs">
                <thead className="text-slate-400 text-left">
                  <tr><th className="py-1">Floor</th><th>Area</th><th>Footprint</th><th>Openings</th></tr>
                </thead>
                <tbody>
                  {spec.floors.map((f) => (
                    <tr key={f.name} className="border-t border-slate-100">
                      <td className="py-1 font-medium">{f.name}</td>
                      <td>{f.area_sqft ? `${f.area_sqft} sf` : "—"}</td>
                      <td>{f.fw}×{f.fd}</td>
                      <td>{f.openings.length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* right: views */}
        <section>
          {!result ? (
            <div className="h-full min-h-[420px] grid place-items-center rounded-2xl border border-slate-200 bg-white text-center p-10">
              <div>
                <div className="text-5xl mb-3">🏛️</div>
                <p className="font-semibold">Upload a plan or load the example</p>
                <p className="text-sm text-slate-500 mt-1">
                  You'll get a real-time 3D elevation (5 themes) plus front · rear · two sides · top line views.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {VIEWS.map((v) => (
                  <button
                    key={v.key}
                    onClick={() => setActive(v.key)}
                    className={`px-3.5 py-1.5 rounded-full text-sm font-medium transition ${
                      active === v.key ? "bg-amber-600 text-white" : "bg-white border border-slate-200 text-slate-600 hover:border-amber-400"
                    }`}
                  >
                    {v.label}
                  </button>
                ))}
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-3">
                <div className="flex items-center justify-between mb-2 px-1">
                  <p className="text-xs text-slate-500">
                    {VIEWS.find((v) => v.key === active)?.hint}
                  </p>
                  {active !== "model3d" && (
                    <div className="flex gap-2">
                      <button onClick={() => downloadSvg(svg, `${spec.project}-${active}`)}
                        className="text-xs px-2.5 py-1 rounded bg-slate-100 hover:bg-slate-200">SVG</button>
                      <button onClick={() => downloadPng(svg, `${spec.project}-${active}`)}
                        className="text-xs px-2.5 py-1 rounded bg-slate-100 hover:bg-slate-200">PNG</button>
                    </div>
                  )}
                </div>

                {active === "model3d" ? (
                  <div className="space-y-3">
                    <Building3D spec={spec} theme={themeById(themeId)} />
                    <div>
                      <p className="text-xs text-slate-500 mb-1.5">
                        Design theme — <b>5 different elevations</b>, same exact plan:
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {THEMES.map((t) => (
                          <button
                            key={t.id}
                            onClick={() => setThemeId(t.id)}
                            className={`flex items-center gap-2 pl-1.5 pr-3 py-1.5 rounded-full text-xs font-medium transition border ${
                              themeId === t.id ? "border-amber-500 bg-amber-50 text-amber-800" : "border-slate-200 text-slate-600 hover:border-slate-300"
                            }`}
                          >
                            <span className="flex -space-x-1">
                              {[t.plaster, t.wood, t.accent].map((c, i) => (
                                <span key={i} className="h-4 w-4 rounded-full border border-white" style={{ background: c }} />
                              ))}
                            </span>
                            {t.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div
                    className="w-full overflow-auto rounded-lg bg-slate-50 grid place-items-center [&>svg]:max-w-full [&>svg]:h-auto"
                    dangerouslySetInnerHTML={{ __html: svg || "" }}
                  />
                )}
              </div>

              <p className="text-xs text-slate-400 px-1">
                Geometry is built deterministically from the extracted spec — every view (and the 3D model)
                stays true to the plan. Themes change only materials/finish, never the structure.
                Storey heights use a conventional assumption when the sheet has no vertical dimensions.
              </p>
            </div>
          )}
        </section>
      </main>

      <footer className="max-w-6xl mx-auto px-5 py-8 text-xs text-slate-400">
        Roadmap: line views ✓ → shaded elevation ✓ → parametric 3D + themes ✓ → photoreal render (export to Blender / ControlNet) — next.
      </footer>
    </div>
  );
}
