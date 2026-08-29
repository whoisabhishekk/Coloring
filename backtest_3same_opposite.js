#!/usr/bin/env node
/**
 * BACKTEST: 3 Same Colors → Bet Opposite (with Trend Skip on Loss)
 *
 * Rules:
 *   1. Detect 3 consecutive same colors (RRR or GGG)
 *   2. Bet OPPOSITE color on the next period
 *   3. If WIN  → go back to hunting for next 3-same pattern
 *   4. If LOSS → the same-color streak continued (e.g. RRR→bet G→got R = RRRR)
 *      • Do NOT bet again while this same-color trend is still alive
 *      • Wait for the trend to break (a different color appears)
 *      • Then wait for a FRESH 3 same colors before betting again
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

// ============ HELPERS ============
function getColor(period) {
  return period.is_green ? 'G' : 'R';
}

// ============ STRATEGY 1: DIRECT (no skip on loss) ============
function backtestDirect(periods) {
  const trades = [];
  let activeBet = null;

  for (let i = 0; i < periods.length; i++) {
    // Resolve active bet
    if (activeBet && periods[i].period === activeBet.period) {
      const actualColor = getColor(periods[i]);
      const won = actualColor === activeBet.color;
      trades.push({
        period: periods[i].period,
        trigger: activeBet.trigger,
        betColor: activeBet.color,
        actualColor,
        won
      });
      activeBet = null;
    }

    if (activeBet) continue;

    // Need at least 3 periods to look back
    if (i < 2) continue;

    const c1 = getColor(periods[i - 2]);
    const c2 = getColor(periods[i - 1]);
    const c3 = getColor(periods[i]);

    // Check for 3 same colors
    if (c1 === c2 && c2 === c3) {
      if (i + 1 < periods.length) {
        const oppositeColor = c3 === 'R' ? 'G' : 'R';
        activeBet = {
          color: oppositeColor,
          period: periods[i + 1].period,
          trigger: `${c1}${c2}${c3}→${oppositeColor}`
        };
      }
    }
  }

  return trades;
}

// ============ STRATEGY 2: SKIP ON LOSS + WAIT FOR FRESH 3 ============
function backtestSkipOnLoss(periods) {
  const trades = [];
  // HUNTING         = looking for 3 same colors to bet
  // SIGNAL_ACTIVE   = bet placed, waiting to resolve
  // SKIPPING_TREND  = loss happened, skip while same-color trend continues
  // WAITING_FRESH   = trend broke, now waiting for a fresh 3 same colors
  let state = 'HUNTING';
  let activeBet = null;
  let trendColor = null;   // the color of the trend we're skipping
  let freshCount = 0;      // count of consecutive same colors in new tracking

  for (let i = 0; i < periods.length; i++) {
    const currentColor = getColor(periods[i]);

    // ── Resolve active bet ──
    if (activeBet && periods[i].period === activeBet.period) {
      const actualColor = currentColor;
      const won = actualColor === activeBet.color;
      trades.push({
        period: periods[i].period,
        trigger: activeBet.trigger,
        betColor: activeBet.color,
        actualColor,
        won
      });
      activeBet = null;

      if (won) {
        // Win → trend reversed, go back to hunting
        state = 'HUNTING';
      } else {
        // Loss → trend continued (e.g. RRR bet G got R = RRRR)
        // Skip until this trend breaks
        state = 'SKIPPING_TREND';
        trendColor = actualColor; // the color that's still running
      }
      continue;
    }

    if (activeBet) continue;

    // ── Handle SKIPPING_TREND state ──
    if (state === 'SKIPPING_TREND') {
      if (currentColor !== trendColor) {
        // Trend broke! Now we need a FRESH 3 same colors
        state = 'WAITING_FRESH';
        freshCount = 1; // this different color is the start of a potential new run
        trendColor = null;
      }
      // If still same color, stay in SKIPPING_TREND
      continue;
    }

    // ── Handle WAITING_FRESH state ──
    if (state === 'WAITING_FRESH') {
      // Track consecutive same colors from scratch
      if (i > 0 && currentColor === getColor(periods[i - 1])) {
        freshCount++;
      } else {
        freshCount = 1;
      }

      // Once we get 3 fresh same colors, place the bet
      if (freshCount >= 3) {
        if (i + 1 < periods.length) {
          const oppositeColor = currentColor === 'R' ? 'G' : 'R';
          activeBet = {
            color: oppositeColor,
            period: periods[i + 1].period,
            trigger: `${currentColor}${currentColor}${currentColor}→${oppositeColor}`
          };
          state = 'SIGNAL_ACTIVE';
        }
      }
      continue;
    }

    // ── HUNTING state: look for 3 same colors ──
    if (i < 2) continue;

    const c1 = getColor(periods[i - 2]);
    const c2 = getColor(periods[i - 1]);
    const c3 = currentColor;

    if (c1 === c2 && c2 === c3) {
      if (i + 1 < periods.length) {
        const oppositeColor = c3 === 'R' ? 'G' : 'R';
        activeBet = {
          color: oppositeColor,
          period: periods[i + 1].period,
          trigger: `${c1}${c2}${c3}→${oppositeColor}`
        };
        state = 'SIGNAL_ACTIVE';
      }
    }
  }

  return trades;
}

// ============ CONSECUTIVE LOSS ANALYSIS ============
function analyzeConsecutiveLosses(trades) {
  let currentStreak = 0;
  let maxStreak = 0;
  const allStreaks = [];
  let streakStart = -1;

  for (let i = 0; i < trades.length; i++) {
    if (!trades[i].won) {
      if (currentStreak === 0) streakStart = i;
      currentStreak++;
      if (currentStreak > maxStreak) maxStreak = currentStreak;
    } else {
      if (currentStreak > 0) {
        allStreaks.push({ length: currentStreak, startIdx: streakStart, endIdx: i - 1 });
      }
      currentStreak = 0;
    }
  }
  if (currentStreak > 0) {
    allStreaks.push({ length: currentStreak, startIdx: streakStart, endIdx: trades.length - 1 });
  }

  const streakFreq = {};
  for (const s of allStreaks) {
    streakFreq[s.length] = (streakFreq[s.length] || 0) + 1;
  }

  return { maxStreak, allStreaks, streakFreq };
}

// ============ PRINT HELPERS ============
function printStreakFreq(freq) {
  const sorted = Object.keys(freq).map(Number).sort((a, b) => a - b);
  for (const len of sorted) {
    const bar = '█'.repeat(Math.min(freq[len] * 2, 40));
    console.log(`     ${String(len).padStart(2)} in a row: ${String(freq[len]).padStart(3)} times  ${bar}`);
  }
}

function printStrategyResult(label, trades) {
  const wins = trades.filter(t => t.won).length;
  const losses = trades.filter(t => !t.won).length;
  const winRate = trades.length > 0 ? (wins / trades.length * 100).toFixed(1) : '0.0';
  const net = wins - losses;
  const { maxStreak, allStreaks, streakFreq } = analyzeConsecutiveLosses(trades);

  // Split by trigger
  const rrrTrades = trades.filter(t => t.trigger.startsWith('RRR'));
  const gggTrades = trades.filter(t => t.trigger.startsWith('GGG'));
  const rrrWins = rrrTrades.filter(t => t.won).length;
  const gggWins = gggTrades.filter(t => t.won).length;

  console.log(`\n  ── ${label} ──`);
  console.log(`  Trades: ${trades.length}  |  ✅ Wins: ${wins}  |  ❌ Losses: ${losses}  |  Win Rate: ${winRate}%`);
  console.log(`  Net P/L: ${net >= 0 ? '+' : ''}${net} units`);
  console.log(`  📉 RRR→G: ${rrrTrades.length} trades (won ${rrrWins}, ${rrrTrades.length > 0 ? (rrrWins / rrrTrades.length * 100).toFixed(1) : 0}%)`);
  console.log(`  📈 GGG→R: ${gggTrades.length} trades (won ${gggWins}, ${gggTrades.length > 0 ? (gggWins / gggTrades.length * 100).toFixed(1) : 0}%)`);
  console.log(`  🔴 Max Consecutive Losses: ${maxStreak}`);

  if (Object.keys(streakFreq).length > 0) {
    console.log(`  Loss Streak Breakdown:`);
    printStreakFreq(streakFreq);
  }

  // Show worst streaks
  const worstStreaks = allStreaks.filter(s => s.length >= 3).sort((a, b) => b.length - a.length);
  if (worstStreaks.length > 0) {
    console.log(`\n  ⚠️ Worst streaks (3+ consecutive losses):`);
    for (const s of worstStreaks.slice(0, 5)) {
      const details = trades.slice(s.startIdx, s.endIdx + 1)
        .map(t => `${t.trigger}→${t.actualColor}`)
        .join(', ');
      console.log(`     ${s.length} losses: Trade #${s.startIdx + 1}-${s.endIdx + 1}  [${details}]`);
    }
  }

  // Trade sequence (last 50)
  console.log(`\n  Trade sequence (last 50):`);
  const recent = trades.slice(-50);
  let line = '     ';
  for (const t of recent) {
    line += t.won ? '✅' : '❌';
  }
  console.log(line);

  return { wins, losses, winRate, net, maxStreak, streakFreq };
}

// ============ MAIN ============
async function main() {
  const categories = ['P', 'S', 'B', 'E'];
  const categoryNames = { P: 'Parity', S: 'Sapre', B: 'Bcone', E: 'Emerd' };

  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('  📊 BACKTEST: 3 Same Colors → Bet Opposite');
  console.log('     Strategy A: Direct (always bet after 3 same)');
  console.log('     Strategy B: Skip on Loss (wait for trend end + fresh 3 same)');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  const totalDirect = { trades: [] };
  const totalSkip = { trades: [] };

  for (const cat of categories) {
    const data = await fetchSectionData(cat);
    if (!data || !data.periods || data.periods.length === 0) {
      console.log(`  ⚠️ No data for ${categoryNames[cat]}`);
      continue;
    }

    const periods = data.periods;

    // Show color distribution
    const greens = periods.filter(p => p.is_green).length;
    const reds = periods.length - greens;

    // Find longest streaks in raw data
    let maxSameStreak = 0;
    let currentSameStreak = 1;
    for (let i = 1; i < periods.length; i++) {
      if (getColor(periods[i]) === getColor(periods[i - 1])) {
        currentSameStreak++;
        if (currentSameStreak > maxSameStreak) maxSameStreak = currentSameStreak;
      } else {
        currentSameStreak = 1;
      }
    }

    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`  ${categoryNames[cat]} (${cat}) — ${periods.length} periods | 🟢 ${greens} Green | 🔴 ${reds} Red | Max same-color streak: ${maxSameStreak}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    const directTrades = backtestDirect(periods);
    const skipTrades = backtestSkipOnLoss(periods);

    printStrategyResult('Strategy A: DIRECT (always bet after 3 same)', directTrades);
    printStrategyResult('Strategy B: SKIP ON LOSS (wait for trend end + fresh 3)', skipTrades);

    // Improvement comparison
    const directWR = directTrades.length > 0 ? (directTrades.filter(t => t.won).length / directTrades.length * 100) : 0;
    const skipWR = skipTrades.length > 0 ? (skipTrades.filter(t => t.won).length / skipTrades.length * 100) : 0;
    const wrDiff = skipWR - directWR;
    const sigDiff = skipTrades.length - directTrades.length;

    console.log(`\n  📊 Comparison:`);
    console.log(`     Signals: ${sigDiff >= 0 ? '+' : ''}${sigDiff} (${directTrades.length} → ${skipTrades.length})`);
    console.log(`     Win Rate: ${wrDiff >= 0 ? '+' : ''}${wrDiff.toFixed(1)}% (${directWR.toFixed(1)}% → ${skipWR.toFixed(1)}%)`);

    totalDirect.trades = totalDirect.trades.concat(directTrades);
    totalSkip.trades = totalSkip.trades.concat(skipTrades);
  }

  // ============ COMBINED SUMMARY ============
  console.log('\n\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('  📊 COMBINED SUMMARY (All 4 Categories)');
  console.log('═══════════════════════════════════════════════════════════════════════════════');

  const directStats = printStrategyResult('Strategy A: DIRECT (Combined)', totalDirect.trades);
  const skipStats = printStrategyResult('Strategy B: SKIP ON LOSS (Combined)', totalSkip.trades);

  // Final comparison table
  console.log('\n\n  ┌────────────────────────────────────────────────────────────┐');
  console.log('  │                │   Direct (A)    │   Skip on Loss (B)    │');
  console.log('  ├────────────────────────────────────────────────────────────┤');
  console.log(`  │  Total Trades  │ ${String(totalDirect.trades.length).padStart(15)} │ ${String(totalSkip.trades.length).padStart(21)} │`);
  console.log(`  │  Wins          │ ${String(directStats.wins).padStart(15)} │ ${String(skipStats.wins).padStart(21)} │`);
  console.log(`  │  Losses        │ ${String(directStats.losses).padStart(15)} │ ${String(skipStats.losses).padStart(21)} │`);
  console.log(`  │  Win Rate      │ ${(directStats.winRate + '%').padStart(15)} │ ${(skipStats.winRate + '%').padStart(21)} │`);
  console.log(`  │  Net P/L       │ ${((directStats.net >= 0 ? '+' : '') + directStats.net).padStart(15)} │ ${((skipStats.net >= 0 ? '+' : '') + skipStats.net).padStart(21)} │`);
  console.log(`  │  Max Loss Strk │ ${String(directStats.maxStreak).padStart(15)} │ ${String(skipStats.maxStreak).padStart(21)} │`);
  console.log('  └────────────────────────────────────────────────────────────┘');

  // Verdict
  const directWR = parseFloat(directStats.winRate);
  const skipWR = parseFloat(skipStats.winRate);
  console.log('\n  🏆 VERDICT:');
  if (skipWR > directWR) {
    console.log(`     Skip on Loss strategy WINS by +${(skipWR - directWR).toFixed(1)}% win rate`);
    console.log(`     Fewer signals (${totalSkip.trades.length} vs ${totalDirect.trades.length}) but HIGHER quality`);
  } else if (directWR > skipWR) {
    console.log(`     Direct strategy WINS by +${(directWR - skipWR).toFixed(1)}% win rate`);
    console.log(`     Skipping on loss did NOT improve quality in this dataset`);
  } else {
    console.log(`     Both strategies have EQUAL win rate of ${directWR}%`);
  }

  if (skipStats.maxStreak < directStats.maxStreak) {
    console.log(`     ✅ Skip strategy has LOWER max loss streak (${skipStats.maxStreak} vs ${directStats.maxStreak})`);
  } else if (skipStats.maxStreak === directStats.maxStreak) {
    console.log(`     ⚖️ Both strategies have same max loss streak of ${skipStats.maxStreak}`);
  } else {
    console.log(`     ⚠️ Skip strategy has HIGHER max loss streak (${skipStats.maxStreak} vs ${directStats.maxStreak})`);
  }

  // Martingale risk table
  const maxLoss = Math.max(directStats.maxStreak, skipStats.maxStreak);
  console.log('\n  💰 Martingale Risk (₹10 base bet):');
  for (let streak = 1; streak <= Math.min(maxLoss, 10); streak++) {
    const totalLost = Array.from({ length: streak }, (_, i) => 10 * Math.pow(2, i)).reduce((a, b) => a + b, 0);
    const nextBet = 10 * Math.pow(2, streak);
    console.log(`     ${String(streak).padStart(2)} loss${streak > 1 ? 'es' : '  '}: Total invested: ₹${totalLost.toLocaleString().padStart(7)}, Next bet: ₹${nextBet.toLocaleString().padStart(7)}`);
  }

  console.log('\n═══════════════════════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
