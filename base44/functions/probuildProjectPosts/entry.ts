import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { getProbuildIdToken, fetchProbuildPostsForProject } from '../../shared/probuildApi.ts';

// Diagnostic: fetch ALL posts for a specific project ID, with Denver dates.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const projectId = body.project_id;
    if (!projectId) return Response.json({ error: 'project_id required' }, { status: 400 });

    const idToken = await getProbuildIdToken(base44);
    const posts = await fetchProbuildPostsForProject(idToken, projectId);

    const postList = posts.map((pp) => {
      const created = pp.post.createdAt;
      let denverDate = null;
      if (created) {
        try {
          denverDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(created));
        } catch (e) { /* skip */ }
      }
      return {
        post_id: pp.postId,
        created_utc: created,
        denver_date: denverDate,
        message: (pp.post.message || '').slice(0, 300),
        attachments: pp.post.attachments ? (typeof pp.post.attachments === 'object' ? Object.keys(pp.post.attachments).length : pp.post.attachments.length) : 0,
      };
    });

    return Response.json({ project_id: projectId, total_posts: postList.length, posts: postList });
  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 200 });
  }
}