// JSON output identical to Python's json.dump (default separators, float repr, ensure_ascii),
// so the browser importer writes the same bytes as the tools/*.py converters.

/** marks a number that Python holds as a float (printed as 1.0, 1e-05, ...) */
export class PyFloat { constructor(v) { this.v = v; } }
export const F = (v) => new PyFloat(v);

export function pyRepr(x) {
  if (Number.isNaN(x)) return 'NaN';
  if (x === Infinity) return 'Infinity';
  if (x === -Infinity) return '-Infinity';
  if (x === 0) return Object.is(x, -0) ? '-0.0' : '0.0';
  let s = x.toExponential(); // shortest round-trip digits, like Python's repr
  const neg = s[0] === '-';
  if (neg) s = s.slice(1);
  const [m, e] = s.split('e');
  const digits = m.replace('.', '');
  const exp = +e, decpt = exp + 1;
  let out;
  if (decpt > -4 && decpt <= 16) {
    if (decpt <= 0) out = '0.' + '0'.repeat(-decpt) + digits;
    else if (decpt >= digits.length) out = digits + '0'.repeat(decpt - digits.length) + '.0';
    else out = digits.slice(0, decpt) + '.' + digits.slice(decpt);
  } else {
    out = digits[0] + (digits.length > 1 ? '.' + digits.slice(1) : '') + 'e' + (exp < 0 ? '-' : '+') + String(Math.abs(exp)).padStart(2, '0');
  }
  return (neg ? '-' : '') + out;
}

const SHORT = { '"': '\\"', '\\': '\\\\', '\n': '\\n', '\r': '\\r', '\t': '\\t', '\b': '\\b', '\f': '\\f' };

function str(s, ascii) {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i], c = s.charCodeAt(i);
    if (SHORT[ch]) out += SHORT[ch];
    else if (c < 0x20 || (ascii && c > 0x7e)) out += '\\u' + c.toString(16).padStart(4, '0');
    else out += ch;
  }
  return out + '"';
}

function enc(v, ascii) {
  if (v === null || v === undefined) return 'null';
  if (v === true) return 'true';
  if (v === false) return 'false';
  if (v instanceof PyFloat) return pyRepr(v.v);
  if (typeof v === 'number') {
    if (!Number.isInteger(v)) throw new Error('pyjson: non-integer number without F(): ' + v);
    return String(v);
  }
  if (typeof v === 'string') return str(v, ascii);
  if (Array.isArray(v)) return v.length ? '[' + v.map((x) => enc(x, ascii)).join(', ') + ']' : '[]';
  const ents = v instanceof Map ? [...v.entries()] : Object.entries(v);
  return ents.length ? '{' + ents.map(([k, x]) => str(String(k), ascii) + ': ' + enc(x, ascii)).join(', ') + '}' : '{}';
}

/** json.dumps(v, ensure_ascii=ascii) */
export function dumps(v, ascii = true) { return enc(v, ascii); }

/** Python round(x) for floats (half to even), returning a JS integer */
export function pyRoundInt(x) {
  const f = Math.floor(x), d = x - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

/** numpy rint (half to even) */
export const rint = (x) => {
  if (!Number.isFinite(x)) return x;
  const r = pyRoundInt(x);
  return r === 0 && (x < 0 || Object.is(x, -0)) ? -0 : r;
};

/** Python round(x, n) for a Python float: correctly rounded decimal, ties to even on the exact binary value */
export function pyRoundFloat(x, n) {
  if (!Number.isFinite(x) || x === 0) return x;
  const neg = x < 0;
  const [mant, e2] = frexpBig(Math.abs(x));
  let num = mant * 10n ** BigInt(n), den = 1n;
  if (e2 >= 0) num <<= BigInt(e2); else den <<= BigInt(-e2);
  let q = num / den;
  const r2 = 2n * (num % den);
  if (r2 > den || (r2 === den && q % 2n === 1n)) q += 1n;
  const v = Number(q + 'e-' + n);
  return neg ? -v : v;
}

function frexpBig(x) {
  const b = new DataView(new ArrayBuffer(8));
  b.setFloat64(0, x);
  const hi = b.getUint32(0), lo = b.getUint32(4);
  const e = (hi >>> 20) & 0x7ff;
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (e) mant |= 1n << 52n;
  return [mant, (e || 1) - 1075];
}
