import { createComment, getComments, deleteComment, updateComment, getCommentOwner } from '../core/services';
import { checkRateLimit, getRequestIp } from '../core/rate-limit';
import type { NextRequest } from 'next/server';

export interface CommentHandlerOptions {
    getAuth?: (req: NextRequest) => Promise<{ userId: string | null; isAdmin?: boolean }> | { userId: string | null; isAdmin?: boolean };
    /** 
     * Optional boolean or custom function to sanitize comment content. 
     * If true, applies a basic HTML entity encoding to prevent XSS. 
     * If a function is provided, it will be called with the content.
     */
    sanitizeHtml?: boolean | ((content: string) => string);
    /** Maximum length of the comment content (excluding whitespaces) */
    maxLength?: number;
    /** Cloudflare Turnstile secret key for server-side verification of POST/PUT requests */
    turnstileSecret?: string;
}

function escapeHtml(unsafe: string): string {
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
}

export function createCommentsHandler(options?: CommentHandlerOptions) {
    return {
        async GET(req: NextRequest) {
            const ip = getRequestIp(req);
            if (!await checkRateLimit('get:' + ip)) {
                return new Response(JSON.stringify({ error: 'Too many requests' }), {
                    status: 429,
                    headers: { 'Retry-After': '60' }
                });
            }

            const url = new URL(req.url);
            const entity_path = url.searchParams.get('entity_path') || undefined;
            const entity_path_prefix = url.searchParams.get('entity_path_prefix') || undefined;
            const cursor = url.searchParams.get('cursor') || undefined;
            const limitParam = url.searchParams.get('limit');
            const limit = limitParam ? Math.min(Number(limitParam), 100) : undefined;

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
                console.error('[Comment API Error]', err);
                return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500 });
            }
        },

        async POST(req: NextRequest) {
            const ip = getRequestIp(req);
            if (!await checkRateLimit('post:' + ip)) {
                return new Response(JSON.stringify({ error: 'Too many requests' }), {
                    status: 429,
                    headers: { 'Retry-After': '60' }
                });
            }

            const body = await req.json();

            if (options?.turnstileSecret) {
                const token = body.turnstileToken;
                if (!token || typeof token !== 'string') {
                    return new Response(JSON.stringify({ error: 'Turnstile verification required' }), { status: 400 });
                }
                try {
                    const formData = new URLSearchParams();
                    formData.append('secret', options.turnstileSecret);
                    formData.append('response', token);
                    formData.append('remoteip', ip);
                    
                    const tsRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
                        method: 'POST',
                        body: formData,
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
                    });
                    const tsData = await tsRes.json();
                    
                    if (!tsData.success) {
                        return new Response(JSON.stringify({ error: 'Turnstile verification failed' }), { status: 403 });
                    }
                } catch (err) {
                    console.error('[Turnstile Error]', err);
                    return new Response(JSON.stringify({ error: 'Error validating Turnstile token' }), { status: 500 });
                }
            }

            if (typeof body.content !== 'string' || body.content.trim().length === 0 || body.content.length > 50000) {
                return new Response(JSON.stringify({ error: 'Invalid or missing content' }), { status: 400 });
            }

            if (options?.maxLength) {
                const charCount = body.content.replace(/\s+/g, '').length;
                if (charCount > options.maxLength) {
                    return new Response(JSON.stringify({ error: `Comment is too long (maximum ${options.maxLength} characters)` }), { status: 400 });
                }
            }
            if (typeof body.entity_path !== 'string' || body.entity_path.length > 255) {
                return new Response(JSON.stringify({ error: 'Invalid or missing entity_path' }), { status: 400 });
            }

            if (options?.getAuth) {
                const auth = await options.getAuth(req);
                if (!auth.userId) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
                body.user_id = auth.userId;
            } else {
                return new Response(JSON.stringify({ error: 'Authentication not configured' }), { status: 401 });
            }

            if (body.content && options?.sanitizeHtml) {
                if (typeof options.sanitizeHtml === 'function') {
                    body.content = options.sanitizeHtml(body.content);
                } else if (options.sanitizeHtml === true) {
                    body.content = escapeHtml(body.content);
                }
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
            if (!await checkRateLimit('put:' + ip)) {
                return new Response(JSON.stringify({ error: 'Too many requests' }), { status: 429 });
            }

            const body = await req.json();

            const commentId = Number(body.id);
            if (!body.id || isNaN(commentId)) {
                return new Response(JSON.stringify({ error: 'Invalid ID' }), { status: 400 });
            }
            if (typeof body.content !== 'string' || body.content.trim().length === 0 || body.content.length > 50000) {
                return new Response(JSON.stringify({ error: 'Invalid or missing content' }), { status: 400 });
            }

            if (options?.maxLength) {
                const charCount = body.content.replace(/\s+/g, '').length;
                if (charCount > options.maxLength) {
                    return new Response(JSON.stringify({ error: `Comment is too long (maximum ${options.maxLength} characters)` }), { status: 400 });
                }
            }

            if (options?.getAuth) {
                const auth = await options.getAuth(req);
                if (!auth.userId) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
                
                const owner = await getCommentOwner(commentId);
                if (!owner) return new Response(JSON.stringify({ error: 'Comment not found' }), { status: 404 });
                if (owner.user_id !== auth.userId && !auth.isAdmin) {
                    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
                }
            } else {
                return new Response(JSON.stringify({ error: 'Authentication not configured' }), { status: 401 });
            }

            if (body.content && options?.sanitizeHtml) {
                if (typeof options.sanitizeHtml === 'function') {
                    body.content = options.sanitizeHtml(body.content);
                } else if (options.sanitizeHtml === true) {
                    body.content = escapeHtml(body.content);
                }
            }

            try {
                const result = await updateComment(commentId, body.content);
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
            if (!await checkRateLimit('delete:' + ip)) {
                return new Response(JSON.stringify({ error: 'Too many requests' }), { status: 429 });
            }

            const url = new URL(req.url);
            const id = url.searchParams.get('id');
            if (!id) return new Response('Missing ID', { status: 400 });
            const commentId = Number(id);
            if (isNaN(commentId)) return new Response(JSON.stringify({ error: 'Invalid ID' }), { status: 400 });

            if (options?.getAuth) {
                const auth = await options.getAuth(req);
                if (!auth.userId) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
                
                const owner = await getCommentOwner(commentId);
                if (!owner) return new Response(JSON.stringify({ error: 'Comment not found' }), { status: 404 });
                if (owner.user_id !== auth.userId && !auth.isAdmin) {
                    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
                }
            } else {
                return new Response(JSON.stringify({ error: 'Authentication not configured' }), { status: 401 });
            }

            try {
                const result = await deleteComment(commentId);
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
