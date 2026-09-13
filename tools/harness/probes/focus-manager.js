/*
	L'etat de la page : visible ou non, au premier plan ou non.

	Ecrite depuis la description du module, avant sa reecriture.

	Le module lit deux choses du navigateur, document.hidden et document.hasFocus(), et previent
	quand l'une d'elles change vraiment. Une sonde ne peut ni cacher la fenetre ni la defocaliser
	depuis la page : elle remplace donc ces deux entrees le temps de l'essai, dispatche les memes
	evenements que le navigateur, et rend tout a la fin.

	Ce qui compte et ne se lit pas dans une signature :
	  - actif implique visible. Une page cachee n'est jamais active, meme si elle garde le focus ;
	  - un evenement qui ne change rien n'envoie rien. Les evenements de focus arrivent par paquets,
	    et chaque envoi reveille le lecteur entier ;
	  - l'envoi n'est pas synchrone. Au moment ou blur arrive, document.hasFocus() ment encore :
	    le module laisse passer une tache avant de mesurer.
*/
(async () => {
	const verdicts = [];
	const dire = (nom, ok, detail) => verdicts.push([nom, !!ok, detail === undefined ? '' : detail]);
	const dormir = (ms) => new Promise((f) => setTimeout(f, ms));

	// Les deux entrees du module, remplacees.
	const fHasFocusOrigine = document.hasFocus;
	let bFocus = fHasFocusOrigine.call(document);
	let bHidden = document.hidden;
	document.hasFocus = () => bFocus;
	Object.defineProperty(document, 'hidden', { configurable: true, get: () => bHidden });

	const recus = [];
	m_Events.AddHandler('focus-statechanged', (oState) => recus.push(oState));
	const dernier = () => recus[recus.length - 1];

	// Le navigateur signale, le module mesure une tache plus tard.
	const signaler = async (sType, elCible) => {
		const nAvant = recus.length;
		elCible.dispatchEvent(new Event(sType));
		const bTouteSuite = recus.length > nAvant;
		await dormir(120);
		return { synchrone: bTouteSuite, nouveaux: recus.length - nAvant };
	};

	const etat = () => m_FocusManager.GetState();
	dire('l\'etat de depart suit le document',
		etat().bShown === !bHidden && etat().bActive === (!bHidden && bFocus),
		JSON.stringify(etat()));

	// Partir d'une base connue : visible et au premier plan.
	bHidden = false;
	bFocus = true;
	await signaler('focus', window);
	dire('base connue : visible et actif', etat().bShown === true && etat().bActive === true, JSON.stringify(etat()));

	// Un evenement qui ne change rien n'envoie rien.
	const rien = await signaler('focus', window);
	dire('un evenement sans changement n\'envoie rien', rien.nouveaux === 0, String(rien.nouveaux));

	// Perte du premier plan.
	bFocus = false;
	const perte = await signaler('blur', window);
	dire('la perte du premier plan est annoncee', perte.nouveaux === 1, String(perte.nouveaux));
	dire('l\'envoi n\'est pas synchrone', !perte.synchrone);
	dire('l\'etat annonce est inactif mais visible',
		dernier() && dernier().bShown === true && dernier().bActive === false, JSON.stringify(dernier()));
	dire('GetState dit la meme chose', etat().bActive === false && etat().bShown === true, JSON.stringify(etat()));

	// Le meme evenement une seconde fois ne fait rien.
	const doublon = await signaler('blur', window);
	dire('le meme evenement deux fois n\'envoie qu\'une fois', doublon.nouveaux === 0, String(doublon.nouveaux));

	// Retour du premier plan.
	bFocus = true;
	const retour = await signaler('focus', window);
	dire('le retour au premier plan est annonce', retour.nouveaux === 1 && etat().bActive === true, JSON.stringify(etat()));

	// Page cachee : actif implique visible, meme si le focus reste.
	bHidden = true;
	const cachee = await signaler('visibilitychange', document);
	dire('la page cachee est annoncee', cachee.nouveaux === 1, String(cachee.nouveaux));
	dire('cachee, elle n\'est plus active malgre le focus',
		etat().bShown === false && etat().bActive === false, JSON.stringify(etat()));

	// Retour a la visibilite.
	bHidden = false;
	const revenue = await signaler('visibilitychange', document);
	dire('le retour a la visibilite est annonce', revenue.nouveaux === 1, String(revenue.nouveaux));
	dire('visible et active a nouveau', etat().bShown === true && etat().bActive === true, JSON.stringify(etat()));

	/*
		L'etat est un couple, pas deux drapeaux independants. Perdre le premier plan puis se cacher
		fait deux etats differents, donc deux envois. Se cacher d'abord puis perdre le premier plan
		n'en fait qu'un : cachee, la page etait deja inactive, et le second evenement ne change rien.
	*/
	const nAvant = recus.length;
	bFocus = false;
	await signaler('blur', window);
	bHidden = true;
	await signaler('visibilitychange', document);
	dire('perdre le premier plan puis se cacher : deux envois', recus.length - nAvant === 2,
		String(recus.length - nAvant));

	bHidden = false;
	bFocus = true;
	await signaler('focus', window);
	const nAvantInverse = recus.length;
	bHidden = true;
	await signaler('visibilitychange', document);
	bFocus = false;
	await signaler('blur', window);
	dire('se cacher puis perdre le premier plan : un seul envoi', recus.length - nAvantInverse === 1,
		String(recus.length - nAvantInverse));

	// Tout est rendu.
	bHidden = false;
	bFocus = true;
	await signaler('focus', window);
	delete document.hidden;
	document.hasFocus = fHasFocusOrigine;
	dire('les entrees du navigateur sont rendues',
		document.hasFocus === fHasFocusOrigine && !Object.getOwnPropertyDescriptor(document, 'hidden'));

	return JSON.stringify(verdicts);
})()
