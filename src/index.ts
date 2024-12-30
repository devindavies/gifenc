import constants from "./constants.js";
import lzwEncode from "./lzwEncode.js";
import createStream from "./stream.js";
import quantize from "./pnnquant2.js";

import {
	prequantize,
	applyPalette,
	nearestColorIndex,
	nearestColor,
	nearestColorIndexWithDistance,
	snapColorsToPalette,
} from "./palettize.js";

export type GIFEncoderOptions = {
	initialCapacity?: number;
	auto?: boolean;
};

type WriteFrameOpts = {
	palette?: number[][];
	first?: boolean;
	transparent?: boolean;
	transparentIndex?: number;
	delay?: number;
	repeat?: number;
	colorDepth?: number;
	dispose?: number;
};

function GIFEncoder(opt: GIFEncoderOptions = {}) {
	const { initialCapacity = 4096, auto = true } = opt;

	// Stream all encoded data into this buffer
	const stream = createStream(initialCapacity);

	// Shared array data across all frames
	const HSIZE = 5003; // 80% occupancy
	const accum = new Uint8Array(256);
	const htab = new Int32Array(HSIZE);
	const codetab = new Int32Array(HSIZE);

	let hasInit = false;

	return {
		reset() {
			stream.reset();
			hasInit = false;
		},
		finish() {
			stream.writeByte(constants.trailer);
		},
		bytes() {
			return stream.bytes();
		},
		bytesView() {
			return stream.bytesView();
		},
		get buffer() {
			return stream.buffer;
		},
		get stream() {
			return stream;
		},
		writeHeader,
		writeFrame(
			index: Uint8Array<ArrayBuffer>,
			width: number,
			height: number,
			opts: WriteFrameOpts = {},
		) {
			const {
				transparent = false,
				transparentIndex = 0x00,
				delay = 0,
				palette = null,
				repeat = 0, // -1=once, 0=forever, >0=count
				colorDepth = 8,
				dispose = -1,
			} = opts;

			let first = false;
			if (auto) {
				// In 'auto' mode, the first time we write a frame
				// we will write LSD/GCT/EXT
				if (!hasInit) {
					// have not yet init, we can consider this our first frame
					first = true;
					// in 'auto' mode, we also encode a header on first frame
					// this is different than manual mode where you must encode
					// header yoursef (or perhaps not write header altogether)
					writeHeader();
					hasInit = true;
				}
			} else {
				// in manual mode, the first frame is determined by the options only
				first = Boolean(opts.first);
			}

			const frameWidth = Math.max(0, Math.floor(width));
			const frameHeight = Math.max(0, Math.floor(height));

			// Write pre-frame details such as repeat count and global palette
			if (first) {
				if (!palette) {
					throw new Error("First frame must include a { palette } option");
				}
				encodeLogicalScreenDescriptor(
					stream,
					frameWidth,
					frameHeight,
					palette,
					colorDepth,
				);
				encodeColorTable(stream, palette);
				if (repeat >= 0) {
					encodeNetscapeExt(stream, repeat);
				}
			}

			const delayTime = Math.round(delay / 10);
			encodeGraphicControlExt(
				stream,
				dispose,
				delayTime,
				transparent,
				transparentIndex,
			);

			const useLocalColorTable = palette !== null && !first;
			encodeImageDescriptor(
				stream,
				frameWidth,
				frameHeight,
				useLocalColorTable ? palette : null,
			);
			if (useLocalColorTable) encodeColorTable(stream, palette);
			encodePixels(stream, index, accum, htab, codetab, colorDepth);
		},
	};

	function writeHeader() {
		writeUTFBytes(stream, "GIF89a");
	}
}

function encodeGraphicControlExt(
	stream: ReturnType<typeof createStream>,
	dispose: number,
	delay: number,
	transparent: boolean,
	transparentIndex: number,
) {
	stream.writeByte(0x21); // extension introducer
	stream.writeByte(0xf9); // GCE label
	stream.writeByte(4); // data block size

	let transIndex = transparentIndex;
	let isTransparent = transparent;
	if (transIndex < 0) {
		transIndex = 0x00;
		isTransparent = false;
	}

	let transp: number;
	let disp: number;
	if (!isTransparent) {
		transp = 0;
		disp = 0; // dispose = no action
	} else {
		transp = 1;
		disp = 2; // force clear if using transparent color
	}

	if (dispose >= 0) {
		disp = dispose & 7; // user override
	}

	disp <<= 2;

	const userInput = 0;

	// packed fields
	stream.writeByte(
		0 | // 1:3 reserved
			disp | // 4:6 disposal
			userInput | // 7 user input - 0 = none
			transp, // 8 transparency flag
	);

	stream.writeByte(transIndex || 0x00); // transparent color index
	writeUInt16(stream, delay); // delay x 1/100 sec
	stream.writeByte(0); // block terminator
}

function encodeLogicalScreenDescriptor(
	stream: ReturnType<typeof createStream>,
	width: number,
	height: number,
	palette: number[][],
	colorDepth = 8,
) {
	const globalColorTableFlag = 1;
	const sortFlag = 0;
	const globalColorTableSize = colorTableSize(palette.length) - 1;
	const fields =
		(globalColorTableFlag << 7) |
		((colorDepth - 1) << 4) |
		(sortFlag << 3) |
		globalColorTableSize;
	const backgroundColorIndex = 0;
	const pixelAspectRatio = 0;
	writeUInt16(stream, width);
	writeUInt16(stream, height);
	stream.writeBytes([fields, backgroundColorIndex, pixelAspectRatio]);
}

function encodeNetscapeExt(
	stream: ReturnType<typeof createStream>,
	repeat: number,
) {
	stream.writeByte(0x21); // extension introducer
	stream.writeByte(0xff); // app extension label
	stream.writeByte(11); // block size
	writeUTFBytes(stream, "NETSCAPE2.0"); // app id + auth code
	stream.writeByte(3); // sub-block size
	stream.writeByte(1); // loop sub-block id
	writeUInt16(stream, repeat); // loop count (extra iterations, 0=repeat forever)
	stream.writeByte(0); // block terminator
}

function encodeColorTable(
	stream: ReturnType<typeof createStream>,
	palette: number[][],
) {
	const colorTableLength = 1 << colorTableSize(palette.length);
	for (let i = 0; i < colorTableLength; i++) {
		let color = [0, 0, 0];
		if (i < palette.length) {
			color = palette[i];
		}
		stream.writeByte(color[0]);
		stream.writeByte(color[1]);
		stream.writeByte(color[2]);
	}
}

function encodeImageDescriptor(
	stream: ReturnType<typeof createStream>,
	width: number,
	height: number,
	localPalette: number[][] | null,
) {
	stream.writeByte(0x2c); // image separator

	writeUInt16(stream, 0); // x position
	writeUInt16(stream, 0); // y position
	writeUInt16(stream, width); // image size
	writeUInt16(stream, height);

	if (localPalette) {
		const interlace = 0;
		const sorted = 0;
		const palSize = colorTableSize(localPalette.length) - 1;
		// local palette
		stream.writeByte(
			0x80 | // 1 local color table 1=yes
				interlace | // 2 interlace - 0=no
				sorted | // 3 sorted - 0=no
				0 | // 4-5 reserved
				palSize, // 6-8 size of color table
		);
	} else {
		// global palette
		stream.writeByte(0);
	}
}

function encodePixels(
	stream: ReturnType<typeof createStream>,
	index: Uint8Array<ArrayBuffer>,
	accum: Uint8Array<ArrayBuffer>,
	htab: Int32Array<ArrayBuffer>,
	codetab: Int32Array<ArrayBuffer>,
	colorDepth = 8,
) {
	lzwEncode(index, colorDepth, stream, accum, htab, codetab);
}

// Utilities

function writeUInt16(stream: ReturnType<typeof createStream>, short: number) {
	stream.writeByte(short & 0xff);
	stream.writeByte((short >> 8) & 0xff);
}

function writeUTFBytes(stream: ReturnType<typeof createStream>, text: string) {
	for (let i = 0; i < text.length; i++) {
		stream.writeByte(text.charCodeAt(i));
	}
}

function colorTableSize(length: number) {
	return Math.max(Math.ceil(Math.log2(length)), 1);
}

export {
	GIFEncoder,
	quantize,
	prequantize,
	applyPalette,
	nearestColorIndex,
	nearestColor,
	nearestColorIndexWithDistance,
	snapColorsToPalette,
};

export default GIFEncoder;
