#!/usr/bin/env node
/**
 * BACKTEST: RGRG→G / GRGR→R — Wait 2 Consecutive Virtual Losses → Flat LIVE Bet
 * 
 * Strategy:
 * - Detect 4-length alternating pattern: RGRG or GRGR
 * - Bet SAME as last color (bet that alternation breaks)
 *   → RGRG → bet G   |   GRGR → bet R
 * - Track virtually until 2 consecutive losses occur
 * - After 2 consecutive virtual losses → place ONE live flat bet (₹10)
 * - If LIVE bet WINS → collect profit, reset to virtual
 * - If LIVE bet LOSES → reset to virtual, wait for 2 more consecutive virtual losses
 * 
 * Payout: 1.96x (0.96 profit per ₹1 bet, 4% platform fee)
 */

const API_BASE = 'https://cooe02.in';
const SAAS_ID = 1;

const VIRTUAL_LOSS_THRESHOLD = 2;   // need 2 consecutive virtual losses
const BET_AMOUNT = 10;              // flat bet
const WIN_MULTIPLIER = 0.96;        // profit = bet * 0.96

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

function runBacktest(periods) {
  let virtualLosses = 0;     // consecutive virtual losses counter
  let goLiveNext = false;    // flag: next signal should be a LIVE bet
  let activeBet = null;

  // Results
  const liveTrades = [];
  let totalPNL = 0;
  let totalVirtualSignals = 0;
  let totalVirtualWins = 0;
  let totalVirtualLosses = 0;
  let entryCount = 0;        // how many times we went live (after 2 losses)

  for (let i = 0; i < periods.length; i++) {
    // ── Resolve active bet ──
    if (activeBet && periods[i].period === activeBet.period) {
      const actualColor = getColor(periods[i]);
      const won = actualColor === activeBet.color;

      if (activeBet.isLive) {
        // LIVE BET resolved
        const pnl = won ? BET_AMOUNT * WIN_MULTIPLIER : -BET_AMOUNT;
        totalPNL += pnl;

        liveTrades.push({
          period: periods[i].period,
          trigger: activeBet.trigger,
          betColor: activeBet.color,
          actualColor,
          won,
          betAmount: BET_AMOUNT,
          pnl,
          runningPNL: totalPNL,
          entryNumber: entryCount
        });

        // Win or lose → reset to virtual, wait for 2 more consecutive losses
        virtualLosses = 0;
        goLiveNext = false;
      } else {
        // VIRTUAL BET resolved
        totalVirtualSignals++;
        if (won) {
          totalVirtualWins++;
          virtualLosses = 0;   // reset consecutive loss counter
        } else {
          totalVirtualLosses++;
          virtualLosses++;
          if (virtualLosses >= VIRTUAL_LOSS_THRESHOLD) {
            goLiveNext = true;  // next signal → LIVE
            entryCount++;
          }
        }
      }

      activeBet = null;
    }

    if (activeBet) continue;
    if (i < 3) continue;  // need at least 4 periods for RGRG pattern

    // ── Detect 4-length alternating pattern ──
    const c1 = getColor(periods[i - 3]);
    const c2 = getColor(periods[i - 2]);
    const c3 = getColor(periods[i - 1]);
    const c4 = getColor(periods[i]);

    if (!isAlternating([c1, c2, c3, c4])) continue;
    if (i + 1 >= periods.length) continue;

    // Bet SAME as last color (alternation break)
    const betColor = c4;
    const trigger = `${c1}${c2}${c3}${c4}→${betColor}`;

    activeBet = {
      color: betColor,
      period: periods[i + 1].period,
      trigger,
      isLive: goLiveNext
    };

    // If going live, reset the flag (one shot)
    if (goLiveNext) {
      goLiveNext = false;
      virtualLosses = 0;
    }
  }

  return {
    liveTrades,
    totalPNL,
    totalVirtualSignals,
    totalVirtualWins,
    totalVirtualLosses,
    entryCount
  };
}

async function main() {
  const categories = ['P', 'S', 'B', 'E'];
  const categoryNames = { P: 'Parity', S: 'Sapre', B: 'Bcone', E: 'Emerd' };

  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('  📊 RGRG→G / GRGR→R — Wait 2 Virtual Losses → Flat ₹10 Bet');
  console.log('  Bet: Same as last color (alternation break)');
  console.log('  Payout: 1.96x | Reset after every live bet (win or lose)');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  let grandPNL = 0;
  let grandLiveTrades = 0;
  let grandLiveWins = 0;
  let grandLiveLosses = 0;
  let grandEntries = 0;
  let grandVirtualSignals = 0;
  let grandVirtualWins = 0;
  let grandVirtualLosses = 0;

  for (const cat of categories) {
    const data = await fetchSectionData(cat);
    if (!data || !data.periods || data.periods.length === 0) continue;

    const result = runBacktest(data.periods);
    const liveWins = result.liveTrades.filter(t => t.won).length;
    const liveLosses = result.liveTrades.filter(t => !t.won).length;

    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`  ${categoryNames[cat]} (${cat}) — ${data.periods.length} periods`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    // Virtual stats
    console.log(`\n  👁️  Virtual Tracking:`);
    console.log(`     Total virtual signals: ${result.totalVirtualSignals}`);
    console.log(`     Virtual wins: ${result.totalVirtualWins}  |  Virtual losses: ${result.totalVirtualLosses}`);
    const vWinRate = result.totalVirtualSignals > 0
      ? (result.totalVirtualWins / result.totalVirtualSignals * 100).toFixed(1)
      : '0.0';
    console.log(`     Virtual win rate: ${vWinRate}%`);

    // Live stats
    console.log(`\n  🎯 Live Entries (after 2 consecutive virtual losses):`);
    console.log(`     Times entered live: ${result.entryCount}`);
    console.log(`     Live trades: ${result.liveTrades.length}`);
    console.log(`     Live wins: ${liveWins}  |  Live losses: ${liveLosses}`);
    const lWinRate = result.liveTrades.length > 0
      ? (liveWins / result.liveTrades.length * 100).toFixed(1)
      : '0.0';
    console.log(`     Live win rate: ${lWinRate}%`);
    console.log(`     💰 P&L: ${result.totalPNL >= 0 ? '+' : ''}₹${result.totalPNL.toFixed(1)}`);

    // Trade-by-trade
    if (result.liveTrades.length > 0) {
      console.log(`\n  📋 Live Trade Details:`);
      result.liveTrades.forEach((t, idx) => {
        const icon = t.won ? '✅' : '❌';
        const pnlStr = t.pnl >= 0 ? `+₹${t.pnl.toFixed(1)}` : `-₹${Math.abs(t.pnl).toFixed(1)}`;
        const runStr = t.runningPNL >= 0 ? `+₹${t.runningPNL.toFixed(1)}` : `-₹${Math.abs(t.runningPNL).toFixed(1)}`;
        console.log(`     ${icon} #${idx + 1} [Entry ${t.entryNumber}]  ${t.trigger} → ${t.actualColor}  ₹${t.betAmount}  ${pnlStr}  (Running: ${runStr})`);
      });
    }

    console.log();

    grandPNL += result.totalPNL;
    grandLiveTrades += result.liveTrades.length;
    grandLiveWins += liveWins;
    grandLiveLosses += liveLosses;
    grandEntries += result.entryCount;
    grandVirtualSignals += result.totalVirtualSignals;
    grandVirtualWins += result.totalVirtualWins;
    grandVirtualLosses += result.totalVirtualLosses;
  }

  // ============ OVERALL ============
  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('  📊 OVERALL SUMMARY (All 4 Sections)');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  const overallVWR = grandVirtualSignals > 0
    ? (grandVirtualWins / grandVirtualSignals * 100).toFixed(1) : '0.0';
  const overallLWR = grandLiveTrades > 0
    ? (grandLiveWins / grandLiveTrades * 100).toFixed(1) : '0.0';

  console.log(`  👁️  Virtual Signals: ${grandVirtualSignals}  (${grandVirtualWins}W / ${grandVirtualLosses}L → ${overallVWR}%)`);
  console.log(`  🎯 Live Entries: ${grandEntries}`);
  console.log(`  📊 Live Trades: ${grandLiveTrades}  (${grandLiveWins}W / ${grandLiveLosses}L → ${overallLWR}%)`);
  console.log(`\n  💰 TOTAL P&L: ${grandPNL >= 0 ? '+' : ''}₹${grandPNL.toFixed(1)}`);

  // Expectation
  if (grandLiveTrades > 0) {
    const avgPNLperTrade = grandPNL / grandLiveTrades;
    console.log(`  📈 Avg P&L per live trade: ${avgPNLperTrade >= 0 ? '+' : ''}₹${avgPNLperTrade.toFixed(2)}`);
  }

  console.log(`\n  📊 Strategy Logic:`);
  console.log(`     Pattern: RGRG→G / GRGR→R (bet same as last = alternation break)`);
  console.log(`     Entry: After ${VIRTUAL_LOSS_THRESHOLD} consecutive virtual losses`);
  console.log(`     Bet: Flat ₹${BET_AMOUNT}`);
  console.log(`     Exit: Reset to virtual after every live bet (win or lose)`);

  console.log('\n═══════════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
