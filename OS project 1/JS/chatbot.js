/**
 * chatbot.js — NexCore
 * AI chatbot powered by Groq (free) — Llama 3.3 70B
 * Calls /api/chat on the Flask backend which proxies to Groq
 */

const Chatbot = (() => {

  let _lastResult = null;
  let _history    = [];
  const BACKEND   = 'http://localhost:5000/api/chat';

  function setContext(result) {
    _lastResult = result;
    _history    = []; // fresh conversation on each new run
  }

  // ── System prompt — scheduling knowledge + current results ──────
  function buildSystemPrompt() {
    const base = `You are Botty, an expert AI assistant inside CalFuxk — an intelligent CPU scheduling simulator. You are powered by Llama 3 via Groq.

You have deep knowledge of:
- ML+DVFS scheduling: linear regression predicts next burst → drives DVFS frequency selection
- DVFS P-states: [800, 1200, 1600, 2400, 3200] MHz. Dynamic power P ∝ V²f
- Heterogeneous cores: P-cores (15W, burst > 6ms) and E-cores (6W, burst ≤ 6ms)
- Thermal migration: temp > limit → task moves to sibling core at 80% frequency
- Energy formula: E = power × (burst / freq_scale / 1000)
- Baseline = all tasks on P-core at 3200 MHz with zero optimization
- Baseline vs Optimized chart: red line = baseline, green = actual. Gap = energy savings
- Round Robin: fixed 4ms quantum, all tasks P-core 2400MHz, fair but not energy-aware
- SJF: shortest burst first, minimizes average wait time, pairs well with DVFS
- Gantt chart: segment width ∝ burst time proportion of total execution
- Frequency chart: ML-predicted load drives clock speed selection per task
- Temperature chart: core heat per task; dashed red = thermal limit; red dot = migrated
- Core pie chart: P-core vs E-core task split

Keep answers concise and specific. Use exact numbers from results. Use bullet points for lists.`;

    if (!_lastResult) {
      return base + '\n\nNo scheduling run yet. Tell the user to enter burst times and click Run Scheduler.';
    }

    const r    = _lastResult;
    const perf = r.tasks.filter(t => t.isPerf);
    const eff  = r.tasks.filter(t => !t.isPerf);
    const hot  = r.tasks.filter(t => t.thermalAlert);
    const pct  = r.baselineEnergy > 0
      ? ((r.saved / r.baselineEnergy) * 100).toFixed(1) : 0;

    return base + `

CURRENT SCHEDULING RESULT:
Algorithm: ${r.algoName}
Tasks: ${r.tasks.length} total
Burst times: ${r.tasks.map(t => `T${t.id}=${t.burst}ms`).join(', ')}
Total energy: ${r.totalEnergy} J
Baseline energy: ${r.baselineEnergy} J
Energy saved: ${r.saved} J (${pct}% reduction)
Peak temperature: ${r.peakTemp}°C
P-core tasks (${perf.length}): ${perf.map(t => `T${t.id}(${t.burst}ms, ${t.freq}MHz, ${t.energy}J, ${t.temp}°C)`).join(', ') || 'none'}
E-core tasks (${eff.length}): ${eff.map(t => `T${t.id}(${t.burst}ms, ${t.freq}MHz, ${t.energy}J, ${t.temp}°C)`).join(', ') || 'none'}
Thermal migrations: ${hot.map(t => `T${t.id}`).join(', ') || 'none'}
${r.model ? `ML model: slope=${r.model.slope}, intercept=${r.model.intercept}` : 'No ML model (non-ML algorithm)'}
${r.nextPredicted != null ? `Next burst forecast: ${r.nextPredicted} ms` : ''}

Answer questions using these exact numbers.`;
  }

  // ── Call Flask /api/chat → Groq ─────────────────────────────────
  async function respond(userMessage) {
    _history.push({ role: 'user', content: userMessage });

    const res = await fetch(BACKEND, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system:   buildSystemPrompt(),
        messages: _history,
      }),
    });

    const data = await res.json();
    if (data.error) throw new Error(data.error);

    const reply = data.reply;
    _history.push({ role: 'assistant', content: reply });

    // Keep last 20 messages to avoid token bloat
    if (_history.length > 20) _history = _history.slice(-20);

    return reply;
  }

  return { respond, setContext };

})();
