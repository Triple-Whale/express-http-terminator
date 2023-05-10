import { Express } from 'express';
import { Server } from 'http';

export type HttpTerminatorConfig = {
  gracefulTerminationTimeout?: number;
  app: Express;
  server: Server;
};
