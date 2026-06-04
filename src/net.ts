/** Loopback remote addresses (IPv4, IPv6, and IPv4-mapped IPv6). */
const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

export function isLoopbackAddress(addr: string | undefined | null): boolean {
  return !!addr && LOOPBACK.has(addr);
}

/** Whether a host bind address is loopback-only (not reachable from the network). */
export function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}
