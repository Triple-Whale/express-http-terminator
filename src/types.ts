import { Express } from 'express';
import { Server } from 'http';
import { Socket } from 'net';

export type HttpTerminatorConfig = {
  gracefulTerminationTimeout?: number;
  app: Express;
  server: Server;
};

export type HttpTerminator = {
  terminate: () => Promise<void>;
  sockets: Set<Socket>;
};
