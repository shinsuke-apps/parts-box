// 手加工用図面（SVG）の生成
import { V } from './geometry.js?v=20261122t';
import { layoutBoards, kidoriSummary, boardSVG } from './kidori.js?v=20261122t';

const { sub, add, mul, dot, cross } = V;
const S2 = Math.SQRT2;

export const fmt = (x) => {
  const r = Math.round(x * 10) / 10;
  return (Object.is(r, -0) ? 0 : r).toFixed(1).replace(/\.0$/, '');
};

// ---------- 隠れ線処理 ----------
function triangles(parts) {
  const tris = [];
  parts.forEach((p) => p.faces.forEach((f) => {
    for (let i = 1; i < f.pts.length - 1; i++) tris.push([f.pts[0], f.pts[i], f.pts[i + 1]]);
  }));
  return tris;
}

function makeOccluder(parts, dir, U, Vf) {
  const tris = triangles(parts).map((t) => {
    const us = t.map(U), vs = t.map(Vf);
    return { t, u0: Math.min(...us) - 1e-6, u1: Math.max(...us) + 1e-6, v0: Math.min(...vs) - 1e-6, v1: Math.max(...vs) + 1e-6 };
  });
  return (p) => {
    const pu = U(p), pv = Vf(p);
    for (const T of tris) {
      if (pu < T.u0 || pu > T.u1 || pv < T.v0 || pv > T.v1) continue;
      const [a, b, c] = T.t;
      const e1 = sub(b, a), e2 = sub(c, a);
      const h = cross(dir, e2), det = dot(e1, h);
      if (Math.abs(det) < 1e-12) continue;
      const f = 1 / det, s = sub(p, a);
      const uu = f * dot(s, h);
      if (uu < 1e-7 || uu > 1 - 1e-7) continue;
      const q = cross(s, e1), vv = f * dot(dir, q);
      if (vv < 1e-7 || uu + vv > 1 - 1e-7) continue;
      if (f * dot(e2, q) > 1e-3) return true;
    }
    return false;
  };
}

// 見える線・隠れ線に分けた2D線分を返す
export function projectLines(parts, view) {
  const { dir, U, V: Vf } = view;
  const occ = makeOccluder(parts, dir, U, Vf);
  const out = [];
  parts.forEach((part) => part.edges.forEach((e) => {
    const len = Math.hypot(...sub(e.b, e.a));
    const n = Math.max(6, Math.min(300, Math.ceil(len / 1.0)));
    const st = [];
    for (let i = 0; i < n; i++) st.push(occ(add(e.a, mul(sub(e.b, e.a), (i + 0.5) / n))));
    for (let i = 1; i < n - 1; i++) if (st[i - 1] === st[i + 1] && st[i] !== st[i - 1]) st[i] = st[i - 1];
    let s0 = 0;
    for (let i = 1; i <= n; i++) {
      if (i === n || st[i] !== st[s0]) {
        const pa = add(e.a, mul(sub(e.b, e.a), s0 / n)), pb = add(e.a, mul(sub(e.b, e.a), i / n));
        const a2 = [U(pa), Vf(pa)], b2 = [U(pb), Vf(pb)];
        if (Math.hypot(a2[0] - b2[0], a2[1] - b2[1]) > 1e-4) out.push({ a: a2, b: b2, hidden: st[s0] });
        s0 = i;
      }
    }
  }));
  return out;
}

// ---------- SVG 部品 ----------
let uid = 0;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

class Sheet {
  constructor(title) {
    this.title = title; this.out = []; this.id = 'sh' + (uid++);
    this.occ = [];                                   // 文字が使っている場所
    this.segs = [];                                  // 部材の線（文字を載せたくない）
    this.zone = { x0: 8, x1: 289, y0: 8, y1: 202 };   // いま描いている区画
  }
  // 区画の中に収まり、ほかの文字と重ならないか
  fits(r, avoidLines = false) {
    const z = this.zone;
    if (r.x0 < z.x0 || r.x1 > z.x1 || r.y0 < z.y0 || r.y1 > z.y1) return false;
    if (!this.occ.every((o) => r.x1 <= o.x0 || r.x0 >= o.x1 || r.y1 <= o.y0 || r.y0 >= o.y1)) return false;
    return !avoidLines || !this.segs.some(([a, b]) => segHitsRect(a, b, r));
  }
  reserve(r) { this.occ.push(r); }
  line(a, b, cls) { this.out.push(`<line x1="${a[0].toFixed(3)}" y1="${a[1].toFixed(3)}" x2="${b[0].toFixed(3)}" y2="${b[1].toFixed(3)}" class="${cls}"/>`); }
  text(p, s, { size = 3, anchor = 'middle', rot = 0, cls = 'tx', weight = '' } = {}) {
    const tr = rot ? ` transform="rotate(${rot.toFixed(2)} ${p[0].toFixed(3)} ${p[1].toFixed(3)})"` : '';
    this.out.push(`<text x="${p[0].toFixed(3)}" y="${p[1].toFixed(3)}" font-size="${size}" text-anchor="${anchor}" class="${cls}"${weight ? ` font-weight="${weight}"` : ''}${tr}>${esc(s)}</text>`);
  }
  raw(s) { this.out.push(s); }
  svg() {
    return `<svg xmlns="http://www.w3.org/2000/svg" class="sheet" viewBox="0 0 297 210" width="297mm" height="210mm">
<defs><pattern id="${this.id}h" width="1.2" height="1.2" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="1.2" class="hatch"/></pattern></defs>
<rect x="0" y="0" width="297" height="210" class="paper"/>
<rect x="6" y="6" width="285" height="198" class="frame"/>
${this.out.join('\n')}
</svg>`;
  }
}

// 線分が矩形にかかるか（Liang–Barsky）
function segHitsRect(a, b, r) {
  let t0 = 0, t1 = 1;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  for (const [p, q] of [[-dx, a[0] - r.x0], [dx, r.x1 - a[0]], [-dy, a[1] - r.y0], [dy, r.y1 - a[1]]]) {
    if (Math.abs(p) < 1e-12) { if (q < 0) return false; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return true;
}

// 文字の幅の目安（全角 ≒ 文字の大きさ、半角 ≒ 0.56倍）
const textW = (s, size) => [...String(s)].reduce((a, ch) => a + (/[\x00-\x7f]/.test(ch) ? 0.58 : 1.06), 0) * size;
// 文字の占める矩形（回転は軸に沿った外接矩形）
function textRect(p, s, size, anchor, rot = 0) {
  const w = textW(s, size) + 0.6, h = size * 1.05;
  const ax = anchor === 'start' ? 0 : anchor === 'end' ? -w : -w / 2;
  const r = rot * Math.PI / 180, cs = Math.cos(r), sn = Math.sin(r);
  const pts = [[ax, -h * 0.9], [ax + w, -h * 0.9], [ax, h * 0.3], [ax + w, h * 0.3]].map(([x, y]) => [p[0] + x * cs - y * sn, p[1] + x * sn + y * cs]);
  const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

// モデル座標(u,v) → 用紙座標
function viewMap(s, ox, oy, umin, vmin) {
  return (p) => [ox + (p[0] - umin) * s, oy - (p[1] - vmin) * s];
}

function arrow(sh, tip, dirv) {
  const L = 2.2, w = 0.7;
  const b = [tip[0] - dirv[0] * L, tip[1] - dirv[1] * L];
  const n = [-dirv[1], dirv[0]];
  sh.raw(`<path d="M${tip[0].toFixed(3)},${tip[1].toFixed(3)} L${(b[0] + n[0] * w).toFixed(3)},${(b[1] + n[1] * w).toFixed(3)} L${(b[0] - n[0] * w).toFixed(3)},${(b[1] - n[1] * w).toFixed(3)} Z" class="arr"/>`);
}

// 寸法線。mode: 'h' 水平, 'v' 垂直, 'a' 平行。off は用紙mm（h:下が＋, v:右が＋, a:左手側が＋）
// at は数字を置く位置（寸法線の a→b の割合、既定は中央）。配列なら順に試す
function dim(sh, M, p1, p2, mode, off, label, at = 0.5) {
  const A = M(p1), B = M(p2);
  let a, b;
  if (mode === 'h') {
    const y = (off > 0 ? Math.max(A[1], B[1]) : Math.min(A[1], B[1])) + off;
    a = [A[0], y]; b = [B[0], y];
  } else if (mode === 'v') {
    const x = (off > 0 ? Math.max(A[0], B[0]) : Math.min(A[0], B[0])) + off;
    a = [x, A[1]]; b = [x, B[1]];
  } else {
    const d = [B[0] - A[0], B[1] - A[1]], L = Math.hypot(...d);
    const n = [d[1] / L, -d[0] / L];
    a = [A[0] + n[0] * off, A[1] + n[1] * off]; b = [B[0] + n[0] * off, B[1] + n[1] * off];
  }
  const ext = (P, Q) => {
    const d = [Q[0] - P[0], Q[1] - P[1]], L = Math.hypot(...d);
    if (L < 0.3) return;
    const u = [d[0] / L, d[1] / L];
    sh.line([P[0] + u[0] * 0.8, P[1] + u[1] * 0.8], [Q[0] + u[0] * 1.5, Q[1] + u[1] * 1.5], 'dim');
  };
  ext(A, a); ext(B, b);
  sh.segs.push([A, a], [B, b], [a, b]); // 注記が寸法線に乗らないように
  const d = [b[0] - a[0], b[1] - a[1]], L = Math.hypot(...d);
  if (L < 1e-6) return;
  const u = [d[0] / L, d[1] / L];
  const value = label ?? fmt(mode === 'h' ? Math.abs(p2[0] - p1[0]) : mode === 'v' ? Math.abs(p2[1] - p1[1]) : Math.hypot(p2[0] - p1[0], p2[1] - p1[1]));
  if (L < 7) { // 狭いときは矢印を外向きに
    sh.line([a[0] - u[0] * 4, a[1] - u[1] * 4], [b[0] + u[0] * 4, b[1] + u[1] * 4], 'dim');
    arrow(sh, a, u); arrow(sh, b, [-u[0], -u[1]]);
  } else {
    sh.line(a, b, 'dim');
    arrow(sh, a, [-u[0], -u[1]]); arrow(sh, b, u);
  }
  let ang = Math.atan2(u[1], u[0]) * 180 / Math.PI;
  if (ang > 90.01) ang -= 180; if (ang <= -90.01) ang += 180;
  const r = ang * Math.PI / 180;
  const nrm = [Math.sin(r), -Math.cos(r)];
  const mid = [(a[0] + b[0]) / 2 + nrm[0] * 0.9, (a[1] + b[1]) / 2 + nrm[1] * 0.9];
  const tw = textW(value, 2.8);
  // 置き場所の候補：指定の位置 → 寸法線の中央 → 外側（b の先・a の先）→ さらに離す
  const cand = [];
  for (const f of [].concat(at)) if (f !== 0.5) cand.push([a[0] + (b[0] - a[0]) * f + nrm[0] * 0.9, a[1] + (b[1] - a[1]) * f + nrm[1] * 0.9]);
  if (L >= tw + 2) cand.push(mid);
  for (const k of [0, 3, 7]) {
    cand.push([b[0] + u[0] * (tw / 2 + 5 + k) + nrm[0] * 0.9, b[1] + u[1] * (tw / 2 + 5 + k) + nrm[1] * 0.9]);
    cand.push([a[0] - u[0] * (tw / 2 + 5 + k) + nrm[0] * 0.9, a[1] - u[1] * (tw / 2 + 5 + k) + nrm[1] * 0.9]);
  }
  for (const k of [3.2, 6.4]) cand.push([mid[0] + nrm[0] * k, mid[1] + nrm[1] * k]);
  // それでも空きがなければ、さらに離す・寸法線の反対側も試す
  for (const k of [12, 18]) {
    cand.push([b[0] + u[0] * (tw / 2 + 5 + k) + nrm[0] * 0.9, b[1] + u[1] * (tw / 2 + 5 + k) + nrm[1] * 0.9]);
    cand.push([a[0] - u[0] * (tw / 2 + 5 + k) + nrm[0] * 0.9, a[1] - u[1] * (tw / 2 + 5 + k) + nrm[1] * 0.9]);
  }
  for (const k of [-2.6, -5.8, 9.6]) cand.push([mid[0] + nrm[0] * k, mid[1] + nrm[1] * k]);
  const pos = cand.find((q) => sh.fits(textRect(q, value, 2.8, 'middle', ang))) || cand[0];
  sh.reserve(textRect(pos, value, 2.8, 'middle', ang));
  sh.text(pos, value, { size: 2.8, rot: ang });
}

// 引き出し線つき注記
function note(sh, M, p, dx, dy, s) {
  const A = M(p);
  const lines = String(s).split('\n');
  const w = Math.max(...lines.map((x) => textW(x, 2.6))) + 1.6;
  const rectOf = (B, right) => ({ x0: right ? B[0] : B[0] - w, x1: right ? B[0] + w : B[0], y0: B[1] - 3.4, y1: B[1] + (lines.length - 1) * 3.4 });
  // 指定の向き → 上下にずらす → 反対側、の順で空いている場所を探す
  let B = [A[0] + dx, A[1] + dy], right = dx >= 0, found = false;
  for (const avoid of [true, false]) {
    for (const side of [right, !right]) {
      for (const k of [0, -4, 4, -8, 8, -12, 12, -16, 16, -22, 22]) {
        const b = [A[0] + (side === (dx >= 0) ? dx : -dx), A[1] + dy + k];
        if (sh.fits(rectOf(b, side), avoid)) { B = b; right = side; found = true; break; }
      }
      if (found) break;
    }
    if (found) break;
  }
  sh.reserve(rectOf(B, right));
  const C = [B[0] + (right ? w : -w), B[1]];
  sh.raw(`<circle cx="${A[0].toFixed(3)}" cy="${A[1].toFixed(3)}" r="0.45" class="arr"/>`);
  sh.line(A, B, 'dim'); sh.line(B, C, 'dim');
  String(s).split('\n').forEach((ln, i) => sh.text([B[0] + (right ? 0.8 : -0.8), B[1] - 0.8 + i * 3.4], ln, { size: 2.6, anchor: right ? 'start' : 'end' }));
}

function drawLines(sh, M, lines) {
  lines.forEach((l) => sh.segs.push([M(l.a), M(l.b)]));
  lines.filter((l) => l.hidden).forEach((l) => sh.line(M(l.a), M(l.b), 'hid'));
  lines.filter((l) => !l.hidden).forEach((l) => sh.line(M(l.a), M(l.b), 'vis'));
}

function bbox(lines) {
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  lines.forEach((l) => [l.a, l.b].forEach((p) => { u0 = Math.min(u0, p[0]); u1 = Math.max(u1, p[0]); v0 = Math.min(v0, p[1]); v1 = Math.max(v1, p[1]); }));
  return { u0, u1, v0, v1, w: u1 - u0, h: v1 - v0 };
}

const SCALES = [1, 1 / 2, 1 / 2.5, 1 / 3, 1 / 4, 1 / 5, 1 / 10, 1 / 20];
const scaleLabel = (s) => (s >= 1 ? `${fmt(s)}:1` : `1:${fmt(1 / s)}`);
const pick = (list, w, h, aw, ah) => list.find((s) => w * s <= aw && h * s <= ah) || list[list.length - 1];

function titleBlock(sh, name, qty, scale, v, params) {
  const x0 = 150, y0 = 186, w = 141, h = 18;
  sh.raw(`<rect x="${x0}" y="${y0}" width="${w}" height="${h}" class="frame"/>`);
  sh.line([x0, y0 + 9], [x0 + w, y0 + 9], 'thin');
  sh.line([x0 + 70, y0], [x0 + 70, y0 + 18], 'thin');
  sh.line([x0 + 105, y0], [x0 + 105, y0 + 18], 'thin');
  sh.text([x0 + 3, y0 + 6.3], name, { size: 4.2, anchor: 'start', weight: 'bold' });
  sh.text([x0 + 3, y0 + 15.2], `パーツ箱  外寸 ${fmt(v.W)}×${fmt(v.depth)}×${fmt(v.H)}`, { size: 2.5, anchor: 'start' });
  sh.text([x0 + 67.5, y0 + 6.3], '設計 Shinsuke Kato', { size: 2.3, anchor: 'end' });
  sh.text([x0 + 87.5, y0 + 6.3], qty, { size: 3.4 });
  sh.text([x0 + 87.5, y0 + 15.2], `板厚 ${fmt(v.t)}`, { size: 3 });
  sh.text([x0 + 123, y0 + 6.3], `縮尺 ${scale}`, { size: 3.2 });
  sh.text([x0 + 123, y0 + 15.2], '単位 mm', { size: 3 });
}

function legend(sh) {
  sh.line([10, 200], [18, 200], 'vis'); sh.text([19.5, 201], '見える線', { size: 2.4, anchor: 'start' });
  sh.line([36, 200], [44, 200], 'hid'); sh.text([45.5, 201], '隠れ線（裏側）', { size: 2.4, anchor: 'start' });
}

// ---------- 図面（総合図1枚） ----------
export function buildSheets(box, params, isoImage, kopt) {
  const sheets = [];
  sheets.push(overviewSheet(box, params, kopt, isoImage));
  return sheets;
}

// ---------- 総合図：1枚で全部の寸法が分かる図 ----------
// 上に平面図、下に右側面図（どちらも左が前）。右に寸法一覧と木取り。
function overviewSheet(box, params, kopt, isoImage) {
  const { v, parts } = box;
  const { W, D, H, t, g, c } = v;
  const hw = W / 2, depth = D + H / 2, e = hw - t + g;
  const y0 = t * S2 - t;            // 底板の前端（上面）
  const Lt = D + g - t * S2;        // 底板の長さ
  const sh = new Sheet('総合図');
  const top = { dir: [0, 0, 1], U: (p) => p[1] + H / 2, V: (p) => hw - p[0] };
  const side = { dir: [1, 0, 0], U: (p) => p[1] + H / 2, V: (p) => p[2] };
  const Lp = projectLines(parts, top), Ls = projectLines(parts, side);

  const area = { x: 10, y: 16, w: 184, h: 168 };
  const pad = { l: 16, r: 20, t: 12, mid: 24, b: 12 };
  const aw = area.w - pad.l - pad.r, ah = area.h - pad.t - pad.b;
  // ふつうは平面図の上下に並べる。幅が広い箱は左右に並べたほうが大きく描けるのでそうする
  // 側面図の下には「前の斜面〜背面の上の角」の寸法が (D−H)/2 だけはみ出す。
  // はみ出すのは図の左寄り（足は U=D/2）なので、表題欄より左なら凡例の上（y≦194）まで使ってよい
  const ex = Math.max(0, (D - H) / 2);
  // 側面図の下端（用紙のy）がどこまで下がってよいか：
  //  右側の寸法（面取りなど）は表題欄の上 y≦183 まで。左寄りの斜めの寸法は表題欄より左なら y≦194 まで
  const bottomLimit = (s, footX) => {
    const a = 183 - pad.b;
    // 斜めの線は足から45°で右上へ上がるので、表題欄の角（x=149, y=185）に届かない深さまで
    const b = ex ? Math.min(194, 183 + Math.max(0, 146 - footX)) - (ex * s + 6) : a;
    return Math.min(a, b);
  };
  // 上下に並べたときの配置（入らなければ null）
  const stacked = (s) => {
    if (depth * s > aw) return null;
    const ox = area.x + pad.l + (aw - depth * s) / 2;
    const lim = bottomLimit(s, ox + D / 2 * s);
    const h = W * s + pad.mid + H * s;                                // 平面図の上端〜側面図の下端
    const top0 = area.y + pad.t;
    if (top0 + h > lim) return null;
    const ty = top0 + Math.min((lim - top0 - h) / 2, 8);              // 余りは少しだけ下げる（上寄せ気味）
    return { Mt: viewMap(s, ox, ty + W * s, 0, 0), Ms: viewMap(s, ox, ty + h, 0, 0) };
  };
  // 左右に並べたときの配置（幅の広い箱向け。2つの図の下端をそろえる）
  const sideways = (s) => {
    const gap = pad.mid + pad.r;
    if (2 * depth * s + gap > aw) return null;
    const ox = area.x + pad.l + (aw - 2 * depth * s - gap) / 2;
    const lim = bottomLimit(s, ox + depth * s + gap + D / 2 * s);
    const h = Math.max(W, H) * s, top0 = area.y + pad.t;
    if (top0 + h > lim) return null;
    const by = top0 + h + Math.min((lim - top0 - h) / 2, 8);
    return { Mt: viewMap(s, ox, by, 0, 0), Ms: viewMap(s, ox + depth * s + gap, by, 0, 0) };
  };
  // 大きい縮尺から順に、入る並べ方を探す（上下を優先）
  let s = SCALES[SCALES.length - 1], lay = null;
  for (const sc of SCALES) { lay = stacked(sc) || sideways(sc); if (lay) { s = sc; break; } }
  if (!lay) lay = stacked(s) || sideways(s) || (() => { const ox = area.x + pad.l; return { Mt: viewMap(s, ox, area.y + pad.t + W * s, 0, 0), Ms: viewMap(s, ox, area.y + pad.t + (W + H) * s + pad.mid, 0, 0) }; })();
  const { Mt, Ms } = lay;

  sh.text([12, 13], '総合図（平面図・右側面図）', { size: 4, anchor: 'start', weight: 'bold' });
  sh.reserve(textRect([12, 13], '総合図（平面図・右側面図）', 4, 'start'));
  sh.reserve({ x0: 149, y0: 185, x1: 292, y1: 205 });
  sh.reserve({ x0: 9, y0: 197, x1: 80, y1: 203 });
  sh.zone = { x0: 8, x1: 195, y0: 8, y1: 196 };
  drawLines(sh, Mt, Lp); drawLines(sh, Ms, Ls);

  // 平面図
  dim(sh, Mt, [0, W], [depth, W], 'h', -6, fmt(depth));                 // 全奥行
  dim(sh, Mt, [depth, 0], [depth, W], 'v', 8);                           // 幅
  const u1 = H / 2 + y0 + Lt * 0.42, u2 = u1 + 8 / s;
  dim(sh, Mt, [u1, t], [u1, W - t], 'v', 0.001, `${fmt(W - 2 * t)} 内寸`);
  dim(sh, Mt, [u2, t - g], [u2, W - t + g], 'v', 0.001, `${fmt(2 * e)} 底板`);
  dim(sh, Mt, [H / 2 + y0, W * 0.28], [H / 2 + y0 + Lt, W * 0.28], 'h', 0.001, `底板 ${fmt(Lt)}`);

  // 右側面図
  dim(sh, Ms, [H / 2, H], [depth, H], 'h', -6, fmt(D));                 // 上端の奥行
  dim(sh, Ms, [depth, 0], [depth, H], 'v', 8);                           // 高さ
  dim(sh, Ms, [0, H / 2], [H / 2, 0], 'v', -6, fmt(H / 2));             // 先端の高さ
  dim(sh, Ms, [0, H / 2], [H / 2, H], 'a', 4, fmt(H / S2));             // 側板の上の斜め
  dim(sh, Ms, [0, H / 2], [H / 2 + t / S2, -t / S2], 'a', -6, fmt(H / S2 + t)); // 前板の幅
  // 前の下の斜面（y+z=0）から背面の上の角まで、斜面に直角に測った距離
  // 背面の上の角から斜面に下ろした足が箱の下に出るとき（D > H）は、斜面を延ばした補助線を描く
  const zFoot = (H - D) / 2;
  if (zFoot < 0) {
    const P = Ms([H / 2, 0]), Q = Ms([D / 2, zFoot]);
    const u = [Q[0] - P[0], Q[1] - P[1]], L = Math.hypot(...u);
    const R = [Q[0] + u[0] / L * 1.5, Q[1] + u[1] / L * 1.5];
    sh.line([P[0] + u[0] / L * 0.8, P[1] + u[1] / L * 0.8], R, 'dim'); sh.segs.push([P, R]);
  }
  // 数字は箱の外（下）に出ている部分の真ん中に置く。出ていなければ中央
  const f0 = zFoot < 0 ? -zFoot / (H - zFoot) : 0;
  const atD = f0 * (H - zFoot) / S2 * s > textW(fmt((D + H) / S2), 2.8) + 4 ? f0 / 2 : 0.5;
  dim(sh, Ms, [D / 2, zFoot], [depth, H], 'a', 0.001, fmt((D + H) / S2), atD);
  // 底板の長さ（前端〜背板の溝の奥）
  dim(sh, Ms, [H / 2 + y0, t], [H / 2 + D - t + g, t], 'h', -Math.min(10, (H - t) * s * 0.35), `底板 ${fmt(Lt)}`);
  const ui = H / 2 + D * 0.62;
  // 下の「底板」の数字を避けて上寄りに。線が短くて「深さ」が入らないときは数字だけ
  const dl = (H - t) * s > textW(`深さ ${fmt(H - t)}`, 2.8) + 4 ? `深さ ${fmt(H - t)}` : fmt(H - t);
  dim(sh, Ms, [ui, t], [ui, H], 'v', 0.001, dl, [0.68, 0.3, 0.85, 0.15]);
  const uf = H / 2 + D * 0.3;
  dim(sh, Ms, [uf, 0], [uf, t], 'v', 0.001, fmt(t));                    // 底板の上面の高さ
  dim(sh, Ms, [uf + 7 / s, t - g], [uf + 7 / s, t], 'v', 0.001, fmt(g)); // 溝の幅＝底板の厚さ
  dim(sh, Ms, [depth - t, H * 0.45], [depth, H * 0.45], 'h', 0.001, fmt(t)); // 背板の厚さ
  dim(sh, Ms, [depth - t, t - g], [depth - t + g, t - g], 'h', -4 - g * s, fmt(g)); // 溝の深さ
  dim(sh, Ms, [depth - c, 0], [depth, 0], 'h', 6, fmt(c));             // 面取り
  note(sh, Mt, [H / 4, W * 0.85], -4, -8, '前（取り出し口）');

  // 立体図：左の区画で、線にも文字にもかからない場所があれば置く（なければ省く）
  if (isoImage) {
    // 大きめ → 小さめの順に、四隅の空いたところを探す
    const tries = [];
    for (const [iw, ih] of [[44, 33], [34, 26]]) {
      for (const [x, y] of [[194 - iw, 15], [10, 16], [10, 183 - ih], [148 - iw, 183 - ih]]) tries.push({ x0: x, y0: y, x1: x + iw, y1: y + ih });
    }
    const sp = tries.find((r) => sh.fits(r, true));
    if (sp) {
      sh.reserve(sp);
      sh.raw(`<image href="${isoImage}" x="${sp.x0}" y="${sp.y0}" width="${sp.x1 - sp.x0}" height="${sp.y1 - sp.y0}" preserveAspectRatio="xMidYMid meet"/>`);
    }
  }

  // 寸法一覧
  sh.zone = { x0: 196, x1: 291, y0: 8, y1: 184 };
  let y = 17;
  sh.text([198, y], '寸法一覧（mm）', { size: 3.2, anchor: 'start', weight: 'bold' });
  y += 1;
  const rows = [
    ['外寸 幅×奥行×高さ', `${fmt(W)}×${fmt(depth)}×${fmt(H)}`],
    ['上端の奥行（背面まで）', fmt(D)],
    ['内寸 幅×奥行(底面)', `${fmt(W - 2 * t)}×${fmt(D - t * S2)}`],
    ['深さ（底板の上から）', fmt(H - t)],
    ['内奥行 最大（前板の上端）', fmt(depth - t * (1 + 1 / S2))],
    ['前板の上端の高さ', fmt(H / 2 + t / S2)],
    ['前の斜面〜背面の上の角（直角に）', fmt((D + H) / S2)],
    ['底板 長さ×幅×厚さ', `${fmt(Lt)}×${fmt(2 * e)}×${fmt(g)}`],
    ['板厚', fmt(t)],
    ['溝 幅×深さ（下端から）', `${fmt(g)}×${fmt(g)}（${fmt(t - g)}〜${fmt(t)}）`],
    ['面取り（底の外・上の内）', fmt(c)],
    ['積み重ね1段', fmt(v.stackPitch)],
  ];
  rows.forEach(([a, b]) => {
    y += 4.4;
    sh.text([198, y], a, { size: 2.4, anchor: 'start' });
    sh.text([289, y], b, { size: 2.5, anchor: 'end', weight: 'bold' });
    sh.line([198, y + 1.2], [289, y + 1.2], 'thin');
  });
  y += 8;
  y = kidoriBlock(sh, v, kopt, y) + 7;
  // 注記（部材図・組立図にあった加工の要点）
  sh.text([198, y], '注記', { size: 3.2, anchor: 'start', weight: 'bold' });
  [
    '・四隅（側板と背板・側板と前板）はすべて45°の留め。',
    `・溝 ${fmt(g)}×${fmt(g)} は側板・背板の内側、下端から ${fmt(t - g)}〜${fmt(t)} に`,
    '  端から端まで通す。',
    '・底板は溝に入れ、前端は45°に削って前板の内面に突き付け。',
    `・底の外側と上の内側を ${fmt(c)} 面取り。積み重ねると噛み合う（1段 ${fmt(v.stackPitch)}）。`,
    '・前板の下端は45°（水平に置ける）、上端は直角。前板の幅は側面図の斜めの寸法。',
  ].forEach((m) => { y += 3.6; sh.text([198, y], m, { size: 2.2, anchor: 'start' }); });
  sh.line([196, 12], [196, 184], 'thin');
  titleBlock(sh, '総合図', '一式', scaleLabel(s), v, params);
  legend(sh);
  return sh.svg();
}

// ---------- 木取り（図面の右の列：x 198〜289） ----------
function kidoriBlock(sh, v, kopt, y) {
  const lay = layoutBoards(v, kopt || {});
  const sm = kidoriSummary(lay);
  const m = lay.main;
  sh.text([198, y], `木取り（残しろ ${fmt(lay.allow)}mm 込み）`, { size: 3.2, anchor: 'start', weight: 'bold' });
  y += 5.5;
  sh.text([198, y], sm.main, { size: 2.6, anchor: 'start', weight: 'bold' });
  y += 3;
  const k = Math.min(91 / m.length, 18 / m.B);   // 板の図の縮尺
  sh.raw(boardSVG(lay, 198, y, k, { size: Math.max(1.5, Math.min(2.2, m.B * k * 0.22)) }));
  y += m.B * k + 9.5; // 図の下の「木目の向き」の分をあける
  sh.text([198, y], sm.bottom, { size: 2.6, anchor: 'start' });
  y += 2.5;
  // 底板の板（上の板と同じ縮尺。入らなければ縮める）
  const b = lay.bottom, kb = Math.min(k, 91 / b.length, 14 / b.B);
  sh.raw(boardSVG(lay, 198, y, kb, { size: Math.max(1.5, Math.min(2.2, b.B * kb * 0.22)), which: 'bottom' }));
  y += b.B * kb + 9;
  sh.text([198, y], '太線＝外形（仕上がり）、破線＝切り出す大きさ。数字は仕上がり寸法。', { size: 2.1, anchor: 'start' });
  return y;
}
