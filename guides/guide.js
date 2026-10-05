// Fills in the workshop links. On the live site the guides sit in guides/, so
// the app is one folder up. When a guide is opened from disk, add
// ?url=https://<user>.github.io/<repo>/ to its address to fill them in, or
// leave the blanks and write the link on after printing.
(function () {
  var given = new URLSearchParams(location.search).get('url');
  var base = null;
  if (given) base = /^https?:\/\//i.test(given) ? given : 'https://' + given;
  else if (/^https?:$/.test(location.protocol)) base = new URL('../', location.href).href;
  if (!base) return;
  base = base.replace(/(index\.html|facilitator\.html)?([?#].*)?$/i, '');
  if (!/\/$/.test(base)) base += '/';
  document.querySelectorAll('[data-link]').forEach(function (slot) {
    var href = base + slot.getAttribute('data-link');
    var a = document.createElement('a');
    a.href = href;
    a.className = 'url';
    // Allow line breaks after each "/" rather than in the middle of a word.
    var parts = href.replace(/^https?:\/\//, '').replace(/\/$/, '').split('/');
    parts.forEach(function (part, i) {
      a.appendChild(document.createTextNode(i < parts.length - 1 ? part + '/' : part));
      if (i < parts.length - 1) a.appendChild(document.createElement('wbr'));
    });
    slot.replaceWith(a);
  });
})();
