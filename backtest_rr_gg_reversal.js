#!/usr/bin/env node
/**
 * BACKTEST: RR→G + GG→R Trend Reversal Strategy
 * 
 * Rules:
 * - See 2 consecutive Reds  → Bet GREEN on next period
 * - See 2 consecutive Greens → Bet RED on next period
 * 
 * Analyzes each of the 4 sections separately + combined overall.
 * Tracks consecutive losses in detail.
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

// ============ BACKTEST ENGINE ============
function runBacktest(periods) {
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

    // Need at least 2 previous periods
    if (i < 1) continue;

    const prev2 = getColor(periods[i - 1]);
    const prev1 = getColor(periods[i]);

    // Check for RR → bet G
    if (prev2 === 'R' && prev1 === 'R') {
      if (i + 1 < periods.length) {
        activeBet = {
          color: 'G',
          period: periods[i + 1].period,
          trigger: 'RR→G'
        };
      }
    }
    // Check for GG → bet R
    else if (prev2 === 'G' && prev1 === 'G') {
      if (i + 1 < periods.length) {
        activeBet = {
          color: 'R',
          period: periods[i + 1].period,
          trigger: 'GG→R'
        };
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

  // Count streak frequencies
  const streakFreq = {};
  for (const s of allStreaks) {
    streakFreq[s.length] = (streakFreq[s.length] || 0) + 1;
  }

  return { maxStreak, allStreaks, streakFreq };
}

// ============ MAIN ============
async function main() {
  const categories = ['P', 'S', 'B', 'E'];
  const categoryNames = { P: 'Parity', S: 'Sapre', B: 'Bcone', E: 'Emerd' };

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  📊 BACKTEST: RR→G + GG→R Trend Reversal Strategy');
  console.log('  Rule: 2 same colors → bet OPPOSITE on next period');
  console.log('═══════════════════════════════════════════════════════════════\n');

  let allTrades = [];

  for (const cat of categories) {
    const data = await fetchSectionData(cat);
    if (!data || !data.periods || data.periods.length === 0) {
      console.log(`  ⚠️ No data for ${categoryNames[cat]}`);
      continue;
    }

    const periods = data.periods;
    const trades = runBacktest(periods);
    const wins = trades.filter(t => t.won).length;
    const losses = trades.filter(t => !t.won).length;
    const winRate = trades.length > 0 ? (wins / trades.length * 100).toFixed(1) : '0.0';

    // Split by trigger type
    const rrTrades = trades.filter(t => t.trigger === 'RR→G');
    const ggTrades = trades.filter(t => t.trigger === 'GG→R');
    const rrWins = rrTrades.filter(t => t.won).length;
    const ggWins = ggTrades.filter(t => t.won).length;

    const { maxStreak, allStreaks, streakFreq } = analyzeConsecutiveLosses(trades);

    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`  ${categoryNames[cat]} (${cat}) — ${periods.length} periods, ${trades.length} trades`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`  ✅ Wins: ${wins}  |  ❌ Losses: ${losses}  |  Win Rate: ${winRate}%`);
    console.log(`  📈 RR→G trades: ${rrTrades.length} (won ${rrWins}, ${rrTrades.length > 0 ? (rrWins / rrTrades.length * 100).toFixed(1) : 0}%)`);
    console.log(`  📉 GG→R trades: ${ggTrades.length} (won ${ggWins}, ${ggTrades.length > 0 ? (ggWins / ggTrades.length * 100).toFixed(1) : 0}%)`);
    console.log(`\n  🔴 MAX CONSECUTIVE LOSSES: ${maxStreak}`);

    // Streak frequency breakdown
    console.log(`\n  Loss Streak Breakdown:`);
    const sortedKeys = Object.keys(streakFreq).map(Number).sort((a, b) => a - b);
    for (const len of sortedKeys) {
      const bar = '█'.repeat(Math.min(streakFreq[len] * 2, 40));
      console.log(`     ${String(len).padStart(2)} in a row: ${String(streakFreq[len]).padStart(3)} times  ${bar}`);
    }

    // Show worst streaks (3+ consecutive losses) with details
    const worstStreaks = allStreaks.filter(s => s.length >= 3).sort((a, b) => b.length - a.length);
    if (worstStreaks.length > 0) {
      console.log(`\n  ⚠️ Worst streaks (3+ consecutive losses):`);
      for (const s of worstStreaks.slice(0, 8)) {
        const details = trades.slice(s.startIdx, s.endIdx + 1)
          .map(t => `${t.trigger}→${t.actualColor}`)
          .join(', ');
        console.log(`     ${s.length} losses: Trade #${s.startIdx + 1}-${s.endIdx + 1}  [${details}]`);
      }
    }

    // Trade sequence (last 40)
    console.log(`\n  Trade sequence (last 40):`);
    const recent = trades.slice(-40);
    let line = '     ';
    for (const t of recent) {
      line += t.won ? '✅' : '❌';
    }
    console.log(line);

    allTrades = allTrades.concat(trades);
  }

  // ============ OVERALL SUMMARY ============
  console.log('\n\n═══════════════════════════════════════════════════════════════');
  console.log('  📊 OVERALL SUMMARY (All 4 Sections Combined)');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const totalWins = allTrades.filter(t => t.won).length;
  const totalLosses = allTrades.filter(t => !t.won).length;
  const totalWinRate = allTrades.length > 0 ? (totalWins / allTrades.length * 100).toFixed(1) : '0.0';

  const totalRR = allTrades.filter(t => t.trigger === 'RR→G');
  const totalGG = allTrades.filter(t => t.trigger === 'GG→R');
  const totalRRWins = totalRR.filter(t => t.won).length;
  const totalGGWins = totalGG.filter(t => t.won).length;

  const { maxStreak, streakFreq } = analyzeConsecutiveLosses(allTrades);

  console.log(`  Total Trades: ${allTrades.length}`);
  console.log(`  ✅ Wins: ${totalWins}  |  ❌ Losses: ${totalLosses}  |  Net: ${totalWins - totalLosses >= 0 ? '+' : ''}${totalWins - totalLosses}`);
  console.log(`  Win Rate: ${totalWinRate}%`);
  console.log(`\n  📈 RR→G: ${totalRR.length} trades (won ${totalRRWins}, ${totalRR.length > 0 ? (totalRRWins / totalRR.length * 100).toFixed(1) : 0}%)`);
  console.log(`  📉 GG→R: ${totalGG.length} trades (won ${totalGGWins}, ${totalGG.length > 0 ? (totalGGWins / totalGG.length * 100).toFixed(1) : 0}%)`);
  console.log(`\n  🔴 MAX CONSECUTIVE LOSSES: ${maxStreak}\n`);

  console.log(`  Loss Streak Distribution:`);
  const sortedKeys = Object.keys(streakFreq).map(Number).sort((a, b) => a - b);
  for (const len of sortedKeys) {
    const bar = '█'.repeat(Math.min(streakFreq[len], 40));
    console.log(`     ${String(len).padStart(2)} consecutive: ${String(streakFreq[len]).padStart(3)} times  ${bar}`);
  }

  // Martingale risk table
  console.log('\n  💰 Martingale Risk (₹10 base bet):');
  for (let streak = 1; streak <= Math.min(maxStreak, 10); streak++) {
    const totalLost = Array.from({ length: streak }, (_, i) => 10 * Math.pow(2, i)).reduce((a, b) => a + b, 0);
    const nextBet = 10 * Math.pow(2, streak);
    console.log(`     ${String(streak).padStart(2)} loss${streak > 1 ? 'es' : '  '}: Total invested: ₹${totalLost.toLocaleString().padStart(7)}, Next bet: ₹${nextBet.toLocaleString().padStart(7)}`);
  }

  console.log('\n═══════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
