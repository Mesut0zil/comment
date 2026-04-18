import { createComment, getComments, deleteComment, updateComment, getCommentOwner } from '../core/services';
import { checkRateLimit, getRequestIp } from '../core/rate-limit';
import type { NextRequest } from 'next/server';

export interface CommentHandlerOptions {
    getAuth?: (req: NextRequest) => Promise<{ userId: string | null; isAdmin?: boolean }> | { userId: string | null; isAdmin?: boolean };
}

export function createCommentsHandler(options?: CommentHandlerOptions) {
    return {
        async GET(req: NextRequest) {
            const ip = getRequestIp(req);
            if (!await checkRateLimit(ip)) {
                return new Response(JSON.stringify({ error: 'Too many requests' }), {
                    status: 429,
                    headers: { 'Retry-After': '60' }
                });
            }

            const url = new URL(req.url);
            const entity_path = url.searchParams.get('entity_path') || undefined;
            const entity_path_prefix = url.searchParams.get('entity_path_prefix') || undefined;
            const cursor = url.searchParams.get('cursor') || undefined;
            const limit = url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : undefined;

            if (!entity_path && !entity_path_prefix) {
                return new Response(JSON.stringify({ error: 'Either entity_path or entity_path_prefix is required' }), {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' }
                });
            }
            if (entity_path_prefix && entity_path_prefix.length < 3) {
                return new Response(JSON.stringify({ error: 'entity_path_prefix must be at least 3 characters long' }), {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            try {
                const result = await getComments({ entity_path, entity_path_prefix, cursor, limit });
                return new Response(JSON.stringify(result), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                });
            } catch (err: any) {
                return new Response(JSON.stringify({ error: err.message }), { status: 500 });
            }
        },

        async POST(req: NextRequest) {
            const ip = getRequestIp(req);
            if (!await checkRateLimit(ip)) {
                return new Response(JSON.stringify({ error: 'Too many requests' }), {
                    status: 429,
                    headers: { 'Retry-After': '60' }
                });
            }

            const body = await req.json();

            if (options?.getAuth) {
                const auth = await options.getAuth(req);
                if (!auth.userId) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
                body.user_id = auth.userId;
            } else {
                return new Response(JSON.stringify({ error: 'Authentication not configured' }), { status: 401 });
            }

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
            const ip = getRequestIp(req);
            if (!await checkRateLimit(ip)) {
                return new Response(JSON.stringify({ error: 'Too many requests' }), { status: 429 });
            }

            const body = await req.json();

            if (options?.getAuth) {
                const auth = await options.getAuth(req);
                if (!auth.userId) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
                
                const owner = await getCommentOwner(body.id);
                if (!owner) return new Response(JSON.stringify({ error: 'Comment not found' }), { status: 404 });
                if (owner.user_id !== auth.userId && !auth.isAdmin) {
                    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
                }
            } else {
                return new Response(JSON.stringify({ error: 'Authentication not configured' }), { status: 401 });
            }

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
            const ip = getRequestIp(req);
            if (!await checkRateLimit(ip)) {
                return new Response(JSON.stringify({ error: 'Too many requests' }), { status: 429 });
            }

            const url = new URL(req.url);
            const id = url.searchParams.get('id');
            if (!id) return new Response('Missing ID', { status: 400 });

            if (options?.getAuth) {
                const auth = await options.getAuth(req);
                if (!auth.userId) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
                
                const owner = await getCommentOwner(Number(id));
                if (!owner) return new Response(JSON.stringify({ error: 'Comment not found' }), { status: 404 });
                if (owner.user_id !== auth.userId && !auth.isAdmin) {
                    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
                }
            } else {
                return new Response(JSON.stringify({ error: 'Authentication not configured' }), { status: 401 });
            }

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
