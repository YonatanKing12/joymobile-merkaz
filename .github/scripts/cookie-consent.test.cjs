const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../../assets/cookie-banner.js'),'utf8').replace(/^import .*;\n/m,'').replace(/export /g,'');
function fixture(shopify={}) {
  const local=new Map(),session=new Map(),buttons=[{disabled:false},{disabled:false}];
  const styles=()=>({setProperty(){},removeProperty(){}});
  const document={addEventListener(){},removeEventListener(){},getElementById(){return null;},body:{style:styles()},documentElement:{style:styles()},activeElement:null};
  const ctx={window:{Shopify:shopify,addEventListener(){},removeEventListener(){}},localStorage:{getItem:k=>local.get(k)||null,setItem:(k,v)=>local.set(k,v),removeItem:k=>local.delete(k)},document,HTMLElement:class{},ResizeObserver:class{},MutationObserver:class{},setTimeout,clearTimeout,Date,Number,Promise,console,announce(){ctx.announced=true;},focusables:()=>[],define:(name,klass)=>{ctx.Banner=klass;}};
  vm.createContext(ctx);vm.runInContext(source,ctx);
  const el=new ctx.Banner();
  Object.assign(el,{hidden:false,isConnected:true,dataset:{renewDays:'365',saved:'saved'},error:{hidden:true},panel:{setAttribute(){},removeAttribute(){}},resize:{disconnect(){}},contains:()=>false,querySelectorAll:()=>buttons,offset(){}});
  return {ctx,el,local,buttons,record:(...a)=>vm.runInContext('record',ctx)(...a),api:(...a)=>vm.runInContext('privacyApi',ctx)(...a)};
}
function privacy({error=false,commit=true,never=false}={}) {
  const state={},calls=[];
  return {state,calls,currentVisitorConsent:()=>state,setTrackingConsent(flags,cb){calls.push(flags);if(never)return;if(commit)for(const [k,v]of Object.entries(flags))state[k]=v?'yes':'no';cb(error?{error:'blocked'}:undefined);}};
}
test('acceptance confirms three optional categories without granting data sale',async()=>{
 const f=fixture(),p=privacy();assert.equal(await f.record(p,true),true);
 assert.deepEqual(Object.keys(p.calls[0]).sort(),['analytics','marketing','preferences']);
});
test('essential-only explicitly rejects optional processing and data sale',async()=>{
 const f=fixture(),p=privacy();assert.equal(await f.record(p,false),true);
 assert.equal(Object.values(p.state).every(v=>v==='no'),true);assert.equal(p.state.sale_of_data,'no');
});
test('later acceptance preserves an existing data sharing opt-out',async()=>{
 const f=fixture(),p=privacy();p.state.sale_of_data='no';assert.equal(await f.record(p,true),true);
 assert.equal(p.calls[0].sale_of_data,false);
});
test('callback error or uncommitted consent cannot report success',async()=>{
 const f=fixture();assert.equal(await f.record(privacy({error:true}),false),false);assert.equal(await f.record(privacy({commit:false}),true),false);
});
test('missing API and missing callback fail safely',async()=>{
 const f=fixture();assert.equal(await f.record(null,false),false);assert.equal(await f.record(privacy({never:true}),false,5),false);
});
test('failed choice stays open, records nothing and allows a retry',async()=>{
 const p=privacy({error:true}),f=fixture({customerPrivacy:p});await f.el.choose('decline');
 assert.equal(f.el.hidden,false);assert.equal(f.el.error.hidden,false);assert.equal(f.local.size,0);assert.equal(f.ctx.announced,undefined);assert(f.buttons.every(b=>!b.disabled));
 f.ctx.window.Shopify.customerPrivacy=privacy();await f.el.choose('decline');
 assert.equal(f.el.hidden,true);assert.equal(JSON.parse(f.local.get('joy:cookie-consent')).choice,'decline');assert.equal(f.ctx.announced,true);
});
test('busy choice rejects duplicate interaction until acknowledgment',async()=>{
 const p=privacy({never:true}),f=fixture({customerPrivacy:p});
 f.el.busy=true;await f.el.choose('accept');assert.equal(p.calls.length,0);
});
test('withdrawal in another tab updates this tab without writing a notification loop',async()=>{
 const p=privacy(),f=fixture({customerPrivacy:p});for(const k of ['analytics','marketing','preferences'])p.state[k]='yes';
 const saved=JSON.stringify({version:2,choice:'decline',at:Date.now()});f.local.set('joy:cookie-consent',saved);
 await f.el.handleEvent({type:'storage',key:'joy:cookie-consent'});
 assert.equal(p.state.analytics,'no');assert.equal(f.el.hidden,true);assert.equal(f.local.get('joy:cookie-consent'),saved);
});
test('consent records reject legacy, expired, future and malformed timestamps',()=>{
 const f=fixture(),put=x=>f.local.set('joy:cookie-consent',JSON.stringify(x));
 for(const x of [{choice:'accept',at:Date.now()},{version:2,choice:'accept',at:Date.now()+100000},{version:2,choice:'accept',at:Date.now()-366*864e5},{version:2,choice:'accept',at:'tomorrow'}]){put(x);assert.equal(f.el.stored(),null);}
 put({version:2,choice:'decline',at:Date.now()});assert.equal(f.el.stored().choice,'decline');
});
test('API can recover after a failed loader and ignores an incomplete global object',async()=>{
 const f=fixture({customerPrivacy:{},loadFeatures:(features,cb)=>cb(new Error('blocked'))});
 assert.equal(await f.api(5),null);
 const p=privacy();f.ctx.window.Shopify.loadFeatures=(features,cb)=>{f.ctx.window.Shopify.customerPrivacy=p;cb();};
 assert.equal(await f.api(5),p);
});
test('a data-sale-only choice does not suppress the initial optional-cookie question',async()=>{
 const p=privacy();p.state.sale_of_data='no';const f=fixture({customerPrivacy:p});let shown=false;f.el.show=()=>{shown=true;};
 f.ctx.MutationObserver=class{observe(){} disconnect(){}};await f.el.decide();assert.equal(shown,true);
});
test('an expired local approval asks again even if the native consent persists',async()=>{
 const p=privacy();for(const k of ['analytics','marketing','preferences'])p.state[k]='yes';
 const f=fixture({customerPrivacy:p});f.local.set('joy:cookie-consent',JSON.stringify({version:2,choice:'accept',at:Date.now()-366*864e5}));
 let shown=false;f.el.show=()=>{shown=true;};f.ctx.MutationObserver=class{observe(){} disconnect(){}};await f.el.decide();assert.equal(shown,true);
});
test('a saved decline overrides stale optional approval on a later page',async()=>{
 const p=privacy(),f=fixture({customerPrivacy:p});for(const k of ['analytics','marketing','preferences'])p.state[k]='yes';
 f.local.set('joy:cookie-consent',JSON.stringify({version:2,choice:'decline',at:Date.now()}));
 await f.el.decide();assert.equal(p.state.analytics,'no');assert.equal(p.state.sale_of_data,'no');assert.equal(f.el.hidden,true);
});
test('failed restoration of a saved decline remains visible and preserves the refusal',async()=>{
 const p=privacy({error:true,commit:false}),f=fixture({customerPrivacy:p});for(const k of ['analytics','marketing','preferences'])p.state[k]='yes';
 const saved=JSON.stringify({version:2,choice:'decline',at:Date.now()});f.local.set('joy:cookie-consent',saved);
 f.el.show=async()=>{f.el.hidden=false;};await f.el.decide();
 assert.equal(f.el.hidden,false);assert.equal(f.el.error.hidden,false);assert.equal(f.local.get('joy:cookie-consent'),saved);
});
test('cleared Shopify acceptance is never silently restored from localStorage',async()=>{
 const p=privacy(),f=fixture({customerPrivacy:p});f.local.set('joy:cookie-consent',JSON.stringify({version:2,choice:'accept',at:Date.now()}));
 let shown=false;f.el.show=()=>{shown=true;};f.ctx.MutationObserver=class{observe(){} disconnect(){}};await f.el.decide();assert.equal(shown,true);assert.equal(p.calls.length,0);
});
