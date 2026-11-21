// パーツ箱の形状計算（Three.jsに依存しない純粋なJS）
// 座標系: x = 幅方向, y = 奥行方向（マイナスが前）, z = 高さ（上が＋）, 単位 mm

const EPS = 1e-7;
const S2 = Math.SQRT2;

// ---------- パラメータ ----------
export const DEFAULTS = { d: 140, dx: 1, dy: 1, dz: 1, t: 12, gRatio: 1 / 3, cRatio: 2 / 3 };

export function derive(p) {
  const W = p.d * p.dx;      // 外幅
  const D = p.d * p.dy;      // 後ろの四角い部分の奥行（尖り先端を除く）
  const H = p.d * p.dz;      // 高さ
  const t = p.t;             // 板厚
  const g = t * p.gRatio;    // 溝の幅・深さ ＝ 底板の厚さ
  const c = t * p.cRatio;    // 面取り
  return {
    W, D, H, t, g, c,
    depth: D + H / 2,                 // 全体の奥行
    frontLen: H / S2,                 // 前板（外側の面）の長さ
    stackPitch: H + t - 2 * c,        // 積み重ねたときの1段の高さ
  };
}

export function validate(v) {
  const w = [];
  if (v.t <= 0 || v.W <= 0 || v.D <= 0 || v.H <= 0) w.push('寸法と板厚は正の値にしてください。');
  if (v.W < 2 * v.t + 10) w.push('幅が板厚に対して狭すぎます（幅 ≧ 板厚×2＋10mm 目安）。');
  // 内奥行（底面）が板厚より短いと、前板の下端が背板に食い込む
  if (v.D - v.t * S2 < Math.max(10, v.t)) w.push(`奥行が短すぎて底板が入りません（底面の内奥行 ≧ ${Math.max(10, v.t)}mm にしてください）。`);
  if (v.H / 2 < v.t * 2) w.push('高さが低すぎて前板が作れません（高さ ≧ 板厚×4 目安）。');
  if (v.g >= v.t * 0.6) w.push('溝が深すぎます（板厚の6割未満にしてください）。');
  if (v.c >= v.t) w.push('面取りが板厚以上です。');
  if (v.c < v.t - v.g - 1e-6) w.push('面取りが小さいため、積み重ねたときに噛み合いません（面取り ≧ 板厚 − 溝 にすると噛み合います）。');
  return w;
}

// ---------- ベクトル ----------
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };
export const V = { sub, add, mul, dot, cross, norm };

// 半空間 n·p <= k（nは正規化する）
function hs(n, k) { const l = Math.hypot(...n); return { n: [n[0] / l, n[1] / l, n[2] / l], k: k / l }; }

// ---------- 凸多面体の切断 ----------
function boxPoly(s) {
  const P = (x, y, z) => [x * s, y * s, z * s];
  const q = (a, b, c, d) => ({ pts: [a, b, c, d], tag: null });
  const v = [P(-1, -1, -1), P(1, -1, -1), P(1, 1, -1), P(-1, 1, -1), P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1)];
  return [
    q(v[0], v[3], v[2], v[1]), q(v[4], v[5], v[6], v[7]), q(v[0], v[1], v[5], v[4]),
    q(v[2], v[3], v[7], v[6]), q(v[1], v[2], v[6], v[5]), q(v[0], v[4], v[7], v[3]),
  ];
}

function clip(faces, plane, tag) {
  const out = [];
  const cap = [];
  for (const f of faces) {
    const pts = f.pts, res = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const da = dot(plane.n, a) - plane.k, db = dot(plane.n, b) - plane.k;
      if (da <= EPS) res.push(a);
      if ((da < -EPS && db > EPS) || (da > EPS && db < -EPS)) {
        const p = add(a, mul(sub(b, a), da / (da - db)));
        res.push(p); cap.push(p);
      } else if (Math.abs(da) <= EPS) cap.push(a);
    }
    const r = dedupe(res);
    if (r.length >= 3) out.push({ pts: r, tag: f.tag });
  }
  const c = orderCap(dedupe(cap), plane.n);
  if (c.length >= 3) out.push({ pts: c, tag });
  return out;
}

function dedupe(pts) {
  const r = [];
  for (const p of pts) {
    if (!r.some((q) => Math.abs(q[0] - p[0]) < 1e-6 && Math.abs(q[1] - p[1]) < 1e-6 && Math.abs(q[2] - p[2]) < 1e-6)) r.push(p);
  }
  return r;
}

function orderCap(pts, n) {
  if (pts.length < 3) return pts;
  const c = mul(pts.reduce((s, p) => add(s, p), [0, 0, 0]), 1 / pts.length);
  const a = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = norm(cross(n, a)), w = cross(n, u);
  return pts
    .map((p) => ({ p, ang: Math.atan2(dot(sub(p, c), w), dot(sub(p, c), u)) }))
    .sort((x, y) => x.ang - y.ang)
    .map((o) => o.p);
}

function convex(planes) {
  let f = boxPoly(1e5);
  planes.forEach((pl) => { f = clip(f, pl, pl.tag || null); });
  return f;
}

const inside = (planes, p, tol = 1e-6) => planes.every((pl) => dot(pl.n, p) - pl.k <= tol);

// 凸形状 base から溝（groove: 半空間の組）を取り除いた「セル」の集合を作る
// 溝 = base ∩ {depth面の内側} ∩ {lo <= 帯 <= hi}
function withGroove(base, groove) {
  if (!groove) return [convex(base)];
  const { depth, bandLo, bandHi } = groove; // それぞれ半空間（溝の側を表す）
  const flip = (pl) => ({ n: mul(pl.n, -1), k: -pl.k, tag: 'split' });
  const tagS = (pl) => ({ ...pl, tag: 'split' });
  const cells = [];
  for (const sideD of [tagS(depth), flip(depth)]) {
    for (const band of [[flip(bandLo)], [tagS(bandLo), tagS(bandHi)], [flip(bandHi)]]) {
      cells.push({ planes: [...base, sideD, ...band], groovePart: false });
    }
  }
  // 1番目のdepth側（溝側）× 帯の真ん中 が溝そのもの
  cells[1].groovePart = true;
  const grooveRegion = [...base, depth, bandLo, bandHi];
  return cells.filter((c) => !c.groovePart).map((c) => {
    const faces = convex(c.planes);
    // 分割面上の面は、外側が溝ならば見える面、そうでなければ内部の面
    faces.forEach((f) => {
      if (f.tag === 'split') {
        const n = faceNormal(f.pts);
        const cen = centroid(f.pts);
        f.internal = !inside(grooveRegion, add(cen, mul(n, 1e-3)));
      }
    });
    return faces;
  });
}

export function faceNormal(pts) {
  let n = [0, 0, 0];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    n = add(n, [(a[1] - b[1]) * (a[2] + b[2]), (a[2] - b[2]) * (a[0] + b[0]), (a[0] - b[0]) * (a[1] + b[1])]);
  }
  return norm(n);
}
const centroid = (pts) => mul(pts.reduce((s, p) => add(s, p), [0, 0, 0]), 1 / pts.length);

function volumeOf(cells) {
  let v = 0;
  for (const faces of cells) for (const f of faces) {
    const p = f.pts;
    for (let i = 1; i < p.length - 1; i++) v += dot(p[0], cross(p[i], p[i + 1])) / 6;
  }
  return Math.abs(v);
}

// 見える面だけを集め、形状の稜線（向きが変わる辺）を求める
function buildPart(cells) {
  const faces = [];
  cells.forEach((fs) => fs.forEach((f) => { if (!f.internal) faces.push({ pts: f.pts, n: faceNormal(f.pts) }); }));
  const key = (p) => p.map((x) => Math.round(x * 1e4)).join(',');
  const map = new Map();
  faces.forEach((f, fi) => {
    for (let i = 0; i < f.pts.length; i++) {
      const a = f.pts[i], b = f.pts[(i + 1) % f.pts.length];
      const ka = key(a), kb = key(b);
      if (ka === kb) continue;
      const k = ka < kb ? ka + '|' + kb : kb + '|' + ka;
      if (!map.has(k)) map.set(k, { a, b, faces: [] });
      map.get(k).faces.push(fi);
    }
  });
  const edges = [];
  for (const e of map.values()) {
    if (e.faces.length === 1) { edges.push({ a: e.a, b: e.b }); continue; }
    const n0 = faces[e.faces[0]].n;
    if (e.faces.some((fi) => dot(faces[fi].n, n0) < 0.9999)) edges.push({ a: e.a, b: e.b });
  }
  return { faces, edges, volume: volumeOf(cells), cells };
}

// ---------- 部材の定義 ----------
export function buildBox(params) {
  const v = derive(params);
  const { W, D, H, t, g, c } = v;
  const hw = W / 2;
  const parts = [];

  // 側板（右: x>0）。 s = +1 右, -1 左
  for (const s of [1, -1]) {
    const X = (n) => [n[0] * s, n[1], n[2]];
    const base = [
      hs(X([1, 0, 0]), hw),                       // 外面
      hs(X([-1, 0, 0]), -(hw - t)),               // 内面
      hs([0, 0, -1], 0),                          // 下端
      hs([0, 0, 1], H),                           // 上端
      hs(X([-1, 1, 0]), D - hw),                  // 背板との留め  y - x <= D - W/2
      hs([0, -1, 1], H),                          // 上の斜め（取り出し口）
      hs(X([-1, -1 / S2, -1 / S2]), -hw),         // 前板との留め  (y+z)/√2 + x >= W/2
      hs(X([1, 0, -1]), hw - c),                  // 底の外側の面取り
      hs(X([-1, 0, 1]), H - hw + t - c),          // 上の内側の面取り
    ];
    const groove = {
      depth: hs(X([1, 0, 0]), hw - t + g),        // |x| <= W/2 - t + g（内面から深さ g）
      bandLo: hs([0, 0, -1], -(t - g)),           // z >= t - g
      bandHi: hs([0, 0, 1], t),                   // z <= t
    };
    parts.push({ id: s > 0 ? 'sideR' : 'sideL', name: s > 0 ? '側板（右）' : '側板（左）', group: 'side', ...buildPart(withGroove(base, groove)), outward: [s, 0, 0] });
  }

  // 背板
  {
    const base = [
      hs([0, 1, 0], D), hs([0, -1, 0], -(D - t)),
      hs([0, 0, -1], 0), hs([0, 0, 1], H),
      hs([1, -1, 0], -(D - hw)),                   // y - x >= D - W/2
      hs([-1, -1, 0], -(D - hw)),                  // y + x >= D - W/2
      hs([0, 1, -1], D - c),                       // 底の外側の面取り
      hs([0, -1, 1], H - D + t - c),               // 上の内側の面取り
    ];
    const groove = { depth: hs([0, 1, 0], D - t + g), bandLo: hs([0, 0, -1], -(t - g)), bandHi: hs([0, 0, 1], t) };
    parts.push({ id: 'back', name: '背板', group: 'back', ...buildPart(withGroove(base, groove)), outward: [0, 1, 0] });
  }

  // 前板（45°に傾いた板）
  {
    const base = [
      hs([0, -1, -1], 0),                          // 外面  y+z >= 0
      hs([0, 1, 1], t * S2),                       // 内面  y+z <= t√2
      hs([0, 0, -1], 0),                           // 下端（水平に切る）
      hs([0, -1, 1], H),                           // 上端（直角）
      hs([1, 1 / S2, 1 / S2], hw),                 // 右の留め
      hs([-1, 1 / S2, 1 / S2], hw),                // 左の留め
      hs([1, 0, -1], hw - c),                      // 角の面取り（側板の面取りの延長）
      hs([-1, 0, -1], hw - c),
    ];
    parts.push({ id: 'front', name: '前板', group: 'front', ...buildPart([convex(base)]), outward: [0, -1, -1] });
  }

  // 底板
  {
    const e = hw - t + g;
    const base = [
      hs([1, 0, 0], e), hs([-1, 0, 0], e),
      hs([0, 0, -1], -(t - g)), hs([0, 0, 1], t),
      hs([0, 1, 0], D - t + g),
      hs([0, -1, -1], -t * S2),                    // 前板の内面に沿って45°
    ];
    parts.push({ id: 'bottom', name: '底板', group: 'bottom', ...buildPart([convex(base)]), outward: [0, 0, -1] });
  }

  return { v, parts };
}

// ---------- 部材表（木取り寸法） ----------
export function cutList(v) {
  const { W, D, H, t, g } = v;
  return [
    { name: '側板', qty: 2, L: D + H / 2, Wd: H, T: t, note: '左右対称。前は45°に尖る五角形' },
    { name: '背板', qty: 1, L: W, Wd: H, T: t, note: '両端45°留め' },
    { name: '前板', qty: 1, L: W, Wd: H / S2 + t, T: t, note: '両端45°留め、下端45°' },
    { name: '底板', qty: 1, L: W - 2 * t + 2 * g, Wd: D + g - t * S2, T: g, note: '前端45°' },
  ];
}
