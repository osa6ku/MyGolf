// トモダチゲーム：打順シャッフル／手動設定、ニアピン・ドラコンの記録。
// ポイント計算は後処理・将来拡張（要件：ゲーム設定は打順まわりが必須）。

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
    order: [...playerNames], // 打順（手動設定 or シャッフル結果）
    nearpin: {},             // {"H18": "名前"}
    dragon: {},              // {"H9": "名前"}
  };
}
