import React, { useEffect, useState } from 'react';
import type { CommentRow, CommentNode } from '../core/services';
import { buildTree } from '../core/services';

export interface CommentSectionProps {
    entityPath: string;
    apiPath?: string;
    currentUser?: { id: string; name?: string };
}

export function CommentSection({ entityPath, apiPath = '/api/comments', currentUser }: CommentSectionProps) {
    const [comments, setComments] = useState<CommentNode[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [newComment, setNewComment] = useState('');
    const [replyTo, setReplyTo] = useState<number | null>(null);

    useEffect(() => {
        fetchComments();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [entityPath]);

    const fetchComments = async () => {
        try {
            setLoading(true);
            const res = await fetch(`${apiPath}?entity_path=${encodeURIComponent(entityPath)}`);
            if (!res.ok) throw new Error('Failed to fetch');
            const data: CommentRow[] = await res.json();
            setComments(buildTree(data));
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newComment.trim() || !currentUser) return;

        try {
            const res = await fetch(apiPath, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity_path: entityPath,
                    user_id: currentUser.id,
                    content: newComment,
                    parent_id: replyTo
                })
            });
            if (!res.ok) throw new Error('Submit failed');

            await fetchComments();
            setNewComment('');
            setReplyTo(null);
        } catch (err: any) {
            setError(err.message);
        }
    };

    const renderTree = (nodes: CommentNode[], level = 0) => {
        return (
            <div style= {{ marginLeft: level === 0 ? '0' : '20px' }
    }>
    {
        nodes.map(node => (
            <div key= { node.id } style = {{ marginBottom: '10px', padding: '10px', borderLeft: level === 0 ? 'none' : '2px solid #eee' }} >
        <div style={ { display: 'flex', gap: '10px', alignItems: 'center' } }>
            <strong>{ node.user_id } </strong>
            < small style = {{ color: '#888' }
}> { new Date(node.created_at).toLocaleString() } </small>
    </div>
    < div style = {{ margin: '8px 0' }}> { node.content } </div>

{
    currentUser && (
        <button 
                onClick={ () => setReplyTo(node.id) }
    style = {{ background: 'transparent', border: 'none', color: '#0066cc', cursor: 'pointer', padding: 0 }
}
              >
    Reply
    </button>
            )}

{
    replyTo === node.id && (
        <form onSubmit={ handleSubmit } style = {{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }
}>
    <textarea 
                  value={ newComment }
onChange = { e => setNewComment(e.target.value) }
placeholder = "Write a reply..."
style = {{ width: '100%', minHeight: '60px', padding: '8px' }}
                />
    < div style = {{ display: 'flex', gap: '8px' }}>
        <button type="submit" disabled = {!newComment.trim()}> Submit </button>
            < button type = "button" onClick = {() => { setReplyTo(null); setNewComment(''); }}> Cancel </button>
                </div>
                </form>
            )}

{ node.children && node.children.length > 0 && renderTree(node.children, level + 1) }
</div>
        ))}
</div>
    );
  };

if (loading) return <div>Loading comments...</div>;
if (error) return <div style={ { color: 'red' } }> Error: { error } </div>;

return (
    <div className= "comment-section" style = {{ fontFamily: 'sans-serif' }}>
        <h3 style={ { borderBottom: '1px solid #eee', paddingBottom: '8px' } }> Comments </h3>

{
    !replyTo && currentUser && (
        <form onSubmit={ handleSubmit } style = {{ marginBottom: '24px', display: 'flex', flexDirection: 'column', gap: '8px' }
}>
    <textarea 
            value={ newComment }
onChange = { e => setNewComment(e.target.value) }
placeholder = "Leave a comment..."
style = {{ width: '100%', minHeight: '80px', padding: '12px' }}
          />
    < div >
    <button type="submit" disabled = {!newComment.trim()}> Post Comment </button>
        </div>
        </form>
      )}

{
    !currentUser && (
        <div style={ { padding: '10px', background: '#f5f5f5', marginBottom: '20px' } }>
            Please log in to leave a comment.
        </div>
      )
}

{
    comments.length === 0 ? (
        <p>No comments yet.Be the first! </p>
      ) : (
        renderTree(comments)
    )
}
</div>
  );
}
