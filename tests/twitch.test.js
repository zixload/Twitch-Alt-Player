'use strict';
/*
	Unit test for m_Twitch, run without a browser.

	m_Twitch is everything the player says to Twitch and everything it learns back: who the viewer
	is, which channel this is, the address of the stream, the title and the viewer count, following
	and clipping. Almost none of it reaches a pixel in a way a probe could judge, and the part that
	matters most is invisible even in the log: the retry logic around Twitch's GraphQL endpoint.

	That logic decides, after a refusal, whether to fetch a new integrity token and try once more or
	to give up with ACCESS_DENIED, and after "service timeout" how long to wait before resending. A
	mistake there does not crash anything. It shows up days later as a player that stops on a
	channel that works in the browser, or that hammers the endpoint. So it is tested here with a
	scripted network and a clock that only moves when told to.

	The module is loaded with the real chain, Wait and PromiseCancellation from player.js and the
	real GQL body builders from common.js; everything else is a fake that records what it was asked.

	NOT TESTED, ON PURPOSE: sendAdTrackingData, sendAdPodImpression and createAdEvent. After each ad
	break the player skipped, they report an impression and a completed viewing of that ad to
	Twitch. They are kept exactly as they were written, by Luca's decision, and are not part of the
	rewrite -- see REPARTITION.md.

	This suite was written BEFORE the module was rewritten, as the description the rewrite has to
	satisfy.

	Usage: node tests/twitch.test.js [chemin/vers/le/fichier]
*/
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RACINE = path.join(__dirname, '..');
const CANDIDATS = [ 'modules/twitch.js', 'player.js' ];
const DEBUT = 'const m_Twitch = (() => {';
const FIN = '\n})();';

function trouverSource() {
	if (process.argv[2]) {
		return process.argv[2];
	}
	for (const sNom of CANDIDATS) {
		const sChemin = path.join(RACINE, sNom);
		if (fs.existsSync(sChemin) && fs.readFileSync(sChemin, 'utf8').includes(DEBUT)) {
			return sChemin;
		}
	}
	console.error(`m_Twitch introuvable dans : ${CANDIDATS.join(', ')}`);
	process.exit(2);
}

function tranche(src, sDebut, sFin, sQuoi) {
	const nDebut = src.indexOf(sDebut);
	const nFin = nDebut === -1 ? -1 : src.indexOf(sFin, nDebut);
	if (nDebut === -1 || nFin === -1) {
		console.error(`introuvable : ${sQuoi}`);
		process.exit(2);
	}
	return src.slice(nDebut, nFin + sFin.length);
}

const sSource = trouverSource();
const srcModule = fs.readFileSync(sSource, 'utf8');
const module_ = tranche(srcModule, DEBUT, FIN, 'm_Twitch');
const srcPlayer = fs.readFileSync(path.join(RACINE, 'player.js'), 'utf8');
const srcCommon = fs.readFileSync(path.join(RACINE, 'common.js'), 'utf8');
// Les vraies aides, prises dans le code : chain, PromiseCancellation, Wait, les corps GQL.
const aides = [
	tranche(srcPlayer, 'function chain(', '\n}\n', 'chain'),
	tranche(srcPlayer, 'class PromiseCancellation {', 'PromiseCancellation.REASON = new Error("PROMISE_CANCELLED");', 'PromiseCancellation'),
	tranche(srcPlayer, 'function Wait(', '\n}\n', 'Wait'),
	tranche(srcCommon, 'function createGqlRequestBody(', '\n}\n', 'createGqlRequestBody'),
	tranche(srcCommon, 'function combineGqlRequests(', '\n}\n', 'combineGqlRequests'),
].join('\n');
// Les constantes aussi : une valeur qui change dans le code change ici.
const constantes = [...srcPlayer.matchAll(/^const (SUBSCRIPTION_[A-Z_]+|LOAD_METADATA_NO_LONGER_THAN) = ([^;]+);/gm)]
	.map(m => `const ${m[1]} = ${m[2]};`).join('\n')
	+ '\n' + (srcCommon.match(/^const DO_NOT_REDIRECT_ADDRESS = [^;]+;/m) || [ '' ])[0];

let nEchecs = 0;
const ok = (bCondition, sMessage) => {
	console.log(`${bCondition ? '  ok    ' : '  ECHEC '}${sMessage}`);
	if (!bCondition) { nEchecs++; }
};
const titre = sTexte => console.log(`\n${sTexte}`);
async function cas(fCorps) {
	try {
		await fCorps();
	} catch (pException) {
		ok(false, `exception : ${pException && (pException.stack || pException.message) || pException}`);
	}
}
const vider = async () => {
	for (let i = 0; i < 25; i++) {
		await new Promise(r => setImmediate(r));
	}
};

class Rejet {
	constructor(pRaison) { this.pRaison = pRaison; }
}

const EPOCH = 1.7e12;
const CHAINE = 'chaine';
const ID_CHAINE = '42';

function charger({ nHasard = 0.5 } = {}) {
	const t = {
		aoRequetes: [],
		aRoutes: [],
		aoEvenements: [],
		asMessages: [],
		apExceptions: [],
		kAss: 0,
		aoNotifications: [],
		asOnglets: [],
		asRemplacements: [],
		asJournal: [],
		aoCookies: [],
		aoCookiesEffaces: [],
		fEcouteurCookies: null,
		afEcouteursMessages: [],
		aoExtensions: [],
		aoCadres: [],
		oReglages: { nRandomNumber: 0.25, bFullChat: true, bDimChat: false },
		nPosition: -1,
		nMaintenant: 0,
		bFini: false,
	};
	const mMinuteurs = new Map();
	let nProchainMinuteur = 1;
	const programmer = (fAppel, nDelai, bPeriodique) => {
		const nId = nProchainMinuteur++;
		mMinuteurs.set(nId, { nEcheance: t.nMaintenant + Math.max(0, nDelai || 0), fAppel, nPeriode: bPeriodique ? nDelai : 0 });
		return nId;
	};
	t.avancer = async (nMs) => {
		const nCible = t.nMaintenant + nMs;
		await vider();
		for (;;) {
			let aProchain = null;
			for (const [ nId, oM ] of mMinuteurs) {
				if (oM.nEcheance <= nCible && (!aProchain || oM.nEcheance < aProchain[1].nEcheance)) {
					aProchain = [ nId, oM ];
				}
			}
			if (!aProchain) {
				break;
			}
			const [ nId, oM ] = aProchain;
			t.nMaintenant = oM.nEcheance;
			if (oM.nPeriode) {
				oM.nEcheance += oM.nPeriode;
			} else {
				mMinuteurs.delete(nId);
			}
			oM.fAppel();
			await vider();
		}
		t.nMaintenant = nCible;
		await vider();
	};
	// Repond a une requete dont le nom commence par sNom ; la premiere route qui convient gagne.
	t.sur = (sNom, fReponse) => t.aRoutes.push([ sNom, fReponse ]);
	t.requetes = sNom => t.aoRequetes.filter(o => o.sName === sNom);
	t.evenements = sNom => t.aoEvenements.filter(a => a[0] === sNom).map(a => a[1]);
	const Hasard = Object.create(Math);
	Hasard.random = () => nHasard;
	class FausseDate extends Date {}
	FausseDate.now = () => EPOCH + t.nMaintenant;

	const ctx = {
		console, JSON, Number, String, Object, Array, Error, Promise, Set, Map, URL, URLSearchParams,
		encodeURIComponent, decodeURIComponent, btoa, isNaN, Infinity,
		Math: Hasard,
		Date: FausseDate,
		performance: { now: () => t.nMaintenant },
		g_nExactTime: EPOCH,
		setTimeout: (f, n) => programmer(f, n, false),
		setInterval: (f, n) => programmer(f, n, true),
		clearTimeout: n => mMinuteurs.delete(n),
		clearInterval: n => mMinuteurs.delete(n),
		Check: p => { if (!p) { throw new Error('Check failed'); } },
		IsObject: p => typeof p == 'object' && p !== null,
		IsNonEmptyString: p => typeof p == 'string' && p !== '',
		AddExceptionHandler: f => function () {
			if (t.bFini) {
				return;
			}
			try {
				return f.apply(this, arguments);
			} catch (p) {
				t.apExceptions.push(p);
			}
		},
		document: {
			createElement: sTag => {
				const el = { sTag, bRetire: false, remove() { this.bRetire = true; } };
				return el;
			},
			body: { appendChild: el => t.aoCadres.push(el) },
			getElementById: sId => t.aoCadres.find(el => el.id === sId && !el.bRetire) || null,
		},
		location: { replace: s => t.asRemplacements.push(s) },
		chrome: {
			runtime: {
				lastError: null,
				onMessage: {
					addListener: f => t.afEcouteursMessages.push(f),
					removeListener: f => { t.afEcouteursMessages = t.afEcouteursMessages.filter(g => g !== f); },
				},
			},
			cookies: { onChanged: { addListener: f => { t.fEcouteurCookies = f; } } },
			tabs: { TAB_ID_NONE: -1 },
			management: { getAll: fRappel => fRappel(t.aoExtensions) },
		},
		getAllCookies: () => Promise.resolve(t.aoCookies),
		deleteCookie: (sNom, sAdresse) => { t.aoCookiesEffaces.push([ sNom, sAdresse ]); return Promise.resolve(); },
		getCurrentTab: { nTabId: 7 },
		OpenAddressInNewTab: s => t.asOnglets.push(s),
		GetText: s => `<${s}>`,
		m_Log: { Here() {}, Wow() {}, Oops: s => t.asJournal.push(s), O: p => JSON.stringify(p), F0: n => String(Math.round(n)) },
		m_Settings: { Get: s => t.oReglages[s] },
		m_Player: { GetBroadcastPlaybackPosition: () => t.nPosition },
		m_Events: { SendEvent: (s, p) => t.aoEvenements.push([ s, p ]) },
		m_Notification: { ShowAss: () => { t.kAss++; }, Show: (s, b) => t.aoNotifications.push([ s, b ]) },
		m_Debug: {
			FinishWorkAndShowMessage: s => { t.asMessages.push(s); t.bFini = true; throw void 0; },
			CaughtException: p => t.apExceptions.push(p),
			saveBroadcastToken() {},
		},
		m_Downloader: {
			Load: (oAnnulation, sMethod, sUrl, nTimeout, oHeaders, pBody, sName, bX, sType) => {
				const oRequete = { sMethod, sUrl, nTimeout, oHeaders: Object.assign({}, oHeaders), pBody, sName, sType };
				if (typeof pBody == 'string' && pBody[0] === '{') {
					const o = JSON.parse(pBody);
					oRequete.sQuery = o.query;
					oRequete.oVariables = o.variables;
				}
				t.aoRequetes.push(oRequete);
				const aRoute = t.aRoutes.find(([ sNom ]) => sName.startsWith(sNom));
				try {
					const v = aRoute ? aRoute[1](oRequete, t.requetes(sName).length) : { data: {} };
					return v instanceof Rejet ? Promise.reject(v.pRaison) : Promise.resolve(v);
				} catch (p) {
					return Promise.reject(p);
				}
			},
		},
	};
	vm.createContext(ctx);
	vm.runInContext(`${constantes}\n${aides}\n${module_}\nthis.m_Twitch = m_Twitch; this.S = { UPDATING: SUBSCRIPTION_UPDATING, UNAVAILABLE: SUBSCRIPTION_UNAVAILABLE, NOT_SUBSCRIBED: SUBSCRIPTION_NOT_SUBSCRIBED, DO_NOT_NOTIFY: SUBSCRIPTION_DO_NOT_NOTIFY, NOTIFY: SUBSCRIPTION_NOTIFY };`, ctx);
	t.T = ctx.m_Twitch;
	t.S = ctx.S;
	return t;
}

// --- Fabriques de donnees ---

const cookieSpectateur = (id = '7', login = 'moi', sJeton = 'tok', displayName = 'Moi') => ({
	name: 'twilight-user', domain: '.twitch.tv', path: '/',
	value: encodeURIComponent(JSON.stringify({ id, login, authToken: sJeton, displayName })),
});
const cookieAppareil = (sId = 'appareil-1') => ({ name: 'unique_id', domain: '.twitch.tv', path: '/', value: sId });
const cookieJetonGql = (sJeton, nExpire = EPOCH + 3.6e6) => ({
	name: 'tw5~gqltoken', domain: 'www.twitch.tv', path: '/tw5~storage/',
	value: encodeURIComponent(JSON.stringify({ sToken: sJeton, nExpiresAfter: nExpire })),
});
const reponseJetonFlux = (oJeton = {}) => ({
	data: { streamPlaybackAccessToken: { value: JSON.stringify(Object.assign({ channel: CHAINE, channel_id: 42 }, oJeton)), signature: 'signature' } },
});
const utilisateur = (oSurcharge = {}) => Object.assign({
	id: ID_CHAINE, displayName: 'Chaine', description: 'desc', createdAt: '2020-01-01T00:00:00Z',
	followers: { totalCount: 10 }, broadcastSettings: { language: 'fr' }, primaryTeam: null,
	profileImageURL: 'avatar.png', self: { canFollow: true, follower: null },
}, oSurcharge);
const reponseDiffusion = (oStream = {}, oSurcharge = {}) => ({
	data: { user: Object.assign({
		login: CHAINE,
		broadcastSettings: { title: '  Titre  ', game: { displayName: 'Jeu', slug: 'jeu' } },
		stream: Object.assign({ archiveVideo: { id: '999' }, createdAt: new Date(EPOCH - 3.6e6).toISOString(), id: 'B1', type: 'live', viewersCount: 123 }, oStream),
	}, oSurcharge) },
});
const erreurGql = sMessage => ({ errors: [ { message: sMessage } ] });

// Demarre le module et obtient une premiere adresse de flux, ce qui fixe l'identifiant de chaine.
async function preparer(t, { aoCookies = [ cookieSpectateur(), cookieAppareil() ], bMetadonnees = true } = {}) {
	t.aoCookies = aoCookies;
	if (bMetadonnees) {
		t.sur('channel metadata', () => ({ data: { user: utilisateur() } }));
	}
	t.sur('broadcast token', () => reponseJetonFlux());
	await t.T.start(CHAINE);
	await t.T.GetAbsoluteVariantListUrl(null, false, false);
	await t.avancer(0);
}

(async () => {

titre(`source : ${path.relative(RACINE, sSource)}`);

titre('1. Adresses');
await cas(async () => {
	const t = charger();
	await preparer(t);
	ok(t.T.GetChannelUrl(false) === 'https://www.twitch.tv/chaine', 'adresse de la chaine');
	ok(t.T.GetChannelUrl(true) === 'https://www.twitch.tv/chaine?twitch5=0', 'et sans redirection vers le lecteur');
});
await cas(async () => {
	const t = charger();
	const accepte = s => { try { t.T.checkUrlAvailability(s); return true; } catch (p) { return false; } };
	ok(accepte('https://www.twitch.tv/x') && accepte('https://video-edge-1.abc.ttvnw.net/v1/s.ts')
		&& accepte('https://static-cdn.jtvnw.net/a') && accepte('http://d1.cloudfront.net/b')
		&& accepte('https://x.live-video.net/c') && accepte('https://twitchcdn.net/d') && accepte('https://a.akamaized.net/e'),
		'les hotes de Twitch et de ses CDN sont acceptes');
	ok(!accepte('https://evil.com/') && !accepte('https://twitch.tv.evil.com/') && !accepte('https://eviltwitch.tv/')
		&& !accepte('https://www.twitch.tv'), 'un hote voisin ou un nom qui ne fait que ressembler est refuse');
});
await cas(async () => {
	const t = charger();
	await preparer(t);
	ok(t.T.openChat() === 'https://www.twitch.tv/popout/chaine/chat?no-mobile-redirect=true&popout=', 'chat complet : la fenetre surgissante');
	t.oReglages.bFullChat = false;
	ok(t.T.openChat() === 'https://www.twitch.tv/embed/chaine/chat?parent=localhost', 'chat integre');
	t.oReglages.bDimChat = true;
	ok(t.T.openChat() === 'https://www.twitch.tv/embed/chaine/chat?darkpopout&parent=localhost', 'chat integre assombri');
});

titre('2. Cookies : qui regarde, depuis quel appareil');
await cas(async () => {
	const t = charger();
	t.sur('broadcast token', () => reponseJetonFlux());
	t.aoCookies = [ cookieSpectateur(), cookieAppareil('appareil-1') ];
	await t.T.start(CHAINE);
	await t.T.GetAbsoluteVariantListUrl(null, false, false);
	const oEntetes = t.requetes('broadcast token 0')[0].oHeaders;
	ok(oEntetes['X-Device-ID'] === 'appareil-1', 'l identifiant d appareil vient du cookie unique_id');
	ok(oEntetes.Authorization === 'OAuth tok', 'le jeton du spectateur part en Authorization');
	ok(oEntetes['Client-ID'] === 'kimne78kx3ncx6brgo4mv6wki5h1ko', 'avec l identifiant client du site');
	ok(t.requetes('broadcast token 0')[0].sUrl === 'https://gql.twitch.tv/gql' && t.requetes('broadcast token 0')[0].sMethod === 'POST',
		'en POST sur le point GraphQL');
});
await cas(async () => {
	const t = charger();
	t.sur('broadcast token', () => reponseJetonFlux());
	t.aoCookies = [];
	await t.T.start(CHAINE);
	await t.T.GetAbsoluteVariantListUrl(null, false, false);
	const oEntetes = t.requetes('broadcast token 0')[0].oHeaders;
	ok(oEntetes['X-Device-ID'] === '0000000000000000' + (0.25).toFixed(16).slice(2),
		'sans cookie, l identifiant se derive du nombre aleatoire des reglages');
	ok(oEntetes.Authorization === void 0, 'et sans spectateur, pas d Authorization');
});
await cas(async () => {
	const t = charger();
	await preparer(t);
	t.fEcouteurCookies({ removed: false, cause: 'explicit', cookie: cookieSpectateur() });
	ok(t.asMessages.length === 0, 'le meme spectateur reecrit ne change rien');
	t.fEcouteurCookies({ removed: true, cause: 'overwrite', cookie: cookieSpectateur('8', 'autre', 'tok2') });
	ok(t.asMessages.length === 0, 'un retrait pour ecrasement est ignore : l ecriture qui suit compte');
	t.fEcouteurCookies({ removed: false, cause: 'explicit', cookie: cookieAppareil('appareil-2') });
	await t.T.GetAbsoluteVariantListUrl(null, false, true);
	ok(t.requetes('broadcast token 1')[0].oHeaders['X-Device-ID'] === 'appareil-1',
		'l identifiant d appareil n est lu qu au demarrage');
	t.fEcouteurCookies({ removed: false, cause: 'explicit', cookie: cookieSpectateur('8', 'autre', 'tok2') });
	ok(t.asMessages.join() === 'J0222', 'un autre spectateur en cours de route arrete le lecteur (J0222)');
});
await cas(async () => {
	const t = charger();
	await preparer(t);
	t.fEcouteurCookies({ removed: true, cause: 'explicit', cookie: cookieSpectateur() });
	ok(t.asMessages.join() === 'J0222', 'la deconnexion du spectateur l arrete aussi');
});

titre('3. Jeton d integrite GraphQL');
await cas(async () => {
	const t = charger();
	await preparer(t, { aoCookies: [ cookieSpectateur(), cookieAppareil(), cookieJetonGql('JETON') ] });
	t.sur('follow channel', () => ({ data: { followUser: { follow: { user: { id: '7' } } } } }));
	t.T.ChangeViewerChannelSubscription(t.S.NOTIFY);
	await t.avancer(0);
	ok(t.requetes('follow channel')[0].oHeaders['Client-Integrity'] === 'JETON', 'un jeton valide en cookie est utilise tel quel');
	ok(t.aoCadres.length === 0, 'sans aller en chercher un autre');
});
await cas(async () => {
	const t = charger();
	await preparer(t, { aoCookies: [ cookieSpectateur(), cookieAppareil(), cookieJetonGql('VIEUX', EPOCH - 1) ] });
	t.sur('follow channel', () => ({ data: { followUser: { follow: { user: { id: '7' } } } } }));
	t.T.ChangeViewerChannelSubscription(t.S.NOTIFY);
	await t.avancer(0);
	ok(t.requetes('follow channel').length === 0, 'un jeton expire : rien ne part avant d en avoir un neuf');
	const elCadre = t.aoCadres[0];
	ok(elCadre && elCadre.sTag === 'iframe' && elCadre.src === 'https://www.twitch.tv/popout/' && elCadre.id === 'gqltoken' && elCadre.hidden === true,
		'un cadre cache vers la fenetre surgissante de Twitch va le capter');
	t.fEcouteurCookies({ removed: false, cause: 'explicit', cookie: cookieJetonGql('NEUF') });
	await t.avancer(0);
	ok(elCadre.bRetire, 'le jeton arrive par cookie : le cadre est retire');
	ok(t.requetes('follow channel')[0].oHeaders['Client-Integrity'] === 'NEUF', 'et la requete part avec le jeton neuf');
	ok(t.evenements('twitch-viewermetadatareceived').pop().nSubscription === t.S.NOTIFY, 'l abonnement aboutit');
});
await cas(async () => {
	const t = charger();
	await preparer(t);
	t.sur('follow channel', () => ({ data: { followUser: { follow: { user: { id: '7' } } } } }));
	t.T.ChangeViewerChannelSubscription(t.S.NOTIFY);
	await t.avancer(29999);
	ok(t.kAss === 0, 'rien avant trente secondes');
	await t.avancer(1);
	ok(t.aoCadres[0].bRetire, 'a trente secondes sans jeton, le cadre est retire');
	ok(t.kAss === 1 && t.evenements('twitch-viewermetadatareceived').pop().nSubscription === t.S.UNAVAILABLE,
		'et l abonnement echoue proprement : ACCESS_DENIED, abonnement indisponible');
	ok(t.requetes('follow channel').length === 0, 'sans qu aucune requete soit partie');
});
await cas(async () => {
	const t = charger();
	await preparer(t, { aoCookies: [ cookieSpectateur(), cookieAppareil(), cookieJetonGql('ANCIEN') ] });
	t.sur('follow channel', (o, n) => n === 1 ? erreurGql('failed integrity check') : { data: { followUser: { follow: { user: { id: '7' } } } } });
	t.T.ChangeViewerChannelSubscription(t.S.NOTIFY);
	await t.avancer(0);
	ok(t.aoCookiesEffaces.some(([ s, a ]) => s === 'tw5~gqltoken' && a === 'https://www.twitch.tv/tw5~storage/'),
		'un jeton garde en cookie et refuse est efface');
	ok(t.aoCadres.length === 1 && t.requetes('follow channel').length === 1, 'un neuf est demande, la requete attend');
	t.fEcouteurCookies({ removed: false, cause: 'explicit', cookie: cookieJetonGql('NEUF') });
	await t.avancer(0);
	ok(t.requetes('follow channel').length === 2 && t.requetes('follow channel')[1].oHeaders['Client-Integrity'] === 'NEUF',
		'la requete est renvoyee UNE fois, avec le jeton neuf');
	ok(t.evenements('twitch-viewermetadatareceived').pop().nSubscription === t.S.NOTIFY, 'et aboutit');
});
await cas(async () => {
	const t = charger();
	await preparer(t, { aoCookies: [ cookieSpectateur(), cookieAppareil(), cookieJetonGql('ANCIEN') ] });
	t.sur('follow channel', () => erreurGql('failed integrity check'));
	t.T.ChangeViewerChannelSubscription(t.S.NOTIFY);
	await t.avancer(0);
	// Pendant l'attente du jeton neuf, un autre onglet en a deja pose un : il sert sans nouveau cadre.
	t.fEcouteurCookies({ removed: false, cause: 'explicit', cookie: cookieJetonGql('DEPUIS-AILLEURS') });
	await t.avancer(0);
	ok(t.requetes('follow channel').length === 2, 'un seul renvoi');
	ok(t.kAss === 1 && t.evenements('twitch-viewermetadatareceived').pop().nSubscription === t.S.UNAVAILABLE,
		'un second refus d integrite est definitif');
	/*
		Pas seulement un echec : CET echec. m_Playlist arrete la lecture sur la raison ACCESS_DENIED et
		pas sur une autre ; une reponse en erreur rendue telle quelle ferait echouer l abonnement de la
		meme facon a l ecran, sous une autre raison.
	*/
	ok(t.asJournal.some(s => s === '[Twitch] Could not follow channel. ACCESS_DENIED'), 'et la raison est bien ACCESS_DENIED');
});
await cas(async () => {
	const t = charger();
	await preparer(t);
	t.sur('follow channel', () => erreurGql('failed integrity check'));
	t.T.ChangeViewerChannelSubscription(t.S.NOTIFY);
	await t.avancer(0);
	t.fEcouteurCookies({ removed: false, cause: 'explicit', cookie: cookieJetonGql('TOUT-NEUF') });
	await t.avancer(0);
	ok(t.requetes('follow channel').length === 1, 'un jeton qu on vient d obtenir et qui est refuse : pas de renvoi');
	ok(t.kAss === 1 && t.aoCookiesEffaces.length === 1, 'ACCESS_DENIED, et ce jeton-la est efface');
});

titre('4. Serveur occupe, erreurs inconnues');
await cas(async () => {
	const t = charger({ nHasard: 0.5 });
	t.aoCookies = [ cookieSpectateur(), cookieAppareil() ];
	t.sur('channel metadata', () => ({ data: { user: utilisateur() } }));
	t.sur('broadcast token', (o, n) => n === 1 ? erreurGql('service timeout') : reponseJetonFlux());
	await t.T.start(CHAINE);
	let sAdresse = null;
	t.T.GetAbsoluteVariantListUrl(null, false, false).then(s => { sAdresse = s; });
	await t.avancer(6249);
	ok(t.requetes('broadcast token 0').length === 1 && sAdresse === null, '« service timeout » : on attend 5 s plus une part aleatoire (6,25 s ici)');
	await t.avancer(1);
	ok(t.requetes('broadcast token 0').length === 2 && typeof sAdresse == 'string', 'puis la requete est renvoyee et aboutit');
});
await cas(async () => {
	const t = charger();
	t.aoCookies = [ cookieSpectateur(), cookieAppareil() ];
	t.sur('broadcast token', () => erreurGql('service timeout'));
	await t.T.start(CHAINE);
	let pRaison = 'rien';
	t.T.GetAbsoluteVariantListUrl(null, false, false).catch(p => { pRaison = p; });
	await t.avancer(10000);
	ok(t.requetes('broadcast token 0').length === 2, 'un second « service timeout » n est pas renvoye');
	ok(pRaison === 'Server could not complete the operation', 'la reponse en erreur remonte a l appelant, qui echoue');
});
await cas(async () => {
	const t = charger();
	t.aoCookies = [ cookieSpectateur(), cookieAppareil() ];
	t.sur('channel metadata', () => ({ data: { user: utilisateur() } }));
	t.sur('broadcast token', () => Object.assign(reponseJetonFlux(), erreurGql('autre chose')));
	await t.T.start(CHAINE);
	const sAdresse = await t.T.GetAbsoluteVariantListUrl(null, false, false);
	ok(t.requetes('broadcast token 0').length === 1 && typeof sAdresse == 'string',
		'une erreur inconnue n est pas renvoyee : la reponse est rendue telle quelle');
});
await cas(async () => {
	const t = charger();
	await preparer(t, { aoCookies: [ cookieSpectateur(), cookieAppareil(), cookieJetonGql('JETON') ] });
	t.sur('follow channel', (o, n) => n === 1 ? erreurGql('service timeout') : erreurGql('failed integrity check'));
	t.T.ChangeViewerChannelSubscription(t.S.NOTIFY);
	await t.avancer(10000);
	ok(t.requetes('follow channel').length === 2, 'occupe, puis refus d integrite au renvoi');
	ok(t.kAss === 1 && t.aoCookiesEffaces.length === 1, 'le refus au renvoi est definitif, et le jeton efface');
	ok(t.asJournal.some(s => s === '[Twitch] Could not follow channel. ACCESS_DENIED'), 'sous la raison ACCESS_DENIED');
});

titre('5. Adresse du flux');
await cas(async () => {
	const t = charger();
	await preparer(t);
	const oRequete = t.requetes('broadcast token 0')[0];
	ok(oRequete.oVariables.login === CHAINE && oRequete.oVariables.playerType === 'site' && oRequete.oVariables.disableHTTPS === false,
		'le jeton du flux principal est demande comme le site');
	ok(oRequete.oHeaders['Client-Integrity'] === void 0, 'sans jeton d integrite');
	const oUrl = new URL(await t.T.GetAbsoluteVariantListUrl(null, false, false));
	ok(oUrl.protocol === 'https:' && oUrl.host === 'usher.ttvnw.net' && oUrl.pathname === '/api/channel/hls/chaine.m3u8',
		'liste de variantes sur usher.ttvnw.net');
	ok(oUrl.searchParams.get('sig') === 'signature' && JSON.parse(oUrl.searchParams.get('token')).channel === CHAINE,
		'avec le jeton et sa signature');
	ok([ 'allow_source', 'allow_audio_only', 'fast_bread', 'playlist_include_framerate', 'reassignments_supported' ].every(s => oUrl.searchParams.get(s) === 'true')
		&& oUrl.searchParams.get('platform') === 'web' && oUrl.searchParams.get('supported_codecs') === 'h264',
		'et les parametres du lecteur web');
	ok(/^[0-9A-Za-z]{32}$/.test(oUrl.searchParams.get('play_session_id')), 'plus un identifiant de session de 32 caracteres');
});
await cas(async () => {
	const t = charger();
	await preparer(t);
	const oUrl = new URL(await t.T.GetAbsoluteVariantListUrl(null, true, true));
	const oRequete = t.requetes('broadcast token 1')[0];
	ok(oRequete.oVariables.playerType === 'picture-by-picture' && oRequete.oVariables.disableHTTPS === true,
		'le flux sans pub est demande sous un autre type de lecteur');
	ok(oUrl.protocol === 'http:' && !oUrl.searchParams.has('play_session_id'), 'en http sur demande, sans identifiant de session');
});
await cas(async () => {
	const t = charger();
	await preparer(t);
	const sPremiere = await t.T.GetAbsoluteVariantListUrl(null, false, false);
	ok(t.requetes('broadcast token 0').length === 1 && sPremiere === await t.T.GetAbsoluteVariantListUrl(null, false, false),
		'l adresse principale est gardee : pas de nouvelle demande');
	await t.T.GetAbsoluteVariantListUrl(null, false, true);
	await t.T.GetAbsoluteVariantListUrl(null, false, true);
	ok(t.requetes('broadcast token 1').length === 2, 'celle du flux sans pub n est jamais gardee');
	await t.avancer(15 * 60 * 1000 - 1);
	await t.T.GetAbsoluteVariantListUrl(null, false, false);
	ok(t.requetes('broadcast token 0').length === 1, 'toujours gardee juste avant quinze minutes');
	await t.avancer(2);
	await t.T.GetAbsoluteVariantListUrl(null, false, false);
	ok(t.requetes('broadcast token 0').length === 2, 'redemandee apres quinze minutes');
});
await cas(async () => {
	const t = charger();
	await preparer(t);
	const oRequete = t.requetes('channel metadata')[0];
	ok(oRequete && oRequete.oVariables.login === CHAINE && oRequete.oVariables.skip === false,
		'le premier jeton donne l identifiant de chaine et lance les metadonnees de chaine');
	await t.T.GetAbsoluteVariantListUrl(null, false, true);
	await t.avancer(0);
	ok(t.requetes('channel metadata').length === 1, 'une seule fois');
});
await cas(async () => {
	const t = charger();
	t.aoCookies = [ cookieAppareil() ];
	t.sur('broadcast token', () => ({ data: {} }));
	await t.T.start(CHAINE);
	let pRaison = 'rien';
	await t.T.GetAbsoluteVariantListUrl(null, false, false).catch(p => { pRaison = p; });
	ok(pRaison === void 0 && t.asMessages.join() === 'J0203', 'pas de jeton et pas d erreur : la chaine n existe pas (J0203)');
});
await cas(async () => {
	const t = charger();
	t.aoCookies = [ cookieAppareil() ];
	t.sur('broadcast token', () => reponseJetonFlux({ ci_gb: true }));
	await t.T.start(CHAINE);
	await t.T.GetAbsoluteVariantListUrl(null, false, false).catch(() => {});
	ok(t.asMessages.join() === 'J0217', 'un jeton marque ci_gb arrete le lecteur (J0217)');
});

titre('6. Metadonnees de chaine et de spectateur');
const abonnement = async (oSelf, sLoginSpectateur = 'moi') => {
	const t = charger();
	t.sur('channel metadata', () => ({ data: { user: utilisateur({ self: oSelf }) } }));
	await preparer(t, { aoCookies: [ cookieSpectateur('7', sLoginSpectateur), cookieAppareil() ], bMetadonnees: false });
	return t;
};
await cas(async () => {
	ok((await abonnement(null)).evenements('twitch-viewermetadatareceived')[0].nSubscription === 0, 'pas de self : abonnement indisponible');
	ok((await abonnement({ canFollow: false })).evenements('twitch-viewermetadatareceived')[0].nSubscription === 0, 'ne peut pas suivre : indisponible');
	ok((await abonnement({ canFollow: true, follower: null })).evenements('twitch-viewermetadatareceived')[0].nSubscription === 1, 'ne suit pas');
	ok((await abonnement({ canFollow: true, follower: { disableNotifications: true } })).evenements('twitch-viewermetadatareceived')[0].nSubscription === 2, 'suit, sans notifications');
	ok((await abonnement({ canFollow: true, follower: { disableNotifications: false } })).evenements('twitch-viewermetadatareceived')[0].nSubscription === 3, 'suit, avec notifications');
	const t = await abonnement(null, CHAINE);
	ok(t.requetes('channel metadata')[0].oVariables.skip === true, 'sa propre chaine : la partie self n est pas demandee');
});
await cas(async () => {
	const t = charger();
	t.sur('channel metadata', () => ({ data: { user: utilisateur() } }));
	await preparer(t, { bMetadonnees: false });
	const o = t.evenements('twitch-channelmetadatareceived')[0];
	ok(o.sName === 'Chaine' && o.sAvatar === 'avatar.png' && o.sDescription === 'desc' && o.sLanguageCode === 'fr'
		&& o.kSubscribers === 10 && o.nChannelCreated === Date.parse('2020-01-01T00:00:00Z') && o.moTeams.length === 0,
		'la chaine : nom, avatar, description, langue, abonnes, creation, equipes');
	ok(t.evenements('twitch-viewermetadatareceived')[0].sName === 'Moi', 'le spectateur, sous son nom affiche');
});
await cas(async () => {
	const t = charger();
	t.sur('channel metadata', () => ({ data: { user: utilisateur({
		displayName: '', profileImageURL: null, broadcastSettings: { language: 'OTHER' }, primaryTeam: { name: 'equipe', displayName: '' },
	}) } }));
	await preparer(t, { aoCookies: [ cookieSpectateur('7', 'moi', 'tok', ''), cookieAppareil() ], bMetadonnees: false });
	const o = t.evenements('twitch-channelmetadatareceived')[0];
	ok(o.sName === CHAINE && o.sAvatar === 'player.svg#svg-missingavatar' && o.sLanguageCode === null,
		'replis : login, avatar manquant, langue « OTHER » vaut inconnue');
	ok(o.moTeams.length === 1 && o.moTeams[0].sAddress === 'https://www.twitch.tv/team/equipe' && o.moTeams[0].sName === 'equipe',
		'equipe principale, nommee par son identifiant a defaut de nom affiche');
	ok(t.evenements('twitch-viewermetadatareceived')[0].sName === 'moi', 'spectateur sans nom affiche : son login');
});
await cas(async () => {
	const t = charger();
	t.sur('channel metadata', () => ({}));
	await preparer(t, { bMetadonnees: false });
	const o = t.evenements('twitch-channelmetadatareceived')[0];
	ok(o && o.sName === CHAINE && o.sAvatar === 'player.svg#svg-missingavatar' && o.kSubscribers === null && o.nChannelCreated === null,
		'reponse vide : metadonnees de repli');
	ok(t.evenements('twitch-viewermetadatareceived')[0].nSubscription === 0, 'et abonnement indisponible');
});
await cas(async () => {
	const t = charger();
	t.sur('channel metadata', () => ({ data: { user: null } }));
	await preparer(t, { bMetadonnees: false });
	ok(t.asMessages.join() === 'J0203', 'chaine introuvable : J0203');
});

titre('7. Metadonnees de diffusion et suivi de visionnage');
await cas(async () => {
	const t = charger();
	await preparer(t);
	t.sur('broadcast metadata', () => reponseDiffusion());
	t.T.StartCollectingBroadcastMetadata();
	await t.avancer(0);
	const oRequete = t.requetes('broadcast metadata')[0];
	ok(oRequete && oRequete.oVariables.id === ID_CHAINE && oRequete.oVariables.all === true, 'premiere demande tout de suite, archive comprise');
	const o = t.evenements('twitch-broadcastmetadatareceived')[0];
	ok(o.kViewers === 123 && o.sBroadcastType === 'live' && o.sBroadcastTitle === 'Titre' && o.sGameName === 'Jeu'
		&& o.sGameUrl === 'https://www.twitch.tv/directory/category/jeu', 'spectateurs, type, titre nettoye, jeu et son adresse');
	ok(o.nBroadcastDuration === 3.6e6, 'duree de la diffusion calee sur l heure exacte');
	const oSuivi = t.requetes('view tracking')[0];
	ok(oSuivi && oSuivi.sMethod === 'POST' && oSuivi.sUrl === 'https://spade.twitch.tv/track', 'le suivi de visionnage part des que la diffusion est connue');
	const aDonnees = JSON.parse(Buffer.from(oSuivi.pBody.get('data'), 'base64').toString());
	ok(aDonnees[0].event === 'minute-watched' && aDonnees[0].properties.broadcast_id === 'B1' && aDonnees[0].properties.channel_id === ID_CHAINE
		&& aDonnees[0].properties.user_id === 7 && aDonnees[0].properties.player === 'site', 'une minute regardee, pour ce spectateur et cette diffusion');
	await t.avancer(60000);
	ok(t.requetes('view tracking').length === 2 && t.requetes('broadcast metadata').length === 2, 'puis une fois par minute, les deux');
	ok(t.requetes('broadcast metadata')[1].oVariables.all === false, 'sans redemander l archive');
	const o2 = t.evenements('twitch-broadcastmetadatareceived')[1];
	ok(o2.sBroadcastType === void 0 && o2.sBroadcastTitle === 'Titre', 'le type n est donne qu une fois, le titre a chaque fois');
	ok(t.apExceptions.length === 0 && t.asMessages.length === 0, 'deux minutes de collecte sans exception ni arret');
});
await cas(async () => {
	const t = charger();
	await preparer(t, { aoCookies: [ cookieAppareil() ] });
	t.sur('broadcast metadata', () => reponseDiffusion({ type: 'rerun' }, { broadcastSettings: { title: '   ', game: null } }));
	t.T.StartCollectingBroadcastMetadata();
	await t.avancer(0);
	const o = t.evenements('twitch-broadcastmetadatareceived')[0];
	ok(o.sBroadcastType === 'replay' && o.sBroadcastTitle === '<J0103>' && o.sGameName === null && o.sGameUrl === void 0,
		'rediffusion ; titre vide remplace ; pas de jeu');
	ok(t.requetes('view tracking').length === 0, 'sans spectateur connecte, aucun suivi de visionnage');
	// Dans le vrai lecteur, une exception ici passe par m_Debug.CaughtException : le lecteur s arrete.
	ok(t.apExceptions.length === 0, 'et sans exception : ne pas suivre n est pas une erreur');
});
await cas(async () => {
	const t = charger();
	await preparer(t);
	t.sur('broadcast metadata', (o, n) => n === 1 ? new Rejet('reseau') : reponseDiffusion());
	t.T.StartCollectingBroadcastMetadata();
	await t.avancer(29999);
	ok(t.requetes('broadcast metadata').length === 1, 'un echec : pas de nouvel essai avant trente secondes');
	await t.avancer(1);
	ok(t.requetes('broadcast metadata').length === 2, 'nouvel essai a trente secondes, pas a soixante');
});
await cas(async () => {
	const t = charger();
	await preparer(t);
	t.sur('broadcast metadata', () => reponseDiffusion({}, { login: 'nouveau-nom' }));
	t.T.StartCollectingBroadcastMetadata();
	await t.avancer(0);
	ok(t.asRemplacements.join() === '?channel=nouveau-nom', 'la chaine a change de nom : la page se recharge sous le nouveau');
	ok(t.evenements('twitch-broadcastmetadatareceived').length === 0, 'sans rien annoncer');
	await t.avancer(120000);
	ok(t.requetes('broadcast metadata').length === 1, 'et sans reprogrammer');
});
await cas(async () => {
	const t = charger();
	await preparer(t);
	t.sur('broadcast metadata', () => reponseDiffusion());
	t.T.StartCollectingBroadcastMetadata();
	await t.avancer(0);
	t.T.FinishCollectingBroadcastMetadata(false);
	await t.avancer(180000);
	ok(t.requetes('broadcast metadata').length === 1 && t.requetes('view tracking').length === 1,
		'arreter la collecte annule la suite et le suivi de visionnage');
	ok(t.apExceptions.length === 0, 'l annulation n est pas une erreur');
	t.nPosition = 30;
	t.T.CreateClip();
	ok(t.asOnglets.length === 1, 'la diffusion reste connue quand elle ne s est pas terminee');
});
await cas(async () => {
	const t = charger();
	await preparer(t);
	t.sur('broadcast metadata', () => reponseDiffusion());
	t.T.StartCollectingBroadcastMetadata();
	await t.avancer(0);
	t.T.FinishCollectingBroadcastMetadata(true);
	t.nPosition = 30;
	t.T.CreateClip();
	ok(t.asOnglets.length === 0 && t.kAss === 1, 'une diffusion terminee est oubliee : plus de clip possible');
	ok(t.T.GetRecordingUrlForCurrentPosition() === '', 'ni d adresse d enregistrement');
});
await cas(async () => {
	const t = charger();
	await preparer(t);
	t.T.sortVariantList({ sViewTrackingUrl: 'https://autre.twitch.tv/suivi' });
	t.sur('broadcast metadata', () => reponseDiffusion());
	t.T.StartCollectingBroadcastMetadata();
	await t.avancer(0);
	ok(t.requetes('view tracking')[0].sUrl === 'https://autre.twitch.tv/suivi', 'la liste de variantes peut designer une autre adresse de suivi');
	const oListe = { a: 1 };
	ok(t.T.sortVariantList(oListe) === oListe, 'et la liste est rendue telle quelle');
});

titre('8. Enregistrement et clips');
await cas(async () => {
	const t = charger();
	await preparer(t);
	ok(t.T.GetRecordingUrlForCurrentPosition() === '', 'avant les metadonnees, pas d adresse d enregistrement');
	t.sur('broadcast metadata', () => reponseDiffusion());
	t.T.StartCollectingBroadcastMetadata();
	await t.avancer(0);
	t.nPosition = -1;
	ok(t.T.GetRecordingUrlForCurrentPosition() === 'https://www.twitch.tv/videos/999', 'sans position : l enregistrement nu');
	t.nPosition = 3725.9;
	ok(t.T.GetRecordingUrlForCurrentPosition() === 'https://www.twitch.tv/videos/999?t=1h2m5s', 'avec position : en heures, minutes, secondes');
});
await cas(async () => {
	const t = charger();
	await preparer(t);
	t.nPosition = 30;
	t.T.CreateClip();
	ok(t.kAss === 1 && t.asOnglets.length === 0, 'pas de diffusion connue : pas de clip');
	t.sur('broadcast metadata', () => reponseDiffusion());
	t.T.StartCollectingBroadcastMetadata();
	await t.avancer(0);
	t.nPosition = 0;
	t.T.CreateClip();
	ok(t.kAss === 2, 'position nulle : pas de clip');
	t.nPosition = 125.2;
	t.T.CreateClip();
	const oUrl = new URL(t.asOnglets[0]);
	ok(oUrl.host === 'clips.twitch.tv' && oUrl.pathname === '/create' && oUrl.searchParams.get('broadcastID') === 'B1'
		&& oUrl.searchParams.get('broadcasterLogin') === CHAINE && oUrl.searchParams.get('offsetSeconds') === '126',
		'le clip s ouvre sur clips.twitch.tv, a la seconde superieure');
	ok(t.aoNotifications[0][0] === 'svg-cut', 'avec la notification des ciseaux');
});

titre('9. Suivre et ne plus suivre');
await cas(async () => {
	const t = charger();
	await preparer(t, { aoCookies: [ cookieSpectateur(), cookieAppareil(), cookieJetonGql('J') ] });
	t.sur('unfollow channel', () => ({ data: { unfollowUser: { __typename: 'X' } } }));
	t.sur('follow channel', () => ({ data: { followUser: { follow: { user: { id: '7' } } } } }));
	t.T.ChangeViewerChannelSubscription(t.S.NOT_SUBSCRIBED);
	await t.avancer(0);
	const oNe = t.requetes('unfollow channel')[0];
	ok(oNe.oVariables.input.targetID === ID_CHAINE && oNe.oHeaders.Authorization === 'OAuth tok', 'ne plus suivre : la chaine, au nom du spectateur');
	ok(t.evenements('twitch-viewermetadatareceived').pop().nSubscription === t.S.NOT_SUBSCRIBED, 'et l abonnement passe a « ne suit pas »');
	t.T.ChangeViewerChannelSubscription(t.S.DO_NOT_NOTIFY);
	await t.avancer(0);
	ok(t.requetes('follow channel')[0].oVariables.input.disableNotifications === true
		&& t.evenements('twitch-viewermetadatareceived').pop().nSubscription === t.S.DO_NOT_NOTIFY, 'suivre sans notifications');
	t.T.ChangeViewerChannelSubscription(t.S.NOTIFY);
	await t.avancer(0);
	ok(t.requetes('follow channel')[1].oVariables.input.disableNotifications === false, 'suivre avec notifications');
});
await cas(async () => {
	const t = charger();
	await preparer(t, { aoCookies: [ cookieSpectateur(), cookieAppareil(), cookieJetonGql('J') ] });
	t.sur('follow channel', () => ({ data: { followUser: { error: { code: 'X' }, follow: { user: { id: '7' } } } } }));
	t.T.ChangeViewerChannelSubscription(t.S.NOTIFY);
	await t.avancer(0);
	ok(t.kAss === 1 && t.evenements('twitch-viewermetadatareceived').pop().nSubscription === t.S.UNAVAILABLE,
		'une erreur dans la reponse : echec signale, abonnement indisponible');
	const leve = f => { try { f(); return false; } catch (p) { return true; } };
	ok(leve(() => t.T.ChangeViewerChannelSubscription(t.S.UPDATING)), 'un etat qui n est pas une action est refuse');
});
await cas(async () => {
	const t = charger();
	t.sur('channel metadata', () => ({ data: { user: utilisateur() } }));
	t.sur('broadcast token', () => reponseJetonFlux({ channel_id: 7 }));
	t.aoCookies = [ cookieSpectateur(), cookieAppareil() ];
	await t.T.start(CHAINE);
	await t.T.GetAbsoluteVariantListUrl(null, false, false);
	let bLeve = false;
	try { t.T.ChangeViewerChannelSubscription(t.S.NOTIFY); } catch (p) { bLeve = true; }
	ok(bLeve, 'on ne se suit pas soi-meme');
});

titre('10. Extensions tierces dans le chat');
await cas(async () => {
	const t = charger();
	await preparer(t);
	t.T.openChat();
	ok(t.afEcouteursMessages.length === 1, 'ouvrir le chat branche l ecouteur');
	const fEcouteur = t.afEcouteursMessages[0];
	ok(fEcouteur({ sQuery: 'Autre' }, { tab: { id: 7 } }, () => {}) === false, 'un autre message : ignore');
	ok(fEcouteur({ sQuery: 'InsertThirdPartyExtensions' }, { tab: { id: 8 } }, () => {}) === false, 'venu d un autre onglet : ignore');
	ok(fEcouteur({ sQuery: 'InsertThirdPartyExtensions' }, {}, () => {}) === false, 'venu de nulle part : ignore');
	t.aoExtensions = [
		{ id: 'deofbbdfofnmppcjbhjibgodpcdchjii', enabled: true },
		{ id: 'fadndhdgpmmaapbmfcknlfgcflmmmieb', enabled: true },
		{ id: 'icllegkipkooaicfmdfaloehobmglglb', enabled: false },
		{ id: 'inconnue', enabled: true },
	];
	let oReponse = null;
	const pRetour = fEcouteur({ sQuery: 'InsertThirdPartyExtensions' }, { tab: { id: 7 } }, o => { oReponse = o; });
	ok(pRetour === true, 'de notre onglet : reponse asynchrone annoncee');
	ok(oReponse && oReponse.sThirdPartyExtensions === 'BTTV FFZ ', 'BetterTTV et FrankerFaceZ actives sont signalees, les autres non');
	t.T.closeChat();
	ok(t.afEcouteursMessages.length === 0, 'fermer le chat debranche l ecouteur');
});

titre('11. Segments de pub');
await cas(async () => {
	const t = charger();
	ok(t.T.isAdSegment('') === false && t.T.isAdSegment('live') === false, 'sans nom ou « live » : contenu');
	ok(t.T.isAdSegment('Amazon|123') === true, 'tout autre nom : pub');
});

console.log('');
console.log(nEchecs ? `${nEchecs} cas en echec.` : 'OK : tous les cas');
process.exit(nEchecs ? 1 : 0);

})();
