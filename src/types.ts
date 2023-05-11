import { Express, Response } from 'express';
import { Server } from 'http';

export type HttpTerminatorConfig = {
  gracefulTerminationTimeout?: number;
  app: Express;
  server: Server;
};

export type HttpTerminator = {
  terminate: () => Promise<void>;
  responses: Set<Response>;
};
