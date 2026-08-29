#!/usr/bin/env node
/**
 * BACKTEST: 2-Loss Wait → Bet Next 3 Signals + 4-Level Martingale
 * 
 * Strategy per section:
 *   1. Detect alternating pattern (RGRG / GRGR — 4-length)
 *   2. Wait for 2 virtual losses on pattern
 *   3. Place LIVE bet on next 3 pattern signals at current level
 *   4. If ANY of the 3 bets WIN → reset to Level 1, hunt again
 *   5. If ALL 3 lose → escalate to next level, wait 2 more losses, bet 3 again
 *   6. Levels: ₹10 → ₹30 → ₹90 → ₹270
 *   7. If all 4 levels exhaust (12 live bets all lost) → full bust, reset
 */

const API_BASE = 'https://cooe02.in';
const SAAS_ID = 1;
const BET_LEVELS = [10, 30, 90, 270];
const WIN_MULTIPLIER = 0.96;
const PATTERN_LENGTH = 4;
const REQUIRED_LOSSES = 2;
const LIVE_BETS_PER_LEVEL = 3;

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

function formatPeriod(period) { return String(period).slice(-3); }
function colorEmoji(c) { return c === 'G' ? '🟢' : '🔴'; }

// ============ CORE BACKTEST ============
function backtestSection(periods, sectionName) {
  /**
   * States:
   *   HUNTING          → Looking for patterns, counting virtual losses
   *   READY_FOR_LIVE   → 2 virtual losses done, next patterns = LIVE bet
   *   LIVE_BETTING     → Currently in LIVE mode, betting on signals (up to 2)
   */
  let state = 'HUNTING';
  let virtualLossCount = 0;
  let martingaleLevel = 0;       // 0-3
  let liveBetsRemaining = 0;     // How many more LIVE bets at this level
  let liveBetsWonThisLevel = 0;  // Track wins in current level's 2 bets
  let activeBet = null;

  // Results
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
  let totalCyclesCompleted = 0;  // Full win cycles (any level win → reset)

  for (let i = 0; i < periods.length; i++) {
    // ── Resolve active bet ──
    if (activeBet && periods[i].period === activeBet.period) {
      const actualColor = getColor(periods[i]);
      const won = actualColor === activeBet.color;

      if (activeBet.isVirtual) {
        if (won) {
          virtualWins++;
          virtualLossCount = 0;
          state = 'HUNTING';
          events.push({
            period: formatPeriod(periods[i].period),
            type: 'VIRTUAL',
            level: martingaleLevel + 1,
            bet: colorEmoji(activeBet.color),
            got: colorEmoji(actualColor),
            result: 'V-WIN ✅',
            amount: '—',
            pnl: '—',
            balance: `₹${totalPnL.toFixed(0)}`,
            note: `Virtual win → counter reset (${virtualLossCount}/2). Level ${martingaleLevel + 1}.`
          });
        } else {
          virtualLosses++;
          virtualLossCount++;

          if (virtualLossCount >= REQUIRED_LOSSES) {
            state = 'READY_FOR_LIVE';
            liveBetsRemaining = LIVE_BETS_PER_LEVEL;
            liveBetsWonThisLevel = 0;
            events.push({
              period: formatPeriod(periods[i].period),
              type: 'VIRTUAL',
              level: martingaleLevel + 1,
              bet: colorEmoji(activeBet.color),
              got: colorEmoji(actualColor),
              result: 'V-LOSS ❌',
              amount: '—',
              pnl: '—',
              balance: `₹${totalPnL.toFixed(0)}`,
              note: `2nd virtual loss! ★ Next 2 signals → LIVE ₹${BET_LEVELS[martingaleLevel]} each`
            });
          } else {
            state = 'HUNTING';
            events.push({
              period: formatPeriod(periods[i].period),
              type: 'VIRTUAL',
              level: martingaleLevel + 1,
              bet: colorEmoji(activeBet.color),
              got: colorEmoji(actualColor),
              result: 'V-LOSS ❌',
              amount: '—',
              pnl: '—',
              balance: `₹${totalPnL.toFixed(0)}`,
              note: `Virtual loss ${virtualLossCount}/2. Need ${REQUIRED_LOSSES - virtualLossCount} more.`
            });
          }
        }
      } else {
        // ── LIVE bet resolution ──
        const betAmount = BET_LEVELS[martingaleLevel];
        liveBetsRemaining--;

        if (won) {
          const pnlChange = betAmount * WIN_MULTIPLIER;
          totalPnL += pnlChange;
          liveBetsWonThisLevel++;

          currentConsecLiveWin++;
          currentConsecLiveLoss = 0;
          if (currentConsecLiveWin > maxConsecLiveWin) maxConsecLiveWin = currentConsecLiveWin;

          events.push({
            period: formatPeriod(periods[i].period),
            type: '★ LIVE',
            level: martingaleLevel + 1,
            bet: colorEmoji(activeBet.color),
            got: colorEmoji(actualColor),
            result: `WIN 🎉 (${LIVE_BETS_PER_LEVEL - liveBetsRemaining}/2)`,
            amount: `₹${betAmount}`,
            pnl: `+₹${pnlChange.toFixed(0)}`,
            balance: `₹${totalPnL.toFixed(0)}`,
            note: `Level ${martingaleLevel + 1} bet ${LIVE_BETS_PER_LEVEL - liveBetsRemaining}/2 WIN! +₹${pnlChange.toFixed(0)}. RESET → Level 1.`
          });

          trades.push({ won: true, amount: betAmount, pnl: pnlChange, level: martingaleLevel + 1, period: periods[i].period });

          // WIN at any point → reset everything
          martingaleLevel = 0;
          virtualLossCount = 0;
          liveBetsRemaining = 0;
          totalCyclesCompleted++;
          state = 'HUNTING';
        } else {
          const pnlChange = -betAmount;
          totalPnL += pnlChange;

          currentConsecLiveLoss++;
          currentConsecLiveWin = 0;
          if (currentConsecLiveLoss > maxConsecLiveLoss) maxConsecLiveLoss = currentConsecLiveLoss;

          trades.push({ won: false, amount: betAmount, pnl: pnlChange, level: martingaleLevel + 1, period: periods[i].period });

          if (liveBetsRemaining > 0) {
            // Still have 1 more LIVE bet at this level
            events.push({
              period: formatPeriod(periods[i].period),
              type: '★ LIVE',
              level: martingaleLevel + 1,
              bet: colorEmoji(activeBet.color),
              got: colorEmoji(actualColor),
              result: `LOSS ❌ (${LIVE_BETS_PER_LEVEL - liveBetsRemaining}/2)`,
              amount: `₹${betAmount}`,
              pnl: `-₹${betAmount}`,
              balance: `₹${totalPnL.toFixed(0)}`,
              note: `Level ${martingaleLevel + 1} bet ${LIVE_BETS_PER_LEVEL - liveBetsRemaining}/2 loss. 1 more LIVE bet left.`
            });
            state = 'LIVE_BETTING';
          } else {
            // Both LIVE bets at this level lost
            const nextLevel = martingaleLevel + 1;

            if (nextLevel >= BET_LEVELS.length) {
              // Full cycle bust!
              fullCycleBusts++;
              events.push({
                period: formatPeriod(periods[i].period),
                type: '★ LIVE',
                level: martingaleLevel + 1,
                bet: colorEmoji(activeBet.color),
                got: colorEmoji(actualColor),
                result: `LOSS 💀 (2/2)`,
                amount: `₹${betAmount}`,
                pnl: `-₹${betAmount}`,
                balance: `₹${totalPnL.toFixed(0)}`,
                note: `Level 4 bet 2/2 LOSS! 💀 FULL BUST! All 8 bets lost. RESET → Level 1.`
              });
              martingaleLevel = 0;
              virtualLossCount = 0;
              state = 'HUNTING';
            } else {
              events.push({
                period: formatPeriod(periods[i].period),
                type: '★ LIVE',
                level: martingaleLevel + 1,
                bet: colorEmoji(activeBet.color),
                got: colorEmoji(actualColor),
                result: `LOSS ❌ (2/2)`,
                amount: `₹${betAmount}`,
                pnl: `-₹${betAmount}`,
                balance: `₹${totalPnL.toFixed(0)}`,
                note: `Level ${martingaleLevel + 1} both bets lost! → Level ${nextLevel + 1} (₹${BET_LEVELS[nextLevel]}). Wait 2 losses.`
              });
              martingaleLevel = nextLevel;
              virtualLossCount = 0;
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
      // Virtual bet — counting losses
      activeBet = { color: betColor, period: nextPeriod, isVirtual: true };
    }
  }

  // ── Summary stats ──
  const wins = trades.filter(t => t.won).length;
  const losses = trades.length - wins;
  const totalBetted = trades.reduce((s, t) => s + t.amount, 0);
  const winRate = trades.length > 0 ? ((wins / trades.length) * 100).toFixed(1) : '0.0';

  const levelStats = BET_LEVELS.map((bet, idx) => {
    const lvlTrades = trades.filter(t => t.level === idx + 1);
    const lvlWins = lvlTrades.filter(t => t.won).length;
    const lvlLosses = lvlTrades.length - lvlWins;
    const lvlPnL = lvlTrades.reduce((s, t) => s + t.pnl, 0);
    return { level: idx + 1, bet, trades: lvlTrades.length, wins: lvlWins, losses: lvlLosses, pnl: lvlPnL };
  });

  return {
    sectionName, totalPnL, totalBetted, trades, wins, losses, winRate,
    virtualWins, virtualLosses, fullCycleBusts, totalCyclesCompleted,
    maxConsecLiveLoss, maxConsecLiveWin, maxDrawdown, peakPnL,
    levelStats, events, totalPeriods: periods.length
  };
}

// ============ PRINT RESULTS ============
function printSectionResult(r) {
  console.log('');
  console.log(`  ╔═══════════════════════════════════════════════════════════════╗`);
  console.log(`  ║  📊 ${r.sectionName.padEnd(8)} — ${r.totalPeriods} periods                            ║`);
  console.log(`  ╚═══════════════════════════════════════════════════════════════╝`);
  console.log('');

  const pnlStr = (r.totalPnL >= 0 ? '+₹' : '-₹') + Math.abs(r.totalPnL).toFixed(0);
  const pnlIcon = r.totalPnL >= 0 ? '✅' : '❌';
  console.log(`  💰 Net P&L: ${pnlStr} ${pnlIcon}`);
  console.log(`  📈 Total LIVE trades: ${r.trades.length} (${r.wins}W / ${r.losses}L) — Win Rate: ${r.winRate}%`);
  console.log(`  💸 Total Betted: ₹${r.totalBetted}`);
  console.log(`  📉 Max Drawdown: ₹${r.maxDrawdown.toFixed(0)} | Peak P&L: ₹${r.peakPnL.toFixed(0)}`);
  console.log(`  🔥 Max Consec Live Loss: ${r.maxConsecLiveLoss} | Max Consec Live Win: ${r.maxConsecLiveWin}`);
  console.log(`  👁️ Virtual: ${r.virtualLosses} losses skipped, ${r.virtualWins} wins skipped`);
  console.log(`  🔄 Successful cycles (win → reset): ${r.totalCyclesCompleted}`);
  console.log(`  💀 Full Cycle Busts (all 4 levels × 3 bets lost): ${r.fullCycleBusts}`);
  if (r.fullCycleBusts > 0) {
    const bustCost = BET_LEVELS.reduce((a, b) => a + b * 3, 0);
    console.log(`     └─ Each bust costs: -₹${bustCost} (3×₹${BET_LEVELS.join(' + 3×₹')})`);
  }

  // Level breakdown
  console.log('');
  console.log('  ── Level-wise Breakdown (3 bets per level) ──');
  console.log('  ┌───────┬────────┬────────┬──────┬──────┬──────────┐');
  console.log('  │ Level │ Bet ₹  │ Trades │ Wins │ Loss │ P&L      │');
  console.log('  ├───────┼────────┼────────┼──────┼──────┼──────────┤');
  for (const ls of r.levelStats) {
    const lsPnl = (ls.pnl >= 0 ? '+₹' : '-₹') + Math.abs(ls.pnl).toFixed(0);
    const icon = ls.pnl >= 0 ? '✅' : '❌';
    console.log(`  │   ${ls.level}   │ ${String(ls.bet).padStart(5)}  │ ${String(ls.trades).padStart(6)} │ ${String(ls.wins).padStart(4)} │ ${String(ls.losses).padStart(4)} │ ${(lsPnl + icon).padStart(8)} │`);
  }
  console.log('  └───────┴────────┴────────┴──────┴──────┴──────────┘');

  // Trade log
  const liveTrades = r.events.filter(e => e.type === '★ LIVE');
  if (liveTrades.length > 0) {
    console.log('');
    console.log('  ── Trade-by-Trade Log (LIVE only) ──');
    console.log('  ┌─────┬────────┬───┬─────┬───┬───┬──────────┬──────────┬───────────────────────────────────────────────────┐');
    console.log('  │  #  │ Period │ L │ Bet │ → │ = │ Amount   │ Balance  │ Note                                              │');
    console.log('  ├─────┼────────┼───┼─────┼───┼───┼──────────┼──────────┼───────────────────────────────────────────────────┤');
    liveTrades.forEach((e, idx) => {
      const res = e.result.includes('WIN') ? '✅' : (e.result.includes('💀') ? '💀' : '❌');
      const noteShort = e.note.length > 49 ? e.note.slice(0, 46) + '...' : e.note;
      console.log(`  │ ${String(idx + 1).padStart(3)} │  ${e.period}   │ ${e.level} │  ${e.bet}  │${e.got} │${res}│ ${e.pnl.padStart(8)} │ ${e.balance.padStart(8)} │ ${noteShort.padEnd(49)} │`);
    });
    console.log('  └─────┴────────┴───┴─────┴───┴───┴──────────┴──────────┴───────────────────────────────────────────────────┘');
  }
}

// ============ MAIN ============
async function main() {
  const categories = ['P', 'S', 'B', 'E'];
  const categoryNames = { P: 'Parity', S: 'Sapre', B: 'Bcone', E: 'Emerd' };

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║  🎯 BACKTEST: 2-Loss Wait → Bet Next 3 Signals + Martingale (₹10→₹30→₹90→₹270)  🎯   ║');
  console.log('╠══════════════════════════════════════════════════════════════════════════════════════════╣');
  console.log('║                                                                                        ║');
  console.log('║  Strategy:                                                                              ║');
  console.log('║    1. Detect RGRG/GRGR pattern (4-length alternating)                                  ║');
  console.log('║    2. Wait for 2 virtual losses on patterns                                             ║');
  console.log('║    3. Bet LIVE on next 3 signals at ₹10 (Level 1)                                      ║');
  console.log('║    4. If ANY wins → RESET to Level 1                                                    ║');
  console.log('║    5. If ALL 3 lose → wait 2 more losses → bet 3 signals at ₹30 (Level 2)              ║');
  console.log('║    6. Continue: ₹90 (Level 3) → ₹270 (Level 4)                                         ║');
  console.log('║    7. If all 4 levels × 3 bets = 12 bets lose → 💀 Full Bust, reset                    ║');
  console.log('║                                                                                        ║');
  console.log('║  Payout: 1.96x (0.96 net profit per unit)                                              ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════════════════╝');
  console.log('');

  const allResults = [];
  let grandPnL = 0, grandTrades = 0, grandWins = 0, grandLosses = 0, grandBusts = 0, grandBetted = 0;

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
    grandBetted += result.totalBetted;
  }

  for (const r of allResults) {
    printSectionResult(r);
  }

  // ═══════════════════════════════════════════════
  // GRAND SUMMARY
  // ═══════════════════════════════════════════════
  console.log('');
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║  🏆 GRAND SUMMARY — All 4 Sections Combined                                      🏆   ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════════════════╝');
  console.log('');

  const grandPnLStr = (grandPnL >= 0 ? '+₹' : '-₹') + Math.abs(grandPnL).toFixed(0);
  const grandIcon = grandPnL >= 0 ? '✅' : '❌';
  const grandWinRate = grandTrades > 0 ? ((grandWins / grandTrades) * 100).toFixed(1) : '0.0';

  console.log(`  💰 Grand Net P&L: ${grandPnLStr} ${grandIcon}`);
  console.log(`  📈 Total LIVE trades: ${grandTrades} (${grandWins}W / ${grandLosses}L) — Win Rate: ${grandWinRate}%`);
  console.log(`  💸 Total Amount Betted: ₹${grandBetted}`);
  console.log(`  💀 Total Full Cycle Busts: ${grandBusts}`);
  if (grandBusts > 0) {
    const totalBustCost = grandBusts * BET_LEVELS.reduce((a, b) => a + b * 3, 0);
    console.log(`     └─ Total bust damage: -₹${totalBustCost}`);
  }
  console.log('');

  // Section comparison
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
  const totalCycleRisk = BET_LEVELS.reduce((a, b) => a + b * 3, 0);
  console.log(`  Max risk per full cycle: ₹${totalCycleRisk} (3×₹${BET_LEVELS.join(' + 3×₹')})`);
  console.log(`  That's 4 levels × 3 bets each = 12 bets before bust`);
  console.log('');

  console.log('  ── 💡 Recovery Math per Level (3 bets each) ──');
  let cumLoss = 0;
  for (let i = 0; i < BET_LEVELS.length; i++) {
    const bet = BET_LEVELS[i];
    const levelCost = bet * 2;
    const winProfit = bet * WIN_MULTIPLIER;
    // Win on 1st bet of level
    const netWin1 = winProfit - cumLoss;
    // Lose 1st, win 2nd
    const netWin2 = winProfit - cumLoss - bet;
    const net1Str = (netWin1 >= 0 ? '+₹' : '-₹') + Math.abs(netWin1).toFixed(0);
    const net2Str = (netWin2 >= 0 ? '+₹' : '-₹') + Math.abs(netWin2).toFixed(0);
    const icon1 = netWin1 >= 0 ? '✅' : '❌';
    const icon2 = netWin2 >= 0 ? '✅' : '❌';
    console.log(`  Level ${i + 1} (₹${bet}×2): Win 1st bet → Net ${net1Str} ${icon1} | Lose 1st, Win 2nd → Net ${net2Str} ${icon2}`);
    cumLoss += levelCost;
  }
  console.log(`  Full bust (all 8 lose): -₹${cumLoss}`);

  console.log('');
  console.log('══════════════════════════════════════════════════════════════════════════════════════');
  console.log('');
}

main().catch(console.error);
