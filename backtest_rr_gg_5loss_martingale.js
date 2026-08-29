#!/usr/bin/env node
/**
 * BACKTEST: RR→G / GG→R — Wait 5 Virtual Losses → 5-Level Martingale
 * 
 * Strategy:
 *   - Detect 2 consecutive same colors: RR or GG
 *   - Bet OPPOSITE color (trend reversal)
 *   - Track virtually until 5 consecutive losses
 *   - After 5 virtual losses → go LIVE with 5-step martingale
 *   - Each martingale bet recovers all previous losses + base profit
 *   - If any martingale bet wins → profit, reset to virtual
 *   - If all 5 martingale bets lose → take loss, reset to virtual
 * 
 * Payout: 1.96x (0.96 profit per ₹1 bet, 4% platform fee)
 */

const API_BASE = 'https://cooe02.in';
const SAAS_ID = 1;

const BASE_BET = 10;
const WIN_MULTIPLIER = 0.96;  // profit = bet * 0.96
const VIRTUAL_LOSS_THRESHOLD = 5;  // wait for 5 consecutive virtual losses
const MARTINGALE_LEVELS = 5;       // 5 live martingale bets

// Calculate martingale bet amounts (each bet recovers all prior losses + base profit)
function calcMartingaleBets(baseBet, levels) {
  const bets = [];
  let totalLost = 0;
  for (let i = 0; i < levels; i++) {
    // Bet enough so that win covers all losses so far + base profit
    const needed = totalLost + baseBet;  // want to recover losses + make baseBet profit
    const bet = Math.ceil(needed / WIN_MULTIPLIER);
    bets.push(bet);
    totalLost += bet;
  }
  return bets;
}

const MARTINGALE_BETS = calcMartingaleBets(BASE_BET, MARTINGALE_LEVELS);
const TOTAL_MARTINGALE_RISK = MARTINGALE_BETS.reduce((a, b) => a + b, 0);

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

function runBacktest(periods) {
  let virtualConsecLosses = 0;
  let isLive = false;
  let martingaleLevel = 0;
  let martingaleLostSoFar = 0;  // accumulated loss in current martingale round

  const liveTrades = [];
  let totalPNL = 0;
  let totalVirtualSignals = 0;
  let totalVirtualWins = 0;
  let totalVirtualLosses = 0;
  let liveEntries = 0;          // how many times we entered live (after 5 losses)
  let martingaleWins = 0;       // rounds won (recovered)
  let martingaleBusts = 0;      // rounds where all 5 levels lost

  // Track consecutive live losses for reporting
  let maxLiveConsecLosses = 0;
  let currentLiveConsecLosses = 0;

  for (let i = 0; i < periods.length; i++) {
    if (i < 1) continue;

    const c1 = getColor(periods[i - 1]);
    const c2 = getColor(periods[i]);

    // Only trigger on 2 consecutive same colors
    if (c1 !== c2) continue;
    if (i + 1 >= periods.length) continue;

    const betColor = c2 === 'R' ? 'G' : 'R';
    const pattern = `${c1}${c2}`;
    const actualColor = getColor(periods[i + 1]);
    const won = actualColor === betColor;

    if (!isLive) {
      // ── VIRTUAL MODE ──
      totalVirtualSignals++;
      if (won) {
        totalVirtualWins++;
        virtualConsecLosses = 0;
      } else {
        totalVirtualLosses++;
        virtualConsecLosses++;

        if (virtualConsecLosses >= VIRTUAL_LOSS_THRESHOLD) {
          // Switch to LIVE martingale on next signal
          isLive = true;
          martingaleLevel = 0;
          martingaleLostSoFar = 0;
          liveEntries++;
          virtualConsecLosses = 0;
        }
      }
    } else {
      // ── LIVE MARTINGALE MODE ──
      const betAmount = MARTINGALE_BETS[martingaleLevel];
      const pnl = won ? (betAmount * WIN_MULTIPLIER) - martingaleLostSoFar : -betAmount;

      if (won) {
        // Martingale WIN — recovered all losses + profit
        const netProfit = (betAmount * WIN_MULTIPLIER) - martingaleLostSoFar;
        totalPNL += netProfit;
        liveTrades.push({
          period: periods[i + 1].period,
          pattern,
          betColor,
          actualColor,
          won: true,
          betAmount,
          level: martingaleLevel + 1,
          pnl: netProfit,
          runningPNL: totalPNL,
          entry: liveEntries,
          type: `M${martingaleLevel + 1} WIN`
        });

        currentLiveConsecLosses = 0;
        martingaleWins++;
        // Reset to virtual
        isLive = false;
        martingaleLevel = 0;
        martingaleLostSoFar = 0;
      } else {
        // Martingale LOSS
        martingaleLostSoFar += betAmount;
        martingaleLevel++;
        currentLiveConsecLosses++;
        if (currentLiveConsecLosses > maxLiveConsecLosses) {
          maxLiveConsecLosses = currentLiveConsecLosses;
        }

        if (martingaleLevel >= MARTINGALE_LEVELS) {
          // All 5 levels BUSTED
          totalPNL -= martingaleLostSoFar;
          liveTrades.push({
            period: periods[i + 1].period,
            pattern,
            betColor,
            actualColor,
            won: false,
            betAmount,
            level: MARTINGALE_LEVELS,
            pnl: -martingaleLostSoFar,
            runningPNL: totalPNL,
            entry: liveEntries,
            type: `M${MARTINGALE_LEVELS} BUST`
          });

          martingaleBusts++;
          // Reset to virtual
          isLive = false;
          martingaleLevel = 0;
          martingaleLostSoFar = 0;
        } else {
          liveTrades.push({
            period: periods[i + 1].period,
            pattern,
            betColor,
            actualColor,
            won: false,
            betAmount,
            level: martingaleLevel,  // level before increment already happened
            pnl: 0,  // not settled yet, still in martingale
            runningPNL: totalPNL,
            entry: liveEntries,
            type: `M${martingaleLevel} LOSS → next`
          });
        }
      }
    }
  }

  return {
    liveTrades,
    totalPNL,
    totalVirtualSignals,
    totalVirtualWins,
    totalVirtualLosses,
    liveEntries,
    martingaleWins,
    martingaleBusts,
    maxLiveConsecLosses
  };
}

async function main() {
  const categories = ['P', 'S', 'B', 'E'];
  const categoryNames = { P: 'Parity', S: 'Sapre', B: 'Bcone', E: 'Emerd' };

  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('  📊 BACKTEST: RR→G / GG→R — 5 Virtual Losses → 5-Level Martingale');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(`  Pattern: RR → bet G  |  GG → bet R`);
  console.log(`  Entry:   After ${VIRTUAL_LOSS_THRESHOLD} consecutive virtual losses`);
  console.log(`  Live:    ${MARTINGALE_LEVELS}-level martingale (recovery)`);
  console.log(`  Bets:    ${MARTINGALE_BETS.map(b => '₹' + b).join(' → ')}`);
  console.log(`  Max Risk: ₹${TOTAL_MARTINGALE_RISK} per round (if all ${MARTINGALE_LEVELS} lose)`);
  console.log(`  Win Profit: ~₹${BASE_BET} per round (recovers all losses + ₹${BASE_BET})`);
  console.log(`  Payout:  1.96x`);
  console.log('═══════════════════════════════════════════════════════════════════\n');

  let grandPNL = 0;
  let grandEntries = 0;
  let grandMartWins = 0;
  let grandMartBusts = 0;
  let grandMaxConsec = 0;
  const allResults = [];

  for (const cat of categories) {
    const data = await fetchSectionData(cat);
    if (!data || !data.periods || data.periods.length === 0) {
      console.log(`  ⚠️ No data for ${categoryNames[cat]}`);
      continue;
    }

    const periods = data.periods;
    const result = runBacktest(periods);

    allResults.push({ cat, name: categoryNames[cat], periods: periods.length, result });

    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`  📌 ${categoryNames[cat]} (${cat}) — ${periods.length} periods`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    // Virtual stats
    console.log(`\n  👁️  Virtual Tracking:`);
    console.log(`     Signals: ${result.totalVirtualSignals}  (${result.totalVirtualWins}W / ${result.totalVirtualLosses}L)`);
    const vWR = result.totalVirtualSignals > 0 
      ? (result.totalVirtualWins / result.totalVirtualSignals * 100).toFixed(1) : '0.0';
    console.log(`     Win rate: ${vWR}%`);

    // Live martingale stats
    console.log(`\n  🎯 Live Martingale Rounds:`);
    console.log(`     Times entered live: ${result.liveEntries}`);
    console.log(`     Rounds WON (recovered): ${result.martingaleWins} ✅`);
    console.log(`     Rounds BUSTED (all ${MARTINGALE_LEVELS} lost): ${result.martingaleBusts} ❌`);
    const roundWR = result.liveEntries > 0 
      ? (result.martingaleWins / result.liveEntries * 100).toFixed(1) : '0.0';
    console.log(`     Round win rate: ${roundWR}%`);
    console.log(`     💰 P&L: ${result.totalPNL >= 0 ? '+' : ''}₹${result.totalPNL.toFixed(1)}`);

    // Trade details
    if (result.liveTrades.length > 0) {
      console.log(`\n  📋 Live Trade Details:`);
      result.liveTrades.forEach((t, idx) => {
        const icon = t.won ? '✅' : (t.type.includes('BUST') ? '💥' : '🔄');
        const pnlStr = t.pnl > 0 ? `+₹${t.pnl.toFixed(1)}` 
                      : t.pnl < 0 ? `-₹${Math.abs(t.pnl).toFixed(1)}`
                      : `→ M${t.level + 1}`;
        const runStr = t.runningPNL >= 0 ? `+₹${t.runningPNL.toFixed(1)}` : `-₹${Math.abs(t.runningPNL).toFixed(1)}`;
        console.log(`     ${icon} [Entry ${t.entry}] ${t.type.padEnd(14)} ${t.pattern}→${t.betColor} Got:${t.actualColor}  ₹${t.betAmount}  ${pnlStr}  (Total: ${runStr})`);
      });
    }

    console.log();
    grandPNL += result.totalPNL;
    grandEntries += result.liveEntries;
    grandMartWins += result.martingaleWins;
    grandMartBusts += result.martingaleBusts;
    if (result.maxLiveConsecLosses > grandMaxConsec) grandMaxConsec = result.maxLiveConsecLosses;
  }

  // ═══ OVERALL ═══
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('  📊 OVERALL SUMMARY (All 4 Sections)');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  const overallRoundWR = grandEntries > 0 
    ? (grandMartWins / grandEntries * 100).toFixed(1) : '0.0';

  console.log(`  🎯 Total live entries: ${grandEntries}`);
  console.log(`  ✅ Rounds WON: ${grandMartWins}`);
  console.log(`  ❌ Rounds BUSTED: ${grandMartBusts}`);
  console.log(`  📊 Round win rate: ${overallRoundWR}%`);
  console.log(`  💰 TOTAL P&L: ${grandPNL >= 0 ? '+' : ''}₹${grandPNL.toFixed(1)}`);

  if (grandEntries > 0) {
    const avgPNL = grandPNL / grandEntries;
    console.log(`  📈 Avg P&L per round: ${avgPNL >= 0 ? '+' : ''}₹${avgPNL.toFixed(2)}`);
  }

  // Per-section table
  console.log(`\n  ┌────────────┬─────────┬──────┬───────┬──────────┬────────────┐`);
  console.log(`  │ Section    │ Entries │ Wins │ Busts │ Win Rate │   P&L      │`);
  console.log(`  ├────────────┼─────────┼──────┼───────┼──────────┼────────────┤`);
  for (const r of allResults) {
    const wr = r.result.liveEntries > 0 
      ? (r.result.martingaleWins / r.result.liveEntries * 100).toFixed(1) + '%' : '0.0%';
    const pnl = `${r.result.totalPNL >= 0 ? '+' : ''}₹${r.result.totalPNL.toFixed(1)}`;
    console.log(`  │ ${r.name.padEnd(10)} │ ${String(r.result.liveEntries).padStart(7)} │ ${String(r.result.martingaleWins).padStart(4)} │ ${String(r.result.martingaleBusts).padStart(5)} │ ${wr.padStart(8)} │ ${pnl.padStart(10)} │`);
  }
  console.log(`  └────────────┴─────────┴──────┴───────┴──────────┴────────────┘`);

  // Risk analysis
  console.log(`\n  ⚠️  Risk Analysis:`);
  console.log(`     Per-round win profit: ~₹${BASE_BET}`);
  console.log(`     Per-round bust loss:  ₹${TOTAL_MARTINGALE_RISK}`);
  console.log(`     Risk/Reward ratio:    1:${(TOTAL_MARTINGALE_RISK / BASE_BET).toFixed(0)} (need ${((TOTAL_MARTINGALE_RISK / (TOTAL_MARTINGALE_RISK + BASE_BET)) * 100).toFixed(1)}% round win rate to break even)`);
  const breakEvenWR = (TOTAL_MARTINGALE_RISK / (TOTAL_MARTINGALE_RISK + BASE_BET) * 100).toFixed(1);
  console.log(`     Actual round win rate: ${overallRoundWR}% ${parseFloat(overallRoundWR) > parseFloat(breakEvenWR) ? '✅ ABOVE breakeven' : '❌ BELOW breakeven'}`);

  console.log('\n═══════════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
