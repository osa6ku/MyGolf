// MyGolf 起動・画面遷移・Service Worker 登録
import { openDb, getMeta, setMeta } from './db.js';
import { APP_VERSION, ROUND_RECORDS_URL } from './config.js';
import { getState, setState, loadCurrent, saveNow, scheduleSave, totals, toRoundRecord, clearCurrent, summarize, materializePartnerPars } from './state.js';
import { gasUrl, setGasUrl, pendingList, flushPending, queuePending, saveRoundNow, fetchScoreBook, saveScorebookPdf, saveShareImage } from './sync.js';
import { syncMaster, masterCount, getMembers, getPlayedCourses } from './master.js';
import { renderSetup, setSetupStartHandler } from './ui-setup.js';
import { renderHole, setHoleNavHandler, resetHoleModal } from './ui-hole.js';
import { calcTomodachi } from './game.js';
import { renderRestore, setRestoreHandler } from './ui-restore.js';
import { exportRoundJson } from './export.js';
import { generateArtifacts, tomoFromCalc } from './book.js';
import { renderBooks } from './books.js';
import { renderHistory } from './history.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const $ = sel => document.querySelector(sel);

function show(screen) {
  document.querySelectorAll('[data-nav]').forEach(b => b.classList.toggle('active', b.dataset.nav === screen));
  document.querySelectorAll('.screen').forEach(el => { el.style.display = 'none'; });
  const el = $(`#screen-${screen}`);
  if (el) el.style.display = '';
  if (screen === 'home') renderHome();
  if (screen === 'books') renderBooks($('#books-body'));
  if (screen === 'history') renderHistory($('#history-body'));
  if (screen === 'hole') { resetHoleModal(); renderHole($('#screen-hole')); }
  if (screen === 'finish') renderFinish();
  if (screen === 'settings') renderSettings();
  window.scrollTo(0, 0);
}

async function renderHome() {
  const s = getState();
  const lastLocal = await getMeta('lastLocalSave', '');
  const lastDraft = await getMeta('lastDraftSave', '');
  const pending = await pendingList();
  const mc = await masterCount();
  const sum = s ? summarize(s) : null;
  const artifactJob = await getMeta('pendingArtifact', null);
  $('#home-body').innerHTML = `
    ${sum ? `<div class="card resume">
      <h3>進行中のラウンド</h3>
      <p>${esc(sum.course_name)}（${esc(sum.date)}）/ 現在 ${sum.currentHole}H / 入力済み ${sum.playedHoles}H / スコア計 ${sum.scoreSoFar}</p>
      <button type="button" class="primary" id="resume-btn">再開する</button>
      <button type="button" id="discard-btn">破棄する</button>
    </div>` : ''}
    ${artifactJob && artifactJob.record ? `<div class="card">
      <h3>スコアブック未作成のラウンド</h3>
      <p>${esc(artifactJob.record.course_name)}（${esc(artifactJob.record.date)}）のスコアブック／共有用画像が未作成です。電波の良い場所で作成してください。</p>
      <button type="button" class="primary" id="artifact-btn">スコアブックを作成する</button>
      <p id="artifact-home-msg"></p>
      <div id="artifact-home-links"></div>
    </div>` : ''}
    <div class="card">
      <button type="button" class="primary big" id="new-btn">新規ラウンド</button>
      <button type="button" class="big" id="restore-btn">復元</button>
      <button type="button" class="big" id="books-btn">スコアブック</button>
      <button type="button" class="big" id="book-pdf-btn">スコアブックPDF</button>
      <button type="button" class="big" id="history-btn">過去のスコア</button>
      <button type="button" class="big" id="records-btn">ラウンド記録</button>
      <p id="book-pdf-msg"></p>
      <div id="book-pdf-links"></div>
    </div>
    <div class="card status">
      <h3>保存ステータス</h3>
      <p>最終ローカル保存：${esc(lastLocal || '—')}<br>
      最終クラウド下書き：${esc(lastDraft || '—')}<br>
      確定保存の保留：${pending.length} 件<br>
      コースマスタ：${mc} 件</p>
      ${pending.length ? '<button type="button" id="flush-btn">保留を送信する</button>' : ''}
    </div>`;
  const resume = $('#resume-btn');
  if (resume) resume.addEventListener('click', () => show('hole'));
  const discard = $('#discard-btn');
  if (discard) discard.addEventListener('click', async () => {
    if (confirm('進行中のラウンドを破棄しますか？')) { await clearCurrent(); renderHome(); }
  });
  const artifactBtn = $('#artifact-btn');
  if (artifactBtn) artifactBtn.addEventListener('click', async () => {
    if (artifactBtn.disabled) return;
    artifactBtn.disabled = true;
    const msg = $('#artifact-home-msg');
    const linksEl = $('#artifact-home-links');
    const out = await generateArtifacts(artifactJob.record, artifactJob.tomo,
      { fetchScoreBook, saveScorebookPdf, saveShareImage },
      t => { if (msg) msg.textContent = t; });
    if (out.errors.length) {
      if (msg) msg.textContent = `一部作成できませんでした：${out.errors.join(' / ')}`;
      artifactBtn.disabled = false;
    } else {
      await setMeta('pendingArtifact', '');
      const links = [];
      if (out.bookUrl) links.push(`<p><a class="btn-link" href="${esc(out.bookUrl)}" target="_blank" rel="noopener">📖 スコアブックPDF</a></p>`);
      if (out.shareUrl) links.push(`<p><a class="btn-link" href="${esc(out.shareUrl)}" target="_blank" rel="noopener">🖼 共有用スコアカード画像</a></p>`);
      if (linksEl) linksEl.innerHTML = links.join('');
      if (msg) msg.textContent = 'スコアブックと共有用画像を作成しました。' +
        (out.warnings && out.warnings.length ? `（${out.warnings.join(' / ')}）` : '');
      artifactBtn.style.display = 'none';
    }
  });
  $('#new-btn').addEventListener('click', async () => { await renderSetup($('#screen-setup')); show('setup'); });
  $('#restore-btn').addEventListener('click', async () => { await renderRestore($('#screen-restore')); show('restore'); });
  $('#books-btn').addEventListener('click', () => show('books'));
  $('#history-btn').addEventListener('click', () => show('history'));
  $('#records-btn').addEventListener('click', () => window.open(ROUND_RECORDS_URL, '_blank'));
  const bookPdfBtn = $('#book-pdf-btn');
  const showPdfLink = url => {
    if (bookPdfBtn) bookPdfBtn.style.display = 'none';
    const linksEl = $('#book-pdf-links');
    if (linksEl) linksEl.innerHTML = `<p><a class="btn-link" href="${esc(url)}" target="_blank" rel="noopener">📖 スコアブックPDFを開く</a></p>`;
  };
  const cachedPdfUrl = await getMeta('scorebookPdfUrl', '');
  if (cachedPdfUrl) showPdfLink(cachedPdfUrl);
  if (bookPdfBtn) bookPdfBtn.addEventListener('click', async () => {
    const msg = $('#book-pdf-msg');
    if (msg) msg.textContent = 'スコアブックを探しています…';
    let url = '';
    try {
      const res = await fetchScoreBook();
      if (res && res.exists && res.url) {
        url = res.url;
        await setMeta('scorebookPdfUrl', url);
      }
    } catch (e) { /* 取得できなければ未作成として扱う */ }
    if (msg) msg.textContent = url ? '' : 'スコアブックPDFがまだありません。';
    if (url) showPdfLink(url);
  });
  const flush = $('#flush-btn');
  if (flush) flush.addEventListener('click', async () => {
    const results = await flushPending();
    alert(results.map(r => `${r.round_id}: ${r.ok ? (r.duplicate ? '送信済み（重複なし）' : '送信完了') : '失敗 ' + (r.error || '')}`).join('\n') || '保留なし');
    renderHome();
  });
}

function renderFinish() {
  const s = getState();
  const root = $('#finish-body');
  if (!s) { root.innerHTML = '<p>進行中のラウンドがありません。</p>'; return; }
  // ホール確定を押していないホールの同伴者スコア（未入力=0）をパーで実体化してから表示・保存する
  materializePartnerPars(s);
  scheduleSave();
  const t = totals(s);
  root.innerHTML = `
    <div class="card">
      <h3>${esc(s.course_name)}（${esc(s.date)}）</h3>
      <table class="score-table">
        <tr><th></th><th>OUT</th><th>IN</th><th>合計</th><th>パット</th></tr>
        <tr><td>本人</td><td>${t.out_score}</td><td>${t.in_score}</td><td>${t.score}</td><td>${t.putts}</td></tr>
        ${s.partners.map(p => {
          const sc = p.scores, pt = p.putts;
          const sum = (a, f, u) => a.slice(f, u).reduce((x, y) => x + (y || 0), 0);
          return `<tr><td>${esc(p.name)}</td><td>${sum(sc, 0, 9)}</td><td>${sum(sc, 9, 18)}</td><td>${sum(sc, 0, 18)}</td><td>${pt.every(v => v == null) ? '—' : sum(pt, 0, 18)}</td></tr>`;
        }).join('')}
      </table>
      <p>OB ${t.ob} / ペナ ${t.pen} / バンカー ${t.bunker} / FWキープ率 ${t.fw_rate}%</p>
      ${(() => { const tomo = calcTomodachi(s); return tomo ? `<p>🤝 トモダチ：${tomo.players.map((n, ix) => `${esc(n)} ${tomo.totals[ix] > 0 ? '+' : ''}${tomo.totals[ix]}pt`).join(' ／ ')}</p>` : ''; })()}
      <button type="button" class="primary" id="save-round-btn">確定保存する</button>
      <button type="button" id="export-btn">JSON書き出し</button>
      <button type="button" id="back-hole-btn">ホール入力に戻る</button>
      <button type="button" id="make-book-btn">スコアブックを作成</button>
      <p class="hint">保存済みラウンド（復元したラウンドなど）のスコアブック／共有用画像を作成します。すでに作成済みの場合は押さないでください（ページが重複します）。</p>
      <p id="make-book-msg"></p>
      <div id="make-book-links"></div>
      <p id="finish-msg"></p>
    </div>`;
  $('#back-hole-btn').addEventListener('click', () => show('hole'));
  $('#export-btn').addEventListener('click', () => exportRoundJson(s));
  $('#make-book-btn').addEventListener('click', async ev => {
    const btn = ev.currentTarget;
    if (btn.disabled) return;
    btn.disabled = true;
    const msg = $('#make-book-msg');
    const record = toRoundRecord(s);
    const tomoCalc = calcTomodachi(s);
    const npByHole = {};
    if (s.game && s.game.nearpin) {
      Object.entries(s.game.nearpin).forEach(([h, n]) => { npByHole[Number(String(h).replace('H', ''))] = n; });
    }
    const tomo = tomoCalc ? tomoFromCalc(tomoCalc, s.game ? s.game.order : null, npByHole) : null;
    const out = await generateArtifacts(record, tomo,
      { fetchScoreBook, saveScorebookPdf, saveShareImage },
      t => { if (msg) msg.textContent = t; });
    if (out.errors.length) {
      await setMeta('pendingArtifact', { record, tomo });
      if (msg) msg.textContent = `一部作成できませんでした：${out.errors.join(' / ')}（ホームからも再作成できます）`;
      btn.disabled = false;
    } else {
      const pendingJob = await getMeta('pendingArtifact', null);
      if (pendingJob && pendingJob.record && pendingJob.record.round_id === record.round_id) {
        await setMeta('pendingArtifact', '');
      }
      const links = [];
      if (out.bookUrl) links.push(`<p><a class="btn-link" href="${esc(out.bookUrl)}" target="_blank" rel="noopener">📖 スコアブックPDF</a></p>`);
      if (out.shareUrl) links.push(`<p><a class="btn-link" href="${esc(out.shareUrl)}" target="_blank" rel="noopener">🖼 共有用スコアカード画像</a></p>`);
      $('#make-book-links').innerHTML = links.join('');
      if (msg) msg.textContent = 'スコアブックと共有用画像を作成しました。' +
        (out.warnings && out.warnings.length ? `（${out.warnings.join(' / ')}）` : '');
    }
  });
  $('#save-round-btn').addEventListener('click', async ev => {
    const btn = ev.currentTarget;
    if (btn.disabled) return;
    btn.disabled = true; // 弱電波下での連打による二重送信を防ぐ
    const msg = $('#finish-msg');
    const record = toRoundRecord(s);
    // 生成物（スコアブック／共有画像）は保存成功後に state が消える前に材料を捕捉しておく
    const tomoCalc = calcTomodachi(s);
    const npByHole = {};
    if (s.game && s.game.nearpin) {
      Object.entries(s.game.nearpin).forEach(([h, n]) => { npByHole[Number(String(h).replace('H', ''))] = n; });
    }
    const tomo = tomoCalc ? tomoFromCalc(tomoCalc, s.game ? s.game.order : null, npByHole) : null;
    try {
      const data = await saveRoundNow(record);
      await clearCurrent();
      renderSaved(record, tomo, !!data.duplicate);
    } catch (err) {
      await queuePending(record);
      msg.textContent = `送信できませんでした。保留キューに入れました（ホームから再送できます）：${err.message || err}`;
      btn.disabled = false;
    }
  });
}

// 確定保存の完了画面：スコアブックPDFと共有用画像を生成し、リンクを出す
async function renderSaved(record, tomo, duplicate) {
  const root = $('#finish-body');
  root.innerHTML = `
    <div class="card">
      <h3>保存完了</h3>
      <p>${esc(record.course_name)}（${esc(record.date)}）を${duplicate ? '保存済みでした（二重登録なし）' : '確定保存しました'}。</p>
      <p id="artifact-status">${duplicate ? 'すでに保存済みのラウンドのため、スコアブックへの追記はスキップしました。' : 'スコアブックと共有用画像を作成しています…'}</p>
      <div id="artifact-links"></div>
      <button type="button" class="primary" id="saved-home-btn">ホームへ</button>
    </div>`;
  $('#saved-home-btn').addEventListener('click', () => show('home'));
  if (duplicate) return;
  const statusEl = $('#artifact-status');
  const linksEl = $('#artifact-links');
  const out = await generateArtifacts(record, tomo,
    { fetchScoreBook, saveScorebookPdf, saveShareImage },
    t => { if (statusEl) statusEl.textContent = t; });
  if (out.bookUrl) await setMeta('scorebookPdfUrl', out.bookUrl);
  // v0.7.6: 作成に失敗したら材料を残し、ホームから再作成できるようにする（弱電波対策）
  if (out.errors.length) {
    await setMeta('pendingArtifact', { record, tomo });
  } else {
    const pendingJob = await getMeta('pendingArtifact', null);
    if (pendingJob && pendingJob.record && pendingJob.record.round_id === record.round_id) {
      await setMeta('pendingArtifact', '');
    }
  }
  const links = [];
  if (out.bookUrl) links.push(`<p><a class="btn-link" href="${esc(out.bookUrl)}" target="_blank" rel="noopener">📖 スコアブックPDF</a></p>`);
  if (out.shareUrl) links.push(`<p><a class="btn-link" href="${esc(out.shareUrl)}" target="_blank" rel="noopener">🖼 共有用スコアカード画像</a></p>`);
  if (linksEl) linksEl.innerHTML = links.join('');
  if (statusEl) {
    statusEl.textContent = out.errors.length
      ? `一部作成できませんでした：${out.errors.join(' / ')}`
      : 'スコアブックと共有用画像を作成しました。' +
        (out.warnings && out.warnings.length ? `（${out.warnings.join(' / ')}）` : '');
  }
}

async function renderSettings() {
  const root = $('#settings-body');
  const url = await gasUrl();
  let usage = '—';
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const est = await navigator.storage.estimate();
      usage = `${Math.round((est.usage || 0) / 1024)} KB / ${Math.round((est.quota || 0) / 1024 / 1024)} MB`;
    }
  } catch (e) { /* ignore */ }
  root.innerHTML = `
    <div class="card">
      <h3>GAS URL</h3>
      <input type="url" id="gas-url" value="${esc(url)}" placeholder="https://script.google.com/macros/s/.../exec">
      <button type="button" id="gas-save">保存</button>
      <p class="hint">MyGolf_DB に紐づく GAS のウェブアプリ URL。未設定でもローカル保存だけで使えます。</p>
    </div>
    <div class="card">
      <h3>コースマスタ</h3>
      <p id="master-count">コース現在 ${await masterCount()} 件 / メンバー ${(await getMembers()).length} 名 / プレー済み ${(await getPlayedCourses()).length} コース</p>
      <button type="button" id="master-sync">マスタ同期</button>
      <p id="master-msg"></p>
    </div>
    <div class="card">
      <h3>ストレージ</h3>
      <p>使用量（目安）：${usage}</p>
    </div>`;
  $('#gas-save').addEventListener('click', async () => { await setGasUrl($('#gas-url').value); alert('保存しました'); });
  $('#master-sync').addEventListener('click', async () => {
    const msg = $('#master-msg');
    msg.textContent = '同期中…';
    try {
      const n = await syncMaster();
      const playedMerged = (await getPlayedCourses()).length; // 名寄せ後の件数で表示を統一する
      msg.textContent = `コース ${n.courses} 件 / メンバー ${n.members} 名 / プレー済み ${playedMerged} コースを同期しました。`;
      const mc = document.querySelector('#master-count');
      if (mc) mc.textContent = `コース現在 ${n.courses} 件 / メンバー ${n.members} 名 / プレー済み ${playedMerged} コース`;
    } catch (err) {
      msg.textContent = `失敗：${err.message || err}`;
    }
  });
}

// 変更履歴（バージョン表示ボタンのモーダル用。新しい順）
const CHANGELOG = [
  ['0.7.16', '2026-11-21', ['iPhoneで画面上部（時刻や電池の表示まわり）にかかっていた白いモヤを解消。ヘッダーの緑をステータスバーの領域まで広げた']],
  ['0.7.15', '2026-11-21', ['「ラウンド記録」ボタンのリンク先を、スペースからスプレッドシート版（年別・コース別・同伴者別・トモダチ集計）に切り替えた']],
  ['0.7.14', '2026-11-21', ['ホームに「ラウンド記録」ボタンを追加。期間別集計・同伴者別・トモダチの分析スペースを開けるようにした']],
  ['0.7.13', '2026-11-20', ['過去のスコア：FWキープ率の表示を修正（ホール別データから算出）。OB・ペナ・バンカーを合計ではなくホール別の行で表示するようにした']],
  ['0.7.12', '2026-11-20', ['「過去のスコア」を追加。保存済みラウンドの一覧から、ホール別のスコアカードを閲覧できるようにした（GAS側の更新も必要）']],
  ['0.7.11', '2026-11-20', ['ホームのスコアブックPDFを、リンクが分かっている場合は最初からリンク表示にして1タップで開けるようにした']],
  ['0.7.10', '2026-11-20', ['変更履歴に「更新を確認」ボタンを追加。更新バナーが出ないときでも、手動で最新版を確認して更新できるようにした']],
  ['0.7.9', '2026-11-20', ['ホームに「スコアブックPDF」ボタンを追加。累積スコアブック（新しいラウンドが先頭）をいつでも開けるようにした']],
  ['0.7.8', '2026-11-20', ['既存のスコアブックPDFが壊れていて読めない場合に、行き詰まらず新規に作り直すよう修正']],
  ['0.7.7', '2026-11-20', ['終了画面に「スコアブックを作成」ボタンを追加。保存済み・復元したラウンドでもスコアブックと共有用画像を作成できるようにした']],
  ['0.7.6', '2026-11-20', ['スコアブック作成の通信リトライを強化（弱電波で失敗しにくく）。作成に失敗したラウンドは、ホームから後で作成し直せるようにした']],
  ['0.7.5', '2026-11-20', ['スコアブック（衛星写真つき）をホームのボタンから開けるようにした。ファイルの置き場所はGoogleドライブのまま']],
  ['0.7.4', '2026-11-19', ['iPhone（ホーム画面アプリ）で画面上部がステータスバーに重なり、更新バナーなどが押せない問題を修正']],
  ['0.7.3', '2026-11-19', ['結果ボタン（◯・左・右など）を青系に色分けし、番手と見分けやすくした', '復元タブのアイコンを📥に変更']],
  ['0.7.2', '2026-11-18', ['バージョン表示をボタンにし、タップでこの変更履歴を開けるようにした']],
  ['0.7.1', '2026-11-18', ['下タブバーを濃緑バー＋アイコンに変更し、開いているタブに琥珀色のラインを表示']],
  ['0.7.0', '2026-11-18', ['デザインB（グリーン基調）：全体の色遣いとボタンの見た目を見直し。PTは緑、PT外は琥珀色に色分け']],
  ['0.6.9', '2026-11-17', ['ゴールデンレイクスのハーフ自動決定（オレンジ→グリーン）を登録', 'Par変更をホール画面のヘッダー内へ移し、設定画面をコンパクトに']],
  ['0.6.8', '2026-11-17', ['ホール画面でParを当日変更できるようにした']],
  ['0.6.7', '2026-11-17', ['後半ハーフの手動選択を残し、検索に出ないコースをその場で新規追加できるようにした']],
  ['0.6.6', '2026-11-17', ['ハーフ選択を連動（前半を選ぶと後半の候補を自動調整）']],
  ['0.6.5', '2026-11-16', ['アプリ更新フローを修正し、新バージョンが確実に反映されるようにした']],
  ['0.6.4', '2026-11-16', ['Android Chromeの文字自動拡大を無効化']],
  ['0.6.3', '2026-11-16', ['アプリ内バージョンチェックと「新しいバージョンがあります」バナーを追加']],
  ['0.6.2', '2026-11-16', ['クラブに「PT外」を追加（グリーン外のパター用。パット数はPTのみ集計）']],
  ['0.6.1', '2026-11-16', ['長いコース名でヘッダーの表示が重なる問題を修正']],
  ['0.6.0', '2026-11-16', ['確定保存時にスコアブックPDFと共有用画像を生成するようにした']],
  ['0.5.2', '2026-11-15', ['本番運用に合わせた文言の整備']],
  ['0.5.1', '2026-11-15', ['ホール確定時の保存順序を厳密化するなど、安定性の修正']],
  ['0.5.0', '2026-11-15', ['レビュー指摘の修正（保存の競合、同伴者スコアのパー補完、マスタ同期の原子化）']],
  ['0.4.9', '2026-11-15', ['プレー済みコースの名前解決を修正']],
  ['0.4.8', '2026-11-15', ['ホール選択でメモのあるホールが分かるようにした。マスカブルアイコン対応']],
  ['0.4.7', '2026-11-15', ['攻略メモのあるホールをホール選択に表示']],
  ['0.4.6', '2026-11-15', ['プレー済みコースを名前で解決するよう修正']],
  ['0.4.5', '2026-11-15', ['プレー済みコースをプルダウン化。ホール名をボタン化']],
  ['0.4.4', '2026-11-15', ['プレー済みコースを折りたたみ表示・プレー回数順に']],
  ['0.4.3', '2026-11-15', ['ダブルタップズームを無効化。ホール名タップでホール選択モーダル']],
  ['0.4.2', '2026-11-15', ['同伴者スコアの初期値をパーに。速報バーをタップでモーダル表示に']],
  ['0.4.1', '2026-11-15', ['ショット結果ボタンの整理。トモダチバーを1行表示に']],
  ['0.4.0', '2026-11-15', ['攻略メモ、ショットへのOB／プレ4／ペナルティ／バンカー付記、スコアカード表示を追加']],
  ['0.3.6', '2026-11-15', ['ラウンド設定をラウンド中にも変更できるようにした']],
  ['0.3.5', '2026-11-15', ['タブバーの高さに合わせた表示位置の調整']],
  ['0.3.4', '2026-11-15', ['設定タブに現在の設定を表示。アプリアイコンの整備']],
  ['0.3.3', '2026-11-15', ['ホール画面を圧縮し、スコア／トモダチをモーダル表示に']],
  ['0.3.2', '2026-11-15', ['クラブ一覧を本人の13本＋PT外の構成に固定']],
  ['0.3.1', '2026-11-15', ['ティーとグリーンの選択を分離']],
  ['0.3.0', '2026-11-15', ['ショット単位の記録方式に刷新。プレー済みコース一覧、打順表示、トモダチ自動計算']],
  ['0.2.0', '2026-11-15', ['ヘッダーにバージョン表示。同伴者（メンバー）選択を追加']],
  ['0.1.0', '2026-11-15', ['初版：ホール入力、ローカル保存とクラウド同期の土台']],
];

function openChangelog() {
  if (document.querySelector('#changelog-overlay')) return;
  const ov = document.createElement('div');
  ov.className = 'modal-overlay';
  ov.id = 'changelog-overlay';
  ov.innerHTML = `<div class="modal-box"><h3>変更履歴</h3>` +
    CHANGELOG.map(([v, d, notes]) =>
      `<div class="cl-ver">v${esc(v)} <span class="cl-date">${esc(d)}</span></div><ul class="cl-list">` +
      notes.map(n => `<li>${esc(n)}</li>`).join('') + `</ul>`).join('') +
    `<p><button type="button" id="update-check-btn">更新を確認</button></p>` +
    `<p id="update-check-msg"></p>` +
    `<button type="button" class="primary modal-close">閉じる</button></div>`;
  ov.addEventListener('click', e => { if (e.target === ov || e.target.closest('.modal-close')) ov.remove(); });
  document.body.appendChild(ov);
  const btn = ov.querySelector('#update-check-btn');
  const msg = ov.querySelector('#update-check-msg');
  let pendingVersion = null;
  btn.addEventListener('click', async () => {
    if (pendingVersion) { applyUpdate(); return; }
    btn.disabled = true;
    msg.textContent = '確認中…';
    const r = await checkForUpdate(true);
    btn.disabled = false;
    if (r.status === 'newer') {
      pendingVersion = r.version;
      msg.textContent = `新しいバージョン v${r.version} があります`;
      btn.textContent = '更新する';
    } else if (r.status === 'latest') {
      msg.textContent = `最新です（v${APP_VERSION}）`;
    } else {
      msg.textContent = '確認できませんでした（通信状態を確認してください）';
    }
  });
}

// バージョン確認：PWA は再開時にページを読み直さないため、サーバーの version.json と
// 明示的に比べないと更新に気づけない。新しければバナーを出し、タップで更新する。
let lastVersionCheck = 0;
async function checkForUpdate(force = false) {
  const now = Date.now();
  if (!force && now - lastVersionCheck < 10 * 60 * 1000) return { status: 'throttled' };
  lastVersionCheck = now;
  try {
    const res = await fetch('./version.json', { cache: 'no-store' });
    if (!res.ok) return { status: 'error' };
    const data = await res.json();
    if (data.version && data.version !== APP_VERSION) {
      // 新 SW のインストールを先に走らせておく（「更新する」を押した時点で waiting にしておく）
      navigator.serviceWorker.getRegistration().then(r => { if (r) r.update().catch(() => {}); }).catch(() => {});
      showUpdateBanner(data.version);
      return { status: 'newer', version: data.version };
    }
    return { status: 'latest' };
  } catch (_) { /* オフライン時は何もしない */
    return { status: 'error' };
  }
}
function showUpdateBanner(v) {
  if ($('#update-banner')) return;
  const bar = document.createElement('div');
  bar.id = 'update-banner';
  bar.className = 'banner';
  bar.innerHTML = `新しいバージョン v${esc(v)} があります <button type="button" id="update-apply" class="small">更新する</button>`;
  document.body.prepend(bar);
  $('#update-apply').addEventListener('click', applyUpdate);
}
async function applyUpdate() {
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg) {
      let reloaded = false;
      const reloadOnce = () => { if (!reloaded) { reloaded = true; location.reload(); } };
      navigator.serviceWorker.addEventListener('controllerchange', reloadOnce);
      await reg.update().catch(() => {});
      const sw = reg.waiting || reg.installing;
      if (sw) {
        // インストール完了（waiting 化）を待ってから有効化する。即チェックすると
        // まだ installing で waiting が無く、古い版のまま再読み込みしてしまう。
        const target = reg.waiting || sw;
        if (target.state === 'installed') {
          target.postMessage('SKIP_WAITING');
        } else {
          target.addEventListener('statechange', () => {
            if (target.state === 'installed') target.postMessage('SKIP_WAITING');
          });
        }
        setTimeout(reloadOnce, 6000); // 切り替わらない場合の保険
        return;
      }
    }
  } catch (_) { /* そのまま再読み込みする */ }
  location.reload();
}

async function init() {
  const verEl = document.querySelector('#app-version');
  if (verEl) { verEl.textContent = 'v' + APP_VERSION; verEl.addEventListener('click', openChangelog); }
  await openDb();
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().catch(() => {});
  }
  const cur = await loadCurrent();
  if (cur) setState(cur);

  setSetupStartHandler(() => show('hole'));
  setHoleNavHandler(screen => show(screen));
  setRestoreHandler(() => show('hole'));

  document.querySelectorAll('[data-nav]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const target = btn.dataset.nav;
      if (target === 'setup') await renderSetup($('#screen-setup'));
      if (target === 'restore') await renderRestore($('#screen-restore'));
      show(target);
    });
  });

  // 保存ステータスのバナー（失敗は出し続ける）
  const banner = $('#save-banner');
  window.addEventListener('mygolf-save-status', e => {
    if (e.detail.ok) { banner.style.display = 'none'; }
    else { banner.style.display = ''; banner.textContent = `⚠️ ローカル保存に失敗しています：${e.detail.error}`; }
  });
  const saveStatus = $('#save-status');
  window.addEventListener('mygolf-save-status', e => {
    if (e.detail.ok) saveStatus.textContent = `保存済み ${new Date(e.detail.at).toLocaleTimeString('ja-JP')}`;
  });
  window.addEventListener('mygolf-draft-status', e => {
    if (e.detail.ok) saveStatus.textContent = `下書き保存済み ${new Date(e.detail.at).toLocaleTimeString('ja-JP')}`;
  });

  // ホール移動・非表示・終了時に即時フラッシュ
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveNow().catch(() => {}); });
  window.addEventListener('pagehide', () => { saveNow().catch(() => {}); });

  // Service Worker：新バージョンは自動で有効化しない（ラウンド中の差し替え防止）
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  checkForUpdate();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkForUpdate(); });

  show('home');
}

init();
