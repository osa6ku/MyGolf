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
  // 同日・同コースの2ラウンド目やテスト保存と衝突しないよう、開始時刻のサフィックスを付ける
  const now = new Date();
  const suffix = [now.getHours(), now.getMinutes(), now.getSeconds()]
    .map(v => String(v).padStart(2, '0')).join('');
  return {
    round_id: `R${yyyymmdd}_${setup.course_id}_${suffix}`,
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

// 保存は直列化する：実行中の保存があるときは後ろに並び、古い保存が新しい状態を上書きしないようにする
let _saveChain = Promise.resolve();

export function saveNow() {
  if (!_state) return Promise.resolve();
  if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
  const run = async () => {
    if (!_state) return;
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
  };
  const p = _saveChain.then(run, run);
  _saveChain = p.catch(() => {});
  return p;
}

// ホール確定時：現世代を 'prev' に退避してから続行（世代ローテーション）
export async function rotateGeneration() {
  const cur = await get('round', 'current');
  if (cur && cur.state) {
    await putVerified('round', { key: 'prev', state: cur.state }, v => v.key);
  }
}

// 設定変更時：バックアップ世代（prev）も現在の内容で上書きする（古い設定が復元で蘇らないように）
export async function overwritePrevGeneration() {
  if (!_state) return;
  await putVerified('round', { key: 'prev', state: _state }, v => v.key);
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
// ショット記録が本人のスコアの正（v0.3〜）。ショットを編集したら scores/putts/clubs と
// OB/ペナ/バンカー/FW をすべてショットから導出する（独立入力は v0.4 で廃止）。
// 1打分の打数：通常1打。OBは+1、プレ4は+2、1ペナは+1。バンカーは+0（記録のみ）。
export function shotStrokes(sh) {
  return 1 + (sh.ob ? 1 : 0) + (sh.pre4 ? 2 : 0) + (sh.pen ? 1 : 0);
}

// ティーショット（1打目）の結果 → FW表記（MyScoreと同じ対応）。結果ボタンは '◯'（U+25EF）で統一。
const FW_FROM_RES = { '◯': 'K', '左': 'L', '右': 'R', '短': 'S', '奥': 'O' };

export function syncDerived(s, i) {
  const shots = s.shots[i] || [];
  s.scores[i] = shots.reduce((a, sh) => a + shotStrokes(sh), 0);
  s.putts[i] = shots.filter(sh => sh.club === 'PT').length;
  s.clubs[i] = shots.length ? shots[0].club : '';
  s.ob[i] = shots.filter(sh => sh.ob).length;
  s.pen[i] = shots.filter(sh => sh.pen).length + shots.filter(sh => sh.pre4).length;
  s.bunker[i] = shots.filter(sh => sh.isBunker).length;
  const first = shots[0];
  s.fw[i] = (s.pars[i] >= 4 && first && first.res) ? (FW_FROM_RES[first.res] || null) : null;
}

export function holePlayed(s, i) {
  return (s.scores[i] || 0) > 0;
}

// 同伴者スコアの未入力（0）は「デフォルト＝パー」。ホール確定を押さずに終了画面へ進んでも
// 0のまま保存されないよう、本人がプレーしたホールについては保存前にパーで実体化する。
export function materializePartnerPars(s) {
  s.partners.forEach(p => {
    for (let i = 0; i < 18; i++) {
      if (!p.scores[i] && holePlayed(s, i)) p.scores[i] = s.pars[i];
    }
  });
}

export function totals(s) {
  const sum = (arr, from, to) => arr.slice(from, to).reduce((a, b) => a + (b || 0), 0);
  const ob = s.ob.reduce((a, b) => a + b, 0);
  const pen = s.pen.reduce((a, b) => a + b, 0);
  const bunker = s.bunker.reduce((a, b) => a + b, 0);
  let fwKeep = 0, fwTotal = 0;
  s.fw.forEach((v, i) => {
    if (s.pars[i] === 3) return;
    if (v) { fwTotal++; if (v === 'K') fwKeep++; }
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
  materializePartnerPars(s); // 未確定ホールの同伴者スコア（0）をパーで補完してから写像する
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
