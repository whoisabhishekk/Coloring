import re

with open('app.js', 'r') as f:
    code = f.read()

# 1. Update virtual loss checks from 3 to 5
code = code.replace('virtualLossCount >= 3', 'virtualLossCount >= 5')
code = code.replace('virtualLossCount === 3', 'virtualLossCount === 5')
code = code.replace('Math.min(3,', 'Math.min(5,')
code = code.replace('virtualLossCount = 3', 'virtualLossCount = 5')
code = code.replace('lockLossCount = 3', 'lockLossCount = 5')
code = code.replace('/3', '/5')

# 2. Update UI sniper tracker loop and logic
code = code.replace('for (let i = 1; i <= 3; i++) {', 'for (let i = 1; i <= 5; i++) {')
code = code.replace('count >= 3', 'count >= 5')

# 3. Disable section locking
code = re.sub(r'function isRgrgSectionLocked\([^)]*\)\s*\{[^}]*\}', 'function isRgrgSectionLocked(section, strategy = state.selectedStrategy) { return false; }', code)

# 4. Remove syncRgrgSectionLocks logic
code = re.sub(r'function syncRgrgSectionLocks\(\)\s*\{[^}]*\}', 'function syncRgrgSectionLocks() {}', code)

# 5. Disable resetRgrgCycle global reset
code = re.sub(r'function resetRgrgCycle\(\)\s*\{[\s\S]*?persistRgrgLockState\(\);\n\}', 'function resetRgrgCycle() {}', code)

# 6. Add class toggling in renderSection for highlighting
# We need to find `function renderSection(key) {`
# and add logic to toggle 'highlight-loss' class based on virtualLossCount >= 5
highlight_logic = """
  const sectionCard = document.getElementById(`card-${key}`);
  if (sectionCard) {
    if (section.virtualLossCount >= 5) {
      sectionCard.classList.add('highlight-loss');
    } else {
      sectionCard.classList.remove('highlight-loss');
    }
  }
"""
# inject right after `if (!section) return;` or similar in renderSection
# Let's just put it at the end of renderSection
code = re.sub(r'(function renderSection\(key\) \{[\s\S]*?renderSniperTracker\(key\);\n)', r'\1' + highlight_logic, code)

# Also update win logic to reset the section properly since we disabled resetRgrgCycle
# Find the win block in resolveRgrgBet
win_block = """
    section.strategyState = 'HUNTING';
    section.pendingBet = null;
    section.patternDetected = false;
    section.patternColors = null;
    resetRgrgCycle();
"""
code = code.replace('resetRgrgCycle();', win_block)

with open('app.js', 'w') as f:
    f.write(code)

print("Patched app.js successfully.")
