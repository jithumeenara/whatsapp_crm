/*
 * Website chat — install script.
 *
 *   <script src="https://YOUR-CRM/webchat/widget.js" data-widget="wk_…" defer></script>
 *
 * Draws the chat button and, on the first click, opens the chat window in
 * an iframe served by the CRM. Everything the conversation needs — the
 * visitor's session, the messages — lives inside that frame, on the CRM's
 * origin, where this page's other scripts cannot read it. This file only
 * positions a button and a box.
 *
 * The button lives in a closed shadow root, so the site's CSS cannot
 * restyle it and its CSS cannot leak into the site.
 */
(function () {
  'use strict';
  if (window.__crmWebChat) return;
  window.__crmWebChat = true;

  var script = document.currentScript;
  if (!script) {
    var candidates = document.querySelectorAll('script[data-widget],script[data-tenant]');
    script = candidates[candidates.length - 1];
  }
  if (!script) return;

  var key = script.getAttribute('data-widget') || script.getAttribute('data-tenant') || '';
  if (!/^wk_[A-Za-z0-9]{24}$/.test(key)) {
    console.warn('[chat] The install snippet is missing its data-widget key. Copy it again from Settings → Channels → Website Bot.');
    return;
  }

  var base;
  try {
    base = new URL(script.src, location.href).origin;
  } catch (e) {
    return;
  }

  function start() {
    fetch(base + '/api/webchat/config/' + key, { credentials: 'omit', mode: 'cors' })
      .then(function (res) {
        if (res.status === 403) console.warn('[chat] This website is not in the chat’s allowed list (Settings → Channels → Website Bot).');
        return res.ok ? res.json() : null;
      })
      .then(function (cfg) {
        if (cfg) mount(cfg);
      })
      .catch(function () {
        /* No chat button is better than a broken one. */
      });
  }

  function safeColor(value) {
    return /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#4f46e5';
  }

  var ANIMATIONS = ['none', 'pulse', 'bounce', 'wiggle', 'float', 'glow'];

  function mount(cfg) {
    var color = safeColor(cfg.primary_color);
    var side = cfg.position === 'left' ? 'left' : 'right';
    // Solid, or a gradient to a second colour (a darker shade when none).
    var second = /^#[0-9a-fA-F]{6}$/.test(cfg.secondary_color) ? cfg.secondary_color : 'color-mix(in srgb,' + color + ' 72%,#000)';
    var fill = cfg.color_style === 'solid' ? color : 'linear-gradient(135deg,' + color + ',' + second + ')';
    var animation = ANIMATIONS.indexOf(cfg.launcher_animation) >= 0 ? cfg.launcher_animation : 'none';
    var calm = false;
    // WhatsApp / Call / bot. Numbers are re-checked here: digits only.
    function numbersOf(list) {
      var out = [];
      if (!list || !list.length) return out;
      for (var n = 0; n < list.length && out.length < 5; n++) {
        var item = list[n] || {};
        if (/^\d{7,15}$/.test(item.phone)) out.push({ label: String(item.label || '').slice(0, 40), phone: item.phone });
      }
      return out;
    }
    var menuCfg = cfg.contact_menu || null;
    var waNumbers = numbersOf(menuCfg && menuCfg.whatsapp);
    var callNumbers = numbersOf(menuCfg && menuCfg.call);
    var hasMenu = waNumbers.length > 0 || callNumbers.length > 0;
    var prefill = menuCfg && typeof menuCfg.prefill === 'string' ? menuCfg.prefill.slice(0, 300) : '';
    try { calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { /* fine */ }

    var host = document.createElement('div');
    host.setAttribute('data-crm-webchat', '');
    host.style.cssText = 'all:initial;position:fixed;z-index:2147483000;bottom:0;' + side + ':0;';
    var root = host.attachShadow ? host.attachShadow({ mode: 'closed' }) : host;

    var style = document.createElement('style');
    style.textContent =
      ':host,*{box-sizing:border-box}' +
      '.launcher{position:fixed;bottom:20px;' + side + ':20px;width:60px;height:60px;border-radius:50%;border:0;cursor:pointer;' +
      'background:' + fill + ';color:#fff;overflow:hidden;' +
      'box-shadow:0 10px 30px -6px color-mix(in srgb,' + color + ' 60%,transparent),0 4px 10px rgba(15,23,42,.18);' +
      'display:flex;align-items:center;justify-content:center;transition:transform .25s cubic-bezier(.34,1.56,.64,1),box-shadow .2s}' +
      '.launcher:hover{transform:translateY(-2px) scale(1.08)}' +
      '.launcher:active{transform:scale(.92)}' +
      // The attention animations use translate/rotate/scale, which compose
      // with the hover transform instead of fighting it. They stop for good
      // once the chat has been opened, and never run for reduced motion.
      '.ring{position:fixed;bottom:20px;' + side + ':20px;width:60px;height:60px;border-radius:50%;background:' + color + ';' +
      'pointer-events:none;opacity:0}' +
      '@media (prefers-reduced-motion:no-preference){' +
      '.a-pulse .ring{animation:wc-ring 2.6s cubic-bezier(.2,.6,.3,1) infinite}' +
      '.a-pulse .ring.r2{animation-delay:1.3s}' +
      '.a-bounce .launcher{animation:wc-bounce 3.4s cubic-bezier(.3,.7,.4,1) infinite}' +
      '.a-wiggle .launcher{animation:wc-wiggle 4.2s ease-in-out infinite}' +
      '.a-float .launcher{animation:wc-float 3.2s ease-in-out infinite}' +
      '.a-glow .launcher{animation:wc-glow 2.8s ease-in-out infinite}' +
      '.a-glow .launcher::after{content:"";position:absolute;inset:0;border-radius:50%;pointer-events:none;' +
      'background:linear-gradient(115deg,transparent 35%,rgba(255,255,255,.55) 50%,transparent 65%);background-size:260% 100%;' +
      'animation:wc-shine 2.8s ease-in-out infinite}' +
      '}' +
      '@keyframes wc-ring{0%{transform:scale(1);opacity:.5}100%{transform:scale(1.85);opacity:0}}' +
      '@keyframes wc-bounce{0%,55%,100%{translate:0 0;scale:1 1}12%{translate:0 -16px;scale:.96 1.05}24%{translate:0 0;scale:1.08 .9}' +
      '32%{translate:0 -7px;scale:.98 1.02}42%{translate:0 0;scale:1.03 .97}}' +
      '@keyframes wc-wiggle{0%,68%,100%{rotate:0deg}72%{rotate:-16deg}76%{rotate:14deg}80%{rotate:-10deg}84%{rotate:7deg}88%{rotate:-3deg}92%{rotate:0deg}}' +
      '@keyframes wc-float{0%,100%{translate:0 0}50%{translate:0 -8px}}' +
      '@keyframes wc-glow{0%,100%{box-shadow:0 10px 30px -6px color-mix(in srgb,' + color + ' 60%,transparent),0 0 0 0 color-mix(in srgb,' + color + ' 45%,transparent)}' +
      '50%{box-shadow:0 10px 30px -6px color-mix(in srgb,' + color + ' 60%,transparent),0 0 26px 8px color-mix(in srgb,' + color + ' 45%,transparent)}}' +
      '@keyframes wc-shine{0%{background-position:130% 0}55%,100%{background-position:-130% 0}}' +
      '.launcher svg{transition:transform .25s cubic-bezier(.2,.8,.2,1)}' +
      '.open .launcher svg{transform:rotate(90deg)}' +
      '.launcher:focus-visible{outline:3px solid #fff;outline-offset:2px;box-shadow:0 0 0 6px ' + color + '}' +
      '.launcher svg{width:27px;height:27px}' +
      '.badge{position:fixed;bottom:62px;' + side + ':18px;min-width:20px;height:20px;padding:0 6px;border-radius:10px;' +
      'background:#ef4444;color:#fff;font:600 12px/20px system-ui,-apple-system,sans-serif;text-align:center}' +
      '.panel{position:fixed;bottom:94px;' + side + ':20px;width:384px;height:min(640px,calc(100vh - 116px));' +
      'border-radius:20px;overflow:hidden;background:#fff;box-shadow:0 24px 60px -12px rgba(15,23,42,.35),0 0 0 1px rgba(15,23,42,.06);' +
      'transform-origin:bottom ' + side + ';animation:wc-pop .38s cubic-bezier(.34,1.56,.64,1)}' +
      '@keyframes wc-pop{from{opacity:0;transform:translateY(14px) scale(.9)}to{opacity:1;transform:none}}' +
      '@keyframes wc-teaser{0%{opacity:0;transform:translateY(10px) scale(.85)}60%{opacity:1;transform:translateY(-3px) scale(1.03)}100%{transform:none}}' +
      '.teaser{position:fixed;bottom:92px;' + side + ':20px;max-width:260px;padding:12px 34px 12px 14px;border-radius:16px;' +
      'border-bottom-' + side + '-radius:4px;background:#fff;color:#0f172a;cursor:pointer;' +
      'font:14px/1.45 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans","Noto Sans Malayalam",sans-serif;' +
      'box-shadow:0 12px 32px -8px rgba(15,23,42,.3),0 0 0 1px rgba(15,23,42,.06);transform-origin:bottom ' + side + ';animation:wc-teaser .55s cubic-bezier(.2,.8,.2,1)}' +
      '.teaser .x{position:absolute;top:6px;right:6px;width:22px;height:22px;border:0;border-radius:50%;background:#f1f5f9;color:#475569;' +
      'cursor:pointer;font:600 13px/22px system-ui;text-align:center;padding:0}' +
      '.teaser .x:hover{background:#e2e8f0}' +
      '@media (prefers-reduced-motion:reduce){.panel,.teaser,.launcher,.ring{animation:none!important}.launcher,.launcher svg{transition:none}}' +
      '.panel iframe{width:100%;height:100%;border:0;display:block}' +
      '.menu{position:fixed;bottom:94px;' + side + ':20px;width:300px;max-height:calc(100vh - 116px);overflow:auto;border-radius:20px;' +
      'background:#fff;color:#0f172a;box-shadow:0 24px 60px -12px rgba(15,23,42,.35),0 0 0 1px rgba(15,23,42,.06);' +
      'font:14px/1.4 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans","Noto Sans Malayalam",sans-serif;' +
      'transform-origin:bottom ' + side + ';animation:wc-pop .38s cubic-bezier(.34,1.56,.64,1)}' +
      '.menu .top{padding:16px 16px 12px;background:' + fill + ';color:#fff;display:flex;align-items:center;gap:8px}' +
      '.menu .top b{font-size:15px;font-weight:650;flex:1}' +
      '.menu .top small{display:block;font-size:12px;opacity:.85;font-weight:400;margin-top:2px}' +
      '.menu .back{border:0;background:rgba(255,255,255,.2);color:#fff;width:28px;height:28px;border-radius:50%;cursor:pointer;' +
      'display:flex;align-items:center;justify-content:center;padding:0}' +
      '.menu .back:hover{background:rgba(255,255,255,.32)}' +
      '.menu .list{padding:10px;display:flex;flex-direction:column;gap:8px}' +
      '.menu .opt{display:flex;align-items:center;gap:12px;width:100%;padding:11px 12px;border:1px solid #e2e8f0;border-radius:14px;' +
      'background:#fff;color:#0f172a;text-decoration:none;cursor:pointer;text-align:left;font:inherit;' +
      'transition:transform .18s cubic-bezier(.34,1.56,.64,1),border-color .15s,box-shadow .15s}' +
      '.menu .opt:hover{transform:translateY(-1px);border-color:#cbd5e1;box-shadow:0 6px 18px -8px rgba(15,23,42,.25)}' +
      '.menu .opt:focus-visible{outline:2px solid ' + color + ';outline-offset:2px}' +
      '.menu .ic{width:40px;height:40px;flex:none;border-radius:12px;display:flex;align-items:center;justify-content:center;color:#fff}' +
      '.menu .ic svg{width:21px;height:21px}' +
      '.menu .ic.wa{background:#25d366}.menu .ic.call{background:#2563eb}.menu .ic.bot{background:' + fill + '}' +
      '.menu .txt{flex:1;min-width:0}.menu .txt b{display:block;font-weight:600}' +
      '.menu .txt span{display:block;color:#64748b;font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.menu .go{flex:none;color:#94a3b8;width:18px;height:18px}' +
      '.menu .pill{flex:none;padding:7px 14px;border-radius:999px;color:#fff;font-weight:600;font-size:13px;display:inline-flex;align-items:center;gap:6px}' +
      '.menu .pill svg{width:15px;height:15px}' +
      '.menu .pill.wa{background:#25d366}.menu .pill.call{background:#2563eb}' +
      '.open-menu .launcher svg{transform:none}' +
      '@media (max-width:480px){.menu{width:calc(100vw - 40px)}}' +
      '[hidden]{display:none!important}' +
      '@media (max-width:480px){.panel{inset:0;width:100%;height:100%;border-radius:0;bottom:0}' +
      '.open .launcher,.open .badge,.open .ring{display:none}.teaser{max-width:calc(100vw - 110px)}}';

    var wrap = document.createElement('div');
    var attention = animation !== 'none' ? 'a-' + animation : '';
    wrap.className = attention;
    var rings = [];
    if (animation === 'pulse') {
      for (var i = 0; i < 2; i++) {
        var ring = document.createElement('span');
        ring.className = i ? 'ring r2' : 'ring';
        ring.setAttribute('aria-hidden', 'true');
        rings.push(ring);
      }
    }
    var launcher = document.createElement('button');
    launcher.className = 'launcher';
    launcher.type = 'button';
    launcher.setAttribute('aria-label', 'Open chat');
    launcher.setAttribute('aria-expanded', 'false');
    // A bot in a chat bubble — it is the Website Bot.
    var chatIcon =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M12 6V2H8"/><path d="m8 18-4 4V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2Z"/>' +
      '<path d="M2 12h2"/><path d="M9 11v2"/><path d="M15 11v2"/><path d="M20 12h2"/></svg>';
    var closeIcon =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">' +
      '<path d="M18 6 6 18M6 6l12 12"/></svg>';
    launcher.innerHTML = chatIcon;

    var badge = document.createElement('span');
    badge.className = 'badge';
    badge.hidden = true;
    badge.setAttribute('aria-hidden', 'true');

    var panel = document.createElement('div');
    panel.className = 'panel';
    panel.hidden = true;

    // The welcome line, once per visit, a few seconds in — the nudge every
    // modern chat uses. Text only; dismissible; gone once the chat opens.
    var teaser = document.createElement('div');
    teaser.className = 'teaser';
    teaser.hidden = true;
    teaser.setAttribute('role', 'status');
    var teaserText = document.createElement('span');
    var welcome = String(cfg.welcome_message || '').trim();
    teaserText.textContent = welcome.length > 140 ? welcome.slice(0, 137) + '…' : welcome;
    var teaserClose = document.createElement('button');
    teaserClose.className = 'x';
    teaserClose.type = 'button';
    teaserClose.setAttribute('aria-label', 'Dismiss');
    teaserClose.textContent = '×';
    teaser.appendChild(teaserText);
    teaser.appendChild(teaserClose);
    var TEASER_KEY = 'wc:teaser:' + key;
    function teaserSeen() {
      try { return window.sessionStorage.getItem(TEASER_KEY) === '1'; } catch (e) { return false; }
    }
    function hideTeaser() {
      teaser.hidden = true;
      try { window.sessionStorage.setItem(TEASER_KEY, '1'); } catch (e) { /* fine */ }
    }
    teaserClose.addEventListener('click', function (event) {
      event.stopPropagation();
      hideTeaser();
    });
    teaser.addEventListener('click', function () {
      hideTeaser();
      if (hasMenu) openMenu();
      else setOpen(true);
    });
    if (welcome && !teaserSeen()) {
      window.setTimeout(function () {
        if (!open && !teaserSeen()) teaser.hidden = false;
      }, 4000);
    }

    var frame = null;
    var open = false;

    // ── The contact menu: WhatsApp, Call, or the bot ──────────────────
    var ICON = {
      wa: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.9 9.9 0 0 0 4.74 1.21c5.46 0 9.91-4.45 9.91-9.91S17.5 2 12.04 2zm5.79 14.01c-.24.68-1.41 1.3-1.95 1.38-.5.07-1.13.1-1.82-.11-.42-.13-.96-.31-1.65-.61-2.9-1.25-4.79-4.17-4.94-4.36-.14-.19-1.18-1.57-1.18-3s.75-2.13 1.02-2.42c.27-.29.58-.36.78-.36h.56c.18 0 .42-.07.65.5.24.58.82 2 .89 2.15.07.14.12.31.02.5-.1.19-.14.31-.29.48l-.43.51c-.14.14-.29.3-.13.58.17.29.74 1.22 1.59 1.97 1.09.97 2.01 1.27 2.3 1.42.29.14.46.12.63-.07.17-.19.72-.84.91-1.13.19-.29.38-.24.65-.14.27.1 1.7.8 1.99.95.29.14.48.22.55.34.07.12.07.7-.17 1.38z"/></svg>',
      call: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg>',
      go: '<svg class="go" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>',
      back: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>'
    };
    var menu = document.createElement('div');
    menu.className = 'menu';
    menu.hidden = true;
    menu.setAttribute('role', 'dialog');
    menu.setAttribute('aria-label', 'Contact options');
    var menuOpen = false;

    function el(tag, cls, text) {
      var node = document.createElement(tag);
      if (cls) node.className = cls;
      if (text) node.textContent = text;
      return node;
    }
    function shown(phone) { return '+' + phone; }
    function waHref(phone) {
      return 'https://wa.me/' + phone + (prefill ? '?text=' + encodeURIComponent(prefill) : '');
    }
    // One row: an icon, two lines of text, and a chevron or a pill.
    function option(kind, title, sub, tail) {
      var row = el(tail && tail.href ? 'a' : 'button', 'opt');
      if (tail && tail.href) {
        row.href = tail.href;
        if (tail.external) { row.target = '_blank'; row.rel = 'noopener noreferrer'; }
      } else {
        row.type = 'button';
      }
      var ic = el('span', 'ic ' + kind);
      ic.innerHTML = kind === 'bot' ? chatIcon : ICON[kind];
      var txt = el('span', 'txt');
      txt.appendChild(el('b', '', title));
      if (sub) txt.appendChild(el('span', '', sub));
      row.appendChild(ic);
      row.appendChild(txt);
      if (tail && tail.pill) {
        var pill = el('span', 'pill ' + kind);
        pill.innerHTML = ICON[kind];
        pill.appendChild(document.createTextNode(tail.pill));
        row.appendChild(pill);
      } else {
        row.insertAdjacentHTML('beforeend', ICON.go);
      }
      return row;
    }

    function renderMenu(view) {
      menu.textContent = '';
      var top = el('div', 'top');
      var heading = el('b');
      if (view !== 'main') {
        var back = el('button', 'back');
        back.type = 'button';
        back.setAttribute('aria-label', 'Back');
        back.innerHTML = ICON.back;
        back.addEventListener('click', function () { renderMenu('main'); });
        top.appendChild(back);
      }
      heading.textContent = view === 'whatsapp' ? 'Chat on WhatsApp' : view === 'call' ? 'Call us' : 'How can we help?';
      heading.appendChild(el('small', '', view === 'main' ? 'Choose how you would like to reach us' : 'Tap a number'));
      top.appendChild(heading);
      menu.appendChild(top);

      var list = el('div', 'list');
      var rows = [];
      if (view === 'main') {
        if (waNumbers.length === 1) {
          rows.push(option('wa', 'WhatsApp', shown(waNumbers[0].phone), { href: waHref(waNumbers[0].phone), external: true }));
        } else if (waNumbers.length > 1) {
          var waRow = option('wa', 'WhatsApp', 'Chat with us on WhatsApp');
          waRow.addEventListener('click', function () { renderMenu('whatsapp'); });
          rows.push(waRow);
        }
        if (callNumbers.length) {
          var callRow = option('call', 'Direct call', callNumbers.length === 1 ? shown(callNumbers[0].phone) : 'Talk to our team');
          callRow.addEventListener('click', function () { renderMenu('call'); });
          rows.push(callRow);
        }
        var botRow = option('bot', cfg.title || 'Chat with us', 'Instant answers, any time');
        botRow.addEventListener('click', function () { closeMenu(true); setOpen(true); });
        rows.push(botRow);
      } else if (view === 'whatsapp') {
        for (var w = 0; w < waNumbers.length; w++) {
          rows.push(option('wa', waNumbers[w].label || 'WhatsApp', shown(waNumbers[w].phone), { href: waHref(waNumbers[w].phone), external: true, pill: 'Chat' }));
        }
      } else {
        // Straight to the phone's dial pad.
        for (var c = 0; c < callNumbers.length; c++) {
          rows.push(option('call', callNumbers[c].label || 'Call us', shown(callNumbers[c].phone), { href: 'tel:+' + callNumbers[c].phone, pill: 'Call' }));
        }
      }
      for (var i = 0; i < rows.length; i++) {
        rows[i].addEventListener('click', function (event) {
          // A link leaves the page or opens WhatsApp: the menu can close.
          if (event.currentTarget.tagName === 'A') closeMenu(true);
        });
        list.appendChild(rows[i]);
        // Each option springs in a beat after the one above it.
        if (!calm && rows[i].animate) {
          rows[i].animate(
            [{ opacity: 0, transform: 'translateY(14px) scale(.96)' }, { opacity: 1, transform: 'none' }],
            { duration: 420, delay: 60 + i * 70, easing: 'cubic-bezier(.34,1.56,.64,1)', fill: 'backwards' }
          );
        }
      }
      menu.appendChild(list);
      var first = list.querySelector('.opt') || menu.querySelector('.back');
      if (first) first.focus({ preventScroll: true });
    }

    function setLauncher(expanded, label) {
      launcher.innerHTML = expanded ? closeIcon : chatIcon;
      if (!calm && launcher.firstChild && launcher.firstChild.animate) {
        launcher.firstChild.animate(
          [{ transform: 'rotate(' + (expanded ? '-90deg' : '90deg') + ') scale(.4)', opacity: 0 }, { transform: 'none', opacity: 1 }],
          { duration: 320, easing: 'cubic-bezier(.34,1.56,.64,1)' }
        );
      }
      launcher.setAttribute('aria-label', label);
      launcher.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    }

    function openMenu() {
      menuOpen = true;
      attention = '';
      hideTeaser();
      wrap.className = 'open-menu';
      renderMenu('main');
      menu.hidden = false;
      setLauncher(true, 'Close contact options');
    }
    function closeMenu(quiet) {
      if (!menuOpen) return;
      menuOpen = false;
      menu.hidden = true;
      wrap.className = attention;
      setLauncher(false, 'Open chat');
      if (!quiet) launcher.focus();
    }
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && menuOpen) closeMenu(false);
    });
    // A click anywhere else on the page closes it. Clicks inside arrive
    // retargeted to the host element (closed shadow root).
    document.addEventListener('click', function (event) {
      if (menuOpen && event.target !== host) closeMenu(true);
    });

    function frameWindow() {
      return frame && frame.contentWindow;
    }

    function setOpen(next) {
      open = next;
      panel.hidden = !open;
      // The attention animation has done its job once the chat is opened.
      if (open) attention = '';
      if (open && menuOpen) { menuOpen = false; menu.hidden = true; }
      wrap.className = (open ? 'open ' : '') + attention;
      // The icon spins in as it changes.
      setLauncher(open, open ? 'Close chat' : 'Open chat');
      if (open) {
        badge.hidden = true;
        hideTeaser();
        if (!frame) {
          frame = document.createElement('iframe');
          frame.title = cfg.title || 'Chat';
          frame.setAttribute('allow', 'clipboard-write');
          // The page the visitor was on, for the team — in the fragment, so
          // it never travels in a request.
          frame.src = base + '/api/webchat/frame/' + key + '#page=' + encodeURIComponent(location.href.slice(0, 500));
          panel.appendChild(frame);
        } else if (frameWindow()) {
          frameWindow().postMessage({ type: 'wc:open' }, base);
        }
      } else {
        launcher.focus();
        if (frameWindow()) frameWindow().postMessage({ type: 'wc:closed' }, base);
      }
    }

    launcher.addEventListener('click', function () {
      if (open) setOpen(false);
      else if (menuOpen) closeMenu(false);
      else if (hasMenu) openMenu();
      else setOpen(true);
    });

    // Messages from the chat frame. Only from that frame, at the CRM's
    // origin — anything else on the page could post a lookalike.
    window.addEventListener('message', function (event) {
      if (event.origin !== base || !frame || event.source !== frame.contentWindow) return;
      var data = event.data || {};
      if (data.type === 'wc:close') setOpen(false);
      else if (data.type === 'wc:unread' && !open) {
        var count = Math.max(0, Math.min(99, Number(data.count) || 0));
        badge.textContent = String(count);
        badge.hidden = count === 0;
      }
    });

    wrap.appendChild(panel);
    wrap.appendChild(menu);
    wrap.appendChild(teaser);
    for (var r = 0; r < rings.length; r++) wrap.appendChild(rings[r]);
    wrap.appendChild(badge);
    wrap.appendChild(launcher);
    root.appendChild(style);
    root.appendChild(wrap);
    document.body.appendChild(host);

    // The button arrives with a spring: grows in, overshoots, settles.
    if (!calm && launcher.animate) {
      launcher.animate(
        [
          { transform: 'scale(0) rotate(-120deg)', opacity: 0 },
          { transform: 'scale(1.18) rotate(10deg)', opacity: 1, offset: 0.55 },
          { transform: 'scale(.94) rotate(-4deg)', offset: 0.78 },
          { transform: 'scale(1) rotate(0deg)' }
        ],
        { duration: 750, easing: 'ease-out', delay: 250, fill: 'backwards' }
      );
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
