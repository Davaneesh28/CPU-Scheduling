/**
 * app.js — NexCore main controller
 * - Uses Python ML backend (Flask) when available, falls back to JS scheduler
 * - Chatbot powered by Claude AI
 */

let selectedAlgo = 'ml';
let lastResult   = null;
let PYTHON_BACKEND = 'http://localhost:5000'; // Flask server URL

// ── Page navigation ───────────────────────────────────
function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  const link = document.querySelector('.nav-link[data-page="' + name + '"]');
  if (link) link.classList.add('active');
  const nav = document.querySelector('.nav');
  if (name === 'scheduler') {
    nav.classList.remove('nav-dark'); nav.classList.add('nav-light');
  } else {
    nav.classList.remove('nav-light'); nav.classList.add('nav-dark');
  }
  window.scrollTo(0, 0);
}

// ── Algorithm selection ───────────────────────────────
function selectAlgo(el) {
  document.querySelectorAll('.algo-tab').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  selectedAlgo = el.dataset.val;
  const names = { ml: 'ML + DVFS', rr: 'Round Robin', sjf: 'SJF' };
  const d = document.getElementById('algoDisplay');
  if (d) d.textContent = names[selectedAlgo];
}

// ── Run — tries Python backend first, falls back to JS ─
async function run() {
  const input   = document.getElementById('burst').value.trim();
  const thermal = parseFloat(document.getElementById('thermalLimit').value) || 75;
  const errorEl = document.getElementById('error');
  const runBtn  = document.getElementById('runBtn');

  errorEl.classList.remove('show');
  if (!input) { showErr('Please enter at least one burst time.'); return; }
  const values = input.split(',').map(x => parseFloat(x.trim()));
  if (values.some(v => isNaN(v) || v <= 0)) { showErr('Enter valid positive numbers, comma-separated.'); return; }
  if (values.length > 20) { showErr('Max 20 tasks supported.'); return; }

  runBtn.disabled = true;
  runBtn.innerHTML = `<span>Running…</span>`;

  try {
    let result;

    // Try Python ML backend first
    try {
      const res = await fetch(`${PYTHON_BACKEND}/api/schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bursts: values, thermal_limit: thermal, algo: selectedAlgo }),
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        result = await res.json();
        result._source = 'python';
      }
    } catch(e) {
      // Python backend not running — fall back to JS scheduler
      result = null;
    }

    // JS fallback
    if (!result) {
      result = Scheduler.schedule(values, selectedAlgo, thermal);
      result._source = 'javascript';
    }

    if (result.error) { showErr(result.error); return; }

    lastResult = result;
    renderTable(result);
    renderMetrics(result);
    Charts.renderAll(result, thermal);
    Chatbot.setContext(result);
    showCharts();
    updateAlgoDisplay(result.algoName);
    addBotMsg(autoInsight(result));

  } catch (e) {
    showErr('Error: ' + e.message);
  }

  runBtn.disabled = false;
  runBtn.innerHTML = `Run Scheduler <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
}

function showErr(msg) {
  const e = document.getElementById('error');
  e.textContent = msg; e.classList.add('show');
}

// ── Render table ──────────────────────────────────────
function renderTable(result) {
  const tbody = document.getElementById('tableBody');
  const maxE  = Math.max(...result.tasks.map(t => t.energy));
  tbody.innerHTML = result.tasks.map((t, i) => {
    const pct     = Math.round(t.energy / maxE * 100);
    const coreCls = t.isPerf ? 'core-perf' : 'core-eff';
    const eCls    = t.isPerf ? 'ebar-p' : 'ebar-e';
    const tCls    = t.temp > 78 ? 'temp-hot' : t.temp > 68 ? 'temp-mid' : 'temp-ok';
    const tIcon   = t.thermalAlert ? '🔥' : '';
    return `<tr class="enter" style="animation-delay:${i*35}ms">
      <td><div class="task-chip">
        <div class="task-dot" style="background:${t.color}"></div>
        <span class="task-label">T${t.id}</span>
      </div></td>
      <td>${t.burst} ms</td>
      <td><span class="core-tag ${coreCls}">${t.coreType}</span></td>
      <td><span class="freq-val">${t.freq} MHz</span></td>
      <td><span class="${tCls}">${tIcon} ${t.temp}°C</span></td>
      <td><div class="ebar">
        <div class="ebar-track"><div class="ebar-fill ${eCls}" style="width:${pct}%"></div></div>
        <span class="ebar-val">${t.energy} J</span>
      </div></td>
    </tr>`;
  }).join('');
}

// ── Render metrics ────────────────────────────────────
function renderMetrics(r) {
  document.getElementById('mTasks').textContent  = r.tasks.length;
  document.getElementById('mEnergy').textContent = r.totalEnergy + ' J';
  document.getElementById('mSaved').textContent  = (r.saved >= 0 ? '+' : '') + r.saved + ' J';
  document.getElementById('mTemp').textContent   = r.peakTemp + '°C';
  const badge = document.getElementById('savingsBadge');
  if (badge && r.saved > 0) badge.textContent = r.saved + ' J saved';
  ['mc1','mc2','mc3','mc4'].forEach((id, i) => {
    setTimeout(() => {
      const el = document.getElementById(id);
      if (el) { el.classList.add('pop'); setTimeout(() => el.classList.remove('pop'), 700); }
    }, i * 80);
  });
}

function showCharts() {
  document.getElementById('chartsRow').style.display = 'grid';
  document.getElementById('compCard').style.display  = 'block';
  document.getElementById('freqCard').style.display  = 'block';
  document.getElementById('tempCard').style.display  = 'block';
  document.getElementById('predCard').style.display  = 'block';
}

function updateAlgoDisplay(name) {
  const el = document.getElementById('algoDisplay');
  if (el) el.textContent = name;
}

// ── Auto insight shown after run ──────────────────────
function autoInsight(r) {
  const perf = r.tasks.filter(t => t.isPerf).length;
  const src  = r._source === 'python' ? '🐍 Python ML engine' : '🟨 JS engine';
  let msg = `${src} · ${r.tasks.length} tasks scheduled — ${perf} on P-cores, ${r.tasks.length - perf} on E-cores. Total energy: ${r.totalEnergy} J`;
  if (r.saved > 0) msg += ` (saved ${r.saved} J vs naive baseline)`;
  msg += `. Peak temp: ${r.peakTemp}°C.`;
  if (r.tasks.some(t => t.thermalAlert)) msg += ` Some tasks triggered thermal migration — look for 🔥 in the table.`;
  return msg;
}

// ── Chat (async — calls Claude AI) ───────────────────
async function sendChat() {
  const inp   = document.getElementById('chatInput');
  const query = inp.value.trim();
  if (!query) return;
  addUserMsg(query);
  inp.value = '';

  const tid = showTyping();
  try {
    const reply = await Chatbot.respond(query);
    removeTyping(tid);
    addBotMsg(reply);
  } catch(e) {
    removeTyping(tid);
    const msg = e.message || '';
    if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('ERR_CONNECTION_REFUSED')) {
      addBotMsg('⚠️ Cannot reach the backend server.\n\nStart it with:\n`python server.py`\n\nThen make sure ANTHROPIC_API_KEY is set:\n`export ANTHROPIC_API_KEY=sk-ant-...`');
    } else if (msg.includes('ANTHROPIC_API_KEY')) {
      addBotMsg('⚠️ API key not set on the server.\n\nRun:\n`export ANTHROPIC_API_KEY=sk-ant-...`\nthen restart `python server.py`');
    } else {
      addBotMsg('⚠️ ' + msg);
    }
  }
}

function addUserMsg(text) {
  const win = document.getElementById('chatWindow');
  const d   = document.createElement('div');
  d.className = 'msg user';
  d.innerHTML = `<div class="bubble user-bubble">${esc(text)}</div>`;
  win.appendChild(d); win.scrollTop = win.scrollHeight;
}

function addBotMsg(text) {
  const win = document.getElementById('chatWindow');
  const d   = document.createElement('div');
  d.className = 'msg bot';
  // Render newlines and basic markdown bold
  const formatted = esc(text)
    .replace(/\n/g, '<br>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.*?)`/g, '<code style="background:rgba(0,0,0,.08);padding:1px 5px;border-radius:3px;font-family:monospace">$1</code>');
  d.innerHTML = `<div class="bubble bot-bubble">${formatted}</div>`;
  win.appendChild(d); win.scrollTop = win.scrollHeight;
}

function showTyping() {
  const win = document.getElementById('chatWindow');
  const id  = 'ty-' + Date.now();
  const d   = document.createElement('div');
  d.className = 'msg bot'; d.id = id;
  d.innerHTML = `<div class="bubble bot-bubble" style="color:var(--l-text-3)">
    <span class="typing-dots"><span>.</span><span>.</span><span>.</span></span>
  </div>`;
  win.appendChild(d); win.scrollTop = win.scrollHeight;
  return id;
}

function removeTyping(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Enter key shortcuts ───────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && document.activeElement.id === 'burst') run();
  if (e.key === 'Enter' && document.activeElement.id === 'chatInput') sendChat();
});
