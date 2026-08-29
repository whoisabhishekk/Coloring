#!/usr/bin/env node
/**
 * BACKTEST: RGRG→G / GRGR→R — Wait 2 Virtual Losses → Martingale LIVE Bet
 * 
 * Strategy:
 * - Detect 4-length alternating pattern: RGRG or GRGR
 * - Bet SAME as last color (bet that alternation breaks)
 * - Track virtually until 2 consecutive losses occur
 * - After 2 consecutive virtual losses → place ONE live bet at current ladder step
 * - If LIVE bet WINS → collect profit, reset to Step 0, reset to virtual
 * - If LIVE bet LOSES → move to next ladder step, reset to virtual, wait for 2 MORE consecutive virtual losses
 * - If ladder exhausted (all 4 steps lost) → BUST cycle, reset to Step 0, reset to virtual
 * 
 * Payout: 1.96x (0.96 profit per ₹1 bet, 4% platform fee)
 */

const API_BASE = 'https://cooe02.in';
const SAAS_ID = 1;

const VIRTUAL_LOSS_THRESHOLD = 2;
const BET_LADDER = [10, 30, 90, 270];
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

function isAlternating(colors) {
  for (let i = 1; i < colors.length; i++) {
    if (colors[i] === colors[i - 1]) return false;
  }
  return true;
}

function runBacktest(periods) {
  let virtualLosses = 0;
  let goLiveNext = false;
  let liveStep = 0;
  let activeBet = null;

  let cyclePNL = 0;
  let currentCycleTrades = [];
  const cycles = [];
  let totalPNL = 0;

  for (let i = 0; i < periods.length; i++) {
    // ── Resolve active bet ──
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
          // WIN -> collect profit, reset cycle
          cycles.push({
            trades: [...currentCycleTrades],
            cyclePNL,
            result: 'WIN',
            wonAtStep: liveStep + 1
          });
          currentCycleTrades = [];
          cyclePNL = 0;
          liveStep = 0;
        } else {
          // LOSS -> move to next ladder step
          liveStep++;
          if (liveStep >= BET_LADDER.length) {
            // BUST -> all steps lost
            cycles.push({
              trades: [...currentCycleTrades],
              cyclePNL,
              result: 'BUST'
            });
            currentCycleTrades = [];
            cyclePNL = 0;
            liveStep = 0;
          }
        }

        // Win or lose, we go back to virtual tracking
        virtualLosses = 0;
        goLiveNext = false;
      } else {
        // VIRTUAL BET resolved
        if (won) {
          virtualLosses = 0;
        } else {
          virtualLosses++;
          if (virtualLosses >= VIRTUAL_LOSS_THRESHOLD) {
            goLiveNext = true;
          }
        }
      }

      activeBet = null;
    }

    if (activeBet) continue;
    if (i < 3) continue;

    // ── Detect 4-length alternating pattern ──
    const c1 = getColor(periods[i - 3]);
    const c2 = getColor(periods[i - 2]);
    const c3 = getColor(periods[i - 1]);
    const c4 = getColor(periods[i]);

    if (!isAlternating([c1, c2, c3, c4])) continue;
    if (i + 1 >= periods.length) continue;

    const betColor = c4;
    const trigger = `${c1}${c2}${c3}${c4}→${betColor}`;

    activeBet = {
      color: betColor,
      period: periods[i + 1].period,
      trigger,
      isLive: goLiveNext
    };

    if (goLiveNext) {
      goLiveNext = false;
      virtualLosses = 0; // Reset virtual losses since we're committing to a live bet
    }
  }

  return { cycles, totalPNL };
}

async function main() {
  const categories = ['P', 'S', 'B', 'E'];
  const categoryNames = { P: 'Parity', S: 'Sapre', B: 'Bcone', E: 'Emerd' };

  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('  📊 RGRG→G / GRGR→R — Wait 2 Virtual Losses → MARTINGALE');
  console.log('  Ladder: ₹10 → ₹30 → ₹90 → ₹270');
  console.log('  Wait 2 virtual losses BEFORE EACH step in the ladder');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  let grandPNL = 0;
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

    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`  ${categoryNames[cat]} (${cat}) — ${data.periods.length} periods`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    if (cycles.length === 0) {
      console.log(`  ⚠️ No live cycles occurred.\n`);
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

    // Breakdown
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

    grandPNL += totalPNL;
    grandCycles += cycles.length;
    grandWins += winCycles.length;
    grandBusts += bustCycles.length;
    grandLiveTrades += totalLiveTrades;
  }

  // ============ OVERALL ============
  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('  📊 OVERALL SUMMARY (All 4 Sections)');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  console.log(`  Total Live Cycles: ${grandCycles}`);
  console.log(`  ✅ Won: ${grandWins}  |  💀 Busted: ${grandBusts}`);
  console.log(`  Cycle Win Rate: ${grandCycles > 0 ? (grandWins / grandCycles * 100).toFixed(1) : 0}%`);
  console.log(`  Total Live Trades: ${grandLiveTrades}`);
  console.log(`\n  💰 TOTAL P&L: ${grandPNL >= 0 ? '+' : ''}₹${grandPNL.toFixed(1)}`);

  console.log('\n═══════════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
