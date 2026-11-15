/**
 * MyGolf backend (新規・最小) — 検証用コピー「マイスコア_DB_新アプリ検証用」専用。
 * 本番DBには接続しない。認証なし・AccessLogなし（要件 U-10）。URLの秘匿のみで運用。
 *
 * Actions:
 *   GET  ?action=getMaster  コースマスタ全件
 *   GET  ?action=getDraft   最新の下書き（シート「下書き」1行保持）
 *   POST {action:"saveDraft", round_id, payload}   下書き保存
 *   POST {action:"saveRound", round:{...}}         確定保存（Rounds へ降順挿入、round_id重複チェック付き）
 * 応答は常に JSON {ok:true,...} / {ok:false, error:"..."}。
 */

var SHEET_COURSES = 'Courses';
var SHEET_ROUNDS = 'Rounds';
var SHEET_DRAFT = '下書き';

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  try {
    var action = (e && e.parameter && e.parameter.action) || '';
    if (action === 'getMaster') return jsonOut(getMaster_());
    if (action === 'getDraft') return jsonOut(getDraft_());
    return jsonOut({ ok: false, error: 'unknown action: ' + action });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err && err.message || err) });
  }
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var action = body.action || '';
    if (action === 'saveDraft') return jsonOut(saveDraft_(body));
    if (action === 'saveRound') return jsonOut(saveRound_(body));
    return jsonOut({ ok: false, error: 'unknown action: ' + action });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err && err.message || err) });
  }
}

/** Courses 全件。sub_courses_json はパースして返す。 */
function getMaster_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_COURSES);
  var values = sh.getDataRange().getValues();
  var header = values[0];
  var idx = {};
  header.forEach(function (h, i) { idx[h] = i; });
  var courses = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    if (!row[idx.course_id]) continue;
    var subs = [];
    try { subs = JSON.parse(row[idx.sub_courses_json] || '[]'); } catch (e) { subs = []; }
    courses.push({
      course_id: String(row[idx.course_id]),
      name: row[idx.name],
      name_kana: row[idx.name_kana],
      name_abbreviation: row[idx.name_abbreviation],
      sub_courses: subs
    });
  }
  return { ok: true, count: courses.length, courses: courses };
}

/** 下書きシート（なければ作る）。 */
function draftSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_DRAFT);
  if (!sh) {
    sh = ss.insertSheet(SHEET_DRAFT);
    sh.getRange(1, 1, 1, 3).setValues([['round_id', 'updated_at', 'payload_json']]);
  }
  return sh;
}

function saveDraft_(body) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = draftSheet_();
    var updatedAt = new Date().toISOString();
    sh.getRange(2, 1, 1, 3).setValues([[
      String(body.round_id || ''),
      updatedAt,
      JSON.stringify(body.payload || {})
    ]]);
    return { ok: true, updated_at: updatedAt };
  } finally {
    lock.releaseLock();
  }
}

function getDraft_() {
  var sh = draftSheet_();
  var row = sh.getRange(2, 1, 1, 3).getValues()[0];
  if (!row[0]) return { ok: true, draft: null };
  var payload = null;
  try { payload = JSON.parse(row[2] || 'null'); } catch (e) { payload = null; }
  return {
    ok: true,
    draft: {
      round_id: String(row[0]),
      // 日付はサーバー側で ISO 文字列に正規化して返す
      updated_at: row[1] instanceof Date ? row[1].toISOString() : String(row[1]),
      payload: payload
    }
  };
}

/**
 * 確定保存。Rounds の既存17列形式で2行目に挿入（降順）。
 * round_id が既に存在すれば二重登録せず duplicate:true を返す。
 * round = {round_id, date, course_id, course_name, half_names, tee, green,
 *           weather, wind, score, putts, fw_rate, ob_pen_bunker, memo,
 *           holes_json, partners_json, game_json}
 * （*_json はオブジェクトでも文字列でも可。オブジェクトは文字列化する）
 */
function saveRound_(body) {
  var round = body.round || {};
  if (!round.round_id) return { ok: false, error: 'round_id required' };
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName(SHEET_ROUNDS);
    var ids = sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 0), 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === String(round.round_id)) {
        return { ok: true, duplicate: true };
      }
    }
    var asJson = function (v) {
      if (v == null) return '';
      return typeof v === 'string' ? v : JSON.stringify(v);
    };
    var rowValues = [[
      String(round.round_id),
      round.date || '',
      String(round.course_id || ''),
      round.course_name || '',
      asJson(round.half_names),
      round.tee || '',
      round.green || '',
      round.weather || '',
      round.wind || '',
      round.score != null ? round.score : '',
      round.putts != null ? round.putts : '',
      round.fw_rate != null ? round.fw_rate : '',
      asJson(round.ob_pen_bunker),
      round.memo || '',
      asJson(round.holes_json),
      asJson(round.partners_json),
      asJson(round.game_json)
    ]];
    sh.insertRows(2, 1);
    sh.getRange(2, 1, 1, 17).setValues(rowValues);
    return { ok: true, duplicate: false };
  } finally {
    lock.releaseLock();
  }
}
