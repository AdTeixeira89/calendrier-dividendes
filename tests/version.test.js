/* Garde-fou : le numéro de version de l'application (refresh.js) doit suivre celui du cache du service worker (sw.js), sinon la détection de mise à jour se trompe. */
const assert = require('assert'), fs = require('fs'), path = require('path');
const sw = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8'), rf = fs.readFileSync(path.join(__dirname, '..', 'refresh.js'), 'utf8');
const a = Number((sw.match(/dividendes-shell-v(\d+)/) || [])[1]), b = Number((rf.match(/APP_BUILD = (\d+)/) || [])[1]);
try { assert.ok(a > 0 && b > 0, 'numéros introuvables'); assert.strictEqual(a, b, 'sw.js (v' + a + ') et refresh.js APP_BUILD (' + b + ') doivent être identiques'); assert.ok(/'refresh\.js'/.test(sw), 'refresh.js absent de la liste de fichiers du service worker'); console.log('ok   version : sw.js et refresh.js alignés (v' + a + ')'); }
catch (e) { console.log('FAIL version\n   ', e.message); process.exitCode = 1; }
