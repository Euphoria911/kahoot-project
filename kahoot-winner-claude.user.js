// ==UserScript==
// @name         Kahoot Winner (Claude) Ultimate
// @namespace    kahoot-winner
// @version      8.7
// @description  Type-aware Kahoot helper — all 13 types, Claude only, vision, pin & puzzle & slider support
// @match        https://kahoot.it/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @connect      api.anthropic.com
// ==/UserScript==

(function () {
    'use strict';

    // ─────────────────────────────────────────────────────────────────────
    // Config / storage
    // ─────────────────────────────────────────────────────────────────────
    let claudeKey         = GM_getValue('claude_key', '');
    let claudeModel       = GM_getValue('claude_model', 'claude-haiku-5-5');
    let claudeVisionModel = GM_getValue('claude_vision_model', 'claude-sonnet-5-5');
    let autoClick         = GM_getValue('kw_autoclick', false);
    let stealth           = GM_getValue('kw_stealth', false);

    const BUSY_MS   = 1500;
    const IMG_MAX_W = 1568;
    const IMG_QUAL  = 0.9;

    let lastQ = '', busy = false, overlays = [];
    let puzzleRenderState = null;

    // ─────────────────────────────────────────────────────────────────────
    // Question kinds
    // ─────────────────────────────────────────────────────────────────────
    const K = {
        QUIZ:        'quiz',
        MULTI:       'multi',
        TF:          'tf',
        TYPE:        'type',
        WORDCLOUD:   'wordcloud',
        OPENENDED:   'openended',
        SLIDER:      'slider',
        PIN:         'pin',
        PUZZLE:      'puzzle',
        SCALE:       'scale',
        NPS:         'nps',
        LOBBY:       'lobby',
        LEADERBOARD: 'leaderboard',
        UNKNOWN:     'unknown',
    };

    // ─────────────────────────────────────────────────────────────────────
    // DOM helpers
    // ─────────────────────────────────────────────────────────────────────
    const S = (el, css) => { el.setAttribute('style', css); return el; };
    const D = (tag, css) => S(document.createElement(tag), css);
    const root = () => document.body || document.documentElement;

    // ─────────────────────────────────────────────────────────────────────
    // Floating badge + panel UI
    // ─────────────────────────────────────────────────────────────────────
    const badge = D('div',
        'position:fixed;top:10px;right:10px;z-index:2147483647;' +
        'background:#111827;color:#e3b341;border:2px solid #e3b341;' +
        'border-radius:20px;font-family:monospace;font-size:13px;' +
        'padding:6px 14px;cursor:pointer;user-select:none;' +
        'box-shadow:0 2px 14px rgba(0,0,0,.8);pointer-events:auto;white-space:nowrap;');
    badge.textContent = '🎯 kahoot++';

    const panel = D('div',
        'display:none;position:fixed;top:48px;right:10px;z-index:2147483647;' +
        'background:#0d1117;border:1px solid #30363d;border-radius:10px;' +
        'padding:14px;width:330px;font-family:monospace;font-size:11px;color:#8b949e;' +
        'box-shadow:0 6px 28px rgba(0,0,0,.85);pointer-events:auto;' +
        'max-height:85vh;overflow-y:auto;');

    function mkRow(id, col) {
        const el = D('div',
            'padding:7px 9px;background:#161b22;border:1px solid #21262d;' +
            'border-radius:5px;margin-bottom:7px;word-break:break-word;' +
            'white-space:pre-wrap;line-height:1.45;color:' + col + ';');
        el.id = id; el.textContent = id + ': —'; return el;
    }
    function mkBtn(label, col, fn) {
        const b = D('button',
            'flex:1;border:none;border-radius:4px;padding:5px 7px;font-size:11px;' +
            'font-family:monospace;cursor:pointer;pointer-events:auto;background:' + col + ';color:#fff;');
        b.textContent = label; b.onclick = fn; return b;
    }
    function mkInput(ph, val) {
        const i = D('input',
            'width:100%;background:#161b22;color:#e3b341;border:1px solid #374151;' +
            'border-radius:4px;padding:5px 7px;font-size:11px;font-family:monospace;' +
            'outline:none;box-sizing:border-box;margin-bottom:6px;pointer-events:auto;');
        i.type = 'text'; i.placeholder = ph; i.value = val || '';
        return i;
    }

    const rowQ = mkRow('Q', '#58a6ff');
    const rowK = mkRow('K', '#f0883e');
    const rowA = mkRow('A', '#3fb950');
    const rowR = mkRow('R', '#ffa657');

    const btnRow = D('div', 'display:flex;gap:6px;margin-bottom:10px;');
    btnRow.appendChild(mkBtn('scan DOM', '#1d4ed8', doScan));
    btnRow.appendChild(mkBtn('force now', '#166534', () => { lastQ=''; busy=false; tryAnswer(); }));

    // Claude section
    const claudeSec = D('div', 'margin-bottom:10px;');
    const ckLbl = D('div', 'color:#8b949e;margin-bottom:4px;'); ckLbl.textContent = 'Claude API key (sk-ant-...)';
    const cki = mkInput('paste Claude key...', claudeKey); cki.type = 'password';
    const btnSaveClaude = mkBtn('save key', '#374151', () => {
        claudeKey = cki.value.trim();
        GM_setValue('claude_key', claudeKey);
        setStatus('✓ saved', '#3fb950'); setTimeout(resetBadge, 1500);
    });
    btnSaveClaude.style.width = '100%';
    const cmLbl = D('div', 'color:#8b949e;margin:6px 0 4px;'); cmLbl.textContent = 'Text model (fast/cheap)';
    const cmi = mkInput('claude-haiku-5-5', claudeModel);
    const cvLbl = D('div', 'color:#8b949e;margin:6px 0 4px;'); cvLbl.textContent = 'Vision model (reads images)';
    const cvi = mkInput('claude-sonnet-5-5', claudeVisionModel);
    const btnSaveModels = mkBtn('save models', '#374151', () => {
        claudeModel       = cmi.value.trim() || 'claude-haiku-5-5';
        claudeVisionModel = cvi.value.trim() || claudeModel;
        GM_setValue('claude_model', claudeModel);
        GM_setValue('claude_vision_model', claudeVisionModel);
        setStatus('✓ saved', '#3fb950'); setTimeout(resetBadge, 1500); updateInfo();
    });
    btnSaveModels.style.width = '100%';
    claudeSec.appendChild(ckLbl); claudeSec.appendChild(cki); claudeSec.appendChild(btnSaveClaude);
    claudeSec.appendChild(cmLbl); claudeSec.appendChild(cmi);
    claudeSec.appendChild(cvLbl); claudeSec.appendChild(cvi); claudeSec.appendChild(btnSaveModels);

    // Auto-click row
    const acRow = D('div', 'display:flex;gap:6px;margin-bottom:8px;align-items:center;font-size:11px;');
    const acLbl = D('span', 'color:#8b949e;flex:1;'); acLbl.textContent = 'Auto-click (anti-cheat risk)';
    const btnAuto = mkBtn(autoClick ? 'ON' : 'OFF', autoClick?'#dc2626':'#374151', () => {
        autoClick = !autoClick;
        GM_setValue('kw_autoclick', autoClick);
        btnAuto.textContent = autoClick ? 'ON' : 'OFF';
        btnAuto.style.background = autoClick ? '#dc2626' : '#374151';
        resetBadge();
    });
    btnAuto.style.flex = '0 0 50px';
    acRow.appendChild(acLbl); acRow.appendChild(btnAuto);

    // Stealth row
    const stRow = D('div', 'display:flex;gap:6px;margin-bottom:8px;align-items:center;font-size:11px;');
    const stLbl = D('span', 'color:#8b949e;flex:1;'); stLbl.textContent = 'Stealth (no overlays)';
    const btnStealth = mkBtn(stealth ? 'ON' : 'OFF', stealth ? '#6366f1' : '#374151', () => {
        stealth = !stealth;
        GM_setValue('kw_stealth', stealth);
        btnStealth.textContent = stealth ? 'ON' : 'OFF';
        btnStealth.style.background = stealth ? '#6366f1' : '#374151';
        if (stealth) clearOverlays();
        setStatus(stealth ? '🥷 STEALTH ON' : '🥷 STEALTH OFF', stealth ? '#6366f1' : '#8b949e');
        console.log('[kw] stealth', stealth ? 'ON' : 'OFF');
        setTimeout(resetBadge, 2500);
    });
    btnStealth.style.flex = '0 0 50px';
    stRow.appendChild(stLbl); stRow.appendChild(btnStealth);

    const infoLbl = D('div', 'color:#3fb950;font-size:11px;text-align:center;padding:6px 0;border-top:1px solid #21262d;margin-top:4px;');
    function updateInfo() {
        infoLbl.textContent = '🧠 ' + claudeModel + ' / vision: ' + claudeVisionModel;
    }
    updateInfo();

    const titleRow = D('div', 'display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;');
    const titleEl  = D('span', 'color:#e3b341;font-weight:bold;font-size:12px;'); titleEl.textContent = 'kahoot++ v8 debug';
    const closeBtn = D('button', 'background:none;border:none;color:#8b949e;cursor:pointer;font-size:16px;pointer-events:auto;padding:0;');
    closeBtn.textContent = '✕'; closeBtn.onclick = () => { panel.style.display = 'none'; };
    titleRow.appendChild(titleEl); titleRow.appendChild(closeBtn);

    [titleRow, rowQ, rowK, rowA, rowR, btnRow, claudeSec, acRow, stRow, infoLbl].forEach(el => panel.appendChild(el));

    badge.onclick = () => {
        panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
        if (panel.style.display === 'block') {
            cki.value = claudeKey;
            cmi.value = claudeModel; cvi.value = claudeVisionModel;
            doScan();
        }
    };

    function ensureInDOM() {
        const r = root(); if (!r) return;
        if (!r.contains(badge)) r.appendChild(badge);
        if (!r.contains(panel)) r.appendChild(panel);
        overlays.forEach(ov => { if (ov && !r.contains(ov)) r.appendChild(ov); });
        if (!document.getElementById('kw-style') && document.head) {
            const s = document.createElement('style');
            s.id = 'kw-style';
            s.textContent = '@keyframes kwp{from{box-shadow:0 0 12px 3px rgba(0,255,136,.5)}to{box-shadow:0 0 26px 10px rgba(0,255,136,.95)}}' +
                '@keyframes kwpulse{0%,100%{transform:translate(-50%,-50%) scale(1);opacity:1}50%{transform:translate(-50%,-50%) scale(1.15);opacity:.7}}';
            document.head.appendChild(s);
        }
    }
    setInterval(ensureInDOM, 300);

    function setStatus(t, c) {
        badge.textContent = t;
        badge.style.color = c || '#e3b341';
        badge.style.borderColor = c || '#e3b341';
    }
    function resetBadge() {
        if (stealth) { setStatus(autoClick ? '🥷 [AUTO]' : '🥷', '#6366f1'); return; }
        setStatus('🎯 kahoot++' + (autoClick ? ' [AUTO]' : ''), autoClick ? '#dc2626' : '#e3b341');
    }

    // ─────────────────────────────────────────────────────────────────────
    // Overlays
    // ─────────────────────────────────────────────────────────────────────
    function clearOverlays() { overlays.forEach(o => o && o.remove()); overlays = []; }

    function showRing(el, label) {
        if (stealth) return;
        const r = el.getBoundingClientRect();
        if (!r.width) return;
        const ov = D('div',
            'position:fixed;pointer-events:none;z-index:2147483646;' +
            'border:4px solid #00ff88;border-radius:8px;' +
            'animation:kwp .8s ease-in-out infinite alternate;' +
            'top:'    + (r.top    - 5) + 'px;' +
            'left:'   + (r.left   - 5) + 'px;' +
            'width:'  + (r.width  + 10) + 'px;' +
            'height:' + (r.height + 10) + 'px;');
        root().appendChild(ov); overlays.push(ov);
        if (label !== undefined) {
            const b = D('div',
                'position:fixed;pointer-events:none;z-index:2147483647;' +
                'background:#00ff88;color:#0d1117;border-radius:50%;' +
                'width:34px;height:34px;display:flex;align-items:center;justify-content:center;' +
                'font-family:monospace;font-size:18px;font-weight:bold;' +
                'box-shadow:0 0 14px rgba(0,255,136,.9);' +
                'top:'  + (r.top  - 12) + 'px;' +
                'left:' + (r.left - 12) + 'px;');
            b.textContent = String(label);
            root().appendChild(b); overlays.push(b);
        }
    }

    function showTextHint(text) {
        if (stealth) return;
        const ov = D('div',
            'position:fixed;z-index:2147483646;pointer-events:none;' +
            'left:50%;transform:translateX(-50%);bottom:140px;' +
            'background:#0d1117;border:3px solid #00ff88;border-radius:10px;' +
            'color:#00ff88;font-family:monospace;font-size:20px;font-weight:bold;' +
            'padding:10px 28px;box-shadow:0 0 24px rgba(0,255,136,.5);' +
            'white-space:nowrap;max-width:80vw;overflow:hidden;text-overflow:ellipsis;');
        ov.textContent = '→ ' + text;
        root().appendChild(ov); overlays.push(ov);
    }

    function showCrosshair(imgEl, xPct, yPct) {
        if (stealth) return;
        const r = imgEl.getBoundingClientRect();
        if (!r.width) return;
        const cx = r.left + r.width  * xPct / 100;
        const cy = r.top  + r.height * yPct / 100;
        const dot = D('div',
            'position:fixed;z-index:2147483647;pointer-events:none;' +
            'width:28px;height:28px;border-radius:50%;' +
            'background:#00ff88;border:3px solid #0d1117;' +
            'box-shadow:0 0 20px rgba(0,255,136,.9),0 0 40px rgba(0,255,136,.6);' +
            'animation:kwpulse 1s ease-in-out infinite;' +
            'top:' + cy + 'px;left:' + cx + 'px;');
        const ring = D('div',
            'position:fixed;z-index:2147483646;pointer-events:none;' +
            'width:80px;height:80px;border-radius:50%;' +
            'border:3px dashed #00ff88;' +
            'top:' + (cy - 40) + 'px;left:' + (cx - 40) + 'px;' +
            'animation:kwp 1s ease-in-out infinite alternate;');
        root().appendChild(ring); root().appendChild(dot);
        overlays.push(ring, dot);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Text extraction
    // ─────────────────────────────────────────────────────────────────────
    function cleanText(el) {
        const raw = (el.innerText || el.textContent || '').trim();
        if (!raw) return '';
        const len = raw.length;
        for (let n = 2; n <= 4; n++) {
            if (len % n !== 0) continue;
            const part = raw.slice(0, len / n);
            if (part.length >= 4 && raw === part.repeat(n)) return part.trim();
        }
        return raw;
    }

    // ─────────────────────────────────────────────────────────────────────
    // Answer buttons (2–6)
    // ─────────────────────────────────────────────────────────────────────
    function getAnswerEls() {
        const byDfs = [...document.querySelectorAll('[data-functional-selector^="answer-"]')]
            .filter(el => !panel.contains(el) && el !== badge)
            .filter(el => /^answer-\d+$/.test(el.getAttribute('data-functional-selector') || ''));
        if (byDfs.length >= 2) return byDfs.slice(0, 6);

        const threshold = window.innerHeight * 0.45;
        const btns = [...document.querySelectorAll('button,[role="button"]')].filter(b => {
            if (b === badge || b === closeBtn || panel.contains(b)) return false;
            const r = b.getBoundingClientRect();
            const txt = cleanText(b);
            return r.width > 80 && r.height > 36 && r.top > threshold
                && r.bottom < window.innerHeight + 20 && txt.length > 0 && txt.length < 160;
        }).sort((a, b) => {
            const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
            const dr = Math.round(ra.top / 15) - Math.round(rb.top / 15);
            return dr !== 0 ? dr : ra.left - rb.left;
        });
        if (btns.length >= 2 && btns.length <= 8) return btns.slice(0, 6);
        return [];
    }

    function getQuestion() {
        for (const k of ['question-title','question-text','block-title']) {
            const el = document.querySelector('[data-functional-selector="' + k + '"]');
            if (el) { const t = cleanText(el); if (t.length > 2) return t; }
        }
        for (const f of ['QuestionTitle','QuestionText','questionTitle','question-title']) {
            const el = document.querySelector('[class*="' + f + '"]');
            if (el) { const t = cleanText(el); if (t.length > 2) return t; }
        }
        const mid = window.innerHeight * 0.5;
        return [...document.querySelectorAll('p,h1,h2,h3,div,span')]
            .filter(el => {
                if (el === badge || panel.contains(el) || el.tagName === 'BUTTON') return false;
                const r = el.getBoundingClientRect(), t = cleanText(el);
                return t.length > 5 && t.length < 400 && r.width > 120 && r.height > 18
                    && r.top > 40 && r.bottom < window.innerHeight * 0.78 && el.children.length < 4;
            })
            .sort((a, b) => {
                const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
                return Math.abs((ra.top + ra.height/2) - mid) - Math.abs((rb.top + rb.height/2) - mid);
            })[0]?.innerText?.trim() ?? null;
    }

    function getTypeInput() {
        return [...document.querySelectorAll('input[type="text"],textarea,input:not([type])')].find(el => {
            if (panel.contains(el)) return false;
            const r = el.getBoundingClientRect();
            return r.width > 100 && r.top > window.innerHeight * 0.35 && r.bottom < window.innerHeight + 10;
        }) || null;
    }

    function getSliderInput() {
        return [...document.querySelectorAll('input[type="range"],[role="slider"]')].find(el => {
            if (panel.contains(el)) return false;
            const r = el.getBoundingClientRect();
            return r.width > 50 && r.top > 60 && r.bottom < window.innerHeight;
        }) || null;
    }

    function getQuestionImage() {
        for (const sel of [
            '[data-functional-selector="block-image"] img',
            '[data-functional-selector="question-image"] img',
            '[data-functional-selector="pin-answer-image"] img',
            '[class*="QuestionImage"] img',
            '[class*="PinAnswerImage"] img',
        ]) {
            const el = document.querySelector(sel);
            if (el && el.getBoundingClientRect().width > 60) return el;
        }
        const imgs = [...document.querySelectorAll('img')].filter(img => {
            if (panel.contains(img) || badge.contains(img)) return false;
            const r = img.getBoundingClientRect();
            return r.width > 100 && r.height > 70 && r.top > 20 && r.top < window.innerHeight * 0.75;
        });
        return imgs.sort((a, b) => (b.width * b.height) - (a.width * a.height))[0] || null;
    }

    function imgToBase64(imgEl) {
        try {
            const srcW = imgEl.naturalWidth || imgEl.width;
            const srcH = imgEl.naturalHeight || imgEl.height;
            if (!srcW || !srcH) return null;
            const w = Math.min(srcW, IMG_MAX_W);
            const h = Math.round(srcH * w / srcW);
            const c = document.createElement('canvas');
            c.width = w; c.height = h;
            c.getContext('2d').drawImage(imgEl, 0, 0, w, h);
            return c.toDataURL('image/jpeg', IMG_QUAL).split(',')[1];
        } catch(e) { return null; }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Kind detection
    // ─────────────────────────────────────────────────────────────────────
    function isLeaderboardScreen() {
        const dfs = sel => document.querySelector(sel);
        if (dfs('[data-functional-selector="feedback-text"]')) return true;
        if (dfs('[data-functional-selector^="podium-"]'))      return true;
        if (dfs('[data-functional-selector*="scoreboard"]'))   return true;
        if (dfs('[data-functional-selector="correct-answer-text"]')) return true;
        if (dfs('[data-functional-selector="incorrect-answer-text"]')) return true;
        if (dfs('[class*="Podium"]')) return true;
        const t = document.body?.innerText || '';
        if (/^You're on \d+(st|nd|rd|th) place/im.test(t)) return true;
        if (/^(Correct|Incorrect)!$/im.test(t)) return true;
        return false;
    }

    function isLobbyScreen() {
        return !!(document.querySelector('[data-functional-selector="game-pin-input"]') ||
                  document.querySelector('[data-functional-selector="username-input"]'));
    }

    function isMultiSelect() {
        if (document.querySelector('[data-functional-selector="submit-answer-button"]')) return true;
        if (document.querySelector('[data-functional-selector^="multi-select-"]')) return true;
        if ([...document.querySelectorAll('[class]')].some(el =>
            /multi[-_]?select/i.test(el.className))) return true;
        return false;
    }

    function detectKind() {
        if (isLobbyScreen())       return K.LOBBY;
        if (isLeaderboardScreen()) return K.LEADERBOARD;

        if (document.querySelector('[data-functional-selector*="pin-answer"]')
         || document.querySelector('[class*="PinAnswer"]')
         || document.querySelector('[class*="pin-answer"]')) {
            return K.PIN;
        }

        if (document.querySelector('[data-functional-selector*="puzzle"]')
         || document.querySelector('[data-functional-selector*="drop-zone"]')
         || document.querySelector('[class*="Puzzle"]')
         || document.querySelector('[draggable="true"]')) {
            return K.PUZZLE;
        }

        const numBtns = [...document.querySelectorAll('button,[role="button"]')]
            .filter(b => /^(10|[0-9])$/.test(cleanText(b)));
        if (numBtns.length >= 10) return K.NPS;

        if (document.querySelector('[data-functional-selector^="scale-"]')) return K.SCALE;

        if (getSliderInput()) return K.SLIDER;

        const input = getTypeInput();
        if (input) {
            if (input.tagName === 'TEXTAREA') return K.OPENENDED;
            const ml = parseInt(input.getAttribute('maxlength') || '0', 10);
            if (ml > 0 && ml <= 25) return K.WORDCLOUD;
            return K.TYPE;
        }

        const btns = getAnswerEls();
        if (btns.length === 2 && !isMultiSelect()) return K.TF;
        if (btns.length >= 2) return isMultiSelect() ? K.MULTI : K.QUIZ;

        return K.UNKNOWN;
    }

    // ─────────────────────────────────────────────────────────────────────
    // Claude backend
    // ─────────────────────────────────────────────────────────────────────
    function callClaude(prompt, images) {
        return new Promise((resolve, reject) => {
            if (!claudeKey) { setStatus('⚠ no key', '#ff7b72'); reject('no claude key'); return; }
            const imgArr = Array.isArray(images) ? images.filter(Boolean) : (images ? [images] : []);
            const model = imgArr.length ? claudeVisionModel : claudeModel;
            rowR.textContent = 'R: using ' + model + (imgArr.length > 1 ? ' (' + imgArr.length + ' imgs)' : '') + '...';
            const content = [];
            for (const b64 of imgArr) content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } });
            content.push({ type: 'text', text: prompt });
            GM_xmlhttpRequest({
                method: 'POST',
                url: 'https://api.anthropic.com/v1/messages',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': claudeKey,
                    'anthropic-version': '2023-06-01',
                    'anthropic-dangerous-direct-browser-access': 'true',
                },
                data: JSON.stringify({ model, max_tokens: 1024, messages: [{ role: 'user', content }] }),
                onload(res) {
                    rowR.textContent = 'R: ' + res.responseText.slice(0, 220);
                    try {
                        const parsed = JSON.parse(res.responseText);
                        if (parsed?.error) { reject(parsed.error.message || JSON.stringify(parsed.error)); return; }
                        const blocks = parsed?.content || [];
                        resolve(blocks.filter(b => b.type === 'text').map(b => b.text).join('\n').trim());
                    } catch(e) { reject(e); }
                },
                onerror(e) { rowR.textContent = 'R: ERR ' + JSON.stringify(e).slice(0,80); reject(e); },
                ontimeout() { rowR.textContent = 'R: timeout'; reject('timeout'); },
                timeout: 30000,
            });
        });
    }

    const askAI = (prompt, images) => callClaude(prompt, images);

    // ─────────────────────────────────────────────────────────────────────
    // Response parsers
    // ─────────────────────────────────────────────────────────────────────
    function parseDigits(raw, count) {
        const max = Math.min(count - 1, 5);
        if (max < 0) return [];
        const re = new RegExp('[0-' + max + ']', 'g');
        const lines = String(raw).split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        for (let i = lines.length - 1; i >= 0; i--) {
            const hits = lines[i].match(re);
            if (hits) return [...new Set(hits.map(Number))];
        }
        return [];
    }

    function parseNumber(raw) {
        const m = String(raw).match(/-?\d+(?:\.\d+)?/);
        return m ? parseFloat(m[0]) : null;
    }

    function parsePercent(raw) {
        const nums = String(raw).match(/-?\d+(?:\.\d+)?/g);
        if (!nums || nums.length < 2) return null;
        const x = parseFloat(nums[0]);
        const y = parseFloat(nums[1]);
        if (isNaN(x) || isNaN(y)) return null;
        return { x: Math.max(0, Math.min(100, x)), y: Math.max(0, Math.min(100, y)) };
    }

    function parsePermutation(raw, n) {
        const nums = (String(raw).match(/\d+/g) || []).map(Number).filter(x => x >= 1 && x <= n);
        if (nums.length < n) return null;
        return nums.slice(0, n);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Scan debug
    // ─────────────────────────────────────────────────────────────────────
    function doScan() {
        const q = getQuestion();
        const kind = detectKind();
        const els = getAnswerEls();
        const img = getQuestionImage();
        rowQ.textContent = (q ? '✓ Q: "' + q.slice(0, 160) + '"' : '❌ Q: not found') + (img ? ' [📷]' : '');
        rowK.textContent = 'K: ' + kind;
        rowA.textContent = els.length
            ? '✓ A (' + els.length + '):\n' + els.map((e,i) => '  '+i+': "'+cleanText(e).slice(0,60)+'"').join('\n')
            : '❌ A: no buttons found';
    }

    // ─────────────────────────────────────────────────────────────────────
    // Per-kind handlers
    // ─────────────────────────────────────────────────────────────────────
    function getReactProps(el) {
        if (!el) return null;
        for (const k of Object.keys(el)) {
            if (k.startsWith('__reactProps$') || k.startsWith('__reactInternalInstance$')) {
                return el[k];
            }
        }
        return null;
    }
    function callReactHandler(el, handlerName) {
        let node = el;
        for (let i = 0; i < 5 && node; i++) {
            const props = getReactProps(node);
            const fn = props && props[handlerName];
            if (typeof fn === 'function') {
                try {
                    const synth = {
                        preventDefault() {}, stopPropagation() {}, persist() {},
                        target: el, currentTarget: node, isTrusted: true,
                        bubbles: true, type: handlerName.slice(2).toLowerCase(),
                        nativeEvent: new MouseEvent(handlerName.slice(2).toLowerCase(), { bubbles: true }),
                    };
                    fn(synth);
                    return true;
                } catch(e) { console.warn('[kw] fiber handler threw:', e); }
            }
            node = node.parentElement;
        }
        return false;
    }

    function dispatchClickChain(el) {
        if (!el) return false;
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width  / 2;
        const cy = r.top  + r.height / 2;
        const target = document.elementFromPoint(cx, cy) || el;
        const base = { bubbles: true, cancelable: true, composed: true, view: window, button: 0, clientX: cx, clientY: cy };
        const pOpts = Object.assign({}, base, { pointerType: 'mouse', isPrimary: true, pointerId: 1 });
        try {
            target.dispatchEvent(new PointerEvent('pointerover', pOpts));
            target.dispatchEvent(new PointerEvent('pointerenter', pOpts));
            target.dispatchEvent(new MouseEvent('mouseover', base));
            target.dispatchEvent(new PointerEvent('pointerdown', Object.assign({}, pOpts, { buttons: 1 })));
            target.dispatchEvent(new MouseEvent('mousedown', Object.assign({}, base, { buttons: 1 })));
            if (window.TouchEvent) {
                try {
                    const touch = new Touch({ identifier: 1, target, clientX: cx, clientY: cy, pageX: cx, pageY: cy });
                    target.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, composed: true, touches: [touch], targetTouches: [touch], changedTouches: [touch] }));
                    target.dispatchEvent(new TouchEvent('touchend',   { bubbles: true, cancelable: true, composed: true, touches: [],      targetTouches: [],      changedTouches: [touch] }));
                } catch(e) {}
            }
            target.dispatchEvent(new PointerEvent('pointerup', pOpts));
            target.dispatchEvent(new MouseEvent('mouseup', base));
            target.dispatchEvent(new MouseEvent('click', base));
            return true;
        } catch(e) { return false; }
    }

    function fireClick(el) {
        if (!el) return false;
        const fiberOk = callReactHandler(el, 'onClick');
        if (fiberOk) { console.log('[kw] fiber onClick fired on', el); return true; }
        const chainOk = dispatchClickChain(el);
        if (chainOk) console.log('[kw] event chain fired on', el);
        try { el.click(); } catch(e) {}
        try { el.focus(); } catch(e) {}
        return chainOk;
    }
    function autoClickOne(el) {
        if (!autoClick || !el) return;
        setTimeout(() => fireClick(el), 80);
    }

    async function handleChoice(q, els, imgB64, multi) {
        rowA.textContent = 'A:\n' + els.map((e,i) => '  '+i+': "'+cleanText(e).slice(0,60)+'"').join('\n');
        const n = els.length;
        const digits = [...Array(n).keys()].join(',');
        const prompt = (multi
            ? 'Kahoot multi-select question (' + n + ' options, ' + digits + '). Reply with ALL correct digit(s) space-separated (e.g. "0 2"). NOTHING ELSE.\n\n'
            : 'Kahoot ' + (n === 2 ? 'TRUE/FALSE' : 'quiz') + ' question (' + n + ' options, ' + digits + '). Think carefully. Reply with ONLY ONE digit. NOTHING ELSE.\n\n')
            + 'Question: ' + q + '\n\n'
            + els.map((e,i) => i + ': ' + cleanText(e)).join('\n')
            + '\n\nAnswer:';
        const raw = await askAI(prompt, imgB64);
        let choices = parseDigits(raw, n);
        if (!multi) choices = choices.slice(0, 1);
        if (!choices.length) { setStatus('⚠ bad', '#ff7b72'); return false; }
        const fresh = getAnswerEls();
        choices.forEach(i => { if (fresh[i]) { showRing(fresh[i]); autoClickOne(fresh[i]); } });
        setStatus('✓ ' + choices.map(i => cleanText(fresh[i] || els[i]).slice(0, 12)).join(' + '), '#00ff88');
        if (multi) {
            if (autoClick) setTimeout(() => {
                const sub = document.querySelector('[data-functional-selector="submit-answer-button"]');
                if (sub) fireClick(sub);
            }, 450);
        }
        return true;
    }

    async function handleTypeFamily(q, imgB64, kind) {
        rowA.textContent = 'A: [' + kind + ']';
        const limit = kind === K.WORDCLOUD ? 20 : (kind === K.TYPE ? 60 : 200);
        const prompt =
            'Kahoot ' + kind + ' question. Reply with ONLY the exact short answer text (<= ' + limit + ' chars). ' +
            'No quotes, no explanation, no prefix, nothing else.\n\n' +
            'Question: ' + q + '\n\nAnswer:';
        const raw = (await askAI(prompt, imgB64)).split('\n')[0].trim();
        const ans = raw.replace(/^["'`]|["'`]$/g, '').slice(0, limit);
        if (!ans) { setStatus('⚠ no ans', '#ff7b72'); return false; }
        showTextHint(ans);
        setStatus('→ ' + ans.slice(0, 24), '#00ff88');
        if (autoClick) {
            const input = getTypeInput();
            if (input) {
                try {
                    const setter = Object.getOwnPropertyDescriptor(input.__proto__, 'value')?.set
                        || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
                    setter.call(input, ans);
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                } catch(e) {}
            }
        }
        return true;
    }

    async function handleSlider(q, imgB64) {
        const slider = getSliderInput();
        if (!slider) { setStatus('⚠ no slider', '#ff7b72'); return false; }
        const min = parseFloat(slider.getAttribute('min') || slider.getAttribute('aria-valuemin') || '0');
        const max = parseFloat(slider.getAttribute('max') || slider.getAttribute('aria-valuemax') || '100');
        const step = parseFloat(slider.getAttribute('step') || '1');
        rowA.textContent = 'A: slider [' + min + '..' + max + ' step ' + step + ']';
        const prompt =
            'Kahoot slider question. Pick a number between ' + min + ' and ' + max + ' (step ' + step + '). ' +
            'Reply with ONLY the number. NOTHING ELSE.\n\n' +
            'Question: ' + q + '\n\nAnswer:';
        const raw = await askAI(prompt, imgB64);
        let num = parseNumber(raw);
        if (num === null) { setStatus('⚠ bad num', '#ff7b72'); return false; }
        num = Math.max(min, Math.min(max, Math.round(num / step) * step));
        showTextHint(String(num));
        setStatus('→ ' + num, '#00ff88');
        if (autoClick) {
            try {
                const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
                setter.call(slider, String(num));
                slider.dispatchEvent(new Event('input', { bubbles: true }));
                slider.dispatchEvent(new Event('change', { bubbles: true }));
            } catch(e) {}
        }
        return true;
    }

    async function handleNPS(q, imgB64) {
        const numBtns = [...document.querySelectorAll('button,[role="button"]')]
            .filter(b => /^(10|[0-9])$/.test(cleanText(b)))
            .sort((a, b) => parseInt(cleanText(a), 10) - parseInt(cleanText(b), 10));
        if (numBtns.length < 10) { setStatus('⚠ no nps btns', '#ff7b72'); return false; }
        rowA.textContent = 'A: NPS 0-10 (' + numBtns.length + ' buttons)';
        const prompt =
            'Kahoot NPS/scale question (pick 0-' + (numBtns.length - 1) + '). ' +
            'Reply with ONLY the number. NOTHING ELSE.\n\n' +
            'Question: ' + q + '\n\nAnswer:';
        const raw = await askAI(prompt, imgB64);
        let num = parseNumber(raw);
        if (num === null) { setStatus('⚠ bad', '#ff7b72'); return false; }
        num = Math.max(0, Math.min(numBtns.length - 1, Math.round(num)));
        const target = numBtns.find(b => parseInt(cleanText(b), 10) === num);
        if (target) { showRing(target, String(num)); autoClickOne(target); }
        setStatus('→ ' + num, '#00ff88');
        return true;
    }

    async function handlePin(q, imgB64) {
        const img = getQuestionImage();
        if (!img || !imgB64) { setStatus('⚠ no pin img', '#ff7b72'); return false; }
        rowA.textContent = 'A: pin-answer (vision)';
        const prompt =
            'Kahoot "pin answer" / drop-pin question. Look at the attached image. The player taps a point. ' +
            'Reply with the correct point as "X% Y%" where X is horizontal (0-100, left=0) and Y is vertical (0-100, top=0). ' +
            'Only those two numbers with % signs, nothing else.\n\n' +
            'Question: ' + q + '\n\nAnswer:';
        const raw = await askAI(prompt, imgB64);
        const pt = parsePercent(raw);
        if (!pt) { setStatus('⚠ bad coord', '#ff7b72'); return false; }
        showCrosshair(img, pt.x, pt.y);
        setStatus('→ ' + pt.x.toFixed(0) + '%,' + pt.y.toFixed(0) + '%', '#00ff88');
        if (autoClick) {
            const r = img.getBoundingClientRect();
            const cx = r.left + r.width  * pt.x / 100;
            const cy = r.top  + r.height * pt.y / 100;
            const opts = { bubbles: true, cancelable: true, composed: true, view: window, button: 0, clientX: cx, clientY: cy };
            try {
                img.dispatchEvent(new PointerEvent('pointerdown', Object.assign({}, opts, { pointerType: 'mouse', isPrimary: true, pointerId: 1 })));
                img.dispatchEvent(new MouseEvent('mousedown', opts));
                img.dispatchEvent(new PointerEvent('pointerup',   Object.assign({}, opts, { pointerType: 'mouse', isPrimary: true, pointerId: 1 })));
                img.dispatchEvent(new MouseEvent('mouseup', opts));
                img.dispatchEvent(new MouseEvent('click', opts));
            } catch(e) {}
        }
        return true;
    }

    function ordinal(n) {
        const s = ['th','st','nd','rd'], v = n % 100;
        return n + (s[(v - 20) % 10] || s[v] || s[0]);
    }

    function ensurePuzzleBadgesExist() {
        if (!puzzleRenderState || stealth) return;
        const s = puzzleRenderState;
        if (s.hintText && !s.hintEl) {
            const ov = D('div',
                'position:fixed;z-index:2147483646;pointer-events:none;' +
                'left:50%;transform:translateX(-50%);bottom:20px;' +
                'background:#0d1117;border:3px solid #00ff88;border-radius:10px;' +
                'color:#00ff88;font-family:system-ui,-apple-system,sans-serif;' +
                'font-size:16px;font-weight:bold;padding:10px 20px;' +
                'box-shadow:0 0 24px rgba(0,255,136,.5);' +
                'max-width:92vw;text-align:center;');
            ov.textContent = '→ ' + s.hintText;
            root().appendChild(ov); overlays.push(ov); s.hintEl = ov;
        }
        for (const e of s.entries) {
            if (!e.ring) {
                e.ring = D('div',
                    'position:fixed;pointer-events:none;z-index:2147483646;' +
                    'border:4px solid #00ff88;border-radius:8px;' +
                    'animation:kwp .8s ease-in-out infinite alternate;');
                root().appendChild(e.ring); overlays.push(e.ring);
            }
            if (!e.badge) {
                e.badge = D('div',
                    'position:fixed;pointer-events:none;z-index:2147483647;' +
                    'background:#00ff88;color:#0d1117;border-radius:12px;' +
                    'min-width:60px;height:40px;padding:0 14px;' +
                    'display:flex;align-items:center;justify-content:center;' +
                    'font-family:system-ui,-apple-system,sans-serif;font-size:20px;font-weight:900;' +
                    'box-shadow:0 0 18px rgba(0,255,136,.9),0 4px 14px rgba(0,0,0,.6);');
                e.badge.textContent = ordinal(e.slot);
                root().appendChild(e.badge); overlays.push(e.badge);
            }
        }
    }

    function tileSignature(el) {
        if (!el) return { text: '', imgSrc: '', dfs: '' };
        const img = el.querySelector('img');
        return {
            text: cleanText(el) || '',
            imgSrc: img ? (img.currentSrc || img.src || '') : '',
            dfs: el.getAttribute('data-functional-selector') || '',
        };
    }

    function sigMatchesEl(sig, el) {
        if (!el) return false;
        const cur = tileSignature(el);
        if (sig.imgSrc && cur.imgSrc && sig.imgSrc === cur.imgSrc) return true;
        if (sig.text && cur.text) {
            if (sig.text === cur.text) return true;
            if (sig.text.startsWith(cur.text) && cur.text.length >= 2) return true;
            if (cur.text.startsWith(sig.text) && sig.text.length >= 2) return true;
        }
        return false;
    }

    function findTileBySig(sig) {
        const tiles = [...document.querySelectorAll('[data-functional-selector^="answer-"]')]
            .filter(el => /^answer-\d+$/.test(el.getAttribute('data-functional-selector') || ''));
        const list = tiles.length ? tiles : [...document.querySelectorAll('[draggable="true"]')];
        return list.find(el => sigMatchesEl(sig, el))
            || (sig.dfs ? document.querySelector('[data-functional-selector="' + sig.dfs + '"]') : null);
    }

    function renderPuzzleBadges() {
        if (!puzzleRenderState) return;
        ensurePuzzleBadgesExist();
        for (const e of puzzleRenderState.entries) {
            const el = findTileBySig(e.sig);
            if (!el || !e.ring || !e.badge) continue;
            const r = el.getBoundingClientRect();
            if (!r.width) continue;
            e.ring.style.top    = (r.top    - 5)  + 'px';
            e.ring.style.left   = (r.left   - 5)  + 'px';
            e.ring.style.width  = (r.width  + 10) + 'px';
            e.ring.style.height = (r.height + 10) + 'px';
            e.badge.style.top   = (r.top    - 14) + 'px';
            e.badge.style.left  = (r.left   + r.width/2 - 40) + 'px';
        }
    }

    async function handlePuzzle(q, imgB64) {
        let tiles = [...document.querySelectorAll('[data-functional-selector^="answer-"]')]
            .filter(el => /^answer-\d+$/.test(el.getAttribute('data-functional-selector') || ''));
        if (tiles.length < 2) tiles = [...document.querySelectorAll('[draggable="true"]')];
        if (tiles.length < 2) tiles = getAnswerEls();
        if (tiles.length < 2) { setStatus('⚠ no puzzle tiles', '#ff7b72'); return false; }

        const n = tiles.length;
        const items = tiles.map(cleanText);
        const sigs = tiles.map(tileSignature);
        const tileImgs = tiles.map(el => el.querySelector('img'));
        const hasImgs = tileImgs.some(Boolean);

        const images = imgB64 ? [imgB64] : [];
        const tileLines = [];
        const attachedTiles = [];
        for (let i = 0; i < n; i++) {
            if (tileImgs[i]) {
                const b64 = imgToBase64(tileImgs[i]);
                if (b64) {
                    images.push(b64);
                    attachedTiles.push(i + 1);
                    tileLines.push((i + 1) + ': [tile image attached—see images below in order]');
                    continue;
                }
            }
            tileLines.push((i + 1) + ': ' + (items[i] || '[blank or unreadable tile]'));
        }

        rowA.textContent = 'A: puzzle (' + n + ')' + (hasImgs ? ' · ' + attachedTiles.length + ' tile imgs' : '') + ':\n'
            + items.map((t,i) => '  ' + (i+1) + ': "' + ((t || (tileImgs[i] ? '[img]' : '[blank]'))).slice(0,60) + '"').join('\n');

        const imgOrderNote = images.length
            ? '\n\nAttached images, in order: ' + (imgB64 ? '[question/context image]' : '') +
              (attachedTiles.length ? (imgB64 ? ', ' : '') + attachedTiles.map(i => 'tile ' + i).join(', ') : '')
            : '';

        const prompt =
            'Kahoot puzzle / reorder question. There are ' + n + ' tiles listed below in their CURRENT (scrambled) order 1..' + n + '. ' +
            'Each tile may be text, an image, or both. ' +
            'Reply with the correct order as space-separated numbers. ' +
            'Example for 4 items: "3 1 4 2" means tile #3 goes FIRST, #1 goes SECOND, #4 THIRD, #2 LAST. ' +
            'Reply with NUMBERS ONLY, nothing else.\n\n' +
            'Question: ' + q + '\n\n' +
            tileLines.join('\n') +
            imgOrderNote +
            '\n\nCorrect order:';

        const raw = await askAI(prompt, images.length ? images : null);
        const perm = parsePermutation(raw, n);
        if (!perm) { setStatus('⚠ bad perm', '#ff7b72'); return false; }

        const entries = perm.map((origIdx, slotIdx) => ({
            sig: sigs[origIdx - 1] || { text: '', imgSrc: '', dfs: '' },
            text: items[origIdx - 1] || (tileImgs[origIdx - 1] ? '[img]' : '[blank]'),
            slot: slotIdx + 1,
            ring: null, badge: null,
        }));
        const hintText = entries.map(e => ordinal(e.slot) + ': ' + e.text.slice(0, 18)).join('  →  ');
        puzzleRenderState = { entries, hintText, hintEl: null };
        renderPuzzleBadges();

        setStatus('→ ' + perm.join(' '), '#00ff88');

        if (autoClick) {
            for (let slot = 0; slot < perm.length; slot++) {
                setTimeout(() => {
                    const e = entries[slot];
                    const el = findTileBySig(e.sig) || tiles[perm[slot] - 1];
                    if (el) {
                        fireClick(el);
                        console.log('[kw] puzzle click', slot + 1, '/', perm.length, '-> tile text="' + e.sig.text.slice(0, 24) + '"');
                    }
                }, 500 + slot * 600);
            }
        }
        return true;
    }

    // ─────────────────────────────────────────────────────────────────────
    // Main dispatcher
    // ─────────────────────────────────────────────────────────────────────
    async function tryAnswer() {
        if (busy) return;
        const kind = detectKind();
        if (kind === K.LOBBY || kind === K.LEADERBOARD || kind === K.UNKNOWN) return;

        const q = getQuestion();
        if (!q || q === lastQ) return;

        if ((kind === K.QUIZ || kind === K.MULTI || kind === K.TF) && getAnswerEls().length < 2) return;
        if ((kind === K.TYPE || kind === K.WORDCLOUD || kind === K.OPENENDED) && !getTypeInput()) return;
        if (kind === K.SLIDER && !getSliderInput()) return;

        lastQ = q; busy = true; clearOverlays();
        setStatus('⏳ ' + kind, '#58a6ff');
        rowQ.textContent = '⏳ Q: "' + q.slice(0, 160) + '"';
        rowK.textContent = 'K: ' + kind;

        const imgEl = getQuestionImage();
        const imgB64 = imgEl ? imgToBase64(imgEl) : null;
        if (imgB64) rowQ.textContent += ' [📷]';

        try {
            switch (kind) {
                case K.QUIZ:
                case K.TF:
                    await handleChoice(q, getAnswerEls(), imgB64, false);
                    break;
                case K.MULTI:
                    await handleChoice(q, getAnswerEls(), imgB64, true);
                    break;
                case K.TYPE:
                case K.WORDCLOUD:
                case K.OPENENDED:
                    await handleTypeFamily(q, imgB64, kind);
                    break;
                case K.SLIDER:
                case K.SCALE:
                    await handleSlider(q, imgB64);
                    break;
                case K.NPS:
                    await handleNPS(q, imgB64);
                    break;
                case K.PIN:
                    await handlePin(q, imgB64);
                    break;
                case K.PUZZLE:
                    await handlePuzzle(q, imgB64);
                    break;
            }
        } catch (e) {
            setStatus('✗ err', '#ff7b72');
            console.error('[kw]', e);
        }

        setTimeout(() => { busy = false; }, BUSY_MS);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Hotkeys
    // ─────────────────────────────────────────────────────────────────────
    let uiVisible = true;
    document.addEventListener('keydown', e => {
        if (!e.altKey) return;
        const code = e.code;
        if (code === 'KeyH') {
            e.preventDefault();
            uiVisible = !uiVisible;
            badge.style.opacity       = uiVisible ? '1' : '0';
            badge.style.pointerEvents = uiVisible ? 'auto' : 'none';
            if (!uiVisible) panel.style.display = 'none';
            setStatus(uiVisible ? '👁 UI shown' : '👁 UI hidden', '#58a6ff');
            setTimeout(resetBadge, 2000);
        } else if (code === 'KeyA') {
            e.preventDefault();
            autoClick = !autoClick;
            GM_setValue('kw_autoclick', autoClick);
            btnAuto.textContent = autoClick ? 'ON' : 'OFF';
            btnAuto.style.background = autoClick ? '#dc2626' : '#374151';
            setStatus(autoClick ? '🤖 AUTO-CLICK ON' : '🤖 AUTO-CLICK OFF', autoClick ? '#dc2626' : '#8b949e');
            console.log('[kw] auto-click', autoClick ? 'ON' : 'OFF');
            setTimeout(resetBadge, 2500);
        } else if (code === 'KeyS') {
            e.preventDefault();
            stealth = !stealth;
            GM_setValue('kw_stealth', stealth);
            btnStealth.textContent = stealth ? 'ON' : 'OFF';
            btnStealth.style.background = stealth ? '#6366f1' : '#374151';
            if (stealth) clearOverlays();
            setStatus(stealth ? '🥷 STEALTH ON' : '🥷 STEALTH OFF', stealth ? '#6366f1' : '#8b949e');
            console.log('[kw] stealth', stealth ? 'ON' : 'OFF');
            setTimeout(resetBadge, 2500);
        }
    }, true);

    // ─────────────────────────────────────────────────────────────────────
    // Watchers
    // ─────────────────────────────────────────────────────────────────────
    let prevQ = '';
    setInterval(() => {
        ensureInDOM();
        const q = getQuestion();
        if (q && q !== prevQ) {
            clearOverlays();
            prevQ = q;
            puzzleRenderState = null;
        }
        if (puzzleRenderState) renderPuzzleBadges();
    }, 400);

    let moTimer;
    const scheduleAnswer = () => { clearTimeout(moTimer); moTimer = setTimeout(tryAnswer, 180); };
    new MutationObserver(scheduleAnswer).observe(document.documentElement, { childList: true, subtree: true });
    setInterval(tryAnswer, 900);

    setStatus('✓ v8 ready', '#3fb950');
    setTimeout(resetBadge, 2000);

})();
