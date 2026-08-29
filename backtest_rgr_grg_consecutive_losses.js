#!/usr/bin/env node
/**
 * BACKTEST: RGG→R / GRR→G — Consecutive Loss Analysis
 * 
 * Strategy:
 *   - Detect 3-color pattern: ABB (first differs, last two same)
 *   - Bet OPPOSITE of the pair (= same as first color)
 *     → RGG → bet R
 *     → GRR → bet G
 * 
 * Analysis:
 *   - Every signal is tracked
 *   - For each section: how many consecutive losses occurred
 *   - Shows max consecutive losses, all loss streaks, and distribution
 * 
 * Payout: 1.96x (0.96 profit per ₹1 bet, 4% platform fee)
 */

const API_BASE = 'https://cooe02.in';
const SAAS_ID = 1;

const BET_AMOUNT = 10;
const WIN_MULTIPLIER = 0.96;

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

/**
 * Run backtest and return all signals + consecutive loss analysis
 */
function runBacktest(periods) {
  const trades = [];
  let totalPNL = 0;

  for (let i = 0; i < periods.length; i++) {
    if (i < 2) continue;  // need at least 3 periods

    // Get last 3 colors
    const c1 = getColor(periods[i - 2]);
    const c2 = getColor(periods[i - 1]);
    const c3 = getColor(periods[i]);

    // Check for ABB pattern: first differs, last two same
    // RGG or GRR
    if (!(c1 !== c2 && c2 === c3)) continue;

    // Next period to bet on
    if (i + 1 >= periods.length) continue;

    // RGG → bet R (opposite of pair = same as first)
    // GRR → bet G (opposite of pair = same as first)
    const betColor = c1;  // bet same as first color
    const pattern = `${c1}${c2}${c3}`;
    
    const actualColor = getColor(periods[i + 1]);
    const won = actualColor === betColor;
    const pnl = won ? BET_AMOUNT * WIN_MULTIPLIER : -BET_AMOUNT;
    totalPNL += pnl;

    trades.push({
      index: i,
      period: periods[i + 1].period,
      pattern,
      betColor,
      actualColor,
      won,
      pnl,
      runningPNL: totalPNL
    });
  }

  return { trades, totalPNL };
}

/**
 * Analyze consecutive losses from a list of trades
 * Returns: maxConsecutiveLosses, all loss streaks, distribution
 */
function analyzeConsecutiveLosses(trades) {
  let currentStreak = 0;
  let maxStreak = 0;
  const lossStreaks = [];       // array of { startIdx, endIdx, length, startPeriod, endPeriod }
  let streakStart = null;

  for (let i = 0; i < trades.length; i++) {
    if (!trades[i].won) {
      currentStreak++;
      if (streakStart === null) streakStart = i;
      if (currentStreak > maxStreak) maxStreak = currentStreak;
    } else {
      if (currentStreak > 0) {
        lossStreaks.push({
          startTradeIdx: streakStart,
          endTradeIdx: i - 1,
          length: currentStreak,
          startPeriod: trades[streakStart].period,
          endPeriod: trades[i - 1].period
        });
      }
      currentStreak = 0;
      streakStart = null;
    }
  }

  // Don't forget trailing streak
  if (currentStreak > 0) {
    lossStreaks.push({
      startTradeIdx: streakStart,
      endTradeIdx: trades.length - 1,
      length: currentStreak,
      startPeriod: trades[streakStart].period,
      endPeriod: trades[trades.length - 1].period
    });
  }

  // Distribution: how many streaks of each length
  const distribution = {};
  for (const s of lossStreaks) {
    distribution[s.length] = (distribution[s.length] || 0) + 1;
  }

  return { maxStreak, lossStreaks, distribution };
}

async function main() {
  const categories = ['P', 'S', 'B', 'E'];
  const categoryNames = { P: 'Parity', S: 'Sapre', B: 'Bcone', E: 'Emerd' };

  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('  📊 BACKTEST: RGG→R / GRR→G — Consecutive Loss Analysis');
  console.log('  Bet: Opposite of pair (= same as first color)');
  console.log('    RGG → bet R  |  GRR → bet G');
  console.log('  Payout: 1.96x | Flat ₹10 bets');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  let grandTotalTrades = 0;
  let grandTotalWins = 0;
  let grandTotalLosses = 0;
  let grandPNL = 0;
  let grandMaxStreak = 0;
  const allSectionResults = [];

  for (const cat of categories) {
    const data = await fetchSectionData(cat);
    if (!data || !data.periods || data.periods.length === 0) {
      console.log(`  ⚠️ No data for ${categoryNames[cat]}`);
      continue;
    }

    const periods = data.periods;
    const { trades, totalPNL } = runBacktest(periods);
    const wins = trades.filter(t => t.won).length;
    const losses = trades.filter(t => !t.won).length;
    const winRate = trades.length > 0 ? (wins / trades.length * 100).toFixed(1) : '0.0';

    const lossAnalysis = analyzeConsecutiveLosses(trades);

    allSectionResults.push({
      category: cat,
      name: categoryNames[cat],
      periods: periods.length,
      trades,
      wins,
      losses,
      winRate,
      totalPNL,
      lossAnalysis
    });

    // ── Section Header ──
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`  📌 ${categoryNames[cat]} (${cat}) — ${periods.length} periods`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    // ── Basic Stats ──
    console.log(`\n  📊 Trade Stats:`);
    console.log(`     Total signals: ${trades.length}`);
    console.log(`     Wins: ${wins}  |  Losses: ${losses}`);
    console.log(`     Win rate: ${winRate}%`);
    console.log(`     💰 P&L: ${totalPNL >= 0 ? '+' : ''}₹${totalPNL.toFixed(1)}`);

    // ── Consecutive Loss Analysis ──
    console.log(`\n  🔥 Consecutive Loss Analysis:`);
    console.log(`     Max consecutive losses: ${lossAnalysis.maxStreak}`);
    console.log(`     Total loss streaks: ${lossAnalysis.lossStreaks.length}`);

    // Distribution
    if (Object.keys(lossAnalysis.distribution).length > 0) {
      console.log(`\n     📊 Loss Streak Distribution:`);
      const sortedLengths = Object.keys(lossAnalysis.distribution).map(Number).sort((a, b) => a - b);
      for (const len of sortedLengths) {
        const count = lossAnalysis.distribution[len];
        const bar = '█'.repeat(Math.min(count, 30));
        console.log(`        ${len} consecutive: ${count} time(s)  ${bar}`);
      }
    }

    // Show all loss streaks >= 3
    const bigStreaks = lossAnalysis.lossStreaks.filter(s => s.length >= 3);
    if (bigStreaks.length > 0) {
      console.log(`\n     ⚠️  Loss Streaks of 3+:`);
      for (const s of bigStreaks) {
        // Show the actual trades in this streak
        const streakTrades = trades.slice(s.startTradeIdx, s.endTradeIdx + 1);
        const patterns = streakTrades.map(t => `${t.pattern}→${t.betColor}(got ${t.actualColor})`).join(', ');
        console.log(`        ${s.length} losses: Trade #${s.startTradeIdx + 1}–#${s.endTradeIdx + 1}`);
        console.log(`           ${patterns}`);
      }
    }

    // ── Trade-by-trade log (last 20) ──
    if (trades.length > 0) {
      const showCount = Math.min(trades.length, 20);
      console.log(`\n  📋 Last ${showCount} Trades:`);
      trades.slice(-showCount).forEach((t, idx) => {
        const icon = t.won ? '✅' : '❌';
        const pnlStr = t.pnl >= 0 ? `+₹${t.pnl.toFixed(1)}` : `-₹${Math.abs(t.pnl).toFixed(1)}`;
        const runStr = t.runningPNL >= 0 ? `+₹${t.runningPNL.toFixed(1)}` : `-₹${Math.abs(t.runningPNL).toFixed(1)}`;
        console.log(`     ${icon} ${t.pattern}→${t.betColor}  Got:${t.actualColor}  ${pnlStr}  (Total: ${runStr})`);
      });
    }

    // ── W/L Sequence (visual) ──
    if (trades.length > 0) {
      const sequence = trades.map(t => t.won ? 'W' : 'L').join('');
      console.log(`\n  📈 W/L Sequence:`);
      // Print in chunks of 50
      for (let j = 0; j < sequence.length; j += 50) {
        const chunk = sequence.slice(j, j + 50);
        console.log(`     ${String(j + 1).padStart(4)}: ${chunk}`);
      }
    }

    console.log();

    grandTotalTrades += trades.length;
    grandTotalWins += wins;
    grandTotalLosses += losses;
    grandPNL += totalPNL;
    if (lossAnalysis.maxStreak > grandMaxStreak) grandMaxStreak = lossAnalysis.maxStreak;
  }

  // ════════════════ OVERALL SUMMARY ════════════════
  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('  📊 OVERALL SUMMARY (All 4 Sections)');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  const overallWinRate = grandTotalTrades > 0
    ? (grandTotalWins / grandTotalTrades * 100).toFixed(1)
    : '0.0';

  console.log(`  Total trades across all sections: ${grandTotalTrades}`);
  console.log(`  Wins: ${grandTotalWins}  |  Losses: ${grandTotalLosses}`);
  console.log(`  Overall win rate: ${overallWinRate}%`);
  console.log(`  💰 Total P&L: ${grandPNL >= 0 ? '+' : ''}₹${grandPNL.toFixed(1)}`);
  console.log(`  🔥 Worst consecutive loss streak (any section): ${grandMaxStreak}`);

  if (grandTotalTrades > 0) {
    const avgPNL = grandPNL / grandTotalTrades;
    console.log(`  📈 Avg P&L per trade: ${avgPNL >= 0 ? '+' : ''}₹${avgPNL.toFixed(2)}`);
  }

  // ── Per-Section Comparison Table ──
  console.log(`\n  ┌────────────┬────────┬──────┬───────┬──────────┬──────────────┬────────────┐`);
  console.log(`  │ Section    │ Trades │ Wins │ Losses│ Win Rate │ Max ConsLoss │   P&L      │`);
  console.log(`  ├────────────┼────────┼──────┼───────┼──────────┼──────────────┼────────────┤`);
  for (const r of allSectionResults) {
    const pnlStr = `${r.totalPNL >= 0 ? '+' : ''}₹${r.totalPNL.toFixed(1)}`;
    console.log(`  │ ${r.name.padEnd(10)} │ ${String(r.trades.length).padStart(6)} │ ${String(r.wins).padStart(4)} │ ${String(r.losses).padStart(5)} │ ${(r.winRate + '%').padStart(8)} │ ${String(r.lossAnalysis.maxStreak).padStart(12)} │ ${pnlStr.padStart(10)} │`);
  }
  console.log(`  └────────────┴────────┴──────┴───────┴──────────┴──────────────┴────────────┘`);

  // ── Combined Loss Streak Distribution ──
  console.log(`\n  📊 Combined Loss Streak Distribution (All Sections):`);
  const combinedDist = {};
  for (const r of allSectionResults) {
    for (const [len, count] of Object.entries(r.lossAnalysis.distribution)) {
      combinedDist[len] = (combinedDist[len] || 0) + count;
    }
  }
  const sortedKeys = Object.keys(combinedDist).map(Number).sort((a, b) => a - b);
  for (const len of sortedKeys) {
    const count = combinedDist[len];
    const bar = '█'.repeat(Math.min(count, 40));
    console.log(`     ${String(len).padStart(2)} consecutive losses: ${String(count).padStart(3)} time(s)  ${bar}`);
  }

  console.log(`\n  Strategy: RGG→R / GRR→G (ABB pattern → bet opposite of pair)`);
  console.log(`  Bet: Flat ₹${BET_AMOUNT} per trade`);

  console.log('\n═══════════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
