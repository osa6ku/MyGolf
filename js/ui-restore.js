// 復元画面：端末内（現世代→前世代）→クラウド下書きの順に候補を提示。
// 各候補は概要付き。「データなし」と「不完全かもしれない」を分けて表示する。
// 検証関数は復元の可否に使わない（本人の判断で復元できる）。
import { loadGeneration, setState, saveNow, summarize } from './state.js';
import { fetchDraft } from './sync.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let onRestored = () => {};
export function setRestoreHandler(fn) { onRestored = fn; }

function candidateHtml(kind, sum) {
  if (!sum) return `<div class="card"><h3>${kind}</h3><p>データなし</p></div>`;
  const incomplete = !sum.complete
    ? '<p class="warn">不完全かもしれません（入力済みホールが18未満）。内容を確認のうえ復元できます。</p>' : '';
  return `<div class="card"><h3>${kind}</h3>
    <p>${esc(sum.course_name)}（${esc(sum.date)}）/ 現在 ${sum.currentHole}H / 入力済み ${sum.playedHoles}H / スコア計 ${sum.scoreSoFar}<br>
    同伴者：${sum.partners.map(esc).join('、') || 'なし'} / 最終保存：${esc(sum.updated_at || '')}</p>
    ${incomplete}
    <button type="button" class="primary" data-restore="${kind}">この内容で復元する</button></div>`;
}

export async function renderRestore(root) {
  root.innerHTML = '<p>候補を読み込み中…</p>';
  const cur = await loadGeneration('current');
  const prev = await loadGeneration('prev');
  let cloud = null, cloudErr = '';
  try {
    const draft = await fetchDraft();
    if (draft && draft.payload) cloud = draft.payload;
  } catch (err) {
    cloudErr = String(err && err.message || err);
  }

  root.innerHTML = `
    ${candidateHtml('端末内（現世代）', summarize(cur))}
    ${candidateHtml('端末内（前世代）', summarize(prev))}
    ${cloudErr ? `<div class="card"><h3>クラウド下書き</h3><p class="warn">取得できませんでした：${esc(cloudErr)}</p></div>`
               : candidateHtml('クラウド下書き', summarize(cloud))}`;

  const apply = async (state) => {
    if (!state) return;
    setState(state);
    await saveNow();
    onRestored();
  };
  root.querySelectorAll('[data-restore]').forEach(btn => {
    btn.addEventListener('click', () => {
      const kind = btn.dataset.restore;
      if (kind.startsWith('端末内（現')) apply(cur);
      else if (kind.startsWith('端末内（前')) apply(prev);
      else apply(cloud);
    });
  });
}
