#!/usr/bin/env node
/**
 * MEGA BACKTEST: Streak Continue Strategy — All Lengths (2 to 10)
 * 
 * Test: N same colors aane pe bet SAME color
 * Both: Flat ₹10 AND Martingale (₹10→₹20→₹40→₹80)
 * Per section results
 */

const API_BASE = 'https://cooe02.in';
const SAAS_ID = 1;
const BET_LEVELS = [10, 20, 40, 80];
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

// ============ BACKTEST: Streak Continue ============
function backtestStreakContinue(periods, streakLength) {
  const trades = [];
  let activeBet = null;

  for (let i = 0; i < periods.length; i++) {
    if (activeBet && periods[i].period === activeBet.period) {
      const actualColor = getColor(periods[i]);
      const won = actualColor === activeBet.color;
      trades.push({ won });
      activeBet = null;
    }

    if (activeBet) continue;
    if (i < streakLength - 1) continue;

    const colors = [];
    for (let j = i - streakLength + 1; j <= i; j++) {
      colors.push(getColor(periods[j]));
    }
    if (!colors.every(c => c === colors[0])) continue;
    if (i + 1 >= periods.length) continue;

    activeBet = {
      color: colors[0],
      period: periods[i + 1].period,
    };
  }

  return trades;
}

// ============ CALCULATE PNL ============
function calcFlat(trades, bet = 10) {
  let pnl = 0;
  let maxDD = 0, peak = 0;
  let maxLoss = 0, maxWin = 0, cl = 0, cw = 0;

  for (const t of trades) {
    if (t.won) {
      pnl += bet * WIN_MULTIPLIER;
      cw++; cl = 0;
      if (cw > maxWin) maxWin = cw;
    } else {
      pnl -= bet;
      cl++; cw = 0;
      if (cl > maxLoss) maxLoss = cl;
    }
    if (pnl > peak) peak = pnl;
    const dd = peak - pnl;
    if (dd > maxDD) maxDD = dd;
  }

  const wins = trades.filter(t => t.won).length;
  return { pnl, wins, losses: trades.length - wins, maxLoss, maxWin, maxDD };
}

function calcMartingale(trades) {
  let pnl = 0, level = 0;
  let maxDD = 0, peak = 0;
  let maxLoss = 0, maxWin = 0, cl = 0, cw = 0;
  let fullCycleLoss = 0;

  for (const t of trades) {
    const bet = BET_LEVELS[level];
    if (t.won) {
      pnl += bet * WIN_MULTIPLIER;
      level = 0;
      cw++; cl = 0;
      if (cw > maxWin) maxWin = cw;
    } else {
      pnl -= bet;
      level++;
      if (level >= BET_LEVELS.length) { fullCycleLoss++; level = 0; }
      cl++; cw = 0;
      if (cl > maxLoss) maxLoss = cl;
    }
    if (pnl > peak) peak = pnl;
    const dd = peak - pnl;
    if (dd > maxDD) maxDD = dd;
  }

  const wins = trades.filter(t => t.won).length;
  return { pnl, wins, losses: trades.length - wins, maxLoss, maxWin, maxDD, fullCycleLoss };
}

// ============ MAIN ============
async function main() {
  const categories = ['P', 'S', 'B', 'E'];
  const categoryNames = { P: 'Parity', S: 'Sapre', B: 'Bcone', E: 'Emerd' };
  const STREAK_RANGE = [2, 3, 4, 5, 6, 7, 8, 9, 10];

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║  🎯 MEGA BACKTEST: Kitne Same Colors Ke Baad Bet Lagayen? (2 to 10)               🎯   ║');
  console.log('╠══════════════════════════════════════════════════════════════════════════════════════════╣');
  console.log('║  Test: N same colors → bet SAME color (streak continue)                                ║');
  console.log('║  Flat ₹10 AND Martingale (₹10→₹20→₹40→₹80) dono test                                  ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════════════════╝');
  console.log('');

  const allPeriods = {};
  for (const cat of categories) {
    const data = await fetchSectionData(cat);
    if (!data || !data.periods) continue;
    allPeriods[cat] = data.periods;
    console.log(`  ✅ ${categoryNames[cat]}: ${data.periods.length} periods`);
  }
  console.log('');

  // ═══════════════════════════════════════════════
  // PART 1: FLAT ₹10 — All streaks, all sections
  // ═══════════════════════════════════════════════
  console.log('╔══════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║  📊 PART 1: FLAT ₹10 BET — Per Section, Per Streak Length                              ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════════════════╝');
  console.log('');

  // Header
  console.log('  Streak │ Parity          │ Sapre           │ Bcone           │ Emerd           │ TOTAL');
  console.log('         │ Sig W%  PnL     │ Sig W%  PnL     │ Sig W%  PnL     │ Sig W%  PnL     │ Sig W%  PnL');
  console.log('  ───────┼─────────────────┼─────────────────┼─────────────────┼─────────────────┼─────────────────');

  const flatResults = {};

  for (const n of STREAK_RANGE) {
    let totalSig = 0, totalWins = 0, totalPnl = 0;
    let row = `  ${String(n).padStart(4)}×  │`;
    flatResults[n] = {};

    for (const cat of categories) {
      const periods = allPeriods[cat];
      if (!periods) { row += '       -        │'; continue; }
      const trades = backtestStreakContinue(periods, n);
      const r = calcFlat(trades);
      flatResults[n][cat] = { ...r, signals: trades.length };

      const pnlStr = (r.pnl >= 0 ? '+' : '') + r.pnl.toFixed(0);
      const wrStr = trades.length > 0 ? ((r.wins / trades.length) * 100).toFixed(0) + '%' : '  -';
      const icon = r.pnl >= 0 ? '✅' : '❌';

      row += ` ${String(trades.length).padStart(3)} ${wrStr.padStart(3)} ${(pnlStr).padStart(5)}${icon} │`;
      totalSig += trades.length;
      totalWins += r.wins;
      totalPnl += r.pnl;
    }

    const tWrStr = totalSig > 0 ? ((totalWins / totalSig) * 100).toFixed(0) + '%' : '  -';
    const tPnlStr = (totalPnl >= 0 ? '+' : '') + totalPnl.toFixed(0);
    const tIcon = totalPnl >= 0 ? '✅' : '❌';
    row += ` ${String(totalSig).padStart(3)} ${tWrStr.padStart(3)} ${tPnlStr.padStart(5)}${tIcon}`;

    console.log(row);
  }

  // ═══════════════════════════════════════════════
  // PART 2: MARTINGALE — All streaks, all sections
  // ═══════════════════════════════════════════════
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║  📊 PART 2: MARTINGALE (₹10→₹20→₹40→₹80) — Per Section, Per Streak Length              ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════════════════╝');
  console.log('');

  console.log('  Streak │ Parity          │ Sapre           │ Bcone           │ Emerd           │ TOTAL');
  console.log('         │ Sig W%  PnL     │ Sig W%  PnL     │ Sig W%  PnL     │ Sig W%  PnL     │ Sig W%  PnL');
  console.log('  ───────┼─────────────────┼─────────────────┼─────────────────┼─────────────────┼─────────────────');

  const martResults = {};

  for (const n of STREAK_RANGE) {
    let totalSig = 0, totalWins = 0, totalPnl = 0;
    let row = `  ${String(n).padStart(4)}×  │`;
    martResults[n] = {};

    for (const cat of categories) {
      const periods = allPeriods[cat];
      if (!periods) { row += '       -        │'; continue; }
      const trades = backtestStreakContinue(periods, n);
      const r = calcMartingale(trades);
      martResults[n][cat] = { ...r, signals: trades.length };

      const pnlStr = (r.pnl >= 0 ? '+' : '') + r.pnl.toFixed(0);
      const wrStr = trades.length > 0 ? ((r.wins / trades.length) * 100).toFixed(0) + '%' : '  -';
      const icon = r.pnl >= 0 ? '✅' : '❌';

      row += ` ${String(trades.length).padStart(3)} ${wrStr.padStart(3)} ${(pnlStr).padStart(5)}${icon} │`;
      totalSig += trades.length;
      totalWins += r.wins;
      totalPnl += r.pnl;
    }

    const tWrStr = totalSig > 0 ? ((totalWins / totalSig) * 100).toFixed(0) + '%' : '  -';
    const tPnlStr = (totalPnl >= 0 ? '+' : '') + totalPnl.toFixed(0);
    const tIcon = totalPnl >= 0 ? '✅' : '❌';
    row += ` ${String(totalSig).padStart(3)} ${tWrStr.padStart(3)} ${tPnlStr.padStart(5)}${tIcon}`;

    console.log(row);
  }

  // ═══════════════════════════════════════════════
  // PART 3: DETAILED — Max consecutive loss per streak per section
  // ═══════════════════════════════════════════════
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║  📊 PART 3: MAX CONSECUTIVE LOSSES — Per Section, Per Streak Length                     ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════════════════╝');
  console.log('');

  console.log('  Streak │ Parity │ Sapre │ Bcone │ Emerd │ Safe for Martingale?');
  console.log('  ───────┼────────┼───────┼───────┼───────┼─────────────────────');

  for (const n of STREAK_RANGE) {
    let maxAll = 0;
    let row = `  ${String(n).padStart(4)}×  │`;
    for (const cat of categories) {
      const r = flatResults[n][cat];
      if (!r) { row += '     - │'; continue; }
      const icon = r.maxLoss <= 3 ? '✅' : r.maxLoss <= 4 ? '⚠️' : '💀';
      row += ` ${String(r.maxLoss).padStart(4)}${icon} │`;
      if (r.maxLoss > maxAll) maxAll = r.maxLoss;
    }
    const safe = maxAll <= 3 ? '✅ YES (max ' + maxAll + 'L)' :
                 maxAll <= 4 ? '⚠️ RISKY (max ' + maxAll + 'L)' :
                 '❌ NO (max ' + maxAll + 'L — will fail!)';
    row += ` ${safe}`;
    console.log(row);
  }

  // ═══════════════════════════════════════════════
  // PART 4: FULL CYCLE LOSSES (Martingale failures)
  // ═══════════════════════════════════════════════
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║  📊 PART 4: MARTINGALE FULL CYCLE LOSSES (💀 -₹150 each)                               ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════════════════╝');
  console.log('');

  console.log('  Streak │ Parity │ Sapre │ Bcone │ Emerd │ Total │ Total Loss');
  console.log('  ───────┼────────┼───────┼───────┼───────┼───────┼───────────');

  for (const n of STREAK_RANGE) {
    let total = 0;
    let row = `  ${String(n).padStart(4)}×  │`;
    for (const cat of categories) {
      const r = martResults[n][cat];
      if (!r) { row += '     - │'; continue; }
      const icon = r.fullCycleLoss === 0 ? '✅' : '💀';
      row += ` ${String(r.fullCycleLoss).padStart(4)}${icon} │`;
      total += r.fullCycleLoss;
    }
    const totalLoss = total * 150;
    row += ` ${String(total).padStart(5)} │ -₹${totalLoss}`;
    console.log(row);
  }

  // ═══════════════════════════════════════════════
  // PART 5: BEST COMBO FINDER
  // ═══════════════════════════════════════════════
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║  🏆 BEST COMBINATIONS — Streak + Section (Sorted by Profit)                            ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════════════════╝');
  console.log('');

  // Collect all combos
  const combos = [];
  for (const n of STREAK_RANGE) {
    for (const cat of categories) {
      const flat = flatResults[n][cat];
      const mart = martResults[n][cat];
      if (!flat || flat.signals === 0) continue;
      const wr = ((flat.wins / flat.signals) * 100).toFixed(1);
      combos.push({
        streak: n,
        section: categoryNames[cat],
        signals: flat.signals,
        winRate: wr,
        flatPnl: flat.pnl,
        martPnl: mart.pnl,
        maxLoss: flat.maxLoss,
        fullCycle: mart.fullCycleLoss,
      });
    }
  }

  // Sort by martingale PnL
  console.log('  ── Top 10 by Martingale Profit ──');
  console.log('');
  console.log('  Rank │ Streak │ Section │ Sig │ Win%  │ Flat PnL │ Mart PnL │ MaxL │ 💀');
  console.log('  ─────┼────────┼─────────┼─────┼───────┼──────────┼──────────┼──────┼───');

  const topMart = [...combos].sort((a, b) => b.martPnl - a.martPnl).slice(0, 10);
  topMart.forEach((c, i) => {
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '  ';
    const fStr = (c.flatPnl >= 0 ? '+₹' : '-₹') + Math.abs(c.flatPnl).toFixed(0);
    const mStr = (c.martPnl >= 0 ? '+₹' : '-₹') + Math.abs(c.martPnl).toFixed(0);
    console.log(
      `  ${medal}   │ ${String(c.streak).padStart(4)}×  │ ${c.section.padEnd(7)} │ ${String(c.signals).padStart(3)} │ ${(c.winRate + '%').padStart(5)} │ ${fStr.padStart(8)} │ ${mStr.padStart(8)} │ ${String(c.maxLoss).padStart(4)} │ ${c.fullCycle}`
    );
  });

  // Top by flat PnL
  console.log('');
  console.log('  ── Top 10 by Flat ₹10 Profit ──');
  console.log('');
  console.log('  Rank │ Streak │ Section │ Sig │ Win%  │ Flat PnL │ Mart PnL │ MaxL │ 💀');
  console.log('  ─────┼────────┼─────────┼─────┼───────┼──────────┼──────────┼──────┼───');

  const topFlat = [...combos].sort((a, b) => b.flatPnl - a.flatPnl).slice(0, 10);
  topFlat.forEach((c, i) => {
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '  ';
    const fStr = (c.flatPnl >= 0 ? '+₹' : '-₹') + Math.abs(c.flatPnl).toFixed(0);
    const mStr = (c.martPnl >= 0 ? '+₹' : '-₹') + Math.abs(c.martPnl).toFixed(0);
    console.log(
      `  ${medal}   │ ${String(c.streak).padStart(4)}×  │ ${c.section.padEnd(7)} │ ${String(c.signals).padStart(3)} │ ${(c.winRate + '%').padStart(5)} │ ${fStr.padStart(8)} │ ${mStr.padStart(8)} │ ${String(c.maxLoss).padStart(4)} │ ${c.fullCycle}`
    );
  });

  // Best safe combo (max loss <= 3, profitable)
  console.log('');
  console.log('  ── 🛡️ SAFEST Profitable Combos (Max 3 consecutive loss, Martingale safe) ──');
  console.log('');
  const safeCombos = combos.filter(c => c.maxLoss <= 3 && c.martPnl > 0).sort((a, b) => b.martPnl - a.martPnl);
  if (safeCombos.length === 0) {
    console.log('    ⚠️ No combo with max 3 consecutive loss AND profit found!');
  } else {
    console.log('  Rank │ Streak │ Section │ Sig │ Win%  │ Flat PnL │ Mart PnL │ MaxL │ 💀');
    console.log('  ─────┼────────┼─────────┼─────┼───────┼──────────┼──────────┼──────┼───');
    safeCombos.forEach((c, i) => {
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '  ';
      const fStr = (c.flatPnl >= 0 ? '+₹' : '-₹') + Math.abs(c.flatPnl).toFixed(0);
      const mStr = (c.martPnl >= 0 ? '+₹' : '-₹') + Math.abs(c.martPnl).toFixed(0);
      console.log(
        `  ${medal}   │ ${String(c.streak).padStart(4)}×  │ ${c.section.padEnd(7)} │ ${String(c.signals).padStart(3)} │ ${(c.winRate + '%').padStart(5)} │ ${fStr.padStart(8)} │ ${mStr.padStart(8)} │ ${String(c.maxLoss).padStart(4)} │ ${c.fullCycle}`
      );
    });
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════════════');
  console.log('');
}

main().catch(console.error);
