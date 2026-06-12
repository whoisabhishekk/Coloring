#!/usr/bin/env node
/**
 * MEGA BACKTEST: Test 10+ creative strategies to find the MOST PROFITABLE one
 * All strategies tested on the same live data from all 4 categories
 */

const API_BASE = 'https://cooe02.in';
const SAAS_ID = 1;

// ============ FETCH DATA ============
async function fetchSectionData(category) {
  const url = `${API_BASE}/win/next_period_info_noauth?category=${category}&saas_id=${SAAS_ID}`;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (data.code !== 200) throw new Error(`API error code: ${data.code}`);
    return data;
  } catch (err) {
    console.error(`Failed to fetch ${category}:`, err.message);
    return null;
  }
}

function getColor(p) { return p.is_green ? 'G' : 'R'; }

function isAlternating(colors) {
  for (let i = 1; i < colors.length; i++) {
    if (colors[i] === colors[i - 1]) return false;
  }
  return true;
}

function opposite(c) { return c === 'G' ? 'R' : 'G'; }

// ============ STRATEGY 1: RGR Direct (Current App - Baseline) ============
function strategy_RGR_Direct(periods) {
  const trades = [];
  let activeBet = null;

  for (let i = 0; i < periods.length; i++) {
    if (activeBet && periods[i].period === activeBet.period) {
      const actual = getColor(periods[i]);
      trades.push({ betColor: activeBet.color, actualColor: actual, won: actual === activeBet.color });
      activeBet = null;
    }
    if (activeBet) continue;
    if (i < 2) continue;

    const colors = [getColor(periods[i-2]), getColor(periods[i-1]), getColor(periods[i])];
    if (!isAlternating(colors)) continue;
    if (i + 1 >= periods.length) continue;

    activeBet = { color: colors[2], period: periods[i + 1].period };
  }
  return trades;
}

// ============ STRATEGY 2: RGR Opposite (Bet OPPOSITE of last pattern color) ============
function strategy_RGR_Opposite(periods) {
  const trades = [];
  let activeBet = null;

  for (let i = 0; i < periods.length; i++) {
    if (activeBet && periods[i].period === activeBet.period) {
      const actual = getColor(periods[i]);
      trades.push({ betColor: activeBet.color, actualColor: actual, won: actual === activeBet.color });
      activeBet = null;
    }
    if (activeBet) continue;
    if (i < 2) continue;

    const colors = [getColor(periods[i-2]), getColor(periods[i-1]), getColor(periods[i])];
    if (!isAlternating(colors)) continue;
    if (i + 1 >= periods.length) continue;

    // Bet OPPOSITE — predicting the alternation continues
    activeBet = { color: opposite(colors[2]), period: periods[i + 1].period };
  }
  return trades;
}

// ============ STRATEGY 3: Streak Breaker (After 3+ same colors, bet opposite) ============
function strategy_StreakBreaker(periods, streakLen = 3) {
  const trades = [];
  let activeBet = null;

  for (let i = 0; i < periods.length; i++) {
    if (activeBet && periods[i].period === activeBet.period) {
      const actual = getColor(periods[i]);
      trades.push({ betColor: activeBet.color, actualColor: actual, won: actual === activeBet.color });
      activeBet = null;
    }
    if (activeBet) continue;
    if (i < streakLen - 1) continue;

    // Check for streak of same colors
    let allSame = true;
    const streakColor = getColor(periods[i]);
    for (let j = i - streakLen + 1; j <= i; j++) {
      if (getColor(periods[j]) !== streakColor) { allSame = false; break; }
    }

    if (!allSame) continue;
    if (i + 1 >= periods.length) continue;

    // Bet OPPOSITE after streak
    activeBet = { color: opposite(streakColor), period: periods[i + 1].period };
  }
  return trades;
}

// ============ STRATEGY 4: Streak Follower (After 2+ same, bet SAME — ride the trend) ============
function strategy_StreakFollower(periods, streakLen = 2) {
  const trades = [];
  let activeBet = null;

  for (let i = 0; i < periods.length; i++) {
    if (activeBet && periods[i].period === activeBet.period) {
      const actual = getColor(periods[i]);
      trades.push({ betColor: activeBet.color, actualColor: actual, won: actual === activeBet.color });
      activeBet = null;
    }
    if (activeBet) continue;
    if (i < streakLen - 1) continue;

    let allSame = true;
    const streakColor = getColor(periods[i]);
    for (let j = i - streakLen + 1; j <= i; j++) {
      if (getColor(periods[j]) !== streakColor) { allSame = false; break; }
    }

    if (!allSame) continue;
    if (i + 1 >= periods.length) continue;

    // Bet SAME color — ride the momentum
    activeBet = { color: streakColor, period: periods[i + 1].period };
  }
  return trades;
}

// ============ STRATEGY 5: RGR + Cooldown (Skip N periods after a loss) ============
function strategy_RGR_Cooldown(periods, cooldownPeriods = 3) {
  const trades = [];
  let activeBet = null;
  let cooldown = 0;

  for (let i = 0; i < periods.length; i++) {
    if (activeBet && periods[i].period === activeBet.period) {
      const actual = getColor(periods[i]);
      const won = actual === activeBet.color;
      trades.push({ betColor: activeBet.color, actualColor: actual, won });
      activeBet = null;
      if (!won) cooldown = cooldownPeriods; // Skip next N after loss
    }
    if (activeBet) continue;
    if (cooldown > 0) { cooldown--; continue; }
    if (i < 2) continue;

    const colors = [getColor(periods[i-2]), getColor(periods[i-1]), getColor(periods[i])];
    if (!isAlternating(colors)) continue;
    if (i + 1 >= periods.length) continue;

    activeBet = { color: colors[2], period: periods[i + 1].period };
  }
  return trades;
}

// ============ STRATEGY 6: Double Confirmation (RGR pattern + last bet color won) ============
function strategy_DoubleConfirm(periods) {
  const trades = [];
  let activeBet = null;
  let lastWon = true; // Start optimistic

  for (let i = 0; i < periods.length; i++) {
    if (activeBet && periods[i].period === activeBet.period) {
      const actual = getColor(periods[i]);
      const won = actual === activeBet.color;
      trades.push({ betColor: activeBet.color, actualColor: actual, won });
      lastWon = won;
      activeBet = null;
    }
    if (activeBet) continue;
    if (i < 2) continue;

    const colors = [getColor(periods[i-2]), getColor(periods[i-1]), getColor(periods[i])];
    if (!isAlternating(colors)) continue;
    if (i + 1 >= periods.length) continue;

    // Only bet if last trade was a win (riding hot hand)
    if (!lastWon) { lastWon = true; continue; } // Skip one, then re-enable

    activeBet = { color: colors[2], period: periods[i + 1].period };
  }
  return trades;
}

// ============ STRATEGY 7: RGRG Direct (4-length alternation, direct bet) ============
function strategy_RGRG_Direct(periods) {
  const trades = [];
  let activeBet = null;

  for (let i = 0; i < periods.length; i++) {
    if (activeBet && periods[i].period === activeBet.period) {
      const actual = getColor(periods[i]);
      trades.push({ betColor: activeBet.color, actualColor: actual, won: actual === activeBet.color });
      activeBet = null;
    }
    if (activeBet) continue;
    if (i < 3) continue;

    const colors = [getColor(periods[i-3]), getColor(periods[i-2]), getColor(periods[i-1]), getColor(periods[i])];
    if (!isAlternating(colors)) continue;
    if (i + 1 >= periods.length) continue;

    activeBet = { color: colors[3], period: periods[i + 1].period };
  }
  return trades;
}

// ============ STRATEGY 8: Streak Break → Bet After Break (Wait for RR/GG, then bet opposite) ============
function strategy_BreakThenOpposite(periods) {
  const trades = [];
  let activeBet = null;

  for (let i = 0; i < periods.length; i++) {
    if (activeBet && periods[i].period === activeBet.period) {
      const actual = getColor(periods[i]);
      trades.push({ betColor: activeBet.color, actualColor: actual, won: actual === activeBet.color });
      activeBet = null;
    }
    if (activeBet) continue;
    if (i < 2) continue;

    // Pattern: A, B, B → bet A (the odd one out before the double)
    const c0 = getColor(periods[i-2]);
    const c1 = getColor(periods[i-1]);
    const c2 = getColor(periods[i]);

    // Need: different color followed by 2 same colors
    if (c0 !== c1 && c1 === c2) {
      if (i + 1 >= periods.length) continue;
      // After seeing RGG, bet R (expecting the double to break)
      activeBet = { color: opposite(c2), period: periods[i + 1].period };
    }
  }
  return trades;
}

// ============ STRATEGY 9: Win Streak Rider (Only bet when on a 2+ win streak) ============
function strategy_WinStreakRider(periods) {
  const trades = [];
  let activeBet = null;
  let consecutiveWins = 0;

  for (let i = 0; i < periods.length; i++) {
    if (activeBet && periods[i].period === activeBet.period) {
      const actual = getColor(periods[i]);
      const won = actual === activeBet.color;
      trades.push({ betColor: activeBet.color, actualColor: actual, won });
      if (won) consecutiveWins++; else consecutiveWins = 0;
      activeBet = null;
    }
    if (activeBet) continue;
    if (i < 2) continue;

    const colors = [getColor(periods[i-2]), getColor(periods[i-1]), getColor(periods[i])];
    if (!isAlternating(colors)) continue;
    if (i + 1 >= periods.length) continue;

    // First bet always allowed, after that only if we're winning
    if (trades.length > 0 && consecutiveWins === 0) {
      // Check pattern and skip — but reset on next fresh pattern
      consecutiveWins = 1; // Give another chance
      continue;
    }

    activeBet = { color: colors[2], period: periods[i + 1].period };
  }
  return trades;
}

// ============ STRATEGY 10: Hybrid (RGR + After Loss, switch to opposite bet) ============
function strategy_Hybrid_FlipOnLoss(periods) {
  const trades = [];
  let activeBet = null;
  let flipMode = false; // After loss, flip bet direction

  for (let i = 0; i < periods.length; i++) {
    if (activeBet && periods[i].period === activeBet.period) {
      const actual = getColor(periods[i]);
      const won = actual === activeBet.color;
      trades.push({ betColor: activeBet.color, actualColor: actual, won });
      flipMode = !won; // Flip on loss, normal on win
      activeBet = null;
    }
    if (activeBet) continue;
    if (i < 2) continue;

    const colors = [getColor(periods[i-2]), getColor(periods[i-1]), getColor(periods[i])];
    if (!isAlternating(colors)) continue;
    if (i + 1 >= periods.length) continue;

    let betColor = colors[2]; // Normal: bet last same color
    if (flipMode) betColor = opposite(betColor); // After loss: bet opposite

    activeBet = { color: betColor, period: periods[i + 1].period };
  }
  return trades;
}

// ============ STRATEGY 11: RGR + Trend Break Wait (loss ke baad trend break wait, then bet) ============
function strategy_RGR_TrendBreakWait(periods) {
  const trades = [];
  let state = 'HUNTING';
  let activeBet = null;

  for (let i = 0; i < periods.length; i++) {
    if (activeBet && periods[i].period === activeBet.period) {
      const actual = getColor(periods[i]);
      const won = actual === activeBet.color;
      trades.push({ betColor: activeBet.color, actualColor: actual, won });
      activeBet = null;
      state = won ? 'HUNTING' : 'WAITING_FOR_TREND_BREAK';
    }
    if (activeBet) continue;

    if (state === 'WAITING_FOR_TREND_BREAK') {
      if (i > 0 && getColor(periods[i-1]) === getColor(periods[i])) {
        state = 'HUNTING';
      }
    }

    if (state !== 'HUNTING') continue;
    if (i < 2) continue;

    const colors = [getColor(periods[i-2]), getColor(periods[i-1]), getColor(periods[i])];
    if (!isAlternating(colors)) continue;
    if (i + 1 >= periods.length) continue;

    activeBet = { color: colors[2], period: periods[i + 1].period };
    state = 'SIGNAL_ACTIVE';
  }
  return trades;
}

// ============ STRATEGY 12: Contrarian After Double (See RR → bet G, see GG → bet R) ============
function strategy_ContrarianDouble(periods) {
  const trades = [];
  let activeBet = null;

  for (let i = 0; i < periods.length; i++) {
    if (activeBet && periods[i].period === activeBet.period) {
      const actual = getColor(periods[i]);
      trades.push({ betColor: activeBet.color, actualColor: actual, won: actual === activeBet.color });
      activeBet = null;
    }
    if (activeBet) continue;
    if (i < 1) continue;

    const prev = getColor(periods[i-1]);
    const curr = getColor(periods[i]);

    if (prev === curr && i + 1 < periods.length) {
      // After 2 same colors, bet opposite
      activeBet = { color: opposite(curr), period: periods[i + 1].period };
    }
  }
  return trades;
}

// ============ STRATEGY 13: RGRG + Trend Break Wait (4-length + pause after loss) ============
function strategy_RGRG_TrendBreakWait(periods) {
  const trades = [];
  let state = 'HUNTING';
  let activeBet = null;

  for (let i = 0; i < periods.length; i++) {
    if (activeBet && periods[i].period === activeBet.period) {
      const actual = getColor(periods[i]);
      const won = actual === activeBet.color;
      trades.push({ betColor: activeBet.color, actualColor: actual, won });
      activeBet = null;
      state = won ? 'HUNTING' : 'WAITING_FOR_TREND_BREAK';
    }
    if (activeBet) continue;

    if (state === 'WAITING_FOR_TREND_BREAK') {
      if (i > 0 && getColor(periods[i-1]) === getColor(periods[i])) {
        state = 'HUNTING';
      }
    }

    if (state !== 'HUNTING') continue;
    if (i < 3) continue;

    const colors = [getColor(periods[i-3]), getColor(periods[i-2]), getColor(periods[i-1]), getColor(periods[i])];
    if (!isAlternating(colors)) continue;
    if (i + 1 >= periods.length) continue;

    activeBet = { color: colors[3], period: periods[i + 1].period };
    state = 'SIGNAL_ACTIVE';
  }
  return trades;
}

// ============ STRATEGY 14: Selective RGR (Only bet when R is the bet color — Red bias) ============
function strategy_RedOnly_RGR(periods) {
  const trades = [];
  let activeBet = null;

  for (let i = 0; i < periods.length; i++) {
    if (activeBet && periods[i].period === activeBet.period) {
      const actual = getColor(periods[i]);
      trades.push({ betColor: activeBet.color, actualColor: actual, won: actual === activeBet.color });
      activeBet = null;
    }
    if (activeBet) continue;
    if (i < 2) continue;

    const colors = [getColor(periods[i-2]), getColor(periods[i-1]), getColor(periods[i])];
    if (!isAlternating(colors)) continue;
    if (i + 1 >= periods.length) continue;

    // Only bet if the signal color is RED
    if (colors[2] !== 'R') continue;

    activeBet = { color: 'R', period: periods[i + 1].period };
  }
  return trades;
}

// ============ STRATEGY 15: Selective RGR (Only bet when G is the bet color — Green bias) ============
function strategy_GreenOnly_RGR(periods) {
  const trades = [];
  let activeBet = null;

  for (let i = 0; i < periods.length; i++) {
    if (activeBet && periods[i].period === activeBet.period) {
      const actual = getColor(periods[i]);
      trades.push({ betColor: activeBet.color, actualColor: actual, won: actual === activeBet.color });
      activeBet = null;
    }
    if (activeBet) continue;
    if (i < 2) continue;

    const colors = [getColor(periods[i-2]), getColor(periods[i-1]), getColor(periods[i])];
    if (!isAlternating(colors)) continue;
    if (i + 1 >= periods.length) continue;

    // Only bet if the signal color is GREEN
    if (colors[2] !== 'G') continue;

    activeBet = { color: 'G', period: periods[i + 1].period };
  }
  return trades;
}

// ============ STRATEGY 16: RGRGRG (5-length alternation — ultra selective) ============
function strategy_5Length(periods) {
  const trades = [];
  let activeBet = null;

  for (let i = 0; i < periods.length; i++) {
    if (activeBet && periods[i].period === activeBet.period) {
      const actual = getColor(periods[i]);
      trades.push({ betColor: activeBet.color, actualColor: actual, won: actual === activeBet.color });
      activeBet = null;
    }
    if (activeBet) continue;
    if (i < 4) continue;

    const colors = [];
    for (let j = i - 4; j <= i; j++) colors.push(getColor(periods[j]));
    if (!isAlternating(colors)) continue;
    if (i + 1 >= periods.length) continue;

    activeBet = { color: colors[4], period: periods[i + 1].period };
  }
  return trades;
}

// ============ STRATEGY 17: RGR + Max 2 Consecutive Bets (Limit exposure) ============
function strategy_RGR_Max2(periods) {
  const trades = [];
  let activeBet = null;
  let consecutiveBets = 0;
  let pauseRemaining = 0;

  for (let i = 0; i < periods.length; i++) {
    if (activeBet && periods[i].period === activeBet.period) {
      const actual = getColor(periods[i]);
      const won = actual === activeBet.color;
      trades.push({ betColor: activeBet.color, actualColor: actual, won });
      activeBet = null;
      
      if (won) {
        consecutiveBets++;
        if (consecutiveBets >= 2) {
          pauseRemaining = 2; // Take a break after 2 consecutive bets
          consecutiveBets = 0;
        }
      } else {
        consecutiveBets = 0;
        pauseRemaining = 1; // Short pause after loss
      }
    }
    if (activeBet) continue;
    if (pauseRemaining > 0) { pauseRemaining--; continue; }
    if (i < 2) continue;

    const colors = [getColor(periods[i-2]), getColor(periods[i-1]), getColor(periods[i])];
    if (!isAlternating(colors)) continue;
    if (i + 1 >= periods.length) continue;

    activeBet = { color: colors[2], period: periods[i + 1].period };
  }
  return trades;
}

// ============ STREAK ANALYSIS ============
function analyzeStreaks(trades) {
  let maxLossStreak = 0, currentStreak = 0;
  let maxWinStreak = 0, currentWinStreak = 0;

  for (const t of trades) {
    if (!t.won) {
      currentStreak++;
      currentWinStreak = 0;
      if (currentStreak > maxLossStreak) maxLossStreak = currentStreak;
    } else {
      currentWinStreak++;
      currentStreak = 0;
      if (currentWinStreak > maxWinStreak) maxWinStreak = currentWinStreak;
    }
  }
  return { maxLossStreak, maxWinStreak };
}

// ============ MAIN ============
async function main() {
  const categories = ['P', 'S', 'B', 'E'];
  const categoryNames = { P: 'Parity', S: 'Sapre', B: 'Bcone', E: 'Emerd' };
  
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║           🏆 MEGA BACKTEST — 17 STRATEGIES COMPARED 🏆                 ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝');
  console.log('');

  // Collect all periods
  const allPeriods = {};
  let totalPeriodsCount = 0;
  
  for (const cat of categories) {
    const data = await fetchSectionData(cat);
    if (!data || !data.periods) {
      console.log(`  ⚠️ No data for ${categoryNames[cat]}`);
      continue;
    }
    allPeriods[cat] = data.periods;
    totalPeriodsCount += data.periods.length;
    console.log(`  ✅ ${categoryNames[cat]}: ${data.periods.length} periods loaded`);
  }

  console.log(`\n  📦 Total: ${totalPeriodsCount} periods across ${Object.keys(allPeriods).length} categories\n`);

  // Define all strategies
  const strategies = [
    { name: 'RGR Direct (CURRENT)', fn: (p) => strategy_RGR_Direct(p), emoji: '📌' },
    { name: 'RGR Opposite', fn: (p) => strategy_RGR_Opposite(p), emoji: '🔄' },
    { name: 'Streak Break (3+same→opp)', fn: (p) => strategy_StreakBreaker(p, 3), emoji: '💥' },
    { name: 'Streak Break (4+same→opp)', fn: (p) => strategy_StreakBreaker(p, 4), emoji: '💥' },
    { name: 'Streak Follow (2+same→same)', fn: (p) => strategy_StreakFollower(p, 2), emoji: '🏄' },
    { name: 'RGR + Cooldown(3)', fn: (p) => strategy_RGR_Cooldown(p, 3), emoji: '❄️' },
    { name: 'RGR + Cooldown(5)', fn: (p) => strategy_RGR_Cooldown(p, 5), emoji: '❄️' },
    { name: 'Double Confirm (win→bet)', fn: (p) => strategy_DoubleConfirm(p), emoji: '✌️' },
    { name: 'RGRG Direct (4-length)', fn: (p) => strategy_RGRG_Direct(p), emoji: '📊' },
    { name: 'Break→Opposite (ABB→opp)', fn: (p) => strategy_BreakThenOpposite(p), emoji: '🎪' },
    { name: 'Win Streak Rider', fn: (p) => strategy_WinStreakRider(p), emoji: '🔥' },
    { name: 'RGR + Flip On Loss', fn: (p) => strategy_Hybrid_FlipOnLoss(p), emoji: '🪙' },
    { name: 'RGR + Trend Break Wait', fn: (p) => strategy_RGR_TrendBreakWait(p), emoji: '⏳' },
    { name: 'Contrarian Double (RR→G)', fn: (p) => strategy_ContrarianDouble(p), emoji: '🎯' },
    { name: 'RGRG + Trend Break Wait', fn: (p) => strategy_RGRG_TrendBreakWait(p), emoji: '⏳' },
    { name: 'Red Only RGR', fn: (p) => strategy_RedOnly_RGR(p), emoji: '🔴' },
    { name: 'Green Only RGR', fn: (p) => strategy_GreenOnly_RGR(p), emoji: '🟢' },
    { name: 'RGRGRG (5-length)', fn: (p) => strategy_5Length(p), emoji: '👑' },
    { name: 'RGR + Max 2 then pause', fn: (p) => strategy_RGR_Max2(p), emoji: '⏸️' },
  ];

  // Run all strategies across all categories
  const results = strategies.map(s => ({
    name: s.name,
    emoji: s.emoji,
    totalSignals: 0,
    wins: 0,
    losses: 0,
    maxLossStreak: 0,
    maxWinStreak: 0,
    perCategory: {}
  }));

  for (const [cat, periods] of Object.entries(allPeriods)) {
    for (let si = 0; si < strategies.length; si++) {
      const trades = strategies[si].fn(periods);
      const wins = trades.filter(t => t.won).length;
      const losses = trades.filter(t => !t.won).length;
      const streaks = analyzeStreaks(trades);

      results[si].totalSignals += trades.length;
      results[si].wins += wins;
      results[si].losses += losses;
      if (streaks.maxLossStreak > results[si].maxLossStreak) results[si].maxLossStreak = streaks.maxLossStreak;
      if (streaks.maxWinStreak > results[si].maxWinStreak) results[si].maxWinStreak = streaks.maxWinStreak;
      
      results[si].perCategory[cat] = {
        signals: trades.length,
        wins,
        losses,
        winRate: trades.length > 0 ? ((wins / trades.length) * 100).toFixed(1) : '0.0'
      };
    }
  }

  // Calculate derived fields
  for (const r of results) {
    r.winRate = r.totalSignals > 0 ? ((r.wins / r.totalSignals) * 100).toFixed(1) : '0.0';
    r.net = r.wins - r.losses;
  }

  // Sort by net profit (primary), win rate (secondary)
  const ranked = [...results].sort((a, b) => {
    if (b.net !== a.net) return b.net - a.net;
    return parseFloat(b.winRate) - parseFloat(a.winRate);
  });

  // Print results table
  console.log('═══════════════════════════════════════════════════════════════════════════════════');
  console.log('  RANKING BY NET PROFIT (Wins - Losses)');
  console.log('═══════════════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log('  #  │ Strategy                      │ Signals │ W    │ L    │ Win%   │ Net  │ MaxL │ MaxW');
  console.log('  ───┼───────────────────────────────┼─────────┼──────┼──────┼────────┼──────┼──────┼─────');

  ranked.forEach((r, i) => {
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '  ';
    const netStr = (r.net >= 0 ? '+' : '') + r.net;
    const isCurrent = r.name.includes('CURRENT');
    const marker = isCurrent ? ' ◀ CURRENT' : '';
    
    console.log(
      `  ${medal} │ ${(r.emoji + ' ' + r.name).padEnd(29)} │ ${String(r.totalSignals).padStart(7)} │ ${String(r.wins).padStart(4)} │ ${String(r.losses).padStart(4)} │ ${(r.winRate + '%').padStart(6)} │ ${netStr.padStart(4)} │ ${String(r.maxLossStreak).padStart(4)} │ ${String(r.maxWinStreak).padStart(4)}${marker}`
    );
  });

  console.log('');
  console.log('  MaxL = Max consecutive losses | MaxW = Max consecutive wins');

  // Top 5 detailed breakdown
  console.log('\n');
  console.log('═══════════════════════════════════════════════════════════════════════════════════');
  console.log('  🏆 TOP 5 STRATEGIES — CATEGORY-WISE BREAKDOWN');
  console.log('═══════════════════════════════════════════════════════════════════════════════════');

  const top5 = ranked.slice(0, 5);
  for (const r of top5) {
    const netStr = (r.net >= 0 ? '+' : '') + r.net;
    console.log(`\n  ${r.emoji} ${r.name} — Overall: ${r.winRate}% win, Net ${netStr}, ${r.totalSignals} signals`);
    console.log('  ┌─────────┬─────────┬──────┬──────┬────────┐');
    console.log('  │ Section │ Signals │ Wins │ Loss │ Win%   │');
    console.log('  ├─────────┼─────────┼──────┼──────┼────────┤');
    for (const [cat, data] of Object.entries(r.perCategory)) {
      console.log(`  │ ${categoryNames[cat].padEnd(7)} │ ${String(data.signals).padStart(7)} │ ${String(data.wins).padStart(4)} │ ${String(data.losses).padStart(4)} │ ${(data.winRate + '%').padStart(6)} │`);
    }
    console.log('  └─────────┴─────────┴──────┴──────┴────────┘');
  }

  // Profitability analysis with Martingale
  console.log('\n');
  console.log('═══════════════════════════════════════════════════════════════════════════════════');
  console.log('  💰 PROFIT SIMULATION (₹100 flat bet per signal)');
  console.log('═══════════════════════════════════════════════════════════════════════════════════');
  console.log('');

  // Assume: Win pays 1.96x (platform takes ~2% cut), so profit = bet * 0.96
  // Loss = -bet
  const baseBet = 100;
  const winMultiplier = 0.96; // Profit on win (1.96x payout - 1x stake = 0.96x profit)

  const profitRanking = ranked.map(r => {
    const profit = (r.wins * baseBet * winMultiplier) - (r.losses * baseBet);
    return { ...r, profit };
  }).sort((a, b) => b.profit - a.profit);

  console.log('  #  │ Strategy                      │ Gross Profit │ Net ₹');
  console.log('  ───┼───────────────────────────────┼──────────────┼──────────');
  
  profitRanking.forEach((r, i) => {
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '  ';
    const profitStr = (r.profit >= 0 ? '+' : '') + '₹' + Math.round(r.profit);
    console.log(`  ${medal} │ ${(r.emoji + ' ' + r.name).padEnd(29)} │ ${profitStr.padStart(12)} │ ${profitStr}`);
  });

  console.log('');
  console.log('  Note: Assuming 1.96x payout (96% profit on win, 100% loss on loss)');
  console.log('        Higher payout = more profit for winning strategies');

  console.log('\n');
  console.log('═══════════════════════════════════════════════════════════════════════════════════');
  console.log('  🎯 FINAL VERDICT');
  console.log('═══════════════════════════════════════════════════════════════════════════════════');
  
  const best = profitRanking[0];
  const bestNet = ranked[0];
  const bestWinRate = [...results].sort((a, b) => parseFloat(b.winRate) - parseFloat(a.winRate))[0];
  const safest = [...results].filter(r => r.totalSignals >= 20).sort((a, b) => a.maxLossStreak - b.maxLossStreak)[0];

  console.log(`\n  💰 Most Profitable:  ${best.emoji} ${best.name} (₹${Math.round(best.profit)} on ₹100/bet)`);
  console.log(`  📈 Best Win Rate:    ${bestWinRate.emoji} ${bestWinRate.name} (${bestWinRate.winRate}%)`);
  console.log(`  🛡️ Safest (low loss): ${safest ? safest.emoji + ' ' + safest.name + ' (max ' + safest.maxLossStreak + ' consecutive losses)' : 'N/A'}`);
  console.log(`  ⚖️ Best Balanced:    ${bestNet.emoji} ${bestNet.name} (Net ${(bestNet.net >= 0?'+':'') + bestNet.net}, ${bestNet.winRate}%)`);
  
  console.log('\n═══════════════════════════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
