#!/usr/bin/env node
/**
 * BACKTEST: Compare N-Loss Wait strategies
 * 
 * Logic: Per pattern pe N baar virtual loss hone do, phir (N+1)th pattern pe LIVE bet lagao.
 * 
 * Strategies tested:
 *   - Direct (no wait) — har pattern pe seedha bet
 *   - 1-Loss Wait — 1 virtual loss ke baad next pattern pe LIVE
 *   - 2-Loss Wait — 2 virtual losses ke baad next pattern pe LIVE
 *   - 3-Loss Wait — 3 virtual losses ke baad next pattern pe LIVE (NEW REQUEST)
 * 
 * Both 3-length (RGR) and 4-length (RGRG) patterns tested.
 * Also with and without Trend Break Wait after LIVE loss.
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

// ============ STRATEGY: N-LOSS WAIT ============
/**
 * N-loss wait strategy:
 *   1. Pattern detect karo (alternating colors of given length).
 *   2. Pehle N patterns pe virtual bet lagao (count karo losses).
 *   3. Jab N virtual losses ho jayein, next pattern pe LIVE bet lagao.
 *   4. LIVE bet ke baad:
 *      - WIN → counter reset, wapas HUNTING
 *      - LOSS (with trendBreak) → WAITING_FOR_TREND_BREAK, phir reset
 *      - LOSS (without trendBreak) → counter reset, wapas HUNTING
 *   
 * @param {Array} periods - Array of period objects
 * @param {number} patternLength - 3 for RGR, 4 for RGRG
 * @param {number} requiredLosses - How many virtual losses needed before LIVE bet
 * @param {boolean} useTrendBreak - Whether to wait for trend break after LIVE loss
 */
function backtestNLossWait(periods, patternLength, requiredLosses, useTrendBreak = false) {
  const results = { totalSignals: 0, wins: 0, losses: 0, trades: [], virtualLosses: 0, virtualWins: 0 };
  let state = 'HUNTING';
  let virtualLossCount = 0; // Current count of consecutive virtual losses
  let activeBet = null;

  for (let i = 0; i < periods.length; i++) {
    // Resolve active bet
    if (activeBet && periods[i].period === activeBet.period) {
      const actualColor = getColor(periods[i]);
      const won = actualColor === activeBet.color;

      if (activeBet.isVirtual) {
        // Virtual bet resolution
        if (won) {
          results.virtualWins++;
          // Virtual win — loss count reset, stay hunting
          virtualLossCount = 0;
          state = 'HUNTING';
        } else {
          results.virtualLosses++;
          virtualLossCount++;
          
          if (virtualLossCount >= requiredLosses) {
            // Required losses achieved! Next pattern pe LIVE bet lagega
            state = 'READY_FOR_LIVE';
          } else {
            // Need more losses, keep hunting
            state = 'HUNTING';
          }
        }
      } else {
        // LIVE bet resolution
        results.totalSignals++;
        results.trades.push({ betColor: activeBet.color, actualColor, won, period: periods[i].period });

        if (won) {
          results.wins++;
        } else {
          results.losses++;
        }

        // After LIVE bet (win or loss), reset counter
        virtualLossCount = 0;

        if (won) {
          state = 'HUNTING';
        } else if (useTrendBreak) {
          state = 'WAITING_FOR_TREND_BREAK';
        } else {
          state = 'HUNTING';
        }
      }
      activeBet = null;
    }

    if (activeBet) continue;

    // Check for trend break if waiting
    if (state === 'WAITING_FOR_TREND_BREAK') {
      if (i > 0 && getColor(periods[i - 1]) === getColor(periods[i])) {
        state = 'HUNTING';
        virtualLossCount = 0;
      }
    }

    if (state !== 'HUNTING' && state !== 'READY_FOR_LIVE') continue;
    if (i < patternLength - 1) continue;

    // Check for alternating pattern
    const patternColors = [];
    for (let j = i - patternLength + 1; j <= i; j++) {
      patternColors.push(getColor(periods[j]));
    }
    if (!isAlternating(patternColors)) continue;
    if (i + 1 >= periods.length) continue;

    const betColor = patternColors[patternColors.length - 1];
    const nextPeriod = periods[i + 1].period;

    if (state === 'READY_FOR_LIVE') {
      // We've seen enough virtual losses — this is a LIVE bet!
      activeBet = { color: betColor, period: nextPeriod, isVirtual: false };
      state = 'SIGNAL_ACTIVE';
    } else if (requiredLosses === 0) {
      // Direct bet — no waiting needed
      activeBet = { color: betColor, period: nextPeriod, isVirtual: false };
      state = 'SIGNAL_ACTIVE';
    } else {
      // Virtual bet — counting losses
      activeBet = { color: betColor, period: nextPeriod, isVirtual: true };
    }
  }

  results.winRate = results.totalSignals > 0 ? ((results.wins / results.totalSignals) * 100).toFixed(1) : '0.0';
  return results;
}

// ============ STREAK ANALYSIS ============
function analyzeStreaks(trades) {
  let maxLossStreak = 0, currentLoss = 0;
  let maxWinStreak = 0, currentWin = 0;

  for (const t of trades) {
    if (!t.won) {
      currentLoss++; currentWin = 0;
      if (currentLoss > maxLossStreak) maxLossStreak = currentLoss;
    } else {
      currentWin++; currentLoss = 0;
      if (currentWin > maxWinStreak) maxWinStreak = currentWin;
    }
  }
  return { maxLossStreak, maxWinStreak };
}

// ============ MAIN ============
async function main() {
  const categories = ['P', 'S', 'B', 'E'];
  const categoryNames = { P: 'Parity', S: 'Sapre', B: 'Bcone', E: 'Emerd' };

  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║      🏆 BACKTEST: N-Loss Wait Strategy Comparison (0, 1, 2, 3 Losses)  🏆      ║');
  console.log('╚═══════════════════════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('  Logic: Pattern detect → N baar virtual loss hone do → (N+1)th pattern pe LIVE bet');
  console.log('  Current app: 0-loss (Direct). User request: 3-loss wait.');
  console.log('');

  // Strategy definitions
  const strategyDefs = [
    { name: 'Direct (0-Loss)', losses: 0, trendBreak: false },
    { name: '1-Loss Wait', losses: 1, trendBreak: false },
    { name: '2-Loss Wait', losses: 2, trendBreak: false },
    { name: '3-Loss Wait ★', losses: 3, trendBreak: false },
    { name: 'Direct + TrendBrk', losses: 0, trendBreak: true },
    { name: '1-Loss + TrendBrk', losses: 1, trendBreak: true },
    { name: '2-Loss + TrendBrk', losses: 2, trendBreak: true },
    { name: '3-Loss + TrendBrk ★', losses: 3, trendBreak: true },
  ];

  const patternLengths = [
    { len: 3, label: 'RGR (3-length)' },
    { len: 4, label: 'RGRG (4-length)' },
  ];

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

  // Run backtests for each pattern length
  for (const pl of patternLengths) {
    console.log('');
    console.log(`╔═══════════════════════════════════════════════════════════════════════════════════╗`);
    console.log(`║  📊 ${pl.label} — All 4 Categories Combined                                     ║`);
    console.log(`╚═══════════════════════════════════════════════════════════════════════════════════╝`);
    console.log('');

    const aggregated = strategyDefs.map(s => ({
      name: s.name,
      losses: s.losses,
      trendBreak: s.trendBreak,
      totalSignals: 0, wins: 0, losses_count: 0,
      virtualLosses: 0, virtualWins: 0,
      maxLossStreak: 0, maxWinStreak: 0,
      perCategory: {}
    }));

    // Run per category
    for (const [cat, periods] of Object.entries(allPeriods)) {
      for (let si = 0; si < strategyDefs.length; si++) {
        const sd = strategyDefs[si];
        const result = backtestNLossWait(periods, pl.len, sd.losses, sd.trendBreak);
        const streaks = analyzeStreaks(result.trades);

        aggregated[si].totalSignals += result.totalSignals;
        aggregated[si].wins += result.wins;
        aggregated[si].losses_count += result.losses;
        aggregated[si].virtualLosses += result.virtualLosses;
        aggregated[si].virtualWins += result.virtualWins;
        if (streaks.maxLossStreak > aggregated[si].maxLossStreak) aggregated[si].maxLossStreak = streaks.maxLossStreak;
        if (streaks.maxWinStreak > aggregated[si].maxWinStreak) aggregated[si].maxWinStreak = streaks.maxWinStreak;

        aggregated[si].perCategory[cat] = {
          signals: result.totalSignals,
          wins: result.wins,
          losses: result.losses,
          winRate: result.winRate,
          virtualLosses: result.virtualLosses,
          virtualWins: result.virtualWins
        };
      }
    }

    // Calculate derived fields
    for (const a of aggregated) {
      a.winRate = a.totalSignals > 0 ? ((a.wins / a.totalSignals) * 100).toFixed(1) : '0.0';
      a.net = a.wins - a.losses_count;
    }

    // Print main table
    console.log('  #  │ Strategy              │ Signals │ Wins │ Loss │ Win%   │ Net  │ MaxL │ MaxW │ V.Loss │ V.Win');
    console.log('  ───┼───────────────────────┼─────────┼──────┼──────┼────────┼──────┼──────┼──────┼────────┼──────');

    const ranked = [...aggregated].sort((a, b) => {
      if (b.net !== a.net) return b.net - a.net;
      return parseFloat(b.winRate) - parseFloat(a.winRate);
    });

    ranked.forEach((r, i) => {
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '  ';
      const netStr = (r.net >= 0 ? '+' : '') + r.net;
      const star = r.name.includes('★') ? ' ◀ USER REQUEST' : '';

      console.log(
        `  ${medal} │ ${r.name.padEnd(21)} │ ${String(r.totalSignals).padStart(7)} │ ${String(r.wins).padStart(4)} │ ${String(r.losses_count).padStart(4)} │ ${(r.winRate + '%').padStart(6)} │ ${netStr.padStart(4)} │ ${String(r.maxLossStreak).padStart(4)} │ ${String(r.maxWinStreak).padStart(4)} │ ${String(r.virtualLosses).padStart(6)} │ ${String(r.virtualWins).padStart(4)}${star}`
      );
    });

    console.log('');
    console.log('  MaxL = Max consecutive LIVE losses | MaxW = Max consecutive LIVE wins');
    console.log('  V.Loss = Virtual losses skipped | V.Win = Virtual wins skipped (missed opportunities)');

    // Category breakdown for 3-loss strategy
    console.log('');
    console.log('  ─── Category Breakdown: 3-Loss Wait (User Request) ───');
    
    const threeLossNoTrend = aggregated.find(a => a.losses === 3 && !a.trendBreak);
    const threeLossWithTrend = aggregated.find(a => a.losses === 3 && a.trendBreak);

    if (threeLossNoTrend) {
      console.log(`\n  ★ 3-Loss Wait (No TrendBreak) — Overall: ${threeLossNoTrend.winRate}% win, Net ${(threeLossNoTrend.net >= 0 ? '+' : '') + threeLossNoTrend.net}`);
      console.log('  ┌─────────┬─────────┬──────┬──────┬────────┬────────┬───────┐');
      console.log('  │ Section │ Signals │ Wins │ Loss │ Win%   │ V.Loss │ V.Win │');
      console.log('  ├─────────┼─────────┼──────┼──────┼────────┼────────┼───────┤');
      for (const [cat, data] of Object.entries(threeLossNoTrend.perCategory)) {
        console.log(`  │ ${categoryNames[cat].padEnd(7)} │ ${String(data.signals).padStart(7)} │ ${String(data.wins).padStart(4)} │ ${String(data.losses).padStart(4)} │ ${(data.winRate + '%').padStart(6)} │ ${String(data.virtualLosses).padStart(6)} │ ${String(data.virtualWins).padStart(5)} │`);
      }
      console.log('  └─────────┴─────────┴──────┴──────┴────────┴────────┴───────┘');
    }

    if (threeLossWithTrend) {
      console.log(`\n  ★ 3-Loss Wait + TrendBreak — Overall: ${threeLossWithTrend.winRate}% win, Net ${(threeLossWithTrend.net >= 0 ? '+' : '') + threeLossWithTrend.net}`);
      console.log('  ┌─────────┬─────────┬──────┬──────┬────────┬────────┬───────┐');
      console.log('  │ Section │ Signals │ Wins │ Loss │ Win%   │ V.Loss │ V.Win │');
      console.log('  ├─────────┼─────────┼──────┼──────┼────────┼────────┼───────┤');
      for (const [cat, data] of Object.entries(threeLossWithTrend.perCategory)) {
        console.log(`  │ ${categoryNames[cat].padEnd(7)} │ ${String(data.signals).padStart(7)} │ ${String(data.wins).padStart(4)} │ ${String(data.losses).padStart(4)} │ ${(data.winRate + '%').padStart(6)} │ ${String(data.virtualLosses).padStart(6)} │ ${String(data.virtualWins).padStart(5)} │`);
      }
      console.log('  └─────────┴─────────┴──────┴──────┴────────┴────────┴───────┘');
    }

    // Profit simulation
    console.log('');
    console.log('  ─── 💰 Profit Simulation (₹100 flat bet, 1.96x payout) ───');
    console.log('');
    
    const baseBet = 100;
    const winMultiplier = 0.96;

    const profitRanked = ranked.map(r => {
      const profit = (r.wins * baseBet * winMultiplier) - (r.losses_count * baseBet);
      return { ...r, profit };
    }).sort((a, b) => b.profit - a.profit);

    console.log('  #  │ Strategy              │ Profit     │ ROI/Signal');
    console.log('  ───┼───────────────────────┼────────────┼──────────');
    
    profitRanked.forEach((r, i) => {
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '  ';
      const profitStr = (r.profit >= 0 ? '+' : '') + '₹' + Math.round(r.profit);
      const roi = r.totalSignals > 0 ? (r.profit / (r.totalSignals * baseBet) * 100).toFixed(1) + '%' : '0.0%';
      const star = r.name.includes('★') ? ' ◀' : '';

      console.log(`  ${medal} │ ${r.name.padEnd(21)} │ ${profitStr.padStart(10)} │ ${roi.padStart(8)}${star}`);
    });
  }

  // ============ FINAL VERDICT ============
  console.log('\n');
  console.log('╔═══════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║  🎯 FINAL VERDICT: 3-Loss Wait Strategy ke Results                              ║');
  console.log('╚═══════════════════════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('  Explanation of "3-Loss Wait" strategy:');
  console.log('    1. Pattern detect hota hai (RGR ya RGRG)');
  console.log('    2. Pehle 3 patterns pe sirf VIRTUAL bet lagta hai (paisa nahi lagta)');
  console.log('    3. Jab 3 virtual losses ho jayein → 4th pattern pe REAL/LIVE bet lagao');
  console.log('    4. Agar virtual bet win ho jaye → counter reset, phir se 3 losses wait karo');
  console.log('    5. Agar LIVE bet loss ho → (optional) trend break wait, phir reset');
  console.log('');
  console.log('  Key tradeoff:');
  console.log('    ✅ Fewer total bets = Less risk exposure');
  console.log('    ✅ May filter out some losing patterns');
  console.log('    ❌ Fewer signals = Fewer opportunities');
  console.log('    ❌ Virtual wins are MISSED profits');
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════════');
  console.log('');
}

main().catch(console.error);
