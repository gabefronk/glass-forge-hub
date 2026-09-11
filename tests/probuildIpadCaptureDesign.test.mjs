import test from "node:test";
import assert from "node:assert/strict";
import {buildAgentInventory} from "../base44/shared/agentCenter.js";
import {ORG_TREE,DAILY_PLANS} from "../src/lib/agentCenterRoles.js";
test("iPad capture is a registered design with every execution path disabled",()=>{
 const node=buildAgentInventory().find(n=>n.id==="probuild_ipad_capture");
 assert.ok(node);assert.equal(node.design_only,true);assert.equal(node.schedule_enabled,false);assert.equal(node.device_automation_enabled,false);assert.equal(node.email_enabled,false);
 assert.match(node.design.cutoff,/daylight-saving/);assert.match(node.design.retry_safety,/never resend blindly/);assert.match(node.design.prerequisites,/No recipient has been inferred/);
 assert.ok(ORG_TREE.sections.find(s=>s.leadId==="field_reporting_lead").members.some(m=>m.id===node.id));
 assert.equal(DAILY_PLANS[node.id].length,4);
});
test("a manually recorded progress event cannot make the disabled design appear running",()=>{
 const node=buildAgentInventory({events:[{agent_id:"probuild_ipad_capture",event_type:"started",occurred_at:"2026-09-11",message:"Manual note"}]}).find(n=>n.id==="probuild_ipad_capture");
 assert.match(node.status,/Disabled/);assert.equal(node.schedule_enabled,false);
});
