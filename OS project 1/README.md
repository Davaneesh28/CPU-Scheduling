# NexCore — Intelligent CPU Scheduler

## Setup (3 steps)

### Step 1 — Install dependencies
```bash
pip install flask flask-cors groq
```

### Step 2 — Get a free Groq API key
1. Go to https://console.groq.com
2. Sign up (free, no credit card)
3. Create an API key

```bash
# Mac / Linux
export GROQ_API_KEY=gsk_...

# Windows
set GROQ_API_KEY=gsk_...
```

### Step 3 — Start the server
```bash
python server.py
```

You should see:
```
====================================================
  NexCore Backend — http://localhost:5000
  Groq AI (Llama 3): ✓ API key found
  Free key → https://console.groq.com
====================================================
```

Then open `index.html` in Chrome or Edge.

---

## File Structure
```
nexcore/
├── index.html
├── style.css
├── server.py               ← Flask backend (ML + Groq proxy)
├── ml_dvfs_scheduler.py    ← Python ML engine
├── README.md
└── js/
    ├── app.js
    ├── chatbot.js          ← Calls /api/chat → Groq (Llama 3)
    ├── charts.js
    └── scheduler.js
```

## Troubleshooting

| Error in chat | Fix |
|---|---|
| "Cannot reach backend server" | Run `python server.py` |
| "GROQ_API_KEY not set" | `export GROQ_API_KEY=gsk_...` then restart server |
| "groq package not installed" | `pip install groq` |
| Scheduler works but chat fails | Server running but API key missing |

## Why Groq?
- 100% free tier (no credit card needed)
- Extremely fast (runs Llama 3 on custom hardware)
- Llama 3.3 70B — very capable for technical Q&A
