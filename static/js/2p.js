(function () {
  'use strict';

  let _visible = false;
  let _status = null;      // { mode, local_configured, [session_id, session_key, session_id_full, session_key_full, relay_url] }
  let _confirmRotate = false;
  let _remoteDisclaimer = false;
  let _pendingEnable = false;  // intermediate state: user clicked ENABLE, choosing mode
  let _pasteIdOpen  = false;
  let _pasteKeyOpen = false;
  let _pasteIdError  = null;
  let _pasteKeyError = null;
  let _pasteIdVal   = '';
  let _pasteKeyVal  = '';
  let _busy = false;

  // ── DOM setup ──────────────────────────────────────────────────────
  const _overlay = document.createElement('div');
  _overlay.id = 'm2p-overlay';
  _overlay.innerHTML = `<div id="m2p-box"><div id="m2p-title">2-PLAYER MODE</div><div id="m2p-body"></div></div>`;
  document.body.appendChild(_overlay);

  const _body = _overlay.querySelector('#m2p-body');

  _overlay.addEventListener('click', e => { if (e.target === _overlay) _close(); });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && _visible) { e.stopPropagation(); _close(); }
  }, true);

  // ── API helpers ────────────────────────────────────────────────────
  async function _api(path, method, body) {
    const opts = { method: method || 'GET', headers: {} };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const r = await fetch(path, opts);
    return r.json();
  }

  function _copy(text) {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => _legacyCopy(text));
    } else {
      _legacyCopy(text);
    }
  }

  function _legacyCopy(text) {
    const t = document.createElement('textarea');
    t.value = text;
    t.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
    document.body.appendChild(t);
    t.select();
    try { document.execCommand('copy'); } catch {}
    document.body.removeChild(t);
  }

  function _flash(btn, msg) {
    const orig = btn.textContent;
    btn.textContent = msg;
    btn.classList.add('flash');
    setTimeout(() => { btn.textContent = orig; btn.classList.remove('flash'); }, 900);
  }

  // ── Render ─────────────────────────────────────────────────────────
  function _render() {
    if (!_status) {
      _body.innerHTML = '<div class="m2p-info" style="text-align:center;padding:12px 0">LOADING...</div>';
      return;
    }

    const { mode, local_configured } = _status;
    const off = mode === 'off';
    let h = '';

    if (_remoteDisclaimer) {
      // Status row without a toggle button -- user is in the disclaimer flow
      h += `<div class="m2p-row">
        <span class="m2p-label">STATUS</span>
        <span class="m2p-status-val ${off ? 'offline' : 'online'}">${off ? 'OFFLINE' : 'ONLINE'}</span>
      </div>`;

      h += `<div class="m2p-divider"></div>
      <div style="margin-bottom:14px">
        <div style="font-family:'Press Start 2P',monospace;font-size:10px;color:rgba(175,200,238,0.88);letter-spacing:0.05em;line-height:1.7;margin-bottom:12px">PLAY WITH A FRIEND<br>ANYWHERE IN THE WORLD.</div>
        <div style="font-family:'Press Start 2P',monospace;font-size:8px;color:rgba(175,200,238,0.50);letter-spacing:0.03em;line-height:1.9;margin-bottom:14px">EACH PLAYER RUNS THEIR OWN INSTANCE<br>AND YOU SHARE A LIVE GAME SESSION<br>OVER AN ENCRYPTED RELAY.</div>
        <div style="font-family:'Press Start 2P',monospace;font-size:8px;color:rgba(100,180,255,0.78);letter-spacing:0.04em;margin-bottom:6px">WHAT YOUR PARTNER RECEIVES</div>
        <div style="font-family:'Press Start 2P',monospace;font-size:8px;color:rgba(175,200,238,0.48);letter-spacing:0.03em;line-height:1.9;margin-bottom:14px">&nbsp;&bull;&nbsp;QUERY STATUS (BLOCKED / ALLOWED)<br>&nbsp;&bull;&nbsp;QUERY TYPE (CACHE / UPSTREAM / BLOCKED)<br>&nbsp;&bull;&nbsp;BLOCKING ON/OFF AND SHIP SELECTION<br>&nbsp;&bull;&nbsp;NO DOMAINS. NO CLIENT IPS. NOTHING ELSE.</div>
        <div style="font-family:'Press Start 2P',monospace;font-size:8px;color:rgba(100,180,255,0.78);letter-spacing:0.04em;margin-bottom:6px">SECURITY</div>
        <div style="font-family:'Press Start 2P',monospace;font-size:8px;color:rgba(175,200,238,0.48);letter-spacing:0.03em;line-height:1.9;margin-bottom:14px">&nbsp;&bull;&nbsp;XSALSA20-POLY1305 END-TO-END ENCRYPTION<br>&nbsp;&bull;&nbsp;SESSION KEY NEVER LEAVES THIS DEVICE<br>&nbsp;&bull;&nbsp;THE RELAY SEES ONLY CIPHERTEXT</div>
        <div style="font-family:'Press Start 2P',monospace;font-size:8px;color:rgba(255,200,80,0.92);letter-spacing:0.04em;line-height:1.7">SHARE YOUR SESSION ID + KEY<br>ONLY WITH SOMEONE YOU TRUST.</div>
      </div>
      <div class="m2p-confirm-row">
        <button class="m2p-btn active" id="m2p-disclaimer-confirm">ENABLE REMOTE</button>
        <button class="m2p-btn" id="m2p-disclaimer-cancel">GO BACK</button>
      </div>`;

    } else if (_pendingEnable && off) {
      // Mode selection: user clicked ENABLE but hasn't confirmed a mode yet
      const remoteOk = _status.remote_enabled;
      h += `<div class="m2p-row">
        <span class="m2p-label">STATUS</span>
        <span class="m2p-status-val offline">OFFLINE</span>
        <button class="m2p-btn danger" id="m2p-toggle">DISABLE</button>
      </div>`;

      h += `<div class="m2p-divider"></div>
      <div class="m2p-row">
        <span class="m2p-label">MODE</span>
        <div class="m2p-seg">
          <button class="m2p-btn${!local_configured ? ' dim' : ''}" id="m2p-local"${!local_configured ? ' title="Requires PIHOLE2_URL"' : ''}>LOCAL</button>
          <button class="m2p-btn${!remoteOk ? ' dim' : ''}" id="m2p-remote"${!remoteOk ? ' title="Requires REMOTE_2P=true"' : ''}>REMOTE</button>
        </div>
      </div>`;

    } else if (!off) {
      // Online state
      const remoteOk = _status.remote_enabled;
      h += `<div class="m2p-row">
        <span class="m2p-label">STATUS</span>
        <span class="m2p-status-val online">ONLINE</span>
        <button class="m2p-btn danger" id="m2p-toggle">DISABLE</button>
      </div>`;

      h += `<div class="m2p-divider"></div>
      <div class="m2p-row">
        <span class="m2p-label">MODE</span>
        <div class="m2p-seg">
          <button class="m2p-btn${mode === 'local' ? ' active' : ''}${!local_configured ? ' dim' : ''}" id="m2p-local"${!local_configured ? ' title="Requires PIHOLE2_URL"' : ''}>LOCAL</button>
          <button class="m2p-btn${mode === 'remote' ? ' active' : ''}${!remoteOk ? ' dim' : ''}" id="m2p-remote"${!remoteOk ? ' title="Requires REMOTE_2P=true"' : ''}>REMOTE</button>
        </div>
      </div>`;

      if (mode === 'local') {
        h += `<div class="m2p-divider"></div>
        <div class="m2p-info">${local_configured ? 'SECOND PI-HOLE CONFIGURED' : 'REQUIRES PIHOLE2_URL IN ENV'}</div>`;
      }

      if (mode === 'remote') {
        if (_confirmRotate) {
          h += `<div class="m2p-divider"></div>
          <div class="m2p-warn">NEW HASHES WILL DISCONNECT<br>ANY ACTIVE SESSION.</div>
          <div class="m2p-confirm-row">
            <button class="m2p-btn danger" id="m2p-rotate-yes">CONFIRM ROTATE</button>
            <button class="m2p-btn" id="m2p-rotate-no">CANCEL</button>
          </div>`;
        } else {
          // SESSION ID row
          h += `<div class="m2p-divider"></div>
          <div class="m2p-hash-row">
            <span class="m2p-hash-label">SESSION ID</span>
            <span class="m2p-hash-val" title="base64url">${_esc(_status.session_id || '—')}</span>
            <div class="m2p-hash-actions">
              <button class="m2p-btn" id="m2p-copy-id">COPY</button>
              <button class="m2p-btn" id="m2p-paste-id">PASTE</button>
            </div>
          </div>`;
          if (_pasteIdOpen) {
            h += `<div class="m2p-paste-row">
              <input class="m2p-paste-input" id="m2p-paste-id-input" type="text"
                     value="${_esc(_pasteIdVal)}" placeholder="PASTE SESSION ID HERE"
                     spellcheck="false" autocomplete="off" autocorrect="off">
              <button class="m2p-btn danger" id="m2p-paste-id-confirm">APPLY</button>
              <button class="m2p-btn" id="m2p-paste-id-cancel">CANCEL</button>
            </div>
            ${_pasteIdError ? `<div class="m2p-hint">${_esc(_pasteIdError)}</div>` : ''}`;
          }

          // SESSION KEY row
          h += `<div class="m2p-hash-row" style="margin-top:4px">
            <span class="m2p-hash-label">SESSION KEY</span>
            <span class="m2p-hash-val" title="SHA-512/base64 · XSalsa20-Poly1305">${_esc(_status.session_key || '—')}</span>
            <div class="m2p-hash-actions">
              <button class="m2p-btn" id="m2p-copy-key">COPY</button>
              <button class="m2p-btn" id="m2p-paste-key">PASTE</button>
            </div>
          </div>`;
          if (_pasteKeyOpen) {
            h += `<div class="m2p-paste-row">
              <input class="m2p-paste-input" id="m2p-paste-key-input" type="text"
                     value="${_esc(_pasteKeyVal)}" placeholder="PASTE SESSION KEY HERE"
                     spellcheck="false" autocomplete="off" autocorrect="off">
              <button class="m2p-btn danger" id="m2p-paste-key-confirm">APPLY</button>
              <button class="m2p-btn" id="m2p-paste-key-cancel">CANCEL</button>
            </div>
            ${_pasteKeyError ? `<div class="m2p-hint">${_esc(_pasteKeyError)}</div>` : ''}`;
          }

          h += `<div class="m2p-divider"></div>
          <div class="m2p-remote-actions">
            <button class="m2p-btn" id="m2p-rotate">ROTATE</button>
          </div>`;
        }
      }

    } else {
      // Offline, not pending
      h += `<div class="m2p-row">
        <span class="m2p-label">STATUS</span>
        <span class="m2p-status-val offline">OFFLINE</span>
        <button class="m2p-btn" id="m2p-toggle">ENABLE</button>
      </div>`;
    }

    h += `<div class="m2p-divider"></div>
    <div class="m2p-footer">
      <button class="m2p-btn" id="m2p-close">CLOSE</button>
    </div>`;

    _body.innerHTML = h;
    _bind();
  }

  function _esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── Event binding ──────────────────────────────────────────────────
  function _bind() {
    const $ = id => document.getElementById(id);

    const toggle = $('m2p-toggle');
    if (toggle) toggle.addEventListener('click', async () => {
      if (_busy) return;
      if (_status.mode === 'off') {
        if (_pendingEnable) {
          // CANCEL from mode selection
          _pendingEnable = false;
        } else {
          // ENABLE clicked -- show mode selection
          _pendingEnable = true;
        }
        _render();
      } else {
        // DISABLE
        _busy = true;
        try { _status = await _api('/api/2p/mode', 'POST', { mode: 'off' }); } catch {}
        _confirmRotate = false; _pasteIdOpen = false; _pasteKeyOpen = false;
        _pasteIdError = null; _pasteKeyError = null; _pasteIdVal = ''; _pasteKeyVal = '';
        _pendingEnable = false; _busy = false;
        _render();
      }
    });

    const localBtn = $('m2p-local');
    if (localBtn) localBtn.addEventListener('click', async () => {
      if (_busy || !_status.local_configured) return;
      _busy = true;
      try { _status = await _api('/api/2p/mode', 'POST', { mode: 'local' }); } catch {}
      _confirmRotate = false; _pasteIdOpen = false; _pasteKeyOpen = false;
      _pasteIdError = null; _pasteKeyError = null; _pasteIdVal = ''; _pasteKeyVal = '';
      _pendingEnable = false; _busy = false;
      _render();
    });

    const remoteBtn = $('m2p-remote');
    if (remoteBtn) remoteBtn.addEventListener('click', () => {
      if (_busy || _status.mode === 'remote' || !_status.remote_enabled) return;
      _remoteDisclaimer = true; _render();
    });

    const disclaimerConfirm = $('m2p-disclaimer-confirm');
    if (disclaimerConfirm) disclaimerConfirm.addEventListener('click', async () => {
      if (_busy) return;
      _busy = true; _remoteDisclaimer = false; _pendingEnable = false;
      try { _status = await _api('/api/2p/mode', 'POST', { mode: 'remote' }); } catch {}
      _confirmRotate = false; _pasteIdOpen = false; _pasteKeyOpen = false;
      _pasteIdError = null; _pasteKeyError = null; _pasteIdVal = ''; _pasteKeyVal = ''; _busy = false;
      _render();
    });

    const disclaimerCancel = $('m2p-disclaimer-cancel');
    if (disclaimerCancel) disclaimerCancel.addEventListener('click', () => {
      // Go back to mode selection (if mode is still off) or back to on-state
      _remoteDisclaimer = false; _render();
    });

    const copyId = $('m2p-copy-id');
    if (copyId) copyId.addEventListener('click', () => {
      _copy(_status.session_id_full || '');
      _flash(copyId, 'COPIED');
    });

    const copyKey = $('m2p-copy-key');
    if (copyKey) copyKey.addEventListener('click', () => {
      _copy(_status.session_key_full || '');
      _flash(copyKey, 'COPIED');
    });

    const pasteId = $('m2p-paste-id');
    if (pasteId) pasteId.addEventListener('click', async () => {
      if (_busy) return;
      if (_pasteIdOpen) { _pasteIdOpen = false; _pasteIdError = null; _pasteIdVal = ''; _render(); return; }
      _pasteIdOpen = true; _pasteIdError = null; _pasteKeyOpen = false; _pasteKeyVal = '';
      try { _pasteIdVal = (await navigator.clipboard.readText()).trim(); } catch { _pasteIdVal = ''; }
      _render();
    });

    const pasteIdConfirm = $('m2p-paste-id-confirm');
    if (pasteIdConfirm) pasteIdConfirm.addEventListener('click', async () => {
      if (_busy) return;
      const inputEl = $('m2p-paste-id-input');
      const text = (inputEl ? inputEl.value : _pasteIdVal).trim();
      if (!text) { _pasteIdError = 'enter a session id'; _render(); return; }
      _busy = true; _pasteIdError = null;
      try {
        const res = await _api('/api/2p/update', 'POST', { session_id: text, session_key: null });
        if (res.error) { _pasteIdError = res.error; }
        else { _status = res; _pasteIdOpen = false; _pasteIdVal = ''; }
      } catch { _pasteIdError = 'request failed'; }
      _busy = false; _render();
    });

    const pasteIdCancel = $('m2p-paste-id-cancel');
    if (pasteIdCancel) pasteIdCancel.addEventListener('click', () => { _pasteIdOpen = false; _pasteIdError = null; _pasteIdVal = ''; _render(); });

    const pasteKey = $('m2p-paste-key');
    if (pasteKey) pasteKey.addEventListener('click', async () => {
      if (_busy) return;
      if (_pasteKeyOpen) { _pasteKeyOpen = false; _pasteKeyError = null; _pasteKeyVal = ''; _render(); return; }
      _pasteKeyOpen = true; _pasteKeyError = null; _pasteIdOpen = false; _pasteIdVal = '';
      try { _pasteKeyVal = (await navigator.clipboard.readText()).trim(); } catch { _pasteKeyVal = ''; }
      _render();
    });

    const pasteKeyConfirm = $('m2p-paste-key-confirm');
    if (pasteKeyConfirm) pasteKeyConfirm.addEventListener('click', async () => {
      if (_busy) return;
      const inputEl = $('m2p-paste-key-input');
      const text = (inputEl ? inputEl.value : _pasteKeyVal).trim();
      if (!text) { _pasteKeyError = 'enter a session key'; _render(); return; }
      _busy = true; _pasteKeyError = null;
      try {
        const res = await _api('/api/2p/update', 'POST', { session_id: null, session_key: text });
        if (res.error) { _pasteKeyError = res.error; }
        else { _status = res; _pasteKeyOpen = false; _pasteKeyVal = ''; }
      } catch { _pasteKeyError = 'request failed'; }
      _busy = false; _render();
    });

    const pasteKeyCancel = $('m2p-paste-key-cancel');
    if (pasteKeyCancel) pasteKeyCancel.addEventListener('click', () => { _pasteKeyOpen = false; _pasteKeyError = null; _pasteKeyVal = ''; _render(); });

    const rotateBtn = $('m2p-rotate');
    if (rotateBtn) rotateBtn.addEventListener('click', () => { _confirmRotate = true; _render(); });

    const rotateYes = $('m2p-rotate-yes');
    if (rotateYes) rotateYes.addEventListener('click', async () => {
      if (_busy) return;
      _busy = true;
      try { _status = await _api('/api/2p/rotate', 'POST', {}); } catch {}
      _confirmRotate = false; _busy = false;
      _render();
    });

    const rotateNo = $('m2p-rotate-no');
    if (rotateNo) rotateNo.addEventListener('click', () => { _confirmRotate = false; _render(); });

    const closeBtn = $('m2p-close');
    if (closeBtn) closeBtn.addEventListener('click', _close);
  }

  // ── Public API ─────────────────────────────────────────────────────
  function _close() {
    _visible = false;
    _overlay.classList.remove('m2p-open');
    _confirmRotate = false; _pasteIdOpen = false; _pasteKeyOpen = false;
    _pasteIdError = null; _pasteKeyError = null; _pasteIdVal = ''; _pasteKeyVal = ''; _busy = false;
    _remoteDisclaimer = false; _status = null;
    if (window._game2PReconnect) window._game2PReconnect();
  }

  async function _open() {
    _visible = true;
    _confirmRotate = false; _pasteIdOpen = false; _pasteKeyOpen = false;
    _pasteIdError = null; _pasteKeyError = null; _pasteIdVal = ''; _pasteKeyVal = ''; _busy = false;
    _remoteDisclaimer = false; _status = null;
    _overlay.classList.add('m2p-open');
    _render();
    try { _status = await _api('/api/2p/status'); } catch {}
    _render();
  }

  window.open2PModal  = _open;
  window.close2PModal = _close;
})();
