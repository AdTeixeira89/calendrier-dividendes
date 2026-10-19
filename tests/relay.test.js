/* Tests du relais Cloudflare (relay/worker.js) : traduction avec service de secours, validation des entrées. Lancer : node tests/relay.test.js */
const assert = require('assert'), fs = require('fs'), path = require('path');
(async () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'relay', 'worker.js'), 'utf8');
  const W = (await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'))).default;
  const call = (u, hdr) => W.fetch(new Request(u, { headers: hdr || { Origin: 'https://adteixeira89.github.io' } }), {});
  const real = globalThis.fetch; let n = 0;
  try {
    globalThis.fetch = async (u) => { n++; if (/translate\.googleapis/.test(u)) return { ok: false, status: 429, json: async () => ({}) }; return { ok: true, json: async () => ({ responseData: { translatedText: 'L&#39;action monte' } }) }; };
    let r = await call('https://x.dev/translate?t=' + encodeURIComponent('Stock rises')); assert.deepStrictEqual(await r.json(), { translations: ["L'action monte"] }); n = 0;
    globalThis.fetch = async () => { throw new Error('down'); };
    r = await call('https://x.dev/translate?t=a&t=b'); assert.deepStrictEqual(await r.json(), { translations: [null, null] }, 'échec complet = null, jamais une erreur');
    globalThis.fetch = async (u) => ({ ok: true, json: async () => ([[['Bonjour ', 'Hello '], ['le monde', 'world']]]) });
    r = await call('https://x.dev/translate?t=Hello%20world'); assert.deepStrictEqual(await r.json(), { translations: ['Bonjour le monde'] }, 'segments Google assemblés');
    assert.strictEqual((await call('https://x.dev/translate')).status, 400); assert.strictEqual((await call('https://x.dev/translate?t=a', { Origin: 'https://evil.dev' })).status, 403, 'origine non autorisée');
    assert.strictEqual((await call('https://x.dev/news?symbol=' + encodeURIComponent('A B'))).status, 400, 'symbole invalide refusé');
  } finally { globalThis.fetch = real; }
  console.log('ok   relais : traduction avec secours (Google puis MyMemory), échec = null, origine et symbole validés');
})().catch((e) => { console.log('FAIL relais\n   ', e.message); process.exitCode = 1; });
