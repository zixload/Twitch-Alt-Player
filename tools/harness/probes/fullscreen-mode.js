/*
	Le plein ecran : y entrer, en sortir, et le dire au reste du lecteur.

	Ecrite depuis la description du module, avant sa reecriture.

	**Une seule entree par passage.** Le plein ecran exige un geste de l'utilisateur, que
	modulecheck.py accorde par userGesture -- et cette activation est *consommee* par la premiere
	demande. La sonde entre donc une fois, par le vrai chemin (le double-clic sur l'oeil), et se
	sert de ce que le navigateur refuse ensuite : une demande sans geste est refusee, et le module
	ne doit pas pretendre le contraire. C'est la meilleure preuve qu'il mesure au lieu de croire.

	Ce qui compte et ne se lit dans aucune signature :
	  - l'element mis en plein ecran est #playerandchat, pas la video : le chat reste a cote ;
	  - la classe alt-fullscreen sur le body est la seule facon pour les feuilles de style de savoir.
	    La barre laterale est soeur de l'element plein ecran, et son backdrop-filter la promeut sur
	    sa propre couche, qui survivrait par-dessus la video si rien ne la masquait ;
	  - entrer efface l'interface sans animation ;
	  - le module ecoute fullscreenchange et mesure, il ne se fie pas a ce qu'il a demande. Le
	    navigateur peut refuser, et l'utilisateur sortir par Echap sans prevenir personne.
*/
(async () => {
	const verdicts = [];
	const dire = (nom, ok, detail) => verdicts.push([nom, !!ok, detail === undefined ? '' : detail]);
	const dormir = (ms) => new Promise((f) => setTimeout(f, ms));
	const plein = () => Boolean(document.fullscreenElement || document.webkitFullscreenElement);
	const classe = () => document.body.classList.contains('alt-fullscreen');
	const elEye = document.getElementById('eye');

	const annonces = [];
	m_Events.AddHandler('fullscreen-changed', (bEnabled) => annonces.push(bEnabled));

	dire('au repos, pas de plein ecran', !plein() && !m_FullscreenMode.Enabled(), String(plein()));
	dire('la classe suit l\'etat', !classe());
	dire('l\'element mis en plein ecran est le lecteur et le chat',
		m_FullscreenMode.GetElement() === document.getElementById('playerandchat'),
		m_FullscreenMode.GetElement().id);

	// L'unique entree du passage, par le double-clic : c'est lui qui porte le geste.
	elEye.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, button: 0 }));
	await dormir(700);
	dire('un double-clic sur l\'oeil met en plein ecran', plein(), String(plein()));
	dire('le module le dit', m_FullscreenMode.Enabled());
	dire('le body porte alt-fullscreen', classe());
	dire('l\'entree est annoncee', annonces.length === 1 && annonces[0] === true, JSON.stringify(annonces));
	dire('le plein ecran efface l\'interface', document.body.classList.contains('autohide'));

	// Sortir n'exige aucun geste.
	m_FullscreenMode.Toggle();
	await dormir(700);
	dire('Toggle en sort', !plein(), String(plein()));
	dire('la sortie est annoncee', annonces.length === 2 && annonces[1] === false, JSON.stringify(annonces));
	dire('la classe est retiree', !classe());

	const bRefus = m_FullscreenMode.Disable();
	await dormir(200);
	dire('Disable sans plein ecran rend faux', bRefus === false, String(bRefus));
	dire('et n\'annonce rien de plus', annonces.length === 2, String(annonces.length));

	/*
		L'activation a ete consommee par l'entree. Le navigateur refuse donc la demande suivante, et
		c'est le cas interessant : le module a demande le plein ecran, ne l'a pas obtenu, et ne
		pretend pas l'avoir.
	*/
	m_FullscreenMode.Toggle();
	await dormir(700);
	dire('une demande sans geste ne met pas en plein ecran', !plein(), String(plein()));
	dire('et le module ne pretend pas le contraire', !m_FullscreenMode.Enabled() && !classe(),
		`${m_FullscreenMode.Enabled()} ${classe()}`);
	dire('rien n\'a ete annonce a tort', annonces.length === 2, JSON.stringify(annonces));

	// Un double-clic du bouton droit n'est pas une bascule.
	elEye.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, button: 2 }));
	await dormir(400);
	dire('un double-clic droit ne bascule pas', !plein() && annonces.length === 2,
		`${plein()} ${annonces.length}`);

	dire('l\'etat final est coherent',
		m_FullscreenMode.Enabled() === plein() && classe() === plein(),
		`${m_FullscreenMode.Enabled()} ${plein()} ${classe()}`);

	return JSON.stringify(verdicts);
})()
