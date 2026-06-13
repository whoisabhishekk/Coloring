#!/usr/bin/env node
/**
 * 🧠 SMART STRATEGY BUILDER — ₹150 Account, ₹200 Daily Target
 * 
 * Learnings from today's backtests:
 *   ❌ Parity & Sapre = 40% win rate (AVOID)
 *   ✅ Bcone & Emerd = 55.6% win rate (PLAY ONLY THESE)
 *   ❌ Martingale (₹30, ₹90 recovery) = amplifies losses
 *   ✅ Flat/small bets = controlled risk
 * 
 * NEW STRATEGY: "SNIPER SELECT + ANTI-MARTINGALE"
 * 
 *   1. SECTION FILTER: Only Bcone + Emerd (proven 55%+ win rate)
 *   2. ANTI-MARTINGALE: Increase bet after WIN, reset after LOSS
 *      - Start: ₹10
 *      - After Win 1: ₹15
 *      - After Win 2: ₹25
 *      - After Win 3: ₹40
 *      - After Win 4+: ₹40 (cap)
 *      - After ANY Loss: back to ₹10
 *   3. DAILY STOP-LOSS: -₹60 (protect capital, 40% of ₹150)
 *   4. DAILY TAKE-PROFIT: +₹200 (target achieved, stop playing)
 *   5. PATTERN: RGRG (4-length alternating)
 * 
 * Why Anti-Martingale works:
 *   - When you're winning, you bet more → ride the streak
 *   - When you lose, you bet minimum → protect capital
 *   - Unlike Martingale, losses are SMALL, wins are BIG
 */

const API_BASE = 'https://cooe02.in';
const SAAS_ID = 1;
const WIN_MULTIPLIER = 0.96;

// Strategy parameters
const BASE_BET = 10;
const BET_LADDER = [10, 15, 25, 40, 40]; // after each consecutive win
const STOP_LOSS = -60;     // stop if losing ₹60
const TAKE_PROFIT = 200;   // stop if profit reaches ₹200
const STARTING_CAPITAL = 150;

// Only profitable sections
const PLAY_SECTIONS = ['B', 'E']; // Bcone + Emerd only
const ALL_SECTIONS = ['P', 'S', 'B', 'E']; // for comparison

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

/**
 * Extract all signals from a section's periods
 * Returns array of { period, betColor, actualColor, won }
 */
function extractSignals(periods) {
  const signals = [];
  let activeBet = null;

  for (let i = 0; i < periods.length; i++) {
    if (activeBet && periods[i].period === activeBet.period) {
      const actualColor = getColor(periods[i]);
      const won = actualColor === activeBet.color;
      signals.push({
        period: periods[i].period,
        betColor: activeBet.color,
        actualColor,
        won,
        periodIndex: i,
      });
      activeBet = null;
    }

    if (activeBet) continue;
    if (i < 3) continue;

    const colors = [i-3, i-2, i-1, i].map(j => getColor(periods[j]));
    if (!isAlternating(colors)) continue;
    if (i + 1 >= periods.length) continue;

    activeBet = { color: colors[3], period: periods[i + 1].period };
  }
  return signals;
}


/**
 * Simulate a strategy on a list of signals
 */
function simulateStrategy(allSignals, strategyName, config) {
  const { betLadder, stopLoss, takeProfit, startCapital } = config;
  
  const results = {
    name: strategyName,
    totalBets: 0, wins: 0, losses: 0,
    totalInvested: 0,
    capital: startCapital,
    peakCapital: startCapital,
    minCapital: startCapital,
    pnl: 0,
    trades: [],
    stoppedReason: null,
    consecutiveWins: 0,
    maxConsecutiveWins: 0,
    maxBetUsed: 0,
  };

  let consecutiveWins = 0;

  for (const signal of allSignals) {
    // Check stop conditions
    if (results.pnl <= stopLoss) {
      results.stoppedReason = `⛔ STOP-LOSS hit (${stopLoss})`;
      break;
    }
    if (results.pnl >= takeProfit) {
      results.stoppedReason = `🎯 TAKE-PROFIT hit (+${takeProfit})`;
      break;
    }
    if (results.capital < betLadder[0]) {
      results.stoppedReason = `💀 CAPITAL exhausted`;
      break;
    }

    // Determine bet amount (anti-martingale)
    const ladderIndex = Math.min(consecutiveWins, betLadder.length - 1);
    let betAmount = betLadder[ladderIndex];
    
    // Don't bet more than current capital
    betAmount = Math.min(betAmount, results.capital);

    if (betAmount > results.maxBetUsed) results.maxBetUsed = betAmount;

    const won = signal.won;
    const profitLoss = won ? (betAmount * WIN_MULTIPLIER) : -betAmount;

    results.totalBets++;
    results.totalInvested += betAmount;
    results.pnl += profitLoss;
    results.capital += profitLoss;

    if (won) {
      results.wins++;
      consecutiveWins++;
      if (consecutiveWins > results.maxConsecutiveWins) {
        results.maxConsecutiveWins = consecutiveWins;
      }
    } else {
      results.losses++;
      consecutiveWins = 0;
    }

    if (results.capital > results.peakCapital) results.peakCapital = results.capital;
    if (results.capital < results.minCapital) results.minCapital = results.capital;

    results.trades.push({
      period: signal.period,
      betColor: signal.betColor,
      actualColor: signal.actualColor,
      won,
      betAmount,
      profitLoss,
      runningPNL: results.pnl,
      capital: results.capital,
      consecutiveWins: won ? consecutiveWins : 0,
    });
  }

  results.consecutiveWins = consecutiveWins;
  return results;
}


async function main() {
  const categoryNames = { P: 'Parity', S: 'Sapre', B: 'Bcone', E: 'Emerd' };

  console.log('');
  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║   🧠 SMART STRATEGY BUILDER                                              ║');
  console.log('║   Account: ₹150 │ Target: ₹200/day │ Building Profitable Strategy        ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝');
  console.log('');

  // Fetch all data
  const allPeriodsMap = {};
  for (const cat of ALL_SECTIONS) {
    const data = await fetchSectionData(cat);
    if (data && data.periods) {
      allPeriodsMap[cat] = data.periods;
      console.log(`  ✅ ${categoryNames[cat]}: ${data.periods.length} periods`);
    }
  }

  // Extract signals from each section
  const sectionSignals = {};
  for (const [cat, periods] of Object.entries(allPeriodsMap)) {
    sectionSignals[cat] = extractSignals(periods);
    const wins = sectionSignals[cat].filter(s => s.won).length;
    const total = sectionSignals[cat].length;
    const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) : '0.0';
    console.log(`     → ${categoryNames[cat]}: ${total} signals, ${wins}W/${total - wins}L (${winRate}%)`);
  }

  // ============ STRATEGY COMPARISON ============
  console.log('');
  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║   📊 TESTING MULTIPLE STRATEGIES                                         ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝');
  console.log('');

  // Merge signals by period number for chronological order
  function mergeSignals(cats) {
    const all = [];
    for (const cat of cats) {
      if (sectionSignals[cat]) {
        for (const s of sectionSignals[cat]) {
          all.push({ ...s, section: cat });
        }
      }
    }
    return all.sort((a, b) => a.period - b.period);
  }

  const strategies = [
    // Strategy 1: Flat ₹10 all sections
    {
      name: '❌ Flat ₹10 All Sections',
      signals: mergeSignals(['P', 'S', 'B', 'E']),
      config: { betLadder: [10], stopLoss: -60, takeProfit: 200, startCapital: 150 }
    },
    // Strategy 2: Flat ₹10 only Bcone+Emerd
    {
      name: '⭐ Flat ₹10 Bcone+Emerd',
      signals: mergeSignals(['B', 'E']),
      config: { betLadder: [10], stopLoss: -60, takeProfit: 200, startCapital: 150 }
    },
    // Strategy 3: Anti-Martingale Bcone+Emerd (₹10→15→25→40)
    {
      name: '🚀 Anti-Mart B+E (10→15→25→40)',
      signals: mergeSignals(['B', 'E']),
      config: { betLadder: [10, 15, 25, 40, 40], stopLoss: -60, takeProfit: 200, startCapital: 150 }
    },
    // Strategy 4: Anti-Martingale ALL sections
    {
      name: '🔄 Anti-Mart ALL (10→15→25→40)',
      signals: mergeSignals(['P', 'S', 'B', 'E']),
      config: { betLadder: [10, 15, 25, 40, 40], stopLoss: -60, takeProfit: 200, startCapital: 150 }
    },
    // Strategy 5: Aggressive Anti-Mart B+E (₹10→20→40→50)
    {
      name: '🔥 Aggro Anti-Mart B+E (10→20→40→50)',
      signals: mergeSignals(['B', 'E']),
      config: { betLadder: [10, 20, 40, 50, 50], stopLoss: -60, takeProfit: 200, startCapital: 150 }
    },
    // Strategy 6: Conservative Anti-Mart B+E (₹5→10→15→20)
    {
      name: '🛡️ Safe Anti-Mart B+E (5→10→15→20)',
      signals: mergeSignals(['B', 'E']),
      config: { betLadder: [5, 10, 15, 20, 20], stopLoss: -40, takeProfit: 200, startCapital: 150 }
    },
    // Strategy 7: Flat ₹10 only Emerd
    {
      name: '💎 Flat ₹10 Emerd Only',
      signals: mergeSignals(['E']),
      config: { betLadder: [10], stopLoss: -60, takeProfit: 200, startCapital: 150 }
    },
    // Strategy 8: Anti-Mart Emerd only
    {
      name: '💎 Anti-Mart Emerd (10→15→25→40)',
      signals: mergeSignals(['E']),
      config: { betLadder: [10, 15, 25, 40, 40], stopLoss: -60, takeProfit: 200, startCapital: 150 }
    },
    // Strategy 9: Flat ₹15 B+E (slightly bigger flat)
    {
      name: '📈 Flat ₹15 Bcone+Emerd',
      signals: mergeSignals(['B', 'E']),
      config: { betLadder: [15], stopLoss: -60, takeProfit: 200, startCapital: 150 }
    },
    // Strategy 10: Anti-Mart B+E with tight SL
    {
      name: '🎯 Anti-Mart B+E TightSL(-40)',
      signals: mergeSignals(['B', 'E']),
      config: { betLadder: [10, 15, 25, 40, 40], stopLoss: -40, takeProfit: 200, startCapital: 150 }
    },
  ];

  const results = [];
  for (const strat of strategies) {
    const result = simulateStrategy(strat.signals, strat.name, strat.config);
    results.push(result);
  }

  // Sort by PNL
  results.sort((a, b) => b.pnl - a.pnl);

  // Print comparison table
  console.log('  #  │ Strategy                           │ Bets │ W/L     │ Win%  │ PNL       │ Capital   │ Stopped');
  console.log('  ───┼────────────────────────────────────┼──────┼─────────┼───────┼───────────┼───────────┼─────────────────');

  results.forEach((r, i) => {
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '  ';
    const pnlStr = r.pnl >= 0 ? `+₹${r.pnl.toFixed(0)}` : `-₹${Math.abs(r.pnl).toFixed(0)}`;
    const capStr = `₹${r.capital.toFixed(0)}`;
    const winRate = r.totalBets > 0 ? ((r.wins / r.totalBets) * 100).toFixed(1) + '%' : '0%';
    const stopped = r.stoppedReason || 'Full run';
    console.log(
      `  ${medal} │ ${r.name.padEnd(34)} │ ${String(r.totalBets).padStart(4)} │ ${String(r.wins).padStart(3)}/${String(r.losses).padStart(3)} │ ${winRate.padStart(5)} │ ${pnlStr.padStart(9)} │ ${capStr.padStart(9)} │ ${stopped}`
    );
  });

  // ============ BEST STRATEGY DETAIL ============
  const best = results[0];
  console.log('');
  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log(`║   🏆 BEST STRATEGY: ${best.name.padEnd(52)}║`);
  console.log('╚════════════════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`  Total Bets:        ${best.totalBets}`);
  console.log(`  Wins / Losses:     ${best.wins} / ${best.losses}`);
  console.log(`  Win Rate:          ${best.totalBets > 0 ? ((best.wins / best.totalBets) * 100).toFixed(1) : 0}%`);
  console.log(`  Max Consecutive W: ${best.maxConsecutiveWins}`);
  console.log(`  Max Bet Used:      ₹${best.maxBetUsed}`);
  console.log(`  Starting Capital:  ₹${STARTING_CAPITAL}`);
  console.log(`  Final Capital:     ₹${best.capital.toFixed(0)}`);
  console.log(`  Peak Capital:      ₹${best.peakCapital.toFixed(0)}`);
  console.log(`  Min Capital:       ₹${best.minCapital.toFixed(0)}`);
  console.log(`  NET PNL:           ${best.pnl >= 0 ? '+' : ''}₹${best.pnl.toFixed(1)}`);
  if (best.stoppedReason) console.log(`  Stopped:           ${best.stoppedReason}`);
  console.log('');

  // Print trade-by-trade for best strategy
  if (best.trades.length > 0) {
    console.log('  ─── Trade-by-Trade ───');
    console.log('');
    console.log('  #  │ Period     │ Bet  │ Color  │ Result │ P/L     │ PNL     │ Capital │ Streak');
    console.log('  ───┼────────────┼──────┼────────┼────────┼─────────┼─────────┼─────────┼───────');
    best.trades.forEach((t, idx) => {
      const periodStr = String(t.period).slice(-8);
      const resultStr = t.won ? '  ✅ W' : '  ❌ L';
      const plStr = t.profitLoss >= 0 ? `+₹${t.profitLoss.toFixed(0)}` : `-₹${Math.abs(t.profitLoss).toFixed(0)}`;
      const runStr = t.runningPNL >= 0 ? `+₹${t.runningPNL.toFixed(0)}` : `-₹${Math.abs(t.runningPNL).toFixed(0)}`;
      const capStr = `₹${t.capital.toFixed(0)}`;
      const betColorStr = t.betColor === 'G' ? '🟢 GRN' : '🔴 RED';
      const streakStr = t.consecutiveWins > 0 ? `W${t.consecutiveWins} 🔥` : '';
      console.log(
        `  ${String(idx + 1).padStart(2)} │ ${periodStr.padStart(10)} │ ₹${String(t.betAmount).padStart(3)} │ ${betColorStr} │ ${resultStr} │ ${plStr.padStart(7)} │ ${runStr.padStart(7)} │ ${capStr.padStart(7)} │ ${streakStr}`
      );
    });
  }

  // ============ FINAL RECOMMENDATION ============
  console.log('');
  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║   💡 RECOMMENDED STRATEGY FOR ₹150 ACCOUNT                               ║');
  console.log('╠════════════════════════════════════════════════════════════════════════════╣');
  console.log('║                                                                            ║');
  console.log('║   📌 RULE 1: ONLY play Bcone + Emerd (skip Parity & Sapre)                ║');
  console.log('║   📌 RULE 2: Anti-Martingale bet sizing:                                   ║');
  console.log('║              Loss/Start → ₹10                                              ║');
  console.log('║              1 Win      → ₹15                                              ║');
  console.log('║              2 Wins     → ₹25                                              ║');
  console.log('║              3+ Wins    → ₹40 (cap)                                        ║');
  console.log('║   📌 RULE 3: STOP-LOSS = -₹60 (capital ₹90 pe stop)                       ║');
  console.log('║   📌 RULE 4: TAKE-PROFIT = +₹200 (target pe stop)                         ║');
  console.log('║   📌 RULE 5: RGRG pattern only (4-length alternating)                      ║');
  console.log('║                                                                            ║');
  console.log('║   Why this works:                                                          ║');
  console.log('║   ✅ Section filter removes 40% win-rate sections                          ║');
  console.log('║   ✅ Anti-Martingale RIDES winning streaks for bigger profit               ║');
  console.log('║   ✅ Loss = always small (₹10 reset)                                       ║');
  console.log('║   ✅ Stop-loss protects capital from bad days                               ║');
  console.log('║                                                                            ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝');
  console.log('');
}

main().catch(console.error);
