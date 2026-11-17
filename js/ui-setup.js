// ラウンド設定：コース選択（プレー済みリスト＋新規はインクリメンタルサーチ）、条件、同伴者、打順（常時）、端末間復元オプション
// v0.3: トモダチの使用オプションは廃止。4人なら開始時に自動でゲームを作る。打順はトモダチと無関係に常時設定する。
import { searchCourses, getMembers, getPlayedCourses, addCustomCourse } from './master.js';
import { newRoundState, setState, getState, clearCurrent, saveNow, overwritePrevGeneration, summarize } from './state.js';
import { fetchDraft, saveDraft } from './sync.js';
import { newGame, shuffleOrder } from './game.js';
import { WEATHERS, WINDS } from './config.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let selectedCourse = null;
let lastPreset = null;
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
  const playedSorted = [...played].sort((a, b) => (b.count - a.count) || String(b.last || '').localeCompare(String(a.last || '')));
  root.innerHTML = `
  <section class="card">
    <h3>コース</h3>
    <input type="search" id="course-q" placeholder="新規コースは名前・かなで検索">
    <select id="played-select">
      <option value="">プレー済みコースから選ぶ（回数が多い順）</option>
      ${playedSorted.map(p => `<option value="${esc(p.course_id)}">${esc(p.name)}（${p.count}回${p.last ? `・${esc(p.last)}` : ''}）</option>`).join('')}
    </select>
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

  // --- コース選択：プレー済みは同伴者と同じプルダウンから。新規は入力して全マスタを検索 ---
  wireCourseSearch(root);

  // --- 同伴者スロット（メンバー一覧から選択。新規はその場で入力） ---
  const members = await getMembers();
  members.sort((a, b) => (b.count || 0) - (a.count || 0)); // 共回数が多い順
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
    const pick = name => pickSub(selectedCourse, name, teeName, greenName);
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

// 後半の候補：コースに組み合わせ表（half_pairs: [[前半,後半],...]）があればそれに従い、
// 無ければ前半と同じハーフを除いた残り全部。ハーフが1つだけのコース（9ホール）は同じハーフを2回回る。
function halfCandidates(course, frontName) {
  const subs = course.sub_courses || [];
  const names = subs.map(s => s.name);
  if (names.length <= 1) return names;
  const pairs = Array.isArray(course.half_pairs) ? course.half_pairs : [];
  const paired = pairs.filter(p => p && p[0] === frontName).map(p => p[1]).filter(n => names.includes(n));
  if (paired.length) return [...new Set(paired)];
  return names.filter(n => n !== frontName);
}

// ハーフ名＋ティー＋グリーンから、state が必要とするハーフ情報を組み立てる
function pickSub(course, halfName, teeName, greenName) {
  const sub = (course.sub_courses || []).find(x => x.name === halfName) || course.sub_courses[0];
  const tees = sub.tees || [];
  const tee = tees.find(t => t.tee_name === teeName && t.green_name === greenName)
    || tees.find(t => t.tee_name === teeName)
    || tees.find(t => t.green_name === greenName)
    || tees[0]
    || { distance_per_hole: sub.pars.map(() => 0) };
  return { name: sub.name, pars: sub.pars, handicaps: sub.handicaps, yards: tee.distance_per_hole, strategies: sub.hole_strategies || [] };
}

// コース検索の配線（新規設定・設定変更で共通）。検索結果に出ないコースはその場で新規追加できる。
function wireCourseSearch(root) {
  const q = root.querySelector('#course-q');
  const results = root.querySelector('#course-results');
  const renderSearch = async () => {
    const list = await searchCourses(q.value);
    const html = list.map(c =>
      `<button type="button" class="course-item" data-id="${esc(c.course_id)}">${esc(c.name)}</button>`).join('');
    results.innerHTML = (html || '<p>該当なし</p>')
      + (q.value.trim() ? `<button type="button" class="course-item" data-add="1">「${esc(q.value.trim())}」を新規コースとして追加</button>` : '');
    bindCourseButtons(root, results);
    const addBtn = results.querySelector('[data-add]');
    if (addBtn) addBtn.addEventListener('click', () => renderNewCourseForm(root, q.value.trim()));
  };
  q.addEventListener('input', () => {
    if (!q.value.trim()) results.innerHTML = '';
    else renderSearch();
  });
  root.querySelector('#played-select').addEventListener('change', e => {
    if (e.target.value) selectCourse(root, e.target.value);
  });
}

const PAR_TEMPLATE = [4, 4, 3, 5, 4, 4, 3, 5, 4];
const HDCP_TEMPLATE = [2, 5, 8, 1, 7, 4, 9, 6, 3];

// マスタに無いコースをこの端末に追加する（最低限：名前・ハーフ名・パー。距離は0、Hdcpは仮置き）
function renderNewCourseForm(root, name) {
  const box = root.querySelector('#course-selected');
  const halfBlock = (idx, defName) => `
    <div class="nc-half">
      <div class="row"><label>ハーフ${idx + 1}名</label><input type="text" class="nc-half-name" value="${esc(defName)}"></div>
      <div class="row"><label>パー</label><span class="nc-pars">${PAR_TEMPLATE.map(p => `<select class="nc-par">${[3, 4, 5, 6].map(v => `<option ${v === p ? 'selected' : ''}>${v}</option>`).join('')}</select>`).join('')}</span></div>
    </div>`;
  box.innerHTML = `
    <p class="selected-course">新規コースを追加（この端末にだけ保存されます）</p>
    <div class="row"><label>コース名</label><input type="text" id="nc-name" value="${esc(name || '')}"></div>
    <div class="row"><label>ハーフ数</label><select id="nc-count"><option value="2">2（18ホール）</option><option value="1">1（9ホール）</option></select></div>
    <div id="nc-halves">${halfBlock(0, 'OUT')}${halfBlock(1, 'IN')}</div>
    <p class="hint">パーは標準的な並びが初期値です。違うホールは直してください。距離は0で登録されます。</p>
    <div class="row"><button type="button" id="nc-save" class="primary">追加して選択する</button><button type="button" id="nc-cancel">やめる</button></div>`;
  const countSel = box.querySelector('#nc-count');
  countSel.addEventListener('change', () => {
    box.querySelector('#nc-halves').innerHTML = countSel.value === '1' ? halfBlock(0, 'OUT') : halfBlock(0, 'OUT') + halfBlock(1, 'IN');
  });
  box.querySelector('#nc-cancel').addEventListener('click', () => {
    if (selectedCourse) selectCourse(root, selectedCourse.course_id, lastPreset || undefined);
    else box.innerHTML = '';
  });
  box.querySelector('#nc-save').addEventListener('click', async () => {
    const cname = box.querySelector('#nc-name').value.trim();
    if (!cname) { alert('コース名を入力してください'); return; }
    const subs = [...box.querySelectorAll('.nc-half')].map((h, i) => ({
      sub_course_id: null,
      name: h.querySelector('.nc-half-name').value.trim() || (i === 0 ? 'OUT' : 'IN'),
      hole_range: '1_to_9',
      pars: [...h.querySelectorAll('.nc-par')].map(s => Number(s.value)),
      handicaps: [...HDCP_TEMPLATE],
      hole_strategies: Array(9).fill(null),
      recommended_holes: Array(9).fill(null),
      tees: [],
    }));
    const course = {
      course_id: `local-${Date.now()}`, name: cname, name_kana: '', name_abbreviation: '', custom: true,
      sub_courses: subs,
    };
    await addCustomCourse(course);
    const res = root.querySelector('#course-results');
    if (res) res.innerHTML = '';
    await selectCourse(root, course.course_id);
  });
}

function bindCourseButtons(root, results) {
  results.querySelectorAll('.course-item').forEach(btn => {
    btn.addEventListener('click', () => selectCourse(root, btn.dataset.id));
  });
}

export function collectPartners(root) {
  const names = [];
  const push = raw => {
    // 名前は空白を除いて正規化し、本人と重複は除外する（トモダチ計算の名前照合を壊さないため）
    const v = String(raw || '').replace(/\s+/g, '');
    if (!v || v === '桑木修' || names.includes(v)) return;
    names.push(v);
  };
  root.querySelectorAll('.partner-select').forEach(sel => {
    if (sel.value === '+新規') {
      push(root.querySelector(`.partner-new[data-slot="${sel.dataset.slot}"]`).value);
    } else if (sel.value) {
      push(sel.value);
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

async function selectCourse(root, courseId, preset) {
  const { allCourses } = await import('./master.js');
  const all = await allCourses();
  selectedCourse = all.find(c => String(c.course_id) === String(courseId));
  if (!selectedCourse) return;
  if (preset) lastPreset = preset;
  const subs = selectedCourse.sub_courses || [];
  const teeNames = [];
  const greenNames = [];
  let regularTee = '';
  subs.forEach(sub => (sub.tees || []).forEach(t => {
    if (!teeNames.includes(t.tee_name)) teeNames.push(t.tee_name);
    if (!greenNames.includes(t.green_name)) greenNames.push(t.green_name);
    if (t.is_regular_tee && !regularTee) regularTee = t.tee_name;
  }));
  const halfA = preset && preset.halfA && subs.some(s => s.name === preset.halfA) ? preset.halfA : (subs[0] ? subs[0].name : '');
  const backCandidates = halfCandidates(selectedCourse, halfA);
  const halfB = preset && preset.halfB && backCandidates.includes(preset.halfB) ? preset.halfB : (backCandidates[0] || halfA);
  const teeSel = preset && preset.tee && teeNames.includes(preset.tee) ? preset.tee : regularTee;
  const greenSel = preset && preset.green && greenNames.includes(preset.green) ? preset.green : (greenNames[0] || '');
  root.querySelector('#course-selected').innerHTML = `
    <p class="selected-course">選択中：${esc(selectedCourse.name)}</p>
    <div class="row"><label>前半</label><select id="half-a">${subs.map(s => `<option ${s.name === halfA ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>
    <div class="row"><label>後半</label><select id="half-b">${backCandidates.map(n => `<option ${n === halfB ? 'selected' : ''}>${esc(n)}</option>`).join('')}<option value="__all__">＋ 全ハーフから選ぶ</option></select></div>
    <div class="row"><label>ティー</label><select id="tee-sel">${teeNames.map(n => `<option ${n === teeSel ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></div>
    <div class="row"><label>グリーン</label><select id="green-sel">${greenNames.map(n => `<option ${n === greenSel ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></div>`;
  // 前半を変えたら後半の候補を連動させる（現在の後半が候補に残る場合は維持、残らなければ先頭の候補にする）。
  // 後半で「＋ 全ハーフから選ぶ」を選ぶと全ハーフ表示に切り替わり、その後は前半に連動させない（手動選択を優先）。
  const halfASel = root.querySelector('#half-a');
  const halfBSel = root.querySelector('#half-b');
  if (halfASel && halfBSel) {
    halfBSel.dataset.current = halfB;
    const renderBack = names => {
      const keep = names.includes(halfBSel.dataset.current) ? halfBSel.dataset.current : names[0];
      halfBSel.dataset.current = keep;
      halfBSel.innerHTML = names.map(n => `<option ${n === keep ? 'selected' : ''}>${esc(n)}</option>`).join('')
        + (halfBSel.dataset.free === '1' ? '' : '<option value="__all__">＋ 全ハーフから選ぶ</option>');
    };
    halfASel.addEventListener('change', () => {
      if (halfBSel.dataset.free === '1') return;
      renderBack(halfCandidates(selectedCourse, halfASel.value));
    });
    halfBSel.addEventListener('change', () => {
      if (halfBSel.value === '__all__') {
        halfBSel.dataset.free = '1';
        renderBack((selectedCourse.sub_courses || []).map(s => s.name));
      } else {
        halfBSel.dataset.current = halfBSel.value;
      }
    });
  }
  ['#start-round', '#apply-settings'].forEach(sel => {
    const btn = root.querySelector(sel);
    if (btn) btn.disabled = false;
  });
  // プレー済みプルダウンの表示も選択中コースに合わせておく
  const ps = root.querySelector('#played-select');
  if (ps) ps.value = [...ps.options].some(o => o.value === String(courseId)) ? String(courseId) : '';
}

// 進行中のラウンドがあるときのラウンド設定：全項目を変更できる（仕様どおり）。
// 入力済みのショット・スコアはホール番号のまま保持し、同伴者は名前が一致すればスコアを引き継ぐ。
// 変更は現在の世代だけでなく、バックアップ世代（prev）とクラウド下書きにも上書きする。
async function renderCurrentSetup(root, s) {
  selectedCourse = null;
  const played = await getPlayedCourses();
  const members = await getMembers();
  members.sort((a, b) => (b.count || 0) - (a.count || 0)); // 共回数が多い順
  root.innerHTML = `
  <section class="card">
    <h3>現在のラウンド設定</h3>
    <p class="hint">コース・日付・同伴者も含め、すべて変更できます。入力済みのショットやスコアはホール番号のまま保持され、変更はバックアップとクラウド下書きにも上書きされます。</p>
    <input type="search" id="course-q" placeholder="コースを変更する場合は名前・かなで検索">
    <select id="played-select">
      <option value="">プレー済みコースから選ぶ（回数が多い順）</option>
      ${played.some(p => String(p.course_id) === String(s.course_id)) ? '' : `<option value="${esc(s.course_id)}">${esc(s.course_name)}（選択中）</option>`}
      ${[...played].sort((a, b) => (b.count - a.count) || String(b.last || '').localeCompare(String(a.last || ''))).map(p => `<option value="${esc(p.course_id)}">${esc(p.name)}（${p.count}回${p.last ? `・${esc(p.last)}` : ''}）</option>`).join('')}
    </select>
    <div id="course-results"></div>
    <div id="course-selected"></div>
  </section>
  <section class="card">
    <h3>条件</h3>
    <div class="row"><label>日付</label><input type="date" id="f-date" value="${esc(s.date)}"></div>
    <div class="row"><label>天候</label><select id="f-weather">${WEATHERS.map(w => `<option ${s.weather === w ? 'selected' : ''}>${w}</option>`).join('')}</select></div>
    <div class="row"><label>風</label><select id="f-wind">${WINDS.map(w => `<option value="${w}" ${s.wind === w ? 'selected' : ''}>${w || '—'}</option>`).join('')}</select></div>
  </section>
  <section class="card">
    <h3>同伴者（最大3名）</h3>
    <div id="partner-slots"></div>
    <p class="hint">名前が同じ同伴者は、入力済みスコアを引き継ぎます。4人そろうとトモダチ計算を自動で行います。</p>
  </section>
  <section class="card">
    <h3>打順</h3>
    <div class="row"><span>H1の打順</span><button type="button" id="order-shuffle">シャッフル</button></div>
    <ol id="order-list" class="order-list"></ol>
    <p class="hint">手動で変えるときは、入れ替えたい2人を順にタップしてください。</p>
  </section>
  <button type="button" id="apply-settings" class="primary">設定を更新して入力に戻る</button>
  <button type="button" id="restart-round">新しいラウンドを始める</button>`;

  // --- コース選択（プレー済みは同伴者と同じプルダウンから。現在のコースは下で選択済みにする） ---
  wireCourseSearch(root);
  // 現在のコース・構成を初期選択にする
  await selectCourse(root, s.course_id, {
    halfA: s.half_names[0], halfB: s.half_names[1], tee: s.tee, green: s.green,
  });

  // --- 同伴者スロット（現在の同伴者を初期値にする） ---
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
  s.partners.forEach((p, k) => {
    const sel = slotsRoot.querySelector(`.partner-select[data-slot="${k}"]`);
    const input = slotsRoot.querySelector(`.partner-new[data-slot="${k}"]`);
    if (!sel) return;
    if (members.some(m => m.name === p.name)) {
      sel.value = p.name;
    } else {
      sel.value = '+新規';
      input.style.display = '';
      input.value = p.name;
    }
  });
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

  // --- 打順（現在の打順を初期値にする） ---
  const names = ['桑木修', ...s.partners.map(p => p.name)];
  const initialOrder = (s.order && s.order.length) ? s.order : ((s.game && s.game.order) || names);
  const list = root.querySelector('#order-list');
  list.dataset.order = JSON.stringify(initialOrder);
  refreshOrder(root);
  root.querySelector('#order-shuffle').addEventListener('click', () => {
    list.dataset.order = JSON.stringify(shuffleOrder(playerNames(root)));
    renderOrder(root);
  });

  // --- 更新：複製へ変更を適用し、保存が成功してから state を差し替える（失敗時は元のまま）。
  // 変更は現在の世代だけでなく、バックアップ世代（prev）とクラウド下書きにも上書きする。
  const applyBtn = root.querySelector('#apply-settings');
  applyBtn.addEventListener('click', async () => {
    if (!selectedCourse) { alert('コースを選択してください'); return; }
    if (applyBtn.disabled) return;
    applyBtn.disabled = true;
    const halfA = root.querySelector('#half-a').value;
    const halfB = root.querySelector('#half-b').value;
    const teeName = root.querySelector('#tee-sel').value;
    const greenName = root.querySelector('#green-sel').value;
    const halves = [pickSub(selectedCourse, halfA, teeName, greenName), pickSub(selectedCourse, halfB, teeName, greenName)];
    const newNames = collectPartners(root);
    const order = JSON.parse(list.dataset.order || '[]');
    const finalOrder = order.length ? order : playerNames(root);

    const next = JSON.parse(JSON.stringify(s)); // state は JSON 形式のみで構成される
    next.date = root.querySelector('#f-date').value;
    next.weather = root.querySelector('#f-weather').value;
    next.wind = root.querySelector('#f-wind').value;
    next.course_id = String(selectedCourse.course_id);
    next.course_name = selectedCourse.name;
    next.half_names = halves.map(h => h.name);
    next.tee = teeName;
    next.green = greenName;
    // round_id は開始時刻サフィックスを引き継ぐ（同日・同コースの別ラウンドと衝突させない）
    const suffix = String(s.round_id || '').split('_')[2] || '000000';
    next.round_id = `R${next.date.replace(/-/g, '')}_${next.course_id}_${suffix}`;
    const pars = [], yards = [], hdcp = [], strategies = [];
    halves.forEach(sub => {
      pars.push(...sub.pars); yards.push(...sub.yards); hdcp.push(...sub.handicaps);
      strategies.push(...(sub.strategies || sub.pars.map(() => '')));
    });
    next.pars = pars; next.yards = yards; next.hdcp = hdcp; next.strategies = strategies;
    // 同伴者：名前が一致すればスコア・パットを引き継ぐ
    const oldByName = {};
    s.partners.forEach(p => { oldByName[p.name] = p; });
    next.partners = newNames.map((name, i) => oldByName[name]
      ? { partner_id: i + 1, name, scores: oldByName[name].scores, putts: oldByName[name].putts }
      : { partner_id: i + 1, name, scores: Array.from({ length: 18 }, () => 0), putts: Array.from({ length: 18 }, () => null) });
    next.order = finalOrder;
    // ゲーム：4人ならニアピンの記録を引き継いで再構築、それ以外は解除
    if (newNames.length === 3) {
      const g = newGame(finalOrder);
      if (s.game) {
        if (s.game.nearpin) g.nearpin = s.game.nearpin;
        if (s.game.dragon) g.dragon = s.game.dragon;
      }
      next.game = g;
    } else {
      next.game = null;
    }
    try {
      setState(next);
      await saveNow();
      await overwritePrevGeneration();
    } catch (e) {
      setState(s); // 保存できなかったので、メモリ上の設定も元に戻す
      applyBtn.disabled = false;
      alert('保存に失敗しました。設定は変更されていません。');
      return;
    }
    try { await saveDraft(next); } catch (e) { /* 失敗表示はバナー側。入力には進む */ }
    onStart();
  });
  root.querySelector('#restart-round').addEventListener('click', async () => {
    if (!confirm('進行中のラウンドを破棄して、新しいラウンドの設定を始めますか？')) return;
    await clearCurrent();
    await renderSetup(root);
  });
}
