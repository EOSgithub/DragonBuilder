/* ============================================================================
   THE WYRMLING CODEX — shared interaction layer
   Loaded by the three *_Statblock.html pages. Adds, without touching any
   game logic or save keys:
     1. Semantic highlighting — DC (gold), dice/damage (ember), conditions (violet)
     2. Tap an ability to roll every die it contains
     3. A Quick-DC strip derived from whatever the plate just rendered
   The pages own render(); they call Codex.enhance() after each one.
   ============================================================================ */
(function (global) {
  'use strict';

  var DMG_TYPES = 'cold|fire|force|psychic|necrotic|radiant|acid|lightning|thunder|poison|slashing|piercing|bludgeoning';
  var ABIL = 'STR|DEX|CON|INT|WIS|CHA';
  var CONDITIONS = [
    'frightened', 'charmed', 'slowed', 'dazed', 'prone', 'petrified', 'blinded',
    'restrained', 'stunned', 'incapacitated', 'paralyzed', 'poisoned', 'deafened',
    'grappled', 'unconscious', 'invisible', 'exhaustion', 'bleeding',
    'difficult terrain', 'heavily obscuring', 'heavily obscured'
  ].join('|');

  /* One pass, four token families. Alternation order matters: a DC clause is
     tried before the bare dice that may sit inside it. */
  var TOKEN = new RegExp(
    '(' +
      '\\b(?:' + ABIL + ')\\s+sav(?:e|ing\\s+throws?)\\s*\\(\\s*DC\\s*\\d+\\s*\\)' +
      '|\\bDC\\s*\\d+(?:\\s*(?:' + ABIL + '))?(?:\\s+sav(?:e|ing\\s+throws?))?' +
    ')' +
    '|([+−-]\\d+\\s+to\\s+hit)' +
    '|([+−-]?\\d*d\\d+(?:\\s*[+−-]\\s*\\d+)?(?:\\s+(?:' + DMG_TYPES + '))?)' +
    '|(\\[[A-Za-z][A-Za-z ]*\\]|\\b(?:' + CONDITIONS + ')\\b)' +
    // Flat damage, e.g. "5 bludgeoning" — some entries deal a fixed value with
    // no die. Shown, but never rolled.
    '|(\\b\\d+\\s+(?:' + DMG_TYPES + ')\\b)',
    'gi'
  );

  var SCOPE = '.sb-ability, .sb-mechanic, .sb-prop';

  // ── Highlighting ──────────────────────────────────────────────────────────
  function collectTextNodes(root) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var out = [], n;
    while ((n = walker.nextNode())) {
      if (n.nodeValue && /\S/.test(n.nodeValue)) out.push(n);
    }
    return out;
  }

  function highlight(scope) {
    collectTextNodes(scope).forEach(function (node) {
      // Never re-wrap something already marked.
      if (node.parentNode && node.parentNode.classList &&
          node.parentNode.classList.contains('hl')) return;

      var text = node.nodeValue;
      TOKEN.lastIndex = 0;
      if (!TOKEN.test(text)) return;
      TOKEN.lastIndex = 0;

      var frag = document.createDocumentFragment();
      var last = 0, m;
      while ((m = TOKEN.exec(text)) !== null) {
        if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
        var span = document.createElement('span');
        span.className = m[1] ? 'hl hl-dc'
                       : m[2] ? 'hl hl-hit'
                       : m[3] ? 'hl hl-dice'
                       : m[4] ? 'hl hl-cond'
                              : 'hl hl-flat';
        span.textContent = m[0];
        frag.appendChild(span);
        last = m.index + m[0].length;
      }
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      node.parentNode.replaceChild(frag, node);
    });
  }

  // ── Dice ──────────────────────────────────────────────────────────────────
  function d(sides) { return Math.floor(Math.random() * sides) + 1; }

  var DICE_RX = /([+\-])?\s*(\d*)d(\d+)\s*([+\-]\s*\d+)?\s*(\w+)?/i;

  function parseDice(str) {
    var m = DICE_RX.exec(str.replace(/−/g, '-'));
    if (!m) return null;
    return {
      count: parseInt(m[2] || '1', 10) || 1,
      sides: parseInt(m[3], 10),
      mod: m[4] ? parseInt(m[4].replace(/\s+/g, ''), 10) : 0,
      type: m[5] && new RegExp('^(?:' + DMG_TYPES + ')$', 'i').test(m[5]) ? m[5].toLowerCase() : ''
    };
  }

  function rollSpec(spec) {
    var dice = [];
    for (var i = 0; i < spec.count; i++) dice.push(d(spec.sides));
    var sum = dice.reduce(function (a, b) { return a + b; }, 0);
    return { dice: dice, sides: spec.sides, mod: spec.mod, total: sum + spec.mod, type: spec.type };
  }

  function abilityRolls(ability) {
    var rolls = [];

    ability.querySelectorAll('.hl-hit').forEach(function (el) {
      var mod = parseInt(el.textContent.replace(/−/g, '-').replace(/[^\d+\-]/g, ''), 10) || 0;
      var nat = d(20);
      rolls.push({
        label: 'To Hit', dice: [nat], sides: 20, mod: mod, total: nat + mod,
        type: '', crit: nat === 20, fumble: nat === 1
      });
    });

    ability.querySelectorAll('.hl-dice').forEach(function (el) {
      var spec = parseDice(el.textContent);
      if (!spec) return;
      var r = rollSpec(spec);
      r.label = r.type || 'Damage';
      rolls.push(r);
    });

    // Fixed damage carries no die, but still belongs in the tally.
    ability.querySelectorAll('.hl-flat').forEach(function (el) {
      var m = /(\d+)\s+(\w+)/.exec(el.textContent);
      if (!m) return;
      rolls.push({
        label: m[2].toLowerCase(), dice: [], sides: 0, mod: 0,
        total: parseInt(m[1], 10), type: m[2].toLowerCase(), flat: true
      });
    });

    return rolls;
  }

  function abilityDCs(ability) {
    return Array.prototype.map.call(ability.querySelectorAll('.hl-dc'), function (el) {
      return el.textContent.replace(/\s+/g, ' ').trim();
    });
  }

  function abilityTitle(ability) {
    var name = ability.querySelector('.sb-ability-name, .sb-mechanic-name');
    if (!name) return 'Roll';
    var clone = name.cloneNode(true);
    var tag = clone.querySelector('.tag');
    if (tag) tag.remove();
    return clone.textContent.replace(/[.\s]+$/, '').trim();
  }

  // ── Roll panel ────────────────────────────────────────────────────────────
  function renderPanel(ability) {
    var rolls = abilityRolls(ability);
    if (!rolls.length) return;

    var dcs = abilityDCs(ability);
    var panel = ability.querySelector('.roll');
    if (!panel) {
      panel = document.createElement('div');
      panel.className = 'roll';
      ability.appendChild(panel);
    }

    var html = '<div class="roll-head">' +
      '<span class="roll-title">' + abilityTitle(ability) + '</span>' +
      '<span class="roll-actions">' +
        '<button type="button" class="roll-btn" data-roll-again aria-label="Ritira">&#10227;</button>' +
        '<button type="button" class="roll-btn" data-roll-close aria-label="Chiudi">&#10005;</button>' +
      '</span></div>';

    if (dcs.length) {
      html += '<div class="roll-dcs">' + dcs.map(function (t) {
        return '<span class="roll-dc">' + t + '</span>';
      }).join('') + '</div>';
    }

    html += '<div class="roll-rows">' + rolls.map(function (r) {
      var cls = 'roll-row' + (r.crit ? ' is-crit' : '') + (r.fumble ? ' is-fumble' : '') +
                (r.flat ? ' is-flat' : '');
      var dice = r.flat
        ? '<span class="roll-fixed">fisso</span>'
        : r.dice.map(function (v) {
            var hot = (v === r.sides) ? ' is-max' : (v === 1 ? ' is-min' : '');
            return '<i class="roll-die' + hot + '">' + v + '</i>';
          }).join('');
      var modTxt = r.mod ? '<span class="roll-mod">' + (r.mod > 0 ? '+' : '−') + Math.abs(r.mod) + '</span>' : '';
      var note = r.crit ? '<span class="roll-note">critico</span>'
               : r.fumble ? '<span class="roll-note">fallimento</span>' : '';
      return '<div class="' + cls + '">' +
          '<span class="roll-k">' + r.label + '</span>' +
          '<span class="roll-dice">' + dice + modTxt + '</span>' +
          '<span class="roll-total">' + r.total + '</span>' + note +
        '</div>';
    }).join('') + '</div>';

    panel.innerHTML = html;
    panel.classList.remove('is-rolling');
    void panel.offsetWidth;           // restart the entry animation
    panel.classList.add('is-rolling');
    ability.classList.add('has-roll');
  }

  function closePanel(ability) {
    if (!ability) return;
    var panel = ability.querySelector('.roll');
    if (panel) panel.remove();
    ability.classList.remove('has-roll');
  }

  // ── Quick-DC strip ────────────────────────────────────────────────────────
  function buildDCStrip(scopeRoot, anchor) {
    var seen = {}, chips = [];
    scopeRoot.querySelectorAll('.sb-ability, .sb-mechanic').forEach(function (ability) {
      var title = abilityTitle(ability);
      abilityDCs(ability).forEach(function (text) {
        var num = (text.match(/DC\s*(\d+)/i) || [])[1];
        var save = (text.match(new RegExp('\\b(' + ABIL + ')\\b', 'i')) || [])[1];
        if (!num) return;
        var key = num + '|' + (save || '') + '|' + title;
        if (seen[key]) return;
        seen[key] = true;
        chips.push('<span class="dc-chip"><b>DC ' + num + '</b>' +
          (save ? '<span class="dc-save">' + save.toUpperCase() + '</span>' : '') +
          '<span class="dc-src">' + title + '</span></span>');
      });
    });

    var strip = document.getElementById('dcStrip');
    if (!chips.length) { if (strip) strip.remove(); return; }
    if (!strip) {
      strip = document.createElement('div');
      strip.id = 'dcStrip';
      strip.className = 'dc-strip';
      anchor.parentNode.insertBefore(strip, anchor);
    }
    strip.innerHTML = '<span class="dc-strip-label">Difficolt&agrave;</span>' + chips.join('');
  }

  // ── Wiring ────────────────────────────────────────────────────────────────
  var bound = false;

  function bind(scopeRoot) {
    if (bound) return;
    bound = true;
    scopeRoot.addEventListener('click', function (e) {
      var host = e.target.closest('.sb-ability, .sb-mechanic');
      if (e.target.closest('[data-roll-close]')) { closePanel(host); return; }
      if (e.target.closest('[data-roll-again]')) { renderPanel(host); return; }
      if (e.target.closest('.roll')) return;      // clicks inside the result are inert
      if (!host || !host.classList.contains('is-rollable')) return;
      renderPanel(host);
    });
  }

  function enhance() {
    var scopeRoot = document.getElementById('sbInner');
    if (!scopeRoot) return;

    scopeRoot.querySelectorAll(SCOPE).forEach(highlight);

    scopeRoot.querySelectorAll('.sb-ability, .sb-mechanic').forEach(function (ability) {
      var rollable = ability.querySelector('.hl-dice, .hl-hit');
      ability.classList.toggle('is-rollable', !!rollable);
      if (rollable) {
        ability.setAttribute('role', 'button');
        ability.setAttribute('tabindex', '0');
        ability.setAttribute('aria-label', 'Tira i dadi di ' + abilityTitle(ability));
      } else {
        ability.removeAttribute('role');
        ability.removeAttribute('tabindex');
        ability.removeAttribute('aria-label');
      }
    });

    var plate = document.querySelector('.plate');
    if (plate) buildDCStrip(scopeRoot, plate);

    bind(scopeRoot);
  }

  // Keyboard parity for the tap-to-roll affordance.
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var ability = e.target.closest && e.target.closest('.sb-ability.is-rollable, .sb-mechanic.is-rollable');
    if (!ability) return;
    e.preventDefault();
    renderPanel(ability);
  });

  global.Codex = { enhance: enhance };
})(window);
