/*
	Tout ce que le lecteur dit a l'utilisateur, et la mise en forme qui va avec.

	Ecrite depuis la description du module, avant sa reecriture.

	Ce qui merite d'etre tenu et ne se lit dans aucune signature :
	  - une cle absente leve. Un libelle vide passerait inapercu a l'ecran et se retrouverait dans
	    une capture d'ecran d'utilisateur trois mois plus tard ;
	  - les messages portent du balisage -- 73 sur 700 contiennent une balise -- donc ils
	    s'inserent, ils ne s'affectent pas en textContent ;
	  - data-i18n porte deux cles separees par « ^ » : avant, le corps ; apres, l'infobulle. L'une
	    ou l'autre peut manquer, et « ^A0503 » veut dire « infobulle seulement » ;
	  - TranslateDocument prend un document en parametre, pas le document courant : il traduit aussi
	    celui du cadre du rapport ;
	  - les dates sont formatees en UTC. Une date d'archive affichee dans le fuseau du spectateur
	    change de jour a vingt-trois heures, et deux spectateurs ne verraient pas la meme.
*/
(async () => {
	const verdicts = [];
	const dire = (nom, ok, detail) => verdicts.push([nom, !!ok, detail === undefined ? '' : detail]);
	const leve = (f) => {
		try {
			f();
			return false;
		} catch (oError) {
			return true;
		}
	};

	// --- Les messages
	const sTitre = m_i18n.GetMessage('F0539');
	dire('une cle connue rend son texte', typeof sTitre === 'string' && sTitre.length > 0, sTitre);
	dire('une cle inconnue leve', leve(() => m_i18n.GetMessage('F9999')));
	dire('une cle vide leve', leve(() => m_i18n.GetMessage('')));
	dire('une substitution qui n\'est pas une chaine leve', leve(() => m_i18n.GetMessage('F0539', 42)));

	const sAvecBalise = m_i18n.GetMessage('F0668');
	dire('les messages portent du balisage', sAvecBalise.includes('<'), sAvecBalise.slice(0, 40));

	// --- L'insertion
	const elBac = document.createElement('div');
	elBac.hidden = true;
	document.body.appendChild(elBac);

	m_i18n.InsertAdjacentHtmlMessage(elBac, 'beforeend', 'F0668');
	dire('le message s\'insere comme balisage, pas comme texte',
		elBac.children.length > 0, elBac.innerHTML.slice(0, 40));

	m_i18n.InsertAdjacentHtmlMessage(elBac, 'beforeend', 'F0668');
	const nDeux = elBac.children.length;
	m_i18n.InsertAdjacentHtmlMessage(elBac, 'content', 'F0668');
	dire('« content » vide l\'element avant d\'inserer', elBac.children.length < nDeux,
		`${nDeux} -> ${elBac.children.length}`);
	dire('l\'element est rendu a l\'appelant',
		m_i18n.InsertAdjacentHtmlMessage(elBac, 'content', 'F0539') === elBac);

	// --- La traduction d'un document, celui d'un cadre en l'occurrence
	const elFrame = document.createElement('iframe');
	elFrame.hidden = true;
	document.body.appendChild(elFrame);
	const oDoc = elFrame.contentDocument;
	oDoc.body.innerHTML = [
		'<span id=corps data-i18n=F0539></span>',
		'<span id=les-deux data-i18n=F0539^A0503></span>',
		'<span id=infobulle data-i18n=^A0503></span>',
	].join('');
	m_i18n.TranslateDocument(oDoc);
	const corps = oDoc.getElementById('corps');
	const lesDeux = oDoc.getElementById('les-deux');
	const infobulle = oDoc.getElementById('infobulle');
	dire('le corps est traduit', corps.textContent === sTitre, corps.textContent);
	dire('sans « ^ », pas d\'infobulle', !corps.title);
	dire('avec « ^ », le corps et l\'infobulle', lesDeux.textContent === sTitre && lesDeux.title.length > 0,
		lesDeux.title.slice(0, 30));
	dire('« ^cle » seule ne met que l\'infobulle',
		infobulle.textContent === '' && infobulle.title.length > 0, infobulle.title.slice(0, 30));

	// --- Les nombres
	const sMille = m_i18n.FormatNumber(1234.5);
	dire('un nombre se formate', /\d/.test(sMille), sMille);
	const sDeuxDecimales = m_i18n.FormatNumber(1.5, 2);
	dire('deux decimales sont deux decimales', /\D50$/.test(sDeuxDecimales), sDeuxDecimales);
	dire('zero decimale n\'en laisse aucune', /^\D?\d+$/.test(m_i18n.FormatNumber(1.5, 0)),
		m_i18n.FormatNumber(1.5, 0));
	dire('le meme nombre donne le meme texte', m_i18n.FormatNumber(1.5, 2) === sDeuxDecimales);
	dire('un nombre de decimales negatif leve', leve(() => m_i18n.FormatNumber(1, -1)));

	// --- Les dates, en UTC
	const nTard = Date.UTC(2020, 0, 2, 23, 30);
	const sTard = m_i18n.FormatDate(nTard);
	dire('une date se formate', /2020/.test(sTard), sTard);
	dire('la date est lue en UTC, pas dans le fuseau du spectateur',
		/\b2\b/.test(sTard) && !/\b3\b/.test(sTard), sTard);
	dire('une date invalide leve', leve(() => m_i18n.FormatDate(NaN)));

	// --- Les durees
	dire('une duree sans secondes', m_i18n.SecondsToString(3600 + 5 * 60 + 7, false) === '1 : 05',
		m_i18n.SecondsToString(3600 + 5 * 60 + 7, false));
	dire('une duree avec secondes', m_i18n.SecondsToString(3600 + 5 * 60 + 7, true) === '1 : 05 : 07',
		m_i18n.SecondsToString(3600 + 5 * 60 + 7, true));
	dire('zero seconde', m_i18n.SecondsToString(0, true) === '0 : 00 : 00', m_i18n.SecondsToString(0, true));
	dire('au-dela de vingt-quatre heures, les heures ne bouclent pas',
		m_i18n.SecondsToString(30 * 3600, false) === '30 : 00', m_i18n.SecondsToString(30 * 3600, false));

	// --- Les langues
	dire('un code de langue rend son nom dans sa langue', m_i18n.GetLanguageName('fr') === 'Français',
		m_i18n.GetLanguageName('fr'));
	dire('la casse du code est indifferente', m_i18n.GetLanguageName('FR') === m_i18n.GetLanguageName('fr'));
	dire('un code regional est distinct', m_i18n.GetLanguageName('pt_br') !== m_i18n.GetLanguageName('pt'),
		m_i18n.GetLanguageName('pt_br'));
	dire('un code inconnu leve', leve(() => m_i18n.GetLanguageName('zz')));

	elBac.remove();
	elFrame.remove();
	dire('la page est rendue propre', !document.getElementById('corps'));

	return JSON.stringify(verdicts);
})()
