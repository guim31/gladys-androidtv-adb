// -----------------------------------------------------------------------------
// A fake adbd on 127.0.0.1: the ADB handshake with real RSA checks (it
// verifies the signatures against the keys it authorized, like a device),
// the "Allow debugging?" prompt, and `shell:` streams answered by a callback.
// -----------------------------------------------------------------------------

import net from 'node:net';
import { constants, createPublicKey, publicDecrypt, randomBytes } from 'node:crypto';
import { parseAndroidPublicKey } from '../../src/adb/keys.js';
import {
  AUTH_RSAPUBLICKEY,
  AUTH_SIGNATURE,
  AUTH_TOKEN,
  COMMANDS,
  PacketReader,
  encodePacket,
} from '../../src/adb/protocol.js';

const SHA1_DIGEST_INFO = Buffer.from('3021300906052b0e03021a05000414', 'hex');

/**
 * @param {object} [options]
 * @param {(command: string) => string|Promise<string>} [options.respond] shell output
 * @param {boolean} [options.autoAccept] the user accepts the prompt at once
 * @param {boolean} [options.secure] false: no authentication (ro.adb.secure=0)
 * @param {boolean} [options.tls] answer STLS (a wireless-debugging port)
 * @param {number} [options.chunk] WRTE payload size
 */
export async function startFakeAdbd(options = {}) {
  const device = {
    respond: options.respond ?? (() => ''),
    autoAccept: options.autoAccept ?? false,
    secure: options.secure ?? true,
    tls: options.tls ?? false,
    chunk: options.chunk ?? 1024,
    banner: 'device::ro.product.name=fake;ro.product.model=Fake;ro.product.device=fake;\0',
    /** @type {import('node:crypto').KeyObject[]} */
    authorized: [],
    prompts: 0,
    pending: [],
    commands: [],
    connections: 0,
    open: new Set(),
    /** Authorizes a key ahead (as if "Always allow" had been ticked before). */
    authorize(privateKeyPem) {
      device.authorized.push(createPublicKey(privateKeyPem));
    },
    /** The user taps "Allow" on the pending prompts. */
    accept() {
      for (const { socket, key } of device.pending.splice(0)) {
        device.authorized.push(key);
        socket.write(encodePacket(COMMANDS.CNXN, 0x01000000, 4096, device.banner));
      }
    },
  };

  const server = net.createServer((socket) => {
    device.connections += 1;
    device.open.add(socket);
    socket.on('close', () => device.open.delete(socket));
    socket.on('error', () => {});
    const reader = new PacketReader();
    let token = null;
    let nextRemoteId = 100;
    const streams = new Map();
    const send = (command, arg0, arg1, data) => {
      if (!socket.destroyed) {
        socket.write(encodePacket(command, arg0, arg1, data));
      }
    };
    const sendToken = () => {
      token = randomBytes(20);
      send(COMMANDS.AUTH, AUTH_TOKEN, 0, token);
    };
    const verify = (signature) =>
      device.authorized.some((key) => {
        try {
          const clear = publicDecrypt({ key, padding: constants.RSA_PKCS1_PADDING }, signature);
          return clear.equals(Buffer.concat([SHA1_DIGEST_INFO, token]));
        } catch {
          return false;
        }
      });

    async function runShell(localId, remoteId, command) {
      device.commands.push(command);
      let output;
      try {
        output = Buffer.from(String(await device.respond(command)), 'utf8');
      } catch {
        output = Buffer.from('error\n');
      }
      for (let offset = 0; offset < output.length; offset += device.chunk) {
        const acked = new Promise((resolve) => streams.set(remoteId, resolve));
        send(COMMANDS.WRTE, remoteId, localId, output.subarray(offset, offset + device.chunk));
        await acked;
      }
      send(COMMANDS.CLSE, remoteId, localId);
    }

    socket.on('data', (chunk) => {
      for (const packet of reader.push(chunk)) {
        if (packet.command === COMMANDS.CNXN) {
          if (device.tls) {
            send(COMMANDS.STLS, 0x01000000, 0);
          } else if (device.secure) {
            sendToken();
          } else {
            send(COMMANDS.CNXN, 0x01000000, 4096, device.banner);
          }
        } else if (packet.command === COMMANDS.AUTH && packet.arg0 === AUTH_SIGNATURE) {
          if (verify(packet.data)) {
            send(COMMANDS.CNXN, 0x01000000, 4096, device.banner);
          } else {
            sendToken();
          }
        } else if (packet.command === COMMANDS.AUTH && packet.arg0 === AUTH_RSAPUBLICKEY) {
          device.prompts += 1;
          const key = parseAndroidPublicKey(packet.data);
          if (device.autoAccept) {
            device.authorized.push(key);
            send(COMMANDS.CNXN, 0x01000000, 4096, device.banner);
          } else {
            device.pending.push({ socket, key });
          }
        } else if (packet.command === COMMANDS.OPEN) {
          const service = packet.data.toString('utf8').replace(/\0$/, '');
          const remoteId = nextRemoteId++;
          if (!service.startsWith('shell:')) {
            send(COMMANDS.CLSE, 0, packet.arg0);
            continue;
          }
          send(COMMANDS.OKAY, remoteId, packet.arg0);
          runShell(packet.arg0, remoteId, service.slice('shell:'.length));
        } else if (packet.command === COMMANDS.OKAY) {
          const resolve = streams.get(packet.arg1);
          streams.delete(packet.arg1);
          resolve?.();
        }
      }
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  device.host = '127.0.0.1';
  device.port = server.address().port;
  device.address = `${device.host}:${device.port}`;
  /** Drops every connection (the device went to deep sleep). */
  device.dropConnections = () => {
    for (const socket of device.open) {
      socket.destroy();
    }
  };
  device.close = async () => {
    device.dropConnections();
    await new Promise((resolve) => server.close(resolve));
  };
  return device;
}

/** A port where nothing listens (a device off, or debugging disabled). */
export async function closedPort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}
