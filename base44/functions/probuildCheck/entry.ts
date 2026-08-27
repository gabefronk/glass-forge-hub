import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { getProbuildIdToken, fetchProbuildPostsForProject } from '../../shared/probuildApi.ts';

const DB_BASE = 'https://probuild-prod.firebaseio.com';
const TEAM_ID = '-O7aXXhvthc41u60Koc6';

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const idToken = await getProbuildIdToken(base44);

    // Search all projects for matching names
    const projRes = await fetch(`${DB_BASE}/teams/${TEAM_ID}/projects.json?auth=${idToken}`);
    const projJson = await projRes.json();
    const searchTerms = (body.search_terms || []).map((s) => s.toLowerCase());

    const matching = [];
    for (const [pid, p] of Object.entries(projJson || {})) {
      if (!p) continue;
      const name = (p.name || p.title || '').toLowerCase();
      const isMatch = searchTerms.some((t) => name.includes(t));
      if (isMatch) {
        matching.push({ id: pid, name: p.name || p.title, lastModifiedAt: p.lastModifiedAt, deletedAt: p.deletedAt });
      }
    }

    // For each matching project, fetch all posts and filter to Aug 25-28
    const results = [];
    for (const proj of matching) {
      const posts = await fetchProbuildPostsForProject(idToken, proj.id);
      const recentPosts = posts.filter((p) => {
        const d = new Date(p.post.createdAt);
        const denverDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
        return denverDate >= '2026-08-24' && denverDate <= '2026-08-28';
      });
      results.push({
        project: proj,
        total_posts: posts.length,
        recent_posts: recentPosts.map((p) => ({
          post_id: p.postId,
          created_utc: p.post.createdAt,
          message: (p.post.message || '').slice(0, 120),
          attachment_count: p.post.attachments ? Object.keys(p.post.attachments).length : 0
        }))
      });
    }

    return Response.json({ matching_projects: matching.length, results });
  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 200 });
  }
}