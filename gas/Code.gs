/**
 * MyGolf backend (新規・最小) — 検証用コピー「マイスコア_DB_新アプリ検証用」専用。
 * 本番DBには接続しない。認証なし・AccessLogなし（要件 U-10）。URLの秘匿のみで運用。
 *
 * Actions:
 *   GET  ?action=getMaster  コースマスタ全件＋メンバー一覧（Rounds の partners_json から集計）＋プレー済みコース集計
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
  return { ok: true, count: courses.length, courses: courses, members: getMembers_(), played: getPlayed_() };
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

/**
 * プレー済みコース：Rounds から (course_id, 名前) のペア単位で集計（回数・最終日）。
 * 元データには「同じ course_id に別のコース名が付いた行」が混在する（例：レイクランドの行が
 * 鹿沼72の ID を持つ）。ID単位で名前を上書きすると別コースに化けるため、ペアで返し、
 * 名前→ID の引き直しと合算はアプリ側（getPlayedCourses）が行う。
 * アプリのコース選択は初期表示をこの一覧に絞る（全3,038件は検索時のみ）。
 * 並びは最終日 desc → 回数 desc。
 */
function getPlayed_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_ROUNDS);
  var stats = {}; // (course_id + '|' + name) -> {course_id, name, count, last}
  if (sh && sh.getLastRow() > 1) {
    var values = sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues();
    for (var r = 0; r < values.length; r++) {
      var cid = String(values[r][2] || '');
      if (!cid) continue;
      var name = String(values[r][3] || '');
      var dateVal = values[r][1];
      var dateStr = dateVal instanceof Date
        ? Utilities.formatDate(dateVal, 'Asia/Tokyo', 'yyyy-MM-dd')
        : String(dateVal || '');
      var key = cid + '|' + name;
      if (!stats[key]) stats[key] = { course_id: cid, name: name, count: 0, last: '' };
      stats[key].count++;
      if (dateStr > stats[key].last) stats[key].last = dateStr;
    }
  }
  return Object.keys(stats).map(function (k) { return stats[k]; }).sort(function (a, b) {
    if (a.last !== b.last) return a.last < b.last ? 1 : -1;
    return b.count - a.count;
  });
}

/** MyScore 内蔵リスト（MemberMasterシートが存在しないため、履歴に無い名前の受け皿）。本人は除く。 */
var FALLBACK_MEMBERS = [
  '松村和也', '熊谷浩', '古屋典之', '角陸伸彦', '西山明宏', '岡田剛', '土井武之',
  '平居孝博', '蓑手強志', '石原一', '太田あいり', '水木雅之', '山田良和', '堀覚', '上原',
  '稲田壮', '山本', '北野', '浦上真乙プロ', 'ハヤシ', 'ジュン', '石原千夏', '古屋綾子',
  '佐藤めぐみ', '加藤', '沢田', '大西剛', '綾部豊', '中山航', '竹沢磊', '近藤',
  '米村', '江口', '成瀬', '伊藤', '谷口', '浦野', '北浦', '蓑手美子'
];

/** 名前の正規化（MyScore の表記ゆれ吸収ルールを継承）。 */
function cleanMemberName_(name) {
  var clean = String(name || '').trim().replace(/\s+/g, '');
  if (clean.endsWith('さん') && clean.length > 2) clean = clean.slice(0, -2);
  if (clean.endsWith('様') && clean.length > 1) clean = clean.slice(0, -1);
  if (clean === '角陸信彦') clean = '角陸伸彦';
  if (clean === '西山明彦') clean = '西山明宏';
  if (clean === '稲田荘' || clean === '稲田さな') clean = '稲田壮';
  if (clean === '水木') clean = '水木雅之';
  if (clean === '堀') clean = '堀覚';
  if (clean === '太田') clean = '太田あいり';
  return clean;
}

/**
 * メンバー一覧：Rounds の partners_json から実績（回数・最終日）を集計し、
 * 内蔵リストで補完。本人は除外。並びは最終日 desc → 回数 desc → 内蔵リスト順。
 */
function getMembers_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_ROUNDS);
  var stats = {}; // name -> {name, count, last}
  if (sh && sh.getLastRow() > 1) {
    var values = sh.getRange(2, 1, sh.getLastRow() - 1, 16).getValues();
    for (var r = 0; r < values.length; r++) {
      var dateVal = values[r][1];
      var dateStr = dateVal instanceof Date
        ? Utilities.formatDate(dateVal, 'Asia/Tokyo', 'yyyy-MM-dd')
        : String(dateVal || '');
      var partners = [];
      try { partners = JSON.parse(values[r][15] || '[]'); } catch (e) { partners = []; }
      if (!Array.isArray(partners)) continue;
      var seenInRound = {};
      partners.forEach(function (p) {
        var name = cleanMemberName_(p && p.name);
        if (!name || name === '桑木修' || seenInRound[name]) return;
        seenInRound[name] = true;
        if (!stats[name]) stats[name] = { name: name, count: 0, last: '' };
        stats[name].count++;
        if (dateStr > stats[name].last) stats[name].last = dateStr;
      });
    }
  }
  var order = {};
  FALLBACK_MEMBERS.forEach(function (n, i) { order[n] = i; });
  Object.keys(stats).forEach(function (n) {
    if (!(n in order)) order[n] = FALLBACK_MEMBERS.length + Object.keys(order).length;
  });
  FALLBACK_MEMBERS.forEach(function (n) {
    if (!stats[n]) stats[n] = { name: n, count: 0, last: '' };
  });
  return Object.keys(stats).map(function (n) { return stats[n]; }).sort(function (a, b) {
    if (a.last !== b.last) return a.last < b.last ? 1 : -1;
    if (a.count !== b.count) return b.count - a.count;
    return order[a.name] - order[b.name];
  });
}
