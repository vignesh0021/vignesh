// Height standards + user preferences (persisted in the browser).

export const TN_STANDARD = {
  id: "tn",
  name: "Tamil Nadu (standard)",
  floor_height: 10.0,   // floor-to-floor
  stilt_height: 10.0,   // ground / open-parking storey
  plinth: 2.0,
  parapet: 3.5,
  lintel: 7.0,          // door/window head
  window_sill: 3.0,
  vent_sill: 6.0,
  door_height: 7.0,
  wall_thickness: 0.75,
  note: "TNCDBR: clear height ≥ 2.75 m (9'); floor-to-floor ~10'; plinth 2'; parapet ≥ 1 m (3'-3\"); lintel 7'; window sill 3'.",
};

const KEY = "selva.heightStandard";

export function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(KEY)) || null; }
  catch { return null; }
}
export function savePrefs(std) {
  try { localStorage.setItem(KEY, JSON.stringify(std)); } catch {}
}
export function clearPrefs() {
  try { localStorage.removeItem(KEY); } catch {}
}

// "10'6\"" | "10'-6\"" | "10' 6" | "10.5" | "10"  ->  10.5   (feet, decimal)
export function parseFeet(v) {
  if (typeof v === "number") return v;
  const s = String(v).trim();
  if (s === "") return "";
  const fi = s.match(/^(\d+(?:\.\d+)?)\s*'?\s*-?\s*(\d+(?:\.\d+)?)?\s*"?$/);
  if (fi && fi[2] !== undefined) return +(+fi[1] + +fi[2] / 12).toFixed(3);
  const n = Number(s.replace(/['"]/g, ""));
  return Number.isFinite(n) ? n : "";
}

// 10.5 -> 10'-6"
export function formatFeet(x) {
  if (x === "" || x == null) return "";
  const ft = Math.floor(x);
  const inch = Math.round((x - ft) * 12);
  return inch ? `${ft}'-${inch}"` : `${ft}'-0"`;
}
