/*
	Le glisser-deposer : un seul a la fois, et trois temps pour chacun.

	Ecrite depuis la description du module, avant sa reecriture.

	Ce qui compte et ne se lit dans aucune signature :
	  - la poignee et ce qui bouge sont deux elements differents. On attrape un en-tete de tableau ou
	    un bouton « + », et ce qui se deplace est nomme par l'attribut data-dragger ;
	  - trois temps, annonces sur le meme nom d'evenement : 1 au debut, 2 a chaque mouvement retenu,
	    3 a la fin. C'est le numero qui distingue, pas l'evenement ;
	  - **le meme objet de parametres traverse tout le glisser**, mute au fil des temps. Un auditeur
	    qui en garde une reference voit ses valeurs changer sous lui ; c'est voulu, et fragile ;
	  - un mouvement par 45 ms, et seulement s'il a vraiment bouge. Un pointeur en envoie des
	    centaines par seconde, et chacun ferait un recalcul de mise en page ;
	  - la fin arrive par cinq chemins : le bouton relache, un pointerup, un pointercancel, l'onglet
	    qui perd la main, ou une annulation demandee. Le dernier pose bCancel : l'auditeur doit
	    defaire, pas valider.
*/
(async () => {
	const verdicts = [];
	const dire = (nom, ok, detail) => verdicts.push([nom, !!ok, detail === undefined ? '' : detail]);
	const dormir = (ms) => new Promise((f) => setTimeout(f, ms));

	const elHandle = document.querySelector('#interfacesize > .numberinput-plus');
	const elDragged = document.getElementById('interfacesize');
	const elCapture = m_FullscreenMode.GetElement();
	const nTailleDorigine = m_Settings.Get('nInterfaceSize');

	const recus = [];
	m_Events.AddHandler('dragger-drag-interfacesize', (oParams) => {
		// L'objet est mute d'un temps a l'autre : on garde une copie ET la reference.
		recus.push({ ref: oParams, nStep: oParams.nStep, bCancel: oParams.bCancel,
			nDeltaX: oParams.nDeltaX, nDeltaY: oParams.nDeltaY,
			bChangedX: oParams.bChangedX, bChangedY: oParams.bChangedY,
			pressed: oParams.nodePressed, dragging: oParams.nodeDragging });
	});

	let nPointeur = 100;
	const appuyer = (elCible, nButton = 0, nX = 400, nY = 300) => {
		nPointeur += 1;
		elCible.dispatchEvent(new PointerEvent('pointerdown', {
			bubbles: true, pointerId: nPointeur, button: nButton, buttons: nButton === 0 ? 1 : 2,
			clientX: nX, clientY: nY, pointerType: 'mouse', isPrimary: true,
		}));
		return nPointeur;
	};
	const bouger = (nId, nX, nY, nButtons = 1) => document.dispatchEvent(new PointerEvent('pointermove', {
		bubbles: true, pointerId: nId, buttons: nButtons, clientX: nX, clientY: nY,
	}));
	const relacher = (nId, sType = 'pointerup') => document.dispatchEvent(new PointerEvent(sType, {
		bubbles: true, pointerId: nId, buttons: 0, clientX: 0, clientY: 0,
	}));

	dire('la poignee et ce qu\'elle deplace existent', Boolean(elHandle && elDragged),
		elHandle ? elHandle.className : 'absente');

	// --- Un glisser complet
	let nId = appuyer(elHandle, 0, 400, 300);
	await dormir(60);
	dire('l\'appui ouvre le premier temps', recus.length === 1 && recus[0].nStep === 1,
		JSON.stringify(recus.map((r) => r.nStep)));
	dire('la poignee et l\'element deplace sont distincts',
		recus[0] && recus[0].pressed === elHandle && recus[0].dragging === elDragged);
	dire('l\'element deplace est marque', elDragged.classList.contains('dragger'));
	dire('le lecteur capture le curseur', elCapture.classList.contains('dragger-capture'));
	dire('le curseur est force', elCapture.style.cursor !== '', elCapture.style.cursor);

	bouger(nId, 440, 330);
	await dormir(60);
	dire('un mouvement ouvre le deuxieme temps', recus.length === 2 && recus[1].nStep === 2,
		JSON.stringify(recus.map((r) => r.nStep)));
	dire('les ecarts sont comptes depuis le debut',
		recus[1] && recus[1].nDeltaX === 40 && recus[1].nDeltaY === 30,
		recus[1] ? `${recus[1].nDeltaX},${recus[1].nDeltaY}` : '');
	dire('les deux axes se disent separement',
		recus[1] && recus[1].bChangedX === true && recus[1].bChangedY === true);
	dire('c\'est le meme objet qui traverse le glisser', recus[0].ref === recus[1].ref);

	/*
		La cadence se mesure sur trois mouvements d'affilee : le premier est retenu -- la fenetre de
		45 ms est passee --, les deux suivants tombent dedans et sont ignores.
	*/
	await dormir(60);
	bouger(nId, 460, 350);
	bouger(nId, 461, 351);
	bouger(nId, 462, 352);
	await dormir(60);
	dire('un mouvement par 45 ms, pas plus', recus.length === 3, String(recus.length));

	/*
		La position retenue est celle du dernier mouvement COMPTE, pas du dernier envoye. Et le
		mouvement immobile referme quand meme la fenetre de 45 ms : un mouvement examine est un
		mouvement paye. Le vrai mouvement qui suit aussitot doit donc attendre son tour -- c'est le
		seul cas qui distingue les deux ordres possibles dans le code, et il se joue en deux
		evenements colles.
	*/
	bouger(nId, 460, 350);
	bouger(nId, 470, 360);
	await dormir(60);
	dire('un retour au meme point ne compte pas, et referme la fenetre', recus.length === 3,
		String(recus.length));

	bouger(nId, 480, 370);
	await dormir(60);
	dire('le mouvement suivant passe une fois le delai ecoule', recus.length === 4, String(recus.length));

	relacher(nId);
	await dormir(60);
	dire('le relachement ferme le glisser', recus.length === 5 && recus[4].nStep === 3,
		JSON.stringify(recus.map((r) => r.nStep)));
	dire('sans annulation', recus[4] && recus[4].bCancel === false);
	dire('les marques sont retirees',
		!elDragged.classList.contains('dragger') && !elCapture.classList.contains('dragger-capture'));
	dire('le curseur est rendu', elCapture.style.cursor === '', elCapture.style.cursor);

	bouger(nId, 500, 500);
	await dormir(60);
	dire('apres la fin, plus rien n\'ecoute', recus.length === 5, String(recus.length));

	// --- Un seul glisser a la fois
	recus.length = 0;
	nId = appuyer(elHandle, 0, 400, 300);
	await dormir(60);
	const nAutre = appuyer(elHandle, 0, 500, 400);
	await dormir(60);
	dire('un second appui pendant un glisser est ignore', recus.length === 1, String(recus.length));
	relacher(nId);
	await dormir(60);

	// --- L'annulation
	recus.length = 0;
	nId = appuyer(elHandle, 0, 400, 300);
	await dormir(60);
	m_Dragger.CancelDrag('interfacesize');
	await dormir(60);
	dire('l\'annulation ferme le glisser',
		recus.length === 2 && recus[1].nStep === 3, JSON.stringify(recus.map((r) => r.nStep)));
	dire('et le dit : bCancel', recus[1] && recus[1].bCancel === true);

	let leve = false;
	try {
		m_Dragger.CancelDrag('interfacesize');
		m_Dragger.CancelDrag();
	} catch (oError) {
		leve = true;
	}
	dire('annuler sans glisser en cours ne leve pas', !leve);

	// --- L'onglet qui part
	recus.length = 0;
	nId = appuyer(elHandle, 0, 400, 300);
	await dormir(60);
	m_Events.SendEvent('focus-statechanged', { bShown: true, bActive: false });
	await dormir(60);
	dire('l\'onglet qui perd la main ferme le glisser',
		recus.length === 2 && recus[1].nStep === 3, JSON.stringify(recus.map((r) => r.nStep)));

	// --- Le bouton droit n'ouvre rien
	recus.length = 0;
	appuyer(elHandle, 2, 400, 300);
	await dormir(60);
	dire('le bouton droit n\'ouvre pas de glisser', recus.length === 0, String(recus.length));

	// --- Le bouton relache pendant un mouvement
	recus.length = 0;
	nId = appuyer(elHandle, 0, 400, 300);
	await dormir(60);
	bouger(nId, 450, 350, 0);
	await dormir(60);
	dire('un mouvement sans bouton ferme le glisser',
		recus.length === 2 && recus[1].nStep === 3, JSON.stringify(recus.map((r) => r.nStep)));

	m_Settings.Change('nInterfaceSize', nTailleDorigine);
	await dormir(60);
	dire('le reglage d\'origine est rendu', m_Settings.Get('nInterfaceSize') === nTailleDorigine,
		String(m_Settings.Get('nInterfaceSize')));

	return JSON.stringify(verdicts);
})()
