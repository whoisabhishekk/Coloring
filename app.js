/* ==============================================
   WINGO STRATEGY DASHBOARD - Application Logic
   Pattern Detection | Signal System | Live Data
   ============================================== */

// ============ CONFIGURATION ============
const CONFIG = {
  // Local proxy handles CORS — requests go to /api/win/... → proxied to cooe02.in
  API_BASE: '/api',
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
  activeSection: null,     // Key of the section with signal (e.g., 'P')
  sections: {},
  logs: [],
  refreshTimer: null,
  refreshProgress: 0,
  progressTimer: null,
  initialized: false,
  lastSignalSoundTime: 0,
  lastNotifiedPeriod: 0    // Prevents spamming duplicate alerts for the same period
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
    skipUntilTrendBreaks: false // After loss: skip remaining trend, wait for new pattern
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

// ============ SOUND SYSTEM ============
let audioCtx = null;

function playAlertSound() {
  const now = Date.now();
  if (now - state.lastSignalSoundTime < 3000) return; // Debounce 3s
  state.lastSignalSoundTime = now;

  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    // Triple beep
    [0, 200, 400].forEach(delay => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.frequency.value = delay === 200 ? 1000 : 880;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.25, audioCtx.currentTime + delay / 1000);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + delay / 1000 + 0.15);
      osc.start(audioCtx.currentTime + delay / 1000);
      osc.stop(audioCtx.currentTime + delay / 1000 + 0.15);
    });
  } catch (e) {
    console.warn('Sound unavailable:', e);
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
  const periods = section.periods;
  if (periods.length < CONFIG.PATTERN_LENGTH + 1) return;

  // Reset tracking for fresh scan
  section.consecutiveLosses = 0;
  section.totalWins = 0;
  section.totalLosses = 0;
  section.betHistory = [];
  section.skipUntilTrendBreaks = false;

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
  const periods = section.periods;
  if (periods.length < CONFIG.PATTERN_LENGTH) {
    section.patternDetected = false;
    section.patternColors = null;
    return;
  }

  const lastN = periods.slice(-CONFIG.PATTERN_LENGTH);
  const colors = lastN.map(p => getColor(p));

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

    addLog(`${section.emoji} [${section.name}] Loaded ${newPeriods.length} periods | Losses: ${section.consecutiveLosses}`, 'info');

    // Set pending bet if pattern detected and not skipping
    if (section.patternDetected && !section.skipUntilTrendBreaks) {
      const betColor = section.patternColors[section.patternColors.length - 1];
      section.pendingBet = { color: betColor, period: newNextPeriod };
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
        addLog(
          `✅ [${section.name}] WIN! Bet ${colorName(section.pendingBet.color)}, Got ${colorName(actualColor)} (#${formatPeriod(period.period)})`,
          'win'
        );
        // Handle win in signal flow
        handleBetOutcome(key, true);
      } else {
        section.totalLosses++;
        section.consecutiveLosses++;     // Loss counted IMMEDIATELY
        section.skipUntilTrendBreaks = true; // Skip rest of this trend
        addLog(
          `❌ [${section.name}] LOSS #${section.consecutiveLosses}! Bet ${colorName(section.pendingBet.color)}, Got ${colorName(actualColor)}. Skipping trend, waiting for new pattern.`,
          'loss'
        );
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

  if (state.mode === 'WATCHING') {
    // Check if this section hit 2 consecutive losses
    if (section.consecutiveLosses >= CONFIG.CONSECUTIVE_LOSSES_FOR_SIGNAL) {
      // TRIGGER SIGNAL!
      state.mode = 'SIGNAL_ACTIVE';
      state.activeSection = key;

      addLog(
        `🚨 [${section.name}] SIGNAL TRIGGERED! ${section.consecutiveLosses} consecutive losses detected!`,
        'signal'
      );

      playAlertSound();
      showSignalBanner(key);
    }
  } else if (state.mode === 'SIGNAL_ACTIVE' && state.activeSection === key) {
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
    } else {
      // Loss in active section - keep watching for next pattern
      addLog(
        `⚠️ [${section.name}] Loss in active signal section. Waiting for next pattern...`,
        'loss'
      );
      updateSignalBanner(key);
    }
  }
}

function resetAllSections() {
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
  }
}

function checkSignalConditions() {
  if (state.mode !== 'WATCHING') return;

  for (const [key, section] of Object.entries(state.sections)) {
    if (section.consecutiveLosses >= CONFIG.CONSECUTIVE_LOSSES_FOR_SIGNAL) {
      state.mode = 'SIGNAL_ACTIVE';
      state.activeSection = key;

      addLog(
        `🚨 [${section.name}] SIGNAL! ${section.consecutiveLosses} consecutive losses!`,
        'signal'
      );

      playAlertSound();
      showSignalBanner(key);
      break;
    }
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
    statusEl.textContent = 'SIGNAL';
    statusEl.className = 'section-status status-signal';
  } else if (state.mode === 'SIGNAL_ACTIVE' && state.activeSection !== key) {
    statusEl.textContent = 'Paused';
    statusEl.className = 'section-status status-paused';
  } else if (section.patternDetected) {
    statusEl.textContent = 'Pattern!';
    statusEl.className = 'section-status status-pattern';
  } else {
    statusEl.textContent = 'Watching';
    statusEl.className = 'section-status status-watching';
  }

  // Card classes
  const cardEl = document.getElementById(`card-${key}`);
  cardEl.classList.remove('active', 'signal-triggered', 'paused');

  if (state.mode === 'SIGNAL_ACTIVE') {
    if (state.activeSection === key) {
      cardEl.classList.add('signal-triggered');
    } else {
      cardEl.classList.add('paused');
    }
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

  if (state.mode === 'WATCHING') {
    modeText.textContent = 'WATCHING';
    modeText.className = 'value watching-mode';
    activeSectionText.textContent = 'All Sections';
    appStatus.textContent = 'WATCHING ALL';
    appStatus.className = 'status-badge watching';

    // Find section closest to signal (highest consecutive losses)
    let maxLosses = 0;
    let closestSection = null;
    for (const [key, section] of Object.entries(state.sections)) {
      if (section.consecutiveLosses > maxLosses) {
        maxLosses = section.consecutiveLosses;
        closestSection = section;
      }
    }
    if (closestSection && maxLosses > 0) {
      nextSignalText.textContent = `${closestSection.name}: ${maxLosses}/${CONFIG.CONSECUTIVE_LOSSES_FOR_SIGNAL} losses`;
    } else {
      nextSignalText.textContent = 'Monitoring...';
    }
  } else {
    const section = state.sections[state.activeSection];
    modeText.textContent = 'SIGNAL ACTIVE';
    modeText.className = 'value signal-mode';
    activeSectionText.textContent = `${section.emoji} ${section.name}`;
    appStatus.textContent = `SIGNAL: ${section.name.toUpperCase()}`;
    appStatus.className = 'status-badge signal-active';

    if (section.pendingBet) {
      nextSignalText.textContent = `Bet ${colorName(section.pendingBet.color)} on #${formatPeriod(section.pendingBet.period)}`;
      nextSignalText.style.color = section.pendingBet.color === 'G' ? 'var(--color-green)' : 'var(--color-red)';
    } else {
      nextSignalText.textContent = 'Waiting for pattern...';
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

  mainText.textContent = `🚨 ${section.name.toUpperCase()} SIGNAL TRIGGERED!`;

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
        `🚨 Wingo: ${section.name} Signal`,
        `Bet ${betColor} on Period #${periodStr}!`
      );
    }
  } else {
    subText.textContent = `${section.consecutiveLosses} consecutive losses — Waiting for next RGRG/GRGR pattern`;
    banner.className = 'signal-banner signal-red';
    
    // Notification logic
    const uniqueKey = section.lastKnownPeriod + "_waiting";
    if (state.lastNotifiedPeriod !== uniqueKey) {
      state.lastNotifiedPeriod = uniqueKey;
      sendSystemNotification(
        `🚨 Wingo: ${section.name} Alert`,
        `${section.consecutiveLosses} Losses! Lock active, waiting for pattern...`
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
    if (state.mode === 'WATCHING') {
      checkSignalConditions();
    }

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
