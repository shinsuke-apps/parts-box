// いろいろな寸法で形状と図面が破綻しないかを調べる開発用テスト。
// ブラウザのコンソールで:  const m = await import('/tests/sweep.js'); await m.run()
import { buildBox, derive, validate, cutList, faceNormal } from '../src/geometry.js';
import { buildSheets } from '../src/drawing.js';

const S2 = Math.SQRT2;
const BLOCK = /正の値|狭すぎ|短すぎ|低すぎ|板厚以上/;

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }

// 外寸(W, 全奥行L, H, t) → 内部パラメータ
export function paramsOf({ W, L, H, t, g, c }) {
  const d = 100;
  return { d, dx: W / d, dz: H / d, dy: (L - H / 2) / d, t, gRatio: (g ?? t / 3) / t, cRatio: (c ?? 2 * t / 3) / t };
}

function cellPlanes(cell) {
  return cell.map((f) => { const n = faceNormal(f.pts); const p = f.pts[0]; return [n, n[0] * p[0] + n[1] * p[1] + n[2] * p[2]]; });
}
const inside = (planes, p, e = 1e-6) => planes.every(([n, k]) => n[0] * p[0] + n[1] * p[1] + n[2] * p[2] < k - e);

// 1つの寸法を調べる
export function checkGeometry(P, N = 30000) {
  const issues = [];
  const box = buildBox(P), v = box.v;
  const hw = v.W / 2;
  // 数値が壊れていないか
  for (const part of box.parts) {
    if (!part.faces.length) issues.push(`${part.name}: 面がない`);
    for (const f of part.faces) for (const p of f.pts) if (!p.every(Number.isFinite)) { issues.push(`${part.name}: NaN`); break; }
    if (!(part.volume > 0)) issues.push(`${part.name}: 体積が0以下`);
  }
  // 部材表の板からはみ出していないか（体積で）
  const cl = cutList(v);
  const blank = { side: cl[0], back: cl[1], front: cl[2], bottom: cl[3] };
  for (const part of box.parts) {
    const b = blank[part.group];
    if (b && part.volume > b.L * b.Wd * b.T * (1 + 1e-6)) issues.push(`${part.name}: 部材表の寸法より大きい`);
  }
  // モンテカルロ：干渉・すき間・体積
  const cells = box.parts.map((part) => part.cells.map(cellPlanes));
  const R = rng(12345);
  const lo = [-hw, -v.H / 2, 0], hi = [hw, v.D, v.H];
  const vol = (hi[0] - lo[0]) * (hi[1] - lo[1]) * (hi[2] - lo[2]);
  const hits = box.parts.map(() => 0);
  let overlap = 0, gap = 0, extra = 0, counted = 0, holes = 0;
  const gapPts = [], ovPts = [];
  for (let i = 0; i < N; i++) {
    const p = [lo[0] + R() * (hi[0] - lo[0]), lo[1] + R() * (hi[1] - lo[1]), lo[2] + R() * (hi[2] - lo[2])];
    let cnt = 0;
    cells.forEach((pc, j) => { if (pc.some((pl) => inside(pl, p, 0))) { cnt++; hits[j]++; } });
    if (cnt > 1) { overlap++; if (ovPts.length < 3) ovPts.push(p.map((x) => +x.toFixed(1))); }
    // 期待される形：外形 − 内側の空間（上端の面取り帯は除いて比べる）
    if (p[2] > v.H - v.c - 0.01) continue;
    counted++;
    const x = Math.abs(p[0]);
    const outer = x <= hw && p[1] <= v.D && p[1] + p[2] >= 0 && p[2] - p[1] <= v.H &&
      x - p[2] <= hw - v.c && p[1] - p[2] <= v.D - v.c;
    // 底板は t−g〜t の高さに浮いていて、その下は空いている
    const cavity = x < hw - v.t && p[1] < v.D - v.t && p[1] + p[2] > v.t * S2 && !(p[2] >= v.t - v.g && p[2] <= v.t);
    const want = outer && !cavity;
    // 通し溝が前の留めに抜けてできる小さな穴（設計どおり）は別に数える
    const grooveHole = p[2] >= v.t - v.g && p[2] <= v.t && x > hw - v.t && x < hw - v.t + v.g && p[1] < v.t * S2;
    if (want && cnt === 0 && grooveHole) { holes++; continue; }
    if (want && cnt === 0) { gap++; if (gapPts.length < 3) gapPts.push(p.map((x) => +x.toFixed(1))); }
    if (!want && cnt > 0) extra++;
  }
  if (overlap) issues.push(`干渉 ${overlap}点 例${JSON.stringify(ovPts)}`);
  if (gap) issues.push(`すき間 ${gap}点 例${JSON.stringify(gapPts)}`);
  if (extra) issues.push(`余分な材 ${extra}点`);
  box.parts.forEach((part, j) => {
    const mc = hits[j] / N * vol;
    const se = Math.sqrt(hits[j]) / N * vol; // 標準誤差
    if (Math.abs(mc - part.volume) > 5 * se + part.volume * 0.02) issues.push(`${part.name}: 体積の食い違い 計算${part.volume.toFixed(0)} / 標本${mc.toFixed(0)}`);
  });
  return { box, issues, grooveHoleMm3: holes / N * vol };
}

// 図面：NaN、紙からはみ出し、文字の重なり、主図が右の詳細列・表題欄に入り込んでいないか
export function checkSheets(box, P) {
  const issues = [];
  const svgs = buildSheets(box, P, null);
  const names = ['総合図'];
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;left:-10000px;top:0;width:1188px';
  document.body.appendChild(host);
  svgs.forEach((s, si) => {
    const nm = names[si];
    if (/NaN|Infinity|undefined/.test(s)) issues.push(`${nm}: NaN/undefinedを含む`);
    host.innerHTML = s;
    const svg = host.querySelector('svg');
    const els = [...svg.querySelectorAll('line,path,text,circle,polyline,polygon')].filter((e) => !e.closest('clipPath') && !e.closest('defs') && !e.closest('pattern') && !e.closest('g[clip-path]'));
    // 回転した文字もあるので、変換後の外接矩形（用紙座標）で比べる
    const inv = svg.getScreenCTM().inverse();
    const boxes = els.map((e) => {
      const b = e.getBBox(), M = inv.multiply(e.getScreenCTM());
      const pts = [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]]
        .map(([x, y]) => [M.a * x + M.c * y + M.e, M.b * x + M.d * y + M.f]);
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      return { e, x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
    });
    let out = 0;
    boxes.forEach((b) => { if (b.x0 < 2 || b.y0 < 2 || b.x1 > 295 || b.y1 > 208) out++; });
    if (out) issues.push(`${nm}: 紙からはみ出し ${out}要素`);
    // 文字どうしの重なり
    const texts = boxes.filter((b) => b.e.tagName === 'text' && b.e.textContent.trim());
    let tov = 0; const ex = [];
    for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i], b = texts[j];
      const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
      if (w > 0.4 && h > 0.4) { tov++; if (ex.length < 3) ex.push(`「${a.e.textContent}」と「${b.e.textContent}」`); }
    }
    if (tov) issues.push(`${nm}: 文字の重なり ${tov}組 ${ex.join(' ')}`);
    // 部材図：主図（左側）の線・寸法が詳細列（x>204）や表題欄（x>150,y>186）に入っていないか
    // 総合図：左の図が右の一覧（x>196）に入っていないか
    if (si === 0) {
      const into = boxes.filter((b) => b.x0 < 194 && b.x1 > 196.5 && b.y1 < 186);
      if (into.length) issues.push(`${nm}: 図が右の一覧に入り込む ${into.length}要素`);
    }
    if (si >= 1) {
      const main = boxes.filter((b) => !b.e.closest('g[clip-path]') && b.x0 < 200 && b.y0 > 14 && b.y1 < 186.5);
      const intoCol = main.filter((b) => b.x1 > 203);
      if (intoCol.length) issues.push(`${nm}: 主図が右の詳細列に入り込む ${intoCol.length}要素`);
    }
    // 直線は外接矩形ではなく線分そのもので表題欄（x≧151, y≧187）と交わるかを見る（斜めの寸法線の誤検出を防ぐ）
    const hitsTB = (e) => {
      const g = (k) => +e.getAttribute(k);
      let [x1, y1, x2, y2] = [g('x1'), g('y1'), g('x2'), g('y2')], t0 = 0, t1 = 1;
      const dx = x2 - x1, dy = y2 - y1;
      for (const [p, q] of [[-dx, x1 - 151], [dx, 291 - x1], [-dy, y1 - 187], [dy, 204 - y1]]) {
        if (Math.abs(p) < 1e-12) { if (q < 0) return false; continue; }
        const r = q / p;
        if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
      }
      return true;
    };
    const tb = boxes.filter((b) => b.x1 > 151 && b.y1 > 187 && !(b.x0 >= 149.9 && b.y0 >= 185.9) && b.e.tagName !== 'text' &&
      (b.e.tagName !== 'line' || hitsTB(b.e)));
    if (tb.length) issues.push(`${nm}: 表題欄に線がかかる ${tb.length}要素`);
  });
  host.remove();
  return issues;
}

export function cases(n = 120, seed = 7) {
  const R = rng(seed);
  const pick = (a, b) => Math.round(a + R() * (b - a));
  const out = [
    { W: 140, L: 210, H: 140, t: 12 },             // 初期値
    { W: 60, L: 90, H: 50, t: 6 },                 // 小さい
    { W: 600, L: 500, H: 300, t: 24 },             // 大きい
    { W: 600, L: 120, H: 60, t: 9 },               // 横長で浅い
    { W: 80, L: 500, H: 80, t: 9 },                // 細長い
    { W: 120, L: 200, H: 400, t: 15 },             // 背が高い
    { W: 300, L: 300, H: 40, t: 9 },               // ぎりぎり低い
    { W: 200, L: 250, H: 150, t: 30 },             // 板厚が厚い
    { W: 200, L: 250, H: 150, t: 4 },              // 板厚が薄い
    { W: 200, L: 250, H: 150, t: 12, g: 3, c: 9 }, // 溝・面取りを手入力
    { W: 200, L: 250, H: 150, t: 12, g: 6, c: 6 },
    { W: 200, L: 250, H: 150, t: 12, g: 4, c: 0 },
  ];
  // 警告のぎりぎり（少しだけ内側）
  for (const t of [4, 9, 15, 24, 30]) {
    const H = 4 * t + 1, W = 2 * t + 11, D = Math.max(10, t) + t * S2 + 0.5;
    out.push({ W, L: D + H / 2, H, t });
    out.push({ W: 300, L: D + 60, H: 120, t });
    out.push({ W, L: 400, H: 300, t });
  }
  // 溝・面取りの手入力（ランダム）
  for (let i = 0; i < 20; i++) {
    const t = [6, 9, 12, 18, 24][Math.floor(R() * 5)];
    out.push({ W: pick(120, 500), L: pick(150, 500), H: pick(Math.max(60, 4 * t + 2), 300), t, g: +(t * (0.15 + R() * 0.43)).toFixed(1), c: +(t * R() * 0.98).toFixed(1) });
  }
  while (out.length < n) {
    const t = [4, 6, 9, 12, 15, 18, 21, 24, 30][Math.floor(R() * 9)];
    const H = pick(30, 400), W = pick(40, 700), L = pick(H / 2 + 20, 700);
    out.push({ W, L, H, t });
  }
  return out;
}

export async function run({ n = 120, sheets = true, N = 30000 } = {}) {
  const res = [];
  for (const c of cases(n)) {
    const P = paramsOf(c);
    const v = derive(P);
    const warns = validate(v);
    if (warns.some((w) => BLOCK.test(w))) { res.push({ c, skipped: warns.filter((w) => BLOCK.test(w)) }); continue; }
    const t0 = performance.now();
    let issues = [];
    try {
      const { box, issues: gi, grooveHoleMm3 } = checkGeometry(P, N);
      issues = gi; var hole = grooveHoleMm3;
      if (sheets) issues.push(...checkSheets(box, P));
    } catch (e) { issues.push('例外: ' + e.message); }
    res.push({ c, warns, issues, hole, ms: Math.round(performance.now() - t0) });
    await new Promise((r) => setTimeout(r, 0));
  }
  return res;
}
