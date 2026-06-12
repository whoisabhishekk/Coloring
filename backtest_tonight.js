#!/usr/bin/env node
/**
 * TONIGHT'S DETAILED BACKTEST: 1-Loss + TrendBreak (RGR 3-length)
 * 
 * Data: 12:00 AM (Period 001) → Now (Period 020)
 * ₹10 per trade | 1.96x payout
 */

const API_BASE = 'https://cooe02.in';
const SAAS_ID = 1;
const BET_AMOUNT = 10;
const WIN_PROFIT = BET_AMOUNT * 0.96; // ₹9.60
const LOSS_AMOUNT = BET_AMOUNT;

async function fetchSectionData(category) {
  const url = `${API_BASE}/win/next_period_info_noauth?category=${category}&saas_id=${SAAS_ID}`;
  const response = await fetch(url);
  const data = await response.json();
  return data;
}

function getColor(p) { return p.is_green ? 'G' : 'R'; }
function colorEmoji(c) { return c === 'G' ? '🟢' : '🔴'; }
function colorName(c) { return c === 'G' ? 'GREEN' : 'RED'; }

function isAlternating(colors) {
  for (let i = 1; i < colors.length; i++) {
    if (colors[i] === colors[i - 1]) return false;
  }
  return true;
}

function formatPeriod(period) {
  const s = String(period);
  return s.slice(-3); // last 3 digits = today's sequence number
}

// ============ DETAILED WALK-THROUGH BACKTEST ============
function runDetailedBacktest(periods, sectionName) {
  const events = [];
  let state = 'HUNTING';
  let activeBet = null;
  let runningPnL = 0;
  let liveTradeNum = 0;
  let totalVirtualWins = 0;
  let totalVirtualLosses = 0;
  const liveTrades = [];

  for (let i = 0; i < periods.length; i++) {
    const p = periods[i];
    const color = getColor(p);
    const pNum = formatPeriod(p.period);

    // ── Resolve bet ──
    if (activeBet && p.period === activeBet.period) {
      const actual = color;
      const won = actual === activeBet.color;

      if (activeBet.isVirtual) {
        if (won) {
          totalVirtualWins++;
          events.push({
            step: events.length + 1,
            period: pNum,
            type: '👁️ VIRTUAL RESULT',
            bet: colorEmoji(activeBet.color),
            got: colorEmoji(actual),
            result: '✅ V-WIN',
            pnl: '—',
            balance: `₹${runningPnL.toFixed(2)}`,
            explanation: `Virtual bet WIN tha — paisa nahi lagaya tha toh koi fayda nahi. Counter RESET → hunting.`
          });
          state = 'HUNTING';
        } else {
          totalVirtualLosses++;
          events.push({
            step: events.length + 1,
            period: pNum,
            type: '👁️ VIRTUAL RESULT',
            bet: colorEmoji(activeBet.color),
            got: colorEmoji(actual),
            result: '❌ V-LOSS',
            pnl: '—',
            balance: `₹${runningPnL.toFixed(2)}`,
            explanation: `Virtual loss ho gaya! ✅ Ab NEXT pattern pe ₹${BET_AMOUNT} REAL bet lagega!`
          });
          state = 'READY_FOR_LIVE';
        }
      } else {
        // LIVE trade
        liveTradeNum++;
        const pnl = won ? +WIN_PROFIT : -LOSS_AMOUNT;
        runningPnL += pnl;

        liveTrades.push({
          num: liveTradeNum,
          period: pNum,
          betColor: activeBet.color,
          actualColor: actual,
          won,
          pnl,
          runningPnL
        });

        if (won) {
          events.push({
            step: events.length + 1,
            period: pNum,
            type: '💰 LIVE RESULT',
            bet: colorEmoji(activeBet.color),
            got: colorEmoji(actual),
            result: `✅ WIN T${liveTradeNum}`,
            pnl: `+₹${WIN_PROFIT.toFixed(2)}`,
            balance: `₹${runningPnL.toFixed(2)}`,
            explanation: `LIVE bet JEET gaye! +₹${WIN_PROFIT.toFixed(2)} profit. Ab wapas hunting.`
          });
          state = 'HUNTING';
        } else {
          events.push({
            step: events.length + 1,
            period: pNum,
            type: '💰 LIVE RESULT',
            bet: colorEmoji(activeBet.color),
            got: colorEmoji(actual),
            result: `❌ LOSS T${liveTradeNum}`,
            pnl: `-₹${LOSS_AMOUNT.toFixed(2)}`,
            balance: `₹${runningPnL.toFixed(2)}`,
            explanation: `LIVE bet HAAR gaye! -₹${LOSS_AMOUNT}. Ab TREND BREAK ka wait (2 same colors chahiye).`
          });
          state = 'WAITING_FOR_TREND_BREAK';
        }
      }
      activeBet = null;
    }

    if (activeBet) continue;

    // ── Trend Break Check ──
    if (state === 'WAITING_FOR_TREND_BREAK') {
      if (i > 0 && getColor(periods[i - 1]) === color) {
        events.push({
          step: events.length + 1,
          period: pNum,
          type: '🔄 TREND BREAK',
          bet: '—',
          got: colorEmoji(color),
          result: '🔄 RESUME',
          pnl: '—',
          balance: `₹${runningPnL.toFixed(2)}`,
          explanation: `${colorEmoji(color)}${colorEmoji(color)} 2 same colors aaye → Trend break! Ab hunting resume.`
        });
        state = 'HUNTING';
      } else {
        // Still waiting
        continue;
      }
    }

    if (state !== 'HUNTING' && state !== 'READY_FOR_LIVE') continue;
    if (i < 2) continue; // Need at least 3 periods for RGR

    // ── Pattern Check ──
    const c0 = getColor(periods[i - 2]);
    const c1 = getColor(periods[i - 1]);
    const c2 = getColor(periods[i]);

    if (!isAlternating([c0, c1, c2])) continue;
    if (i + 1 >= periods.length) {
      // Pattern found but no next period to bet on
      events.push({
        step: events.length + 1,
        period: pNum,
        type: '📊 PATTERN',
        bet: '—',
        got: '—',
        result: '⏳ WAIT',
        pnl: '—',
        balance: `₹${runningPnL.toFixed(2)}`,
        explanation: `Pattern ${colorEmoji(c0)}${colorEmoji(c1)}${colorEmoji(c2)} mila! Lekin next period abhi resolve nahi hua. ${state === 'READY_FOR_LIVE' ? '🔥 LIVE bet pending!' : '👁️ Virtual bet pending.'}`
      });
      continue;
    }

    const betColor = c2; // Bet on last pattern color
    const nextPeriod = periods[i + 1].period;
    const nextPNum = formatPeriod(nextPeriod);

    if (state === 'READY_FOR_LIVE') {
      events.push({
        step: events.length + 1,
        period: pNum,
        type: '🚨 LIVE SIGNAL',
        bet: colorEmoji(betColor),
        got: '—',
        result: `🔥 BET ₹${BET_AMOUNT}`,
        pnl: '—',
        balance: `₹${runningPnL.toFixed(2)}`,
        explanation: `Pattern ${colorEmoji(c0)}${colorEmoji(c1)}${colorEmoji(c2)} → LIVE bet ${colorEmoji(betColor)} ${colorName(betColor)} on Period #${nextPNum}! ₹${BET_AMOUNT} lagaya! (Virtual loss ke baad)`
      });
      activeBet = { color: betColor, period: nextPeriod, isVirtual: false };
      state = 'SIGNAL_ACTIVE';
    } else {
      events.push({
        step: events.length + 1,
        period: pNum,
        type: '👁️ VIRTUAL BET',
        bet: colorEmoji(betColor),
        got: '—',
        result: '👁️ OBSERVE',
        pnl: '—',
        balance: `₹${runningPnL.toFixed(2)}`,
        explanation: `Pattern ${colorEmoji(c0)}${colorEmoji(c1)}${colorEmoji(c2)} → Virtual bet ${colorEmoji(betColor)} ${colorName(betColor)} on #${nextPNum}. Paisa NAHI laga rahe, sirf dekh rahe hain.`
      });
      activeBet = { color: betColor, period: nextPeriod, isVirtual: true };
    }
  }

  return { events, liveTrades, runningPnL, liveTradeNum, totalVirtualWins, totalVirtualLosses, state };
}

// ============ MAIN ============
async function main() {
  const categories = ['P', 'S', 'B', 'E'];
  const categoryNames = { P: 'Parity', S: 'Sapre', B: 'Bcone', E: 'Emerd' };
  const categoryEmojis = { P: '🟣', S: '🔵', B: '🟤', E: '🟡' };

  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║  💰 TONIGHT\'S BACKTEST — 12:00 AM se Ab Tak                                             ║');
  console.log('║  Strategy: 1-Loss + TrendBreak (RGR 3-length) | ₹10 per trade                          ║');
  console.log('╚═══════════════════════════════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`  📅 Date: ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`);
  console.log(`  ⏰ Time: 12:00 AM → ${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`);
  console.log(`  💰 Bet: ₹${BET_AMOUNT}/trade | Win: +₹${WIN_PROFIT.toFixed(2)} | Loss: -₹${LOSS_AMOUNT}`);
  console.log('');

  let grandPnL = 0;
  let grandTrades = 0;
  let grandWins = 0;
  let grandLosses = 0;
  let grandVirtualWins = 0;
  let grandVirtualLosses = 0;

  for (const cat of categories) {
    const data = await fetchSectionData(cat);
    if (!data || !data.periods) continue;

    const periods = data.periods;
    const result = runDetailedBacktest(periods, categoryNames[cat]);

    // ── Section Header ──
    console.log('');
    console.log(`${'━'.repeat(95)}`);
    console.log(`  ${categoryEmojis[cat]} ${categoryNames[cat].toUpperCase()} — ${periods.length} Periods (12 AM se ab tak)`);
    console.log(`${'━'.repeat(95)}`);

    // ── Color Sequence with Numbers ──
    console.log('');
    console.log('  📊 Color Sequence:');
    console.log('  Period:  ' + periods.map(p => formatPeriod(p.period).padStart(3)).join(' '));
    console.log('  Number:  ' + periods.map(p => String(p.last_num).padStart(3)).join(' '));
    console.log('  Color:   ' + periods.map(p => (' ' + colorEmoji(getColor(p)) + ' ')).join(''));
    console.log('');

    // ── Step-by-Step Events ──
    if (result.events.length === 0) {
      console.log('  ❌ Koi pattern nahi mila iss section mein.');
      continue;
    }

    console.log('  📝 STEP-BY-STEP WALKTHROUGH:');
    console.log('  ─'.repeat(48));

    for (const e of result.events) {
      console.log('');
      console.log(`  Step ${e.step} │ Period #${e.period} │ ${e.type}`);
      console.log(`         │ Bet: ${e.bet} │ Got: ${e.got} │ ${e.result} │ P&L: ${e.pnl} │ Balance: ${e.balance}`);
      console.log(`         └─ ${e.explanation}`);
    }

    // ── Live Trades Table ──
    if (result.liveTrades.length > 0) {
      console.log('');
      console.log(`  ── 💰 ${categoryNames[cat]} LIVE TRADES ──`);
      console.log('  ┌───────┬─────────┬────────┬────────┬──────────┬────────────┬────────────┐');
      console.log('  │ Trade │ Period  │  Bet   │  Got   │ Result   │    P&L     │  Balance   │');
      console.log('  ├───────┼─────────┼────────┼────────┼──────────┼────────────┼────────────┤');

      for (const t of result.liveTrades) {
        const pnlStr = t.pnl > 0 ? `+₹${t.pnl.toFixed(2)}` : `-₹${Math.abs(t.pnl).toFixed(2)}`;
        const balStr = t.runningPnL >= 0 ? `+₹${t.runningPnL.toFixed(2)}` : `-₹${Math.abs(t.runningPnL).toFixed(2)}`;
        const res = t.won ? '✅ WIN ' : '❌ LOSS';

        console.log(`  │  T${String(t.num).padStart(2)}  │  #${t.period.padStart(3)}   │  ${colorEmoji(t.betColor)}    │  ${colorEmoji(t.actualColor)}    │ ${res}   │ ${pnlStr.padStart(10)} │ ${balStr.padStart(10)} │`);
      }
      console.log('  └───────┴─────────┴────────┴────────┴──────────┴────────────┴────────────┘');

      const wins = result.liveTrades.filter(t => t.won).length;
      const losses = result.liveTrades.filter(t => !t.won).length;

      console.log(`\n  ${categoryEmojis[cat]} ${categoryNames[cat]}: ${wins}W/${losses}L (${(wins/(wins+losses)*100).toFixed(0)}%) | Net: ${result.runningPnL >= 0 ? '+' : ''}₹${result.runningPnL.toFixed(2)} | Virtual skipped: ${result.totalVirtualWins}W + ${result.totalVirtualLosses}L`);

      grandPnL += result.runningPnL;
      grandTrades += result.liveTrades.length;
      grandWins += wins;
      grandLosses += losses;
    } else {
      console.log(`\n  ⚠️ Koi LIVE trade trigger nahi hua ${categoryNames[cat]} mein.`);
      if (result.totalVirtualWins > 0 || result.totalVirtualLosses > 0) {
        console.log(`     Virtual: ${result.totalVirtualWins} wins + ${result.totalVirtualLosses} losses (sab virtual — paisa nahi laga)`);
      }
    }

    grandVirtualWins += result.totalVirtualWins;
    grandVirtualLosses += result.totalVirtualLosses;

    // Current state
    console.log(`  📡 Current State: ${result.state === 'HUNTING' ? '🔍 HUNTING (naya pattern dhundh raha)' : result.state === 'READY_FOR_LIVE' ? '🔥 READY! Next pattern pe LIVE bet lagega!' : result.state === 'WAITING_FOR_TREND_BREAK' ? '⏳ Trend break ka wait' : result.state}`);
  }

  // ============ GRAND TOTAL ============
  console.log('\n');
  console.log('╔═══════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║  🏆 AAJKI RAAT KA FINAL RESULT (12:00 AM → Now)                                        ║');
  console.log('╚═══════════════════════════════════════════════════════════════════════════════════════════╝');
  console.log('');

  const grandWinRate = grandTrades > 0 ? ((grandWins / grandTrades) * 100).toFixed(1) : '0.0';
  const pnlEmoji = grandPnL >= 0 ? '🟢' : '🔴';
  const pnlSign = grandPnL >= 0 ? '+' : '';

  console.log('  ┌──────────────────────────────────────────────────────────────┐');
  console.log(`  │  📅 Date:               ${new Date().toLocaleDateString('en-IN')}`.padEnd(63) + '│');
  console.log(`  │  ⏰ Period Range:        #001 → #${formatPeriod(20260612020)}`.padEnd(63) + '│');
  console.log(`  │  💰 Bet Amount:          ₹${BET_AMOUNT} per trade`.padEnd(63) + '│');
  console.log('  ├──────────────────────────────────────────────────────────────┤');
  console.log(`  │  📊 Total LIVE Trades:   ${grandTrades}`.padEnd(63) + '│');
  console.log(`  │  ✅ Wins:                ${grandWins}`.padEnd(63) + '│');
  console.log(`  │  ❌ Losses:              ${grandLosses}`.padEnd(63) + '│');
  console.log(`  │  📈 Win Rate:            ${grandWinRate}%`.padEnd(63) + '│');
  console.log('  ├──────────────────────────────────────────────────────────────┤');
  console.log(`  │  👁️ Virtual Wins (skip): ${grandVirtualWins} (ye paisa miss hua)`.padEnd(63) + '│');
  console.log(`  │  👁️ Virtual Loss (skip): ${grandVirtualLosses} (ye loss bach gaya)`.padEnd(63) + '│');
  console.log('  ├──────────────────────────────────────────────────────────────┤');
  console.log(`  │  💵 Total Lagaya:        ₹${(grandTrades * BET_AMOUNT).toFixed(2)}`.padEnd(63) + '│');
  console.log(`  │  ${pnlEmoji} NET P&L:             ${pnlSign}₹${grandPnL.toFixed(2)}`.padEnd(63) + '│');
  console.log('  └──────────────────────────────────────────────────────────────┘');

  if (grandTrades > 0) {
    const roi = (grandPnL / (grandTrades * BET_AMOUNT) * 100).toFixed(1);
    console.log(`\n  📊 ROI: ${roi}%`);
    console.log(`  📊 Per Trade Avg: ${pnlSign}₹${(grandPnL / grandTrades).toFixed(2)}`);
  }

  // Per category summary table
  console.log('\n  ── Per Category Summary ──');
  console.log('  ┌─────────┬────────┬──────┬──────┬────────┬────────────┐');
  console.log('  │ Section │ Trades │ Wins │ Loss │ Win%   │ Net P&L    │');
  console.log('  ├─────────┼────────┼──────┼──────┼────────┼────────────┤');

  // Re-fetch and compute per category
  for (const cat of categories) {
    const data = await fetchSectionData(cat);
    if (!data || !data.periods) continue;
    const result = runDetailedBacktest(data.periods, categoryNames[cat]);
    const w = result.liveTrades.filter(t => t.won).length;
    const l = result.liveTrades.filter(t => !t.won).length;
    const total = w + l;
    const wr = total > 0 ? ((w / total) * 100).toFixed(1) : '—';
    const pnl = result.runningPnL;
    const pStr = pnl >= 0 ? `+₹${pnl.toFixed(2)}` : `-₹${Math.abs(pnl).toFixed(2)}`;

    console.log(`  │ ${categoryNames[cat].padEnd(7)} │ ${String(total).padStart(6)} │ ${String(w).padStart(4)} │ ${String(l).padStart(4)} │ ${String(wr + (total > 0 ? '%' : '')).padStart(6)} │ ${pStr.padStart(10)} │`);
  }
  console.log('  └─────────┴────────┴──────┴──────┴────────┴────────────┘');

  const breakEven = (LOSS_AMOUNT / (WIN_PROFIT + LOSS_AMOUNT) * 100).toFixed(1);
  console.log(`\n  ⚖️ Breakeven: ${breakEven}% | Tumhara: ${grandWinRate}% ${parseFloat(grandWinRate) >= parseFloat(breakEven) ? '✅ PROFIT ZONE' : '❌ LOSS ZONE'}`);
  console.log('');
}

main().catch(console.error);
