#!/usr/bin/env node
/**
 * BACKTEST: Compare Direct strategy vs "Wait for Trend End" strategy
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

function getColor(period) {
  return period.is_green ? 'G' : 'R';
}

function isAlternating(colors) {
  for (let i = 1; i < colors.length; i++) {
    if (colors[i] === colors[i - 1]) return false;
  }
  return true;
}

// ============ STRATEGY 1: DIRECT (CURRENT) ============
function backtestDirect(periods, patternLength) {
  const results = { totalSignals: 0, wins: 0, losses: 0, trades: [] };
  let activeBet = null;

  for (let i = 0; i < periods.length; i++) {
    // Resolve active bet
    if (activeBet && periods[i].period === activeBet.period) {
      const actualColor = getColor(periods[i]);
      const won = actualColor === activeBet.color;
      results.totalSignals++;
      results.trades.push({ period: periods[i].period, betColor: activeBet.color, actualColor, won });
      if (won) results.wins++; else results.losses++;
      activeBet = null;
    }

    if (activeBet) continue;

    // Hunt for pattern
    if (i < patternLength - 1) continue;

    const patternColors = [];
    for (let j = i - patternLength + 1; j <= i; j++) {
      patternColors.push(getColor(periods[j]));
    }
    if (!isAlternating(patternColors)) continue;
    if (i + 1 >= periods.length) continue;

    const betColor = patternColors[patternColors.length - 1];
    const nextPeriod = periods[i + 1].period;
    activeBet = { color: betColor, period: nextPeriod };
  }

  results.winRate = results.totalSignals > 0 ? ((results.wins / results.totalSignals) * 100).toFixed(1) : '0.0';
  return results;
}

// ============ STRATEGY 2: WAIT FOR TREND END (NEW) ============
function backtestWaitTrendEnd(periods, patternLength) {
  const results = { totalSignals: 0, wins: 0, losses: 0, trades: [] };
  let state = 'HUNTING'; // 'HUNTING' | 'SIGNAL_ACTIVE' | 'WAITING_FOR_TREND_BREAK'
  let activeBet = null;

  for (let i = 0; i < periods.length; i++) {
    // Resolve active bet
    if (activeBet && periods[i].period === activeBet.period) {
      const actualColor = getColor(periods[i]);
      const won = actualColor === activeBet.color;
      results.totalSignals++;
      results.trades.push({ period: periods[i].period, betColor: activeBet.color, actualColor, won });
      if (won) results.wins++; else results.losses++;
      
      activeBet = null;

      if (won) {
        // Win means the alternating trend broke (e.g. RGR -> bet R -> got R, so sequence is RGRR)
        state = 'HUNTING';
      } else {
        // Loss means the alternating trend continued (e.g. RGR -> bet R -> got G, so sequence is RGRG)
        // We must wait for the trend to break before hunting again
        state = 'WAITING_FOR_TREND_BREAK';
      }
    }

    if (activeBet) continue;

    // Check for trend break if we are waiting for one
    if (state === 'WAITING_FOR_TREND_BREAK') {
      if (i > 0 && getColor(periods[i - 1]) === getColor(periods[i])) {
        state = 'HUNTING';
      }
    }

    if (state !== 'HUNTING') continue;
    if (i < patternLength - 1) continue;

    const patternColors = [];
    for (let j = i - patternLength + 1; j <= i; j++) {
      patternColors.push(getColor(periods[j]));
    }
    if (!isAlternating(patternColors)) continue;
    if (i + 1 >= periods.length) continue;

    const betColor = patternColors[patternColors.length - 1];
    const nextPeriod = periods[i + 1].period;
    activeBet = { color: betColor, period: nextPeriod };
    state = 'SIGNAL_ACTIVE';
  }

  results.winRate = results.totalSignals > 0 ? ((results.wins / results.totalSignals) * 100).toFixed(1) : '0.0';
  return results;
}

// ============ MAIN ============
async function main() {
  const categories = ['P', 'S', 'B', 'E'];
  const categoryNames = { P: 'Parity', S: 'Sapre', B: 'Bcone', E: 'Emerd' };

  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('  📊 BACKTEST: Direct Strategy vs Wait for Trend End Strategy');
  console.log('═══════════════════════════════════════════════════════════════════════════\n');

  const totals = {
    direct: { signals: 0, wins: 0, losses: 0 },
    trendEnd: { signals: 0, wins: 0, losses: 0 }
  };

  for (const cat of categories) {
    const data = await fetchSectionData(cat);
    if (!data || !data.periods || data.periods.length === 0) {
      console.log(`  ⚠️ No data for ${categoryNames[cat]}`);
      continue;
    }

    const periods = data.periods;

    const directRes = backtestDirect(periods, 3);
    const trendEndRes = backtestWaitTrendEnd(periods, 3);

    totals.direct.signals += directRes.totalSignals;
    totals.direct.wins += directRes.wins;
    totals.direct.losses += directRes.losses;

    totals.trendEnd.signals += trendEndRes.totalSignals;
    totals.trendEnd.wins += trendEndRes.wins;
    totals.trendEnd.losses += trendEndRes.losses;

    console.log(`━━━ ${categoryNames[cat]} (${periods.length} periods) ━━━`);
    console.log(`  ┌────────────────────────────────────────────────────────┐`);
    console.log(`  │              │    Direct Strategy   │  Wait Trend End  │`);
    console.log(`  ├────────────────────────────────────────────────────────┤`);
    console.log(`  │  Signals     │ ${String(directRes.totalSignals).padStart(20)} │ ${String(trendEndRes.totalSignals).padStart(16)} │`);
    console.log(`  │  Wins        │ ${String(directRes.wins).padStart(20)} │ ${String(trendEndRes.wins).padStart(16)} │`);
    console.log(`  │  Losses      │ ${String(directRes.losses).padStart(20)} │ ${String(trendEndRes.losses).padStart(16)} │`);
    console.log(`  │  Win Rate    │ ${(directRes.winRate + '%').padStart(20)} │ ${(trendEndRes.winRate + '%').padStart(16)} │`);
    console.log(`  │  Net P/L     │ ${String(directRes.wins - directRes.losses).padStart(20)} │ ${String(trendEndRes.wins - trendEndRes.losses).padStart(16)} │`);
    
    // Streak analysis
    const directStreaks = analyzeConsecutiveLosses(directRes.trades);
    const trendEndStreaks = analyzeConsecutiveLosses(trendEndRes.trades);
    console.log(`  │  Max Loss Stk│ ${String(directStreaks.maxStreak).padStart(20)} │ ${String(trendEndStreaks.maxStreak).padStart(16)} │`);
    console.log(`  └────────────────────────────────────────────────────────┘\n`);
  }

  // Combined totals
  const directRate = totals.direct.signals > 0 ? ((totals.direct.wins / totals.direct.signals) * 100).toFixed(1) : '0.0';
  const trendEndRate = totals.trendEnd.signals > 0 ? ((totals.trendEnd.wins / totals.trendEnd.signals) * 100).toFixed(1) : '0.0';

  // Combined trades streak analysis
  let maxDirectStreak = 0;
  let maxTrendEndStreak = 0;
  const combDirectStreakFreq = {};
  const combTrendEndStreakFreq = {};

  for (const cat of categories) {
    const data = await fetchSectionData(cat);
    if (data && data.periods) {
      const directTrades = backtestDirect(data.periods, 3).trades;
      const trendEndTrades = backtestWaitTrendEnd(data.periods, 3).trades;

      const directStreaks = analyzeConsecutiveLosses(directTrades);
      const trendEndStreaks = analyzeConsecutiveLosses(trendEndTrades);

      if (directStreaks.maxStreak > maxDirectStreak) maxDirectStreak = directStreaks.maxStreak;
      if (trendEndStreaks.maxStreak > maxTrendEndStreak) maxTrendEndStreak = trendEndStreaks.maxStreak;

      // Accumulate frequencies
      for (const [streakLen, count] of Object.entries(directStreaks.streakFreq)) {
        combDirectStreakFreq[streakLen] = (combDirectStreakFreq[streakLen] || 0) + count;
      }
      for (const [streakLen, count] of Object.entries(trendEndStreaks.streakFreq)) {
        combTrendEndStreakFreq[streakLen] = (combTrendEndStreakFreq[streakLen] || 0) + count;
      }
    }
  }

  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('  📊 COMBINED SUMMARY (All 4 Categories)');
  console.log('═══════════════════════════════════════════════════════════════════════════\n');
  console.log(`  ┌────────────────────────────────────────────────────────┐`);
  console.log(`  │              │    Direct Strategy   │  Wait Trend End  │`);
  console.log(`  ├────────────────────────────────────────────────────────┤`);
  console.log(`  │  Total Sig   │ ${String(totals.direct.signals).padStart(20)} │ ${String(totals.trendEnd.signals).padStart(16)} │`);
  console.log(`  │  Total Wins  │ ${String(totals.direct.wins).padStart(20)} │ ${String(totals.trendEnd.wins).padStart(16)} │`);
  console.log(`  │  Total Loss  │ ${String(totals.direct.losses).padStart(20)} │ ${String(totals.trendEnd.losses).padStart(16)} │`);
  console.log(`  │  Win Rate    │ ${(directRate + '%').padStart(20)} │ ${(trendEndRate + '%').padStart(16)} │`);
  const directNet = totals.direct.wins - totals.direct.losses;
  const trendEndNet = totals.trendEnd.wins - totals.trendEnd.losses;
  console.log(`  │  Net P/L     │ ${(directNet >= 0 ? '+' : '') + directNet.toString().padStart(19)} │ ${(trendEndNet >= 0 ? '+' : '') + trendEndNet.toString().padStart(15)} │`);
  console.log(`  │  Max Loss Stk│ ${String(maxDirectStreak).padStart(20)} │ ${String(maxTrendEndStreak).padStart(16)} │`);
  console.log(`  └────────────────────────────────────────────────────────┘\n`);

  console.log('  🔴 Direct Strategy Loss Streaks (Summed across all categories):');
  printStreakFreq(combDirectStreakFreq);
  console.log('\n  🟢 Wait Trend End Strategy Loss Streaks (Summed across all categories):');
  printStreakFreq(combTrendEndStreakFreq);
  console.log('\n═══════════════════════════════════════════════════════════════════════════\n');
}

function analyzeConsecutiveLosses(trades) {
  let currentStreak = 0;
  let maxStreak = 0;
  const streakFreq = {};

  for (let i = 0; i < trades.length; i++) {
    if (!trades[i].won) {
      currentStreak++;
      if (currentStreak > maxStreak) maxStreak = currentStreak;
    } else {
      if (currentStreak > 0) {
        streakFreq[currentStreak] = (streakFreq[currentStreak] || 0) + 1;
      }
      currentStreak = 0;
    }
  }
  if (currentStreak > 0) {
    streakFreq[currentStreak] = (streakFreq[currentStreak] || 0) + 1;
  }
  return { maxStreak, streakFreq };
}

function printStreakFreq(freq) {
  const sorted = Object.keys(freq).map(Number).sort((a, b) => a - b);
  for (const len of sorted) {
    console.log(`     ${len} in a row: ${freq[len]} times`);
  }
}


main().catch(console.error);
