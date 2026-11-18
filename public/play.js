const socket = io();
const SHAPES = ['▲', '◆', '●', '■'];
const LETTERS = ['A', 'B', 'C', 'D'];

const els = {
  joinScreen: document.getElementById('joinScreen'),
  gameShell: document.getElementById('gameShell'),
  pinInput: document.getElementById('pinInput'),
  nameInput: document.getElementById('nameInput'),
  joinBtn: document.getElementById('joinBtn'),
  joinError: document.getElementById('joinError'),
  hudName: document.getElementById('hudName'),
  hudProgress: document.getElementById('hudProgress'),
  hudScore: document.getElementById('hudScore'),
  hudCorrect: document.getElementById('hudCorrect'),
  pLobby: document.getElementById('pLobby'),
  pQuestion: document.getElementById('pQuestion'),
  pDiffBadge: document.getElementById('pDiffBadge'),
  pCatBadge: document.getElementById('pCatBadge'),
  pQuestionText: document.getElementById('pQuestionText'),
  pOptionsGrid: document.getElementById('pOptionsGrid'),
  pWait: document.getElementById('pWait'),
  pResult: document.getElementById('pResult'),
  pResultMascot: document.getElementById('pResultMascot'),
  pResultBanner: document.getElementById('pResultBanner'),
  pRankInfo: document.getElementById('pRankInfo'),
  pTicketProgress: document.getElementById('pTicketProgress'),
  pFinished: document.getElementById('pFinished'),
  pFinalStats: document.getElementById('pFinalStats'),
  pTicketBox: document.getElementById('pTicketBox'),
};

// Pre-fill PIN from QR code query param
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get('pin')) {
  els.pinInput.value = urlParams.get('pin');
}

function showSubView(id) {
  ['pLobby', 'pQuestion', 'pWait', 'pResult', 'pFinished'].forEach((k) => {
    els[k].classList.toggle('hidden', k !== id);
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderPlayerState(data) {
  els.joinScreen.classList.add('hidden');
  els.gameShell.classList.remove('hidden');

  const p = data.player;
  els.hudName.textContent = p.name;
  els.hudScore.textContent = `${p.score.toLocaleString()} pts`;
  els.hudCorrect.textContent = `${p.correctCount} Benar ${p.hasTicket ? '🎟️' : ''}`;

  if (data.state === 'LOBBY') {
    els.hudProgress.textContent = `Lobby · Target ${data.ticketThreshold}/${data.totalQuestions} 🎟️`;
    showSubView('pLobby');
    return;
  }

  els.hudProgress.textContent = `Soal ${data.currentIndex + 1} / ${data.totalQuestions}`;

  if (data.state === 'QUESTION') {
    if (data.answered) {
      showSubView('pWait');
      return;
    }
    showSubView('pQuestion');
    const q = data.question;
    els.pDiffBadge.className = `badge badge-${q.difficulty}`;
    els.pDiffBadge.textContent = q.difficulty === 'ultimate' ? '⚡ ULTIMATE' : q.difficulty.toUpperCase();
    els.pCatBadge.textContent = q.category;
    els.pQuestionText.textContent = q.question;

    els.pOptionsGrid.innerHTML = q.options
      .map(
        (opt, idx) => `
        <button class="p-opt-btn p-opt-${idx}" onclick="submitAnswer(${idx})">
          <span class="p-shape">${SHAPES[idx]}</span>
          <span>${LETTERS[idx]}. ${escapeHtml(opt)}</span>
        </button>`
      )
      .join('');
    return;
  }

  if (data.state === 'REVEAL' || data.state === 'LEADERBOARD') {
    showSubView('pResult');
    const res = data.lastResult;
    if (res && res.isCorrect) {
      els.pResultMascot.src = '/assets/mascot/happy.webp';
      els.pResultBanner.className = 'result-banner res-correct';
      els.pResultBanner.textContent = `BENAR! +${res.pointsEarned} pts`;
    } else {
      els.pResultMascot.src = '/assets/mascot/knowledge.webp';
      els.pResultBanner.className = 'result-banner res-wrong';
      els.pResultBanner.textContent = res?.timedOut ? 'WAKTU HABIS!' : 'KURANG TEPAT!';
    }
    els.pRankInfo.textContent = `Peringkat #${p.rank} · Streak 🔥 ${p.streak}`;
    if (p.hasTicket) {
      els.pTicketProgress.innerHTML = `<span class="ticket-badge">🎟️ TICKET UNLOCKED! (${p.correctCount}/${data.totalQuestions} Benar)</span>`;
    } else {
      const need = data.ticketThreshold - p.correctCount;
      els.pTicketProgress.textContent = `${p.correctCount} / ${data.ticketThreshold} benar (Butuh ${need} lagi untuk Ticket 🎟️)`;
    }
    return;
  }

  if (data.state === 'FINISHED') {
    showSubView('pFinished');
    els.pFinalStats.textContent = `Peringkat #${p.rank} · ${p.score.toLocaleString()} pts · ${p.correctCount}/${data.totalQuestions} Benar`;
    if (p.hasTicket) {
      els.pTicketBox.innerHTML = `
        <div class="ticket-voucher">
          <div style="font-size:2.2rem;margin-bottom:6px;">🎟️</div>
          <div style="font-size:1.25rem;font-weight:900;color:#6d28d9;">TICKET UNLOCKED!</div>
          <div style="margin-top:6px;font-weight:700;">Selamat ${escapeHtml(p.name)}!</div>
          <div style="font-size:0.88rem;color:var(--text-muted);margin-top:4px;">
            Tunjukkan layar ini ke panitia untuk klaim Ticket kamu.
          </div>
        </div>`;
    } else {
      els.pTicketBox.innerHTML = `
        <div style="color:var(--text-muted);line-height:1.5;">
          Kamu menjawab benar <strong>${p.correctCount}</strong> dari ${data.totalQuestions} soal.<br/>
          Butuh minimal <strong>${data.ticketThreshold} benar</strong> untuk mendapat Ticket. Coba lagi di sesi berikutnya!
        </div>`;
    }
  }
}

window.submitAnswer = function (optionIndex) {
  // Disable buttons immediately to prevent double tap
  const btns = els.pOptionsGrid.querySelectorAll('button');
  btns.forEach((b) => (b.disabled = true));
  socket.emit('player:answer', { optionIndex }, (res) => {
    if (res && res.ok && res.state) {
      renderPlayerState(res.state);
    }
  });
};

function attemptJoin() {
  els.joinError.textContent = '';
  const pin = els.pinInput.value.trim();
  const name = els.nameInput.value.trim();
  const savedId = localStorage.getItem('tq_playerId');

  socket.emit('player:join', { pin, name, playerId: savedId }, (res) => {
    if (!res || !res.ok) {
      els.joinError.textContent = res?.error || 'Gagal bergabung.';
      return;
    }
    localStorage.setItem('tq_playerId', res.state.player.id);
    localStorage.setItem('tq_pin', res.state.pin);
    renderPlayerState(res.state);
  });
}

els.joinBtn.addEventListener('click', attemptJoin);
els.nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') attemptJoin();
});

socket.on('connect', () => {
  const savedId = localStorage.getItem('tq_playerId');
  const savedPin = localStorage.getItem('tq_pin');
  if (savedId && savedPin) {
    socket.emit('player:reconnect', { playerId: savedId, pin: savedPin }, (res) => {
      if (res && res.ok && res.state) {
        renderPlayerState(res.state);
      }
    });
  }
});

socket.on('player:state', renderPlayerState);

socket.on('player:kicked', () => {
  localStorage.removeItem('tq_playerId');
  localStorage.removeItem('tq_pin');
  alert('Kamu dikeluarkan oleh Host.');
  window.location.reload();
});

socket.on('game:reset', () => {
  localStorage.removeItem('tq_playerId');
  localStorage.removeItem('tq_pin');
  window.location.href = '/play';
});
