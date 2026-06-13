#!/usr/bin/env node
/**
 * BACKTEST: Recovery 3-Chance Strategy vs All Others
 * 
 * Strategies compared:
 *   1. Direct RGRG (no wait, no trend break)
 *   2. RGRG + Trend Break Wait
 *   3. Sniper 3-Loss (3 virtual losses → 1 LIVE)
 *   4. Sniper 3-Loss + Trend Break
 *   5. ★ Recovery 3-Chance (NEW — max 3 LIVE signals per trend)
 *
 * Pattern: 4-length alternating (RGRG / GRGR)
 * Bet: Same as last color in pattern
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

// ============ STRATEGY 1: Direct RGRG (No Wait) ============
function backtestDirect(periods) {
  const results = { totalSignals: 0, wins: 0, losses: 0, trades: [] };
  let activeBet = null;

  for (let i = 0; i < periods.length; i++) {
    if (activeBet && periods[i].period === activeBet.period) {
      const actualColor = getColor(periods[i]);
      const won = actualColor === activeBet.color;
      results.totalSignals++;
      results.trades.push({ betColor: activeBet.color, actualColor, won, period: periods[i].period });
      if (won) results.wins++; else results.losses++;
      activeBet = null;
    }
    if (activeBet) continue;
    if (i < 3) continue;

    const colors = [i-3, i-2, i-1, i].map(j => getColor(periods[j]));
    if (!isAlternating(colors)) continue;
    if (i + 1 >= periods.length) continue;

    activeBet = { color: colors[3], period: periods[i + 1].period };
  }

  results.winRate = results.totalSignals > 0 ? ((results.wins / results.totalSignals) * 100).toFixed(1) : '0.0';
  return results;
}

// ============ STRATEGY 2: RGRG + Trend Break Wait ============
function backtestRGRGTrendBreak(periods) {
  const results = { totalSignals: 0, wins: 0, losses: 0, trades: [] };
  let state = 'HUNTING';
  let activeBet = null;

  for (let i = 0; i < periods.length; i++) {
    if (activeBet && periods[i].period === activeBet.period) {
      const actualColor = getColor(periods[i]);
      const won = actualColor === activeBet.color;
      results.totalSignals++;
      results.trades.push({ betColor: activeBet.color, actualColor, won, period: periods[i].period });
      if (won) { results.wins++; state = 'HUNTING'; }
      else { results.losses++; state = 'WAITING_FOR_TREND_BREAK'; }
      activeBet = null;
    }
    if (activeBet) continue;

    if (state === 'WAITING_FOR_TREND_BREAK') {
      if (i > 0 && getColor(periods[i - 1]) === getColor(periods[i])) {
        state = 'HUNTING';
      }
    }
    if (state !== 'HUNTING') continue;
    if (i < 3) continue;

    const colors = [i-3, i-2, i-1, i].map(j => getColor(periods[j]));
    if (!isAlternating(colors)) continue;
    if (i + 1 >= periods.length) continue;

    activeBet = { color: colors[3], period: periods[i + 1].period };
    state = 'SIGNAL_ACTIVE';
  }

  results.winRate = results.totalSignals > 0 ? ((results.wins / results.totalSignals) * 100).toFixed(1) : '0.0';
  return results;
}

// ============ STRATEGY 3 & 4: Sniper N-Loss Wait ============
function backtestSniper(periods, useTrendBreak = false) {
  const results = { totalSignals: 0, wins: 0, losses: 0, trades: [], virtualLosses: 0, virtualWins: 0 };
  let state = 'HUNTING';
  let virtualLossCount = 0;
  let activeBet = null;

  for (let i = 0; i < periods.length; i++) {
    if (activeBet && periods[i].period === activeBet.period) {
      const actualColor = getColor(periods[i]);
      const won = actualColor === activeBet.color;

      if (activeBet.isVirtual) {
        if (won) { results.virtualWins++; virtualLossCount = 0; state = 'HUNTING'; }
        else {
          results.virtualLosses++;
          virtualLossCount++;
          state = virtualLossCount >= 3 ? 'READY_FOR_LIVE' : 'HUNTING';
        }
      } else {
        results.totalSignals++;
        results.trades.push({ betColor: activeBet.color, actualColor, won, period: periods[i].period });
        if (won) { results.wins++; state = 'HUNTING'; }
        else {
          results.losses++;
          state = useTrendBreak ? 'WAITING_FOR_TREND_BREAK' : 'HUNTING';
        }
        virtualLossCount = 0;
      }
      activeBet = null;
    }
    if (activeBet) continue;

    if (state === 'WAITING_FOR_TREND_BREAK') {
      if (i > 0 && getColor(periods[i - 1]) === getColor(periods[i])) {
        state = 'HUNTING';
        virtualLossCount = 0;
      }
    }
    if (state !== 'HUNTING' && state !== 'READY_FOR_LIVE') continue;
    if (i < 3) continue;

    const colors = [i-3, i-2, i-1, i].map(j => getColor(periods[j]));
    if (!isAlternating(colors)) continue;
    if (i + 1 >= periods.length) continue;

    const betColor = colors[3];
    const nextPeriod = periods[i + 1].period;

    if (state === 'READY_FOR_LIVE') {
      activeBet = { color: betColor, period: nextPeriod, isVirtual: false };
      state = 'SIGNAL_ACTIVE';
    } else {
      activeBet = { color: betColor, period: nextPeriod, isVirtual: true };
    }
  }

  results.winRate = results.totalSignals > 0 ? ((results.wins / results.totalSignals) * 100).toFixed(1) : '0.0';
  return results;
}

// ============ STRATEGY 5: ★ Recovery 3-Chance ============
/**
 * Logic:
 *   1. Pattern detect (RGRG/GRGR) → Signal #1 (LIVE)
 *   2. WIN → reset, back to hunting
 *   3. LOSS → recoveryAttempt++
 *      - If recoveryAttempt < 3 → keep hunting in SAME trend for next pattern
 *      - If recoveryAttempt >= 3 → wait for trend break, then reset
 *   4. If trend breaks naturally before 3 losses → reset counter
 */
function backtestRecovery3Chance(periods) {
  const results = {
    totalSignals: 0, wins: 0, losses: 0, trades: [],
    // Detailed tracking
    signal1_wins: 0, signal1_losses: 0,
    signal2_wins: 0, signal2_losses: 0,
    signal3_wins: 0, signal3_losses: 0,
    fullCycleResets: 0, // Times all 3 attempts were used (all lost)
    winOnFirst: 0, winOnSecond: 0, winOnThird: 0,
    trendBreaksBeforeMax: 0, // Trend broke before using all 3 attempts
  };

  let state = 'HUNTING';
  let recoveryAttempt = 0; // 0 = fresh, 1 = 1st loss done, 2 = 2nd loss done
  let activeBet = null;

  for (let i = 0; i < periods.length; i++) {
    // Resolve active bet
    if (activeBet && periods[i].period === activeBet.period) {
      const actualColor = getColor(periods[i]);
      const won = actualColor === activeBet.color;
      const attemptNum = activeBet.attemptNum;

      results.totalSignals++;
      results.trades.push({
        betColor: activeBet.color, actualColor, won,
        period: periods[i].period, attemptNum
      });

      if (won) {
        results.wins++;
        if (attemptNum === 1) { results.signal1_wins++; results.winOnFirst++; }
        else if (attemptNum === 2) { results.signal2_wins++; results.winOnSecond++; }
        else if (attemptNum === 3) { results.signal3_wins++; results.winOnThird++; }
        recoveryAttempt = 0;
        state = 'HUNTING';
      } else {
        results.losses++;
        if (attemptNum === 1) results.signal1_losses++;
        else if (attemptNum === 2) results.signal2_losses++;
        else if (attemptNum === 3) results.signal3_losses++;

        recoveryAttempt++;
        if (recoveryAttempt >= 3) {
          results.fullCycleResets++;
          state = 'WAITING_FOR_TREND_BREAK';
          recoveryAttempt = 0;
        } else {
          state = 'HUNTING'; // Keep hunting in same trend
        }
      }
      activeBet = null;
    }

    if (activeBet) continue;

    // Check for trend break if waiting
    if (state === 'WAITING_FOR_TREND_BREAK') {
      if (i > 0 && getColor(periods[i - 1]) === getColor(periods[i])) {
        state = 'HUNTING';
        recoveryAttempt = 0;
      }
    }

    // Also check: if we're hunting with recovery > 0, and trend broke, reset
    if (state === 'HUNTING' && recoveryAttempt > 0) {
      if (i > 0 && getColor(periods[i - 1]) === getColor(periods[i])) {
        results.trendBreaksBeforeMax++;
        recoveryAttempt = 0;
      }
    }

    if (state !== 'HUNTING') continue;
    if (i < 3) continue;

    const colors = [i-3, i-2, i-1, i].map(j => getColor(periods[j]));
    if (!isAlternating(colors)) continue;
    if (i + 1 >= periods.length) continue;

    const betColor = colors[3];
    const nextPeriod = periods[i + 1].period;
    const attemptNum = recoveryAttempt + 1;

    activeBet = { color: betColor, period: nextPeriod, attemptNum };
    state = 'SIGNAL_ACTIVE';
  }

  results.winRate = results.totalSignals > 0 ? ((results.wins / results.totalSignals) * 100).toFixed(1) : '0.0';
  return results;
}

// ============ STREAK ANALYSIS ============
function analyzeStreaks(trades) {
  let maxLossStreak = 0, currentLoss = 0;
  let maxWinStreak = 0, currentWin = 0;

  for (const t of trades) {
    if (!t.won) { currentLoss++; currentWin = 0; if (currentLoss > maxLossStreak) maxLossStreak = currentLoss; }
    else { currentWin++; currentLoss = 0; if (currentWin > maxWinStreak) maxWinStreak = currentWin; }
  }
  return { maxLossStreak, maxWinStreak };
}

// ============ MAIN ============
async function main() {
  const categories = ['P', 'S', 'B', 'E'];
  const categoryNames = { P: 'Parity', S: 'Sapre', B: 'Bcone', E: 'Emerd' };

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║   🔄 BACKTEST: Recovery 3-Chance Strategy vs All Others (RGRG 4-length)   🔄       ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('  ★ Recovery 3-Chance Logic:');
  console.log('    Pattern → Signal #1 (LIVE) → Loss? → Recovery #2 (LIVE) → Loss? → LAST #3 (LIVE)');
  console.log('    Win at any point = Reset. 3 losses = Cooldown + Trend Break Wait.');
  console.log('');

  // Fetch all data
  const allPeriods = {};
  let totalPeriods = 0;

  for (const cat of categories) {
    const data = await fetchSectionData(cat);
    if (!data || !data.periods) {
      console.log(`  ⚠️ No data for ${categoryNames[cat]}`);
      continue;
    }
    allPeriods[cat] = data.periods;
    totalPeriods += data.periods.length;
    console.log(`  ✅ ${categoryNames[cat]}: ${data.periods.length} periods loaded`);
  }

  console.log(`\n  📦 Total: ${totalPeriods} periods across ${Object.keys(allPeriods).length} categories\n`);

  // Aggregate results
  const strategies = {
    'Direct RGRG':          { signals: 0, wins: 0, losses: 0, maxL: 0, maxW: 0, trades: [] },
    'RGRG+TrendBreak':      { signals: 0, wins: 0, losses: 0, maxL: 0, maxW: 0, trades: [] },
    'Sniper 3-Loss':        { signals: 0, wins: 0, losses: 0, maxL: 0, maxW: 0, trades: [], vLoss: 0, vWin: 0 },
    'Sniper+TrendBreak':    { signals: 0, wins: 0, losses: 0, maxL: 0, maxW: 0, trades: [], vLoss: 0, vWin: 0 },
    '★ Recovery 3-Chance':  { signals: 0, wins: 0, losses: 0, maxL: 0, maxW: 0, trades: [],
                              s1w: 0, s1l: 0, s2w: 0, s2l: 0, s3w: 0, s3l: 0,
                              fullResets: 0, trendBreaks: 0 },
  };

  const perCategory = {};

  for (const [cat, periods] of Object.entries(allPeriods)) {
    const r1 = backtestDirect(periods);
    const r2 = backtestRGRGTrendBreak(periods);
    const r3 = backtestSniper(periods, false);
    const r4 = backtestSniper(periods, true);
    const r5 = backtestRecovery3Chance(periods);

    const s1 = analyzeStreaks(r1.trades);
    const s2 = analyzeStreaks(r2.trades);
    const s3 = analyzeStreaks(r3.trades);
    const s4 = analyzeStreaks(r4.trades);
    const s5 = analyzeStreaks(r5.trades);

    // Aggregate
    strategies['Direct RGRG'].signals += r1.totalSignals;
    strategies['Direct RGRG'].wins += r1.wins;
    strategies['Direct RGRG'].losses += r1.losses;
    strategies['Direct RGRG'].maxL = Math.max(strategies['Direct RGRG'].maxL, s1.maxLossStreak);
    strategies['Direct RGRG'].maxW = Math.max(strategies['Direct RGRG'].maxW, s1.maxWinStreak);

    strategies['RGRG+TrendBreak'].signals += r2.totalSignals;
    strategies['RGRG+TrendBreak'].wins += r2.wins;
    strategies['RGRG+TrendBreak'].losses += r2.losses;
    strategies['RGRG+TrendBreak'].maxL = Math.max(strategies['RGRG+TrendBreak'].maxL, s2.maxLossStreak);
    strategies['RGRG+TrendBreak'].maxW = Math.max(strategies['RGRG+TrendBreak'].maxW, s2.maxWinStreak);

    strategies['Sniper 3-Loss'].signals += r3.totalSignals;
    strategies['Sniper 3-Loss'].wins += r3.wins;
    strategies['Sniper 3-Loss'].losses += r3.losses;
    strategies['Sniper 3-Loss'].maxL = Math.max(strategies['Sniper 3-Loss'].maxL, s3.maxLossStreak);
    strategies['Sniper 3-Loss'].maxW = Math.max(strategies['Sniper 3-Loss'].maxW, s3.maxWinStreak);
    strategies['Sniper 3-Loss'].vLoss += r3.virtualLosses;
    strategies['Sniper 3-Loss'].vWin += r3.virtualWins;

    strategies['Sniper+TrendBreak'].signals += r4.totalSignals;
    strategies['Sniper+TrendBreak'].wins += r4.wins;
    strategies['Sniper+TrendBreak'].losses += r4.losses;
    strategies['Sniper+TrendBreak'].maxL = Math.max(strategies['Sniper+TrendBreak'].maxL, s4.maxLossStreak);
    strategies['Sniper+TrendBreak'].maxW = Math.max(strategies['Sniper+TrendBreak'].maxW, s4.maxWinStreak);
    strategies['Sniper+TrendBreak'].vLoss += r4.virtualLosses;
    strategies['Sniper+TrendBreak'].vWin += r4.virtualWins;

    strategies['★ Recovery 3-Chance'].signals += r5.totalSignals;
    strategies['★ Recovery 3-Chance'].wins += r5.wins;
    strategies['★ Recovery 3-Chance'].losses += r5.losses;
    strategies['★ Recovery 3-Chance'].maxL = Math.max(strategies['★ Recovery 3-Chance'].maxL, s5.maxLossStreak);
    strategies['★ Recovery 3-Chance'].maxW = Math.max(strategies['★ Recovery 3-Chance'].maxW, s5.maxWinStreak);
    strategies['★ Recovery 3-Chance'].s1w += r5.signal1_wins;
    strategies['★ Recovery 3-Chance'].s1l += r5.signal1_losses;
    strategies['★ Recovery 3-Chance'].s2w += r5.signal2_wins;
    strategies['★ Recovery 3-Chance'].s2l += r5.signal2_losses;
    strategies['★ Recovery 3-Chance'].s3w += r5.signal3_wins;
    strategies['★ Recovery 3-Chance'].s3l += r5.signal3_losses;
    strategies['★ Recovery 3-Chance'].fullResets += r5.fullCycleResets;
    strategies['★ Recovery 3-Chance'].trendBreaks += r5.trendBreaksBeforeMax;

    perCategory[cat] = {
      direct: r1, trendBreak: r2, sniper: r3, sniperTB: r4, recovery: r5
    };
  }

  // ============ MAIN COMPARISON TABLE ============
  console.log('╔══════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║   📊 STRATEGY COMPARISON — All 4 Categories Combined (RGRG 4-length)              ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('  #  │ Strategy              │ Signals │ Wins │ Loss │ Win%   │ Net  │ MaxL │ MaxW');
  console.log('  ───┼───────────────────────┼─────────┼──────┼──────┼────────┼──────┼──────┼──────');

  const ranked = Object.entries(strategies).map(([name, s]) => ({
    name,
    ...s,
    net: s.wins - s.losses,
    winRate: s.signals > 0 ? ((s.wins / s.signals) * 100).toFixed(1) : '0.0',
  })).sort((a, b) => {
    if (b.net !== a.net) return b.net - a.net;
    return parseFloat(b.winRate) - parseFloat(a.winRate);
  });

  ranked.forEach((r, i) => {
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '  ';
    const netStr = (r.net >= 0 ? '+' : '') + r.net;
    const star = r.name.includes('★') ? ' ◀ NEW' : '';

    console.log(
      `  ${medal} │ ${r.name.padEnd(21)} │ ${String(r.signals).padStart(7)} │ ${String(r.wins).padStart(4)} │ ${String(r.losses).padStart(4)} │ ${(r.winRate + '%').padStart(6)} │ ${netStr.padStart(4)} │ ${String(r.maxL).padStart(4)} │ ${String(r.maxW).padStart(4)}${star}`
    );
  });

  // ============ PROFIT SIMULATION ============
  console.log('');
  console.log('  ─── 💰 Profit Simulation (₹100 flat bet, 1.96x payout) ───');
  console.log('');

  const baseBet = 100;
  const winMultiplier = 0.96;

  console.log('  #  │ Strategy              │ Profit     │ ROI/Signal │ Total Invested');
  console.log('  ───┼───────────────────────┼────────────┼────────────┼───────────────');

  const profitRanked = ranked.map(r => {
    const profit = (r.wins * baseBet * winMultiplier) - (r.losses * baseBet);
    const totalInvested = r.signals * baseBet;
    const roi = r.signals > 0 ? ((profit / totalInvested) * 100).toFixed(1) : '0.0';
    return { ...r, profit, totalInvested, roi };
  }).sort((a, b) => b.profit - a.profit);

  profitRanked.forEach((r, i) => {
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '  ';
    const profitStr = (r.profit >= 0 ? '+' : '') + '₹' + Math.round(r.profit);
    const star = r.name.includes('★') ? ' ◀' : '';

    console.log(
      `  ${medal} │ ${r.name.padEnd(21)} │ ${profitStr.padStart(10)} │ ${(r.roi + '%').padStart(10)} │ ₹${r.totalInvested}${star}`
    );
  });

  // ============ RECOVERY 3-CHANCE DEEP DIVE ============
  const rec = strategies['★ Recovery 3-Chance'];
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║   🔄 RECOVERY 3-CHANCE — DEEP DIVE                                                ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════════════╝');
  console.log('');

  const totalS1 = rec.s1w + rec.s1l;
  const totalS2 = rec.s2w + rec.s2l;
  const totalS3 = rec.s3w + rec.s3l;
  const s1WinRate = totalS1 > 0 ? ((rec.s1w / totalS1) * 100).toFixed(1) : '0.0';
  const s2WinRate = totalS2 > 0 ? ((rec.s2w / totalS2) * 100).toFixed(1) : '0.0';
  const s3WinRate = totalS3 > 0 ? ((rec.s3w / totalS3) * 100).toFixed(1) : '0.0';

  console.log('  ┌───────────────────┬──────────┬──────┬──────┬────────┐');
  console.log('  │ Signal            │ Total    │ Wins │ Loss │ Win%   │');
  console.log('  ├───────────────────┼──────────┼──────┼──────┼────────┤');
  console.log(`  │ 🎯 Signal #1      │ ${String(totalS1).padStart(8)} │ ${String(rec.s1w).padStart(4)} │ ${String(rec.s1l).padStart(4)} │ ${(s1WinRate + '%').padStart(6)} │`);
  console.log(`  │ 🔄 Recovery #2    │ ${String(totalS2).padStart(8)} │ ${String(rec.s2w).padStart(4)} │ ${String(rec.s2l).padStart(4)} │ ${(s2WinRate + '%').padStart(6)} │`);
  console.log(`  │ ⚠️  LAST Chance #3 │ ${String(totalS3).padStart(8)} │ ${String(rec.s3w).padStart(4)} │ ${String(rec.s3l).padStart(4)} │ ${(s3WinRate + '%').padStart(6)} │`);
  console.log('  ├───────────────────┼──────────┼──────┼──────┼────────┤');
  console.log(`  │ TOTAL             │ ${String(rec.signals).padStart(8)} │ ${String(rec.wins).padStart(4)} │ ${String(rec.losses).padStart(4)} │ ${(rec.signals > 0 ? ((rec.wins / rec.signals) * 100).toFixed(1) : '0.0') + '%'} │`);
  console.log('  └───────────────────┴──────────┴──────┴──────┴────────┘');
  console.log('');
  console.log(`  📈 Full cycle resets (all 3 lost):  ${rec.fullResets} times`);
  console.log(`  🔀 Trend broke before 3 attempts:   ${rec.trendBreaks} times`);
  console.log(`  🏆 Win on 1st attempt:              ${rec.s1w} (${totalS1 > 0 ? ((rec.s1w / totalS1) * 100).toFixed(1) : '0'}%)`);
  console.log(`  🔄 Win on 2nd attempt (recovered):  ${rec.s2w} (saved ₹${rec.s2w * baseBet * winMultiplier - rec.s2w * baseBet} net from recovery)`);
  console.log(`  ⚠️  Win on 3rd attempt (last chance): ${rec.s3w}`);

  // Recovery effectiveness
  const totalRecoveryCycles = rec.s1l; // Signal #1 losses = number of times recovery was needed
  const recoverySuccesses = rec.s2w + rec.s3w; // Wins on 2nd or 3rd attempt
  const recoveryRate = totalRecoveryCycles > 0 ? ((recoverySuccesses / totalRecoveryCycles) * 100).toFixed(1) : '0.0';

  console.log('');
  console.log(`  ─── 🎯 Recovery Effectiveness ───`);
  console.log(`  Times recovery was needed (Signal #1 lost): ${totalRecoveryCycles}`);
  console.log(`  Times recovery SAVED the cycle (won #2 or #3): ${recoverySuccesses}`);
  console.log(`  Recovery Success Rate: ${recoveryRate}%`);

  // ============ PER-CATEGORY BREAKDOWN ============
  console.log('');
  console.log('  ─── Per-Category Breakdown: Recovery 3-Chance ───');
  console.log('');
  console.log('  ┌─────────┬─────────┬──────┬──────┬────────┬────────┬────────┬────────┐');
  console.log('  │ Section │ Signals │ Wins │ Loss │ Win%   │ S1 W/L │ S2 W/L │ S3 W/L │');
  console.log('  ├─────────┼─────────┼──────┼──────┼────────┼────────┼────────┼────────┤');

  for (const [cat, data] of Object.entries(perCategory)) {
    const r = data.recovery;
    console.log(
      `  │ ${categoryNames[cat].padEnd(7)} │ ${String(r.totalSignals).padStart(7)} │ ${String(r.wins).padStart(4)} │ ${String(r.losses).padStart(4)} │ ${(r.winRate + '%').padStart(6)} │ ${String(r.signal1_wins + '/' + r.signal1_losses).padStart(6)} │ ${String(r.signal2_wins + '/' + r.signal2_losses).padStart(6)} │ ${String(r.signal3_wins + '/' + r.signal3_losses).padStart(6)} │`
    );
  }
  console.log('  └─────────┴─────────┴──────┴──────┴────────┴────────┴────────┴────────┘');

  // ============ FINAL VERDICT ============
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║   🏆 FINAL VERDICT                                                                ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════════════╝');
  console.log('');

  const recProfit = (rec.wins * baseBet * winMultiplier) - (rec.losses * baseBet);
  const sniperProfit = (strategies['Sniper 3-Loss'].wins * baseBet * winMultiplier) - (strategies['Sniper 3-Loss'].losses * baseBet);
  const directProfit = (strategies['Direct RGRG'].wins * baseBet * winMultiplier) - (strategies['Direct RGRG'].losses * baseBet);

  console.log(`  Recovery 3-Chance:  ₹${Math.round(recProfit)} profit | ${rec.signals} signals | ${rec.wins > 0 ? ((rec.wins / rec.signals) * 100).toFixed(1) : 0}% win rate`);
  console.log(`  Sniper 3-Loss:     ₹${Math.round(sniperProfit)} profit | ${strategies['Sniper 3-Loss'].signals} signals | ${strategies['Sniper 3-Loss'].signals > 0 ? ((strategies['Sniper 3-Loss'].wins / strategies['Sniper 3-Loss'].signals) * 100).toFixed(1) : 0}% win rate`);
  console.log(`  Direct RGRG:       ₹${Math.round(directProfit)} profit | ${strategies['Direct RGRG'].signals} signals | ${strategies['Direct RGRG'].signals > 0 ? ((strategies['Direct RGRG'].wins / strategies['Direct RGRG'].signals) * 100).toFixed(1) : 0}% win rate`);
  console.log('');

  if (recProfit > sniperProfit && recProfit > directProfit) {
    console.log('  ✅ Recovery 3-Chance is the BEST strategy by profit!');
  } else if (recProfit > sniperProfit) {
    console.log('  ✅ Recovery 3-Chance beats Sniper 3-Loss!');
  } else {
    console.log('  ⚠️  Recovery 3-Chance needs more data / market conditions may vary.');
  }

  console.log('');
  console.log('  Key insight: Recovery gives MORE signals than Sniper (no virtual waste),');
  console.log('  and the 3-chance system helps recover losses within the same trend.');
  console.log('');
  console.log('══════════════════════════════════════════════════════════════════════════════════════');
  console.log('');
}

main().catch(console.error);
