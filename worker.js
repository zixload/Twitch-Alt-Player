'use strict';

var MAKE_FIRST_FRAME_KEY = getBrowserEngineVersion() < 50;

var STATE_VARIANT_CHANGE = 9;

function Check(pCondition) {
	if (!pCondition) {
		throw new Error('Проверка не пройдена');
	}
}

function getBrowserEngineVersion() {
	if (!getBrowserEngineVersion.hasOwnProperty('_чРезультат')) {
		if (navigator.userAgentData) {
			for (const {brand, version} of navigator.userAgentData.brands) {
				if (brand === 'Chromium' || brand === 'Google Chrome') {
					getBrowserEngineVersion._чРезультат = Number.parseInt(version, 10);
					break;
				}
			}
		}
		if (!getBrowserEngineVersion._чРезультат) {
			getBrowserEngineVersion._чРезультат = navigator.userAgent ? Number.parseInt(/Chrome\/(\d+)/.exec(navigator.userAgent)[1], 10) : 89;
		}
	}
	return getBrowserEngineVersion._чРезультат;
}

function isMobileDevice() {
	if (!isMobileDevice.hasOwnProperty('_лРезультат')) {
		isMobileDevice._лРезультат = navigator.userAgentData ? navigator.userAgentData.mobile : navigator.userAgent.includes('Android');
	}
	return isMobileDevice._лРезультат;
}

if (getBrowserEngineVersion() < 58) {
	Uint8Array.prototype.copyWithin = function(target, begin, end) {
		target |= 0;
		begin |= 0;
		end |= 0;
		var c = end - begin | 0;
		if ((c | 0) > 70) {
			this.set(new Uint8Array(this.buffer, begin, c), target);
		} else {
			while ((begin | 0) < (end | 0)) {
				this[target] = this[begin];
				target = target + 1 | 0;
				begin = begin + 1 | 0;
			}
		}
	};
}

if (getBrowserEngineVersion() >= 70) {
	var CreateDataView = mbBuffer => new DataView(mbBuffer.buffer);
} else {
	CreateDataView = (mbBuffer => mbBuffer);
	Uint8Array.prototype.getUint8 = function(u) {
		u |= 0;
		return this[u];
	};
	Uint8Array.prototype.getInt16 = function(u) {
		u |= 0;
		return this[u] << 24 >> 16 | this[u + 1 | 0];
	};
	Uint8Array.prototype.getUint16 = function(u) {
		u |= 0;
		return this[u] << 8 | this[u + 1 | 0];
	};
	Uint8Array.prototype.getInt32 = function(u) {
		u |= 0;
		return this[u] << 24 | this[u + 1 | 0] << 16 | this[u + 2 | 0] << 8 | this[u + 3 | 0];
	};
	Uint8Array.prototype.getUint32 = function(u) {
		u |= 0;
		return (this[u] << 24 | this[u + 1 | 0] << 16 | this[u + 2 | 0] << 8 | this[u + 3 | 0]) >>> 0;
	};
	Uint8Array.prototype.setInt8 = Uint8Array.prototype.setUint8 = function(u, nValue) {
		u |= 0;
		nValue |= 0;
		this[u] = nValue;
	};
	Uint8Array.prototype.setInt16 = Uint8Array.prototype.setUint16 = function(u, nValue) {
		u |= 0;
		nValue |= 0;
		this[u] = nValue >> 8;
		this[u + 1 | 0] = nValue;
	};
	Uint8Array.prototype.setInt32 = Uint8Array.prototype.setUint32 = function(u, nValue) {
		u |= 0;
		nValue |= 0;
		this[u] = nValue >> 24;
		this[u + 1 | 0] = nValue >> 16;
		this[u + 2 | 0] = nValue >> 8;
		this[u + 3 | 0] = nValue;
	};
}

Uint8Array.prototype.getUint64 = function(u) {
	u |= 0;
	return ((this[u] << 24 | this[u + 1 | 0] << 16 | this[u + 2 | 0] << 8 | this[u + 3 | 0]) >>> 0) * 4294967296 + ((this[u + 4 | 0] << 24 | this[u + 5 | 0] << 16 | this[u + 6 | 0] << 8 | this[u + 7 | 0]) >>> 0);
};

Uint8Array.prototype.setInt64 = Uint8Array.prototype.setUint64 = function(u, nValue) {
	u |= 0;
	var h = Math.trunc(nValue);
	if (h < Number.MIN_SAFE_INTEGER || h > Number.MAX_SAFE_INTEGER) {
		throw new Error(nValue);
	}
	var n32 = h / 4294967296 | 0;
	this[u] = n32 >> 24;
	this[u + 1 | 0] = n32 >> 16;
	this[u + 2 | 0] = n32 >> 8;
	this[u + 3 | 0] = n32;
	n32 = h | 0;
	this[u + 4 | 0] = n32 >> 24;
	this[u + 5 | 0] = n32 >> 16;
	this[u + 6 | 0] = n32 >> 8;
	this[u + 7 | 0] = n32;
};

class Wasm {
	constructor() {
		this._oModule = null;
		this._oMemory = null;
		this._oInstance = null;
	}
	_CalculateHeapSize(kbSize) {
		return Math.ceil(kbSize) + (Wasm.PAGE_SIZE - 1) & ~(Wasm.PAGE_SIZE - 1);
	}
	Compile() {
		return fetch('wasm.wasm').then(oResponse => oResponse.arrayBuffer()).then(bufCode => WebAssembly.compile ? WebAssembly.compile(bufCode) : new WebAssembly.Module(bufCode)).then(oModule => {
			this._oModule = oModule;
		});
	}
	AllocateMemory(kbSize) {
		kbSize = this._CalculateHeapSize(kbSize);
		if (this._oMemory === null) {
			this._oMemory = new WebAssembly.Memory({
				initial: kbSize / Wasm.PAGE_SIZE
			});
			this._oInstance = new WebAssembly.Instance(this._oModule, {
				i: {
					m: this._oMemory
				}
			});
		} else {
			this._oMemory.grow((kbSize - this._oMemory.buffer.byteLength) / Wasm.PAGE_SIZE);
		}
		return [ this._oMemory.buffer, this._oInstance.exports ];
	}
	FreeMemory() {
		this._oMemory = null;
		this._oInstance = null;
	}
	static Available() {
		return !!self.WebAssembly;
	}
}

Wasm.PAGE_SIZE = 65536;

class Asmjs {
	_CalculateHeapSize(kbSize) {
		kbSize = Math.ceil(kbSize);
		if (kbSize <= Wasm.PAGE_SIZE) {
			return Wasm.PAGE_SIZE;
		}
		if (kbSize < 1 << 24) {
			return 1 << 32 - Math.clz32(kbSize - 1);
		}
		return kbSize + 16777215 & 4278190080;
	}
	Compile() {
		importScripts('asmjs.js');
		return Promise.resolve();
	}
	AllocateMemory(kbSize) {
		kbSize = this._CalculateHeapSize(kbSize);
		var bufHeap = new ArrayBuffer(kbSize);
		return [ bufHeap, AsmjsModule(self, null, bufHeap) ];
	}
	FreeMemory() {}
}

class BitStream {
	constructor(mbBuffer, uStart, uEnd) {
		Check(Number.isInteger(uStart) && Number.isInteger(uEnd) && uStart >= 0 && uEnd <= mbBuffer.length && uEnd >= uStart);
		this._mbBuffer = mbBuffer;
		this._uNextByte = uStart;
		this._nNextBit = 7;
		this.kBitsLeft = (uEnd - uStart) * 8;
	}
	SkipBits(kBits) {
		Check(Number.isInteger(kBits));
		Check((this.kBitsLeft -= kBits) >= 0);
		if (kBits === 1) {
			if (--this._nNextBit < 0) {
				this._nNextBit = 7;
				++this._uNextByte;
			}
		} else {
			var h = this._nNextBit - kBits;
			if (h >= 0) {
				this._nNextBit = h;
			} else {
				h = -h - 1;
				this._nNextBit = 7 - (h & 7);
				this._uNextByte += (h >>> 3) + 1;
			}
		}
	}
	ReadBits(kBits) {
		Check(Number.isInteger(kBits));
		Check((this.kBitsLeft -= kBits) >= 0);
		if (kBits === 1) {
			nResult = this._mbBuffer[this._uNextByte] >>> this._nNextBit & 1;
			if (--this._nNextBit < 0) {
				this._nNextBit = 7;
				++this._uNextByte;
			}
		} else {
			Check(kBits >= 1 && kBits <= 32);
			var nResult = 0;
			var чСледующийБитРезультата = kBits - 1;
			var чМаска = (1 << this._nNextBit + 1) - 1;
			do {
				var чБиты = this._mbBuffer[this._uNextByte] & чМаска;
				nResult |= this._nNextBit < чСледующийБитРезультата ? чБиты << чСледующийБитРезультата - this._nNextBit : чБиты >>> this._nNextBit - чСледующийБитРезультата;
				var кБитДобавлено = Math.min(чСледующийБитРезультата, this._nNextBit) + 1;
				if ((this._nNextBit -= кБитДобавлено) < 0) {
					this._nNextBit = 7;
					++this._uNextByte;
					чМаска = 255;
				}
			} while ((чСледующийБитРезультата -= кБитДобавлено) >= 0);
		}
		return nResult >>> 0;
	}
	ReadUnsignedExpGolomb() {
		for (var kLeadingZeros = 0; this.ReadBits(1) === 0; ++kLeadingZeros) {}
		Check(kLeadingZeros <= 31);
		return kLeadingZeros === 0 ? 0 : (1 << kLeadingZeros >>> 0) - 1 + this.ReadBits(kLeadingZeros);
	}
	ReadSignedExpGolomb() {
		var h = this.ReadUnsignedExpGolomb();
		return (h & 1) != 0 ? Math.ceil(h / 2) : -h / 2;
	}
	SkipExpGolomb() {
		for (var kLeadingZeros = 0; this.ReadBits(1) === 0; ++kLeadingZeros) {}
		if (kLeadingZeros !== 0) {
			this.SkipBits(kLeadingZeros);
		}
	}
}

class IsoBaseMedia {
	constructor(mbBuffer, dvBuffer, uStart) {
		Check(Number.isInteger(uStart) && uStart >= 0 && uStart <= mbBuffer.length);
		this.mbBuffer = mbBuffer;
		this.dvBuffer = dvBuffer;
		this.uStart = uStart;
		this.uEnd = uStart;
	}
	Finish() {
		Check(Number.isInteger(this.uEnd) && this.uEnd >= this.uStart && this.uEnd <= this.mbBuffer.length);
		return this.mbBuffer.subarray(this.uStart, this.uEnd);
	}
	AddFullBox(sType, чВерсия, чФлаги, pContent) {
		Check(sType.length === 4 && Number.isFinite(чВерсия) && Number.isFinite(чФлаги));
		Check(this.uEnd >= this.uStart);
		var uStart = this.uEnd;
		Check(this.mbBuffer.length - this.uEnd >= 8);
		this.mbBuffer[uStart + 4] = sType.charCodeAt(0);
		this.mbBuffer[uStart + 5] = sType.charCodeAt(1);
		this.mbBuffer[uStart + 6] = sType.charCodeAt(2);
		this.mbBuffer[uStart + 7] = sType.charCodeAt(3);
		this.uEnd += 8;
		if (чВерсия !== -1) {
			Check(чВерсия >= 0 && чВерсия <= 255 && чФлаги >= 0 && чФлаги <= 16777215);
			Check(this.mbBuffer.length - this.uEnd >= 4);
			this.dvBuffer.setUint32(uStart + 8, чВерсия << 24 | чФлаги);
			this.uEnd += 4;
		}
		if (typeof pContent == 'number') {
			Check(Number.isInteger(pContent) && pContent >= 0);
			this.uEnd += pContent;
			Check(this.uEnd <= this.mbBuffer.length);
		} else if (typeof pContent == 'function') {
			var u = this.uEnd;
			pContent();
			Check(Number.isInteger(this.uEnd) && this.uEnd >= u && this.uEnd <= this.mbBuffer.length);
		} else {
			this.CopyFromArray(this.uEnd, pContent);
		}
		this.dvBuffer.setUint32(uStart, this.uEnd - uStart);
	}
	AddBox(sType, pContent) {
		return this.AddFullBox(sType, -1, -1, pContent);
	}
	CopyFromArray(uTo, mnFrom) {
		Check(Number.isInteger(uTo) && uTo >= this.uEnd);
		this.mbBuffer.set(mnFrom, uTo);
		this.uEnd = uTo + mnFrom.length;
	}
	CopyFromBuffer(uTo, mbFrom, uStart, uEnd) {
		Check(Number.isInteger(uTo) && uTo >= this.uEnd);
		Check(mbFrom.buffer !== this.mbBuffer.buffer);
		if (arguments.length === 2) {
			this.mbBuffer.set(mbFrom, uTo);
			this.uEnd = uTo + mbFrom.length;
		} else {
			Check(Number.isInteger(uStart) && Number.isInteger(uEnd) && mbFrom.byteOffset === 0);
			this.mbBuffer.set(new Uint8Array(mbFrom.buffer, uStart, uEnd - uStart), uTo);
			this.uEnd = uTo + uEnd - uStart;
		}
	}
}

class ID3 {
	constructor(mbBuffer, uStart, uEnd) {
		var РАЗМЕР_ЗАГОЛОВКА_ТЕГА = 10;
		var FIELD_HEADER_SIZE = 10;
		Check(mbBuffer.BYTES_PER_ELEMENT === 1 && Number.isInteger(uStart) && Number.isInteger(uEnd) && uStart >= 0 && uStart <= uEnd);
		this._mb = mbBuffer;
		this._uTagStart = -1;
		this._kbTagSize = -1;
		this._uFieldStart = -1;
		this._kbFieldSize = -1;
		var kbSize = uEnd - uStart;
		if (kbSize > РАЗМЕР_ЗАГОЛОВКА_ТЕГА + FIELD_HEADER_SIZE && this._mb[uStart] === 73 && this._mb[uStart + 1] === 68 && this._mb[uStart + 2] === 51 && this._mb[uStart + 3] === 4 && this._mb[uStart + 5] === 0 && this._ParseSynchsafeInteger(uStart + 6) === kbSize - РАЗМЕР_ЗАГОЛОВКА_ТЕГА) {
			this._uTagStart = uStart + РАЗМЕР_ЗАГОЛОВКА_ТЕГА;
			this._kbTagSize = kbSize - РАЗМЕР_ЗАГОЛОВКА_ТЕГА;
		}
	}
	_ParseSynchsafeInteger(uAddress) {
		var nResult = -1;
		var чБайт = this._mb[uAddress];
		if (чБайт < 128) {
			var ч4Байта = чБайт << 24 - 3;
			чБайт = this._mb[uAddress + 1];
			if (чБайт < 128) {
				ч4Байта |= чБайт << 16 - 2;
				чБайт = this._mb[uAddress + 2];
				if (чБайт < 128) {
					ч4Байта |= чБайт << 8 - 1;
					чБайт = this._mb[uAddress + 3];
					if (чБайт < 128) {
						nResult = ч4Байта | чБайт;
					}
				}
			}
		}
		return nResult;
	}
	_GetTagText() {
		if (this._kbFieldSize < 2 || this._mb[this._uFieldStart] !== 3) {
			return null;
		}
		if (ID3._oUtf8Decoder === null) {
			ID3._oUtf8Decoder = new TextDecoder('utf-8', {
				fatal: true
			});
		}
		try {
			return ID3._oUtf8Decoder.decode(new Uint8Array(this._mb.buffer, this._mb.byteOffset + this._uFieldStart + 1, this._kbFieldSize - 1));
		} catch (_) {
			return null;
		}
	}
	* [Symbol.iterator]() {
		var FIELD_HEADER_SIZE = 10;
		var уТег = this._uTagStart;
		var кбТег = this._kbTagSize;
		while (кбТег > FIELD_HEADER_SIZE) {
			var чКод1 = this._mb[уТег];
			var чКод2 = this._mb[уТег + 1];
			var чКод3 = this._mb[уТег + 2];
			var чКод4 = this._mb[уТег + 3];
			if ((чКод1 < 48 || чКод1 > 57) && (чКод1 < 65 || чКод1 > 90) || (чКод2 < 48 || чКод2 > 57) && (чКод2 < 65 || чКод2 > 90) || (чКод3 < 48 || чКод3 > 57) && (чКод3 < 65 || чКод3 > 90) || (чКод4 < 48 || чКод4 > 57) && (чКод4 < 65 || чКод4 > 90)) {
				break;
			}
			if (this._mb[уТег + 9] !== 0) {
				break;
			}
			var кбПоле = this._ParseSynchsafeInteger(уТег + 4);
			if (кбПоле < 1 || кбПоле > кбТег - FIELD_HEADER_SIZE) {
				break;
			}
			this._uFieldStart = уТег + FIELD_HEADER_SIZE;
			this._kbFieldSize = кбПоле;
			уТег += FIELD_HEADER_SIZE + кбПоле;
			кбТег -= FIELD_HEADER_SIZE + кбПоле;
			yield String.fromCharCode(чКод1, чКод2, чКод3, чКод4);
		}
		this._uFieldStart = -1;
		this._kbFieldSize = -1;
	}
	ПолучитьПервуюСтроку() {
		var sText = this._GetTagText();
		if (sText === null) {
			return null;
		}
		var nStringEnd = sText.indexOf('\0');
		if (nStringEnd === -1) {
			return null;
		}
		return sText.slice(0, nStringEnd);
	}
	ParseTXXX() {
		var sText = this._GetTagText();
		if (sText === null) {
			return null;
		}
		var nStringEnd = sText.indexOf('\0');
		if (nStringEnd === -1) {
			return null;
		}
		var sDescription = sText.slice(0, nStringEnd);
		var sValue = sText.slice(nStringEnd + 1);
		if (sValue.indexOf('\0') !== -1) {
			return null;
		}
		return {
			sDescription,
			sValue
		};
	}
}

ID3._oUtf8Decoder = null;

class Track {
	constructor(kbSampleStruct) {
		Check(Number.isInteger(kbSampleStruct) && kbSampleStruct >= 0);
		this.uStreamMemoryStart = 0;
		this.uStreamMemoryEnd = 0;
		this.uStreamStart = 0;
		this.uStreamEnd = 0;
		this.uSamplesMemoryEnd = 0;
		this.uSamplesStart = 0;
		this.uSamplesEnd = 0;
		this.kbSampleStruct = kbSampleStruct;
		this.nStartDTS = -1;
		this.nContinuityCounter = -1;
		this.pPesPacketEnd = -1;
	}
	Empty() {
		return this.uStreamEnd === this.uStreamStart;
	}
	GetStreamSize() {
		Check(Number.isInteger(this.uStreamStart) && Number.isInteger(this.uStreamEnd) && this.uStreamStart >= 0 && this.uStreamStart <= this.uStreamEnd);
		Check(this.uStreamStart >= this.uStreamMemoryStart && this.uStreamEnd <= this.uStreamMemoryEnd);
		return this.uStreamEnd - this.uStreamStart;
	}
	GetSamplesSize() {
		Check(Number.isInteger(this.uSamplesStart) && Number.isInteger(this.uSamplesEnd) && this.uSamplesStart >= 0 && this.uSamplesStart <= this.uSamplesEnd);
		Check(this.uSamplesEnd <= this.uSamplesMemoryEnd);
		Check((this.uSamplesEnd - this.uSamplesStart) % this.kbSampleStruct == 0);
		return this.uSamplesEnd - this.uSamplesStart;
	}
	GetSampleCount() {
		return this.GetSamplesSize() / this.kbSampleStruct;
	}
	GetSampleNumber(uSample) {
		Check(Number.isInteger(this.uSamplesStart) && Number.isInteger(this.uSamplesEnd) && this.uSamplesStart >= 0 && this.uSamplesStart <= this.uSamplesEnd);
		Check(this.uSamplesEnd <= this.uSamplesMemoryEnd);
		Check(Number.isInteger(uSample));
		if (this.Empty() || uSample < this.uSamplesStart) {
			return NaN;
		}
		Check(uSample <= this.uSamplesEnd - this.kbSampleStruct);
		Check((uSample - this.uSamplesStart) % this.kbSampleStruct == 0);
		return (uSample - this.uSamplesStart) / this.kbSampleStruct;
	}
}

var m_Log = (() => {
	var _мсВажность = [];
	var _мсЗаписи = [];
	function Add(sImportance, sRecord) {
		_мсВажность.push(sImportance);
		_мсЗаписи.push(`[Worker] ${sRecord}`);
	}
	function Вот(sRecord) {
		Add('Вот', sRecord);
	}
	function Окак(sRecord) {
		Add('Окак', sRecord);
	}
	function Ой(sRecord) {
		Add('Ой', sRecord);
	}
	function Send() {
		if (_мсВажность.length !== 0) {
			postMessage([ 2, _мсВажность, _мсЗаписи ]);
			_мсВажность.length = 0;
			_мсЗаписи.length = 0;
		}
	}
	return {
		Вот,
		Окак,
		Ой,
		Send
	};
})();

{
	var TRANSPORT_PACKET_SIZE = 188;
	var TS_TIMESCALE = 9e4;
	var AUDIO_SAMPLE_LENGTH = 1024;
	var SAMPLE_RATES = [ 96e3, 88200, 64e3, 48e3, 44100, 32e3, 24e3, 22050, 16e3, 12e3, 11025, 8e3, 7350 ];
	var VIDEO_TRACK_NUMBER = 1;
	var AUDIO_TRACK_NUMBER = 2;
	var AUDIO_SAMPLE_STRUCT_SIZE = 1 * 4;
	var VIDEO_SAMPLE_STRUCT_SIZE = 4 * 4;
	var VIDEO_SAMPLE_DURATION = 0;
	var VIDEO_SAMPLE_SIZE = 4;
	var VIDEO_SAMPLE_FLAGS = 8;
	var VIDEO_SAMPLE_CTO = 12;
	var _mUnprocessedMessages = [];
	var _oSourceSegment = null;
	var _mbHeap = null;
	var _mcHeap = null;
	var _dvHeap = null;
	var _fFindPrefix = null;
	var _oAssembler = Wasm.Available() ? new Wasm() : new Asmjs();
	var _bDiscontinuity = true;
	var _oPat = null;
	var _oPmt = null;
	var _trVideo = new Track(VIDEO_SAMPLE_STRUCT_SIZE);
	var _trAudio = new Track(AUDIO_SAMPLE_STRUCT_SIZE);
	var _trMetadata = new Track(0);
	var _muMetadataStart = [];
	var _nLastVideoSampleDTS;
	var _nVideoSegmentEndDTS;
	var _nAudioSegmentEndDTS;
	var _nPrevVideoSegmentLastSampleDTS;
	var _nPrevVideoSegmentEndDTS;
	var _nPrevAudioSegmentEndDTS;
	var _anDecoderSpecificInfo = [ 0, 0 ];
	var _abSequenceParameterSet;
	var _abPictureParameterSet;
	var _abSequenceParameterSetExt;
	var _nProfileIndication;
	var _nConstraintSetFlag;
	var _nLevelIndication;
	var _nChromaFormatIndication;
	var _nBitDepthLumaMinus8;
	var _nBitDepthChromaMinus8;
	var _nMaxNumberReferenceFrames;
	var _nPictureWidth;
	var _nPictureHeight;
	var _nFrameRate;
	var _nRange;
	var _bInterlaced;
	var _nAudioObjectType;
	var _nSampleRate;
	var _nChannelCount;
	var _nConvertedIn = NaN;
	var _bRejected;
	var _bVideoLoss;
	var _bAudioLoss;
	var _nMinVideoSampleDuration;
	var _nMaxVideoSampleDuration;
	var _nAvgVideoSampleDuration;
	var _nAudioBitrate;
	var _nEncodingPosition;
	var _nBroadcastPosition;
	var _nEncodingTime;
	function ОчиститьСтатистику() {
		_bRejected = false;
		_bVideoLoss = false;
		_bAudioLoss = false;
		_nMinVideoSampleDuration = +Infinity;
		_nMaxVideoSampleDuration = -Infinity;
		_nAvgVideoSampleDuration = NaN;
		_nAudioBitrate = NaN;
		_nEncodingPosition = NaN;
		_nBroadcastPosition = NaN;
		_nEncodingTime = NaN;
	}
	function Браковать(pCondition) {
		if (!pCondition) {
			throw new Error('БРАКОВАТЬ');
		}
	}
	function Мс(чВремяТП, сЕдиницыИзмерения = 'мс') {
		return `${(чВремяТП / (TS_TIMESCALE / 1e3)).toFixed(2)}${сЕдиницыИзмерения}`;
	}
	function ОтправитьРезультат(mbufTransfer) {
		postMessage([ 1, _oSourceSegment ], mbufTransfer);
	}
	function FinishWorkAndShowMessage(sMessageCode) {
		postMessage([ 4, sMessageCode ]);
		throw void 0;
	}
	function TerminateAndSendReport(pException) {
		var sTerminationReason = pException instanceof Error ? `Поймано исключение в рабочем потоке: ${pException.stack}` : `Поймано исключение в рабочем потоке: [typeof ${typeof pException}] ${new Error(pException).stack}`;
		if (typeof _oSourceSegment == 'object' && _oSourceSegment !== null && typeof _oSourceSegment.pData == 'object' && _oSourceSegment.pData !== null && _oSourceSegment.pData.byteLength) {
			postMessage([ 3, sTerminationReason, _oSourceSegment.pData ], [ _oSourceSegment.pData ]);
		} else {
			postMessage([ 3, sTerminationReason, null ]);
		}
		_oSourceSegment = null;
	}
	function ВыброситьВПомойку(мбБарахло) {
		if (isMobileDevice() || getBrowserEngineVersion() >= 64) {
			return;
		}
		if (мбБарахло && мбБарахло.buffer.byteLength) {
			Check(_mbHeap === null || _mbHeap.buffer !== мбБарахло.buffer);
			postMessage([ 5, мбБарахло.buffer ], [ мбБарахло.buffer ]);
		}
	}
	var m_Memory = (() => {
		var МАКС_ДЛИТЕЛЬНОСТЬ_СЕГМЕНТА = 30;
		var МАКС_ЧАСТОТА_КАДРОВ = 150;
		var МАКС_КОЛИЧЕСТВО_NAL_UNITS_В_КАДРЕ = 10;
		var ЗАНАЧКА = 1.4;
		var РАЗМЕР_КРАТЕН_БАЙТАМ = 1 << 6;
		var РАЗМЕР_ДАННЫХ_АССЕМБЛЕРА = Выровнить(4);
		var РАЗМЕР_ПАМЯТИ_ВИДЕОСЕМПЛОВ = Выровнить(VIDEO_SAMPLE_STRUCT_SIZE * МАКС_ЧАСТОТА_КАДРОВ * МАКС_ДЛИТЕЛЬНОСТЬ_СЕГМЕНТА);
		var РАЗМЕР_ПАМЯТИ_АУДИОСЕМПЛОВ = Выровнить(AUDIO_SAMPLE_STRUCT_SIZE * SAMPLE_RATES[0] / AUDIO_SAMPLE_LENGTH * МАКС_ДЛИТЕЛЬНОСТЬ_СЕГМЕНТА);
		var РАЗМЕР_ПАМЯТИ_МЕДИАПОТОКА = Выровнить(1e4);
		var РАЗМЕР_РЕЗЕРВА_ВИДЕОПОТОКА = Выровнить(МАКС_КОЛИЧЕСТВО_NAL_UNITS_В_КАДРЕ * МАКС_ЧАСТОТА_КАДРОВ * МАКС_ДЛИТЕЛЬНОСТЬ_СЕГМЕНТА);
		function Выровнить(чАдресИлиРазмер) {
			return Math.ceil(чАдресИлиРазмер) + (РАЗМЕР_КРАТЕН_БАЙТАМ - 1) & ~(РАЗМЕР_КРАТЕН_БАЙТАМ - 1);
		}
		function Allocate(mbTransportStream) {
			var уВыделить = РАЗМЕР_ДАННЫХ_АССЕМБЛЕРА;
			_trVideo.uSamplesStart = _trVideo.uSamplesEnd = уВыделить;
			_trVideo.uSamplesMemoryEnd = уВыделить += РАЗМЕР_ПАМЯТИ_ВИДЕОСЕМПЛОВ;
			_trAudio.uSamplesStart = _trAudio.uSamplesEnd = уВыделить;
			_trAudio.uSamplesMemoryEnd = уВыделить += РАЗМЕР_ПАМЯТИ_АУДИОСЕМПЛОВ;
			_trMetadata.uStreamMemoryStart = _trMetadata.uStreamStart = _trMetadata.uStreamEnd = уВыделить;
			_trMetadata.uStreamMemoryEnd = уВыделить += РАЗМЕР_ПАМЯТИ_МЕДИАПОТОКА;
			_trVideo.uStreamMemoryStart = уВыделить;
			_trVideo.uStreamStart = _trVideo.uStreamEnd = уВыделить += РАЗМЕР_РЕЗЕРВА_ВИДЕОПОТОКА;
			var кбПостоянныйРазмер = уВыделить;
			_trVideo.uStreamMemoryEnd = уВыделить += Выровнить(mbTransportStream.length);
			_trAudio.uStreamMemoryStart = _trAudio.uStreamStart = _trAudio.uStreamEnd = уВыделить;
			_trAudio.uStreamMemoryEnd = уВыделить += Выровнить(mbTransportStream.length);
			var кбПеременныйРазмер = уВыделить - кбПостоянныйРазмер;
			if (_mbHeap === null || _mbHeap.length < уВыделить) {
				var кбРазмерКучи = кбПостоянныйРазмер + кбПеременныйРазмер * ЗАНАЧКА;
				if (_mbHeap === null) {
					m_Log.Вот(`Создаю кучу ${кбРазмерКучи} байт`);
				} else {
					m_Log.Ой(`Увеличиваю кучу с ${_mbHeap.length} до ${кбРазмерКучи} байт`);
				}
				var [bufHeap, oExport] = _oAssembler.AllocateMemory(кбРазмерКучи);
				_mbHeap = new Uint8Array(bufHeap);
				_mcHeap = new Int32Array(bufHeap);
				_dvHeap = CreateDataView(_mbHeap);
				_fFindPrefix = oExport.SearchStartCodePrefix;
			}
		}
		function Free() {
			_oAssembler.FreeMemory();
			_mbHeap = null;
			_mcHeap = null;
			_dvHeap = null;
			_fFindPrefix = null;
		}
		return {
			Allocate,
			Free
		};
	})();
	function РазобратьТранспортныйПоток(mbTransportStream) {
		Браковать(mbTransportStream.length !== 0 && mbTransportStream.length % TRANSPORT_PACKET_SIZE == 0);
		_trVideo.nStartDTS = _trAudio.nStartDTS = -1;
		_trMetadata.nStartDTS = 0;
		_trVideo.pPesPacketEnd = _trAudio.pPesPacketEnd = _trMetadata.pPesPacketEnd = -1;
		_muMetadataStart.length = 0;
		_nLastVideoSampleDTS = -1;
		if (_bDiscontinuity) {
			_trVideo.nContinuityCounter = _trAudio.nContinuityCounter = _trMetadata.nContinuityCounter = -1;
			_oPat = _oPmt = null;
		}
		var nPmtPid = -1, nVideoPid = -1, nAudioPid = -1, nMetadataPid = -1;
		var cPat = 0, cPmt = 0, кИзмененийВД = 0;
		var уТранспортныйПакет = _trVideo.uStreamStart | 0;
		_mbHeap.set(mbTransportStream, уТранспортныйПакет);
		for (var уКонецТранспортногоПотока = уТранспортныйПакет + mbTransportStream.length; уТранспортныйПакет !== уКонецТранспортногоПотока; уТранспортныйПакет += TRANSPORT_PACKET_SIZE) {
			var чЗаголовокТранспортногоПакета = _dvHeap.getUint32(уТранспортныйПакет) | 0;
			Браковать((чЗаголовокТранспортногоПакета & 4286578880) == 1191182336);
			var nPid = (чЗаголовокТранспортногоПакета & 2096896) >> 8;
			var pPayload = уТранспортныйПакет + 4;
			if ((чЗаголовокТранспортногоПакета & 32) != 0) {
				var cbAdaptationField = _mbHeap[pPayload];
				Check(cbAdaptationField <= TRANSPORT_PACKET_SIZE - 5);
				Check(cbAdaptationField === 0 || (_mbHeap[pPayload + 1] & 128) == 0);
				pPayload += 1 + cbAdaptationField;
			}
			var дорОбработать;
			switch (nPid) {
			  case nVideoPid:
				if ((чЗаголовокТранспортногоПакета & 4194304) != 0) {
					Check((_dvHeap.getUint32(pPayload) & 4294967280) == 480);
				}
				дорОбработать = _trVideo;
				break;

			  case nAudioPid:
				if ((чЗаголовокТранспортногоПакета & 4194304) != 0) {
					Check((_dvHeap.getUint32(pPayload) & 4294967264) == 448);
				}
				дорОбработать = _trAudio;
				break;

			  case nMetadataPid:
				if ((чЗаголовокТранспортногоПакета & 4194304) != 0) {
					Check(_dvHeap.getUint32(pPayload) === 445);
					Check((_mbHeap[pPayload + 6] & 4) != 0);
					Check((_mbHeap[pPayload + 7] & 192) == 128);
					_muMetadataStart.push(_trMetadata.uStreamEnd);
				}
				дорОбработать = _trMetadata;
				break;

			  case 0:
				Check((чЗаголовокТранспортногоПакета & 4194320) == 4194320);
				var oPat = new ProgramAssociationTable(pPayload, уТранспортныйПакет + TRANSPORT_PACKET_SIZE);
				if (_oPat === null) {
					_oPat = oPat;
					m_Log.Вот(`PatVersion=${oPat.nPatVersion} ProgramNumber=${oPat.nProgramNumber} PmtPid=${oPat.nPmtPid}`);
				} else {
					Check(_oPat.nPatVersion === oPat.nPatVersion && _oPat.nProgramNumber === oPat.nProgramNumber && _oPat.nPmtPid === oPat.nPmtPid);
				}
				nPmtPid = oPat.nPmtPid;
				++cPat;
				continue;

			  case nPmtPid:
				Check((чЗаголовокТранспортногоПакета & 4194320) == 4194320);
				var oPmt = new ProgramMapTable(pPayload, уТранспортныйПакет + TRANSPORT_PACKET_SIZE, _oPat.nProgramNumber);
				if (_oPmt === null) {
					_oPmt = oPmt;
					m_Log.Вот(`PmtVersion=${oPmt.nPmtVersion} VideoPid=${oPmt.nVideoPid} AudioPid=${oPmt.nAudioPid} MetadataPid=${oPmt.nMetadataPid}`);
				} else {
					Check(_oPmt.nPmtVersion === oPmt.nPmtVersion && _oPmt.nVideoPid === oPmt.nVideoPid && _oPmt.nAudioPid === oPmt.nAudioPid && _oPmt.nMetadataPid === oPmt.nMetadataPid);
				}
				({nVideoPid, nAudioPid, nMetadataPid} = oPmt);
				++cPmt;
				continue;

			  default:
				continue;
			}
			if (дорОбработать.nContinuityCounter !== (чЗаголовокТранспортногоПакета & 15) && дорОбработать.nContinuityCounter !== -1) {
				m_Log.Ой(`continuity_counter равен ${чЗаголовокТранспортногоПакета & 15} вместо ${дорОбработать.nContinuityCounter} PID=${nPid} СмещениеПакета=${mbTransportStream.length - уКонецТранспортногоПотока + уТранспортныйПакет}`);
				Браковать(дорОбработать.uStreamEnd === дорОбработать.uStreamStart);
			}
			дорОбработать.nContinuityCounter = чЗаголовокТранспортногоПакета + 1 & 15;
			switch (чЗаголовокТранспортногоПакета & 4194320) {
			  case 16:
				Check(дорОбработать.uStreamEnd !== дорОбработать.uStreamStart);
				break;

			  case 4194320:
				var cbPesPacket = _dvHeap.getUint16(pPayload + 4);
				var cbPesHeader = _mbHeap[pPayload + 8];
				Check(дорОбработать.pPesPacketEnd === дорОбработать.uStreamEnd || дорОбработать.pPesPacketEnd === -1);
				if (cbPesPacket !== 0) {
					дорОбработать.pPesPacketEnd = дорОбработать.uStreamEnd + cbPesPacket - 3 - cbPesHeader;
				} else {
					Check(nPid === nVideoPid);
					дорОбработать.pPesPacketEnd = -1;
				}
				if (nPid === nVideoPid || дорОбработать.nStartDTS === -1) {
					var nPts, nDts;
					switch (_dvHeap.getUint16(pPayload + 6) & 61632) {
					  case 32896:
						Check(cbPesHeader >= 5);
						nPts = DecodeTimestamp(pPayload + 9, 33);
						nDts = nPts;
						break;

					  case 32960:
						Check(cbPesHeader >= 10);
						nPts = DecodeTimestamp(pPayload + 9, 49);
						nDts = DecodeTimestamp(pPayload + 14, 17);
						break;

					  default:
						Check(false);
					}
					if (дорОбработать.nStartDTS === -1) {
						дорОбработать.nStartDTS = nDts;
					}
					if (nPid === nVideoPid) {
						if (nDts === _nLastVideoSampleDTS && cbPesPacket !== 0) {
							Check((_mbHeap[pPayload + 6] & 4) == 0);
						} else {
							Check(_trVideo.uSamplesEnd <= _trVideo.uSamplesMemoryEnd - VIDEO_SAMPLE_STRUCT_SIZE);
							if (_nLastVideoSampleDTS !== -1) {
								var чДлительностьВидеоСемпла = nDts - _nLastVideoSampleDTS;
								if (чДлительностьВидеоСемпла <= 0) {
									if (чДлительностьВидеоСемпла > -10) {
										чДлительностьВидеоСемпла = 1;
										nDts = _nLastVideoSampleDTS + чДлительностьВидеоСемпла;
										++кИзмененийВД;
									} else {
										Браковать(false);
									}
								}
								Check(чДлительностьВидеоСемпла < TS_TIMESCALE * 60);
								_nMinVideoSampleDuration = Math.min(_nMinVideoSampleDuration, чДлительностьВидеоСемпла);
								_nMaxVideoSampleDuration = Math.max(_nMaxVideoSampleDuration, чДлительностьВидеоСемпла);
								_dvHeap.setUint32(_trVideo.uSamplesEnd + VIDEO_SAMPLE_DURATION - VIDEO_SAMPLE_STRUCT_SIZE, чДлительностьВидеоСемпла);
								_dvHeap.setUint32(_trVideo.uSamplesEnd + VIDEO_SAMPLE_SIZE - VIDEO_SAMPLE_STRUCT_SIZE, _trVideo.uStreamEnd);
							}
							_dvHeap.setInt32(_trVideo.uSamplesEnd + VIDEO_SAMPLE_CTO, nPts - nDts);
							_trVideo.uSamplesEnd += VIDEO_SAMPLE_STRUCT_SIZE;
							_nLastVideoSampleDTS = nDts;
						}
					} else {
						Check(nPts === nDts);
					}
				}
				pPayload += 9 + cbPesHeader;
				break;

			  default:
				Check(false);
			}
			var cbPayload = уТранспортныйПакет + TRANSPORT_PACKET_SIZE - pPayload;
			Check(cbPayload > 0 && cbPayload + дорОбработать.uStreamEnd <= дорОбработать.uStreamMemoryEnd);
			_mbHeap.copyWithin(дорОбработать.uStreamEnd, pPayload, pPayload + cbPayload);
			дорОбработать.uStreamEnd += cbPayload;
		}
		Check(_trVideo.pPesPacketEnd === _trVideo.uStreamEnd || _trVideo.pPesPacketEnd === -1);
		Check(_trAudio.pPesPacketEnd === _trAudio.uStreamEnd || _trAudio.pPesPacketEnd === -1);
		Check(_trMetadata.pPesPacketEnd === _trMetadata.uStreamEnd || _trMetadata.pPesPacketEnd === -1);
		if (cPat !== 1 || cPmt !== 1) {
			m_Log.Ой(`Количество таблиц в сегменте: PAT=${cPat} PMT=${cPmt}`);
		}
		if (кИзмененийВД !== 0) {
			m_Log.Ой(`Количество видеосемплов с увеличенным ВД: ${кИзмененийВД}`);
		}
		Check(nVideoPid !== -1 || nAudioPid !== -1);
		_bVideoLoss = nVideoPid !== -1 && _trVideo.Empty();
		_bAudioLoss = nAudioPid !== -1 && _trAudio.Empty();
		if (_bVideoLoss || _bAudioLoss) {
			m_Log.Ой(`Сегмент не годится для воспроизведения: нет видео ${_bVideoLoss}, нет звука ${_bAudioLoss}`);
			return false;
		}
		var sImportance = _muMetadataStart.length > 1 ? 'Ой' : 'Вот';
		var sRecord = `Метаданных=${_muMetadataStart.length}`;
		if (!_trVideo.Empty()) {
			_dvHeap.setUint32(_trVideo.uSamplesEnd + VIDEO_SAMPLE_SIZE - VIDEO_SAMPLE_STRUCT_SIZE, _trVideo.uStreamEnd);
			var kVideoSamples = _trVideo.GetSampleCount();
			_nAvgVideoSampleDuration = (_nLastVideoSampleDTS - _trVideo.nStartDTS) / (kVideoSamples - 1);
			if (kVideoSamples < 25) {
				sImportance = 'Ой';
			}
			sRecord += ` ВДПервВидСемпла=${(_trVideo.nStartDTS / TS_TIMESCALE).toFixed(5)}` + ` ВДПослВидСемпла=${(_nLastVideoSampleDTS / TS_TIMESCALE).toFixed(5)}` + ` ДлитВидСегмента>${Мс(_nLastVideoSampleDTS - _trVideo.nStartDTS)} ВидСемплов=${kVideoSamples}` + ` ДлитВидСемплов=${Мс(_nMinVideoSampleDuration, '')}<${Мс(_nAvgVideoSampleDuration, '')}<${Мс(_nMaxVideoSampleDuration)}` + `(${(TS_TIMESCALE / _nMinVideoSampleDuration).toFixed(2)}` + `<${(TS_TIMESCALE / _nAvgVideoSampleDuration).toFixed(2)}` + `<${(TS_TIMESCALE / _nMaxVideoSampleDuration).toFixed(2)}к/с)`;
		}
		if (!_trAudio.Empty()) {
			sRecord += ` ВДПервАудСемпла=${(_trAudio.nStartDTS / TS_TIMESCALE).toFixed(5)}`;
		}
		if (!_trVideo.Empty() && !_trAudio.Empty()) {
			var чСмещениеЗвука = _trAudio.nStartDTS - _trVideo.nStartDTS;
			if (чСмещениеЗвука < -TS_TIMESCALE * .1 || чСмещениеЗвука > TS_TIMESCALE * .2) {
				sImportance = 'Ой';
			}
			sRecord += ` СмещНачалаАудСегмента=${Мс(_trAudio.nStartDTS - _trVideo.nStartDTS)}`;
		}
		m_Log[sImportance](sRecord);
		_nEncodingPosition = (_trAudio.nStartDTS !== -1 ? _trAudio.nStartDTS : _trVideo.nStartDTS) / TS_TIMESCALE;
		return true;
	}
	function DecodeTimestamp(uAddress, nMarkerBits) {
		var ч1 = _mbHeap[uAddress] | 0;
		var ч2 = _dvHeap.getUint32(uAddress + 1) | 0;
		Check((ч1 & 241) == (nMarkerBits | 0) && (ч2 & 65537) == 65537);
		return +((ч1 & 14) * (1 << 29) + (ч2 >> 2 & 1073709056 | ч2 >> 1 & 32767));
	}
	function ProgramAssociationTable(uStart, uEnd) {
		Check(uStart < uEnd);
		uStart += 1 + _mbHeap[uStart];
		Check(uEnd - uStart >= 16);
		Check(_mbHeap[uStart] === 0);
		Check((_dvHeap.getUint16(uStart + 1) & 53247) == 32781);
		Check((_mbHeap[uStart + 5] & 1) == 1);
		var nPatVersion = _mbHeap[uStart + 5] & 62;
		Check(_mbHeap[uStart + 6] === 0);
		Check(_mbHeap[uStart + 7] === 0);
		var nProgramNumber = _dvHeap.getUint16(uStart + 8);
		Check(nProgramNumber !== 0);
		var nPmtPid = _dvHeap.getUint16(uStart + 10) & 8191;
		Check(nPmtPid >= 16 && nPmtPid <= 8190);
		this.nPatVersion = nPatVersion;
		this.nProgramNumber = nProgramNumber;
		this.nPmtPid = nPmtPid;
	}
	function ProgramMapTable(uStart, uEnd, nProgramNumber) {
		Check(uStart < uEnd);
		uStart += 1 + _mbHeap[uStart];
		Check(uEnd - uStart >= 12);
		Check(_mbHeap[uStart] === 2);
		var уКонецСекции = _dvHeap.getUint16(uStart + 1);
		Check((уКонецСекции & 49152) == 32768);
		уКонецСекции = uStart + 3 + (уКонецСекции & 4095) - 4;
		Check(уКонецСекции >= uStart + 12 && уКонецСекции + 4 <= uEnd);
		Check(_dvHeap.getUint16(uStart + 3) === nProgramNumber);
		Check((_mbHeap[uStart + 5] & 1) == 1);
		var nPmtVersion = _mbHeap[uStart + 5] & 62;
		Check(_mbHeap[uStart + 6] === 0);
		Check(_mbHeap[uStart + 7] === 0);
		uStart += 12 + (_dvHeap.getUint16(uStart + 10) & 4095);
		var nVideoPid = -1, nAudioPid = -1, nMetadataPid = -1;
		while (uStart !== уКонецСекции) {
			var pDescriptor = uStart + 5;
			Check(pDescriptor <= уКонецСекции);
			var nElementaryPid = _dvHeap.getUint16(uStart + 1) & 8191;
			Check(nElementaryPid >= 16 && nElementaryPid <= 8190);
			var nEsInfoLength = _dvHeap.getUint16(uStart + 3) & 4095;
			Check(pDescriptor + nEsInfoLength <= уКонецСекции);
			switch (_mbHeap[uStart]) {
			  case 27:
				if (nVideoPid === -1) {
					nVideoPid = nElementaryPid;
				} else {
					m_Log.Ой(`Найден дополнительный видеопоток PID=${nElementaryPid}`);
				}
				break;

			  case 15:
				if (nAudioPid === -1) {
					nAudioPid = nElementaryPid;
				} else {
					m_Log.Ой(`Найден дополнительный аудиопоток PID=${nElementaryPid}`);
				}
				break;

			  case 21:
				if (nEsInfoLength === 15 && _mbHeap[pDescriptor] === 38 && _mbHeap[pDescriptor + 1] === 13 && _mbHeap[pDescriptor + 2] === 255 && _mbHeap[pDescriptor + 3] === 255 && _mbHeap[pDescriptor + 4] === 73 && _mbHeap[pDescriptor + 5] === 68 && _mbHeap[pDescriptor + 6] === 51 && _mbHeap[pDescriptor + 7] === 32 && _mbHeap[pDescriptor + 8] === 255 && _mbHeap[pDescriptor + 9] === 73 && _mbHeap[pDescriptor + 10] === 68 && _mbHeap[pDescriptor + 11] === 51 && _mbHeap[pDescriptor + 12] === 32) {
					if (nMetadataPid === -1) {
						nMetadataPid = nElementaryPid;
					} else {
						m_Log.Ой(`Найден дополнительный метапоток PID=${nElementaryPid} metadata_service_id=${_mbHeap[pDescriptor + 13]}`);
					}
				}
			}
			uStart = pDescriptor + nEsInfoLength;
		}
		this.nPmtVersion = nPmtVersion;
		this.nVideoPid = nVideoPid;
		this.nAudioPid = nAudioPid;
		this.nMetadataPid = nMetadataPid;
	}
	function РазобратьМетаданные() {
		for (var idx = 0; idx < _muMetadataStart.length; idx++) {
			var oID3 = new ID3(_mbHeap, _muMetadataStart[idx], _muMetadataStart[idx + 1] || _trMetadata.uStreamEnd);
			for (var сИдПоля of oID3) {
				if (сИдПоля === 'TXXX') {
					var {sDescription, sValue} = oID3.ParseTXXX();
					if (sDescription === 'segmentmetadata') {
						var oMetadata = JSON.parse(sValue);
						if (Number.isFinite(oMetadata.transc_r)) {
							Check(oMetadata.transc_r > 14200704e5 && oMetadata.transc_r < 18468864e5);
							_nEncodingTime = oMetadata.transc_r;
						}
						if (Number.isFinite(oMetadata.stream_offset)) {
							Check(oMetadata.stream_offset >= 0);
							_nBroadcastPosition = oMetadata.stream_offset;
						}
						return;
					}
				}
			}
		}
	}
	function РазобратьВидеоПоток() {
		if (_bDiscontinuity) {
			_abSequenceParameterSet = null;
			_abPictureParameterSet = null;
			_abSequenceParameterSetExt = null;
		}
		if (_trVideo.Empty()) {
			return true;
		}
		var ФЛАГИ_ОБЫЧНОГО_КАДРА = 65536;
		var ФЛАГИ_КЛЮЧЕВОГО_КАДРА = 0;
		Check(_trVideo.uStreamStart > _trVideo.uStreamMemoryStart && _trVideo.uStreamEnd > _trVideo.uStreamStart && _trVideo.uSamplesEnd > _trVideo.uSamplesStart);
		var uParsedStream = _trVideo.uStreamMemoryStart;
		var уСемплПервогоКлючКадра = -1;
		var cNalUnits = 0, cAccessUnits = 0, кСемпловБезVCL = 0, кКлючКадров = 0, уСемплПоследнегоКлючКадра = -1;
		var uSample = _trVideo.uSamplesStart;
		var уНачалоСледующегоСемпла = -1;
		var уНачалоРазобранногоСемпла;
		var чФлагиСемпла;
		var pNalUnitEnd = _fFindPrefix(_trVideo.uStreamStart, _trVideo.uStreamEnd);
		Check(pNalUnitEnd === _trVideo.uStreamStart);
		Check(_mcHeap[0] > 3);
		for (;;) {
			var кбРазмерПрефикса = pNalUnitEnd === _trVideo.uStreamEnd ? 0 : _mcHeap[0];
			var лНачалоСемпла = pNalUnitEnd + кбРазмерПрефикса - Math.min(4, кбРазмерПрефикса) >= уНачалоСледующегоСемпла;
			if (лНачалоСемпла && уНачалоСледующегоСемпла !== -1) {
				if (чФлагиСемпла === -1) {
					чФлагиСемпла = ФЛАГИ_ОБЫЧНОГО_КАДРА;
					++кСемпловБезVCL;
				}
				Check(uParsedStream > уНачалоРазобранногоСемпла);
				_dvHeap.setUint32(uSample + VIDEO_SAMPLE_SIZE, uParsedStream - уНачалоРазобранногоСемпла);
				_dvHeap.setUint32(uSample + VIDEO_SAMPLE_FLAGS, чФлагиСемпла);
				uSample += VIDEO_SAMPLE_STRUCT_SIZE;
			}
			if (pNalUnitEnd === _trVideo.uStreamEnd) {
				Check(uSample === _trVideo.uSamplesEnd);
				break;
			}
			var pNalUnitBegin = pNalUnitEnd + кбРазмерПрефикса;
			pNalUnitEnd = _fFindPrefix(pNalUnitBegin, _trVideo.uStreamEnd);
			Браковать(pNalUnitEnd >= pNalUnitBegin);
			if (лНачалоСемпла) {
				Check(uSample < _trVideo.uSamplesEnd);
				уНачалоСледующегоСемпла = _dvHeap.getUint32(uSample + VIDEO_SAMPLE_SIZE);
				уНачалоРазобранногоСемпла = uParsedStream;
				чФлагиСемпла = -1;
				if (cAccessUnits === 1) {
					cAccessUnits = 0;
				}
			}
			if (pNalUnitBegin === pNalUnitEnd) {
				continue;
			}
			++cNalUnits;
			var nNalRefIdc = _mbHeap[pNalUnitBegin] & 224;
			Браковать(nNalRefIdc < 128);
			switch (_mbHeap[pNalUnitBegin] & 31) {
			  case 1:
			  case 2:
			  case 3:
			  case 4:
				Check(чФлагиСемпла !== ФЛАГИ_КЛЮЧЕВОГО_КАДРА);
				чФлагиСемпла = ФЛАГИ_ОБЫЧНОГО_КАДРА;
				break;

			  case 5:
				Check(nNalRefIdc !== 0);
				if (чФлагиСемпла !== ФЛАГИ_КЛЮЧЕВОГО_КАДРА) {
					Check(чФлагиСемпла !== ФЛАГИ_ОБЫЧНОГО_КАДРА);
					чФлагиСемпла = ФЛАГИ_КЛЮЧЕВОГО_КАДРА;
					if (уСемплПервогоКлючКадра === -1) {
						уСемплПервогоКлючКадра = uSample;
					}
					уСемплПоследнегоКлючКадра = uSample;
					++кКлючКадров;
				}
				break;

			  case 6:
				Check(nNalRefIdc === 0);
				break;

			  case 7:
				Check(nNalRefIdc !== 0);
				if (_bDiscontinuity && (уСемплПервогоКлючКадра === -1 || _abSequenceParameterSet === null)) {
					_abSequenceParameterSet = _mbHeap.slice(pNalUnitBegin, pNalUnitEnd);
				}
				continue;

			  case 8:
				Check(nNalRefIdc !== 0);
				if (_bDiscontinuity && (уСемплПервогоКлючКадра === -1 || _abPictureParameterSet === null)) {
					_abPictureParameterSet = _mbHeap.slice(pNalUnitBegin, pNalUnitEnd);
				}
				continue;

			  case 9:
				Check(nNalRefIdc === 0);
				++cAccessUnits;
				continue;

			  case 10:
				Check(nNalRefIdc === 0);
				continue;

			  case 11:
				Check(nNalRefIdc === 0);
				Check(false);
				continue;

			  case 12:
				Check(nNalRefIdc === 0);
				continue;

			  case 13:
				Check(nNalRefIdc !== 0);
				Check(false);
				if (_bDiscontinuity && (уСемплПервогоКлючКадра === -1 || _abSequenceParameterSetExt === null)) {
					_abSequenceParameterSetExt = _mbHeap.slice(pNalUnitBegin, pNalUnitEnd);
				}
				continue;
			}
			var cbNalUnit = pNalUnitEnd - pNalUnitBegin;
			_dvHeap.setUint32(uParsedStream, cbNalUnit);
			uParsedStream += 4;
			Check(uParsedStream < pNalUnitBegin);
			_mbHeap.copyWithin(uParsedStream, pNalUnitBegin, pNalUnitEnd);
			uParsedStream += cbNalUnit;
		}
		_trVideo.uStreamStart = _trVideo.uStreamMemoryStart;
		_trVideo.uStreamEnd = uParsedStream;
		m_Log.Вот('NalUnits=' + cNalUnits + ' КлючКадров=' + кКлючКадров + ' ПервКлючКадр=' + _trVideo.GetSampleNumber(уСемплПервогоКлючКадра) + ' ПослКлючКадр=' + _trVideo.GetSampleNumber(уСемплПоследнегоКлючКадра));
		if (кСемпловБезVCL !== 0) {
			m_Log.Ой(`Видеосемплов без VCL NAL unit: ${кСемпловБезVCL}`);
		}
		if (cAccessUnits > 1) {
			m_Log.Ой('Несколько access unit в одном видеосемпле');
		}
		if (_bDiscontinuity) {
			if (уСемплПервогоКлючКадра === -1 || _abSequenceParameterSet === null || _abPictureParameterSet === null) {
				m_Log.Ой(`Сегмент не годится для воспроизведения: не найден IDR ${уСемплПервогоКлючКадра === -1}, не найден SPS ${_abSequenceParameterSet === null}, не найден PPS ${_abPictureParameterSet === null}`);
				return false;
			}
			var мбКопия = _abSequenceParameterSet.slice();
			var o = RemoveEmulationPreventionBytesFromNalUnit(мбКопия, 0, мбКопия.length);
			ParseSequenceParameterSet(мбКопия, o.uRBSPStart, o.uRBSPEnd);
		} else if (MAKE_FIRST_FRAME_KEY && уСемплПервогоКлючКадра !== _trVideo.uSamplesStart) {
			m_Log.Ой('Делаю первый видеосемпл ключевым');
			_dvHeap.setUint32(_trVideo.uSamplesStart + VIDEO_SAMPLE_FLAGS, ФЛАГИ_КЛЮЧЕВОГО_КАДРА);
		}
		return true;
	}
	function ParseSequenceParameterSet(mbStream, uStart, uEnd) {
		_nProfileIndication = mbStream[uStart];
		_nConstraintSetFlag = mbStream[uStart + 1];
		_nLevelIndication = mbStream[uStart + 2];
		var оПотокБитов = new BitStream(mbStream, uStart + 3, uEnd);
		оПотокБитов.SkipExpGolomb();
		var nSeparateColourPlaneFlag = 0;
		_nChromaFormatIndication = 1;
		_nBitDepthLumaMinus8 = 0;
		_nBitDepthChromaMinus8 = 0;
		switch (_nProfileIndication) {
		  case 183:
			_nChromaFormatIndication = 0;
			break;

		  case 100:
		  case 110:
		  case 122:
		  case 244:
		  case 44:
		  case 83:
		  case 86:
		  case 118:
		  case 128:
		  case 138:
		  case 139:
		  case 134:
			_nChromaFormatIndication = оПотокБитов.ReadUnsignedExpGolomb();
			Check(_nChromaFormatIndication <= 3);
			if (_nChromaFormatIndication === 3) {
				nSeparateColourPlaneFlag = оПотокБитов.ReadBits(1);
			}
			_nBitDepthLumaMinus8 = оПотокБитов.ReadUnsignedExpGolomb();
			Check(_nBitDepthLumaMinus8 <= 6);
			_nBitDepthChromaMinus8 = оПотокБитов.ReadUnsignedExpGolomb();
			Check(_nBitDepthChromaMinus8 <= 6);
			оПотокБитов.SkipBits(1);
			if (оПотокБитов.ReadBits(1) !== 0) {
				for (var i = 0, ic = _nChromaFormatIndication !== 3 ? 8 : 12; i < ic; ++i) {
					if (оПотокБитов.ReadBits(1) !== 0) {
						var nLastScale = 8, nNextScale = 8;
						for (var j = 0, jc = i < 6 ? 16 : 64; j < jc; ++j) {
							if (nNextScale !== 0) {
								nNextScale = (nLastScale + оПотокБитов.ReadSignedExpGolomb() + 256) % 256;
							}
							if (nNextScale !== 0) {
								nLastScale = nNextScale;
							}
						}
					}
				}
			}
		}
		оПотокБитов.SkipExpGolomb();
		switch (оПотокБитов.ReadUnsignedExpGolomb()) {
		  case 0:
			оПотокБитов.SkipExpGolomb();
			break;

		  case 1:
			оПотокБитов.SkipBits(1);
			оПотокБитов.SkipExpGolomb();
			оПотокБитов.SkipExpGolomb();
			for (i = 0, ic = оПотокБитов.ReadUnsignedExpGolomb(); i < ic; ++i) {
				оПотокБитов.SkipExpGolomb();
			}
		}
		_nMaxNumberReferenceFrames = оПотокБитов.ReadUnsignedExpGolomb();
		оПотокБитов.SkipBits(1);
		var nPictureWidthInMacroblocks = оПотокБитов.ReadUnsignedExpGolomb() + 1;
		var nPictureHeightInMapUnits = оПотокБитов.ReadUnsignedExpGolomb() + 1;
		var nFrameMacroblocksOnlyFlag = оПотокБитов.ReadBits(1);
		if (nFrameMacroblocksOnlyFlag === 0) {
			оПотокБитов.SkipBits(1);
		}
		оПотокБитов.SkipBits(1);
		var nFrameCropLeftOffset = 0;
		var nFrameCropRightOffset = 0;
		var nFrameCropTopOffset = 0;
		var nFrameCropBottomOffset = 0;
		if (оПотокБитов.ReadBits(1) !== 0) {
			nFrameCropLeftOffset = оПотокБитов.ReadUnsignedExpGolomb();
			nFrameCropRightOffset = оПотокБитов.ReadUnsignedExpGolomb();
			nFrameCropTopOffset = оПотокБитов.ReadUnsignedExpGolomb();
			nFrameCropBottomOffset = оПотокБитов.ReadUnsignedExpGolomb();
		}
		_nFrameRate = 0;
		_nRange = -1;
		if (оПотокБитов.ReadBits(1) !== 0) {
			var nAspectRatioIndication;
			if (оПотокБитов.ReadBits(1) !== 0) {
				nAspectRatioIndication = оПотокБитов.ReadBits(8);
				if (nAspectRatioIndication === 255) {
					оПотокБитов.ReadBits(16);
					оПотокБитов.ReadBits(16);
				}
			}
			if (оПотокБитов.ReadBits(1) !== 0) {
				оПотокБитов.SkipBits(1);
			}
			if (оПотокБитов.ReadBits(1) !== 0) {
				оПотокБитов.ReadBits(3);
				_nRange = оПотокБитов.ReadBits(1);
				if (оПотокБитов.ReadBits(1) !== 0) {
					оПотокБитов.SkipBits(8 + 8 + 8);
				}
			}
			if (оПотокБитов.ReadBits(1) !== 0) {
				оПотокБитов.SkipExpGolomb();
				оПотокБитов.SkipExpGolomb();
			}
			var nNumUnitsInTick, nTimeScale, nFixedFrameRateFlag;
			if (оПотокБитов.ReadBits(1) !== 0) {
				nNumUnitsInTick = оПотокБитов.ReadBits(32);
				nTimeScale = оПотокБитов.ReadBits(32);
				nFixedFrameRateFlag = оПотокБитов.ReadBits(1);
				_nFrameRate = nTimeScale / nNumUnitsInTick / (nFixedFrameRateFlag === 0 ? -2 : 2);
			}
		}
		var nCropUnitX = 1;
		var nCropUnitY = 1;
		if (nSeparateColourPlaneFlag === 0 && _nChromaFormatIndication !== 0) {
			nCropUnitX = _nChromaFormatIndication === 3 ? 1 : 2;
			nCropUnitY = _nChromaFormatIndication === 1 ? 2 : 1;
		}
		if (nFrameMacroblocksOnlyFlag === 0) {
			nCropUnitY += nCropUnitY;
			nPictureHeightInMapUnits += nPictureHeightInMapUnits;
		}
		_nPictureWidth = nPictureWidthInMacroblocks * 16 - nCropUnitX * nFrameCropRightOffset - nCropUnitX * nFrameCropLeftOffset;
		_nPictureHeight = nPictureHeightInMapUnits * 16 - nCropUnitY * nFrameCropBottomOffset - nCropUnitY * nFrameCropTopOffset;
		_bInterlaced = nFrameMacroblocksOnlyFlag === 0;
	}
	function RemoveEmulationPreventionBytesFromNalUnit(mbStream, uStart, uEnd) {
		Check(uStart < uEnd);
		var nNalUnitType = mbStream[uStart++] & 31;
		if (nNalUnitType === 14 || nNalUnitType === 20 || nNalUnitType === 21) {
			Check(uStart < uEnd);
			uStart += nNalUnitType === 21 && (mbStream[uStart] & 128) != 0 ? 2 : 3;
			Check(uStart <= uEnd);
		}
		var uRBSPStart = uStart;
		var уКонец2 = uEnd - 2;
		while (uStart < уКонец2) {
			if (mbStream[uStart++] === 0 && mbStream[uStart++] === 0) {
				var чТретийБайт = mbStream[uStart++];
				Check(чТретийБайт >= 3);
				if (чТретийБайт === 3) {
					var уДекодированныйПоток = uStart - 1;
					Check(uStart === uEnd || mbStream[uStart] <= 3);
					while (uStart < уКонец2) {
						if ((mbStream[уДекодированныйПоток++] = mbStream[uStart++]) === 0 && (mbStream[уДекодированныйПоток++] = mbStream[uStart++]) === 0) {
							чТретийБайт = mbStream[уДекодированныйПоток++] = mbStream[uStart++];
							Check(чТретийБайт >= 3);
							if (чТретийБайт === 3) {
								--уДекодированныйПоток;
								Check(uStart === uEnd || mbStream[uStart] <= 3);
							}
						}
					}
					while (uStart !== uEnd) {
						var чПоследнийБайт = mbStream[уДекодированныйПоток++] = mbStream[uStart++];
					}
					Check(чПоследнийБайт !== 0);
					return {
						uRBSPStart,
						uRBSPEnd: уДекодированныйПоток
					};
				}
			}
		}
		Check(uStart === uEnd || mbStream[uEnd - 1] !== 0);
		return {
			uRBSPStart,
			uRBSPEnd: uEnd
		};
	}
	function РазобратьАудиоПоток() {
		if (_trAudio.Empty()) {
			return true;
		}
		var ADTS_HEADER_SIZE = 7;
		Check(_trAudio.uStreamEnd > _trAudio.uStreamStart && _trAudio.uSamplesEnd === _trAudio.uSamplesStart);
		if (_bDiscontinuity) {
			Check(_trAudio.GetStreamSize() > ADTS_HEADER_SIZE);
			ParseAdtsFixedHeader(_dvHeap.getUint32(_trAudio.uStreamStart));
		}
		var pAdtsFrame = _trAudio.uStreamStart;
		var uParsedStream = _trAudio.uStreamStart;
		var uSample = _trAudio.uSamplesStart;
		var uStreamEnd = _trAudio.uStreamEnd - ADTS_HEADER_SIZE;
		var uSamplesMemoryEnd = _trAudio.uSamplesMemoryEnd - AUDIO_SAMPLE_STRUCT_SIZE;
		while (pAdtsFrame < uStreamEnd) {
			Check(uSample <= uSamplesMemoryEnd);
			Check(_mbHeap[pAdtsFrame] === 255 && _mbHeap[pAdtsFrame + 1] === 241);
			Check((_mbHeap[pAdtsFrame + 6] & 3) == 0);
			var cbAdtsFrame = _dvHeap.getUint32(pAdtsFrame + 3) >> 13 & 8191;
			var pNextAdtsFrame = pAdtsFrame + cbAdtsFrame;
			Check(cbAdtsFrame > ADTS_HEADER_SIZE && pNextAdtsFrame <= _trAudio.uStreamEnd);
			_mbHeap.copyWithin(uParsedStream, pAdtsFrame + ADTS_HEADER_SIZE, pNextAdtsFrame);
			cbAdtsFrame -= ADTS_HEADER_SIZE;
			uParsedStream += cbAdtsFrame;
			_dvHeap.setUint32(uSample, cbAdtsFrame);
			uSample += AUDIO_SAMPLE_STRUCT_SIZE;
			pAdtsFrame = pNextAdtsFrame;
		}
		Check(pAdtsFrame === _trAudio.uStreamEnd);
		_trAudio.uStreamEnd = uParsedStream;
		_trAudio.uSamplesEnd = uSample;
		var чДлительностьАудиоСемпла = AUDIO_SAMPLE_LENGTH / _nSampleRate;
		var чДлительностьАудиоСегмента = _trAudio.GetSampleCount() * чДлительностьАудиоСемпла;
		_nAudioSegmentEndDTS = _trAudio.nStartDTS + Math.round(чДлительностьАудиоСегмента * TS_TIMESCALE);
		_nAudioBitrate = _trAudio.GetStreamSize() * 8 / 1e3 / чДлительностьАудиоСегмента;
		m_Log.Вот(`ВДКонцаАудСегмента=${(_nAudioSegmentEndDTS / TS_TIMESCALE).toFixed(5)}` + ` ДлитАудСегмента=${(чДлительностьАудиоСегмента * 1e3).toFixed(2)}мс` + ` ДлитАудСемпла=${(чДлительностьАудиоСемпла * 1e3).toFixed(2)}мс`);
		return true;
	}
	function ParseAdtsFixedHeader(nAdtsFixedHeader) {
		Check((nAdtsFixedHeader & 4294901760) == (4293984256 | 0));
		_nAudioObjectType = (nAdtsFixedHeader >> 14 & 3) + 1;
		Check(_nAudioObjectType === 2);
		_anDecoderSpecificInfo[0] = _nAudioObjectType << 3;
		var чИндексЧастотыДискретизации = nAdtsFixedHeader >> 10 & 15;
		_nSampleRate = SAMPLE_RATES[чИндексЧастотыДискретизации];
		Check(_nSampleRate !== void 0);
		_anDecoderSpecificInfo[0] |= чИндексЧастотыДискретизации >> 1;
		_anDecoderSpecificInfo[1] = чИндексЧастотыДискретизации << 7 & 128;
		_nChannelCount = nAdtsFixedHeader >> 6 & 7;
		Check(_nChannelCount !== 0);
		_anDecoderSpecificInfo[1] |= _nChannelCount << 3;
		m_Log[_nAudioObjectType !== 2 || _nSampleRate < 44100 || _nChannelCount > 2 ? 'Ой' : 'Вот'](`AudioObjectType=${_nAudioObjectType} ЧастотаДискретизации=${_nSampleRate} КоличествоКаналов=${_nChannelCount}`);
	}
	function ПолучитьНазваниеКодеков() {
		var с = 'video/mp4;codecs="';
		if (!_trVideo.Empty()) {
			с += `avc1.${`0${_nProfileIndication.toString(16)}`.slice(-2).toUpperCase()}${`0${_nConstraintSetFlag.toString(16)}`.slice(-2).toUpperCase()}${`0${_nLevelIndication.toString(16)}`.slice(-2).toUpperCase()}`;
		}
		if (!_trVideo.Empty() && !_trAudio.Empty()) {
			с += ',';
		}
		if (!_trAudio.Empty()) {
			с += `mp4a.40.${_nAudioObjectType}`;
		}
		return с + '"';
	}
	function СоздатьСегментИнициализации() {
		var kbSize = 1100 + (_abSequenceParameterSet === null ? 0 : _abSequenceParameterSet.length) + (_abPictureParameterSet === null ? 0 : _abPictureParameterSet.length) + (_abSequenceParameterSetExt === null ? 0 : _abSequenceParameterSetExt.length) + (_trAudio.Empty() ? 0 : _anDecoderSpecificInfo.length);
		var мбСегмент = new Uint8Array(kbSize);
		var dvСегмент = CreateDataView(мбСегмент);
		var oSegment = new IsoBaseMedia(мбСегмент, dvСегмент, 0);
		oSegment.AddBox('ftyp', [ 105, 115, 111, 54, 0, 0, 0, 0, 97, 118, 99, 49 ]);
		oSegment.AddBox('moov', () => {
			oSegment.AddFullBox('mvhd', 1, 0, [ 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 255, 255, 255, 255, 255, 255, 255, 255, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 64, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255, 255, 255, 255 ]);
			oSegment.AddBox('mvex', () => {
				if (!_trVideo.Empty()) {
					oSegment.AddFullBox('trex', 0, 0, 20);
					oSegment.dvBuffer.setUint32(oSegment.uEnd - 20, VIDEO_TRACK_NUMBER);
					oSegment.dvBuffer.setUint32(oSegment.uEnd - 16, 1);
				}
				if (!_trAudio.Empty()) {
					oSegment.AddFullBox('trex', 0, 0, 20);
					oSegment.dvBuffer.setUint32(oSegment.uEnd - 20, AUDIO_TRACK_NUMBER);
					oSegment.dvBuffer.setUint32(oSegment.uEnd - 16, 1);
					oSegment.dvBuffer.setUint32(oSegment.uEnd - 12, AUDIO_SAMPLE_LENGTH);
				}
			});
			if (!_trVideo.Empty()) {
				ДобавитьДорожкуВСегментИнициализации(true, oSegment);
			}
			if (!_trAudio.Empty()) {
				ДобавитьДорожкуВСегментИнициализации(false, oSegment);
			}
		});
		return oSegment.Finish();
	}
	function ДобавитьДорожкуВСегментИнициализации(лВидео, oSegment) {
		oSegment.AddBox('trak', () => {
			oSegment.AddFullBox('tkhd', 0, 3, 80);
			oSegment.mbBuffer[oSegment.uEnd - 64] = 255;
			oSegment.mbBuffer[oSegment.uEnd - 63] = 255;
			oSegment.mbBuffer[oSegment.uEnd - 62] = 255;
			oSegment.mbBuffer[oSegment.uEnd - 61] = 255;
			oSegment.mbBuffer[oSegment.uEnd - 43] = 1;
			oSegment.mbBuffer[oSegment.uEnd - 27] = 1;
			oSegment.mbBuffer[oSegment.uEnd - 12] = 64;
			if (лВидео) {
				oSegment.dvBuffer.setUint32(oSegment.uEnd - 72, VIDEO_TRACK_NUMBER);
				oSegment.dvBuffer.setUint16(oSegment.uEnd - 8, _nPictureWidth);
				oSegment.dvBuffer.setUint16(oSegment.uEnd - 4, _nPictureHeight);
			} else {
				oSegment.dvBuffer.setUint32(oSegment.uEnd - 72, AUDIO_TRACK_NUMBER);
				oSegment.dvBuffer.setUint16(oSegment.uEnd - 48, 256);
			}
			oSegment.AddBox('mdia', () => {
				oSegment.AddFullBox('mdhd', 0, 0, 20);
				oSegment.dvBuffer.setUint32(oSegment.uEnd - 12, лВидео ? TS_TIMESCALE : _nSampleRate);
				oSegment.mbBuffer[oSegment.uEnd - 8] = 255;
				oSegment.mbBuffer[oSegment.uEnd - 7] = 255;
				oSegment.mbBuffer[oSegment.uEnd - 6] = 255;
				oSegment.mbBuffer[oSegment.uEnd - 5] = 255;
				oSegment.mbBuffer[oSegment.uEnd - 4] = 85;
				oSegment.mbBuffer[oSegment.uEnd - 3] = 196;
				oSegment.AddFullBox('hdlr', 0, 0, 21);
				if (лВидео) {
					oSegment.mbBuffer[oSegment.uEnd - 17] = 118;
					oSegment.mbBuffer[oSegment.uEnd - 16] = 105;
					oSegment.mbBuffer[oSegment.uEnd - 15] = 100;
					oSegment.mbBuffer[oSegment.uEnd - 14] = 101;
				} else {
					oSegment.mbBuffer[oSegment.uEnd - 17] = 115;
					oSegment.mbBuffer[oSegment.uEnd - 16] = 111;
					oSegment.mbBuffer[oSegment.uEnd - 15] = 117;
					oSegment.mbBuffer[oSegment.uEnd - 14] = 110;
				}
				oSegment.AddBox('minf', () => {
					if (лВидео) {
						oSegment.AddFullBox('vmhd', 0, 1, 8);
					} else {
						oSegment.AddFullBox('smhd', 0, 0, 4);
					}
					oSegment.AddBox('dinf', () => {
						oSegment.AddFullBox('dref', 0, 0, () => {
							oSegment.dvBuffer.setUint32(oSegment.uEnd, 1);
							oSegment.uEnd += 4;
							oSegment.AddFullBox('url ', 0, 1, 0);
						});
					});
					oSegment.AddBox('stbl', () => {
						oSegment.AddFullBox('stsd', 0, 0, () => {
							oSegment.dvBuffer.setUint32(oSegment.uEnd, 1);
							oSegment.uEnd += 4;
							if (лВидео) {
								oSegment.AddBox('avc1', () => {
									oSegment.dvBuffer.setUint16(oSegment.uEnd + 6, 1);
									oSegment.dvBuffer.setUint16(oSegment.uEnd + 24, _nPictureWidth);
									oSegment.dvBuffer.setUint16(oSegment.uEnd + 26, _nPictureHeight);
									oSegment.dvBuffer.setUint32(oSegment.uEnd + 28, 4718592);
									oSegment.dvBuffer.setUint32(oSegment.uEnd + 32, 4718592);
									oSegment.dvBuffer.setUint16(oSegment.uEnd + 40, 1);
									oSegment.dvBuffer.setUint16(oSegment.uEnd + 74, 24);
									oSegment.dvBuffer.setUint16(oSegment.uEnd + 76, 65535);
									oSegment.uEnd += 78;
									oSegment.AddBox('avcC', () => {
										oSegment.mbBuffer[oSegment.uEnd] = 1;
										oSegment.mbBuffer[oSegment.uEnd + 1] = _nProfileIndication;
										oSegment.mbBuffer[oSegment.uEnd + 2] = _nConstraintSetFlag;
										oSegment.mbBuffer[oSegment.uEnd + 3] = _nLevelIndication;
										oSegment.mbBuffer[oSegment.uEnd + 4] = 255;
										oSegment.mbBuffer[oSegment.uEnd + 5] = 225;
										oSegment.dvBuffer.setUint16(oSegment.uEnd + 6, _abSequenceParameterSet.length);
										oSegment.CopyFromBuffer(oSegment.uEnd + 8, _abSequenceParameterSet);
										oSegment.mbBuffer[oSegment.uEnd] = 1;
										oSegment.dvBuffer.setUint16(oSegment.uEnd + 1, _abPictureParameterSet.length);
										oSegment.CopyFromBuffer(oSegment.uEnd + 3, _abPictureParameterSet);
										switch (_nProfileIndication) {
										  case 100:
										  case 110:
										  case 122:
										  case 144:
											oSegment.mbBuffer[oSegment.uEnd] = 252 | _nChromaFormatIndication;
											oSegment.mbBuffer[oSegment.uEnd + 1] = 248 | _nBitDepthLumaMinus8;
											oSegment.mbBuffer[oSegment.uEnd + 2] = 248 | _nBitDepthChromaMinus8;
											if (_abSequenceParameterSetExt === null) {
												oSegment.uEnd += 4;
											} else {
												oSegment.mbBuffer[oSegment.uEnd + 3] = 1;
												oSegment.dvBuffer.setUint16(oSegment.uEnd + 4, _abSequenceParameterSetExt.length);
												oSegment.CopyFromBuffer(oSegment.uEnd + 6, _abSequenceParameterSetExt);
											}
										}
									});
								});
							} else {
								oSegment.AddBox('mp4a', () => {
									oSegment.dvBuffer.setUint16(oSegment.uEnd + 6, 1);
									oSegment.dvBuffer.setUint16(oSegment.uEnd + 16, _nChannelCount === 1 ? 1 : 2);
									oSegment.dvBuffer.setUint16(oSegment.uEnd + 18, 16);
									oSegment.dvBuffer.setUint32(oSegment.uEnd + 24, _nSampleRate << 16);
									oSegment.uEnd += 28;
									oSegment.AddFullBox('esds', 0, 0, () => {
										oSegment.mbBuffer[oSegment.uEnd] = 3;
										oSegment.mbBuffer[oSegment.uEnd + 1] = 23 + _anDecoderSpecificInfo.length;
										oSegment.dvBuffer.setUint16(oSegment.uEnd + 2, 1);
										oSegment.mbBuffer[oSegment.uEnd + 5] = 4;
										oSegment.mbBuffer[oSegment.uEnd + 6] = 15 + _anDecoderSpecificInfo.length;
										oSegment.mbBuffer[oSegment.uEnd + 7] = 64;
										oSegment.mbBuffer[oSegment.uEnd + 8] = 21;
										oSegment.mbBuffer[oSegment.uEnd + 20] = 5;
										oSegment.mbBuffer[oSegment.uEnd + 21] = _anDecoderSpecificInfo.length;
										oSegment.CopyFromArray(oSegment.uEnd + 22, _anDecoderSpecificInfo);
										oSegment.mbBuffer[oSegment.uEnd] = 6;
										oSegment.mbBuffer[oSegment.uEnd + 1] = 1;
										oSegment.mbBuffer[oSegment.uEnd + 2] = 2;
										oSegment.uEnd += 3;
									});
								});
							}
						});
						oSegment.AddFullBox('stts', 0, 0, 4);
						oSegment.AddFullBox('stsc', 0, 0, 4);
						oSegment.AddFullBox('stco', 0, 0, 4);
						oSegment.AddFullBox('stsz', 0, 0, 8);
					});
				});
			});
		});
	}
	function СоздатьМедиасегмент(мбМедиасегмент) {
		var dvМедиасегмент = CreateDataView(мбМедиасегмент);
		var oSegment = new IsoBaseMedia(мбМедиасегмент, dvМедиасегмент, 0);
		var уСмещениеВидеоданных, уСмещениеАудиоданных;
		oSegment.AddBox('moof', () => {
			oSegment.AddFullBox('mfhd', 0, 0, 4);
			dvМедиасегмент.setUint32(oSegment.uEnd - 4, 0);
			if (!_trVideo.Empty()) {
				oSegment.AddBox('traf', () => {
					oSegment.AddFullBox('tfhd', 0, 131072, 4);
					dvМедиасегмент.setUint32(oSegment.uEnd - 4, VIDEO_TRACK_NUMBER);
					oSegment.AddFullBox('tfdt', 1, 0, 8);
					мбМедиасегмент.setUint64(oSegment.uEnd - 8, _trVideo.nStartDTS);
					oSegment.AddFullBox('trun', 1, 3841, () => {
						dvМедиасегмент.setUint32(oSegment.uEnd, _trVideo.GetSampleCount());
						уСмещениеВидеоданных = oSegment.uEnd + 4;
						oSegment.CopyFromBuffer(oSegment.uEnd + 8, _mbHeap, _trVideo.uSamplesStart, _trVideo.uSamplesEnd);
					});
				});
			}
			if (!_trAudio.Empty()) {
				oSegment.AddBox('traf', () => {
					oSegment.AddFullBox('tfhd', 0, 131072, 4);
					dvМедиасегмент.setUint32(oSegment.uEnd - 4, AUDIO_TRACK_NUMBER);
					oSegment.AddFullBox('tfdt', 1, 0, 8);
					мбМедиасегмент.setUint64(oSegment.uEnd - 8, Math.round(_trAudio.nStartDTS / TS_TIMESCALE * _nSampleRate));
					oSegment.AddFullBox('trun', 1, 513, () => {
						dvМедиасегмент.setUint32(oSegment.uEnd, _trAudio.GetSampleCount());
						уСмещениеАудиоданных = oSegment.uEnd + 4;
						oSegment.CopyFromBuffer(oSegment.uEnd + 8, _mbHeap, _trAudio.uSamplesStart, _trAudio.uSamplesEnd);
					});
				});
			}
		});
		oSegment.AddBox('mdat', () => {
			if (!_trVideo.Empty()) {
				dvМедиасегмент.setInt32(уСмещениеВидеоданных, oSegment.uEnd - oSegment.uStart);
				oSegment.CopyFromBuffer(oSegment.uEnd, _mbHeap, _trVideo.uStreamStart, _trVideo.uStreamEnd);
			}
			if (!_trAudio.Empty()) {
				dvМедиасегмент.setInt32(уСмещениеАудиоданных, oSegment.uEnd - oSegment.uStart);
				oSegment.CopyFromBuffer(oSegment.uEnd, _mbHeap, _trAudio.uStreamStart, _trAudio.uStreamEnd);
			}
		});
		return oSegment.Finish();
	}
	function ОтправитьПреобразованныйСегмент(мбМедиасегмент) {
		var mbufTransfer = void 0;
		var oData = {
			чПреобразованЗа: _nConvertedIn,
			лЗабраковано: _bRejected,
			лПотериВидео: _bVideoLoss,
			лПотериЗвука: _bAudioLoss,
			чМинДлительностьВидеоСемпла: _nMinVideoSampleDuration / TS_TIMESCALE * 1e3,
			чМаксДлительностьВидеоСемпла: _nMaxVideoSampleDuration / TS_TIMESCALE * 1e3,
			чСредняяДлительностьВидеоСемпла: _nAvgVideoSampleDuration / TS_TIMESCALE * 1e3,
			чБитрейтЗвука: _nAudioBitrate,
			чПозицияКодирования: _nEncodingPosition,
			чПозицияТрансляции: _nBroadcastPosition,
			чВремяКодирования: _nEncodingTime
		};
		if (мбМедиасегмент) {
			oData.мбМедиасегмент = СоздатьМедиасегмент(мбМедиасегмент);
			oData.лЕстьВидео = !_trVideo.Empty();
			oData.лЕстьЗвук = !_trAudio.Empty();
			mbufTransfer = [ oData.мбМедиасегмент.buffer ];
			if (_bDiscontinuity) {
				oData.mbInitializationSegment = СоздатьСегментИнициализации();
				oData.сКодеки = ПолучитьНазваниеКодеков();
				oData.nProfileIndication = _nProfileIndication;
				oData.nConstraintSetFlag = _nConstraintSetFlag;
				oData.nLevelIndication = _nLevelIndication;
				oData.nMaxNumberReferenceFrames = _nMaxNumberReferenceFrames;
				oData.чШиринаКартинки = _nPictureWidth;
				oData.чВысотаКартинки = _nPictureHeight;
				oData.чЧастотаКадров = _nFrameRate;
				oData.чДиапазон = _nRange;
				oData.лЧересстрочное = _bInterlaced;
				oData.nAudioObjectType = _nAudioObjectType;
				oData.чЧастотаДискретизации = _nSampleRate;
				oData.чКоличествоКаналов = _nChannelCount;
				mbufTransfer.push(oData.mbInitializationSegment.buffer);
			}
			_oSourceSegment.bDiscontinuity = _bDiscontinuity;
			m_Log.Вот(`Отправляю сегмент Разрыв=${_bDiscontinuity} Размер=${(oData.мбМедиасегмент.length / 1024 / 1024).toFixed(2)}мб`);
		}
		_oSourceSegment.pData = oData;
		m_Log.Send();
		ОтправитьРезультат(mbufTransfer);
	}
	function СостыковатьСегменты() {
		if (_bDiscontinuity) {
			return;
		}
		var чОтклонениеВДВидео = 0, чПерекрытиеВДВидео = 1, чОтклонениеВДАудио = 0;
		if (!_trVideo.Empty()) {
			чОтклонениеВДВидео = _trVideo.nStartDTS - _nPrevVideoSegmentEndDTS;
			чПерекрытиеВДВидео = _trVideo.nStartDTS - _nPrevVideoSegmentLastSampleDTS;
		}
		if (!_trAudio.Empty()) {
			чОтклонениеВДАудио = _trAudio.nStartDTS - _nPrevAudioSegmentEndDTS;
		}
		if (чПерекрытиеВДВидео <= 0 || чОтклонениеВДАудио < -TS_TIMESCALE * .1) {
			m_Log.Ой(`Добавлен разрыв: ОтклонениеВДВидео=${Мс(чОтклонениеВДВидео)} ПерекрытиеВДВидео=${Мс(чПерекрытиеВДВидео)} ОтклонениеВДАудио=${чОтклонениеВДАудио}`);
			_bDiscontinuity = true;
			return;
		}
		if (Math.abs(чОтклонениеВДВидео) > TS_TIMESCALE * .002 || Math.abs(чОтклонениеВДАудио) > 2) {
			m_Log.Ой(`ОтклонениеВДВидео=${Мс(чОтклонениеВДВидео)} ПерекрытиеВДВидео=${Мс(чПерекрытиеВДВидео)} ОтклонениеВДАудио=${чОтклонениеВДАудио}`);
		}
		if (чОтклонениеВДВидео > TS_TIMESCALE * .01) {
			_bVideoLoss = true;
		}
		if (чОтклонениеВДАудио > TS_TIMESCALE * .1) {
			_bAudioLoss = true;
		}
	}
	function РассчитатьДлительностьПоследнегоВидеосемпла() {
		var kVideoSamples = _trVideo.GetSampleCount();
		if (kVideoSamples === 0) {
			return;
		}
		var nDuration;
		if (kVideoSamples === 1) {
			nDuration = _trAudio.Empty() ? Math.round(TS_TIMESCALE / 30) : _nAudioSegmentEndDTS - _trAudio.nStartDTS;
		} else {
			nDuration = _dvHeap.getUint32(_trVideo.uSamplesEnd - VIDEO_SAMPLE_STRUCT_SIZE * 2 + VIDEO_SAMPLE_DURATION);
			var uSample = _trVideo.uSamplesEnd - VIDEO_SAMPLE_STRUCT_SIZE;
			var чВД = 0;
			var чВППоследнегоВидеоСемпла = _dvHeap.getInt32(uSample + VIDEO_SAMPLE_CTO);
			for (var idx = Math.min(16, kVideoSamples); --idx != 0; ) {
				uSample -= VIDEO_SAMPLE_STRUCT_SIZE;
				чВД -= _dvHeap.getUint32(uSample + VIDEO_SAMPLE_DURATION);
				var чВП = чВД + _dvHeap.getInt32(uSample + VIDEO_SAMPLE_CTO);
				if (чВП > чВППоследнегоВидеоСемпла) {
					nDuration = Math.min(nDuration, чВП - чВППоследнегоВидеоСемпла);
				}
			}
		}
		m_Log[kVideoSamples === 1 ? 'Ой' : 'Вот'](`Длительность последнего видеосемпла ${Мс(nDuration)}`);
		_dvHeap.setUint32(_trVideo.uSamplesEnd - VIDEO_SAMPLE_STRUCT_SIZE + VIDEO_SAMPLE_DURATION, nDuration);
		_nVideoSegmentEndDTS = _nLastVideoSampleDTS + nDuration;
	}
	function ПреобразоватьСегмент() {
		var чНачало = performance.now();
		_bDiscontinuity = _bDiscontinuity || _oSourceSegment.bDiscontinuity;
		m_Log.Вот(`ПРЕОБРАЗУЮ СЕГМЕНТ ${_oSourceSegment.чНомер} Разрыв=${_bDiscontinuity} Длительность=${_oSourceSegment.nDuration} Размер=${(_oSourceSegment.pData.byteLength / 1024 / 1024).toFixed(2)}мб`);
		ОчиститьСтатистику();
		var лСегментПреобразован = false;
		var mbTransportStream = new Uint8Array(_oSourceSegment.pData);
		try {
			m_Memory.Allocate(mbTransportStream);
			if (РазобратьТранспортныйПоток(mbTransportStream)) {
				СостыковатьСегменты();
				РазобратьМетаданные();
				лСегментПреобразован = РазобратьВидеоПоток() && РазобратьАудиоПоток();
				if (лСегментПреобразован) {
					РассчитатьДлительностьПоследнегоВидеосемпла();
				}
			}
		} catch (pException) {
			if (pException instanceof Error && pException.message === 'БРАКОВАТЬ') {
				m_Log.Ой(`Сегмент забракован: ${pException.stack}`);
				ОчиститьСтатистику();
				_bRejected = true;
			} else {
				throw pException;
			}
		}
		_oSourceSegment.pData = null;
		if (лСегментПреобразован) {
			ОтправитьПреобразованныйСегмент(mbTransportStream);
		} else {
			ВыброситьВПомойку(mbTransportStream);
			ОтправитьПреобразованныйСегмент(null);
		}
		_bDiscontinuity = !лСегментПреобразован;
		_nPrevVideoSegmentLastSampleDTS = _nLastVideoSampleDTS;
		_nPrevVideoSegmentEndDTS = _nVideoSegmentEndDTS;
		_nPrevAudioSegmentEndDTS = _nAudioSegmentEndDTS;
		_nConvertedIn = performance.now() - чНачало;
	}
	function ОбработатьСменуСостояния() {
		m_Log.Вот(`ПРОПУСКАЮ СЕГМЕНТ ${_oSourceSegment.чНомер} Состояние=${_oSourceSegment.pData}`);
		if (_oSourceSegment.pData !== STATE_VARIANT_CHANGE) {
			m_Memory.Free();
		}
		m_Log.Send();
		ОтправитьРезультат();
		_bDiscontinuity = true;
	}
	function ОбработатьСообщение(pData) {
		_oSourceSegment = pData;
		if (typeof _oSourceSegment.pData == 'number') {
			ОбработатьСменуСостояния();
		} else {
			ПреобразоватьСегмент();
		}
		_oSourceSegment = null;
	}
	function ОбработатьИсключение(pException) {
		self.onmessage = null;
		_mUnprocessedMessages = null;
		m_Memory.Free();
		m_Log.Send();
		TerminateAndSendReport(pException);
	}
	self.onmessage = (oEvent => {
		try {
			if (_mUnprocessedMessages !== null) {
				_mUnprocessedMessages.push(oEvent.data);
				m_Log.Ой('Обработка сообщения отложена: компиляция не завершена');
				m_Log.Send();
			} else {
				ОбработатьСообщение(oEvent.data);
			}
		} catch (pException) {
			ОбработатьИсключение(pException);
		}
	});
	self.onmessageerror = (oEvent => {
		throw new Error(`Произошло событие ${oEvent.type}`);
	});
	_oAssembler.Compile().then(() => {
		m_Log.Вот(`Компиляция завершена: ${performance.now().toFixed()}мс Необработанных сообщений: ${_mUnprocessedMessages.length}`);
		while (_mUnprocessedMessages.length !== 0) {
			ОбработатьСообщение(_mUnprocessedMessages.shift());
		}
		_mUnprocessedMessages = null;
	}).catch(ОбработатьИсключение);
}