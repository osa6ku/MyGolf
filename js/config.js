// MyGolf 設定・定数
export const APP_NAME = 'MyGolf';
export const APP_VERSION = '0.7.0';
export const DB_NAME = 'mygolf';
export const DB_VERSION = 1;

// 本人のバッグ構成13本（2026-11-15 本人指定）。表記は本人の記録履歴に合わせる（アイアンは小文字 i、ウェッジは ° つき）。
// v0.6.2: 'PT外' を追加（実クラブではなく、グリーン外でパターを使った打の記録上の区別。パット数は PT のみで数える — 2026-11-16 本人決定）。
export const DEFAULT_CLUBS = [
  '1W', '5W', '5H',
  '6i', '7i', '8i', '9i',
  'W', '50°', '54°', '58°', 'ChipR', 'PT', 'PT外'
];

export const SHOT_RESULTS = ['◯', '左', '右', '短', '奥', 'ダ', 'ト'];
export const FW_VALUES = ['K', 'L', 'R', 'S', 'O', '-']; // 表示用。FW自体はティーショット結果から自動導出（v0.4〜）
export const WEATHERS = ['晴れ', '曇り', '雨', '雪'];
export const WINDS = ['', '弱', '中', '強'];

// ハーフの組み合わせ（回る順番）が決まっているコース（course_id → [[前半, 後半], ...]）。
// DBのCoursesには組み合わせ情報が無いため、判明したコースだけここに登録する。
export const COURSE_HALF_PAIRS = {
  // ゴールデンレイクスカントリークラブ：3コース営業時のローテーション（楽天GORA予約メールのゴルフ場案内に明記）
  '90036': [['グリーンコース', 'ブルーコース'], ['ブルーコース', 'オレンジコース'], ['オレンジコース', 'グリーンコース']],
};
