/**
 * Real connectivity probe for the Execution Supervisor's Network Monitor
 * (LAW - NETWORK INTERRUPTION IS NOT A HANG / AUTOMATIC NETWORK RESUME).
 *
 * A probe is a genuine reachability check - DNS resolution followed by an
 * actual TCP connection to a well-known endpoint with a short deadline. It is
 * never guessed from "the last request worked". The probe is injectable so
 * tests and platform boundaries (control plane, Daytona, AI provider,
 * external services) can supply their own connectivity observation.
 *
 * Loss of one dependency must never be misclassified as total network loss:
 * callers observe the specific boundary they care about.
 */

import { lookup } from 'node:dns/promises';
import { connect } from 'node:net';

export interface NetworkProbeTarget {
  readonly host: string;
  readonly port: number;
}

export interface NetworkProbeResult {
  readonly up: boolean;
  readonly detail: string;
  readonly at: string;
}

export type NetworkProbe = () => Promise<NetworkProbeResult>;

const DEFAULT_TARGETS: readonly NetworkProbeTarget[] = [
  { host: '1.1.1.1', port: 443 },
  { host: '8.8.8.8', port: 443 },
];

function tcpConnect(host: string, port: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const socket = connect({ host, port, signal: controller.signal });
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
    const cleanup = (): void => {
      clearTimeout(timer);
      socket.destroy();
    };
    socket.once('connect', () => {
      cleanup();
      resolve();
    });
    socket.once('error', (error) => {
      cleanup();
      reject(error);
    });
  });
}

/**
 * Real connectivity probe: resolves each target's hostname via the system DNS
 * and opens an actual TCP connection. The probe reports up on the first
 * reachable target. A failed DNS resolution or refused/aborted connection is
 * honest evidence that the boundary is currently unreachable.
 */
export function defaultNetworkProbe(options?: {
  targets?: readonly NetworkProbeTarget[];
  timeoutMs?: number;
}): NetworkProbe {
  const targets = options?.targets ?? DEFAULT_TARGETS;
  const timeoutMs = options?.timeoutMs ?? 2500;
  return async (): Promise<NetworkProbeResult> => {
    const at = new Date().toISOString();
    for (const target of targets) {
      try {
        await lookup(target.host);
        await tcpConnect(target.host, target.port, timeoutMs);
        return { up: true, detail: `reachable ${target.host}:${target.port}`, at };
      } catch {
        // try the next target; all-targets failure means the boundary is down
      }
    }
    const detail = targets
      .map((t) => `${t.host}:${t.port}`)
      .join(', ');
    return {
      up: false,
      detail: `no target reachable: ${detail}`,
      at,
    };
  };
}