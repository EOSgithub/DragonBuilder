/* ============================================================================
   THE WYRMLING CODEX — shared save & sync layer
   Loaded by the three *_Skill_Tree.html pages. Owns everything the pages used
   to duplicate three times over: dirty tracking, the "Salva Modifiche" bar,
   the GitHub round-trip, device pairing and conflict detection.

   The pages keep owning their own game logic and their own localStorage key —
   this module never guesses either. It asks for them through init().
   ============================================================================ */
(function (global) {
  'use strict';

  /* Save names predate the current dragon names (abyssal stores dragon_villis).
     The mapping is fixed and explicit — never derived from the dragon slug —
     so existing saves, local and remote, keep resolving. */
  var SAVES = {
    erosion:  'dragon_erosion',
    telluric: 'dragon_telluric',
    abyssal:  'dragon_villis'
  };
  function savePath(dragon) { return SAVES[dragon] ? 'saves/' + SAVES[dragon] + '.json' : ''; }

  var API = 'https://api.github.com';
  var COMMIT_MSG = 'Update dragon saves [skip ci]';
  var QR_LIB = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';

  var cfg = { getState: null, setState: null, onApply: null };
  var dragon = '';        // erosion | telluric | abyssal
  var path = '';          // saves/dragon_x.json
  var baseline = '[]';    // last state known to match the remote file
  var sha = null;         // sha of the file we loaded, for conflict detection
  var busy = false;
  var ready = false;

  // ── Config ────────────────────────────────────────────────────────────────
  function readCfg() {
    return {
      owner: localStorage.getItem('gh_owner') || '',
      repo:  localStorage.getItem('gh_repo')  || '',
      token: localStorage.getItem('gh_token') || ''
    };
  }
  function writeCfg(c) {
    localStorage.setItem('gh_owner', c.owner);
    localStorage.setItem('gh_repo',  c.repo);
    localStorage.setItem('gh_token', c.token);
  }
  function configured() { var c = readCfg(); return !!(c.owner && c.repo && c.token); }
  function headers() {
    return {
      Authorization: 'Bearer ' + readCfg().token,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json'
    };
  }
  function contentsUrl(p) {
    var c = readCfg();
    return API + '/repos/' + c.owner + '/' + c.repo + '/contents/' + (p || path);
  }

  /* One remote read, used by every page. `no-store` matters: a cached 200 would
     silently defeat the whole point of re-reading on open. */
  function fetchSave(which) {
    var p = savePath(which);
    if (!p || !configured()) return Promise.resolve(null);
    return fetch(contentsUrl(p), { headers: headers(), cache: 'no-store' })
      .then(function (res) {
        if (res.status === 404) return { ids: null, sha: null, missing: true };
        if (!res.ok) throw new Error('GitHub API ' + res.status);
        return res.json().then(function (data) {
          var parsed = JSON.parse(unb64Content(data.content));
          return { ids: parsed.unlocked || [], sha: data.sha, missing: false };
        });
      });
  }

  // ── base64url, so a token survives a URL fragment intact ──────────────────
  function b64url(s) { return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function unb64url(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    return atob(s);
  }

  // ── Status readout (the config panel line) ────────────────────────────────
  function status(type, msg) {
    var el = document.getElementById('ghStatus');
    if (el) { el.textContent = msg; el.className = 'gh-status gh-' + type; }
  }

  // ── The save bar ──────────────────────────────────────────────────────────
  function buildBar() {
    if (document.getElementById('syncBar')) return;
    var bar = document.createElement('div');
    bar.id = 'syncBar';
    bar.className = 'savebar';
    bar.setAttribute('role', 'status');
    bar.innerHTML =
      '<div class="savebar-inner">' +
        '<span class="savebar-count" id="syncCount"></span>' +
        '<span class="savebar-actions">' +
          '<button type="button" class="btn btn--ghost savebar-undo" id="syncUndo">Annulla</button>' +
          '<button type="button" class="btn btn--save" id="syncSave">Salva Modifiche</button>' +
        '</span>' +
      '</div>';
    document.body.appendChild(bar);
    document.getElementById('syncSave').addEventListener('click', function () { save(); });
    document.getElementById('syncUndo').addEventListener('click', undo);
  }

  function cur() { return JSON.stringify(cfg.getState()); }
  function isDirty() { return cur() !== baseline; }

  function diffCount() {
    var now, was, i;
    try { now = JSON.parse(cur()); was = JSON.parse(baseline); } catch (e) { return 0; }
    var inWas = {}, inNow = {}, n = 0;
    for (i = 0; i < was.length; i++) inWas[was[i]] = 1;
    for (i = 0; i < now.length; i++) { inNow[now[i]] = 1; if (!inWas[now[i]]) n++; }
    for (i = 0; i < was.length; i++) if (!inNow[was[i]]) n++;
    return n;
  }

  function renderBar(message, tone) {
    var bar = document.getElementById('syncBar');
    if (!bar) return;
    var open = isDirty() || !!message;
    bar.classList.toggle('is-open', open);
    document.body.classList.toggle('has-savebar', open);

    var label = document.getElementById('syncCount');
    if (label) {
      if (message) {
        label.textContent = message;
        label.className = 'savebar-count' + (tone ? ' is-' + tone : '');
      } else {
        var n = diffCount();
        label.textContent = n === 1 ? '1 modifica non salvata' : n + ' modifiche non salvate';
        label.className = 'savebar-count';
      }
    }
    var saveBtn = document.getElementById('syncSave');
    if (saveBtn) saveBtn.disabled = busy;
    var undoBtn = document.getElementById('syncUndo');
    if (undoBtn) undoBtn.disabled = busy;
  }

  function markDirty() { if (ready) renderBar(); }

  function undo() {
    if (busy || !isDirty()) return;
    var ids;
    try { ids = JSON.parse(baseline); } catch (e) { return; }
    cfg.setState(ids);
    if (cfg.onApply) cfg.onApply();
    renderBar();
  }

  // ── Remote round-trip ─────────────────────────────────────────────────────
  function unb64Content(c) { return atob(String(c).replace(/\s/g, '')); }

  function load(silent) {
    if (!configured()) return Promise.resolve(false);
    if (!silent) status('sync', '↺ Carico da GitHub…');
    return fetchSave(dragon)
      .then(function (out) {
        if (!out || out.missing) {
          if (!silent) status('ok', '● Nessun salvataggio remoto — uso i dati locali');
          sha = null;
          return false;
        }
        sha = out.sha;
        cfg.setState(out.ids);
        baseline = cur();
        if (cfg.onApply) cfg.onApply();
        if (!silent) status('ok', '✓ Sincronizzato con GitHub');
        return true;
      })
      .catch(function (e) { status('err', '✗ ' + e.message); return false; });
  }

  /* Read every dragon at once and mirror it into localStorage, so a page that
     only displays saves (the codex index, a stat block) shows what the group
     last wrote rather than what this device happens to remember. */
  function fetchAll(dragons) {
    if (!configured()) return Promise.resolve({});
    status('sync', '↺ Carico da GitHub…');
    var out = {};
    return Promise.all(dragons.map(function (d) {
      return fetchSave(d)
        .then(function (r) {
          if (!r || r.missing || !r.ids) return;
          out[d] = r.ids;
          try { localStorage.setItem(SAVES[d], JSON.stringify(r.ids)); } catch (e) {}
        })
        .catch(function () { /* one dragon failing must not sink the others */ });
    })).then(function () {
      var n = Object.keys(out).length;
      status(n ? 'ok' : 'err', n ? '✓ Sincronizzato con GitHub' : '✗ Nessun salvataggio caricato');
      return out;
    });
  }

  function payloadFor(stateJson) { return JSON.stringify({ unlocked: JSON.parse(stateJson) }); }

  function save() {
    if (busy) return Promise.resolve(false);
    if (!configured()) {
      status('err', '✗ Configura prima GitHub Sync qui sotto');
      renderBar('Sincronizzazione non configurata', 'err');
      var panel = document.getElementById('ghSettings');
      if (panel) { panel.open = true; panel.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      return Promise.resolve(false);
    }

    busy = true;
    renderBar('↑ Salvo su GitHub…', 'sync');
    status('sync', '↑ Salvo su GitHub…');
    var payload = cur();

    return fetch(contentsUrl(), { headers: headers(), cache: 'no-store' })
      .then(function (res) {
        if (res.ok) return res.json().then(function (d) { return d.sha; });
        if (res.status === 404) return null;
        throw new Error('GitHub API ' + res.status);
      })
      .then(function (remoteSha) {
        // Someone else saved between our load and this write.
        if (remoteSha && sha && remoteSha !== sha) {
          var overwrite = confirm(
            'Il salvataggio remoto è cambiato da quando hai aperto questa pagina, ' +
            'probabilmente da un altro dispositivo.\n\n' +
            'OK = sovrascrivi con le tue modifiche\n' +
            'Annulla = scarta le tue modifiche e ricarica il remoto');
          if (!overwrite) {
            busy = false;
            return load(false).then(function () { renderBar(); return false; });
          }
        }
        var body = { message: COMMIT_MSG, content: btoa(payloadFor(payload)) };
        if (remoteSha) body.sha = remoteSha;
        return fetch(contentsUrl(), { method: 'PUT', headers: headers(), body: JSON.stringify(body) })
          .then(function (put) {
            if (!put.ok) throw new Error('GitHub API ' + put.status);
            return put.json();
          })
          .then(function (out) {
            sha = out.content && out.content.sha ? out.content.sha : null;
            baseline = payload;
            busy = false;
            status('ok', '✓ Salvato su GitHub');
            renderBar();
            return true;
          });
      })
      .catch(function (e) {
        busy = false;
        status('err', '✗ ' + e.message);
        renderBar('✗ ' + e.message, 'err');
        return false;
      });
  }

  // ── Device pairing ────────────────────────────────────────────────────────
  function pairLink() {
    var c = readCfg();
    return location.origin + location.pathname + '#cfg=' +
           b64url(JSON.stringify({ o: c.owner, r: c.repo, t: c.token }));
  }

  /* A pairing link carries a live token. Consume it and strip it from the URL
     immediately, so it never lingers in the address bar or in history. */
  function consumePairLink() {
    var m = /^#cfg=(.+)$/.exec(location.hash);
    if (!m) return false;
    history.replaceState(null, '', location.pathname + location.search);
    try {
      var d = JSON.parse(unb64url(m[1]));
      if (!d.o || !d.r || !d.t) throw new Error('link incompleto');
      writeCfg({ owner: d.o, repo: d.r, token: d.t });
      status('ok', '✓ Dispositivo configurato');
      return true;
    } catch (e) {
      status('err', '✗ Link di pairing non valido');
      return false;
    }
  }

  function loadQRLib() {
    if (global.QRCode) return Promise.resolve(true);
    return new Promise(function (resolve) {
      var s = document.createElement('script');
      s.src = QR_LIB;
      s.onload = function () { resolve(!!global.QRCode); };
      s.onerror = function () { resolve(false); };
      document.head.appendChild(s);
    });
  }

  function showPairing() {
    var box = document.getElementById('ghPair');
    if (!box) return;
    if (!configured()) { status('err', '✗ Salva prima la configurazione'); return; }

    box.hidden = false;
    var url = pairLink();
    var field = document.getElementById('ghPairLink');
    if (field) field.value = url;

    var host = document.getElementById('ghPairQR');
    if (!host) return;
    host.innerHTML = '';
    loadQRLib().then(function (ok) {
      if (!ok) {
        // The link alone still does the job — it just has to be sent, not scanned.
        host.innerHTML = '<p class="gh-hint">QR non disponibile — usa il link qui sotto.</p>';
        return;
      }
      new global.QRCode(host, {
        text: url, width: 190, height: 190,
        colorDark: '#0c1113', colorLight: '#e9e3d4',
        correctLevel: global.QRCode.CorrectLevel.M
      });
    });
  }

  function copyPairLink() {
    var field = document.getElementById('ghPairLink');
    if (!field) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(field.value).then(
        function () { status('ok', '✓ Link copiato'); },
        function () { field.select(); status('err', '✗ Copia manualmente il link'); });
    } else {
      field.select();
      try { document.execCommand('copy'); status('ok', '✓ Link copiato'); }
      catch (e) { status('err', '✗ Copia manualmente il link'); }
    }
  }

  // ── Config panel wiring ───────────────────────────────────────────────────
  function fillFields() {
    var owner = document.getElementById('ghOwner');
    var repo  = document.getElementById('ghRepo');
    var token = document.getElementById('ghToken');
    var c = readCfg();
    if (owner && c.owner) owner.value = c.owner;
    if (repo  && c.repo)  repo.value  = c.repo;
    if (token && c.token) token.value = c.token;

    // On <user>.github.io/<repo>/ the first two fields are already known.
    var parts = location.hostname.split('.');
    if (parts[1] === 'github' && parts[2] === 'io') {
      if (owner && !owner.value) owner.value = parts[0];
      var fromPath = location.pathname.split('/')[1];
      if (repo && !repo.value && fromPath) repo.value = fromPath;
    }
  }

  function fieldValue(id) {
    var el = document.getElementById(id);
    return el ? el.value.trim() : '';
  }

  function wirePanel() {
    var saveCfg = document.getElementById('ghSaveConfig');
    if (saveCfg) saveCfg.addEventListener('click', function () {
      writeCfg({
        owner: fieldValue('ghOwner'),
        repo:  fieldValue('ghRepo'),
        token: fieldValue('ghToken')
      });
      status('ok', '✓ Configurazione salvata');
      load(false).then(function () { renderBar(); });
    });

    var pairBtn = document.getElementById('ghPairBtn');
    if (pairBtn) pairBtn.addEventListener('click', showPairing);
    var copyBtn = document.getElementById('ghPairCopy');
    if (copyBtn) copyBtn.addEventListener('click', copyPairLink);
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  function init(opts) {
    cfg.getState = opts.getState;
    cfg.setState = opts.setState;
    cfg.onApply  = opts.onApply;
    dragon = opts.dragon;
    path = savePath(dragon);
    if (!path) { console.error('Codex Sync: unknown dragon "' + dragon + '"'); return; }

    buildBar();
    wirePanel();
    consumePairLink();   // may install a config; fillFields then shows it
    fillFields();

    // Whatever is on screen right now is, until the remote says otherwise,
    // already-saved work — the bar must not open on a plain page load.
    baseline = cur();
    ready = true;
    renderBar();

    if (configured()) load(false).then(function () { renderBar(); });

    /* Returning to a tab is the natural moment to pick up what another device
       wrote. Never while there is unsaved work here to clobber. */
    document.addEventListener('visibilitychange', function () {
      if (document.hidden || busy || !configured() || isDirty()) return;
      load(true).then(function () { renderBar(); });
    });

    window.addEventListener('beforeunload', function (e) {
      if (!isDirty()) return;
      e.preventDefault();
      e.returnValue = '';
    });
  }

  /* For pages that only display saves — the codex index and the stat blocks.
     No save bar, no dirty tracking, no writes: just the config panel and a
     fresh read of the named dragons every time the page opens. */
  function initReadOnly(opts) {
    opts = opts || {};
    var dragons = opts.dragons && opts.dragons.length ? opts.dragons : Object.keys(SAVES);

    wirePanel();
    consumePairLink();
    fillFields();

    if (!configured()) return Promise.resolve({});
    return fetchAll(dragons).then(function (out) {
      if (opts.onLoaded) opts.onLoaded(out);
      return out;
    });
  }

  global.Sync = {
    init: init,
    initReadOnly: initReadOnly,
    markDirty: markDirty,
    save: save,
    load: load,
    fetchAll: fetchAll,
    isDirty: isDirty,
    configured: configured
  };
})(window);
