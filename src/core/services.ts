import { getKnex, getTableName, getSiteName, getUserTableName, getUserIdCol, getUserNameCol, getUserAvatarCol } from './config';
import { cacheFetchPage, cacheIndexComments, cacheInvalidateEntity, cacheInvalidateComment, cachePushComment, cacheUpdateCommentContent, cacheRemoveComment } from './cache';

export interface CommentInput {
    user_id: string;
    content: string;
    entity_path: string;
    parent_id?: number;
}

export interface CommentRow {
    id: number;
    site: string;
    user_id: string;
    content: string;
    depth: number;
    comment_path: string;
    entity_path: string;
    parent_id: number | null;
    created_at: string;
    updated_at: string;
    deleted_at: string | null;
    author_name?: string | null;
    author_avatar?: string | null;
}

// Generate the 4-digit padded ID for materialized paths
function padId(id: number): string {
    return id.toString().padStart(4, '0');
}

export async function createComment(data: CommentInput): Promise<CommentRow> {
    const knex = getKnex();
    const table = getTableName();

    return await knex.transaction(async (trx) => {
        // 1. Insert comment temporarily without a valid comment_path
        const [insertedId] = await trx(table).insert({
            site: getSiteName(),
            user_id: data.user_id,
            content: data.content,
            entity_path: data.entity_path,
            parent_id: data.parent_id || null,
            comment_path: '', // Placeholder
            depth: 0,
        });

        if (insertedId === undefined) throw new Error("Insert failed");

        let depth = 0;
        let commentPath = padId(insertedId);

        // 2. If it has a parent, calculate its true depth and comment_path
        if (data.parent_id) {
            const parent = await trx(table).where({ id: data.parent_id as number }).first();
            if (!parent) {
                throw new Error(`Parent comment ${data.parent_id} not found.`);
            }
            depth = parent.depth + 1;
            commentPath = `${parent.comment_path}/${padId(insertedId)}`;
        }

        // 3. Update the exact record with the calculated path and depth
        await trx(table)
            .where({ id: insertedId })
            .update({
                comment_path: commentPath,
                depth: depth
            });

        let finalRowQuery = trx(table).where({ [`${table}.id`]: insertedId });

        const userTable = getUserTableName();
        if (userTable) {
            const idCol = getUserIdCol();
            const nameCol = getUserNameCol();
            const avatarCol = getUserAvatarCol();
            finalRowQuery = finalRowQuery
                .leftJoin(userTable, `${table}.user_id`, `${userTable}.${idCol}`)
                .select(`${table}.*`)
                .select(`${userTable}.${nameCol} as author_name`)
                .select(`${userTable}.${avatarCol} as author_avatar`);
        } else {
            finalRowQuery = finalRowQuery.select(`${table}.*`);
        }

        const finalRow = await finalRowQuery.first();
        const result = finalRow as CommentRow;

        // Push new comment to cache instead of invalidating
        await cachePushComment(data.entity_path, result);

        return result;
    });
}

export interface GetCommentsQuery {
    entity_path?: string | undefined;
    entity_path_prefix?: string | undefined; // Query using LIKE 'prefix/%'
    limit?: number | undefined;
    /**
     * Opaque cursor string returned from previous response.
     * When provided, results start after the comment with this comment_path.
     */
    cursor?: string | undefined;
}

export interface PaginatedComments {
    data: CommentRow[];
    /** Pass this as `cursor` to fetch the next page. Null when no more pages. */
    nextCursor: string | null;
    hasMore: boolean;
}

/** Decode a base64 cursor back to a comment_path string */
function decodeCursor(cursor: string): string {
    return Buffer.from(cursor, 'base64').toString('utf-8');
}

/** Encode a comment_path into an opaque base64 cursor */
function encodeCursor(commentPath: string): string {
    return Buffer.from(commentPath, 'utf-8').toString('base64');
}

export async function getComments(query: GetCommentsQuery): Promise<PaginatedComments> {
    if (!query.entity_path && !query.entity_path_prefix) {
        throw new Error('Either entity_path or entity_path_prefix is required to prevent exploiting the entire database.');
    }
    if (query.entity_path_prefix && query.entity_path_prefix.length < 3) {
        throw new Error('entity_path_prefix must be at least 3 characters long to prevent broad scanning.');
    }

    const pageSize = query.limit ?? 20;
    const afterPath = query.cursor ? decodeCursor(query.cursor) : null;

    // --- Cache read (ZSET + Hash) — only for simple entity_path queries ---
    if (query.entity_path) {
        const cached = await cacheFetchPage(query.entity_path, afterPath, pageSize);
        if (cached !== null) {
            const hasMore = cached.length > pageSize;
            const data = hasMore ? cached.slice(0, pageSize) : cached;
            return {
                data,
                hasMore,
                nextCursor: hasMore ? encodeCursor(data[data.length - 1]!.comment_path) : null,
            };
        }
    }

    // --- DB fallback ---
    const knex = getKnex();
    const table = getTableName();

    // Fetch pageSize+1 to detect hasMore
    let q = knex(table)
        .whereNull(`${table}.deleted_at`)
        .where({ [`${table}.site`]: getSiteName() })
        .orderBy(`${table}.comment_path`, 'asc')
        .limit(pageSize + 1);

    const userTable = getUserTableName();
    if (userTable) {
        const idCol = getUserIdCol();
        const nameCol = getUserNameCol();
        const avatarCol = getUserAvatarCol();
        q = q.leftJoin(userTable, `${table}.user_id`, `${userTable}.${idCol}`)
            .select(`${table}.*`)
            .select(`${userTable}.${nameCol} as author_name`)
            .select(`${userTable}.${avatarCol} as author_avatar`);
    } else {
        q = q.select(`${table}.*`);
    }

    if (query.entity_path) {
        q = q.where({ [`${table}.entity_path`]: query.entity_path });
    } else if (query.entity_path_prefix) {
        const escapedPrefix = query.entity_path_prefix.replace(/([_%])/g, '\\$1');
        q = q.where(`${table}.entity_path`, 'LIKE', `${escapedPrefix}%`);
    }

    if (afterPath) {
        q = q.where(`${table}.comment_path`, '>', afterPath);
    }

    const rows: CommentRow[] = await q;

    const hasMore = rows.length > pageSize;
    const data = hasMore ? rows.slice(0, pageSize) : rows;
    const nextCursor = hasMore ? encodeCursor(data[data.length - 1]!.comment_path) : null;

    // --- Cache write: populate ZSET index + Hash entries ---
    if (query.entity_path && data.length > 0) {
        await cacheIndexComments(query.entity_path, data);
    }

    return { data, hasMore, nextCursor };
}

export async function updateComment(id: number, content: string): Promise<number> {
    const knex = getKnex();
    const table = getTableName();

    // Fetch before update so we can invalidate the right entity
    const row = await knex(table).where({ id }).select('entity_path').first();
    const result = await knex(table).where({ id }).update({ content, updated_at: knex.fn.now() });

    if (row) {
        await cacheUpdateCommentContent(id, content);
    }

    return result;
}

export async function deleteComment(id: number): Promise<number> {
    const knex = getKnex();
    const table = getTableName();

    const row = await knex(table).where({ id }).select('entity_path', 'comment_path').first();
    const result = await knex(table).where({ id }).update({ deleted_at: knex.fn.now() });

    if (row) {
        await cacheRemoveComment(row.entity_path as string, row.comment_path as string, id);
    }

    return result;
}

export async function getCommentOwner(id: number): Promise<{ user_id: string } | null> {
    const knex = getKnex();
    const table = getTableName();
    
    const row = await knex(table).where({ id }).select('user_id').first();
    return row ? { user_id: row.user_id as string } : null;
}

// Tree Builder Logic
export interface CommentNode extends CommentRow {
    children: CommentNode[];
}

export function buildTree(comments: CommentRow[]): CommentNode[] {
    const map = new Map<number, CommentNode>();
    const roots: CommentNode[] = [];

    for (const comment of comments) {
        map.set(comment.id, { ...comment, children: [] });
    }

    for (const comment of comments) {
        const node = map.get(comment.id)!;
        if (comment.parent_id && map.has(comment.parent_id)) {
            map.get(comment.parent_id)!.children.push(node);
        } else {
            roots.push(node);
        }
    }

    return roots;
}
