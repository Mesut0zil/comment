/**
 * Redis cache layer using native Redis data types:
 *
 * 1. ZSET  – ordered comment index per entity (lexicographic cursor pagination)
 *    Key:    comment:{site}:idx:{entity_path}
 *    Score:  0 (all equal → enables ZRANGEBYLEX)
 *    Member: {comment_path}:{id}
 *
 * 2. Hash  – per-comment data storage
 *    Key:    comment:{site}:data:{id}
 *    Fields: all CommentRow fields
 *
 * 3. ZSET  – sliding-window rate limiting (in rate-limit.ts)
 *    Key:    rl:{site}:{identifier}
 */
import { getRedisUrl, isRedisEnabled, getSiteName } from './config';
import type { CommentRow } from './services';

let _redis: any | null = null;

export function getRedis(): any | null {
    if (!isRedisEnabled()) return null;
    if (!_redis) {
        try {
            // ioredis is an optional peer dep
            const { default: Redis } = require('ioredis');
            _redis = new Redis(getRedisUrl()!, {
                lazyConnect: true,
                enableReadyCheck: false,
            });
        } catch {
            console.warn('[comment] ioredis not installed. Redis caching disabled. Run: npm i ioredis');
        }
    }
    return _redis;
}

function site() {
    return getSiteName();
}

function idxKey(entityPath: string) {
    return `comment:${site()}:idx:${entityPath}`;
}

function dataKey(id: number) {
    return `comment:${site()}:data:${id}`;
}

/** Lexicographic member format: "{padded_comment_path}:{id}" */
function toMember(row: CommentRow): string {
    return `${row.comment_path}:${row.id}`;
}

const DEFAULT_TTL = 120; // seconds

// ---------------------------------------------------------------------------
// Write helpers
// ---------------------------------------------------------------------------

/**
 * Index a list of comments into Redis:
 *  - Populate the ZSET index (for cursor-based listing)
 *  - Store each row as a Hash (for O(1) fetches)
 */
export async function cacheIndexComments(
    entityPath: string,
    rows: CommentRow[],
    ttl = DEFAULT_TTL,
): Promise<void> {
    const redis = getRedis();
    if (!redis || rows.length === 0) return;

    const pipeline = redis.pipeline();
    const idx = idxKey(entityPath);

    for (const row of rows) {
        // ZSET index: score=0, member="{comment_path}:{id}"
        pipeline.zadd(idx, 0, toMember(row));

        // Hash: one field per CommentRow property
        pipeline.hset(dataKey(row.id), {
            id: row.id,
            site: row.site,
            user_id: row.user_id,
            content: row.content,
            depth: row.depth,
            comment_path: row.comment_path,
            entity_path: row.entity_path,
            parent_id: row.parent_id ?? '',
            created_at: row.created_at,
            updated_at: row.updated_at,
            deleted_at: row.deleted_at ?? '',
            author_name: row.author_name ?? '',
            author_avatar: row.author_avatar ?? '',
        });
        pipeline.expire(dataKey(row.id), ttl);
    }

    pipeline.expire(idx, ttl);
    await pipeline.exec().catch(() => null);
}

// ---------------------------------------------------------------------------
// Read helpers
// ---------------------------------------------------------------------------

/**
 * Fetch a page of comments from the ZSET index using ZRANGEBYLEX,
 * then bulk-load each row's Hash in a pipeline.
 *
 * Returns null when the index key doesn't exist (cache miss).
 */
export async function cacheFetchPage(
    entityPath: string,
    afterCursorPath: string | null,
    pageSize: number,
): Promise<CommentRow[] | null> {
    const redis = getRedis();
    if (!redis) return null;

    const idx = idxKey(entityPath);

    // ZRANGEBYLEX: members are lexicographically ordered.
    // Marker "-" = from the beginning, "[{value}" = inclusive lower bound.
    const min = afterCursorPath ? `(${afterCursorPath}` : '-';
    const max = '+';

    let members: string[];
    try {
        // Fetch pageSize+1 so we can detect hasMore
        members = await redis.zrangebylex(idx, min, max, 'LIMIT', 0, pageSize + 1);
    } catch {
        return null;
    }

    if (!members || members.length === 0) {
        // Could be a genuine cache miss or an empty entity
        const exists = await redis.exists(idx).catch(() => 0);
        return exists ? [] : null; // null = cache miss
    }

    // Extract IDs from members (format: "{comment_path}:{id}")
    const ids = members.map((m: string) => Number(m.split(':').pop()!));

    // Bulk-fetch Hashes in a pipeline
    const pipeline = redis.pipeline();
    for (const id of ids) pipeline.hgetall(dataKey(id));
    const results: Array<[Error | null, Record<string, string> | null]> = await pipeline.exec();

    const rows: CommentRow[] = [];
    for (const [err, hash] of results) {
        if (err || !hash || !hash['id']) continue; // partial cache miss → skip
        rows.push({
            id: Number(hash['id']),
            site: hash['site'] as string,
            user_id: hash['user_id'] as string,
            content: hash['content'] as string,
            depth: Number(hash['depth']),
            comment_path: hash['comment_path'] as string,
            entity_path: hash['entity_path'] as string,
            parent_id: hash['parent_id'] ? Number(hash['parent_id']) : null,
            created_at: hash['created_at'] as string,
            updated_at: hash['updated_at'] as string,
            deleted_at: hash['deleted_at'] || null,
            author_name: hash['author_name'] || null,
            author_avatar: hash['author_avatar'] || null,
        });
    }

    return rows;
}

// ---------------------------------------------------------------------------
// Invalidation
// ---------------------------------------------------------------------------

/** Remove the ZSET index for the entity (data Hashes expire via TTL automatically) */
export async function cacheInvalidateEntity(entityPath: string): Promise<void> {
    const redis = getRedis();
    if (!redis) return;
    await redis.del(idxKey(entityPath)).catch(() => null);
}

/** Remove the Hash for a single comment ID */
export async function cacheInvalidateComment(id: number): Promise<void> {
    const redis = getRedis();
    if (!redis) return;
    await redis.del(dataKey(id)).catch(() => null);
}

/**
 * Pushes a single new comment into the cache if the index currently exists.
 * Does NOT create a partial cache if it was already cleared/expired.
 */
export async function cachePushComment(
    entityPath: string,
    row: CommentRow,
    ttl = DEFAULT_TTL,
): Promise<void> {
    const redis = getRedis();
    if (!redis) return;

    const idx = idxKey(entityPath);
    // If the index doesn't exist, don't create a partial cache.
    // The next read will fully fetch and populate it.
    const exists = await redis.exists(idx).catch(() => 0);
    if (!exists) return;

    const pipeline = redis.pipeline();

    // ZSET index: score=0, member="{comment_path}:{id}"
    pipeline.zadd(idx, 0, toMember(row));

    // Hash: one field per CommentRow property
    pipeline.hset(dataKey(row.id), {
        id: row.id,
        site: row.site,
        user_id: row.user_id,
        content: row.content,
        depth: row.depth,
        comment_path: row.comment_path,
        entity_path: row.entity_path,
        parent_id: row.parent_id ?? '',
        created_at: row.created_at,
        updated_at: row.updated_at,
        deleted_at: row.deleted_at ?? '',
        author_name: row.author_name ?? '',
        author_avatar: row.author_avatar ?? '',
    });
    pipeline.expire(dataKey(row.id), ttl);

    // Refresh index TTL
    pipeline.expire(idx, ttl);

    await pipeline.exec().catch(() => null);
}

/**
 * Update the content of an existing cached comment.
 * If it's not cached, does nothing.
 */
export async function cacheUpdateCommentContent(id: number, content: string): Promise<void> {
    const redis = getRedis();
    if (!redis) return;

    const dKey = dataKey(id);
    const exists = await redis.exists(dKey).catch(() => 0);
    if (!exists) return;

    // Only update the content, keep the rest intact with same TTL
    await redis.hset(dKey, 'content', content).catch(() => null);
}

/**
 * Remove a comment from the cache completely incrementally.
 */
export async function cacheRemoveComment(entityPath: string, commentPath: string, id: number): Promise<void> {
    const redis = getRedis();
    if (!redis) return;

    const pipeline = redis.pipeline();
    pipeline.del(dataKey(id));
    pipeline.zrem(idxKey(entityPath), `${commentPath}:${id}`);
    await pipeline.exec().catch(() => null);
}
