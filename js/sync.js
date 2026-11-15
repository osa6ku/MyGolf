// GAS クライアント：下書き保存・取得、確定保存、保留キュー。
// fetch はタイムアウト10秒、指数バックオフ最大3回。失敗してもローカル保存は止めない。
import { getMeta, setMeta, put, del, getAll } from './db.js';
import { emit } from './state.js';

export async function gasUrl() {
  return (await getMeta('gasUrl', '')) || '';
}

export async function setGasUrl(url) {
  await setMeta('gasUrl', (url || '').trim());
}

function fetchWithTimeout(url, options, ms = 10000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...options, signal: ctrl.signal })
    .finally(() => clearTimeout(timer));
}

async function call(action, payload, method = 'POST', retries = 3) {
  const base = await gasUrl();
  if (!base) throw new Error('GAS URL が未設定です');
  let lastErr = null;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      let res;
      if (method === 'GET') {
        const u = new URL(base);
        u.searchParams.set('action', action);
        res = await fetchWithTimeout(u.toString(), { method: 'GET' });
      } else {
        // CORS 回避のため Content-Type: text/plain で JSON 文字列を送る（現行の修正知見を継承）
        res = await fetchWithTimeout(base, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify({ action, ...payload }),
        });
      }
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'サーバーエラー');
      return data;
    } catch (err) {
      lastErr = err;
      if (attempt < retries - 1) {
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
      }
    }
  }
  throw lastErr;
}

export async function fetchMaster() {
  const data = await call('getMaster', null, 'GET', 2);
  return { courses: data.courses || [], members: data.members || [], played: data.played || [] };
}

export async function saveDraft(state) {
  try {
    const data = await call('saveDraft', { round_id: state.round_id, payload: state });
    await setMeta('lastDraftSave', data.updated_at || new Date().toISOString());
    emit('mygolf-draft-status', { ok: true, at: data.updated_at });
    return data;
  } catch (err) {
    emit('mygolf-draft-status', { ok: false, error: String(err && err.message || err) });
    throw err;
  }
}

export async function fetchDraft() {
  const data = await call('getDraft', null, 'GET', 2);
  return data.draft; // {round_id, updated_at, payload} | null
}

// --- 確定保存の保留キュー ---
export async function queuePending(record) {
  await put('pending', record);
}

export async function pendingList() {
  return getAll('pending');
}

export async function flushPending() {
  const items = await pendingList();
  const results = [];
  for (const rec of items) {
    try {
      const data = await call('saveRound', { round: rec });
      await del('pending', rec.round_id);
      results.push({ round_id: rec.round_id, ok: true, duplicate: !!data.duplicate });
    } catch (err) {
      results.push({ round_id: rec.round_id, ok: false, error: String(err && err.message || err) });
    }
  }
  return results;
}

export async function saveRoundNow(record) {
  return call('saveRound', { round: record });
}
