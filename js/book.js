// スコアブックPDFページと共有用スコアカード画像の生成。
// 描画は Canvas（デザインは 2026-11-16 承認サンプルと同一仕様）。
// このモジュールは import を持たない純粋モジュール（テストハーネスからも読める）。
// PDF 結合は window.PDFLib（CDN）を使い、GAS 呼び出しは api 引数で注入する。

const FONT = '"Hiragino Kaku Gothic ProN","Hiragino Sans","Yu Gothic UI","Yu Gothic","Noto Sans CJK JP","Noto Sans JP",sans-serif';
const GREEN = '#1d4a38';
const LINE = '#9db8ad';
const SHADE = '#eef4f1';
const DIFF_BG = { '-2': '#8fd0f5', '-1': '#cdeffd', '1': '#fdf0b8', '2': '#ffd9a8', '3': '#ffc7c7' };

function diffBg(v, p) {
  if (v == null || !v) return null;
  const d = v - p;
  if (d <= -2) return DIFF_BG['-2'];
  if (d === -1) return DIFF_BG['-1'];
  if (d === 0) return null;
  if (d === 1) return DIFF_BG['1'];
  if (d === 2) return DIFF_BG['2'];
  return DIFF_BG['3'];
}

const sum = (a, f, t) => a.slice(f, t).reduce((x, y) => x + (y || 0), 0);
const fmtSigned = n => (n >= 0 ? '+' + n : '' + n);

// ヘッダー1行：左タイトルと右メタ情報が重ならないよう、タイトルを縮小し、
// それでも入らなければ末尾を「…」で短縮して描く（長いコース名対策）。
function drawHeaderLine(ctx, title, meta, x, rightX, y, titlePx, metaPx, minPx) {
  ctx.textBaseline = 'middle';
  ctx.font = `${metaPx}px ${FONT}`;
  const avail = (rightX - x) - ctx.measureText(meta).width - 24;
  let size = titlePx;
  ctx.font = `bold ${size}px ${FONT}`;
  let text = title;
  while (ctx.measureText(text).width > avail && size > minPx) {
    size -= 2;
    ctx.font = `bold ${size}px ${FONT}`;
  }
  if (ctx.measureText(text).width > avail) {
    while (text.length && ctx.measureText(text + '…').width > avail) text = text.slice(0, -1);
    text += '…';
  }
  ctx.fillStyle = '#222'; ctx.textAlign = 'left';
  ctx.fillText(text, x, y);
  ctx.font = `${metaPx}px ${FONT}`; ctx.fillStyle = '#444'; ctx.textAlign = 'right';
  ctx.fillText(meta, rightX, y);
}

/* ---------------- データ整形 ---------------- */

// record = toRoundRecord() の出力（Rounds行形式）。tomo = tomoFromCalc() の結果 or null。
export function buildBookData(record, tomo) {
  const hj = typeof record.holes_json === 'string' ? JSON.parse(record.holes_json) : (record.holes_json || {});
  const partnersRaw = typeof record.partners_json === 'string' ? JSON.parse(record.partners_json) : (record.partners_json || []);
  const game = typeof record.game_json === 'string' ? JSON.parse(record.game_json || 'null') : record.game_json;

  const nearpin = {};
  if (game && game.nearpin) {
    const re = /H(\d+)\s*:\s*([^,]+)/g;
    let m;
    while ((m = re.exec(game.nearpin))) nearpin[Number(m[1])] = m[2].trim();
  }

  const memos = {};
  if (record.memo) {
    const re = /H(\d+):(.*?)(?= \/ H\d+:|$)/g;
    let m;
    while ((m = re.exec(record.memo))) memos[Number(m[1])] = m[2].trim();
  }

  const holeLines = [];
  for (let i = 0; i < 18; i++) {
    const shots = (hj.shots && hj.shots[i]) || [];
    const shotsText = shots.map(sh => (sh.club || '') + (sh.res || '')).join(' → ');
    holeLines.push({ shots: shotsText, memo: memos[i + 1] || '' });
  }

  const data = {
    date: record.date || '',
    courseName: record.course_name || '',
    tee: record.tee || '-', green: record.green || '-', weather: record.weather || '-', wind: record.wind || '-',
    companions: partnersRaw.map(p => p.name),
    pars: hj.pars || [], yards: hj.yards || [],
    selfScores: hj.scores || [], selfPutts: hj.putts || [],
    bunker: hj.bunker || [], ob: hj.ob || [], pen: hj.pen || [],
    partners: partnersRaw.map(p => ({ name: p.name, scores: p.scores || [] })),
    nearpin,
    holeLines,
    tomo: tomo || null,
    review: [],
  };
  data.review = computeReview(data, record);
  return data;
}

// calcTomodachi(state) の結果 {players, perHole:[{pts}], totals} と H1打順 order から
// 表示用トモダチ表（行はスコア表と同じ並び＝本人が先頭、順列はH1打順）を作る。
export function tomoFromCalc(calc, order, nearpin) {
  if (!calc) return null;
  const rows = calc.players.map((name, idx) => ({
    jun: order && order.indexOf(name) >= 0 ? order.indexOf(name) + 1 : idx + 1,
    name,
    pts: calc.perHole.map(ph => ph.pts[idx]),
    total: calc.totals[idx],
  }));
  const npText = Object.keys(nearpin || {}).sort((a, b) => a - b)
    .map(h => `H${h} ${nearpin[h]}`).join('、') || 'なし';
  return { rows, nearpinText: npText };
}

function computeReview(d, record) {
  const pars = d.pars, scores = d.selfScores, putts = d.selfPutts;
  const hj = typeof record.holes_json === 'string' ? JSON.parse(record.holes_json) : (record.holes_json || {});
  const dist = {};
  let parOn = 0, parOnBase = 0, onePutt = 0, threePutt = 0;
  let bestI = -1, worstI = -1, bestD = 1e9, worstD = -1e9;
  for (let i = 0; i < 18; i++) {
    const s = scores[i], p = pars[i];
    if (!s || !p) continue;
    const df = s - p;
    const key = df <= -2 ? 'イーグル以下' : df === -1 ? 'バーディ' : df === 0 ? 'パー' : df === 1 ? 'ボギー' : df === 2 ? 'ダボ' : 'トリ以上';
    dist[key] = (dist[key] || 0) + 1;
    if (putts[i] != null) {
      parOnBase++;
      if (s - putts[i] <= p - 2) parOn++;
      if (putts[i] === 1) onePutt++;
      if (putts[i] >= 3) threePutt++;
    }
    if (df < bestD) { bestD = df; bestI = i; }
    if (df > worstD) { worstD = df; worstI = i; }
  }
  const distTxt = ['イーグル以下', 'バーディ', 'パー', 'ボギー', 'ダボ', 'トリ以上']
    .filter(k => dist[k]).map(k => `${k} ${dist[k]}`).join(' / ') || '—';
  let fwKeep = 0, fwTotal = 0;
  (hj.fw || []).forEach((v, i) => {
    if (pars[i] === 3) return;
    if (v && v !== '-') { fwTotal++; if (v === 'K') fwKeep++; }
  });
  const fwTxt = fwTotal ? `${fwKeep}/${fwTotal}（${(fwKeep / fwTotal * 100).toFixed(1)}%）` : '記録なし';
  const obpb = typeof record.ob_pen_bunker === 'string' ? JSON.parse(record.ob_pen_bunker || '{}') : (record.ob_pen_bunker || {});
  return [
    `内訳: ${distTxt}`,
    `パーオン ${parOn}/${parOnBase} / FWキープ ${fwTxt}`,
    `1パット ${onePutt}回 / 3パット ${threePutt}回 / バンカー ${obpb.bunker ?? '-'} / OB ${obpb.ob ?? '-'} / ペナルティ ${obpb.pen ?? '-'}`,
    bestI >= 0 ? `最良 H${bestI + 1}（${fmtSigned(bestD)}） / 最大失点 H${worstI + 1}（${fmtSigned(worstD)}）` : '',
  ];
}

/* ---------------- Canvas ヘルパー ---------------- */

function wrapText(ctx, text, maxW) {
  if (!text) return [];
  const lines = [];
  let cur = '';
  for (const ch of text) {
    if (ch === '\n') { lines.push(cur); cur = ''; continue; }
    const t = cur + ch;
    if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = ch; }
    else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// スコアグリッド描画。style: {labelW, holeH, parH, selfH, detailH, scoreH, npH, fontHole, fontMain, fontSelf, fontDetail}
// 戻り値: 描画した高さ
function drawGrid(ctx, x, y, w, d, detail, st) {
  const cols = 21;
  const colW = (w - st.labelW) / cols;
  const colX = i => x + st.labelW + i * colW;
  // 列インデックス: 0-8 OUT holes, 9 OUT計, 10-18 IN holes, 19 IN計, 20 TOTAL
  const cellOf = (vals, ci) => {
    if (ci < 9) return vals[ci];
    if (ci === 9) return sum(vals, 0, 9);
    if (ci < 19) return vals[ci - 1];
    if (ci === 19) return sum(vals, 9, 18);
    return sum(vals, 0, 18);
  };
  const rows = [];
  rows.push({ label: 'HOLE', h: st.holeH, kind: 'hole' });
  rows.push({ label: 'PAR', h: st.parH, kind: 'par', vals: d.pars });
  rows.push({ label: '桑木 修', h: st.selfH, kind: 'self', vals: d.selfScores });
  if (detail) {
    rows.push({ label: 'パット', h: st.detailH, kind: 'detail', vals: d.selfPutts, puttColor: true });
    rows.push({ label: 'バンカー', h: st.detailH, kind: 'detail', vals: d.bunker });
    rows.push({ label: 'OB', h: st.detailH, kind: 'detail', vals: d.ob });
    rows.push({ label: 'ペナルティ', h: st.detailH, kind: 'detail', vals: d.pen });
  }
  d.partners.forEach(p => rows.push({ label: p.name, h: st.scoreH, kind: 'score', vals: p.scores }));
  rows.push({ label: 'ニアピン', h: st.npH, kind: 'nearpin' });

  let cy = y;
  for (const row of rows) {
    const rh = row.h;
    // 背景
    for (let ci = 0; ci < cols; ci++) {
      let bg = null;
      if (row.kind === 'hole') bg = GREEN;
      else if (ci === 9 || ci === 19 || ci === 20) bg = SHADE;
      if (row.kind === 'self' || row.kind === 'score') {
        if (ci !== 9 && ci !== 19 && ci !== 20) {
          const hi = ci < 9 ? ci : ci - 1;
          bg = diffBg(row.vals[hi], d.pars[hi]) || bg;
        }
      }
      if (row.kind === 'detail' && row.puttColor) {
        if (ci !== 9 && ci !== 19 && ci !== 20) {
          const hi = ci < 9 ? ci : ci - 1;
          if ((row.vals[hi] || 0) >= 3) bg = DIFF_BG['3'];
        }
      }
      if (bg) { ctx.fillStyle = bg; ctx.fillRect(colX(ci), cy, colW, rh); }
    }
    if (row.kind === 'hole') { ctx.fillStyle = GREEN; ctx.fillRect(x, cy, st.labelW, rh); }
    else { ctx.fillStyle = SHADE; ctx.fillRect(x, cy, st.labelW, rh); }

    // 罫線
    ctx.strokeStyle = LINE; ctx.lineWidth = 1.4;
    ctx.strokeRect(x, cy, w, rh);
    ctx.beginPath();
    for (let ci = 0; ci <= cols; ci++) { ctx.moveTo(colX(ci), cy); ctx.lineTo(colX(ci), cy + rh); }
    ctx.stroke();
    if (row.kind === 'nearpin') {
      ctx.strokeStyle = GREEN; ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(x, cy + 1.5); ctx.lineTo(x + w, cy + 1.5);
      ctx.moveTo(x, cy + 5.5); ctx.lineTo(x + w, cy + 5.5);
      ctx.stroke();
    }

    // 文字
    ctx.fillStyle = row.kind === 'hole' ? '#fff' : '#222';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.font = `${row.kind === 'detail' ? st.fontDetail : st.fontMain}px ${FONT}`;
    ctx.fillText(row.label, x + st.labelPad, cy + rh / 2 + 1);

    for (let ci = 0; ci < cols; ci++) {
      let txt = '';
      if (row.kind === 'hole') {
        txt = ci < 9 ? '' + (ci + 1) : ci === 9 ? 'OUT' : ci < 19 ? '' + ci : ci === 19 ? 'IN' : 'TOTAL';
        ctx.font = `bold ${st.fontHole}px ${FONT}`;
        ctx.fillStyle = '#fff';
      } else if (row.kind === 'nearpin') {
        if (ci === 9 || ci === 19 || ci === 20) {
          const holes = ci === 9 ? [1, 9] : ci === 19 ? [10, 18] : [1, 18];
          let cnt = 0;
          for (let h = holes[0]; h <= holes[1]; h++) if (d.nearpin[h]) cnt++;
          txt = ci === 20 ? cnt + '回' : cnt + '回';
        } else {
          const hi = ci < 9 ? ci : ci - 1;
          txt = d.pars[hi] === 3 ? (d.nearpin[hi + 1] ? d.nearpin[hi + 1].slice(0, 1) : 'なし') : '−';
        }
        ctx.font = `${st.fontMain}px ${FONT}`;
        ctx.fillStyle = '#555';
      } else {
        const v = cellOf(row.vals, ci);
        txt = v == null ? '' : '' + v;
        if (row.kind === 'self') { ctx.font = `bold ${st.fontSelf}px ${FONT}`; ctx.fillStyle = '#222'; }
        else if (row.kind === 'par') { ctx.font = `bold ${st.fontMain}px ${FONT}`; ctx.fillStyle = '#222'; }
        else if (row.kind === 'detail') { ctx.font = `${st.fontDetail}px ${FONT}`; ctx.fillStyle = '#555'; }
        else { ctx.font = `${st.fontMain}px ${FONT}`; ctx.fillStyle = '#222'; }
        if (ci === 9 || ci === 19 || ci === 20) ctx.font = `bold ${row.kind === 'detail' ? st.fontDetail : st.fontMain}px ${FONT}`;
      }
      if (row.kind === 'detail') {
        ctx.textAlign = 'right';
        ctx.fillText(txt, colX(ci) + colW - st.detailPad, cy + rh / 2 + 1);
      } else {
        ctx.textAlign = 'center';
        ctx.fillText(txt, colX(ci) + colW / 2, cy + rh / 2 + 1);
      }
    }
    ctx.textAlign = 'left';
    cy += rh;
  }
  return cy - y;
}

function drawLegend(ctx, x, y, w, fontPx) {
  const items = [['イーグル以下', DIFF_BG['-2']], ['バーディ', DIFF_BG['-1']], ['パー', '#ffffff'], ['ボギー', DIFF_BG['1']], ['ダボ', DIFF_BG['2']], ['トリ以上', DIFF_BG['3']]];
  ctx.font = `${fontPx}px ${FONT}`;
  const labelW = ctx.measureText('色分け: ').width;
  let total = labelW;
  const widths = items.map(([t]) => ctx.measureText(t).width + fontPx * 1.6);
  widths.forEach(v => { total += v; });
  let cx = x + w - total;
  ctx.fillStyle = '#555'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText('色分け: ', cx, y);
  cx += labelW;
  items.forEach(([t, bg], i) => {
    ctx.fillStyle = bg;
    ctx.fillRect(cx, y - fontPx * 0.42, fontPx * 1.1, fontPx * 0.84);
    ctx.strokeStyle = '#c3d2cb'; ctx.lineWidth = 1;
    ctx.strokeRect(cx, y - fontPx * 0.42, fontPx * 1.1, fontPx * 0.84);
    ctx.fillStyle = '#555';
    ctx.fillText(t, cx + fontPx * 1.3, y);
    cx += widths[i];
  });
}

function drawTomoTable(ctx, x, y, w, d, st) {
  // st: {titlePx, rowH, fontPx, notePx}
  ctx.fillStyle = '#222'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.font = `bold ${st.titlePx}px ${FONT}`;
  ctx.fillText(d.tomo ? 'トモダチ結果（ホール別ポイント）' : 'トモダチ結果', x, y + st.titlePx / 2);
  ctx.fillStyle = GREEN;
  ctx.fillRect(x, y + st.titlePx + 8, w, 3);
  const ty = y + st.titlePx + 18;
  if (!d.tomo) {
    ctx.font = `${st.notePx}px ${FONT}`;
    ctx.fillStyle = '#444';
    const txt = Object.keys(d.nearpin).length
      ? `${d.partners.length + 1}名のためポイント計算は対象外。ニアピン: ` + Object.keys(d.nearpin).sort((a, b) => a - b).map(h => `H${h} ${d.nearpin[h]}`).join('、')
      : '記録なし';
    ctx.fillText(txt, x, ty + st.notePx / 2);
    return st.titlePx + 18 + st.notePx + 8;
  }
  const junW = st.junW, nameW = st.nameW, totW = st.totW;
  const colW = (w - junW - nameW - totW) / 18;
  const rows = [{ head: true }, ...d.tomo.rows];
  let cy = ty;
  rows.forEach((r, ri) => {
    const rh = st.rowH;
    // 罫線と背景
    ctx.strokeStyle = '#c3d2cb'; ctx.lineWidth = 1.2;
    ctx.strokeRect(x, cy, w, rh);
    ctx.beginPath();
    ctx.moveTo(x + junW, cy); ctx.lineTo(x + junW, cy + rh);
    ctx.moveTo(x + junW + nameW, cy); ctx.lineTo(x + junW + nameW, cy + rh);
    for (let i = 1; i < 18; i++) { const lx = x + junW + nameW + i * colW; ctx.moveTo(lx, cy); ctx.lineTo(lx, cy + rh); }
    ctx.moveTo(x + w - totW, cy); ctx.lineTo(x + w - totW, cy + rh);
    ctx.stroke();
    ctx.font = `${st.fontPx}px ${FONT}`;
    ctx.textBaseline = 'middle';
    if (ri === 0) {
      ctx.fillStyle = '#222';
      ctx.textAlign = 'left'; ctx.fillText('順', x + 8, cy + rh / 2 + 1);
      ctx.fillText('名前', x + junW + 8, cy + rh / 2 + 1);
      ctx.textAlign = 'center'; ctx.fillStyle = '#555';
      for (let i = 0; i < 18; i++) ctx.fillText('' + (i + 1), x + junW + nameW + i * colW + colW / 2, cy + rh / 2 + 1);
      ctx.fillStyle = '#222'; ctx.fillText('合計', x + w - totW / 2, cy + rh / 2 + 1);
    } else {
      ctx.fillStyle = '#666'; ctx.textAlign = 'center';
      ctx.fillText('' + r.jun, x + junW / 2, cy + rh / 2 + 1);
      ctx.fillStyle = '#222'; ctx.textAlign = 'left';
      ctx.font = `bold ${st.fontPx}px ${FONT}`;
      ctx.fillText(r.name, x + junW + 8, cy + rh / 2 + 1);
      ctx.font = `${st.fontPx}px ${FONT}`;
      ctx.textAlign = 'center';
      r.pts.forEach((v, i) => {
        ctx.fillStyle = v > 0 ? '#0b6e2f' : v < 0 ? '#b02a2a' : '#222';
        if (v > 0) ctx.font = `bold ${st.fontPx}px ${FONT}`; else ctx.font = `${st.fontPx}px ${FONT}`;
        ctx.fillText(v === 0 ? '0' : fmtSigned(v), x + junW + nameW + i * colW + colW / 2, cy + rh / 2 + 1);
      });
      ctx.fillStyle = SHADE;
      ctx.fillRect(x + w - totW + 1, cy + 1, totW - 2, rh - 2);
      ctx.fillStyle = '#222'; ctx.font = `bold ${st.fontPx}px ${FONT}`;
      ctx.fillText(fmtSigned(r.total), x + w - totW / 2, cy + rh / 2 + 1);
    }
    cy += rh;
  });
  ctx.font = `${st.notePx}px ${FONT}`;
  ctx.fillStyle = '#444'; ctx.textAlign = 'left';
  ctx.fillText(`ニアピン: ${d.tomo.nearpinText}（順＝H1の打順。以降はホールごとにローテーション）`, x, cy + st.notePx / 2 + 8);
  return (cy - y) + st.notePx + 16;
}

/* ---------------- スコアブック（A4横 2480×1754） ---------------- */

export function drawBookPage(d) {
  const W = 2480, H = 1754, M = 80, CW = W - M * 2;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);

  // ヘッダー
  drawHeaderLine(ctx, `${d.date}　${d.courseName}`,
    `ティー: ${d.tee}　グリーン: ${d.green}　天候: ${d.weather}　風: ${d.wind}　同伴: ${d.companions.join('・') || '−'}`,
    M, W - M, 78, 54, 34, 24);
  ctx.fillStyle = GREEN; ctx.fillRect(M, 122, CW, 5);

  // グリッド
  const gridSt = { labelW: 300, labelPad: 22, detailPad: 16, holeH: 42, parH: 42, selfH: 46, detailH: 34, scoreH: 42, npH: 42, fontHole: 28, fontMain: 30, fontSelf: 34, fontDetail: 25 };
  const gridH = drawGrid(ctx, M, 146, CW, d, true, gridSt);
  drawLegend(ctx, M, 146 + gridH + 28, CW, 25);

  // ホール詳細
  const detY = 146 + gridH + 56;
  const colGap = 56;
  const colW = (CW - colGap) / 2;
  ctx.font = `bold 29px ${FONT}`; ctx.fillStyle = '#222'; ctx.textAlign = 'left';
  ctx.fillText('ホール詳細（OUT 1〜9番）', M, detY + 14);
  ctx.fillText('ホール詳細（IN 10〜18番）', M + colW + colGap, detY + 14);
  const blocksY = detY + 34;
  const availBottom = H - M - 252 - 14; // 下段（トモダチ＋レビュー）用に確保
  const drawHalf = (x0, from) => {
    // 収まり具合で段階的に圧縮する（メモ2行→1行→行間詰め）
    const plans = [
      { memoCap: 2, lh: 27, font: 21, minH: 84 },
      { memoCap: 1, lh: 27, font: 21, minH: 84 },
      { memoCap: 1, lh: 24, font: 20, minH: 80 },
    ];
    let chosen = null;
    for (const plan of plans) {
      ctx.font = `${plan.font}px ${FONT}`;
      const blocks = [];
      let total = 0;
      for (let k = 0; k < 9; k++) {
        const i = from + k;
        const shotsLines = wrapText(ctx, d.holeLines[i].shots, colW - 190).slice(0, 2);
        const memoLines = wrapText(ctx, d.holeLines[i].memo, colW - 190).slice(0, plan.memoCap);
        const bh = Math.max(plan.minH, (shotsLines.length + memoLines.length) * plan.lh + 10);
        blocks.push({ i, shotsLines, memoLines, bh });
        total += bh;
      }
      chosen = { plan, blocks };
      if (blocksY + total <= availBottom) break;
    }
    let cy = blocksY;
    const { plan, blocks } = chosen;
    for (const b of blocks) {
      const i = b.i;
      // 左ミニ列
      ctx.fillStyle = '#222'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.font = `bold 28px ${FONT}`;
      ctx.fillText('H' + (i + 1), x0, cy + 15);
      const sc = d.selfScores[i], pr = d.pars[i];
      const chipTxt = sc ? `${sc}打` : '—';
      ctx.font = `bold 24px ${FONT}`;
      const chipW = ctx.measureText(chipTxt).width + 22;
      const bg = sc ? diffBg(sc, pr) : null;
      if (bg) { ctx.fillStyle = bg; rr(ctx, x0 + 62, cy + 1, chipW, 29, 5); ctx.fill(); }
      ctx.fillStyle = '#222';
      ctx.fillText(chipTxt, x0 + 73, cy + 17);
      ctx.font = `20px ${FONT}`; ctx.fillStyle = '#666';
      ctx.fillText(`${d.selfPutts[i] != null ? d.selfPutts[i] : '−'}パット`, x0, cy + 45);
      ctx.fillText(`Par${pr || '−'} ${d.yards[i] || '−'}y`, x0, cy + 69);
      // 右テキスト
      let ty = cy + 14;
      ctx.font = `${plan.font}px ${FONT}`;
      b.shotsLines.forEach(ln => { ctx.fillStyle = '#222'; ctx.fillText(ln, x0 + 178, ty); ty += plan.lh; });
      b.memoLines.forEach(ln => { ctx.fillStyle = '#555'; ctx.fillText(ln, x0 + 178, ty); ty += plan.lh; });
      cy += b.bh;
    }
    return cy;
  };
  drawHalf(M, 0);
  drawHalf(M + colW + colGap, 9);

  // 下段: トモダチ（左）＋結果レビュー（右）
  const botY = H - M - 252;
  const tomoW = 1420, revX = M + tomoW + 48, revW = CW - tomoW - 48;
  ctx.strokeStyle = '#c3d2cb'; ctx.lineWidth = 1.6;
  ctx.strokeRect(M, botY, tomoW, 236);
  drawTomoTable(ctx, M + 22, botY + 16, tomoW - 44, d,
    { titlePx: 27, rowH: 34, fontPx: 21, notePx: 21, junW: 52, nameW: 168, totW: 76 });
  ctx.strokeRect(revX, botY, revW, 236);
  ctx.fillStyle = '#222'; ctx.font = `bold 27px ${FONT}`; ctx.textAlign = 'left';
  ctx.fillText('結果レビュー', revX + 22, botY + 30);
  ctx.fillStyle = GREEN; ctx.fillRect(revX + 22, botY + 52, revW - 44, 3);
  ctx.font = `24px ${FONT}`; ctx.fillStyle = '#222';
  d.review.forEach((ln, i) => { if (ln) ctx.fillText(ln, revX + 22, botY + 88 + i * 40); });

  ctx.font = `21px ${FONT}`; ctx.fillStyle = '#999'; ctx.textAlign = 'right';
  ctx.fillText('MyGolf スコアブック', W - M, H - 34);
  return cv;
}

/* ---------------- 共有用画像（1600px幅） ---------------- */

export function drawShareImage(d) {
  const W = 1600, M = 38, CW = W - M * 2;
  const gridSt = { labelW: 132, labelPad: 10, detailPad: 8, holeH: 50, parH: 50, selfH: 54, detailH: 40, scoreH: 50, npH: 50, fontHole: 19, fontMain: 20, fontSelf: 22, fontDetail: 16 };
  const gridRowsH = gridSt.holeH + gridSt.parH + gridSt.selfH + d.partners.length * gridSt.scoreH + gridSt.npH;
  const tomoH = d.tomo
    ? 16 + 30 + 18 + (1 + d.tomo.rows.length) * 42 + 24 + 16 + 32
    : (Object.keys(d.nearpin).length ? 16 + 30 + 18 + 24 + 16 : 0);
  const H = 34 + 66 + 14 + gridRowsH + 44 + (tomoH ? tomoH + 18 : 0) + 34 + 24;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);

  drawHeaderLine(ctx, `${d.date}　${d.courseName}`,
    `ティー: ${d.tee}　グリーン: ${d.green}　天候: ${d.weather}　同伴: ${d.companions.join('・') || '−'}`,
    M, W - M, 62, 28, 17, 13);
  ctx.fillStyle = GREEN; ctx.fillRect(M, 96, CW, 3);

  const gridH = drawGrid(ctx, M, 112, CW, d, false, gridSt);
  drawLegend(ctx, M, 112 + gridH + 24, CW, 15);

  if (tomoH) {
    const ty = 112 + gridH + 44;
    ctx.strokeStyle = '#c3d2cb'; ctx.lineWidth = 1.4;
    ctx.strokeRect(M, ty, CW, tomoH);
    drawTomoTable(ctx, M + 18, ty + 14, CW - 36, d,
      { titlePx: 21, rowH: 42, fontPx: 17, notePx: 16, junW: 46, nameW: 118, totW: 66 });
  }
  ctx.font = `14px ${FONT}`; ctx.fillStyle = '#999'; ctx.textAlign = 'right';
  ctx.fillText('MyGolf', W - M, H - 20);
  return cv;
}

/* ---------------- 生成フロー ---------------- */

function bytesToBase64(bytes) {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function canvasToBytes(cv, type, quality) {
  return new Promise((resolve, reject) => {
    cv.toBlob(async blob => {
      if (!blob) return reject(new Error('画像変換に失敗しました'));
      try { resolve(new Uint8Array(await blob.arrayBuffer())); }
      catch (e) { reject(e); }
    }, type, quality);
  });
}

// 確定保存の成功後に呼ぶ。api = {fetchScoreBook, saveScorebookPdf, saveShareImage}（sync.js）
// onStatus(text) で進捗を通知。戻り値 {bookUrl, shareUrl, errors[]}
export async function generateArtifacts(record, tomo, api, onStatus) {
  const data = buildBookData(record, tomo);
  const out = { bookUrl: null, shareUrl: null, errors: [], warnings: [] };
  const status = t => { if (onStatus) onStatus(t); };

  // 共有用画像
  try {
    status('共有用画像を作成中…');
    const pngBytes = await canvasToBytes(drawShareImage(data), 'image/png');
    const res = await api.saveShareImage({
      pngBase64: bytesToBase64(pngBytes),
      fileName: `共有スコアカード_${data.date}_${data.courseName}.png`,
    });
    out.shareUrl = res.url || null;
  } catch (e) {
    out.errors.push('共有用画像: ' + (e.message || e));
  }

  // スコアブック
  try {
    if (typeof window === 'undefined' || !window.PDFLib) throw new Error('PDF結合ライブラリ(pdf-lib)が未読込です');
    status('スコアブックを作成中…');
    const jpgBytes = await canvasToBytes(drawBookPage(data), 'image/jpeg', 0.92);
    const { PDFDocument } = window.PDFLib;
    const pageDoc = await PDFDocument.create();
    const page = pageDoc.addPage([841.89, 595.28]); // A4横 (pt)
    const img = await pageDoc.embedJpg(jpgBytes);
    page.drawImage(img, { x: 0, y: 0, width: 841.89, height: 595.28 });
    const pageBytes = await pageDoc.save();

    status('スコアブックを取得中…');
    const existing = await api.fetchScoreBook();
    let mergedBytes = pageBytes;
    let existingFileId = null;
    if (existing && existing.exists && existing.pdfBase64) {
      try {
        status('スコアブックに結合中…');
        const bookDoc = await PDFDocument.load(base64ToBytes(existing.pdfBase64));
        const newDoc = await PDFDocument.load(pageBytes);
        const [copied] = await bookDoc.copyPages(newDoc, [0]);
        bookDoc.insertPage(0, copied);
        mergedBytes = await bookDoc.save();
        existingFileId = existing.fileId || null;
        out.bookUrl = existing.url || null; // 保存失敗時のフォールバック表示用
      } catch (parseErr) {
        // v0.7.8: 既存ブックが壊れていて読めない場合は、行き詰まらず新規作成として続行する
        // （保存時に同名ファイルへ上書きされるので自己修復する）
        out.warnings.push('既存のスコアブックが読めなかったため、新規に作り直しました');
        mergedBytes = pageBytes;
        existingFileId = null;
      }
    }
    status('スコアブックを保存中…');
    const saved = await api.saveScorebookPdf({
      mergedPdfBase64: bytesToBase64(mergedBytes),
      existingFileId,
      fileName: 'MyGolfスコアブック.pdf',
    });
    out.bookUrl = saved.pdfUrl || out.bookUrl;
  } catch (e) {
    out.errors.push('スコアブック: ' + (e.message || e));
  }
  return out;
}
