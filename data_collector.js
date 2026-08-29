#!/usr/bin/env node
/**
 * 📦 DATA COLLECTOR — Continuously fetches and stores all period data
 * 
 * Run: node data_collector.js
 * 
 * - Polls API every 30 seconds
 * - Stores unique periods to daily JSONL files in data/ folder
 * - Each line: {"ts":"...","cat":"P","period":123,"is_green":true,"number":5}
 * - Safe to restart — deduplicates automatically
 * 
 * Files created:
 *   data/2026-07-01.jsonl
 *   data/2026-07-02.jsonl
 *   ...
 */

const fs = require('fs');
const path = require('path');

const API_BASE = 'https://cooe02.in';
const SAAS_ID = 1;
const POLL_INTERVAL = 30000; // 30 seconds
const DATA_DIR = path.join(__dirname, 'data');
const CATEGORIES = ['P', 'S', 'B', 'E'];
const CATEGORY_NAMES = { P: 'Parity', S: 'Sapre', B: 'Bcone', E: 'Emerd' };

// Track seen periods to avoid duplicates within a session
const seenPeriods = new Set();

// ============ FILE HELPERS ============

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    console.log(`📁 Created data directory: ${DATA_DIR}`);
  }
}

function getTodayFile() {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
  return path.join(DATA_DIR, `${dateStr}.jsonl`);
}

function loadExistingPeriods(filePath) {
  if (!fs.existsSync(filePath)) return new Set();
  
  const lines = fs.readFileSync(filePath, 'utf-8').trim().split('\n').filter(Boolean);
  const periods = new Set();
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      periods.add(`${entry.cat}_${entry.period}`);
    } catch (e) {
      // Skip malformed lines
    }
  }
  return periods;
}

function appendEntry(filePath, entry) {
  fs.appendFileSync(filePath, JSON.stringify(entry) + '\n');
}

// ============ API FETCH ============

async function fetchSectionData(category) {
  const url = `${API_BASE}/win/next_period_info_noauth?category=${category}&saas_id=${SAAS_ID}`;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (data.code !== 200) throw new Error(`API error code: ${data.code}`);
    return data;
  } catch (err) {
    // Silently retry on network errors
    return null;
  }
}

// ============ COLLECTOR LOGIC ============

let totalStored = 0;
let sessionStart = Date.now();

async function collectOnce() {
  const filePath = getTodayFile();
  const existingPeriods = loadExistingPeriods(filePath);
  
  // Merge with in-memory seen set
  for (const key of existingPeriods) {
    seenPeriods.add(key);
  }
  
  let newCount = 0;
  
  for (const cat of CATEGORIES) {
    const data = await fetchSectionData(cat);
    if (!data || !data.periods || data.periods.length === 0) continue;
    
    for (const period of data.periods) {
      const key = `${cat}_${period.period}`;
      if (seenPeriods.has(key)) continue;
      
      const entry = {
        ts: new Date().toISOString(),
        cat: cat,
        period: period.period,
        is_green: period.is_green,
        number: period.number !== undefined ? period.number : null,
        color: period.is_green ? 'G' : 'R'
      };
      
      appendEntry(filePath, entry);
      seenPeriods.add(key);
      newCount++;
      totalStored++;
    }
  }
  
  if (newCount > 0) {
    const elapsed = ((Date.now() - sessionStart) / 1000 / 60).toFixed(1);
    const now = new Date().toLocaleTimeString('en-IN', { hour12: true, timeZone: 'Asia/Kolkata' });
    console.log(`  ✅ ${now} — Stored ${newCount} new periods (Session total: ${totalStored}) [${elapsed} min]`);
  }
}

// ============ STATS ============

function printStats() {
  console.log('\n📊 Data Collection Stats:');
  
  if (!fs.existsSync(DATA_DIR)) {
    console.log('  No data collected yet.');
    return;
  }
  
  const files = fs.readdirSync(DATA_DIR)
    .filter(f => f.endsWith('.jsonl'))
    .sort();
  
  let totalPeriods = 0;
  const catCounts = { P: 0, S: 0, B: 0, E: 0 };
  
  for (const file of files) {
    const filePath = path.join(DATA_DIR, file);
    const lines = fs.readFileSync(filePath, 'utf-8').trim().split('\n').filter(Boolean);
    let fileCount = 0;
    
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        fileCount++;
        totalPeriods++;
        if (catCounts[entry.cat] !== undefined) catCounts[entry.cat]++;
      } catch (e) {}
    }
    
    const date = file.replace('.jsonl', '');
    console.log(`  📅 ${date}: ${fileCount} periods`);
  }
  
  console.log(`\n  📦 Total: ${totalPeriods} periods across ${files.length} days`);
  console.log(`  🎯 Parity: ${catCounts.P} | ⚡ Sapre: ${catCounts.S} | 🔥 Bcone: ${catCounts.B} | 💎 Emerd: ${catCounts.E}`);
  console.log('');
}

// ============ MAIN ============

async function main() {
  ensureDataDir();
  
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  📦 WINGO DATA COLLECTOR — Storing All Period Colors');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  📁 Data folder: ${DATA_DIR}`);
  console.log(`  ⏱️  Poll interval: ${POLL_INTERVAL / 1000}s`);
  console.log(`  📊 Categories: ${CATEGORIES.map(c => `${CATEGORY_NAMES[c]} (${c})`).join(', ')}`);
  console.log('  ❌ Press Ctrl+C to stop\n');
  
  // Show existing data stats
  printStats();
  
  // Initial fetch
  console.log('  🔄 Starting data collection...\n');
  await collectOnce();
  
  // Continuous polling
  setInterval(async () => {
    try {
      await collectOnce();
    } catch (err) {
      console.error('  ⚠️ Error during collection:', err.message);
    }
  }, POLL_INTERVAL);
  
  // Print stats every 30 minutes
  setInterval(() => {
    printStats();
  }, 30 * 60 * 1000);
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log(`\n\n  🛑 Collector stopped. Total stored this session: ${totalStored} periods.`);
  printStats();
  process.exit(0);
});

main().catch(console.error);
