// コースマスタ：取得・キャッシュ・検索。同期完了時はキャッシュ差し替えのみ（進行中ラウンドに干渉しない）。
import { replaceAll, getAll, setMeta, getMeta } from './db.js';
import { fetchMaster } from './sync.js';

export async function syncMaster() {
  const { courses, members, played } = await fetchMaster();
  // 取得が完了してから、1トランザクションで原子的に入れ替える（途中中断でマスタが消えない）
  await replaceAll('master', courses);
  await setMeta('members', members);
  await setMeta('playedCourses', played);
  return { courses: courses.length, members: members.length, played: played.length };
}

export async function getMembers() {
  return (await getMeta('members', [])) || [];
}

export async function getPlayedCourses() {
  const played = (await getMeta('playedCourses', [])) || [];
  const courses = await allCourses();
  if (!courses.length) return played;
  // 元データ（Rounds）で名前とIDが食い違う行がある（例：レイクランドのIDが鹿沼72のもの）。
  // 名前がマスタにあれば名前を正としてIDを引き直し、同IDは合算する。
  const byName = new Map(courses.map(c => [c.name, String(c.course_id)]));
  const merged = new Map();
  for (const p of played) {
    const id = byName.get(p.name) || String(p.course_id);
    if (merged.has(id)) {
      const m = merged.get(id);
      m.count += p.count || 0;
      if (String(p.last || '') > String(m.last || '')) m.last = p.last;
    } else {
      merged.set(id, { ...p, course_id: id });
    }
  }
  return [...merged.values()];
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
