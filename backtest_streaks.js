#!/usr/bin/env node
/**
 * BACKTEST: RGR Direct — Consecutive Loss Analysis
 */

const API_BASE = 'https://cooe02.in';
const SAAS_ID = 1;

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

function getColor(period) { return period.is_green ? 'G' : 'R'; }

function isAlternating(colors) {
  for (let i = 1; i < colors.length; i++) {
    if (colors[i] === colors[i - 1]) return false;
  }
  return true;
}

function backtestDirect(periods, patternLength) {
  const trades = [];
  let activeBet = null;

  for (let i = 0; i < periods.length; i++) {
    if (activeBet && periods[i].period === activeBet.period) {
      const actualColor = getColor(periods[i]);
      const won = actualColor === activeBet.color;
      trades.push({ betColor: activeBet.color, actualColor, won });
      activeBet = null;
    }
    if (activeBet) continue;
    if (i < patternLength - 1) continue;

    const patternColors = [];
    for (let j = i - patternLength + 1; j <= i; j++) {
      patternColors.push(getColor(periods[j]));
    }
    if (!isAlternating(patternColors)) continue;
    if (i + 1 >= periods.length) continue;

    activeBet = { color: patternColors[patternColors.length - 1], period: periods[i + 1].period };
  }

  return trades;
}

function analyzeConsecutiveLosses(trades) {
  let currentStreak = 0;
  let maxStreak = 0;
  const allStreaks = []; // all loss streaks
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

async function main() {
  const categories = ['P', 'S', 'B', 'E'];
  const categoryNames = { P: 'Parity', S: 'Sapre', B: 'Bcone', E: 'Emerd' };

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  📊 RGR Direct — Consecutive Loss Analysis');
  console.log('═══════════════════════════════════════════════════════════════\n');

  let allTrades = [];

  for (const cat of categories) {
    const data = await fetchSectionData(cat);
    if (!data || !data.periods) continue;

    const trades = backtestDirect(data.periods, 3);
    const { maxStreak, allStreaks, streakFreq } = analyzeConsecutiveLosses(trades);

    const wins = trades.filter(t => t.won).length;
    const losses = trades.filter(t => !t.won).length;

    console.log(`\n━━━ ${categoryNames[cat]} (${data.periods.length} periods, ${trades.length} trades) ━━━`);
    console.log(`  Wins: ${wins} | Losses: ${losses} | Win Rate: ${(wins / trades.length * 100).toFixed(1)}%`);
    console.log(`  🔴 Max Consecutive Losses: ${maxStreak}`);
    console.log(`  Loss Streak Breakdown:`);

    const sortedKeys = Object.keys(streakFreq).map(Number).sort((a, b) => a - b);
    for (const len of sortedKeys) {
      const bar = '█'.repeat(streakFreq[len] * 2);
      console.log(`     ${len} in a row: ${streakFreq[len]} times  ${bar}`);
    }

    // Show the worst streak details
    if (allStreaks.length > 0) {
      const worstStreaks = allStreaks.filter(s => s.length >= 3).sort((a, b) => b.length - a.length);
      if (worstStreaks.length > 0) {
        console.log(`\n  ⚠️ Worst streaks (3+ consecutive losses):`);
        for (const s of worstStreaks) {
          const details = trades.slice(s.startIdx, s.endIdx + 1)
            .map(t => `${t.betColor === 'G' ? 'GREEN' : 'RED'}→${t.actualColor === 'G' ? 'GREEN' : 'RED'}`)
            .join(', ');
          console.log(`     ${s.length} losses: Trade #${s.startIdx + 1}-${s.endIdx + 1} [${details}]`);
        }
      }
    }

    // Show trade-by-trade sequence
    console.log(`\n  Trade sequence (last 30):`);
    const recent = trades.slice(-30);
    let line = '     ';
    for (const t of recent) {
      line += t.won ? '✅' : '❌';
    }
    console.log(line);

    allTrades = allTrades.concat(trades);
  }

  // Overall analysis
  console.log('\n\n═══════════════════════════════════════════════════════════════');
  console.log('  📊 OVERALL (All 4 Categories Combined)');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const totalWins = allTrades.filter(t => t.won).length;
  const totalLosses = allTrades.filter(t => !t.won).length;
  const { maxStreak, streakFreq } = analyzeConsecutiveLosses(allTrades);

  console.log(`  Total Trades: ${allTrades.length}`);
  console.log(`  Wins: ${totalWins} | Losses: ${totalLosses} | Net: ${totalWins - totalLosses >= 0 ? '+' : ''}${totalWins - totalLosses}`);
  console.log(`  Win Rate: ${(totalWins / allTrades.length * 100).toFixed(1)}%`);
  console.log(`\n  🔴 MAX CONSECUTIVE LOSSES: ${maxStreak}\n`);
  console.log(`  Loss Streak Distribution:`);

  const sortedKeys = Object.keys(streakFreq).map(Number).sort((a, b) => a - b);
  for (const len of sortedKeys) {
    const bar = '█'.repeat(streakFreq[len]);
    console.log(`     ${len} consecutive: ${String(streakFreq[len]).padStart(3)} times  ${bar}`);
  }

  // Martingale risk analysis
  console.log('\n  💰 Martingale Risk (₹100 base bet):');
  for (let streak = 1; streak <= maxStreak; streak++) {
    const totalLost = Array.from({ length: streak }, (_, i) => 100 * Math.pow(2, i)).reduce((a, b) => a + b, 0);
    const nextBet = 100 * Math.pow(2, streak);
    console.log(`     ${streak} loss${streak > 1 ? 'es' : ' '}:  Total invested: ₹${totalLost.toLocaleString()}, Next bet needed: ₹${nextBet.toLocaleString()}`);
  }

  console.log('\n═══════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
