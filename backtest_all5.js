#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════
 *  COMPREHENSIVE BACKTEST — All 5 Dashboard Strategies Compared
 *  Tests exactly the same logic as app.js uses in production
 * ═══════════════════════════════════════════════════════════════
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
function getColor(p) { return p.is_green ? 'G' : 'R'; }
function opposite(c) { return c === 'G' ? 'R' : 'G'; }

function isAlternating(colors) {
  for (let i = 1; i < colors.length; i++) {
    if (colors[i] === colors[i - 1]) return false;
  }
  return true;
}

// ============ STRATEGY 1: RGRG + Trend Break Wait ============
function strategy_RGRG_TrendBreak(periods) {
  const trades = [];
  let strategyState = 'HUNTING';
  let activeBet = null;

  for (let i = 0; i < periods.length; i++) {
    if (activeBet && periods[i].period === activeBet.period) {
      const actual = getColor(periods[i]);
      const won = actual === activeBet.color;
      trades.push({ betColor: activeBet.color, actualColor: actual, won, period: periods[i].period });
      activeBet = null;
      if (won) {
        strategyState = 'HUNTING';
      } else {
        strategyState = 'WAITING_FOR_TREND_BREAK';
      }
    }
    if (activeBet) continue;

    if (strategyState === 'WAITING_FOR_TREND_BREAK') {
      if (i > 0 && getColor(periods[i - 1]) === getColor(periods[i])) {
        strategyState = 'HUNTING';
      }
    }
    if (strategyState !== 'HUNTING') continue;
    if (i < 3) continue;

    const colors = [getColor(periods[i-3]), getColor(periods[i-2]), getColor(periods[i-1]), getColor(periods[i])];
    if (!isAlternating(colors)) continue;
    if (i + 1 >= periods.length) continue;

    activeBet = { color: colors[3], period: periods[i + 1].period };
    strategyState = 'SIGNAL_ACTIVE';
  }
  return trades;
}

// ============ STRATEGY 2: Contrarian Double RR→G ============
function strategy_ContrarianDouble(periods) {
  const trades = [];
  let activeBet = null;

  for (let i = 0; i < periods.length; i++) {
    if (activeBet && periods[i].period === activeBet.period) {
      const actual = getColor(periods[i]);
      trades.push({ betColor: activeBet.color, actualColor: actual, won: actual === activeBet.color, period: periods[i].period });
      activeBet = null;
    }
    if (activeBet) continue;
    if (i < 1) continue;

    const prev = getColor(periods[i - 1]);
    const curr = getColor(periods[i]);

    if (prev === curr && i + 1 < periods.length) {
      activeBet = { color: opposite(curr), period: periods[i + 1].period };
    }
  }
  return trades;
}

// ============ STRATEGY 3: Break Opposite ABB→opp ============
function strategy_BreakOpposite(periods) {
  const trades = [];
  let activeBet = null;

  for (let i = 0; i < periods.length; i++) {
    if (activeBet && periods[i].period === activeBet.period) {
      const actual = getColor(periods[i]);
      trades.push({ betColor: activeBet.color, actualColor: actual, won: actual === activeBet.color, period: periods[i].period });
      activeBet = null;
    }
    if (activeBet) continue;
    if (i < 2) continue;

    const c0 = getColor(periods[i - 2]);
    const c1 = getColor(periods[i - 1]);
    const c2 = getColor(periods[i]);

    // Pattern: A, B, B (first different, then 2 same) → bet opposite
    if (c0 !== c1 && c1 === c2) {
      if (i + 1 >= periods.length) continue;
      activeBet = { color: opposite(c2), period: periods[i + 1].period };
    }
  }
  return trades;
}

// ============ STRATEGY 4: Streak Break 3+same→opp ============
function strategy_StreakBreak3(periods) {
  const trades = [];
  let activeBet = null;

  for (let i = 0; i < periods.length; i++) {
    if (activeBet && periods[i].period === activeBet.period) {
      const actual = getColor(periods[i]);
      trades.push({ betColor: activeBet.color, actualColor: actual, won: actual === activeBet.color, period: periods[i].period });
      activeBet = null;
    }
    if (activeBet) continue;
    if (i < 2) continue;

    const c0 = getColor(periods[i - 2]);
    const c1 = getColor(periods[i - 1]);
    const c2 = getColor(periods[i]);

    if (c0 === c1 && c1 === c2) {
      if (i + 1 >= periods.length) continue;
      activeBet = { color: opposite(c2), period: periods[i + 1].period };
    }
  }
  return trades;
}

// ============ STRATEGY 5: Sniper 3-Loss Wait + RGRG ============
function strategy_Sniper3Loss(periods) {
  const trades = [];
  let strategyState = 'HUNTING';
  let virtualLossCount = 0;
  let activeBet = null;
  let virtualStats = { wins: 0, losses: 0 };

  for (let i = 0; i < periods.length; i++) {
    if (activeBet && periods[i].period === activeBet.period) {
      const actual = getColor(periods[i]);
      const won = actual === activeBet.color;

      if (activeBet.isVirtual) {
        if (won) {
          virtualStats.wins++;
          virtualLossCount = 0;
          strategyState = 'HUNTING';
        } else {
          virtualStats.losses++;
          virtualLossCount++;
          if (virtualLossCount >= 3) {
            strategyState = 'READY_FOR_LIVE';
          } else {
            strategyState = 'HUNTING';
          }
        }
      } else {
        trades.push({ betColor: activeBet.color, actualColor: actual, won, period: periods[i].period });
        virtualLossCount = 0;
        if (won) {
          strategyState = 'HUNTING';
        } else {
          strategyState = 'WAITING_FOR_TREND_BREAK';
        }
      }
      activeBet = null;
    }
    if (activeBet) continue;

    if (strategyState === 'WAITING_FOR_TREND_BREAK') {
      if (i > 0 && getColor(periods[i - 1]) === getColor(periods[i])) {
        strategyState = 'HUNTING';
        virtualLossCount = 0;
      }
    }

    if (strategyState !== 'HUNTING' && strategyState !== 'READY_FOR_LIVE') continue;
    if (i < 3) continue;

    const colors = [getColor(periods[i-3]), getColor(periods[i-2]), getColor(periods[i-1]), getColor(periods[i])];
    if (!isAlternating(colors)) continue;
    if (i + 1 >= periods.length) continue;

    const betColor = colors[3];
    const nextPeriod = periods[i + 1].period;

    if (strategyState === 'READY_FOR_LIVE') {
      activeBet = { color: betColor, period: nextPeriod, isVirtual: false };
      strategyState = 'SIGNAL_ACTIVE';
    } else {
      activeBet = { color: betColor, period: nextPeriod, isVirtual: true };
    }
  }

  // Attach virtual stats for reporting
  trades._virtualStats = virtualStats;
  return trades;
}

// ============ STREAK ANALYSIS ============
function analyzeStreaks(trades) {
  let maxLoss = 0, curLoss = 0;
  let maxWin = 0, curWin = 0;
  let lossStreaks = {};
  let winStreaks = {};

  for (const t of trades) {
    if (!t.won) {
      curLoss++; curWin = 0;
      if (curLoss > maxLoss) maxLoss = curLoss;
    } else {
      curWin++; curLoss = 0;
      if (curWin > maxWin) maxWin = curWin;
    }
  }

  // Count streak distributions
  curLoss = 0; curWin = 0;
  for (let i = 0; i < trades.length; i++) {
    if (!trades[i].won) {
      if (curWin > 0) { winStreaks[curWin] = (winStreaks[curWin] || 0) + 1; curWin = 0; }
      curLoss++;
    } else {
      if (curLoss > 0) { lossStreaks[curLoss] = (lossStreaks[curLoss] || 0) + 1; curLoss = 0; }
      curWin++;
    }
  }
  if (curLoss > 0) lossStreaks[curLoss] = (lossStreaks[curLoss] || 0) + 1;
  if (curWin > 0) winStreaks[curWin] = (winStreaks[curWin] || 0) + 1;

  return { maxLoss, maxWin, lossStreaks, winStreaks };
}

// ============ DRAWDOWN ANALYSIS ============
function analyzeDrawdown(trades, baseBet) {
  const winMultiplier = 0.96;
  let balance = 0;
  let peak = 0;
  let maxDrawdown = 0;
  let balanceHistory = [];

  for (const t of trades) {
    if (t.won) {
      balance += baseBet * winMultiplier;
    } else {
      balance -= baseBet;
    }
    balanceHistory.push(balance);
    if (balance > peak) peak = balance;
    const dd = peak - balance;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  return { maxDrawdown, finalBalance: balance, peak, balanceHistory };
}

// ============ MAIN ============
async function main() {
  const categories = ['P', 'S', 'B', 'E'];
  const catNames = { P: 'Parity', S: 'Sapre', B: 'Bcone', E: 'Emerd' };
  const baseBet = 100;
  const winMultiplier = 0.96;

  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║         🏆 COMPREHENSIVE BACKTEST — All 5 Dashboard Strategies Compared 🏆          ║');
  console.log('╚═══════════════════════════════════════════════════════════════════════════════════════╝');
  console.log('');

  // Fetch data
  const allPeriods = {};
  let totalPeriods = 0;

  for (const cat of categories) {
    const data = await fetchSectionData(cat);
    if (!data || !data.periods) {
      console.log(`  ⚠️  No data for ${catNames[cat]}`);
      continue;
    }
    allPeriods[cat] = data.periods;
    totalPeriods += data.periods.length;
    console.log(`  ✅ ${catNames[cat]}: ${data.periods.length} periods loaded`);
  }

  console.log(`\n  📦 Total: ${totalPeriods} periods across ${Object.keys(allPeriods).length} categories\n`);

  // Define strategies
  const strategies = [
    { id: 'RGRG_TREND_BREAK', name: 'RGRG + Trend Break Wait', emoji: '🎯', fn: strategy_RGRG_TrendBreak, desc: 'Balanced/Safe' },
    { id: 'CONTRARIAN_DOUBLE', name: 'Contrarian Double RR→G', emoji: '🔥', fn: strategy_ContrarianDouble, desc: 'Highest Signals' },
    { id: 'BREAK_OPPOSITE', name: 'Break→Opposite ABB→opp', emoji: '⚡', fn: strategy_BreakOpposite, desc: 'High Profit' },
    { id: 'STREAK_BREAK_3', name: 'Streak Break 3+same→opp', emoji: '💎', fn: strategy_StreakBreak3, desc: 'Consistent' },
    { id: 'SNIPER_3_LOSS', name: 'Sniper 3-Loss + RGRG', emoji: '🎯', fn: strategy_Sniper3Loss, desc: 'High Win% Rare' },
  ];

  // Aggregate results
  const results = strategies.map(s => ({
    ...s,
    totalSignals: 0, wins: 0, losses: 0,
    maxLoss: 0, maxWin: 0,
    perCategory: {},
    allTrades: [],
    virtualStats: { wins: 0, losses: 0 }
  }));

  // Run backtests
  for (const [cat, periods] of Object.entries(allPeriods)) {
    for (let si = 0; si < strategies.length; si++) {
      const trades = strategies[si].fn(periods);
      const wins = trades.filter(t => t.won).length;
      const losses = trades.filter(t => !t.won).length;
      const streaks = analyzeStreaks(trades);

      results[si].totalSignals += trades.length;
      results[si].wins += wins;
      results[si].losses += losses;
      results[si].allTrades.push(...trades);
      if (streaks.maxLoss > results[si].maxLoss) results[si].maxLoss = streaks.maxLoss;
      if (streaks.maxWin > results[si].maxWin) results[si].maxWin = streaks.maxWin;

      if (trades._virtualStats) {
        results[si].virtualStats.wins += trades._virtualStats.wins;
        results[si].virtualStats.losses += trades._virtualStats.losses;
      }

      results[si].perCategory[cat] = { signals: trades.length, wins, losses,
        winRate: trades.length > 0 ? ((wins / trades.length) * 100).toFixed(1) : '0.0',
        streaks
      };
    }
  }

  // Calculate derived fields
  for (const r of results) {
    r.winRate = r.totalSignals > 0 ? ((r.wins / r.totalSignals) * 100).toFixed(1) : '0.0';
    r.net = r.wins - r.losses;
    r.profit = (r.wins * baseBet * winMultiplier) - (r.losses * baseBet);
    r.roi = r.totalSignals > 0 ? ((r.profit / (r.totalSignals * baseBet)) * 100).toFixed(1) : '0.0';
    const dd = analyzeDrawdown(r.allTrades, baseBet);
    r.maxDrawdown = dd.maxDrawdown;
    r.peak = dd.peak;
  }

  // ═══════════════════════════════════════════
  // TABLE 1: MAIN RANKING BY PROFIT
  // ═══════════════════════════════════════════
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║  📊 TABLE 1: OVERALL RANKING — Sorted by Profit (₹100/bet, 1.96x payout)            ║');
  console.log('╚═══════════════════════════════════════════════════════════════════════════════════════╝');
  console.log('');

  const byProfit = [...results].sort((a, b) => b.profit - a.profit);

  console.log('  #  │ Strategy                    │ Signals │ Wins │ Loss │ Win%   │ Net  │ Profit     │ ROI/Bet  │ MaxLoss │ MaxDD');
  console.log('  ───┼─────────────────────────────┼─────────┼──────┼──────┼────────┼──────┼────────────┼──────────┼─────────┼──────');

  byProfit.forEach((r, i) => {
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '  ';
    const netStr = (r.net >= 0 ? '+' : '') + r.net;
    const profitStr = (r.profit >= 0 ? '+₹' : '-₹') + Math.abs(Math.round(r.profit));

    console.log(
      `  ${medal} │ ${(r.emoji + ' ' + r.name).padEnd(27)} │ ${String(r.totalSignals).padStart(7)} │ ${String(r.wins).padStart(4)} │ ${String(r.losses).padStart(4)} │ ${(r.winRate + '%').padStart(6)} │ ${netStr.padStart(4)} │ ${profitStr.padStart(10)} │ ${(r.roi + '%').padStart(8)} │ ${String(r.maxLoss).padStart(7)} │ ₹${Math.round(r.maxDrawdown)}`
    );
  });

  console.log('');
  console.log('  Net = Wins - Losses | ROI = Profit per ₹100 bet | MaxLoss = Max consecutive losses');
  console.log('  MaxDD = Maximum Drawdown (worst peak-to-trough ₹ drop)');

  // ═══════════════════════════════════════════
  // TABLE 2: WIN RATE RANKING
  // ═══════════════════════════════════════════
  console.log('\n');
  console.log('╔═══════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║  📊 TABLE 2: WIN RATE RANKING — Sorted by Win %                                     ║');
  console.log('╚═══════════════════════════════════════════════════════════════════════════════════════╝');
  console.log('');

  const byWinRate = [...results].sort((a, b) => parseFloat(b.winRate) - parseFloat(a.winRate));

  console.log('  #  │ Strategy                    │ Win%   │ Signals │ Profit     │ Risk Level');
  console.log('  ───┼─────────────────────────────┼────────┼─────────┼────────────┼───────────');

  byWinRate.forEach((r, i) => {
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '  ';
    const profitStr = (r.profit >= 0 ? '+₹' : '-₹') + Math.abs(Math.round(r.profit));
    const risk = r.maxLoss <= 3 ? '⭐ LOW' : r.maxLoss <= 5 ? '⚠️  MEDIUM' : '🔴 HIGH';

    console.log(
      `  ${medal} │ ${(r.emoji + ' ' + r.name).padEnd(27)} │ ${(r.winRate + '%').padStart(6)} │ ${String(r.totalSignals).padStart(7)} │ ${profitStr.padStart(10)} │ ${risk}`
    );
  });

  // ═══════════════════════════════════════════
  // TABLE 3: CATEGORY-WISE BREAKDOWN
  // ═══════════════════════════════════════════
  console.log('\n');
  console.log('╔═══════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║  📊 TABLE 3: CATEGORY-WISE BREAKDOWN — Har Section Ka Performance                   ║');
  console.log('╚═══════════════════════════════════════════════════════════════════════════════════════╝');

  for (const r of results) {
    const profitStr = (r.profit >= 0 ? '+₹' : '-₹') + Math.abs(Math.round(r.profit));
    console.log(`\n  ${r.emoji} ${r.name} (${r.desc}) — Overall: ${r.winRate}% | ${profitStr}`);
    console.log('  ┌─────────┬─────────┬──────┬──────┬────────┬──────────┬──────┬──────┐');
    console.log('  │ Section │ Signals │ Wins │ Loss │ Win%   │ Profit   │ MaxL │ MaxW │');
    console.log('  ├─────────┼─────────┼──────┼──────┼────────┼──────────┼──────┼──────┤');

    for (const [cat, data] of Object.entries(r.perCategory)) {
      const catProfit = (data.wins * baseBet * winMultiplier) - (data.losses * baseBet);
      const catProfitStr = (catProfit >= 0 ? '+₹' : '-₹') + Math.abs(Math.round(catProfit));
      console.log(`  │ ${catNames[cat].padEnd(7)} │ ${String(data.signals).padStart(7)} │ ${String(data.wins).padStart(4)} │ ${String(data.losses).padStart(4)} │ ${(data.winRate + '%').padStart(6)} │ ${catProfitStr.padStart(8)} │ ${String(data.streaks.maxLoss).padStart(4)} │ ${String(data.streaks.maxWin).padStart(4)} │`);
    }
    console.log('  └─────────┴─────────┴──────┴──────┴────────┴──────────┴──────┴──────┘');

    // Sniper virtual stats
    if (r.id === 'SNIPER_3_LOSS') {
      console.log(`  📋 Virtual bets skipped: ${r.virtualStats.wins} wins (missed ₹) + ${r.virtualStats.losses} losses (saved ₹)`);
      const savedLoss = r.virtualStats.losses * baseBet;
      const missedWin = r.virtualStats.wins * baseBet * winMultiplier;
      console.log(`     → Saved from virtual losses: +₹${savedLoss} | Missed from virtual wins: -₹${Math.round(missedWin)}`);
      console.log(`     → Net benefit of waiting: ₹${Math.round(savedLoss - missedWin)}`);
    }
  }

  // ═══════════════════════════════════════════
  // TABLE 4: RISK ANALYSIS
  // ═══════════════════════════════════════════
  console.log('\n');
  console.log('╔═══════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║  📊 TABLE 4: RISK ANALYSIS — Streak Distributions & Drawdown                        ║');
  console.log('╚═══════════════════════════════════════════════════════════════════════════════════════╝');
  console.log('');

  for (const r of results) {
    const allStreaks = analyzeStreaks(r.allTrades);
    console.log(`  ${r.emoji} ${r.name}`);
    console.log(`     Max Consecutive Losses: ${allStreaks.maxLoss} | Max Consecutive Wins: ${allStreaks.maxWin}`);
    console.log(`     Max Drawdown: ₹${Math.round(r.maxDrawdown)} | Peak Balance: ₹${Math.round(r.peak)}`);

    // Loss streak distribution
    const lossDistKeys = Object.keys(allStreaks.lossStreaks).sort((a, b) => Number(a) - Number(b));
    if (lossDistKeys.length > 0) {
      const parts = lossDistKeys.map(k => `${k}-streak: ${allStreaks.lossStreaks[k]}x`);
      console.log(`     Loss streaks: ${parts.join(' | ')}`);
    }
    console.log('');
  }

  // ═══════════════════════════════════════════
  // TABLE 5: BET AMOUNT SIMULATIONS
  // ═══════════════════════════════════════════
  console.log('╔═══════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║  📊 TABLE 5: PROFIT AT DIFFERENT BET AMOUNTS                                        ║');
  console.log('╚═══════════════════════════════════════════════════════════════════════════════════════╝');
  console.log('');

  const betAmounts = [10, 50, 100, 200, 500];

  console.log('  Strategy                    │ ₹10/bet   │ ₹50/bet    │ ₹100/bet   │ ₹200/bet    │ ₹500/bet');
  console.log('  ────────────────────────────┼───────────┼────────────┼────────────┼─────────────┼───────────');

  for (const r of byProfit) {
    const profits = betAmounts.map(bet => {
      const p = (r.wins * bet * winMultiplier) - (r.losses * bet);
      return (p >= 0 ? '+₹' : '-₹') + Math.abs(Math.round(p));
    });

    console.log(
      `  ${(r.emoji + ' ' + r.name).padEnd(27)} │ ${profits[0].padStart(9)} │ ${profits[1].padStart(10)} │ ${profits[2].padStart(10)} │ ${profits[3].padStart(11)} │ ${profits[4].padStart(9)}`
    );
  }

  // ═══════════════════════════════════════════
  // TABLE 6: SIGNALS PER HOUR ESTIMATE
  // ═══════════════════════════════════════════
  console.log('\n');
  console.log('╔═══════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║  📊 TABLE 6: SIGNAL FREQUENCY — Kitni Baar Signal Aata Hai                          ║');
  console.log('╚═══════════════════════════════════════════════════════════════════════════════════════╝');
  console.log('');

  // Each period = 3 minutes. Total periods / 4 categories = avg periods per category
  const avgPeriodsPerCat = totalPeriods / Object.keys(allPeriods).length;
  const totalTimeHours = (avgPeriodsPerCat * 3) / 60;

  console.log(`  Data span: ~${avgPeriodsPerCat.toFixed(0)} periods per category = ~${totalTimeHours.toFixed(1)} hours of data`);
  console.log('');
  console.log('  Strategy                    │ Total Signals │ Signals/Hour │ Avg Gap (mins)');
  console.log('  ────────────────────────────┼───────────────┼──────────────┼───────────────');

  for (const r of results) {
    const perHour = totalTimeHours > 0 ? (r.totalSignals / totalTimeHours).toFixed(1) : '0.0';
    const avgGap = r.totalSignals > 0 ? ((totalTimeHours * 60) / r.totalSignals).toFixed(1) : '∞';

    console.log(
      `  ${(r.emoji + ' ' + r.name).padEnd(27)} │ ${String(r.totalSignals).padStart(13)} │ ${perHour.padStart(12)} │ ${(avgGap + ' min').padStart(14)}`
    );
  }

  // ═══════════════════════════════════════════
  // FINAL VERDICT
  // ═══════════════════════════════════════════
  console.log('\n');
  console.log('╔═══════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║  🏆 FINAL VERDICT — Kaunsa Strategy Best Hai?                                       ║');
  console.log('╚═══════════════════════════════════════════════════════════════════════════════════════╝');
  console.log('');

  const bestProfit = byProfit[0];
  const bestWinRate = byWinRate[0];
  const safest = [...results].sort((a, b) => a.maxLoss - b.maxLoss)[0];
  const bestROI = [...results].sort((a, b) => parseFloat(b.roi) - parseFloat(a.roi))[0];
  const mostSignals = [...results].sort((a, b) => b.totalSignals - a.totalSignals)[0];

  console.log(`  💰 MOST PROFITABLE:    ${bestProfit.emoji} ${bestProfit.name}`);
  console.log(`                         Profit: +₹${Math.round(bestProfit.profit)} | Win Rate: ${bestProfit.winRate}% | ${bestProfit.totalSignals} signals`);
  console.log('');
  console.log(`  📈 HIGHEST WIN RATE:   ${bestWinRate.emoji} ${bestWinRate.name}`);
  console.log(`                         Win Rate: ${bestWinRate.winRate}% | Profit: ₹${Math.round(bestWinRate.profit)} | ${bestWinRate.totalSignals} signals`);
  console.log('');
  console.log(`  🛡️  SAFEST (Low Risk):  ${safest.emoji} ${safest.name}`);
  console.log(`                         Max Loss Streak: ${safest.maxLoss} | Drawdown: ₹${Math.round(safest.maxDrawdown)} | Win: ${safest.winRate}%`);
  console.log('');
  console.log(`  📊 BEST ROI PER BET:   ${bestROI.emoji} ${bestROI.name}`);
  console.log(`                         ROI: ${bestROI.roi}% per bet | Profit: ₹${Math.round(bestROI.profit)}`);
  console.log('');
  console.log(`  🔔 MOST SIGNALS:       ${mostSignals.emoji} ${mostSignals.name}`);
  console.log(`                         ${mostSignals.totalSignals} signals | Great for active trading`);

  console.log('\n');
  console.log('  ═══ RECOMMENDATION ═══');
  console.log('');

  // Smart recommendation
  if (bestProfit.id === bestWinRate.id) {
    console.log(`  🏆 CLEAR WINNER: ${bestProfit.emoji} ${bestProfit.name}`);
    console.log(`     Best in both profit AND win rate!`);
  } else {
    console.log(`  🎯 For MAXIMUM PROFIT:  Use "${bestProfit.name}"`);
    console.log(`  🛡️  For SAFE PLAY:       Use "${safest.name}"`);
    console.log(`  ⚡ For ACTIVE TRADING:  Use "${mostSignals.name}" (most signals per hour)`);
    console.log(`  📈 For BEST ACCURACY:   Use "${bestWinRate.name}" (highest win%)`);
  }

  console.log('');
  console.log('  Note: Results are based on historical data available via API.');
  console.log('        Past performance does NOT guarantee future results.');
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════════════');
  console.log('');
}

main().catch(console.error);
