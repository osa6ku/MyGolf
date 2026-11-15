// ラウンド設定：コース検索・選択、条件、同伴者、ゲーム設定（打順シャッフル/手動）、端末間復元オプション
import { searchCourses, masterCount, getMembers } from './master.js';
import { newRoundState, setState, saveNow, summarize } from './state.js';
import { fetchDraft } from './sync.js';
import { newGame, shuffleOrder } from './game.js';
import { WEATHERS, WINDS } from './config.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let selectedCourse = null;
let onStart = () => {};
export function setSetupStartHandler(fn) { onStart = fn; }

export async function renderSetup(root) {
  const count = await masterCount();
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  root.innerHTML = `
  <section class="card">
    <h3>コース</h3>
    ${count === 0 ? '<p class="warn">コースマスタが未同期です。設定画面から「マスタ同期」を実行してください（GAS URL の設定が必要）。</p>' : ''}
    <input type="search" id="course-q" placeholder="コース名・かな・略称で検索">
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
    <label class="check"><input type="checkbox" id="f-game"> トモダチゲームを使う</label>
    <div id="game-box" style="display:none">
      <div class="row"><span>打順</span><button type="button" id="order-shuffle">シャッフル</button></div>
      <ol id="order-list"></ol>
      <p class="hint">打順は名前をタップで入れ替え（手動設定）もできます。まずシャッフルか、そのままの並びで開始できます。</p>
    </div>
  </section>
  <section class="card">
    <h3>端末間復元（任意）</h3>
    <label class="check"><input type="checkbox" id="f-restore"> 他の端末の下書きを引き継ぐ</label>
    <div id="restore-box"></div>
  </section>
  <button type="button" id="start-round" class="primary" disabled>ラウンド開始</button>`;

  const q = root.querySelector('#course-q');
  const results = root.querySelector('#course-results');
  q.addEventListener('input', async () => {
    const list = await searchCourses(q.value);
    results.innerHTML = list.map(c =>
      `<button type="button" class="course-item" data-id="${esc(c.course_id)}">${esc(c.name)}</button>`).join('') || '<p>該当なし</p>';
    results.querySelectorAll('.course-item').forEach(btn => {
      btn.addEventListener('click', () => selectCourse(root, btn.dataset.id));
    });
  });

  const gameCheck = root.querySelector('#f-game');
  const gameBox = root.querySelector('#game-box');
  gameCheck.addEventListener('change', () => {
    gameBox.style.display = gameCheck.checked ? '' : 'none';
    renderOrder(root);
  });
  root.querySelector('#order-shuffle').addEventListener('click', () => {
    const names = playerNames(root);
    const shuffled = shuffleOrder(names);
    root.querySelector('#order-list').dataset.order = JSON.stringify(shuffled);
    renderOrder(root, shuffled);
  });

  // 同伴者スロット（メンバー一覧から選択。新規はその場で入力）
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
      renderOrder(root);
    });
  });
  slotsRoot.querySelectorAll('.partner-new').forEach(inp => {
    inp.addEventListener('input', () => renderOrder(root));
  });

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
    const teeSel = root.querySelector('#tee-sel');
    const [teeName, greenName] = (teeSel.value || '').split('|');
    const subs = selectedCourse.sub_courses;
    const pick = name => {
      const sub = subs.find(x => x.name === name);
      const tee = sub.tees.find(t => t.tee_name === teeName && t.green_name === greenName) || sub.tees[0];
      return { name: sub.name, pars: sub.pars, handicaps: sub.handicaps, yards: tee.distance_per_hole };
    };
    const partners = collectPartners(root);
    let game = null;
    if (gameCheck.checked) {
      const order = JSON.parse(root.querySelector('#order-list').dataset.order || '[]');
      game = newGame(order.length ? order : playerNames(root));
    }
    const state = newRoundState({
      date: root.querySelector('#f-date').value,
      course_id: selectedCourse.course_id,
      course_name: selectedCourse.name,
      halves: [pick(halfA), pick(halfB)],
      tee_name: teeName, green_name: greenName,
      weather: root.querySelector('#f-weather').value,
      wind: root.querySelector('#f-wind').value,
      partners, game,
    });
    setState(state);
    await saveNow();
    onStart();
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

function renderOrder(root, order) {
  const list = root.querySelector('#order-list');
  const names = order || JSON.parse(list.dataset.order || '[]');
  const shown = names.length ? names : playerNames(root);
  list.dataset.order = JSON.stringify(shown);
  list.innerHTML = shown.map(n => `<li>${esc(n)}</li>`).join('');
}

async function selectCourse(root, courseId) {
  const { allCourses } = await import('./master.js');
  const all = await allCourses();
  selectedCourse = all.find(c => String(c.course_id) === String(courseId));
  if (!selectedCourse) return;
  const subs = selectedCourse.sub_courses || [];
  const teeKeys = [];
  subs.forEach(sub => (sub.tees || []).forEach(t => {
    const key = `${t.tee_name}|${t.green_name}`;
    if (!teeKeys.includes(key)) teeKeys.push(key);
  }));
  root.querySelector('#course-selected').innerHTML = `
    <p class="selected-course">選択中：${esc(selectedCourse.name)}</p>
    <div class="row"><label>前半</label><select id="half-a">${subs.map(s => `<option>${esc(s.name)}</option>`).join('')}</select></div>
    <div class="row"><label>後半</label><select id="half-b">${subs.map((s, ix) => `<option ${ix === 1 ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>
    <div class="row"><label>ティー</label><select id="tee-sel">${teeKeys.map(k => `<option value="${esc(k)}">${esc(k.replace('|', ' / '))}</option>`).join('')}</select></div>`;
  root.querySelector('#start-round').disabled = false;
}
