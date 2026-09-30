/*
	L'image figee au retour sur l'onglet : le chien de garde la voit-il, et ne voit-il qu'elle ?

	Ecrite depuis la description du module, avant sa relecture.

	La panne elle-meme ne se rejoue pas sur un banc -- un navigateur pilote n'atteint jamais l'etat
	« onglet reellement visible ». Ce qui se juge ici, c'est la regle : l'etat decrit est-il reconnu,
	les autres sont-ils laisses tranquilles, et le remede est-il celui annonce.

	La sonde tient donc elle-meme les deux mesures dont le module se sert -- la position de lecture
	et le compte d'images -- sur un element de theatre, et regarde ce qui arrive a la position.

	Ce qui compte et ne se lit dans aucune signature :
	  - **le son avance, pas l'image** : c'est la seule signature de la panne, et aucune lecture
	    saine ne la donne ;
	  - une lecture qui cale vraiment n'avance pas non plus : elle ne doit pas etre deplacee ;
	  - un element en pause n'est pas fige, il est en pause ;
	  - sans compte d'images, on ne conclut rien : mieux vaut ne rien faire que deplacer la lecture
	    sur une comparaison qui ne veut rien dire ;
	  - le remede s'arrete apres deux essais.
*/
(async () => {
	const verdicts = [];
	const dire = (nom, ok, detail) => verdicts.push([nom, !!ok, detail === undefined ? '' : detail]);
	const dormir = (ms) => new Promise((f) => setTimeout(f, ms));

	// Un element de theatre : ses mesures sont tenues a la main, rien ne joue.
	const faire = (o) => {
		const el = document.createElement('video');
		let nTemps = o.temps === undefined ? 10 : o.temps;
		let nImages = o.images === undefined ? 100 : o.images;
		const aGestes = [];
		Object.defineProperties(el, {
			paused: { configurable: true, get: () => Boolean(o.enPause) },
			ended: { configurable: true, get: () => Boolean(o.finie) },
			readyState: { configurable: true, get: () => (o.pret === undefined ? 4 : o.pret) },
			videoWidth: { configurable: true, get: () => (o.largeur === undefined ? 1920 : o.largeur) },
			currentTime: {
				configurable: true,
				get: () => nTemps,
				set: (n) => { aGestes.push(['deplace', Number((n - nTemps).toFixed(4))]); nTemps = n; },
			},
		});
		el.getVideoPlaybackQuality = o.sansCompte
			? undefined
			: () => ({ totalVideoFrames: nImages, droppedVideoFrames: 0 });
		el.pause = () => { aGestes.push(['pause']); };
		el.play = () => { aGestes.push(['reprise']); return Promise.resolve(); };
		// Ce que le temps fait pendant que le module attend.
		el.avancer = (nSecondes, nNouvellesImages) => {
			nTemps += nSecondes;
			nImages += nNouvellesImages;
		};
		el.gestes = aGestes;
		return el;
	};

	// Le module regarde a 700 ms, puis a 1200 ms de plus : la sonde suit ce rythme de loin.
	const APRES_PREMIER = 950;
	const APRES_SECOND = 1500;

	try {
		// --- L'etat de la panne : le son avance, pas une image.
		const elFige = faire({});
		m_Unfreeze.Examine(elFige);
		elFige.avancer(0.7, 0);
		await dormir(APRES_PREMIER);
		dire('le son qui avance sans image est reconnu',
			elFige.gestes.length === 1 && elFige.gestes[0][0] === 'deplace',
			JSON.stringify(elFige.gestes));
		dire('et le remede est un deplacement d\'un millieme',
			elFige.gestes[0] && Math.abs(elFige.gestes[0][1] - 0.001) < 1e-6,
			JSON.stringify(elFige.gestes[0]));

		// Toujours fige apres le deplacement : le son continue d'avancer, l'image non.
		elFige.avancer(0.7, 0);
		await dormir(APRES_SECOND);
		dire('toujours fige, il tente la pause et la reprise',
			elFige.gestes.map(([s]) => s).join(' ') === 'deplace pause reprise',
			elFige.gestes.map(([s]) => s).join(' '));
		await dormir(APRES_SECOND);
		dire('et il s\'arrete la', elFige.gestes.length === 3, JSON.stringify(elFige.gestes));

		// --- Une lecture saine : les images arrivent.
		const elSaine = faire({});
		m_Unfreeze.Examine(elSaine);
		elSaine.avancer(0.7, 21);
		await dormir(APRES_PREMIER);
		dire('une lecture qui produit des images est laissee tranquille',
			elSaine.gestes.length === 0, JSON.stringify(elSaine.gestes));

		// --- Une lecture qui cale : ni image, ni temps. Ce n'est pas la meme panne.
		const elCalee = faire({});
		m_Unfreeze.Examine(elCalee);
		elCalee.avancer(0, 0);
		await dormir(APRES_PREMIER);
		dire('une lecture qui cale vraiment n\'est pas deplacee',
			elCalee.gestes.length === 0, JSON.stringify(elCalee.gestes));

		// --- Ce qui n'est pas en train de jouer.
		const elPause = faire({ enPause: true });
		m_Unfreeze.Examine(elPause);
		elPause.avancer(0.7, 0);
		await dormir(APRES_PREMIER);
		dire('un element en pause est en pause, pas fige', elPause.gestes.length === 0,
			JSON.stringify(elPause.gestes));

		const elVide = faire({ pret: 1 });
		m_Unfreeze.Examine(elVide);
		elVide.avancer(0.7, 0);
		await dormir(APRES_PREMIER);
		dire('un element sans donnees non plus', elVide.gestes.length === 0,
			JSON.stringify(elVide.gestes));

		const elSansImage = faire({ largeur: 0 });
		m_Unfreeze.Examine(elSansImage);
		elSansImage.avancer(0.7, 0);
		await dormir(APRES_PREMIER);
		dire('un flux sans image non plus', elSansImage.gestes.length === 0,
			JSON.stringify(elSansImage.gestes));

		// --- Sans compte d'images, on ne conclut rien.
		const elAveugle = faire({ sansCompte: true });
		m_Unfreeze.Examine(elAveugle);
		elAveugle.avancer(0.7, 0);
		await dormir(APRES_PREMIER);
		dire('sans compte d\'images, rien n\'est tente', elAveugle.gestes.length === 0,
			JSON.stringify(elAveugle.gestes));

		// --- Ce qu'il surveille de lui-meme.
		dire('il surveille la video des rediffusions et celle du retour arriere',
			typeof m_Unfreeze.Watch === 'function' && document.getElementById('videos-video') !== null
			&& document.getElementById('rewind') !== null);
	} catch (oErreur) {
		dire('la sonde va jusqu\'au bout', false, String((oErreur && oErreur.stack) || oErreur).slice(0, 300));
	}
	return JSON.stringify(verdicts);
})()
