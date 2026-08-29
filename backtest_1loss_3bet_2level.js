#!/usr/bin/env node
/**
 * BACKTEST: 1 Virtual Loss → Bet Next 3 Signals (2-Level Martingale)
 * 
 * Strategy:
 *   1. Detect alternating pattern (RGR/GRG — 3-length)
 *   2. Wait for 1 virtual loss on pattern signal
 *   3. LEVEL 1: Bet LIVE on next 3 signals → ₹10, ₹30, ₹60
 *      - If ANY wins → RESET to Level 1, wait for 1 virtual loss again
 *      - If ALL 3 lose → go to Level 2
 *   4. LEVEL 2: Wait for 1 virtual loss again → Bet LIVE on next 3 signals → ₹130, ₹260, ₹520
 *      - If ANY wins → RESET to Level 1
 *      - If ALL 3 lose → 💀 FULL BUST, reset to Level 1
 * 
 *   Payout: 1.96x (0.96 net profit per unit)
 */

const API_BASE = 'https://cooe02.in';
const SAAS_ID = 1;
const LEVEL_BETS = [
  [10, 30, 60],       // Level 1: ₹10 → ₹30 → ₹60
  [130, 260, 520]     // Level 2: ₹130 → ₹260 → ₹520
];
const WIN_MULTIPLIER = 0.96;
const PATTERN_LENGTH = 3;

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

function getColor(p) { return p.is_green ? 'G' : 'R'; }

function isAlternating(colors) {
  for (let i = 1; i < colors.length; i++) {
    if (colors[i] === colors[i - 1]) return false;
  }
  return true;
}

function formatPeriod(period) { return String(period).slice(-4); }
function colorEmoji(c) { return c === 'G' ? '🟢' : '🔴'; }

// ============ CORE BACKTEST ============
function backtestSection(periods, sectionName) {
  /**
   * States:
   *   HUNTING          → Looking for patterns, waiting for 1 virtual loss
   *   READY_FOR_LIVE   → Virtual loss done, next signals = LIVE bets
   *   LIVE_BETTING     → Currently placing LIVE bets (up to 3 per level)
   */
  let state = 'HUNTING';
  let currentLevel = 0;         // 0 = Level 1, 1 = Level 2
  let liveBetIndex = 0;         // Which bet in the 3-bet sequence (0, 1, 2)
  let activeBet = null;

  // Results tracking
  let totalPnL = 0;
  let peakPnL = 0;
  let maxDrawdown = 0;
  const trades = [];
  const events = [];
  let virtualWins = 0;
  let virtualLosses = 0;
  let fullCycleBusts = 0;
  let maxConsecLiveLoss = 0;
  let currentConsecLiveLoss = 0;
  let maxConsecLiveWin = 0;
  let currentConsecLiveWin = 0;
  let totalCyclesCompleted = 0;
  let totalInvested = 0;

  for (let i = 0; i < periods.length; i++) {
    // ── Resolve active bet ──
    if (activeBet && periods[i].period === activeBet.period) {
      const actualColor = getColor(periods[i]);
      const won = actualColor === activeBet.color;

      if (activeBet.isVirtual) {
        // ── Virtual bet resolution ──
        if (won) {
          virtualWins++;
          state = 'HUNTING';
          events.push({
            period: formatPeriod(periods[i].period),
            type: 'VIRTUAL',
            level: currentLevel + 1,
            bet: colorEmoji(activeBet.color),
            got: colorEmoji(actualColor),
            result: 'V-WIN ✅',
            amount: '—',
            pnl: '—',
            balance: `₹${totalPnL.toFixed(0)}`,
            note: `Virtual win → reset, still hunting. Level ${currentLevel + 1}.`
          });
        } else {
          virtualLosses++;
          // 1 virtual loss → ready for LIVE!
          state = 'READY_FOR_LIVE';
          liveBetIndex = 0;
          const bets = LEVEL_BETS[currentLevel];
          events.push({
            period: formatPeriod(periods[i].period),
            type: 'VIRTUAL',
            level: currentLevel + 1,
            bet: colorEmoji(activeBet.color),
            got: colorEmoji(actualColor),
            result: 'V-LOSS ❌',
            amount: '—',
            pnl: '—',
            balance: `₹${totalPnL.toFixed(0)}`,
            note: `Virtual loss! ★ Next 3 signals → LIVE ₹${bets[0]}, ₹${bets[1]}, ₹${bets[2]}`
          });
        }
      } else {
        // ── LIVE bet resolution ──
        const bets = LEVEL_BETS[currentLevel];
        const betAmount = bets[liveBetIndex];
        totalInvested += betAmount;

        if (won) {
          const pnlChange = betAmount * WIN_MULTIPLIER;
          totalPnL += pnlChange;

          currentConsecLiveWin++;
          currentConsecLiveLoss = 0;
          if (currentConsecLiveWin > maxConsecLiveWin) maxConsecLiveWin = currentConsecLiveWin;

          trades.push({ won: true, amount: betAmount, pnl: pnlChange, level: currentLevel + 1, betNum: liveBetIndex + 1, period: periods[i].period, totalPnL });

          events.push({
            period: formatPeriod(periods[i].period),
            type: '★ LIVE',
            level: currentLevel + 1,
            bet: colorEmoji(activeBet.color),
            got: colorEmoji(actualColor),
            result: `WIN 🎉 (${liveBetIndex + 1}/3)`,
            amount: `₹${betAmount}`,
            pnl: `+₹${pnlChange.toFixed(0)}`,
            balance: `₹${totalPnL.toFixed(0)}`,
            note: `L${currentLevel + 1} Bet ${liveBetIndex + 1}/3 WIN! +₹${pnlChange.toFixed(1)}. ✅ RESET → Level 1, hunt again.`
          });

          // WIN → reset everything back to Level 1
          currentLevel = 0;
          liveBetIndex = 0;
          totalCyclesCompleted++;
          state = 'HUNTING';

        } else {
          const pnlChange = -betAmount;
          totalPnL += pnlChange;

          currentConsecLiveLoss++;
          currentConsecLiveWin = 0;
          if (currentConsecLiveLoss > maxConsecLiveLoss) maxConsecLiveLoss = currentConsecLiveLoss;

          trades.push({ won: false, amount: betAmount, pnl: pnlChange, level: currentLevel + 1, betNum: liveBetIndex + 1, period: periods[i].period, totalPnL });

          const nextBetIdx = liveBetIndex + 1;

          if (nextBetIdx < 3) {
            // Still have more bets at this level
            events.push({
              period: formatPeriod(periods[i].period),
              type: '★ LIVE',
              level: currentLevel + 1,
              bet: colorEmoji(activeBet.color),
              got: colorEmoji(actualColor),
              result: `LOSS ❌ (${liveBetIndex + 1}/3)`,
              amount: `₹${betAmount}`,
              pnl: `-₹${betAmount}`,
              balance: `₹${totalPnL.toFixed(0)}`,
              note: `L${currentLevel + 1} Bet ${liveBetIndex + 1}/3 loss. Next bet: ₹${bets[nextBetIdx]}`
            });
            liveBetIndex = nextBetIdx;
            state = 'LIVE_BETTING';

          } else {
            // All 3 bets at this level lost
            const nextLevel = currentLevel + 1;

            if (nextLevel >= LEVEL_BETS.length) {
              // ALL LEVELS EXHAUSTED → FULL BUST
              fullCycleBusts++;
              const totalLost = LEVEL_BETS.flat().reduce((a, b) => a + b, 0);
              events.push({
                period: formatPeriod(periods[i].period),
                type: '★ LIVE',
                level: currentLevel + 1,
                bet: colorEmoji(activeBet.color),
                got: colorEmoji(actualColor),
                result: `LOSS 💀 (3/3)`,
                amount: `₹${betAmount}`,
                pnl: `-₹${betAmount}`,
                balance: `₹${totalPnL.toFixed(0)}`,
                note: `L2 Bet 3/3 LOSS! 💀 FULL BUST! All 6 bets lost (-₹${totalLost}). RESET → L1.`
              });
              currentLevel = 0;
              liveBetIndex = 0;
              state = 'HUNTING';

            } else {
              // Move to next level → wait for 1 virtual loss again
              events.push({
                period: formatPeriod(periods[i].period),
                type: '★ LIVE',
                level: currentLevel + 1,
                bet: colorEmoji(activeBet.color),
                got: colorEmoji(actualColor),
                result: `LOSS ❌ (3/3)`,
                amount: `₹${betAmount}`,
                pnl: `-₹${betAmount}`,
                balance: `₹${totalPnL.toFixed(0)}`,
                note: `L${currentLevel + 1} all 3 lost! → Level ${nextLevel + 1} (₹${LEVEL_BETS[nextLevel].join(',₹')}). Wait 1 V-loss.`
              });
              currentLevel = nextLevel;
              liveBetIndex = 0;
              state = 'HUNTING';
            }
          }
        }
      }

      // Track drawdown
      if (totalPnL > peakPnL) peakPnL = totalPnL;
      const dd = peakPnL - totalPnL;
      if (dd > maxDrawdown) maxDrawdown = dd;

      activeBet = null;
    }

    if (activeBet) continue;
    if (state !== 'HUNTING' && state !== 'READY_FOR_LIVE' && state !== 'LIVE_BETTING') continue;
    if (i < PATTERN_LENGTH - 1) continue;

    // ── Check for alternating pattern ──
    const patternColors = [];
    for (let j = i - PATTERN_LENGTH + 1; j <= i; j++) {
      patternColors.push(getColor(periods[j]));
    }
    if (!isAlternating(patternColors)) continue;
    if (i + 1 >= periods.length) continue;

    const betColor = patternColors[patternColors.length - 1];
    const nextPeriod = periods[i + 1].period;

    if (state === 'READY_FOR_LIVE' || state === 'LIVE_BETTING') {
      // LIVE bet!
      activeBet = { color: betColor, period: nextPeriod, isVirtual: false };
    } else {
      // Virtual bet — waiting for 1 loss
      activeBet = { color: betColor, period: nextPeriod, isVirtual: true };
    }
  }

  // ── Summary stats ──
  const wins = trades.filter(t => t.won).length;
  const losses = trades.length - wins;
  const winRate = trades.length > 0 ? ((wins / trades.length) * 100).toFixed(1) : '0.0';

  const levelStats = LEVEL_BETS.map((bets, idx) => {
    const lvlTrades = trades.filter(t => t.level === idx + 1);
    const lvlWins = lvlTrades.filter(t => t.won).length;
    const lvlLosses = lvlTrades.length - lvlWins;
    const lvlPnL = lvlTrades.reduce((s, t) => s + t.pnl, 0);
    const lvlInvested = lvlTrades.reduce((s, t) => s + t.amount, 0);
    return { level: idx + 1, bets, trades: lvlTrades.length, wins: lvlWins, losses: lvlLosses, pnl: lvlPnL, invested: lvlInvested };
  });

  return {
    sectionName, totalPnL, totalInvested, trades, wins, losses, winRate,
    virtualWins, virtualLosses, fullCycleBusts, totalCyclesCompleted,
    maxConsecLiveLoss, maxConsecLiveWin, maxDrawdown, peakPnL,
    levelStats, events, totalPeriods: periods.length
  };
}

// ============ PRINT SECTION RESULTS ============
function printSectionResult(r) {
  console.log('');
  console.log(`  ╔═══════════════════════════════════════════════════════════════════════╗`);
  console.log(`  ║  📊 ${r.sectionName.padEnd(8)} — ${r.totalPeriods} periods`.padEnd(72) + '║');
  console.log(`  ╚═══════════════════════════════════════════════════════════════════════╝`);
  console.log('');

  const pnlStr = (r.totalPnL >= 0 ? '+₹' : '-₹') + Math.abs(r.totalPnL).toFixed(1);
  const pnlIcon = r.totalPnL >= 0 ? '✅' : '❌';
  console.log(`  💰 Net P&L: ${pnlStr} ${pnlIcon}`);
  console.log(`  📈 Total LIVE trades: ${r.trades.length} (${r.wins}W / ${r.losses}L) — Win Rate: ${r.winRate}%`);
  console.log(`  💸 Total Invested: ₹${r.totalInvested}`);
  console.log(`  📉 Max Drawdown: ₹${r.maxDrawdown.toFixed(0)} | Peak P&L: ₹${r.peakPnL.toFixed(0)}`);
  console.log(`  🔥 Max Consec Live Loss: ${r.maxConsecLiveLoss} | Max Consec Live Win: ${r.maxConsecLiveWin}`);
  console.log(`  👁️  Virtual: ${r.virtualLosses} losses (triggers), ${r.virtualWins} wins (skipped)`);
  console.log(`  🔄 Successful cycles (win → reset): ${r.totalCyclesCompleted}`);
  console.log(`  💀 Full Cycle Busts (both levels × 3 bets lost): ${r.fullCycleBusts}`);
  if (r.fullCycleBusts > 0) {
    const bustCost = LEVEL_BETS.flat().reduce((a, b) => a + b, 0);
    console.log(`     └─ Each bust costs: -₹${bustCost} (₹${LEVEL_BETS[0].join('+₹')} + ₹${LEVEL_BETS[1].join('+₹')})`);
  }

  // Level breakdown
  console.log('');
  console.log('  ── Level-wise Breakdown ──');
  console.log('  ┌───────┬───────────────────┬────────┬──────┬──────┬──────────┐');
  console.log('  │ Level │ Bets (₹)          │ Trades │ Wins │ Loss │ P&L      │');
  console.log('  ├───────┼───────────────────┼────────┼──────┼──────┼──────────┤');
  for (const ls of r.levelStats) {
    const lsPnl = (ls.pnl >= 0 ? '+₹' : '-₹') + Math.abs(ls.pnl).toFixed(0);
    const icon = ls.pnl >= 0 ? '✅' : '❌';
    const betStr = ls.bets.map(b => `₹${b}`).join(',');
    console.log(`  │   ${ls.level}   │ ${betStr.padEnd(17)} │ ${String(ls.trades).padStart(6)} │ ${String(ls.wins).padStart(4)} │ ${String(ls.losses).padStart(4)} │ ${(lsPnl + ' ' + icon).padStart(8)} │`);
  }
  console.log('  └───────┴───────────────────┴────────┴──────┴──────┴──────────┘');

  // Detailed event log (LIVE trades only)
  const liveTrades = r.events.filter(e => e.type === '★ LIVE');
  if (liveTrades.length > 0) {
    console.log('');
    console.log('  ── Trade-by-Trade Log (LIVE only) ──');
    console.log('  ┌─────┬────────┬───┬─────┬───┬───┬──────────┬──────────┬────────────────────────────────────────────────────────┐');
    console.log('  │  #  │ Period │ L │ Bet │ → │ = │ Amount   │ Balance  │ Note                                                   │');
    console.log('  ├─────┼────────┼───┼─────┼───┼───┼──────────┼──────────┼────────────────────────────────────────────────────────┤');
    liveTrades.forEach((e, idx) => {
      const res = e.result.includes('WIN') ? '✅' : (e.result.includes('💀') ? '💀' : '❌');
      const noteShort = e.note.length > 54 ? e.note.slice(0, 51) + '...' : e.note;
      console.log(`  │ ${String(idx + 1).padStart(3)} │  ${e.period}  │ ${e.level} │  ${e.bet}  │${e.got} │${res}│ ${e.pnl.padStart(8)} │ ${e.balance.padStart(8)} │ ${noteShort.padEnd(54)} │`);
    });
    console.log('  └─────┴────────┴───┴─────┴───┴───┴──────────┴──────────┴────────────────────────────────────────────────────────┘');
  }

  // Full event log (including virtuals)
  if (r.events.length > 0) {
    console.log('');
    console.log('  ── Full Event Log (Virtual + LIVE) ──');
    for (const e of r.events) {
      const icon = e.type === '★ LIVE' ? '💰' : '👁️';
      console.log(`  ${icon} [#${e.period}] L${e.level} ${e.result} | Bet: ${e.bet} Got: ${e.got} | ${e.amount !== '—' ? e.amount : 'Virtual'} | Bal: ${e.balance} | ${e.note}`);
    }
  }
}

// ============ MAIN ============
async function main() {
  const categories = ['P', 'S', 'B', 'E'];
  const categoryNames = { P: 'Parity', S: 'Sapre', B: 'Bcone', E: 'Emerd' };

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║  🎯 BACKTEST: 1 Virtual Loss → Bet Next 3 Signals (2-Level Martingale)                🎯  ║');
  console.log('╠══════════════════════════════════════════════════════════════════════════════════════════════╣');
  console.log('║                                                                                            ║');
  console.log('║  Strategy:                                                                                 ║');
  console.log('║    1. Detect RGR/GRG pattern (3-length alternating)                                        ║');
  console.log('║    2. Wait for 1 virtual loss on a pattern signal                                          ║');
  console.log('║    3. LEVEL 1: Bet LIVE on next 3 signals → ₹10, ₹30, ₹60                                 ║');
  console.log('║       - If ANY wins → RESET to Level 1, hunt again                                        ║');
  console.log('║       - If ALL 3 lose → go to Level 2                                                     ║');
  console.log('║    4. LEVEL 2: Wait 1 virtual loss → Bet LIVE → ₹130, ₹260, ₹520                          ║');
  console.log('║       - If ANY wins → RESET to Level 1                                                    ║');
  console.log('║       - If ALL 3 lose → 💀 FULL BUST, reset                                               ║');
  console.log('║                                                                                            ║');
  console.log('║  Payout: 1.96x (0.96 net profit per unit)                                                  ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════════════════════╝');
  console.log('');

  const allResults = [];
  let grandPnL = 0, grandTrades = 0, grandWins = 0, grandLosses = 0;
  let grandBusts = 0, grandInvested = 0, grandCycles = 0;

  for (const cat of categories) {
    const data = await fetchSectionData(cat);
    if (!data || !data.periods) {
      console.log(`  ⚠️ No data for ${categoryNames[cat]}`);
      continue;
    }
    console.log(`  ✅ ${categoryNames[cat]}: ${data.periods.length} periods loaded`);

    const result = backtestSection(data.periods, categoryNames[cat]);
    allResults.push(result);

    grandPnL += result.totalPnL;
    grandTrades += result.trades.length;
    grandWins += result.wins;
    grandLosses += result.losses;
    grandBusts += result.fullCycleBusts;
    grandInvested += result.totalInvested;
    grandCycles += result.totalCyclesCompleted;
  }

  for (const r of allResults) {
    printSectionResult(r);
  }

  // ═══════════════════════════════════════════════
  // GRAND SUMMARY
  // ═══════════════════════════════════════════════
  console.log('');
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║  🏆 GRAND SUMMARY — All 4 Sections Combined                                          🏆  ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════════════════════╝');
  console.log('');

  const grandPnLStr = (grandPnL >= 0 ? '+₹' : '-₹') + Math.abs(grandPnL).toFixed(1);
  const grandIcon = grandPnL >= 0 ? '✅' : '❌';
  const grandWinRate = grandTrades > 0 ? ((grandWins / grandTrades) * 100).toFixed(1) : '0.0';

  console.log(`  💰 Grand Net P&L: ${grandPnLStr} ${grandIcon}`);
  console.log(`  📈 Total LIVE trades: ${grandTrades} (${grandWins}W / ${grandLosses}L) — Win Rate: ${grandWinRate}%`);
  console.log(`  💸 Total Amount Invested: ₹${grandInvested}`);
  console.log(`  🔄 Successful cycles (win → reset): ${grandCycles}`);
  console.log(`  💀 Total Full Cycle Busts: ${grandBusts}`);
  if (grandBusts > 0) {
    const bustCost = LEVEL_BETS.flat().reduce((a, b) => a + b, 0);
    console.log(`     └─ Total bust damage: -₹${grandBusts * bustCost}`);
  }
  console.log('');

  // Section comparison table
  console.log('  ── Section Comparison ──');
  console.log('  ┌──────────┬────────┬──────┬──────┬────────┬──────────┬───────┬──────────┐');
  console.log('  │ Section  │ Trades │ Wins │ Loss │ Win%   │ Net P&L  │ Busts │ Max DD   │');
  console.log('  ├──────────┼────────┼──────┼──────┼────────┼──────────┼───────┼──────────┤');

  for (const r of allResults) {
    const pStr = (r.totalPnL >= 0 ? '+₹' : '-₹') + Math.abs(r.totalPnL).toFixed(0);
    const icon = r.totalPnL >= 0 ? '✅' : '❌';
    console.log(`  │ ${r.sectionName.padEnd(8)} │ ${String(r.trades.length).padStart(6)} │ ${String(r.wins).padStart(4)} │ ${String(r.losses).padStart(4)} │ ${(r.winRate + '%').padStart(6)} │ ${(pStr + icon).padStart(8)} │ ${String(r.fullCycleBusts).padStart(5)} │ ₹${String(r.maxDrawdown.toFixed(0)).padStart(5)}  │`);
  }

  console.log('  ├──────────┼────────┼──────┼──────┼────────┼──────────┼───────┼──────────┤');
  console.log(`  │ TOTAL    │ ${String(grandTrades).padStart(6)} │ ${String(grandWins).padStart(4)} │ ${String(grandLosses).padStart(4)} │ ${(grandWinRate + '%').padStart(6)} │ ${(grandPnLStr + grandIcon).padStart(8)} │ ${String(grandBusts).padStart(5)} │          │`);
  console.log('  └──────────┴────────┴──────┴──────┴────────┴──────────┴───────┴──────────┘');

  // Risk analysis
  console.log('');
  console.log('  ── 🛡️ Risk Analysis ──');
  console.log('');
  const l1Cost = LEVEL_BETS[0].reduce((a, b) => a + b, 0);
  const l2Cost = LEVEL_BETS[1].reduce((a, b) => a + b, 0);
  const totalCycleRisk = l1Cost + l2Cost;
  console.log(`  Level 1 risk: ₹${l1Cost} (₹${LEVEL_BETS[0].join(' + ₹')})`);
  console.log(`  Level 2 risk: ₹${l2Cost} (₹${LEVEL_BETS[1].join(' + ₹')})`);
  console.log(`  Max risk per full cycle: ₹${totalCycleRisk} (if all 6 bets lose)`);
  console.log('');

  console.log('  ── 💡 Recovery Math ──');
  console.log('');

  // Level 1 recovery scenarios
  let cumLoss = 0;
  console.log('  Level 1 (₹10, ₹30, ₹60):');
  for (let i = 0; i < LEVEL_BETS[0].length; i++) {
    const bet = LEVEL_BETS[0][i];
    const winProfit = bet * WIN_MULTIPLIER;
    const netAfterWin = winProfit - cumLoss;
    const netStr = (netAfterWin >= 0 ? '+₹' : '-₹') + Math.abs(netAfterWin).toFixed(1);
    const icon = netAfterWin >= 0 ? '✅' : '❌';
    console.log(`    Bet ${i + 1} (₹${bet}) wins: ${netStr} ${icon} (after losing ₹${cumLoss} before)`);
    cumLoss += bet;
  }
  console.log(`    All 3 lose: -₹${cumLoss} → escalate to Level 2`);

  console.log('');
  console.log('  Level 2 (₹130, ₹260, ₹520):');
  const l1TotalLoss = cumLoss;
  for (let i = 0; i < LEVEL_BETS[1].length; i++) {
    const bet = LEVEL_BETS[1][i];
    const winProfit = bet * WIN_MULTIPLIER;
    const netAfterWin = winProfit - cumLoss;
    const netStr = (netAfterWin >= 0 ? '+₹' : '-₹') + Math.abs(netAfterWin).toFixed(1);
    const icon = netAfterWin >= 0 ? '✅' : '❌';
    console.log(`    Bet ${i + 1} (₹${bet}) wins: ${netStr} ${icon} (total loss so far: ₹${cumLoss})`);
    cumLoss += bet;
  }
  console.log(`    Full bust (all 6 lose): -₹${cumLoss} 💀`);

  console.log('');
  console.log('══════════════════════════════════════════════════════════════════════════════════════');
  console.log('');
}

main().catch(console.error);
