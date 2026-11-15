// コースマスタ：取得・キャッシュ・検索。同期完了時はキャッシュ差し替えのみ（進行中ラウンドに干渉しない）。
import { clear, put, getAll, setMeta, getMeta } from './db.js';
import { fetchMaster } from './sync.js';

export async function syncMaster() {
  const { courses, members, played } = await fetchMaster();
  await clear('master');
  for (const c of courses) await put('master', c);
  await setMeta('members', members);
  await setMeta('playedCourses', played);
  return { courses: courses.length, members: members.length, played: played.length };
}

export async function getMembers() {
  return (await getMeta('members', [])) || [];
}

export async function getPlayedCourses() {
  return (await getMeta('playedCourses', [])) || [];
}

export async function allCourses() {
  return getAll('master');
}

export async function searchCourses(query) {
  const q = (query || '').trim();
  if (!q) return [];
  const all = await allCourses();
  return all.filter(c =>
    (c.name && c.name.includes(q)) ||
    (c.name_kana && c.name_kana.includes(q)) ||
    (c.name_abbreviation && c.name_abbreviation.includes(q))
  ).slice(0, 30);
}

export async function masterCount() {
  return (await allCourses()).length;
}
