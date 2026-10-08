/* ==================================================================
   payouts.js — calcul des versements, rappels et export agenda.
   Chargé par la page (<script>) ET par le service worker
   (importScripts) : une seule source de vérité pour savoir
   « quel dividende tombe quel jour ».
   ================================================================== */
(function (root) {
  const MOIS = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
  const SYMBOLS = { EUR: '€', USD: '$', GBP: '£', CHF: 'CHF' };

  function pad2(n) { return String(n).padStart(2, '0'); }
  function iso(y, m, d) { return y + '-' + pad2(m) + '-' + pad2(d); }
  function daysIn(y, m) { return new Date(y, m, 0).getDate(); } // m = 1..12
  function money(n, cur) {
    const s = SYMBOLS[cur] !== undefined ? SYMBOLS[cur] : (cur || '');
    return Number(n || 0).toFixed(2).replace('.', ',') + (s.length > 1 ? ' ' : '') + s;
  }

  function freqMonths(f) { return { monthly: 1, quarterly: 3, semiannual: 6, annual: 12 }[f] || 0; }
  function monthsInCycle(anchor, f) {
    const step = freqMonths(f);
    if (!anchor || step <= 0) return [];
    const out = [];
    for (let off = 0; off < 12; off += step) out.push(((anchor - 1 + off) % 12) + 1);
    return out;
  }

  /* Versement d'une ligne pour un mois donné (m = 1..12), ou null.
     Si le jour n'est pas renseigné, on garde le modèle « mois seul » :
     jour = 15 par convention, dayKnown = false. */
  function payoutInMonth(h, y, m) {
    const div = h.dividend || {};
    const ym = y + '-' + pad2(m);
    const base = { holdingId: h.id, ticker: h.displayTicker || h.ticker, name: h.name || '', quantity: h.quantity || 0, currency: h.currency };
    // 1) date confirmée par l'API (déclarée par la société) : prioritaire
    const conf = (div.confirmed || []).find(function (c) { return c.payDate && c.payDate.slice(0, 7) === ym; });
    if (conf) {
      const amt = conf.amount || div.lastAmount || 0;
      return Object.assign(base, { date: conf.payDate, dayKnown: true, dayFrom: 'confirmed', confirmed: true,
        amount: amt, total: amt * base.quantity });
    }
    if (!div.lastAmount) return null;
    if (monthsInCycle(div.anchorMonth, div.frequency).indexOf(m) === -1) return null;
    // 2) jour saisi à la main, 3) jour habituel relevé par l'API, 4) mois seul
    const pd = parseInt(div.payDay, 10), pa = parseInt(div.payDayApi, 10);
    const manual = pd >= 1 && pd <= 31, api = !manual && pa >= 1 && pa <= 31;
    const known = manual || api;
    const day = known ? Math.min(manual ? pd : pa, daysIn(y, m)) : 15;
    return Object.assign(base, { date: iso(y, m, day), dayKnown: known, dayFrom: manual ? 'manual' : api ? 'api' : null, confirmed: false,
      amount: div.lastAmount, total: div.lastAmount * base.quantity });
  }

  /* Tous les versements entre deux dates incluses (objets Date). */
  function payoutsBetween(holdings, from, to) {
    const out = [];
    for (let y = from.getFullYear(); y <= to.getFullYear(); y++) {
      for (let m = 1; m <= 12; m++) {
        holdings.forEach(function (h) {
          const p = payoutInMonth(h, y, m);
          if (!p) return;
          const d = new Date(y, m - 1, Number(p.date.slice(8)));
          if (d >= from && d <= to) out.push(p);
        });
      }
    }
    out.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    return out;
  }

  /* Résumé mensuel : UNE notification par mois, à la première ouverture
     du mois, avec le montant attendu pour chaque action concernée. */
  function monthSummary(list) {
    const totals = {};
    list.forEach(function (p) { totals[p.currency] = (totals[p.currency] || 0) + p.total; });
    const totalTxt = Object.keys(totals).map(function (c) { return money(totals[c], c); }).join(' + ');
    const lines = list.map(function (p) {
      const day = p.dayKnown ? ' (le ' + Number(p.date.slice(8)) + ')' : '';
      return p.ticker + ' ≈ ' + money(p.total, p.currency) + day;
    });
    return { totalTxt: totalTxt, lines: lines };
  }
  function notificationPlan(state, now) {
    const sent = state.sent || { days: {}, months: {} };
    const y = now.getFullYear(), m = now.getMonth() + 1;
    const monthKey = y + '-' + pad2(m);
    if ((sent.months || {})[monthKey]) return [];
    const list = [];
    (state.holdings || []).forEach(function (h) {
      const p = payoutInMonth(h, y, m);
      if (p) list.push(p);
    });
    if (!list.length) return [];
    list.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    const sum = monthSummary(list);
    return [{
      kind: 'month', key: monthKey, tag: 'dividendes-' + monthKey,
      title: '💰 Dividendes ' + (/^[aeiouéô]/.test(MOIS[m - 1]) ? 'd’' : 'de ') + MOIS[m - 1] + ' : ' + sum.totalTxt,
      body: sum.lines.join('\n')
    }];
  }
  function markSent(state, plan) {
    state.sent = state.sent || { days: {}, months: {} };
    state.sent.days = state.sent.days || {};
    state.sent.months = state.sent.months || {};
    (plan.kind === 'day' ? state.sent.days : state.sent.months)[plan.key] = 1;
    // on ne garde que les 60 dernières clés pour ne pas grossir indéfiniment
    ['days', 'months'].forEach(function (k) {
      const keys = Object.keys(state.sent[k]).sort();
      keys.slice(0, Math.max(0, keys.length - 60)).forEach(function (kk) { delete state.sent[k][kk]; });
    });
  }

  /* ---------- Export agenda (.ics) ---------- */
  function icsEscape(s) { return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n'); }
  function fold(line) {
    // pliage RFC 5545 : 75 octets max, on reste prudent en comptant les caractères
    const out = []; let rest = line;
    while (rest.length > 70) { out.push(rest.slice(0, 70)); rest = ' ' + rest.slice(70); }
    out.push(rest);
    return out.join('\r\n');
  }
  function ymd(isoStr) { return isoStr.replace(/-/g, ''); }
  function nextDay(isoStr) {
    const d = new Date(Number(isoStr.slice(0, 4)), Number(isoStr.slice(5, 7)) - 1, Number(isoStr.slice(8)) + 1);
    return iso(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }
  function buildICS(state, from, monthsAhead, hourOfAlarm) {
    const to = new Date(from.getFullYear(), from.getMonth() + monthsAhead, 0);
    const list = payoutsBetween(state.holdings || [], new Date(from.getFullYear(), from.getMonth(), from.getDate()), to);
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const hour = hourOfAlarm == null ? 9 : hourOfAlarm;
    const ev = [];
    function push(uid, startIso, summary, desc) {
      ev.push('BEGIN:VEVENT', 'UID:' + uid, 'DTSTAMP:' + stamp,
        'DTSTART;VALUE=DATE:' + ymd(startIso), 'DTEND;VALUE=DATE:' + ymd(nextDay(startIso)),
        'SUMMARY:' + icsEscape(summary), 'DESCRIPTION:' + icsEscape(desc), 'TRANSP:TRANSPARENT',
        'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + icsEscape(summary),
        'TRIGGER;VALUE=DURATION:PT' + hour + 'H', 'END:VALARM', 'END:VEVENT');
    }
    const byMonth = {};
    list.forEach(function (p) { (byMonth[p.date.slice(0, 7)] = byMonth[p.date.slice(0, 7)] || []).push(p); });
    Object.keys(byMonth).sort().forEach(function (ym) {
      const items = byMonth[ym];
      const sum = monthSummary(items);
      push('mois-' + ym + '@calendrier-dividendes', ym + '-01',
        '💰 Dividendes du mois : ' + sum.totalTxt, sum.lines.join('\n') + '\nMontants estimés.');
    });
    const head = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Calendrier Dividendes//FR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
      'X-WR-CALNAME:Dividendes'];
    return { text: head.concat(ev, ['END:VCALENDAR']).map(fold).join('\r\n') + '\r\n', count: ev.filter(function (l) { return l === 'BEGIN:VEVENT'; }).length };
  }

  root.Payouts = {
    freqMonths: freqMonths, monthsInCycle: monthsInCycle, payoutInMonth: payoutInMonth,
    payoutsBetween: payoutsBetween, notificationPlan: notificationPlan, markSent: markSent,
    buildICS: buildICS, money: money, MOIS: MOIS
  };
})(typeof self !== 'undefined' ? self : this);
