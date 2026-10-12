/*
 * Website chat window — runs inside the iframe the install script opens.
 *
 * Rules this file keeps:
 *   - Text from anybody is rendered as text (textContent / createElement),
 *     never as HTML. Links are made from https/http URLs only.
 *   - The session token is kept in this frame's storage and sent as a
 *     bearer header — never in a cookie (no CSRF) and never to the host
 *     page.
 *   - Every message carries an id the window chose, so a retry after a
 *     dropped connection is stored and answered once.
 *   - Messages arrive over the socket; when it is down, the window catches
 *     up by asking for everything after the last message it has, and
 *     polls only while it is visible.
 */
(function () {
  'use strict';

  var app = document.getElementById('app');
  var KEY = app.getAttribute('data-key');
  var STORE = 'wc:' + KEY + ':token';
  var POLL_MS = 6000;

  var state = {
    token: null,
    widget: null,
    messages: [], // server messages, oldest first
    pending: {}, // client_id -> { text, failed }
    status: null,
    withTeam: false,
    typing: false,
    connected: false,
    sending: false,
    unread: 0,
    visible: true,
    error: null,
  };
  var socket = null;
  var pollTimer = null;
  var pageUrl = null;

  // ── Storage, which may be blocked (private mode, strict third-party rules) ──
  function load(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  function save(key, value) {
    try {
      if (value === null) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, value);
    } catch (e) { /* the chat still works for this page view */ }
  }

  try {
    var hash = new URLSearchParams(location.hash.slice(1));
    pageUrl = hash.get('page');
  } catch (e) { pageUrl = null; }

  // ── Network ──
  function api(method, path, body) {
    var headers = { 'Content-Type': 'application/json' };
    if (state.token) headers.Authorization = 'Bearer ' + state.token;
    return fetch(path, {
      method: method,
      headers: headers,
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'omit',
      cache: 'no-store',
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) {
          var err = new Error(data.error || 'Something went wrong. Please try again.');
          err.status = res.status;
          throw err;
        }
        return data;
      });
    });
  }

  function randomId() {
    var bytes = new Uint8Array(16);
    (window.crypto || window.msCrypto).getRandomValues(bytes);
    return Array.prototype.map.call(bytes, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }

  function startSession() {
    return api('POST', '/api/webchat/session', { key: KEY, token: load(STORE), page_url: pageUrl }).then(function (data) {
      state.token = data.token;
      save(STORE, data.token);
      state.widget = data.widget;
      state.messages = data.messages || [];
      state.status = data.status;
      state.withTeam = Boolean(data.with_team);
      state.error = null;
      applyBrand();
      render();
      connect();
    });
  }

  function catchUp() {
    if (!state.token) return Promise.resolve();
    var last = state.messages.length ? state.messages[state.messages.length - 1].created_at : null;
    var path = '/api/webchat/messages' + (last ? '?after=' + encodeURIComponent(last) : '');
    return api('GET', path).then(function (data) {
      (data.messages || []).forEach(addMessage);
      if (data.status !== undefined) {
        state.status = data.status;
        state.withTeam = Boolean(data.with_team);
      }
      render();
    }).catch(function (err) {
      if (err.status === 401) restart();
    });
  }

  function restart() {
    save(STORE, null);
    state.token = null;
    if (socket) { socket.disconnect(); socket = null; }
    startSession().catch(showFatal);
  }

  function connect() {
    if (typeof window.io !== 'function') { schedulePoll(); return; }
    if (socket) socket.disconnect();
    socket = window.io('/webchat', {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      auth: function (cb) { cb({ token: state.token }); },
    });
    socket.on('connect', function () {
      var wasDown = !state.connected;
      state.connected = true;
      stopPoll();
      render();
      if (wasDown) catchUp();
    });
    socket.on('disconnect', function () {
      state.connected = false;
      render();
      schedulePoll();
    });
    socket.on('connect_error', function (err) {
      state.connected = false;
      render();
      if (err && err.message === 'unauthorized') { restart(); return; }
      schedulePoll();
    });
    socket.on('message', function (msg) {
      addMessage(msg);
      if (msg.sender !== 'visitor') state.typing = false;
      render();
    });
    socket.on('typing', function (data) {
      state.typing = Boolean(data && data.typing);
      render();
    });
    socket.on('status', function (data) {
      state.status = data.status;
      state.withTeam = Boolean(data.with_team);
      render();
    });
  }

  // Polling is the fallback only, and rests while the chat is not on screen.
  function schedulePoll() {
    if (pollTimer || state.connected) return;
    pollTimer = window.setInterval(function () {
      if (document.visibilityState === 'visible' && state.visible) catchUp();
    }, POLL_MS);
  }
  function stopPoll() {
    if (pollTimer) { window.clearInterval(pollTimer); pollTimer = null; }
  }

  function addMessage(msg) {
    if (!msg || !msg.id) return;
    for (var i = 0; i < state.messages.length; i++) if (state.messages[i].id === msg.id) return;
    state.messages.push(msg);
    state.messages.sort(function (a, b) { return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0; });
    if (msg.sender !== 'visitor' && (!state.visible || document.visibilityState !== 'visible')) {
      state.unread += 1;
      tellParent({ type: 'wc:unread', count: state.unread });
    }
  }

  function send(text, reply) {
    var clientId = randomId();
    state.pending[clientId] = { text: text, failed: false, reply: reply || null };
    state.sending = true;
    render();
    return deliver(clientId);
  }

  function deliver(clientId) {
    var item = state.pending[clientId];
    if (!item) return Promise.resolve();
    item.failed = false;
    state.error = null;
    render();
    var body = { client_id: clientId, text: item.text };
    if (item.reply) body.reply = item.reply;
    return api('POST', '/api/webchat/messages', body).then(function (data) {
      delete state.pending[clientId];
      addMessage(data.message);
    }).catch(function (err) {
      if (err.status === 401) {
        delete state.pending[clientId];
        restart();
        return;
      }
      item.failed = true;
      state.error = err.message;
    }).then(function () {
      state.sending = false;
      render();
    });
  }

  function askForPerson() {
    state.sending = true;
    render();
    api('POST', '/api/webchat/handoff').then(function (data) {
      state.status = data.status;
      state.withTeam = true;
    }).catch(function (err) {
      state.error = err.message;
    }).then(function () {
      state.sending = false;
      render();
    });
  }

  // ── Talking to the install script ──
  // Only harmless signals go out (close, unread count), so the target
  // origin does not need to be known; nothing about the conversation is
  // ever posted to the host page.
  function tellParent(message) {
    if (window.parent && window.parent !== window) window.parent.postMessage(message, '*');
  }
  window.addEventListener('message', function (event) {
    if (event.source !== window.parent) return;
    var data = event.data || {};
    if (data.type === 'wc:open') {
      state.visible = true;
      state.unread = 0;
      focusInput();
      catchUp();
    } else if (data.type === 'wc:closed') {
      state.visible = false;
    }
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') tellParent({ type: 'wc:close' });
  });

  // ── Rendering (text only) ──
  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function svg(path) {
    var ns = 'http://www.w3.org/2000/svg';
    var s = document.createElementNS(ns, 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('fill', 'none');
    s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', '2');
    s.setAttribute('stroke-linecap', 'round');
    s.setAttribute('stroke-linejoin', 'round');
    s.setAttribute('aria-hidden', 'true');
    var p = document.createElementNS(ns, 'path');
    p.setAttribute('d', path);
    s.appendChild(p);
    return s;
  }

  function safeUrl(value) {
    try {
      var url = new URL(value);
      return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
    } catch (e) { return null; }
  }

  /** Text with its web addresses as links — built node by node. */
  function textWithLinks(parent, text) {
    var pattern = /https?:\/\/[^\s<>"')]+/g;
    var last = 0;
    var match;
    while ((match = pattern.exec(text))) {
      if (match.index > last) parent.appendChild(document.createTextNode(text.slice(last, match.index)));
      var href = safeUrl(match[0]);
      if (href) {
        var a = el('a', null, match[0]);
        a.href = href;
        a.target = '_blank';
        a.rel = 'noopener noreferrer nofollow';
        parent.appendChild(a);
      } else {
        parent.appendChild(document.createTextNode(match[0]));
      }
      last = match.index + match[0].length;
    }
    if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
  }

  function timeOf(iso) {
    try {
      return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    } catch (e) { return ''; }
  }

  function applyBrand() {
    var color = state.widget && /^#[0-9a-fA-F]{6}$/.test(state.widget.primary_color) ? state.widget.primary_color : '#4f46e5';
    var r = parseInt(color.slice(1, 3), 16), g = parseInt(color.slice(3, 5), 16), b = parseInt(color.slice(5, 7), 16);
    var light = (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62;
    document.documentElement.style.setProperty('--brand', color);
    document.documentElement.style.setProperty('--brand-ink', light ? '#0f172a' : '#ffffff');
    document.title = (state.widget && state.widget.title) || 'Chat';
  }

  var dom = null;

  function build() {
    app.textContent = '';
    var head = el('header', 'head');
    var logo = null;
    if (state.widget && safeUrl(state.widget.logo_url)) {
      logo = el('img');
      logo.alt = '';
      logo.src = state.widget.logo_url;
      head.appendChild(logo);
    }
    var titles = el('div', 'titles');
    var h1 = el('h1', null, (state.widget && state.widget.title) || 'Chat');
    var status = el('div', 'state');
    status.setAttribute('aria-live', 'polite');
    titles.appendChild(h1);
    titles.appendChild(status);
    head.appendChild(titles);
    var close = el('button', 'icon-btn');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close chat');
    close.appendChild(svg('M18 6 6 18M6 6l12 12'));
    close.addEventListener('click', function () { tellParent({ type: 'wc:close' }); });
    head.appendChild(close);

    var log = el('div', 'log');
    log.setAttribute('role', 'log');
    log.setAttribute('aria-live', 'polite');
    log.setAttribute('aria-label', 'Conversation');

    var notice = el('div', 'notice');
    notice.setAttribute('role', 'alert');
    notice.hidden = true;

    var handoff = el('button', 'handoff', 'Talk to a person');
    handoff.type = 'button';
    handoff.addEventListener('click', askForPerson);

    var form = el('form', 'composer');
    var label = el('label', 'sr-only', 'Type your message');
    label.htmlFor = 'wc-input';
    var input = el('textarea');
    input.id = 'wc-input';
    input.rows = 1;
    input.maxLength = 2000;
    input.placeholder = 'Type a message…';
    input.setAttribute('autocomplete', 'off');
    input.addEventListener('input', function () {
      input.style.height = 'auto';
      input.style.height = Math.min(120, input.scrollHeight) + 'px';
      sendBtn.disabled = state.sending || !input.value.trim();
    });
    input.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        submit();
      }
    });
    var sendBtn = el('button', 'send');
    sendBtn.type = 'submit';
    sendBtn.setAttribute('aria-label', 'Send message');
    sendBtn.disabled = true;
    sendBtn.appendChild(svg('M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z'));
    form.appendChild(label);
    form.appendChild(input);
    form.appendChild(sendBtn);
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      submit();
    });

    function submit() {
      var text = input.value.trim();
      if (!text || state.sending) return;
      input.value = '';
      input.style.height = 'auto';
      sendBtn.disabled = true;
      send(text);
    }

    app.appendChild(head);
    app.appendChild(log);
    app.appendChild(notice);
    app.appendChild(handoff);
    app.appendChild(form);
    dom = { status: status, log: log, notice: notice, handoff: handoff, input: input, send: sendBtn };
  }

  function bubble(row, msg) {
    var b = el('div', 'bubble');
    if (msg.media_url && safeUrl(msg.media_url)) {
      if (msg.media_type === 'image') {
        var img = el('img');
        img.alt = msg.media_name || 'Image';
        img.src = msg.media_url;
        img.loading = 'lazy';
        b.appendChild(img);
      } else {
        var file = el('a', null, msg.media_name || 'Open attachment');
        file.href = msg.media_url;
        file.target = '_blank';
        file.rel = 'noopener noreferrer nofollow';
        b.appendChild(file);
        if (msg.text) b.appendChild(document.createTextNode('\n'));
      }
    }
    if (msg.text) textWithLinks(b, msg.text);
    row.appendChild(b);
  }

  function renderLog() {
    var log = dom.log;
    // Stay where the visitor scrolled to, unless they were already at the
    // bottom — then follow the conversation.
    var nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    log.textContent = '';

    if (state.widget && state.widget.welcome_message) {
      var welcome = el('div', 'row them');
      bubble(welcome, { text: state.widget.welcome_message });
      log.appendChild(welcome);
    }

    // Buttons are live only on the newest message, and only until the
    // visitor answers — the same as a WhatsApp chatbot menu.
    var lastIndex = state.messages.length - 1;
    state.messages.forEach(function (msg, index) {
      var mine = msg.sender === 'visitor';
      var row = el('div', 'row ' + (mine ? 'me' : 'them'));
      bubble(row, msg);
      if (!mine && msg.buttons && msg.buttons.length) {
        var choices = el('div', 'choices');
        choices.setAttribute('role', 'group');
        choices.setAttribute('aria-label', 'Options');
        msg.buttons.forEach(function (option) {
          var btn = el('button', 'choice', option.title);
          btn.type = 'button';
          btn.disabled = index !== lastIndex || state.sending;
          btn.addEventListener('click', function () {
            send(option.title, { id: option.id, title: option.title });
          });
          choices.appendChild(btn);
        });
        row.appendChild(choices);
      }
      if (!mine && msg.link && safeUrl(msg.link.url)) {
        var linkWrap = el('div', 'choices');
        var a = el('a', 'link-btn', msg.link.label || 'Open link');
        a.href = msg.link.url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer nofollow';
        linkWrap.appendChild(a);
        row.appendChild(linkWrap);
      }
      row.appendChild(el('div', 'meta', (msg.sender === 'agent' ? 'Team · ' : '') + timeOf(msg.created_at)));
      log.appendChild(row);
    });

    Object.keys(state.pending).forEach(function (clientId) {
      var item = state.pending[clientId];
      var row = el('div', 'row me');
      bubble(row, { text: item.text });
      var meta = el('div', 'meta' + (item.failed ? ' failed' : ''));
      if (item.failed) {
        meta.appendChild(document.createTextNode('Not sent. '));
        var retry = el('button', null, 'Retry');
        retry.type = 'button';
        retry.addEventListener('click', function () { deliver(clientId); });
        meta.appendChild(retry);
      } else {
        meta.textContent = 'Sending…';
      }
      row.appendChild(meta);
      log.appendChild(row);
    });

    if (state.typing) {
      var typing = el('div', 'typing');
      typing.setAttribute('aria-label', 'Typing');
      typing.appendChild(el('span'));
      typing.appendChild(el('span'));
      typing.appendChild(el('span'));
      log.appendChild(typing);
    }

    if (nearBottom || Object.keys(state.pending).length) log.scrollTop = log.scrollHeight;
  }

  function render() {
    if (!dom) build();
    var status = state.withTeam
      ? 'Connecting you with the team'
      : state.connected || typeof window.io !== 'function'
        ? 'We usually reply in a few minutes'
        : 'Reconnecting…';
    dom.status.textContent = status;
    dom.notice.hidden = !state.error;
    dom.notice.textContent = state.error || '';
    var canHandoff = state.widget && state.widget.allow_handoff;
    dom.handoff.hidden = !canHandoff || !state.messages.length;
    dom.handoff.disabled = state.withTeam || state.sending;
    dom.handoff.textContent = state.withTeam ? 'The team has been told — someone will reply here' : 'Talk to a person';
    dom.send.disabled = state.sending || !dom.input.value.trim();
    renderLog();
  }

  function focusInput() {
    if (dom && dom.input) dom.input.focus();
  }

  function showFatal(err) {
    app.textContent = '';
    var box = el('div', 'center');
    box.appendChild(el('p', null, (err && err.message) || 'The chat could not start.'));
    var retry = el('button', 'handoff', 'Try again');
    retry.type = 'button';
    retry.addEventListener('click', function () {
      dom = null;
      app.textContent = '';
      startSession().then(focusInput).catch(showFatal);
    });
    box.appendChild(retry);
    app.appendChild(box);
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && state.visible) {
      state.unread = 0;
      catchUp();
    }
  });

  startSession().then(focusInput).catch(showFatal);
})();
