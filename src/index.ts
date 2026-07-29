import http from 'http';
import express from 'express';
import cors from 'cors';
import { Server } from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { env } from './config/env';
import { createHttpRouter } from './http/routes';
import { CitaadelRoom } from './rooms/CitaadelRoom';
import { AarenaRoom } from './rooms/AarenaRoom';
import { AarenaRhRoom } from './rooms/AarenaRhRoom';
import { StoreRoom } from './rooms/StoreRoom';

const app = express();

function originAllowed(origin: string): boolean {
  if (env.corsOrigins.includes('*') || env.corsOrigins.includes(origin)) {
    return true;
  }
  let hostname = '';
  try {
    hostname = new URL(origin).hostname;
  } catch {
    return false;
  }
  return env.corsOrigins.some((allowed) => {
    // Support "*.vercel.app" and "https://*.vercel.app"
    const star = allowed.match(/^(?:https?:\/\/)?\*\.(.+)$/i);
    if (star) {
      const root = star[1].toLowerCase();
      return hostname === root || hostname.endsWith(`.${root}`);
    }
    return false;
  });
}

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      // Never pass Error here — cors turns that into HTTP 500 and breaks browser probes.
      return callback(null, originAllowed(origin));
    },
    credentials: true,
  }),
);
app.use(express.json());
app.use(createHttpRouter());

const server = http.createServer(app);

const gameServer = new Server({
  transport: new WebSocketTransport({
    server,
  }),
});

gameServer.define('citaadel', CitaadelRoom);
gameServer.define('aarena', AarenaRoom);
gameServer.define('aarena-rh', AarenaRhRoom);
gameServer.define('store', StoreRoom).filterBy(['storeId']);

server.listen(env.port, env.host, () => {
  console.log(`[realm-server] HTTP+Colyseus listening on ${env.host}:${env.port}`);
  console.log(`[realm-server] publicUrl=${env.publicUrl}`);
  console.log(`[realm-server] cors=${env.corsOrigins.join(',')}`);
});
