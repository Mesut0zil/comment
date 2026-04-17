import knex, { type Knex } from 'knex';

export interface CommentConfig {
    knexInstance?: Knex;
    dbUrl?: string;
    tableName?: string;
}

let internalKnex: Knex | null = null;
let currentConfig: CommentConfig = {
    tableName: 'comments',
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
