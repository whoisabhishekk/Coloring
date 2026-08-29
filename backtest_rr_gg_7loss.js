#!/usr/bin/env node
/**
 * BACKTEST: RGR→G + GRG→R — Wait 3 Virtual Losses → Martingale ₹10/30/90/270
 * 
 * Strategy:
 * - Detect RGR → bet G, detect GRG → bet R (alternation continues)
 * - Track virtually until 3 consecutive losses
 * - Then go LIVE with bet ladder: ₹10 → ₹30 → ₹90 → ₹270
 * - On any WIN → collect profit, reset to virtual
 * - If all 4 LIVE bets lose → full bust for that cycle, reset to virtual
 * 
 * Payout: 1.96x (0.96 profit per ₹1 bet, 4% platform fee)
 */

const API_BASE = 'https://cooe02.in';
const SAAS_ID = 1;

const VIRTUAL_LOSS_THRESHOLD = 3;
const BET_LADDER = [10, 30, 90, 270];
const WIN_MULTIPLIER = 0.96;  // profit = bet * 0.96

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
function opposite(c) { return c === 'G' ? 'R' : 'G'; }
function isAlternating(colors) {
  for (let i = 1; i < colors.length; i++) {
    if (colors[i] === colors[i - 1]) return false;
  }
  return true;
}

function runBacktest(periods) {
  // State
  let virtualLosses = 0;        // consecutive virtual losses
  let liveStep = -1;            // -1 = virtual mode, 0-3 = which step in the bet ladder
  let activeBet = null;
  let cyclePNL = 0;             // P&L within current live cycle

  // Results
  const cycles = [];            // each completed live cycle
  let currentCycleTrades = [];
  let totalPNL = 0;

  for (let i = 0; i < periods.length; i++) {
    // Resolve active bet
    if (activeBet && periods[i].period === activeBet.period) {
      const actualColor = getColor(periods[i]);
      const won = actualColor === activeBet.color;

      if (activeBet.isLive) {
        const betAmount = BET_LADDER[liveStep];
        const pnl = won ? betAmount * WIN_MULTIPLIER : -betAmount;
        cyclePNL += pnl;
        totalPNL += pnl;

        currentCycleTrades.push({
          period: periods[i].period,
          trigger: activeBet.trigger,
          betColor: activeBet.color,
          actualColor,
          won,
          betAmount,
          pnl,
          runningPNL: totalPNL
        });

        if (won) {
          // WIN → cycle complete, reset to virtual
          cycles.push({
            trades: [...currentCycleTrades],
            cyclePNL,
            result: 'WIN',
            wonAtStep: liveStep + 1
          });
          currentCycleTrades = [];
          cyclePNL = 0;
          virtualLosses = 0;
          liveStep = -1;
        } else {
          // LOSS
          liveStep++;
          if (liveStep >= BET_LADDER.length) {
            // All 4 bets lost — bust cycle
            cycles.push({
              trades: [...currentCycleTrades],
              cyclePNL,
              result: 'BUST'
            });
            currentCycleTrades = [];
            cyclePNL = 0;
            virtualLosses = 0;
            liveStep = -1;
          }
          // else: stay live, next signal at higher bet
        }
      } else {
        // Virtual bet resolved
        if (won) {
          virtualLosses = 0;
        } else {
          virtualLosses++;
          if (virtualLosses >= VIRTUAL_LOSS_THRESHOLD) {
            liveStep = 0;  // go live on next signal
          }
        }
      }

      activeBet = null;
    }

    if (activeBet) continue;
    if (i < 2) continue;

    const c1 = getColor(periods[i - 2]);
    const c2 = getColor(periods[i - 1]);
    const c3 = getColor(periods[i]);

    if (!isAlternating([c1, c2, c3])) continue;
    if (i + 1 >= periods.length) continue;

    const betColor = opposite(c3);
    const trigger = `${c1}${c2}${c3}→${betColor}`;

    activeBet = {
      color: betColor,
      period: periods[i + 1].period,
      trigger,
      isLive: liveStep >= 0
    };
  }

  return { cycles, totalPNL };
}

async function main() {
  const categories = ['P', 'S', 'B', 'E'];
  const categoryNames = { P: 'Parity', S: 'Sapre', B: 'Bcone', E: 'Emerd' };

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  📊 RGR→G / GRG→R — Wait 3 Losses → Martingale ₹10/30/90/270');
  console.log('  Payout: 1.96x (0.96 profit) | Reset after win or 4 losses');
  console.log('═══════════════════════════════════════════════════════════════\n');

  let grandTotalPNL = 0;
  let grandCycles = 0;
  let grandWins = 0;
  let grandBusts = 0;
  let grandLiveTrades = 0;

  for (const cat of categories) {
    const data = await fetchSectionData(cat);
    if (!data || !data.periods || data.periods.length === 0) continue;

    const { cycles, totalPNL } = runBacktest(data.periods);

    const winCycles = cycles.filter(c => c.result === 'WIN');
    const bustCycles = cycles.filter(c => c.result === 'BUST');
    const totalLiveTrades = cycles.reduce((sum, c) => sum + c.trades.length, 0);

    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`  ${categoryNames[cat]} (${cat}) — ${data.periods.length} periods`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    if (cycles.length === 0) {
      console.log(`  ⚠️ No 3-loss streaks occurred → 0 LIVE cycles\n`);
      continue;
    }

    console.log(`  🎯 Live Cycles: ${cycles.length}  (${winCycles.length} won, ${bustCycles.length} busted)`);
    console.log(`  📊 Live Trades: ${totalLiveTrades}`);
    console.log(`  💰 Total P&L: ${totalPNL >= 0 ? '+' : ''}₹${totalPNL.toFixed(1)}`);

    // Win step distribution
    const stepDist = {};
    for (const c of winCycles) {
      stepDist[c.wonAtStep] = (stepDist[c.wonAtStep] || 0) + 1;
    }

    if (winCycles.length > 0) {
      console.log(`\n  ✅ Wins by step:`);
      for (let s = 1; s <= BET_LADDER.length; s++) {
        if (stepDist[s]) {
          console.log(`     Step ${s} (₹${BET_LADDER[s-1]} bet): ${stepDist[s]} wins`);
        }
      }
    }

    // Show each cycle
    console.log(`\n  📋 Cycle-by-cycle breakdown:`);
    cycles.forEach((cycle, idx) => {
      const icon = cycle.result === 'WIN' ? '✅' : '💀';
      const label = cycle.result === 'WIN' ? `WIN at step ${cycle.wonAtStep}` : 'BUST (all 4 lost)';
      const pnlStr = cycle.cyclePNL >= 0 ? `+₹${cycle.cyclePNL.toFixed(1)}` : `-₹${Math.abs(cycle.cyclePNL).toFixed(1)}`;

      console.log(`\n     ${icon} Cycle #${idx + 1}: ${label} | Cycle P&L: ${pnlStr}`);
      for (const t of cycle.trades) {
        const tIcon = t.won ? '✅' : '❌';
        const tPnl = t.pnl >= 0 ? `+₹${t.pnl.toFixed(1)}` : `-₹${Math.abs(t.pnl).toFixed(1)}`;
        console.log(`        ${tIcon} ₹${t.betAmount} bet  ${t.trigger} → ${t.actualColor}  ${tPnl}  (Running: ${t.runningPNL >= 0 ? '+' : ''}₹${t.runningPNL.toFixed(1)})`);
      }
    });

    console.log();

    grandTotalPNL += totalPNL;
    grandCycles += cycles.length;
    grandWins += winCycles.length;
    grandBusts += bustCycles.length;
    grandLiveTrades += totalLiveTrades;
  }

  // ============ OVERALL ============
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  📊 OVERALL SUMMARY (All 4 Sections)');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log(`  Total Live Cycles: ${grandCycles}`);
  console.log(`  ✅ Won: ${grandWins}  |  💀 Busted: ${grandBusts}`);
  console.log(`  Cycle Win Rate: ${grandCycles > 0 ? (grandWins / grandCycles * 100).toFixed(1) : 0}%`);
  console.log(`  Total Live Trades: ${grandLiveTrades}`);
  console.log(`\n  💰 TOTAL P&L: ${grandTotalPNL >= 0 ? '+' : ''}₹${grandTotalPNL.toFixed(1)}`);

  // Risk analysis
  const maxBust = BET_LADDER.reduce((sum, b) => sum + b, 0);
  console.log(`\n  📊 Risk Analysis:`);
  console.log(`     Bet ladder: ₹${BET_LADDER.join(' → ₹')}`);
  console.log(`     Max loss per cycle (bust): ₹${maxBust}`);
  console.log(`     Win at step 1: +₹${(BET_LADDER[0] * WIN_MULTIPLIER).toFixed(1)}`);
  console.log(`     Win at step 2: +₹${(BET_LADDER[1] * WIN_MULTIPLIER - BET_LADDER[0]).toFixed(1)} (after ₹${BET_LADDER[0]} loss)`);
  console.log(`     Win at step 3: +₹${(BET_LADDER[2] * WIN_MULTIPLIER - BET_LADDER[0] - BET_LADDER[1]).toFixed(1)} (after ₹${BET_LADDER[0] + BET_LADDER[1]} loss)`);
  console.log(`     Win at step 4: +₹${(BET_LADDER[3] * WIN_MULTIPLIER - BET_LADDER[0] - BET_LADDER[1] - BET_LADDER[2]).toFixed(1)} (after ₹${BET_LADDER[0] + BET_LADDER[1] + BET_LADDER[2]} loss)`);

  console.log('\n═══════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
