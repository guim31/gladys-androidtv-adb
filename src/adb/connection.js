// -----------------------------------------------------------------------------
// One ADB connection to a device over TCP (the "network debugging" port,
// 5555 by default), in plain JavaScript.
//
// Handshake: CNXN → AUTH token → signed token → CNXN. When the device does not
// know the key, the public key is sent only when the caller allows it (it
// opens the "Allow debugging?" prompt on the screen: never in a loop), and
// the device answers CNXN once the user accepted.
//
// After the handshake, each shell command is one stream: OPEN "shell:<cmd>",
// OKAY, WRTE chunks (each acknowledged with OKAY), CLSE. Streams are
// multiplexed over the socket. Only the `shell:` service is used, and the
// commands are built by src/tv/commands.js from fixed templates — this class
// never receives user text.
// -----------------------------------------------------------------------------

import net from 'node:net';
import {
  AUTH_RSAPUBLICKEY,
  AUTH_SIGNATURE,
  AUTH_TOKEN,
  COMMANDS,
  MAX_DATA,
  MAX_LEGACY_DATA,
  PacketReader,
  VERSION,
  commandName,
  encodePacket,
} from './protocol.js';
import { androidPublicKey, signToken } from './keys.js';

export const DEFAULT_PORT = 5555;

/**
 * Error codes:
 * - UNREACHABLE: no TCP connection (device off, wrong address, debugging off)
 * - UNAUTHORIZED: the device does not know our key (prompt not opened)
 * - AUTH_PENDING: the prompt was opened, nobody accepted it in time
 * - TLS_REQUIRED: a wireless-debugging port (Android 11 pairing), not 5555
 * - TIMEOUT, CLOSED, PROTOCOL: the connection broke
 */
export class AdbError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AdbError';
    this.code = code;
  }
}

const UNREACHABLE_CODES = new Set([
  'ECONNREFUSED',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EHOSTDOWN',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
]);

export class AdbConnection {
  /**
   * @param {object} options
   * @param {string} options.host
   * @param {number} [options.port]
   * @param {string} options.privateKey PEM
   * @param {number} [options.connectTimeoutMs] TCP connection + handshake without prompt
   */
  constructor({ host, port = DEFAULT_PORT, privateKey, connectTimeoutMs = 5000 }) {
    this.host = host;
    this.port = port;
    this.privateKey = privateKey;
    this.connectTimeoutMs = connectTimeoutMs;
    this.socket = null;
    this.reader = new PacketReader();
    this.connected = false;
    this.closed = false;
    this.deviceMaxData = MAX_LEGACY_DATA;
    this.banner = '';
    this.nextLocalId = 1;
    /** @type {Map<number, object>} open streams, by our local id */
    this.streams = new Map();
    this.handshake = null;
    this.onCloseListeners = [];
  }

  /** Registers a callback run once when the connection ends (either side). */
  onClose(listener) {
    this.onCloseListeners.push(listener);
  }

  /**
   * Opens the socket and authenticates.
   * @param {object} [options]
   * @param {boolean} [options.sendPublicKey] open the prompt on the device if the key is unknown
   * @param {number} [options.authTimeoutMs] how long to wait for the user to accept the prompt
   * @returns {Promise<{ banner: string }>} the device banner ("device::ro.product.name=…;")
   */
  connect({ sendPublicKey = false, authTimeoutMs = 60_000 } = {}) {
    if (this.handshake) {
      return this.handshake.promise;
    }
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    this.handshake = { promise, resolve, reject, sendPublicKey, authTimeoutMs, keySent: false };

    const socket = net.connect({ host: this.host, port: this.port });
    this.socket = socket;
    socket.setNoDelay(true);
    this.handshakeTimer = setTimeout(
      () => this.fail(new AdbError('UNREACHABLE', `${this.where()}: no answer`)),
      this.connectTimeoutMs,
    );
    socket.on('connect', () => {
      socket.setKeepAlive(true, 30_000);
      this.send(COMMANDS.CNXN, VERSION, MAX_DATA, 'host::\0');
    });
    socket.on('data', (chunk) => {
      let packets;
      try {
        packets = this.reader.push(chunk);
      } catch (err) {
        this.fail(new AdbError('PROTOCOL', `${this.where()}: ${err.message}`));
        return;
      }
      for (const packet of packets) {
        this.dispatch(packet);
      }
    });
    socket.on('error', (err) => {
      const code = UNREACHABLE_CODES.has(err.code) && !this.connected ? 'UNREACHABLE' : 'CLOSED';
      this.fail(new AdbError(code, `${this.where()}: ${err.code ?? err.message}`));
    });
    socket.on('close', () => {
      if (this.handshake?.keySent && !this.connected) {
        this.fail(new AdbError('AUTH_PENDING', `${this.where()}: debugging prompt not accepted`));
      } else {
        this.fail(new AdbError('CLOSED', `${this.where()}: connection closed`));
      }
    });
    return promise;
  }

  where() {
    return `${this.host}:${this.port}`;
  }

  send(command, arg0, arg1, data) {
    if (this.socket && !this.socket.destroyed) {
      this.socket.write(encodePacket(command, arg0, arg1, data));
    }
  }

  dispatch(packet) {
    if (!this.connected) {
      this.onHandshakePacket(packet);
      return;
    }
    const stream = this.streams.get(packet.arg1);
    switch (packet.command) {
      case COMMANDS.OKAY:
        stream?.onOkay(packet.arg0);
        break;
      case COMMANDS.WRTE:
        // Acknowledge every chunk, or the device stops sending.
        this.send(COMMANDS.OKAY, packet.arg1, packet.arg0);
        stream?.onData(packet.data);
        break;
      case COMMANDS.CLSE:
        if (stream) {
          this.send(COMMANDS.CLSE, packet.arg1, packet.arg0);
          stream.onClose();
        }
        break;
      default:
        // CNXN again (device restarted adbd) or anything else: start over.
        this.fail(
          new AdbError('PROTOCOL', `${this.where()}: unexpected ${commandName(packet.command)}`),
        );
    }
  }

  onHandshakePacket(packet) {
    const handshake = this.handshake;
    if (packet.command === COMMANDS.CNXN) {
      this.connected = true;
      clearTimeout(this.handshakeTimer);
      this.deviceMaxData = packet.arg1 || MAX_LEGACY_DATA;
      this.banner = packet.data.toString('utf8').replace(/\0+$/, '');
      handshake.resolve({ banner: this.banner });
      return;
    }
    if (packet.command === COMMANDS.STLS) {
      this.fail(
        new AdbError(
          'TLS_REQUIRED',
          `${this.where()}: this port asks for wireless-debugging pairing (TLS), use the network debugging port`,
        ),
      );
      return;
    }
    if (packet.command !== COMMANDS.AUTH || packet.arg0 !== AUTH_TOKEN) {
      this.fail(
        new AdbError('PROTOCOL', `${this.where()}: unexpected ${commandName(packet.command)}`),
      );
      return;
    }
    if (!handshake.signed) {
      handshake.signed = true;
      this.send(COMMANDS.AUTH, AUTH_SIGNATURE, 0, signToken(this.privateKey, packet.data));
      return;
    }
    // A second token: the device refused the signature, our key is unknown.
    if (!handshake.sendPublicKey) {
      this.fail(new AdbError('UNAUTHORIZED', `${this.where()}: key not authorized on the device`));
      return;
    }
    if (handshake.keySent) {
      return;
    }
    handshake.keySent = true;
    this.send(COMMANDS.AUTH, AUTH_RSAPUBLICKEY, 0, androidPublicKey(this.privateKey));
    clearTimeout(this.handshakeTimer);
    this.handshakeTimer = setTimeout(
      () =>
        this.fail(new AdbError('AUTH_PENDING', `${this.where()}: debugging prompt not accepted`)),
      handshake.authTimeoutMs,
    );
  }

  /**
   * Runs one shell command and resolves with its whole output (stdout and
   * stderr mixed, as the legacy `shell:` service gives them).
   * @param {string} command
   * @param {{ timeoutMs?: number }} [options]
   */
  shell(command, { timeoutMs = 10_000 } = {}) {
    if (!this.connected || this.closed) {
      return Promise.reject(new AdbError('CLOSED', `${this.where()}: not connected`));
    }
    const payload = Buffer.from(`shell:${command}\0`, 'utf8');
    if (payload.length > Math.min(this.deviceMaxData, MAX_LEGACY_DATA)) {
      return Promise.reject(new AdbError('PROTOCOL', 'command too long'));
    }
    const localId = this.nextLocalId;
    this.nextLocalId = (this.nextLocalId % 0x7fffffff) + 1;
    return new Promise((resolve, reject) => {
      const chunks = [];
      const finish = (err) => {
        clearTimeout(timer);
        this.streams.delete(localId);
        if (err) {
          reject(err);
        } else {
          resolve(Buffer.concat(chunks).toString('utf8'));
        }
      };
      const timer = setTimeout(() => {
        const stream = this.streams.get(localId);
        if (stream?.remoteId) {
          this.send(COMMANDS.CLSE, localId, stream.remoteId);
        }
        finish(new AdbError('TIMEOUT', `${this.where()}: command timed out`));
      }, timeoutMs);
      this.streams.set(localId, {
        remoteId: 0,
        onOkay(remoteId) {
          this.remoteId = remoteId;
        },
        onData(data) {
          chunks.push(data);
        },
        onClose() {
          // CLSE before any OKAY: the device refused to open the service.
          if (!this.remoteId) {
            finish(new AdbError('PROTOCOL', 'shell service refused'));
          } else {
            finish();
          }
        },
        onFail: finish,
      });
      this.send(COMMANDS.OPEN, localId, 0, payload);
    });
  }

  fail(err) {
    if (this.closed) {
      return;
    }
    this.closed = true;
    clearTimeout(this.handshakeTimer);
    if (!this.connected) {
      this.handshake?.reject(err);
    }
    for (const stream of this.streams.values()) {
      stream.onFail(err);
    }
    this.streams.clear();
    this.socket?.destroy();
    this.connected = false;
    for (const listener of this.onCloseListeners) {
      listener(err);
    }
  }

  close() {
    this.fail(new AdbError('CLOSED', `${this.where()}: closed`));
  }
}
