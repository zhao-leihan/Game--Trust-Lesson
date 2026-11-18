const socket = io();

const SHAPES = ['▲', '◆', '●', '■'];
const LETTERS = ['A', 'B', 'C', 'D'];

const els = {
  topPin: document.getElementById('topPin'),
  lobbyPin: document.getElementById('lobbyPin'),
  qrImage: document.getElementById('qrImage'),
  joinUrlText: document.getElementById('joinUrlText'),
  playerCountBadge: document.getElementById('playerCountBadge'),
  playerChips: document.getElementById('playerChips'),
  lobbyView: document.getElementById('lobbyView'),
  questionView: document.getElementById('questionView'),
  leaderboardView: document.getElementById('leaderboardView'),
  qCounter: document.getElementById('qCounter'),
  qDiffBadge: document.getElementById('qDiffBadge'),
  qCatBadge: document.getElementById('qCatBadge'),
  answeredPill: document.getElementById('answeredPill'),
  timerCircle: document.getElementById('timerCircle'),
  timerBar: document.getElementById('timerBar'),
  qText: document.getElementById('qText'),
  qMascot: document.getElementById('qMascot'),
  optionsGrid: document.getElementById('optionsGrid'),
  lbMascot: document.getElementById('lbMascot'),
  lbTitle: document.getElementById('lbTitle'),
  lbSubtitle: document.getElementById('lbSubtitle'),
  ticketSummaryBadge: document.getElementById('ticketSummaryBadge'),
  lbList: document.getElementById('lbList'),
  dockPrimaryBtn: document.getElementById('dockPrimaryBtn'),
  dockResetBtn: document.getElementById('dockResetBtn'),
  muteBtn: document.getElementById('muteBtn'),
};

let isMuted = false;
let lastState = null;
let audioCtx = null;

function ensureAudio() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) audioCtx = new Ctx();
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
}

function playTone(freq, duration = 0.12, type = 'sine', vol = 0.12) {
  if (isMuted) return;
  ensureAudio();
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(vol, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + duration);
}

function playRevealSound() {
  playTone(523.25, 0.14, 'triangle', 0.15);
  setTimeout(() => playTone(659.25, 0.18, 'triangle', 0.15), 110);
}

function playFinishSound() {
  [523.25, 659.25, 783.99, 1046.5].forEach((f, idx) => {
    setTimeout(() => playTone(f, 0.22, 'triangle', 0.16), idx * 120);
  });
}

els.muteBtn.addEventListener('click', () => {
  isMuted = !isMuted;
  els.muteBtn.textContent = isMuted ? '🔇 Muted' : '🔊 Sound On';
  if (!isMuted) ensureAudio();
});

async function refreshJoinInfo() {
  try {
    const res = await fetch('/api/info');
    const data = await res.json();
    els.topPin.textContent = data.pin;
    els.lobbyPin.textContent = data.pin;
    els.qrImage.src = data.qrDataUrl;
    els.joinUrlText.textContent = data.joinUrl;
  } catch (e) {
    console.error('Failed to fetch info', e);
  }
}

function showView(viewName) {
  els.lobbyView.classList.toggle('hidden', viewName !== 'LOBBY');
  els.questionView.classList.toggle('hidden', viewName !== 'QUESTION' && viewName !== 'REVEAL');
  els.leaderboardView.classList.toggle('hidden', viewName !== 'LEADERBOARD' && viewName !== 'FINISHED');
}

function updateDockButton(state) {
  if (state === 'LOBBY') {
    els.dockPrimaryBtn.textContent = '▶ Mulai Quiz';
    els.dockPrimaryBtn.disabled = false;
    els.dockPrimaryBtn.classList.remove('hidden');
  } else if (state === 'QUESTION' || state === 'REVEAL') {
    els.dockPrimaryBtn.classList.add('hidden');
  } else if (state === 'FINISHED') {
    els.dockPrimaryBtn.textContent = '🎉 Selesai';
    els.dockPrimaryBtn.disabled = true;
    els.dockPrimaryBtn.classList.remove('hidden');
  }
}

function renderLobby(data) {
  showView('LOBBY');
  els.topPin.textContent = data.pin;
  els.lobbyPin.textContent = data.pin;
  els.playerCountBadge.textContent = `${data.leaderboard.length} Pemain`;

  if (data.leaderboard.length === 0) {
    els.playerChips.innerHTML = '<div class="empty-lobby">Belum ada peserta yang masuk. Scan QR di sebelah kiri!</div>';
    return;
  }

  els.playerChips.innerHTML = data.leaderboard
    .map(
      (p) => `
      <div class="player-chip">
        <span class="player-dot" style="background:${p.connected ? '#10b981' : '#64748b'}"></span>
        <span>${escapeHtml(p.name)}</span>
      </div>`
    )
    .join('');
}

function renderQuestion(data) {
  showView(data.state);
  const q = data.question;
  if (!q) return;

  els.qCounter.textContent = `Soal ${data.currentIndex + 1} / ${data.totalQuestions}`;
  els.qCatBadge.textContent = q.category;

  els.qDiffBadge.className = 'badge';
  if (q.difficulty === 'easy') {
    els.qDiffBadge.classList.add('badge-easy');
    els.qDiffBadge.textContent = 'EASY';
  } else if (q.difficulty === 'medium') {
    els.qDiffBadge.classList.add('badge-medium');
    els.qDiffBadge.textContent = 'MEDIUM';
  } else {
    els.qDiffBadge.classList.add('badge-ultimate');
    els.qDiffBadge.textContent = '⚡ ULTIMATE';
  }

  els.answeredPill.textContent = `${data.answeredCount} / ${data.totalPlayers} Dijawab`;
  els.qText.textContent = q.question;

  if (data.state === 'QUESTION') {
    els.qMascot.src = '/assets/mascot/knowledge.webp';
    updateTimerUI(data.timeLeft, data.timeLimit);
  } else {
    els.qMascot.src = '/assets/mascot/happy.webp';
    updateTimerUI(0, data.timeLimit);
  }

  els.optionsGrid.innerHTML = q.options
    .map((opt, idx) => {
      let extraClass = '';
      let statHtml = '';
      if (data.state === 'REVEAL') {
        const count = data.distribution ? data.distribution[idx] : 0;
        const isCorrect = idx === q.answer;
        extraClass = isCorrect ? 'correct-highlight' : 'dimmed';
        statHtml = `<span class="opt-stat">${isCorrect ? '✓ ' : ''}${count}</span>`;
      }
      return `
        <div class="opt-card opt-${idx} ${extraClass}">
          <div class="opt-shape">${SHAPES[idx]}</div>
          <div class="opt-label">${LETTERS[idx]}. ${escapeHtml(opt)}</div>
          ${statHtml}
        </div>
      `;
    })
    .join('');
}

function renderLeaderboard(data) {
  showView(data.state);
  const isFinished = data.state === 'FINISHED';
  els.lbMascot.src = isFinished ? '/assets/mascot/Done.webp' : '/assets/mascot/happy.webp';
  els.lbTitle.textContent = isFinished ? '🏆 Hasil Akhir & Peraih Ticket!' : `Leaderboard — Setelah Soal ${data.currentIndex + 1} / ${data.totalQuestions}`;

  const ticketWinners = data.leaderboard.filter((p) => p.hasTicket).length;
  els.ticketSummaryBadge.textContent = `🎟️ ${ticketWinners} Peraih Ticket (15+ Benar)`;

  if (data.leaderboard.length === 0) {
    els.lbList.innerHTML = '<div class="empty-lobby">Belum ada skor.</div>';
    return;
  }

  els.lbList.innerHTML = data.leaderboard
    .slice(0, 15)
    .map((p, idx) => {
      const rank = idx + 1;
      const topClass = rank <= 3 ? `top-${rank}` : '';
      const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`;
      const ticketHtml = p.hasTicket
        ? `<span class="ticket-badge">🎟️ TICKET</span>`
        : `<span style="color:var(--text-muted);font-size:0.82rem;">${p.correctCount}/${data.ticketThreshold}</span>`;

      return `
        <div class="lb-row ${topClass}">
          <div class="lb-rank">${medal}</div>
          <div class="lb-name">${escapeHtml(p.name)}</div>
          <div>${ticketHtml}</div>
          <div class="lb-correct">${p.correctCount} / ${data.totalQuestions} Benar</div>
          <div class="lb-score">${p.score.toLocaleString()}</div>
        </div>
      `;
    })
    .join('');
}

function updateTimerUI(timeLeft, timeLimit) {
  els.timerCircle.textContent = timeLeft;
  els.timerCircle.classList.toggle('urgent', timeLeft <= 5 && timeLeft > 0);
  const pct = timeLimit > 0 ? Math.max(0, Math.min(100, (timeLeft / timeLimit) * 100)) : 0;
  els.timerBar.style.width = `${pct}%`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Socket Listeners
socket.on('connect', () => {
  socket.emit('host:join');
  refreshJoinInfo();
});

socket.on('host:state', (data) => {
  if (lastState && lastState !== data.state) {
    if (data.state === 'REVEAL') playRevealSound();
    if (data.state === 'FINISHED') playFinishSound();
    if (data.state === 'LOBBY') refreshJoinInfo();
  }
  lastState = data.state;
  updateDockButton(data.state);

  if (data.state === 'LOBBY') {
    renderLobby(data);
  } else if (data.state === 'QUESTION' || data.state === 'REVEAL') {
    renderQuestion(data);
  } else if (data.state === 'LEADERBOARD' || data.state === 'FINISHED') {
    renderLeaderboard(data);
  }
});

socket.on('host:tick', ({ timeLeft, timeLimit }) => {
  updateTimerUI(timeLeft, timeLimit);
  if (timeLeft <= 5 && timeLeft > 0) {
    playTone(880, 0.06, 'sine', 0.08);
  }
});

// Dock Controls
els.dockPrimaryBtn.addEventListener('click', () => {
  ensureAudio();
  socket.emit('controller:action', { action: 'next' }, (res) => {
    if (res && !res.ok && res.error) {
      alert(res.error);
    }
  });
});

els.dockResetBtn.addEventListener('click', () => {
  if (confirm('Reset game dan buat PIN baru? Semua skor saat ini akan dihapus.')) {
    socket.emit('controller:action', { action: 'reset' });
  }
});
