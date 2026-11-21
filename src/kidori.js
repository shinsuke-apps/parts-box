// 木取り：どれだけの大きさの板があれば部材が取れるか
// 側板・背板・前板は板厚 t の板から、底板は厚さ g の板から取る。
// 木目はすべて部材の長さ方向（箱のまわりを水平に回る向き）。部材ごとに残しろ a を長さ・幅に足す。
import { cutList } from './geometry.js?v=20261122w';

export const KIDORI_DEFAULTS = { boardW: 0, allow: 3 }; // boardW 0 = 必要な最小の幅

// 集合の分け方をすべて並べる（部材は4枚なので15通り）
function partitions(arr) {
  if (!arr.length) return [[]];
  const [first, ...rest] = arr;
  const out = [];
  for (const p of partitions(rest)) {
    out.push([[first], ...p]);
    p.forEach((_, i) => out.push(p.map((g, j) => (j === i ? [first, ...g] : g))));
  }
  return out;
}

// 部材の外形（板の面で見た形）。x は長さ方向（木目）、y は幅方向（下向き）、仕上がり寸法で 0〜L, 0〜Wd
function shapeOf(r, v) {
  if (r.name === '側板') {
    // 前が高さの半分で尖る五角形（上下対称なので左右の側板とも同じ形）
    const L = r.L, H = r.Wd;
    return [[0, H / 2], [H / 2, 0], [L, 0], [L, H], [H / 2, H]];
  }
  return [[0, 0], [r.L, 0], [r.L, r.Wd], [0, r.Wd]];
}

export function layoutBoards(v, opt = {}) {
  const a = opt.allow ?? KIDORI_DEFAULTS.allow;
  const rows = cutList(v);
  const items = [];
  rows.filter((r) => r.T === v.t).forEach((r) => {
    for (let i = 0; i < r.qty; i++) items.push({ name: r.name, L: r.L, Wd: r.Wd, bl: r.L + a, bw: r.Wd + a, shape: shapeOf(r, v) });
  });
  const minW = Math.max(...items.map((p) => p.bw));
  const asked = opt.boardW || 0;
  const B = Math.max(asked || minW, minW);
  // 幅に収まる分け方のうち、板の長さがいちばん短いもの（同じなら切る回数が少ないもの）
  let best = null;
  for (const p of partitions(items)) {
    if (p.some((g) => g.reduce((s, x) => s + x.bw, 0) > B + 1e-9)) continue;
    const len = p.reduce((s, g) => s + Math.max(...g.map((x) => x.bl)), 0);
    if (!best || len < best.len - 1e-9 || (Math.abs(len - best.len) < 1e-9 && p.length < best.p.length)) best = { p, len };
  }
  // 長い順に左から並べ、同じ列の中は幅の広い順に上から重ねる
  const groups = best.p.map((g) => g.slice().sort((x, y) => y.bw - x.bw)).sort((g1, g2) => Math.max(...g2.map((x) => x.bl)) - Math.max(...g1.map((x) => x.bl)));
  let x = 0;
  const placed = [];
  groups.forEach((g) => {
    let y = 0;
    const gl = Math.max(...g.map((p) => p.bl));
    g.forEach((p) => { placed.push({ ...p, x, y }); y += p.bw; });
    x += gl;
  });
  const bot = rows.find((r) => r.T !== v.t) || rows[3];
  // 底板は長い辺を木目に。板は底板1枚ぶん（残しろ込み）
  const bL = Math.max(bot.L, bot.Wd), bW = Math.min(bot.L, bot.Wd);
  const bp = { name: '底板', L: bL, Wd: bW, bl: bL + a, bw: bW + a, x: 0, y: 0, shape: [[0, 0], [bL, 0], [bL, bW], [0, bW]] };
  return {
    allow: a,
    main: { T: v.t, B, minW, asked, tooNarrow: asked > 0 && asked < minW, length: best.len, placed },
    bottom: { T: bot.T, L: bL, Wd: bW, bl: bL + a, bw: bW + a, B: bW + a, length: bL + a, placed: [bp] },
  };
}

const f1 = (x) => { const r = Math.round(x * 10) / 10; return r.toFixed(1).replace(/\.0$/, ''); };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

// 木取り図（SVG の要素）。板を横長に、左上を (x0, y0) にして描く。単位は呼び出し側の座標（図面なら mm）
// which: 'main'（側板・背板・前板の板）か 'bottom'（底板の板）
export function boardSVG(lay, x0, y0, s, { size = 2.2, which = 'main' } = {}) {
  const m = which === 'bottom' ? lay.bottom : lay.main;
  const out = [];
  const R = (x, y, w, h, cls) => out.push(`<rect x="${(x0 + x * s).toFixed(3)}" y="${(y0 + y * s).toFixed(3)}" width="${(w * s).toFixed(3)}" height="${(h * s).toFixed(3)}" class="${cls}"/>`);
  const T = (x, y, str, sz, w = '') => out.push(`<text x="${(x0 + x * s).toFixed(3)}" y="${(y0 + y * s).toFixed(3)}" font-size="${sz}" text-anchor="middle" class="tx"${w ? ` font-weight="${w}"` : ''}>${esc(str)}</text>`);
  R(0, 0, m.length, m.B, 'kd-board');
  // 文字の幅の目安（全角 ≒ 文字の大きさ、半角 ≒ 0.58倍）
  const tw = (str, sz) => [...str].reduce((a, ch) => a + (/[\x00-\x7f]/.test(ch) ? 0.58 : 1.06), 0) * sz;
  m.placed.forEach((p) => {
    R(p.x, p.y, p.bl, p.bw, 'kd-part');                       // 切り出す大きさ（残しろ込み）
    // 部材の外形（仕上がり）。残しろの真ん中に置く
    const ox = p.x + (p.bl - p.L) / 2, oy = p.y + (p.bw - p.Wd) / 2;
    out.push(`<polygon points="${p.shape.map(([u, w]) => `${(x0 + (ox + u) * s).toFixed(3)},${(y0 + (oy + w) * s).toFixed(3)}`).join(' ')}" class="kd-shape"/>`);
    const cx = p.x + p.bl / 2 + (p.name === '側板' ? p.Wd / 8 : 0), cy = p.y + p.bw / 2; // 側板は尖った分だけ右へ
    const name = p.name, dims = `${f1(p.L)}×${f1(p.Wd)}`;
    const w = p.bl * s - size * 0.6, h = p.bw * s - size * 0.4;      // 部材の中で使える幅・高さ（用紙の単位）
    // 横書き2行 → 横書き1行（文字を小さく）→ 縦書き（部材が短く幅が広いとき）の順に、入る書き方を選ぶ
    const sz2 = Math.min(size, w / Math.max(tw(name, 1), tw(dims, 0.9)));
    const one = `${name} ${dims}`, sz1 = Math.min(size * 0.85, w / tw(one, 1));
    const szV = Math.min(size * 0.85, h / tw(one, 1), w / 1.2);
    if (sz2 >= size * 0.7 && h > sz2 * 2.6) {
      T(cx, cy - sz2 * 0.15 / s, name, sz2, 'bold'); T(cx, cy + sz2 * 1.05 / s, dims, sz2 * 0.9);
    } else if (sz1 >= size * 0.55 && h > sz1 * 1.2) {
      T(cx, cy + sz1 * 0.35 / s, one, sz1);
    } else if (szV >= 0.8) {
      const X = x0 + cx * s + szV * 0.35, Y = y0 + cy * s;
      out.push(`<text x="${X.toFixed(3)}" y="${Y.toFixed(3)}" font-size="${szV.toFixed(2)}" text-anchor="middle" class="tx" transform="rotate(-90 ${X.toFixed(3)} ${Y.toFixed(3)})">${esc(one)}</text>`);
    } else {
      T(cx, cy + Math.max(0.8, sz1) * 0.35 / s, one, Math.max(0.8, sz1)); // 小さすぎる部材（めったにない）
    }
  });
  // 木目の向き
  const ay = m.B + 4.5 / s * size / 2.2;
  out.push(`<text x="${(x0).toFixed(3)}" y="${(y0 + ay * s).toFixed(3)}" font-size="${size * 0.85}" text-anchor="start" class="tx">← 木目の向き →</text>`);
  return out.join('\n');
}

// 一言の説明
export function kidoriSummary(lay) {
  const m = lay.main, b = lay.bottom;
  return {
    main: `厚さ ${f1(m.T)}・幅 ${f1(m.B)} 以上の板で、長さ ${f1(m.length)}`,
    bottom: `底板：厚さ ${f1(b.T)}・${f1(b.bl)}×${f1(b.bw)} の板 1枚`,
    note: `部材ごとに残しろ ${f1(lay.allow)}mm を長さ・幅に足した寸法。図の中の数字は仕上がり寸法。`,
  };
}
