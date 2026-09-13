'use strict';

const THIS_IS_CONTENT_SCRIPT = !document.currentScript;

const DO_NOT_REDIRECT_ADDRESS = 'twitch5=0';

const LEFT_BUTTON = 0;

const MIDDLE_BUTTON = 1;

const RIGHT_BUTTON = 2;

const LEFT_BUTTON_PRESSED = 1;

const RIGHT_BUTTON_PRESSED = 2;

const MIDDLE_BUTTON_PRESSED = 4;

const PASSIVE_HANDLER = {
	passive: true
};

const MIN_SETTING_VALUE = Number.MIN_SAFE_INTEGER + 1e3;

const MAX_SETTING_VALUE = Number.MAX_SAFE_INTEGER - 1e3;

const AUTO_SETTING = Number.MIN_SAFE_INTEGER;
// const AUTO_ADJUSTMENT = Number.MIN_SAFE_INTEGER;

const MIN_VOLUME = 1;

const MAX_VOLUME = 100;

const VOLUME_INCREASE_STEP_BY_KEY = 4;

const VOLUME_DECREASE_STEP_BY_KEY = 2;

const CHAT_UNLOADED = 0;

const CHAT_HIDDEN = 1;

const CHAT_PANEL = 2;

const TOP_SIDE = 1;

const RIGHT_SIDE = 2;

const BOTTOM_SIDE = 3;

const LEFT_SIDE = 4;

const MIN_REPEAT_DURATION = 30;

const MAX_REPEAT_DURATION = 300;

const MIN_BUFFER_SIZE = 1.5;

const MAX_BUFFER_SIZE = 30;

const MIN_BUFFER_STRETCH = 9;

const MAX_BUFFER_STRETCH = 30;

const BUFFER_OVERFLOW = MAX_BUFFER_SIZE + MAX_BUFFER_STRETCH;

let g_bWorkFinished = false;

if (!NodeList.prototype[Symbol.iterator]) {
	NodeList.prototype[Symbol.iterator] = Array.prototype[Symbol.iterator];
}

if (!HTMLCollection.prototype[Symbol.iterator]) {
	HTMLCollection.prototype[Symbol.iterator] = Array.prototype[Symbol.iterator];
}

const STUB = () => {};

function Check(pCondition) {
	if (!pCondition) {
		throw new Error('Check failed');
	}
}

function AddExceptionHandler(fFunction) {
	return function() {
		if (g_bWorkFinished) {
			return;
		}
		try {
			return fFunction.apply(this, arguments);
		} catch (pException) {
			m_Debug.CaughtException(pException);
		}
	};
}

function ExceptionToString(pException) {
	return pException instanceof Error ? pException.stack : `[typeof ${typeof pException}] ${new Error(pException).stack}`;
}

function Type(pValue) {
	return pValue === null ? 'null' : typeof pValue;
}

function IsNumber(pValue) {
	return typeof pValue == 'number' && pValue == pValue;
}

function IsObject(pValue) {
	return typeof pValue == 'object' && pValue !== null;
}

function IsNonEmptyString(pValue) {
	return typeof pValue == 'string' && pValue !== '';
}

function LimitStringLength(sString, nMaxLength) {
	return sString.length <= nMaxLength ? sString : `${sString.slice(0, nMaxLength)}---8<---${sString.length - nMaxLength}`;
}

function getBrowserEngineVersion() {
	if (!getBrowserEngineVersion._nResult) {
		if (navigator.userAgentData) {
			for (const {brand, version} of navigator.userAgentData.brands) {
				if (brand === 'Chromium' || brand === 'Google Chrome') {
					getBrowserEngineVersion._nResult = Number.parseInt(version, 10);
					break;
				}
			}
		}
		if (!getBrowserEngineVersion._nResult) {
			getBrowserEngineVersion._nResult = Number(/Chrome\/(\d+)/.exec(navigator.userAgent)[1]);
		}
	}
	return getBrowserEngineVersion._nResult;
}

function isMobileDevice() {
	if (!isMobileDevice.hasOwnProperty('_bResult')) {
		isMobileDevice._bResult = navigator.userAgentData ? navigator.userAgentData.mobile : navigator.userAgent.includes('Android');
	}
	return isMobileDevice._bResult;
}

function GetNode(pElement) {
// function Node(pElement) {
	const elElement = typeof pElement == 'string' ? document.getElementById(pElement) : pElement;
	Check(elElement.nodeType === 1);
	return elElement;
}

function createGqlRequestBody(sQuery, oVariables) {
	Check(IsNonEmptyString(sQuery) && IsObject(oVariables));
	return `{"query":${JSON.stringify(sQuery)},"variables":${JSON.stringify(oVariables)}}`;
}

function combineGqlRequests(msRequestBodies) {
	Check(msRequestBodies[0][0] === '{');
	return `[${msRequestBodies.join(',')}]`;
}

function GetOurPlayerAddress(sChannelCode) {
	const sParameters = '?channel=' + encodeURIComponent(sChannelCode);
	return chrome.runtime.getURL('player.html') + sParameters;
}

/*
	The in-memory log that ends up in a bug report.

	Nothing here is written to the console. Records are kept in a fixed-size ring so a long
	session cannot grow memory without bound: once the ring is full, each new record overwrites
	the oldest one. When the user sends a report, the ring is unrolled into chronological order.

	Every record is one line — a severity mark, the time since the page loaded in seconds, then the
	text — and is cut at a fixed length so a single runaway value cannot fill the report on its own.

	The three severities are part of the public interface *by name*: some callers pick one at run
	time, m_Log[bFailed ? 'Oops' : 'Here'](...). Renaming a severity therefore means renaming every
	string that names it, not only the method.

	Content scripts run inside twitch.tv and have no report to feed. There the log is inert: every
	call is accepted and discarded, so shared code can log unconditionally.
*/
const m_Log = (() => {
	const CAPACITY = 1500;
	const MAX_LINE_LENGTH = 1500;
	const MARK = { Here: ' ', Wow: '~', Oops: '@' };

	const ring = THIS_IS_CONTENT_SCRIPT ? null : [];
	let next = 0;

	function write(sMark, sText) {
		if (ring === null) {
			return;
		}
		Check(typeof sText == 'string');
		const nSeconds = (performance.now() / 1e3).toFixed(3);
		const sLine = LimitStringLength(`${sMark} ${nSeconds} ${sText}`, MAX_LINE_LENGTH);
		if (ring.length < CAPACITY) {
			ring.push(sLine);
		} else {
			ring[next] = sLine;
		}
		next = (next + 1) % CAPACITY;
	}

	// One argument, always: a second one would be silently dropped, and the line would lie.
	const severity = (sMark) => function (sText) {
		Check(arguments.length === 1);
		write(sMark, sText);
	};

	// Oldest first. A copy, so nothing the report does can reach back into the ring.
	function GetDataForReport() {
		if (ring === null) {
			return null;
		}
		if (ring.length < CAPACITY) {
			return ring.slice();
		}
		return ring.slice(next).concat(ring.slice(0, next));
	}

	// Renders any value on one log line.
	function O(pValue) {
		switch (Type(pValue)) {
			case 'object':
				return JSON.stringify(pValue);
			case 'function':
				return `[function ${pValue.name}]`;
			case 'symbol':
				return '[symbol]';
			default:
				return String(pValue);
		}
	}

	// A number with a fixed count of decimals, or NaN for anything that is not a number.
	const fixed = (nDecimals) => (pValue) => typeof pValue == 'number' ? pValue.toFixed(nDecimals) : 'NaN';

	const log = {
		Here: severity(MARK.Here),
		Wow: severity(MARK.Wow),
		Oops: severity(MARK.Oops),
		O,
		F0: fixed(0),
		F1: fixed(1),
		F2: fixed(2),
		F3: fixed(3),
		GetDataForReport,
	};

	log.Here(`[Log] Started after ${performance.now().toFixed()} ms`);
	return log;
})();

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

/*
	Everything the user has chosen, kept across launches.

	Three things are easy to confuse here, so they are named apart:

	  - the SCHEMA (_oSettings) says what a setting's default is and which values it will accept;
	  - the STORE (chrome.storage.local) is what the browser has actually written down;
	  - the PRESETS sit above both -- a named bundle of values that overrides the store for as long
	    as it is selected.

	Validation never rejects a stored value, it corrects it: out of range clamps, off the list
	falls back to the default. The one thing it refuses is a value of the wrong type, because only
	this module writes the store and a type mismatch means a bug, not a stale profile.

	Nothing may read a setting before Restore() has resolved. That is asserted in both directions:
	every pCurrent is undefined until then, and Restore() refuses to run a second time.
*/
const m_Settings = (() => {
	/*
		Stamped into the store on every write. A store carrying a HIGHER version was written by a
		newer extension, cannot be understood, and is dropped whole rather than half-read.
	*/
	const SETTINGS_VERSION = 2;
	/*
		The preset bundles. The J0nnn keys are i18n names: the same string identifies the preset in
		the store and labels it in the list.
	*/
	const _amBufferingPresets = new Map([
		[ 'J0126', { nConcurrentDownloads: 1, nPlaybackStart: 3, nBufferSize: 5, nBufferStretch: 15 } ],
		[ 'J0127', { nConcurrentDownloads: 2, nPlaybackStart: 3, nBufferSize: 8.5, nBufferStretch: 20 } ],
		[ 'J0128', { nConcurrentDownloads: 2, nPlaybackStart: 17, nBufferSize: 9.5, nBufferStretch: 30 } ]
	]);
	const _amAppearancePresets = new Map([
		[ 'J0122', {
			sBackgroundColour: '#282828',
			sGradientColour: '#d4d4d4',
			sButtonColour: '#d3be96',
			sHeadingColour: '#cdbdec',
			sAccentColour: '#ffd862',
			nOpacity: 25
		} ],
		[ 'J0121', {
			sBackgroundColour: '#405b77',
			sGradientColour: '#aaccf2',
			sButtonColour: '#ffffff',
			sHeadingColour: '#c2e4ff',
			sAccentColour: '#fef17c',
			nOpacity: 30
		} ],
		[ 'J0138', {
			sBackgroundColour: '#4b4b4b',
			sGradientColour: '#aaaaaa',
			sButtonColour: '#bad4f8',
			sHeadingColour: '#e2ebb4',
			sAccentColour: '#75a9f0',
			nOpacity: 5
		} ],
		[ 'J0125', {
			sBackgroundColour: '#161616',
			sGradientColour: '#a0a0a0',
			sButtonColour: '#f0f0f0',
			sHeadingColour: '#baccda',
			sAccentColour: '#6cb6ff',
			nOpacity: 20
		} ]
	]);
	/*
		One entry per preset family. sCustom is the sentinel the sSelected setting holds when no
		bundle is active and the user's own values are in force; it is an i18n name too, because it
		also labels the last entry of the list.

		sList is an element id and sEvent an internal event name: both have a twin elsewhere in the
		extension and neither may be renamed on this side alone.
	*/
	const _aoPresetFamilies = [ {
		amPresets: _amBufferingPresets,
		sCustom: 'J0129',
		sSelected: 'sPresetSelected_buffering',
		sFilled: 'bPresetFilled_buffering',
		sList: 'preset-buffering',
		sEvent: 'settings-presetchanged-buffering'
	}, {
		amPresets: _amAppearancePresets,
		sCustom: 'J0123',
		sSelected: 'sPresetSelected_appearance',
		sFilled: 'bPresetFilled_appearance',
		sList: 'preset-appearance',
		sEvent: 'settings-presetchanged-appearance'
	} ];
	/*
		Bookkeeping rather than preferences: they survive a reset, they survive an import, and they
		never appear in an export -- carrying someone else's random number or version history into
		your own profile would be meaningless at best.
	*/
	const _mnoPermanentSettings = new Set([ 'nSettingsVersion', 'nRandomNumber', 'sPreviousVersion', 'nLastExtensionUpdateCheck', 'bAutoRedirectNoticed' ]);
	/*
		One setting's declaration: its default, and the rule its values must satisfy. Three shapes
		of rule, and Create / CreateEnum / CreateRange are the only way to build one.
	*/
	class Setting {
		constructor(pInitial, apEnumeration, nMinimum, nMaximum, sAutoTune) {
			this.pCurrent = void 0;
			this.pInitial = pInitial;
			this.apEnumeration = apEnumeration;
			this.nMinimum = nMinimum;
			this.nMaximum = nMaximum;
			this.sAutoTune = sAutoTune;
		}
		// Anything of the default's type.
		static Create(pInitial) {
			return new Setting(pInitial, null, MIN_SETTING_VALUE, MAX_SETTING_VALUE, '');
		}
		// A closed list; anything else falls back to the default.
		static CreateEnum(pInitial, apEnumeration) {
			return new Setting(pInitial, apEnumeration, MIN_SETTING_VALUE, MAX_SETTING_VALUE, '');
		}
		/*
			A numeric interval. sAutoTune, when given, is the i18n name of the label shown in place
			of a number, and is what makes the AUTO_SETTING sentinel an acceptable value: a setting
			without that label has no automatic mode to fall into.
		*/
		static CreateRange(pInitial, nMinimum, nMaximum, sAutoTune = '') {
			return new Setting(pInitial, null, nMinimum, nMaximum, sAutoTune);
		}
		// Rules out what could not have come from this module: NaN, the infinities, objects, holes.
		static CheckValue(pValue) {
			Check(pValue == pValue && pValue !== Infinity && pValue !== -Infinity && pValue !== void 0
				&& typeof pValue != 'function' && typeof pValue != 'symbol' && typeof pValue != 'object');
		}
		CorrectValue(pValue) {
			Setting.CheckValue(pValue);
			Check(typeof pValue == typeof this.pInitial);
			if (this.apEnumeration) {
				return this.apEnumeration.includes(pValue) ? pValue : this.pInitial;
			}
			if (typeof pValue != 'number') {
				return pValue;
			}
			if (pValue === AUTO_SETTING) {
				return this.sAutoTune === '' ? this.pInitial : pValue;
			}
			if (pValue < this.nMinimum) {
				return this.nMinimum;
			}
			if (pValue > this.nMaximum) {
				return this.nMaximum;
			}
			return pValue;
		}
	}
	/*
		The schema. These names are the keys the store is written under: changing one here without
		a migration entry loses whatever the user had set.

		The four buffering values and the six appearance ones default to zero or to an empty
		string on purpose. A preset is selected out of the box, so the schema value is never the
		one in force until the user customises the family and Change fills them in.
	*/
	const _oSettings = {
		nSettingsVersion: Setting.Create(SETTINGS_VERSION),
		nRandomNumber: Setting.Create(Math.random()),
		sPreviousVersion: Setting.Create('2000.1.1'),
		nLastExtensionUpdateCheck: Setting.Create(0),
		nVolume2: Setting.CreateRange(MAX_VOLUME / 2, MIN_VOLUME, MAX_VOLUME),
		bMute: Setting.Create(false),
		sAudioDeviceId: Setting.Create(''),
		sVariantLabel: Setting.Create('CoolCmd'),
		nVariantBitrate: Setting.Create(MAX_SETTING_VALUE),
		nReplayDuration2: Setting.CreateRange(60, MIN_REPEAT_DURATION, MAX_REPEAT_DURATION, 'J0124'),
		bScaleImage: Setting.Create(true),
		nChatState: Setting.CreateEnum(CHAT_UNLOADED, [ CHAT_UNLOADED, CHAT_HIDDEN, CHAT_PANEL ]),
		nClosedChatState: Setting.CreateEnum(CHAT_UNLOADED, [ CHAT_UNLOADED, CHAT_HIDDEN ]),
		bAutoChatPosition: Setting.Create(isMobileDevice()),
		nHorizontalChatPosition: Setting.CreateEnum(RIGHT_SIDE, [ RIGHT_SIDE, LEFT_SIDE ]),
		nVerticalChatPosition: Setting.CreateEnum(BOTTOM_SIDE, [ TOP_SIDE, BOTTOM_SIDE ]),
		nChatPanelPosition: Setting.CreateEnum(RIGHT_SIDE, [ TOP_SIDE, RIGHT_SIDE, BOTTOM_SIDE, LEFT_SIDE ]),
		nChatPanelWidth: Setting.CreateRange(340, 100, MAX_SETTING_VALUE),
		nChatPanelHeight: Setting.CreateRange(250, 100, MAX_SETTING_VALUE),
		bFullChat: Setting.Create(true),
		bDimChat: Setting.Create(false),
		nInterfaceSize: Setting.CreateRange(isMobileDevice() ? 115 : 100, 50, 200),
		nAutoHideInterval: Setting.CreateRange(4, .5, 60),
		bInterfaceAnimation: Setting.Create(!isMobileDevice()),
		bWheelVolume: Setting.Create(true),
		nWheelVolumeStep: Setting.CreateRange(5, -10, 10),
		bShowStatistics: Setting.Create(false),
		sPresetSelected_buffering: Setting.Create('J0127'),
		bPresetFilled_buffering: Setting.Create(false),
		nConcurrentDownloads: Setting.CreateRange(0, 1, 3),
		nPlaybackStart: Setting.CreateRange(0, MIN_BUFFER_SIZE, MAX_BUFFER_SIZE),
		nBufferSize: Setting.CreateRange(0, MIN_BUFFER_SIZE, MAX_BUFFER_SIZE),
		nBufferStretch: Setting.CreateRange(0, MIN_BUFFER_STRETCH, MAX_BUFFER_STRETCH),
		sPresetSelected_appearance: Setting.Create('J0122'),
		bPresetFilled_appearance: Setting.Create(false),
		sBackgroundColour: Setting.Create(''),
		sGradientColour: Setting.Create('#ffffff'),
		sButtonColour: Setting.Create(''),
		sHeadingColour: Setting.Create(''),
		sAccentColour: Setting.Create(''),
		nOpacity: Setting.CreateRange(0, 0, 80),
		bAutoRedirectAllowed: Setting.Create(true),
		bAutoRedirectNoticed: Setting.Create(false)
	};
	/*
		Settings saved under the old Russian key names, carried over to the new English ones.

		Every setting the user has ever changed sits in chrome.storage under the name this code
		used at the time. Renaming the keys without this step would not raise an error: the schema
		would simply find nothing for each name and fall back to its default, and the user would
		discover on the next launch that their buffer size, their chat position and their colours
		had all gone back to factory settings -- silently, with no way to tell what happened.

		The old names live here and nowhere else. They are data, not code: this table is the only
		place in the extension where Cyrillic identifiers are still meaningful, and it stays for as
		long as someone might still be carrying a profile written before the rename.

		A value already stored under the new name always wins -- re-running this must never undo a
		setting the user has changed since.

		The old key is dropped from the copy being read, not from the store. Deleting it there
		would open a window where the delete succeeded and the write of the new name did not, and
		the setting would be gone for good; a handful of keys nothing ever reads again costs less
		than that.
	*/
	const _amOldSettingNames = new Map(Object.entries({
		'кОдновременныхЗагрузок': 'nConcurrentDownloads',
		'лАвтоПоложениеЧата': 'bAutoChatPosition',
		'лАвтоперенаправлениеЗамечено': 'bAutoRedirectNoticed',
		'лАвтоперенаправлениеРазрешено': 'bAutoRedirectAllowed',
		'лАнимацияИнтерфейса': 'bInterfaceAnimation',
		'лЗатемнитьЧат': 'bDimChat',
		'лМасштабироватьИзображение': 'bScaleImage',
		'лМенятьГромкостьКолесом': 'bWheelVolume',
		'лПоказатьСтатистику': 'bShowStatistics',
		'лПолноценныйЧат': 'bFullChat',
		'лПредустановкаЗаполнена_буферизация': 'bPresetFilled_buffering',
		'лПредустановкаЗаполнена_оформление': 'bPresetFilled_appearance',
		'лПриглушить': 'bMute',
		'сИдАудиоустройства': 'sAudioDeviceId',
		'сНазваниеВарианта': 'sVariantLabel',
		'сПредустановкаВыбрана_буферизация': 'sPresetSelected_buffering',
		'сПредустановкаВыбрана_оформление': 'sPresetSelected_appearance',
		'сПредыдущаяВерсия': 'sPreviousVersion',
		'сЦветВыделения': 'sAccentColour',
		'сЦветГрадиента': 'sGradientColour',
		'сЦветЗаголовка': 'sHeadingColour',
		'сЦветКнопок': 'sButtonColour',
		'сЦветФона': 'sBackgroundColour',
		'чБитрейтВарианта': 'nVariantBitrate',
		'чВерсияНастроек': 'nSettingsVersion',
		'чВертикальноеПоложениеЧата': 'nVerticalChatPosition',
		'чВысотаПанелиЧата': 'nChatPanelHeight',
		'чГоризонтальноеПоложениеЧата': 'nHorizontalChatPosition',
		'чГромкость2': 'nVolume2',
		'чДлительностьПовтора2': 'nReplayDuration2',
		'чИнтервалАвтоскрытия': 'nAutoHideInterval',
		'чНачалоВоспроизведения': 'nPlaybackStart',
		'чПоложениеПанелиЧата': 'nChatPanelPosition',
		'чПоследняяПроверкаОбновленияРасширения': 'nLastExtensionUpdateCheck',
		'чПрозрачность': 'nOpacity',
		'чРазмерБуфера': 'nBufferSize',
		'чРазмерИнтерфейса': 'nInterfaceSize',
		'чРастягиваниеБуфера': 'nBufferStretch',
		'чСлучайноеЧисло': 'nRandomNumber',
		'чСостояниеЗакрытогоЧата': 'nClosedChatState',
		'чСостояниеЧата': 'nChatState',
		'чШагИзмененияГромкостиКолесом': 'nWheelVolumeStep',
		'чШиринаПанелиЧата': 'nChatPanelWidth',
	}));
	/*
		Writes are deferred so that a drag on a slider, which fires a change per pixel, costs one
		write instead of a hundred. The content script uses a shorter delay because its page can be
		torn down without warning.
	*/
	const DELAY_SAVE_FOR = THIS_IS_CONTENT_SCRIPT ? 50 : 500;
	let _nDelayedSaveTimer = 0;
	let _oDelayedSave = null;
	let _bDelayedWipe = false;
	// Every public reader asserts this: no setting has a value before Restore() has resolved.
	function CheckRestored() {
		Check(_oSettings.nSettingsVersion.pCurrent !== void 0);
	}
	function MigrateSettingNames(oStore) {
		let nCarried = 0;
		for (const [ sOld, sNew ] of _amOldSettingNames) {
			if (!oStore.hasOwnProperty(sOld)) {
				continue;
			}
			if (!oStore.hasOwnProperty(sNew)) {
				oStore[sNew] = oStore[sOld];
				++nCarried;
			}
			delete oStore[sOld];
		}
		if (nCarried) {
			m_Log.Here(`[Settings] ${nCarried} setting(s) carried over under their new name`);
		}
		return oStore;
	}
	function Restore() {
		m_Log.Here('[Settings] Restoring settings');
		return new Promise((fResolve, fReject) => {
			chrome.storage.local.get(null, oStore => {
				// Work was abandoned while the store was being read: settle nothing, do nothing.
				if (g_bWorkFinished) {
					return;
				}
				try {
					if (chrome.runtime.lastError) {
						console.error('storage.local.get', chrome.runtime.lastError.message);
						m_Debug.FinishWorkAndShowMessage('J0221');
					}
					m_Log.Here(`[Settings] Settings read from storage: ${m_Log.O(oStore)}`);
					ApplyStore(MigrateSettingNames(oStore));
					fResolve();
				} catch (pException) {
					fReject(pException);
				}
			});
		});
	}
	/*
		Turns what the store holds into the values in force, and writes back only what had to be
		repaired: a value the schema corrected, a permanent setting the store did not have yet, or
		the whole store when its version made it unusable.
	*/
	function ApplyStore(oStore) {
		Check(IsObject(oStore));
		Check(_oSettings.nSettingsVersion.pCurrent === void 0);
		const oSave = {};
		const bWipeFirst = ValidateStore(oStore, oSave);
		for (const sName of Object.keys(_oSettings)) {
			if (oStore.hasOwnProperty(sName)) {
				const pValue = _oSettings[sName].CorrectValue(oStore[sName]);
				if (pValue !== oStore[sName]) {
					oSave[sName] = pValue;
				}
				_oSettings[sName].pCurrent = pValue;
			} else {
				/*
					A permanent setting absent from the store is written at once rather than on the
					next change: nRandomNumber has to be drawn one single time, and the version
					history has to start from this launch and not from whenever a preference next
					happens to be touched.
				*/
				if (_mnoPermanentSettings.has(sName)) {
					oSave[sName] = _oSettings[sName].pInitial;
				}
				_oSettings[sName].pCurrent = _oSettings[sName].pInitial;
			}
		}
		StartSaving(oSave, bWipeFirst);
	}
	/*
		Checks a set of stored values and repairs what can be repaired, in oStore and in oSave at
		once. Returns true when nothing could be salvaged and the whole store must go.

		Import passes the same object twice: there, repairing a value and recording the repair are
		the same act.
	*/
	function ValidateStore(oStore, oSave) {
		if (!Number.isInteger(oStore.nSettingsVersion) || oStore.nSettingsVersion < 1 || oStore.nSettingsVersion > SETTINGS_VERSION) {
			for (const sName of Object.keys(oStore)) {
				delete oStore[sName];
			}
			return true;
		}
		/*
			A preset that no longer exists -- renamed or dropped between versions -- leaves the
			family pointing at nothing, and Get would fall through to schema defaults nobody chose.
			The family goes back to its default bundle instead.
		*/
		for (const oFamily of _aoPresetFamilies) {
			const sSelected = oStore[oFamily.sSelected];
			if (sSelected === void 0 || sSelected === oFamily.sCustom || oFamily.amPresets.has(sSelected)) {
				continue;
			}
			oSave[oFamily.sSelected] = oStore[oFamily.sSelected] = _oSettings[oFamily.sSelected].pInitial;
		}
		/*
			nClosedChatState remembers which of the two closed states to return to. While the chat
			is not in its panel the two must agree, otherwise closing the panel would restore a
			state the user left long ago.
		*/
		if (oStore.nClosedChatState !== oStore.nChatState && (oStore.nChatState === CHAT_UNLOADED || oStore.nChatState === CHAT_HIDDEN)) {
			oSave.nClosedChatState = oStore.nClosedChatState = oStore.nChatState;
		}
		if (oStore.nSettingsVersion !== SETTINGS_VERSION) {
			oSave.nSettingsVersion = oStore.nSettingsVersion = SETTINGS_VERSION;
		}
		return false;
	}
	/*
		Queues a write. Successive calls merge into the one pending object, so a drag costs a
		single write.

		A wipe REPLACES what is pending instead of merging into it: the pending values describe a
		store that is about to cease to exist, and carrying them across would resurrect settings
		the reset or the import was meant to drop.
	*/
	function StartSaving(oSave, bWipeFirst) {
		Check(IsObject(oSave));
		if (Object.keys(oSave).length === 0 && !bWipeFirst) {
			return;
		}
		if (_nDelayedSaveTimer === 0) {
			m_Log.Here(`[Settings] Postponing settings save by ${DELAY_SAVE_FOR}ms`);
			_oDelayedSave = oSave;
			_bDelayedWipe = bWipeFirst;
			_nDelayedSaveTimer = setTimeout(AddExceptionHandler(FinishSaving), DELAY_SAVE_FOR);
		} else if (bWipeFirst) {
			_oDelayedSave = oSave;
			_bDelayedWipe = bWipeFirst;
		} else {
			Object.assign(_oDelayedSave, oSave);
		}
	}
	function FinishSaving() {
		m_Log.Here('[Settings] Finishing postponed save');
		Check(_nDelayedSaveTimer !== 0);
		_nDelayedSaveTimer = 0;
		Check(IsObject(_oDelayedSave));
		WriteToStorage(_oDelayedSave, _bDelayedWipe);
		_oDelayedSave = null;
	}
	function WriteToStorage(oSave, bWipeFirst) {
		if (bWipeFirst) {
			chrome.storage.local.clear(CheckSaveResult);
			m_Log.Here('[Settings] All settings removed from storage');
		}
		chrome.storage.local.set(oSave, CheckSaveResult);
		m_Log.Here(`[Settings] Settings written to storage: ${m_Log.O(oSave)}`);
	}
	function CheckSaveResult() {
		if (chrome.runtime.lastError) {
			console.error('storage.local.set', chrome.runtime.lastError.message);
			m_Debug.FinishWorkAndShowMessage('J0221');
		}
	}
	// Flushes a pending write now, rather than when its timer would have fired.
	function SaveChanges() {
		if (_nDelayedSaveTimer !== 0) {
			clearTimeout(_nDelayedSaveTimer);
			FinishSaving();
		}
	}
	function Reset() {
		m_Log.Wow('[Settings] Resetting settings');
		CheckRestored();
		const oSave = {};
		for (const sName of _mnoPermanentSettings) {
			oSave[sName] = _oSettings[sName].pCurrent;
		}
		StartSaving(oSave, true);
		window.location.reload(true);
	}
	function Export() {
		m_Log.Wow('[Settings] Exporting settings');
		CheckRestored();
		const oExport = { nSettingsVersion: SETTINGS_VERSION };
		for (const sName of Object.keys(_oSettings)) {
			if (!_mnoPermanentSettings.has(sName)) {
				oExport[sName] = _oSettings[sName].pCurrent;
			}
		}
		m_Log.Here(`[Settings] Settings selected for export: ${m_Log.O(oExport)}`);
		WriteTextToLocalFile(JSON.stringify(oExport), 'application/json', GetText('J0133'));
	}
	/*
		Reads an exported file back. Anything the file gets wrong is a reason to refuse the whole
		file rather than to import half of it: the wrong file gets picked far more often than a
		good one gets hand-edited.
	*/
	function Import(oFromFile) {
		m_Log.Wow(`[Settings] Importing settings from file ${oFromFile.name}`);
		CheckRestored();
		/*
			An export of this schema is under two kilobytes. The bound is there so that a video
			file picked by mistake is refused on sight instead of being read into memory and
			handed to JSON.parse.
		*/
		if (oFromFile.size === 0 || oFromFile.size > 1e4) {
			m_Log.Oops(`[Settings] File size: ${oFromFile.size}`);
			m_Notification.ShowAss();
			return;
		}
		const oReader = new FileReader();
		oReader.addEventListener('loadend', AddExceptionHandler(() => {
			if (!IsNonEmptyString(oReader.result)) {
				m_Log.Oops(`[Settings] File read result: ${oReader.result}`);
				m_Notification.ShowAss();
				return;
			}
			m_Log.Here(`[Settings] Settings read from file: ${oReader.result}`);
			let oSave;
			try {
				oSave = JSON.parse(oReader.result);
				if (!IsObject(oSave)) {
					throw new Error('the file does not hold an object');
				}
				if (ValidateStore(oSave, oSave)) {
					throw new Error('the file carries an unusable settings version');
				}
				for (const sName of Object.keys(oSave)) {
					if (!_oSettings.hasOwnProperty(sName)) {
						delete oSave[sName];
					} else {
						oSave[sName] = _oSettings[sName].CorrectValue(oSave[sName]);
						// A value equal to the default is not worth a line in the store.
						if (oSave[sName] === _oSettings[sName].pInitial) {
							delete oSave[sName];
						}
					}
				}
			} catch (pException) {
				m_Log.Oops(`[Settings] Exception caught while parsing settings: ${pException}`);
				m_Notification.ShowAss();
				return;
			}
			// Taken from memory, not from the file: an export never carries them.
			for (const sName of _mnoPermanentSettings) {
				oSave[sName] = _oSettings[sName].pCurrent;
			}
			StartSaving(oSave, true);
			window.location.reload(true);
		}));
		oReader.readAsText(oFromFile);
	}
	/*
		The value in force: the selected preset's, when it defines this setting, otherwise the
		stored one. A preset overriding the store rather than replacing it is what lets the user
		try bundles and come back without having lost anything.
	*/
	function LookUp(sName) {
		Check(typeof sName == 'string');
		Check(_oSettings.hasOwnProperty(sName));
		CheckRestored();
		for (const oFamily of _aoPresetFamilies) {
			const oPreset = oFamily.amPresets.get(_oSettings[oFamily.sSelected].pCurrent);
			if (oPreset && oPreset[sName] !== void 0) {
				return oPreset[sName];
			}
		}
		return _oSettings[sName].pCurrent;
	}
	/*
		nMaxBufferSize is not a setting and is not stored. The buffer has to hold whichever of the
		two is the larger, and every caller that needs that number asks for it by this name.
	*/
	function Get(sName) {
		if (sName === 'nMaxBufferSize') {
			return Math.max(LookUp('nPlaybackStart'), LookUp('nBufferSize'));
		}
		return LookUp(sName);
	}
	/*
		Sets a value, and takes the family out of its preset when the value belongs to one.

		Leaving a bundle cannot simply flip the selection: the other values of the bundle were
		never written to the store, so the switch alone would silently send them all back to their
		schema defaults. The bundle is copied into the store first, and only then does the one
		value the user asked for move. Writing the value the bundle already holds changes nothing
		at all, so it is not a reason to leave it.
	*/
	function Change(sName, pValue, bNoSave = false) {
		Check(typeof sName == 'string');
		Check(_oSettings.hasOwnProperty(sName));
		Check(_oSettings[sName].CorrectValue(pValue) === pValue);
		const oSave = {};
		for (const oFamily of _aoPresetFamilies) {
			const oPreset = oFamily.amPresets.get(_oSettings[oFamily.sSelected].pCurrent);
			if (!oPreset || !oPreset.hasOwnProperty(sName)) {
				continue;
			}
			if (pValue === oPreset[sName]) {
				return;
			}
			// Leaving a preset is a change worth storing: it can never be a no-save change.
			Check(!bNoSave);
			oSave[oFamily.sSelected] = _oSettings[oFamily.sSelected].pCurrent = oFamily.sCustom;
			oSave[oFamily.sFilled] = _oSettings[oFamily.sFilled].pCurrent = true;
			for (const sPresetName of Object.keys(oPreset)) {
				oSave[sPresetName] = _oSettings[sPresetName].pCurrent = oPreset[sPresetName];
			}
			UpdatePresetList(oFamily);
			break;
		}
		if (_oSettings[sName].pCurrent !== pValue) {
			oSave[sName] = _oSettings[sName].pCurrent = pValue;
		}
		if (!bNoSave) {
			StartSaving(oSave, false);
		}
	}
	/*
		Rebuilds a family's list from its bundles, plus the custom entry once the user has one.
		Returns the element, so that the caller can go on wiring it.
	*/
	function UpdatePresetList(oFamily) {
		const nodeList = GetNode(oFamily.sList);
		nodeList.length = 0;
		const sSelected = _oSettings[oFamily.sSelected].pCurrent;
		const AddOption = sName => nodeList.add(new Option(GetText(sName), sName, sName === sSelected, sName === sSelected));
		for (const sName of oFamily.amPresets.keys()) {
			AddOption(sName);
		}
		if (_oSettings[oFamily.sFilled].pCurrent) {
			AddOption(oFamily.sCustom);
		}
		// The selection must have landed on one of the entries just added.
		Check(nodeList.value);
		return nodeList;
	}
	const ProcessPresetChange = AddExceptionHandler(oEvent => {
		for (const oFamily of _aoPresetFamilies) {
			if (oFamily.sList === oEvent.target.id) {
				Check(oEvent.target.value);
				Change(oFamily.sSelected, oEvent.target.value);
				m_Events.SendEvent(oFamily.sEvent);
				return;
			}
		}
		// The handler is wired to those lists and to nothing else.
		Check(false);
	});
	function ConfigurePresetLists() {
		for (const oFamily of _aoPresetFamilies) {
			UpdatePresetList(oFamily).addEventListener('change', ProcessPresetChange);
		}
	}
	/*
		The declaration behind a name. The interface reads pInitial, nMinimum, nMaximum and
		sAutoTune off it to drive the number inputs, which is why they are plain fields.
	*/
	function GetSettingParameters(sName) {
		Check(typeof sName == 'string');
		Check(_oSettings.hasOwnProperty(sName));
		return _oSettings[sName];
	}
	/*
		For the bug report: the bookkeeping, plus whatever the user has actually changed. A default
		tells the reader nothing, and forty of them would bury the three lines that matter.
	*/
	function GetDataForReport() {
		const oReport = {};
		for (const sName of Object.keys(_oSettings)) {
			if (_mnoPermanentSettings.has(sName) || _oSettings[sName].pCurrent !== _oSettings[sName].pInitial) {
				oReport[sName] = _oSettings[sName].pCurrent;
			}
		}
		return oReport;
	}
	window.addEventListener('beforeunload', SaveChanges);
	return {
		Restore,
		Reset,
		Export,
		Import,
		Get,
		Change,
		SaveChanges,
		GetSettingParameters,
		ConfigurePresetLists,
		GetDataForReport
	};
})();