// トモダチゲーム：打順シャッフル／手動設定と、ポイント計算。
// 計算ルールは MyScore の updateTomodachiCalculation をそのまま移植（2026-11-15 確認）:
// - 4人のときだけ計算する（オプションなし）
// - H1の打順は設定時の打順。H2以降は前ホールまでのスコアが少ない順（タイはさらに前→H1打順）
// - 組分けは打順の 1位&4位 = A組、2位&3位 = B組
// - 対象ポイント = Par + 持越。勝敗はベストボール→ワーストボールで判定し、引き分けは次ホールへ持越（H18の引き分けは消滅）
// - 勝ち組の2人に +対象pt、負け組の2人に −対象pt
// - Par3 でニアピン記録があるホールは、ニアピン獲得者 +9pt、他3人 −3pt

export function shuffleOrder(names) {
  const arr = [...names];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function newGame(playerNames) {
  return {
    type: 'tomodachi',
    order: [...playerNames], // H1の打順（手動設定 or シャッフル結果）
    nearpin: {},             // {"H3": "名前"} Par3のみ
    dragon: {},              // {"H9": "名前"}（ポイント計算には使わない記録のみ）
  };
}

// 計算用のプレイヤー並び（0=本人、1..3=同伴者）
export function playerList(s) {
  return [
    { name: '桑木修', scores: s.scores },
    ...s.partners.map(p => ({ name: p.name, scores: p.scores })),
  ];
}

// 4人でなければ null。戻り値: { players:[名前x4], perHole:[{hole, order, teamA, teamB, bet, carryIn, winner, pts, complete}], totals:[pt x4] }
export function calcTomodachi(s) {
  const players = playerList(s);
  if (players.length !== 4) return null;
  const orderNames = (s.game && s.game.order) || s.order || players.map(p => p.name);
  const initialIdx = orderNames.map(n => players.findIndex(p => p.name === n)).filter(i => i >= 0);
  if (initialIdx.length !== 4) return null;

  const holeOrder = (h) => {
    if (h === 0) return [...initialIdx];
    const idx = [0, 1, 2, 3];
    idx.sort((a, b) => {
      for (let back = h - 1; back >= 0; back--) {
        const sa = Number(players[a].scores[back]) || 0;
        const sb = Number(players[b].scores[back]) || 0;
        if (sa > 0 && sb > 0) { if (sa !== sb) return sa - sb; }
        else if (sa > 0 && sb === 0) return -1;
        else if (sa === 0 && sb > 0) return 1;
      }
      return initialIdx.indexOf(a) - initialIdx.indexOf(b);
    });
    return idx;
  };

  let carry = 0;
  const perHole = [];
  const totals = [0, 0, 0, 0];
  for (let h = 0; h < 18; h++) {
    const par = s.pars[h] || 4;
    const carryIn = carry;
    const bet = par + carryIn;
    const order = holeOrder(h);
    const teamA = [order[0], order[3]];
    const teamB = [order[1], order[2]];
    const sc = i => Number(players[i].scores[h]) || 0;
    const complete = [0, 1, 2, 3].every(i => sc(i) > 0);
    let winner = null;
    const pts = [0, 0, 0, 0];
    if (complete) {
      const bestA = Math.min(sc(teamA[0]), sc(teamA[1]));
      const worstA = Math.max(sc(teamA[0]), sc(teamA[1]));
      const bestB = Math.min(sc(teamB[0]), sc(teamB[1]));
      const worstB = Math.max(sc(teamB[0]), sc(teamB[1]));
      let win = null;
      if (bestA < bestB) win = 'A';
      else if (bestB < bestA) win = 'B';
      else if (worstA < worstB) win = 'A';
      else if (worstB < worstA) win = 'B';
      if (win === 'A') { winner = 'A'; teamA.forEach(i => { pts[i] += bet; }); teamB.forEach(i => { pts[i] -= bet; }); carry = 0; }
      else if (win === 'B') { winner = 'B'; teamB.forEach(i => { pts[i] += bet; }); teamA.forEach(i => { pts[i] -= bet; }); carry = 0; }
      else { winner = 'TIE'; carry = (h === 17) ? 0 : bet; }
      if (par === 3 && s.game && s.game.nearpin) {
        const wname = s.game.nearpin['H' + (h + 1)];
        if (wname) {
          for (let i = 0; i < 4; i++) pts[i] += (players[i].name === wname ? 9 : -3);
        }
      }
      for (let i = 0; i < 4; i++) totals[i] += pts[i];
    }
    perHole.push({ hole: h + 1, order, teamA, teamB, bet, carryIn, winner, pts, complete });
  }
  return { players: players.map(p => p.name), perHole, totals };
}

// 現在ホールのステータステキスト（MyScore の表示文言に合わせる）
export function tomodachiHoleText(res, holeIdx) {
  if (!res) return '';
  const r = res.perHole[holeIdx];
  if (!r) return '';
  if (r.complete) {
    if (r.winner === 'TIE') {
      return holeIdx === 17 ? '結果: 引き分け (持越消滅)' : `結果: 引き分け (次へ+${r.bet}pt持越)`;
    }
    return `結果: ${r.winner}組勝利！ (+${r.bet}pt)`;
  }
  return r.carryIn > 0 ? `対象: ${r.bet}pt (持越+${r.carryIn}pt)` : `対象: ${r.bet}pt`;
}
