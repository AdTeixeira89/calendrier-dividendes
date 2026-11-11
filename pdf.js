/* ==================================================================
   pdf.js — petit générateur de PDF texte (module PUR, testé sous Node ; aucune dépendance).
   Police Courier (monospace), A4, accents français (WinAnsi), plusieurs pages.
   Sert à exporter des listes (ex. positions à vérifier) en fichier PDF lisible partout, y compris sur téléphone.
   ================================================================== */
(function (root) {
  'use strict';
  const MAP = { '€': 0x80, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, ' ': 0x20, ' ': 0x20, '≈': 0x7e, '→': 0x3e };
  function enc(s) {
    let out = '';
    for (const ch of String(s)) {
      const c = ch.codePointAt(0);
      if (MAP[ch] !== undefined) out += String.fromCharCode(MAP[ch]);
      else if (c >= 32 && c < 127) out += ch;
      else if (c >= 0xa0 && c <= 0xff) out += ch;
      else out += '?';
    }
    return out.replace(/[\\()]/g, (m) => '\\' + m);
  }
  /* Découpe un texte en lignes de `width` caractères (retour à la ligne sur les espaces), retrait de `indent` espaces à partir de la 2e ligne. */
  function wrap(text, width, indent) {
    const pad = ' '.repeat(indent || 0), out = [];
    String(text).split('\n').forEach((para) => {
      let line = '';
      para.split(' ').forEach((w) => {
        for (;;) {
          const sep = line.trim() ? ' ' : '';
          if ((line + sep + w).length <= width) { line += sep + w; break; }
          if (line.trim()) { out.push(line); line = pad; continue; }
          const room = width - line.length; out.push(line + w.slice(0, room)); w = w.slice(room); line = pad;     // mot plus long qu'une ligne
        }
      });
      out.push(line);
    });
    return out;
  }
  /* lines : tableau de chaînes ou d'objets { t: texte, b: true (gras) } ; renvoie le PDF sous forme de chaîne « binaire » (1 caractère = 1 octet). */
  function build(lines, o) {
    o = o || {};
    const size = o.size || 9, lead = o.lead || 12, W = 595, H = 842, M = 40, perPage = Math.floor((H - 2 * M) / lead);
    const pages = []; for (let i = 0; i < lines.length; i += perPage) pages.push(lines.slice(i, i + perPage));
    if (!pages.length) pages.push([]);
    const objs = [];                                   // objs[i] = contenu de l'objet i+1
    objs.push('<< /Type /Catalog /Pages 2 0 R >>');
    const kids = pages.map((_, i) => (5 + i * 2) + ' 0 R').join(' ');
    objs.push('<< /Type /Pages /Kids [' + kids + '] /Count ' + pages.length + ' >>');
    objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>');
    objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold /Encoding /WinAnsiEncoding >>');
    pages.forEach((pl, i) => {
      let c = 'BT\n' + lead + ' TL\n' + M + ' ' + (H - M - size) + ' Td\n';
      pl.forEach((ln) => { const t = typeof ln === 'string' ? ln : ln.t, b = typeof ln === 'object' && ln.b; c += '/F' + (b ? 2 : 1) + ' ' + size + ' Tf\n(' + enc(t) + ') Tj T*\n'; });
      c += 'ET';
      const page = 5 + i * 2, cont = 6 + i * 2;
      objs.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + W + ' ' + H + '] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ' + cont + ' 0 R >>');
      objs.push('<< /Length ' + c.length + ' >>\nstream\n' + c + '\nendstream');
    });
    let pdf = '%PDF-1.4\n', offs = [];
    objs.forEach((body, i) => { offs.push(pdf.length); pdf += (i + 1) + ' 0 obj\n' + body + '\nendobj\n'; });
    const xref = pdf.length;
    pdf += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n' + offs.map((x) => String(x).padStart(10, '0') + ' 00000 n \n').join('') + 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF';
    return pdf;
  }
  const toBytes = (s) => { const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 255; return u; };
  root.Pdf = { build, wrap, toBytes, enc };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.Pdf;
})(typeof self !== 'undefined' ? self : this);
