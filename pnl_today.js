#!/usr/bin/env node
/**
 * TODAY's PNL Calculator — Recovery 3-Chance with Custom Bet Amounts
 * 
 * Strategy: RECOVERY_3_CHANCE (RGRG 4-length pattern)
 * 
 * Bet Amounts:
 *   - V Bet #1 (1st virtual/recovery): ₹10
 *   - V Bet #2 (2nd virtual/recovery): ₹30
 *   - V Bet #3 (3rd virtual/recovery): ₹90
 *   - 4th Signal (original/live): ₹100
 * 
 * Wait — user clarified: "V bet" means the virtual bets that the SNIPER strategy
 * tracks. After 3 virtual losses, the 4th signal is the LIVE bet.
 * 
 * But re-reading: "paise lagayunga" = "I will put money" — so ALL bets are REAL.
 * This is a MARTINGALE-style approach on top of Recovery 3-Chance:
 *   - 1st signal: ₹10
 *   - 2nd signal (recovery): ₹30
 *   - 3rd signal (recovery): ₹90
 *   - After winning or all 3 lost → reset
 *   - 4th signal = ₹100 (the system's original signal on SNIPER)
 * 
 * ACTUALLY re-reading more carefully:
 * "jese hi v bet aagyi" = "as soon as virtual bet comes"
 * 
 * So the user wants to PUT REAL MONEY on the virtual bets too:
 *   - Virtual Bet 1 → ₹10
 *   - Virtual Bet 2 → ₹30
 *   - Virtual Bet 3 → ₹90
 *   - After 3 V losses → 4th Original Signal → ₹100
 * 
 * This is SNIPER_3_LOSS_RGRG strategy but betting real money on virtuals too.
 * 
 * Payout: 1.96x (net profit = bet * 0.96 on win)
 */

const API_BASE = 'https://cooe02.in';
const SAAS_ID = 1;

// Bet amounts for each step
const BET_AMOUNTS = {
  virtual1: 10,    // 1st V bet
  virtual2: 30,    // 2nd V bet
  virtual3: 90,    // 3rd V bet
  live: 100,       // 4th signal (original live signal after 3 V losses)
};

const WIN_MULTIPLIER = 0.96; // Net profit per ₹1 bet on win (1.96x payout)

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

/**
 * Simulate SNIPER_3_LOSS with real money on all bets (including virtual)
 * 
 * Logic:
 *   HUNTING → detect RGRG pattern → V Bet #1 (₹10)
 *     WIN → pocket profit, reset to HUNTING
 *     LOSS → virtualLossCount = 1, keep HUNTING
 *   HUNTING → detect RGRG pattern → V Bet #2 (₹30)
 *     WIN → pocket profit, reset to HUNTING
 *     LOSS → virtualLossCount = 2, keep HUNTING
 *   HUNTING → detect RGRG pattern → V Bet #3 (₹90)
 *     WIN → pocket profit, reset to HUNTING
 *     LOSS → virtualLossCount = 3, READY_FOR_LIVE
 *   HUNTING/READY_FOR_LIVE → detect RGRG pattern → LIVE Signal (₹100)
 *     WIN → pocket profit, reset
 *     LOSS → reset to HUNTING (wait for trend break in original strategy)
 */
function simulatePNL(periods) {
  const results = {
    totalBets: 0,
    wins: 0,
    losses: 0,
    totalInvested: 0,
    totalReturned: 0,
    pnl: 0,
    trades: [],
    // Per-step breakdown
    v1_bets: 0, v1_wins: 0, v1_losses: 0, v1_invested: 0, v1_profit: 0,
    v2_bets: 0, v2_wins: 0, v2_losses: 0, v2_invested: 0, v2_profit: 0,
    v3_bets: 0, v3_wins: 0, v3_losses: 0, v3_invested: 0, v3_profit: 0,
    live_bets: 0, live_wins: 0, live_losses: 0, live_invested: 0, live_profit: 0,
  };

  let state = 'HUNTING';
  let virtualLossCount = 0;
  let activeBet = null;

  for (let i = 0; i < periods.length; i++) {
    // Resolve active bet
    if (activeBet && periods[i].period === activeBet.period) {
      const actualColor = getColor(periods[i]);
      const won = actualColor === activeBet.color;
      const betAmount = activeBet.betAmount;
      const step = activeBet.step;

      results.totalBets++;
      results.totalInvested += betAmount;

      const profitLoss = won ? (betAmount * WIN_MULTIPLIER) : -betAmount;
      if (won) {
        results.wins++;
        results.totalReturned += betAmount + (betAmount * WIN_MULTIPLIER);
      } else {
        results.losses++;
      }

      results.trades.push({
        period: periods[i].period,
        betColor: activeBet.color,
        actualColor,
        won,
        betAmount,
        profitLoss,
        step,
        runningPNL: 0, // will calculate after
      });

      // Update per-step stats
      if (step === 'V1') {
        results.v1_bets++; results.v1_invested += betAmount;
        if (won) { results.v1_wins++; results.v1_profit += betAmount * WIN_MULTIPLIER; }
        else { results.v1_losses++; results.v1_profit -= betAmount; }
      } else if (step === 'V2') {
        results.v2_bets++; results.v2_invested += betAmount;
        if (won) { results.v2_wins++; results.v2_profit += betAmount * WIN_MULTIPLIER; }
        else { results.v2_losses++; results.v2_profit -= betAmount; }
      } else if (step === 'V3') {
        results.v3_bets++; results.v3_invested += betAmount;
        if (won) { results.v3_wins++; results.v3_profit += betAmount * WIN_MULTIPLIER; }
        else { results.v3_losses++; results.v3_profit -= betAmount; }
      } else if (step === 'LIVE') {
        results.live_bets++; results.live_invested += betAmount;
        if (won) { results.live_wins++; results.live_profit += betAmount * WIN_MULTIPLIER; }
        else { results.live_losses++; results.live_profit -= betAmount; }
      }

      // State transitions
      if (won) {
        virtualLossCount = 0;
        state = 'HUNTING';
      } else {
        if (step === 'LIVE') {
          // After live loss → wait for trend break then reset
          state = 'WAITING_FOR_TREND_BREAK';
          virtualLossCount = 0;
        } else {
          virtualLossCount++;
          if (virtualLossCount >= 3) {
            state = 'READY_FOR_LIVE';
          } else {
            state = 'HUNTING';
          }
        }
      }

      activeBet = null;
    }

    if (activeBet) continue;

    // Check for trend break if waiting
    if (state === 'WAITING_FOR_TREND_BREAK') {
      if (i > 0 && getColor(periods[i - 1]) === getColor(periods[i])) {
        state = 'HUNTING';
        virtualLossCount = 0;
      }
    }

    if (state !== 'HUNTING' && state !== 'READY_FOR_LIVE') continue;
    if (i < 3) continue;

    const colors = [i-3, i-2, i-1, i].map(j => getColor(periods[j]));
    if (!isAlternating(colors)) continue;
    if (i + 1 >= periods.length) continue;

    const betColor = colors[3]; // same as last color in pattern
    const nextPeriod = periods[i + 1].period;

    if (state === 'READY_FOR_LIVE') {
      // 4th signal = LIVE bet ₹100
      activeBet = { color: betColor, period: nextPeriod, betAmount: BET_AMOUNTS.live, step: 'LIVE' };
      state = 'SIGNAL_ACTIVE';
    } else {
      // Virtual bet with real money
      let betAmount, step;
      if (virtualLossCount === 0) { betAmount = BET_AMOUNTS.virtual1; step = 'V1'; }
      else if (virtualLossCount === 1) { betAmount = BET_AMOUNTS.virtual2; step = 'V2'; }
      else if (virtualLossCount === 2) { betAmount = BET_AMOUNTS.virtual3; step = 'V3'; }
      else { betAmount = BET_AMOUNTS.virtual1; step = 'V1'; }

      activeBet = { color: betColor, period: nextPeriod, betAmount, step };
    }
  }

  // Calculate running PNL
  let runningPNL = 0;
  for (const trade of results.trades) {
    runningPNL += trade.profitLoss;
    trade.runningPNL = runningPNL;
  }

  results.pnl = runningPNL;
  return results;
}


// ============ MAIN ============
async function main() {
  const categories = ['P', 'S', 'B', 'E'];
  const categoryNames = { P: 'Parity', S: 'Sapre', B: 'Bcone', E: 'Emerd' };

  console.log('');
  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║   💰 TODAY\'s PNL CALCULATOR — Custom Bet Amounts on SNIPER Strategy      ║');
  console.log('╠════════════════════════════════════════════════════════════════════════════╣');
  console.log('║   V Bet #1 = ₹10  │  V Bet #2 = ₹30  │  V Bet #3 = ₹90                 ║');
  console.log('║   4th Live Signal = ₹100  │  Payout = 1.96x (0.96 net)                  ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝');
  console.log('');

  // Fetch all data
  let grandTotal = {
    totalBets: 0, wins: 0, losses: 0,
    totalInvested: 0, pnl: 0,
    v1_bets: 0, v1_wins: 0, v1_losses: 0, v1_invested: 0, v1_profit: 0,
    v2_bets: 0, v2_wins: 0, v2_losses: 0, v2_invested: 0, v2_profit: 0,
    v3_bets: 0, v3_wins: 0, v3_losses: 0, v3_invested: 0, v3_profit: 0,
    live_bets: 0, live_wins: 0, live_losses: 0, live_invested: 0, live_profit: 0,
  };

  for (const cat of categories) {
    const data = await fetchSectionData(cat);
    if (!data || !data.periods) {
      console.log(`  ⚠️ No data for ${categoryNames[cat]}`);
      continue;
    }

    const periods = data.periods;
    console.log(`  ✅ ${categoryNames[cat]}: ${periods.length} periods loaded`);

    const result = simulatePNL(periods);

    // Print per-category results
    console.log('');
    console.log(`  ─── ${categoryNames[cat]} Results ───`);
    console.log(`  Total Bets: ${result.totalBets} | Wins: ${result.wins} | Losses: ${result.losses} | Win%: ${result.totalBets > 0 ? ((result.wins / result.totalBets) * 100).toFixed(1) : 0}%`);
    console.log(`  Total Invested: ₹${result.totalInvested} | PNL: ${result.pnl >= 0 ? '+' : ''}₹${result.pnl.toFixed(0)}`);
    
    // Print each trade
    if (result.trades.length > 0) {
      console.log('');
      console.log('  #  │ Period     │ Step │ Bet  │ Color  │ Result │ P/L     │ Running PNL');
      console.log('  ───┼────────────┼──────┼──────┼────────┼────────┼─────────┼────────────');
      
      result.trades.forEach((t, idx) => {
        const periodStr = String(t.period).slice(-5);
        const resultStr = t.won ? '  ✅ W' : '  ❌ L';
        const plStr = t.profitLoss >= 0 ? `+₹${t.profitLoss.toFixed(0)}` : `-₹${Math.abs(t.profitLoss).toFixed(0)}`;
        const runStr = t.runningPNL >= 0 ? `+₹${t.runningPNL.toFixed(0)}` : `-₹${Math.abs(t.runningPNL).toFixed(0)}`;
        const betColorStr = t.betColor === 'G' ? '🟢 GRN' : '🔴 RED';
        
        console.log(
          `  ${String(idx + 1).padStart(2)} │ ${periodStr.padStart(10)} │ ${t.step.padEnd(4)} │ ₹${String(t.betAmount).padStart(3)} │ ${betColorStr} │ ${resultStr} │ ${plStr.padStart(7)} │ ${runStr}`
        );
      });
    }

    // Aggregate
    grandTotal.totalBets += result.totalBets;
    grandTotal.wins += result.wins;
    grandTotal.losses += result.losses;
    grandTotal.totalInvested += result.totalInvested;
    grandTotal.pnl += result.pnl;
    grandTotal.v1_bets += result.v1_bets;
    grandTotal.v1_wins += result.v1_wins;
    grandTotal.v1_losses += result.v1_losses;
    grandTotal.v1_invested += result.v1_invested;
    grandTotal.v1_profit += result.v1_profit;
    grandTotal.v2_bets += result.v2_bets;
    grandTotal.v2_wins += result.v2_wins;
    grandTotal.v2_losses += result.v2_losses;
    grandTotal.v2_invested += result.v2_invested;
    grandTotal.v2_profit += result.v2_profit;
    grandTotal.v3_bets += result.v3_bets;
    grandTotal.v3_wins += result.v3_wins;
    grandTotal.v3_losses += result.v3_losses;
    grandTotal.v3_invested += result.v3_invested;
    grandTotal.v3_profit += result.v3_profit;
    grandTotal.live_bets += result.live_bets;
    grandTotal.live_wins += result.live_wins;
    grandTotal.live_losses += result.live_losses;
    grandTotal.live_invested += result.live_invested;
    grandTotal.live_profit += result.live_profit;
  }

  // ============ GRAND TOTAL ============
  console.log('');
  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║   📊 GRAND TOTAL — ALL 4 SECTIONS COMBINED                               ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`  Total Bets:     ${grandTotal.totalBets}`);
  console.log(`  Wins:           ${grandTotal.wins} ✅`);
  console.log(`  Losses:         ${grandTotal.losses} ❌`);
  console.log(`  Win Rate:       ${grandTotal.totalBets > 0 ? ((grandTotal.wins / grandTotal.totalBets) * 100).toFixed(1) : 0}%`);
  console.log(`  Total Invested: ₹${grandTotal.totalInvested}`);
  console.log('');

  // Per-step breakdown
  console.log('  ┌──────────────┬───────┬──────┬──────┬────────────┬────────────┐');
  console.log('  │ Step         │ Bets  │ Wins │ Loss │ Invested   │ P/L        │');
  console.log('  ├──────────────┼───────┼──────┼──────┼────────────┼────────────┤');
  
  const steps = [
    { name: 'V Bet #1 (₹10)', bets: grandTotal.v1_bets, wins: grandTotal.v1_wins, losses: grandTotal.v1_losses, invested: grandTotal.v1_invested, profit: grandTotal.v1_profit },
    { name: 'V Bet #2 (₹30)', bets: grandTotal.v2_bets, wins: grandTotal.v2_wins, losses: grandTotal.v2_losses, invested: grandTotal.v2_invested, profit: grandTotal.v2_profit },
    { name: 'V Bet #3 (₹90)', bets: grandTotal.v3_bets, wins: grandTotal.v3_wins, losses: grandTotal.v3_losses, invested: grandTotal.v3_invested, profit: grandTotal.v3_profit },
    { name: 'LIVE (₹100)',     bets: grandTotal.live_bets, wins: grandTotal.live_wins, losses: grandTotal.live_losses, invested: grandTotal.live_invested, profit: grandTotal.live_profit },
  ];

  steps.forEach(s => {
    const plStr = s.profit >= 0 ? `+₹${s.profit.toFixed(0)}` : `-₹${Math.abs(s.profit).toFixed(0)}`;
    console.log(
      `  │ ${s.name.padEnd(12)} │ ${String(s.bets).padStart(5)} │ ${String(s.wins).padStart(4)} │ ${String(s.losses).padStart(4)} │ ₹${String(s.invested).padStart(9)} │ ${plStr.padStart(10)} │`
    );
  });
  
  console.log('  ├──────────────┼───────┼──────┼──────┼────────────┼────────────┤');
  const totalPLStr = grandTotal.pnl >= 0 ? `+₹${grandTotal.pnl.toFixed(0)}` : `-₹${Math.abs(grandTotal.pnl).toFixed(0)}`;
  console.log(
    `  │ TOTAL        │ ${String(grandTotal.totalBets).padStart(5)} │ ${String(grandTotal.wins).padStart(4)} │ ${String(grandTotal.losses).padStart(4)} │ ₹${String(grandTotal.totalInvested).padStart(9)} │ ${totalPLStr.padStart(10)} │`
  );
  console.log('  └──────────────┴───────┴──────┴──────┴────────────┴────────────┘');

  console.log('');
  if (grandTotal.pnl >= 0) {
    console.log(`  🎉 TODAY's NET PROFIT:  +₹${grandTotal.pnl.toFixed(0)}`);
  } else {
    console.log(`  💔 TODAY's NET LOSS:    -₹${Math.abs(grandTotal.pnl).toFixed(0)}`);
  }
  console.log(`  💵 ROI: ${grandTotal.totalInvested > 0 ? ((grandTotal.pnl / grandTotal.totalInvested) * 100).toFixed(1) : 0}%`);
  console.log('');

  // Martingale cycle analysis
  console.log('  ─── 🔄 Cycle Analysis ───');
  console.log('  If V1(₹10) wins:  profit = +₹9.6');
  console.log('  If V1 loses, V2(₹30) wins:  profit = +₹28.8 - ₹10 = +₹18.8');
  console.log('  If V1,V2 lose, V3(₹90) wins:  profit = +₹86.4 - ₹40 = +₹46.4');
  console.log('  If V1,V2,V3 lose, LIVE(₹100) wins:  profit = +₹96 - ₹130 = -₹34');
  console.log('  If ALL 4 lose:  loss = -(₹10+₹30+₹90+₹100) = -₹230');
  console.log('');
  console.log('══════════════════════════════════════════════════════════════════════════════');
}

main().catch(console.error);
