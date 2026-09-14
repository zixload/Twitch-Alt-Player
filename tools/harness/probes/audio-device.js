/*
	Le choix du peripherique de sortie audio.

	Ecrite depuis la description du module, avant sa reecriture.

	**Le cas normal du banc est le cas sans permission.** Un profil neuf n'a pas accede aux
	peripheriques, donc enumerateDevices rend des entrees sans nom ni identifiant : le module montre
	alors le bouton d'acces a la place de la liste. C'est exactement l'etat que la sonde verifie, et
	c'est aussi le defaut connu du depot -- accorder la permission demande un clic humain sur une
	invite du navigateur, qu'aucun banc ne peut donner.

	La sonde va donc jusqu'a cette frontiere et pas au-dela : elle verifie que le clic declenche bien
	la demande de permission (le journal le dit), sans attendre de reponse.

	Ce qui compte et ne se lit dans aucune signature :
	  - start ne s'execute qu'une fois, et se tait si le navigateur ne sait pas changer de sortie ;
	  - la liste se refait quand le systeme signale un changement de peripherique : brancher un casque
	    pendant qu'on regarde doit suffire ;
	  - « par defaut » n'est pas un peripherique comme un autre : il vaut la chaine vide dans la liste
	    et le mot « default » pour le navigateur.
*/
(async () => {
	const verdicts = [];
	const dire = (nom, ok, detail) => verdicts.push([nom, !!ok, detail === undefined ? '' : detail]);
	const dormir = (ms) => new Promise((f) => setTimeout(f, ms));
	const journal = () => (m_Log.GetDataForReport() || []).join('\n');
	const depuis = (sAvant) => journal().slice(sAvant.length);
	const compter = (sTexte, sQuoi) => sTexte.split(sQuoi).length - 1;

	const elBloc = document.getElementById('audiodevices');
	const elListe = document.getElementById('audiodevices-list');
	const elAcces = document.getElementById('audiodevices-access');
	const elVideo = document.querySelector('video');

	dire('les trois elements existent', Boolean(elBloc && elListe && elAcces),
		[elBloc, elListe, elAcces].map((el) => (el ? 'ok' : 'absent')).join(' '));
	dire('le navigateur sait changer de sortie', 'setSinkId' in elVideo);

	const bSansPermission = !elAcces.hasAttribute('hidden');
	dire('sans permission, le bouton d\'acces remplace la liste',
		!bSansPermission || elListe.hasAttribute('hidden'),
		bSansPermission ? 'bouton montre' : 'liste montree');
	dire('avec permission, la liste porte au moins une sortie',
		bSansPermission || elListe.length > 0,
		bSansPermission ? 'cas saute : profil sans permission' : String(elListe.length));

	// Un second start ne refait rien : le module garde le premier element media.
	let sAvant = journal();
	m_AudioDevice.start(elVideo);
	await dormir(200);
	dire('un second start ne relit pas les peripheriques',
		compter(depuis(sAvant), '[AudioDevices] Getting media device list') === 0,
		String(compter(depuis(sAvant), '[AudioDevices] Getting media device list')));

	// Un changement de peripherique refait la liste.
	sAvant = journal();
	navigator.mediaDevices.dispatchEvent(new Event('devicechange'));
	await dormir(400);
	dire('un changement de peripherique refait la liste',
		compter(depuis(sAvant), '[AudioDevices] Getting media device list') === 1,
		String(compter(depuis(sAvant), '[AudioDevices] Getting media device list')));

	// La frontiere : le clic demande la permission, et la sonde s'arrete la.
	if (bSansPermission) {
		sAvant = journal();
		m_Events.SendEvent('controls-leftclick', { sCallsign: 'audiodevices-access', target: elAcces });
		await dormir(500);
		dire('le clic sur le bouton d\'acces demande la permission',
			compter(depuis(sAvant), '[AudioDevices] Requesting contentSettings permission') === 1,
			String(compter(depuis(sAvant), '[AudioDevices] Requesting contentSettings permission')));

		// Un clic ailleurs ne demande rien.
		sAvant = journal();
		m_Events.SendEvent('controls-leftclick', { sCallsign: 'togglechat', target: elAcces });
		await dormir(300);
		dire('un clic ailleurs ne demande rien',
			compter(depuis(sAvant), '[AudioDevices] Requesting contentSettings permission') === 0,
			String(compter(depuis(sAvant), '[AudioDevices] Requesting contentSettings permission')));
	} else {
		dire('le clic sur le bouton d\'acces demande la permission', true, 'permission deja accordee, cas saute');
		dire('un clic ailleurs ne demande rien', true, 'cas saute');
	}

	// Le reglage existe et garde ce qui a ete choisi.
	const sChoixDorigine = m_Settings.Get('sAudioDeviceId');
	dire('le peripherique choisi est un reglage', typeof sChoixDorigine === 'string',
		JSON.stringify(sChoixDorigine));

	return JSON.stringify(verdicts);
})()
