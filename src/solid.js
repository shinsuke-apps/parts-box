// 3Dプリント用：箱を「一塊」のすき間のない立体にして STL で書き出す
// 部材を積み上げるのではなく、外形（凸）から内側の空間（凸の組）を引いて作る。
// そのため部材どうしの継ぎ目の面はなく、溝が前の留めに抜ける小さな穴も埋まる。
import { convex, hs, derive, faceNormal } from './geometry.js?v=20261122s';

const S2 = Math.SQRT2;
const EPS = 1e-6;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// 外形と、そこから引く空間（どれも半空間 n·p<=k の組＝凸）
// fillFloor: 底板の下のすき間を埋める（3Dプリントで底を支えなしで刷れるように）
export function solidSpec(v, { fillFloor = true } = {}) {
  const { W, D, H, t, g, c } = v;
  const hw = W / 2;
  const outer = [
    hs([1, 0, 0], hw), hs([-1, 0, 0], hw), hs([0, 1, 0], D),
    hs([0, -1, -1], 0),            // 前の下の斜面
    hs([0, -1, 1], H),             // 前の上の斜め（取り出し口）
    hs([0, 0, -1], 0), hs([0, 0, 1], H),
    hs([1, 0, -1], hw - c), hs([-1, 0, -1], hw - c), hs([0, 1, -1], D - c), // 底の外側の面取り
  ];
  const inner = (z0, z1, front) => [
    hs([1, 0, 0], hw - t), hs([-1, 0, 0], hw - t), hs([0, 1, 0], D - t),
    front,
    hs([0, 0, -1], -z0), hs([0, 0, 1], z1),
  ];
  const cutters = [inner(t, H + 10, hs([0, -1, -1], -t * S2))]; // 底板の上〜縁（前は前板の内面、上は開いている）
  // 底板の下のすき間。前の壁は前板の内面（y+z=t√2）ではなく、逆向きの45°（y−z=t√2）にする。
  // 後ろ板を下にして刷ると、前板の内面のままでは壁が箱の底の縁（支えのない所）から張り出し始め、
  // 最初の1本が側板どうしに掛かる橋になる。逆向きなら底板の下の面から張り出し始めるので支えなしで刷れる。
  // 底の縁では前から t−c の位置。側板・背板は外側の面取り c の内側に平らな縁 t−c が残るので、
  // 前（面取りの代わりに斜面がある）の平らな縁も t−c にして、下から見た幅をそろえる。
  if (!fillFloor) cutters.push(inner(-10, t - g, hs([0, -1, 1], -(t - c))));
  // 上の内側の面取り（側板）。留めの面で背板の面取りと分ける
  for (const s of [1, -1]) {
    const X = (n) => [n[0] * s, n[1], n[2]];
    cutters.push([
      hs(X([1, 0, -1]), hw - t - H + c),
      hs(X([-1, 0, 0]), -(hw - t - 1)),
      hs(X([-1, 1, 0]), D - hw),
      hs(X([-1, -1 / S2, -1 / S2]), -hw),
    ]);
  }
  // 上の内側の面取り（背板）
  cutters.push([
    hs([0, 1, -1], D - t - H + c),
    hs([0, -1, 0], -(D - t - 1)),
    hs([1, -1, 0], -(D - hw)),
    hs([-1, -1, 0], -(D - hw)),
  ]);
  return { outer, cutters };
}

// 多角形を半空間 n·p<=k で切って内側を残す
function clipKeep(pts, pl) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const da = dot(pl.n, a) - pl.k, db = dot(pl.n, b) - pl.k;
    if (da <= EPS) out.push(a);
    if ((da < -EPS && db > EPS) || (da > EPS && db < -EPS)) out.push(add(a, mul(sub(b, a), da / (da - db))));
  }
  const r = [];
  out.forEach((p) => { if (!r.length || Math.hypot(...sub(p, r[r.length - 1])) > 1e-7) r.push(p); });
  if (r.length > 1 && Math.hypot(...sub(r[0], r[r.length - 1])) < 1e-7) r.pop();
  return r;
}
const flip = (pl) => ({ n: mul(pl.n, -1), k: -pl.k });
function area(pts) {
  let s = [0, 0, 0];
  for (let i = 1; i < pts.length - 1; i++) s = add(s, cross(sub(pts[i], pts[0]), sub(pts[i + 1], pts[0])));
  return Math.hypot(...s) / 2;
}
const coplanar = (pts, pl) => pts.every((p) => Math.abs(dot(pl.n, p) - pl.k) < 1e-5);

// 面（法線 n は「材料 → 空き」の向き）の後ろ側が凸 C の中にあるかを、面と同じ平面の扱いも含めて判定するための平面リスト
// 返り値 null: 面は C の外（後ろ側が C に入らない）
function effPlanes(pts, n, planes) {
  const eff = [];
  for (const pl of planes) {
    if (coplanar(pts, pl)) { if (dot(pl.n, n) > 0.99) continue; return null; }
    eff.push(pl);
  }
  return eff;
}
// 面 ∩ C
function intersect(pts, n, planes) {
  const eff = effPlanes(pts, n, planes);
  if (!eff) return [];
  let cur = pts;
  for (const pl of eff) { cur = clipKeep(cur, pl); if (cur.length < 3) return []; }
  return area(cur) > 1e-9 ? [cur] : [];
}
// 面 − C（凸なので、平面ごとに外側の部分を順に切り出す）
function subtract(pts, n, planes) {
  const eff = effPlanes(pts, n, planes);
  if (!eff) return [pts];
  if (eff.some((pl) => pts.every((p) => dot(pl.n, p) - pl.k >= -EPS))) return [pts];
  const out = [];
  let cur = pts;
  for (const pl of eff) {
    const o = clipKeep(cur, flip(pl));
    if (o.length >= 3 && area(o) > 1e-9) out.push(o);
    cur = clipKeep(cur, pl);
    if (cur.length < 3) break;
  }
  return out;
}

// 凸多面体の面を、外向きにそろえて返す
function outwardFaces(planes) {
  const faces = convex(planes);
  const all = faces.flatMap((f) => f.pts);
  const cen = mul(all.reduce((s, p) => add(s, p), [0, 0, 0]), 1 / all.length);
  return faces.map((f) => {
    let pts = f.pts, n = faceNormal(pts);
    const fc = mul(pts.reduce((s, p) => add(s, p), [0, 0, 0]), 1 / pts.length);
    if (dot(n, sub(fc, cen)) < 0) { pts = pts.slice().reverse(); n = mul(n, -1); }
    return { pts, n };
  });
}

// 立体の表面（多角形）を作る
export function solidPolygons(v, opt) {
  const { outer, cutters } = solidSpec(v, opt);
  const polys = [];
  const carve = (pieces, n, skip) => {
    cutters.forEach((C, ci) => { if (ci !== skip) pieces = pieces.flatMap((p) => subtract(p, n, C)); });
    pieces.forEach((pts) => polys.push({ pts, n }));
  };
  outwardFaces(outer).forEach((f) => carve([f.pts], f.n, -1));
  cutters.forEach((C, ci) => outwardFaces(C).forEach((f) => {
    const pts = f.pts.slice().reverse(), n = mul(f.n, -1);        // 空間の面は材料から見て裏返し
    carve(intersect(pts, n, outer), n, ci);
  }));
  return polys;
}

// T字の継ぎ目（辺の途中に別の面の頂点がある）を分けて、すき間のない三角形にする
export function solidTriangles(v, opt) {
  const polys = solidPolygons(v, opt);
  const verts = [];
  const key = (p) => p.map((x) => Math.round(x * 1e4)).join(',');
  const seen = new Map();
  polys.forEach((P) => P.pts.forEach((p) => { const k = key(p); if (!seen.has(k)) { seen.set(k, p); verts.push(p); } }));
  const snap = (p) => seen.get(key(p));
  const tris = [];
  polys.forEach((P) => {
    const ring = [];
    const pts = P.pts.map(snap);
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      ring.push(a);
      const ab = sub(b, a), L2 = dot(ab, ab);
      if (L2 < 1e-12) continue;
      const mids = [];
      for (const q of verts) {
        if (q === a || q === b) continue;
        const s = dot(sub(q, a), ab) / L2;
        if (s <= 1e-6 || s >= 1 - 1e-6) continue;
        const d = sub(q, add(a, mul(ab, s)));
        if (dot(d, d) < 1e-8) mids.push({ q, s });
      }
      mids.sort((x, y) => x.s - y.s).forEach((m) => ring.push(m.q));
    }
    if (ring.length === 3) { tris.push([ring[0], ring[1], ring[2]]); return; }
    // 凸多角形なので、中心から扇形に分ける（辺の途中の頂点があっても細い三角形が潰れない）
    const c = mul(ring.reduce((s, p) => add(s, p), [0, 0, 0]), 1 / ring.length);
    for (let i = 0; i < ring.length; i++) tris.push([c, ring[i], ring[(i + 1) % ring.length]]);
  });
  return tris;
}

// 確かめ用：体積と、すべての辺がちょうど2枚の三角形で逆向きに使われているか
export function checkSolid(tris) {
  let vol = 0;
  const key = (p) => p.map((x) => Math.round(x * 1e4)).join(',');
  const E = new Map();
  for (const [a, b, c] of tris) {
    vol += dot(a, cross(b, c)) / 6;
    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      const k = key(p) + '>' + key(q);
      E.set(k, (E.get(k) || 0) + 1);
    }
  }
  let bad = 0;
  for (const [k, n] of E) {
    const [p, q] = k.split('>');
    if (n !== 1 || E.get(q + '>' + p) !== 1) bad++;
  }
  return { volume: vol, triangles: tris.length, badEdges: bad };
}

// 刷る向き：後ろ板を下（造形台）にして、前が上を向く向きに回す（Z が上）。
// (x, y, z) → (x + W/2, z, D − y)。回転なので面の向き（表裏）は変わらない。
// 造形台の上では 幅 W × 奥行 H、高さ（Z）は全奥行 D + H/2 になる
export function toPrint(v, p) { return [p[0] + v.W / 2, p[2], v.D - p[1]]; }
export function printTriangles(v, opt) { return solidTriangles(v, opt).map((t) => t.map((p) => toPrint(v, p))); }

// バイナリ STL（単位 mm）。刷る向き（後ろ板が下）で、すべての座標が 0 以上になるように置く
export function solidSTL(params, opt) {
  const v = derive(params);
  const tris = printTriangles(v, opt);
  const off = [0, 0, 0];
  const buf = new ArrayBuffer(84 + tris.length * 50);
  const dv = new DataView(buf);
  const head = 'parts-box (Shinsuke Kato) - mm';
  for (let i = 0; i < 80; i++) dv.setUint8(i, i < head.length ? head.charCodeAt(i) : 0);
  dv.setUint32(80, tris.length, true);
  let o = 84;
  for (const t of tris) {
    const [a, b, c] = t.map((p) => add(p, off));
    const n = cross(sub(b, a), sub(c, a)), l = Math.hypot(...n) || 1;
    [n[0] / l, n[1] / l, n[2] / l, ...a, ...b, ...c].forEach((x) => { dv.setFloat32(o, x, true); o += 4; });
    dv.setUint16(o, 0, true); o += 2;
  }
  return new Blob([buf], { type: 'model/stl' });
}
