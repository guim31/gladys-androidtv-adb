// -----------------------------------------------------------------------------
// The integration's ADB key pair, and what ADB authentication does with it.
//
// adbd authenticates a host by a 2048-bit RSA key: it sends a 20-byte token,
// the host signs it (PKCS#1 v1.5, the token standing for a SHA-1 digest), and
// adbd checks the signature against the public keys the user approved
// ("Allow USB debugging?" → "Always allow from this computer"). An unknown
// host sends its public key instead, in Android's own binary format, and the
// device shows the prompt. Everything here is plain node:crypto: no binary,
// no dependency. Ported from JeffLIrion/adb_shell (Apache-2.0),
// adb_shell/auth/keygen.py and sign_pythonrsa.py.
// -----------------------------------------------------------------------------

import {
  constants,
  createHash,
  createPublicKey,
  generateKeyPairSync,
  privateEncrypt,
} from 'node:crypto';

const MODULUS_BITS = 2048;
const MODULUS_BYTES = MODULUS_BITS / 8;

// DER prefix of a SHA-1 DigestInfo: the token is signed as if it were the digest.
const SHA1_DIGEST_INFO = Buffer.from('3021300906052b0e03021a05000414', 'hex');

// What the device shows next to the fingerprint in its prompt and its list of
// authorized computers (Developer options → Revoke USB debugging authorizations).
export const KEY_COMMENT = 'gladys@gladys-androidtv-adb';

/** @returns {string} a new private key, PEM PKCS#8 (the format `adb` itself stores) */
export function generatePrivateKey() {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: MODULUS_BITS,
    publicExponent: 65537,
  });
  return privateKey.export({ type: 'pkcs8', format: 'pem' });
}

/**
 * Signs the AUTH token sent by adbd.
 * @param {string} privateKeyPem
 * @param {Buffer} token
 */
export function signToken(privateKeyPem, token) {
  return privateEncrypt(
    { key: privateKeyPem, padding: constants.RSA_PKCS1_PADDING },
    Buffer.concat([SHA1_DIGEST_INFO, token]),
  );
}

const fromBase64Url = (text) => BigInt(`0x${Buffer.from(text, 'base64url').toString('hex')}`);

function toLittleEndian(value, length) {
  const bytes = Buffer.alloc(length);
  let rest = value;
  for (let i = 0; i < length; i += 1) {
    bytes[i] = Number(rest & 0xffn);
    rest >>= 8n;
  }
  return bytes;
}

function fromLittleEndian(bytes) {
  let value = 0n;
  for (let i = bytes.length - 1; i >= 0; i -= 1) {
    value = (value << 8n) | BigInt(bytes[i]);
  }
  return value;
}

function modInverse(value, modulus) {
  let [a, b, x0, x1] = [value % modulus, modulus, 0n, 1n];
  while (a > 1n) {
    const q = a / b;
    [a, b] = [b, a % b];
    [x0, x1] = [x1 - q * x0, x0];
  }
  return ((x1 % modulus) + modulus) % modulus;
}

/**
 * The public key in Android's RSAPublicKey struct (libcrypto_utils
 * android_pubkey.cpp): modulus size in words, -1/n[0] mod 2^32, modulus and
 * R^2 mod n little-endian, exponent.
 * @param {string} privateKeyPem
 * @returns {Buffer} the 524-byte struct
 */
export function androidPublicKeyStruct(privateKeyPem) {
  const jwk = createPublicKey(privateKeyPem).export({ format: 'jwk' });
  const n = fromBase64Url(jwk.n);
  const e = fromBase64Url(jwk.e);
  const r32 = 1n << 32n;
  const n0inv = r32 - modInverse(n % r32, r32);
  const rr = (1n << BigInt(MODULUS_BITS * 2)) % n;
  const struct = Buffer.alloc(4 + 4 + MODULUS_BYTES * 2 + 4);
  struct.writeUInt32LE(MODULUS_BYTES / 4, 0);
  struct.writeUInt32LE(Number(n0inv), 4);
  toLittleEndian(n, MODULUS_BYTES).copy(struct, 8);
  toLittleEndian(rr, MODULUS_BYTES).copy(struct, 8 + MODULUS_BYTES);
  struct.writeUInt32LE(Number(e), 8 + MODULUS_BYTES * 2);
  return struct;
}

/**
 * The AUTH RSAPUBLICKEY payload: base64 struct, a space, a comment, a NUL.
 * @param {string} privateKeyPem
 */
export function androidPublicKey(privateKeyPem) {
  return Buffer.from(
    `${androidPublicKeyStruct(privateKeyPem).toString('base64')} ${KEY_COMMENT}\0`,
    'utf8',
  );
}

/**
 * The fingerprint the device prompt shows (MD5 of the struct, as Android's
 * AdbDebuggingManager prints it), so the user can check it is this key.
 * @param {string} privateKeyPem
 */
export function keyFingerprint(privateKeyPem) {
  const digest = createHash('md5').update(androidPublicKeyStruct(privateKeyPem)).digest('hex');
  return digest.toUpperCase().match(/../g).join(':');
}

/**
 * Reads an Android public key back (what adbd does): used by the tests' fake
 * device to check signatures.
 * @param {Buffer|string} payload the AUTH RSAPUBLICKEY payload
 * @returns {import('node:crypto').KeyObject}
 */
export function parseAndroidPublicKey(payload) {
  const text = Buffer.from(payload).toString('utf8').replace(/\0$/, '');
  const struct = Buffer.from(text.split(/\s+/)[0], 'base64');
  if (struct.length !== 4 + 4 + MODULUS_BYTES * 2 + 4 || struct.readUInt32LE(0) !== 64) {
    throw new Error('Not an Android RSA public key');
  }
  const n = fromLittleEndian(struct.subarray(8, 8 + MODULUS_BYTES));
  const e = BigInt(struct.readUInt32LE(8 + MODULUS_BYTES * 2));
  const toBase64Url = (value) => {
    let hex = value.toString(16);
    if (hex.length % 2) hex = `0${hex}`;
    return Buffer.from(hex, 'hex').toString('base64url');
  };
  return createPublicKey({
    key: { kty: 'RSA', n: toBase64Url(n), e: toBase64Url(e) },
    format: 'jwk',
  });
}
