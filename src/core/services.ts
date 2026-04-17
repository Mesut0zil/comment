import { getKnex, getTableName, getSiteName } from './config';

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

        const finalRow = await trx(table).where({ id: insertedId }).first();
        return finalRow as CommentRow;
    });
}

export interface GetCommentsQuery {
    entity_path?: string;
    entity_path_prefix?: string; // Query using LIKE 'prefix/%'
    limit?: number;
    offset?: number;
}

export async function getComments(query: GetCommentsQuery): Promise<CommentRow[]> {
    const knex = getKnex();
    const table = getTableName();

    let q = knex(table).whereNull('deleted_at').where({ site: getSiteName() });

    if (query.entity_path) {
        q = q.where({ entity_path: query.entity_path });
    } else if (query.entity_path_prefix) {
        // Use prefix matching to grab a whole group of comments (e.g. "video:1/%")
        q = q.where('entity_path', 'LIKE', `${query.entity_path_prefix}%`);
    }

    q = q.orderBy('comment_path', 'asc'); // Ensures the tree can be reconstructed sequentially

    if (query.limit) q = q.limit(query.limit);
    if (query.offset) q = q.offset(query.offset);

    return await q;
}

export async function updateComment(id: number, content: string): Promise<number> {
    const knex = getKnex();
    const table = getTableName();
    return await knex(table).where({ id }).update({ content, updated_at: knex.fn.now() });
}

export async function deleteComment(id: number): Promise<number> {
    // Soft delete default
    const knex = getKnex();
    const table = getTableName();
    return await knex(table).where({ id }).update({ deleted_at: knex.fn.now() });
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
