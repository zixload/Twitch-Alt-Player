'use strict';
/*
	Le fil de conversion : du MPEG-TS de Twitch au MP4 fragmente que MediaSource sait jouer.

	Un segment arrive en paquets de transport de 188 octets. Le fil les trie par flux -- video H.264,
	son AAC, metadonnees ID3 --, reassemble les paquets PES de chacun, puis :
	  - pour la video, remplace les prefixes de debut Annex B (00 00 01) par des longueurs sur quatre
	    octets, et releve pour chaque image sa duree, sa taille, si c'est une image cle et son decalage
	    de composition ;
	  - pour le son, retire les en-tetes ADTS de chaque trame AAC et releve leur taille ;
	  - et ecrit un fragment MP4 (moof + mdat), precede d'un en-tete d'initialisation (moov) a chaque
	    discontinuite.

	**Une erreur d'un octet ici ne leve rien : elle corrompt l'image.** Toute modification de ce fichier
	se verifie avec tools/worker/workercheck.js, qui rejoue des segments reels dans l'ancienne et la
	nouvelle version et compare ce qui sort, octet par octet. Les nombres qui suivent sont des champs de
	normes -- ISO/IEC 13818-1 pour le transport, ITU-T H.264 pour la video, ISO/IEC 14496-3 pour l'AAC,
	ISO/IEC 14496-12 pour le MP4 -- et sont ecrits en hexadecimal quand ce sont des masques de bits.

	**Tout se passe dans un seul tas.** Le segment y est copie, puis chaque piste y a sa zone : la table
	des images, puis le flux brut. Le reassemblage recopie vers le bas dans la meme memoire, sans jamais
	allouer. La recherche des prefixes de debut -- la seule boucle chaude qui ne tient pas en quelques
	octets -- est en WebAssembly (wasm.wasm), avec un repli asm.js (asmjs.js) qui partage le tas.

	**Une discontinuite remet tout a zero.** Tables PAT/PMT, compteurs de continuite, parametres de la
	video et du son : tout est relu, et l'en-tete d'initialisation est recree. Hors discontinuite, le
	fil verifie que le segment recolle au precedent, et en declare une lui-meme sinon.

	Le fil suppose Chrome 92 ou plus, comme le manifeste : les contournements pour des moteurs plus
	anciens ont ete retires.
*/

var STATE_VARIANT_CHANGE = 9;

function Check(pCondition) {
	if (!pCondition) {
		throw new Error('Check failed');
	}
}

function CreateDataView(mbBuffer) {
	return new DataView(mbBuffer.buffer);
}

// Un entier sans signe sur 64 bits, gros-boutiste. DataView n'a de variante 64 bits qu'en BigInt.
function SetUint64(mbBuffer, u, nValue) {
	u |= 0;
	var h = Math.trunc(nValue);
	if (h < Number.MIN_SAFE_INTEGER || h > Number.MAX_SAFE_INTEGER) {
		throw new Error(nValue);
	}
	var n32 = h / 4294967296 | 0;
	mbBuffer[u] = n32 >> 24;
	mbBuffer[u + 1 | 0] = n32 >> 16;
	mbBuffer[u + 2 | 0] = n32 >> 8;
	mbBuffer[u + 3 | 0] = n32;
	n32 = h | 0;
	mbBuffer[u + 4 | 0] = n32 >> 24;
	mbBuffer[u + 5 | 0] = n32 >> 16;
	mbBuffer[u + 6 | 0] = n32 >> 8;
	mbBuffer[u + 7 | 0] = n32;
}

// Les codes de quatre lettres des boites MP4 et des gestionnaires, en octets.
function FourCC(sCode) {
	return [ sCode.charCodeAt(0), sCode.charCodeAt(1), sCode.charCodeAt(2), sCode.charCodeAt(3) ];
}

// ----------------------------------------------------------------------------------------------
// La recherche des prefixes de debut, et le tas qu'elle partage

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
	// La memoire WebAssembly ne peut que grandir : on l'agrandit plutot que d'en recreer une.
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

// asm.js exige un tas d'une puissance de deux jusqu'a 16 Mo, puis un multiple de 16 Mo.
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

// ----------------------------------------------------------------------------------------------
// Lire des bits : les parametres de sequence H.264 sont codes en Exp-Golomb

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
	// Jusqu'a 32 bits, poids fort d'abord.
	ReadBits(kBits) {
		Check(Number.isInteger(kBits));
		Check((this.kBitsLeft -= kBits) >= 0);
		var nResult;
		if (kBits === 1) {
			nResult = this._mbBuffer[this._uNextByte] >>> this._nNextBit & 1;
			if (--this._nNextBit < 0) {
				this._nNextBit = 7;
				++this._uNextByte;
			}
		} else {
			Check(kBits >= 1 && kBits <= 32);
			nResult = 0;
			var nNextResultBit = kBits - 1;
			var nMask = (1 << this._nNextBit + 1) - 1;
			do {
				var nBits = this._mbBuffer[this._uNextByte] & nMask;
				nResult |= this._nNextBit < nNextResultBit ? nBits << nNextResultBit - this._nNextBit : nBits >>> this._nNextBit - nNextResultBit;
				var kBitsAdded = Math.min(nNextResultBit, this._nNextBit) + 1;
				if ((this._nNextBit -= kBitsAdded) < 0) {
					this._nNextBit = 7;
					++this._uNextByte;
					nMask = 0xFF;
				}
			} while ((nNextResultBit -= kBitsAdded) >= 0);
		}
		return nResult >>> 0;
	}
	// ue(v) : n zeros, un un, puis n bits.
	ReadUnsignedExpGolomb() {
		for (var kLeadingZeros = 0; this.ReadBits(1) === 0; ++kLeadingZeros) {}
		Check(kLeadingZeros <= 31);
		return kLeadingZeros === 0 ? 0 : (1 << kLeadingZeros >>> 0) - 1 + this.ReadBits(kLeadingZeros);
	}
	// se(v) : 1, 2, 3, 4... se lisent +1, -1, +2, -2...
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

// ----------------------------------------------------------------------------------------------
// Ecrire des boites MP4

/*
	Une boite commence par sa taille sur quatre octets, que l'on ne connait qu'a la fin : on reserve la
	place, on ecrit le contenu, et on revient poser la taille. Le contenu est un nombre d'octets laisses
	a zero (a remplir ensuite par l'appelant, qui connait les positions depuis la fin), un tableau
	d'octets, ou une fonction qui ecrit des boites imbriquees.
*/
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
	// Une « full box » porte en plus une version (8 bits) et des drapeaux (24 bits). -1 : boite simple.
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
			Check(nVersion >= 0 && nVersion <= 0xFF && nFlags >= 0 && nFlags <= 0xFFFFFF);
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

// ----------------------------------------------------------------------------------------------
// Lire les metadonnees ID3 que Twitch glisse dans le flux

/*
	Une etiquette ID3v2.4 entiere, dont on parcourt les champs. Tout ce qui ne ressemble pas a une
	etiquette bien formee est ignore sans erreur : ces metadonnees sont un bonus (position dans la
	diffusion, heure d'encodage), jamais une condition pour jouer.
*/
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
		// « ID3 », version 4, sans drapeaux, et une taille qui couvre exactement le reste.
		if (kbSize > TAG_HEADER_SIZE + FIELD_HEADER_SIZE && this._mb[uStart] === 0x49 && this._mb[uStart + 1] === 0x44 && this._mb[uStart + 2] === 0x33 && this._mb[uStart + 3] === 4 && this._mb[uStart + 5] === 0 && this._ParseSynchsafeInteger(uStart + 6) === kbSize - TAG_HEADER_SIZE) {
			this._uTagStart = uStart + TAG_HEADER_SIZE;
			this._kbTagSize = kbSize - TAG_HEADER_SIZE;
		}
	}
	// Quatre octets de sept bits chacun, le bit de poids fort toujours a zero ; -1 sinon.
	_ParseSynchsafeInteger(uAddress) {
		var nResult = -1;
		var nByte = this._mb[uAddress];
		if (nByte < 0x80) {
			var n4Bytes = nByte << 24 - 3;
			nByte = this._mb[uAddress + 1];
			if (nByte < 0x80) {
				n4Bytes |= nByte << 16 - 2;
				nByte = this._mb[uAddress + 2];
				if (nByte < 0x80) {
					n4Bytes |= nByte << 8 - 1;
					nByte = this._mb[uAddress + 3];
					if (nByte < 0x80) {
						nResult = n4Bytes | nByte;
					}
				}
			}
		}
		return nResult;
	}
	// Le texte du champ courant, s'il est en UTF-8 (codage 3) et valide.
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
	// Rend l'identifiant de chaque champ, et en fait le champ courant le temps de l'iteration.
	* [Symbol.iterator]() {
		var FIELD_HEADER_SIZE = 10;
		var uTag = this._uTagStart;
		var kbTag = this._kbTagSize;
		var IsIdCharacter = nCode => nCode >= 0x30 && nCode <= 0x39 || nCode >= 0x41 && nCode <= 0x5A;
		while (kbTag > FIELD_HEADER_SIZE) {
			var nCode1 = this._mb[uTag];
			var nCode2 = this._mb[uTag + 1];
			var nCode3 = this._mb[uTag + 2];
			var nCode4 = this._mb[uTag + 3];
			// Un identifiant de champ : quatre chiffres ou majuscules. Autre chose : fin des champs.
			if (!IsIdCharacter(nCode1) || !IsIdCharacter(nCode2) || !IsIdCharacter(nCode3) || !IsIdCharacter(nCode4)) {
				break;
			}
			// Le second octet de drapeaux du champ : chiffrement, compression... non geres.
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
	// Un champ TXXX : une description et une valeur, separees par un octet nul.
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

// ----------------------------------------------------------------------------------------------
// Une piste dans le tas

/*
	Deux zones par piste : la table des images (une structure de kbSampleStruct octets par image) et le
	flux brut. Chacune a sa borne de memoire et ses bornes de contenu. nStartDTS est l'horodatage de
	decodage de la premiere image du segment ; nContinuityCounter, le compteur de continuite attendu au
	prochain paquet de transport ; pPesPacketEnd, la fin annoncee du paquet PES en cours.
*/
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
	// Le rang d'une image dans la table, pour le journal ; NaN si l'adresse est hors de la table.
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

// ----------------------------------------------------------------------------------------------
// Le journal : accumule, puis envoye d'un bloc a la page, qui le verse dans le sien

var m_Log = (() => {
	var _msSeverity = [];
	var _msRecords = [];
	function Add(sImportance, sRecord) {
		_msSeverity.push(sImportance);
		_msRecords.push(`[Worker] ${sRecord}`);
	}
	function Here(sRecord) {
		Add('Here', sRecord);
	}
	function Wow(sRecord) {
		Add('Wow', sRecord);
	}
	function Oops(sRecord) {
		Add('Oops', sRecord);
	}
	function Send() {
		if (_msSeverity.length !== 0) {
			postMessage([ MESSAGE_LOG, _msSeverity, _msRecords ]);
			_msSeverity.length = 0;
			_msRecords.length = 0;
		}
	}
	return {
		Here,
		Wow,
		Oops,
		Send
	};
})();

// Ce que le fil renvoie a la page : m_Transcoder lit la premiere case.
var MESSAGE_SEGMENT = 1;
var MESSAGE_LOG = 2;
var MESSAGE_REPORT = 3;

{
	var TRANSPORT_PACKET_SIZE = 188;
	// Les horodatages MPEG sont en 90 000e de seconde.
	var TS_TIMESCALE = 9e4;
	// Une trame AAC porte 1024 echantillons.
	var AUDIO_SAMPLE_LENGTH = 1024;
	// Les frequences d'echantillonnage AAC, dans l'ordre de leur indice.
	var SAMPLE_RATES = [ 96e3, 88200, 64e3, 48e3, 44100, 32e3, 24e3, 22050, 16e3, 12e3, 11025, 8e3, 7350 ];
	var VIDEO_TRACK_NUMBER = 1;
	var AUDIO_TRACK_NUMBER = 2;

	// Une image audio dans la table : sa taille. Une image video : duree, taille, drapeaux, decalage de
	// composition -- exactement l'ordre des champs d'une entree de boite trun, qui les recopie tels quels.
	var AUDIO_SAMPLE_STRUCT_SIZE = 1 * 4;
	var VIDEO_SAMPLE_STRUCT_SIZE = 4 * 4;
	var VIDEO_SAMPLE_DURATION = 0;
	var VIDEO_SAMPLE_SIZE = 4;
	var VIDEO_SAMPLE_FLAGS = 8;
	var VIDEO_SAMPLE_CTO = 12;

	// En-tete d'un paquet de transport (ISO/IEC 13818-1, 2.4.3.2), lu sur 32 bits.
	var TS_SYNC_AND_ERRORS_MASK = 0xFF8000C0;   // sync_byte, transport_error_indicator, transport_scrambling_control
	var TS_SYNC_AND_NO_ERRORS = 0x47000000;     // sync_byte 0x47, sans erreur ni embrouillage
	var TS_PID_MASK = 0x1FFF00;
	var TS_PID_SHIFT = 8;
	var TS_PAYLOAD_UNIT_START = 0x400000;
	var TS_ADAPTATION_FIELD = 0x20;
	var TS_PAYLOAD = 0x10;
	var TS_CONTINUITY_COUNTER = 0x0F;
	var TS_PUSI_AND_PAYLOAD = TS_PAYLOAD_UNIT_START | TS_PAYLOAD;
	var ADAPTATION_DISCONTINUITY_INDICATOR = 0x80;

	// Le debut d'un paquet PES : le prefixe 00 00 01 et l'identifiant du flux.
	var PES_VIDEO_START_MASK = 0xFFFFFFF0;      // flux video 0xE0 a 0xEF
	var PES_VIDEO_START = 0x000001E0;
	var PES_AUDIO_START_MASK = 0xFFFFFFE0;      // flux audio 0xC0 a 0xDF
	var PES_AUDIO_START = 0x000001C0;
	var PES_PRIVATE_STREAM_1 = 0x000001BD;      // les metadonnees ID3
	var PES_DATA_ALIGNMENT_INDICATOR = 0x04;
	var PES_PTS_DTS_FLAGS = 0xC0;
	var PES_PTS_ONLY = 0x80;
	// Les deux octets de drapeaux PES, lus ensemble : marqueur '10' et PTS_DTS_flags.
	var PES_FLAGS_MASK = 0xF0C0;
	var PES_FLAGS_PTS = 0x8080;
	var PES_FLAGS_PTS_DTS = 0x80C0;

	// Types de flux dans la PMT.
	var STREAM_TYPE_H264 = 0x1B;
	var STREAM_TYPE_AAC_ADTS = 0x0F;
	var STREAM_TYPE_METADATA = 0x15;

	// Types d'unites NAL H.264 (ITU-T H.264, table 7-1).
	var NAL_SLICE = 1;
	var NAL_SLICE_PARTITION_A = 2;
	var NAL_SLICE_PARTITION_B = 3;
	var NAL_SLICE_PARTITION_C = 4;
	var NAL_IDR_SLICE = 5;
	var NAL_SEI = 6;
	var NAL_SPS = 7;
	var NAL_PPS = 8;
	var NAL_ACCESS_UNIT_DELIMITER = 9;
	var NAL_END_OF_SEQUENCE = 10;
	var NAL_END_OF_STREAM = 11;
	var NAL_FILLER = 12;
	var NAL_SPS_EXTENSION = 13;
	var NAL_TYPE_MASK = 0x1F;
	var NAL_REF_IDC_MASK = 0xE0;                // forbidden_zero_bit et nal_ref_idc

	// Les drapeaux d'une image dans trun : sample_is_non_sync_sample pour tout ce qui n'est pas cle.
	var NORMAL_FRAME_FLAGS = 0x10000;
	var KEY_FRAME_FLAGS = 0;

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

	// Ce qui fait le lien d'un segment au suivant.
	var _nLastVideoSampleDTS;
	var _nVideoSegmentEndDTS;
	var _nAudioSegmentEndDTS;
	var _nPrevVideoSegmentLastSampleDTS;
	var _nPrevVideoSegmentEndDTS;
	var _nPrevAudioSegmentEndDTS;

	// Les parametres du flux, relus a chaque discontinuite.
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

	// Ce que le segment rapporte aux statistiques de la page.
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

	/*
		Un rejet, par opposition a un Check : le segment est inutilisable, mais le flux ne l'est pas. Le
		segment est renvoye sans images et le suivant repartira sur une discontinuite. Un Check qui
		echoue, lui, arrete le fil et envoie un rapport : c'est un defaut, pas un segment abime.
	*/
	function Reject(pCondition) {
		if (!pCondition) {
			throw new Error('REJECT');
		}
	}

	// Une duree en 90 000e de seconde, ecrite en millisecondes pour le journal.
	function Ms(nTpTime, sUnits = 'ms') {
		return `${(nTpTime / (TS_TIMESCALE / 1e3)).toFixed(2)}${sUnits}`;
	}

	function SendResult(mbufTransfer) {
		postMessage([ MESSAGE_SEGMENT, _oSourceSegment ], mbufTransfer);
	}

	// Le segment en cours part avec le rapport : c'est souvent lui qui explique la panne.
	function TerminateAndSendReport(pException) {
		var sTerminationReason = pException instanceof Error ? `Exception caught in the worker thread: ${pException.stack}` : `Exception caught in the worker thread: [typeof ${typeof pException}] ${new Error(pException).stack}`;
		if (typeof _oSourceSegment == 'object' && _oSourceSegment !== null && typeof _oSourceSegment.pData == 'object' && _oSourceSegment.pData !== null && _oSourceSegment.pData.byteLength) {
			postMessage([ MESSAGE_REPORT, sTerminationReason, _oSourceSegment.pData ], [ _oSourceSegment.pData ]);
		} else {
			postMessage([ MESSAGE_REPORT, sTerminationReason, null ]);
		}
		_oSourceSegment = null;
	}

	// ------------------------------------------------------------------------------------------
	// La disposition du tas

	/*
		De bas en haut : la case de retour de l'assembleur, la table des images video (dimensionnee pour
		30 s a 150 im/s), la table audio, les metadonnees, une reserve devant le flux video, puis deux
		zones de la taille du segment : flux video et flux audio.

		La reserve devant le flux video est ce qui permet le reassemblage sur place : chaque unite NAL
		perd un prefixe de trois ou quatre octets mais gagne une longueur de quatre, et il faut de la
		marge pour que la copie vers le bas ne rattrape jamais ce qu'elle n'a pas encore lu.

		Le tas ne retrecit pas. Quand il grandit, on prend 40 % de marge sur la partie qui depend de la
		taille du segment, pour ne pas le refaire au segment suivant.
	*/
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
					m_Log.Here(`Creating heap ${kbHeapSize} bytes`);
				} else {
					m_Log.Oops(`Growing heap from ${_mbHeap.length} to ${kbHeapSize} bytes`);
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

	// ------------------------------------------------------------------------------------------
	// Le transport : trier les paquets par flux

	/*
		Le segment est copie en tete de la zone du flux video, puis parcouru paquet par paquet ; la charge
		utile de chaque paquet est recopiee a la fin de la zone de sa piste. Le flux video se recopie donc
		sur lui-meme vers le bas, ce qui est sur puisqu'on ecrit toujours derriere ce qu'on lit.

		Au passage : les tables PAT et PMT disent quel PID porte quoi ; chaque debut de paquet PES video
		ajoute une entree a la table des images (sa duree ne sera connue qu'a l'image suivante) ; les
		compteurs de continuite trahissent les paquets perdus.

		Rend false quand le segment n'a pas de quoi jouer : un flux annonce mais vide.
	*/
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
			Reject((nTransportPacketHeader & TS_SYNC_AND_ERRORS_MASK) == TS_SYNC_AND_NO_ERRORS);
			var nPid = (nTransportPacketHeader & TS_PID_MASK) >> TS_PID_SHIFT;
			var pPayload = uTransportPacket + 4;
			if ((nTransportPacketHeader & TS_ADAPTATION_FIELD) != 0) {
				var cbAdaptationField = _mbHeap[pPayload];
				Check(cbAdaptationField <= TRANSPORT_PACKET_SIZE - 5);
				Check(cbAdaptationField === 0 || (_mbHeap[pPayload + 1] & ADAPTATION_DISCONTINUITY_INDICATOR) == 0);
				pPayload += 1 + cbAdaptationField;
			}
			var trToProcess;
			switch (nPid) {
			  case nVideoPid:
				if ((nTransportPacketHeader & TS_PAYLOAD_UNIT_START) != 0) {
					Check((_dvHeap.getUint32(pPayload) & PES_VIDEO_START_MASK) == PES_VIDEO_START);
				}
				trToProcess = _trVideo;
				break;

			  case nAudioPid:
				if ((nTransportPacketHeader & TS_PAYLOAD_UNIT_START) != 0) {
					Check((_dvHeap.getUint32(pPayload) & PES_AUDIO_START_MASK) == PES_AUDIO_START);
				}
				trToProcess = _trAudio;
				break;

			  case nMetadataPid:
				if ((nTransportPacketHeader & TS_PAYLOAD_UNIT_START) != 0) {
					Check(_dvHeap.getUint32(pPayload) === PES_PRIVATE_STREAM_1);
					Check((_mbHeap[pPayload + 6] & PES_DATA_ALIGNMENT_INDICATOR) != 0);
					Check((_mbHeap[pPayload + 7] & PES_PTS_DTS_FLAGS) == PES_PTS_ONLY);
					_muMetadataStart.push(_trMetadata.uStreamEnd);
				}
				trToProcess = _trMetadata;
				break;

			  // La PAT est toujours sur le PID 0.
			  case 0:
				Check((nTransportPacketHeader & TS_PUSI_AND_PAYLOAD) == TS_PUSI_AND_PAYLOAD);
				var oPat = new ProgramAssociationTable(pPayload, uTransportPacket + TRANSPORT_PACKET_SIZE);
				if (_oPat === null) {
					_oPat = oPat;
					m_Log.Here(`PatVersion=${oPat.nPatVersion} ProgramNumber=${oPat.nProgramNumber} PmtPid=${oPat.nPmtPid}`);
				} else {
					Check(_oPat.nPatVersion === oPat.nPatVersion && _oPat.nProgramNumber === oPat.nProgramNumber && _oPat.nPmtPid === oPat.nPmtPid);
				}
				nPmtPid = oPat.nPmtPid;
				++cPat;
				continue;

			  case nPmtPid:
				Check((nTransportPacketHeader & TS_PUSI_AND_PAYLOAD) == TS_PUSI_AND_PAYLOAD);
				var oPmt = new ProgramMapTable(pPayload, uTransportPacket + TRANSPORT_PACKET_SIZE, _oPat.nProgramNumber);
				if (_oPmt === null) {
					_oPmt = oPmt;
					m_Log.Here(`PmtVersion=${oPmt.nPmtVersion} VideoPid=${oPmt.nVideoPid} AudioPid=${oPmt.nAudioPid} MetadataPid=${oPmt.nMetadataPid}`);
				} else {
					Check(_oPmt.nPmtVersion === oPmt.nPmtVersion && _oPmt.nVideoPid === oPmt.nVideoPid && _oPmt.nAudioPid === oPmt.nAudioPid && _oPmt.nMetadataPid === oPmt.nMetadataPid);
				}
				({nVideoPid, nAudioPid, nMetadataPid} = oPmt);
				++cPmt;
				continue;

			  default:
				continue;
			}

			// Un paquet perdu au milieu d'une piste rend le segment inutilisable ; en tete, ce n'est rien.
			if (trToProcess.nContinuityCounter !== (nTransportPacketHeader & TS_CONTINUITY_COUNTER) && trToProcess.nContinuityCounter !== -1) {
				m_Log.Oops(`continuity_counter is ${nTransportPacketHeader & TS_CONTINUITY_COUNTER} instead of ${trToProcess.nContinuityCounter} PID=${nPid} PacketOffset=${mbTransportStream.length - uTransportStreamEnd + uTransportPacket}`);
				Reject(trToProcess.uStreamEnd === trToProcess.uStreamStart);
			}
			trToProcess.nContinuityCounter = nTransportPacketHeader + 1 & TS_CONTINUITY_COUNTER;

			switch (nTransportPacketHeader & TS_PUSI_AND_PAYLOAD) {
			  // La suite d'un paquet PES deja commence.
			  case TS_PAYLOAD:
				Check(trToProcess.uStreamEnd !== trToProcess.uStreamStart);
				break;

			  // Le debut d'un paquet PES : sa taille, son en-tete, ses horodatages.
			  case TS_PUSI_AND_PAYLOAD:
				var cbPesPacket = _dvHeap.getUint16(pPayload + 4);
				var cbPesHeader = _mbHeap[pPayload + 8];
				Check(trToProcess.pPesPacketEnd === trToProcess.uStreamEnd || trToProcess.pPesPacketEnd === -1);
				if (cbPesPacket !== 0) {
					trToProcess.pPesPacketEnd = trToProcess.uStreamEnd + cbPesPacket - 3 - cbPesHeader;
				} else {
					// Une taille nulle n'est permise que pour la video.
					Check(nPid === nVideoPid);
					trToProcess.pPesPacketEnd = -1;
				}
				if (nPid === nVideoPid || trToProcess.nStartDTS === -1) {
					var nPts, nDts;
					switch (_dvHeap.getUint16(pPayload + 6) & PES_FLAGS_MASK) {
					  case PES_FLAGS_PTS:
						Check(cbPesHeader >= 5);
						nPts = DecodeTimestamp(pPayload + 9, 0x21);
						nDts = nPts;
						break;

					  case PES_FLAGS_PTS_DTS:
						Check(cbPesHeader >= 10);
						nPts = DecodeTimestamp(pPayload + 9, 0x31);
						nDts = DecodeTimestamp(pPayload + 14, 0x11);
						break;

					  default:
						Check(false);
					}
					if (trToProcess.nStartDTS === -1) {
						trToProcess.nStartDTS = nDts;
					}
					if (nPid === nVideoPid) {
						AddVideoSample(pPayload, cbPesPacket, nPts, nDts);
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
			m_Log.Oops(`Number of tables in segment: PAT=${cPat} PMT=${cPmt}`);
		}
		if (kDTSChanges !== 0) {
			m_Log.Oops(`Number of video samples with increased DTS: ${kDTSChanges}`);
		}
		Check(nVideoPid !== -1 || nAudioPid !== -1);
		_bVideoLoss = nVideoPid !== -1 && _trVideo.Empty();
		_bAudioLoss = nAudioPid !== -1 && _trAudio.Empty();
		if (_bVideoLoss || _bAudioLoss) {
			m_Log.Oops(`Segment unfit for playback: no video ${_bVideoLoss}, no audio ${_bAudioLoss}`);
			return false;
		}

		var sImportance = _muMetadataStart.length > 1 ? 'Oops' : 'Here';
		var sRecord = `Metadata=${_muMetadataStart.length}`;
		if (!_trVideo.Empty()) {
			// La derniere image recoit la fin du flux comme fin ; sa duree sera estimee plus tard.
			_dvHeap.setUint32(_trVideo.uSamplesEnd + VIDEO_SAMPLE_SIZE - VIDEO_SAMPLE_STRUCT_SIZE, _trVideo.uStreamEnd);
			var kVideoSamples = _trVideo.GetSampleCount();
			_nAvgVideoSampleDuration = (_nLastVideoSampleDTS - _trVideo.nStartDTS) / (kVideoSamples - 1);
			if (kVideoSamples < 25) {
				sImportance = 'Oops';
			}
			sRecord += ` FirstVidSampleDTS=${(_trVideo.nStartDTS / TS_TIMESCALE).toFixed(5)}` + ` LastVidSampleDTS=${(_nLastVideoSampleDTS / TS_TIMESCALE).toFixed(5)}` + ` VidSegmentDur>${Ms(_nLastVideoSampleDTS - _trVideo.nStartDTS)} VidSamples=${kVideoSamples}` + ` VidSampleDur=${Ms(_nMinVideoSampleDuration, '')}<${Ms(_nAvgVideoSampleDuration, '')}<${Ms(_nMaxVideoSampleDuration)}` + `(${(TS_TIMESCALE / _nMinVideoSampleDuration).toFixed(2)}` + `<${(TS_TIMESCALE / _nAvgVideoSampleDuration).toFixed(2)}` + `<${(TS_TIMESCALE / _nMaxVideoSampleDuration).toFixed(2)}fps)`;
		}
		if (!_trAudio.Empty()) {
			sRecord += ` FirstAudSampleDTS=${(_trAudio.nStartDTS / TS_TIMESCALE).toFixed(5)}`;
		}
		if (!_trVideo.Empty() && !_trAudio.Empty()) {
			// Plus de 100 ms de son en avance, ou 200 ms en retard, se voit sur les levres.
			var nAudioOffset = _trAudio.nStartDTS - _trVideo.nStartDTS;
			if (nAudioOffset < -TS_TIMESCALE * .1 || nAudioOffset > TS_TIMESCALE * .2) {
				sImportance = 'Oops';
			}
			sRecord += ` AudSegmentStartOffset=${Ms(_trAudio.nStartDTS - _trVideo.nStartDTS)}`;
		}
		m_Log[sImportance](sRecord);
		_nEncodingPosition = (_trAudio.nStartDTS !== -1 ? _trAudio.nStartDTS : _trVideo.nStartDTS) / TS_TIMESCALE;
		return true;

		/*
			Une nouvelle image video commence -- sauf si le paquet PES porte le meme DTS que la
			precedente, ce qui n'est permis que sans alignement annonce : c'est alors la suite de la
			meme image, coupee en deux paquets. La duree de l'image precedente est l'ecart de DTS, et
			sa taille commence a la position actuelle du flux (elle sera convertie en taille plus tard).

			Un DTS qui recule de moins de dix unites est une erreur d'arrondi de l'encodeur : on
			l'avance d'une unite et on le note. Au-dela, le segment est rejete.
		*/
		function AddVideoSample(pPayload, cbPesPacket, nPts, nDts) {
			if (nDts === _nLastVideoSampleDTS && cbPesPacket !== 0) {
				Check((_mbHeap[pPayload + 6] & PES_DATA_ALIGNMENT_INDICATOR) == 0);
				return;
			}
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
	}

	/*
		Un horodatage PES sur 33 bits, reparti sur cinq octets avec des bits marqueurs. nMarkerBits : les
		quatre bits de tete attendus (0010 pour un PTS seul, 0011 pour un PTS suivi d'un DTS, 0001 pour
		le DTS) et le bit marqueur du premier octet.
	*/
	function DecodeTimestamp(uAddress, nMarkerBits) {
		var n1 = _mbHeap[uAddress] | 0;
		var n2 = _dvHeap.getUint32(uAddress + 1) | 0;
		Check((n1 & 0xF1) == (nMarkerBits | 0) && (n2 & 0x10001) == 0x10001);
		return +((n1 & 0x0E) * (1 << 29) + (n2 >> 2 & 0x3FFF8000 | n2 >> 1 & 0x7FFF));
	}

	// La PAT : le seul programme du flux, et le PID de sa PMT.
	function ProgramAssociationTable(uStart, uEnd) {
		Check(uStart < uEnd);
		uStart += 1 + _mbHeap[uStart];
		Check(uEnd - uStart >= 16);
		// table_id 0, puis section_syntax_indicator, '0', et une longueur de section de 13 octets.
		Check(_mbHeap[uStart] === 0);
		Check((_dvHeap.getUint16(uStart + 1) & 0xCFFF) == 0x800D);
		Check((_mbHeap[uStart + 5] & 1) == 1);
		var nPatVersion = _mbHeap[uStart + 5] & 0x3E;
		Check(_mbHeap[uStart + 6] === 0);
		Check(_mbHeap[uStart + 7] === 0);
		var nProgramNumber = _dvHeap.getUint16(uStart + 8);
		Check(nProgramNumber !== 0);
		var nPmtPid = _dvHeap.getUint16(uStart + 10) & 0x1FFF;
		Check(nPmtPid >= 0x10 && nPmtPid <= 0x1FFE);
		this.nPatVersion = nPatVersion;
		this.nProgramNumber = nProgramNumber;
		this.nPmtPid = nPmtPid;
	}

	/*
		La PMT : quel PID porte la video H.264, le son AAC, et les metadonnees ID3. Ces dernieres se
		reconnaissent a leur descripteur de metadonnees (format « ID3 » deux fois, application 0xFFFF).
		Un second flux du meme type est signale et ignore.
	*/
	function ProgramMapTable(uStart, uEnd, nProgramNumber) {
		Check(uStart < uEnd);
		uStart += 1 + _mbHeap[uStart];
		Check(uEnd - uStart >= 12);
		Check(_mbHeap[uStart] === 2);
		var uSectionEnd = _dvHeap.getUint16(uStart + 1);
		Check((uSectionEnd & 0xC000) == 0x8000);
		// La longueur de section compte le CRC final, qu'on ne lit pas.
		uSectionEnd = uStart + 3 + (uSectionEnd & 0x0FFF) - 4;
		Check(uSectionEnd >= uStart + 12 && uSectionEnd + 4 <= uEnd);
		Check(_dvHeap.getUint16(uStart + 3) === nProgramNumber);
		Check((_mbHeap[uStart + 5] & 1) == 1);
		var nPmtVersion = _mbHeap[uStart + 5] & 0x3E;
		Check(_mbHeap[uStart + 6] === 0);
		Check(_mbHeap[uStart + 7] === 0);
		uStart += 12 + (_dvHeap.getUint16(uStart + 10) & 0x0FFF);
		var nVideoPid = -1, nAudioPid = -1, nMetadataPid = -1;
		while (uStart !== uSectionEnd) {
			var pDescriptor = uStart + 5;
			Check(pDescriptor <= uSectionEnd);
			var nElementaryPid = _dvHeap.getUint16(uStart + 1) & 0x1FFF;
			Check(nElementaryPid >= 0x10 && nElementaryPid <= 0x1FFE);
			var nEsInfoLength = _dvHeap.getUint16(uStart + 3) & 0x0FFF;
			Check(pDescriptor + nEsInfoLength <= uSectionEnd);
			switch (_mbHeap[uStart]) {
			  case STREAM_TYPE_H264:
				if (nVideoPid === -1) {
					nVideoPid = nElementaryPid;
				} else {
					m_Log.Oops(`Found an additional video stream PID=${nElementaryPid}`);
				}
				break;

			  case STREAM_TYPE_AAC_ADTS:
				if (nAudioPid === -1) {
					nAudioPid = nElementaryPid;
				} else {
					m_Log.Oops(`Found an additional audio stream PID=${nElementaryPid}`);
				}
				break;

			  case STREAM_TYPE_METADATA:
				if (nEsInfoLength === 15 && IsId3MetadataDescriptor(pDescriptor)) {
					if (nMetadataPid === -1) {
						nMetadataPid = nElementaryPid;
					} else {
						m_Log.Oops(`Found an additional metadata stream PID=${nElementaryPid} metadata_service_id=${_mbHeap[pDescriptor + 13]}`);
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

	// metadata_descriptor (0x26), 13 octets : application 0xFFFF « ID3 », format 0xFF « ID3 ».
	function IsId3MetadataDescriptor(pDescriptor) {
		var mnExpected = [ 0x26, 13, 0xFF, 0xFF, 0x49, 0x44, 0x33, 0x20, 0xFF, 0x49, 0x44, 0x33, 0x20 ];
		for (var idx = 0; idx < mnExpected.length; ++idx) {
			if (_mbHeap[pDescriptor + idx] !== mnExpected[idx]) {
				return false;
			}
		}
		return true;
	}

	// ------------------------------------------------------------------------------------------
	// Les metadonnees : l'heure d'encodage et la position dans la diffusion

	/*
		Twitch met dans chaque segment un champ TXXX « segmentmetadata » en JSON. transc_r est l'heure
		d'encodage en millisecondes (bornee entre 2015 et 2028 pour ecarter une valeur absurde),
		stream_offset la position dans la diffusion. Seul le premier champ de ce nom compte.
	*/
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

	// ------------------------------------------------------------------------------------------
	// La video : d'Annex B a des unites NAL precedees de leur longueur

	/*
		Le flux video est parcouru d'un prefixe de debut au suivant. Chaque unite NAL utile est recopiee
		vers le bas, precedee de sa taille sur quatre octets ; les parametres de sequence et d'image, les
		delimiteurs et le remplissage sont retires du flux -- les premiers partent dans l'en-tete
		d'initialisation. En meme temps, la table des images recoit la taille reelle de chaque image et
		ses drapeaux : cle si elle contient une tranche IDR.

		A une discontinuite, il faut une image cle et les deux jeux de parametres, sinon le decodeur ne
		saurait pas par ou commencer : le segment est alors juge injouable.
	*/
	function ParseVideoStream() {
		if (_bDiscontinuity) {
			_abSequenceParameterSet = null;
			_abPictureParameterSet = null;
			_abSequenceParameterSetExt = null;
		}
		if (_trVideo.Empty()) {
			return true;
		}
		Check(_trVideo.uStreamStart > _trVideo.uStreamMemoryStart && _trVideo.uStreamEnd > _trVideo.uStreamStart && _trVideo.uSamplesEnd > _trVideo.uSamplesStart);
		var uParsedStream = _trVideo.uStreamMemoryStart;
		var uFirstKeyFrameSample = -1;
		var cNalUnits = 0, cAccessUnits = 0, kSamplesWithoutVCL = 0, kKeyFrames = 0, uLastKeyFrameSample = -1;
		var uSample = _trVideo.uSamplesStart;
		var uNextSampleStart = -1;
		var uParsedSampleStart;
		var nSampleFlags;
		// Le flux doit commencer par un prefixe, et la fonction assembleur rend sa longueur dans la
		// premiere case du tas.
		var pNalUnitEnd = _fFindPrefix(_trVideo.uStreamStart, _trVideo.uStreamEnd);
		Check(pNalUnitEnd === _trVideo.uStreamStart);
		Check(_mcHeap[0] > 3);
		for (;;) {
			var kbPrefixSize = pNalUnitEnd === _trVideo.uStreamEnd ? 0 : _mcHeap[0];
			// L'image suivante commence-t-elle a ce prefixe ? La table donne sa position dans le flux.
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
			var nNalRefIdc = _mbHeap[pNalUnitBegin] & NAL_REF_IDC_MASK;
			Reject(nNalRefIdc < 0x80);
			switch (_mbHeap[pNalUnitBegin] & NAL_TYPE_MASK) {
			  case NAL_SLICE:
			  case NAL_SLICE_PARTITION_A:
			  case NAL_SLICE_PARTITION_B:
			  case NAL_SLICE_PARTITION_C:
				Check(nSampleFlags !== KEY_FRAME_FLAGS);
				nSampleFlags = NORMAL_FRAME_FLAGS;
				break;

			  case NAL_IDR_SLICE:
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

			  case NAL_SEI:
				Check(nNalRefIdc === 0);
				break;

			  // Les parametres : gardes a une discontinuite (ceux de la premiere image cle), retires du flux.
			  case NAL_SPS:
				Check(nNalRefIdc !== 0);
				if (_bDiscontinuity && (uFirstKeyFrameSample === -1 || _abSequenceParameterSet === null)) {
					_abSequenceParameterSet = _mbHeap.slice(pNalUnitBegin, pNalUnitEnd);
				}
				continue;

			  case NAL_PPS:
				Check(nNalRefIdc !== 0);
				if (_bDiscontinuity && (uFirstKeyFrameSample === -1 || _abPictureParameterSet === null)) {
					_abPictureParameterSet = _mbHeap.slice(pNalUnitBegin, pNalUnitEnd);
				}
				continue;

			  case NAL_ACCESS_UNIT_DELIMITER:
				Check(nNalRefIdc === 0);
				++cAccessUnits;
				continue;

			  case NAL_END_OF_SEQUENCE:
				Check(nNalRefIdc === 0);
				continue;

			  case NAL_END_OF_STREAM:
				Check(nNalRefIdc === 0);
				Check(false);
				continue;

			  case NAL_FILLER:
				Check(nNalRefIdc === 0);
				continue;

			  // Jamais vu chez Twitch : le Check(false) le signalerait avant qu'on le garde.
			  case NAL_SPS_EXTENSION:
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
		m_Log.Here('NalUnits=' + cNalUnits + ' KeyFrames=' + kKeyFrames + ' FirstKeyFrame=' + _trVideo.GetSampleNumber(uFirstKeyFrameSample) + ' LastKeyFrame=' + _trVideo.GetSampleNumber(uLastKeyFrameSample));
		if (kSamplesWithoutVCL !== 0) {
			m_Log.Oops(`Video samples without a VCL NAL unit: ${kSamplesWithoutVCL}`);
		}
		if (cAccessUnits > 1) {
			m_Log.Oops('Several access units in one video sample');
		}
		if (_bDiscontinuity) {
			if (uFirstKeyFrameSample === -1 || _abSequenceParameterSet === null || _abPictureParameterSet === null) {
				m_Log.Oops(`Segment unfit for playback: no IDR found ${uFirstKeyFrameSample === -1}, no SPS found ${_abSequenceParameterSet === null}, no PPS found ${_abPictureParameterSet === null}`);
				return false;
			}
			// Sur une copie : les octets anti-emulation sont retires sur place, et l'original part tel
			// quel dans l'en-tete d'initialisation.
			var mbCopy = _abSequenceParameterSet.slice();
			var o = RemoveEmulationPreventionBytesFromNalUnit(mbCopy, 0, mbCopy.length);
			ParseSequenceParameterSet(mbCopy, o.uRBSPStart, o.uRBSPEnd);
		}
		return true;
	}

	/*
		Les parametres de sequence H.264 (7.3.2.1) : profil, niveau, format de chrominance, nombre
		d'images de reference, dimensions apres rognage, plage de couleurs et cadence annoncee. Le reste
		est lu pour etre saute. Une cadence negative est une cadence non fixe.
	*/
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
		var i, ic;
		switch (_nProfileIndication) {
		  case 183:
			_nChromaFormatIndication = 0;
			break;

		  // Les profils qui portent le format de chrominance, la profondeur et les matrices d'echelle.
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
				for (i = 0, ic = _nChromaFormatIndication !== 3 ? 8 : 12; i < ic; ++i) {
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
		// Les informations d'utilisabilite video (Annexe E), si presentes.
		if (oBitStream.ReadBits(1) !== 0) {
			var nAspectRatioIndication;
			if (oBitStream.ReadBits(1) !== 0) {
				nAspectRatioIndication = oBitStream.ReadBits(8);
				// Extended_SAR : largeur et hauteur de pixel explicites.
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

	/*
		Retire sur place les octets anti-emulation : dans une unite NAL, 00 00 03 xx se lit 00 00 xx.
		Rend les bornes de la charge utile brute (RBSP), apres l'en-tete de l'unite. Les types 14, 20 et
		21 ont un en-tete etendu a sauter.
	*/
	function RemoveEmulationPreventionBytesFromNalUnit(mbStream, uStart, uEnd) {
		Check(uStart < uEnd);
		var nNalUnitType = mbStream[uStart++] & NAL_TYPE_MASK;
		if (nNalUnitType === 14 || nNalUnitType === 20 || nNalUnitType === 21) {
			Check(uStart < uEnd);
			uStart += nNalUnitType === 21 && (mbStream[uStart] & 0x80) != 0 ? 2 : 3;
			Check(uStart <= uEnd);
		}
		var uRBSPStart = uStart;
		var uEnd2 = uEnd - 2;
		while (uStart < uEnd2) {
			if (mbStream[uStart++] === 0 && mbStream[uStart++] === 0) {
				var nThirdByte = mbStream[uStart++];
				Check(nThirdByte >= 3);
				if (nThirdByte === 3) {
					// Le premier octet anti-emulation : a partir d'ici, on recopie en le sautant.
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
					var nLastByte;
					while (uStart !== uEnd) {
						nLastByte = mbStream[uDecodedStream++] = mbStream[uStart++];
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

	// ------------------------------------------------------------------------------------------
	// Le son : retirer les en-tetes ADTS

	/*
		Chaque trame AAC arrive avec un en-tete ADTS de sept octets (MPEG-4, sans CRC). On le retire, on
		recopie la trame vers le bas, et la table des images recoit sa taille. La duree d'une trame est
		fixe -- 1024 echantillons -- donc la fin du son se calcule, elle ne se lit pas.
	*/
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
			// syncword 0xFFF, MPEG-4, couche 0, sans CRC.
			Check(_mbHeap[pAdtsFrame] === 0xFF && _mbHeap[pAdtsFrame + 1] === 0xF1);
			// Une seule trame de donnees brutes par trame ADTS.
			Check((_mbHeap[pAdtsFrame + 6] & 3) == 0);
			var cbAdtsFrame = _dvHeap.getUint32(pAdtsFrame + 3) >> 13 & 0x1FFF;
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
		m_Log.Here(`AudSegmentEndDTS=${(_nAudioSegmentEndDTS / TS_TIMESCALE).toFixed(5)}` + ` AudSegmentDur=${(nAudioSegmentDuration * 1e3).toFixed(2)}ms` + ` AudSampleDur=${(nAudioSampleDuration * 1e3).toFixed(2)}ms`);
		return true;
	}

	/*
		La partie fixe de l'en-tete ADTS, lue a chaque discontinuite : profil, frequence et canaux. Elle
		donne aussi les deux octets AudioSpecificConfig de l'en-tete d'initialisation : 5 bits de type
		d'objet, 4 bits d'indice de frequence, 4 bits de configuration des canaux.
	*/
	function ParseAdtsFixedHeader(nAdtsFixedHeader) {
		Check((nAdtsFixedHeader & 0xFFFF0000) == (0xFFF10000 | 0));
		_nAudioObjectType = (nAdtsFixedHeader >> 14 & 3) + 1;
		// AAC-LC.
		Check(_nAudioObjectType === 2);
		_anDecoderSpecificInfo[0] = _nAudioObjectType << 3;
		var nSampleRateIndex = nAdtsFixedHeader >> 10 & 0x0F;
		_nSampleRate = SAMPLE_RATES[nSampleRateIndex];
		Check(_nSampleRate !== void 0);
		_anDecoderSpecificInfo[0] |= nSampleRateIndex >> 1;
		_anDecoderSpecificInfo[1] = nSampleRateIndex << 7 & 0x80;
		_nChannelCount = nAdtsFixedHeader >> 6 & 7;
		Check(_nChannelCount !== 0);
		_anDecoderSpecificInfo[1] |= _nChannelCount << 3;
		m_Log[_nAudioObjectType !== 2 || _nSampleRate < 44100 || _nChannelCount > 2 ? 'Oops' : 'Here'](`AudioObjectType=${_nAudioObjectType} SampleRate=${_nSampleRate} ChannelCount=${_nChannelCount}`);
	}

	// ------------------------------------------------------------------------------------------
	// L'en-tete d'initialisation : ftyp et moov

	// Le type MIME du SourceBuffer : avc1.PPCCLL (profil, contraintes, niveau en hexadecimal), mp4a.40.T.
	function GetCodecNames() {
		var Hex2 = n => `0${n.toString(16)}`.slice(-2).toUpperCase();
		var sCodecs = 'video/mp4;codecs="';
		if (!_trVideo.Empty()) {
			sCodecs += `avc1.${Hex2(_nProfileIndication)}${Hex2(_nConstraintSetFlag)}${Hex2(_nLevelIndication)}`;
		}
		if (!_trVideo.Empty() && !_trAudio.Empty()) {
			sCodecs += ',';
		}
		if (!_trAudio.Empty()) {
			sCodecs += `mp4a.40.${_nAudioObjectType}`;
		}
		return sCodecs + '"';
	}

	/*
		Un moov sans echantillons : les tables sont vides et chaque fragment porte les siens. Les durees
		sont « inconnues » (tout a 0xFF) puisqu'il s'agit d'un direct.
	*/
	function CreateInitSegment() {
		var kbSize = 1100 + (_abSequenceParameterSet === null ? 0 : _abSequenceParameterSet.length) + (_abPictureParameterSet === null ? 0 : _abPictureParameterSet.length) + (_abSequenceParameterSetExt === null ? 0 : _abSequenceParameterSetExt.length) + (_trAudio.Empty() ? 0 : _anDecoderSpecificInfo.length);
		var mbSegment = new Uint8Array(kbSize);
		var dvSegment = CreateDataView(mbSegment);
		var oSegment = new IsoBaseMedia(mbSegment, dvSegment, 0);
		// Marque majeure « iso6 », version 0, compatible « avc1 ».
		oSegment.AddBox('ftyp', [].concat(FourCC('iso6'), [ 0, 0, 0, 0 ], FourCC('avc1')));
		oSegment.AddBox('moov', () => {
			oSegment.AddFullBox('mvhd', 1, 0, [].concat(
				[ 0, 0, 0, 0, 0, 0, 0, 0 ],                      // creation_time
				[ 0, 0, 0, 0, 0, 0, 0, 0 ],                      // modification_time
				[ 0, 0, 0, 1 ],                                  // timescale
				[ 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF ],  // duration : inconnue
				[ 0x00, 0x01, 0x00, 0x00 ],                      // rate 1.0
				[ 0x01, 0x00 ],                                  // volume 1.0
				[ 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 ],                // reserve
				[ 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,            // matrice identite
					0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0,
					0, 0, 0, 0, 0, 0, 0, 0, 0x40, 0, 0, 0 ],
				new Array(24).fill(0),                           // pre_defined
				[ 0xFF, 0xFF, 0xFF, 0xFF ]                       // next_track_ID
			));
			// Les valeurs par defaut des fragments : description d'echantillon 1, et pour le son la duree
			// fixe d'une trame.
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

	// Une piste : tkhd, mdia (mdhd, hdlr, minf avec la description de l'echantillon).
	function AddTrackToInitSegment(bVideo, oSegment) {
		var mb = oSegment.mbBuffer;
		var dv = oSegment.dvBuffer;
		oSegment.AddBox('trak', () => {
			// Piste active et presente dans la presentation. Les positions sont comptees depuis la fin.
			oSegment.AddFullBox('tkhd', 0, 3, 80);
			mb.set([ 0xFF, 0xFF, 0xFF, 0xFF ], oSegment.uEnd - 64);   // duration : inconnue
			mb[oSegment.uEnd - 43] = 1;                               // matrice identite : a
			mb[oSegment.uEnd - 27] = 1;                               // d
			mb[oSegment.uEnd - 12] = 0x40;                            // w
			if (bVideo) {
				dv.setUint32(oSegment.uEnd - 72, VIDEO_TRACK_NUMBER);
				dv.setUint16(oSegment.uEnd - 8, _nPictureWidth);
				dv.setUint16(oSegment.uEnd - 4, _nPictureHeight);
			} else {
				dv.setUint32(oSegment.uEnd - 72, AUDIO_TRACK_NUMBER);
				dv.setUint16(oSegment.uEnd - 48, 0x0100);             // volume 1.0
			}
			oSegment.AddBox('mdia', () => {
				oSegment.AddFullBox('mdhd', 0, 0, 20);
				dv.setUint32(oSegment.uEnd - 12, bVideo ? TS_TIMESCALE : _nSampleRate);
				mb.set([ 0xFF, 0xFF, 0xFF, 0xFF ], oSegment.uEnd - 8);    // duration : inconnue
				mb.set([ 0x55, 0xC4 ], oSegment.uEnd - 4);                // langue « und »
				oSegment.AddFullBox('hdlr', 0, 0, 21);
				mb.set(FourCC(bVideo ? 'vide' : 'soun'), oSegment.uEnd - 17);
				oSegment.AddBox('minf', () => {
					if (bVideo) {
						oSegment.AddFullBox('vmhd', 0, 1, 8);
					} else {
						oSegment.AddFullBox('smhd', 0, 0, 4);
					}
					// Les donnees sont dans le fichier meme : une entree « url  » autonome.
					oSegment.AddBox('dinf', () => {
						oSegment.AddFullBox('dref', 0, 0, () => {
							dv.setUint32(oSegment.uEnd, 1);
							oSegment.uEnd += 4;
							oSegment.AddFullBox('url ', 0, 1, 0);
						});
					});
					oSegment.AddBox('stbl', () => {
						oSegment.AddFullBox('stsd', 0, 0, () => {
							dv.setUint32(oSegment.uEnd, 1);
							oSegment.uEnd += 4;
							if (bVideo) {
								AddAvc1SampleEntry(oSegment);
							} else {
								AddMp4aSampleEntry(oSegment);
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

	function AddAvc1SampleEntry(oSegment) {
		var mb = oSegment.mbBuffer;
		var dv = oSegment.dvBuffer;
		oSegment.AddBox('avc1', () => {
			dv.setUint16(oSegment.uEnd + 6, 1);                   // data_reference_index
			dv.setUint16(oSegment.uEnd + 24, _nPictureWidth);
			dv.setUint16(oSegment.uEnd + 26, _nPictureHeight);
			dv.setUint32(oSegment.uEnd + 28, 0x00480000);         // 72 dpi horizontalement
			dv.setUint32(oSegment.uEnd + 32, 0x00480000);         // et verticalement
			dv.setUint16(oSegment.uEnd + 40, 1);                  // frame_count
			dv.setUint16(oSegment.uEnd + 74, 0x0018);             // depth
			dv.setUint16(oSegment.uEnd + 76, 0xFFFF);             // pre_defined
			oSegment.uEnd += 78;
			// AVCDecoderConfigurationRecord (ISO/IEC 14496-15, 5.2.4.1).
			oSegment.AddBox('avcC', () => {
				mb[oSegment.uEnd] = 1;                            // configurationVersion
				mb[oSegment.uEnd + 1] = _nProfileIndication;
				mb[oSegment.uEnd + 2] = _nConstraintSetFlag;
				mb[oSegment.uEnd + 3] = _nLevelIndication;
				mb[oSegment.uEnd + 4] = 0xFF;                     // longueurs NAL sur 4 octets
				mb[oSegment.uEnd + 5] = 0xE1;                     // un jeu de parametres de sequence
				dv.setUint16(oSegment.uEnd + 6, _abSequenceParameterSet.length);
				oSegment.CopyFromBuffer(oSegment.uEnd + 8, _abSequenceParameterSet);
				mb[oSegment.uEnd] = 1;                            // un jeu de parametres d'image
				dv.setUint16(oSegment.uEnd + 1, _abPictureParameterSet.length);
				oSegment.CopyFromBuffer(oSegment.uEnd + 3, _abPictureParameterSet);
				// Les profils eleves ajoutent chrominance, profondeurs et extensions de sequence.
				switch (_nProfileIndication) {
				  case 100:
				  case 110:
				  case 122:
				  case 144:
					mb[oSegment.uEnd] = 0xFC | _nChromaFormatIndication;
					mb[oSegment.uEnd + 1] = 0xF8 | _nBitDepthLumaMinus8;
					mb[oSegment.uEnd + 2] = 0xF8 | _nBitDepthChromaMinus8;
					if (_abSequenceParameterSetExt === null) {
						oSegment.uEnd += 4;
					} else {
						mb[oSegment.uEnd + 3] = 1;
						dv.setUint16(oSegment.uEnd + 4, _abSequenceParameterSetExt.length);
						oSegment.CopyFromBuffer(oSegment.uEnd + 6, _abSequenceParameterSetExt);
					}
				}
			});
		});
	}

	function AddMp4aSampleEntry(oSegment) {
		var mb = oSegment.mbBuffer;
		var dv = oSegment.dvBuffer;
		oSegment.AddBox('mp4a', () => {
			dv.setUint16(oSegment.uEnd + 6, 1);                   // data_reference_index
			dv.setUint16(oSegment.uEnd + 16, _nChannelCount === 1 ? 1 : 2);
			dv.setUint16(oSegment.uEnd + 18, 16);                 // samplesize
			dv.setUint32(oSegment.uEnd + 24, _nSampleRate << 16); // samplerate en 16.16
			oSegment.uEnd += 28;
			// Les descripteurs MPEG-4 (ISO/IEC 14496-1) : ES, configuration du decodeur, config AAC, SL.
			oSegment.AddFullBox('esds', 0, 0, () => {
				mb[oSegment.uEnd] = 0x03;                         // ES_DescrTag
				mb[oSegment.uEnd + 1] = 23 + _anDecoderSpecificInfo.length;
				dv.setUint16(oSegment.uEnd + 2, 1);               // ES_ID
				mb[oSegment.uEnd + 5] = 0x04;                     // DecoderConfigDescrTag
				mb[oSegment.uEnd + 6] = 15 + _anDecoderSpecificInfo.length;
				mb[oSegment.uEnd + 7] = 0x40;                     // objectTypeIndication : audio MPEG-4
				mb[oSegment.uEnd + 8] = 0x15;                     // streamType audio, reserve a 1
				mb[oSegment.uEnd + 20] = 0x05;                    // DecSpecificInfoTag
				mb[oSegment.uEnd + 21] = _anDecoderSpecificInfo.length;
				oSegment.CopyFromArray(oSegment.uEnd + 22, _anDecoderSpecificInfo);
				mb[oSegment.uEnd] = 0x06;                         // SLConfigDescrTag
				mb[oSegment.uEnd + 1] = 1;
				mb[oSegment.uEnd + 2] = 2;                        // predefined : MP4
				oSegment.uEnd += 3;
			});
		});
	}

	// ------------------------------------------------------------------------------------------
	// Le fragment : moof et mdat

	/*
		Ecrit dans le tampon meme du segment de transport, qui est plus grand que le fragment ne le sera
		jamais. La table des images de chaque piste est recopiee telle quelle dans sa boite trun -- c'est
		pour ca que ses champs sont dans cet ordre --, puis les flux dans mdat. Le decalage des donnees
		de chaque piste, relatif au debut du moof, n'est connu qu'en ecrivant mdat : on revient le poser.
	*/
	function CreateMediaSegment(mbMediaSegment) {
		// tfhd : default-base-is-moof. trun video : data-offset, duree, taille, drapeaux, decalage de
		// composition par image. trun audio : data-offset et taille seulement.
		var TFHD_DEFAULT_BASE_IS_MOOF = 0x20000;
		var TRUN_VIDEO_FLAGS = 0xF01;
		var TRUN_AUDIO_FLAGS = 0x201;
		var dvMediaSegment = CreateDataView(mbMediaSegment);
		var oSegment = new IsoBaseMedia(mbMediaSegment, dvMediaSegment, 0);
		var uVideoDataOffset, uAudioDataOffset;
		oSegment.AddBox('moof', () => {
			oSegment.AddFullBox('mfhd', 0, 0, 4);
			dvMediaSegment.setUint32(oSegment.uEnd - 4, 0);
			if (!_trVideo.Empty()) {
				oSegment.AddBox('traf', () => {
					oSegment.AddFullBox('tfhd', 0, TFHD_DEFAULT_BASE_IS_MOOF, 4);
					dvMediaSegment.setUint32(oSegment.uEnd - 4, VIDEO_TRACK_NUMBER);
					oSegment.AddFullBox('tfdt', 1, 0, 8);
					SetUint64(mbMediaSegment, oSegment.uEnd - 8, _trVideo.nStartDTS);
					oSegment.AddFullBox('trun', 1, TRUN_VIDEO_FLAGS, () => {
						dvMediaSegment.setUint32(oSegment.uEnd, _trVideo.GetSampleCount());
						uVideoDataOffset = oSegment.uEnd + 4;
						oSegment.CopyFromBuffer(oSegment.uEnd + 8, _mbHeap, _trVideo.uSamplesStart, _trVideo.uSamplesEnd);
					});
				});
			}
			if (!_trAudio.Empty()) {
				oSegment.AddBox('traf', () => {
					oSegment.AddFullBox('tfhd', 0, TFHD_DEFAULT_BASE_IS_MOOF, 4);
					dvMediaSegment.setUint32(oSegment.uEnd - 4, AUDIO_TRACK_NUMBER);
					oSegment.AddFullBox('tfdt', 1, 0, 8);
					// Le temps du son est dans l'echelle de sa frequence d'echantillonnage.
					SetUint64(mbMediaSegment, oSegment.uEnd - 8, Math.round(_trAudio.nStartDTS / TS_TIMESCALE * _nSampleRate));
					oSegment.AddFullBox('trun', 1, TRUN_AUDIO_FLAGS, () => {
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

	/*
		Le segment repart vers la page. Converti, il porte le fragment -- et, a une discontinuite, l'en-tete
		d'initialisation, les codecs et les parametres que les statistiques affichent. Sinon, seulement ce
		qu'on a pu mesurer. Les tampons partent par transfert.
	*/
	function SendConvertedSegment(mbMediaSegment) {
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
		if (mbMediaSegment) {
			oData.mbMediaSegment = CreateMediaSegment(mbMediaSegment);
			oData.bHasVideo = !_trVideo.Empty();
			oData.bHasAudio = !_trAudio.Empty();
			mbufTransfer = [ oData.mbMediaSegment.buffer ];
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
			m_Log.Here(`Sending segment Discontinuity=${_bDiscontinuity} Size=${(oData.mbMediaSegment.length / 1024 / 1024).toFixed(2)}MB`);
		}
		_oSourceSegment.pData = oData;
		m_Log.Send();
		SendResult(mbufTransfer);
	}

	// ------------------------------------------------------------------------------------------
	// Recoller un segment au precedent

	/*
		Hors discontinuite, le segment doit prendre la suite exacte du precedent. Une video qui recommence
		sur une image deja vue, ou un son qui recule de plus de 100 ms, ne se recollent pas : on declare
		une discontinuite. Un petit ecart est seulement note ; un trou de plus de 10 ms de video ou 100 ms
		de son est signale comme une perte aux statistiques.
	*/
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
			m_Log.Oops(`Discontinuity added: VideoDTSDeviation=${Ms(nVideoDTSDeviation)} VideoDTSOverlap=${Ms(nVideoDTSOverlap)} AudioDTSDeviation=${nAudioDTSDeviation}`);
			_bDiscontinuity = true;
			return;
		}
		if (Math.abs(nVideoDTSDeviation) > TS_TIMESCALE * .002 || Math.abs(nAudioDTSDeviation) > 2) {
			m_Log.Oops(`VideoDTSDeviation=${Ms(nVideoDTSDeviation)} VideoDTSOverlap=${Ms(nVideoDTSOverlap)} AudioDTSDeviation=${nAudioDTSDeviation}`);
		}
		if (nVideoDTSDeviation > TS_TIMESCALE * .01) {
			_bVideoLoss = true;
		}
		if (nAudioDTSDeviation > TS_TIMESCALE * .1) {
			_bAudioLoss = true;
		}
	}

	/*
		La duree de la derniere image n'est pas dans le flux : il faudrait le DTS de l'image suivante, qui
		est dans le segment suivant. On prend celle de l'avant-derniere, bornee par le plus petit ecart de
		composition vers la derniere parmi les quinze precedentes -- avec des images B, c'est le seul
		indice fiable. Une image unique prend la duree du son, ou un trentieme de seconde.
	*/
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
		m_Log[kVideoSamples === 1 ? 'Oops' : 'Here'](`Duration of the last video sample ${Ms(nDuration)}`);
		_dvHeap.setUint32(_trVideo.uSamplesEnd - VIDEO_SAMPLE_STRUCT_SIZE + VIDEO_SAMPLE_DURATION, nDuration);
		_nVideoSegmentEndDTS = _nLastVideoSampleDTS + nDuration;
	}

	// ------------------------------------------------------------------------------------------
	// Un segment, du debut a la fin

	function ConvertSegment() {
		var nStart = performance.now();
		_bDiscontinuity = _bDiscontinuity || _oSourceSegment.bDiscontinuity;
		m_Log.Here(`CONVERTING SEGMENT ${_oSourceSegment.nNumber} Discontinuity=${_bDiscontinuity} Duration=${_oSourceSegment.nDuration} Size=${(_oSourceSegment.pData.byteLength / 1024 / 1024).toFixed(2)}MB`);
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
			if (pException instanceof Error && pException.message === 'REJECT') {
				m_Log.Oops(`Segment rejected: ${pException.stack}`);
				ClearStatistics();
				_bRejected = true;
			} else {
				throw pException;
			}
		}
		_oSourceSegment.pData = null;
		SendConvertedSegment(bSegmentConverted ? mbTransportStream : null);
		// Un segment injouable fait repartir le suivant sur une discontinuite.
		_bDiscontinuity = !bSegmentConverted;
		_nPrevVideoSegmentLastSampleDTS = _nLastVideoSampleDTS;
		_nPrevVideoSegmentEndDTS = _nVideoSegmentEndDTS;
		_nPrevAudioSegmentEndDTS = _nAudioSegmentEndDTS;
		_nConvertedIn = performance.now() - nStart;
	}

	// Un marqueur d'etat traverse le fil sans conversion. Hors changement de qualite, le tas est libere :
	// le flux s'arrete, et la prochaine transmission n'aura peut-etre pas la meme taille de segments.
	function HandleStateSwitch() {
		m_Log.Here(`SKIPPING SEGMENT ${_oSourceSegment.nNumber} State=${_oSourceSegment.pData}`);
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

	// Une erreur ici est un defaut du fil : on arrete de recevoir et on envoie le rapport.
	function HandleException(pException) {
		self.onmessage = null;
		_mUnprocessedMessages = null;
		m_Memory.Free();
		m_Log.Send();
		TerminateAndSendReport(pException);
	}

	// Les messages qui arrivent pendant la compilation de l'assembleur attendent leur tour, dans l'ordre.
	self.onmessage = (oEvent => {
		try {
			if (_mUnprocessedMessages !== null) {
				_mUnprocessedMessages.push(oEvent.data);
				m_Log.Oops('Message handling postponed: compilation not ended');
				m_Log.Send();
			} else {
				HandleMessage(oEvent.data);
			}
		} catch (pException) {
			HandleException(pException);
		}
	});
	self.onmessageerror = (oEvent => {
		throw new Error(`Event occurred ${oEvent.type}`);
	});
	_oAssembler.Compile().then(() => {
		m_Log.Here(`Compilation ended: ${performance.now().toFixed()}ms Unprocessed messages: ${_mUnprocessedMessages.length}`);
		while (_mUnprocessedMessages.length !== 0) {
			HandleMessage(_mUnprocessedMessages.shift());
		}
		_mUnprocessedMessages = null;
	}).catch(HandleException);
}
