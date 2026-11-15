// ホール入力画面：本人（スコア/パット/番手/ショット/FW/OB/ペナ/バンカー/メモ）＋同伴者（スコア/パット）
// 再描画はホール画面全体ではなく入力部のみ。保存は state.scheduleSave に委ねる。
import { getState, scheduleSave, saveNow, rotateGeneration, totals } from './state.js';
import { saveDraft } from './sync.js';
import { DEFAULT_CLUBS, SHOT_RESULTS, FW_VALUES } from './config.js';

let onNavigate = () => {};
export function setHoleNavHandler(fn) { onNavigate = fn; }

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function stepper(label, value, min, max, dataAttrs) {
  return `<div class="stepper">
    <span class="stepper-label">${label}</span>
    <button type="button" class="step-btn" data-step="-1" ${dataAttrs}>−</button>
    <span class="step-value">${value}</span>
    <button type="button" class="step-btn" data-step="1" ${dataAttrs}>＋</button>
  </div>`;
}

export function renderHole(root) {
  const s = getState();
  if (!s) { root.innerHTML = '<p>進行中のラウンドがありません。</p>'; return; }
  const i = s.currentHole - 1;
  const t = totals(s);
  const half = i < 9 ? 0 : 1;
  const subName = s.half_names[half];

  let html = `
  <div class="hole-head">
    <button type="button" id="hole-prev" ${i === 0 ? 'disabled' : ''}>◀ 前</button>
    <div class="hole-title">
      <div class="hole-name">${esc(subName)} ${i % 9 + 1}H <span class="hole-no">（通し ${s.currentHole}H）</span></div>
      <div class="hole-meta">Par ${s.pars[i]} ・ ${s.yards[i]}y ・ Hdcp ${s.hdcp[i]}</div>
    </div>
    <button type="button" id="hole-next" ${i === 17 ? 'disabled' : ''}>次 ▶</button>
  </div>
  <div class="hole-nav">${s.scores.map((v, h) =>
    `<button type="button" class="hole-chip ${h === i ? 'active' : ''} ${v > 0 ? 'done' : ''}" data-hole="${h + 1}">${h + 1}</button>`).join('')}</div>
  <div class="totals-bar">OUT ${t.out_score}（${t.out_putts}） / IN ${t.in_score}（${t.in_putts}） / 合計 ${t.score} ・ パット ${t.putts}</div>

  <section class="card">
    <h3>本人のスコア</h3>
    ${stepper('スコア', s.scores[i], 0, 20, `data-kind="score"`)}
    ${stepper('パット', s.putts[i], 0, 10, `data-kind="putts"`)}
    <div class="row">
      <label>FW</label>
      <div class="chip-group" id="fw-group">${FW_VALUES.map(v =>
        `<button type="button" class="chip ${s.fw[i] === v ? 'active' : ''}" data-fw="${v}">${v}</button>`).join('')}</div>
    </div>
    ${stepper('OB', s.ob[i], 0, 5, `data-kind="ob"`)}
    ${stepper('ペナ', s.pen[i], 0, 5, `data-kind="pen"`)}
    ${stepper('バンカー', s.bunker[i], 0, 5, `data-kind="bunker"`)}
    <div class="row">
      <label>ティーショット番手</label>
      <select id="tee-club">${['', ...DEFAULT_CLUBS].map(c =>
        `<option value="${c}" ${s.clubs[i] === c ? 'selected' : ''}>${c || '—'}</option>`).join('')}</select>
    </div>
  </section>

  <section class="card">
    <h3>ショット記録</h3>
    <div id="shots">
      ${s.shots[i].map((sh, k) => `
      <div class="shot-row" data-shot="${k}">
        <span class="shot-no">${k + 1}打</span>
        <select class="shot-club">${DEFAULT_CLUBS.map(c =>
          `<option value="${c}" ${sh.club === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
        <select class="shot-res">${SHOT_RESULTS.map(r =>
          `<option value="${r}" ${sh.res === r ? 'selected' : ''}>${r || '結果'}</option>`).join('')}</select>
        <button type="button" class="shot-del" data-shot="${k}">✕</button>
      </div>`).join('')}
    </div>
    <div class="row">
      <button type="button" id="shot-add">＋ ショット追加</button>
      <button type="button" id="shot-bunker">バンカー追加</button>
      <button type="button" id="shot-ob">OB追加</button>
      <button type="button" id="shot-pre4">プレ4追加</button>
    </div>
  </section>

  <section class="card">
    <h3>同伴者</h3>
    ${s.partners.map((p, pi) => `
    <div class="partner-row">
      <span class="partner-name">${esc(p.name)}</span>
      ${stepper('スコア', p.scores[i], 0, 20, `data-kind="p-score" data-partner="${pi}"`)}
      ${stepper('パット', p.putts[i] ?? 0, 0, 10, `data-kind="p-putts" data-partner="${pi}"`)}
    </div>`).join('') || '<p>同伴者なし</p>'}
  </section>

  <section class="card">
    <h3>ホールメモ</h3>
    <textarea id="hole-memo" rows="2" placeholder="このホールのメモ">${esc(s.holeMemos[i])}</textarea>
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

  root.querySelectorAll('[data-step]').forEach(btn => {
    btn.addEventListener('click', () => {
      const d = Number(btn.dataset.step);
      const kind = btn.dataset.kind;
      const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
      if (kind === 'score') s.scores[i] = clamp((s.scores[i] || 0) + d, 0, 20);
      else if (kind === 'putts') s.putts[i] = clamp((s.putts[i] || 0) + d, 0, 10);
      else if (kind === 'ob') s.ob[i] = clamp((s.ob[i] || 0) + d, 0, 5);
      else if (kind === 'pen') s.pen[i] = clamp((s.pen[i] || 0) + d, 0, 5);
      else if (kind === 'bunker') s.bunker[i] = clamp((s.bunker[i] || 0) + d, 0, 5);
      else if (kind === 'p-score') { const p = s.partners[Number(btn.dataset.partner)]; p.scores[i] = clamp((p.scores[i] || 0) + d, 0, 20); }
      else if (kind === 'p-putts') { const p = s.partners[Number(btn.dataset.partner)]; p.putts[i] = clamp((p.putts[i] || 0) + d, 0, 10); }
      scheduleSave();
      renderHole(root);
    });
  });

  root.querySelectorAll('.hole-chip').forEach(chip => {
    chip.addEventListener('click', async () => {
      await saveNow().catch(() => {});
      s.currentHole = Number(chip.dataset.hole);
      scheduleSave();
      renderHole(root);
    });
  });
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

  const teeClub = root.querySelector('#tee-club');
  if (teeClub) teeClub.addEventListener('change', () => { s.clubs[i] = teeClub.value; scheduleSave(); });

  const shotsRoot = root.querySelector('#shots');
  if (shotsRoot) {
    shotsRoot.querySelectorAll('.shot-row').forEach(row => {
      const k = Number(row.dataset.shot);
      row.querySelector('.shot-club').addEventListener('change', e => { s.shots[i][k].club = e.target.value; scheduleSave(); });
      row.querySelector('.shot-res').addEventListener('change', e => { s.shots[i][k].res = e.target.value; scheduleSave(); });
      row.querySelector('.shot-del').addEventListener('click', () => { s.shots[i].splice(k, 1); scheduleSave(); renderHole(root); });
    });
  }
  const addShot = (shot) => { s.shots[i].push(shot); scheduleSave(); renderHole(root); };
  const addBtn = root.querySelector('#shot-add');
  if (addBtn) addBtn.addEventListener('click', () => addShot({ club: s.clubs[i] || '1W', res: '', isBunker: false, type: 'club' }));
  const bkBtn = root.querySelector('#shot-bunker');
  if (bkBtn) bkBtn.addEventListener('click', () => addShot({ club: 'バンカー', res: '', isBunker: true, type: 'bunker' }));
  const obBtn = root.querySelector('#shot-ob');
  if (obBtn) obBtn.addEventListener('click', () => addShot({ club: 'OB', res: '', isBunker: false, type: 'ob' }));
  const pre4Btn = root.querySelector('#shot-pre4');
  if (pre4Btn) pre4Btn.addEventListener('click', () => addShot({ club: 'プレ4', res: '', isBunker: false, type: 'pre4' }));

  const memo = root.querySelector('#hole-memo');
  if (memo) memo.addEventListener('input', () => { s.holeMemos[i] = memo.value; scheduleSave(); });

  const confirmBtn = root.querySelector('#hole-confirm');
  if (confirmBtn) confirmBtn.addEventListener('click', async () => {
    await rotateGeneration();          // 現世代を prev に退避
    await saveNow().catch(() => {});    // 確定内容を current に保存
    saveDraft(s).catch(() => {});       // クラウド下書き（失敗しても止めない）
    if (s.currentHole < 18) { s.currentHole++; scheduleSave(); }
    renderHole(root);
  });

  const finishBtn = root.querySelector('#go-finish');
  if (finishBtn) finishBtn.addEventListener('click', () => onNavigate('finish'));
}
