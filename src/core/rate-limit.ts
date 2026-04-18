/**
 * Rate limiting using:
 * - Redis ZSET sliding window (when Redis is enabled): precise, no fixed-window cliff
 *   Key:    rl:{site}:{identifier}
 *   Score:  timestamp in ms
 *   Member: random token (unique per request)
 *
 * - In-memory fixed window (fallback when Redis is not configured)
 */
import { getRateLimitConfig, getSiteName } from './config';
import { getRedis } from './cache';

/** In-memory fallback: key → [count, windowStartEpochSec] */
const memStore = new Map<string, [number, number]>();

setInterval(() => {
    const cfg = getRateLimitConfig();
    if (!cfg) return;
    const now = Math.floor(Date.now() / 1000);
    for (const [k, [, windowStart]] of memStore) {
        if (now - windowStart > (cfg as any).windowSec) memStore.delete(k);
    }
}, 5 * 60 * 1000).unref?.();

// ---------------------------------------------------------------------------
// Redis sliding-window implementation (Lua for atomicity)
// ---------------------------------------------------------------------------

const LUA_SLIDING_WINDOW = `
local key    = KEYS[1]
local now    = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local max    = tonumber(ARGV[3])
local token  = ARGV[4]

-- Prune entries older than the window
redis.call('ZREMRANGEBYSCORE', key, 0, now - window * 1000)

-- Count remaining requests in window
local count = redis.call('ZCARD', key)

if count < max then
    redis.call('ZADD', key, now, token)
    redis.call('PEXPIRE', key, window * 1000)
    return 1  -- allowed
else
    return 0  -- rate limited
end
`;

async function checkRateLimitRedis(identifier: string): Promise<boolean> {
    const redis = getRedis();
    const cfg = getRateLimitConfig();
    if (!redis || !cfg) return true;

    const { max, windowSec } = cfg as Required<typeof cfg>;
    const key = `rl:${getSiteName()}:${identifier}`;
    const now = Date.now();
    const token = `${now}-${Math.random().toString(36).slice(2)}`;

    try {
        const result: number = await redis.eval(
            LUA_SLIDING_WINDOW,
            1,   // number of KEYS
            key,
            now,
            windowSec,
            max,
            token,
        );
        return result === 1;
    } catch {
        return true; // fail open — never block on Redis errors
    }
}

// ---------------------------------------------------------------------------
// In-memory fixed-window fallback
// ---------------------------------------------------------------------------

function checkRateLimitMemory(identifier: string): boolean {
    const cfg = getRateLimitConfig();
    if (cfg === false) return true;
    const { max, windowSec } = cfg as Required<typeof cfg>;
    const now = Math.floor(Date.now() / 1000);
    const entry = memStore.get(identifier);

    if (!entry || now - entry[1] >= windowSec) {
        memStore.set(identifier, [1, now]);
        return true;
    }
    const [count, windowStart] = entry;
    if (count >= max) return false;
    memStore.set(identifier, [count + 1, windowStart]);
    return true;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns true when the request is allowed, false when rate-limited.
 * Uses Redis ZSET sliding window when available, in-memory fixed window otherwise.
 */
export async function checkRateLimit(identifier: string): Promise<boolean> {
    const cfg = getRateLimitConfig();
    if (cfg === false) return true;

    const redis = getRedis();
    return redis
        ? checkRateLimitRedis(identifier)
        : checkRateLimitMemory(identifier);
}

/** Derive best-effort IP from a Next.js / Web API Request */
export function getRequestIp(req: Request): string {
    const nextReq = req as any;
    if (nextReq.ip) return nextReq.ip;
    
    // Fallback if not hosted on Vercel or similar platforms that populate req.ip.
    // Note: If you self-host, ensure your reverse proxy (e.g. Nginx, Cloudflare) properly overwrites
    // these headers to prevent rate limit IP spoofing.
    const headers = nextReq.headers as Headers;
    return (
        headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
        headers.get('x-real-ip') ||
        'unknown'
    );
}
