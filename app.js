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
  REFRESH_INTERVAL: 30000,       // 30 seconds
  PATTERN_LENGTH: 4,             // RGRG or GRGR
  CONSECUTIVE_LOSSES_FOR_SIGNAL: 2,
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
  mode: 'WATCHING',        // 'WATCHING' | 'SIGNAL_ACTIVE'
  activeSection: null,     // Key of the locked section (e.g., 'S')
  watchCandidates: [],     // Sections with 1+ losses, waiting for the first fresh trade
  sections: {},
  logs: [],
  refreshTimer: null,
  refreshProgress: 0,
  progressTimer: null,
  initialized: false,
  lastSignalSoundTime: 0,
  lastNotifiedPeriod: 0,   // Prevents spamming duplicate alerts for the same period
  tradeReadyCounter: 0
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
    consecutiveLosses: 0,      // Count of losses from SEPARATE patterns
    totalWins: 0,
    totalLosses: 0,
    betHistory: [],            // [{ period, betColor, actualColor, won }]
    patternDetected: false,
    patternColors: null,
    skipUntilTrendBreaks: false, // After loss: skip remaining trend, wait for new pattern
    isWatchCandidate: false,
    tradeReadySequence: 0,
    freshStartArmed: false,
    freshStartAnchorPeriod: 0
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
      if (section.freshStartArmed) {
        section.skipUntilTrendBreaks = true;
      }
    }
  } catch (e) {
    removeStorage(CONFIG.FRESH_SIGNAL_STORAGE_KEY);
  }
}

function addWatchCandidate(key) {
  const section = state.sections[key];
  if (section.isWatchCandidate) return;

  section.isWatchCandidate = true;
  section.tradeReadySequence = 0;
  state.watchCandidates.push(key);

  addLog(
    `👀 [${section.name}] ${section.consecutiveLosses} loss registered. Added to watchlist.`,
    'info'
  );
}

function removeWatchCandidate(key) {
  const section = state.sections[key];
  if (!section.isWatchCandidate) return;

  section.isWatchCandidate = false;
  section.tradeReadySequence = 0;
  state.watchCandidates = state.watchCandidates.filter(candidateKey => candidateKey !== key);
}

function syncWatchCandidate(key) {
  const section = state.sections[key];

  if (section.consecutiveLosses >= CONFIG.CONSECUTIVE_LOSSES_FOR_SIGNAL) {
    addWatchCandidate(key);
  } else {
    removeWatchCandidate(key);
  }
}

function markWatchTradeReady(key) {
  const section = state.sections[key];

  if (state.mode !== 'WATCHING') return;
  if (!section.isWatchCandidate || !section.pendingBet || section.tradeReadySequence) return;

  state.tradeReadyCounter++;
  section.tradeReadySequence = state.tradeReadyCounter;
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
 * Scan history with IMMEDIATE loss counting + skip-trend logic.
 * Rule: When a pattern bet LOSES → count 1 loss IMMEDIATELY, then skip
 * the rest of the alternating trend. Only bet again on a FRESH new pattern
 * that appears after the trend breaks.
 * A WIN → resets consecutive losses to 0.
 */
function scanHistoryForSection(section) {
  const periods = getEligiblePeriodsForSignals(section);

  // Reset tracking for fresh scan
  section.consecutiveLosses = 0;
  section.totalWins = 0;
  section.totalLosses = 0;
  section.betHistory = [];
  section.skipUntilTrendBreaks = false;

  if (section.freshStartArmed) {
    section.skipUntilTrendBreaks = true;
  }

  if (periods.length < CONFIG.PATTERN_LENGTH + 1) {
    checkCurrentPattern(section);
    return;
  }

  for (let i = CONFIG.PATTERN_LENGTH - 1; i < periods.length - 1; i++) {
    const patternColors = [];
    for (let j = i - (CONFIG.PATTERN_LENGTH - 1); j <= i; j++) {
      patternColors.push(getColor(periods[j]));
    }

    const isPattern = isAlternating(patternColors);

    if (isPattern) {
      if (section.skipUntilTrendBreaks) {
        // Still in the same alternating trend after a loss → skip, don't bet
        continue;
      }

      // Fresh pattern → place bet
      const betColor = patternColors[patternColors.length - 1];
      const actualColor = getColor(periods[i + 1]);
      const won = actualColor === betColor;

      section.betHistory.push({
        period: periods[i + 1].period,
        betColor,
        actualColor,
        won
      });

      if (won) {
        section.totalWins++;
        section.consecutiveLosses = 0; // Win resets everything
        section.skipUntilTrendBreaks = false;
      } else {
        section.totalLosses++;
        section.consecutiveLosses++;   // Loss counted IMMEDIATELY
        section.skipUntilTrendBreaks = true; // Skip rest of this trend
      }
    } else {
      // Pattern broken → trend ended, ready for new patterns
      section.skipUntilTrendBreaks = false;
    }
  }

  // Check for current pattern (latest 4 colors)
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
    section.skipUntilTrendBreaks = false;
    persistFreshSignalState();
  }

  const periods = getEligiblePeriodsForSignals(section);
  if (periods.length < CONFIG.PATTERN_LENGTH) {
    section.patternDetected = false;
    section.patternColors = null;
    return;
  }

  const lastN = periods.slice(-CONFIG.PATTERN_LENGTH);
  const colors = lastN.map(period => getColor(period));

  if (isAlternating(colors)) {
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
    syncWatchCandidate(key);

    addLog(`${section.emoji} [${section.name}] Loaded ${newPeriods.length} periods | Losses: ${section.consecutiveLosses}`, 'info');

    // Set pending bet if pattern detected and not skipping
    if (section.patternDetected && !section.skipUntilTrendBreaks) {
      const betColor = section.patternColors[section.patternColors.length - 1];
      section.pendingBet = { color: betColor, period: newNextPeriod };
      markWatchTradeReady(key);
      addLog(
        `${section.emoji} [${section.name}] Pattern ${section.patternColors.join('')} → Bet ${colorName(betColor)} on #${formatPeriod(newNextPeriod)}`,
        'pattern'
      );
    } else if (section.skipUntilTrendBreaks) {
      addLog(`${section.emoji} [${section.name}] Skipping current trend (lost already), waiting for trend to break`, 'info');
    }

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
      const actualColor = getColor(period);
      const won = actualColor === section.pendingBet.color;

      section.betHistory.push({
        period: period.period,
        betColor: section.pendingBet.color,
        actualColor,
        won
      });

      if (won) {
        section.totalWins++;
        section.consecutiveLosses = 0;  // Win resets loss count
        section.skipUntilTrendBreaks = false;
        section.tradeReadySequence = 0;
        addLog(
          `✅ [${section.name}] WIN! Bet ${colorName(section.pendingBet.color)}, Got ${colorName(actualColor)} (#${formatPeriod(period.period)})`,
          'win'
        );
        syncWatchCandidate(key);
        // Handle win in signal flow
        handleBetOutcome(key, true);
      } else {
        section.totalLosses++;
        section.consecutiveLosses++;     // Loss counted IMMEDIATELY
        section.skipUntilTrendBreaks = true; // Skip rest of this trend
        section.tradeReadySequence = 0;
        addLog(
          `❌ [${section.name}] LOSS #${section.consecutiveLosses}! Bet ${colorName(section.pendingBet.color)}, Got ${colorName(actualColor)}. Skipping trend, waiting for new pattern.`,
          'loss'
        );
        syncWatchCandidate(key);
        // Handle loss in signal flow
        handleBetOutcome(key, false);
      }

      section.pendingBet = null;
    }
  }

  // Update stored periods
  section.periods = newPeriods;
  section.lastKnownPeriod = latestPeriodInData;
  section.nextPeriod = newNextPeriod;

  // Check for new pattern (only if no pending bet)
  if (!section.pendingBet) {
    checkCurrentPattern(section);

    if (section.patternDetected) {
      if (section.skipUntilTrendBreaks) {
        // Still in the same alternating trend after a loss → skip, don't bet
        // Just wait for trend to break
      } else {
        // FRESH new pattern → place bet
        const betColor = section.patternColors[section.patternColors.length - 1];
        section.pendingBet = { color: betColor, period: newNextPeriod };
        markWatchTradeReady(key);
        addLog(
          `${section.emoji} [${section.name}] New pattern ${section.patternColors.join('')} → Bet ${colorName(betColor)} on #${formatPeriod(newNextPeriod)}`,
          'pattern'
        );
      }
    } else {
      // Pattern NOT found → trend is broken, ready for new patterns
      if (section.skipUntilTrendBreaks) {
        addLog(
          `🔄 [${section.name}] Trend broken. Ready for new pattern.`,
          'info'
        );
        section.skipUntilTrendBreaks = false;
      }
    }
  }
}

// ============ SIGNAL FLOW STATE MACHINE ============

function handleBetOutcome(key, won) {
  const section = state.sections[key];

  if (state.mode === 'SIGNAL_ACTIVE' && state.activeSection === key) {
    if (won) {
      // PROFIT! Reset everything
      addLog(
        `🎉 [${section.name}] PROFIT! Resetting all sections for fresh monitoring.`,
        'win'
      );

      resetAllSections();
      hideSignalBanner();

      state.mode = 'WATCHING';
      state.activeSection = null;

      playAlertSound();
      showToast('✅ Profit achieved! Fresh monitoring started.', 'success');
      sendSystemNotification(
        '🎉 PROFIT!',
        `${section.name} section mein WIN! Sab reset — fresh monitoring shuru.`
      );
    } else {
      // Loss in locked section — STAY LOCKED, wait for next pattern
      addLog(
        `⚠️ [${section.name}] Loss in locked section. Staying locked — waiting for next pattern...`,
        'loss'
      );

      // Stay on same section, just update the banner
      updateSignalBanner(key);
    }
  }
}

function resetAllSections() {
  state.watchCandidates = [];
  state.tradeReadyCounter = 0;

  for (const key of Object.keys(state.sections)) {
    const section = state.sections[key];
    section.consecutiveLosses = 0;
    section.pendingBet = null;
    section.patternDetected = false;
    section.patternColors = null;
    section.totalWins = 0;
    section.totalLosses = 0;
    section.betHistory = [];
    section.skipUntilTrendBreaks = false;
    section.isWatchCandidate = false;
    section.tradeReadySequence = 0;
    section.freshStartArmed = false;
    section.freshStartAnchorPeriod = 0;
  }

  persistFreshSignalState();
}

function startFreshSignalsNow() {
  state.mode = 'WATCHING';
  state.activeSection = null;
  state.watchCandidates = [];
  state.tradeReadyCounter = 0;
  state.lastNotifiedPeriod = 0;

  for (const section of Object.values(state.sections)) {
    const ignoreCurrentPattern = sectionHasLiveAlternatingPattern(section);
    const anchorPeriod = section.lastKnownPeriod || section.periods[section.periods.length - 1]?.period || 0;

    section.consecutiveLosses = 0;
    section.pendingBet = null;
    section.patternDetected = false;
    section.patternColors = null;
    section.totalWins = 0;
    section.totalLosses = 0;
    section.betHistory = [];
    section.isWatchCandidate = false;
    section.tradeReadySequence = 0;
    section.freshStartArmed = ignoreCurrentPattern;
    section.freshStartAnchorPeriod = anchorPeriod;
    section.skipUntilTrendBreaks = ignoreCurrentPattern;
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

/**
 * Among all watchlist sections, lock the one whose next valid trade appeared first.
 */
function lockFirstWatchTradeSection() {
  let bestKey = null;
  let earliestTrade = Infinity;

  for (const key of state.watchCandidates) {
    const section = state.sections[key];
    if (!section.pendingBet || !section.tradeReadySequence) continue;

    if (section.tradeReadySequence < earliestTrade) {
      earliestTrade = section.tradeReadySequence;
      bestKey = key;
    }
  }

  if (!bestKey) return;

  const section = state.sections[bestKey];

  state.mode = 'SIGNAL_ACTIVE';
  state.activeSection = bestKey;

  addLog(
    `🎯 [${section.name}] LOCKED! First fresh trade among watchlist sections.`,
    'signal'
  );

  playAlertSound();
  showSignalBanner(bestKey);
  showTradeAlert(bestKey);  // Full-screen popup with premium sound

  const betInfo = section.pendingBet
    ? `Bet ${colorName(section.pendingBet.color)} on #${formatPeriod(section.pendingBet.period)}`
    : 'Waiting for pattern...';
  sendSystemNotification(
    `🎯 LOCKED: ${section.name}`,
    `Watchlist winner — ${betInfo}`
  );
}

function checkSignalConditions() {
  if (state.mode === 'WATCHING') {
    lockFirstWatchTradeSection();
  }
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
  document.getElementById(`streak-${key}`).textContent = `Loss: ${section.consecutiveLosses}/${CONFIG.CONSECUTIVE_LOSSES_FOR_SIGNAL}`;

  // Show skip indicator
  if (section.skipUntilTrendBreaks) {
    document.getElementById(`streak-${key}`).textContent += ' ⏸️';
  }

  // Section status badge
  const statusEl = document.getElementById(`status-${key}`);
  if (state.mode === 'SIGNAL_ACTIVE' && state.activeSection === key) {
    statusEl.textContent = '🎯 LOCKED';
    statusEl.className = 'section-status status-signal';
  } else if (state.mode === 'SIGNAL_ACTIVE' && state.activeSection !== key) {
    statusEl.textContent = 'Paused';
    statusEl.className = 'section-status status-paused';
  } else if (hasFreshSignalState(section)) {
    statusEl.textContent = 'Fresh Reset';
    statusEl.className = 'section-status status-watching';
  } else if (section.isWatchCandidate) {
    statusEl.textContent = '1L Watch';
    statusEl.className = 'section-status status-hunting';
  } else if (section.patternDetected) {
    statusEl.textContent = 'Pattern!';
    statusEl.className = 'section-status status-pattern';
  } else {
    statusEl.textContent = 'Watching';
    statusEl.className = 'section-status status-watching';
  }

  // Card classes
  const cardEl = document.getElementById(`card-${key}`);
  cardEl.classList.remove('active', 'signal-triggered', 'paused', 'hunting');

  if (state.mode === 'SIGNAL_ACTIVE') {
    if (state.activeSection === key) {
      cardEl.classList.add('signal-triggered');
    } else {
      cardEl.classList.add('paused');
    }
  } else if (section.isWatchCandidate) {
    cardEl.classList.add('hunting');
  } else if (section.patternDetected) {
    cardEl.classList.add('active');
  }

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

  if (state.mode === 'WATCHING') {
    const watchedSections = state.watchCandidates.map(key => state.sections[key].name);

    modeText.textContent = freshResetActive ? 'FRESH WATCH' : 'WATCHING';
    modeText.className = freshResetActive ? 'value reset-mode' : 'value watching-mode';
    activeSectionText.textContent = watchedSections.length > 0
      ? watchedSections.join(', ')
      : 'All Sections';
    if (watchedSections.length > 0) {
      appStatus.textContent = 'WATCHING 1L';
    } else if (freshResetActive) {
      appStatus.textContent = 'FRESH START';
    } else {
      appStatus.textContent = 'WATCHING ALL';
    }
    appStatus.className = 'status-badge watching';

    if (watchedSections.length > 0) {
      nextSignalText.textContent = `Waiting for first fresh trade in: ${watchedSections.join(', ')}`;
    } else if (freshResetActive) {
      nextSignalText.textContent = 'Fresh reset active. Waiting for current trend to clear and new pattern to form.';
    } else {
      nextSignalText.textContent = 'Monitoring...';
    }
    nextSignalText.style.color = '';

  } else if (state.mode === 'SIGNAL_ACTIVE' && state.activeSection) {
    const section = state.sections[state.activeSection];
    modeText.textContent = '🎯 LOCKED';
    modeText.className = 'value signal-mode';
    activeSectionText.textContent = `${section.emoji} ${section.name} (${section.consecutiveLosses} loss)`;
    appStatus.textContent = `🎯 ${section.name.toUpperCase()}`;
    appStatus.className = 'status-badge signal-active';

    if (section.pendingBet) {
      nextSignalText.textContent = `Bet ${colorName(section.pendingBet.color)} on #${formatPeriod(section.pendingBet.period)}`;
      nextSignalText.style.color = section.pendingBet.color === 'G' ? 'var(--color-green)' : 'var(--color-red)';
    } else {
      nextSignalText.textContent = 'Waiting for next pattern in locked section...';
      nextSignalText.style.color = '';
    }
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

  mainText.textContent = `🎯 LOCKED ON: ${section.name.toUpperCase()}`;

  if (section.pendingBet) {
    const betColor = colorName(section.pendingBet.color);
    const periodStr = formatPeriod(section.pendingBet.period);
    subText.textContent = `Next Bet: ${betColor} on Period #${periodStr}`;
    banner.className = `signal-banner signal-${betColor.toLowerCase()}`;
    
    // Notification logic
    const period = section.pendingBet.period;
    if (state.lastNotifiedPeriod !== period) {
      state.lastNotifiedPeriod = period;
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
    if (state.lastNotifiedPeriod !== uniqueKey) {
      state.lastNotifiedPeriod = uniqueKey;
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
    if (state.lastNotifiedPeriod !== period) {
      state.lastNotifiedPeriod = period;
      showTradeAlert(key);  // Show full-screen popup for new bet in locked section
      sendSystemNotification(
        `🚨 Wingo: ${section.name} Bet`,
        `Next Bet: ${betColor} on Period #${periodStr}!`
      );
    }
  } else {
    subText.textContent = `Losses: ${section.consecutiveLosses} — Waiting for next pattern...`;
  }
}

function hideSignalBanner() {
  const banner = document.getElementById('signal-banner');
  banner.classList.add('hidden');
  document.getElementById('app-header').style.paddingTop = '';
}

// ============ TRADE ALERT POPUP ============

let tradeAlertSoundInterval = null;

function showTradeAlert(sectionKey) {
  const section = state.sections[sectionKey];
  if (!section || !section.pendingBet) return;

  const overlay = document.getElementById('trade-alert-overlay');
  const modal = overlay.querySelector('.trade-alert-modal');
  const icon = document.getElementById('trade-alert-icon');
  const title = document.getElementById('trade-alert-title');
  const sectionEl = document.getElementById('trade-alert-section');
  const badge = document.getElementById('trade-alert-badge');
  const colorText = document.getElementById('trade-alert-color-text');
  const periodEl = document.getElementById('trade-alert-period');
  const messageEl = document.getElementById('trade-alert-message');

  const betColor = section.pendingBet.color;
  const betColorName = colorName(betColor);
  const periodStr = formatPeriod(section.pendingBet.period);
  const isGreen = betColor === 'G';

  // Set content
  icon.textContent = '🚨';
  title.textContent = 'TRADE AA GYA!';
  sectionEl.textContent = `${section.emoji} ${section.name} — LOCKED`;
  colorText.textContent = betColorName;
  periodEl.textContent = `Period #${periodStr}`;
  messageEl.textContent = `Abhi ${betColorName} pe bet lagao! Jaldi karo!`;

  // Set color mode
  modal.classList.toggle('green-mode', isGreen);
  badge.className = `trade-alert-color-badge badge-${betColorName.toLowerCase()}`;

  // Remove old sound bar, add new
  modal.querySelectorAll('.trade-alert-sound-bar').forEach(el => el.remove());
  const soundBar = document.createElement('div');
  soundBar.className = 'trade-alert-sound-bar';
  modal.appendChild(soundBar);

  // Spawn particles
  spawnTradeParticles(isGreen ? '#2ED573' : '#FF4757');

  // Show overlay
  overlay.classList.remove('hidden');

  // Play the premium trade sound immediately
  playTradeReadySound();

  // Repeat sound every 4 seconds until dismissed
  clearInterval(tradeAlertSoundInterval);
  tradeAlertSoundInterval = setInterval(() => {
    playTradeReadySound();
  }, 4000);

  // Auto dismiss after 30 seconds
  if (showTradeAlert._autoDismissTimer) clearTimeout(showTradeAlert._autoDismissTimer);
  showTradeAlert._autoDismissTimer = setTimeout(() => {
    dismissTradeAlert();
  }, 30000);
}

function dismissTradeAlert() {
  const overlay = document.getElementById('trade-alert-overlay');
  overlay.classList.add('hidden');

  // Stop repeated sound
  clearInterval(tradeAlertSoundInterval);
  tradeAlertSoundInterval = null;

  // Clear auto dismiss
  if (showTradeAlert._autoDismissTimer) {
    clearTimeout(showTradeAlert._autoDismissTimer);
    showTradeAlert._autoDismissTimer = null;
  }

  // Clear particles
  const particlesContainer = document.getElementById('trade-particles');
  particlesContainer.innerHTML = '';
}

function spawnTradeParticles(color) {
  const container = document.getElementById('trade-particles');
  container.innerHTML = '';

  const particleColors = [color, '#38bdf8', '#a855f7', '#F59E0B', '#22D3EE'];

  for (let i = 0; i < 30; i++) {
    const particle = document.createElement('div');
    particle.className = 'trade-particle';
    particle.style.left = `${Math.random() * 100}%`;
    particle.style.backgroundColor = particleColors[Math.floor(Math.random() * particleColors.length)];
    particle.style.animationDelay = `${Math.random() * 3}s`;
    particle.style.animationDuration = `${2 + Math.random() * 2}s`;
    particle.style.width = `${4 + Math.random() * 6}px`;
    particle.style.height = particle.style.width;
    container.appendChild(particle);
  }
}

// Expose functions globally
window.dismissTradeAlert = dismissTradeAlert;

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

// ============ MAIN LOOP ============

async function refresh() {
  try {
    const allData = await fetchAllSections();

    for (const [key, data] of Object.entries(allData)) {
      processNewData(key, data);
    }

    // Check signal conditions after processing all sections
    checkSignalConditions();

    // If signal is active, update banner
    if (state.mode === 'SIGNAL_ACTIVE' && state.activeSection) {
      updateSignalBanner(state.activeSection);
    }

    renderAll();
    startRefreshProgress();

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

    // Start auto-refresh
    state.refreshTimer = setInterval(refresh, CONFIG.REFRESH_INTERVAL);
    startRefreshProgress();

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
