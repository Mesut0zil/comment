import { createComment, getComments, deleteComment, updateComment } from '../core/services';
import type { NextRequest } from 'next/server';

export function createCommentsHandler() {
    return {
        async GET(req: NextRequest) {
            const url = new URL(req.url);
            const entity_path = url.searchParams.get('entity_path') || undefined;
            const entity_path_prefix = url.searchParams.get('entity_path_prefix') || undefined;

            const query: any = {};
            if (entity_path) query.entity_path = entity_path;
            if (entity_path_prefix) query.entity_path_prefix = entity_path_prefix;

            try {
                const results = await getComments(query);
                return new Response(JSON.stringify(results), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                });
            } catch (err: any) {
                return new Response(JSON.stringify({ error: err.message }), { status: 500 });
            }
        },

        async POST(req: NextRequest) {
            const body = await req.json();
            try {
                const result = await createComment(body);
                return new Response(JSON.stringify(result), {
                    status: 201,
                    headers: { 'Content-Type': 'application/json' }
                });
            } catch (err: any) {
                return new Response(JSON.stringify({ error: err.message }), { status: 500 });
            }
        },

        async PUT(req: NextRequest) {
            const body = await req.json();
            try {
                const result = await updateComment(body.id, body.content);
                return new Response(JSON.stringify({ success: result > 0 }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                });
            } catch (err: any) {
                return new Response(JSON.stringify({ error: err.message }), { status: 500 });
            }
        },

        async DELETE(req: NextRequest) {
            const url = new URL(req.url);
            const id = url.searchParams.get('id');
            if (!id) return new Response('Missing ID', { status: 400 });
            try {
                const result = await deleteComment(Number(id));
                return new Response(JSON.stringify({ success: result > 0 }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                });
            } catch (err: any) {
                return new Response(JSON.stringify({ error: err.message }), { status: 500 });
            }
        }
    };
}
