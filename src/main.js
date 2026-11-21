import { DEFAULTS, derive, validate, buildBox } from './geometry.js?v=20261122n';
import { solidSTL, solidTriangles, checkSolid } from './solid.js?v=20261122n';
import { PrintView } from './print3d.js?v=20261122n';
import { layoutBoards, kidoriSummary, boardSVG, KIDORI_DEFAULTS } from './kidori.js?v=20261122n';
import { buildSheets, fmt } from './drawing.js?v=20261122n';
import { View3D } from './view3d.js?v=20261122n';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

let params = { ...DEFAULTS };
let keep = 'out'; // 板厚を変えたときに保つ側
let kopt = { ...KIDORI_DEFAULTS }; // 木取り：板の幅（0=最小）・残しろ
let tab = 'model';
let box = null;
let sheetsDirty = true;
let currentSheet = 0;
const S2 = Math.SQRT2;

// 外寸・内寸 ⇔ 内部パラメータ（d は固定し、dx/dy/dz で寸法を持つ）
function dims() {
  const v = derive(params);
  return { W: v.W, depth: v.depth, H: v.H, iw: v.W - 2 * v.t, id: v.D - v.t * S2, ih: v.H - v.t };
}
function setOuter(W, depth, H) {
  params.dx = W / params.d; params.dz = H / params.d; params.dy = (depth - H / 2) / params.d;
}
function setInner(iw, id, ih) {
  const t = params.t;
  const W = iw + 2 * t, H = ih + t, D = id + t * S2;
  setOuter(W, D + H / 2, H);
}
// 前板の上端の高さ（側板の先端 H/2 から板厚ぶん上）。ここで内奥行がいちばん広い
const frontTop = (v) => v.H / 2 + v.t / S2;
const widest = (v) => v.depth - v.t * (1 + 1 / S2);
// 内容量：底板の上〜縁。前は前板の内面（y+z=t√2）と、その上は側板の前の縁（y=z−H）で囲む。
// 側板の前の縁はちょうど前板の内側の上端を通る。上端の小さな面取りは無視
function capacity(v) {
  const iw = v.W - 2 * v.t, t = v.t, H = v.H, zf = frontTop(v);
  const a = v.D - t - t * S2, b = v.D - t + H;
  return iw * ((zf - t) * a + (zf * zf - t * t) / 2 + (H - zf) * b - (H * H - zf * zf) / 2);
}

// ---------- URL ----------
function readHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  const num = (k) => { const x = parseFloat(h.get(k)); return Number.isFinite(x) && x > 0 ? x : null; };
  if (num('t')) params.t = num('t');
  if (num('W') && num('L') && num('H')) setOuter(num('W'), num('L'), num('H'));
  else for (const k of ['d', 'dx', 'dy', 'dz']) if (num(k)) params[k] = num(k); // 旧形式のURL
  if (h.has('g')) { const g = parseFloat(h.get('g')); if (g > 0) params.gRatio = g / params.t; }
  if (h.has('c')) { const c = parseFloat(h.get('c')); if (c >= 0) params.cRatio = c / params.t; }
  $('#auto-gc').checked = !(h.has('g') || h.has('c'));
  if (h.get('m') === 'in') setKeep('in');
  if (num('bw')) kopt.boardW = num('bw');
  if (h.has('ka')) { const a = parseFloat(h.get('ka')); if (a >= 0) kopt.allow = a; }
  $('#kd-w').value = kopt.boardW || '';
  $('#kd-a').value = kopt.allow;
}
function writeHash() {
  const h = new URLSearchParams();
  const d = dims();
  h.set('W', +d.W.toFixed(2)); h.set('L', +d.depth.toFixed(2)); h.set('H', +d.H.toFixed(2)); h.set('t', +params.t.toFixed(2));
  if (kopt.boardW) h.set('bw', kopt.boardW);
  if (kopt.allow !== KIDORI_DEFAULTS.allow) h.set('ka', kopt.allow);
  if (!$('#auto-gc').checked) { h.set('g', +(params.gRatio * params.t).toFixed(3)); h.set('c', +(params.cRatio * params.t).toFixed(3)); }
  if (keep === 'in') h.set('m', 'in');
  history.replaceState(null, '', '#' + h.toString());
}

// ---------- 入力欄 ----------
function syncInputs(except) {
  $$('[data-k]').forEach((el) => { if (el !== except) el.value = +(+params[el.dataset.k]).toFixed(4); });
  $$('[data-r]').forEach((el) => { if (el !== except) el.value = params[el.dataset.r]; });
  const v = derive(params);
  const mm = dims();
  $$('[data-mm]').forEach((el) => { if (el !== except) el.value = +mm[el.dataset.mm].toFixed(1); });
  if (except !== $('#g-mm')) $('#g-mm').value = +(v.g).toFixed(2);
  if (except !== $('#c-mm')) $('#c-mm').value = +(v.c).toFixed(2);
  $('#g-mm').disabled = $('#c-mm').disabled = $('#auto-gc').checked;
}

// ---------- テンプレート（コピー用紙500枚がすっと入る箱） ----------
// 紙（短辺×長辺）にゆとり（両側の合計、初期3mm）を足す。深さは束（約50mm）＋指が入る分。
const PAPER = { A5: [148, 210, 12], B5: [182, 257, 12], A4: [210, 297, 12], B4: [257, 364, 15], A3: [297, 420, 15] };
const CLEAR = 3, DEPTH = 65;
let tplRot = false; // テンプレート選択中に「縦横を入れ替え」したか
const clearance = () => { const x = parseFloat($('#clr').value); return x >= 0 ? x : CLEAR; };
// 横長（長い辺が左右）で入れる。縦長にしたいときは「縦横を入れ替え」
function applyPaper(paper, ih = DEPTH) {
  const [s, l, t] = PAPER[paper];
  params.t = t; params.gRatio = DEFAULTS.gRatio; params.cRatio = DEFAULTS.cRatio; $('#auto-gc').checked = true;
  const c = clearance();
  const [a, b] = tplRot ? [s + c, l + c] : [l + c, s + c];
  setInner(a, b, ih);
  setKeep('in');
}
// テンプレートを選んでいないときは、ゆとりの欄を薄くする
function markTpl() {
  const on = !!PAPER[$('#tpl').value];
  $('#clr').disabled = !on;
  $('.clr').classList.toggle('is-off', !on);
  const c = clearance();
  $('#clr-half').textContent = `片側 ${+(c / 2).toFixed(2)}mm`;
}

function setKeep(m) {
  keep = m;
  $$('[data-keep]').forEach((x) => { x.classList.toggle('is-on', x.dataset.keep === m); x.setAttribute('aria-checked', x.dataset.keep === m); });
}

// 板厚を変えるとき、選んだ側（外寸 or 内寸）を保つ
function setT(t) {
  const d = dims();
  params.t = t;
  if (!$('#auto-gc').checked) keepGcMm();
  if (keep === 'in') setInner(d.iw, d.id, d.ih); else setOuter(d.W, d.depth, d.H);
}

function bind() {
  $$('[data-k="t"]').forEach((el) => el.addEventListener('input', () => {
    const x = parseFloat(el.value);
    if (!(x > 0)) return;
    setT(x); update(el);
  }));
  $$('[data-r="t"]').forEach((el) => el.addEventListener('input', () => { setT(parseFloat(el.value)); update(el); }));
  // 打ち終わったら、打った欄も小数1桁に揃える
  $$('[data-mm]').forEach((el) => el.addEventListener('change', () => syncInputs()));
  $$('[data-mm]').forEach((el) => el.addEventListener('input', () => {
    const x = parseFloat(el.value);
    if (!(x > 0)) return;
    const d = dims(); d[el.dataset.mm] = x;
    if (['iw', 'id', 'ih'].includes(el.dataset.mm)) setInner(d.iw, d.id, d.ih); else setOuter(d.W, d.depth, d.H);
    update(el);
  }));
  $('#auto-gc').addEventListener('change', () => {
    if ($('#auto-gc').checked) { params.gRatio = DEFAULTS.gRatio; params.cRatio = DEFAULTS.cRatio; }
    update();
  });
  $('#g-mm').addEventListener('input', () => { const x = parseFloat($('#g-mm').value); if (x > 0) { params.gRatio = x / params.t; update($('#g-mm')); } });
  $('#c-mm').addEventListener('input', () => { const x = parseFloat($('#c-mm').value); if (x >= 0) { params.cRatio = x / params.t; update($('#c-mm')); } });

  $$('[data-keep]').forEach((b) => b.addEventListener('click', () => { setKeep(b.dataset.keep); writeHash(); }));
  $('#tpl').addEventListener('change', () => {
    const p = $('#tpl').value;
    tplRot = false;
    if (PAPER[p]) { applyPaper(p); update(); view.fit(); }
    markTpl();
  });
  $('#clr').addEventListener('input', () => {
    markTpl();
    const p = $('#tpl').value;
    if (PAPER[p] && parseFloat($('#clr').value) >= 0) { applyPaper(p, dims().ih); update(); }
  });
  // 内寸の幅と奥行を入れ替える（前板が斜めなので外寸はきれいには入れ替わらない）
  $('#swap').addEventListener('click', () => { const d = dims(); tplRot = !tplRot; setInner(d.id, d.iw, d.ih); update(); view.fit(); });
  // 寸法や板厚を手で変えたら、テンプレートの選択表示は外す
  $$('[data-mm],[data-k],[data-r],#g-mm,#c-mm,#auto-gc').forEach((el) => el.addEventListener('input', () => { $('#tpl').value = ''; markTpl(); }));
  $$('.tab').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
  $('#o-dims').addEventListener('change', (e) => view.setOpts({ dims: e.target.value }));
  // 木取りの入力（板の幅を空にすると最小の幅で計算）
  const kdChange = () => {
    const w = parseFloat($('#kd-w').value), a = parseFloat($('#kd-a').value);
    kopt.boardW = w > 0 ? w : 0;
    if (a >= 0) kopt.allow = a;
    writeHash();
    if (box) { renderList(); sheetsDirty = true; if (tab === 'sheets') renderSheets(); }
  };
  $('#kd-w').addEventListener('input', kdChange);
  $('#kd-a').addEventListener('input', kdChange);
  $('#o-explode').addEventListener('change', (e) => view.setOpts({ explode: e.target.checked }));
  $('#o-stack').addEventListener('change', (e) => { view.setOpts({ stack: e.target.checked }); view.fit(); });
  $('#fit').addEventListener('click', () => view.fit());
  // 3Dプリント用：一塊の立体を STL で保存
  $('#stl').addEventListener('click', () => {
    if (!box || !$('#blocked').hidden) return;
    const blob = solidSTL(params, { fillFloor: $('#stl-fill').checked });
    const d = dims(), r = (x) => Math.round(x * 10) / 10;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `parts-box_W${r(d.W)}_L${r(d.depth)}_H${r(d.H)}_t${r(params.t)}.stl`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast('STL を保存しました（単位 mm）');
  });
  $('#stl-fill').addEventListener('change', () => { printDirty = true; renderPrint(); });
  $('#pfit').addEventListener('click', () => pview && pview.fit());
  $('#reset').addEventListener('click', () => { params = { ...DEFAULTS }; $('#auto-gc').checked = true; setKeep('out'); $('#tpl').value = ''; markTpl(); update(); view.fit(); });
  $('#share').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(location.href); toast('URLをコピーしました'); } catch { toast('コピーできませんでした。アドレス欄のURLを使ってください'); }
  });
  $('#print').addEventListener('click', () => {
    if ($('#print').disabled) return;
    ensureSheets();
    $('#print-area').innerHTML = lastSheets.join('');
    window.print();
  });
}

function keepGcMm() {
  const g = parseFloat($('#g-mm').value), c = parseFloat($('#c-mm').value);
  if (g > 0) params.gRatio = g / params.t;
  if (c >= 0) params.cRatio = c / params.t;
}

function setTab(t) {
  tab = t;
  $$('.tab').forEach((b) => b.classList.toggle('is-on', b.dataset.tab === t));
  $$('.pane').forEach((p) => p.classList.toggle('is-on', p.id === 'tab-' + t));
  if (t === 'sheets') renderSheets();
  if (t === 'model') view.resize();
  if (t === 'print3d') renderPrint();
}

// ---------- 3Dプリント（書き出す立体のプレビュー） ----------
let pview = null, printDirty = true;
function renderPrint() {
  if (tab !== 'print3d' || !box || !printDirty) return;
  if (!pview) pview = new PrintView($('#pview')); // 初めて開いたときに作る
  pview.resize();
  const fill = $('#stl-fill').checked;
  const tris = solidTriangles(box.v, { fillFloor: fill });
  pview.setTriangles(tris);
  const ck = checkSolid(tris), v = box.v;
  $('#p3-info').innerHTML = `<b>3Dプリント用の立体（一塊）</b>` +
    `外形 ${fmt(v.W)} × ${fmt(v.depth)} × ${fmt(v.H)} mm<br>` +
    `体積 約 ${(ck.volume / 1000).toFixed(0)} cm³ ・ 三角形 ${ck.triangles} ・ ${ck.badEdges ? `<span style="color:var(--warn-ink)">すき間あり（${ck.badEdges}）</span>` : 'すき間なし'}` +
    `<small>${fill ? '底板の下を埋めています。底を下にして、支えなしで刷れます。' : '底板の下が空いています。後ろ板を下にすれば、支えなしで刷れます（そのため、底のくぼみの前の壁は底板から45°で下りる形にしています）。'}溝の小さな穴は埋めてあります。</small>`;
  printDirty = false;
}

// ---------- 更新 ----------
let timer = null;
function update(except) {
  syncInputs(except);
  const v = derive(params);
  const warns = validate(v);
  $('#warn').innerHTML = warns.map((w) => `<li>${w}</li>`).join('');
  const d = dims();
  const L = capacity(v) / 1e6;
  $('#derived').innerHTML = [
    ['内奥行（前板の上端で・最大）', fmt(widest(v))],
    ['前板の上端の高さ', fmt(frontTop(v))],
    ['容量', `約 ${L >= 10 ? L.toFixed(1) : L.toFixed(2)} L`],
    ['溝・底板厚 / 面取り', `${fmt(v.g)} / ${fmt(v.c)}`],
    ['積み重ね1段の高さ', fmt(v.stackPitch)],
  ].map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('');
  writeHash();
  const blocks = warns.filter((w) => /正の値|狭すぎ|短すぎ|低すぎ|板厚以上/.test(w));
  const ok = !blocks.length;
  // 作れない寸法：3D・図面・部材表の上に理由を重ね、印刷できないようにする（古い寸法の図面を出さない）
  $('#blocked').hidden = ok;
  $('#blocked-list').innerHTML = blocks.map((w) => `<li>${w}</li>`).join('');
  $('#print').disabled = !ok;
  $('#print').title = ok ? '' : 'この寸法では作れないので印刷できません';
  if (!ok) return;
  box = buildBox(params);
  view.setBox(box);
  renderList();
  sheetsDirty = true;
  printDirty = true;
  clearTimeout(timer);
  if (tab === 'sheets') timer = setTimeout(renderSheets, 120);
  if (tab === 'print3d') timer = setTimeout(renderPrint, 60);
}

let lastSheets = [];
function ensureSheets() {
  if (!sheetsDirty && lastSheets.length) return;
  const iso = view.snapshot(box);
  lastSheets = buildSheets(box, params, iso, kopt);
  sheetsDirty = false;
}

const SHEET_NAMES = ['総合図'];
function renderSheets() {
  if (!box) return; // 作れない寸法のURLで開いたときは、まだ箱がない
  ensureSheets();
  $('#sheetnav').innerHTML = SHEET_NAMES.map((n, i) => `<button class="sn ${i === currentSheet ? 'is-on' : ''}" data-i="${i}">${n}</button>`).join('') +
    '<span class="hint">印刷すると全ページがA4横で出ます</span>';
  $$('.sn').forEach((b) => b.addEventListener('click', () => { currentSheet = +b.dataset.i; renderSheets(); }));
  $('#sheets').innerHTML = lastSheets[currentSheet];
}

function renderList() {
  const v = box.v;
  const lay = layoutBoards(v, kopt);
  const sm = kidoriSummary(lay);
  const m = lay.main;
  $('#kd-wmin').textContent = `（最小 ${fmt(m.minW)}）`;
  $('#kd-sum').textContent = m.tooNarrow ? `板の幅が足りません。幅 ${fmt(m.minW)} 以上の板が要ります（いちばん幅の広い部材＋残しろ）。下の図は幅 ${fmt(m.minW)} で計算しています。` : sm.main;
  $('#kd-sum').classList.toggle('bad', m.tooNarrow);
  // 図：板の長さに合わせて縮める（単位 mm）
  const s = 1, pad = 6, size = Math.max(9, Math.min(16, m.B * 0.11));
  const wv = m.length * s + pad * 2, hv = m.B * s + pad * 2 + size * 2.6; // 下に「木目の向き」
  $('#kd-fig').innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="sheet" viewBox="0 0 ${wv} ${hv}" style="max-height:${Math.max(160, Math.min(420, hv * 2))}px">${boardSVG(lay, pad, pad, s, { size })}</svg>`;
  // 底板の板：上の板と同じ縮尺で見えるよう、横幅を上の図に対する割合で決める
  const b = lay.bottom, wb = b.length + pad * 2, hb = b.B + pad * 2 + size * 2.6;
  $('#kd-figb').innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="sheet" viewBox="0 0 ${wb} ${hb}" style="width:${Math.min(100, wb / wv * 100).toFixed(1)}%">${boardSVG(lay, pad, pad, s, { size, which: 'bottom' })}</svg>`;
  $('#kd-bot').textContent = sm.bottom;
  $('#kd-note').textContent = sm.note;
  const steps = [
    `上の木取り図のとおりに板を切る（側板2枚・背板・前板は厚さ ${fmt(v.t)}、底板は ${fmt(v.g)}。残しろ ${fmt(lay.allow)}mm 込み）。`,
    `側板の前側を45°に尖らせる（先端は高さの半分 ${fmt(v.H / 2)} の位置）。`,
    `側板・背板の内側に、下端から ${fmt(v.t - v.g)}〜${fmt(v.t)} の位置へ幅 ${fmt(v.g)}・深さ ${fmt(v.g)} の溝を端から端まで通す。`,
    '四隅（側板と背板、側板と前板）を45°の留めに削る。前板の下端は45°、上端は直角。',
    `底板の前端を45°に削り、仮組みで合わせる。`,
    `接着して組み、底の外側と上の内側を ${fmt(v.c)} 面取りする（前板の下の角も一緒に落とす）。`,
  ];
  $('#howto').innerHTML = steps.map((s) => `<li>${s}</li>`).join('');
}

function toast(s) {
  const t = $('#toast'); t.textContent = s; t.hidden = false;
  clearTimeout(toast.tm); toast.tm = setTimeout(() => { t.hidden = true; }, 2200);
}

// ---------- 起動 ----------
const view = new View3D($('#view3d'));
readHash();
// アプリの版（直したら上げる。index.html と import の ?v= も合わせて変える）
const APP_VERSION = '1.2.0', APP_DATE = '2026-11-22';
$('#ver').textContent = `作者 Shinsuke Kato ・ バージョン ${APP_VERSION}（${APP_DATE}）`;
bind();
markTpl();
update();
window.__pmc = { buildBox, derive, view, buildSheets, validate, dims, capacity, get params() { return params; }, get pview() { return pview; } };
