#!/usr/bin/env node
/**
 * BACKTEST: 4 Consecutive RGRG/GRGR Loss → Trend Break → Confirm Color → 2-Bet Recovery
 * 
 * Strategy:
 *   1. Detect RGRG/GRGR (4-length alternating) → counts as 1 "loss" (no bet placed)
 *   2. Wait for trend break (consecutive same color: RR/GG)
 *   3. After break, hunt for next RGRG/GRGR:
 *      - If consecutive same color appears before RGRG/GRGR → RESET counter to 0
 *      - If RGRG/GRGR found cleanly → increment loss counter
 *   4. After 4 consecutive losses + trend break:
 *      - Wait for CONFIRM color (opposite of break: RR→wait G, GG→wait R)
 *      - Confirm color appears → BET on it for the NEXT period
 *      - If 1st bet LOSES → flip color for 2nd bet
 *      - If 2nd bet LOSES → RESET, count 4 losses again
 *
 * Payout: 1.96x (0.96 profit per ₹1 bet, 4% platform fee)
 */

const API_BASE = 'https://cooe02.in';
const SAAS_ID = 1;

const BET_AMOUNT = 10;
const WIN_MULTIPLIER = 0.96;
const REQUIRED_LOSSES = 4;

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

// ============ BACKTEST ============
function runBacktest(periods) {
  /**
   * States:
   *   HUNTING              - Looking for RGRG/GRGR (lossCount = 0)
   *   WAITING_TREND_BREAK  - RGRG/GRGR detected, waiting for RR/GG
   *   POST_BREAK_HUNTING   - After trend break, looking for next RGRG/GRGR
   *                          If consecutive appears before pattern → RESET
   *   WAITING_CONFIRM      - 4 losses done + trend broke, waiting for confirm color
   *   LIVE_BET_1           - 1st live bet placed, waiting for result
   *   LIVE_BET_2           - Recovery bet placed, waiting for result
   */
  let state = 'HUNTING';
  let lossCount = 0;
  let breakColor = null;
  let initialStreakBroken = false;
  let confirmColor = null;
  let activeBet = null;

  // Stats
  const liveTrades = [];
  let totalPNL = 0;
  let totalResets = 0;
  let totalPatternDetections = 0;
  let maxLossCountReached = 0;
  let liveEntries = 0;

  for (let i = 0; i < periods.length; i++) {
    const currentColor = getColor(periods[i]);
    const prevColor = i > 0 ? getColor(periods[i - 1]) : null;

    // ── Resolve active bet ──
    if (activeBet && activeBet.periodIndex === i) {
      const won = currentColor === activeBet.color;
      const pnl = won ? BET_AMOUNT * WIN_MULTIPLIER : -BET_AMOUNT;
      totalPNL += pnl;

      liveTrades.push({
        period: periods[i].period,
        betColor: activeBet.color,
        actualColor: currentColor,
        won,
        betNumber: activeBet.betNumber,
        pnl,
        runningPNL: totalPNL,
        liveEntry: liveEntries,
        trigger: activeBet.trigger
      });

      if (state === 'LIVE_BET_1') {
        if (won) {
          state = 'HUNTING';
          lossCount = 0;
          activeBet = null;
          continue;
        } else {
          const flipColor = activeBet.color === 'G' ? 'R' : 'G';
          if (i + 1 < periods.length) {
            activeBet = {
              color: flipColor,
              periodIndex: i + 1,
              betNumber: 2,
              trigger: `Recovery: ${activeBet.color} lost → bet ${flipColor}`
            };
            state = 'LIVE_BET_2';
          } else {
            state = 'HUNTING';
            lossCount = 0;
            activeBet = null;
          }
          continue;
        }
      }

      if (state === 'LIVE_BET_2') {
        state = 'HUNTING';
        lossCount = 0;
        activeBet = null;
        continue;
      }
    }

    if (activeBet) continue;

    // ── State transitions ──

    if (state === 'WAITING_TREND_BREAK') {
      if (prevColor && currentColor === prevColor) {
        breakColor = currentColor;
        if (lossCount >= REQUIRED_LOSSES) {
          confirmColor = breakColor === 'R' ? 'G' : 'R';
          state = 'WAITING_CONFIRM';
        } else {
          state = 'POST_BREAK_HUNTING';
          initialStreakBroken = false;
        }
      }
      continue;
    }

    if (state === 'WAITING_CONFIRM') {
      if (currentColor === confirmColor) {
        if (i + 1 < periods.length) {
          liveEntries++;
          activeBet = {
            color: confirmColor,
            periodIndex: i + 1,
            betNumber: 1,
            trigger: `${breakColor}${breakColor} break → ${confirmColor} confirmed → bet ${confirmColor}`
          };
          state = 'LIVE_BET_1';
        } else {
          state = 'HUNTING';
          lossCount = 0;
        }
      }
      continue;
    }

    if (state === 'POST_BREAK_HUNTING') {
      if (currentColor !== breakColor) {
        initialStreakBroken = true;
      }

      if (prevColor && currentColor === prevColor) {
        const isInitialStreak = (currentColor === breakColor) && !initialStreakBroken;
        if (!isInitialStreak) {
          if (lossCount > maxLossCountReached) maxLossCountReached = lossCount;
          totalResets++;
          lossCount = 0;
          state = 'HUNTING';
        }
      }
    }

    // ── HUNTING / POST_BREAK_HUNTING: detect RGRG/GRGR ──
    if (state === 'HUNTING' || state === 'POST_BREAK_HUNTING') {
      if (i < 3) continue;

      const c1 = getColor(periods[i - 3]);
      const c2 = getColor(periods[i - 2]);
      const c3 = getColor(periods[i - 1]);
      const c4 = getColor(periods[i]);

      if (isAlternating([c1, c2, c3, c4])) {
        totalPatternDetections++;
        lossCount++;
        state = 'WAITING_TREND_BREAK';
      }
    }
  }

  return {
    liveTrades,
    totalPNL,
    totalResets,
    totalPatternDetections,
    maxLossCountReached,
    liveEntries
  };
}

// ============ STREAK ANALYSIS ============
function analyzeStreaks(trades) {
  let maxLossStreak = 0, currentLoss = 0;
  let maxWinStreak = 0, currentWin = 0;
  const lossStreakDist = {};

  for (const t of trades) {
    if (!t.won) {
      currentLoss++;
      currentWin = 0;
      if (currentLoss > maxLossStreak) maxLossStreak = currentLoss;
    } else {
      if (currentLoss > 0) {
        lossStreakDist[currentLoss] = (lossStreakDist[currentLoss] || 0) + 1;
      }
      currentWin++;
      currentLoss = 0;
      if (currentWin > maxWinStreak) maxWinStreak = currentWin;
    }
  }
  if (currentLoss > 0) {
    lossStreakDist[currentLoss] = (lossStreakDist[currentLoss] || 0) + 1;
  }
  return { maxLossStreak, maxWinStreak, lossStreakDist };
}

// ============ MAIN ============
async function main() {
  const categories = ['P', 'S', 'B', 'E'];
  const categoryNames = { P: 'Parity', S: 'Sapre', B: 'Bcone', E: 'Emerd' };

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════════════════════╗');
  console.log('║  📊 BACKTEST: 4 Consecutive RGRG → Trend Break → Confirm → 2-Bet Recovery  ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('  Strategy:');
  console.log('    1. Detect RGRG/GRGR = 1 loss (no bet)');
  console.log('    2. Wait for trend break (RR/GG)');
  console.log('    3. Hunt next RGRG/GRGR — if consecutive before it → RESET');
  console.log('    4. After 4 consecutive losses + break:');
  console.log('       → Wait for confirm color (RR→G, GG→R)');
  console.log('       → Bet confirm color | If loss → flip color');
  console.log('       → Both lose → RESET, wait 4 again');
  console.log('    Bet: Flat ₹' + BET_AMOUNT + ' | Payout: 1.96x');
  console.log('');

  let grandPNL = 0;
  let grandLiveWins = 0;
  let grandLiveLosses = 0;
  let grandLiveTrades = 0;
  let grandResets = 0;
  let grandPatterns = 0;
  let grandEntries = 0;
  const allResults = [];

  for (const cat of categories) {
    const data = await fetchSectionData(cat);
    if (!data || !data.periods || data.periods.length === 0) {
      console.log('  ⚠️ No data for ' + categoryNames[cat]);
      continue;
    }

    const periods = data.periods;
    const result = runBacktest(periods);
    const wins = result.liveTrades.filter(t => t.won).length;
    const losses = result.liveTrades.filter(t => !t.won).length;
    const streaks = analyzeStreaks(result.liveTrades);

    allResults.push({ cat, name: categoryNames[cat], periods: periods.length, result, wins, losses, streaks });

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  📌 ' + categoryNames[cat] + ' (' + cat + ') — ' + periods.length + ' periods');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    console.log('\n  🔍 Pattern Detection:');
    console.log('     Total RGRG/GRGR patterns detected: ' + result.totalPatternDetections);
    console.log('     Times reached 4 consecutive losses: ' + result.liveEntries);
    console.log('     Resets (consecutive broke the chain): ' + result.totalResets);
    console.log('     Highest loss count before reset: ' + result.maxLossCountReached);

    console.log('\n  🎯 Live Trades:');
    console.log('     Total live bets: ' + result.liveTrades.length);
    console.log('     Wins: ' + wins + '  |  Losses: ' + losses);
    const winRate = result.liveTrades.length > 0 ? (wins / result.liveTrades.length * 100).toFixed(1) : '0.0';
    console.log('     Win rate: ' + winRate + '%');
    console.log('     💰 P&L: ' + (result.totalPNL >= 0 ? '+' : '') + '₹' + result.totalPNL.toFixed(1));

    if (result.liveTrades.length > 0) {
      console.log('\n  📊 Streak Analysis:');
      console.log('     Max consecutive live wins: ' + streaks.maxWinStreak);
      console.log('     Max consecutive live losses: ' + streaks.maxLossStreak);

      if (Object.keys(streaks.lossStreakDist).length > 0) {
        console.log('     Loss streak distribution:');
        const sorted = Object.keys(streaks.lossStreakDist).map(Number).sort((a, b) => a - b);
        for (const len of sorted) {
          console.log('       ' + len + ' in a row: ' + streaks.lossStreakDist[len] + ' time(s)');
        }
      }

      const bet1Trades = result.liveTrades.filter(t => t.betNumber === 1);
      const bet2Trades = result.liveTrades.filter(t => t.betNumber === 2);
      const bet1Wins = bet1Trades.filter(t => t.won).length;
      const bet2Wins = bet2Trades.filter(t => t.won).length;

      console.log('\n  📈 Bet Breakdown:');
      console.log('     1st bets: ' + bet1Trades.length + ' (' + bet1Wins + 'W / ' + (bet1Trades.length - bet1Wins) + 'L) → ' + (bet1Trades.length > 0 ? (bet1Wins / bet1Trades.length * 100).toFixed(1) : '0.0') + '%');
      console.log('     2nd bets (recovery): ' + bet2Trades.length + ' (' + bet2Wins + 'W / ' + (bet2Trades.length - bet2Wins) + 'L) → ' + (bet2Trades.length > 0 ? (bet2Wins / bet2Trades.length * 100).toFixed(1) : '0.0') + '%');

      console.log('\n  📋 Trade Details:');
      result.liveTrades.forEach((t, idx) => {
        const icon = t.won ? '✅' : '❌';
        const pnlStr = t.pnl >= 0 ? '+₹' + t.pnl.toFixed(1) : '-₹' + Math.abs(t.pnl).toFixed(1);
        const runStr = t.runningPNL >= 0 ? '+₹' + t.runningPNL.toFixed(1) : '-₹' + Math.abs(t.runningPNL).toFixed(1);
        console.log('     ' + icon + ' #' + (idx + 1) + ' [Entry ' + t.liveEntry + '] Bet' + t.betNumber + ': ' + t.betColor + '→' + t.actualColor + '  ' + pnlStr + '  (Total: ' + runStr + ')  ' + t.trigger);
      });
    }

    console.log('');

    grandPNL += result.totalPNL;
    grandLiveWins += wins;
    grandLiveLosses += losses;
    grandLiveTrades += result.liveTrades.length;
    grandResets += result.totalResets;
    grandPatterns += result.totalPatternDetections;
    grandEntries += result.liveEntries;
  }

  // ════════════════ OVERALL SUMMARY ════════════════
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════════════════════╗');
  console.log('║  📊 OVERALL SUMMARY (All 4 Sections)                                       ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════╝');
  console.log('');

  const overallWinRate = grandLiveTrades > 0
    ? (grandLiveWins / grandLiveTrades * 100).toFixed(1) : '0.0';

  console.log('  🔍 Total RGRG/GRGR patterns detected: ' + grandPatterns);
  console.log('  🔄 Total resets (chain broken): ' + grandResets);
  console.log('  🎯 Times reached 4 consecutive losses: ' + grandEntries);
  console.log('');
  console.log('  📊 Live Trades: ' + grandLiveTrades + '  (' + grandLiveWins + 'W / ' + grandLiveLosses + 'L → ' + overallWinRate + '%)');
  console.log('  💰 TOTAL P&L: ' + (grandPNL >= 0 ? '+' : '') + '₹' + grandPNL.toFixed(1));

  if (grandLiveTrades > 0) {
    const avgPNL = grandPNL / grandLiveTrades;
    console.log('  📈 Avg P&L per live trade: ' + (avgPNL >= 0 ? '+' : '') + '₹' + avgPNL.toFixed(2));
  }

  // Per-section comparison table
  console.log('\n  ┌────────────┬─────────┬────────┬──────┬───────┬──────────┬──────────┬────────────┐');
  console.log('  │ Section    │ Periods │ Trades │ Wins │ Losses│ Win Rate │ Max L.Stk│    P&L     │');
  console.log('  ├────────────┼─────────┼────────┼──────┼───────┼──────────┼──────────┼────────────┤');
  for (const r of allResults) {
    const wr = r.result.liveTrades.length > 0 ? (r.wins / r.result.liveTrades.length * 100).toFixed(1) : '0.0';
    const pnlStr = (r.result.totalPNL >= 0 ? '+' : '') + '₹' + r.result.totalPNL.toFixed(1);
    console.log('  │ ' + r.name.padEnd(10) + ' │ ' + String(r.periods).padStart(7) + ' │ ' + String(r.result.liveTrades.length).padStart(6) + ' │ ' + String(r.wins).padStart(4) + ' │ ' + String(r.losses).padStart(5) + ' │ ' + (wr + '%').padStart(8) + ' │ ' + String(r.streaks.maxLossStreak).padStart(8) + ' │ ' + pnlStr.padStart(10) + ' │');
  }
  console.log('  └────────────┴─────────┴────────┴──────┴───────┴──────────┴──────────┴────────────┘');

  // Pattern detection stats table
  console.log('\n  ┌────────────┬──────────┬──────────┬────────┬──────────────────┐');
  console.log('  │ Section    │ Patterns │ Entries  │ Resets │ Max Before Reset │');
  console.log('  ├────────────┼──────────┼──────────┼────────┼──────────────────┤');
  for (const r of allResults) {
    console.log('  │ ' + r.name.padEnd(10) + ' │ ' + String(r.result.totalPatternDetections).padStart(8) + ' │ ' + String(r.result.liveEntries).padStart(8) + ' │ ' + String(r.result.totalResets).padStart(6) + ' │ ' + String(r.result.maxLossCountReached).padStart(16) + ' │');
  }
  console.log('  └────────────┴──────────┴──────────┴────────┴──────────────────┘');

  console.log('\n  Strategy: 4 Consecutive RGRG/GRGR → Break → Confirm Color → 2-Bet');
  console.log('  Bet: Flat ₹' + BET_AMOUNT + ' | If both lose → wait 4 new consecutive losses');
  console.log('');
  console.log('══════════════════════════════════════════════════════════════════════════════════');
  console.log('');
}

main().catch(console.error);
