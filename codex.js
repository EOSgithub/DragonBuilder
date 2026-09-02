/* ============================================================================
   THE WYRMLING CODEX — shared interaction layer
   Loaded by the three *_Statblock.html pages. Adds, without touching any
   game logic or save keys:
     1. Semantic highlighting — DC (gold), dice/damage (ember), conditions (violet)
     2. Tap an ability to roll every die it contains
     3. Tap a condition keyword for its rules, in a thumb-reachable sheet
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

  /* ── Condition reference ───────────────────────────────────────────────────
     Standard entries restate the rules from SRD 5.1, released by Wizards of
     the Coast under CC BY 4.0 — the same mechanics D&D Beyond prints, from a
     source we may ship. Embedding them rather than fetching keeps the sheet
     instant and usable with no signal at the table.

     Campaign entries are ours, taken from how the stat blocks already use the
     term. A term that also has a live [Mechanic] block on the page is read
     from that block instead (see liveMechanic), so rules that scale with the
     skill tree are never shown stale. */
  var GLOSSARY = {
    blinded: { name: 'Blinded', src: 'srd', effects: [
      'Can’t see, and automatically fails any ability check that requires sight.',
      'Attack rolls against the creature have advantage; its own attack rolls have disadvantage.'
    ] },
    charmed: { name: 'Charmed', src: 'srd', effects: [
      'Can’t attack the charmer or target them with harmful abilities or magical effects.',
      'The charmer has advantage on any ability check to interact socially with the creature.'
    ] },
    deafened: { name: 'Deafened', src: 'srd', effects: [
      'Can’t hear, and automatically fails any ability check that requires hearing.'
    ] },
    exhaustion: { name: 'Exhaustion', src: 'campaign', effects: [
      'Each level subtracts 1 from every d20 roll — attack rolls, saving throws and ability checks alike.',
      'The penalty equals the creature’s exhaustion level: 3 levels means −3.',
      'A long rest removes one level, provided the creature has also eaten and drunk.'
    ], note: 'House rule: this replaces the standard exhaustion table outright. There are no per-level speed, hit point maximum or death effects.' },
    frightened: { name: 'Frightened', src: 'srd', effects: [
      'Disadvantage on ability checks and attack rolls while the source of its fear is within line of sight.',
      'Can’t willingly move closer to the source of its fear.'
    ] },
    grappled: { name: 'Grappled', src: 'srd', effects: [
      'Speed becomes 0, and it can’t benefit from any bonus to its speed.',
      'Ends if the grappler is incapacitated.',
      'Ends if an effect removes the grappled creature from the reach of the grappler.'
    ] },
    incapacitated: { name: 'Incapacitated', src: 'srd', effects: [
      'Can’t take actions or reactions.'
    ] },
    invisible: { name: 'Invisible', src: 'srd', effects: [
      'Impossible to see without magic or a special sense. For hiding, the creature counts as heavily obscured.',
      'Its location can still be given away by noise or by tracks it leaves.',
      'Attack rolls against the creature have disadvantage; its own attack rolls have advantage.'
    ] },
    paralyzed: { name: 'Paralyzed', src: 'srd', effects: [
      'Incapacitated, and can’t move or speak.',
      'Automatically fails STR and DEX saving throws.',
      'Attack rolls against the creature have advantage.',
      'Any attack that hits is a critical hit if the attacker is within 5 feet.'
    ] },
    petrified: { name: 'Petrified', src: 'srd', effects: [
      'Transformed, with everything it carries, into solid inanimate substance — usually stone. Its weight increases tenfold and it stops aging.',
      'Incapacitated, can’t move or speak, and is unaware of its surroundings.',
      'Automatically fails STR and DEX saving throws.',
      'Attack rolls against the creature have advantage.',
      'Has resistance to all damage.',
      'Immune to poison and disease, though any already in its system is only suspended.'
    ] },
    poisoned: { name: 'Poisoned', src: 'srd', effects: [
      'Disadvantage on attack rolls and ability checks.'
    ] },
    prone: { name: 'Prone', src: 'srd', effects: [
      'Its only movement option is to crawl, unless it stands up and ends the condition.',
      'Disadvantage on its own attack rolls.',
      'Attack rolls against the creature have advantage if the attacker is within 5 feet, and disadvantage otherwise.'
    ] },
    restrained: { name: 'Restrained', src: 'srd', effects: [
      'Speed becomes 0, and it can’t benefit from any bonus to its speed.',
      'Attack rolls against the creature have advantage; its own attack rolls have disadvantage.',
      'Disadvantage on DEX saving throws.'
    ] },
    stunned: { name: 'Stunned', src: 'srd', effects: [
      'Incapacitated, can’t move, and can speak only falteringly.',
      'Automatically fails STR and DEX saving throws.',
      'Attack rolls against the creature have advantage.'
    ] },
    unconscious: { name: 'Unconscious', src: 'srd', effects: [
      'Incapacitated, can’t move or speak, and is unaware of its surroundings.',
      'Drops whatever it is holding and falls prone.',
      'Automatically fails STR and DEX saving throws.',
      'Attack rolls against the creature have advantage.',
      'Any attack that hits is a critical hit if the attacker is within 5 feet.'
    ] },

    'difficult terrain': { name: 'Difficult Terrain', src: 'srd', effects: [
      'Every foot of movement costs 1 extra foot.',
      'The cost is not doubled again when several things in the same space each count as difficult terrain.'
    ] },
    'heavily obscured': { name: 'Heavily Obscured', src: 'srd', effects: [
      'Vision is blocked entirely — darkness, opaque fog, dense foliage.',
      'A creature effectively suffers the blinded condition when trying to see anything in the area.'
    ] },

    dazed: { name: 'Dazed', src: 'campaign', effects: [
      'On its turn it can either move or take an action — not both.'
    ] },
    slowed: { name: 'Slowed', src: 'campaign', effects: [
      'On its next turn the creature can either move or take actions — not both.'
    ] },
    bleeding: { name: '[Bleeding]', src: 'campaign', effects: [
      'Deals 1d4 damage at the start of each of the creature’s turns.',
      'A stacking mark applied by the dragon’s Rend attack.',
      'The dragon has advantage on attack rolls against any creature that is Bleeding.',
      'Removed when the creature is healed.'
    ] },
    erosion: { name: '[Erosion]', src: 'campaign', effects: [
      'A stacking mark applied by the dragon’s breath and attrition abilities.',
      'Every 2 stacks impose a −1 penalty to AC.'
    ], note: 'The exact limits and removal rules scale with the Attrition path — see the [Erosion] entry on this stat block for the current numbers.' }
  };

  /* Same rule, two spellings in the prose. */
  var COND_ALIAS = { 'heavily obscuring': 'heavily obscured' };

  function condKey(text) {
    var k = String(text).toLowerCase().replace(/[\[\]]/g, '').replace(/\s+/g, ' ').trim();
    return COND_ALIAS[k] || k;
  }

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

  /* On a critical hit the damage DICE are rolled twice; modifiers are not
     doubled (PHB). `crit` doubles the count and nothing else. */
  function rollSpec(spec, crit) {
    var count = spec.count * (crit ? 2 : 1);
    var dice = [];
    for (var i = 0; i < count; i++) dice.push(d(spec.sides));
    var sum = dice.reduce(function (a, b) { return a + b; }, 0);
    return {
      dice: dice, sides: spec.sides, mod: spec.mod, total: sum + spec.mod,
      type: spec.type, crit: !!crit, baseCount: spec.count
    };
  }

  function abilityRolls(ability) {
    var attacks = [], rolls = [];

    ability.querySelectorAll('.hl-hit').forEach(function (el) {
      var mod = parseInt(el.textContent.replace(/−/g, '-').replace(/[^\d+\-]/g, ''), 10) || 0;
      var nat = d(20);
      attacks.push({
        label: 'To Hit', dice: [nat], sides: 20, mod: mod, total: nat + mod,
        type: '', attack: true, crit: nat === 20, fumble: nat === 1
      });
    });

    /* A 20 anywhere in the entry crits its damage; an entry whose only attacks
       all rolled a 1 hits nothing. Entries with no attack roll — breath weapons
       and other save-based effects — can do neither. */
    var crit = attacks.some(function (r) { return r.crit; });
    var miss = attacks.length > 0 && attacks.every(function (r) { return r.fumble; });

    rolls = rolls.concat(attacks);

    ability.querySelectorAll('.hl-dice').forEach(function (el) {
      var spec = parseDice(el.textContent);
      if (!spec) return;
      var r = rollSpec(spec, crit);
      r.label = r.type || 'Damage';
      r.missed = miss;
      rolls.push(r);
    });

    // Fixed damage carries no die, so a crit never doubles it.
    ability.querySelectorAll('.hl-flat').forEach(function (el) {
      var m = /(\d+)\s+(\w+)/.exec(el.textContent);
      if (!m) return;
      rolls.push({
        label: m[2].toLowerCase(), dice: [], sides: 0, mod: 0,
        total: parseInt(m[1], 10), type: m[2].toLowerCase(), flat: true, missed: miss
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

    /* The outcome is the first thing wanted at the table, so it is stated once
       at the top rather than inferred from the rows. */
    var didCrit = rolls.some(function (r) { return r.attack && r.crit; });
    var didMiss = rolls.some(function (r) { return r.missed; });
    var flag = didCrit ? '<span class="roll-flag is-crit">Critico</span>'
             : didMiss ? '<span class="roll-flag is-miss">Mancato</span>' : '';

    var html = '<div class="roll-head">' +
      '<span class="roll-title"><span class="roll-title-txt">' + abilityTitle(ability) + '</span>' + flag + '</span>' +
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
                (r.flat ? ' is-flat' : '') + (r.missed ? ' is-miss' : '');
      var dice = r.flat
        ? '<span class="roll-fixed">fisso</span>'
        : r.dice.map(function (v, i) {
            var hot = (v === r.sides) ? ' is-max' : (v === 1 ? ' is-min' : '');
            // Mark the dice the critical added, so the doubling is visible.
            var extra = (r.crit && !r.attack && i >= r.baseCount) ? ' is-extra' : '';
            return '<i class="roll-die' + hot + extra + '">' + v + '</i>';
          }).join('');
      var modTxt = r.mod ? '<span class="roll-mod">' + (r.mod > 0 ? '+' : '−') + Math.abs(r.mod) + '</span>' : '';
      var note = r.attack && r.crit ? '<span class="roll-note">critico</span>'
               : r.attack && r.fumble ? '<span class="roll-note">fallimento</span>'
               : r.crit ? '<span class="roll-note">dadi &times;2</span>' : '';
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

  // ── Condition sheet ───────────────────────────────────────────────────────
  /* A term the stat block defines for itself wins over the static entry: those
     rules scale with the skill tree, so a copy here would drift out of date. */
  function liveMechanic(key) {
    var root = document.getElementById('sbInner');
    if (!root) return null;
    var hit = null;
    root.querySelectorAll('.sb-mechanic').forEach(function (m) {
      var nameEl = m.querySelector('.sb-mechanic-name');
      if (!nameEl || hit) return;
      if (condKey(nameEl.textContent) !== key) return;
      // Everything the block says except its own title and any open dice panel.
      var frag = document.createElement('div');
      Array.prototype.forEach.call(m.children, function (child) {
        if (child === nameEl || child.classList.contains('roll')) return;
        frag.appendChild(child.cloneNode(true));
      });
      if (frag.childNodes.length) hit = { name: nameEl.textContent.trim(), html: frag.innerHTML };
    });
    return hit;
  }

  function knownCondition(key) { return !!(GLOSSARY[key] || liveMechanic(key)); }

  var sheetOpener = null;   // element to hand focus back to on close

  function buildSheet() {
    if (document.getElementById('condSheet')) return;
    var wrap = document.createElement('div');
    wrap.id = 'condSheet';
    wrap.className = 'cond-wrap';
    wrap.hidden = true;
    wrap.innerHTML =
      '<div class="cond-backdrop" data-cond-close></div>' +
      '<div class="cond-sheet" role="dialog" aria-modal="true" aria-labelledby="condTitle">' +
        '<div class="cond-grip" aria-hidden="true"></div>' +
        '<div class="cond-head">' +
          '<h4 class="cond-title" id="condTitle"></h4>' +
          '<button type="button" class="roll-btn" data-cond-close aria-label="Chiudi">&#10005;</button>' +
        '</div>' +
        '<div class="cond-body" id="condBody"></div>' +
        '<p class="cond-src" id="condSrc"></p>' +
      '</div>';
    document.body.appendChild(wrap);

    wrap.addEventListener('click', function (e) {
      if (e.target.closest('[data-cond-close]')) closeSheet();
    });
    bindSwipe(wrap.querySelector('.cond-sheet'));
  }

  /* Flick the sheet down to dismiss — the gesture a phone user already expects. */
  function bindSwipe(sheet) {
    var startY = 0, delta = 0, dragging = false;
    sheet.addEventListener('touchstart', function (e) {
      // Only from the top of the sheet, so scrolling the rules never dismisses.
      if (sheet.querySelector('.cond-body').scrollTop > 0) return;
      dragging = true; startY = e.touches[0].clientY; delta = 0;
      sheet.style.transition = 'none';
    }, { passive: true });

    sheet.addEventListener('touchmove', function (e) {
      if (!dragging) return;
      delta = Math.max(0, e.touches[0].clientY - startY);
      sheet.style.transform = 'translateY(' + delta + 'px)';
    }, { passive: true });

    sheet.addEventListener('touchend', function () {
      if (!dragging) return;
      dragging = false;
      sheet.style.transition = '';
      sheet.style.transform = '';
      if (delta > 70) closeSheet();
    });
  }

  function openCondition(key, opener) {
    var live = liveMechanic(key);
    var entry = GLOSSARY[key];
    if (!live && !entry) return;

    buildSheet();
    var wrap = document.getElementById('condSheet');
    var title = document.getElementById('condTitle');
    var body = document.getElementById('condBody');
    var src = document.getElementById('condSrc');

    title.textContent = live ? live.name : entry.name;
    body.innerHTML = '';

    if (live) {
      var wrapEl = document.createElement('div');
      wrapEl.innerHTML = live.html;
      // Nested keywords are decoration here; only the stat block itself is tappable.
      wrapEl.querySelectorAll('.hl-cond').forEach(function (el) {
        el.classList.remove('is-known');
        el.removeAttribute('role');
        el.removeAttribute('tabindex');
      });
      body.appendChild(wrapEl);
      src.textContent = 'Regola della campagna · da questo stat block';
    } else {
      var ul = document.createElement('ul');
      ul.className = 'cond-list';
      entry.effects.forEach(function (line) {
        var li = document.createElement('li');
        li.textContent = line;
        ul.appendChild(li);
      });
      body.appendChild(ul);
      if (entry.note) {
        var note = document.createElement('p');
        note.className = 'cond-note';
        note.textContent = entry.note;
        body.appendChild(note);
      }
      src.textContent = entry.src === 'srd'
        ? 'SRD 5.1 · Wizards of the Coast · CC BY 4.0'
        : 'Regola della campagna';
    }

    body.scrollTop = 0;
    sheetOpener = opener || null;
    wrap.hidden = false;
    void wrap.offsetWidth;              // let the entry transition run
    wrap.classList.add('is-open');
    var close = wrap.querySelector('[data-cond-close]');
    if (close) close.focus();
  }

  function closeSheet() {
    var wrap = document.getElementById('condSheet');
    if (!wrap || wrap.hidden) return;
    wrap.classList.remove('is-open');
    var done = function () { wrap.hidden = true; };
    // Match the CSS exit; fall back if transitionend never fires.
    setTimeout(done, 260);
    if (sheetOpener && document.contains(sheetOpener)) sheetOpener.focus();
    sheetOpener = null;
  }

  // ── Wiring ────────────────────────────────────────────────────────────────
  var bound = false;

  function bind(scopeRoot) {
    if (bound) return;
    bound = true;
    scopeRoot.addEventListener('click', function (e) {
      /* A keyword lives inside a rollable entry, so it must claim the tap
         before the dice do — otherwise one touch opens the sheet AND rolls. */
      var cond = e.target.closest('.hl-cond.is-known');
      if (cond) { e.preventDefault(); openCondition(cond.dataset.cond, cond); return; }

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

    scopeRoot.querySelectorAll('.hl-cond').forEach(function (el) {
      var key = condKey(el.textContent);
      var known = knownCondition(key);
      el.classList.toggle('is-known', known);
      if (known) {
        el.dataset.cond = key;
        el.setAttribute('role', 'button');
        el.setAttribute('tabindex', '0');
        el.setAttribute('aria-label', 'Regole di ' + el.textContent.trim());
      } else {
        el.removeAttribute('role');
        el.removeAttribute('tabindex');
        el.removeAttribute('aria-label');
      }
    });

    bind(scopeRoot);
  }

  // Keyboard parity for the two tap affordances, keywords first.
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { closeSheet(); return; }
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if (!e.target.closest) return;

    var cond = e.target.closest('.hl-cond.is-known');
    if (cond) { e.preventDefault(); openCondition(cond.dataset.cond, cond); return; }

    var ability = e.target.closest('.sb-ability.is-rollable, .sb-mechanic.is-rollable');
    if (!ability) return;
    e.preventDefault();
    renderPanel(ability);
  });

  global.Codex = { enhance: enhance };
})(window);
