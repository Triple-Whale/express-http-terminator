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
      socket.destroy();
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
      // not sure abt this
      sockets.add(socket);
      outgoingMessage.on('finish', () => {
        sockets.delete(socket);
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
      // I decide to not destroy it, but also not keep the server from draining.
      // later we call closeIdleConnections which will take care of destroying it.
      // hopefully this will result in less socket hang ups, as new connections coming in will get
      // the connection: close header set.
      sockets.delete(socket);
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
        socket.destroy();
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
