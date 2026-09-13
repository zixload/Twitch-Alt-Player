'use strict';

function AsmjsModule(stdlib, foreign, heap)
{
	'use asm';

	var _abHeap = new stdlib.Uint8Array(heap);
	var _aiHeap = new stdlib.Int32Array(heap);

	function SearchStartCodePrefix(pStream, pStreamEnd)
	// ITU-T H.264:2014 Annex B
	// Finds a start code prefix: at least two zero bytes followed by a one.
	// Prefix layout depending on its length:
	// =3 - start_code_prefix_one_3bytes
	// =4 - zero_byte + start_code_prefix_one_3bytes
	// >4 - leading_zero_8bits or trailing_zero_8bits + zero_byte + start_code_prefix_one_3bytes
	// Returns a pointer to the start of the prefix. Int32Array(heap)[0] receives the prefix length.
	// If no prefix is found, returns pStreamEnd. The length is undefined.
	// If the data is corrupt, returns -2.
	// Function arguments running past the end of the buffer are not checked.
	{
		pStream = pStream|0;
		pStreamEnd = pStreamEnd|0;

		var pStreamEnd3 = 0, uByte = 0, pStart = 0;

		pStreamEnd3 = (pStreamEnd - 3)|0;
		if ((pStream|0) > (pStreamEnd3|0))
		{
			return pStreamEnd|0;
		}

		for (;;)
		{
			// Most of the time is spent in the following code
			// ↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓
			uByte = _abHeap[(pStream + 2) >> 0]|0;
			if ((uByte|0) > 1)
			{
				pStream = (pStream + 3)|0;
				if ((pStream|0) <= (pStreamEnd3|0))
				{
					continue;
				}
				return pStreamEnd|0;
			}
			// ↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑
			if ((_abHeap[(pStream + 1) >> 0]|0) != 0)
			{
				pStream = (pStream + 2)|0;
				if ((pStream|0) <= (pStreamEnd3|0))
				{
					continue;
				}
				return pStreamEnd|0;
			}
			if ((_abHeap[pStream >> 0]|0) != 0)
			{
				pStream = (pStream + 1)|0;
				if ((pStream|0) <= (pStreamEnd3|0))
				{
					continue;
				}
				return pStreamEnd|0;
			}
			break;
		}

		pStart = pStream;
		// Chrome 67 slows down if 3 is added.
		pStream = (pStream + 2)|0;

		while ((uByte|0) == 0)
		{
			pStream = (pStream + 1)|0;
			if ((pStream|0) == (pStreamEnd|0))
			{
				return pStreamEnd|0; // trailing_zero_8bits
			}
			uByte = _abHeap[pStream >> 0]|0;
		}
		if ((uByte|0) != 1)
		{
			// Twitch: filler data sometimes contains runs of zero bytes of arbitrary length.
			// They do not disturb playback, but break several rules of the H.264 standard.
			return -2|0;
		}

		_aiHeap[0 >> 2] = (pStream - pStart + 1)|0;
		return pStart|0;
	}

	return {SearchStartCodePrefix: SearchStartCodePrefix};
}
