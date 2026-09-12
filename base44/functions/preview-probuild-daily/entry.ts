import { createClientFromRequest } from "npm:@base44/sdk";
import {getProbuildIdToken,fetchProbuildProjects,fetchProbuildPostsForProject} from "../../shared/probuildApi.ts";
Deno.serve(async(req)=>{
 const client=createClientFromRequest(req);
 const user=await client.auth.me().catch(()=>null);
 if(user?.role!=="admin")return Response.json({error:"Administrator access required"},{status:403});
 try{
  const {date,offset=0}=await req.json();
  if(typeof date!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isInteger(offset)||offset<0)
   return Response.json({error:"Valid date and offset required"},{status:400});
  const token=await getProbuildIdToken(client);
  const projects=(await fetchProbuildProjects(token)).sort((a,b)=>String(a.id).localeCompare(String(b.id)));
  const slice=projects.slice(offset,offset+10);
  const results=await Promise.all(slice.map(async p=>{
   try{
    const posts=await fetchProbuildPostsForProject(token,p.id);
    const matching=posts.filter(({post})=>{
     const d=new Date(post.createdAt);
     if(!Number.isFinite(d.getTime()))return false;
     return new Intl.DateTimeFormat("en-CA",{timeZone:"America/Denver",year:"numeric",month:"2-digit",day:"2-digit"}).format(d)===date;
    }).map(({postId,post})=>({post_id:postId,created_at:post.createdAt,message:String(post.message||""),attachment_count:post.attachments?Object.keys(post.attachments).length:0,deleted:!!post.deletedAt}));
    return {project_id:p.id,project_name:p.name||p.title||"",posts:matching,ok:true};
   }catch{return {project_id:p.id,project_name:p.name||p.title||"",posts:[],ok:false};}
  }));
  return Response.json({date,timezone:"America/Denver",offset,total_projects:projects.length,next_offset:offset+slice.length<projects.length?offset+slice.length:null,results,complete:false,attachments_downloaded:false});
 }catch{return Response.json({error:"ProBuild source connection failed. No report was sent."},{status:502});}
});
