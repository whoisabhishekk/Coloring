#!/usr/bin/env node
/**
 * BACKTEST: Compare WITH vs WITHOUT "1 loss wait" system
 * For both 4-length (RGRG) and 3-length (RGR) patterns
 * 
 * WITH 1-loss: Pattern → Virtual bet → Loss hone pe trend break wait → next pattern LIVE
 * WITHOUT 1-loss: Pattern → Directly LIVE bet on same last color → repeat
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

// ============ STRATEGY: WITH 1-LOSS WAIT ============
function backtestWithLossWait(periods, patternLength) {
  const results = { totalSignals: 0, wins: 0, losses: 0, trades: [] };
  let state = 'HUNTING';
  let waitingForSignalPattern = false;
  let activeBet = null;

  for (let i = 0; i < periods.length; i++) {
    if (activeBet && periods[i].period === activeBet.period) {
      const actualColor = getColor(periods[i]);
      const won = actualColor === activeBet.color;

      if (activeBet.isVirtual) {
        if (won) {
          state = 'HUNTING';
          waitingForSignalPattern = false;
        } else {
          waitingForSignalPattern = true;
          state = 'WAITING_FOR_TREND_BREAK';
        }
      } else {
        results.totalSignals++;
        results.trades.push({ betColor: activeBet.color, actualColor, won });
        if (won) results.wins++; else results.losses++;
        state = 'HUNTING';
        waitingForSignalPattern = false;
      }
      activeBet = null;
    }

    if (activeBet) continue;

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

    if (waitingForSignalPattern) {
      activeBet = { color: betColor, period: nextPeriod, isVirtual: false };
      state = 'SIGNAL_ACTIVE';
      waitingForSignalPattern = false;
    } else {
      activeBet = { color: betColor, period: nextPeriod, isVirtual: true };
      state = 'WAITING_FOR_FIRST_LOSS';
    }
  }

  results.winRate = results.totalSignals > 0 ? ((results.wins / results.totalSignals) * 100).toFixed(1) : '0.0';
  return results;
}

// ============ STRATEGY: WITHOUT 1-LOSS WAIT (DIRECT BET) ============
function backtestDirect(periods, patternLength) {
  const results = { totalSignals: 0, wins: 0, losses: 0, trades: [] };
  let activeBet = null;

  for (let i = 0; i < periods.length; i++) {
    // Resolve active bet
    if (activeBet && periods[i].period === activeBet.period) {
      const actualColor = getColor(periods[i]);
      const won = actualColor === activeBet.color;
      results.totalSignals++;
      results.trades.push({ betColor: activeBet.color, actualColor, won });
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

// ============ MAIN ============
async function main() {
  const categories = ['P', 'S', 'B', 'E'];
  const categoryNames = { P: 'Parity', S: 'Sapre', B: 'Bcone', E: 'Emerd' };

  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('  📊 BACKTEST: With 1-Loss Wait  vs  Without 1-Loss (Direct Bet)');
  console.log('═══════════════════════════════════════════════════════════════════════════\n');

  const totals = {
    s1_loss: { signals: 0, wins: 0, losses: 0 },
    s1_direct: { signals: 0, wins: 0, losses: 0 },
    s2_loss: { signals: 0, wins: 0, losses: 0 },
    s2_direct: { signals: 0, wins: 0, losses: 0 },
  };

  for (const cat of categories) {
    const data = await fetchSectionData(cat);
    if (!data || !data.periods || data.periods.length === 0) {
      console.log(`  ⚠️ No data for ${categoryNames[cat]}`);
      continue;
    }

    const periods = data.periods;

    // 4-length pattern
    const s1_loss = backtestWithLossWait(periods, 4);
    const s1_direct = backtestDirect(periods, 4);

    // 3-length pattern
    const s2_loss = backtestWithLossWait(periods, 3);
    const s2_direct = backtestDirect(periods, 3);

    totals.s1_loss.signals += s1_loss.totalSignals; totals.s1_loss.wins += s1_loss.wins; totals.s1_loss.losses += s1_loss.losses;
    totals.s1_direct.signals += s1_direct.totalSignals; totals.s1_direct.wins += s1_direct.wins; totals.s1_direct.losses += s1_direct.losses;
    totals.s2_loss.signals += s2_loss.totalSignals; totals.s2_loss.wins += s2_loss.wins; totals.s2_loss.losses += s2_loss.losses;
    totals.s2_direct.signals += s2_direct.totalSignals; totals.s2_direct.wins += s2_direct.wins; totals.s2_direct.losses += s2_direct.losses;

    console.log(`\n━━━ ${categoryNames[cat]} (${periods.length} periods) ━━━`);
    console.log(`  ┌──────────────────────────────────────────────────────────────────────┐`);
    console.log(`  │              │ RGRG + 1Loss │ RGRG Direct │ RGR + 1Loss │ RGR Direct │`);
    console.log(`  ├──────────────────────────────────────────────────────────────────────┤`);
    console.log(`  │  Signals     │ ${String(s1_loss.totalSignals).padStart(6)}       │ ${String(s1_direct.totalSignals).padStart(6)}      │ ${String(s2_loss.totalSignals).padStart(6)}      │ ${String(s2_direct.totalSignals).padStart(6)}     │`);
    console.log(`  │  Wins        │ ${String(s1_loss.wins).padStart(6)}       │ ${String(s1_direct.wins).padStart(6)}      │ ${String(s2_loss.wins).padStart(6)}      │ ${String(s2_direct.wins).padStart(6)}     │`);
    console.log(`  │  Losses      │ ${String(s1_loss.losses).padStart(6)}       │ ${String(s1_direct.losses).padStart(6)}      │ ${String(s2_loss.losses).padStart(6)}      │ ${String(s2_direct.losses).padStart(6)}     │`);
    console.log(`  │  Win Rate    │ ${(s1_loss.winRate + '%').padStart(6)}       │ ${(s1_direct.winRate + '%').padStart(6)}      │ ${(s2_loss.winRate + '%').padStart(6)}      │ ${(s2_direct.winRate + '%').padStart(6)}     │`);
    console.log(`  └──────────────────────────────────────────────────────────────────────┘`);
  }

  // Overall
  const rates = {
    s1_loss: totals.s1_loss.signals > 0 ? ((totals.s1_loss.wins / totals.s1_loss.signals) * 100).toFixed(1) : '0.0',
    s1_direct: totals.s1_direct.signals > 0 ? ((totals.s1_direct.wins / totals.s1_direct.signals) * 100).toFixed(1) : '0.0',
    s2_loss: totals.s2_loss.signals > 0 ? ((totals.s2_loss.wins / totals.s2_loss.signals) * 100).toFixed(1) : '0.0',
    s2_direct: totals.s2_direct.signals > 0 ? ((totals.s2_direct.wins / totals.s2_direct.signals) * 100).toFixed(1) : '0.0',
  };

  console.log('\n\n═══════════════════════════════════════════════════════════════════════════');
  console.log('  📊 OVERALL SUMMARY (All 4 Categories Combined)');
  console.log('═══════════════════════════════════════════════════════════════════════════\n');

  console.log(`  ┌──────────────────────────────────────────────────────────────────────┐`);
  console.log(`  │              │ RGRG + 1Loss │ RGRG Direct │ RGR + 1Loss │ RGR Direct │`);
  console.log(`  ├──────────────────────────────────────────────────────────────────────┤`);
  console.log(`  │  Pattern     │   4-length   │  4-length   │  3-length   │  3-length  │`);
  console.log(`  │  1-Loss Wait │     YES      │     NO      │     YES     │     NO     │`);
  console.log(`  ├──────────────────────────────────────────────────────────────────────┤`);
  console.log(`  │  Signals     │ ${String(totals.s1_loss.signals).padStart(6)}       │ ${String(totals.s1_direct.signals).padStart(6)}      │ ${String(totals.s2_loss.signals).padStart(6)}      │ ${String(totals.s2_direct.signals).padStart(6)}     │`);
  console.log(`  │  Wins        │ ${String(totals.s1_loss.wins).padStart(6)}       │ ${String(totals.s1_direct.wins).padStart(6)}      │ ${String(totals.s2_loss.wins).padStart(6)}      │ ${String(totals.s2_direct.wins).padStart(6)}     │`);
  console.log(`  │  Losses      │ ${String(totals.s1_loss.losses).padStart(6)}       │ ${String(totals.s1_direct.losses).padStart(6)}      │ ${String(totals.s2_loss.losses).padStart(6)}      │ ${String(totals.s2_direct.losses).padStart(6)}     │`);
  console.log(`  │  Win Rate    │ ${(rates.s1_loss + '%').padStart(6)}       │ ${(rates.s1_direct + '%').padStart(6)}      │ ${(rates.s2_loss + '%').padStart(6)}      │ ${(rates.s2_direct + '%').padStart(6)}     │`);

  const net = {
    s1_loss: totals.s1_loss.wins - totals.s1_loss.losses,
    s1_direct: totals.s1_direct.wins - totals.s1_direct.losses,
    s2_loss: totals.s2_loss.wins - totals.s2_loss.losses,
    s2_direct: totals.s2_direct.wins - totals.s2_direct.losses,
  };
  const fmtNet = (n) => (n >= 0 ? '+' + n : String(n));

  console.log(`  │  Net P/L     │ ${fmtNet(net.s1_loss).padStart(6)}       │ ${fmtNet(net.s1_direct).padStart(6)}      │ ${fmtNet(net.s2_loss).padStart(6)}      │ ${fmtNet(net.s2_direct).padStart(6)}     │`);
  console.log(`  └──────────────────────────────────────────────────────────────────────┘`);

  // Find winner
  const all = [
    { name: 'RGRG + 1-Loss Wait', rate: parseFloat(rates.s1_loss), net: net.s1_loss, signals: totals.s1_loss.signals },
    { name: 'RGRG Direct', rate: parseFloat(rates.s1_direct), net: net.s1_direct, signals: totals.s1_direct.signals },
    { name: 'RGR + 1-Loss Wait', rate: parseFloat(rates.s2_loss), net: net.s2_loss, signals: totals.s2_loss.signals },
    { name: 'RGR Direct', rate: parseFloat(rates.s2_direct), net: net.s2_direct, signals: totals.s2_direct.signals },
  ];

  all.sort((a, b) => b.rate - a.rate || b.net - a.net);

  console.log('\n  🏆 RANKING (by Win Rate):');
  all.forEach((s, i) => {
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '  ';
    console.log(`     ${medal} ${s.name.padEnd(22)} → ${s.rate}% win rate, ${s.signals} signals, Net ${fmtNet(s.net)}`);
  });

  console.log('\n═══════════════════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
