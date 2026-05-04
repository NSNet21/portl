// Runs in the webview browser context — no Node/VS Code APIs available here.
declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };
declare const GROUPS: string[];
declare const EXISTING_LABELS: string[];

const vscode = acquireVsCodeApi();

const LOREM_WORDS = (
  'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor ' +
  'incididunt ut labore et dolore magna aliqua enim ad minim veniam quis nostrud ' +
  'exercitation ullamco laboris nisi aliquip ex ea commodo consequat duis aute irure ' +
  'in reprehenderit voluptate velit esse cillum fugiat nulla pariatur excepteur sint ' +
  'occaecat cupidatat non proident sunt culpa qui officia deserunt mollit anim id est laborum'
).split(' ');

function escHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const labelInput    = document.getElementById('label')             as HTMLInputElement;
const labelWarn     = document.getElementById('label-warn')        as HTMLElement;
const targetInput   = document.getElementById('target')            as HTMLInputElement;
const groupInput    = document.getElementById('group')             as HTMLInputElement;
const descInput     = document.getElementById('description')       as HTMLTextAreaElement;
const loremCount    = document.getElementById('lorem-count')       as HTMLInputElement;
const btnLorem      = document.getElementById('btn-lorem')         as HTMLButtonElement;
const suggList      = document.getElementById('group-suggestions') as HTMLUListElement;

// ── duplicate label warning ───────────────────────────────────────────────────
labelInput.addEventListener('input', () => {
  labelWarn.style.display = EXISTING_LABELS.includes(labelInput.value.trim()) ? 'block' : 'none';
});

// ── submit ────────────────────────────────────────────────────────────────────
function submit(): void {
  const label  = labelInput.value.trim();
  const target = targetInput.value.trim();
  if (!label || !target) return;
  vscode.postMessage({
    command:     'add',
    label,
    target,
    description: descInput.value.trim(),
    group:       groupInput.value.trim(),
  });
}

(document.getElementById('btn-add') as HTMLButtonElement).addEventListener('click', submit);

document.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit();
});

// ── lorem button ──────────────────────────────────────────────────────────────
btnLorem.addEventListener('click', () => {
  const count  = Math.min(Math.max(parseInt(loremCount.value, 10) || 30, 1), 200);
  const words  = Array.from({ length: count }, (_, i) => LOREM_WORDS[i % LOREM_WORDS.length]);
  words[0]     = words[0][0].toUpperCase() + words[0].slice(1);
  const text   = words.join(' ');

  const cursor = descInput.selectionStart ?? descInput.value.length;
  const before = descInput.value.slice(0, cursor);
  const after  = descInput.value.slice(cursor);
  const sep    = before.length > 0 && !before.endsWith('\n') && !before.endsWith(' ') ? ' ' : '';

  descInput.value = before + sep + text + after;
  const newPos = before.length + sep.length + text.length;
  descInput.setSelectionRange(newPos, newPos);
  descInput.focus();
});

// ── group autocomplete ────────────────────────────────────────────────────────
let activeIdx = -1;

function getMatches(val: string): string[] {
  if (!val) return GROUPS;
  const lower = val.toLowerCase();
  return GROUPS.filter(g => g.toLowerCase().includes(lower));
}

function hideSuggestions(): void {
  suggList.classList.remove('open');
  activeIdx = -1;
}

function selectGroup(val: string): void {
  groupInput.value = val;
  hideSuggestions();
}

function updateActive(): void {
  suggList.querySelectorAll('li').forEach((li, i) => li.classList.toggle('active', i === activeIdx));
}

function renderSuggestions(matches: string[]): void {
  activeIdx = -1;
  if (matches.length === 0) { hideSuggestions(); return; }
  suggList.innerHTML = matches.map(g => `<li>${escHtml(g)}</li>`).join('');
  suggList.querySelectorAll('li').forEach(li => {
    li.addEventListener('mousedown', (e: Event) => {
      e.preventDefault();
      selectGroup((li as HTMLElement).textContent ?? '');
    });
  });
  suggList.classList.add('open');
}

groupInput.addEventListener('input',  () => renderSuggestions(getMatches(groupInput.value)));
groupInput.addEventListener('focus',  () => renderSuggestions(getMatches(groupInput.value)));
groupInput.addEventListener('blur',   () => setTimeout(hideSuggestions, 120));

groupInput.addEventListener('keydown', (e: KeyboardEvent) => {
  const items = suggList.querySelectorAll('li');
  if (!suggList.classList.contains('open')) return;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    activeIdx = Math.min(activeIdx + 1, items.length - 1);
    updateActive();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    activeIdx = Math.max(activeIdx - 1, 0);
    updateActive();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const chosen = activeIdx >= 0 ? items[activeIdx] : items[0];
    if (chosen) selectGroup((chosen as HTMLElement).textContent ?? '');
  } else if (e.key === 'Escape') {
    hideSuggestions();
  }
});

document.addEventListener('click', (e: MouseEvent) => {
  if (!(e.target as Element).closest('.autocomplete')) hideSuggestions();
});
