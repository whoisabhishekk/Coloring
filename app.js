/* ==============================================
   WINGO STRATEGY DASHBOARD - Application Logic
   Pattern Detection | Signal System | Live Data
   ============================================== */

// ============ CONFIGURATION ============
const CONFIG = {
  // Local proxy handles CORS — requests go to /api/win/... → proxied to cooe02.in
  API_BASE: '/api',
  FRESH_SIGNAL_STORAGE_KEY: 'wingo-fresh-signal-state',
  SAAS_ID: 1,
  REFRESH_INTERVAL: 10000,       // 10 seconds (safety-net background poll)
  PERIOD_DURATION_MS: 180000,    // 3 minutes = 180 seconds per color period
  PATTERN_LENGTH: 4,             // RGRG or GRGR (4-length for higher accuracy)
  MAX_LOG_ENTRIES: 80,
  MAX_DOTS_DISPLAY: 30,
  SECTIONS: {
    P: { name: 'Parity', emoji: '🎯' },
    S: { name: 'Sapre',  emoji: '⚡' },
    B: { name: 'Bcone',  emoji: '🔥' },
    E: { name: 'Emerd',  emoji: '💎' }
  }
};

// ============ APPLICATION STATE ============
const state = {
  sections: {},
  logs: [],
  refreshTimer: null,
  refreshProgress: 0,
  progressTimer: null,
  initialized: false,
  lastSignalSoundTime: 0,
  lastNotifiedPeriod: 0,   // Prevents spamming duplicate alerts for the same period
  nextBoundaryTimer: null,   // setTimeout ID for the next 3-min boundary fetch
  boundaryFollowUp1: null,   // Follow-up fetch 3s after boundary
  boundaryFollowUp2: null,   // Follow-up fetch 8s after boundary
  countdownInterval: null,   // setInterval for live countdown display
  lastBoundaryFetch: 0       // Timestamp of last boundary-triggered fetch
};

// Initialize section states
for (const [key, info] of Object.entries(CONFIG.SECTIONS)) {
  state.sections[key] = {
    name: info.name,
    emoji: info.emoji,
    periods: [],
    lastKnownPeriod: 0,
    nextPeriod: 0,
    pendingBet: null,          // { color: 'R'|'G', period: number }
    totalWins: 0,
    totalLosses: 0,
    betHistory: [],            // [{ period, betColor, actualColor, won }]
    patternDetected: false,
    patternColors: null,
    freshStartArmed: false,
    freshStartAnchorPeriod: 0,
    strategyState: 'HUNTING',   // 'HUNTING' | 'SIGNAL_ACTIVE' | 'WAITING_FOR_TREND_BREAK'
    lastNotifiedPeriod: 0
  };
}

// ============ UTILITY FUNCTIONS ============

/** Get simplified color from period data */
function getColor(period) {
  return period.is_green ? 'G' : 'R';
}

/** Get display color name */
function colorName(c) {
  return c === 'G' ? 'GREEN' : 'RED';
}

/** Check if 4 colors form an alternating pattern */
function isAlternating(colors) {
  if (colors.length < CONFIG.PATTERN_LENGTH) return false;
  for (let i = 1; i < colors.length; i++) {
    if (colors[i] === colors[i - 1]) return false;
  }
  return true;
}

function getLatestAlternatingColors(periods) {
  if (periods.length < CONFIG.PATTERN_LENGTH) return null;

  const colors = periods
    .slice(-CONFIG.PATTERN_LENGTH)
    .map(period => getColor(period));

  return isAlternating(colors) ? colors : null;
}

function hasLatestTrendBreak(periods) {
  if (periods.length < 2) return false;

  const last = periods[periods.length - 1];
  const prev = periods[periods.length - 2];
  return getColor(last) === getColor(prev);
}

/** Format current time as HH:MM:SS */
function formatTime(date) {
  if (!date) date = new Date();
  return date.toLocaleTimeString('en-IN', { hour12: false });
}

/** Format period number for display */
function formatPeriod(period) {
  const str = String(period);
  return str.length > 6 ? str.slice(-3) : str;
}

function readStorage(key) {
  try {
    return window.localStorage.getItem(key);
  } catch (e) {
    return null;
  }
}

function writeStorage(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch (e) {
    // Ignore storage failures in restricted browsers.
  }
}

function removeStorage(key) {
  try {
    window.localStorage.removeItem(key);
  } catch (e) {
    // Ignore storage failures in restricted browsers.
  }
}

function hasFreshSignalState(section) {
  return Boolean(section.freshStartArmed || section.freshStartAnchorPeriod);
}

// ============ SOUND SYSTEM ============
let audioCtx = null;

function ensureAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

/** Premium alert sound — ascending chime with harmonics */
function playAlertSound() {
  const now = Date.now();
  if (now - state.lastSignalSoundTime < 3000) return;
  state.lastSignalSoundTime = now;

  try {
    const ctx = ensureAudioCtx();
    const t = ctx.currentTime;

    // Ascending chime notes (C5, E5, G5, C6)
    const notes = [523.25, 659.25, 783.99, 1046.50];
    notes.forEach((freq, i) => {
      const delay = i * 0.12;
      // Main tone
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, t + delay);
      gain.gain.linearRampToValueAtTime(0.22, t + delay + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + delay + 0.4);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t + delay);
      osc.stop(t + delay + 0.4);

      // Harmonic shimmer (octave above, quieter)
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'triangle';
      osc2.frequency.value = freq * 2;
      gain2.gain.setValueAtTime(0, t + delay);
      gain2.gain.linearRampToValueAtTime(0.06, t + delay + 0.02);
      gain2.gain.exponentialRampToValueAtTime(0.001, t + delay + 0.25);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(t + delay);
      osc2.stop(t + delay + 0.25);
    });

    // Sub-bass impact
    const sub = ctx.createOscillator();
    const subGain = ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(80, t);
    sub.frequency.exponentialRampToValueAtTime(40, t + 0.3);
    subGain.gain.setValueAtTime(0.3, t);
    subGain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    sub.connect(subGain);
    subGain.connect(ctx.destination);
    sub.start(t);
    sub.stop(t + 0.3);

  } catch (e) {
    console.warn('Sound unavailable:', e);
  }
}

/**
 * TRADE READY SOUND — Loud, attention-grabbing alert
 * Plays a powerful "cash register ka-ching + siren + victory fanfare" combo
 * This is the MAIN sound that plays when a trade signal arrives
 */
function playTradeReadySound() {
  try {
    const ctx = ensureAudioCtx();
    const t = ctx.currentTime;

    // ── Part 1: Siren sweep (attention grabber) ──
    const siren = ctx.createOscillator();
    const sirenGain = ctx.createGain();
    siren.type = 'sawtooth';
    siren.frequency.setValueAtTime(600, t);
    siren.frequency.linearRampToValueAtTime(1200, t + 0.15);
    siren.frequency.linearRampToValueAtTime(600, t + 0.3);
    siren.frequency.linearRampToValueAtTime(1200, t + 0.45);
    sirenGain.gain.setValueAtTime(0.12, t);
    sirenGain.gain.setValueAtTime(0.12, t + 0.4);
    sirenGain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    siren.connect(sirenGain);
    sirenGain.connect(ctx.destination);
    siren.start(t);
    siren.stop(t + 0.5);

    // ── Part 2: Ka-ching (metallic ring) ──
    const ringDelay = 0.5;
    [2637, 3520, 4186].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, t + ringDelay);
      gain.gain.linearRampToValueAtTime(0.08, t + ringDelay + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, t + ringDelay + 0.4);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t + ringDelay);
      osc.stop(t + ringDelay + 0.4);
    });

    // ── Part 3: Victory fanfare (ascending power chord) ──
    const fanfareDelay = 0.9;
    const fanfareNotes = [
      { freq: 523.25, time: 0, dur: 0.5 },     // C5
      { freq: 659.25, time: 0.1, dur: 0.45 },   // E5
      { freq: 783.99, time: 0.2, dur: 0.4 },     // G5
      { freq: 1046.50, time: 0.35, dur: 0.5 },   // C6 (hold!)
      { freq: 1318.51, time: 0.45, dur: 0.6 },   // E6 (finale!)
    ];

    fanfareNotes.forEach(note => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = note.freq;
      const start = t + fanfareDelay + note.time;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.2, start + 0.03);
      gain.gain.setValueAtTime(0.18, start + note.dur * 0.6);
      gain.gain.exponentialRampToValueAtTime(0.001, start + note.dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + note.dur);

      // Shimmer harmonics
      const shim = ctx.createOscillator();
      const shimGain = ctx.createGain();
      shim.type = 'triangle';
      shim.frequency.value = note.freq * 2;
      shimGain.gain.setValueAtTime(0, start);
      shimGain.gain.linearRampToValueAtTime(0.04, start + 0.03);
      shimGain.gain.exponentialRampToValueAtTime(0.001, start + note.dur * 0.7);
      shim.connect(shimGain);
      shimGain.connect(ctx.destination);
      shim.start(start);
      shim.stop(start + note.dur * 0.7);
    });

    // ── Part 4: Sub-bass boom at start ──
    const boom = ctx.createOscillator();
    const boomGain = ctx.createGain();
    boom.type = 'sine';
    boom.frequency.setValueAtTime(100, t);
    boom.frequency.exponentialRampToValueAtTime(30, t + 0.5);
    boomGain.gain.setValueAtTime(0.35, t);
    boomGain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    boom.connect(boomGain);
    boomGain.connect(ctx.destination);
    boom.start(t);
    boom.stop(t + 0.5);

  } catch (e) {
    console.warn('Trade sound unavailable:', e);
  }
}

// ============ NOTIFICATION SYSTEM ============

function updateNotificationStatus() {
  const statusEl = document.getElementById('notification-status');
  if (!statusEl) return;

  if (!('Notification' in window)) {
    statusEl.textContent = '🔇 NO NOTIF';
    statusEl.className = 'status-badge watching';
    return;
  }

  if (Notification.permission === 'granted') {
    statusEl.textContent = '🔔 ALERTS ON';
    statusEl.className = 'status-badge watching';
    statusEl.style.backgroundColor = 'var(--color-green)';
    statusEl.style.color = '#fff';
  } else if (Notification.permission === 'denied') {
    statusEl.textContent = '🔇 BLOCKED';
    statusEl.className = 'status-badge paused';
    statusEl.style.backgroundColor = 'var(--color-red)';
    statusEl.style.color = '#fff';
  } else {
    statusEl.textContent = '🔔 ENABLE ALERTS';
    statusEl.className = 'status-badge watching';
    statusEl.style.backgroundColor = '#f1c40f';
    statusEl.style.color = '#000';
  }
}

function requestNotificationPermission() {
  if (!('Notification' in window)) {
    alert('Browser notifications are not supported on this device.');
    return;
  }

  Notification.requestPermission().then(permission => {
    updateNotificationStatus();
    if (permission === 'granted') {
      sendSystemNotification('🎰 Wingo Strategy', 'Notifications successfully enabled!');
    }
  });
}

function sendSystemNotification(title, message) {
  console.log(`[Notification] ${title}: ${message}`);

  // 1. Native Android Bridge (if running in custom Android App)
  if (window.AndroidBridge && typeof window.AndroidBridge.showNotification === 'function') {
    try {
      window.AndroidBridge.showNotification(title, message);
      return;
    } catch (e) {
      console.error('AndroidBridge notification failed:', e);
    }
  }

  // 2. Standard Browser PWA Notification
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.ready.then(registration => {
          registration.showNotification(title, {
            body: message,
            icon: './icon.png',
            vibrate: [200, 100, 200],
            tag: 'wingo-signal',
            renotify: true
          });
        });
      } else {
        new Notification(title, {
          body: message,
          icon: './icon.png'
        });
      }
    } catch (e) {
      console.warn('Web notification failed:', e);
    }
  }
}

// Expose functions globally for HTML event attributes
window.requestNotificationPermission = requestNotificationPermission;
window.updateNotificationStatus = updateNotificationStatus;
window.startFreshSignalsNow = startFreshSignalsNow;

// ============ LOGGING ============

function addLog(message, type = 'info') {
  const entry = {
    time: formatTime(),
    message,
    type  // 'info' | 'pattern' | 'win' | 'loss' | 'signal' | 'reset'
  };

  state.logs.unshift(entry);
  if (state.logs.length > CONFIG.MAX_LOG_ENTRIES) state.logs.pop();

  renderLog(entry);
}

function sectionHasLiveAlternatingPattern(section) {
  if (section.periods.length < CONFIG.PATTERN_LENGTH) return false;

  const colors = section.periods
    .slice(-CONFIG.PATTERN_LENGTH)
    .map(period => getColor(period));

  return isAlternating(colors);
}

function getEligiblePeriodsForSignals(section) {
  if (!section.freshStartAnchorPeriod) {
    return section.periods;
  }

  return section.periods.filter(period => period.period > section.freshStartAnchorPeriod);
}

function persistFreshSignalState() {
  const sections = {};
  let hasFreshState = false;

  for (const [key, section] of Object.entries(state.sections)) {
    if (!section.freshStartAnchorPeriod && !section.freshStartArmed) continue;

    hasFreshState = true;
    sections[key] = {
      freshStartAnchorPeriod: section.freshStartAnchorPeriod || 0,
      freshStartArmed: section.freshStartArmed
    };
  }

  if (!hasFreshState) {
    removeStorage(CONFIG.FRESH_SIGNAL_STORAGE_KEY);
    return;
  }

  writeStorage(
    CONFIG.FRESH_SIGNAL_STORAGE_KEY,
    JSON.stringify({ sections })
  );
}

function restoreFreshSignalState() {
  const raw = readStorage(CONFIG.FRESH_SIGNAL_STORAGE_KEY);
  if (!raw) return;

  try {
    const parsed = JSON.parse(raw);
    const savedSections = parsed.sections || {};

    for (const [key, saved] of Object.entries(savedSections)) {
      const section = state.sections[key];
      if (!section) continue;

      section.freshStartAnchorPeriod = Number(saved.freshStartAnchorPeriod) || 0;
      section.freshStartArmed = Boolean(saved.freshStartArmed);
    }
  } catch (e) {
    removeStorage(CONFIG.FRESH_SIGNAL_STORAGE_KEY);
  }
}

/**
 * Show a live trade signal — direct bet on pattern's last same color.
 */
function showTradeSignal(key) {
  const section = state.sections[key];
  if (!section.pendingBet) return;

  const betColor = colorName(section.pendingBet.color);
  const periodStr = formatPeriod(section.pendingBet.period);

  // Show signal banner at top
  showSignalBanner(key);

  // Play the trade ready sound (no popup)
  playTradeReadySound();

  // Send push notification
  sendSystemNotification(
    `🎯 TRADE: ${section.name}`,
    `Bet ${betColor} on Period #${periodStr}!`
  );

  addLog(
    `🚨 [${section.name}] TRADE SIGNAL! Bet ${betColor} on #${periodStr}`,
    'signal'
  );
}

function armBetFromCurrentPattern(key, nextPeriod) {
  const section = state.sections[key];
  if (section.pendingBet || section.strategyState !== 'HUNTING') return false;

  checkCurrentPattern(section);
  if (!section.patternDetected || !section.patternColors) return false;

  const betColor = section.patternColors[section.patternColors.length - 1];

  // Direct LIVE bet — no virtual, no loss wait
  section.pendingBet = { color: betColor, period: nextPeriod };
  section.strategyState = 'SIGNAL_ACTIVE';

  showTradeSignal(key);
  addLog(
    `${section.emoji} [${section.name}] Pattern ${section.patternColors.join('')} → LIVE Bet ${colorName(betColor)} on #${formatPeriod(nextPeriod)}`,
    'pattern'
  );

  return true;
}

// ============ DATA FETCHING ============

async function fetchSectionData(category) {
  const url = `${CONFIG.API_BASE}/win/next_period_info_noauth?category=${category}&saas_id=${CONFIG.SAAS_ID}`;

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    if (data.code !== 200) throw new Error(`API error code: ${data.code}`);

    return data;
  } catch (err) {
    console.error(`Failed to fetch ${category}:`, err);
    return null;
  }
}

async function fetchAllSections() {
  const results = {};
  const promises = Object.keys(CONFIG.SECTIONS).map(async (key) => {
    const data = await fetchSectionData(key);
    if (data) results[key] = data;
  });

  await Promise.all(promises);
  return results;
}

// ============ PATTERN DETECTION & STRATEGY ENGINE ============

/**
 * 🎰 RGRG + TREND BREAK WAIT STRATEGY (Rank #1 — 57.3% win rate):
 * 1. Detect 4-length alternating pattern (RGRG / GRGR).
 * 2. Bet LIVE on last same color.
 * 3. WIN → back to hunting for next pattern.
 * 4. LOSS → PAUSE → wait for trend break (2 consecutive same colors).
 * 5. After trend break → resume hunting.
 */

/**
 * Scan history — replay past periods to build bet history stats.
 * States: HUNTING → SIGNAL_ACTIVE → HUNTING (repeat)
 */
function scanHistoryForSection(section) {
  const periods = getEligiblePeriodsForSignals(section);

  // Reset tracking for fresh scan
  section.totalWins = 0;
  section.totalLosses = 0;
  section.betHistory = [];
  section.pendingBet = null;
  section.strategyState = 'HUNTING';

  if (periods.length === 0) {
    checkCurrentPattern(section);
    return;
  }

  let activeBet = null; // { color, period }

  for (let i = 0; i < periods.length; i++) {
    // Resolve active bet
    if (activeBet && periods[i].period === activeBet.period) {
      const actualColor = getColor(periods[i]);
      const won = actualColor === activeBet.color;

      section.betHistory.push({
        period: periods[i].period,
        betColor: activeBet.color,
        actualColor,
        won
      });

      if (won) {
        section.totalWins++;
        section.strategyState = 'HUNTING';
      } else {
        section.totalLosses++;
        section.strategyState = 'WAITING_FOR_TREND_BREAK';
      }

      activeBet = null;
    }

    if (activeBet) continue;

    // Check for trend break if we are waiting for one
    if (section.strategyState === 'WAITING_FOR_TREND_BREAK') {
      if (i > 0 && getColor(periods[i - 1]) === getColor(periods[i])) {
        section.strategyState = 'HUNTING';
      }
    }

    if (section.strategyState !== 'HUNTING') continue;

    // Hunt for pattern
    if (i < CONFIG.PATTERN_LENGTH - 1) continue;

    const patternColors = periods
      .slice(i - CONFIG.PATTERN_LENGTH + 1, i + 1)
      .map(period => getColor(period));

    if (!isAlternating(patternColors)) continue;
    if (i + 1 >= periods.length) continue;

    const betColor = patternColors[patternColors.length - 1];
    const nextPeriod = periods[i + 1].period;

    activeBet = { color: betColor, period: nextPeriod };
    section.strategyState = 'SIGNAL_ACTIVE';
  }

  // Check for current pattern (latest colors)
  checkCurrentPattern(section);
}

function checkCurrentPattern(section) {
  const allPeriods = section.periods;
  if (allPeriods.length < CONFIG.PATTERN_LENGTH) {
    section.patternDetected = false;
    section.patternColors = null;
    return;
  }

  const latestColors = allPeriods
    .slice(-CONFIG.PATTERN_LENGTH)
    .map(period => getColor(period));

  if (section.freshStartArmed) {
    if (isAlternating(latestColors)) {
      section.patternDetected = false;
      section.patternColors = null;
      persistFreshSignalState();
      return;
    }

    section.freshStartArmed = false;
    section.freshStartAnchorPeriod = allPeriods[allPeriods.length - 1].period;
    section.strategyState = 'HUNTING';
    persistFreshSignalState();
  }

  const periods = getEligiblePeriodsForSignals(section);
  if (periods.length < CONFIG.PATTERN_LENGTH) {
    section.patternDetected = false;
    section.patternColors = null;
    return;
  }

  const colors = getLatestAlternatingColors(periods);

  if (colors) {
    section.patternDetected = true;
    section.patternColors = colors;
  } else {
    section.patternDetected = false;
    section.patternColors = null;
  }
}

function processNewData(key, apiData) {
  const section = state.sections[key];
  const newPeriods = apiData.periods;
  const newNextPeriod = apiData.next_period;

  if (!newPeriods || newPeriods.length === 0) return;

  const isFirstLoad = section.periods.length === 0;

  if (isFirstLoad) {
    // First load - set up and scan history
    section.periods = newPeriods;
    section.lastKnownPeriod = newPeriods[newPeriods.length - 1].period;
    section.nextPeriod = newNextPeriod;
    scanHistoryForSection(section);

    addLog(`${section.emoji} [${section.name}] Loaded ${newPeriods.length} periods | State: ${section.strategyState}`, 'info');

    armBetFromCurrentPattern(key, newNextPeriod);

    return;
  }

  // Find new resolved periods
  const previousLastPeriod = section.lastKnownPeriod;
  const latestPeriodInData = newPeriods[newPeriods.length - 1].period;

  if (latestPeriodInData <= previousLastPeriod) {
    return; // No new data
  }

  // Get newly resolved periods
  const newResolvedPeriods = newPeriods.filter(p => p.period > previousLastPeriod);

  // Check pending bet outcomes
  for (const period of newResolvedPeriods) {
    if (section.pendingBet && period.period === section.pendingBet.period) {
      const resolvedBet = section.pendingBet;
      section.pendingBet = null;

      const actualColor = getColor(period);
      const won = actualColor === resolvedBet.color;

      // Resolve LIVE bet
      section.betHistory.push({
        period: period.period,
        betColor: resolvedBet.color,
        actualColor,
        won
      });

      if (won) {
        section.totalWins++;
        addLog(
          `✅ [${section.name}] WIN! Bet ${colorName(resolvedBet.color)}, Got ${colorName(actualColor)} (#${formatPeriod(period.period)})`,
          'win'
        );
        hideSignalBanner();
        playAlertSound();
        showToast(`✅ ${section.name} WIN!`, 'success');
        section.strategyState = 'HUNTING';
      } else {
        section.totalLosses++;
        addLog(
          `❌ [${section.name}] LOSS! Bet ${colorName(resolvedBet.color)}, Got ${colorName(actualColor)}.`,
          'loss'
        );
        hideSignalBanner();
        section.strategyState = 'WAITING_FOR_TREND_BREAK';
      }
    }
  }

  // Update stored periods
  section.periods = newPeriods;
  section.lastKnownPeriod = latestPeriodInData;
  section.nextPeriod = newNextPeriod;

  // Check for trend break if we are waiting for one
  if (section.strategyState === 'WAITING_FOR_TREND_BREAK') {
    if (hasLatestTrendBreak(section.periods)) {
      section.strategyState = 'HUNTING';
      addLog(`🔄 [${section.name}] Trend ended (consecutive same colors). Re-armed and hunting.`, 'info');
    }
  }

  // Hunt for next pattern if no active bet and state is HUNTING
  if (!section.pendingBet && section.strategyState === 'HUNTING') {
    armBetFromCurrentPattern(key, newNextPeriod);
  }
}

// ============ SIMPLIFIED SIGNAL FLOW ============

function resetAllSections() {
  for (const key of Object.keys(state.sections)) {
    const section = state.sections[key];
    section.pendingBet = null;
    section.patternDetected = false;
    section.patternColors = null;
    section.totalWins = 0;
    section.totalLosses = 0;
    section.betHistory = [];
    section.freshStartArmed = false;
    section.freshStartAnchorPeriod = 0;
    section.strategyState = 'HUNTING';
  }

  persistFreshSignalState();
}

function startFreshSignalsNow() {
  state.lastNotifiedPeriod = 0;

  for (const section of Object.values(state.sections)) {
    const ignoreCurrentPattern = sectionHasLiveAlternatingPattern(section);
    const anchorPeriod = section.lastKnownPeriod || section.periods[section.periods.length - 1]?.period || 0;

    section.pendingBet = null;
    section.patternDetected = false;
    section.patternColors = null;
    section.totalWins = 0;
    section.totalLosses = 0;
    section.betHistory = [];
    section.freshStartArmed = ignoreCurrentPattern;
    section.freshStartAnchorPeriod = anchorPeriod;
    section.strategyState = 'HUNTING';
  }

  hideSignalBanner();
  persistFreshSignalState();
  renderAll();

  addLog(
    '🔄 Manual fresh reset applied. Current pattern cleared, now watching only fresh signals from this point.',
    'reset'
  );
  showToast('Fresh signal mode started from current point.', 'success');
  sendSystemNotification(
    '🔄 Fresh Signals',
    'Current pattern and lock reset. Now watching fresh signals from this point.'
  );
}

// ============ UI RENDERING ============

function renderSection(key) {
  const section = state.sections[key];

  // Period info
  const periodEl = document.getElementById(`period-P`.replace('P', key));
  const nextPeriodEl = document.getElementById(`next-period-P`.replace('P', key));
  if (section.periods.length > 0) {
    const last = section.periods[section.periods.length - 1];
    periodEl.textContent = `Latest: #${formatPeriod(last.period)}`;
    nextPeriodEl.textContent = `Next: #${formatPeriod(section.nextPeriod)}`;
  }

  // Color trend dots
  renderColorDots(key);

  // Pattern status
  const patternEl = document.getElementById(`pattern-${key}`);
  if (section.patternDetected && section.patternColors) {
    patternEl.textContent = `Pattern: ${section.patternColors.join(' → ')}`;
    patternEl.className = 'pattern-status pattern-found';
  } else {
    patternEl.textContent = 'No Pattern';
    patternEl.className = 'pattern-status no-pattern';
  }

  // Bet info
  const betEl = document.getElementById(`bet-${key}`);
  if (section.pendingBet) {
    const colorLabel = colorName(section.pendingBet.color);
    betEl.textContent = `Bet: ${colorLabel}`;
    betEl.className = `bet-info bet-${colorLabel.toLowerCase()}`;
  } else {
    betEl.textContent = '--';
    betEl.className = 'bet-info bet-none';
  }

  // Stats
  document.getElementById(`wins-${key}`).textContent = `W: ${section.totalWins}`;
  document.getElementById(`losses-${key}`).textContent = `L: ${section.totalLosses}`;
  
  // Strategy state label — simple: Hunting or LIVE
  let stateLabel = '🔍 Hunting';
  if (section.strategyState === 'SIGNAL_ACTIVE') {
    stateLabel = '🎯 LIVE Signal';
  } else if (section.strategyState === 'WAITING_FOR_TREND_BREAK') {
    stateLabel = '⏳ Wait Trend';
  } else if (section.patternDetected) {
    stateLabel = '📊 Pattern Found';
  }
  document.getElementById(`streak-${key}`).textContent = stateLabel;

  // Section status badge
  const statusEl = document.getElementById(`status-${key}`);
  if (section.pendingBet) {
    statusEl.textContent = '🎯 TRADE';
    statusEl.className = 'section-status status-signal';
  } else if (section.strategyState === 'WAITING_FOR_TREND_BREAK') {
    statusEl.textContent = 'Wait Trend';
    statusEl.className = 'section-status status-watching';
  } else if (hasFreshSignalState(section)) {
    statusEl.textContent = 'Fresh Reset';
    statusEl.className = 'section-status status-watching';
  } else if (section.patternDetected) {
    statusEl.textContent = 'Pattern!';
    statusEl.className = 'section-status status-pattern';
  } else {
    statusEl.textContent = 'Watching';
    statusEl.className = 'section-status status-watching';
  }

  // Card classes
  const cardEl = document.getElementById(`card-${key}`);
  cardEl.classList.remove('active', 'signal-triggered', 'signal-green', 'signal-red', 'paused', 'hunting');

  if (section.pendingBet) {
    cardEl.classList.add('signal-triggered');
    cardEl.classList.add(section.pendingBet.color === 'G' ? 'signal-green' : 'signal-red');
  } else if (section.patternDetected) {
    cardEl.classList.add('active');
  }

  // In-card trade banner
  renderTradeBanner(key);

  // Bet history ribbon
  renderBetHistory(key);
}

function renderColorDots(key) {
  const section = state.sections[key];
  const container = document.getElementById(`trend-${key}`);
  container.innerHTML = '';

  const periods = section.periods;
  const startIdx = Math.max(0, periods.length - CONFIG.MAX_DOTS_DISPLAY);
  const displayPeriods = periods.slice(startIdx);

  // Determine pattern highlight range
  let patternStart = -1;
  if (section.patternDetected && displayPeriods.length >= CONFIG.PATTERN_LENGTH) {
    patternStart = displayPeriods.length - CONFIG.PATTERN_LENGTH;
  }

  displayPeriods.forEach((period, idx) => {
    const dot = document.createElement('div');
    const num = period.last_num;

    // Determine CSS class
    let dotClass = 'color-dot';
    if (period.is_violet) {
      dotClass += period.is_green ? ' green-violet' : ' red-violet';
    } else if (period.is_green) {
      dotClass += ' green';
    } else {
      dotClass += ' red';
    }

    // Latest dot
    if (idx === displayPeriods.length - 1) {
      dotClass += ' latest';
    }

    // Pattern highlight
    if (patternStart >= 0 && idx >= patternStart) {
      dotClass += ' pattern-highlight';
    }

    dot.className = dotClass;
    dot.textContent = num;
    dot.title = `#${formatPeriod(period.period)} | Num: ${num} | ${period.is_green ? 'Green' : 'Red'}${period.is_violet ? '+Violet' : ''}`;

    container.appendChild(dot);
  });
}

function renderBetHistory(key) {
  const section = state.sections[key];
  const container = document.getElementById(`history-${key}`);
  container.innerHTML = '';

  // Show last 10 bet results
  const recent = section.betHistory.slice(-10);
  if (recent.length === 0) return;

  recent.forEach(bet => {
    const dot = document.createElement('div');
    dot.className = `bet-result-dot ${bet.won ? 'result-win' : 'result-loss'}`;
    dot.textContent = bet.won ? '✓' : '✗';
    dot.title = `Bet: ${colorName(bet.betColor)}, Got: ${colorName(bet.actualColor)} → ${bet.won ? 'WIN' : 'LOSS'}`;
    container.appendChild(dot);
  });
}

function renderLog(entry) {
  const container = document.getElementById('activity-log');

  // Remove empty state on first entry
  const emptyState = container.querySelector('.empty-state');
  if (emptyState) emptyState.remove();

  const iconMap = {
    info: 'ℹ️',
    pattern: '🎯',
    win: '✅',
    loss: '❌',
    signal: '🚨',
    reset: '🔄'
  };

  const el = document.createElement('div');
  el.className = `log-entry log-${entry.type}`;
  el.innerHTML = `
    <span class="log-time">${entry.time}</span>
    <span class="log-icon">${iconMap[entry.type] || 'ℹ️'}</span>
    <span class="log-text">${entry.message}</span>
  `;

  container.insertBefore(el, container.firstChild);

  // Trim old entries
  while (container.children.length > CONFIG.MAX_LOG_ENTRIES) {
    container.removeChild(container.lastChild);
  }
}

function renderStrategyPanel() {
  const modeText = document.getElementById('mode-text');
  const activeSectionText = document.getElementById('active-section-text');
  const nextSignalText = document.getElementById('next-signal-text');
  const appStatus = document.getElementById('app-status');
  const freshResetActive = Object.values(state.sections).some(section => hasFreshSignalState(section));

  // Find sections with active trades
  const activeTrades = [];
  for (const [key, section] of Object.entries(state.sections)) {
    if (section.pendingBet) {
      activeTrades.push({ key, section });
    }
  }

  const patternSections = Object.values(state.sections)
    .filter(section => section.patternDetected);

  const waitingSections = Object.values(state.sections)
    .filter(section => section.strategyState === 'WAITING_FOR_TREND_BREAK');

  if (activeTrades.length > 0) {
    modeText.textContent = '🎯 TRADE ACTIVE';
    modeText.className = 'value signal-mode';
    const names = activeTrades.map(t => t.section.name).join(', ');
    activeSectionText.textContent = names;
    appStatus.textContent = `🎯 ${activeTrades.length} TRADE${activeTrades.length > 1 ? 'S' : ''}`;
    appStatus.className = 'status-badge signal-active';

    const tradeTexts = activeTrades.map(t => {
      const betColor = colorName(t.section.pendingBet.color);
      return `${t.section.name}: ${betColor}`;
    });
    nextSignalText.textContent = tradeTexts.join(' | ');
    nextSignalText.style.color = '';
  } else if (patternSections.length > 0) {
    modeText.textContent = '📊 PATTERN FOUND';
    modeText.className = 'value hunting-mode';
    activeSectionText.textContent = patternSections.map(s => s.name).join(', ');
    appStatus.textContent = 'PATTERN';
    appStatus.className = 'status-badge hunting';
    nextSignalText.textContent = 'Pattern detected! Signal will fire on next period.';
    nextSignalText.style.color = '';
  } else if (waitingSections.length > 0) {
    modeText.textContent = '⏳ WAIT TREND';
    modeText.className = 'value reset-mode';
    activeSectionText.textContent = waitingSections.map(s => s.name).join(', ');
    appStatus.textContent = 'WAIT TREND';
    appStatus.className = 'status-badge watching';
    nextSignalText.textContent = 'Waiting for alternating trend to end before hunting next signal.';
    nextSignalText.style.color = '';
  } else if (freshResetActive) {
    modeText.textContent = 'FRESH WATCH';
    modeText.className = 'value reset-mode';
    activeSectionText.textContent = 'All Sections';
    appStatus.textContent = 'FRESH START';
    appStatus.className = 'status-badge watching';
    nextSignalText.textContent = 'Fresh reset active. Waiting for current trend to clear and new pattern to form.';
    nextSignalText.style.color = '';
  } else {
    modeText.textContent = 'WATCHING';
    modeText.className = 'value watching-mode';
    activeSectionText.textContent = 'All Sections';
    appStatus.textContent = 'WATCHING ALL';
    appStatus.className = 'status-badge watching';
    nextSignalText.textContent = 'Monitoring all sections for RGRG/GRGR patterns...';
    nextSignalText.style.color = '';
  }
}

function renderAll() {
  for (const key of Object.keys(CONFIG.SECTIONS)) {
    renderSection(key);
  }
  renderStrategyPanel();
  updateLastUpdateTime();
}

function updateLastUpdateTime() {
  document.getElementById('last-update').textContent = formatTime();
}

// ============ SIGNAL BANNER ============



function showSignalBanner(key) {
  const section = state.sections[key];
  const banner = document.getElementById('signal-banner');
  const mainText = document.getElementById('signal-main-text');
  const subText = document.getElementById('signal-sub-text');

  mainText.textContent = `🎯 TRADE: ${section.name.toUpperCase()}`;

  if (section.pendingBet) {
    const betColor = colorName(section.pendingBet.color);
    const periodStr = formatPeriod(section.pendingBet.period);
    subText.textContent = `Next Bet: ${betColor} on Period #${periodStr}`;
    banner.className = `signal-banner signal-${betColor.toLowerCase()}`;
    
    // Notification logic
    const period = section.pendingBet.period;
    if (section.lastNotifiedPeriod !== period) {
      section.lastNotifiedPeriod = period;
      sendSystemNotification(
        `🎯 Wingo: LOCKED ${section.name}`,
        `Bet ${betColor} on Period #${periodStr}!`
      );
    }
  } else {
    subText.textContent = `Locked on ${section.name} — Waiting for next pattern`;
    banner.className = 'signal-banner signal-red';
    
    // Notification logic
    const uniqueKey = section.lastKnownPeriod + "_locked";
    if (section.lastNotifiedPeriod !== uniqueKey) {
      section.lastNotifiedPeriod = uniqueKey;
      sendSystemNotification(
        `🎯 Wingo: ${section.name} Locked`,
        `Locked on ${section.name}, waiting for pattern...`
      );
    }
  }

  // Shift content down
  document.getElementById('app-header').style.paddingTop = '80px';
}

function updateSignalBanner(key) {
  const section = state.sections[key];
  const subText = document.getElementById('signal-sub-text');

  if (section.pendingBet) {
    const betColor = colorName(section.pendingBet.color);
    const periodStr = formatPeriod(section.pendingBet.period);
    subText.textContent = `Next Bet: ${betColor} on Period #${periodStr}`;
    const banner = document.getElementById('signal-banner');
    banner.className = `signal-banner signal-${betColor.toLowerCase()}`;
    
    // Notification logic
    const period = section.pendingBet.period;
    if (section.lastNotifiedPeriod !== period) {
      section.lastNotifiedPeriod = period;
      playTradeReadySound();  // Play sound for new bet signal
      sendSystemNotification(
        `🚨 Wingo: ${section.name} Bet`,
        `Next Bet: ${betColor} on Period #${periodStr}!`
      );
    }
  } else {
    subText.textContent = 'Hunting for RGRG/GRGR pattern...';
  }
}

function hideSignalBanner() {
  // Check if any other section still has an active live bet
  const activeSectionKey = Object.keys(state.sections).find(
    key => state.sections[key].pendingBet
  );

  if (activeSectionKey) {
    showSignalBanner(activeSectionKey);
    return;
  }

  const banner = document.getElementById('signal-banner');
  banner.classList.add('hidden');
  document.getElementById('app-header').style.paddingTop = '';
}

// ============ IN-CARD TRADE BANNER ============

function renderTradeBanner(key) {
  const section = state.sections[key];
  const banner = document.getElementById(`trade-banner-${key}`);
  if (!banner) return;

  const colorEl = document.getElementById(`trade-banner-color-${key}`);
  const periodEl = document.getElementById(`trade-banner-period-${key}`);

  if (section.pendingBet) {
    const betColor = section.pendingBet.color;
    const betColorLabel = colorName(betColor);
    const periodStr = formatPeriod(section.pendingBet.period);
    const isGreen = betColor === 'G';

    colorEl.textContent = `🎯 ${betColorLabel} pe lagao!`;
    colorEl.className = `trade-banner-color ${isGreen ? 'banner-green' : 'banner-red'}`;
    periodEl.textContent = `Period #${periodStr}`;

    banner.classList.remove('hidden', 'banner-mode-green', 'banner-mode-red');
    banner.classList.add(isGreen ? 'banner-mode-green' : 'banner-mode-red');
  } else {
    banner.classList.add('hidden');
    banner.classList.remove('banner-mode-green', 'banner-mode-red');
  }
}

// ============ TOAST NOTIFICATIONS ============

function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast toast-${type} show`;

  setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}

// ============ REFRESH PROGRESS BAR ============

function startRefreshProgress() {
  state.refreshProgress = 0;
  const bar = document.getElementById('refresh-bar');
  bar.style.width = '0%';

  clearInterval(state.progressTimer);
  state.progressTimer = setInterval(() => {
    state.refreshProgress += (1000 / CONFIG.REFRESH_INTERVAL) * 100;
    if (state.refreshProgress > 100) state.refreshProgress = 100;
    bar.style.width = `${state.refreshProgress}%`;
  }, 1000);
}

// ============ SMART 3-MIN BOUNDARY SYNC ============

/**
 * Calculate milliseconds until the next 3-minute boundary from midnight.
 * Periods start at 00:00:00 and repeat every 3 minutes:
 *   00:00, 00:03, 00:06, 00:09, ... 23:57
 */
function getMsUntilNextBoundary() {
  const now = new Date();
  const midnightMs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const elapsedMs = now.getTime() - midnightMs;
  const periodMs = CONFIG.PERIOD_DURATION_MS; // 180000 (3 min)
  const currentPeriodStart = Math.floor(elapsedMs / periodMs) * periodMs;
  const nextBoundary = currentPeriodStart + periodMs;
  const msUntil = nextBoundary - elapsedMs;
  return Math.max(msUntil, 50); // minimum 50ms to avoid tight loops
}

/**
 * Get remaining seconds until next 3-minute boundary.
 */
function getSecondsUntilNextBoundary() {
  return Math.ceil(getMsUntilNextBoundary() / 1000);
}

/**
 * Schedule a precision fetch right at the next 3-minute boundary,
 * plus follow-up fetches at +3s and +8s (API may be slightly delayed).
 */
function scheduleNextBoundaryFetch() {
  // Clear any existing timers
  clearTimeout(state.nextBoundaryTimer);
  clearTimeout(state.boundaryFollowUp1);
  clearTimeout(state.boundaryFollowUp2);

  const msUntil = getMsUntilNextBoundary();

  state.nextBoundaryTimer = setTimeout(async () => {
    state.lastBoundaryFetch = Date.now();
    addLog('⏰ 3-min boundary hit! Fetching new color...', 'info');
    await refresh();

    // Follow-up fetch at +3 seconds (API might update slightly late)
    state.boundaryFollowUp1 = setTimeout(async () => {
      await refresh();
    }, 3000);

    // Follow-up fetch at +8 seconds (catch slower updates)
    state.boundaryFollowUp2 = setTimeout(async () => {
      await refresh();
    }, 8000);

    // Schedule the NEXT boundary
    scheduleNextBoundaryFetch();
  }, msUntil);
}

/**
 * Start the live countdown timer that updates every second.
 */
function startCountdownTimer() {
  clearInterval(state.countdownInterval);

  function updateCountdown() {
    const secondsLeft = getSecondsUntilNextBoundary();
    const min = Math.floor(secondsLeft / 60);
    const sec = secondsLeft % 60;
    const display = `${min}:${String(sec).padStart(2, '0')}`;

    // Update countdown elements
    const countdownEl = document.getElementById('next-color-countdown');
    if (countdownEl) {
      countdownEl.textContent = display;

      // Visual urgency: change color when < 10 seconds
      if (secondsLeft <= 10) {
        countdownEl.classList.add('countdown-urgent');
      } else if (secondsLeft <= 30) {
        countdownEl.classList.add('countdown-soon');
        countdownEl.classList.remove('countdown-urgent');
      } else {
        countdownEl.classList.remove('countdown-urgent', 'countdown-soon');
      }
    }

    // Update the progress bar to match the 3-minute cycle
    const bar = document.getElementById('refresh-bar');
    if (bar) {
      const totalSeconds = CONFIG.PERIOD_DURATION_MS / 1000; // 180
      const elapsed = totalSeconds - secondsLeft;
      const pct = (elapsed / totalSeconds) * 100;
      bar.style.width = `${Math.min(pct, 100)}%`;
    }
  }

  updateCountdown(); // run immediately
  state.countdownInterval = setInterval(updateCountdown, 1000);
}

// ============ MAIN LOOP ============

async function refresh() {
  try {
    const allData = await fetchAllSections();

    for (const [key, data] of Object.entries(allData)) {
      processNewData(key, data);
    }

    renderAll();

  } catch (err) {
    console.error('Refresh error:', err);
    addLog(`⚠️ Refresh failed: ${err.message}`, 'info');
    showToast('⚠️ Data fetch failed, retrying...', 'error');
  }
}

async function initialize() {
  addLog('🚀 Dashboard initializing...', 'info');

  try {
    await refresh();

    state.initialized = true;

    // Hide loading overlay
    const overlay = document.getElementById('loading-overlay');
    overlay.classList.add('fade-out');
    setTimeout(() => overlay.style.display = 'none', 500);

    addLog('✅ Dashboard ready! Monitoring all 4 sections.', 'info');
    showToast('Dashboard ready!', 'success');

    // Start smart 3-minute boundary sync (precision fetch at period boundaries)
    scheduleNextBoundaryFetch();

    // Start live countdown timer (updates every second)
    startCountdownTimer();

    // Safety-net background poll (catches anything the boundary sync might miss)
    state.refreshTimer = setInterval(refresh, CONFIG.REFRESH_INTERVAL);

    addLog(`⏰ Smart sync started. Next color in ${getSecondsUntilNextBoundary()}s`, 'info');

  } catch (err) {
    console.error('Initialization error:', err);
    addLog(`❌ Init failed: ${err.message}`, 'info');
    showToast('Failed to load data. Retrying in 10s...', 'error');

    // Retry after 10 seconds
    setTimeout(initialize, 10000);
  }
}

// ============ START ============

// Initialize audio context and request notification permission on first user interaction
document.addEventListener('click', () => {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  requestNotificationPermission();
}, { once: true });

// Start the app
document.addEventListener('DOMContentLoaded', () => {
  restoreFreshSignalState();
  initialize();
  updateNotificationStatus();
});

// Register Service Worker for PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js')
      .then(reg => {
        console.log('Service Worker registered successfully!', reg.scope);
      })
      .catch(err => {
        console.error('Service Worker registration failed:', err);
      });
  });
}
