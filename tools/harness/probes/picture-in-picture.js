/*
	L'image dans l'image : la video sort dans sa propre fenetre, le reste du lecteur reste ici.

	Ecrite depuis la description du module, avant sa reecriture.

	Comme le plein ecran, elle exige un geste de l'utilisateur, et la premiere demande le consomme :
	la sonde n'entre donc qu'une fois, et se sert du refus suivant.

	Ce qui compte et ne se lit dans aucune signature :
	  - le module ne fait rien tant qu'on ne lui a pas donne la video (start), et le bouton reste
	    cache. Un navigateur qui ne sait pas faire, ou une video qui l'interdit, laissent le lecteur
	    exactement comme s'il n'y avait pas de bouton ;
	  - plein ecran et image dans l'image ne tiennent pas ensemble : entrer dans l'une sort de
	    l'autre ;
	  - sans video a l'ecran -- la classe novideo -- la bascule ne fait rien ;
	  - l'etat vient des evenements du navigateur, jamais de ce qu'on a demande.
*/
(async () => {
	const verdicts = [];
	const dire = (nom, ok, detail) => verdicts.push([nom, !!ok, detail === undefined ? '' : detail]);
	const dormir = (ms) => new Promise((f) => setTimeout(f, ms));
	const dedans = () => Boolean(document.pictureInPictureElement);
	const elBouton = document.getElementById('togglepictureinpicture');
	const elVideo = document.querySelector('video');

	dire('le navigateur sait faire l\'image dans l\'image', document.pictureInPictureEnabled === true,
		String(document.pictureInPictureEnabled));
	dire('la video ne l\'interdit pas', elVideo && elVideo.disablePictureInPicture === false,
		String(elVideo && elVideo.disablePictureInPicture));
	dire('le bouton est montre une fois la video connue', elBouton && !elBouton.hasAttribute('hidden'),
		elBouton ? elBouton.outerHTML.slice(0, 40) : 'absent');
	dire('au repos, on n\'y est pas', !dedans());
	// Sans metadonnees, le navigateur refuse : la chaine doit etre en direct, et le banc le dit.
	dire('la video a ses metadonnees', Boolean(elVideo) && elVideo.readyState > 0 && elVideo.videoWidth > 0,
		// La largeur depend de la qualite servie a l'instant : elle varie d'un passage a l'autre.
		`readyState=${elVideo && elVideo.readyState}`);

	// L'unique entree du passage : c'est elle qui consomme le geste.
	m_PictureInPicture.toggle();
	await dormir(1200);
	const bEntre = dedans();
	dire('la bascule fait sortir la video', bEntre, String(bEntre));
	if (bEntre) {
		dire('la video sortie est bien celle du lecteur', document.pictureInPictureElement === elVideo);
		dire('le lecteur n\'est pas en plein ecran en meme temps', !document.fullscreenElement);

		// En sortir ne demande aucun geste.
		const bSorti = m_PictureInPicture.disable();
		await dormir(1200);
		dire('disable rend vrai quand on y etait', bSorti === true, String(bSorti));
		dire('la video est revenue', !dedans(), String(dedans()));
	} else {
		dire('la video sortie est bien celle du lecteur', false, 'entree refusee par le navigateur');
		dire('le lecteur n\'est pas en plein ecran en meme temps', false, 'entree refusee');
		dire('disable rend vrai quand on y etait', false, 'entree refusee');
		dire('la video est revenue', false, 'entree refusee');
	}

	dire('disable sans y etre rend faux', m_PictureInPicture.disable() === false);

	// Sans video a l'ecran, la bascule ne fait rien.
	document.body.classList.add('novideo');
	m_PictureInPicture.toggle();
	await dormir(600);
	dire('sans video, la bascule ne fait rien', !dedans(), String(dedans()));
	document.body.classList.remove('novideo');

	dire('l\'etat final est net', !dedans() && !document.fullscreenElement);

	return JSON.stringify(verdicts);
})()
