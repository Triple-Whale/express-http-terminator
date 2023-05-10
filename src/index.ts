import waitFor from 'p-wait-for';
import type { HttpTerminatorConfig } from './types';
import { NextFunction, Request, Response } from 'express';

export function createInternalHttpTerminator(configurationInput: HttpTerminatorConfig) {
  const { app, gracefulTerminationTimeout, server } = configurationInput;

  const requests = new Set<Request>();

  let terminating: Promise<void> | undefined;

  function trackActive(req: Request, res: Response, next: NextFunction) {
    requests.add(req);

    req.once('close', () => {
      requests.delete(req);
    });
    if (terminating) {
      res.setHeader('connection', 'close');
    }
    next();
  }
  app.use(trackActive);

  async function terminate() {
    if (terminating) {
      console.log('already terminating HTTP server');

      return terminating;
    }

    let resolveTerminating;
    let rejectTerminating;

    terminating = new Promise((resolve, reject) => {
      resolveTerminating = resolve;
      rejectTerminating = reject;
    });

    try {
      await waitFor(
        () => {
          return requests.size === 0;
        },
        {
          interval: 10,
          timeout: gracefulTerminationTimeout,
        }
      );
    } catch {
      // Ignore timeout errors
    } finally {
      for (const res of requests) {
        res.socket?.destroy();
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
    requests,
    terminate,
  };
}
