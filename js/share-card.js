// ── Share Card Generator ──────────────────────────────────────────────
// Draws a result card on Canvas and shares via Web Share API or TG

export async function generateShareCard({ title, score, correct, total, pct, icon }) {
  const W = 800, H = 480;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  // Background gradient
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#0d0d1a');
  bg.addColorStop(1, '#12082a');
  ctx.fillStyle = bg;
  ctx.roundRect(0, 0, W, H, 28);
  ctx.fill();

  // Glow circle behind icon
  const glow = ctx.createRadialGradient(W/2, 140, 0, W/2, 140, 120);
  glow.addColorStop(0, 'rgba(108,99,255,0.35)');
  glow.addColorStop(1, 'rgba(108,99,255,0)');
  ctx.fillStyle = glow;
  ctx.beginPath(); ctx.arc(W/2, 140, 120, 0, Math.PI*2); ctx.fill();

  // Icon
  ctx.font = '72px serif';
  ctx.textAlign = 'center';
  ctx.fillText(icon, W/2, 100);

  // Title
  ctx.font = 'bold 28px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(title, W/2, 148);

  // Score pill
  const pillW = 220, pillH = 60, pillX = W/2 - pillW/2, pillY = 168;
  ctx.fillStyle = 'rgba(108,99,255,0.25)';
  ctx.strokeStyle = 'rgba(108,99,255,0.6)';
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.roundRect(pillX, pillY, pillW, pillH, 16); ctx.fill(); ctx.stroke();
  ctx.font = 'bold 36px system-ui, sans-serif';
  ctx.fillStyle = '#a78bfa';
  ctx.fillText(`⚡ ${score}`, W/2, pillY + 42);

  // Stats row
  const stats = [
    { label: 'Правильных', value: `${correct} / ${total}` },
    { label: 'Точность', value: `${pct}%` },
  ];
  stats.forEach((s, i) => {
    const x = W/4 + i * W/2;
    ctx.font = 'bold 30px system-ui, sans-serif';
    ctx.fillStyle = pct >= 80 ? '#4ade80' : pct >= 50 ? '#facc15' : '#f87171';
    ctx.fillText(s.value, x, 295);
    ctx.font = '16px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillText(s.label, x, 318);
  });

  // Divider
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(60, 340); ctx.lineTo(W-60, 340); ctx.stroke();

  // Stars row
  const stars = pct >= 80 ? '★★★' : pct >= 50 ? '★★☆' : '★☆☆';
  ctx.font = '32px serif';
  ctx.fillStyle = '#facc15';
  ctx.fillText(stars, W/2, 388);

  // CTA
  ctx.font = 'bold 17px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillText('Попробуй сам →  brain-fight-club.vercel.app', W/2, 438);

  // BFC badge top-right
  ctx.font = 'bold 13px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(108,99,255,0.8)';
  ctx.textAlign = 'right';
  ctx.fillText('🧠 BRAIN FIGHT CLUB', W - 24, 36);

  return canvas;
}

export async function sharePackResult({ title, score, correct, total, pct }) {
  const icon = pct >= 80 ? '🏆' : pct >= 50 ? '🎯' : '📚';
  const canvas = await generateShareCard({ title, score, correct, total, pct, icon });

  const text = `${icon} «${title}»\n✅ ${correct}/${total} · ⚡${score} · ${pct}%\n\n🧠 brain-fight-club.vercel.app`;

  // Try native share with image
  try {
    const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
    const file = new File([blob], 'bfc-result.png', { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], text });
      return;
    }
  } catch(_) {}

  // Fallback: show card in modal + share options
  showShareModal(canvas, text);
}

function showShareModal(canvas, text) {
  const existing = document.getElementById('share-card-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'share-card-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:500;background:rgba(0,0,0,.85);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;gap:14px';

  const img = document.createElement('img');
  img.src = canvas.toDataURL('image/png');
  img.style.cssText = 'max-width:100%;border-radius:16px;box-shadow:0 8px 40px rgba(0,0,0,.6)';

  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:10px;width:100%;max-width:400px';

  const tgBtn = document.createElement('button');
  tgBtn.className = 'big-btn';
  tgBtn.style.cssText = 'flex:1;padding:13px;background:rgba(44,165,224,.25);border-color:rgba(44,165,224,.5)';
  tgBtn.innerHTML = '✈️ Telegram';
  tgBtn.onclick = () => {
    const encoded = encodeURIComponent(text);
    window.open(`https://t.me/share/url?url=brain-fight-club.vercel.app&text=${encoded}`, '_blank');
  };

  const copyBtn = document.createElement('button');
  copyBtn.className = 'score-sec-btn';
  copyBtn.style.cssText = 'flex:1;padding:13px';
  copyBtn.textContent = '📋 Копировать';
  copyBtn.onclick = () => {
    navigator.clipboard?.writeText(text).then(() => { copyBtn.textContent = '✓ Скопировано'; });
  };

  const closeBtn = document.createElement('button');
  closeBtn.style.cssText = 'background:none;border:none;color:rgba(255,255,255,.4);font-size:24px;cursor:pointer;position:absolute;top:16px;right:16px';
  closeBtn.textContent = '×';
  closeBtn.onclick = () => modal.remove();

  btnRow.append(tgBtn, copyBtn);
  modal.append(img, btnRow, closeBtn);
  document.body.appendChild(modal);
}

window.sharePackResult = sharePackResult;
