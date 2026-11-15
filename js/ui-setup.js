// ラウンド設定：コース選択（プレー済みリスト＋新規はインクリメンタルサーチ）、条件、同伴者、打順（常時）、端末間復元オプション
// v0.3: トモダチの使用オプションは廃止。4人なら開始時に自動でゲームを作る。打順はトモダチと無関係に常時設定する。
import { searchCourses, getMembers, getPlayedCourses } from './master.js';
import { newRoundState, setState, getState, clearCurrent, saveNow, summarize } from './state.js';
import { fetchDraft } from './sync.js';
import { newGame, shuffleOrder } from './game.js';
import { WEATHERS, WINDS } from './config.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let selectedCourse = null;
let onStart = () => {};
export function setSetupStartHandler(fn) { onStart = fn; }

export async function renderSetup(root) {
  // 進行中のラウンドがあるときは、一からの新規設定ではなく「現在の設定」を出す
  const cur = getState();
  if (cur) { await renderCurrentSetup(root, cur); return; }
  selectedCourse = null;
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const played = await getPlayedCourses();
  root.innerHTML = `
  <section class="card">
    <h3>コース</h3>
    <input type="search" id="course-q" placeholder="新規コースは名前・かなで検索">
    <div id="course-results"></div>
    <div id="course-selected"></div>
  </section>
  <section class="card">
    <h3>条件</h3>
    <div class="row"><label>日付</label><input type="date" id="f-date" value="${todayStr}"></div>
    <div class="row"><label>天候</label><select id="f-weather">${WEATHERS.map(w => `<option>${w}</option>`).join('')}</select></div>
    <div class="row"><label>風</label><select id="f-wind">${WINDS.map(w => `<option value="${w}">${w || '—'}</option>`).join('')}</select></div>
  </section>
  <section class="card">
    <h3>同伴者（最大3名）</h3>
    <div id="partner-slots"></div>
    <p class="hint">4人そろうと、トモダチ計算を自動で行います（設定は不要です）。</p>
  </section>
  <section class="card">
    <h3>打順</h3>
    <div class="row"><span>H1の打順</span><button type="button" id="order-shuffle">シャッフル</button></div>
    <ol id="order-list" class="order-list"></ol>
    <p class="hint">手動で変えるときは、入れ替えたい2人を順にタップしてください。</p>
  </section>
  <section class="card">
    <h3>端末間復元（任意）</h3>
    <label class="check"><input type="checkbox" id="f-restore"> 他の端末の下書きを引き継ぐ</label>
    <div id="restore-box"></div>
  </section>
  <button type="button" id="start-round" class="primary" disabled>ラウンド開始</button>`;

  // --- コース選択：初期表示はプレー済みリストのみ。入力したら全マスタを検索 ---
  const q = root.querySelector('#course-q');
  const results = root.querySelector('#course-results');
  const renderPlayed = () => {
    if (!played.length) {
      results.innerHTML = '<p class="hint">プレー済みコースがまだありません。上の検索から選んでください（マスタ同期が必要な場合は設定画面から）。</p>';
      return;
    }
    results.innerHTML = '<p class="hint">プレー済みコース</p>' + played.map(p =>
      `<button type="button" class="course-item" data-id="${esc(p.course_id)}">${esc(p.name)}<span class="course-meta">${p.count}回${p.last ? ` ・ 最終 ${esc(p.last)}` : ''}</span></button>`).join('');
    bindCourseButtons(root, results);
  };
  const renderSearch = async () => {
    const list = await searchCourses(q.value);
    results.innerHTML = list.map(c =>
      `<button type="button" class="course-item" data-id="${esc(c.course_id)}">${esc(c.name)}</button>`).join('') || '<p>該当なし</p>';
    bindCourseButtons(root, results);
  };
  q.addEventListener('input', () => {
    if (!q.value.trim()) renderPlayed();
    else renderSearch();
  });
  renderPlayed();

  // --- 同伴者スロット（メンバー一覧から選択。新規はその場で入力） ---
  const members = await getMembers();
  const slotsRoot = root.querySelector('#partner-slots');
  slotsRoot.innerHTML = [0, 1, 2].map(k => `
    <div class="row">
      <select class="partner-select" data-slot="${k}">
        <option value="">同伴者${k + 1}（なし）</option>
        ${members.map(m => `<option value="${esc(m.name)}">${esc(m.name)}${m.count ? `（${m.count}回）` : ''}</option>`).join('')}
        <option value="+新規">＋新規入力</option>
      </select>
      <input type="text" class="partner-new" data-slot="${k}" placeholder="名前を入力" style="display:none">
    </div>`).join('');
  slotsRoot.querySelectorAll('.partner-select').forEach(sel => {
    sel.addEventListener('change', () => {
      const input = slotsRoot.querySelector(`.partner-new[data-slot="${sel.dataset.slot}"]`);
      input.style.display = sel.value === '+新規' ? '' : 'none';
      if (sel.value === '+新規') input.focus();
      refreshOrder(root);
    });
  });
  slotsRoot.querySelectorAll('.partner-new').forEach(inp => {
    inp.addEventListener('input', () => refreshOrder(root));
  });

  // --- 打順（常時表示） ---
  root.querySelector('#order-list').dataset.order = JSON.stringify(playerNames(root));
  renderOrder(root);
  root.querySelector('#order-shuffle').addEventListener('click', () => {
    const shuffled = shuffleOrder(playerNames(root));
    root.querySelector('#order-list').dataset.order = JSON.stringify(shuffled);
    renderOrder(root);
  });

  // --- 端末間復元 ---
  const restoreCheck = root.querySelector('#f-restore');
  restoreCheck.addEventListener('change', async () => {
    const box = root.querySelector('#restore-box');
    if (!restoreCheck.checked) { box.innerHTML = ''; return; }
    box.innerHTML = '<p>下書きを取得中…</p>';
    try {
      const draft = await fetchDraft();
      if (!draft || !draft.payload) { box.innerHTML = '<p>クラウドに下書きはありませんでした。</p>'; return; }
      const sum = summarize(draft.payload);
      box.innerHTML = `
        <p>下書きが見つかりました：${esc(sum.course_name)}（${esc(sum.date)}）/ 現在 ${sum.currentHole}H / 入力済み ${sum.playedHoles}H / スコア計 ${sum.scoreSoFar}</p>
        <button type="button" id="apply-draft" class="primary">この下書きで開始する</button>`;
      box.querySelector('#apply-draft').addEventListener('click', async () => {
        setState(draft.payload);
        await saveNow();
        onStart();
      });
    } catch (err) {
      box.innerHTML = `<p class="warn">下書きの取得に失敗しました：${esc(err.message || err)}</p>`;
    }
  });

  root.querySelector('#start-round').addEventListener('click', async () => {
    if (!selectedCourse) return;
    const halfA = root.querySelector('#half-a').value;
    const halfB = root.querySelector('#half-b').value;
    const teeName = root.querySelector('#tee-sel').value;
    const greenName = root.querySelector('#green-sel').value;
    const subs = selectedCourse.sub_courses;
    const pick = name => {
      const sub = subs.find(x => x.name === name);
      const tees = sub.tees || [];
      const tee = tees.find(t => t.tee_name === teeName && t.green_name === greenName)
        || tees.find(t => t.tee_name === teeName)
        || tees.find(t => t.green_name === greenName)
        || tees[0]
        || { distance_per_hole: sub.pars.map(() => 0) };
      return { name: sub.name, pars: sub.pars, handicaps: sub.handicaps, yards: tee.distance_per_hole, strategies: sub.hole_strategies || [] };
    };
    const partners = collectPartners(root);
    const order = JSON.parse(root.querySelector('#order-list').dataset.order || '[]');
    const finalOrder = order.length ? order : playerNames(root);
    // 4人のときだけトモダチ（自動）。打順そのものは人数によらず保持する。
    const game = partners.length === 3 ? newGame(finalOrder) : null;
    const state = newRoundState({
      date: root.querySelector('#f-date').value,
      course_id: selectedCourse.course_id,
      course_name: selectedCourse.name,
      halves: [pick(halfA), pick(halfB)],
      tee_name: teeName, green_name: greenName,
      weather: root.querySelector('#f-weather').value,
      wind: root.querySelector('#f-wind').value,
      partners, game, order: finalOrder,
    });
    setState(state);
    await saveNow();
    onStart();
  });
}

function bindCourseButtons(root, results) {
  results.querySelectorAll('.course-item').forEach(btn => {
    btn.addEventListener('click', () => selectCourse(root, btn.dataset.id));
  });
}

export function collectPartners(root) {
  const names = [];
  root.querySelectorAll('.partner-select').forEach(sel => {
    if (sel.value === '+新規') {
      const v = root.querySelector(`.partner-new[data-slot="${sel.dataset.slot}"]`).value.trim();
      if (v) names.push(v);
    } else if (sel.value) {
      names.push(sel.value);
    }
  });
  return names;
}

function playerNames(root) {
  return ['桑木修', ...collectPartners(root)];
}

// 同伴者が変わったら打順を引き継ぎつつ追随させる（残っている名前の順序は維持、新規は末尾）
function refreshOrder(root) {
  const list = root.querySelector('#order-list');
  const names = playerNames(root);
  const prev = JSON.parse(list.dataset.order || '[]');
  const merged = prev.filter(n => names.includes(n));
  names.forEach(n => { if (!merged.includes(n)) merged.push(n); });
  list.dataset.order = JSON.stringify(merged);
  renderOrder(root);
}

let swapPick = null;
function renderOrder(root) {
  const list = root.querySelector('#order-list');
  const order = JSON.parse(list.dataset.order || '[]');
  list.innerHTML = order.map((n, i) =>
    `<li><button type="button" class="order-item ${swapPick === i ? 'picked' : ''}" data-idx="${i}">${i + 1}. ${esc(n)}</button></li>`).join('');
  list.querySelectorAll('.order-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.idx);
      if (swapPick === null) { swapPick = idx; renderOrder(root); return; }
      if (swapPick === idx) { swapPick = null; renderOrder(root); return; }
      const cur = JSON.parse(list.dataset.order || '[]');
      [cur[swapPick], cur[idx]] = [cur[idx], cur[swapPick]];
      list.dataset.order = JSON.stringify(cur);
      swapPick = null;
      renderOrder(root);
    });
  });
}

async function selectCourse(root, courseId) {
  const { allCourses } = await import('./master.js');
  const all = await allCourses();
  selectedCourse = all.find(c => String(c.course_id) === String(courseId));
  if (!selectedCourse) return;
  const subs = selectedCourse.sub_courses || [];
  const teeNames = [];
  const greenNames = [];
  let regularTee = '';
  subs.forEach(sub => (sub.tees || []).forEach(t => {
    if (!teeNames.includes(t.tee_name)) teeNames.push(t.tee_name);
    if (!greenNames.includes(t.green_name)) greenNames.push(t.green_name);
    if (t.is_regular_tee && !regularTee) regularTee = t.tee_name;
  }));
  root.querySelector('#course-selected').innerHTML = `
    <p class="selected-course">選択中：${esc(selectedCourse.name)}</p>
    <div class="row"><label>前半</label><select id="half-a">${subs.map(s => `<option>${esc(s.name)}</option>`).join('')}</select></div>
    <div class="row"><label>後半</label><select id="half-b">${subs.map((s, ix) => `<option ${ix === 1 ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>
    <div class="row"><label>ティー</label><select id="tee-sel">${teeNames.map(n => `<option ${n === regularTee ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></div>
    <div class="row"><label>グリーン</label><select id="green-sel">${greenNames.map(n => `<option>${esc(n)}</option>`).join('')}</select></div>`;
  root.querySelector('#start-round').disabled = false;
}

// 進行中のラウンドがあるときのラウンド設定：現在の設定を表示し、天候・風・打順だけ更新できる
async function renderCurrentSetup(root, s) {
  const names = ['桑木修', ...s.partners.map(p => p.name)];
  const initialOrder = (s.order && s.order.length) ? s.order : ((s.game && s.game.order) || names);
  root.innerHTML = `
  <section class="card">
    <h3>現在のラウンド設定</h3>
    <p class="selected-course">${esc(s.course_name)}（${esc(s.date)}）</p>
    <p>コース構成：${s.half_names.map(esc).join(' / ')}<br>ティー：${esc(s.tee || '—')} ／ グリーン：${esc(s.green || '—')}</p>
    <p class="hint">コース・日付・同伴者はラウンド中は変更できません。変える場合は下の「新しいラウンドを始める」から（進行中の記録は破棄されます）。</p>
  </section>
  <section class="card">
    <h3>条件</h3>
    <div class="row"><label>天候</label><select id="f-weather">${WEATHERS.map(w => `<option ${s.weather === w ? 'selected' : ''}>${w}</option>`).join('')}</select></div>
    <div class="row"><label>風</label><select id="f-wind">${WINDS.map(w => `<option value="${w}" ${s.wind === w ? 'selected' : ''}>${w || '—'}</option>`).join('')}</select></div>
  </section>
  <section class="card">
    <h3>同伴者</h3>
    <p>${s.partners.length ? s.partners.map(p => esc(p.name)).join('、') : '同伴者なし'}</p>
  </section>
  <section class="card">
    <h3>打順</h3>
    <div class="row"><span>H1の打順</span><button type="button" id="order-shuffle">シャッフル</button></div>
    <ol id="order-list" class="order-list"></ol>
    <p class="hint">手動で変えるときは、入れ替えたい2人を順にタップしてください。</p>
  </section>
  <button type="button" id="apply-settings" class="primary">更新して入力に戻る</button>
  <button type="button" id="restart-round">新しいラウンドを始める</button>`;

  const list = root.querySelector('#order-list');
  list.dataset.order = JSON.stringify(initialOrder);
  renderOrder(root);
  root.querySelector('#order-shuffle').addEventListener('click', () => {
    const curOrder = JSON.parse(list.dataset.order || '[]');
    list.dataset.order = JSON.stringify(shuffleOrder(curOrder.length ? curOrder : names));
    renderOrder(root);
  });
  root.querySelector('#apply-settings').addEventListener('click', async () => {
    s.weather = root.querySelector('#f-weather').value;
    s.wind = root.querySelector('#f-wind').value;
    const order = JSON.parse(list.dataset.order || '[]');
    if (order.length) { s.order = order; if (s.game) s.game.order = order; }
    await saveNow();
    onStart();
  });
  root.querySelector('#restart-round').addEventListener('click', async () => {
    if (!confirm('進行中のラウンドを破棄して、新しいラウンドの設定を始めますか？')) return;
    await clearCurrent();
    await renderSetup(root);
  });
}
