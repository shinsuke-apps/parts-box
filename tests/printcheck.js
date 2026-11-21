// 3Dプリント用の立体を調べる開発用テスト。
// ブラウザのコンソールで:  const m = await import('/tests/printcheck.js'); m.run()
//
// 1. すき間：すべての辺がちょうど2枚の三角形で逆向きに使われているか（checkSolid）
// 2. 支え：刷る向きに薄い層（0.25mm）を1枚ずつ積み、ひとつ前の層の 45° 以内に何もない所（空中から刷り始める所）を数える。
//    面の向き（45° より急か）だけでは足りない。張り出しが「どこから始まるか」を見ないと、
//    くぼみの縁から始まる橋（最初の1本が空中）を見落とす（2026-11-22 に実際に見落とした）。
//    層の中の向き（左右）は見ないので、側板の外側の面取り（左右方向の 45°）は数えない位置で調べる。
import { derive } from '../src/geometry.js';
import { solidSpec, solidTriangles, checkSolid } from '../src/solid.js';

const ins = (pl, p) => pl.every((q) => q.n[0] * p[0] + q.n[1] * p[1] + q.n[2] * p[2] <= q.k + 1e-9);

// orient: 'back'（後ろ板を下・層は −y 向きに積む）か 'bottom'（底を下・層は +z 向き）
export function unsupported(v, spec, orient = 'back', h = 0.25) {
  const solid = (p) => ins(spec.outer, p) && !spec.cutters.some((C) => ins(C, p));
  const hw = v.W / 2;
  // 調べる左右の位置：中央と、側板の内側の壁ぎわ（面取りにかからない所）
  const xs = [0, hw - v.t - 0.6, -(hw - v.t - 0.6), hw - v.t + 1];
  let bad = 0; const examples = [];
  const layerCount = orient === 'back' ? Math.round(v.depth / h) : Math.round(v.H / h);
  const cellCount = orient === 'back' ? Math.round(v.H / h) : Math.round(v.depth / h);
  const at = (x, k, j) => (orient === 'back'
    ? [x, v.D - (k + 0.5) * h, (j + 0.5) * h]
    : [x, -v.H / 2 + (j + 0.5) * h, (k + 0.5) * h]);
  for (const x of xs) {
    let prev = null;
    for (let k = 0; k < layerCount; k++) {
      const row = [];
      for (let j = 0; j < cellCount; j++) row.push(solid(at(x, k, j)));
      if (prev) for (let j = 0; j < cellCount; j++) {
        if (row[j] && !prev[j] && !(j > 0 && prev[j - 1]) && !(j < cellCount - 1 && prev[j + 1])) {
          bad++; if (examples.length < 4) examples.push(at(x, k, j).map((q) => +q.toFixed(1)));
        }
      }
      prev = row;
    }
  }
  return { bad, examples };
}

// 代表的な寸法で、すき間と支えを調べる
export function run() {
  const cases = [
    { d: 140, dx: 1, dy: 1, dz: 1, t: 12 },            // 初期値
    { d: 100, dx: 3.31, dy: 2.37, dz: 0.77, t: 12 },   // A4横長くらい（低くて広い）
    { d: 100, dx: 2, dy: 2.5, dz: 1.5, t: 18 },        // 板厚が厚い
    { d: 100, dx: 2, dy: 2.5, dz: 1.5, t: 6 },         // 板厚が薄い
  ];
  const out = [];
  for (const c of cases) {
    const v = derive({ gRatio: 1 / 3, cRatio: 2 / 3, ...c });
    for (const fillFloor of [false, true]) {
      const ck = checkSolid(solidTriangles(v, { fillFloor }));
      const back = unsupported(v, solidSpec(v, { fillFloor }), 'back');
      const row = { size: `${v.W.toFixed(0)}x${v.depth.toFixed(0)}x${v.H.toFixed(0)} t${v.t}`, fillFloor, badEdges: ck.badEdges, volumeCm3: +(ck.volume / 1000).toFixed(1), backDown: back.bad };
      if (fillFloor) row.bottomDown = unsupported(v, solidSpec(v, { fillFloor }), 'bottom').bad;
      out.push(row);
    }
  }
  console.table(out);
  return out; // すべて badEdges 0・backDown 0（埋めたときは bottomDown も 0）なら合格
}
