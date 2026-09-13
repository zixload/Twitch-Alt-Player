'use strict';

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
	const _amFormatNumber = new Map();
	let _fFormatDate = null;
	function GetMessage(sMessageName, sSubstitution) {
		Check(IsNonEmptyString(sMessageName));
		Check(sSubstitution === void 0 || typeof sSubstitution == 'string');
		const sMessageText = chrome.i18n.getMessage(sMessageName, sSubstitution);
		if (!sMessageText) {
			throw new Error(`Text not found ${sMessageName}`);
		}
		return sMessageText;
	}
	function FastInsertAdjacentHtmlMessage(elInsertTo, sPosition, sMessageName) {
		
		//! HTML content is taken from the file messages.json. See GetMessage().
		elInsertTo.insertAdjacentHTML(sPosition, GetMessage(sMessageName));
	}
	function InsertAdjacentHtmlMessage(vInsertTo, sPosition, sMessageName) {
		const elInsertTo = GetNode(vInsertTo);
		// const elInsertTo = Node(vInsertTo);
		if (sPosition === 'content') {
			sPosition = 'beforeend';
			elInsertTo.textContent = '';
		}
		FastInsertAdjacentHtmlMessage(elInsertTo, sPosition, sMessageName);
		return elInsertTo;
	}
	function TranslateDocument(oDocument) {
		m_Log.Here('[i18n] Translating document');
		for (let elTranslate, celTranslate = oDocument.querySelectorAll('*[data-i18n]'), i = 0; elTranslate = celTranslate[i]; ++i) {
			const sNames = elTranslate.getAttribute('data-i18n');
			const sNamesDelimiter = sNames.indexOf('^');
			if (sNamesDelimiter !== 0) {
				FastInsertAdjacentHtmlMessage(elTranslate, 'afterbegin', sNamesDelimiter === -1 ? sNames : sNames.slice(0, sNamesDelimiter));
			}
			if (sNamesDelimiter !== -1) {
				elTranslate.title = GetMessage(sNames.slice(sNamesDelimiter + 1));
			}
		}
	}
	function FormatNumber(pNumber, nDecimalPlaces) {
		Check(nDecimalPlaces === void 0 || typeof nDecimalPlaces == 'number' && nDecimalPlaces >= 0);
		let fFormat = _amFormatNumber.get(nDecimalPlaces);
		if (!fFormat) {
			fFormat = new Intl.NumberFormat([], nDecimalPlaces === void 0 ? void 0 : {
				minimumFractionDigits: nDecimalPlaces,
				maximumFractionDigits: nDecimalPlaces
			}).format;
			_amFormatNumber.set(nDecimalPlaces, fFormat);
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
	function SecondsToString(nSeconds, bNeedSeconds) {
		let h = Math.floor(nSeconds / 60 % 60);
		let sTime = Math.floor(nSeconds / 60 / 60) + (h < 10 ? ' : 0' : ' : ') + h;
		// let s = Math.floor(nSeconds / 60 / 60) + (h < 10 ? ' : 0' : ' : ') + h;
		if (bNeedSeconds) {
			h = Math.floor(nSeconds % 60);
			sTime += (h < 10 ? ' : 0' : ' : ') + h;
			// s += (h < 10 ? ' : 0' : ' : ') + h;
		}
		return sTime;
		// return s;
	}
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
