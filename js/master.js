// コースマスタ：取得・キャッシュ・検索。同期完了時はキャッシュ差し替えのみ（進行中ラウンドに干渉しない）。
import { clear, put, getAll, setMeta, getMeta } from './db.js';
import { fetchMaster } from './sync.js';

export async function syncMaster() {
  const { courses, members } = await fetchMaster();
  await clear('master');
  for (const c of courses) await put('master', c);
  await setMeta('members', members);
  return { courses: courses.length, members: members.length };
}

export async function getMembers() {
  return (await getMeta('members', [])) || [];
}

export async function allCourses() {
  return getAll('master');
}

export async function searchCourses(query) {
  const all = await allCourses();
  const q = (query || '').trim();
  if (!q) return all.slice(0, 50);
  return all.filter(c =>
    (c.name && c.name.includes(q)) ||
    (c.name_kana && c.name_kana.includes(q)) ||
    (c.name_abbreviation && c.name_abbreviation.includes(q))
  ).slice(0, 50);
}

export async function masterCount() {
  return (await allCourses()).length;
}
