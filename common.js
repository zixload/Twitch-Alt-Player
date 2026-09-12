'use strict';

const THIS_IS_CONTENT_SCRIPT = !document.currentScript;
// const THIS_IS_CONTENT_SCRIPT = !document.currentScript;

const DO_NOT_REDIRECT_ADDRESS = 'twitch5=0';
// const DO_NOT_REDIRECT_ADDRESS = 'twitch5=0';

const LEFT_BUTTON = 0;
// const LEFT_BUTTON = 0;

const MIDDLE_BUTTON = 1;
// const MIDDLE_BUTTON = 1;

const RIGHT_BUTTON = 2;
// const RIGHT_BUTTON = 2;

const LEFT_BUTTON_PRESSED = 1;
// const LEFT_BUTTON_PRESSED = 1;

const RIGHT_BUTTON_PRESSED = 2;
// const RIGHT_BUTTON_PRESSED = 2;

const MIDDLE_BUTTON_PRESSED = 4;
// const MIDDLE_BUTTON_PRESSED = 4;

const PASSIVE_HANDLER = {
// const PASSIVE_HANDLER = {
	passive: true
};

const MIN_SETTING_VALUE = Number.MIN_SAFE_INTEGER + 1e3;
// const MIN_SETTING_VALUE = Number.MIN_SAFE_INTEGER + 1e3;

const MAX_SETTING_VALUE = Number.MAX_SAFE_INTEGER - 1e3;
// const MAX_SETTING_VALUE = Number.MAX_SAFE_INTEGER - 1e3;

const AUTO_SETTING = Number.MIN_SAFE_INTEGER;
// const AUTO_ADJUSTMENT = Number.MIN_SAFE_INTEGER;

const MIN_VOLUME = 1;
// const MIN_VOLUME = 1;

const MAX_VOLUME = 100;
// const MAX_VOLUME = 100;

const VOLUME_INCREASE_STEP_BY_KEY = 4;
// const VOLUME_INCREASE_STEP_BY_KEY = 4;

const VOLUME_DECREASE_STEP_BY_KEY = 2;
// const VOLUME_DECREASE_STEP_BY_KEY = 2;

const CHAT_UNLOADED = 0;
// const CHAT_UNLOADED = 0;

const CHAT_HIDDEN = 1;
// const CHAT_HIDDEN = 1;

const CHAT_PANEL = 2;
// const CHAT_PANEL = 2;

const TOP_SIDE = 1;
// const TOP_SIDE = 1;

const RIGHT_SIDE = 2;
// const RIGHT_SIDE = 2;

const BOTTOM_SIDE = 3;
// const BOTTOM_SIDE = 3;

const LEFT_SIDE = 4;
// const LEFT_SIDE = 4;

const MIN_REPEAT_DURATION = 30;
// const MIN_REPEAT_DURATION = 30;

const MAX_REPEAT_DURATION = 300;
// const MAX_REPEAT_DURATION = 300;

const MIN_BUFFER_SIZE = 1.5;
// const MIN_BUFFER_SIZE = 1.5;

const MAX_BUFFER_SIZE = 30;
// const MAX_BUFFER_SIZE = 30;

const MIN_BUFFER_STRETCH = 9;
// const MIN_BUFFER_STRETCH = 9;

const MAX_BUFFER_STRETCH = 30;
// const MAX_BUFFER_STRETCH = 30;

const BUFFER_OVERFLOW = MAX_BUFFER_SIZE + MAX_BUFFER_STRETCH;
// const BUFFER_OVERFLOW = MAX_BUFFER_SIZE + MAX_BUFFER_STRETCH;

let g_bWorkFinished = false;
// let g_bWorkFinished = false;

if (!NodeList.prototype[Symbol.iterator]) {
	NodeList.prototype[Symbol.iterator] = Array.prototype[Symbol.iterator];
}

if (!HTMLCollection.prototype[Symbol.iterator]) {
	HTMLCollection.prototype[Symbol.iterator] = Array.prototype[Symbol.iterator];
}

if (!THIS_IS_CONTENT_SCRIPT && !window.PointerEvent) {
// if (!THIS_IS_CONTENT_SCRIPT && !window.PointerEvent) {
	const nodeScript = document.createElement('script');
	// const nodeScript = document.createElement('script');
	nodeScript.src = 'pointerevent.js';
	// nodeScript.src = 'pointerevent.js';
	document.currentScript.parentNode.appendChild(nodeScript);
	// document.currentScript.parentNode.appendChild(nodeScript);
}

const STUB = () => {};
// const STUB = () => {};

function Check(pCondition) {
// function Check(pCondition) {
	if (!pCondition) {
	// if (!pCondition) {
		throw new Error('Проверка не пройдена');
		// throw new Error('Check failed');
	}
}

function AddExceptionHandler(fFunction) {
// function AddExceptionHandler(fFunction) {
	return function() {
		if (g_bWorkFinished) {
		// if (g_bWorkFinished) {
			return;
		}
		try {
			return fFunction.apply(this, arguments);
			// return fFunction.apply(this, arguments);
		} catch (pException) {
		// } catch (pException) {
			m_Debug.CaughtException(pException);
			// m_Debug.CaughtException(pException);
		}
	};
}

function ExceptionToString(pException) {
// function ExceptionToString(pException) {
	return pException instanceof Error ? pException.stack : `[typeof ${typeof pException}] ${new Error(pException).stack}`;
	// return pException instanceof Error ? pException.stack : `[typeof ${typeof pException}] ${new Error(pException).stack}`;
}

function Type(pValue) {
// function Type(pValue) {
	return pValue === null ? 'null' : typeof pValue;
	// return pValue === null ? 'null' : typeof pValue;
}

function IsNumber(pValue) {
// function IsNumber(pValue) {
	return typeof pValue == 'number' && pValue == pValue;
	// return typeof pValue == 'number' && pValue == pValue;
}

function IsObject(pValue) {
// function IsObject(pValue) {
	return typeof pValue == 'object' && pValue !== null;
	// return typeof pValue == 'object' && pValue !== null;
}

function IsNonEmptyString(pValue) {
// function IsNonEmptyString(pValue) {
	return typeof pValue == 'string' && pValue !== '';
	// return typeof pValue == 'string' && pValue !== '';
}

function LimitStringLength(sString, nMaxLength) {
// function LimitStringLength(sString, nMaxLength) {
	return sString.length <= nMaxLength ? sString : `${sString.slice(0, nMaxLength)}---8<---${sString.length - nMaxLength}`;
	// return sString.length <= nMaxLength ? sString : `${sString.slice(0, nMaxLength)}---8<---${sString.length - nMaxLength}`;
}

function getBrowserEngineVersion() {
// function getBrowserEngineVersion() {
	if (!getBrowserEngineVersion._чРезультат) {
	// if (!getBrowserEngineVersion._nResult) {
		if (navigator.userAgentData) {
			for (const {brand, version} of navigator.userAgentData.brands) {
				if (brand === 'Chromium' || brand === 'Google Chrome') {
					getBrowserEngineVersion._чРезультат = Number.parseInt(version, 10);
					// getBrowserEngineVersion._nResult = Number.parseInt(version, 10);
					break;
				}
			}
		}
		if (!getBrowserEngineVersion._чРезультат) {
		// if (!getBrowserEngineVersion._nResult) {
			getBrowserEngineVersion._чРезультат = Number(/Chrome\/(\d+)/.exec(navigator.userAgent)[1]);
			// getBrowserEngineVersion._nResult = Number(/Chrome\/(\d+)/.exec(navigator.userAgent)[1]);
		}
	}
	return getBrowserEngineVersion._чРезультат;
	// return getBrowserEngineVersion._nResult;
}

function isMobileDevice() {
// function isMobileDevice() {
	if (!isMobileDevice.hasOwnProperty('_лРезультат')) {
	// if (!isMobileDevice.hasOwnProperty('_bResult')) {
		isMobileDevice._лРезультат = navigator.userAgentData ? navigator.userAgentData.mobile : navigator.userAgent.includes('Android');
		// isMobileDevice._bResult = navigator.userAgentData ? navigator.userAgentData.mobile : navigator.userAgent.includes('Android');
	}
	return isMobileDevice._лРезультат;
	// return isMobileDevice._bResult;
}

function GetNode(pElement) {
// function Node(pElement) {
	const elElement = typeof pElement == 'string' ? document.getElementById(pElement) : pElement;
	// const elElement = typeof pElement == 'string' ? document.getElementById(pElement) : pElement;
	Check(elElement.nodeType === 1);
	// Check(elElement.nodeType === 1);
	return elElement;
	// return elElement;
}

function createGqlRequestBody(sQuery, oVariables) {
// function createGqlRequestBody(sQuery, oVariables) {
	Check(IsNonEmptyString(sQuery) && IsObject(oVariables));
	// Check(IsNonEmptyString(sQuery) && IsObject(oVariables));
	return `{"query":${JSON.stringify(sQuery)},"variables":${JSON.stringify(oVariables)}}`;
	// return `{"query":${JSON.stringify(sQuery)},"variables":${JSON.stringify(oVariables)}}`;
}

function combineGqlRequests(msRequestBodies) {
// function combineGqlRequests(msRequestBodies) {
	Check(msRequestBodies[0][0] === '{');
	// Check(msRequestBodies[0][0] === '{');
	return `[${msRequestBodies.join(',')}]`;
	// return `[${msRequestBodies.join(',')}]`;
}

function GetOurPlayerAddress(sChannelCode) {
// function GetOurPlayerAddress(sChannelCode) {
	const sParameters = '?channel=' + encodeURIComponent(sChannelCode);
	// const sParameters = '?channel=' + encodeURIComponent(sChannelCode);
	return chrome.runtime.getURL('player.html') + sParameters;
	// return chrome.runtime.getURL('player.html') + sParameters;
}

const m_Log = (() => {
// const m_Log = (() => {
	const MAX_RECORD_LENGTH = 1500;
	// const MAX_RECORD_LENGTH = 1500;
	let _msLog = null;
	// let _msLog = null;
	let _nLastRecord = -1;
	// let _nLastRecord = -1;
	function Add(sImportance, sRecord) {
	// function Add(sImportance, sRecord) {
		if (_msLog) {
		// if (_msLog) {
			Check(typeof sImportance == 'string' && typeof sRecord == 'string');
			// Check(typeof sImportance == 'string' && typeof sRecord == 'string');
			sRecord = LimitStringLength(`${sImportance} ${(performance.now() / 1e3).toFixed(3)} ${sRecord}`, MAX_RECORD_LENGTH);
			// sRecord = LimitStringLength(`${sImportance} ${(performance.now() / 1e3).toFixed(3)} ${sRecord}`, MAX_RECORD_LENGTH);
			if (++_nLastRecord === _msLog.length) {
			// if (++_nLastRecord === _msLog.length) {
				_nLastRecord = 0;
				// _nLastRecord = 0;
			}
			_msLog[_nLastRecord] = sRecord;
			// _msLog[_nLastRecord] = sRecord;
		}
	}
	function GetDataForReport() {
	// function GetDataForReport() {
		if (!_msLog) {
		// if (!_msLog) {
			return null;
		}
		const nNextRecord = _nLastRecord + 1;
		// const nNextRecord = _nLastRecord + 1;
		if (nNextRecord === _msLog.length) {
		// if (nNextRecord === _msLog.length) {
			return _msLog;
			// return _msLog;
		}
		if (_msLog[nNextRecord] === void 0) {
		// if (_msLog[nNextRecord] === void 0) {
			return _msLog.slice(0, nNextRecord);
			// return _msLog.slice(0, nNextRecord);
		}
		return _msLog.slice(nNextRecord).concat(_msLog.slice(0, nNextRecord));
		// return _msLog.slice(nNextRecord).concat(_msLog.slice(0, nNextRecord));
	}
	function Вот(sRecord) {
	// function Here(sRecord) {
		Check(arguments.length === 1);
		// Check(arguments.length === 1);
		Add(' ', sRecord);
		// Add(' ', sRecord);
	}
	function Окак(sRecord) {
	// function Wow(sRecord) {
		Check(arguments.length === 1);
		// Check(arguments.length === 1);
		Add('~', sRecord);
		// Add('~', sRecord);
	}
	function Ой(sRecord) {
	// function Oops(sRecord) {
		Check(arguments.length === 1);
		// Check(arguments.length === 1);
		Add('@', sRecord);
		// Add('@', sRecord);
	}
	function O(pObject) {
	// function O(pObject) {
		switch (Type(pObject)) {
		// switch (Type(pObject)) {
		  case 'object':
			return JSON.stringify(pObject);
			// return JSON.stringify(pObject);

		  case 'function':
			return `[function ${pObject.name}]`;
			// return `[function ${pObject.name}]`;

		  case 'symbol':
			return '[symbol]';

		  default:
			return String(pObject);
			// return String(pObject);
		}
	}
	function F(nPrecision) {
	// function F(nPrecision) {
		return nValue => typeof nValue == 'number' ? nValue.toFixed(nPrecision) : 'NaN';
		// return nValue => typeof nValue == 'number' ? nValue.toFixed(nPrecision) : 'NaN';
	}
	if (!THIS_IS_CONTENT_SCRIPT) {
	// if (!THIS_IS_CONTENT_SCRIPT) {
		_msLog = new Array(1500);
		// _msLog = new Array(1500);
		Вот(`[Журнал] Журнал запущен ${performance.now().toFixed()}мс`);
		// Here(`[Log] Log started ${performance.now().toFixed()}ms`);
	}
	return {
		Вот,
		// Here,
		Окак,
		// Wow,
		Ой,
		// Oops,
		O,
		F0: F(0),
		F1: F(1),
		F2: F(2),
		F3: F(3),
		GetDataForReport
		// GetDataForReport
	};
})();

const m_i18n = (() => {
// const m_i18n = (() => {
	const LANGUAGE_NAMES = {
	// const LANGUAGE_NAMES = {
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
	// const _amFormatNumber = new Map();
	let _fFormatDate = null;
	// let _fFormatDate = null;
	function GetMessage(sMessageName, sSubstitution) {
		Check(IsNonEmptyString(sMessageName));
		// Check(IsNonEmptyString(sMessageName));
		Check(sSubstitution === void 0 || typeof sSubstitution == 'string');
		// Check(sSubstitution === void 0 || typeof sSubstitution == 'string');
		const sMessageText = chrome.i18n.getMessage(sMessageName, sSubstitution);
		if (!sMessageText) {
			throw new Error(`Не найден текст ${sMessageName}`);
			// throw new Error(`Text not found ${sMessageName}`);
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
	// function TranslateDocument(oDocument) {
		m_Log.Вот('[i18n] Перевод документа');
		// m_Log.Here('[i18n] Translating document');
		for (let elTranslate, celTranslate = oDocument.querySelectorAll('*[data-i18n]'), i = 0; elTranslate = celTranslate[i]; ++i) {
		// for (let elTranslate, celTranslate = oDocument.querySelectorAll('*[data-i18n]'), i = 0; elTranslate = celTranslate[i]; ++i) {
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
	// function FormatNumber(pNumber, nDecimalPlaces) {
		Check(nDecimalPlaces === void 0 || typeof nDecimalPlaces == 'number' && nDecimalPlaces >= 0);
		// Check(nDecimalPlaces === void 0 || typeof nDecimalPlaces == 'number' && nDecimalPlaces >= 0);
		let fFormat = _amFormatNumber.get(nDecimalPlaces);
		// let fFormat = _amFormatNumber.get(nDecimalPlaces);
		if (!fFormat) {
		// if (!fFormat) {
			fFormat = new Intl.NumberFormat([], nDecimalPlaces === void 0 ? void 0 : {
			// fFormat = new Intl.NumberFormat([], nDecimalPlaces === void 0 ? void 0 : {
				minimumFractionDigits: nDecimalPlaces,
				// minimumFractionDigits: nDecimalPlaces,
				maximumFractionDigits: nDecimalPlaces
				// maximumFractionDigits: nDecimalPlaces
			}).format;
			_amFormatNumber.set(nDecimalPlaces, fFormat);
			// _amFormatNumber.set(nDecimalPlaces, fFormat);
		}
		return fFormat(pNumber);
		// return fFormat(pNumber);
	}
	function FormatDate(pDate) {
	// function FormatDate(pDate) {
		Check(Number.isFinite(pDate) || Number.isFinite(pDate.getTime()));
		// Check(Number.isFinite(pDate) || Number.isFinite(pDate.getTime()));
		if (!_fFormatDate) {
		// if (!_fFormatDate) {
			_fFormatDate = new Intl.DateTimeFormat([], {
			// _fFormatDate = new Intl.DateTimeFormat([], {
				timeZone: 'UTC'
			}).format;
		}
		return _fFormatDate(pDate);
		// return _fFormatDate(pDate);
	}
	function SecondsToString(nSeconds, bNeedSeconds) {
	// function SecondsToString(nSeconds, bNeedSeconds) {
		let h = Math.floor(nSeconds / 60 % 60);
		// let h = Math.floor(nSeconds / 60 % 60);
		let с = Math.floor(nSeconds / 60 / 60) + (h < 10 ? ' : 0' : ' : ') + h;
		// let s = Math.floor(nSeconds / 60 / 60) + (h < 10 ? ' : 0' : ' : ') + h;
		if (bNeedSeconds) {
		// if (bNeedSeconds) {
			h = Math.floor(nSeconds % 60);
			// h = Math.floor(nSeconds % 60);
			с += (h < 10 ? ' : 0' : ' : ') + h;
			// s += (h < 10 ? ' : 0' : ' : ') + h;
		}
		return с;
		// return s;
	}
	function GetLanguageName(sLanguageCode) {
	// function GetLanguageName(sLanguageCode) {
		const sLanguageName = LANGUAGE_NAMES[sLanguageCode.toUpperCase()];
		// const sLanguageName = LANGUAGE_NAMES[sLanguageCode.toUpperCase()];
		if (!sLanguageName) {
		// if (!sLanguageName) {
			throw new Error(`Неизвестный код языка: ${sLanguageCode}`);
			// throw new Error(`Unknown language code: ${sLanguageCode}`);
		}
		return sLanguageName;
		// return sLanguageName;
	}
	return {
		GetMessage,
		InsertAdjacentHtmlMessage,
		TranslateDocument,
		FormatNumber,
		// FormatNumber,
		FormatDate,
		// FormatDate,
		SecondsToString,
		// SecondsToString,
		GetLanguageName
		// GetLanguageName
	};
})();

const m_Settings = (() => {
// const m_Settings = (() => {
	const SETTINGS_VERSION = 2;
	// const SETTINGS_VERSION = 2;
	const _amBufferingPresets = new Map([ [ 'J0126', {
	// const _amBufferingPresets = new Map([ [ 'J0126', {
		кОдновременныхЗагрузок: 1,
		// nConcurrentDownloads: 1,
		чНачалоВоспроизведения: 3,
		// nPlaybackStart: 3,
		чРазмерБуфера: 5,
		// nBufferSize: 5,
		чРастягиваниеБуфера: 15
		// nBufferStretch: 15
	} ], [ 'J0127', {
		кОдновременныхЗагрузок: 2,
		// nConcurrentDownloads: 2,
		чНачалоВоспроизведения: 3,
		// nPlaybackStart: 3,
		чРазмерБуфера: 8.5,
		// nBufferSize: 8.5,
		чРастягиваниеБуфера: 20
		// nBufferStretch: 20
	} ], [ 'J0128', {
		кОдновременныхЗагрузок: 2,
		// nConcurrentDownloads: 2,
		чНачалоВоспроизведения: 17,
		// nPlaybackStart: 17,
		чРазмерБуфера: 9.5,
		// nBufferSize: 9.5,
		чРастягиваниеБуфера: 30
		// nBufferStretch: 30
	} ] ]);
	const _amAppearancePresets = new Map([ [ 'J0122', {
	// const _amAppearancePresets = new Map([ [ 'J0122', {
		сЦветФона: '#282828',
		// sBackgroundColor: '#282828',
		сЦветГрадиента: '#d4d4d4',
		// sGradientColor: '#d4d4d4',
		сЦветКнопок: '#d3be96',
		// sButtonColor: '#d3be96',
		сЦветЗаголовка: '#cdbdec',
		// sHeaderColor: '#cdbdec',
		сЦветВыделения: '#ffd862',
		// sHighlightColor: '#ffd862',
		чПрозрачность: 25
		// nOpacity: 25
	} ], [ 'J0121', {
		сЦветФона: '#405b77',
		// sBackgroundColor: '#405b77',
		сЦветГрадиента: '#aaccf2',
		// sGradientColor: '#aaccf2',
		сЦветКнопок: '#ffffff',
		// sButtonColor: '#ffffff',
		сЦветЗаголовка: '#c2e4ff',
		// sHeaderColor: '#c2e4ff',
		сЦветВыделения: '#fef17c',
		// sHighlightColor: '#fef17c',
		чПрозрачность: 30
		// nOpacity: 30
	} ], [ 'J0138', {
		сЦветФона: '#4b4b4b',
		// sBackgroundColor: '#4b4b4b',
		сЦветГрадиента: '#aaaaaa',
		// sGradientColor: '#aaaaaa',
		сЦветКнопок: '#bad4f8',
		// sButtonColor: '#bad4f8',
		сЦветЗаголовка: '#e2ebb4',
		// sHeaderColor: '#e2ebb4',
		сЦветВыделения: '#75a9f0',
		// sHighlightColor: '#75a9f0',
		чПрозрачность: 5
		// nOpacity: 5
	} ], [ 'J0125', {
		сЦветФона: '#161616',
		// sBackgroundColor: '#161616',
		сЦветГрадиента: '#a0a0a0',
		// sGradientColor: '#a0a0a0',
		сЦветКнопок: '#f0f0f0',
		// sButtonColor: '#f0f0f0',
		сЦветЗаголовка: '#baccda',
		// sHeaderColor: '#baccda',
		сЦветВыделения: '#6cb6ff',
		// sHighlightColor: '#6cb6ff',
		чПрозрачность: 20
		// nOpacity: 20
	} ] ]);
	const _moPresetMetadata = [ {
	// const _moPresetMetadata = [ {
		amData: _amBufferingPresets,
		// amData: _amBufferingPresets,
		sCustomizable: 'J0129',
		// sCustomizable: 'J0129',
		sSelected: 'сПредустановкаВыбрана_буферизация',
		// sSelected: 'sPresetSelected_buffering',
		sFilled: 'лПредустановкаЗаполнена_буферизация',
		// sFilled: 'bPresetFilled_buffering',
		sList: 'preset-buffering',
		// sList: 'preset-buffering',
		sEvent: 'настройки-измениласьпредустановка-буферизация'
		// sEvent: 'settings-presetChanged-buffering'
	}, {
		amData: _amAppearancePresets,
		// amData: _amAppearancePresets,
		sCustomizable: 'J0123',
		// sCustomizable: 'J0123',
		sSelected: 'сПредустановкаВыбрана_оформление',
		// sSelected: 'sPresetSelected_appearance',
		sFilled: 'лПредустановкаЗаполнена_оформление',
		// sFilled: 'bPresetFilled_appearance',
		sList: 'preset-appearance',
		// sList: 'preset-appearance',
		sEvent: 'настройки-измениласьпредустановка-оформление'
		// sEvent: 'settings-presetChanged-appearance'
	} ];
	const _mnoPermanentSettings = new Set([ 'чВерсияНастроек', 'чСлучайноеЧисло', 'сПредыдущаяВерсия', 'чПоследняяПроверкаОбновленияРасширения', 'лАвтоперенаправлениеЗамечено' ]);
	// const _mnoPermanentSettings = new Set([ 'nSettingsVersion', 'nRandomNumber', 'sPreviousVersion', 'nLastExtensionUpdateCheck', 'bAutoredirectNoticed' ]);
	const _mnoDoNotShow = new Set();
	// const _mnoDoNotShow = new Set();
	class Setting {
	// class Setting {
		constructor(pInitial, mpEnumeration, nMinimum, nMaximum, sAutoTune) {
		// constructor(pInitial, mpEnumeration, nMinimum, nMaximum, sAutoTune) {
			this.pCurrent = void 0;
			// this.pCurrent = void 0;
			this.pInitial = pInitial;
			// this.pInitial = pInitial;
			this.mpEnumeration = mpEnumeration;
			// this.mpEnumeration = mpEnumeration;
			this.nMinimum = nMinimum;
			// this.nMinimum = nMinimum;
			this.nMaximum = nMaximum;
			// this.nMaximum = nMaximum;
			this.sAutoTune = sAutoTune;
			// this.sAutoTune = sAutoTune;
		}
		static Create(pInitial) {
		// static Create(pInitial) {
			return new this(pInitial, null, MIN_SETTING_VALUE, MAX_SETTING_VALUE, '');
			// return new this(pInitial, null, MIN_SETTING_VALUE, MAX_SETTING_VALUE, '');
		}
		static CreateEnum(pInitial, mpEnumeration) {
		// static CreateEnumeration(pInitial, mpEnumeration) {
			return new this(pInitial, mpEnumeration, MIN_SETTING_VALUE, MAX_SETTING_VALUE, '');
			// return new this(pInitial, mpEnumeration, MIN_SETTING_VALUE, MAX_SETTING_VALUE, '');
		}
		static CreateRange(pInitial, nMinimum, nMaximum, sAutoTune = '') {
		// static CreateRange(pInitial, nMinimum, nMaximum, sAutoTune = '') {
			return new this(pInitial, null, nMinimum, nMaximum, sAutoTune);
			// return new this(pInitial, null, nMinimum, nMaximum, sAutoTune);
		}
		static CheckValue(pValue) {
		// static CheckValue(pValue) {
			Check(pValue == pValue && pValue !== Infinity && pValue !== -Infinity && pValue !== void 0 && typeof pValue != 'function' && typeof pValue != 'symbol' && typeof pValue != 'object');
			// Check(pValue == pValue && pValue !== Infinity && pValue !== -Infinity && pValue !== void 0 && typeof pValue != 'function' && typeof pValue != 'symbol' && typeof pValue != 'object');
		}
		CorrectValue(pValue) {
		// CorrectValue(pValue) {
			Setting.CheckValue(pValue);
			// Setting.CheckValue(pValue);
			Check(typeof pValue == typeof this.pInitial);
			// Check(typeof pValue == typeof this.pInitial);
			if (this.mpEnumeration) {
			// if (this.mpEnumeration) {
				if (!this.mpEnumeration.includes(pValue)) {
				// if (!this.mpEnumeration.includes(pValue)) {
					pValue = this.pInitial;
					// pValue = this.pInitial;
				}
			} else if (typeof pValue == 'number') {
			// } else if (typeof pValue == 'number') {
				if (pValue === AUTO_SETTING) {
				// if (pValue === AUTO_TUNE) {
					if (this.sAutoTune === '') {
					// if (this.sAutoTune === '') {
						pValue = this.pInitial;
						// pValue = this.pInitial;
					}
				} else if (pValue < this.nMinimum) {
				// } else if (pValue < this.nMinimum) {
					pValue = this.nMinimum;
					// pValue = this.nMinimum;
				} else if (pValue > this.nMaximum) {
				// } else if (pValue > this.nMaximum) {
					pValue = this.nMaximum;
					// pValue = this.nMaximum;
				}
			}
			return pValue;
			// return pValue;
		}
	}
	const _oSettings = {
	// const _oSettings = {
		чВерсияНастроек: Setting.Create(SETTINGS_VERSION),
		// nSettingsVersion: Setting.Create(SETTINGS_VERSION),
		чСлучайноеЧисло: Setting.Create(Math.random()),
		// nRandomNumber: Setting.Create(Math.random()),
		сПредыдущаяВерсия: Setting.Create('2000.1.1'),
		// sPreviousVersion: Setting.Create('2000.1.1'),
		чПоследняяПроверкаОбновленияРасширения: Setting.Create(0),
		// nLastExtensionUpdateCheck: Setting.Create(0),
		чГромкость2: Setting.CreateRange(MAX_VOLUME / 2, MIN_VOLUME, MAX_VOLUME),
		// nVolume2: Setting.CreateRange(MAX_VOLUME / 2, MIN_VOLUME, MAX_VOLUME),
		лПриглушить: Setting.Create(false),
		// bMute: Setting.Create(false),
		сИдАудиоустройства: Setting.Create(''),
		// sAudioDeviceId: Setting.Create(''),
		сНазваниеВарианта: Setting.Create('CoolCmd'),
		// sVariantName: Setting.Create('CoolCmd'),
		чБитрейтВарианта: Setting.Create(MAX_SETTING_VALUE),
		// nVariantBitrate: Setting.Create(MAX_SETTING_VALUE),
		чДлительностьПовтора2: Setting.CreateRange(60, MIN_REPEAT_DURATION, MAX_REPEAT_DURATION, 'J0124'),
		// nRepeatDuration2: Setting.CreateRange(60, MIN_REPEAT_DURATION, MAX_REPEAT_DURATION, 'J0124'),
		лМасштабироватьИзображение: Setting.Create(true),
		// bScaleImage: Setting.Create(true),
		чСостояниеЧата: Setting.CreateEnum(CHAT_UNLOADED, [ CHAT_UNLOADED, CHAT_HIDDEN, CHAT_PANEL ]),
		// nChatState: Setting.CreateEnum(CHAT_UNLOADED, [ CHAT_UNLOADED, CHAT_HIDDEN, CHAT_PANEL ]),
		чСостояниеЗакрытогоЧата: Setting.CreateEnum(CHAT_UNLOADED, [ CHAT_UNLOADED, CHAT_HIDDEN ]),
		// nClosedChatState: Setting.CreateEnum(CHAT_UNLOADED, [ CHAT_UNLOADED, CHAT_HIDDEN ]),
		лАвтоПоложениеЧата: Setting.Create(isMobileDevice()),
		// bAutoChatPosition: Setting.Create(isMobileDevice()),
		чГоризонтальноеПоложениеЧата: Setting.CreateEnum(RIGHT_SIDE, [ RIGHT_SIDE, LEFT_SIDE ]),
		// nHorizontalChatPosition: Setting.CreateEnum(RIGHT_SIDE, [ RIGHT_SIDE, LEFT_SIDE ]),
		чВертикальноеПоложениеЧата: Setting.CreateEnum(BOTTOM_SIDE, [ TOP_SIDE, BOTTOM_SIDE ]),
		// nVerticalChatPosition: Setting.CreateEnum(BOTTOM_SIDE, [ TOP_SIDE, BOTTOM_SIDE ]),
		чПоложениеПанелиЧата: Setting.CreateEnum(RIGHT_SIDE, [ TOP_SIDE, RIGHT_SIDE, BOTTOM_SIDE, LEFT_SIDE ]),
		// nChatPanelPosition: Setting.CreateEnum(RIGHT_SIDE, [ TOP_SIDE, RIGHT_SIDE, BOTTOM_SIDE, LEFT_SIDE ]),
		чШиринаПанелиЧата: Setting.CreateRange(340, 100, MAX_SETTING_VALUE),
		// nChatPanelWidth: Setting.CreateRange(340, 100, MAX_SETTING_VALUE),
		чВысотаПанелиЧата: Setting.CreateRange(250, 100, MAX_SETTING_VALUE),
		// nChatPanelHeight: Setting.CreateRange(250, 100, MAX_SETTING_VALUE),
		лПолноценныйЧат: Setting.Create(true),
		// bFullFeaturedChat: Setting.Create(true),
		лЗатемнитьЧат: Setting.Create(false),
		// bDimChat: Setting.Create(false),
		чРазмерИнтерфейса: Setting.CreateRange(isMobileDevice() ? 115 : 100, 50, 200),
		// nInterfaceSize: Setting.CreateRange(isMobileDevice() ? 115 : 100, 50, 200),
		чИнтервалАвтоскрытия: Setting.CreateRange(4, .5, 60),
		// nAutoHideInterval: Setting.CreateRange(4, .5, 60),
		лАнимацияИнтерфейса: Setting.Create(!isMobileDevice()),
		// bInterfaceAnimation: Setting.Create(!isMobileDevice()),
		лМенятьГромкостьКолесом: Setting.Create(true),
		// bChangeVolumeWithWheel: Setting.Create(true),
		чШагИзмененияГромкостиКолесом: Setting.CreateRange(5, -10, 10),
		// nVolumeChangeStepWithWheel: Setting.CreateRange(5, -10, 10),
		лПоказатьСтатистику: Setting.Create(false),
		// bShowStatistics: Setting.Create(false),
		сПредустановкаВыбрана_буферизация: Setting.Create('J0127'),
		// sPresetSelected_buffering: Setting.Create('J0127'),
		лПредустановкаЗаполнена_буферизация: Setting.Create(false),
		// bPresetFilled_buffering: Setting.Create(false),
		кОдновременныхЗагрузок: Setting.CreateRange(0, 1, 3),
		// nConcurrentDownloads: Setting.CreateRange(0, 1, 3),
		чНачалоВоспроизведения: Setting.CreateRange(0, MIN_BUFFER_SIZE, MAX_BUFFER_SIZE),
		// nPlaybackStart: Setting.CreateRange(0, MIN_BUFFER_SIZE, MAX_BUFFER_SIZE),
		чРазмерБуфера: Setting.CreateRange(0, MIN_BUFFER_SIZE, MAX_BUFFER_SIZE),
		// nBufferSize: Setting.CreateRange(0, MIN_BUFFER_SIZE, MAX_BUFFER_SIZE),
		чРастягиваниеБуфера: Setting.CreateRange(0, MIN_BUFFER_STRETCH, MAX_BUFFER_STRETCH),
		// nBufferStretch: Setting.CreateRange(0, MIN_BUFFER_STRETCH, MAX_BUFFER_STRETCH),
		сПредустановкаВыбрана_оформление: Setting.Create('J0122'),
		// sPresetSelected_appearance: Setting.Create('J0122'),
		лПредустановкаЗаполнена_оформление: Setting.Create(false),
		// bPresetFilled_appearance: Setting.Create(false),
		сЦветФона: Setting.Create(''),
		// sBackgroundColor: Setting.Create(''),
		сЦветГрадиента: Setting.Create('#ffffff'),
		// sGradientColor: Setting.Create('#ffffff'),
		сЦветКнопок: Setting.Create(''),
		// sButtonColor: Setting.Create(''),
		сЦветЗаголовка: Setting.Create(''),
		// sHeaderColor: Setting.Create(''),
		сЦветВыделения: Setting.Create(''),
		// sHighlightColor: Setting.Create(''),
		чПрозрачность: Setting.CreateRange(0, 0, 80),
		// nOpacity: Setting.CreateRange(0, 0, 80),
		лАвтоперенаправлениеРазрешено: Setting.Create(true),
		// bAutoRedirectAllowed: Setting.Create(true),
		лАвтоперенаправлениеЗамечено: Setting.Create(false)
		// bAutoRedirectNoticed: Setting.Create(false)
	};
	const DELAY_SAVE_FOR = THIS_IS_CONTENT_SCRIPT ? 50 : 500;
	// const DELAY_SAVE_FOR = THIS_IS_CONTENT_SCRIPT ? 50 : 500;
	let _nDelayedSaveTimer = 0;
	// let _nDelayedSaveTimer = 0;
	let _oDelayedSave = null;
	// let _oDelayedSave = null;
	let _bDelayedDelete = false;
	// let _bDelayedDelete = false;
	function Restore() {
	// function Restore() {
		m_Log.Вот('[Настройки] Восстанавливаю settings');
		// m_Log.Here('[Settings] Restoring settings');
		return new Promise((fResolve, fReject) => {
		// return new Promise((fResolve, fReject) => {
			chrome.storage.local.get(null, oRestoredSettings => {
			// chrome.storage.local.get(null, oRestoredSettings => {
				if (g_bWorkFinished) {
				// if (g_bWorkFinished) {
					return;
				}
				try {
					if (chrome.runtime.lastError) {
						console.error('storage.local.get', chrome.runtime.lastError.message);
						m_Debug.FinishWorkAndShowMessage('J0221');
						// m_Debug.FinishWorkAndShowMessage('J0221');
					}
					m_Log.Вот(`[Настройки] Настройки прочитаны из хранилища: ${m_Log.O(oRestoredSettings)}`);
					// m_Log.Here(`[Settings] Settings read from storage: ${m_Log.O(oRestoredSettings)}`);
					FinishRestoring(oRestoredSettings);
					// FinishRestoring(oRestoredSettings);
					fResolve();
					// fResolve();
				} catch (pException) {
				// } catch (pException) {
					fReject(pException);
					// fReject(pException);
				}
			});
		});
	}
	function FinishRestoring(oRestoredSettings) {
	// function FinishRestoring(oRestoredSettings) {
		Check(IsObject(oRestoredSettings));
		// Check(IsObject(oRestoredSettings));
		Check(!_oSettings.чВерсияНастроек.pCurrent);
		// Check(!_oSettings.nSettingsVersion.pCurrent);
		const oSave = {};
		// const oSave = {};
		const bDeleteRest = CheckSettingsVersion(oRestoredSettings, oSave);
		// const bDeleteRest = CheckSettingsVersion(oRestoredSettings, oSave);
		for (let sName of Object.keys(_oSettings)) {
		// for (let sName of Object.keys(_oSettings)) {
			if (oRestoredSettings.hasOwnProperty(sName)) {
			// if (oRestoredSettings.hasOwnProperty(sName)) {
				const pValue = _oSettings[sName].CorrectValue(oRestoredSettings[sName]);
				// const pValue = _oSettings[sName].CorrectValue(oRestoredSettings[sName]);
				if (pValue !== oRestoredSettings[sName]) {
				// if (pValue !== oRestoredSettings[sName]) {
					oSave[sName] = pValue;
					// oSave[sName] = pValue;
				}
				_oSettings[sName].pCurrent = pValue;
				// _oSettings[sName].pCurrent = pValue;
			} else {
				if (_mnoPermanentSettings.has(sName)) {
				// if (_mnoPermanentSettings.has(sName)) {
					oSave[sName] = _oSettings[sName].pInitial;
					// oSave[sName] = _oSettings[sName].pInitial;
				}
				_oSettings[sName].pCurrent = _oSettings[sName].pInitial;
				// _oSettings[sName].pCurrent = _oSettings[sName].pInitial;
			}
		}
		StartSaving(oSave, bDeleteRest);
		// StartSaving(oSave, bDeleteRest);
	}
	function CheckSettingsVersion(oSettings, oSave) {
	// function CheckSettingsVersion(oSettings, oSave) {
		if (!Number.isInteger(oSettings.чВерсияНастроек) || oSettings.чВерсияНастроек < 1 || oSettings.чВерсияНастроек > SETTINGS_VERSION) {
		// if (!Number.isInteger(oSettings.nSettingsVersion) || oSettings.nSettingsVersion < 1 || oSettings.nSettingsVersion > SETTINGS_VERSION) {
			for (let sName of Object.keys(oSettings)) {
			// for (let sName of Object.keys(oSettings)) {
				delete oSettings[sName];
				// delete oSettings[sName];
			}
			return true;
		}
		for (let oMetadata of _moPresetMetadata) {
		// for (let oMetadata of _moPresetMetadata) {
			let sName = oSettings[oMetadata.sSelected];
			// let sName = oSettings[oMetadata.sSelected];
			if (sName !== void 0 && sName !== oMetadata.sCustomizable) {
			// if (sName !== void 0 && sName !== oMetadata.sCustomizable) {
				for (let sPresetName of oMetadata.amData.keys()) {
				// for (let sPresetName of oMetadata.amData.keys()) {
					if (sName === sPresetName) {
					// if (sName === sPresetName) {
						sName = void 0;
						// sName = void 0;
						break;
					}
				}
				if (sName !== void 0) {
				// if (sName !== void 0) {
					oSave[oMetadata.sSelected] = oSettings[oMetadata.sSelected] = _oSettings[oMetadata.sSelected].pInitial;
					// oSave[oMetadata.sSelected] = oSettings[oMetadata.sSelected] = _oSettings[oMetadata.sSelected].pInitial;
				}
			}
		}
		if (oSettings.чСостояниеЗакрытогоЧата !== oSettings.чСостояниеЧата && (oSettings.чСостояниеЧата === CHAT_UNLOADED || oSettings.чСостояниеЧата === CHAT_HIDDEN)) {
		// if (oSettings.nClosedChatState !== oSettings.nChatState && (oSettings.nChatState === CHAT_UNLOADED || oSettings.nChatState === CHAT_HIDDEN)) {
			oSave.чСостояниеЗакрытогоЧата = oSettings.чСостояниеЗакрытогоЧата = oSettings.чСостояниеЧата;
			// oSave.nClosedChatState = oSettings.nClosedChatState = oSettings.nChatState;
		}
		if (oSettings.чВерсияНастроек === SETTINGS_VERSION) {
		// if (oSettings.nSettingsVersion === SETTINGS_VERSION) {
			return false;
		}
		oSave.чВерсияНастроек = oSettings.чВерсияНастроек = SETTINGS_VERSION;
		// oSave.nSettingsVersion = oSettings.nSettingsVersion = SETTINGS_VERSION;
		return false;
	}
	function StartSaving(oSave, bDeleteRest) {
	// function StartSaving(oSave, bDeleteRest) {
		Check(IsObject(oSave));
		// Check(IsObject(oSave));
		if (Object.keys(oSave).length !== 0 || bDeleteRest) {
		// if (Object.keys(oSave).length !== 0 || bDeleteRest) {
			if (_nDelayedSaveTimer === 0) {
			// if (_nDelayedSaveTimer === 0) {
				m_Log.Вот(`[Настройки] Откладываю сохранение настроек на ${DELAY_SAVE_FOR}мс`);
				// m_Log.Here(`[Settings] Delaying settings save for ${DELAY_SAVE_FOR}ms`);
				_oDelayedSave = oSave;
				// _oDelayedSave = oSave;
				_bDelayedDelete = bDeleteRest;
				// _bDelayedDelete = bDeleteRest;
				_nDelayedSaveTimer = setTimeout(AddExceptionHandler(FinishSaving), DELAY_SAVE_FOR);
				// _nDelayedSaveTimer = setTimeout(AddExceptionHandler(FinishSaving), DELAY_SAVE_FOR);
			} else if (bDeleteRest) {
			// } else if (bDeleteRest) {
				_oDelayedSave = oSave;
				// _oDelayedSave = oSave;
				_bDelayedDelete = bDeleteRest;
				// _bDelayedDelete = bDeleteRest;
			} else {
				Object.assign(_oDelayedSave, oSave);
				// Object.assign(_oDelayedSave, oSave);
			}
		}
	}
	function FinishSaving() {
	// function FinishSaving() {
		m_Log.Вот('[Настройки] Завершаю отложенное сохранение');
		// m_Log.Here('[Settings] Finishing delayed save');
		Check(_nDelayedSaveTimer !== 0);
		// Check(_nDelayedSaveTimer !== 0);
		_nDelayedSaveTimer = 0;
		// _nDelayedSaveTimer = 0;
		Check(IsObject(_oDelayedSave));
		// Check(IsObject(_oDelayedSave));
		Save(_oDelayedSave, _bDelayedDelete);
		// Save(_oDelayedSave, _bDelayedDelete);
		_oDelayedSave = null;
		// _oDelayedSave = null;
	}
	function Save(oSave, bDeleteRest) {
	// function Save(oSave, bDeleteRest) {
		if (bDeleteRest) {
		// if (bDeleteRest) {
			chrome.storage.local.clear(CheckSaveResult);
			// chrome.storage.local.clear(CheckSaveResult);
			m_Log.Вот('[Настройки] Все settings удалены из хранилища');
			// m_Log.Here('[Settings] All settings deleted from storage');
		}
		chrome.storage.local.set(oSave, CheckSaveResult);
		// chrome.storage.local.set(oSave, CheckSaveResult);
		m_Log.Вот(`[Настройки] Настройки записаны в хранилище: ${m_Log.O(oSave)}`);
		// m_Log.Here(`[Settings] Settings written to storage: ${m_Log.O(oSave)}`);
	}
	function CheckSaveResult() {
	// function CheckSaveResult() {
		if (chrome.runtime.lastError) {
			console.error('storage.local.set', chrome.runtime.lastError.message);
			m_Debug.FinishWorkAndShowMessage('J0221');
			// m_Debug.FinishWorkAndShowMessage('J0221');
		}
	}
	function Reset() {
	// function Reset() {
		m_Log.Окак('[Настройки] Сбрасываю settings');
		// m_Log.Wow('[Settings] Resetting settings');
		Check(_oSettings.чВерсияНастроек.pCurrent);
		// Check(_oSettings.nSettingsVersion.pCurrent);
		const oSave = {};
		// const oSave = {};
		for (let sName of _mnoPermanentSettings) {
		// for (let sName of _mnoPermanentSettings) {
			oSave[sName] = _oSettings[sName].pCurrent;
			// oSave[sName] = _oSettings[sName].pCurrent;
		}
		StartSaving(oSave, true);
		// StartSaving(oSave, true);
		window.location.reload(true);
	}
	function Export() {
	// function Export() {
		m_Log.Окак('[Настройки] Экспортирую settings');
		// m_Log.Wow('[Settings] Exporting settings');
		Check(_oSettings.чВерсияНастроек.pCurrent);
		// Check(_oSettings.nSettingsVersion.pCurrent);
		const oExport = {
		// const oExport = {
			чВерсияНастроек: SETTINGS_VERSION
			// nSettingsVersion: SETTINGS_VERSION
		};
		for (let sName of Object.keys(_oSettings)) {
		// for (let sName of Object.keys(_oSettings)) {
			if (!_mnoPermanentSettings.has(sName) && !_mnoDoNotShow.has(sName)) {
			// if (!_mnoPermanentSettings.has(sName) && !_mnoDoNotShow.has(sName)) {
				oExport[sName] = _oSettings[sName].pCurrent;
				// oExport[sName] = _oSettings[sName].pCurrent;
			}
		}
		m_Log.Вот(`[Настройки] Отобраны settings для экспорта: ${m_Log.O(oExport)}`);
		// m_Log.Here(`[Settings] Settings selected for export: ${m_Log.O(oExport)}`);
		WriteTextToLocalFile(JSON.stringify(oExport), 'application/json', GetText('J0133'));
		// WriteTextToLocalFile(JSON.stringify(oExport), 'application/json', Text('J0133'));
	}
	function Import(oFromFile) {
	// function Import(oFromFile) {
		m_Log.Окак(`[Настройки] Импортирую settings из файла ${oFromFile.name}`);
		// m_Log.Wow(`[Settings] Importing settings from file ${oFromFile.name}`);
		Check(_oSettings.чВерсияНастроек.pCurrent);
		// Check(_oSettings.nSettingsVersion.pCurrent);
		if (oFromFile.size === 0 || oFromFile.size > 1e4) {
		// if (oFromFile.size === 0 || oFromFile.size > 1e4) {
			m_Log.Ой(`[Настройки] Размер файла: ${oFromFile.size}`);
			// m_Log.Oops(`[Settings] File size: ${oFromFile.size}`);
			m_Notification.ShowAss();
			// m_Notification.ShowAss();
			return;
		}
		const oReader = new FileReader();
		// const oReader = new FileReader();
		oReader.addEventListener('loadend', AddExceptionHandler(() => {
		// oReader.addEventListener('loadend', AddExceptionHandler(() => {
			if (!IsNonEmptyString(oReader.result)) {
			// if (!IsNonEmptyString(oReader.result)) {
				m_Log.Ой(`[Настройки] Результат чтения файла: ${oReader.result}`);
				// m_Log.Oops(`[Settings] File read result: ${oReader.result}`);
				m_Notification.ShowAss();
				// m_Notification.ShowAss();
				return;
			}
			m_Log.Вот(`[Настройки] Настройки прочитаны из файла: ${oReader.result}`);
			// m_Log.Here(`[Settings] Settings read from file: ${oReader.result}`);
			let oSave;
			// let oSave;
			try {
				oSave = JSON.parse(oReader.result);
				// oSave = JSON.parse(oReader.result);
				if (!IsObject(oSave)) {
				// if (!IsObject(oSave)) {
					throw 1;
				}
				if (CheckSettingsVersion(oSave, oSave)) {
				// if (CheckSettingsVersion(oSave, oSave)) {
					throw 2;
				}
				for (let sName of Object.keys(oSave)) {
				// for (let sName of Object.keys(oSave)) {
					if (!_oSettings.hasOwnProperty(sName) || _mnoDoNotShow.has(sName)) {
					// if (!_oSettings.hasOwnProperty(sName) || _mnoDoNotShow.has(sName)) {
						delete oSave[sName];
						// delete oSave[sName];
					} else {
						oSave[sName] = _oSettings[sName].CorrectValue(oSave[sName]);
						// oSave[sName] = _oSettings[sName].CorrectValue(oSave[sName]);
						if (oSave[sName] === _oSettings[sName].pInitial) {
						// if (oSave[sName] === _oSettings[sName].pInitial) {
							delete oSave[sName];
							// delete oSave[sName];
						}
					}
				}
			} catch (pException) {
			// } catch (pException) {
				m_Log.Ой(`[Настройки] Поймано исключение во время разбора настроек: ${pException}`);
				// m_Log.Oops(`[Settings] Exception caught while parsing settings: ${pException}`);
				m_Notification.ShowAss();
				// m_Notification.ShowAss();
				return;
			}
			for (let sName of _mnoPermanentSettings) {
			// for (let sName of _mnoPermanentSettings) {
				oSave[sName] = _oSettings[sName].pCurrent;
				// oSave[sName] = _oSettings[sName].pCurrent;
			}
			StartSaving(oSave, true);
			// StartSaving(oSave, true);
			window.location.reload(true);
		}));
		oReader.readAsText(oFromFile);
		// oReader.readAsText(oFromFile);
	}
	function Get2(sName) {
	// function Get2(sName) {
		Check(typeof sName == 'string');
		// Check(typeof sName == 'string');
		Check(_oSettings.hasOwnProperty(sName));
		// Check(_oSettings.hasOwnProperty(sName));
		Check(_oSettings.чВерсияНастроек.pCurrent);
		// Check(_oSettings.nSettingsVersion.pCurrent);
		for (let oMetadata of _moPresetMetadata) {
		// for (let oMetadata of _moPresetMetadata) {
			const oPreset = oMetadata.amData.get(_oSettings[oMetadata.sSelected].pCurrent);
			// const oPreset = oMetadata.amData.get(_oSettings[oMetadata.sSelected].pCurrent);
			if (oPreset) {
			// if (oPreset) {
				const pValue = oPreset[sName];
				// const pValue = oPreset[sName];
				if (pValue !== void 0) {
				// if (pValue !== void 0) {
					return pValue;
					// return pValue;
				}
			}
		}
		return _oSettings[sName].pCurrent;
		// return _oSettings[sName].pCurrent;
	}
	function Get(sName) {
	// function Get(sName) {
		if (sName === 'чМаксРазмерБуфера') {
		// if (sName === 'nMaxBufferSize') {
			return Math.max(Get2('чНачалоВоспроизведения'), Get2('чРазмерБуфера'));
			// return Math.max(Get2('nPlaybackStart'), Get2('nBufferSize'));
		}
		return Get2(sName);
		// return Get2(sName);
	}
	function Change(sName, pValue, bNoSave = false) {
	// function Change(sName, pValue, bNoSave = false) {
		Check(typeof sName == 'string');
		// Check(typeof sName == 'string');
		Check(_oSettings[sName].CorrectValue(pValue) === pValue);
		// Check(_oSettings[sName].CorrectValue(pValue) === pValue);
		const oSave = {};
		// const oSave = {};
		for (let oMetadata of _moPresetMetadata) {
		// for (let oMetadata of _moPresetMetadata) {
			const oPreset = oMetadata.amData.get(_oSettings[oMetadata.sSelected].pCurrent);
			// const oPreset = oMetadata.amData.get(_oSettings[oMetadata.sSelected].pCurrent);
			if (oPreset && oPreset.hasOwnProperty(sName)) {
			// if (oPreset && oPreset.hasOwnProperty(sName)) {
				if (pValue === oPreset[sName]) {
				// if (pValue === oPreset[sName]) {
					return;
				}
				Check(!bNoSave);
				// Check(!bNoSave);
				oSave[oMetadata.sSelected] = _oSettings[oMetadata.sSelected].pCurrent = oMetadata.sCustomizable;
				// oSave[oMetadata.sSelected] = _oSettings[oMetadata.sSelected].pCurrent = oMetadata.sCustomizable;
				oSave[oMetadata.sFilled] = _oSettings[oMetadata.sFilled].pCurrent = true;
				// oSave[oMetadata.sFilled] = _oSettings[oMetadata.sFilled].pCurrent = true;
				for (let sPresetName of Object.keys(oPreset)) {
				// for (let sPresetName of Object.keys(oPreset)) {
					oSave[sPresetName] = _oSettings[sPresetName].pCurrent = oPreset[sPresetName];
					// oSave[sPresetName] = _oSettings[sPresetName].pCurrent = oPreset[sPresetName];
				}
				UpdatePresetList(oMetadata);
				// UpdatePresetList(oMetadata);
				break;
			}
		}
		if (_oSettings[sName].pCurrent !== pValue) {
		// if (_oSettings[sName].pCurrent !== pValue) {
			oSave[sName] = _oSettings[sName].pCurrent = pValue;
			// oSave[sName] = _oSettings[sName].pCurrent = pValue;
		}
		if (!bNoSave) {
		// if (!bNoSave) {
			StartSaving(oSave, false);
			// StartSaving(oSave, false);
		}
	}
	function UpdatePresetList(oMetadata) {
	// function UpdatePresetList(oMetadata) {
		const nodeList = GetNode(oMetadata.sList);
		// const nodeList = Node(oMetadata.sList);
		nodeList.length = 0;
		// nodeList.length = 0;
		const sSelect = _oSettings[oMetadata.sSelected].pCurrent;
		// const sSelect = _oSettings[oMetadata.sSelected].pCurrent;
		for (let sName of oMetadata.amData.keys()) {
		// for (let sName of oMetadata.amData.keys()) {
			nodeList.add(new Option(GetText(sName), sName, sName === sSelect, sName === sSelect));
			// nodeList.add(new Option(Text(sName), sName, sName === sSelect, sName === sSelect));
		}
		if (_oSettings[oMetadata.sFilled].pCurrent) {
		// if (_oSettings[oMetadata.sFilled].pCurrent) {
			nodeList.add(new Option(GetText(oMetadata.sCustomizable), oMetadata.sCustomizable, oMetadata.sCustomizable === sSelect, oMetadata.sCustomizable === sSelect));
			// nodeList.add(new Option(Text(oMetadata.sCustomizable), oMetadata.sCustomizable, oMetadata.sCustomizable === sSelect, oMetadata.sCustomizable === sSelect));
		}
		Check(nodeList.value);
		// Check(nodeList.value);
		return nodeList;
		// return nodeList;
	}
	const ProcessPresetChange = AddExceptionHandler(oEvent => {
	// const ProcessPresetChange = AddExceptionHandler(oEvent => {
		for (let oMetadata of _moPresetMetadata) {
		// for (let oMetadata of _moPresetMetadata) {
			if (oMetadata.sList === oEvent.target.id) {
			// if (oMetadata.sList === oEvent.target.id) {
				Check(oEvent.target.value);
				// Check(oEvent.target.value);
				Change(oMetadata.sSelected, oEvent.target.value);
				// Change(oMetadata.sSelected, oEvent.target.value);
				m_Events.SendEvent(oMetadata.sEvent);
				// m_Events.SendEvent(oMetadata.sEvent);
				return;
			}
		}
		Check(false);
		// Check(false);
	});
	function ConfigurePresetLists() {
	// function ConfigurePresetLists() {
		for (let oMetadata of _moPresetMetadata) {
		// for (let oMetadata of _moPresetMetadata) {
			UpdatePresetList(oMetadata).addEventListener('change', ProcessPresetChange);
			// UpdatePresetList(oMetadata).addEventListener('change', ProcessPresetChange);
		}
	}
	function GetSettingParameters(sName) {
	// function GetSettingParameters(sName) {
		Check(typeof sName == 'string');
		// Check(typeof sName == 'string');
		Check(_oSettings.hasOwnProperty(sName));
		// Check(_oSettings.hasOwnProperty(sName));
		return _oSettings[sName];
		// return _oSettings[sName];
	}
	function GetDataForReport() {
	// function GetDataForReport() {
		const oReport = {};
		// const oReport = {};
		for (let sName of Object.keys(_oSettings)) {
		// for (let sName of Object.keys(_oSettings)) {
			if (!_mnoDoNotShow.has(sName) && (_mnoPermanentSettings.has(sName) || _oSettings[sName].pCurrent !== _oSettings[sName].pInitial)) {
			// if (!_mnoDoNotShow.has(sName) && (_mnoPermanentSettings.has(sName) || _oSettings[sName].pCurrent !== _oSettings[sName].pInitial)) {
				oReport[sName] = _oSettings[sName].pCurrent;
				// oReport[sName] = _oSettings[sName].pCurrent;
			}
		}
		return oReport;
		// return oReport;
	}
	function SaveChanges() {
	// function SaveChanges() {
		if (_nDelayedSaveTimer !== 0) {
		// if (_nDelayedSaveTimer !== 0) {
			clearTimeout(_nDelayedSaveTimer);
			// clearTimeout(_nDelayedSaveTimer);
			FinishSaving();
			// FinishSaving();
		}
	}
	window.addEventListener('beforeunload', SaveChanges);
	// window.addEventListener('beforeunload', SaveChanges);
	return {
		Restore,
		// Restore,
		Reset,
		// Reset,
		Export,
		// Export,
		Import,
		// Import,
		Get,
		// Get,
		Change,
		// Change,
		SaveChanges,
		// SaveChanges,
		GetSettingParameters,
		// GetSettingParameters,
		ConfigurePresetLists,
		// ConfigurePresetLists,
		GetDataForReport
		// GetDataForReport
	};
})();