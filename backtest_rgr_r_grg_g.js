#!/usr/bin/env node
/**
 * BACKTEST: RGR→R / GRG→G Strategy
 * 
 * Strategy:
 *   - Detect 3-color alternating pattern: ABA
 *   - Bet SAME as last color (= same as first color)
 *     → RGR → bet R
 *     → GRG → bet G
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
 * Run backtest: RGR→R, GRG→G
 */
function runBacktest(periods) {
  const trades = [];
  let totalPNL = 0;

  for (let i = 2; i < periods.length - 1; i++) {
    const c1 = getColor(periods[i - 2]);
    const c2 = getColor(periods[i - 1]);
    const c3 = getColor(periods[i]);

    // Check for alternating 3-pattern: ABA
    // RGR or GRG
    if (!(c1 !== c2 && c2 !== c3 && c1 === c3)) continue;

    // Bet same as last color (= first color)
    const betColor = c3;
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
 * Analyze consecutive losses
 */
function analyzeConsecutiveLosses(trades) {
  let currentStreak = 0;
  let maxStreak = 0;
  const lossStreaks = [];
  let streakStart = null;

  for (let i = 0; i < trades.length; i++) {
    if (!trades[i].won) {
      currentStreak++;
      if (streakStart === null) streakStart = i;
      if (currentStreak > maxStreak) maxStreak = currentStreak;
    } else {
      if (currentStreak > 0) {
        lossStreaks.push({
          length: currentStreak,
          startPeriod: trades[streakStart].period,
          endPeriod: trades[i - 1].period
        });
      }
      currentStreak = 0;
      streakStart = null;
    }
  }

  if (currentStreak > 0) {
    lossStreaks.push({
      length: currentStreak,
      startPeriod: trades[streakStart].period,
      endPeriod: trades[trades.length - 1].period
    });
  }

  const distribution = {};
  for (const s of lossStreaks) {
    distribution[s.length] = (distribution[s.length] || 0) + 1;
  }

  return { maxStreak, lossStreaks, distribution };
}

/**
 * N-loss entry backtest: wait for N consecutive virtual losses, then bet live
 */
function runNLossEntryBacktest(periods, nLosses) {
  const trades = [];
  let virtualLossCount = 0;
  let totalPNL = 0;
  let liveBets = 0;
  let liveWins = 0;
  let waitingForTrendBreak = false;

  for (let i = 2; i < periods.length - 1; i++) {
    // Trend break check: two consecutive same colors
    if (waitingForTrendBreak) {
      if (i >= 1 && getColor(periods[i]) === getColor(periods[i - 1])) {
        waitingForTrendBreak = false;
      } else {
        continue;
      }
    }

    const c1 = getColor(periods[i - 2]);
    const c2 = getColor(periods[i - 1]);
    const c3 = getColor(periods[i]);

    // Check for alternating 3-pattern: ABA
    if (!(c1 !== c2 && c2 !== c3 && c1 === c3)) continue;

    const betColor = c3;
    const actualColor = getColor(periods[i + 1]);
    const won = actualColor === betColor;

    if (virtualLossCount < nLosses) {
      // Virtual bet
      if (won) {
        virtualLossCount = 0; // reset on win
      } else {
        virtualLossCount++;
        waitingForTrendBreak = true;
      }
    } else {
      // LIVE bet
      liveBets++;
      const pnl = won ? BET_AMOUNT * WIN_MULTIPLIER : -BET_AMOUNT;
      totalPNL += pnl;

      if (won) {
        liveWins++;
        virtualLossCount = 0; // reset on profit
      } else {
        waitingForTrendBreak = true;
      }

      trades.push({
        period: periods[i + 1].period,
        pattern: `${c1}${c2}${c3}`,
        betColor,
        actualColor,
        won,
        pnl,
        runningPNL: totalPNL,
        entryAfterLosses: nLosses
      });
    }
  }

  return { trades, totalPNL, liveBets, liveWins };
}

async function main() {
  const categories = ['P', 'S', 'B', 'E'];
  const categoryNames = { P: 'Parity', S: 'Sapre', B: 'Bcone', E: 'Emerd' };

  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('  📊 BACKTEST: RGR→R / GRG→G (Alternating 3-Pattern)');
  console.log('  If RGR → bet R  |  If GRG → bet G');
  console.log('  (Bet same as last color in alternating pattern)');
  console.log('  Payout: 1.96x | Flat ₹10 bets');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  let grandTrades = 0, grandWins = 0, grandPNL = 0, grandMaxStreak = 0;

  for (const cat of categories) {
    const data = await fetchSectionData(cat);
    if (!data?.periods?.length) {
      console.log(`  ⚠️ No data for ${categoryNames[cat]}`);
      continue;
    }

    const periods = data.periods;
    const { trades, totalPNL } = runBacktest(periods);
    const wins = trades.filter(t => t.won).length;
    const losses = trades.filter(t => !t.won).length;
    const winRate = trades.length > 0 ? (wins / trades.length * 100).toFixed(1) : '0.0';
    const lossAnalysis = analyzeConsecutiveLosses(trades);

    grandTrades += trades.length;
    grandWins += wins;
    grandPNL += totalPNL;
    if (lossAnalysis.maxStreak > grandMaxStreak) grandMaxStreak = lossAnalysis.maxStreak;

    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`  📌 ${categoryNames[cat]} (${cat}) — ${periods.length} periods`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    console.log(`\n  📊 All Signals (flat bet every pattern):`);
    console.log(`     Signals: ${trades.length}  |  Wins: ${wins}  |  Losses: ${losses}`);
    console.log(`     Win rate: ${winRate}%`);
    console.log(`     💰 P&L: ${totalPNL >= 0 ? '+' : ''}₹${totalPNL.toFixed(1)}`);
    console.log(`     Max consecutive losses: ${lossAnalysis.maxStreak}`);

    // Loss distribution
    if (Object.keys(lossAnalysis.distribution).length > 0) {
      console.log(`\n  📉 Loss Streak Distribution:`);
      const sorted = Object.entries(lossAnalysis.distribution).sort((a, b) => Number(a[0]) - Number(b[0]));
      for (const [len, count] of sorted) {
        console.log(`     ${len} in a row: ${count} times`);
      }
    }

    // N-Loss entry analysis
    console.log(`\n  🎯 N-Loss Entry Analysis (wait N losses, then bet live):`);
    console.log(`     ${'N-Loss'.padEnd(10)} ${'Live Bets'.padEnd(12)} ${'Wins'.padEnd(8)} ${'Win%'.padEnd(10)} ${'P&L'.padEnd(12)}`);
    console.log(`     ${'─'.repeat(55)}`);

    for (let n = 0; n <= 10; n++) {
      const result = runNLossEntryBacktest(periods, n);
      const liveWinRate = result.liveBets > 0 ? (result.liveWins / result.liveBets * 100).toFixed(1) : '0.0';
      const pnlStr = `${result.totalPNL >= 0 ? '+' : ''}₹${result.totalPNL.toFixed(1)}`;
      const marker = result.totalPNL > 0 ? ' ✅' : result.totalPNL === 0 ? '' : ' ❌';
      console.log(`     ${`${n} loss`.padEnd(10)} ${String(result.liveBets).padEnd(12)} ${String(result.liveWins).padEnd(8)} ${`${liveWinRate}%`.padEnd(10)} ${pnlStr}${marker}`);
    }

    // Show last 20 trades
    console.log(`\n  📋 Last 20 Signals:`);
    const lastTrades = trades.slice(-20);
    for (const t of lastTrades) {
      const icon = t.won ? '✅' : '❌';
      console.log(`     ${icon} ${t.pattern}→${t.betColor} | Actual: ${t.actualColor} | P&L: ${t.pnl > 0 ? '+' : ''}₹${t.pnl.toFixed(1)} | Running: ${t.runningPNL >= 0 ? '+' : ''}₹${t.runningPNL.toFixed(1)}`);
    }

    console.log('');
  }

  // Grand totals
  const grandLosses = grandTrades - grandWins;
  const grandWinRate = grandTrades > 0 ? (grandWins / grandTrades * 100).toFixed(1) : '0.0';

  console.log(`\n╔═══════════════════════════════════════════════════════════════════╗`);
  console.log(`║  📊 GRAND TOTAL (All 4 Sections Combined)                       ║`);
  console.log(`╠═══════════════════════════════════════════════════════════════════╣`);
  console.log(`║  Total signals: ${String(grandTrades).padEnd(47)}║`);
  console.log(`║  Wins: ${String(grandWins).padEnd(10)} Losses: ${String(grandLosses).padEnd(34)}║`);
  console.log(`║  Win rate: ${`${grandWinRate}%`.padEnd(52)}║`);
  console.log(`║  💰 P&L: ${`${grandPNL >= 0 ? '+' : ''}₹${grandPNL.toFixed(1)}`.padEnd(53)}║`);
  console.log(`║  Max consecutive losses: ${String(grandMaxStreak).padEnd(38)}║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════╝`);
}

main().catch(console.error);
