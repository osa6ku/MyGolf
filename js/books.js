// スコアブック（衛星写真つきHTML）の一覧・表示。
// 置き場所は Google Drive。ScoreBook 用 GAS が Drive からの一覧取得と
// 中身の受け渡しを担い、この画面はその窓口（2026-11-20 v0.7.5）。
import { SCOREBOOK_GAS_URL } from './config.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function parseName(name) {
  // ScoreBook_2026-11-20_ゴールデンレイクス.html
  const m = String(name).replace(/\.html$/i, '').match(/^ScoreBook_(\d{4}-\d{2}-\d{2})_(.+)$/);
  return m ? { date: m[1], course: m[2] } : { date: '', course: name };
}

export async function renderBooks(root) {
  root.innerHTML = `
    <div class="card">
      <h3>📖 スコアブック</h3>
      <p class="hint">Googleドライブに置いたスコアブック（衛星写真つき）の一覧です。</p>
      <p id="books-msg">読み込み中…</p>
    </div>
    <div id="books-list"></div>`;
  const msg = root.querySelector('#books-msg');
  const listEl = root.querySelector('#books-list');
  try {
    const res = await fetch(SCOREBOOK_GAS_URL + '?action=list');
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'list failed');
    if (!data.files.length) {
      msg.textContent = 'まだスコアブックがありません。';
      return;
    }
    msg.textContent = '';
    for (const f of data.files) {
      const p = parseName(f.name);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'book-item';
      b.innerHTML = `<span class="book-date">${esc(p.date)}</span>` +
        `<span class="book-course">${esc(p.course)}</span>` +
        `<span class="book-meta">${(f.size / 1048576).toFixed(1)} MB</span>`;
      b.addEventListener('click', () => openBook(f.id, `${p.date} ${p.course}`));
      listEl.appendChild(b);
    }
  } catch (e) {
    msg.textContent = `一覧を取得できませんでした：${e.message || e}`;
  }
}

async function openBook(id, title) {
  closeBook();
  const ov = document.createElement('div');
  ov.className = 'books-overlay';
  ov.id = 'books-overlay';
  ov.innerHTML = `
    <div class="books-bar">
      <button type="button" id="books-close">← 戻る</button>
      <span class="books-title">${esc(title)}</span>
    </div>
    <div class="books-load" id="books-load">読み込み中…</div>
    <iframe class="books-frame" id="books-frame" sandbox="allow-scripts"></iframe>`;
  document.body.appendChild(ov);
  ov.querySelector('#books-close').addEventListener('click', closeBook);
  const frame = ov.querySelector('#books-frame');
  const load = ov.querySelector('#books-load');
  try {
    const res = await fetch(SCOREBOOK_GAS_URL + '?action=get&id=' + encodeURIComponent(id));
    frame.srcdoc = await res.text();
  } catch (e) {
    frame.srcdoc = `<p style="font-family:sans-serif;padding:20px">読み込めませんでした（${esc(e.message || e)}）</p>`;
  } finally {
    if (load) load.style.display = 'none';
  }
}

function closeBook() {
  const ov = document.querySelector('#books-overlay');
  if (ov) ov.remove();
}
