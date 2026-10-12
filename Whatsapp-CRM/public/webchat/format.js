/*
 * WhatsApp-style formatting for the website chat window.
 *
 * The assistant and chatbots write for WhatsApp — *bold*, _italic_,
 * ~strike~, `code`, ```block```, "- " lists — and the window showed the
 * markers as typed. This renders them the way WhatsApp does.
 *
 * Safe by construction: it only ever creates elements and text nodes,
 * never parses HTML, so a visitor typing <script> gets those characters
 * back as text. Web addresses are found first and never formatted inside,
 * so an underscore in a link cannot turn half of it italic.
 *
 * Exposes window.wcFormat(parent, text). No dependencies.
 */
(function () {
  'use strict';

  var URL_RE = /https?:\/\/[^\s<>"')]+/g;
  // A marker opens after a start, space or opening punctuation, is followed
  // by a non-space, closes after a non-space and before an end, space or
  // closing punctuation — WhatsApp's own rule, so "2*3*4" stays as typed.
  var INLINE_RE = /(^|[\s(\[{"'«“‘\-])(```([\s\S]+?)```|`([^`\n]+)`|\*(\S(?:[^*\n]*?\S)?)\*|_(\S(?:[^_\n]*?\S)?)_|~(\S(?:[^~\n]*?\S)?)~)(?=$|[\s.,!?;:)\]}"'»”’\-])/;
  var BULLET_RE = /^\s*(?:[-•*])\s+(.*)$/;
  var NUMBERED_RE = /^\s*(\d{1,3})[.)]\s+(.*)$/;

  function safeHref(value) {
    try {
      var url = new URL(value);
      return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
    } catch (e) {
      return null;
    }
  }

  function el(tag, cls) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    return node;
  }

  /** Plain text with links, no formatting. */
  function linkify(parent, text) {
    var last = 0;
    var match;
    URL_RE.lastIndex = 0;
    while ((match = URL_RE.exec(text))) {
      if (match.index > last) parent.appendChild(document.createTextNode(text.slice(last, match.index)));
      var href = safeHref(match[0]);
      if (href) {
        var a = el('a');
        a.textContent = match[0];
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

  /** Inline markers, recursively (bold inside italic and so on). */
  function inline(parent, text, depth) {
    if (depth > 4) { linkify(parent, text); return; }
    // Links are cut out first; only the text between them is formatted.
    var last = 0;
    var match;
    URL_RE.lastIndex = 0;
    var pieces = [];
    while ((match = URL_RE.exec(text))) {
      if (match.index > last) pieces.push({ text: text.slice(last, match.index) });
      pieces.push({ url: match[0] });
      last = match.index + match[0].length;
    }
    if (last < text.length) pieces.push({ text: text.slice(last) });

    pieces.forEach(function (piece) {
      if (piece.url) { linkify(parent, piece.url); return; }
      var rest = piece.text;
      var m;
      while (rest && (m = INLINE_RE.exec(rest))) {
        var start = m.index + m[1].length;
        if (start > 0) parent.appendChild(document.createTextNode(rest.slice(0, start)));
        var node;
        if (m[3] !== undefined) { node = el('code', 'wc-pre'); node.textContent = m[3]; }
        else if (m[4] !== undefined) { node = el('code'); node.textContent = m[4]; }
        else if (m[5] !== undefined) { node = el('strong'); inline(node, m[5], depth + 1); }
        else if (m[6] !== undefined) { node = el('em'); inline(node, m[6], depth + 1); }
        else { node = el('s'); inline(node, m[7], depth + 1); }
        parent.appendChild(node);
        rest = rest.slice(start + m[2].length);
      }
      if (rest) parent.appendChild(document.createTextNode(rest));
    });
  }

  /**
   * The whole message: paragraphs, "- " / "• " lists and "1. " lists.
   * Consecutive list lines become one list; everything else keeps its
   * line breaks (the bubble is pre-wrap).
   */
  function format(parent, text) {
    var lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    var list = null;
    var listKind = null;
    var pendingBreak = false;

    function closeList() {
      list = null;
      listKind = null;
    }

    lines.forEach(function (line, i) {
      var bullet = BULLET_RE.exec(line);
      var numbered = !bullet && NUMBERED_RE.exec(line);
      // "* bold *"-style lines are not bullets: a bullet marker needs text
      // after the space, which BULLET_RE already requires.
      if (bullet || numbered) {
        var kind = bullet ? 'ul' : 'ol';
        if (!list || listKind !== kind) {
          list = el(kind, 'wc-list');
          if (numbered) list.start = Number(numbered[1]);
          listKind = kind;
          parent.appendChild(list);
          pendingBreak = false;
        }
        var li = el('li');
        inline(li, bullet ? bullet[1] : numbered[2], 0);
        list.appendChild(li);
        return;
      }
      if (list) {
        closeList();
        // A blank line straight after a list is the list's own spacing.
        if (!line.trim()) return;
      } else if (pendingBreak) {
        parent.appendChild(document.createTextNode('\n'));
      }
      inline(parent, line, 0);
      pendingBreak = i < lines.length - 1;
    });
  }

  window.wcFormat = format;
})();
