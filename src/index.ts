import waitFor from 'p-wait-for';
import type { HttpTerminatorConfig } from './types';
import { NextFunction, Request, Response } from 'express';

export function createHttpTerminator(configurationInput: HttpTerminatorConfig) {
  const { app, gracefulTerminationTimeout, server } = configurationInput;

  const responses = new Set<Response>();

  let terminating: Promise<void> | undefined;

  function trackActive(req: Request, res: Response, next: NextFunction) {
    responses.add(res);
    res.once('close', () => {
      responses.delete(res);
    });
    res.req.once('close', () => {
      responses.delete(res);
    });
    if (terminating) {
      res.setHeader('connection', 'close');
    }
    next();
  }
  app.use(trackActive);

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

    try {
      await waitFor(
        () => {
          return responses.size === 0;
        },
        {
          interval: 10,
          timeout: gracefulTerminationTimeout,
        }
      );
    } catch (error) {
      console.error('httpTerminator', error);
    } finally {
      for (const res of responses) {
        res.socket?.destroy();
      }
    }

    server.closeAllConnections();
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
    responses,
    terminate,
  };
}
