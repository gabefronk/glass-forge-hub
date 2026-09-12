import {createClientFromRequest} from 'npm:@base44/sdk@0.8.48';
import {getProbuildIdToken,fetchProbuildProjects,fetchProbuildPostsForProject} from '../../shared/probuildApi.ts';
const owners=new Set(['gabefronk@gmail.com','gabriel.fronk.wd@gmail.com']);
const sha=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),v=>v.toString(16).padStart(2,'0')).join('');
Deno.serve(async(req)=>{
 const c=createClientFromRequest(req),api=c.asServiceRole.entities;
 try{
  const key=req.headers.get('x-glass-forge-control-key');
  if(key){if(key.length<40||key.length>200||!(await api.ProbuildControlDevice.filter({token_hash:await sha(key),enabled:true},'-created_date',1))[0])return Response.json({error:'Device authorization required'},{status:401});}
  else{const u=await c.auth.me().catch(()=>null);if(u?.role!=='admin'||!owners.has(String(u.email||'').toLowerCase()))return Response.json({error:'Owner access required'},{status:403});}
  const i=await req.json(),token=await getProbuildIdToken(c);
  const projects=await fetchProbuildProjects(token);
  if(i.action==='projects')return Response.json({projects:projects.map(p=>({id:p.id,name:p.name||p.title||'',last_modified_at:p.lastModifiedAt,archived:!!p.archivedAt,deleted:!!p.deletedAt})),checked_at:new Date().toISOString()});
  if(!projects.some(p=>p.id===i.project_id))return Response.json({error:'Project not found'},{status:404});
  const posts=await fetchProbuildPostsForProject(token,i.project_id);
  if(i.action==='photo'){
   const a=posts.find(p=>p.postId===i.post_id)?.post?.attachments?.[i.attachment_id];
   if(!a||a.type!=='photo')return Response.json({error:'Photo not found'},{status:404});
   const path=`teams/-O7aXXhvthc41u60Koc6/posts/${i.project_id}/${i.post_id}/attachments/${i.attachment_id}`;
   const u=`https://firebasestorage.googleapis.com/v0/b/probuild-prod.appspot.com/o/${encodeURIComponent(path)}?alt=media&generation=${encodeURIComponent(a.generation||'')}`;
   const r=await fetch(u,{headers:{Authorization:`Firebase ${token}`}});
   if(!r.ok)return Response.json({error:'Photo retrieval failed',upstream_status:r.status},{status:502});
   const bytes=new Uint8Array(await r.arrayBuffer());let b='';for(let j=0;j<bytes.length;j+=32768)b+=String.fromCharCode(...bytes.subarray(j,j+32768));
   return Response.json({mime_type:r.headers.get('content-type'),size:bytes.length,base64:btoa(b)});
  }
  if(i.action!=='project')return Response.json({error:'Unsupported action'},{status:400});
  return Response.json({project:projects.find(p=>p.id===i.project_id),posts});
 }catch(e){console.error('Probuild control failed',e?.name);return Response.json({error:'ProBuild source unavailable'},{status:502});}
});