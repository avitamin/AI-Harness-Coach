import { AppState } from './app-state.js';
import { createHttpServer } from './http-app.js';
import { resolveLoopbackHost } from './loopback.js';

const state = new AppState();
await state.initialize();

const host = resolveLoopbackHost(process.env.HOST ?? '127.0.0.1');
const port = Number(process.env.PORT ?? 4317);
const server = createHttpServer(state);

server.listen(port, host, () => {
  console.log(`AI Harness Coach listening on http://${host}:${port}`);
});
