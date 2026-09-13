/*
	Le pouls : est-ce que cette page est encore servie par le navigateur ?

	Ecrite depuis la description du module, avant sa reecriture.

	Le module ne fait rien qu'on puisse voir a l'ecran : il mesure deux ecarts, se plaint dans le
	journal quand ils sortent des bornes, et garde le pire pour le rapport. La sonde le juge donc sur
	ce qu'il ecrit -- le journal EST sa sortie, et il finit dans les rapports de bug.

	Les details rapportes sont des comptes, jamais des extraits de journal : le journal porte des
	horodatages et les lignes des autres modules, et deux passages n'y ecrivent jamais la meme chose.

	Ce qui compte et ne se lit dans aucune signature :
	  - il ne bat que pendant qu'on regarde. Une rediffusion, un arret, une fin de diffusion :
	    le pouls s'arrete, sinon chaque lecteur en pause se plaindrait dans le vide ;
	  - demander deux fois la meme chose ne fait rien deux fois. L'etat est renvoye a chaque
	    changement de controle, des dizaines de fois par session ;
	  - deux ecarts, pas un. Le premier dit que le navigateur nous a servis en retard ; le second,
	    que l'horloge du systeme a saute pendant qu'on tournait -- mise a l'heure, veille, changement
	    manuel. Dans un rapport, les deux se ressemblent si on ne les separe pas.
*/
(async () => {
	const verdicts = [];
	const dire = (nom, ok, detail) => verdicts.push([nom, !!ok, detail === undefined ? '' : detail]);
	const dormir = (ms) => new Promise((f) => setTimeout(f, ms));

	const journal = () => (m_Log.GetDataForReport() || []).join('\n');
	const depuis = (sAvant) => journal().slice(sAvant.length);
	const compter = (sTexte, sQuoi) => sTexte.split(sQuoi).length - 1;
	const DEMARRE = '[Heartbeat] Timer started';
	const ARRETE = '[Heartbeat] Timer stopped';

	const nEtatDorigine = m_Controls.GetState();
	const etat = (nEtat) => m_Events.SendEvent('controls-statechanged', nEtat);

	// Arreter, puis demarrer : chaque transition se dit une fois.
	etat(STATE_STOP);
	await dormir(150);
	let sAvant = journal();
	etat(STATE_PLAYING);
	await dormir(200);
	dire('en lecture, le pouls demarre', compter(depuis(sAvant), DEMARRE) === 1,
		String(compter(depuis(sAvant), DEMARRE)));

	sAvant = journal();
	etat(STATE_PLAYING);
	await dormir(200);
	dire('le meme etat deux fois ne le redemarre pas', compter(depuis(sAvant), DEMARRE) === 0,
		String(compter(depuis(sAvant), DEMARRE)));

	const nAvantBattements = m_Heartbeat.GetDataForReport();
	dire('le pire ecart est un nombre', Number.isFinite(nAvantBattements),
		Number.isFinite(nAvantBattements) ? 'fini' : String(nAvantBattements));
	await dormir(2500);
	const nApresBattements = m_Heartbeat.GetDataForReport();
	dire('le pire ecart ne recule jamais', nApresBattements >= nAvantBattements,
		nApresBattements >= nAvantBattements ? '' : `${nAvantBattements} -> ${nApresBattements}`);

	// Une rediffusion arrete le pouls.
	sAvant = journal();
	etat(STATE_REPEAT);
	await dormir(200);
	dire('une rediffusion arrete le pouls', compter(depuis(sAvant), ARRETE) === 1,
		String(compter(depuis(sAvant), ARRETE)));

	sAvant = journal();
	etat(STATE_STOP);
	await dormir(200);
	dire('un arret de plus ne l\'arrete pas deux fois', compter(depuis(sAvant), ARRETE) === 0,
		String(compter(depuis(sAvant), ARRETE)));

	// Arrete, il ne se plaint plus : rien de nouveau dans le journal pendant deux secondes.
	sAvant = journal();
	await dormir(2200);
	dire('arrete, il n\'ecrit plus rien', compter(depuis(sAvant), '[Heartbeat]') === 0,
		String(compter(depuis(sAvant), '[Heartbeat]')));

	// Fin de diffusion : meme traitement que l'arret.
	etat(STATE_PLAYING);
	await dormir(200);
	sAvant = journal();
	etat(STATE_BROADCAST_END);
	await dormir(200);
	dire('une fin de diffusion arrete aussi', compter(depuis(sAvant), ARRETE) === 1,
		String(compter(depuis(sAvant), ARRETE)));

	etat(nEtatDorigine);
	await dormir(200);
	dire('l\'etat d\'origine est rendu', m_Controls.GetState() === nEtatDorigine, String(nEtatDorigine));

	return JSON.stringify(verdicts);
})()
