// MyGolf 起動・画面遷移・Service Worker 登録
import { openDb, getMeta } from './db.js';
import { APP_VERSION } from './config.js';
import { getState, setState, loadCurrent, saveNow, scheduleSave, totals, toRoundRecord, clearCurrent, summarize, materializePartnerPars } from './state.js';
import { gasUrl, setGasUrl, pendingList, flushPending, queuePending, saveRoundNow, fetchScoreBook, saveScorebookPdf, saveShareImage } from './sync.js';
import { syncMaster, masterCount, getMembers, getPlayedCourses } from './master.js';
import { renderSetup, setSetupStartHandler } from './ui-setup.js';
import { renderHole, setHoleNavHandler, resetHoleModal } from './ui-hole.js';
import { calcTomodachi } from './game.js';
import { renderRestore, setRestoreHandler } from './ui-restore.js';
import { exportRoundJson } from './export.js';
import { generateArtifacts, tomoFromCalc } from './book.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const $ = sel => document.querySelector(sel);

function show(screen) {
  document.querySelectorAll('.screen').forEach(el => { el.style.display = 'none'; });
  const el = $(`#screen-${screen}`);
  if (el) el.style.display = '';
  if (screen === 'home') renderHome();
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
  $('#home-body').innerHTML = `
    ${sum ? `<div class="card resume">
      <h3>進行中のラウンド</h3>
      <p>${esc(sum.course_name)}（${esc(sum.date)}）/ 現在 ${sum.currentHole}H / 入力済み ${sum.playedHoles}H / スコア計 ${sum.scoreSoFar}</p>
      <button type="button" class="primary" id="resume-btn">再開する</button>
      <button type="button" id="discard-btn">破棄する</button>
    </div>` : ''}
    <div class="card">
      <button type="button" class="primary big" id="new-btn">新規ラウンド</button>
      <button type="button" class="big" id="restore-btn">復元</button>
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
  $('#new-btn').addEventListener('click', async () => { await renderSetup($('#screen-setup')); show('setup'); });
  $('#restore-btn').addEventListener('click', async () => { await renderRestore($('#screen-restore')); show('restore'); });
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
      <p id="finish-msg"></p>
    </div>`;
  $('#back-hole-btn').addEventListener('click', () => show('hole'));
  $('#export-btn').addEventListener('click', () => exportRoundJson(s));
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
  const links = [];
  if (out.bookUrl) links.push(`<p><a class="btn-link" href="${esc(out.bookUrl)}" target="_blank" rel="noopener">📖 スコアブックPDF</a></p>`);
  if (out.shareUrl) links.push(`<p><a class="btn-link" href="${esc(out.shareUrl)}" target="_blank" rel="noopener">🖼 共有用スコアカード画像</a></p>`);
  if (linksEl) linksEl.innerHTML = links.join('');
  if (statusEl) {
    statusEl.textContent = out.errors.length
      ? `一部作成できませんでした：${out.errors.join(' / ')}`
      : 'スコアブックと共有用画像を作成しました。';
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

async function init() {
  const verEl = document.querySelector('#app-version');
  if (verEl) verEl.textContent = 'v' + APP_VERSION;
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

  // バージョン確認：PWA は再開時にページを読み直さないため、サーバーの version.json と
  // 明示的に比べないと更新に気づけない。新しければバナーを出し、タップで更新する。
  let lastVersionCheck = 0;
  async function checkForUpdate() {
    const now = Date.now();
    if (now - lastVersionCheck < 10 * 60 * 1000) return;
    lastVersionCheck = now;
    try {
      const res = await fetch('./version.json', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      if (data.version && data.version !== APP_VERSION) {
        // 新 SW のインストールを先に走らせておく（「更新する」を押した時点で waiting にしておく）
        navigator.serviceWorker.getRegistration().then(r => { if (r) r.update().catch(() => {}); }).catch(() => {});
        showUpdateBanner(data.version);
      }
    } catch (_) { /* オフライン時は何もしない */ }
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
  checkForUpdate();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkForUpdate(); });

  show('home');
}

init();
