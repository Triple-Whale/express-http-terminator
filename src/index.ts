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
        sockets.delete(socket);
      });
    }
  });

  function destroySocket(socket: Socket) {
    socket.destroy();
    sockets.delete(socket);
  }

  async function terminate() {
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

    server.on('request', (incomingMessage, outgoingMessage) => {
      if (!outgoingMessage.headersSent) {
        outgoingMessage.setHeader('connection', 'close');
      }
    });

    for (const socket of sockets) {
      // @ts-expect-error Unclear if I am using wrong type or how else this should be handled.
      const serverResponse = socket._httpMessage;

      if (serverResponse) {
        if (!serverResponse.headersSent) {
          serverResponse.setHeader('connection', 'close');
        }

        continue;
      }
      destroySocket(socket);
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
      console.error('httpTerminator', error);
    } finally {
      for (const socket of sockets) {
        destroySocket(socket);
      }
    }

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
