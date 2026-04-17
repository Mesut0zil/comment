import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { configure, getKnex } from '../src/core/config';
import { createComment, getComments, buildTree, deleteComment } from '../src/core/services';
import { up, down } from '../src/db/migrate';

describe('Comment System', () => {
    beforeAll(async () => {
        // Use an in-memory SQLite database
        configure({
            dbUrl: 'sqlite://:memory:',
            tableName: 'test_comments'
        });

        // Run migrations
        await up();
    });

    afterAll(async () => {
        await down();
        const knex = getKnex();
        await knex.destroy();
    });

    it('should initialize and migrate the database', async () => {
        const knex = getKnex();
        const exists = await knex.schema.hasTable('test_comments');
        expect(exists).toBe(true);
    });

    let rootCommentId: number;

    it('should create a root comment properly', async () => {
        const comment = await createComment({
            user_id: 'user_1',
            content: 'This is a test root comment',
            entity_path: 'video:1/episode:1'
        });

        expect(comment).toBeDefined();
        expect(comment.depth).toBe(0);
        expect(comment.parent_id).toBeNull();
        // Assuming ID is 1, padded is '0001'
        expect(comment.comment_path).toBe('0001');

        rootCommentId = comment.id;
    });

    let childCommentId: number;

    it('should reply to a root comment', async () => {
        const comment = await createComment({
            user_id: 'user_2',
            content: 'This is a reply',
            entity_path: 'video:1/episode:1',
            parent_id: rootCommentId
        });

        expect(comment.depth).toBe(1);
        expect(comment.parent_id).toBe(rootCommentId);
        expect(comment.comment_path).toBe(`0001/${comment.id.toString().padStart(4, '0')}`);

        childCommentId = comment.id;
    });

    it('should build a tree correctly', async () => {
        const comments = await getComments({ entity_path: 'video:1/episode:1' });
        const tree = buildTree(comments);

        expect(tree).toHaveLength(1); // One root
        expect(tree[0].id).toBe(rootCommentId);
        expect(tree[0].children).toHaveLength(1);
        expect(tree[0].children[0].id).toBe(childCommentId);
    });

    it('should query comments by parent entity (wildcard)', async () => {
        // Add another comment to a different episode
        await createComment({
            user_id: 'user_3',
            content: 'Comment on episode 2',
            entity_path: 'video:1/episode:2'
        });

        // Add a comment to a different video
        await createComment({
            user_id: 'user_4',
            content: 'Comment on video 2',
            entity_path: 'video:2/episode:1'
        });

        // Fetch all comments for video:1
        const comments = await getComments({ entity_path_prefix: 'video:1/' });

        // There should be 3 comments total for video 1 (root, child, and ep2)
        expect(comments).toHaveLength(3);
    });

    it('should handle deep tree creation and sort correctly', async () => {
        let lastParentId = childCommentId;
        const depthsToCreate = 5;

        for (let i = 0; i < depthsToCreate; i++) {
            const c = await createComment({
                user_id: `deep_user_${i}`,
                content: `Deep level ${i + 2}`,
                entity_path: 'video:1/episode:1',
                parent_id: lastParentId
            });
            lastParentId = c.id;
        }

        const comments = await getComments({ entity_path: 'video:1/episode:1' });
        expect(comments.length).toBe(2 + depthsToCreate);

        // Tree should have depth
        const tree = buildTree(comments);
        let current = tree[0];
        let depthCount = 0;
        while (current.children.length > 0) {
            depthCount++;
            current = current.children[0];
        }
        // Root = 0, child = 1, + 5 deep = 6 transitions = depth 6
        expect(depthCount).toBe(6);
    });
});
