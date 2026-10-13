/* ==================================================================
   settings.js — Paramètres : compte, affichage, données de marché,
   sauvegarde, sécurité de l'appareil, rappels.
   ================================================================== */

function renderSettings(host) {
  const u = Cloud.user(), cfgd = Cloud.configured(), s = state.settings;
  const sec = (title, sub, body) => '<section class="card settings-sec"><h3>' + title + '</h3>' + (sub ? '<div class="sub">' + sub + '</div>' : '') + body + '</section>';
  let account;
  if (u) {
    account = '<dl class="kv"><dt>Adresse e-mail</dt><dd>' + esc(u.email) + '</dd><dt>Vérification</dt><dd>' + (u.emailVerified ? 'Adresse vérifiée' : 'Non vérifiée') + '</dd><dt>Synchronisation</dt><dd>' + esc(view.sync.msg || 'Compte connecté') + '</dd></dl>' +
      '<div class="btn-row" style="margin-top:12px"><button class="btn" type="button" id="sSync">' + icon('refresh') + 'Synchroniser maintenant</button><button class="btn" type="button" id="sReset">Changer le mot de passe (e-mail)</button>' +
      (u.emailVerified ? '' : '<button class="btn" type="button" id="sVerify">Renvoyer l\'e-mail de vérification</button>') + '<button class="btn" type="button" id="sOut">Se déconnecter</button></div>' +
      '<div class="section-gap"><button class="btn danger sm" type="button" id="sDelAcc">' + icon('trash') + 'Supprimer mon compte et mes données cloud</button><div class="hint" style="margin-top:6px">Irréversible. Les données de cet appareil sont supprimées aussi.</div></div>';
  } else if (cfgd) {
    account = '<div class="notice info">Vous utilisez l\'application sans compte : vos données restent sur cet appareil uniquement.</div><div class="btn-row" style="margin-top:12px"><button class="btn primary" type="button" id="sIn">Se connecter / créer un compte</button></div><div class="hint" style="margin-top:8px">À la connexion, vos données actuelles peuvent être envoyées dans votre compte sans rien perdre.</div>';
  } else {
    account = '<div class="notice">La synchronisation par compte n\'est pas encore activée sur cette installation (configuration Firebase manquante). Vos données restent sur cet appareil. Voir le README (section « Comptes utilisateurs et synchronisation »).</div>';
  }
  const dataSrc = '<div class="field"><label for="sRelay">Adresse du relais de données (Yahoo Finance)</label><input type="text" id="sRelay" value="' + esc(s.relayUrl) + '" placeholder="https://…workers.dev"><span class="hint">Fournit nom, devise et historique des dividendes (date de détachement et montant par titre). Ne fournit ni date de paiement, ni retenue fiscale : saisissez-les à la main ou importez vos transactions.</span></div>' +
    '<div class="btn-row"><button class="btn" type="button" id="sTest">Tester le relais</button><button class="btn" type="button" id="sRefresh">' + icon('refresh') + 'Actualiser tous les actifs</button></div><div class="hint" id="sRelayMsg" style="margin-top:8px">' + esc(marketLine()) + '</div>' +
    '<label class="chk" style="margin-top:8px"><input type="checkbox" id="sAuto" ' + (s.autoRefresh ? 'checked' : '') + '><span>Actualiser automatiquement (au plus une fois par jour, à l\'ouverture)</span></label>';
  const display = '<div class="row2"><div class="field"><label for="sBase">Devise d\'affichage des totaux</label><select id="sBase">' + CURRENCIES.map((c) => opt(c, c, c === baseCur())).join('') + '</select><span class="hint">Taux de change BCE ' + (fx.date ? '(du ' + esc(fmtDate(fx.date)) + ')' : '(indisponibles pour le moment)') + '.</span></div>' +
    '<div class="field"><label for="sMode">Revenus affichés par défaut</label><select id="sMode">' + opt('gross', 'Bruts (avant retenue)', incomeMode() === 'gross') + opt('net', 'Nets (après retenue, si connue)', incomeMode() === 'net') + '</select></div></div>' +
    '<label class="chk"><input type="checkbox" id="sLogos" ' + (s.autoLogos !== false ? 'checked' : '') + '><span>Afficher les logos des sociétés (services publics Parqet et FMP Images : seuls le ticker ou l\'ISIN sont transmis, jamais vos quantités)</span></label>' +
    '<label class="chk"><input type="checkbox" id="sTicker" ' + (s.tickerAuto ? 'checked' : '') + '><span>Défilement automatique du bandeau des prochains versements</span></label>' +
    '<div class="btn-row" style="margin-top:10px"><button class="btn" type="button" id="sAcc">Gérer les portefeuilles</button><button class="btn" type="button" id="sCols">Réinitialiser les colonnes des tableaux</button></div>';
  const backup = '<div class="btn-row"><button class="btn" type="button" id="sExport">' + icon('download') + 'Exporter une sauvegarde (JSON)</button><button class="btn" type="button" id="sImport">' + icon('upload') + 'Restaurer une sauvegarde</button>' +
    '<button class="btn" type="button" data-do="import">Importer un relevé de portefeuille</button><button class="btn" type="button" data-do="import-tx">Importer des transactions</button></div>' +
    '<div class="hint" style="margin-top:8px">Le fichier exporté n\'est pas chiffré (il contient vos positions et versements) : gardez-le en lieu sûr.<br>Stockage durable sur cet appareil : ' + (Vault.isPersisted() ? 'activé ✓' : 'non garanti — installez l\'app sur l\'écran d\'accueil') + '.</div>';
  const security = '<p class="muted" style="margin:0 0 10px">' + (Vault.hasPin() ? '🔒 Un code protège l\'ouverture de l\'application sur cet appareil (données locales chiffrées).' : '🔓 Aucun code de verrouillage sur cet appareil.') + '</p><button class="btn" type="button" id="sPin">Code de verrouillage…</button>';
  const notif = '<p class="muted" style="margin:0 0 10px" id="nStatus">' + esc(notifStatusText()) + '</p><div class="btn-row"><button class="btn" type="button" id="nEnable">Activer les rappels</button><button class="btn" type="button" id="nIcs">Ajouter à l\'agenda (.ics)</button></div>';
  host.innerHTML = pageHead('Paramètres', 'Compte, préférences d\'affichage et gestion des données') +
    sec('Compte utilisateur', 'Retrouvez vos données sur tous vos appareils.', account) + sec('Affichage', '', display) + sec('Données de marché', 'Source unique des historiques de dividendes (aucune clé API requise).', dataSrc) +
    sec('Sauvegarde et import', 'Vos données restent récupérables à tout moment.', backup) + sec('Sécurité de cet appareil', 'Facultatif : verrouille l\'ouverture de l\'app avec un code.', security) + sec('Rappels de versement', '', notif) +
    '<p class="hint" style="text-align:center;margin-top:18px">Suivi des dividendes · version 2 · ' + (Cloud.configured() ? 'synchronisation activée' : 'mode local') + '</p>';
  wireDo(host);
  const on = (id, fn) => { const e = $('#' + id, host); if (e) e.onclick = fn; };
  on('sIn', () => showAuth('in'));
  on('sSync', async () => { const ok = await syncNow(); renderSettings(host); toast(ok ? 'Synchronisé.' : 'Synchronisation impossible : ' + (view.sync.msg || 'voir l\'indicateur'), { error: !ok }); });
  on('sReset', async () => { try { await Cloud.resetPassword(u.email); toast('E-mail de réinitialisation envoyé à ' + u.email + '.', { ms: 6000 }); } catch (e) { toast(Cloud.friendly(e), { error: true }); } });
  on('sVerify', async () => { try { await Cloud.sendVerification(); toast('E-mail de vérification envoyé.'); } catch (e) { toast(Cloud.friendly(e), { error: true }); } });
  on('sOut', doLogout);
  on('sDelAcc', deleteAccountFlow);
  on('sTest', async () => { const url = $('#sRelay', host).value.trim().replace(/\/+$/, ''); if (!/^https:\/\//i.test(url)) { $('#sRelayMsg', host).textContent = 'Saisissez une adresse commençant par https://'; return; } state.settings.relayUrl = url; saveState(); $('#sRelayMsg', host).textContent = 'Test en cours…'; try { const a = await market.fetchAsset('AI.PA'); $('#sRelayMsg', host).textContent = '✓ Relais OK — ' + (a.name || 'AI.PA') + ' : ' + a.dividends.length + ' dividende(s) dans l\'historique.'; } catch (e) { $('#sRelayMsg', host).textContent = '✗ ' + e.message; } });
  $('#sRelay', host).onchange = (e) => { state.settings.relayUrl = e.target.value.trim().replace(/\/+$/, ''); saveState(); };
  on('sRefresh', () => refreshMarket(null));
  $('#sAuto', host).onchange = (e) => { state.settings.autoRefresh = e.target.checked; saveState(); };
  $('#sBase', host).onchange = (e) => { state.settings.baseCurrency = e.target.value; saveState(); renderPage(); };
  $('#sMode', host).onchange = (e) => { state.settings.incomeMode = e.target.value; saveState(); toast('Préférence enregistrée.'); };
  $('#sLogos', host).onchange = (e) => { state.settings.autoLogos = e.target.checked; saveState(); renderPage(); };
  $('#sTicker', host).onchange = (e) => { state.settings.tickerAuto = e.target.checked; saveState(); };
  on('sAcc', openAccountsModal);
  on('sCols', () => { state.settings.columns = {}; saveState(); toast('Colonnes réinitialisées.'); });
  on('sExport', exportData);
  on('sImport', async () => { const f = await pickFile('application/json,.json'); if (f) importBackup(f); });
  on('sPin', openSecurityModal);
  on('nEnable', async () => { await enableNotifications(); const st = $('#nStatus', host); if (st) st.textContent = notifStatusText(); });
  on('nIcs', downloadICS);
}

async function deleteAccountFlow() {
  const u = Cloud.user(); if (!u) return;
  const m = openModal('<h2>Supprimer mon compte ?</h2><div class="sub">Votre compte et <b>toutes vos données cloud</b> seront supprimés définitivement, ainsi que les données de cet appareil. Exportez d\'abord une sauvegarde si vous souhaitez les conserver.</div>' +
    fld('Mot de passe', '<input type="password" id="dPwd" autocomplete="current-password">', '', 'dPwd') + '<div id="dErr" class="notice err hide"></div>' +
    '<div class="modal-actions"><button class="btn" type="button" id="dExp">Exporter une sauvegarde</button><div class="btn-row"><button class="btn" type="button" data-close>Annuler</button><button class="btn danger" type="button" id="dGo">Supprimer définitivement</button></div></div>');
  $('#dExp', m).onclick = exportData;
  $('#dGo', m).onclick = async () => {
    const e = $('#dErr', m); e.classList.add('hide');
    try { await Cloud.deleteAccount($('#dPwd', m).value); }
    catch (ex) { e.textContent = Cloud.friendly(ex); e.classList.remove('hide'); return; }
    closeModal(); state = defaultState(); state.settings.relayUrl = CFG.relayUrl || ''; Vault.write(JSON.stringify(state)); localStorage.removeItem('dca_guest');
    toast('Compte supprimé.'); showAuth('in');
  };
}

/* Code de verrouillage de l'appareil (chiffrement local, voir vault.js) */
function openSecurityModal() {
  const pin = Vault.hasPin();
  const inp = (id, label) => fld(label, '<input type="password" id="' + id + '" inputmode="numeric" pattern="[0-9]*" maxlength="8" autocomplete="off">', '', id);
  const m = openModal('<h2>Code de verrouillage</h2><div class="sub">' + (pin ? '🔒 Actif : les données stockées sur cet appareil sont chiffrées.' : '🔓 Aucun code : l\'app s\'ouvre directement.') + '</div>' +
    (pin ? inp('cCur', 'Code actuel') : '') + inp('cNew', 'Nouveau code (4 à 8 chiffres, 6 recommandé)') + inp('cNew2', 'Confirmer le nouveau code') +
    '<p class="hint" style="color:var(--warn)">⚠ Le code ne peut pas être récupéré. Avec un compte connecté, vos données restent dans le cloud ; sinon exportez une sauvegarde.</p>' +
    '<div id="cErr" class="notice err hide"></div><div class="btn-row"><button class="btn primary" type="button" id="cSet">' + (pin ? 'Changer le code' : 'Activer le code') + '</button></div>' +
    (pin ? '<div class="sec">Retirer le code</div>' + inp('cRm', 'Code actuel') + '<button class="btn" type="button" id="cRemove">Retirer le code</button>' : '') +
    '<div class="modal-actions"><span></span><button class="btn" type="button" data-close>Fermer</button></div>');
  const err = (t) => { const e = $('#cErr', m); e.textContent = t; e.classList.toggle('hide', !t); };
  const valid = (v) => /^\d{4,8}$/.test(v);
  $('#cSet', m).onclick = async () => {
    const n1 = $('#cNew', m).value.trim(), n2 = $('#cNew2', m).value.trim();
    if (!valid(n1)) return err('Le code doit comporter 4 à 8 chiffres.');
    if (n1 !== n2) return err('Les deux codes ne correspondent pas.');
    if (pin) { try { await Vault.verifyPin($('#cCur', m).value.trim()); } catch (e) { return err('Code actuel incorrect.'); } }
    await Vault.setPin(n1, JSON.stringify(state)); snapshotForWorker(); toast(pin ? 'Code modifié.' : 'Code activé.'); closeModal(); renderPage();
  };
  if (pin) $('#cRemove', m).onclick = async () => {
    try { await Vault.verifyPin($('#cRm', m).value.trim()); } catch (e) { return err('Code actuel incorrect.'); }
    await Vault.removePin(JSON.stringify(state)); snapshotForWorker(); toast('Code retiré.'); closeModal(); renderPage();
  };
}
