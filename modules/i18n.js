"use strict";
/*
	Everything the player says to the viewer, in the viewer's language, and the formatting that goes
	with it: numbers, dates, durations, language names.

	**A missing key raises.** chrome.i18n.getMessage answers an empty string for a key that is not
	in messages.json, and an empty label is invisible: it goes unnoticed in testing and turns up in
	a user's screenshot three months later. So a key that answers nothing is an exception, which
	lands in the bug report like any other.

	**Messages carry markup** — 73 of them hold a tag, a link, a line break — so they are inserted,
	never assigned as text. The markup comes from a file of this repository, never from a remote
	source: that is what makes insertAdjacentHTML acceptable here and nowhere else.

	**data-i18n holds two keys, separated by "^"**: before it the body, after it the tooltip. Either
	half may be missing, and "^A0503" means tooltip only. TranslateDocument takes the document as an
	argument rather than assuming the current one, because it also translates the report's frame.

	**Dates are read in UTC.** An archive recorded at 23:30 UTC would be dated the next day for a
	viewer east of London and the same day for one west of it, and the two would not see the same
	broadcast date for the same broadcast.

	The two formatters are kept because Intl builds an expensive object: the statistics overlay asks
	for a formatted number several times a second.
*/
const m_i18n = (() => {
	const LANGUAGE_NAMES = {
		AR: 'العربية',
		ASE: 'American Sign Language',
		ASL: 'American Sign Language',
		BG: 'Български',
		CA: 'Català',
		CS: 'Čeština',
		DA: 'Dansk',
		DE: 'Deutsch',
		EL: 'Ελληνικά',
		EN: 'English',
		EN_GB: 'English (UK)',
		ES: 'Español',
		ES_MX: 'Español (Latinoamérica)',
		FI: 'Suomi',
		FR: 'Français',
		HI: 'हिन्दी',
		HU: 'Magyar',
		ID: 'Bahasa Indonesia',
		IT: 'Italiano',
		JA: '日本語',
		KO: '한국어',
		MS: 'بهاس ملايو',
		NL: 'Nederlands',
		NO: 'Norsk',
		PL: 'Polski',
		PT: 'Português',
		PT_BR: 'Português (Brasil)',
		RO: 'Română',
		RU: 'Русский',
		SK: 'Slovenčina',
		SV: 'Svenska',
		TH: 'ภาษาไทย',
		TL: 'Tagalog',
		TR: 'Türkçe',
		UK: 'Українська',
		VI: 'Tiếng Việt',
		ZH: '中文',
		ZH_HK: '中文（香港）',
		ZH_CN: '简体中文',
		ZH_TW: '繁體中文'
	};

	// Un formateur par nombre de decimales, et un seul pour les dates : Intl coute cher a construire.
	const _amNumberFormats = new Map();
	let _fFormatDate = null;

	// data-i18n="corps^infobulle" ; l'une des deux moities peut manquer.
	const TOOLTIP_SEPARATOR = '^';

	function GetMessage(sMessageName, sSubstitution) {
		Check(IsNonEmptyString(sMessageName));
		Check(sSubstitution === void 0 || typeof sSubstitution == 'string');
		const sMessageText = chrome.i18n.getMessage(sMessageName, sSubstitution);
		if (!sMessageText) {
			throw new Error(`Text not found ${sMessageName}`);
		}
		return sMessageText;
	}

	// Le balisage vient de messages.json, un fichier du depot.
	function InsertMessage(elInsertTo, sPosition, sMessageName) {
		elInsertTo.insertAdjacentHTML(sPosition, GetMessage(sMessageName));
	}

	function InsertAdjacentHtmlMessage(pInsertTo, sPosition, sMessageName) {
		const elInsertTo = GetNode(pInsertTo);
		if (sPosition === 'content') {
			// Fausse position : remplacer ce qu'il y a, plutot que de s'y ajouter.
			elInsertTo.textContent = '';
			sPosition = 'beforeend';
		}
		InsertMessage(elInsertTo, sPosition, sMessageName);
		return elInsertTo;
	}

	function TranslateDocument(oDocument) {
		m_Log.Here('[i18n] Translating document');
		for (const elTranslate of oDocument.querySelectorAll('[data-i18n]')) {
			const sNames = elTranslate.getAttribute('data-i18n');
			const nSeparator = sNames.indexOf(TOOLTIP_SEPARATOR);
			if (nSeparator !== 0) {
				InsertMessage(elTranslate, 'afterbegin',
					nSeparator === -1 ? sNames : sNames.slice(0, nSeparator));
			}
			if (nSeparator !== -1) {
				elTranslate.title = GetMessage(sNames.slice(nSeparator + 1));
			}
		}
	}

	function FormatNumber(pNumber, nDecimalPlaces) {
		Check(nDecimalPlaces === void 0 || typeof nDecimalPlaces == 'number' && nDecimalPlaces >= 0);
		let fFormat = _amNumberFormats.get(nDecimalPlaces);
		if (!fFormat) {
			fFormat = new Intl.NumberFormat([], nDecimalPlaces === void 0 ? void 0 : {
				minimumFractionDigits: nDecimalPlaces,
				maximumFractionDigits: nDecimalPlaces
			}).format;
			_amNumberFormats.set(nDecimalPlaces, fFormat);
		}
		return fFormat(pNumber);
	}

	function FormatDate(pDate) {
		Check(Number.isFinite(pDate) || Number.isFinite(pDate.getTime()));
		if (!_fFormatDate) {
			_fFormatDate = new Intl.DateTimeFormat([], {
				timeZone: 'UTC'
			}).format;
		}
		return _fFormatDate(pDate);
	}

	/*
		« 12 : 05 : 07 ». Les heures ne bouclent pas a vingt-quatre : une rediffusion de trente
		heures s'affiche « 30 : 00 », pas « 06 : 00 ».
	*/
	function SecondsToString(nSeconds, bNeedSeconds) {
		const AfterSeparator = (nValue) => (nValue < 10 ? ' : 0' : ' : ') + nValue;
		const nHours = Math.floor(nSeconds / 60 / 60);
		const nMinutes = Math.floor(nSeconds / 60 % 60);
		const sTime = nHours + AfterSeparator(nMinutes);
		return bNeedSeconds ? sTime + AfterSeparator(Math.floor(nSeconds % 60)) : sTime;
	}

	// Twitch rend un code de langue ; le spectateur lit un nom, dans cette langue-la.
	function GetLanguageName(sLanguageCode) {
		const sLanguageName = LANGUAGE_NAMES[sLanguageCode.toUpperCase()];
		if (!sLanguageName) {
			throw new Error(`Unknown language code: ${sLanguageCode}`);
		}
		return sLanguageName;
	}

	return {
		GetMessage,
		InsertAdjacentHtmlMessage,
		TranslateDocument,
		FormatNumber,
		FormatDate,
		SecondsToString,
		GetLanguageName
	};
})();
