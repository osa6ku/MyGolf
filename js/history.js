// 過去のスコア：保存済みラウンドの一覧と、読み取り専用のスコアカード表示。
// データは GAS の getRounds / getRound から取得する（閲覧専用、現在のラウンドには触らない）。
import { fetchRounds, fetchRound } from './sync.js';
import { buildBookData } from './book.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let _listCache = null;

export async function renderHistory(root) {
  if (_listCache) { renderList(root, _listCache); return; }
  root.innerHTML = '<div class="card"><p>読み込み中…</p></div>';
  try {
    _listCache = await fetchRounds();
    renderList(root, _listCache);
  } catch (e) {
    root.innerHTML = `<div class="card"><h3>過去のスコア</h3>` +
      `<p class="warn">一覧を取得できませんでした：${esc(e.message || e)}</p>` +
      `<p class="hint">GAS 側に getRounds / getRound の追加が反映されていないと取得できません。</p></div>`;
  }
}

function renderList(root, rounds) {
  if (!rounds.length) {
    root.innerHTML = '<div class="card"><h3>過去のスコア</h3><p>まだラウンド記録がありません。</p></div>';
    return;
  }
  root.innerHTML = `<div class="card"><h3>過去のスコア（${rounds.length}件）</h3>` +
    `<p class="hint">タップでスコアカードを表示します。</p></div><div id="hist-list"></div>`;
  const listEl = root.querySelector('#hist-list');
  for (const r of rounds) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'book-item';
    b.innerHTML = `<span class="book-date">${esc(r.date)}</span>` +
      `<span class="book-course">${esc(r.course_name)}</span>` +
      `<span class="book-meta">スコア ${r.score ?? '—'}${r.putts != null ? ` / パット ${r.putts}` : ''}</span>`;
    b.addEventListener('click', () => renderDetail(root, r.round_id));
    listEl.appendChild(b);
  }
}

function sumRange(arr, from, to) {
  let s = 0, any = false;
  for (let i = from; i <= to; i++) {
    if (arr[i] != null) { s += arr[i]; any = true; }
  }
  return any ? s : null;
}

const cell = v => (v == null ? '—' : v);

function scoreRow(label, values, pars, isScore) {
  const tds = [];
  for (let half = 0; half < 2; half++) {
    for (let i = half * 9; i < half * 9 + 9; i++) {
      let cls = '';
      if (isScore && values[i] != null && pars[i] != null) {
        if (values[i] < pars[i]) cls = ' class="sc-under"';
        else if (values[i] >= pars[i] + 2) cls = ' class="sc-over2"';
      }
      tds.push(`<td${cls}>${cell(values[i])}</td>`);
    }
    tds.push(`<td class="sc-sub">${cell(sumRange(values, half * 9, half * 9 + 8))}</td>`);
  }
  const total = sumRange(values, 0, 17);
  return `<tr><td class="sc-name">${esc(label)}</td>${tds.join('')}<td class="sc-total">${cell(total)}</td></tr>`;
}

// OB・ペナ・バンカー用：あったホールだけ数字を出し、0は空白にする（どこで起きたかを見るための表）。
// その種別が1件も無いラウンドでは行自体を出さない。
function troubleRow(label, values) {
  const total = sumRange(values, 0, 17);
  if (total == null || total === 0) return '';
  const tds = [];
  for (let half = 0; half < 2; half++) {
    for (let i = half * 9; i < half * 9 + 9; i++) {
      const v = values[i];
      tds.push(`<td>${v ? v : ''}</td>`);
    }
    const sub = sumRange(values, half * 9, half * 9 + 8);
    tds.push(`<td class="sc-sub">${sub ? sub : ''}</td>`);
  }
  return `<tr><td class="sc-name">${esc(label)}</td>${tds.join('')}<td class="sc-total">${total}</td></tr>`;
}

async function renderDetail(root, id) {
  root.innerHTML = '<div class="card"><p>読み込み中…</p></div>';
  try {
    const rec = await fetchRound(id);
    if (!rec) throw new Error('ラウンドが見つかりません');
    const d = buildBookData(rec, null);
    const head = ['', ...Array.from({ length: 9 }, (_, i) => i + 1), 'OUT',
      ...Array.from({ length: 9 }, (_, i) => i + 10), 'IN', '計'];
    const headRow = head.map((h, i) =>
      `<th${i === 0 ? ' class="sc-name"' : ''}>${h}</th>`).join('');
    const rows = [
      scoreRow('Par', d.pars, d.pars, false),
      scoreRow('本人', d.selfScores, d.pars, true),
      scoreRow('パット', d.selfPutts, d.pars, false),
      troubleRow('OB', d.ob || []),
      troubleRow('ペナ', d.pen || []),
      troubleRow('バンカー', d.bunker || []),
      ...d.partners.map(p => scoreRow(p.name, p.scores, d.pars, true)),
    ].join('');
    // FWキープ率は holes_json.fw から数える。保存済み fw_rate は本アプリ分が「%値（41.7）」で
    // 旧表示は ×100 して 4170% になっていた。移行ラウンドでは保存値が 0 のこともあり信用しない。
    // fw が無いラウンドのみ、保存値を桁（1以下なら割合、それ以上なら%値）で吸収して使う。
    const hj = typeof rec.holes_json === 'string'
      ? JSON.parse(rec.holes_json || '{}') : (rec.holes_json || {});
    let fwKeep = 0, fwTotal = 0;
    (hj.fw || []).forEach(v => {
      if (v && v !== '-') { fwTotal++; if (v === 'K') fwKeep++; }
    });
    let stats = '';
    if (fwTotal) {
      stats = `FWキープ率 ${(fwKeep / fwTotal * 100).toFixed(1)}%（${fwKeep}/${fwTotal}）`;
    } else if (rec.fw_rate != null) {
      const pct = rec.fw_rate <= 1 ? rec.fw_rate * 100 : rec.fw_rate;
      stats = `FWキープ率 ${pct.toFixed(1)}%`;
    }
    const np = Object.entries(d.nearpin || {})
      .map(([h, n]) => `H${h}: ${n}`).join('、');
    const memos = (d.holeLines || [])
      .map((l, i) => (l.memo || l.shots) ? `<p>H${i + 1}：${esc(l.shots)}${l.memo ? `（${esc(l.memo)}）` : ''}</p>` : '')
      .filter(Boolean).join('');
    root.innerHTML = `
      <div class="card">
        <button type="button" id="hist-back">← 一覧に戻る</button>
        <h3>${esc(d.courseName)}</h3>
        <p>${esc(d.date)} / ティー ${esc(d.tee)} / グリーン ${esc(d.green)} / ${esc(d.weather)}・風 ${esc(d.wind)}</p>
        ${stats ? `<p>${esc(stats)}</p>` : ''}
        ${np ? `<p>ニアピン：${esc(np)}</p>` : ''}
        <div style="overflow-x:auto">
          <table class="scorecard"><tr>${headRow}</tr>${rows}</table>
        </div>
        ${memos ? `<h4>ホールメモ</h4>${memos}` : ''}
      </div>`;
    root.querySelector('#hist-back').addEventListener('click', () => renderList(root, _listCache || []));
  } catch (e) {
    root.innerHTML = `<div class="card"><button type="button" id="hist-back">← 一覧に戻る</button>` +
      `<p class="warn">取得できませんでした：${esc(e.message || e)}</p></div>`;
    const back = root.querySelector('#hist-back');
    if (back) back.addEventListener('click', () => renderList(root, _listCache || []));
  }
}
