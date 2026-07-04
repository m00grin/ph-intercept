(function () {
  'use strict';

  let _visible = false;
  let _status = null;      // { mode, local_configured }
  let _error = null;
  let _busy = false;
  let _needsReconnect = false;

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

  function _esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── Render ─────────────────────────────────────────────────────────
  function _render() {
    if (!_status) {
      _body.innerHTML = '<div class="m2p-info" style="text-align:center;padding:12px 0">LOADING...</div>';
      return;
    }

    const off = _status.mode === 'off';
    let h = '';

    h += `<div class="m2p-row">
      <span class="m2p-label">STATUS</span>
      <span class="m2p-status-val ${off ? 'offline' : 'online'}">${off ? 'OFFLINE' : 'ONLINE'}</span>
      <button class="m2p-btn${off ? '' : ' danger'}" id="m2p-toggle">${off ? 'ENABLE' : 'DISABLE'}</button>
    </div>`;

    if (!off) {
      const _p2Name = window.PROVIDER === 'adguard' ? 'ADGUARD'
                    : window.PROVIDER === 'technitium' ? 'TECHNITIUM'
                    : 'PI-HOLE';
      h += `<div class="m2p-divider"></div>
      <div class="m2p-info">SECOND ${_p2Name} CONNECTED</div>`;
    }

    if (_error) {
      h += `<div class="m2p-error">${_esc(_error)}</div>`;
    }

    h += `<div class="m2p-divider"></div>
    <div class="m2p-footer">
      <button class="m2p-btn" id="m2p-close">CLOSE</button>
    </div>`;

    _body.innerHTML = h;
    _bind();
  }

  // ── Event binding ──────────────────────────────────────────────────
  function _bind() {
    const $ = id => document.getElementById(id);

    const toggle = $('m2p-toggle');
    if (toggle) toggle.addEventListener('click', async () => {
      if (_busy) return;
      _busy = true; _error = null;
      const newMode = _status.mode === 'off' ? 'local' : 'off';
      try {
        const res = await _api('/api/2p/mode', 'POST', { mode: newMode });
        if (res.error) {
          _error = res.error;
        } else {
          _status = res; _needsReconnect = true;
        }
      } catch { _error = 'Request failed'; }
      _busy = false;
      _render();
    });

    const closeBtn = $('m2p-close');
    if (closeBtn) closeBtn.addEventListener('click', _close);
  }

  // ── Public API ─────────────────────────────────────────────────────
  function _close() {
    _visible = false;
    _overlay.classList.remove('m2p-open');
    _error = null; _busy = false;
    _status = null;
    if (_needsReconnect && window._game2PReconnect) window._game2PReconnect();
    _needsReconnect = false;
  }

  async function _open() {
    _visible = true;
    _needsReconnect = false;
    _error = null; _busy = false;
    _status = null;
    _overlay.classList.add('m2p-open');
    _render();
    try { _status = await _api('/api/2p/status'); } catch {}
    _render();
  }

  window.open2PModal  = _open;
  window.close2PModal = _close;
})();
