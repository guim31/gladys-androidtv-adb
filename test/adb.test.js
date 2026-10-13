// -----------------------------------------------------------------------------
// The ADB transport in plain JavaScript: wire format, RSA authentication
// (checked by a fake adbd that verifies the signatures like a device), the
// prompt, shell streams.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { constants, createPublicKey, publicDecrypt, randomBytes } from 'node:crypto';
import { AdbConnection } from '../src/adb/connection.js';
import {
  androidPublicKey,
  androidPublicKeyStruct,
  generatePrivateKey,
  keyFingerprint,
  parseAndroidPublicKey,
  signToken,
} from '../src/adb/keys.js';
import { COMMANDS, PacketReader, checksum, encodePacket } from '../src/adb/protocol.js';
import { closedPort, startFakeAdbd } from './helpers/fakeAdbd.js';

const KEY = generatePrivateKey();
const OTHER_KEY = generatePrivateKey();

test('a packet is a 24-byte header, the payload, a byte-sum checksum and the magic', () => {
  const packet = encodePacket(COMMANDS.OPEN, 1, 0, 'shell:echo\0');
  assert.equal(packet.length, 24 + 11);
  assert.equal(packet.subarray(0, 4).toString('ascii'), 'OPEN');
  assert.equal(packet.readUInt32LE(12), 11);
  assert.equal(packet.readUInt32LE(16), checksum(Buffer.from('shell:echo\0')));
  assert.equal(packet.readUInt32LE(20), (COMMANDS.OPEN ^ 0xffffffff) >>> 0);
});

test('the reader rebuilds packets cut anywhere by TCP, and refuses a corrupted stream', () => {
  const stream = Buffer.concat([
    encodePacket(COMMANDS.WRTE, 7, 1, 'hello '),
    encodePacket(COMMANDS.WRTE, 7, 1, Buffer.alloc(3000, 0x61)),
    encodePacket(COMMANDS.CLSE, 7, 1),
  ]);
  const reader = new PacketReader();
  const packets = [];
  for (let i = 0; i < stream.length; i += 5) {
    packets.push(...reader.push(stream.subarray(i, i + 5)));
  }
  assert.deepEqual(
    packets.map((p) => [p.command, p.data.length]),
    [
      [COMMANDS.WRTE, 6],
      [COMMANDS.WRTE, 3000],
      [COMMANDS.CLSE, 0],
    ],
  );
  const broken = encodePacket(COMMANDS.OKAY, 1, 2);
  broken.writeUInt32LE(0, 20);
  assert.throws(() => new PacketReader().push(broken), /bad magic/);
  const tampered = encodePacket(COMMANDS.WRTE, 1, 2, 'abc');
  tampered[24] = 0x7a;
  assert.throws(() => new PacketReader().push(tampered), /bad checksum/);
});

test('the public key follows the Android RSAPublicKey struct', () => {
  const struct = androidPublicKeyStruct(KEY);
  assert.equal(struct.length, 524);
  assert.equal(struct.readUInt32LE(0), 64, 'modulus size in 32-bit words');
  assert.equal(struct.readUInt32LE(520), 65537, 'exponent');
  // n0inv = -1 / n mod 2^32: n[0] * n0inv + 1 must be a multiple of 2^32.
  const n0 = BigInt(struct.readUInt32LE(8));
  const n0inv = BigInt(struct.readUInt32LE(4));
  assert.equal((n0 * n0inv + 1n) % (1n << 32n), 0n);
  const payload = androidPublicKey(KEY);
  assert.equal(payload.at(-1), 0, 'NUL-terminated');
  assert.match(payload.toString(), /^[A-Za-z0-9+/=]+ gladys@gladys-androidtv-adb\0$/);
  assert.match(keyFingerprint(KEY), /^([0-9A-F]{2}:){15}[0-9A-F]{2}$/);
});

test('a signed token verifies against the public key the device received', () => {
  const token = randomBytes(20);
  const key = parseAndroidPublicKey(androidPublicKey(KEY));
  const clear = publicDecrypt({ key, padding: constants.RSA_PKCS1_PADDING }, signToken(KEY, token));
  assert.ok(clear.subarray(-20).equals(token));
  // The struct carries exactly our modulus.
  assert.deepEqual(
    key.export({ format: 'jwk' }).n,
    createPublicKey(KEY).export({ format: 'jwk' }).n,
  );
});

test('an authorized key connects without prompt, and runs shell commands', async (t) => {
  const device = await startFakeAdbd({ respond: (cmd) => (cmd === 'echo hi' ? 'hi\n' : '') });
  t.after(() => device.close());
  device.authorize(KEY);
  const connection = new AdbConnection({ host: device.host, port: device.port, privateKey: KEY });
  const { banner } = await connection.connect();
  assert.match(banner, /^device::ro\.product\.name=fake/);
  assert.equal(await connection.shell('echo hi'), 'hi\n');
  assert.equal(device.prompts, 0);
  connection.close();
});

test('a long output arrives in several chunks, each acknowledged', async (t) => {
  const big = 'x'.repeat(50_000);
  const device = await startFakeAdbd({ respond: () => big, chunk: 4096 });
  t.after(() => device.close());
  device.authorize(KEY);
  const connection = new AdbConnection({ host: device.host, port: device.port, privateKey: KEY });
  await connection.connect();
  const [a, b] = await Promise.all([connection.shell('one'), connection.shell('two')]);
  assert.equal(a.length, 50_000);
  assert.equal(b.length, 50_000);
  connection.close();
});

test('an unknown key is refused without opening the prompt, unless asked', async (t) => {
  const device = await startFakeAdbd();
  t.after(() => device.close());
  device.authorize(OTHER_KEY);
  const silent = new AdbConnection({ host: device.host, port: device.port, privateKey: KEY });
  await assert.rejects(silent.connect(), { code: 'UNAUTHORIZED' });
  assert.equal(device.prompts, 0, 'no prompt in a background read');

  const asking = new AdbConnection({ host: device.host, port: device.port, privateKey: KEY });
  const connecting = asking.connect({ sendPublicKey: true, authTimeoutMs: 5000 });
  await waitFor(() => device.prompts === 1);
  device.accept(); // the user taps "Allow"
  await connecting;
  asking.close();

  // From now on the key is known: no prompt.
  const again = new AdbConnection({ host: device.host, port: device.port, privateKey: KEY });
  await again.connect();
  assert.equal(device.prompts, 1);
  again.close();
});

test('a prompt nobody accepts ends in AUTH_PENDING', async (t) => {
  const device = await startFakeAdbd();
  t.after(() => device.close());
  const connection = new AdbConnection({ host: device.host, port: device.port, privateKey: KEY });
  await assert.rejects(connection.connect({ sendPublicKey: true, authTimeoutMs: 200 }), {
    code: 'AUTH_PENDING',
  });
});

test('nothing listening is UNREACHABLE; a pairing port is TLS_REQUIRED', async (t) => {
  const port = await closedPort();
  const off = new AdbConnection({ host: '127.0.0.1', port, privateKey: KEY });
  await assert.rejects(off.connect(), { code: 'UNREACHABLE' });

  const device = await startFakeAdbd({ tls: true });
  t.after(() => device.close());
  const pairing = new AdbConnection({ host: device.host, port: device.port, privateKey: KEY });
  await assert.rejects(pairing.connect(), { code: 'TLS_REQUIRED' });
});

test('a dropped connection fails the running command and calls onClose', async (t) => {
  const device = await startFakeAdbd({ respond: () => new Promise(() => {}) });
  t.after(() => device.close());
  device.authorize(KEY);
  const connection = new AdbConnection({ host: device.host, port: device.port, privateKey: KEY });
  await connection.connect();
  let closed = null;
  connection.onClose((err) => {
    closed = err;
  });
  const running = connection.shell('sleep');
  device.dropConnections();
  await assert.rejects(running, { code: 'CLOSED' });
  assert.equal(closed.code, 'CLOSED');
  await assert.rejects(connection.shell('again'), { code: 'CLOSED' });
});

test('a command that never ends times out', async (t) => {
  const device = await startFakeAdbd({ respond: () => new Promise(() => {}) });
  t.after(() => device.close());
  device.authorize(KEY);
  const connection = new AdbConnection({ host: device.host, port: device.port, privateKey: KEY });
  await connection.connect();
  await assert.rejects(connection.shell('sleep', { timeoutMs: 100 }), { code: 'TIMEOUT' });
  connection.close();
});

async function waitFor(condition, timeoutMs = 3000) {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('condition not met in time');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
