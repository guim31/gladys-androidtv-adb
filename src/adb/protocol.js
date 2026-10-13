// -----------------------------------------------------------------------------
// The ADB wire format, as adbd speaks it on its TCP port (5555).
//
// Every message is a 24-byte header of six little-endian uint32 — command,
// arg0, arg1, payload length, payload checksum, command XOR 0xffffffff —
// followed by the payload. The checksum is the plain sum of the payload bytes.
// Reference: AOSP packages/modules/adb/protocol.txt, and the Python port
// JeffLIrion/adb_shell (Apache-2.0), which Home Assistant's `androidtv`
// integration uses and from which the constants below are taken.
// -----------------------------------------------------------------------------

export const HEADER_LENGTH = 24;

/** Protocol version sent in CNXN: the one adb_shell sends (checksums on). */
export const VERSION = 0x01000000;

/** Largest payload we accept from the device, announced in CNXN (adb_shell's value). */
export const MAX_DATA = 1024 * 1024;

/** Largest payload we send: what every adbd accepts, even the legacy ones. */
export const MAX_LEGACY_DATA = 4096;

/** AUTH arg0 values. */
export const AUTH_TOKEN = 1;
export const AUTH_SIGNATURE = 2;
export const AUTH_RSAPUBLICKEY = 3;

const toCode = (name) => Buffer.from(name, 'ascii').readUInt32LE(0);

export const COMMANDS = Object.freeze({
  CNXN: toCode('CNXN'),
  AUTH: toCode('AUTH'),
  OPEN: toCode('OPEN'),
  OKAY: toCode('OKAY'),
  CLSE: toCode('CLSE'),
  WRTE: toCode('WRTE'),
  STLS: toCode('STLS'),
});

const NAMES = new Map(Object.entries(COMMANDS).map(([name, code]) => [code, name]));

/** Name of a command code ('CNXN'…), or its hexadecimal value when unknown. */
export function commandName(code) {
  return NAMES.get(code) ?? `0x${code.toString(16)}`;
}

/** @param {Buffer} data */
export function checksum(data) {
  let sum = 0;
  for (const byte of data) {
    sum = (sum + byte) >>> 0;
  }
  return sum;
}

/**
 * @param {number} command a value of COMMANDS
 * @param {number} arg0
 * @param {number} arg1
 * @param {Buffer|string} [data]
 * @returns {Buffer} the header and the payload, ready to write
 */
export function encodePacket(command, arg0, arg1, data = Buffer.alloc(0)) {
  const payload = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
  const header = Buffer.alloc(HEADER_LENGTH);
  header.writeUInt32LE(command >>> 0, 0);
  header.writeUInt32LE(arg0 >>> 0, 4);
  header.writeUInt32LE(arg1 >>> 0, 8);
  header.writeUInt32LE(payload.length, 12);
  header.writeUInt32LE(checksum(payload), 16);
  header.writeUInt32LE((command ^ 0xffffffff) >>> 0, 20);
  return Buffer.concat([header, payload]);
}

/**
 * Cuts a TCP byte stream into ADB packets. Feed it the socket chunks; it
 * returns the complete packets, and keeps the incomplete tail for later.
 */
export class PacketReader {
  constructor({ maxData = MAX_DATA } = {}) {
    this.maxData = maxData;
    this.buffer = Buffer.alloc(0);
  }

  /**
   * @param {Buffer} chunk
   * @returns {{ command: number, arg0: number, arg1: number, data: Buffer }[]}
   * @throws on a corrupted stream (bad magic, oversized payload, bad checksum)
   */
  push(chunk) {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    const packets = [];
    while (this.buffer.length >= HEADER_LENGTH) {
      const command = this.buffer.readUInt32LE(0);
      const length = this.buffer.readUInt32LE(12);
      const sum = this.buffer.readUInt32LE(16);
      const magic = this.buffer.readUInt32LE(20);
      if ((command ^ 0xffffffff) >>> 0 !== magic) {
        throw new Error('ADB stream corrupted (bad magic)');
      }
      if (length > this.maxData) {
        throw new Error(`ADB payload too large (${length} bytes)`);
      }
      if (this.buffer.length < HEADER_LENGTH + length) {
        break;
      }
      const data = this.buffer.subarray(HEADER_LENGTH, HEADER_LENGTH + length);
      // Since protocol 0x01000001 adbd may leave the checksum at 0.
      if (sum !== 0 && checksum(data) !== sum) {
        throw new Error('ADB stream corrupted (bad checksum)');
      }
      packets.push({
        command,
        arg0: this.buffer.readUInt32LE(4),
        arg1: this.buffer.readUInt32LE(8),
        data: Buffer.from(data),
      });
      this.buffer = this.buffer.subarray(HEADER_LENGTH + length);
    }
    return packets;
  }
}
