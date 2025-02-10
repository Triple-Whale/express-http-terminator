import type { HttpTerminator, HttpTerminatorConfig } from './types';
import { Socket } from 'net';

export function createHttpTerminator(configurationInput: HttpTerminatorConfig): HttpTerminator {
  const { gracefulTerminationTimeout, server } = configurationInput;

  const sockets = new Set<Socket>();

  let terminating: Promise<void> | undefined;

  server.on('connection', (socket) => {
    socket.once('close', () => {
      sockets.delete(socket);
    });
    if (terminating) {
      socket.end();
    } else {
      sockets.add(socket);
    }
  });

  async function terminate(): Promise<void> {
    process.env.TW_TERMINATING = 'true';
    if (terminating) {
      console.warn('already terminating HTTP server');
      return terminating;
    }

    let resolveTerminating;
    let rejectTerminating;

    terminating = new Promise((resolve, reject) => {
      resolveTerminating = resolve;
      rejectTerminating = reject;
    });

    server.on('request', (_incomingMessage, outgoingMessage) => {
      if (!outgoingMessage.headersSent) {
        outgoingMessage.setHeader('connection', 'close');
      }
      const socket = outgoingMessage.socket;
      // wait for the response to finish before closing the server
      outgoingMessage.on('finish', () => {
        socket.end();
      });
    });

    for (const socket of sockets) {
      if (socket.destroyed) {
        sockets.delete(socket);
        continue;
      }

      // @ts-ignore
      const serverResponse = socket._httpMessage;

      if (serverResponse) {
        if (!serverResponse.headersSent) {
          serverResponse.setHeader('connection', 'close');
        }
        continue;
      }

      // no _httpMessage means keep-alive socket with no active request
      socket.end();
    }

    try {
      // wait for sockets.length to reach 0, with timeout, and check again every 20 ms
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          clearInterval(interval);
          reject(new Error('timeout'));
        }, gracefulTerminationTimeout);

        const interval = setInterval(() => {
          if (sockets.size === 0) {
            clearInterval(interval);
            clearTimeout(timeout);
            resolve();
          }
        }, 20);
      });
    } catch (error) {
      for (const socket of sockets) {
        socket.end();
      }
    }

    server.closeIdleConnections();
    server.close((error) => {
      if (error) {
        rejectTerminating(error);
      } else {
        resolveTerminating();
      }
    });

    return terminating;
  }

  return {
    sockets,
    terminate,
  };
}
