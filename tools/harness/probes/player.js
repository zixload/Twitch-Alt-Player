/*
	Le lecteur : MediaSource, l'element video, le direct et la rediffusion.

	Ecrite depuis la description du module, avant sa reecriture. Elle demande une chaine en direct.

	Le module a deux comportements, et bascule de l'un a l'autre sans recharger la page :
	  - **en direct**, il empile les segments convertis, attend d'avoir assez de tampon pour
	    demarrer, saute par-dessus les trous, et se rapproche du direct quand le tampon deborde ;
	  - **en rediffusion**, il s'arrete sur ce qu'il a deja, et le spectateur s'y deplace, change la
	    vitesse, met en pause.

	Ce qui compte et ne se lit dans aucune signature :
	  - arreter le direct ne vide pas l'image : la rediffusion reprend exactement ce qui est en
	    tampon, en pause, et l'annonce ;
	  - reprendre le direct recharge MediaSource entierement et repasse par le chargement ;
	  - changer de qualite recharge aussi : on ne peut pas empiler un autre encodage dans le meme
	    tampon ;
	  - le volume et la coupure du son s'appliquent a l'element video tels qu'enregistres.

	Aucun detail rapporte ne porte de mesure qui varie d'un passage a l'autre.
*/
(async () => {
	const verdicts = [];
	const dire = (nom, ok, detail) => verdicts.push([nom, !!ok, detail === undefined ? '' : detail]);
	const dormir = (ms) => new Promise((f) => setTimeout(f, ms));
	const v = document.getElementById('eye');
	const etat = () => m_Controls.GetState();
	const attendre = async (fCondition, nMs) => {
		const nFin = performance.now() + nMs;
		while (!fCondition() && performance.now() < nFin) {
			await dormir(100);
		}
		return fCondition();
	};
	const touche = (nCode) => {
		const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true });
		Object.defineProperty(e, 'keyCode', { get: () => nCode });
		document.dispatchEvent(e);
	};

	const oReglages = {};
	for (const s of ['nVolume2', 'bMute', 'sVariantLabel', 'nVariantBitrate']) {
		oReglages[s] = m_Settings.Get(s);
	}
	const aPauses = [];
	const fPause = (b) => { aPauses.push(b); };
	m_Events.AddHandler('player-paused', fPause);
	const aEtats = [];
	const fEtat = (n) => { aEtats.push(n); };
	m_Events.AddHandler('controls-statechanged', fEtat);

	try {
		// ------------------------------------------------------------------- Le direct.
		dire('le direct atteint la lecture', await attendre(() => etat() === STATE_PLAYING && !v.paused, 25000),
			`etat ${etat()}`);
		dire('la video joue par MediaSource', /^blob:/.test(v.src));
		const { nWatched, nUnwatched } = m_Player.GetBufferFill();
		const nFinTampon = v.buffered.length ? v.buffered.end(v.buffered.length - 1) : 0;
		dire('le tampon restant est celui de l\'element video',
			Math.abs(nFinTampon - v.currentTime - nUnwatched) < 0.05 && nWatched >= 0);
		dire('et assez pour jouer', nUnwatched >= MIN_BUFFER_SIZE);
		await dormir(1000);
		const oQualite = m_Player.GetDroppedFrameCount();
		dire('le compte d\'images vient de l\'element video',
			Number.isFinite(oQualite.totalVideoFrames) && Number.isFinite(oQualite.droppedVideoFrames)
			&& oQualite.totalVideoFrames > 0);
		dire('la position dans la diffusion est connue', m_Player.GetBroadcastPlaybackPosition(false) > 0);

		// Le volume enregistre s'applique a l'element.
		m_Settings.Change('nVolume2', 40);
		m_Settings.Change('bMute', true);
		m_Player.ApplyVolume();
		dire('le volume enregistre s\'applique a la video', Math.abs(v.volume - 0.4) < 1e-9 && v.muted === true);
		m_Settings.Change('bMute', false);
		m_Player.ApplyVolume();
		dire('et la coupure se leve', v.muted === false);

		// ShowState ecrit une ligne complete dans le journal.
		m_Player.ShowState('Here', 'sonde du banc');
		const aJournal = m_Log.GetDataForReport() || [];
		const sLigne = aJournal[aJournal.length - 1] || '';
		dire('l\'etat du lecteur s\'ecrit dans le journal avec ce qui compte',
			sLigne.includes('[Player] sonde du banc •••') && sLigne.includes('readyState=')
			&& sLigne.includes('currentTime=') && sLigne.includes('buffered='));

		// ------------------------------------------------------------- La rediffusion.
		const nAvantArret = aPauses.length;
		dire('arreter le direct le dit', m_Controls.StopWatchingBroadcast() === true);
		dire('et passe en rediffusion', await attendre(() => etat() === STATE_REPEAT, 5000), `etat ${etat()}`);
		dire('en pause, sur ce qui etait en tampon', v.paused && v.buffered.length > 0);
		dire('la pause est annoncee', aPauses.slice(nAvantArret).includes(true));

		const nAvantLecture = aPauses.length;
		m_Player.TogglePause();
		dire('reprendre joue la rediffusion', await attendre(() => !v.paused, 3000));
		dire('et l\'annonce', aPauses.slice(nAvantLecture).join(',') === 'false');

		m_Player.SetReplaySpeed(2);
		dire('la vitesse de rediffusion s\'applique', v.playbackRate === 2);
		m_Player.SetReplaySpeed(1);

		m_Player.TogglePause();
		await attendre(() => v.paused, 3000);
		const nAvant = v.currentTime;
		m_Player.SeekReplayBy(false, -5);
		await attendre(() => !v.seeking, 3000);
		dire('reculer de cinq secondes recule de cinq secondes',
			Math.abs(nAvant - 5 - v.currentTime) < 0.3 || v.currentTime === v.buffered.start(0));
		const nDebut = v.buffered.start(0);
		m_Player.SeekReplayTo(nDebut);
		await attendre(() => !v.seeking, 3000);
		dire('se placer au debut reste dans ce qui est enregistre', v.currentTime >= nDebut - 0.01);
		m_Player.SeekReplayBy(false, 1e6);
		await attendre(() => !v.seeking, 3000);
		dire('aller trop loin s\'arrete a la fin de l\'enregistrement',
			v.currentTime <= v.buffered.end(v.buffered.length - 1) + 0.01);

		// -------------------------------------------------------- Reprendre le direct.
		const kEtats = aEtats.length;
		touche(32);
		dire('reprendre le direct repasse par le debut', await attendre(() => aEtats.slice(kEtats).includes(STATE_START), 3000));
		dire('et revient a la lecture', await attendre(() => etat() === STATE_PLAYING && !v.paused, 30000), `etat ${etat()}`);

		// ---------------------------------------------------------- Changer de qualite.
		const elMenu = document.getElementById('broadcastvariant');
		if (elMenu.options.length > 1) {
			const nAutre = elMenu.selectedIndex === 0 ? 1 : 0;
			const kEtats2 = aEtats.length;
			elMenu.selectedIndex = nAutre;
			elMenu.dispatchEvent(new Event('change'));
			dire('changer de qualite recharge le lecteur',
				await attendre(() => aEtats.slice(kEtats2).includes(STATE_LOADING), 15000));
			dire('et la lecture reprend dans la nouvelle', await attendre(() => etat() === STATE_PLAYING && !v.paused, 30000),
				`etat ${etat()}`);
		} else {
			dire('changer de qualite : une seule qualite sur cette chaine', false, 'choisir une autre chaine');
		}
	} catch (oErreur) {
		dire('la sonde va jusqu\'au bout', false, String((oErreur && oErreur.stack) || oErreur).slice(0, 300));
	} finally {
		m_Events.RemoveHandler('player-paused', fPause);
		m_Events.RemoveHandler('controls-statechanged', fEtat);
		for (const s of Object.keys(oReglages)) {
			m_Settings.Change(s, oReglages[s]);
		}
	}
	return JSON.stringify(verdicts);
})()
