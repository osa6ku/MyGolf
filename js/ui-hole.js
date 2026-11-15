// ホール入力画面（v0.3: ショット記録方式）
// - 本人のスコアはショット記録から自動算出（スコア/パットの直接入力は廃止）
// - 1打の記録 = 番手タップ → 結果タップ の2タップ。PT（パター）も他の番手と同じ扱いで結果をつけられる
// - バンカーは打数に数えない独立要素（ステッパー）。OB/ペナ/FWも独立要素
// - 同伴者はスコアのみ（パットなし）
// - ホール移動は左右ボタンのみ（チップ列は廃止）。移動では確定しない。確定は「ホール確定」だけ
// - 4人のときはトモダチの組分けと対象ポイントを上部に表示する
import { getState, scheduleSave, saveNow, rotateGeneration, totals, syncDerived } from './state.js';
import { saveDraft } from './sync.js';
import { calcTomodachi, tomodachiHoleText, playerList } from './game.js';
import { DEFAULT_CLUBS, SHOT_RESULTS, FW_VALUES } from './config.js';

let onNavigate = () => {};
export function setHoleNavHandler(fn) { onNavigate = fn; }

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let pendingClub = '';
let pendingHole = 0; // pendingClub が属するホール（ホールが変わったらリセット）

function miniStepper(label, value, kind, extra = '') {
  return `<span class="mini-stepper">
    <span class="mini-label">${label}</span>
    <button type="button" class="mini-btn" data-step="-1" data-kind="${kind}" ${extra}>−</button>
    <span class="mini-value">${value}</span>
    <button type="button" class="mini-btn" data-step="1" data-kind="${kind}" ${extra}>＋</button>
  </span>`;
}

// v0.2以前の下書き（スコアだけあってショットが無いホール）をショット配列へ変換する（編集を始めたときだけ）
function ensureShots(s, i) {
  if ((s.shots[i] || []).length > 0) return;
  if ((s.scores[i] || 0) <= 0) return;
  const putts = Math.min(s.putts[i] || 0, s.scores[i]);
  const arr = [];
  for (let k = 0; k < s.scores[i] - putts; k++) arr.push({ club: '', res: '', isBunker: false, type: 'club' });
  for (let k = 0; k < putts; k++) arr.push({ club: 'PT', res: '', isBunker: false, type: 'club' });
  s.shots[i] = arr;
}

export function renderHole(root) {
  const s = getState();
  if (!s) { root.innerHTML = '<p>進行中のラウンドがありません。</p>'; return; }
  const i = s.currentHole - 1;
  if (pendingHole !== s.currentHole) { pendingClub = ''; pendingHole = s.currentHole; }
  const t = totals(s);
  const half = i < 9 ? 0 : 1;
  const subName = s.half_names[half];
  const shots = s.shots[i] || [];
  const puttCount = shots.filter(sh => sh.club === 'PT').length;
  const tomo = calcTomodachi(s);
  const tomoHole = tomo ? tomo.perHole[i] : null;
  const names = playerList(s).map(p => p.name);
  const short = n => esc(String(n).replace(/\s/g, ''));

  let html = `
  <div class="hole-head">
    <button type="button" id="hole-prev" ${i === 0 ? 'disabled' : ''}>◀ 前</button>
    <div class="hole-title">
      <div class="hole-name">${esc(subName)} ${i % 9 + 1}H <span class="hole-no">（${s.currentHole}H）</span></div>
      <div class="hole-meta">Par ${s.pars[i]} ・ ${s.yards[i]}y ・ Hdcp ${s.hdcp[i]}</div>
    </div>
    <button type="button" id="hole-next" ${i === 17 ? 'disabled' : ''}>次 ▶</button>
  </div>
  <div class="totals-bar">OUT ${t.out_score}（${t.out_putts}） / IN ${t.in_score}（${t.in_putts}） / 合計 ${t.score} ・ パット ${t.putts}</div>
  ${tomoHole ? `<div class="tomo-bar">
    <div>🤝 A組 ${short(names[tomoHole.teamA[0]])}・${short(names[tomoHole.teamA[1]])} vs B組 ${short(names[tomoHole.teamB[0]])}・${short(names[tomoHole.teamB[1]])}</div>
    <div>${esc(tomodachiHoleText(tomo, i))} ／ 本人 ${tomo.totals[0] > 0 ? '+' : ''}${tomo.totals[0]}pt</div>
  </div>` : ''}

  <section class="card compact">
    <div class="score-line">スコア <b>${shots.length || s.scores[i] || 0}</b> ・ パット <b>${shots.length ? puttCount : (s.putts[i] || 0)}</b>
      <span class="hint">番手→結果の2タップで1打追加</span></div>
    <div class="shots-list">${shots.map((sh, k) =>
      `<span class="shot-line">${k + 1}打 ${esc(sh.club || '—')} ${esc(sh.res || '')}<button type="button" class="shot-x" data-shot="${k}">✕</button></span>`).join('') || '<span class="hint">まだショットがありません</span>'}</div>
    <div class="club-grid">${DEFAULT_CLUBS.map(c =>
      `<button type="button" class="club-btn ${pendingClub === c ? 'active' : ''}" data-club="${c}">${c}</button>`).join('')}</div>
    <div class="res-grid">${SHOT_RESULTS.filter(r => r !== '').map(r =>
      `<button type="button" class="res-btn" data-res="${r}">${r}</button>`).join('')}
      <button type="button" class="res-btn" data-res="">なし</button></div>
    <div id="shot-msg" class="warn" style="display:none">まず番手を選んでください</div>
  </section>

  <section class="card compact">
    <div class="elem-row">
      <span class="mini-label">FW</span>
      <span class="chip-group" id="fw-group">${FW_VALUES.map(v =>
        `<button type="button" class="chip ${s.fw[i] === v ? 'active' : ''}" data-fw="${v}">${v}</button>`).join('')}</span>
    </div>
    <div class="elem-row">
      ${miniStepper('OB', s.ob[i], 'ob')}
      ${miniStepper('ペナ', s.pen[i], 'pen')}
      ${miniStepper('バンカー', s.bunker[i], 'bunker')}
    </div>
    ${s.pars[i] === 3 && s.game ? `<div class="elem-row">
      <span class="mini-label">ニアピン</span>
      <select id="nearpin-sel">
        <option value="">なし</option>
        ${names.map(n => `<option value="${esc(n)}" ${s.game.nearpin['H' + (i + 1)] === n ? 'selected' : ''}>${esc(n)}</option>`).join('')}
      </select>
    </div>` : ''}
  </section>

  ${s.partners.length ? `<section class="card compact">
    ${s.partners.map((p, pi) => `
    <div class="elem-row">
      <span class="partner-name">${esc(p.name)}</span>
      ${miniStepper('スコア', p.scores[i], 'p-score', `data-partner="${pi}"`)}
    </div>`).join('')}
  </section>` : ''}

  <section class="card compact">
    <textarea id="hole-memo" rows="1" placeholder="ホールメモ">${esc(s.holeMemos[i])}</textarea>
  </section>

  <div class="hole-actions">
    <button type="button" id="hole-confirm" class="primary">このホールを確定</button>
    <button type="button" id="go-finish">確認・終了へ</button>
  </div>`;

  root.innerHTML = html;
  bindHoleEvents(root);
}

function bindHoleEvents(root) {
  const s = getState();
  const i = s.currentHole - 1;
  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

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
      s.shots[i].push({ club: pendingClub, res: btn.dataset.res, isBunker: false, type: 'club' });
      syncDerived(s, i);
      scheduleSave();
      renderHole(root);
    });
  });
  root.querySelectorAll('.shot-x').forEach(btn => {
    btn.addEventListener('click', () => {
      ensureShots(s, i);
      s.shots[i].splice(Number(btn.dataset.shot), 1);
      syncDerived(s, i);
      scheduleSave();
      renderHole(root);
    });
  });

  // 独立要素（OB/ペナ/バンカー）と同伴者スコア
  root.querySelectorAll('[data-step]').forEach(btn => {
    btn.addEventListener('click', () => {
      const d = Number(btn.dataset.step);
      const kind = btn.dataset.kind;
      if (kind === 'ob') s.ob[i] = clamp((s.ob[i] || 0) + d, 0, 5);
      else if (kind === 'pen') s.pen[i] = clamp((s.pen[i] || 0) + d, 0, 5);
      else if (kind === 'bunker') s.bunker[i] = clamp((s.bunker[i] || 0) + d, 0, 5);
      else if (kind === 'p-score') { const p = s.partners[Number(btn.dataset.partner)]; p.scores[i] = clamp((p.scores[i] || 0) + d, 0, 20); }
      scheduleSave();
      renderHole(root);
    });
  });

  // ホール移動（左右ボタンのみ）。移動は保存だけして、確定はしない。
  const prev = root.querySelector('#hole-prev');
  const next = root.querySelector('#hole-next');
  if (prev) prev.addEventListener('click', async () => { await saveNow().catch(() => {}); s.currentHole--; scheduleSave(); renderHole(root); });
  if (next) next.addEventListener('click', async () => { await saveNow().catch(() => {}); s.currentHole++; scheduleSave(); renderHole(root); });

  root.querySelectorAll('#fw-group .chip').forEach(chip => {
    chip.addEventListener('click', () => {
      s.fw[i] = s.fw[i] === chip.dataset.fw ? null : chip.dataset.fw;
      scheduleSave();
      renderHole(root);
    });
  });

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

  // 確定はこのボタンだけ（世代退避＋クラウド下書き）
  const confirmBtn = root.querySelector('#hole-confirm');
  if (confirmBtn) confirmBtn.addEventListener('click', async () => {
    await rotateGeneration();
    await saveNow().catch(() => {});
    saveDraft(s).catch(() => {});
    if (s.currentHole < 18) { s.currentHole++; scheduleSave(); }
    renderHole(root);
  });

  const finishBtn = root.querySelector('#go-finish');
  if (finishBtn) finishBtn.addEventListener('click', () => onNavigate('finish'));
}
