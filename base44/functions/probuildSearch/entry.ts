import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { getProbuildIdToken, fetchProbuildProjects, fetchProbuildPostsForProject, toMs } from '../../shared/probuildApi.ts';

// Diagnostic: search ALL Probuild projects (no 21-day filter) for a name
// pattern, fetch their posts, and return posts in a date range. Used to find
// reports that exist in Probuild but weren't captured by the ingest window.
//
// Params: { search: "countryside|pearl|coalville", start_date, end_date }
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const search = (body.search || '').toLowerCase().trim();
    const startDate = body.start_date || null;
    const endDate = body.end_date || null;
    if (!search) return Response.json({ error: 'search required' }, { status: 400 });

    const idToken = await getProbuildIdToken(base44);
    const allProjects = await fetchProbuildProjects(idToken);

    // Match projects by name (case-insensitive substring on any term)
    const terms = search.split(/[|,\s]+/).filter(Boolean);
    const matching = allProjects.filter((p) => {
      const name = String(p.name || p.title || '').toLowerCase();
      return terms.some((t) => name.includes(t));
    });

    // Fetch posts for each matching project
    const results = await Promise.all(matching.slice(0, 30).map(async (p) => {
      const posts = await fetchProbuildPostsForProject(idToken, p.id);
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
          message: (pp.post.message || '').slice(0, 200),
          attachments: pp.post.attachments ? (typeof pp.post.attachments === 'object' ? Object.keys(pp.post.attachments).length : pp.post.attachments.length) : 0,
        };
      });
      const filtered = postList.filter((p) => {
        if (!p.denver_date) return false;
        if (startDate && p.denver_date < startDate) return false;
        if (endDate && p.denver_date > endDate) return false;
        return true;
      });
      return {
        project_id: p.id,
        project_name: p.name || p.title,
        last_modified: p.lastModifiedAt,
        deleted_at: p.deletedAt,
        total_posts: postList.length,
        posts_in_range: filtered,
      };
    }));

    return Response.json({
      search_terms: terms,
      total_projects: allProjects.length,
      matching_projects: matching.length,
      results,
    });
  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 200 });
  }
}