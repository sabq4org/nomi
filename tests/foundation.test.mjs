import test from 'node:test';
import assert from 'node:assert/strict';
import {makeServer} from '../apps/api/server.mjs';
import {publicationErrors} from '../packages/editorial/policy.mjs';
const fixture = () => ({status:'approved',reviewedBy:'editor',reviewedAt:'2026-10-04T07:00:00Z',title:'اختبار',summary:'نص اختبار',claims:[{text:'ادعاء اختبار',kind:'confirmed',evidence:[{support:'supports',excerpt:'مقتطف اختبار',sourceId:'source',originId:'origin',usageAllowed:true,publishedAt:'2026-10-04T06:00:00Z',fetchedAt:'2026-10-04T06:30:00Z',url:'https://example.com/test'}]}]});
test('requires human approval',()=>{const x=fixture();x.reviewedBy=null;assert.ok(publicationErrors(x).includes('human_review_required'));});
test('rejects missing evidence',()=>{const x=fixture();x.claims[0].evidence=[];assert.ok(publicationErrors(x).includes('supported_evidence_required'));});
test('rejects unlicensed sources',()=>{const x=fixture();x.claims[0].evidence[0].usageAllowed=false;assert.ok(publicationErrors(x).includes('supported_evidence_required'));});
test('rejects contradictions as supporting proof',()=>{const x=fixture();x.claims[0].evidence[0].support='contradicts';assert.ok(publicationErrors(x).includes('supported_evidence_required'));});
test('rejects insecure URLs and missing dates',()=>{for(const field of ['url','publishedAt']){const x=fixture();x.claims[0].evidence[0][field]='invalid';assert.ok(publicationErrors(x).includes('supported_evidence_required'));}});
test('allows complete reviewed fixture',()=>assert.deepEqual(publicationErrors(fixture()),[]));
test('HTTP reports live but not database ready; no fake news endpoint',async()=>{
 const server=makeServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try {const base=`http://127.0.0.1:${server.address().port}`;
 for(const [path,status] of [['/health/live',200],['/health/ready',503],['/v1/meta',200],['/v1/stories',404]]){const res=await fetch(base+path);assert.equal(res.status,status);assert.ok((await res.json()).requestId);assert.equal(res.headers.get('cache-control'),'no-store');}
 assert.equal((await fetch(base+'/v1/meta',{method:'POST'})).status,405);
 }finally{await new Promise(r=>server.close(r));}
});
