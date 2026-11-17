// ホール入力画面（v0.4: ショット記録方式＋付随記録）
// - 本人のスコアはショット記録から自動算出（スコア/パットの直接入力は廃止）
// - 1打の記録 = 番手タップ → 結果タップ の2タップ。PT（パター）も他の番手と同じ扱いで結果をつけられる
// - OB・プレ4・1ペナ・バンカーはショットへの付随記録（ボタンで付け外し）：OB +1打、プレ4 +2打、1ペナ +1打、バンカー +0
// - FWはティーショット（1打目）の結果から自動導出するので、独立入力はない
// - 同伴者はスコアのみ（パットなし）
// - ホール移動は左右ボタンのみ（チップ列は廃止）。移動では確定しない。確定は「ホール確定」だけ
// - 4人のときはトモダチの組分けと対象ポイントを上部に表示する
import { getState, scheduleSave, saveNow, rotateGeneration, totals, syncDerived } from './state.js';
import { saveDraft } from './sync.js';
import { calcTomodachi, playerList } from './game.js';
import { DEFAULT_CLUBS, SHOT_RESULTS } from './config.js';

let onNavigate = () => {};
export function setHoleNavHandler(fn) { onNavigate = fn; }

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let pendingClub = '';
let pendingHole = 0; // pendingClub が属するホール（ホールが変わったらリセット）
let selShot = -1;    // 付随記録の対象ショット（-1 = 最後のショット）
let modalOpen = null; // 'score' | 'tomo' | 'strategy' | null

// 画面遷移時にモーダル状態を持ち越さない（開いたまま別タブへ行って戻ると残るのを防ぐ）
export function resetHoleModal() { modalOpen = null; }

function miniStepper(label, value, kind, extra = '') {
  return `<span class="mini-stepper">
    <span class="mini-label">${label}</span>
    <button type="button" class="mini-btn" data-step="-1" data-kind="${kind}" ${extra}>−</button>
    <span class="mini-value">${value}</span>
    <button type="button" class="mini-btn" data-step="1" data-kind="${kind}" ${extra}>＋</button>
  </span>`;
}

// v0.2以前の下書き（スコアだけあってショットが無いホール）をショット配列へ変換する（編集を始めたときだけ）。
// 既存の集計（番手・FW・OB・ペナ・バンカー）が syncDerived で消えないよう、ダミーショットへ情報を種付けする。
// ※旧形式ではプレ4と1ペナの内訳が残っていないため、ペナはすべて+1打として再現する（近似）。
function ensureShots(s, i) {
  if ((s.shots[i] || []).length > 0) return;
  if ((s.scores[i] || 0) <= 0) return;
  const putts = Math.min(s.putts[i] || 0, s.scores[i]);
  const ob = s.ob[i] || 0, pen = s.pen[i] || 0, bunker = s.bunker[i] || 0;
  const base = Math.max(s.scores[i] - putts - ob - pen, 0);
  const mk = club => ({ club, res: '', isBunker: false, type: 'club', ob: false, pre4: false, pen: false });
  const arr = [];
  for (let k = 0; k < base; k++) arr.push(mk(''));
  for (let k = 0; k < putts; k++) arr.push(mk('PT'));
  if (arr.length) {
    if (arr[0].club !== 'PT' && s.clubs[i]) arr[0].club = s.clubs[i];
    const RES_FROM_FW = { K: '◯', L: '左', R: '右', S: '短', O: '奥' };
    if (s.pars[i] >= 4 && s.fw[i] && RES_FROM_FW[s.fw[i]]) arr[0].res = RES_FROM_FW[s.fw[i]];
    for (let k = 0; k < Math.min(ob, arr.length); k++) arr[k].ob = true;
    for (let k = 0; k < Math.min(pen, arr.length); k++) arr[k].pen = true;
    for (let k = 0; k < Math.min(bunker, arr.length); k++) arr[k].isBunker = true;
  }
  s.shots[i] = arr;
}

export function renderHole(root) {
  const s = getState();
  if (!s) { root.innerHTML = '<p>進行中のラウンドがありません。</p>'; return; }
  const i = s.currentHole - 1;
  if (pendingHole !== s.currentHole) { pendingClub = ''; pendingHole = s.currentHole; selShot = -1; }
  const t = totals(s);
  const half = i < 9 ? 0 : 1;
  const subName = s.half_names[half];
  const shots = s.shots[i] || [];
  const puttCount = shots.filter(sh => sh.club === 'PT').length;
  const tomo = calcTomodachi(s);
  const tomoHole = tomo ? tomo.perHole[i] : null;
  const names = playerList(s).map(p => p.name);
  const n2 = n => esc(String(n).replace(/\s/g, '').slice(0, 2)); // トモダチ表示は名前2文字
  const tomoShort = (tomo, hi) => {
    const r = tomo.perHole[hi];
    if (!r) return '';
    if (!r.complete) return r.carryIn > 0 ? `対象${r.bet}pt（持越+${r.carryIn}）` : `対象${r.bet}pt`;
    if (r.winner === 'TIE') return hi === 17 ? '引分' : `引分 持越+${r.bet}pt`;
    return `${r.winner}組勝ち +${r.bet}pt`;
  };

  const strategy = ((s.strategies && s.strategies[i]) || '').replace(/\s+/g, ' ').trim();
  // 付随記録の対象ショット（選択中がなければ最後のショット）
  const target = shots.length ? (selShot >= 0 && selShot < shots.length ? selShot : shots.length - 1) : -1;
  const tsh = target >= 0 ? shots[target] : null;
  const extras = shots.length ? (s.scores[i] || 0) - shots.length : 0;
  const RES_CLASS = { '◯': 'res-good', '左': 'res-miss', '右': 'res-miss', '短': 'res-short', '奥': 'res-over', 'ダ': 'res-bad', 'ト': 'res-bad' };
  const shotBox = (sh, k) => `<span class="shot-box ${RES_CLASS[sh.res] || ''} ${k === target ? 'target' : ''}" data-shotbox="${k}"><span class="shot-no2">${k + 1}打</span><b>${esc(sh.club || '—')}</b><span class="shot-res">${esc(sh.res || '')}</span>${sh.ob ? '<span class="badge b-ob">OB</span>' : ''}${sh.pre4 ? '<span class="badge b-pre4">プレ4</span>' : ''}${sh.pen ? '<span class="badge b-pen">1ペナ</span>' : ''}${sh.isBunker ? '<span class="badge b-bunker">バンカー</span>' : ''}<button type="button" class="shot-x" data-shot="${k}">✕</button></span>`;

  let html = `
  <div class="hole-head">
    <button type="button" id="hole-prev" ${i === 0 ? 'disabled' : ''}>◀ 前</button>
    <button type="button" class="hole-title-btn" id="hole-title">
      <span class="hole-course">${esc(s.course_name)}</span>
      <span class="hole-name">${esc(subName)} ${i % 9 + 1}H <span class="hole-no">（${s.currentHole}H）</span> <span class="hole-pick-mark">▾</span></span>
      <span class="hole-meta">Par ${s.pars[i]} ・ ${s.yards[i]}y ・ Hdcp ${s.hdcp[i]}</span>
    </button>
    <button type="button" id="hole-next" ${i === 17 ? 'disabled' : ''}>次 ▶</button>
  </div>
  <div class="par-row"><span class="mini-label">このホールのPar</span><select id="par-sel">${[3, 4, 5, 6].map(v => `<option value="${v}" ${v === s.pars[i] ? 'selected' : ''}>Par ${v}</option>`).join('')}</select><span class="hint">コース都合で変わる日はここで変更</span></div>
  <button type="button" id="open-score" class="totals-bar btn-bar">OUT ${t.out_score}（${t.out_putts}） / IN ${t.in_score}（${t.in_putts}） / 合計 ${t.score} ・ パット ${t.putts}</button>
  ${tomoHole ? `<button type="button" id="open-tomo" class="tomo-bar btn-bar">A ${n2(names[tomoHole.teamA[0]])}・${n2(names[tomoHole.teamA[1]])} / B ${n2(names[tomoHole.teamB[0]])}・${n2(names[tomoHole.teamB[1]])} ｜ ${esc(tomoShort(tomo, i))} ｜ 本人 ${tomo.totals[0] > 0 ? '+' : ''}${tomo.totals[0]}pt</button>` : ''}

  <section class="card compact">
    <div class="score-line">スコア <b>${s.scores[i] || 0}</b> ・ パット <b>${shots.length ? puttCount : (s.putts[i] || 0)}</b>${extras > 0 ? ` <span class="hint">（罰打 +${extras}）</span>` : ''}
      <span class="hint">番手をタップ→結果をタップで1打記録</span></div>
    <div class="shots-list">${shots.map(shotBox).join('') || '<span class="hint">まだショットがありません</span>'}</div>
    <div class="club-grid">${DEFAULT_CLUBS.map(c =>
      `<button type="button" class="club-btn ${pendingClub === c ? 'active' : ''}" data-club="${c}">${c}</button>`).join('')}</div>
    <div class="res-grid">${SHOT_RESULTS.map(r =>
      `<button type="button" class="res-btn" data-res="${r}">${r}</button>`).join('')}</div>
    <div id="shot-msg" class="warn" style="display:none">まず番手を選んでください</div>
    <div class="mod-row">
      <span class="mini-label">ハザード：</span>
      <button type="button" class="mod-btn ${tsh && tsh.ob ? 'active' : ''}" data-mod="ob" ${target < 0 ? 'disabled' : ''}>OB +1</button>
      <button type="button" class="mod-btn ${tsh && tsh.pre4 ? 'active' : ''}" data-mod="pre4" ${target < 0 ? 'disabled' : ''}>プレ4 +2</button>
      <button type="button" class="mod-btn ${tsh && tsh.pen ? 'active' : ''}" data-mod="pen" ${target < 0 ? 'disabled' : ''}>1ペナ +1</button>
      <button type="button" class="mod-btn ${tsh && tsh.isBunker ? 'active' : ''}" data-mod="bunker" ${target < 0 ? 'disabled' : ''}>バンカー</button>
    </div>
  </section>

  ${s.pars[i] === 3 && s.game ? `<section class="card compact">
    <div class="elem-row">
      <span class="mini-label">ニアピン</span>
      <select id="nearpin-sel">
        <option value="">なし</option>
        ${names.map(n => `<option value="${esc(n)}" ${s.game.nearpin['H' + (i + 1)] === n ? 'selected' : ''}>${esc(n)}</option>`).join('')}
      </select>
    </div>
  </section>` : ''}

  ${s.partners.length ? `<section class="card compact">
    ${s.partners.map((p, pi) => `
    <div class="elem-row">
      <span class="partner-name">${esc(p.name)}</span>
      ${miniStepper('スコア', p.scores[i] || s.pars[i], 'p-score', `data-partner="${pi}"`)}
    </div>`).join('')}
  </section>` : ''}

  <section class="card compact memo-row">
    <textarea id="hole-memo" rows="1" placeholder="ホールメモ">${esc(s.holeMemos[i])}</textarea>
    <button type="button" id="hole-confirm" class="primary">このホールを確定</button>
  </section>

  <div class="hole-actions">
    <button type="button" id="go-finish">確認・終了へ</button>
  </div>
  ${modalOpen === 'score' ? buildScoreModal(s) : ''}
  ${modalOpen === 'tomo' && tomo ? buildTomoModal(s, tomo) : ''}
  ${modalOpen === 'holes' ? buildHolePickerModal(s) : ''}`;

  root.innerHTML = html;
  bindHoleEvents(root);
}

// スコアカード形式（横長・本物のカード風）：ホール番号／Par／各プレイヤーのスコア／本人のパット
function scorecardHead(s, title) {
  return `<div class="sc-head">
    <div class="sc-course">${esc(s.course_name)}</div>
    <div class="sc-sub2">${esc(s.date)} ・ ${s.half_names.map(esc).join(' → ')} ・ ティー ${esc(s.tee || '—')} ／ グリーン ${esc(s.green || '—')} ・ ${esc(title)}</div>
  </div>`;
}

function scHeaderRow() {
  const th = (label, cls = '') => `<th class="${cls}">${label}</th>`;
  let cells = '';
  for (let h = 1; h <= 9; h++) cells += th(h);
  cells += th('OUT', 'sc-sub');
  for (let h = 10; h <= 18; h++) cells += th(h);
  cells += th('IN', 'sc-sub') + th('TOTAL', 'sc-total');
  return `<tr><th class="sc-name">HOLE</th>${cells}</tr>`;
}

function scRow(label, values, pars, isParRow = false) {
  const sum = (a, b) => values.slice(a, b).reduce((x, y) => x + (y || 0), 0);
  const cell = (v, h) => {
    if (isParRow) return `<td>${v || ''}</td>`;
    if (!v) return '<td>−</td>';
    const d = pars ? v - pars[h] : 0;
    const cls = pars && d < 0 ? 'sc-under' : (pars && d >= 2 ? 'sc-over2' : '');
    return `<td class="${cls}">${v}</td>`;
  };
  let cells = '';
  for (let h = 0; h < 9; h++) cells += cell(values[h], h);
  cells += `<td class="sc-sub">${sum(0, 9) || '−'}</td>`;
  for (let h = 9; h < 18; h++) cells += cell(values[h], h);
  cells += `<td class="sc-sub">${sum(9, 18) || '−'}</td><td class="sc-total">${sum(0, 18) || '−'}</td>`;
  return `<tr${isParRow ? ' class="sc-par"' : ''}><td class="sc-name">${esc(label)}</td>${cells}</tr>`;
}

function buildScoreModal(s) {
  const players = playerList(s);
  const rows = [
    scRow('Par', s.pars, null, true),
    ...players.map(p => scRow(p.name, p.scores, s.pars)),
    scRow('パット（本人）', s.putts, null),
  ].join('');
  return `<div class="modal-overlay" id="modal-overlay"><div class="modal-box wide">
    ${scorecardHead(s, 'スコアカード')}
    <div class="sc-wrap"><table class="scorecard">${scHeaderRow()}${rows}</table></div>
    <button type="button" class="primary modal-close">閉じる</button>
  </div></div>`;
}

function buildTomoModal(s, tomo) {
  const short = n => String(n).replace(/\s/g, '');
  // プレイヤー×ホールのポイントをスコアカード形式で
  const ptValues = tomo.players.map((_, pi) => tomo.perHole.map(r => (r.complete ? r.pts[pi] : 0)));
  const ptCell = (v, r) => {
    if (!r.complete) return '<td>−</td>';
    return `<td class="${v > 0 ? 'sc-under' : (v < 0 ? 'sc-over2' : '')}">${v > 0 ? '+' + v : v}</td>`;
  };
  const ptRow = (name, pi) => {
    const vals = ptValues[pi];
    const sum = (a, b) => vals.slice(a, b).reduce((x, y) => x + (y || 0), 0);
    let cells = '';
    for (let h = 0; h < 9; h++) cells += ptCell(vals[h], tomo.perHole[h]);
    cells += `<td class="sc-sub">${sum(0, 9)}</td>`;
    for (let h = 9; h < 18; h++) cells += ptCell(vals[h], tomo.perHole[h]);
    cells += `<td class="sc-sub">${sum(9, 18)}</td><td class="sc-total">${tomo.totals[pi] > 0 ? '+' : ''}${tomo.totals[pi]}</td>`;
    return `<tr><td class="sc-name">${esc(short(name))}</td>${cells}</tr>`;
  };
  const npEntries = Object.entries((s.game && s.game.nearpin) || {})
    .sort((a, b) => parseInt(a[0].slice(1), 10) - parseInt(b[0].slice(1), 10));
  const npHtml = npEntries.length
    ? npEntries.map(([h, n]) => `${h} ${esc(short(n))}`).join(' ／ ')
    : '記録なし';
  return `<div class="modal-overlay" id="modal-overlay"><div class="modal-box wide">
    ${scorecardHead(s, 'トモダチ')}
    <div class="sc-wrap"><table class="scorecard">${scHeaderRow()}${tomo.players.map((n, pi) => ptRow(n, pi)).join('')}</table></div>
    <div class="tomo-lines">ニアピン獲得者：${npHtml}</div>
    <button type="button" class="primary modal-close">閉じる</button>
  </div></div>`;
}

function buildHolePickerModal(s) {
  const ci = s.currentHole - 1;
  const st = s.strategies[ci];
  const btn = h => {
    const played = (s.scores[h] || 0) > 0;
    const cur = s.currentHole === h + 1;
    const hasMemo = !!(s.holeMemos[h] && String(s.holeMemos[h]).trim());
    return `<button type="button" class="hole-pick ${cur ? 'cur' : ''} ${played ? 'done' : ''}" data-hole="${h + 1}"><span class="hp-no">${h + 1}H</span><span class="hp-sub">Par${s.pars[h]}${played ? ` ・ ${s.scores[h]}打 ✓` : ''}${hasMemo ? ' ・ 📝' : ''}</span></button>`;
  };
  const cells = Array.from({ length: 18 }, (_, h) => btn(h)).join('');
  return `<div class="modal-overlay" id="modal-overlay"><div class="modal-box">
    <h3>ホール選択（移動だけでは確定しません）</h3>
    <p class="hint">緑＝入力済み ／ 濃緑＝現在のホール ／ グレー＝未入力 ／ 📝＝ホールメモ記入済み</p>
    <div class="hole-pick-grid">${cells}</div>
    ${st ? `<div class="strategy-box"><h4>📖 ${s.currentHole}H 攻略メモ</h4><p>${esc(st)}</p></div>` : ''}
    <button type="button" class="primary modal-close">閉じる</button>
  </div></div>`;
}

function bindHoleEvents(root) {
  const s = getState();
  const i = s.currentHole - 1;
  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

  // Parの当日変更：state.pars を直接書き換えて保存し、画面（合計・ニアピン表示など）を更新する
  const parSel = root.querySelector('#par-sel');
  if (parSel) parSel.addEventListener('change', async () => {
    s.pars[i] = Number(parSel.value);
    await saveNow().catch(() => {});
    renderHole(root);
  });

  // 番手 → 結果 の2タップで1打追加
  root.querySelectorAll('.club-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      pendingClub = pendingClub === btn.dataset.club ? '' : btn.dataset.club;
      root.querySelectorAll('.club-btn').forEach(b => b.classList.toggle('active', b.dataset.club === pendingClub));
    });
  });
  root.querySelectorAll('.res-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!pendingClub) {
        const msg = root.querySelector('#shot-msg');
        if (msg) { msg.style.display = ''; setTimeout(() => { msg.style.display = 'none'; }, 1500); }
        return;
      }
      ensureShots(s, i);
      s.shots[i].push({ club: pendingClub, res: btn.dataset.res, isBunker: false, type: 'club', ob: false, pre4: false, pen: false });
      pendingClub = ''; // 記録したら番手選択を解除する（同じ番手を続けて入れられるように）
      selShot = -1; // 付随記録の対象は、いま入れたショットにする
      syncDerived(s, i);
      scheduleSave();
      renderHole(root);
    });
  });
  root.querySelectorAll('.shot-x').forEach(btn => {
    btn.addEventListener('click', () => {
      ensureShots(s, i);
      s.shots[i].splice(Number(btn.dataset.shot), 1);
      selShot = -1;
      syncDerived(s, i);
      scheduleSave();
      renderHole(root);
    });
  });

  // ショットの囲みをタップすると、そのショットが付随記録の対象になる
  root.querySelectorAll('[data-shotbox]').forEach(box => {
    box.addEventListener('click', e => {
      if (e.target.classList.contains('shot-x')) return;
      selShot = Number(box.dataset.shotbox);
      renderHole(root);
    });
  });

  // 付随記録（OB・プレ4・1ペナ・バンカー）：対象ショットへの付け外し
  root.querySelectorAll('[data-mod]').forEach(btn => {
    btn.addEventListener('click', () => {
      ensureShots(s, i);
      const shots = s.shots[i];
      if (!shots.length) return;
      const t = (selShot >= 0 && selShot < shots.length) ? selShot : shots.length - 1;
      const sh = shots[t];
      const kind = btn.dataset.mod;
      if (kind === 'ob') sh.ob = !sh.ob;
      else if (kind === 'pre4') sh.pre4 = !sh.pre4;
      else if (kind === 'pen') sh.pen = !sh.pen;
      else if (kind === 'bunker') sh.isBunker = !sh.isBunker;
      syncDerived(s, i);
      scheduleSave();
      renderHole(root);
    });
  });

  // 同伴者スコア
  root.querySelectorAll('[data-step]').forEach(btn => {
    btn.addEventListener('click', () => {
      const d = Number(btn.dataset.step);
      const kind = btn.dataset.kind;
      if (kind === 'p-score') { const p = s.partners[Number(btn.dataset.partner)]; const base = p.scores[i] || s.pars[i]; p.scores[i] = clamp(base + d, 1, 20); }
      scheduleSave();
      renderHole(root);
    });
  });

  // ホール移動（左右ボタンのみ）。移動は保存だけして、確定はしない。
  // 先にホール番号を境界内に収めて state へ反映してから保存する（保存後に変えると、
  // 直後にアプリが落ちたとき移動が保存されない。処理中はボタンを無効化して連打を防ぐ）。
  const prev = root.querySelector('#hole-prev');
  const next = root.querySelector('#hole-next');
  const moveHole = async delta => {
    const target = clamp(s.currentHole + delta, 1, 18);
    if (target === s.currentHole) return;
    if (prev) prev.disabled = true;
    if (next) next.disabled = true;
    s.currentHole = target;
    await saveNow().catch(() => {});
    renderHole(root);
  };
  if (prev) prev.addEventListener('click', () => moveHole(-1));
  if (next) next.addEventListener('click', () => moveHole(1));

  const nearpin = root.querySelector('#nearpin-sel');
  if (nearpin) nearpin.addEventListener('change', () => {
    if (!s.game) return;
    if (nearpin.value) s.game.nearpin['H' + (i + 1)] = nearpin.value;
    else delete s.game.nearpin['H' + (i + 1)];
    scheduleSave();
    renderHole(root);
  });

  const memo = root.querySelector('#hole-memo');
  if (memo) memo.addEventListener('input', () => { s.holeMemos[i] = memo.value; scheduleSave(); });

  // 確定はこのボタンだけ（世代退避＋クラウド下書き）。処理中の連打は無効化する。
  const confirmBtn = root.querySelector('#hole-confirm');
  if (confirmBtn) confirmBtn.addEventListener('click', async () => {
    if (confirmBtn.disabled) return;
    confirmBtn.disabled = true;
    // 未保存の編集を先に current へ書き切ってから世代退避する（prev が「確定直前の状態」と一致するように）
    await saveNow().catch(() => {});
    await rotateGeneration();
    // 同伴者スコアの未入力はパーで確定する（デフォルト＝パー）
    s.partners.forEach(p => { if (!p.scores[i]) p.scores[i] = s.pars[i]; });
    await saveNow().catch(() => {});
    saveDraft(s).catch(() => {});
    if (s.currentHole < 18) { s.currentHole++; scheduleSave(); }
    renderHole(root);
  });

  const finishBtn = root.querySelector('#go-finish');
  if (finishBtn) finishBtn.addEventListener('click', () => onNavigate('finish'));

  // ホール名タップでホール選択モーダル（移動だけ。確定はしない）
  const holeTitle = root.querySelector('#hole-title');
  if (holeTitle) holeTitle.addEventListener('click', () => { modalOpen = 'holes'; renderHole(root); });
  root.querySelectorAll('[data-hole]').forEach(btn => {
    btn.addEventListener('click', async () => {
      modalOpen = null;
      s.currentHole = Number(btn.dataset.hole);
      await saveNow().catch(() => {});
      renderHole(root);
    });
  });

  // 詳細モーダル（下部のボタンから開く。見切れる位置でよい）
  const openScore = root.querySelector('#open-score');
  if (openScore) openScore.addEventListener('click', () => { modalOpen = 'score'; renderHole(root); });
  const openTomo = root.querySelector('#open-tomo');
  if (openTomo) openTomo.addEventListener('click', () => { modalOpen = 'tomo'; renderHole(root); });
  const overlay = root.querySelector('#modal-overlay');
  if (overlay) {
    overlay.addEventListener('click', e => { if (e.target === overlay) { modalOpen = null; renderHole(root); } });
    const closeBtn = overlay.querySelector('.modal-close');
    if (closeBtn) closeBtn.addEventListener('click', () => { modalOpen = null; renderHole(root); });
  }
}
