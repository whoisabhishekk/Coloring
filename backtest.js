#!/usr/bin/env node
/**
 * BACKTEST: Compare 4-length (RGRG) vs 3-length (RGR) pattern strategies
 * 
 * Both strategies follow the same logic:
 * 1. Wait for alternating pattern → virtual bet on last same color
 * 2. If virtual bet loses → wait for trend break (2 same colors)
 * 3. After break → wait for next pattern → LIVE signal on last same color
 * 4. After LIVE resolves (win/loss) → repeat from step 1
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

function isAlternating(colors) {
  for (let i = 1; i < colors.length; i++) {
    if (colors[i] === colors[i - 1]) return false;
  }
  return true;
}

// ============ BACKTEST ENGINE ============
function runBacktest(periods, patternLength) {
  const results = {
    patternLength,
    totalSignals: 0,
    wins: 0,
    losses: 0,
    winRate: 0,
    trades: []  // { period, betColor, actualColor, won }
  };

  // State machine
  let state = 'HUNTING';
  let waitingForSignalPattern = false;
  let activeBet = null; // { color, period, isVirtual }

  for (let i = 0; i < periods.length; i++) {
    // Resolve active bet
    if (activeBet && periods[i].period === activeBet.period) {
      const actualColor = getColor(periods[i]);
      const won = actualColor === activeBet.color;

      if (activeBet.isVirtual) {
        if (won) {
          // Virtual win → trend broke, back to hunting
          state = 'HUNTING';
          waitingForSignalPattern = false;
        } else {
          // Virtual loss → 1 loss done, wait for trend break
          waitingForSignalPattern = true;
          state = 'WAITING_FOR_TREND_BREAK';
        }
      } else {
        // LIVE bet resolved
        results.totalSignals++;
        results.trades.push({
          period: periods[i].period,
          betColor: activeBet.color,
          actualColor,
          won
        });

        if (won) {
          results.wins++;
        } else {
          results.losses++;
        }

        // Reset to step 1
        state = 'HUNTING';
        waitingForSignalPattern = false;
      }

      activeBet = null;
    }

    if (activeBet) continue;

    // WAITING_FOR_TREND_BREAK: check for 2 same colors
    if (state === 'WAITING_FOR_TREND_BREAK') {
      if (i > 0 && getColor(periods[i - 1]) === getColor(periods[i])) {
        state = 'HUNTING';
        // Keep waitingForSignalPattern = true
      }
    }

    // HUNTING: look for pattern
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

    if (waitingForSignalPattern) {
      // Step 3: LIVE signal
      activeBet = { color: betColor, period: nextPeriod, isVirtual: false };
      state = 'SIGNAL_ACTIVE';
      waitingForSignalPattern = false;
    } else {
      // Step 1: Virtual bet
      activeBet = { color: betColor, period: nextPeriod, isVirtual: true };
      state = 'WAITING_FOR_FIRST_LOSS';
    }
  }

  results.winRate = results.totalSignals > 0
    ? ((results.wins / results.totalSignals) * 100).toFixed(1)
    : '0.0';

  return results;
}

// ============ MAIN ============
async function main() {
  const categories = ['P', 'S', 'B', 'E'];
  const categoryNames = { P: 'Parity', S: 'Sapre', B: 'Bcone', E: 'Emerd' };

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  📊 BACKTEST: Strategy 1 (RGRG/4) vs Strategy 2 (RGR/3)');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const allResults = { strategy1: [], strategy2: [] };

  for (const cat of categories) {
    console.log(`\n━━━ Fetching ${categoryNames[cat]} (${cat}) data... ━━━`);

    const data = await fetchSectionData(cat);
    if (!data || !data.periods || data.periods.length === 0) {
      console.log(`  ⚠️ No data for ${categoryNames[cat]}`);
      continue;
    }

    const periods = data.periods;
    console.log(`  📦 ${periods.length} periods loaded\n`);

    // Run Strategy 1: 4-length pattern (RGRG/GRGR)
    const s1 = runBacktest(periods, 4);
    allResults.strategy1.push(s1);

    // Run Strategy 2: 3-length pattern (RGR/GRG)
    const s2 = runBacktest(periods, 3);
    allResults.strategy2.push(s2);

    console.log(`  ┌──────────────────────────────────────────────────────┐`);
    console.log(`  │  ${categoryNames[cat].padEnd(10)} │ Strategy 1 (RGRG) │ Strategy 2 (RGR)  │`);
    console.log(`  ├──────────────────────────────────────────────────────┤`);
    console.log(`  │  Signals   │ ${String(s1.totalSignals).padStart(8)}          │ ${String(s2.totalSignals).padStart(8)}          │`);
    console.log(`  │  Wins      │ ${String(s1.wins).padStart(8)}          │ ${String(s2.wins).padStart(8)}          │`);
    console.log(`  │  Losses    │ ${String(s1.losses).padStart(8)}          │ ${String(s2.losses).padStart(8)}          │`);
    console.log(`  │  Win Rate  │ ${(s1.winRate + '%').padStart(8)}          │ ${(s2.winRate + '%').padStart(8)}          │`);
    console.log(`  └──────────────────────────────────────────────────────┘`);
  }

  // ============ OVERALL SUMMARY ============
  const totals = {
    s1: { signals: 0, wins: 0, losses: 0 },
    s2: { signals: 0, wins: 0, losses: 0 }
  };

  allResults.strategy1.forEach(r => { totals.s1.signals += r.totalSignals; totals.s1.wins += r.wins; totals.s1.losses += r.losses; });
  allResults.strategy2.forEach(r => { totals.s2.signals += r.totalSignals; totals.s2.wins += r.wins; totals.s2.losses += r.losses; });

  const s1Rate = totals.s1.signals > 0 ? ((totals.s1.wins / totals.s1.signals) * 100).toFixed(1) : '0.0';
  const s2Rate = totals.s2.signals > 0 ? ((totals.s2.wins / totals.s2.signals) * 100).toFixed(1) : '0.0';

  console.log('\n\n═══════════════════════════════════════════════════════════════');
  console.log('  📊 OVERALL SUMMARY (All 4 Categories Combined)');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log(`  ┌──────────────────────────────────────────────────────┐`);
  console.log(`  │              │ Strategy 1 (RGRG) │ Strategy 2 (RGR)  │`);
  console.log(`  ├──────────────────────────────────────────────────────┤`);
  console.log(`  │  Pattern Len │ ${String(4).padStart(8)}          │ ${String(3).padStart(8)}          │`);
  console.log(`  │  Signals     │ ${String(totals.s1.signals).padStart(8)}          │ ${String(totals.s2.signals).padStart(8)}          │`);
  console.log(`  │  Wins        │ ${String(totals.s1.wins).padStart(8)}          │ ${String(totals.s2.wins).padStart(8)}          │`);
  console.log(`  │  Losses      │ ${String(totals.s1.losses).padStart(8)}          │ ${String(totals.s2.losses).padStart(8)}          │`);
  console.log(`  │  Win Rate    │ ${(s1Rate + '%').padStart(8)}          │ ${(s2Rate + '%').padStart(8)}          │`);
  console.log(`  │  Net P/L     │ ${(totals.s1.wins - totals.s1.losses >= 0 ? '+' : '') + (totals.s1.wins - totals.s1.losses)}${' '.repeat(14 - String(totals.s1.wins - totals.s1.losses).length)}│ ${(totals.s2.wins - totals.s2.losses >= 0 ? '+' : '') + (totals.s2.wins - totals.s2.losses)}${' '.repeat(14 - String(totals.s2.wins - totals.s2.losses).length)}│`);
  console.log(`  └──────────────────────────────────────────────────────┘`);

  const winner = parseFloat(s1Rate) >= parseFloat(s2Rate) ? 'Strategy 1 (RGRG/4-length)' : 'Strategy 2 (RGR/3-length)';
  console.log(`\n  🏆 WINNER: ${winner}\n`);

  // Show last 10 trades for each strategy from the last category
  const lastS1 = allResults.strategy1[allResults.strategy1.length - 1];
  const lastS2 = allResults.strategy2[allResults.strategy2.length - 1];

  if (lastS1 && lastS1.trades.length > 0) {
    console.log('\n  📋 Strategy 1 - Last 10 LIVE trades (last category):');
    lastS1.trades.slice(-10).forEach(t => {
      const icon = t.won ? '✅' : '❌';
      console.log(`     ${icon} Bet: ${t.betColor === 'G' ? 'GREEN' : 'RED'}, Got: ${t.actualColor === 'G' ? 'GREEN' : 'RED'}`);
    });
  }

  if (lastS2 && lastS2.trades.length > 0) {
    console.log('\n  📋 Strategy 2 - Last 10 LIVE trades (last category):');
    lastS2.trades.slice(-10).forEach(t => {
      const icon = t.won ? '✅' : '❌';
      console.log(`     ${icon} Bet: ${t.betColor === 'G' ? 'GREEN' : 'RED'}, Got: ${t.actualColor === 'G' ? 'GREEN' : 'RED'}`);
    });
  }

  console.log('\n═══════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
