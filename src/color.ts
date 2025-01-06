export type RGB = [number, number, number];
export type RGBA = [number, number, number, number];
export type Color = RGB | RGBA;
export type Palette = Color[];

export function isRGBA(color: Color): color is RGBA {
	return color.length === 4;
}

function rgb2y(r: number, g: number, b: number) {
	return r * 0.29889531 + g * 0.58662247 + b * 0.11448223;
}
function rgb2i(r: number, g: number, b: number) {
	return r * 0.59597799 - g * 0.2741761 - b * 0.32180189;
}
function rgb2q(r: number, g: number, b: number) {
	return r * 0.21147017 - g * 0.52261711 + b * 0.31114694;
}

export function colorDifferenceYIQSquared(yiqA: Color, yiqB: Color) {
	const y = yiqA[0] - yiqB[0];
	const i = yiqA[1] - yiqB[1];
	const q = yiqA[2] - yiqB[2];
	const a = alpha(yiqA) - alpha(yiqB);
	return y * y * 0.5053 + i * i * 0.299 + q * q * 0.1957 + a * a;
}

function alpha(array: Color) {
	return array[3] != null ? array[3] : 0xff;
}

export function colorDifferenceYIQ(yiqA: Color, yiqB: Color) {
	return Math.sqrt(colorDifferenceYIQSquared(yiqA, yiqB));
}

export function colorDifferenceRGBToYIQSquared(rgb1: Color, rgb2: Color) {
	const [r1, g1, b1] = rgb1;
	const [r2, g2, b2] = rgb2;
	const y = rgb2y(r1, g1, b1) - rgb2y(r2, g2, b2);
	const i = rgb2i(r1, g1, b1) - rgb2i(r2, g2, b2);
	const q = rgb2q(r1, g1, b1) - rgb2q(r2, g2, b2);
	const a = alpha(rgb1) - alpha(rgb2);
	return y * y * 0.5053 + i * i * 0.299 + q * q * 0.1957 + a * a;
}

export function colorDifferenceRGBToYIQ(rgb1: Color, rgb2: Color) {
	return Math.sqrt(colorDifferenceRGBToYIQSquared(rgb1, rgb2));
}

export function euclideanDistanceSquared<T extends Color>(a: T, b: T) {
	let sum = 0;

	for (let n = 0; n < a.length; n++) {
		const dx = (a[n] ?? 0) - (b[n] ?? 0);
		sum += dx * dx;
	}
	return sum;
}

export function euclideanDistance(a: Color, b: Color) {
	return Math.sqrt(euclideanDistanceSquared(a, b));
}
