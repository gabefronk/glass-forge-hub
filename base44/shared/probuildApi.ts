// Shared Probuild API helpers: Firebase auth, project fetch, post fetch, and
// project filtering. Used by fetchProbuildPosts (ingest) and matchDebug
// (diagnostics) so neither duplicates auth logic.

import { secrets } from 'base44:runtime';

const FIREBASE_API_KEY = 'AIzaSyD-bRl-_9tZLccN3HQ9IMy27pY37VKY1xc';
const FIREBASE_TOKEN_URL = `https://securetoken.googleapis.com/v1/token?key=${FIREBASE_API_KEY}`;
const DB_BASE = 'https://probuild-prod.firebaseio.com';
const TEAM_ID = '-O7aXXhvthc41u60Koc6';

export function toMs(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d.getTime();
  }
  return null;
}

// Exchange the Probuild refresh token for an id_token. Rotates and persists
// the new refresh token to ProbuildAuth (or falls back to the secret).
// Returns the id_token string.
export async function getProbuildIdToken(base44) {
  const authRecords = await base44.asServiceRole.entities.ProbuildAuth.list('-updated_date', 1);
  let refreshToken = authRecords.length > 0 ? authRecords[0].refresh_token : secrets.get('PROBUILD_REFRESH_TOKEN');
  if (!refreshToken) throw new Error('no_refresh_token');

  const tokenRes = await fetch(FIREBASE_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Referer': 'https://portal.probuild.app/',
    },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`,
  });
  if (tokenRes.status === 401) {
    throw new Error('probuild_auth_401: Refresh token rejected. Capture a fresh Probuild refresh token and update PROBUILD_REFRESH_TOKEN / ProbuildAuth.');
  }
  if (!tokenRes.ok) {
    const txt = await tokenRes.text();
    throw new Error(`probuild_auth_failed: ${tokenRes.status} ${txt}`);
  }
  const tokenData = await tokenRes.json();
  const idToken = tokenData.id_token;
  const rotatedRefreshToken = tokenData.refresh_token;

  const nowIso = new Date().toISOString();
  if (authRecords.length > 0) {
    await base44.asServiceRole.entities.ProbuildAuth.update(authRecords[0].id, {
      refresh_token: rotatedRefreshToken,
      last_exchanged_at: nowIso,
    });
  } else {
    await base44.asServiceRole.entities.ProbuildAuth.create({
      refresh_token: rotatedRefreshToken,
      last_exchanged_at: nowIso,
    });
  }

  return idToken;
}

// Fetch all projects from Probuild RTDB. Returns array of { id, name, lastModifiedAt, deletedAt, ... }.
export async function fetchProbuildProjects(idToken) {
  const res = await fetch(`${DB_BASE}/teams/${TEAM_ID}/projects.json?auth=${idToken}`);
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`projects_fetch_failed: ${res.status} ${txt}`);
  }
  const json = await res.json();
  const entries = [];
  if (Array.isArray(json)) {
    json.forEach((p, i) => { if (p) entries.push({ id: String(i), ...p }); });
  } else {
    for (const [pid, p] of Object.entries(json || {})) { if (p) entries.push({ id: pid, ...p }); }
  }
  return entries;
}

// Fetch all posts for a single project. Returns array of { projectId, postId, post }.
export async function fetchProbuildPostsForProject(idToken, projectId) {
  try {
    const r = await fetch(`${DB_BASE}/teams/${TEAM_ID}/posts/${projectId}.json?auth=${idToken}`);
    if (!r.ok) throw new Error('posts_fetch_failed: project ' + projectId + ', HTTP ' + r.status);
    const j = await r.json();
    if (!j) return [];
    const out = [];
    for (const [postId, post] of Object.entries(j)) {
      if (!post) continue;
      out.push({ projectId, postId, post });
    }
    return out;
  } catch (error) {
    throw new Error('ProBuild posts unavailable for project ' + projectId + ': ' + error.message.replace(/auth=[^&\\s]+/g, 'auth=[redacted]'));
  }
}

// Filter projects by deletedAt and lastModifiedAt window.
// Returns { qualifying, stats: { total, deleted, skipped_modified, qualifying } }.
export function filterProjectsByWindow(projects, windowStartMs, windowEndMs) {
  let deleted = 0, skippedModified = 0;
  const qualifying = [];
  for (const p of projects) {
    if (p.deletedAt) { deleted++; continue; }
    const lm = toMs(p.lastModifiedAt);
    if (lm == null || lm >= windowStartMs - 86400000) {
      qualifying.push(p);
    } else {
      skippedModified++;
    }
  }
  return {
    qualifying,
    stats: {
      total: projects.length,
      deleted,
      skipped_modified: skippedModified,
      qualifying: qualifying.length,
    },
  };
}