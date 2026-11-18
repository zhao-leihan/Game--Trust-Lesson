const express = require('express');
const http = require('http');
const os = require('os');
const path = require('path');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const QUESTIONS = require('./data/questions');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Serve static assets
app.use(express.static(path.join(__dirname, 'public')));
app.use('/assets/logo', express.static(path.join(__dirname, 'Logo')));
app.use('/assets/mascot', express.static(path.join(__dirname, 'Mascot')));

// Page routes
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/host', (req, res) => res.sendFile(path.join(__dirname, 'public', 'host.html')));
app.get('/play', (req, res) => res.sendFile(path.join(__dirname, 'public', 'play.html')));

// Helpers
function getLocalIPs() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push(iface.address);
      }
    }
  }
  return ips;
}

function shuffle(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function generatePin() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function prepareQuestionWithShuffledOptions(q) {
  const indexed = q.options.map((text, idx) => ({ text, isCorrect: idx === q.answer }));
  const shuffled = shuffle(indexed);
  return {
    id: q.id,
    difficulty: q.difficulty,
    category: q.category,
    question: q.question,
    options: shuffled.map((o) => o.text),
    answer: shuffled.findIndex((o) => o.isCorrect),
  };
}

function buildGameDeck() {
  const easy = shuffle(QUESTIONS.filter((q) => q.difficulty === 'easy')).slice(0, 10);
  const medium = shuffle(QUESTIONS.filter((q) => q.difficulty === 'medium')).slice(0, 9);
  const ultimate = shuffle(QUESTIONS.filter((q) => q.difficulty === 'ultimate')).slice(0, 1);

  return [...easy, ...medium, ...ultimate].map(prepareQuestionWithShuffledOptions);
}

const TIME_LIMITS = {
  easy: 15,
  medium: 18,
  ultimate: 25,
};

const BASE_POINTS = {
  easy: 1000,
  medium: 1500,
  ultimate: 3000,
};

const TICKET_THRESHOLD = 15;

// Game State
const game = {
  pin: generatePin(),
  state: 'LOBBY', // LOBBY | QUESTION | REVEAL | FINISHED
  deck: [],
  currentIndex: -1,
  questionStartTime: 0,
  timeLimit: 15,
  timerInterval: null,
  autoAdvanceTimeout: null,
  players: new Map(), // playerId -> { id, socketId, name, score, correctCount, streak, bestStreak, lastAnswer, connected }
};

function getLeaderboard() {
  return Array.from(game.players.values())
    .map((p) => ({
      id: p.id,
      name: p.name,
      score: p.score,
      correctCount: p.correctCount,
      streak: p.streak,
      hasTicket: p.correctCount >= TICKET_THRESHOLD,
      connected: p.connected,
      answeredCurrent: p.lastAnswer !== null && p.lastAnswer.questionIndex === game.currentIndex,
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.correctCount - a.correctCount;
    });
}

function getHostStatePayload() {
  const currentQ = game.currentIndex >= 0 ? game.deck[game.currentIndex] : null;
  const elapsed = game.state === 'QUESTION' ? (Date.now() - game.questionStartTime) / 1000 : 0;
  const timeLeft = game.state === 'QUESTION' ? Math.max(0, Math.ceil(game.timeLimit - elapsed)) : 0;

  let distribution = [0, 0, 0, 0];
  let answeredCount = 0;
  for (const p of game.players.values()) {
    if (p.lastAnswer && p.lastAnswer.questionIndex === game.currentIndex) {
      answeredCount++;
      if (p.lastAnswer.optionIndex >= 0 && p.lastAnswer.optionIndex < 4) {
        distribution[p.lastAnswer.optionIndex]++;
      }
    }
  }

  return {
    pin: game.pin,
    state: game.state,
    currentIndex: game.currentIndex,
    totalQuestions: game.deck.length || 20,
    ticketThreshold: TICKET_THRESHOLD,
    timeLimit: game.timeLimit,
    timeLeft,
    answeredCount,
    totalPlayers: game.players.size,
    question: currentQ
      ? {
          id: currentQ.id,
          difficulty: currentQ.difficulty,
          category: currentQ.category,
          question: currentQ.question,
          options: currentQ.options,
          answer: game.state === 'REVEAL' || game.state === 'LEADERBOARD' || game.state === 'FINISHED' ? currentQ.answer : null,
        }
      : null,
    distribution: game.state === 'REVEAL' ? distribution : null,
    leaderboard: getLeaderboard(),
  };
}

function broadcastHostState() {
  io.to('hosts').emit('host:state', getHostStatePayload());
}

function getPlayerStatePayload(player) {
  const currentQ = game.currentIndex >= 0 ? game.deck[game.currentIndex] : null;
  const lb = getLeaderboard();
  const rank = lb.findIndex((p) => p.id === player.id) + 1;
  const answeredThis = player.lastAnswer && player.lastAnswer.questionIndex === game.currentIndex;

  return {
    pin: game.pin,
    state: game.state,
    player: {
      id: player.id,
      name: player.name,
      score: player.score,
      correctCount: player.correctCount,
      streak: player.streak,
      rank,
      hasTicket: player.correctCount >= TICKET_THRESHOLD,
    },
    currentIndex: game.currentIndex,
    totalQuestions: game.deck.length || 20,
    ticketThreshold: TICKET_THRESHOLD,
    question: currentQ
      ? {
          difficulty: currentQ.difficulty,
          category: currentQ.category,
          question: currentQ.question,
          options: currentQ.options,
          timeLimit: game.timeLimit,
        }
      : null,
    answered: answeredThis,
    lastResult: answeredThis ? player.lastAnswer : null,
    correctOption: game.state === 'REVEAL' && currentQ ? currentQ.answer : null,
  };
}

function sendStateToAllPlayers() {
  for (const p of game.players.values()) {
    if (p.socketId && p.connected) {
      io.to(p.socketId).emit('player:state', getPlayerStatePayload(p));
    }
  }
}

function clearTimer() {
  if (game.timerInterval) {
    clearInterval(game.timerInterval);
    game.timerInterval = null;
  }
  if (game.autoAdvanceTimeout) {
    clearTimeout(game.autoAdvanceTimeout);
    game.autoAdvanceTimeout = null;
  }
}

function startQuestion(index) {
  clearTimer();
  game.currentIndex = index;
  const q = game.deck[index];
  game.state = 'QUESTION';
  game.timeLimit = TIME_LIMITS[q.difficulty] || 15;
  game.questionStartTime = Date.now();

  broadcastHostState();
  sendStateToAllPlayers();

  game.timerInterval = setInterval(() => {
    const elapsed = (Date.now() - game.questionStartTime) / 1000;
    const remaining = Math.max(0, Math.ceil(game.timeLimit - elapsed));
    io.to('hosts').emit('host:tick', { timeLeft: remaining, timeLimit: game.timeLimit });
    if (elapsed >= game.timeLimit) {
      revealAnswer();
    }
  }, 250);
}

function revealAnswer() {
  if (game.state !== 'QUESTION') return;
  clearTimer();
  game.state = 'REVEAL';

  // Reset streak for players who didn't answer in time
  for (const p of game.players.values()) {
    if (!p.lastAnswer || p.lastAnswer.questionIndex !== game.currentIndex) {
      p.streak = 0;
      p.lastAnswer = {
        questionIndex: game.currentIndex,
        optionIndex: -1,
        isCorrect: false,
        pointsEarned: 0,
        timedOut: true,
      };
    }
  }

  broadcastHostState();
  sendStateToAllPlayers();

  // Auto-advance directly to next question (or FINISHED) after 2.5s reveal
  game.autoAdvanceTimeout = setTimeout(() => {
    if (game.state !== 'REVEAL') return;
    if (game.currentIndex + 1 < game.deck.length) {
      startQuestion(game.currentIndex + 1);
    } else {
      game.state = 'FINISHED';
      broadcastHostState();
      sendStateToAllPlayers();
    }
  }, 2500);
}

function startGame() {
  if (game.players.size === 0) return { ok: false, error: 'Minimal 1 pemain harus bergabung terlebih dahulu!' };
  clearTimer();
  game.deck = buildGameDeck();
  for (const p of game.players.values()) {
    p.score = 0;
    p.correctCount = 0;
    p.streak = 0;
    p.bestStreak = 0;
    p.lastAnswer = null;
  }
  startQuestion(0);
  return { ok: true };
}

function nextStep() {
  if (game.state === 'LOBBY') {
    return startGame();
  }
  if (game.state === 'QUESTION') {
    revealAnswer();
    return { ok: true };
  }
  if (game.state === 'REVEAL') {
    if (game.currentIndex + 1 >= game.deck.length) {
      game.state = 'FINISHED';
      broadcastHostState();
      sendStateToAllPlayers();
    } else {
      game.state = 'LEADERBOARD';
      broadcastHostState();
      sendStateToAllPlayers();
    }
    return { ok: true };
  }
  if (game.state === 'LEADERBOARD') {
    if (game.currentIndex + 1 < game.deck.length) {
      startQuestion(game.currentIndex + 1);
    } else {
      game.state = 'FINISHED';
      broadcastHostState();
      sendStateToAllPlayers();
    }
    return { ok: true };
  }
  return { ok: false, error: 'Game sudah selesai. Tekan Reset untuk main lagi.' };
}

function resetGame() {
  clearTimer();
  game.pin = generatePin();
  game.state = 'LOBBY';
  game.deck = [];
  game.currentIndex = -1;
  game.players.clear();
  io.emit('game:reset');
  broadcastHostState();
}

// API endpoint for LAN URL & QR Code
app.get('/api/info', async (req, res) => {
  const ips = getLocalIPs();
  const hostHeader = req.headers.host || `localhost:${PORT}`;
  const preferredIp = ips[0] || hostHeader.split(':')[0];
  const portPart = hostHeader.includes(':') ? `:${hostHeader.split(':')[1]}` : `:${PORT}`;
  const protocol = req.protocol || 'http';
  const joinUrl = `${protocol}://${preferredIp}${portPart}/play?pin=${game.pin}`;
  const controllerUrl = `${protocol}://${preferredIp}${portPart}/controller`;

  try {
    const qrDataUrl = await QRCode.toDataURL(joinUrl, {
      width: 320,
      margin: 2,
      color: { dark: '#0f172a', light: '#ffffff' },
    });
    res.json({
      pin: game.pin,
      ips,
      joinUrl,
      controllerUrl,
      qrDataUrl,
      totalBankQuestions: QUESTIONS.length,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate QR' });
  }
});

// Socket.IO handlers
io.on('connection', (socket) => {
  socket.on('host:join', () => {
    socket.join('hosts');
    socket.emit('host:state', getHostStatePayload());
  });

  // Host / Controller actions
  socket.on('controller:action', (payload, cb) => {
    const action = payload?.action;
    let result = { ok: true };

    if (action === 'start') {
      result = startGame();
    } else if (action === 'next') {
      result = nextStep();
    } else if (action === 'reveal') {
      revealAnswer();
    } else if (action === 'leaderboard') {
      clearTimer();
      game.state = game.currentIndex + 1 >= game.deck.length ? 'FINISHED' : 'LEADERBOARD';
      broadcastHostState();
      sendStateToAllPlayers();
    } else if (action === 'finish') {
      clearTimer();
      game.state = 'FINISHED';
      broadcastHostState();
      sendStateToAllPlayers();
    } else if (action === 'reset') {
      resetGame();
    } else if (action === 'kick' && payload?.playerId) {
      const target = game.players.get(payload.playerId);
      if (target) {
        if (target.socketId) {
          io.to(target.socketId).emit('player:kicked');
        }
        game.players.delete(payload.playerId);
        broadcastHostState();
      }
    }

    if (typeof cb === 'function') cb(result);
  });

  // Player join
  socket.on('player:join', ({ pin, name, playerId }, cb) => {
    const cleanPin = String(pin || '').trim();
    const cleanName = String(name || '').trim().slice(0, 18);

    if (cleanPin !== game.pin) {
      return cb?.({ ok: false, error: 'PIN salah! Cek layar Mac untuk PIN terbaru.' });
    }
    if (!cleanName) {
      return cb?.({ ok: false, error: 'Masukkan nama kamu dulu!' });
    }

    // Reconnect existing player if same playerId
    if (playerId && game.players.has(playerId)) {
      const existing = game.players.get(playerId);
      existing.socketId = socket.id;
      existing.connected = true;
      existing.name = cleanName || existing.name;
      socket.data.playerId = playerId;
      broadcastHostState();
      return cb?.({ ok: true, state: getPlayerStatePayload(existing) });
    }

    if (game.state !== 'LOBBY') {
      return cb?.({ ok: false, error: 'Game sudah dimulai! Tunggu ronde berikutnya.' });
    }

    // Check duplicate name
    for (const p of game.players.values()) {
      if (p.name.toLowerCase() === cleanName.toLowerCase()) {
        return cb?.({ ok: false, error: 'Nama sudah dipakai pemain lain, pakai nama lain ya!' });
      }
    }

    const newId = playerId || `p_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const player = {
      id: newId,
      socketId: socket.id,
      name: cleanName,
      score: 0,
      correctCount: 0,
      streak: 0,
      bestStreak: 0,
      lastAnswer: null,
      connected: true,
    };

    game.players.set(newId, player);
    socket.data.playerId = newId;
    broadcastHostState();

    cb?.({ ok: true, state: getPlayerStatePayload(player) });
  });

  // Player reconnect by stored playerId
  socket.on('player:reconnect', ({ playerId, pin }, cb) => {
    if (!playerId || !game.players.has(playerId) || String(pin) !== game.pin) {
      return cb?.({ ok: false });
    }
    const p = game.players.get(playerId);
    p.socketId = socket.id;
    p.connected = true;
    socket.data.playerId = playerId;
    broadcastHostState();
    cb?.({ ok: true, state: getPlayerStatePayload(p) });
  });

  // Player submit answer
  socket.on('player:answer', ({ optionIndex }, cb) => {
    const playerId = socket.data.playerId;
    const player = game.players.get(playerId);
    if (!player || game.state !== 'QUESTION') {
      return cb?.({ ok: false });
    }
    if (player.lastAnswer && player.lastAnswer.questionIndex === game.currentIndex) {
      return cb?.({ ok: false, error: 'Sudah menjawab' });
    }

    const q = game.deck[game.currentIndex];
    const elapsed = (Date.now() - game.questionStartTime) / 1000;
    const timeLeft = Math.max(0, game.timeLimit - elapsed);
    const isCorrect = optionIndex === q.answer;

    let pointsEarned = 0;
    if (isCorrect) {
      player.correctCount += 1;
      player.streak += 1;
      if (player.streak > player.bestStreak) player.bestStreak = player.streak;

      const base = BASE_POINTS[q.difficulty] || 1000;
      const speedRatio = Math.max(0, Math.min(1, timeLeft / game.timeLimit));
      const speedScore = Math.round(base * (0.5 + 0.5 * speedRatio));
      const streakBonus = Math.min(500, (player.streak - 1) * 100);
      pointsEarned = speedScore + streakBonus;
      player.score += pointsEarned;
    } else {
      player.streak = 0;
    }

    player.lastAnswer = {
      questionIndex: game.currentIndex,
      optionIndex,
      isCorrect,
      pointsEarned,
      timedOut: false,
    };

    cb?.({ ok: true, state: getPlayerStatePayload(player) });
    broadcastHostState();

    // Auto-reveal if all connected players have answered
    let allAnswered = true;
    let connectedCount = 0;
    for (const p of game.players.values()) {
      if (p.connected) {
        connectedCount++;
        if (!p.lastAnswer || p.lastAnswer.questionIndex !== game.currentIndex) {
          allAnswered = false;
          break;
        }
      }
    }
    if (connectedCount > 0 && allAnswered) {
      setTimeout(() => {
        if (game.state === 'QUESTION') revealAnswer();
      }, 350);
    }
  });

  socket.on('disconnect', () => {
    const playerId = socket.data.playerId;
    if (playerId && game.players.has(playerId)) {
      const p = game.players.get(playerId);
      p.connected = false;
      broadcastHostState();
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const ips = getLocalIPs();
  console.log(`\n🚀 TechQuiz Arena running on port ${PORT}`);
  console.log(`   Mac Display (Host): http://localhost:${PORT}/host`);
  if (ips.length > 0) {
    console.log(`   Player Join (HP):   http://${ips[0]}:${PORT}/play`);
  }
  console.log(`   Question Bank:      ${QUESTIONS.length} questions loaded\n`);
});
