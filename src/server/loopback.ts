const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

export function resolveLoopbackHost(value = '127.0.0.1') {
  if (!LOOPBACK_HOSTS.has(value)) {
    throw new Error(`Refusing to bind non-loopback host: ${value}`);
  }
  return value;
}
