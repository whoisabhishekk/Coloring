/* ==============================================
   WINGO STRATEGY DASHBOARD - Application Logic
   Pattern Detection | Signal System | Live Data
   ============================================== */

// ============ CONFIGURATION ============
const CONFIG = {
  // Local proxy handles CORS — requests go to /api/win/... → proxied to cooe02.in
  API_BASE: '/api',
  FRESH_SIGNAL_STORAGE_KEY: 'wingo-fresh-signal-state',
  RGRG_LOCK_STORAGE_KEY: 'wingo-rgrg-virtual-lock-state-v2',
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
  lastBoundaryFetch: 0,      // Timestamp of last boundary-triggered fetch
  selectedStrategy: localStorage.getItem('wingo-selected-strategy') || 'RGRG_LOCK_RESET',
  rgrgActiveSectionKey: null
};

// Initialize section states
for (const [key, info] of Object.entries(CONFIG.SECTIONS)) {
  state.sections[key] = {
    name: info.name,
    emoji: info.emoji,
    periods: [],
    lastKnownPeriod: 0,
    nextPeriod: 0,
    pendingBet: null,          // { color: 'R'|'G', period: number, isVirtual: boolean }
    totalWins: 0,
    totalLosses: 0,
    betHistory: [],            // [{ period, betColor, actualColor, won }]
    patternDetected: false,
    patternColors: null,
    freshStartArmed: false,
    freshStartAnchorPeriod: 0,
    strategyState: 'HUNTING',   // 'HUNTING' | 'SIGNAL_ACTIVE' | 'WAITING_FOR_TREND_BREAK' | 'READY_FOR_LIVE'
    lastNotifiedPeriod: 0,
    disabled: false,
    virtualLossCount: 0,
    recoveryAttempt: 0,          // 0 = fresh, 1/2/3 = recovery attempts used (RECOVERY_3_CHANCE)
    // RGRG Virtual Lock state
    lockLossCount: 0,             // Kept in sync with virtualLossCount for legacy UI state.
    rgrgLocked: false,
    rgrgLiveLoss: false,
    // Consecutive loss tracker (independent — virtual + live both count)
    consecLossStreak: 0,          // Current consecutive loss streak
    maxConsecLossStreak: 0,       // Max consecutive loss streak ever seen
    hit6ConsecLosses: false,      // True if 6+ consecutive losses ever happened
    consecLoss6Count: 0,          // How many times 6+ streak happened
    // Anti-Martingale state
    amConsecutiveWins: 0,
    amCurrentBet: 10,
    amTotalPNL: 0,
    amStopped: false,
    amStopReason: '',
    // Streak 5 Continue state
    streak5Level: 0,
    streak5TotalPNL: 0
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

/** Check if colors form an alternating pattern */
function isAlternating(colors) {
  if (colors.length < 2) return false;
  for (let i = 1; i < colors.length; i++) {
    if (colors[i] === colors[i - 1]) return false;
  }
  return true;
}

// ============ ANTI-MARTINGALE CONFIG ============
const AM_CONFIG = {
  BET_LADDER: [10, 20, 40, 50],
  STOP_LOSS: -60,
  TAKE_PROFIT: 200,
  STARTING_CAPITAL: 150,
  ALLOWED_SECTIONS: ['B', 'E'],
  WIN_MULTIPLIER: 0.96
};

// ============ STREAK 5 CONTINUE CONFIG ============
const STREAK5_CONFIG = {
  STREAK_LENGTH: 5,
  BET_LADDER: [10, 20, 40, 80],
  ALLOWED_SECTIONS: ['B', 'E'],
  WIN_MULTIPLIER: 0.96
};

function getAMBetAmount(consecutiveWins) {
  const idx = Math.min(consecutiveWins, AM_CONFIG.BET_LADDER.length - 1);
  return AM_CONFIG.BET_LADDER[idx];
}

/** Get opposite color */
function opposite(c) {
  return c === 'G' ? 'R' : 'G';
}

function getStrategyPatternLength(strategy) {
  if (strategy === 'RGRG_TREND_BREAK' || strategy === 'SNIPER_3_LOSS_RGRG' || strategy === 'RECOVERY_3_CHANCE' || strategy === 'ANTI_MARTINGALE_SELECT' || strategy === 'RGRG_LOCK_RESET') {
    return 4;
  } else if (strategy === 'BREAK_OPPOSITE' || strategy === 'STREAK_BREAK_3') {
    return 3;
  } else if (strategy === 'CONTRARIAN_DOUBLE') {
    return 2;
  } else if (strategy === 'STREAK_5_CONTINUE') {
    return 5;
  }
  return 4;
}

function getLatestAlternatingColors(periods, len = 4) {
  if (periods.length < len) return null;

  const colors = periods
    .slice(-len)
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

function isRgrgLockStrategy(strategy = state.selectedStrategy) {
  return strategy === 'RGRG_LOCK_RESET';
}

function isRgrgSectionLocked(section, strategy = state.selectedStrategy) {
  if (!isRgrgLockStrategy(strategy) || !state.rgrgActiveSectionKey) return false;
  return state.sections[state.rgrgActiveSectionKey] !== section;
}

function clearRgrgSectionLock(section) {
  section.virtualLossCount = 0;
  section.lockLossCount = 0;
  section.rgrgLocked = false;
}

function syncRgrgSectionLocks() {
  for (const [key, section] of Object.entries(state.sections)) {
    section.rgrgLocked = Boolean(state.rgrgActiveSectionKey && key !== state.rgrgActiveSectionKey);
  }
}

function selectRgrgSection(key) {
  if (state.rgrgActiveSectionKey && state.rgrgActiveSectionKey !== key) return false;

  state.rgrgActiveSectionKey = key;
  for (const [otherKey, section] of Object.entries(state.sections)) {
    if (otherKey === key) continue;
    section.pendingBet = null;
    section.patternDetected = false;
    section.patternColors = null;
    section.strategyState = 'HUNTING';
  }
  syncRgrgSectionLocks();
  persistRgrgLockState();
  return true;
}

function resetRgrgCycle() {
  state.rgrgActiveSectionKey = null;
  for (const section of Object.values(state.sections)) {
    section.pendingBet = null;
    section.patternDetected = false;
    section.patternColors = null;
    section.strategyState = 'HUNTING';
    clearRgrgSectionLock(section);
  }
  persistRgrgLockState();
}

function persistRgrgLockState() {
  const sections = {};
  let hasState = Boolean(state.rgrgActiveSectionKey);

  for (const [key, section] of Object.entries(state.sections)) {
    const count = Math.max(0, Number(section.virtualLossCount) || 0);
    // Persist if there's an ongoing bet, loss count, or any loss streak history
    if (!count && !section.pendingBet && !section.consecLossStreak && !section.maxConsecLossStreak) continue;
    
    hasState = true;
    sections[key] = {
      virtualLossCount: count,
      strategyState: section.strategyState,
      pendingBet: section.pendingBet,
      consecLossStreak: section.consecLossStreak || 0,
      maxConsecLossStreak: section.maxConsecLossStreak || 0,
      totalLosses: section.totalLosses || 0,
      rgrgLiveLoss: section.rgrgLiveLoss || false,
      hit6ConsecLosses: section.hit6ConsecLosses || false,
      consecLoss6Count: section.consecLoss6Count || 0
    };
  }

  if (!hasState) {
    removeStorage(CONFIG.RGRG_LOCK_STORAGE_KEY);
    return;
  }

  writeStorage(
    CONFIG.RGRG_LOCK_STORAGE_KEY,
    JSON.stringify({ version: 3, activeSectionKey: state.rgrgActiveSectionKey, sections })
  );
}

function restoreRgrgLockState() {
  const raw = readStorage(CONFIG.RGRG_LOCK_STORAGE_KEY);
  if (!raw) return;

  try {
    const parsed = JSON.parse(raw);
    if (parsed.version !== 2 && parsed.version !== 3) {
      removeStorage(CONFIG.RGRG_LOCK_STORAGE_KEY);
      return;
    }

    const savedSections = parsed.sections || {};
    const activeKey = parsed.activeSectionKey;
    state.rgrgActiveSectionKey = state.sections[activeKey] ? activeKey : null;

    for (const [key, saved] of Object.entries(savedSections)) {
      const section = state.sections[key];
      if (!section) continue;

      section.virtualLossCount = Math.min(3, Math.max(0, Number(saved.virtualLossCount) || 0));
      section.lockLossCount = section.virtualLossCount;
      section.pendingBet = saved.pendingBet || null;
      section.strategyState = saved.strategyState || (section.virtualLossCount >= 3 ? 'READY_FOR_LIVE' : 'HUNTING');
      
      section.consecLossStreak = saved.consecLossStreak || 0;
      section.maxConsecLossStreak = saved.maxConsecLossStreak || 0;
      section.totalLosses = saved.totalLosses || 0;
      section.rgrgLiveLoss = saved.rgrgLiveLoss || false;
      section.hit6ConsecLosses = saved.hit6ConsecLosses || false;
      section.consecLoss6Count = saved.consecLoss6Count || 0;
    }
    syncRgrgSectionLocks();
  } catch (e) {
    removeStorage(CONFIG.RGRG_LOCK_STORAGE_KEY);
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
window.changeStrategy = changeStrategy;
window.toggleSection = toggleSection;

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
  const strategy = state.selectedStrategy || 'SNIPER_3_LOSS_RGRG';
  const len = getStrategyPatternLength(strategy);
  if (section.periods.length < len) return false;

  const colors = section.periods
    .slice(-len)
    .map(period => getColor(period));

  if (strategy === 'RGRG_TREND_BREAK' || strategy === 'SNIPER_3_LOSS_RGRG' || strategy === 'RECOVERY_3_CHANCE' || strategy === 'ANTI_MARTINGALE_SELECT' || strategy === 'RGRG_LOCK_RESET') {
    return isAlternating(colors);
  } else if (strategy === 'CONTRARIAN_DOUBLE') {
    return colors[0] === colors[1];
  } else if (strategy === 'BREAK_OPPOSITE') {
    return colors[0] !== colors[1] && colors[1] === colors[2];
  } else if (strategy === 'STREAK_BREAK_3') {
    return colors[0] === colors[1] && colors[1] === colors[2];
  } else if (strategy === 'STREAK_5_CONTINUE') {
    return colors.every(c => c === colors[0]);
  }
  return false;
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
  const strategy = state.selectedStrategy || 'SNIPER_3_LOSS_RGRG';

  // Show signal banner at top
  showSignalBanner(key);

  // Play the trade ready sound (no popup)
  playTradeReadySound();

  // Send push notification with recovery info
  let notifTitle = `🎯 TRADE: ${section.name}`;
  let notifBody = `Bet ${betColor} on Period #${periodStr}!`;
  if (strategy === 'RECOVERY_3_CHANCE') {
    const attemptNum = section.recoveryAttempt + 1;
    const attemptLabel = attemptNum === 1 ? 'Signal #1' : attemptNum === 2 ? 'Recovery #2' : 'LAST Chance #3';
    notifTitle = `🎯 ${attemptLabel}: ${section.name}`;
    notifBody = `Bet ${betColor} on Period #${periodStr}! (Attempt ${attemptNum}/3)`;
  } else if (strategy === 'STREAK_5_CONTINUE') {
    const betAmt = STREAK5_CONFIG.BET_LADDER[section.streak5Level || 0];
    notifTitle = `🔥 5-Streak: ${section.name}`;
    notifBody = `Bet ${betColor} ₹${betAmt} (Lv${(section.streak5Level || 0) + 1}) on #${periodStr}!`;
  }
  sendSystemNotification(notifTitle, notifBody);

  addLog(
    `🚨 [${section.name}] TRADE SIGNAL! Bet ${betColor} on #${periodStr}`,
    'signal'
  );
}

function armBetFromCurrentPattern(key, nextPeriod) {
  const section = state.sections[key];
  const strategy = state.selectedStrategy || 'RGRG_LOCK_RESET';
  if (section.disabled || isRgrgSectionLocked(section, strategy)) return false;
  if (strategy === 'ANTI_MARTINGALE_SELECT' && !AM_CONFIG.ALLOWED_SECTIONS.includes(key)) return false;
  if (strategy === 'ANTI_MARTINGALE_SELECT' && section.amStopped) return false;
  if (strategy === 'STREAK_5_CONTINUE' && !STREAK5_CONFIG.ALLOWED_SECTIONS.includes(key)) return false;
  if (section.pendingBet || (section.strategyState !== 'HUNTING' && section.strategyState !== 'READY_FOR_LIVE')) return false;

  checkCurrentPattern(section);
  if (!section.patternDetected || !section.patternColors) return false;

  let betColor = null;

  if (strategy === 'RGRG_TREND_BREAK' || strategy === 'SNIPER_3_LOSS_RGRG' || strategy === 'RECOVERY_3_CHANCE' || strategy === 'ANTI_MARTINGALE_SELECT' || strategy === 'RGRG_LOCK_RESET') {
    betColor = section.patternColors[section.patternColors.length - 1];
  } else if (strategy === 'CONTRARIAN_DOUBLE') {
    betColor = opposite(section.patternColors[section.patternColors.length - 1]);
  } else if (strategy === 'BREAK_OPPOSITE') {
    betColor = opposite(section.patternColors[section.patternColors.length - 1]);
  } else if (strategy === 'STREAK_BREAK_3') {
    betColor = opposite(section.patternColors[section.patternColors.length - 1]);
  } else if (strategy === 'STREAK_5_CONTINUE') {
    betColor = section.patternColors[section.patternColors.length - 1];
  }

  if (strategy === 'SNIPER_3_LOSS_RGRG') {
    if (section.strategyState === 'READY_FOR_LIVE') {
      // Sniper is ready, make a LIVE bet
      section.pendingBet = { color: betColor, period: nextPeriod, isVirtual: false };
      section.strategyState = 'SIGNAL_ACTIVE';
      showTradeSignal(key);
      addLog(
        `🎯 [${section.name}] Sniper ARMED! Pattern ${section.patternColors.join('')} → LIVE Bet ${colorName(betColor)} on #${formatPeriod(nextPeriod)}`,
        'pattern'
      );
    } else {
      // Virtual bet to count virtual losses
      section.pendingBet = { color: betColor, period: nextPeriod, isVirtual: true };
      addLog(
        `👁️ [${section.name}] Sniper Hunt: Pattern ${section.patternColors.join('')} → Virtual Bet ${colorName(betColor)} on #${formatPeriod(nextPeriod)} (Virtual Losses: ${section.virtualLossCount}/3)`,
        'info'
      );
    }
  } else if (strategy === 'RECOVERY_3_CHANCE') {
    // Recovery 3-Chance: ALL bets are LIVE, max 3 per trend cycle
    const attemptNum = section.recoveryAttempt + 1; // 1st, 2nd, or 3rd attempt
    const attemptLabel = attemptNum === 1 ? '🎯 Signal #1' : attemptNum === 2 ? '🔄 Recovery #2' : '⚠️ LAST Chance #3';
    section.pendingBet = { color: betColor, period: nextPeriod, isVirtual: false };
    section.strategyState = 'SIGNAL_ACTIVE';
    showTradeSignal(key);
    addLog(
      `${attemptLabel} [${section.name}] Pattern ${section.patternColors.join('')} → LIVE Bet ${colorName(betColor)} on #${formatPeriod(nextPeriod)} (Attempt ${attemptNum}/3)`,
      'signal'
    );
  } else if (strategy === 'STREAK_5_CONTINUE') {
    const betAmt = STREAK5_CONFIG.BET_LADDER[section.streak5Level];
    section.pendingBet = { color: betColor, period: nextPeriod, isVirtual: false, streak5BetAmount: betAmt };
    section.strategyState = 'SIGNAL_ACTIVE';
    showTradeSignal(key);
    addLog(
      `🔥 [${section.name}] 5-Streak! ${section.patternColors.join('')} → Bet ${colorName(betColor)} ₹${betAmt} (Lv${section.streak5Level + 1}) on #${formatPeriod(nextPeriod)}`,
      'signal'
    );
  } else if (strategy === 'RGRG_LOCK_RESET') {
    const isSelected = state.rgrgActiveSectionKey === key;
    const shouldGoLive = isSelected || section.virtualLossCount >= 3;

    if (shouldGoLive) {
      if (!isSelected && !selectRgrgSection(key)) return false;
      section.pendingBet = { color: betColor, period: nextPeriod, isVirtual: false };
      section.strategyState = 'SIGNAL_ACTIVE';
      persistRgrgLockState();
      showTradeSignal(key);
      addLog(
        `🎯 [${section.name}] 4th BET LIVE! RGRG ${section.patternColors.join('')} → ${colorName(betColor)} on #${formatPeriod(nextPeriod)}. Section locked until profit.`,
        'signal'
      );
    } else {
      section.pendingBet = { color: betColor, period: nextPeriod, isVirtual: true };
      section.strategyState = 'HUNTING';
      persistRgrgLockState();
      addLog(
        `👁️ [${section.name}] Virtual Bet ${section.virtualLossCount + 1}/3: ${colorName(betColor)} on #${formatPeriod(nextPeriod)}.`,
        'info'
      );
    }
  } else {
    // Standard direct live bet
    section.pendingBet = { color: betColor, period: nextPeriod, isVirtual: false };
    section.strategyState = 'SIGNAL_ACTIVE';
    showTradeSignal(key);
    addLog(
      `🎯 [${section.name}] Pattern ${section.patternColors.join('')} → LIVE Bet ${colorName(betColor)} on #${formatPeriod(nextPeriod)}`,
      'signal'
    );
  }

  return true;
}

function resolveRgrgBet(key, period) {
  const section = state.sections[key];
  const resolvedBet = section.pendingBet;
  if (!resolvedBet || resolvedBet.period !== period.period) return false;

  section.pendingBet = null;
  const actualColor = getColor(period);
  const won = actualColor === resolvedBet.color;

  if (resolvedBet.isVirtual) {
    if (won) {
      section.virtualLossCount = 0;
      section.lockLossCount = 0;
      section.consecLossStreak = 0;
      section.strategyState = 'HUNTING';
      flashLagatarReset(key);
      addLog(
        `👁️ [${section.name}] Virtual WIN on #${formatPeriod(period.period)}. Counter reset to 0/3.`,
        'info'
      );
    } else {
      section.virtualLossCount = Math.min(3, section.virtualLossCount + 1);
      section.lockLossCount = section.virtualLossCount;
      section.consecLossStreak++;
      section.maxConsecLossStreak = Math.max(section.maxConsecLossStreak, section.consecLossStreak);
      checkConsecLoss6Alert(key, section);
      section.strategyState = 'WAITING_FOR_TREND_BREAK';
      section.rgrgLiveLoss = false;
      addLog(
        `👁️ [${section.name}] Virtual LOSS on #${formatPeriod(period.period)}. ${section.virtualLossCount}/3 complete; waiting for trend break. (Consec: ${section.consecLossStreak})`,
        'info'
      );
    }
    persistRgrgLockState();
    return true;
  }

  section.betHistory.push({
    period: period.period,
    betColor: resolvedBet.color,
    actualColor,
    won
  });
  hideSignalBanner();

  if (won) {
    section.totalWins++;
    section.consecLossStreak = 0;
    addLog(
      `✅ [${section.name}] PROFIT! Bet ${colorName(resolvedBet.color)}, Got ${colorName(actualColor)} (#${formatPeriod(period.period)}). Full cycle reset.`,
      'win'
    );
    playAlertSound();
    showToast(`✅ ${section.name} PROFIT! Cycle reset.`, 'success');
    // Flash lagatar reset on all sections (resetRgrgCycle clears all)
    for (const sKey of Object.keys(state.sections)) {
      flashLagatarReset(sKey);
    }
    resetRgrgCycle();
  } else {
    section.totalLosses++;
    section.consecLossStreak++;
    section.maxConsecLossStreak = Math.max(section.maxConsecLossStreak, section.consecLossStreak);
    checkConsecLoss6Alert(key, section);
    section.strategyState = 'WAITING_FOR_TREND_BREAK';
    section.rgrgLiveLoss = true;
    section.virtualLossCount = 3;
    section.lockLossCount = 3;
    addLog(
      `❌ [${section.name}] LIVE LOSS! Bet ${colorName(resolvedBet.color)}, Got ${colorName(actualColor)}. (Consec: ${section.consecLossStreak}) Waiting for trend break.`,
      'loss'
    );
    showToast(`❌ ${section.name} loss. Waiting for trend break.`, 'error');
    persistRgrgLockState();
  }

  return true;
}

/** Check if consecutive loss streak hit 6 and fire alert */
function checkConsecLoss6Alert(key, section) {
  if (section.consecLossStreak >= 6) {
    if (section.consecLossStreak === 6 || section.consecLossStreak % 6 === 0) {
      section.hit6ConsecLosses = true;
      section.consecLoss6Count++;
      addLog(
        `🚨💀 [${section.name}] 6 CONSECUTIVE LOSSES! Streak: ${section.consecLossStreak} | Times hit: ${section.consecLoss6Count}`,
        'loss'
      );
      showToast(`💀 ${section.name}: ${section.consecLossStreak} consecutive losses!`, 'error');
      sendSystemNotification(
        `💀 6 CONSEC LOSS: ${section.name}`,
        `${section.consecLossStreak} consecutive losses (virtual+live)! Times hit: ${section.consecLoss6Count}`
      );
    }
  }
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
  section.virtualLossCount = 0;
  section.recoveryAttempt = 0;
  section.lockLossCount = 0;
  section.rgrgLocked = false;

  if (periods.length === 0) {
    checkCurrentPattern(section);
    return;
  }

  const strategy = state.selectedStrategy || 'SNIPER_3_LOSS_RGRG';
  const len = getStrategyPatternLength(strategy);
  let activeBet = null; // { color, period, isVirtual }
  let virtualLossCount = 0;
  let recoveryAttempt = 0;
  let consecLossStreak = 0;
  let rgrgHistoryLiveLoss = false;

  for (let i = 0; i < periods.length; i++) {
    // Resolve active bet
    if (activeBet && periods[i].period === activeBet.period) {
      const actualColor = getColor(periods[i]);
      const won = actualColor === activeBet.color;

      if (activeBet.isVirtual) {
        // Virtual bet resolution (Sniper mode)
        if (won) {
          virtualLossCount = 0;
          consecLossStreak = 0;
          section.strategyState = 'HUNTING';
        } else {
          virtualLossCount++;
          consecLossStreak++;
          section.strategyState = 'WAITING_FOR_TREND_BREAK';
          rgrgHistoryLiveLoss = false;
        }
      } else {
        // LIVE bet resolution
        section.betHistory.push({
          period: periods[i].period,
          betColor: activeBet.color,
          actualColor,
          won
        });

        if (won) {
          section.totalWins++;
          consecLossStreak = 0;
          section.strategyState = 'HUNTING';
          if (strategy === 'RGRG_LOCK_RESET') virtualLossCount = 0;
          if (strategy === 'ANTI_MARTINGALE_SELECT') {
            section.amConsecutiveWins++;
            const betAmt = activeBet.amBetAmount || getAMBetAmount(Math.max(0, section.amConsecutiveWins - 1));
            section.amTotalPNL += betAmt * AM_CONFIG.WIN_MULTIPLIER;
            section.amCurrentBet = getAMBetAmount(section.amConsecutiveWins);
            if (section.amTotalPNL >= AM_CONFIG.TAKE_PROFIT) {
              section.amStopped = true;
              section.amStopReason = 'TAKE_PROFIT';
            }
          }
          if (strategy === 'RECOVERY_3_CHANCE') {
            recoveryAttempt = 0;
          }
          if (strategy === 'STREAK_5_CONTINUE') {
            const betAmt = STREAK5_CONFIG.BET_LADDER[section.streak5Level];
            section.streak5TotalPNL += betAmt * STREAK5_CONFIG.WIN_MULTIPLIER;
            section.streak5Level = 0;
          }
        } else {
          section.totalLosses++;
          consecLossStreak++;
          if (strategy === 'ANTI_MARTINGALE_SELECT') {
            const betAmt = activeBet.amBetAmount || getAMBetAmount(section.amConsecutiveWins);
            section.amTotalPNL -= betAmt;
            section.amConsecutiveWins = 0;
            section.amCurrentBet = AM_CONFIG.BET_LADDER[0];
            if (section.amTotalPNL <= AM_CONFIG.STOP_LOSS) {
              section.amStopped = true;
              section.amStopReason = 'STOP_LOSS';
            }
          }
          if (strategy === 'STREAK_5_CONTINUE') {
            const betAmt = STREAK5_CONFIG.BET_LADDER[section.streak5Level];
            section.streak5TotalPNL -= betAmt;
            section.streak5Level++;
            if (section.streak5Level >= STREAK5_CONFIG.BET_LADDER.length) {
              section.streak5Level = 0;
            }
          }
          if (strategy === 'RECOVERY_3_CHANCE') {
            recoveryAttempt++;
            if (recoveryAttempt >= 3) {
              section.strategyState = 'WAITING_FOR_TREND_BREAK';
              recoveryAttempt = 0;
            } else {
              section.strategyState = 'HUNTING'; // Keep hunting in same trend
            }
          } else if (strategy === 'RGRG_TREND_BREAK' || strategy === 'SNIPER_3_LOSS_RGRG') {
            section.strategyState = 'WAITING_FOR_TREND_BREAK';
            rgrgHistoryLiveLoss = true;
          } else if (strategy === 'ANTI_MARTINGALE_SELECT') {
            section.strategyState = 'HUNTING';
          } else if (strategy === 'RGRG_LOCK_RESET') {
            virtualLossCount = 3;
            section.strategyState = 'WAITING_FOR_TREND_BREAK';
            rgrgHistoryLiveLoss = true;
          } else {
            section.strategyState = 'HUNTING';
          }
        }
        if (strategy !== 'RGRG_LOCK_RESET') virtualLossCount = 0;
      }

      activeBet = null;
    }

    if (activeBet) continue;

    // Check for trend break if we are waiting for one
    if (section.strategyState === 'WAITING_FOR_TREND_BREAK') {
      if (i > 0 && getColor(periods[i - 1]) === getColor(periods[i])) {
        if (rgrgHistoryLiveLoss) {
          section.strategyState = 'HUNTING';
          virtualLossCount = 0;
          recoveryAttempt = 0;
          rgrgHistoryLiveLoss = false;
        } else {
          if (virtualLossCount >= 3) {
            section.strategyState = 'READY_FOR_LIVE';
          } else {
            section.strategyState = 'HUNTING';
          }
        }
      }
    }

    if (section.strategyState !== 'HUNTING' && section.strategyState !== 'READY_FOR_LIVE') continue;

    // Hunt for pattern
    if (i < len - 1) continue;

    const patternColors = periods
      .slice(i - len + 1, i + 1)
      .map(period => getColor(period));

    let patternDetected = false;
    let betColor = null;

    if (strategy === 'RGRG_TREND_BREAK' || strategy === 'SNIPER_3_LOSS_RGRG' || strategy === 'RECOVERY_3_CHANCE' || strategy === 'ANTI_MARTINGALE_SELECT' || strategy === 'RGRG_LOCK_RESET') {
      if (isAlternating(patternColors)) {
        patternDetected = true;
        betColor = patternColors[patternColors.length - 1];
      }
    } else if (strategy === 'CONTRARIAN_DOUBLE') {
      if (patternColors[0] === patternColors[1]) {
        patternDetected = true;
        betColor = opposite(patternColors[1]);
      }
    } else if (strategy === 'BREAK_OPPOSITE') {
      if (patternColors[0] !== patternColors[1] && patternColors[1] === patternColors[2]) {
        patternDetected = true;
        betColor = opposite(patternColors[2]);
      }
    } else if (strategy === 'STREAK_BREAK_3') {
      if (patternColors[0] === patternColors[1] && patternColors[1] === patternColors[2]) {
        patternDetected = true;
        betColor = opposite(patternColors[2]);
      }
    } else if (strategy === 'STREAK_5_CONTINUE') {
      if (patternColors.every(c => c === patternColors[0])) {
        patternDetected = true;
        betColor = patternColors[patternColors.length - 1];
      }
    }

    if (!patternDetected) continue;
    if (i + 1 >= periods.length) continue;

    const nextPeriod = periods[i + 1].period;

    if (strategy === 'RGRG_LOCK_RESET') {
      if (virtualLossCount >= 3) {
        activeBet = { color: betColor, period: nextPeriod, isVirtual: false };
        section.strategyState = 'SIGNAL_ACTIVE';
      } else {
        activeBet = { color: betColor, period: nextPeriod, isVirtual: true };
      }
    } else if (strategy === 'ANTI_MARTINGALE_SELECT') {
      activeBet = { color: betColor, period: nextPeriod, isVirtual: false };
      section.strategyState = 'SIGNAL_ACTIVE';
    } else if (strategy === 'SNIPER_3_LOSS_RGRG') {
      if (section.strategyState === 'READY_FOR_LIVE') {
        activeBet = { color: betColor, period: nextPeriod, isVirtual: false };
        section.strategyState = 'SIGNAL_ACTIVE';
      } else {
        activeBet = { color: betColor, period: nextPeriod, isVirtual: true };
      }
    } else if (strategy === 'RECOVERY_3_CHANCE') {
      // Recovery: ALL bets are LIVE
      activeBet = { color: betColor, period: nextPeriod, isVirtual: false };
      section.strategyState = 'SIGNAL_ACTIVE';
    } else {
      activeBet = { color: betColor, period: nextPeriod, isVirtual: false };
      section.strategyState = 'SIGNAL_ACTIVE';
    }
  }

  section.virtualLossCount = virtualLossCount;
  section.lockLossCount = virtualLossCount;
  section.recoveryAttempt = recoveryAttempt;
  section.consecLossStreak = consecLossStreak;
  section.maxConsecLossStreak = Math.max(section.maxConsecLossStreak, consecLossStreak);
  if (consecLossStreak >= 6) {
    section.hit6ConsecLosses = true;
    // Count how many times 6+ streak occurred in history
    let count6 = 0;
    let streak = 0;
    for (const bet of section.betHistory) {
      if (bet.won) { streak = 0; } else { streak++; if (streak === 6) count6++; }
    }
    section.consecLoss6Count = Math.max(count6, section.consecLoss6Count);
  }

  // Check for current pattern (latest colors)
  checkCurrentPattern(section);
}

function checkCurrentPattern(section) {
  const allPeriods = section.periods;
  const strategy = state.selectedStrategy || 'SNIPER_3_LOSS_RGRG';
  const len = getStrategyPatternLength(strategy);

  if (isRgrgSectionLocked(section, strategy)) {
    section.patternDetected = false;
    section.patternColors = null;
    return;
  }

  if (allPeriods.length < len) {
    section.patternDetected = false;
    section.patternColors = null;
    return;
  }

  const latestColors = allPeriods
    .slice(-len)
    .map(period => getColor(period));

  if (section.freshStartArmed) {
    let currentIsPattern = false;
    if (strategy === 'RGRG_TREND_BREAK' || strategy === 'SNIPER_3_LOSS_RGRG' || strategy === 'RECOVERY_3_CHANCE' || strategy === 'ANTI_MARTINGALE_SELECT' || strategy === 'RGRG_LOCK_RESET') {
      currentIsPattern = isAlternating(latestColors);
    } else if (strategy === 'CONTRARIAN_DOUBLE') {
      currentIsPattern = latestColors[0] === latestColors[1];
    } else if (strategy === 'BREAK_OPPOSITE') {
      currentIsPattern = latestColors[0] !== latestColors[1] && latestColors[1] === latestColors[2];
    } else if (strategy === 'STREAK_BREAK_3') {
      currentIsPattern = latestColors[0] === latestColors[1] && latestColors[1] === latestColors[2];
    } else if (strategy === 'STREAK_5_CONTINUE') {
      currentIsPattern = latestColors.every(c => c === latestColors[0]);
    }

    if (currentIsPattern) {
      section.patternDetected = false;
      section.patternColors = null;
      persistFreshSignalState();
      return;
    }

    section.freshStartArmed = false;
    section.freshStartAnchorPeriod = allPeriods[allPeriods.length - 1].period;
    section.strategyState = 'HUNTING';
    section.virtualLossCount = 0;
    persistFreshSignalState();
  }

  const periods = getEligiblePeriodsForSignals(section);
  if (periods.length < len) {
    section.patternDetected = false;
    section.patternColors = null;
    return;
  }

  const sliceColors = periods.slice(-len).map(p => getColor(p));
  let isPattern = false;
  if (strategy === 'RGRG_TREND_BREAK' || strategy === 'SNIPER_3_LOSS_RGRG' || strategy === 'RECOVERY_3_CHANCE' || strategy === 'ANTI_MARTINGALE_SELECT' || strategy === 'RGRG_LOCK_RESET') {
    isPattern = isAlternating(sliceColors);
  } else if (strategy === 'CONTRARIAN_DOUBLE') {
    isPattern = sliceColors[0] === sliceColors[1];
  } else if (strategy === 'BREAK_OPPOSITE') {
    isPattern = sliceColors[0] !== sliceColors[1] && sliceColors[1] === sliceColors[2];
  } else if (strategy === 'STREAK_BREAK_3') {
    isPattern = sliceColors[0] === sliceColors[1] && sliceColors[1] === sliceColors[2];
  } else if (strategy === 'STREAK_5_CONTINUE') {
    isPattern = sliceColors.every(c => c === sliceColors[0]);
  }

  if (isPattern) {
    section.patternDetected = true;
    section.patternColors = sliceColors;
  } else {
    section.patternDetected = false;
    section.patternColors = null;
  }
}

function processNewData(key, apiData) {
  const section = state.sections[key];
  const activeStrategy = state.selectedStrategy || 'RGRG_LOCK_RESET';

  if (section.disabled || isRgrgSectionLocked(section, activeStrategy)) {
    // If paused or locked, just sync periods data silently.
    section.periods = apiData.periods || [];
    section.lastKnownPeriod = section.periods[section.periods.length - 1]?.period || 0;
    section.nextPeriod = apiData.next_period;
    if (isRgrgSectionLocked(section, activeStrategy)) {
      section.pendingBet = null;
      section.patternDetected = false;
      section.patternColors = null;
      section.strategyState = 'HUNTING';
    }
    return;
  }

  const newPeriods = apiData.periods;
  const newNextPeriod = apiData.next_period;

  if (!newPeriods || newPeriods.length === 0) return;

  const isFirstLoad = section.periods.length === 0;

  if (isFirstLoad) {
    // First load - set up and scan history. RGRG Virtual Lock starts from
    // live observations (or restored state), never from stale history.
    section.periods = newPeriods;
    section.lastKnownPeriod = newPeriods[newPeriods.length - 1].period;
    section.nextPeriod = newNextPeriod;

    if (activeStrategy === 'RGRG_LOCK_RESET') {
      if (section.pendingBet) {
        const resolvedPeriod = newPeriods.find(period => period.period === section.pendingBet.period);
        if (resolvedPeriod) resolveRgrgBet(key, resolvedPeriod);
      }
      checkCurrentPattern(section);
    } else {
      scanHistoryForSection(section);
    }

    addLog(`${section.emoji} [${section.name}] Loaded ${newPeriods.length} periods | State: ${section.strategyState}`, 'info');

    if (!section.pendingBet && !isRgrgSectionLocked(section, activeStrategy)) {
      armBetFromCurrentPattern(key, newNextPeriod);
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
      const resolvedBet = section.pendingBet;
      section.pendingBet = null;

      const actualColor = getColor(period);
      const won = actualColor === resolvedBet.color;
      const strategy = state.selectedStrategy || 'SNIPER_3_LOSS_RGRG';

      if (strategy === 'RGRG_LOCK_RESET') {
        section.pendingBet = resolvedBet;
        resolveRgrgBet(key, period);
        continue;
      }

      if (resolvedBet.isVirtual) {
        // Resolve virtual bet (Sniper mode)
        if (won) {
          section.virtualLossCount = 0;
          section.consecLossStreak = 0;
          section.strategyState = 'HUNTING';
          addLog(
            `👁️ [${section.name}] Sniper Virtual WIN (No real bet) on #${formatPeriod(period.period)}. Resetting sniper.`,
            'info'
          );
        } else {
          section.virtualLossCount++;
          section.consecLossStreak++;
          section.maxConsecLossStreak = Math.max(section.maxConsecLossStreak, section.consecLossStreak);
          checkConsecLoss6Alert(key, section);
          section.strategyState = 'WAITING_FOR_TREND_BREAK';
          section.rgrgLiveLoss = false;
          addLog(
            `👁️ [${section.name}] Sniper Virtual LOSS (No real bet) on #${formatPeriod(period.period)}. Count: ${section.virtualLossCount}/3. (Consec: ${section.consecLossStreak})`,
            'info'
          );
        }
      } else {
        // Resolve LIVE bet
        section.betHistory.push({
          period: period.period,
          betColor: resolvedBet.color,
          actualColor,
          won
        });

        if (won) {
          section.totalWins++;
          section.consecLossStreak = 0;
          addLog(
            `✅ [${section.name}] WIN! Bet ${colorName(resolvedBet.color)}, Got ${colorName(actualColor)} (#${formatPeriod(period.period)})`,
            'win'
          );
          hideSignalBanner();
          playAlertSound();
          showToast(`✅ ${section.name} WIN!`, 'success');
          section.strategyState = 'HUNTING';
          if (strategy === 'RECOVERY_3_CHANCE') {
            section.recoveryAttempt = 0;
          }
          if (strategy === 'STREAK_5_CONTINUE') {
            const betAmt = STREAK5_CONFIG.BET_LADDER[section.streak5Level];
            section.streak5TotalPNL += betAmt * STREAK5_CONFIG.WIN_MULTIPLIER;
            section.streak5Level = 0;
            addLog(`💰 [${section.name}] Streak5 PNL: ₹${section.streak5TotalPNL.toFixed(1)} | Reset to Lv1`, 'info');
          }
        } else {
          section.totalLosses++;
          section.consecLossStreak++;
          section.maxConsecLossStreak = Math.max(section.maxConsecLossStreak, section.consecLossStreak);
          checkConsecLoss6Alert(key, section);
          hideSignalBanner();
          if (strategy === 'RECOVERY_3_CHANCE') {
            section.recoveryAttempt++;
            const attemptNum = section.recoveryAttempt;
            if (attemptNum >= 3) {
              addLog(
                `❌ [${section.name}] LOSS #3! Bet ${colorName(resolvedBet.color)}, Got ${colorName(actualColor)}. 3 chances used — Cooling down.`,
                'loss'
              );
              section.strategyState = 'WAITING_FOR_TREND_BREAK';
              section.recoveryAttempt = 0;
            } else {
              addLog(
                `❌ [${section.name}] LOSS! Bet ${colorName(resolvedBet.color)}, Got ${colorName(actualColor)}. Recovery ${attemptNum}/3 — Hunting next pattern in same trend.`,
                'loss'
              );
              section.strategyState = 'HUNTING'; // Keep hunting in same trend
            }
          } else if (strategy === 'RGRG_TREND_BREAK' || strategy === 'SNIPER_3_LOSS_RGRG') {
            addLog(
              `❌ [${section.name}] LOSS! Bet ${colorName(resolvedBet.color)}, Got ${colorName(actualColor)}.`,
              'loss'
            );
            section.strategyState = 'WAITING_FOR_TREND_BREAK';
            section.rgrgLiveLoss = true;
          } else {
            addLog(
              `❌ [${section.name}] LOSS! Bet ${colorName(resolvedBet.color)}, Got ${colorName(actualColor)}.`,
              'loss'
            );
            section.strategyState = 'HUNTING';
          }
          if (strategy === 'STREAK_5_CONTINUE') {
            const betAmt = STREAK5_CONFIG.BET_LADDER[section.streak5Level];
            section.streak5TotalPNL -= betAmt;
            section.streak5Level++;
            if (section.streak5Level >= STREAK5_CONFIG.BET_LADDER.length) {
              section.streak5Level = 0;
              addLog(`💀 [${section.name}] 4 consecutive losses! -₹150 cycle. Reset to Lv1`, 'loss');
            } else {
              addLog(`💰 [${section.name}] Streak5 PNL: ₹${section.streak5TotalPNL.toFixed(1)} | Next: Lv${section.streak5Level + 1} (₹${STREAK5_CONFIG.BET_LADDER[section.streak5Level]})`, 'info');
            }
          }
        }
        section.virtualLossCount = 0;
      }
    }
  }

  // Update stored periods
  section.periods = newPeriods;
  section.lastKnownPeriod = latestPeriodInData;
  section.nextPeriod = newNextPeriod;

  // Check for trend break if we are waiting for one
  const strategy = state.selectedStrategy || 'SNIPER_3_LOSS_RGRG';
  if (section.strategyState === 'WAITING_FOR_TREND_BREAK') {
    if (hasLatestTrendBreak(section.periods)) {
      if (section.rgrgLiveLoss) {
        section.strategyState = 'HUNTING';
        section.recoveryAttempt = 0;
        section.virtualLossCount = 0;
        section.lockLossCount = 0;
        section.rgrgLiveLoss = false;
        if (strategy === 'RGRG_LOCK_RESET') {
          persistRgrgLockState();
        }
      } else {
        if (section.virtualLossCount >= 3) {
          section.strategyState = 'READY_FOR_LIVE';
        } else {
          section.strategyState = 'HUNTING';
        }
      }
      addLog(`🔄 [${section.name}] Trend ended (consecutive same colors). Re-armed and hunting.`, 'info');
    }
  }

  // Hunt for next pattern if no active bet and state is HUNTING/READY_FOR_LIVE
  if (!section.pendingBet && (section.strategyState === 'HUNTING' || section.strategyState === 'READY_FOR_LIVE')) {
    armBetFromCurrentPattern(key, newNextPeriod);
  }
}

// ============ SIMPLIFIED SIGNAL FLOW ============

function resetAllSections() {
  state.rgrgActiveSectionKey = null;
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
    section.virtualLossCount = 0;
    section.recoveryAttempt = 0;
    section.lockLossCount = 0;
    section.rgrgLocked = false;
    section.rgrgLiveLoss = false;
  }

  persistRgrgLockState();
  persistFreshSignalState();
}

function startFreshSignalsNow() {
  state.lastNotifiedPeriod = 0;
  state.rgrgActiveSectionKey = null;

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
    section.virtualLossCount = 0;
    section.recoveryAttempt = 0;
    section.lockLossCount = 0;
    section.rgrgLocked = false;
    section.rgrgLiveLoss = false;
  }

  hideSignalBanner();
  persistRgrgLockState();
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

// ============ UPGRADE EVENT HANDLERS ============

function changeStrategy(newStrategy) {
  state.selectedStrategy = newStrategy;
  localStorage.setItem('wingo-selected-strategy', newStrategy);
  state.rgrgActiveSectionKey = null;
  for (const section of Object.values(state.sections)) {
    clearRgrgSectionLock(section);
    section.pendingBet = null;
    section.patternDetected = false;
    section.patternColors = null;
    section.strategyState = 'HUNTING';
    section.rgrgLiveLoss = false;
  }
  persistRgrgLockState();
  
  addLog(`⚙️ Strategy changed to: ${newStrategy.replace(/_/g, ' ')}`, 'info');
  showToast('Strategy updated! Recalculating stats...', 'success');

  // Recalculate stats for all enabled sections
  for (const [key, section] of Object.entries(state.sections)) {
    if (!section.disabled) {
      if (newStrategy === 'RGRG_LOCK_RESET') {
        section.totalWins = 0;
        section.totalLosses = 0;
        section.betHistory = [];
        checkCurrentPattern(section);
      } else {
        scanHistoryForSection(section);
      }
      
      // Arm if hunting/armed
      if (!section.pendingBet && (section.strategyState === 'HUNTING' || section.strategyState === 'READY_FOR_LIVE')) {
        armBetFromCurrentPattern(key, section.nextPeriod);
      }
    }
  }

  renderAll();
}

function toggleSection(key, isChecked) {
  const section = state.sections[key];
  if (!section) return;

  if (isChecked && isRgrgSectionLocked(section)) {
    showToast(`🔒 ${state.sections[state.rgrgActiveSectionKey].name} is locked until profit.`, 'error');
    renderAll();
    return;
  }

  if (!isChecked && state.selectedStrategy === 'RGRG_LOCK_RESET' && state.rgrgActiveSectionKey === key) {
    resetRgrgCycle();
  }

  section.disabled = !isChecked;
  
  // Persist disabled states
  const disabledSections = {};
  for (const [k, sec] of Object.entries(state.sections)) {
    if (sec.disabled) {
      disabledSections[k] = true;
    }
  }
  localStorage.setItem('wingo-disabled-sections', JSON.stringify(disabledSections));

  if (section.disabled) {
    section.pendingBet = null;
    section.patternDetected = false;
    section.patternColors = null;
    section.strategyState = 'HUNTING';
    section.virtualLossCount = 0;
    section.recoveryAttempt = 0;
    section.rgrgLiveLoss = false;
    hideSignalBanner();
  } else {
    if (state.selectedStrategy === 'RGRG_LOCK_RESET') {
      clearRgrgSectionLock(section);
      checkCurrentPattern(section);
    } else {
      scanHistoryForSection(section);
    }
    if (!section.pendingBet && (section.strategyState === 'HUNTING' || section.strategyState === 'READY_FOR_LIVE')) {
      armBetFromCurrentPattern(key, section.nextPeriod);
    }
  }

  renderAll();
  
  addLog(
    `🔧 [${section.name}] is now ${isChecked ? 'ENABLED' : 'PAUSED'}`,
    'info'
  );
  showToast(`${section.name} is ${isChecked ? 'Enabled' : 'Paused'}`, 'success');
}

// ============ UI RENDERING ============

function renderSection(key) {
  const section = state.sections[key];
  const currentStrategy = state.selectedStrategy || 'SNIPER_3_LOSS_RGRG';
  const isLocked = isRgrgSectionLocked(section, currentStrategy);
  const toggleEl = document.getElementById(`toggle-${key}`);
  if (toggleEl) {
    toggleEl.checked = !section.disabled && !isLocked;
  }

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
  if (isLocked) {
    patternEl.textContent = `🔒 ${state.sections[state.rgrgActiveSectionKey].name} Selected`;
    patternEl.className = 'pattern-status no-pattern';
  } else if (section.disabled) {
    patternEl.textContent = 'Disabled';
    patternEl.className = 'pattern-status no-pattern';
  } else if (section.patternDetected && section.patternColors) {
    patternEl.textContent = `Pattern: ${section.patternColors.join(' → ')}`;
    patternEl.className = 'pattern-status pattern-found';
  } else {
    patternEl.textContent = 'No Pattern';
    patternEl.className = 'pattern-status no-pattern';
  }

  // Bet info
  const betEl = document.getElementById(`bet-${key}`);
  if (isLocked) {
    betEl.textContent = 'WAIT';
    betEl.className = 'bet-info bet-none';
  } else if (section.disabled) {
    betEl.textContent = 'PAUSED';
    betEl.className = 'bet-info bet-none';
  } else if (section.pendingBet) {
    const colorLabel = colorName(section.pendingBet.color);
    const virtualText = section.pendingBet.isVirtual ? ' (V)' : '';
    betEl.textContent = `Bet: ${colorLabel}${virtualText}`;
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
  if (isLocked) {
    stateLabel = '⏸️ Other Section Selected';
  } else if (section.disabled) {
    stateLabel = '⏸️ Paused';
  } else if (section.strategyState === 'SIGNAL_ACTIVE') {
    if (currentStrategy === 'RECOVERY_3_CHANCE') {
      const attemptNum = section.recoveryAttempt + 1;
      stateLabel = attemptNum === 1 ? '🎯 Signal #1' : attemptNum === 2 ? '🔄 Recovery #2' : '⚠️ LAST #3';
    } else {
      stateLabel = '🎯 LIVE Signal';
    }
  } else if (section.strategyState === 'READY_FOR_LIVE') {
    stateLabel = currentStrategy === 'RGRG_LOCK_RESET' ? '✅ 3/3 — Next is LIVE' : '🎯 Armed';
  } else if (section.strategyState === 'WAITING_FOR_TREND_BREAK') {
    stateLabel = currentStrategy === 'RECOVERY_3_CHANCE' ? '❄️ Cooldown' : '⏳ Wait Trend';
  } else if (section.patternDetected) {
    stateLabel = '📊 Pattern Found';
  } else if (currentStrategy === 'RECOVERY_3_CHANCE' && section.recoveryAttempt > 0) {
    stateLabel = `🔄 Recovery ${section.recoveryAttempt}/3`;
  } else if (currentStrategy === 'RGRG_LOCK_RESET' && state.rgrgActiveSectionKey === key) {
    stateLabel = '🔒 Selected — Wait RGRG';
  } else if (currentStrategy === 'RGRG_LOCK_RESET' && section.virtualLossCount > 0) {
    stateLabel = `👁️ V-Loss: ${section.virtualLossCount}/3`;
  } else if (section.virtualLossCount > 0) {
    stateLabel = `🔍 V-Loss: ${section.virtualLossCount}/3`;
  }
  document.getElementById(`streak-${key}`).textContent = stateLabel;

  // Section status badge
  const statusEl = document.getElementById(`status-${key}`);
  if (isLocked) {
    statusEl.textContent = 'WAIT';
    statusEl.className = 'section-status status-locked';
  } else if (section.disabled) {
    statusEl.textContent = 'PAUSED';
    statusEl.className = 'section-status status-paused';
  } else if (section.pendingBet) {
    statusEl.textContent = section.pendingBet.isVirtual ? 'V-BET' : '🎯 TRADE';
    statusEl.className = section.pendingBet.isVirtual ? 'section-status status-pattern' : 'section-status status-signal';
  } else if (currentStrategy === 'RGRG_LOCK_RESET' && state.rgrgActiveSectionKey === key) {
    statusEl.textContent = '🔒 SELECTED';
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

  if (section.disabled || isLocked) {
    cardEl.classList.add('paused');
  } else if (section.pendingBet && !section.pendingBet.isVirtual) {
    cardEl.classList.add('signal-triggered');
    cardEl.classList.add(section.pendingBet.color === 'G' ? 'signal-green' : 'signal-red');
  } else if (section.patternDetected) {
    cardEl.classList.add('active');
  }

  // In-card trade banner
  renderTradeBanner(key);

  // Bet history ribbon
  renderBetHistory(key);

  // 6-consecutive loss badge
  renderConsecLossBadge(key);

  // Sniper loss tracker
  renderSniperTracker(key);
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
  const strategy = state.selectedStrategy || 'SNIPER_3_LOSS_RGRG';
  const len = getStrategyPatternLength(strategy);
  if (section.patternDetected && displayPeriods.length >= len) {
    patternStart = displayPeriods.length - len;
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

function renderSniperTracker(key) {
  const section = state.sections[key];
  const tracker = document.getElementById(`sniper-tracker-${key}`);
  if (!tracker) return;

  const strategy = state.selectedStrategy || 'SNIPER_3_LOSS_RGRG';
  const isLocked = isRgrgSectionLocked(section, strategy);

  // Show for Sniper, Recovery, and RGRG Lock Reset strategies
  if ((strategy !== 'SNIPER_3_LOSS_RGRG' && strategy !== 'RECOVERY_3_CHANCE' && strategy !== 'RGRG_LOCK_RESET') || (section.disabled && !isLocked)) {
    tracker.style.display = 'none';
    return;
  }

  tracker.style.display = '';

  const labelEl = tracker.querySelector('.sniper-label');
  const countEl = document.getElementById(`sniper-count-${key}`);

  if (strategy === 'RGRG_LOCK_RESET') {
    if (labelEl) labelEl.textContent = 'Virtual Loss:';
    const count = section.virtualLossCount || 0;
    const isLive = section.strategyState === 'SIGNAL_ACTIVE' && section.pendingBet && !section.pendingBet.isVirtual;
    const isSelected = state.rgrgActiveSectionKey === key;

    for (let i = 1; i <= 3; i++) {
      const dot = document.getElementById(`sniper-dot-${key}-${i}`);
      if (!dot) continue;

      dot.classList.remove('filled', 'ready');
      if (i <= count) {
        dot.classList.add('filled');
      }
      if (count >= 3 || isSelected) {
        dot.classList.add('ready');
      }
    }

    if (isLocked) {
      countEl.textContent = 'WAIT';
      countEl.className = 'sniper-count';
      tracker.classList.remove('tracker-live', 'tracker-ready');
    } else if (isLive) {
      countEl.textContent = '🎯 4th LIVE!';
      countEl.className = 'sniper-count sniper-live';
      tracker.classList.add('tracker-live');
      tracker.classList.remove('tracker-ready');
    } else if (isSelected) {
      countEl.textContent = '🔒 SELECTED';
      countEl.className = 'sniper-count sniper-ready';
      tracker.classList.add('tracker-ready');
      tracker.classList.remove('tracker-live');
    } else if (section.strategyState === 'READY_FOR_LIVE' || count >= 3) {
      countEl.textContent = '✅ NEXT LIVE';
      countEl.className = 'sniper-count sniper-ready';
      tracker.classList.add('tracker-ready');
      tracker.classList.remove('tracker-live');
    } else if (count > 0) {
      countEl.textContent = `${count}/3`;
      countEl.className = 'sniper-count';
      tracker.classList.remove('tracker-ready', 'tracker-live');
    } else {
      countEl.textContent = '0/3';
      countEl.className = 'sniper-count';
      tracker.classList.remove('tracker-ready', 'tracker-live');
    }
  } else if (strategy === 'RECOVERY_3_CHANCE') {
    // Recovery 3-Chance mode
    if (labelEl) labelEl.textContent = 'Recovery:';
    const count = section.recoveryAttempt || 0;
    const isLive = section.strategyState === 'SIGNAL_ACTIVE' && section.pendingBet && !section.pendingBet.isVirtual;
    const isCooldown = section.strategyState === 'WAITING_FOR_TREND_BREAK';

    // Update dots — show recovery attempts used
    for (let i = 1; i <= 3; i++) {
      const dot = document.getElementById(`sniper-dot-${key}-${i}`);
      if (!dot) continue;

      dot.classList.remove('filled', 'ready');
      if (i <= count) {
        dot.classList.add('filled');
      }
      if (count >= 2 || isLive) {
        dot.classList.add('ready');
      }
    }

    // Update count text
    if (isCooldown) {
      countEl.textContent = '❄️ Cooldown';
      countEl.className = 'sniper-count';
      tracker.classList.remove('tracker-ready', 'tracker-live');
    } else if (isLive) {
      const attemptNum = count + 1;
      const label = attemptNum === 1 ? '🎯 #1' : attemptNum === 2 ? '🔄 #2' : '⚠️ LAST!';
      countEl.textContent = label;
      countEl.className = attemptNum >= 3 ? 'sniper-count sniper-live' : 'sniper-count sniper-ready';
      tracker.classList.add(attemptNum >= 3 ? 'tracker-live' : 'tracker-ready');
      tracker.classList.remove(attemptNum >= 3 ? 'tracker-ready' : 'tracker-live');
    } else if (count > 0) {
      countEl.textContent = `${count}/3 used`;
      countEl.className = 'sniper-count';
      tracker.classList.remove('tracker-ready', 'tracker-live');
    } else {
      countEl.textContent = '0/3';
      countEl.className = 'sniper-count';
      tracker.classList.remove('tracker-ready', 'tracker-live');
    }
  } else {
    // Original Sniper mode
    if (labelEl) labelEl.textContent = 'Sniper Loss:';
    const count = section.virtualLossCount || 0;
    const isReady = section.strategyState === 'READY_FOR_LIVE';
    const isLive = section.strategyState === 'SIGNAL_ACTIVE' && section.pendingBet && !section.pendingBet.isVirtual;

    // Update dots
    for (let i = 1; i <= 3; i++) {
      const dot = document.getElementById(`sniper-dot-${key}-${i}`);
      if (!dot) continue;

      dot.classList.remove('filled', 'ready');
      if (i <= count) {
        dot.classList.add('filled');
      }
      if (count >= 3 || isReady || isLive) {
        dot.classList.add('ready');
      }
    }

    // Update count text
    if (isLive) {
      countEl.textContent = '🎯 LIVE!';
      countEl.className = 'sniper-count sniper-live';
      tracker.classList.add('tracker-live');
      tracker.classList.remove('tracker-ready');
    } else if (isReady || count >= 3) {
      countEl.textContent = '✅ READY!';
      countEl.className = 'sniper-count sniper-ready';
      tracker.classList.add('tracker-ready');
      tracker.classList.remove('tracker-live');
    } else {
      countEl.textContent = `${count}/3`;
      countEl.className = 'sniper-count';
      tracker.classList.remove('tracker-ready', 'tracker-live');
    }
  }
}

function renderConsecLossBadge(key) {
  const section = state.sections[key];
  const badge = document.getElementById(`consec-loss-badge-${key}`);
  if (!badge) return;

  const streak = section.consecLossStreak || 0;
  const maxStreak = section.maxConsecLossStreak || 0;
  const hit6 = section.hit6ConsecLosses;
  const times6 = section.consecLoss6Count || 0;

  badge.style.display = '';

  // Update the big number
  const currentEl = document.getElementById(`consec-loss-current-${key}`);
  if (currentEl) currentEl.textContent = streak;

  // Update max
  const maxEl = document.getElementById(`consec-loss-max-${key}`);
  if (maxEl) maxEl.textContent = `Max: ${maxStreak}`;

  // Update label emoji based on streak
  const labelEl = badge.querySelector('.lagatar-label');
  if (labelEl) {
    if (streak === 0) {
      labelEl.textContent = '✅ Lagatar Loss';
    } else if (streak <= 2) {
      labelEl.textContent = '🔥 Lagatar Loss';
    } else if (streak <= 4) {
      labelEl.textContent = '🔥🔥 Lagatar Loss';
    } else if (streak <= 7) {
      labelEl.textContent = '💀 Lagatar Loss';
    } else {
      labelEl.textContent = '💀☠️ Lagatar Loss';
    }
  }

  // Render fire dots (show up to max 10 dot slots, filled up to streak)
  const dotsContainer = document.getElementById(`lagatar-dots-${key}`);
  if (dotsContainer) {
    const maxDots = Math.max(streak, Math.min(maxStreak, 10));
    // Only re-render if dot count changed
    const currentDotCount = dotsContainer.children.length;
    if (currentDotCount !== maxDots) {
      dotsContainer.innerHTML = '';
      for (let i = 0; i < maxDots; i++) {
        const dot = document.createElement('div');
        dot.className = 'lagatar-fire-dot';
        if (i < streak) {
          dot.classList.add('dot-filled');
        }
        dotsContainer.appendChild(dot);
      }
    } else {
      // Just update filled state
      for (let i = 0; i < maxDots; i++) {
        const dot = dotsContainer.children[i];
        if (!dot) continue;
        if (i < streak) {
          dot.classList.add('dot-filled');
        } else {
          dot.classList.remove('dot-filled');
        }
      }
    }
  }

  // Set escalating color state class
  badge.classList.remove('lagatar-safe', 'lagatar-mild', 'lagatar-warning', 'lagatar-danger', 'lagatar-critical');
  if (streak === 0) {
    badge.classList.add('lagatar-safe');
  } else if (streak <= 2) {
    badge.classList.add('lagatar-mild');
  } else if (streak <= 4) {
    badge.classList.add('lagatar-warning');
  } else if (streak <= 7) {
    badge.classList.add('lagatar-danger');
  } else {
    badge.classList.add('lagatar-critical');
  }

  // 6+ alert text
  const alertEl = document.getElementById(`consec-loss-alert-${key}`);
  if (alertEl) {
    if (hit6) {
      alertEl.textContent = `💀 6+ consecutive loss ${times6}x times!`;
      alertEl.style.display = '';
    } else {
      alertEl.style.display = 'none';
    }
  }
}

/** Trigger green reset flash animation on the lagatar bar when profit resets streak */
function flashLagatarReset(key) {
  const badge = document.getElementById(`consec-loss-badge-${key}`);
  if (!badge) return;
  badge.classList.add('lagatar-reset');
  setTimeout(() => {
    badge.classList.remove('lagatar-reset');
  }, 900);
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

  // Virtual bets stay silent; only the fourth/live bet is a trade signal.
  const activeTrades = [];
  for (const [key, section] of Object.entries(state.sections)) {
    if (section.pendingBet && !section.pendingBet.isVirtual) {
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
  } else if (state.selectedStrategy === 'RGRG_LOCK_RESET' && state.rgrgActiveSectionKey) {
    const selected = state.sections[state.rgrgActiveSectionKey];
    modeText.textContent = '🔒 SECTION SELECTED';
    modeText.className = 'value signal-mode';
    activeSectionText.textContent = selected.name;
    appStatus.textContent = 'WAITING RGRG';
    appStatus.className = 'status-badge hunting';
    nextSignalText.textContent = `Only ${selected.name} will continue until profit.`;
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

  if (section.pendingBet && !section.pendingBet.isVirtual) {
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
    key => state.sections[key].pendingBet && !state.sections[key].pendingBet.isVirtual
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
    const strategy = state.selectedStrategy || 'SNIPER_3_LOSS_RGRG';

    if (strategy === 'RECOVERY_3_CHANCE') {
      const attemptNum = section.recoveryAttempt + 1;
      const attemptLabel = attemptNum === 1 ? '🎯' : attemptNum === 2 ? '🔄 Recovery #2 —' : '⚠️ LAST CHANCE —';
      colorEl.textContent = `${attemptLabel} ${betColorLabel} pe lagao!`;
    } else if (strategy === 'STREAK_5_CONTINUE') {
      const betAmt = STREAK5_CONFIG.BET_LADDER[section.streak5Level || 0];
      colorEl.textContent = `🔥 ${betColorLabel} pe lagao! (₹${betAmt} Lv${(section.streak5Level || 0) + 1})`;
    } else if (strategy === 'RGRG_LOCK_RESET') {
      colorEl.textContent = `🎯 4th BET: ${betColorLabel} pe lagao!`;
    } else {
      colorEl.textContent = `🎯 ${betColorLabel} pe lagao!`;
    }
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
  // Restore disabled sections
  const rawDisabled = localStorage.getItem('wingo-disabled-sections');
  if (rawDisabled) {
    try {
      const disabledMap = JSON.parse(rawDisabled);
      for (const key of Object.keys(state.sections)) {
        if (disabledMap[key]) {
          state.sections[key].disabled = true;
        }
      }
    } catch (e) {
      console.error('Failed to restore disabled sections:', e);
    }
  }

  restoreFreshSignalState();
  restoreRgrgLockState();
  
  // Set strategy select element
  const selectEl = document.getElementById('strategy-select');
  if (selectEl) {
    selectEl.value = state.selectedStrategy;
  }

  // Set toggle switches
  for (const key of Object.keys(state.sections)) {
    const toggleEl = document.getElementById(`toggle-${key}`);
    if (toggleEl) {
      toggleEl.checked = !state.sections[key].disabled && !isRgrgSectionLocked(state.sections[key]);
    }
  }

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
