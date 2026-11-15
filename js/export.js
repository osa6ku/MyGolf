// 進行中ラウンドの JSON 書き出し・共有
export function exportRoundJson(state) {
  const json = JSON.stringify(state, null, 2);
  const filename = `${state.round_id || 'mygolf-round'}.json`;
  if (navigator.share) {
    const file = new File([json], filename, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      return navigator.share({ files: [file], title: filename });
    }
  }
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return Promise.resolve();
}
