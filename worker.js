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
			var nNextResultBit = kBits - 1;
			var nMask = (1 << this._nNextBit + 1) - 1;
			do {
				var nBits = this._mbBuffer[this._uNextByte] & nMask;
				nResult |= this._nNextBit < nNextResultBit ? nBits << nNextResultBit - this._nNextBit : nBits >>> this._nNextBit - nNextResultBit;
				var kBitsAdded = Math.min(nNextResultBit, this._nNextBit) + 1;
				if ((this._nNextBit -= kBitsAdded) < 0) {
					this._nNextBit = 7;
					++this._uNextByte;
					nMask = 255;
				}
			} while ((nNextResultBit -= kBitsAdded) >= 0);
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
	AddFullBox(sType, nVersion, nFlags, pContent) {
		Check(sType.length === 4 && Number.isFinite(nVersion) && Number.isFinite(nFlags));
		Check(this.uEnd >= this.uStart);
		var uStart = this.uEnd;
		Check(this.mbBuffer.length - this.uEnd >= 8);
		this.mbBuffer[uStart + 4] = sType.charCodeAt(0);
		this.mbBuffer[uStart + 5] = sType.charCodeAt(1);
		this.mbBuffer[uStart + 6] = sType.charCodeAt(2);
		this.mbBuffer[uStart + 7] = sType.charCodeAt(3);
		this.uEnd += 8;
		if (nVersion !== -1) {
			Check(nVersion >= 0 && nVersion <= 255 && nFlags >= 0 && nFlags <= 16777215);
			Check(this.mbBuffer.length - this.uEnd >= 4);
			this.dvBuffer.setUint32(uStart + 8, nVersion << 24 | nFlags);
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
		var TAG_HEADER_SIZE = 10;
		var FIELD_HEADER_SIZE = 10;
		Check(mbBuffer.BYTES_PER_ELEMENT === 1 && Number.isInteger(uStart) && Number.isInteger(uEnd) && uStart >= 0 && uStart <= uEnd);
		this._mb = mbBuffer;
		this._uTagStart = -1;
		this._kbTagSize = -1;
		this._uFieldStart = -1;
		this._kbFieldSize = -1;
		var kbSize = uEnd - uStart;
		if (kbSize > TAG_HEADER_SIZE + FIELD_HEADER_SIZE && this._mb[uStart] === 73 && this._mb[uStart + 1] === 68 && this._mb[uStart + 2] === 51 && this._mb[uStart + 3] === 4 && this._mb[uStart + 5] === 0 && this._ParseSynchsafeInteger(uStart + 6) === kbSize - TAG_HEADER_SIZE) {
			this._uTagStart = uStart + TAG_HEADER_SIZE;
			this._kbTagSize = kbSize - TAG_HEADER_SIZE;
		}
	}
	_ParseSynchsafeInteger(uAddress) {
		var nResult = -1;
		var nByte = this._mb[uAddress];
		if (nByte < 128) {
			var n4Bytes = nByte << 24 - 3;
			nByte = this._mb[uAddress + 1];
			if (nByte < 128) {
				n4Bytes |= nByte << 16 - 2;
				nByte = this._mb[uAddress + 2];
				if (nByte < 128) {
					n4Bytes |= nByte << 8 - 1;
					nByte = this._mb[uAddress + 3];
					if (nByte < 128) {
						nResult = n4Bytes | nByte;
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
		var uTag = this._uTagStart;
		var kbTag = this._kbTagSize;
		while (kbTag > FIELD_HEADER_SIZE) {
			var nCode1 = this._mb[uTag];
			var nCode2 = this._mb[uTag + 1];
			var nCode3 = this._mb[uTag + 2];
			var nCode4 = this._mb[uTag + 3];
			if ((nCode1 < 48 || nCode1 > 57) && (nCode1 < 65 || nCode1 > 90) || (nCode2 < 48 || nCode2 > 57) && (nCode2 < 65 || nCode2 > 90) || (nCode3 < 48 || nCode3 > 57) && (nCode3 < 65 || nCode3 > 90) || (nCode4 < 48 || nCode4 > 57) && (nCode4 < 65 || nCode4 > 90)) {
				break;
			}
			if (this._mb[uTag + 9] !== 0) {
				break;
			}
			var kbField = this._ParseSynchsafeInteger(uTag + 4);
			if (kbField < 1 || kbField > kbTag - FIELD_HEADER_SIZE) {
				break;
			}
			this._uFieldStart = uTag + FIELD_HEADER_SIZE;
			this._kbFieldSize = kbField;
			uTag += FIELD_HEADER_SIZE + kbField;
			kbTag -= FIELD_HEADER_SIZE + kbField;
			yield String.fromCharCode(nCode1, nCode2, nCode3, nCode4);
		}
		this._uFieldStart = -1;
		this._kbFieldSize = -1;
	}
	GetFirstLine() {
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
	var _msSeverity = [];
	var _msRecords = [];
	function Add(sImportance, sRecord) {
		_msSeverity.push(sImportance);
		_msRecords.push(`[Worker] ${sRecord}`);
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
		if (_msSeverity.length !== 0) {
			postMessage([ 2, _msSeverity, _msRecords ]);
			_msSeverity.length = 0;
			_msRecords.length = 0;
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
	function ClearStatistics() {
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
	function Reject(pCondition) {
		if (!pCondition) {
			throw new Error('БРАКОВАТЬ');
		}
	}
	function Ms(nTpTime, sUnits = 'мс') {
		return `${(nTpTime / (TS_TIMESCALE / 1e3)).toFixed(2)}${sUnits}`;
	}
	function SendResult(mbufTransfer) {
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
	function ThrowInBin(mbJunk) {
		if (isMobileDevice() || getBrowserEngineVersion() >= 64) {
			return;
		}
		if (mbJunk && mbJunk.buffer.byteLength) {
			Check(_mbHeap === null || _mbHeap.buffer !== mbJunk.buffer);
			postMessage([ 5, mbJunk.buffer ], [ mbJunk.buffer ]);
		}
	}
	var m_Memory = (() => {
		var MAX_SEGMENT_DURATION = 30;
		var MAX_FRAME_RATE = 150;
		var MAX_NAL_UNITS_PER_FRAME = 10;
		var RESERVE = 1.4;
		var SIZE_MULTIPLE_OF_BYTES = 1 << 6;
		var ASSEMBLER_DATA_SIZE = Align(4);
		var VIDEO_SAMPLES_MEMORY_SIZE = Align(VIDEO_SAMPLE_STRUCT_SIZE * MAX_FRAME_RATE * MAX_SEGMENT_DURATION);
		var AUDIO_SAMPLES_MEMORY_SIZE = Align(AUDIO_SAMPLE_STRUCT_SIZE * SAMPLE_RATES[0] / AUDIO_SAMPLE_LENGTH * MAX_SEGMENT_DURATION);
		var MEDIA_STREAM_MEMORY_SIZE = Align(1e4);
		var VIDEO_STREAM_RESERVE_SIZE = Align(MAX_NAL_UNITS_PER_FRAME * MAX_FRAME_RATE * MAX_SEGMENT_DURATION);
		function Align(nAddressOrSize) {
			return Math.ceil(nAddressOrSize) + (SIZE_MULTIPLE_OF_BYTES - 1) & ~(SIZE_MULTIPLE_OF_BYTES - 1);
		}
		function Allocate(mbTransportStream) {
			var uAllocate = ASSEMBLER_DATA_SIZE;
			_trVideo.uSamplesStart = _trVideo.uSamplesEnd = uAllocate;
			_trVideo.uSamplesMemoryEnd = uAllocate += VIDEO_SAMPLES_MEMORY_SIZE;
			_trAudio.uSamplesStart = _trAudio.uSamplesEnd = uAllocate;
			_trAudio.uSamplesMemoryEnd = uAllocate += AUDIO_SAMPLES_MEMORY_SIZE;
			_trMetadata.uStreamMemoryStart = _trMetadata.uStreamStart = _trMetadata.uStreamEnd = uAllocate;
			_trMetadata.uStreamMemoryEnd = uAllocate += MEDIA_STREAM_MEMORY_SIZE;
			_trVideo.uStreamMemoryStart = uAllocate;
			_trVideo.uStreamStart = _trVideo.uStreamEnd = uAllocate += VIDEO_STREAM_RESERVE_SIZE;
			var kbConstantSize = uAllocate;
			_trVideo.uStreamMemoryEnd = uAllocate += Align(mbTransportStream.length);
			_trAudio.uStreamMemoryStart = _trAudio.uStreamStart = _trAudio.uStreamEnd = uAllocate;
			_trAudio.uStreamMemoryEnd = uAllocate += Align(mbTransportStream.length);
			var kbVariableSize = uAllocate - kbConstantSize;
			if (_mbHeap === null || _mbHeap.length < uAllocate) {
				var kbHeapSize = kbConstantSize + kbVariableSize * RESERVE;
				if (_mbHeap === null) {
					m_Log.Вот(`Создаю кучу ${kbHeapSize} байт`);
				} else {
					m_Log.Ой(`Увеличиваю кучу с ${_mbHeap.length} до ${kbHeapSize} байт`);
				}
				var [bufHeap, oExport] = _oAssembler.AllocateMemory(kbHeapSize);
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
	function ParseTransportStream(mbTransportStream) {
		Reject(mbTransportStream.length !== 0 && mbTransportStream.length % TRANSPORT_PACKET_SIZE == 0);
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
		var cPat = 0, cPmt = 0, kDTSChanges = 0;
		var uTransportPacket = _trVideo.uStreamStart | 0;
		_mbHeap.set(mbTransportStream, uTransportPacket);
		for (var uTransportStreamEnd = uTransportPacket + mbTransportStream.length; uTransportPacket !== uTransportStreamEnd; uTransportPacket += TRANSPORT_PACKET_SIZE) {
			var nTransportPacketHeader = _dvHeap.getUint32(uTransportPacket) | 0;
			Reject((nTransportPacketHeader & 4286578880) == 1191182336);
			var nPid = (nTransportPacketHeader & 2096896) >> 8;
			var pPayload = uTransportPacket + 4;
			if ((nTransportPacketHeader & 32) != 0) {
				var cbAdaptationField = _mbHeap[pPayload];
				Check(cbAdaptationField <= TRANSPORT_PACKET_SIZE - 5);
				Check(cbAdaptationField === 0 || (_mbHeap[pPayload + 1] & 128) == 0);
				pPayload += 1 + cbAdaptationField;
			}
			var trToProcess;
			switch (nPid) {
			  case nVideoPid:
				if ((nTransportPacketHeader & 4194304) != 0) {
					Check((_dvHeap.getUint32(pPayload) & 4294967280) == 480);
				}
				trToProcess = _trVideo;
				break;

			  case nAudioPid:
				if ((nTransportPacketHeader & 4194304) != 0) {
					Check((_dvHeap.getUint32(pPayload) & 4294967264) == 448);
				}
				trToProcess = _trAudio;
				break;

			  case nMetadataPid:
				if ((nTransportPacketHeader & 4194304) != 0) {
					Check(_dvHeap.getUint32(pPayload) === 445);
					Check((_mbHeap[pPayload + 6] & 4) != 0);
					Check((_mbHeap[pPayload + 7] & 192) == 128);
					_muMetadataStart.push(_trMetadata.uStreamEnd);
				}
				trToProcess = _trMetadata;
				break;

			  case 0:
				Check((nTransportPacketHeader & 4194320) == 4194320);
				var oPat = new ProgramAssociationTable(pPayload, uTransportPacket + TRANSPORT_PACKET_SIZE);
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
				Check((nTransportPacketHeader & 4194320) == 4194320);
				var oPmt = new ProgramMapTable(pPayload, uTransportPacket + TRANSPORT_PACKET_SIZE, _oPat.nProgramNumber);
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
			if (trToProcess.nContinuityCounter !== (nTransportPacketHeader & 15) && trToProcess.nContinuityCounter !== -1) {
				m_Log.Ой(`continuity_counter равен ${nTransportPacketHeader & 15} вместо ${trToProcess.nContinuityCounter} PID=${nPid} СмещениеПакета=${mbTransportStream.length - uTransportStreamEnd + uTransportPacket}`);
				Reject(trToProcess.uStreamEnd === trToProcess.uStreamStart);
			}
			trToProcess.nContinuityCounter = nTransportPacketHeader + 1 & 15;
			switch (nTransportPacketHeader & 4194320) {
			  case 16:
				Check(trToProcess.uStreamEnd !== trToProcess.uStreamStart);
				break;

			  case 4194320:
				var cbPesPacket = _dvHeap.getUint16(pPayload + 4);
				var cbPesHeader = _mbHeap[pPayload + 8];
				Check(trToProcess.pPesPacketEnd === trToProcess.uStreamEnd || trToProcess.pPesPacketEnd === -1);
				if (cbPesPacket !== 0) {
					trToProcess.pPesPacketEnd = trToProcess.uStreamEnd + cbPesPacket - 3 - cbPesHeader;
				} else {
					Check(nPid === nVideoPid);
					trToProcess.pPesPacketEnd = -1;
				}
				if (nPid === nVideoPid || trToProcess.nStartDTS === -1) {
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
					if (trToProcess.nStartDTS === -1) {
						trToProcess.nStartDTS = nDts;
					}
					if (nPid === nVideoPid) {
						if (nDts === _nLastVideoSampleDTS && cbPesPacket !== 0) {
							Check((_mbHeap[pPayload + 6] & 4) == 0);
						} else {
							Check(_trVideo.uSamplesEnd <= _trVideo.uSamplesMemoryEnd - VIDEO_SAMPLE_STRUCT_SIZE);
							if (_nLastVideoSampleDTS !== -1) {
								var nVideoSampleDuration = nDts - _nLastVideoSampleDTS;
								if (nVideoSampleDuration <= 0) {
									if (nVideoSampleDuration > -10) {
										nVideoSampleDuration = 1;
										nDts = _nLastVideoSampleDTS + nVideoSampleDuration;
										++kDTSChanges;
									} else {
										Reject(false);
									}
								}
								Check(nVideoSampleDuration < TS_TIMESCALE * 60);
								_nMinVideoSampleDuration = Math.min(_nMinVideoSampleDuration, nVideoSampleDuration);
								_nMaxVideoSampleDuration = Math.max(_nMaxVideoSampleDuration, nVideoSampleDuration);
								_dvHeap.setUint32(_trVideo.uSamplesEnd + VIDEO_SAMPLE_DURATION - VIDEO_SAMPLE_STRUCT_SIZE, nVideoSampleDuration);
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
			var cbPayload = uTransportPacket + TRANSPORT_PACKET_SIZE - pPayload;
			Check(cbPayload > 0 && cbPayload + trToProcess.uStreamEnd <= trToProcess.uStreamMemoryEnd);
			_mbHeap.copyWithin(trToProcess.uStreamEnd, pPayload, pPayload + cbPayload);
			trToProcess.uStreamEnd += cbPayload;
		}
		Check(_trVideo.pPesPacketEnd === _trVideo.uStreamEnd || _trVideo.pPesPacketEnd === -1);
		Check(_trAudio.pPesPacketEnd === _trAudio.uStreamEnd || _trAudio.pPesPacketEnd === -1);
		Check(_trMetadata.pPesPacketEnd === _trMetadata.uStreamEnd || _trMetadata.pPesPacketEnd === -1);
		if (cPat !== 1 || cPmt !== 1) {
			m_Log.Ой(`Количество таблиц в сегменте: PAT=${cPat} PMT=${cPmt}`);
		}
		if (kDTSChanges !== 0) {
			m_Log.Ой(`Количество видеосемплов с увеличенным ВД: ${kDTSChanges}`);
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
			sRecord += ` ВДПервВидСемпла=${(_trVideo.nStartDTS / TS_TIMESCALE).toFixed(5)}` + ` ВДПослВидСемпла=${(_nLastVideoSampleDTS / TS_TIMESCALE).toFixed(5)}` + ` ДлитВидСегмента>${Ms(_nLastVideoSampleDTS - _trVideo.nStartDTS)} ВидСемплов=${kVideoSamples}` + ` ДлитВидСемплов=${Ms(_nMinVideoSampleDuration, '')}<${Ms(_nAvgVideoSampleDuration, '')}<${Ms(_nMaxVideoSampleDuration)}` + `(${(TS_TIMESCALE / _nMinVideoSampleDuration).toFixed(2)}` + `<${(TS_TIMESCALE / _nAvgVideoSampleDuration).toFixed(2)}` + `<${(TS_TIMESCALE / _nMaxVideoSampleDuration).toFixed(2)}к/с)`;
		}
		if (!_trAudio.Empty()) {
			sRecord += ` ВДПервАудСемпла=${(_trAudio.nStartDTS / TS_TIMESCALE).toFixed(5)}`;
		}
		if (!_trVideo.Empty() && !_trAudio.Empty()) {
			var nAudioOffset = _trAudio.nStartDTS - _trVideo.nStartDTS;
			if (nAudioOffset < -TS_TIMESCALE * .1 || nAudioOffset > TS_TIMESCALE * .2) {
				sImportance = 'Ой';
			}
			sRecord += ` СмещНачалаАудСегмента=${Ms(_trAudio.nStartDTS - _trVideo.nStartDTS)}`;
		}
		m_Log[sImportance](sRecord);
		_nEncodingPosition = (_trAudio.nStartDTS !== -1 ? _trAudio.nStartDTS : _trVideo.nStartDTS) / TS_TIMESCALE;
		return true;
	}
	function DecodeTimestamp(uAddress, nMarkerBits) {
		var n1 = _mbHeap[uAddress] | 0;
		var n2 = _dvHeap.getUint32(uAddress + 1) | 0;
		Check((n1 & 241) == (nMarkerBits | 0) && (n2 & 65537) == 65537);
		return +((n1 & 14) * (1 << 29) + (n2 >> 2 & 1073709056 | n2 >> 1 & 32767));
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
		var uSectionEnd = _dvHeap.getUint16(uStart + 1);
		Check((uSectionEnd & 49152) == 32768);
		uSectionEnd = uStart + 3 + (uSectionEnd & 4095) - 4;
		Check(uSectionEnd >= uStart + 12 && uSectionEnd + 4 <= uEnd);
		Check(_dvHeap.getUint16(uStart + 3) === nProgramNumber);
		Check((_mbHeap[uStart + 5] & 1) == 1);
		var nPmtVersion = _mbHeap[uStart + 5] & 62;
		Check(_mbHeap[uStart + 6] === 0);
		Check(_mbHeap[uStart + 7] === 0);
		uStart += 12 + (_dvHeap.getUint16(uStart + 10) & 4095);
		var nVideoPid = -1, nAudioPid = -1, nMetadataPid = -1;
		while (uStart !== uSectionEnd) {
			var pDescriptor = uStart + 5;
			Check(pDescriptor <= uSectionEnd);
			var nElementaryPid = _dvHeap.getUint16(uStart + 1) & 8191;
			Check(nElementaryPid >= 16 && nElementaryPid <= 8190);
			var nEsInfoLength = _dvHeap.getUint16(uStart + 3) & 4095;
			Check(pDescriptor + nEsInfoLength <= uSectionEnd);
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
	function ParseMetadata() {
		for (var idx = 0; idx < _muMetadataStart.length; idx++) {
			var oID3 = new ID3(_mbHeap, _muMetadataStart[idx], _muMetadataStart[idx + 1] || _trMetadata.uStreamEnd);
			for (var sFieldId of oID3) {
				if (sFieldId === 'TXXX') {
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
	function ParseVideoStream() {
		if (_bDiscontinuity) {
			_abSequenceParameterSet = null;
			_abPictureParameterSet = null;
			_abSequenceParameterSetExt = null;
		}
		if (_trVideo.Empty()) {
			return true;
		}
		var NORMAL_FRAME_FLAGS = 65536;
		var KEY_FRAME_FLAGS = 0;
		Check(_trVideo.uStreamStart > _trVideo.uStreamMemoryStart && _trVideo.uStreamEnd > _trVideo.uStreamStart && _trVideo.uSamplesEnd > _trVideo.uSamplesStart);
		var uParsedStream = _trVideo.uStreamMemoryStart;
		var uFirstKeyFrameSample = -1;
		var cNalUnits = 0, cAccessUnits = 0, kSamplesWithoutVCL = 0, kKeyFrames = 0, uLastKeyFrameSample = -1;
		var uSample = _trVideo.uSamplesStart;
		var uNextSampleStart = -1;
		var uParsedSampleStart;
		var nSampleFlags;
		var pNalUnitEnd = _fFindPrefix(_trVideo.uStreamStart, _trVideo.uStreamEnd);
		Check(pNalUnitEnd === _trVideo.uStreamStart);
		Check(_mcHeap[0] > 3);
		for (;;) {
			var kbPrefixSize = pNalUnitEnd === _trVideo.uStreamEnd ? 0 : _mcHeap[0];
			var bSampleStart = pNalUnitEnd + kbPrefixSize - Math.min(4, kbPrefixSize) >= uNextSampleStart;
			if (bSampleStart && uNextSampleStart !== -1) {
				if (nSampleFlags === -1) {
					nSampleFlags = NORMAL_FRAME_FLAGS;
					++kSamplesWithoutVCL;
				}
				Check(uParsedStream > uParsedSampleStart);
				_dvHeap.setUint32(uSample + VIDEO_SAMPLE_SIZE, uParsedStream - uParsedSampleStart);
				_dvHeap.setUint32(uSample + VIDEO_SAMPLE_FLAGS, nSampleFlags);
				uSample += VIDEO_SAMPLE_STRUCT_SIZE;
			}
			if (pNalUnitEnd === _trVideo.uStreamEnd) {
				Check(uSample === _trVideo.uSamplesEnd);
				break;
			}
			var pNalUnitBegin = pNalUnitEnd + kbPrefixSize;
			pNalUnitEnd = _fFindPrefix(pNalUnitBegin, _trVideo.uStreamEnd);
			Reject(pNalUnitEnd >= pNalUnitBegin);
			if (bSampleStart) {
				Check(uSample < _trVideo.uSamplesEnd);
				uNextSampleStart = _dvHeap.getUint32(uSample + VIDEO_SAMPLE_SIZE);
				uParsedSampleStart = uParsedStream;
				nSampleFlags = -1;
				if (cAccessUnits === 1) {
					cAccessUnits = 0;
				}
			}
			if (pNalUnitBegin === pNalUnitEnd) {
				continue;
			}
			++cNalUnits;
			var nNalRefIdc = _mbHeap[pNalUnitBegin] & 224;
			Reject(nNalRefIdc < 128);
			switch (_mbHeap[pNalUnitBegin] & 31) {
			  case 1:
			  case 2:
			  case 3:
			  case 4:
				Check(nSampleFlags !== KEY_FRAME_FLAGS);
				nSampleFlags = NORMAL_FRAME_FLAGS;
				break;

			  case 5:
				Check(nNalRefIdc !== 0);
				if (nSampleFlags !== KEY_FRAME_FLAGS) {
					Check(nSampleFlags !== NORMAL_FRAME_FLAGS);
					nSampleFlags = KEY_FRAME_FLAGS;
					if (uFirstKeyFrameSample === -1) {
						uFirstKeyFrameSample = uSample;
					}
					uLastKeyFrameSample = uSample;
					++kKeyFrames;
				}
				break;

			  case 6:
				Check(nNalRefIdc === 0);
				break;

			  case 7:
				Check(nNalRefIdc !== 0);
				if (_bDiscontinuity && (uFirstKeyFrameSample === -1 || _abSequenceParameterSet === null)) {
					_abSequenceParameterSet = _mbHeap.slice(pNalUnitBegin, pNalUnitEnd);
				}
				continue;

			  case 8:
				Check(nNalRefIdc !== 0);
				if (_bDiscontinuity && (uFirstKeyFrameSample === -1 || _abPictureParameterSet === null)) {
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
				if (_bDiscontinuity && (uFirstKeyFrameSample === -1 || _abSequenceParameterSetExt === null)) {
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
		m_Log.Вот('NalUnits=' + cNalUnits + ' КлючКадров=' + kKeyFrames + ' ПервКлючКадр=' + _trVideo.GetSampleNumber(uFirstKeyFrameSample) + ' ПослКлючКадр=' + _trVideo.GetSampleNumber(uLastKeyFrameSample));
		if (kSamplesWithoutVCL !== 0) {
			m_Log.Ой(`Видеосемплов без VCL NAL unit: ${kSamplesWithoutVCL}`);
		}
		if (cAccessUnits > 1) {
			m_Log.Ой('Несколько access unit в одном видеосемпле');
		}
		if (_bDiscontinuity) {
			if (uFirstKeyFrameSample === -1 || _abSequenceParameterSet === null || _abPictureParameterSet === null) {
				m_Log.Ой(`Сегмент не годится для воспроизведения: не найден IDR ${uFirstKeyFrameSample === -1}, не найден SPS ${_abSequenceParameterSet === null}, не найден PPS ${_abPictureParameterSet === null}`);
				return false;
			}
			var mbCopy = _abSequenceParameterSet.slice();
			var o = RemoveEmulationPreventionBytesFromNalUnit(mbCopy, 0, mbCopy.length);
			ParseSequenceParameterSet(mbCopy, o.uRBSPStart, o.uRBSPEnd);
		} else if (MAKE_FIRST_FRAME_KEY && uFirstKeyFrameSample !== _trVideo.uSamplesStart) {
			m_Log.Ой('Делаю первый видеосемпл ключевым');
			_dvHeap.setUint32(_trVideo.uSamplesStart + VIDEO_SAMPLE_FLAGS, KEY_FRAME_FLAGS);
		}
		return true;
	}
	function ParseSequenceParameterSet(mbStream, uStart, uEnd) {
		_nProfileIndication = mbStream[uStart];
		_nConstraintSetFlag = mbStream[uStart + 1];
		_nLevelIndication = mbStream[uStart + 2];
		var oBitStream = new BitStream(mbStream, uStart + 3, uEnd);
		oBitStream.SkipExpGolomb();
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
			_nChromaFormatIndication = oBitStream.ReadUnsignedExpGolomb();
			Check(_nChromaFormatIndication <= 3);
			if (_nChromaFormatIndication === 3) {
				nSeparateColourPlaneFlag = oBitStream.ReadBits(1);
			}
			_nBitDepthLumaMinus8 = oBitStream.ReadUnsignedExpGolomb();
			Check(_nBitDepthLumaMinus8 <= 6);
			_nBitDepthChromaMinus8 = oBitStream.ReadUnsignedExpGolomb();
			Check(_nBitDepthChromaMinus8 <= 6);
			oBitStream.SkipBits(1);
			if (oBitStream.ReadBits(1) !== 0) {
				for (var i = 0, ic = _nChromaFormatIndication !== 3 ? 8 : 12; i < ic; ++i) {
					if (oBitStream.ReadBits(1) !== 0) {
						var nLastScale = 8, nNextScale = 8;
						for (var j = 0, jc = i < 6 ? 16 : 64; j < jc; ++j) {
							if (nNextScale !== 0) {
								nNextScale = (nLastScale + oBitStream.ReadSignedExpGolomb() + 256) % 256;
							}
							if (nNextScale !== 0) {
								nLastScale = nNextScale;
							}
						}
					}
				}
			}
		}
		oBitStream.SkipExpGolomb();
		switch (oBitStream.ReadUnsignedExpGolomb()) {
		  case 0:
			oBitStream.SkipExpGolomb();
			break;

		  case 1:
			oBitStream.SkipBits(1);
			oBitStream.SkipExpGolomb();
			oBitStream.SkipExpGolomb();
			for (i = 0, ic = oBitStream.ReadUnsignedExpGolomb(); i < ic; ++i) {
				oBitStream.SkipExpGolomb();
			}
		}
		_nMaxNumberReferenceFrames = oBitStream.ReadUnsignedExpGolomb();
		oBitStream.SkipBits(1);
		var nPictureWidthInMacroblocks = oBitStream.ReadUnsignedExpGolomb() + 1;
		var nPictureHeightInMapUnits = oBitStream.ReadUnsignedExpGolomb() + 1;
		var nFrameMacroblocksOnlyFlag = oBitStream.ReadBits(1);
		if (nFrameMacroblocksOnlyFlag === 0) {
			oBitStream.SkipBits(1);
		}
		oBitStream.SkipBits(1);
		var nFrameCropLeftOffset = 0;
		var nFrameCropRightOffset = 0;
		var nFrameCropTopOffset = 0;
		var nFrameCropBottomOffset = 0;
		if (oBitStream.ReadBits(1) !== 0) {
			nFrameCropLeftOffset = oBitStream.ReadUnsignedExpGolomb();
			nFrameCropRightOffset = oBitStream.ReadUnsignedExpGolomb();
			nFrameCropTopOffset = oBitStream.ReadUnsignedExpGolomb();
			nFrameCropBottomOffset = oBitStream.ReadUnsignedExpGolomb();
		}
		_nFrameRate = 0;
		_nRange = -1;
		if (oBitStream.ReadBits(1) !== 0) {
			var nAspectRatioIndication;
			if (oBitStream.ReadBits(1) !== 0) {
				nAspectRatioIndication = oBitStream.ReadBits(8);
				if (nAspectRatioIndication === 255) {
					oBitStream.ReadBits(16);
					oBitStream.ReadBits(16);
				}
			}
			if (oBitStream.ReadBits(1) !== 0) {
				oBitStream.SkipBits(1);
			}
			if (oBitStream.ReadBits(1) !== 0) {
				oBitStream.ReadBits(3);
				_nRange = oBitStream.ReadBits(1);
				if (oBitStream.ReadBits(1) !== 0) {
					oBitStream.SkipBits(8 + 8 + 8);
				}
			}
			if (oBitStream.ReadBits(1) !== 0) {
				oBitStream.SkipExpGolomb();
				oBitStream.SkipExpGolomb();
			}
			var nNumUnitsInTick, nTimeScale, nFixedFrameRateFlag;
			if (oBitStream.ReadBits(1) !== 0) {
				nNumUnitsInTick = oBitStream.ReadBits(32);
				nTimeScale = oBitStream.ReadBits(32);
				nFixedFrameRateFlag = oBitStream.ReadBits(1);
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
		var uEnd2 = uEnd - 2;
		while (uStart < uEnd2) {
			if (mbStream[uStart++] === 0 && mbStream[uStart++] === 0) {
				var nThirdByte = mbStream[uStart++];
				Check(nThirdByte >= 3);
				if (nThirdByte === 3) {
					var uDecodedStream = uStart - 1;
					Check(uStart === uEnd || mbStream[uStart] <= 3);
					while (uStart < uEnd2) {
						if ((mbStream[uDecodedStream++] = mbStream[uStart++]) === 0 && (mbStream[uDecodedStream++] = mbStream[uStart++]) === 0) {
							nThirdByte = mbStream[uDecodedStream++] = mbStream[uStart++];
							Check(nThirdByte >= 3);
							if (nThirdByte === 3) {
								--uDecodedStream;
								Check(uStart === uEnd || mbStream[uStart] <= 3);
							}
						}
					}
					while (uStart !== uEnd) {
						var nLastByte = mbStream[uDecodedStream++] = mbStream[uStart++];
					}
					Check(nLastByte !== 0);
					return {
						uRBSPStart,
						uRBSPEnd: uDecodedStream
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
	function ParseAudioStream() {
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
		var nAudioSampleDuration = AUDIO_SAMPLE_LENGTH / _nSampleRate;
		var nAudioSegmentDuration = _trAudio.GetSampleCount() * nAudioSampleDuration;
		_nAudioSegmentEndDTS = _trAudio.nStartDTS + Math.round(nAudioSegmentDuration * TS_TIMESCALE);
		_nAudioBitrate = _trAudio.GetStreamSize() * 8 / 1e3 / nAudioSegmentDuration;
		m_Log.Вот(`ВДКонцаАудСегмента=${(_nAudioSegmentEndDTS / TS_TIMESCALE).toFixed(5)}` + ` ДлитАудСегмента=${(nAudioSegmentDuration * 1e3).toFixed(2)}мс` + ` ДлитАудСемпла=${(nAudioSampleDuration * 1e3).toFixed(2)}мс`);
		return true;
	}
	function ParseAdtsFixedHeader(nAdtsFixedHeader) {
		Check((nAdtsFixedHeader & 4294901760) == (4293984256 | 0));
		_nAudioObjectType = (nAdtsFixedHeader >> 14 & 3) + 1;
		Check(_nAudioObjectType === 2);
		_anDecoderSpecificInfo[0] = _nAudioObjectType << 3;
		var nSampleRateIndex = nAdtsFixedHeader >> 10 & 15;
		_nSampleRate = SAMPLE_RATES[nSampleRateIndex];
		Check(_nSampleRate !== void 0);
		_anDecoderSpecificInfo[0] |= nSampleRateIndex >> 1;
		_anDecoderSpecificInfo[1] = nSampleRateIndex << 7 & 128;
		_nChannelCount = nAdtsFixedHeader >> 6 & 7;
		Check(_nChannelCount !== 0);
		_anDecoderSpecificInfo[1] |= _nChannelCount << 3;
		m_Log[_nAudioObjectType !== 2 || _nSampleRate < 44100 || _nChannelCount > 2 ? 'Ой' : 'Вот'](`AudioObjectType=${_nAudioObjectType} ЧастотаДискретизации=${_nSampleRate} КоличествоКаналов=${_nChannelCount}`);
	}
	function GetCodecNames() {
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
	function CreateInitSegment() {
		var kbSize = 1100 + (_abSequenceParameterSet === null ? 0 : _abSequenceParameterSet.length) + (_abPictureParameterSet === null ? 0 : _abPictureParameterSet.length) + (_abSequenceParameterSetExt === null ? 0 : _abSequenceParameterSetExt.length) + (_trAudio.Empty() ? 0 : _anDecoderSpecificInfo.length);
		var mbSegment = new Uint8Array(kbSize);
		var dvSegment = CreateDataView(mbSegment);
		var oSegment = new IsoBaseMedia(mbSegment, dvSegment, 0);
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
				AddTrackToInitSegment(true, oSegment);
			}
			if (!_trAudio.Empty()) {
				AddTrackToInitSegment(false, oSegment);
			}
		});
		return oSegment.Finish();
	}
	function AddTrackToInitSegment(bVideo, oSegment) {
		oSegment.AddBox('trak', () => {
			oSegment.AddFullBox('tkhd', 0, 3, 80);
			oSegment.mbBuffer[oSegment.uEnd - 64] = 255;
			oSegment.mbBuffer[oSegment.uEnd - 63] = 255;
			oSegment.mbBuffer[oSegment.uEnd - 62] = 255;
			oSegment.mbBuffer[oSegment.uEnd - 61] = 255;
			oSegment.mbBuffer[oSegment.uEnd - 43] = 1;
			oSegment.mbBuffer[oSegment.uEnd - 27] = 1;
			oSegment.mbBuffer[oSegment.uEnd - 12] = 64;
			if (bVideo) {
				oSegment.dvBuffer.setUint32(oSegment.uEnd - 72, VIDEO_TRACK_NUMBER);
				oSegment.dvBuffer.setUint16(oSegment.uEnd - 8, _nPictureWidth);
				oSegment.dvBuffer.setUint16(oSegment.uEnd - 4, _nPictureHeight);
			} else {
				oSegment.dvBuffer.setUint32(oSegment.uEnd - 72, AUDIO_TRACK_NUMBER);
				oSegment.dvBuffer.setUint16(oSegment.uEnd - 48, 256);
			}
			oSegment.AddBox('mdia', () => {
				oSegment.AddFullBox('mdhd', 0, 0, 20);
				oSegment.dvBuffer.setUint32(oSegment.uEnd - 12, bVideo ? TS_TIMESCALE : _nSampleRate);
				oSegment.mbBuffer[oSegment.uEnd - 8] = 255;
				oSegment.mbBuffer[oSegment.uEnd - 7] = 255;
				oSegment.mbBuffer[oSegment.uEnd - 6] = 255;
				oSegment.mbBuffer[oSegment.uEnd - 5] = 255;
				oSegment.mbBuffer[oSegment.uEnd - 4] = 85;
				oSegment.mbBuffer[oSegment.uEnd - 3] = 196;
				oSegment.AddFullBox('hdlr', 0, 0, 21);
				if (bVideo) {
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
					if (bVideo) {
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
							if (bVideo) {
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
	function CreateMediaSegment(мбМедиасегмент) {
		var dvMediaSegment = CreateDataView(мбМедиасегмент);
		var oSegment = new IsoBaseMedia(мбМедиасегмент, dvMediaSegment, 0);
		var uVideoDataOffset, uAudioDataOffset;
		oSegment.AddBox('moof', () => {
			oSegment.AddFullBox('mfhd', 0, 0, 4);
			dvMediaSegment.setUint32(oSegment.uEnd - 4, 0);
			if (!_trVideo.Empty()) {
				oSegment.AddBox('traf', () => {
					oSegment.AddFullBox('tfhd', 0, 131072, 4);
					dvMediaSegment.setUint32(oSegment.uEnd - 4, VIDEO_TRACK_NUMBER);
					oSegment.AddFullBox('tfdt', 1, 0, 8);
					мбМедиасегмент.setUint64(oSegment.uEnd - 8, _trVideo.nStartDTS);
					oSegment.AddFullBox('trun', 1, 3841, () => {
						dvMediaSegment.setUint32(oSegment.uEnd, _trVideo.GetSampleCount());
						uVideoDataOffset = oSegment.uEnd + 4;
						oSegment.CopyFromBuffer(oSegment.uEnd + 8, _mbHeap, _trVideo.uSamplesStart, _trVideo.uSamplesEnd);
					});
				});
			}
			if (!_trAudio.Empty()) {
				oSegment.AddBox('traf', () => {
					oSegment.AddFullBox('tfhd', 0, 131072, 4);
					dvMediaSegment.setUint32(oSegment.uEnd - 4, AUDIO_TRACK_NUMBER);
					oSegment.AddFullBox('tfdt', 1, 0, 8);
					мбМедиасегмент.setUint64(oSegment.uEnd - 8, Math.round(_trAudio.nStartDTS / TS_TIMESCALE * _nSampleRate));
					oSegment.AddFullBox('trun', 1, 513, () => {
						dvMediaSegment.setUint32(oSegment.uEnd, _trAudio.GetSampleCount());
						uAudioDataOffset = oSegment.uEnd + 4;
						oSegment.CopyFromBuffer(oSegment.uEnd + 8, _mbHeap, _trAudio.uSamplesStart, _trAudio.uSamplesEnd);
					});
				});
			}
		});
		oSegment.AddBox('mdat', () => {
			if (!_trVideo.Empty()) {
				dvMediaSegment.setInt32(uVideoDataOffset, oSegment.uEnd - oSegment.uStart);
				oSegment.CopyFromBuffer(oSegment.uEnd, _mbHeap, _trVideo.uStreamStart, _trVideo.uStreamEnd);
			}
			if (!_trAudio.Empty()) {
				dvMediaSegment.setInt32(uAudioDataOffset, oSegment.uEnd - oSegment.uStart);
				oSegment.CopyFromBuffer(oSegment.uEnd, _mbHeap, _trAudio.uStreamStart, _trAudio.uStreamEnd);
			}
		});
		return oSegment.Finish();
	}
	function SendConvertedSegment(мбМедиасегмент) {
		var mbufTransfer = void 0;
		var oData = {
			nConvertedIn: _nConvertedIn,
			bRejected: _bRejected,
			bVideoLoss: _bVideoLoss,
			bAudioLoss: _bAudioLoss,
			nMinVideoSampleDuration: _nMinVideoSampleDuration / TS_TIMESCALE * 1e3,
			nMaxVideoSampleDuration: _nMaxVideoSampleDuration / TS_TIMESCALE * 1e3,
			nAvgVideoSampleDuration: _nAvgVideoSampleDuration / TS_TIMESCALE * 1e3,
			nAudioBitrate: _nAudioBitrate,
			nEncodingPosition: _nEncodingPosition,
			nBroadcastPosition: _nBroadcastPosition,
			nEncodingTime: _nEncodingTime
		};
		if (мбМедиасегмент) {
			oData.мбМедиасегмент = CreateMediaSegment(мбМедиасегмент);
			oData.bHasVideo = !_trVideo.Empty();
			oData.bHasAudio = !_trAudio.Empty();
			mbufTransfer = [ oData.мбМедиасегмент.buffer ];
			if (_bDiscontinuity) {
				oData.mbInitializationSegment = CreateInitSegment();
				oData.sCodecs = GetCodecNames();
				oData.nProfileIndication = _nProfileIndication;
				oData.nConstraintSetFlag = _nConstraintSetFlag;
				oData.nLevelIndication = _nLevelIndication;
				oData.nMaxNumberReferenceFrames = _nMaxNumberReferenceFrames;
				oData.nPictureWidth = _nPictureWidth;
				oData.nPictureHeight = _nPictureHeight;
				oData.nFrameRate = _nFrameRate;
				oData.nRange = _nRange;
				oData.bInterlaced = _bInterlaced;
				oData.nAudioObjectType = _nAudioObjectType;
				oData.nSampleRate = _nSampleRate;
				oData.nChannelCount = _nChannelCount;
				mbufTransfer.push(oData.mbInitializationSegment.buffer);
			}
			_oSourceSegment.bDiscontinuity = _bDiscontinuity;
			m_Log.Вот(`Отправляю сегмент Разрыв=${_bDiscontinuity} Размер=${(oData.мбМедиасегмент.length / 1024 / 1024).toFixed(2)}мб`);
		}
		_oSourceSegment.pData = oData;
		m_Log.Send();
		SendResult(mbufTransfer);
	}
	function JoinSegments() {
		if (_bDiscontinuity) {
			return;
		}
		var nVideoDTSDeviation = 0, nVideoDTSOverlap = 1, nAudioDTSDeviation = 0;
		if (!_trVideo.Empty()) {
			nVideoDTSDeviation = _trVideo.nStartDTS - _nPrevVideoSegmentEndDTS;
			nVideoDTSOverlap = _trVideo.nStartDTS - _nPrevVideoSegmentLastSampleDTS;
		}
		if (!_trAudio.Empty()) {
			nAudioDTSDeviation = _trAudio.nStartDTS - _nPrevAudioSegmentEndDTS;
		}
		if (nVideoDTSOverlap <= 0 || nAudioDTSDeviation < -TS_TIMESCALE * .1) {
			m_Log.Ой(`Добавлен разрыв: ОтклонениеВДВидео=${Ms(nVideoDTSDeviation)} ПерекрытиеВДВидео=${Ms(nVideoDTSOverlap)} ОтклонениеВДАудио=${nAudioDTSDeviation}`);
			_bDiscontinuity = true;
			return;
		}
		if (Math.abs(nVideoDTSDeviation) > TS_TIMESCALE * .002 || Math.abs(nAudioDTSDeviation) > 2) {
			m_Log.Ой(`ОтклонениеВДВидео=${Ms(nVideoDTSDeviation)} ПерекрытиеВДВидео=${Ms(nVideoDTSOverlap)} ОтклонениеВДАудио=${nAudioDTSDeviation}`);
		}
		if (nVideoDTSDeviation > TS_TIMESCALE * .01) {
			_bVideoLoss = true;
		}
		if (nAudioDTSDeviation > TS_TIMESCALE * .1) {
			_bAudioLoss = true;
		}
	}
	function CalculateLastVideoSampleDuration() {
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
			var nDTS = 0;
			var nLastVideoSampleCTO = _dvHeap.getInt32(uSample + VIDEO_SAMPLE_CTO);
			for (var idx = Math.min(16, kVideoSamples); --idx != 0; ) {
				uSample -= VIDEO_SAMPLE_STRUCT_SIZE;
				nDTS -= _dvHeap.getUint32(uSample + VIDEO_SAMPLE_DURATION);
				var nCTO = nDTS + _dvHeap.getInt32(uSample + VIDEO_SAMPLE_CTO);
				if (nCTO > nLastVideoSampleCTO) {
					nDuration = Math.min(nDuration, nCTO - nLastVideoSampleCTO);
				}
			}
		}
		m_Log[kVideoSamples === 1 ? 'Ой' : 'Вот'](`Длительность последнего видеосемпла ${Ms(nDuration)}`);
		_dvHeap.setUint32(_trVideo.uSamplesEnd - VIDEO_SAMPLE_STRUCT_SIZE + VIDEO_SAMPLE_DURATION, nDuration);
		_nVideoSegmentEndDTS = _nLastVideoSampleDTS + nDuration;
	}
	function ConvertSegment() {
		var nStart = performance.now();
		_bDiscontinuity = _bDiscontinuity || _oSourceSegment.bDiscontinuity;
		m_Log.Вот(`ПРЕОБРАЗУЮ СЕГМЕНТ ${_oSourceSegment.nNumber} Разрыв=${_bDiscontinuity} Длительность=${_oSourceSegment.nDuration} Размер=${(_oSourceSegment.pData.byteLength / 1024 / 1024).toFixed(2)}мб`);
		ClearStatistics();
		var bSegmentConverted = false;
		var mbTransportStream = new Uint8Array(_oSourceSegment.pData);
		try {
			m_Memory.Allocate(mbTransportStream);
			if (ParseTransportStream(mbTransportStream)) {
				JoinSegments();
				ParseMetadata();
				bSegmentConverted = ParseVideoStream() && ParseAudioStream();
				if (bSegmentConverted) {
					CalculateLastVideoSampleDuration();
				}
			}
		} catch (pException) {
			if (pException instanceof Error && pException.message === 'БРАКОВАТЬ') {
				m_Log.Ой(`Сегмент забракован: ${pException.stack}`);
				ClearStatistics();
				_bRejected = true;
			} else {
				throw pException;
			}
		}
		_oSourceSegment.pData = null;
		if (bSegmentConverted) {
			SendConvertedSegment(mbTransportStream);
		} else {
			ThrowInBin(mbTransportStream);
			SendConvertedSegment(null);
		}
		_bDiscontinuity = !bSegmentConverted;
		_nPrevVideoSegmentLastSampleDTS = _nLastVideoSampleDTS;
		_nPrevVideoSegmentEndDTS = _nVideoSegmentEndDTS;
		_nPrevAudioSegmentEndDTS = _nAudioSegmentEndDTS;
		_nConvertedIn = performance.now() - nStart;
	}
	function HandleStateSwitch() {
		m_Log.Вот(`ПРОПУСКАЮ СЕГМЕНТ ${_oSourceSegment.nNumber} Состояние=${_oSourceSegment.pData}`);
		if (_oSourceSegment.pData !== STATE_VARIANT_CHANGE) {
			m_Memory.Free();
		}
		m_Log.Send();
		SendResult();
		_bDiscontinuity = true;
	}
	function HandleMessage(pData) {
		_oSourceSegment = pData;
		if (typeof _oSourceSegment.pData == 'number') {
			HandleStateSwitch();
		} else {
			ConvertSegment();
		}
		_oSourceSegment = null;
	}
	function HandleException(pException) {
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
				HandleMessage(oEvent.data);
			}
		} catch (pException) {
			HandleException(pException);
		}
	});
	self.onmessageerror = (oEvent => {
		throw new Error(`Произошло событие ${oEvent.type}`);
	});
	_oAssembler.Compile().then(() => {
		m_Log.Вот(`Компиляция завершена: ${performance.now().toFixed()}мс Необработанных сообщений: ${_mUnprocessedMessages.length}`);
		while (_mUnprocessedMessages.length !== 0) {
			HandleMessage(_mUnprocessedMessages.shift());
		}
		_mUnprocessedMessages = null;
	}).catch(HandleException);
}