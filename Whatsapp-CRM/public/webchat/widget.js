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
    console.warn('[chat] The install snippet is missing its data-widget key. Copy it again from Settings → Website chat.');
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
        if (res.status === 403) console.warn('[chat] This website is not in the chat’s allowed list (Settings → Website chat).');
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
      '.launcher{position:fixed;bottom:20px;' + side + ':20px;width:56px;height:56px;border-radius:50%;border:0;cursor:pointer;' +
      'background:' + color + ';color:#fff;box-shadow:0 6px 20px rgba(15,23,42,.25);display:flex;align-items:center;justify-content:center;' +
      'transition:transform .15s ease}' +
      '.launcher:hover{transform:scale(1.05)}' +
      '.launcher:focus-visible{outline:3px solid #fff;outline-offset:2px;box-shadow:0 0 0 6px ' + color + '}' +
      '.launcher svg{width:26px;height:26px}' +
      '.badge{position:fixed;bottom:62px;' + side + ':18px;min-width:20px;height:20px;padding:0 6px;border-radius:10px;' +
      'background:#ef4444;color:#fff;font:600 12px/20px system-ui,-apple-system,sans-serif;text-align:center}' +
      '.panel{position:fixed;bottom:88px;' + side + ':20px;width:380px;height:min(620px,calc(100vh - 110px));' +
      'border-radius:16px;overflow:hidden;background:#fff;box-shadow:0 12px 40px rgba(15,23,42,.28)}' +
      '.panel iframe{width:100%;height:100%;border:0;display:block}' +
      '[hidden]{display:none!important}' +
      '@media (max-width:480px){.panel{inset:0;width:100%;height:100%;border-radius:0;bottom:0}' +
      '.open .launcher,.open .badge{display:none}}';

    var wrap = document.createElement('div');
    var launcher = document.createElement('button');
    launcher.className = 'launcher';
    launcher.type = 'button';
    launcher.setAttribute('aria-label', 'Open chat');
    launcher.setAttribute('aria-expanded', 'false');
    var chatIcon =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
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
    wrap.appendChild(badge);
    wrap.appendChild(launcher);
    root.appendChild(style);
    root.appendChild(wrap);
    document.body.appendChild(host);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
