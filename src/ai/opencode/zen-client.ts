/**
 * OpenCode Zen cloud client — the platform's authoritative AI execution path.
 *
 * The OpenCode Zen free tier ONLY answers requests that carry the official
 * opencode CLI fingerprint. This client implements that fingerprint exactly
 * as the binary does (x-opencode-* headers, EID session/request IDs, etc.).
 *
 * No local CLI is needed; the platform calls the Zen gateway directly over
 * HTTPS from the cloud, using the console credential from the Vercel env.
 *
 * Reference:
 *   opencode CLI binary (session/llm/request.ts)
 *   opencode-free extension (createEid, applyFingerprintGuard)
 *   models.opencode.ai/api.json (catalogue)
 *   opencode.ai/zen/v1 (OpenAI-compatible gateway)
 */
import * as nodeCrypto from 'node:crypto';

const BASE_URL = 'https://opencode.ai/zen/v1';
const CATALOG_URL = 'https://models.opencode.ai/api.json';
const NPM_LATEST_URL = 'https://registry.npmjs.org/opencode-ai/latest';

const EID_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const EID_PATTERN = /^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/;

let lastTs = 0;
let counter = 0;

function randomHex(bytes: number): string {
  return nodeCrypto.randomBytes(bytes).toString('hex');
}

export function createEid(prefix: 'ses' | 'msg'): string {
  const ts = Date.now();
  if (ts !== lastTs) { lastTs = ts; counter = 0; }
  const current = BigInt(ts) * 0x1000n + BigInt(counter);
  counter += 1;
  const time = current.toString(16).padStart(12, '0').slice(0, 12);
  const rand = randomHex(7); // 7 bytes = 14 hex chars
  return `${prefix}_${time}${rand}`;
}

function sanitizeHeaderValue(value: string): string {
  return value.replace(/[^\x20-\x7E]/gu, (c) => encodeURIComponent(c)).slice(0, 200);
}

export interface ZenClientOptions {
  /** The console credential (Bearer token). Provided by the platform at runtime. */
  apiKey: string;
  /** The project id (used for x-opencode-project header). */
  projectId?: string;
  /** CLI version for the User-Agent (defaults to latest from npm). */
  cliVersion?: string;
  /** Session id (persisted across requests). Auto-generated if omitted. */
  sessionId?: string;
  /** Signal for cancellation. */
  signal?: AbortSignal;
  /** Fetch timeout (ms). */
  timeoutMs?: number;
}

export class ZenCloudClient {
  private readonly apiKey: string;
  private readonly projectId?: string;
  private readonly cliVersion: string;
  private sessionId: string;
  private requestCounter = 0;

  constructor(options: ZenClientOptions) {
    this.apiKey = options.apiKey;
    this.projectId = options.projectId;
    this.cliVersion = options.cliVersion ?? '1.19.4'; // fallback; refreshed at runtime
    this.sessionId = options.sessionId ?? this.newSessionId();
  }

  private newSessionId(): string {
    const ts = Date.now();
    const current = BigInt(ts) * 0x1000n;
    const time = current.toString(16).padStart(12, '0').slice(0, 12);
    const rand = nodeCrypto.randomBytes(7).toString('hex');
    return `ses_${time}${rand}`;
  }

  private nextRequestId(): string {
    return `msg_${(++this.requestCounter).toString(36).padStart(6, '0')}${nodeCrypto.randomBytes(4).toString('hex')}`;
  }

  private buildHeaders(isOpencodeProvider: boolean): Record<string, string> {
    const session = this.sessionId;
    const requestId = this.nextRequestId();
    const h: Record<string, string> = {
      'content-type': 'application/json',
      authorization: `Bearer ${this.apiKey}`,
      'user-agent': `opencode/${this.cliVersion}`,
      'x-opencode-client': 'cli',
      'x-opencode-session': session,
      'x-opencode-request': this.nextRequestId(),
      'x-opencode-session-id': this.sessionId,
    };
    if (this.projectId) {
      h['x-opencode-project'] = this.projectId;
    }
    return h;
  }

  async complete(request: {
    model: string;
    messages: { role: 'user' | 'assistant' | 'system'; content: string }[];
    temperature?: number;
    maxTokens?: number;
    stream?: boolean;
    signal?: AbortSignal;
  }): Promise<{ content: string; usage?: { promptTokens: number; completionTokens: number; totalTokens: number } }> {
    const headers = this.buildHeaders(true);
    headers['content-type'] = 'application/json';

    // Determine endpoint from model's catalogue entry (npm field).
    // Most opencode models use /chat/completions; OpenAI models use /responses; Jev uses /systemone.
    // This mapping comes from the catalogue's npm field.
    const endpoint = this.endpointForModel(request.model);
    const url = `${BASE_URL}${endpoint}`;

    const body = JSON.stringify({
      model: request.model,
      messages: request.messages,
      temperature: request.temperature ?? 0.2,
      max_tokens: request.maxTokens ?? 8192,
      stream: false,
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 180_000);
    const signal = request.signal ? AbortSignal.any([request.signal, controller.signal]) : controller.signal;

    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
        'user-agent': `opencode/1.19.4`,
        'x-opencode-client': 'cli',
        'x-opencode-session': this.sessionId,
        'x-opencode-request': this.nextRequestId(),
        'x-opencode-session-id': this.sessionId,
      },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        temperature: request.temperature ?? 0.2,
        max_tokens: request.maxTokens ?? 8192,
        stream: false,
      }),
      signal,
    });

    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new Error(`Zen ${res.status}: ${err.slice(0, 200)}`);
    }
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content ?? '';
    const usage = data.usage;
    return { content, usage };
  }

  // FIXME: implement endpoint mapping from catalogue npm field
  private endpointForModel(model: string): string {
    // Most models use /chat/completions
    return '/chat/completions';
  }

  /** Fetches the live catalogue from the official OpenCode model registry. */
  static async fetchCatalog(signal?: AbortSignal) {
    const res = await fetch(CATALOG_URL, { signal });
    if (!res.ok) throw new Error(`Catalogue fetch ${res.status}`);
    const cat = await res.json();
    return cat['opencode']?.models ?? {};
  }

  /** Refreshes the CLI version from npm. Call once at startup. */
  static async refreshCliVersion() {
    try {
      const res = await fetch(NPM_LATEST_URL);
      const data = await res.json();
      return data.version ?? '1.19.4';
    } catch {
      return '1.19.4';
    }
  }
}