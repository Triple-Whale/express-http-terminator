import waitFor from 'p-wait-for';
import type { HttpTerminator, HttpTerminatorConfig } from './types';
import { Socket } from 'net';

export function createHttpTerminator(configurationInput: HttpTerminatorConfig): HttpTerminator {
  const { gracefulTerminationTimeout, server } = configurationInput;

  const sockets = new Set<Socket>();

  let terminating: Promise<void> | undefined;

  server.on('connection', (socket) => {
    if (terminating) {
      socket.destroy();
    } else {
      sockets.add(socket);
      socket.once('close', () => {
        // sleep 5 seconds before removing the socket
        // to allow queued requests to enter (knative)
        setTimeout(() => {
          sockets.delete(socket);
        }, 5000);
      });
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
      await waitFor(
        () => {
          return sockets.size === 0;
        },
        {
          interval: 10,
          timeout: gracefulTerminationTimeout,
        }
      );
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
