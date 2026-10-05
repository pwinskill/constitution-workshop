// Fills in the workshop links. On the live site the guides sit in guides/, so
// the app is one folder up. When a guide is opened from disk, add
// ?url=https://<user>.github.io/<repo>/ to its address to fill them in, or
// leave the blanks and write the link on after printing.
(function () {
  var given = new URLSearchParams(location.search).get('url');
  var base = null;
  try {
    if (given) base = new URL(/^https?:\/\//i.test(given) ? given : 'https://' + given);
    else if (/^https?:$/.test(location.protocol)) base = new URL('../', location.href);
  } catch (e) {
    base = null; // not a usable address: leave the blanks
  }
  if (!base) return;
  // The app's folder: without any page name (index.html, facilitator.html, a
  // guide), a trailing guides/, or anything after a ? or #.
  base.search = '';
  base.hash = '';
  var path = base.pathname.replace(/[^/]*\.html?$/i, '').replace(/guides\/$/i, '');
  base.pathname = /\/$/.test(path) ? path : path + '/';
  var root = base.href;
  document.querySelectorAll('[data-link]').forEach(function (slot) {
    var href = root + slot.getAttribute('data-link');
    var a = document.createElement('a');
    a.href = href;
    a.className = 'url';
    // Allow line breaks after each "/" rather than in the middle of a word.
    var parts = href.replace(/^https?:\/\//i, '').replace(/\/$/, '').split('/');
    parts.forEach(function (part, i) {
      a.appendChild(document.createTextNode(i < parts.length - 1 ? part + '/' : part));
      if (i < parts.length - 1) a.appendChild(document.createElement('wbr'));
    });
    slot.replaceWith(a);
  });
})();
