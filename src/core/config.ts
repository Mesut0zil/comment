import knex, { type Knex } from 'knex';

export interface RateLimitConfig {
    /** Max requests per window per IP. Default: 60 */
    max?: number;
    /** Window size in seconds. Default: 60 */
    windowSec?: number;
}

export interface CommentConfig {
    knexInstance?: Knex;
    dbUrl?: string;
    tableName?: string;
    site?: string;
    /** ioredis-compatible URL, e.g. redis://localhost:6379. */
    redisUrl?: string;
    /** Explicitly enable Redis caching. Requires redisUrl to also be set. Default: false */
    enableRedis?: boolean;
    /** Rate limiting options for read operations (GET). Pass false to disable. */
    readRateLimit?: RateLimitConfig | false;
    /** Rate limiting options for write operations (POST, PUT, DELETE). Pass false to disable. */
    writeRateLimit?: RateLimitConfig | false;
    /** Default TTL (in seconds) for Redis cache. Default: 120 */
    cacheTtl?: number;
    /** Table name for users. If provided, comments will be left-joined to fetch author details. */
    userTableName?: string;
    /** User ID column name in user table. Default: 'id' */
    userIdCol?: string;
    /** Username column name in user table. Default: 'name' */
    userNameCol?: string;
    /** Avatar column name in user table. Default: 'avatar' */
    userAvatarCol?: string;
}

let internalKnex: Knex | null = null;
let currentConfig: CommentConfig = {
    tableName: 'comments',
    site: 'default',
    readRateLimit: {},
    writeRateLimit: {},
};

export function configure(config: CommentConfig) {
    currentConfig = { ...currentConfig, ...config };
}

export function getKnex(): Knex {
    if (currentConfig.knexInstance) return currentConfig.knexInstance;
    if (!internalKnex) {
        const url = currentConfig.dbUrl || process.env['COMMENT_DB_URL'];
        if (!url) {
            throw new Error('Comment package requires either a knexInstance or a dbUrl / COMMENT_DB_URL to be configured.');
        }
        const client = url.includes('sqlite') ? 'better-sqlite3' : 'mysql2'; // Simplistic client detect
        internalKnex = knex({
            client,
            connection: client === 'better-sqlite3' ? { filename: url.replace('sqlite://', '') } : url,
            useNullAsDefault: client === 'better-sqlite3'
        });
    }
    return internalKnex;
}

export function getTableName(): string {
    return currentConfig.tableName || process.env['COMMENT_TABLE_NAME'] || 'comments';
}

export function getSiteName(): string {
    return currentConfig.site || process.env['COMMENT_SITE_NAME'] || 'default';
}

export function getRedisUrl(): string | undefined {
    return currentConfig.redisUrl || process.env['COMMENT_REDIS_URL'];
}

export function isRedisEnabled(): boolean {
    const flag = currentConfig.enableRedis ?? process.env['COMMENT_ENABLE_REDIS'] === 'true';
    return flag === true && !!getRedisUrl();
}

export function getCacheTtl(): number {
    return currentConfig.cacheTtl ?? Number(process.env['COMMENT_CACHE_TTL'] ?? 120);
}

export function getReadRateLimitConfig(): RateLimitConfig | false {
    if (currentConfig.readRateLimit === false) return false;
    const cfg = currentConfig.readRateLimit || {};
    return {
        max: cfg.max ?? Number(process.env['COMMENT_READ_RATE_LIMIT_MAX'] ?? 60),
        windowSec: cfg.windowSec ?? Number(process.env['COMMENT_READ_RATE_LIMIT_WINDOW_SEC'] ?? 10),
    };
}

export function getWriteRateLimitConfig(): RateLimitConfig | false {
    if (currentConfig.writeRateLimit === false) return false;
    const cfg = currentConfig.writeRateLimit || {};
    return {
        max: cfg.max ?? Number(process.env['COMMENT_WRITE_RATE_LIMIT_MAX'] ?? 3),
        windowSec: cfg.windowSec ?? Number(process.env['COMMENT_WRITE_RATE_LIMIT_WINDOW_SEC'] ?? 10),
    };
}

export function getUserTableName(): string | undefined {
    return currentConfig.userTableName || process.env['COMMENT_USER_TABLE_NAME'];
}

export function getUserIdCol(): string {
    return currentConfig.userIdCol || process.env['COMMENT_USER_ID_COL'] || 'id';
}

export function getUserNameCol(): string {
    return currentConfig.userNameCol || process.env['COMMENT_USER_NAME_COL'] || 'name';
}

export function getUserAvatarCol(): string {
    return currentConfig.userAvatarCol || process.env['COMMENT_USER_AVATAR_COL'] || 'avatar';
}
