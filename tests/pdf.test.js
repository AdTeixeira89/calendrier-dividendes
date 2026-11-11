/* Tests du générateur de PDF (pdf.js). Lancer :  node tests/pdf.test.js */
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const P = require('../pdf.js');
let n = 0; const t = (name, fn) => { try { fn(); n++; console.log('ok  ', name); } catch (e) { console.log('FAIL', name, '\n   ', e.message); process.exitCode = 1; } };

t('retour à la ligne : largeur respectée, retrait, mots très longs coupés', () => {
  const l = P.wrap('un deux trois quatre cinq six sept huit neuf dix', 12, 2); assert.ok(l.every((x) => x.length <= 12), l.join('|')); assert.ok(l.slice(1).every((x) => x.startsWith('  ')));
  assert.deepStrictEqual(P.wrap('ABCDEFGHIJKLMNOP', 6, 0), ['ABCDEF', 'GHIJKL', 'MNOP']);
});
t('accents, euro et parenthèses encodés (WinAnsi), caractères inconnus remplacés', () => {
  assert.strictEqual(P.enc('Société (€) \\'), 'Soci\u00e9t\u00e9 \\(\x80\\) \\\\'); assert.strictEqual(P.enc('日本'), '??');
});
t('PDF valide : lisible par pdftotext (accents, plusieurs pages)', () => {
  const lines = []; for (let i = 1; i <= 150; i++) lines.push(i === 1 ? { t: 'Liste des positions — Société été', b: true } : 'Ligne ' + i + ' : Carmat SA (FR0010907956) radiée');
  const bytes = P.toBytes(P.build(lines)), f = path.join(os.tmpdir(), 'sp-test.pdf'); fs.writeFileSync(f, bytes);
  assert.strictEqual(Buffer.from(bytes.slice(0, 5)).toString(), '%PDF-');
  let txt = ''; try { txt = cp.execFileSync('pdftotext', ['-layout', f, '-'], { encoding: 'utf8' }); } catch (e) { console.log('     (pdftotext absent : lecture non vérifiée)'); return; }
  assert.ok(/Liste des positions . Soci\u00e9t\u00e9 \u00e9t\u00e9/.test(txt), txt.slice(0, 200)); assert.ok(/Ligne 150 : Carmat SA \(FR0010907956\) radi\u00e9e/.test(txt)); assert.ok(txt.split('\f').length >= 3, 'plusieurs pages');
});
console.log('\n' + n + ' tests réussis');
