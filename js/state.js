// 進行中ラウンドの状態管理（単一の真実）。画面は state を描くだけ。
// 状態 JSON は保存時にそのまま holes_json / partners_json / game_json へ写像できる形に保つ。
import { putVerified, get, setMeta } from './db.js';

export function emit(name, detail) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

const empty18 = (fill) => Array.from({ length: 18 }, () => fill);

export function newRoundState(setup) {
  // setup: {date, course_id, course_name, halves:[subA, subB], tee_name, green_name, weather, wind, partners:[name...], game}
  const pars = [], yards = [], hdcp = [], strategies = [];
  setup.halves.forEach(sub => {
    pars.push(...sub.pars); yards.push(...sub.yards); hdcp.push(...sub.handicaps);
    strategies.push(...(sub.strategies || sub.pars.map(() => '')));
  });
  const yyyymmdd = setup.date.replace(/-/g, '');
  return {
    round_id: `R${yyyymmdd}_${setup.course_id}`,
    date: setup.date,
    course_id: String(setup.course_id),
    course_name: setup.course_name,
    half_names: setup.halves.map(s => s.name),
    tee: setup.tee_name || '',
    green: setup.green_name || '',
    weather: setup.weather || '晴れ',
    wind: setup.wind || '',
    currentHole: 1, // 1..18（通し番号）
    pars, yards, hdcp, strategies,
    scores: empty18(0),
    putts: empty18(0),
    fw: empty18(null),
    clubs: empty18(''),       // ティーショットの番手
    ob: empty18(0),
    pen: empty18(0),
    bunker: empty18(0),
    shots: empty18(null).map(() => []), // [{club, res, isBunker, type}]
    holeMemos: empty18(''),
    partners: (setup.partners || []).map((name, i) => ({
      partner_id: i + 1, name,
      scores: empty18(0),
      putts: empty18(null),
    })),
    order: setup.order || null, // 打順（全人数分。シャッフル/手動設定の結果）
    game: setup.game || null, // {type:'tomodachi', order:[names], nearpin:{H3:name}, dragon:{}} ※4人のときだけ作る
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

let _state = null;
let _saveTimer = null;
let _saveError = null;

export function getState() { return _state; }
export function setState(s) { _state = s; }
export function getSaveError() { return _saveError; }

// --- ローカル保存：300ms デバウンス＋読み戻し照合。失敗はバナー表示用に保持し、再試行する ---
export function scheduleSave() {
  if (!_state) return;
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => { saveNow().catch(() => {}); }, 300);
}

export async function saveNow() {
  if (!_state) return;
  if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
  _state.updated_at = new Date().toISOString();
  try {
    await putVerified('round', { key: 'current', state: _state }, v => v.key);
    _saveError = null;
    await setMeta('lastLocalSave', _state.updated_at);
    emit('mygolf-save-status', { ok: true, at: _state.updated_at });
  } catch (err) {
    _saveError = String(err && err.message || err);
    emit('mygolf-save-status', { ok: false, error: _saveError });
    throw err;
  }
}

// ホール確定時：現世代を 'prev' に退避してから続行（世代ローテーション）
export async function rotateGeneration() {
  const cur = await get('round', 'current');
  if (cur && cur.state) {
    await putVerified('round', { key: 'prev', state: cur.state }, v => v.key);
  }
}

export async function loadCurrent() {
  const row = await get('round', 'current');
  return row ? row.state : null;
}

export async function loadGeneration(key) {
  const row = await get('round', key);
  return row ? row.state : null;
}

export async function clearCurrent() {
  const { del } = await import('./db.js');
  await del('round', 'current');
  await del('round', 'prev');
  _state = null;
}

// --- 集計 ---
// ショット記録が本人のスコアの正（v0.3〜）。ショットを編集したら scores/putts/clubs を同期する。
// バンカーは独立要素で、ここには一切含めない（打数に数えない）。
export function syncDerived(s, i) {
  const shots = s.shots[i] || [];
  s.scores[i] = shots.length;
  s.putts[i] = shots.filter(sh => sh.club === 'PT').length;
  s.clubs[i] = shots.length ? shots[0].club : '';
}

export function holePlayed(s, i) {
  return (s.scores[i] || 0) > 0;
}

export function totals(s) {
  const sum = (arr, from, to) => arr.slice(from, to).reduce((a, b) => a + (b || 0), 0);
  const ob = s.ob.reduce((a, b) => a + b, 0);
  const pen = s.pen.reduce((a, b) => a + b, 0);
  const bunker = s.bunker.reduce((a, b) => a + b, 0);
  let fwKeep = 0, fwTotal = 0;
  s.fw.forEach((v, i) => {
    if (s.pars[i] === 3) return;
    if (v) { fwTotal++; if (v === 'K' || v === 'S') fwKeep++; }
  });
  return {
    out_score: sum(s.scores, 0, 9), in_score: sum(s.scores, 9, 18),
    score: sum(s.scores, 0, 18),
    out_putts: sum(s.putts, 0, 9), in_putts: sum(s.putts, 9, 18),
    putts: sum(s.putts, 0, 18),
    ob, pen, bunker,
    fw_rate: fwTotal ? Math.round(fwKeep / fwTotal * 1000) / 10 : 0,
  };
}

// state → Rounds 行（GAS saveRound の round オブジェクト）
export function toRoundRecord(s) {
  const t = totals(s);
  const memo = s.holeMemos
    .map((m, i) => m ? `H${i + 1}:${m}` : '')
    .filter(Boolean).join(' / ');
  return {
    round_id: s.round_id,
    date: s.date,
    course_id: s.course_id,
    course_name: s.course_name,
    half_names: s.half_names,
    tee: s.tee,
    green: s.green,
    weather: s.weather,
    wind: s.wind,
    score: t.score,
    putts: t.putts,
    fw_rate: t.fw_rate,
    ob_pen_bunker: {
      ob: t.ob, pen: t.pen, bunker: t.bunker,
      out_score: t.out_score, in_score: t.in_score,
      out_putts: t.out_putts, in_putts: t.in_putts,
      fw_keep_rate: t.fw_rate,
    },
    memo,
    holes_json: {
      pars: s.pars, yards: s.yards, hdcp: s.hdcp,
      scores: s.scores, putts: s.putts, fw: s.fw, clubs: s.clubs,
      ob: s.ob, pen: s.pen, bunker: s.bunker, shots: s.shots,
    },
    partners_json: s.partners.map(p => ({
      partner_id: p.partner_id, name: p.name,
      scores: p.scores, putts: p.putts,
      total_score: p.scores.reduce((a, b) => a + (b || 0), 0),
      total_putts: p.putts.every(v => v == null) ? null : p.putts.reduce((a, b) => a + (b || 0), 0),
    })),
    game_json: s.game ? {
      type: s.game.type,
      initial_order: s.game.order.map((n, i) => `${i + 1}:${n}`).join(', '),
      nearpin: Object.entries(s.game.nearpin || {}).map(([h, n]) => `${h}:${n}`).join(', '),
    } : null,
  };
}

// 復元候補の概要（「無い／不完全」の分離表示用）
export function summarize(s) {
  if (!s) return null;
  const played = s.scores.filter(v => v > 0).length;
  return {
    round_id: s.round_id,
    date: s.date,
    course_name: s.course_name,
    currentHole: s.currentHole,
    playedHoles: played,
    scoreSoFar: s.scores.reduce((a, b) => a + (b || 0), 0),
    partners: s.partners.map(p => p.name),
    updated_at: s.updated_at,
    complete: played >= 18,
  };
}
