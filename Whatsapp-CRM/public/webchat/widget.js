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

  function mount(cfg) {
    var color = safeColor(cfg.primary_color);
    var side = cfg.position === 'left' ? 'left' : 'right';

    var host = document.createElement('div');
    host.setAttribute('data-crm-webchat', '');
    host.style.cssText = 'all:initial;position:fixed;z-index:2147483000;bottom:0;' + side + ':0;';
    var root = host.attachShadow ? host.attachShadow({ mode: 'closed' }) : host;

    var style = document.createElement('style');
    style.textContent =
      ':host,*{box-sizing:border-box}' +
      '.launcher{position:fixed;bottom:20px;' + side + ':20px;width:60px;height:60px;border-radius:50%;border:0;cursor:pointer;' +
      'background:linear-gradient(135deg,' + color + ',color-mix(in srgb,' + color + ' 72%,#000));color:#fff;' +
      'box-shadow:0 10px 30px -6px color-mix(in srgb,' + color + ' 60%,transparent),0 4px 10px rgba(15,23,42,.18);' +
      'display:flex;align-items:center;justify-content:center;transition:transform .2s cubic-bezier(.2,.8,.2,1),box-shadow .2s}' +
      '.launcher:hover{transform:translateY(-2px) scale(1.04)}' +
      '.launcher svg{transition:transform .25s cubic-bezier(.2,.8,.2,1)}' +
      '.open .launcher svg{transform:rotate(90deg)}' +
      '.launcher:focus-visible{outline:3px solid #fff;outline-offset:2px;box-shadow:0 0 0 6px ' + color + '}' +
      '.launcher svg{width:27px;height:27px}' +
      '.badge{position:fixed;bottom:62px;' + side + ':18px;min-width:20px;height:20px;padding:0 6px;border-radius:10px;' +
      'background:#ef4444;color:#fff;font:600 12px/20px system-ui,-apple-system,sans-serif;text-align:center}' +
      '.panel{position:fixed;bottom:94px;' + side + ':20px;width:384px;height:min(640px,calc(100vh - 116px));' +
      'border-radius:20px;overflow:hidden;background:#fff;box-shadow:0 24px 60px -12px rgba(15,23,42,.35),0 0 0 1px rgba(15,23,42,.06);' +
      'transform-origin:bottom ' + side + ';animation:wc-pop .22s cubic-bezier(.2,.8,.2,1)}' +
      '@keyframes wc-pop{from{opacity:0;transform:translateY(8px) scale(.97)}to{opacity:1;transform:none}}' +
      '.teaser{position:fixed;bottom:92px;' + side + ':20px;max-width:260px;padding:12px 34px 12px 14px;border-radius:16px;' +
      'border-bottom-' + side + '-radius:4px;background:#fff;color:#0f172a;cursor:pointer;' +
      'font:14px/1.45 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans","Noto Sans Malayalam",sans-serif;' +
      'box-shadow:0 12px 32px -8px rgba(15,23,42,.3),0 0 0 1px rgba(15,23,42,.06);animation:wc-pop .25s cubic-bezier(.2,.8,.2,1)}' +
      '.teaser .x{position:absolute;top:6px;right:6px;width:22px;height:22px;border:0;border-radius:50%;background:#f1f5f9;color:#475569;' +
      'cursor:pointer;font:600 13px/22px system-ui;text-align:center;padding:0}' +
      '.teaser .x:hover{background:#e2e8f0}' +
      '@media (prefers-reduced-motion:reduce){.panel,.teaser{animation:none}.launcher,.launcher svg{transition:none}}' +
      '.panel iframe{width:100%;height:100%;border:0;display:block}' +
      '[hidden]{display:none!important}' +
      '@media (max-width:480px){.panel{inset:0;width:100%;height:100%;border-radius:0;bottom:0}' +
      '.open .launcher,.open .badge{display:none}.teaser{max-width:calc(100vw - 110px)}}';

    var wrap = document.createElement('div');
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
      setOpen(true);
    });
    if (welcome && !teaserSeen()) {
      window.setTimeout(function () {
        if (!open && !teaserSeen()) teaser.hidden = false;
      }, 4000);
    }

    var frame = null;
    var open = false;

    function frameWindow() {
      return frame && frame.contentWindow;
    }

    function setOpen(next) {
      open = next;
      panel.hidden = !open;
      wrap.className = open ? 'open' : '';
      launcher.innerHTML = open ? closeIcon : chatIcon;
      launcher.setAttribute('aria-label', open ? 'Close chat' : 'Open chat');
      launcher.setAttribute('aria-expanded', open ? 'true' : 'false');
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
      setOpen(!open);
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
    wrap.appendChild(teaser);
    wrap.appendChild(badge);
    wrap.appendChild(launcher);
    root.appendChild(style);
    root.appendChild(wrap);
    document.body.appendChild(host);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
