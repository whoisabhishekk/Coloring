#!/usr/bin/env node
/**
 * DETAILED BACKTEST: 1-Loss + TrendBreak (RGR 3-length)
 * 
 * ₹10 per trade | 1.96x payout (profit = ₹9.60 on win, loss = ₹10)
 * 
 * Shows EVERY trade, virtual bets, state changes, and running P&L
 */

const API_BASE = 'https://cooe02.in';
const SAAS_ID = 1;
const BET_AMOUNT = 10;
const WIN_PROFIT = BET_AMOUNT * 0.96; // ₹9.60
const LOSS_AMOUNT = BET_AMOUNT;       // ₹10.00
const PATTERN_LENGTH = 3;

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

function formatPeriod(period) {
  const s = String(period);
  return s.length > 4 ? s.slice(-4) : s;
}

function colorEmoji(c) { return c === 'G' ? '🟢' : '🔴'; }

// ============ DETAILED BACKTEST ============
function detailedBacktest(periods, sectionName) {
  const trades = [];         // LIVE trades only
  const allEvents = [];      // Every event for detailed log
  let state = 'HUNTING';
  let activeBet = null;
  let runningPnL = 0;
  let tradeNumber = 0;
  let virtualCount = 0;

  for (let i = 0; i < periods.length; i++) {
    const currentColor = getColor(periods[i]);
    const periodNum = formatPeriod(periods[i].period);

    // ── Resolve active bet ──
    if (activeBet && periods[i].period === activeBet.period) {
      const actualColor = currentColor;
      const won = actualColor === activeBet.color;

      if (activeBet.isVirtual) {
        virtualCount++;
        if (won) {
          // Virtual WIN → reset, back to hunting
          allEvents.push({
            type: 'VIRTUAL',
            period: periodNum,
            betColor: activeBet.color,
            actualColor,
            result: '✅ V-WIN',
            action: 'Counter reset → HUNTING',
            pnl: 0,
            runningPnL,
            note: 'Virtual win (paisa nahi lagaya tha, skip)'
          });
          state = 'HUNTING';
        } else {
          // Virtual LOSS → ready for LIVE!
          allEvents.push({
            type: 'VIRTUAL',
            period: periodNum,
            betColor: activeBet.color,
            actualColor,
            result: '❌ V-LOSS',
            action: 'Next pattern pe LIVE bet! 🔥',
            pnl: 0,
            runningPnL,
            note: 'Virtual loss → ab next pattern pe REAL bet lagega'
          });
          state = 'READY_FOR_LIVE';
        }
      } else {
        // LIVE bet!
        tradeNumber++;
        const pnl = won ? +WIN_PROFIT : -LOSS_AMOUNT;
        runningPnL += pnl;

        const trade = {
          tradeNum: tradeNumber,
          period: periodNum,
          betColor: activeBet.color,
          actualColor,
          won,
          pnl,
          runningPnL
        };
        trades.push(trade);

        allEvents.push({
          type: 'LIVE',
          tradeNum: tradeNumber,
          period: periodNum,
          betColor: activeBet.color,
          actualColor,
          result: won ? '✅ WIN 💰' : '❌ LOSS',
          action: won ? 'Profit! → HUNTING' : 'Loss → TREND BREAK WAIT ⏳',
          pnl: pnl,
          runningPnL,
          note: won
            ? `+₹${WIN_PROFIT.toFixed(2)} profit`
            : `-₹${LOSS_AMOUNT} loss → jab tak 2 same color na aaye, wait`
        });

        if (won) {
          state = 'HUNTING';
        } else {
          state = 'WAITING_FOR_TREND_BREAK';
        }
      }
      activeBet = null;
    }

    if (activeBet) continue;

    // ── Trend Break Check ──
    if (state === 'WAITING_FOR_TREND_BREAK') {
      if (i > 0 && getColor(periods[i - 1]) === currentColor) {
        allEvents.push({
          type: 'TREND_BREAK',
          period: periodNum,
          betColor: '-',
          actualColor: currentColor,
          result: '🔄 BREAK',
          action: `${colorEmoji(currentColor)}${colorEmoji(currentColor)} same color → HUNTING resume`,
          pnl: 0,
          runningPnL,
          note: `2 consecutive ${currentColor} detected, trend broken`
        });
        state = 'HUNTING';
      }
    }

    if (state !== 'HUNTING' && state !== 'READY_FOR_LIVE') continue;
    if (i < PATTERN_LENGTH - 1) continue;

    // ── Pattern Check ──
    const patternColors = [];
    for (let j = i - PATTERN_LENGTH + 1; j <= i; j++) {
      patternColors.push(getColor(periods[j]));
    }
    if (!isAlternating(patternColors)) continue;
    if (i + 1 >= periods.length) continue;

    const betColor = patternColors[patternColors.length - 1];
    const nextPeriod = periods[i + 1].period;
    const patternStr = patternColors.map(c => colorEmoji(c)).join('');

    if (state === 'READY_FOR_LIVE') {
      // LIVE bet!
      allEvents.push({
        type: 'SIGNAL',
        period: periodNum,
        betColor,
        actualColor: '-',
        result: '🚨 LIVE BET',
        action: `Pattern ${patternStr} → LIVE Bet ${colorEmoji(betColor)} on #${formatPeriod(nextPeriod)}`,
        pnl: 0,
        runningPnL,
        note: `₹${BET_AMOUNT} lagaya! Virtual loss ke baad REAL bet`
      });
      activeBet = { color: betColor, period: nextPeriod, isVirtual: false };
      state = 'SIGNAL_ACTIVE';
    } else {
      // Virtual bet
      allEvents.push({
        type: 'SIGNAL',
        period: periodNum,
        betColor,
        actualColor: '-',
        result: '👁️ VIRTUAL',
        action: `Pattern ${patternStr} → Virtual Bet ${colorEmoji(betColor)} on #${formatPeriod(nextPeriod)}`,
        pnl: 0,
        runningPnL,
        note: 'Paisa nahi lagaya, sirf observe kar rahe hain'
      });
      activeBet = { color: betColor, period: nextPeriod, isVirtual: true };
    }
  }

  return { trades, allEvents, runningPnL, tradeNumber, virtualCount };
}

// ============ MAIN ============
async function main() {
  const categories = ['P', 'S', 'B', 'E'];
  const categoryNames = { P: 'Parity', S: 'Sapre', B: 'Bcone', E: 'Emerd' };

  console.log('');
  console.log('╔════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║   💰 DETAILED BACKTEST: 1-Loss + TrendBreak (RGR 3-length) — ₹10/trade             ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('  Strategy: Pattern (RGR/GRG) → Virtual bet → Loss hone pe next pe LIVE → LIVE loss pe Trend Break Wait');
  console.log(`  Bet Amount: ₹${BET_AMOUNT} | Win Payout: 1.96x (Profit: ₹${WIN_PROFIT.toFixed(2)}) | Loss: -₹${LOSS_AMOUNT}`);
  console.log('');

  let grandTotalPnL = 0;
  let grandTotalTrades = 0;
  let grandWins = 0;
  let grandLosses = 0;
  let grandVirtual = 0;
  let grandMaxLossStreak = 0;
  let grandMaxWinStreak = 0;

  for (const cat of categories) {
    const data = await fetchSectionData(cat);
    if (!data || !data.periods || data.periods.length === 0) {
      console.log(`  ⚠️ No data for ${categoryNames[cat]}`);
      continue;
    }

    const periods = data.periods;
    const result = detailedBacktest(periods, categoryNames[cat]);

    console.log('');
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`  📊 ${categoryNames[cat]} (${periods.length} periods)`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    // Show color sequence
    const colorSeq = periods.map(p => colorEmoji(getColor(p))).join('');
    console.log(`\n  Color Sequence: ${colorSeq}`);
    console.log('');

    // ── Detailed Event Log ──
    if (result.allEvents.length === 0) {
      console.log('  ❌ No patterns found in this section');
      continue;
    }

    console.log('  ┌──────┬─────────┬────────────────┬─────────────────────────────────────────────────────────────────┐');
    console.log('  │  #   │ Period  │ Result         │ Details                                                         │');
    console.log('  ├──────┼─────────┼────────────────┼─────────────────────────────────────────────────────────────────┤');

    for (const e of result.allEvents) {
      const num = e.tradeNum ? `T${e.tradeNum}`.padStart(4) : (e.type === 'VIRTUAL' ? ' V' + String(result.allEvents.filter(x => x.type === 'VIRTUAL').indexOf(e) + 1).padStart(2) : '  --');
      const pnlStr = e.pnl !== 0 ? (e.pnl > 0 ? `+₹${e.pnl.toFixed(2)}` : `-₹${Math.abs(e.pnl).toFixed(2)}`) : '';
      const balStr = e.type === 'LIVE' ? ` [Bal: ₹${e.runningPnL.toFixed(2)}]` : '';

      console.log(`  │ ${num} │ #${e.period.padStart(5)} │ ${e.result.padEnd(14)} │ ${e.note}${pnlStr ? ' → ' + pnlStr : ''}${balStr}`);
    }

    console.log('  └──────┴─────────┴────────────────┴─────────────────────────────────────────────────────────────────┘');

    // ── Trade Summary ──
    if (result.trades.length > 0) {
      console.log('');
      console.log(`  ── LIVE Trades Summary ──`);
      console.log('  ┌──────┬─────────┬──────┬──────┬──────────┬────────────┬────────────┐');
      console.log('  │ Trade│ Period  │ Bet  │ Got  │ Result   │ P&L        │ Running    │');
      console.log('  ├──────┼─────────┼──────┼──────┼──────────┼────────────┼────────────┤');

      for (const t of result.trades) {
        const pnlStr = t.pnl > 0 ? `+₹${t.pnl.toFixed(2)}` : `-₹${Math.abs(t.pnl).toFixed(2)}`;
        const runStr = t.runningPnL >= 0 ? `+₹${t.runningPnL.toFixed(2)}` : `-₹${Math.abs(t.runningPnL).toFixed(2)}`;
        const resultStr = t.won ? '✅ WIN' : '❌ LOSS';

        console.log(`  │  T${String(t.tradeNum).padStart(2)} │ #${t.period.padStart(5)} │ ${colorEmoji(t.betColor)}   │ ${colorEmoji(t.actualColor)}   │ ${resultStr.padEnd(8)} │ ${pnlStr.padStart(10)} │ ${runStr.padStart(10)} │`);
      }

      console.log('  └──────┴─────────┴──────┴──────┴──────────┴────────────┴────────────┘');

      const wins = result.trades.filter(t => t.won).length;
      const losses = result.trades.filter(t => !t.won).length;
      const winRate = ((wins / result.trades.length) * 100).toFixed(1);

      // Streaks
      let maxL = 0, curL = 0, maxW = 0, curW = 0;
      for (const t of result.trades) {
        if (t.won) { curW++; curL = 0; if (curW > maxW) maxW = curW; }
        else { curL++; curW = 0; if (curL > maxL) maxL = curL; }
      }

      console.log('');
      console.log(`  📈 ${categoryNames[cat]} Summary:`);
      console.log(`     Total LIVE Trades: ${result.trades.length}`);
      console.log(`     Wins: ${wins} | Losses: ${losses} | Win Rate: ${winRate}%`);
      console.log(`     Virtual Bets Skipped: ${result.virtualCount}`);
      console.log(`     Max Win Streak: ${maxW} | Max Loss Streak: ${maxL}`);
      console.log(`     Net P&L: ${result.runningPnL >= 0 ? '+' : ''}₹${result.runningPnL.toFixed(2)}`);

      grandTotalPnL += result.runningPnL;
      grandTotalTrades += result.trades.length;
      grandWins += wins;
      grandLosses += losses;
      grandVirtual += result.virtualCount;
      if (maxL > grandMaxLossStreak) grandMaxLossStreak = maxL;
      if (maxW > grandMaxWinStreak) grandMaxWinStreak = maxW;
    } else {
      console.log(`\n  ⚠️ No LIVE trades triggered in ${categoryNames[cat]} (only virtual bets)`);
      grandVirtual += result.virtualCount;
    }
  }

  // ============ GRAND TOTAL ============
  console.log('\n');
  console.log('╔════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║   🏆 GRAND TOTAL — All 4 Categories Combined                                       ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════════════╝');
  console.log('');

  const grandWinRate = grandTotalTrades > 0 ? ((grandWins / grandTotalTrades) * 100).toFixed(1) : '0.0';

  console.log('  ┌────────────────────────────────────────────────────────┐');
  console.log(`  │  💰 Bet Amount:           ₹${BET_AMOUNT} per trade`.padEnd(57) + '│');
  console.log(`  │  📊 Total LIVE Trades:    ${grandTotalTrades}`.padEnd(57) + '│');
  console.log(`  │  ✅ Wins:                 ${grandWins}`.padEnd(57) + '│');
  console.log(`  │  ❌ Losses:               ${grandLosses}`.padEnd(57) + '│');
  console.log(`  │  📈 Win Rate:             ${grandWinRate}%`.padEnd(57) + '│');
  console.log(`  │  👁️ Virtual Bets (skip):   ${grandVirtual}`.padEnd(57) + '│');
  console.log('  ├────────────────────────────────────────────────────────┤');
  console.log(`  │  🔥 Max Win Streak:       ${grandMaxWinStreak}`.padEnd(57) + '│');
  console.log(`  │  💀 Max Loss Streak:      ${grandMaxLossStreak}`.padEnd(57) + '│');
  console.log('  ├────────────────────────────────────────────────────────┤');
  console.log(`  │  💵 Total Invested:       ₹${(grandTotalTrades * BET_AMOUNT).toFixed(2)}`.padEnd(57) + '│');
  console.log(`  │  💰 Total Winnings:       ₹${(grandWins * (BET_AMOUNT + WIN_PROFIT)).toFixed(2)}`.padEnd(57) + '│');
  console.log(`  │  📉 Total Lost:           ₹${(grandLosses * LOSS_AMOUNT).toFixed(2)}`.padEnd(57) + '│');
  const pnlSign = grandTotalPnL >= 0 ? '+' : '';
  const pnlEmoji = grandTotalPnL >= 0 ? '🟢' : '🔴';
  console.log(`  │  ${pnlEmoji} NET P&L:              ${pnlSign}₹${grandTotalPnL.toFixed(2)}`.padEnd(57) + '│');
  console.log('  └────────────────────────────────────────────────────────┘');

  // ROI
  if (grandTotalTrades > 0) {
    const roi = (grandTotalPnL / (grandTotalTrades * BET_AMOUNT) * 100).toFixed(1);
    console.log(`\n  📊 ROI: ${roi}% (profit per ₹ invested)`);
    console.log(`  📊 Avg P&L per trade: ${pnlSign}₹${(grandTotalPnL / grandTotalTrades).toFixed(2)}`);
  }

  // Breakeven analysis
  const breakEvenWinRate = (LOSS_AMOUNT / (WIN_PROFIT + LOSS_AMOUNT) * 100).toFixed(1);
  console.log(`\n  ⚖️ Breakeven Win Rate: ${breakEvenWinRate}% (need at least this to not lose money)`);
  console.log(`     Your Win Rate: ${grandWinRate}% ${parseFloat(grandWinRate) >= parseFloat(breakEvenWinRate) ? '✅ ABOVE breakeven!' : '❌ BELOW breakeven'}`);

  console.log('\n');
  console.log('═══════════════════════════════════════════════════════════════════════════════════════');
  console.log('  ⚠️ Note: Results are based on limited API data (~17 periods per category).');
  console.log('  For reliable results, 100+ periods are needed. Current data = snapshot only.');
  console.log('═══════════════════════════════════════════════════════════════════════════════════════');
  console.log('');
}

main().catch(console.error);
