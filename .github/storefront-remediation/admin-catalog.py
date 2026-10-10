"""Restricted catalog/menu/branch Admin applier. Dry-run reads by default; writes require --apply PLAN."""
from __future__ import annotations
import argparse,copy,datetime as dt,hashlib,json,os,pathlib,re,ssl,sys,urllib.error,urllib.parse,urllib.request
D=pathlib.Path(__file__).parent
STORES={'national':'k8qhkp-gn.myshopify.com','eilat':'x511g0-rj.myshopify.com'}
TOKEN_ENV={'national':'SHOPIFY_NATIONAL_ADMIN_TOKEN','eilat':'SHOPIFY_EILAT_ADMIN_TOKEN'}
API_VERSION='2026-07'
PRODUCTS={'national':'gid://shopify/Product/16046138818929','eilat':'gid://shopify/Product/7825054171345'}
COLLECTION='gid://shopify/Collection/711169999217'
BRANCH_HANDLES={'branch-flagship','branch-icemall','branch-shalom','branch-tachana','branch-fix'}
BRANCH_FIELDS={'name','text','address','map_query'}
ITEM_KEYS={'id','title','type','url','resourceId','tags','items'}
PRODUCT_FIELDS='id handle descriptionHtml options { name values }'
COLLECTION_FIELDS='id handle descriptionHtml'
META_FIELDS='id handle type updatedAt fields { key value }'
PAGE_FIELDS='id handle isPublished'
def item_fields(depth=4):
 return 'id title type url resourceId tags items { '+(item_fields(depth-1) if depth else 'id')+' }'
MENU_FIELDS='id handle title items { '+item_fields()+' }'
DEF_QUERY='query { metaobjectDefinitionByType(type:"branch") { type fieldDefinitions { key type { name } } } }'
class SafeError(Exception):pass
class MutationUnknown(SafeError):pass
class ApplyStopped(SafeError):
 def __init__(self,message,report):super().__init__(message);self.report=report
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs):return None
def fingerprint(value):return hashlib.sha256(json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()
def body_sha(value):return hashlib.sha256(value.encode()).hexdigest()
def node_query(kind,fields):return 'query Node($id: ID!) { node(id:$id) { ... on '+kind+' { '+fields+' } } }'
class AdminClient:
 def __init__(self,site,token=None,opener=None):
  if site not in STORES:raise SafeError('Unknown store.')
  self.site=site;self._token=token if token is not None else os.environ.get(TOKEN_ENV[site])
  if not isinstance(self._token,str) or not self._token.strip():raise SafeError('Set '+TOKEN_ENV[site]+' through the secure environment.')
  self._opener=opener or urllib.request.build_opener(NoRedirect(),urllib.request.HTTPSHandler(context=ssl.create_default_context()))
 def graphql(self,query,variables=None,*,mutation=False):
  request=urllib.request.Request('https://'+STORES[self.site]+'/admin/api/'+API_VERSION+'/graphql.json',data=json.dumps({'query':query,'variables':variables or {}}).encode(),headers={'Content-Type':'application/json','X-Shopify-Access-Token':self._token},method='POST')
  try:
   with self._opener.open(request,timeout=30) as response:r=json.load(response)
  except (urllib.error.URLError,TimeoutError,OSError,ValueError):
   if mutation:raise MutationUnknown('Mutation outcome unknown; no automatic retry attempted.') from None
   raise SafeError('Admin read failed; check connectivity, credentials and scopes.') from None
  if not isinstance(r,dict) or r.get('errors') or not isinstance(r.get('data'),dict):
   if mutation:raise MutationUnknown('Mutation outcome cannot be established; re-read before any retry.')
   raise SafeError('Admin GraphQL read failed; check API version and scopes.')
  return r['data']
 def node(self,kind,gid,fields):
  value=self.graphql(node_query(kind,fields),{'id':gid}).get('node')
  if value is not None and (not isinstance(value,dict) or value.get('id')!=gid):raise SafeError('Wrong or incomplete Admin node.')
  return value
 def connection(self,key,fields,extra=''):
  out=[];after=None;seen=set()
  query='query List($after:String) { '+key+'(first:100,after:$after'+extra+') { nodes { '+fields+' } pageInfo { hasNextPage endCursor } } }'
  while True:
   c=self.graphql(query,{'after':after}).get(key,{})
   if not isinstance(c.get('nodes'),list) or not isinstance(c.get('pageInfo'),dict):raise SafeError('Incomplete Admin pagination.')
   out.extend(c['nodes']);info=c['pageInfo']
   if info.get('hasNextPage') is False:return out
   after=info.get('endCursor')
   if info.get('hasNextPage') is not True or not after or after in seen:raise SafeError('Admin pagination did not advance.')
   seen.add(after)
 def definition(self):return self.graphql(DEF_QUERY).get('metaobjectDefinitionByType')
 def joyfix_public_status(self):
  request=urllib.request.Request('https://joymobile.co.il/pages/joy-fix',method='GET')
  try:
   with self._opener.open(request,timeout=30) as response:return response.status
  except urllib.error.HTTPError as e:return e.code
  except (urllib.error.URLError,TimeoutError,OSError):raise SafeError('Public JOY FIX verification failed; no menu write.') from None
 def snapshot(self):
  data={'store':STORES[self.site],'product':self.node('Product',PRODUCTS[self.site],PRODUCT_FIELDS),'branches':[x for x in self.connection('metaobjects',META_FIELDS,',type:"branch"') if x.get('handle') in BRANCH_HANDLES],'branch_definition':self.definition()}
  if self.site=='national':
   data.update(collection=self.node('Collection',COLLECTION,COLLECTION_FIELDS),menus=[x for x in self.connection('menus',MENU_FIELDS) if x.get('handle')=='footer-1'],pages=[x for x in self.connection('pages',PAGE_FIELDS) if x.get('handle')=='joy-fix'])
   page=unique(data['pages'],'joy-fix');data['joyfix_public_status']=self.joyfix_public_status() if page and page.get('isPublished') is True else None
  return data
 def mutate(self,kind,payload):
  if kind=='product':
   query='mutation Update($product:ProductUpdateInput!) { productUpdate(product:$product) { product { '+PRODUCT_FIELDS+' } userErrors { field } } }';variables={'product':payload};key='productUpdate';result_key='product'
  elif kind=='collection':
   query='mutation Update($collection:CollectionUpdateInput!) { collectionUpdate(collection:$collection) { collection { '+COLLECTION_FIELDS+' } userErrors { field } } }';variables={'collection':payload};key='collectionUpdate';result_key='collection'
  elif kind=='menu':
   query='mutation Update($id:ID!,$title:String!,$items:[MenuItemUpdateInput!]!) { menuUpdate(id:$id,title:$title,items:$items) { menu { '+MENU_FIELDS+' } userErrors { field } } }';variables=payload;key='menuUpdate';result_key='menu'
  elif kind=='metaobject':
   query='mutation Update($id:ID!,$metaobject:MetaobjectUpdateInput!) { metaobjectUpdate(id:$id,metaobject:$metaobject) { metaobject { '+META_FIELDS+' } userErrors { field } } }';variables=payload;key='metaobjectUpdate';result_key='metaobject'
  else:raise SafeError('Unknown mutation kind.')
  response=self.graphql(query,variables,mutation=True).get(key)
  if not isinstance(response,dict):raise MutationUnknown('Incomplete mutation result.')
  if response.get('userErrors'):raise SafeError('Shopify rejected a mutation; inspect content/scopes before retrying.')
  value=response.get(result_key)
  if not isinstance(value,dict):raise MutationUnknown('Incomplete mutation resource; re-read before retrying.')
  return value

def unique(rows,handle):
 matches=[x for x in rows if x.get('handle')==handle]
 if len(matches)>1:raise SafeError('Duplicate target handles; review required.')
 return matches[0] if matches else None

def normalize_items(items):
 if not isinstance(items,list):raise SafeError('Incomplete menu item list.')
 result=[]
 for item in items:
  if not isinstance(item,dict) or set(item)!=ITEM_KEYS:raise SafeError('Incomplete/unknown menu fields or excessive nesting; refusing lossy update.')
  result.append({k:(normalize_items(v) if k=='items' else v) for k,v in item.items()})
 return result

def is_joyfix_item(item,page_gid):
 if item.get('resourceId')==page_gid:return True
 url=item.get('url') or '';u=urllib.parse.urlsplit(url)
 return (not u.netloc or u.netloc.lower() in {'joymobile.co.il','www.joymobile.co.il',STORES['national']}) and u.path.rstrip('/')=='/pages/joy-fix'

def menu_contains(items,page_gid):return any(is_joyfix_item(i,page_gid) or menu_contains(i['items'],page_gid) for i in items)

def desired_menu(menu,page):
 if not page or page.get('handle')!='joy-fix' or page.get('isPublished') is not True:raise SafeError('JOY FIX must already exist and be published; this applier never creates or publishes pages.')
 if not isinstance(page.get('id'),str) or not page['id'].startswith('gid://shopify/Page/'):raise SafeError('Invalid National page identity.')
 if not menu or menu.get('handle')!='footer-1':raise SafeError('Existing National footer-1 menu required; no menu creation.')
 items=normalize_items(menu['items'])
 if menu_contains(items,page['id']):return None
 items.append({'title':'מעבדת JOY FIX','type':'PAGE','resourceId':page['id'],'items':[]})
 return {'id':menu['id'],'title':menu['title'],'items':items}

def fields_map(meta):
 fields=meta.get('fields') if meta else None
 if not isinstance(fields,list) or any(not isinstance(x,dict) or set(x)!={'key','value'} for x in fields):raise SafeError('Incomplete metaobject fields.')
 if len({x['key']for x in fields})!=len(fields):raise SafeError('Duplicate metaobject field keys.')
 return {x['key']:x['value'] for x in fields}

def canon_field(key,value):
 if key=='text' and value:
  try:return json.loads(value)
  except (ValueError,TypeError):raise SafeError('Invalid rich-text field JSON.') from None
 return value

def definition_map(definition):
 if not definition or definition.get('type')!='branch':raise SafeError('Existing branch definition required; creation refused.')
 fields=definition.get('fieldDefinitions')
 if not isinstance(fields,list):raise SafeError('Incomplete branch definition.')
 return {x['key']:x['type']['name'] for x in fields}

def verified_field_type(key,target_type,source_type):
 allowed={'rich_text_field'} if key=='text' else {'single_line_text_field','multi_line_text_field'}
 return target_type==source_type and target_type in allowed

def operation(site,kind,target,status,**extra):return {'site':site,'store':STORES[site],'kind':kind,'target':target,'status':status,**extra}

def build_plan(snapshots,manifest):
 out=[]
 for proposal in manifest['products']:
  site=next(k for k,v in STORES.items() if v==proposal['store']);current=snapshots[site]['product'];before=(D/proposal['before_description_file']).read_text();desired=(D/proposal['proposed_description_file']).read_text()
  if proposal['graphql_id']!=PRODUCTS[site] or proposal['fields_changed']!=['descriptionHtml'] or body_sha(before)!=proposal['expected_description_sha256']:raise SafeError('Product proposal scope/hash is invalid.')
  if not current or current.get('id')!=PRODUCTS[site] or current.get('handle')!='apple-iphone-17-pro':status='blocked_wrong_identity'
  elif next((x.get('values')for x in current.get('options',[]) if x.get('name')=='נפח'),None)!=proposal['verified_capacity_values']:status='blocked_changed_options'
  elif current.get('descriptionHtml')==desired:status='already_applied'
  elif current.get('descriptionHtml')!=before:status='blocked_changed_description'
  else:status='ready'
  out.append(operation(site,'product',PRODUCTS[site],status,expected=current,expected_fingerprint=fingerprint(current),payload={'id':PRODUCTS[site],'descriptionHtml':desired}))
 proposal=manifest['collections'][0];current=snapshots['national']['collection'];desired=(D/proposal['proposed_description_file']).read_text()
 if proposal['graphql_id']!=COLLECTION or proposal['fields_changed']!=['descriptionHtml']:raise SafeError('Collection proposal scope is invalid.')
 status='blocked_wrong_identity' if not current or current.get('handle')!='smartphones' else 'already_applied' if current.get('descriptionHtml')==desired else 'ready' if current.get('descriptionHtml') in ('',None) else 'blocked_existing_description'
 out.append(operation('national','collection',COLLECTION,status,expected=current,expected_fingerprint=fingerprint(current),payload={'id':COLLECTION,'descriptionHtml':desired}))
 for proposal in manifest['physical_branches']:
  handle=proposal['handle']
  if handle not in BRANCH_HANDLES or set(proposal['proposed_fields'])-BRANCH_FIELDS:raise SafeError('Unknown branch handle or field in proposal.')
  current=unique(snapshots['national']['branches'],handle);source=unique(snapshots['eilat']['branches'],handle)
  try:
   if not current or not source:raise SafeError('Existing metaobjects in both stores required; creation refused.')
   if current.get('type')!='branch' or source.get('type')!='branch':raise SafeError('Wrong metaobject type.')
   defs=definition_map(snapshots['national']['branch_definition']);source_defs=definition_map(snapshots['eilat']['branch_definition']);fields=fields_map(current);sourcefields=fields_map(source);updates=[]
   for key,value in proposal['proposed_fields'].items():
    if not verified_field_type(key,defs.get(key),source_defs.get(key)):raise SafeError('Unverified field definition/type.')
    if key not in fields or key not in sourcefields:raise SafeError('Missing existing source/target field.')
    if canon_field(key,sourcefields[key])!=canon_field(key,value):raise SafeError('Eilat Admin source does not match reviewed public proposal.')
    if canon_field(key,fields[key])!=canon_field(key,value):updates.append({'key':key,'value':sourcefields[key]})
   status='ready' if updates else 'already_applied';extra={'expected':current,'expected_fingerprint':fingerprint(current),'source_expected':source,'source_fingerprint':fingerprint(source),'definition_expected':snapshots['national']['branch_definition'],'source_definition_expected':snapshots['eilat']['branch_definition'],'payload':{'id':current['id'],'metaobject':{'fields':updates}}}
  except SafeError as e:status='blocked_branch_verification';extra={'reason':str(e)}
  out.append(operation('national','metaobject',handle,status,**extra))
 menu=unique(snapshots['national']['menus'],'footer-1');page=unique(snapshots['national']['pages'],'joy-fix')
 try:
  payload=desired_menu(menu,page)
  if snapshots['national'].get('joyfix_public_status')!=200:raise SafeError('Published JOY FIX must return public HTTP 200 before adding its menu link.')
  status='ready' if payload else 'already_applied';extra={'expected':menu,'expected_fingerprint':fingerprint(menu),'page_expected':page,'page_fingerprint':fingerprint(page),'public_page_status':200,'payload':payload}
 except SafeError as e:status='blocked_menu_dependency';extra={'reason':str(e)}
 out.append(operation('national','menu','footer-1',status,**extra))
 return {'schema_version':1,'mode':'dry_run','api_version':API_VERSION,'captured_utc':dt.datetime.now(dt.timezone.utc).isoformat(),'manifest_fingerprint':fingerprint(manifest),'operations':out}

def validate_plan(plan):
 if not isinstance(plan,dict) or plan.get('schema_version')!=1 or plan.get('api_version')!=API_VERSION or not isinstance(plan.get('operations'),list):raise SafeError('Invalid review plan.')
 seen=set();ready=[];skipped=[]
 for op in plan['operations']:
  if not isinstance(op,dict) or op.get('site')not in STORES or op.get('store')!=STORES[op['site']]:raise SafeError('Invalid operation store.')
  kind,target,site=op.get('kind'),op.get('target'),op['site'];identity=(site,kind,target)
  if identity in seen:raise SafeError('Duplicate operation.')
  seen.add(identity)
  if kind=='product' and target!=PRODUCTS[site] or kind=='collection' and (site!='national' or target!=COLLECTION) or kind in ('menu','metaobject') and site!='national' or kind=='menu' and target!='footer-1' or kind=='metaobject' and target not in BRANCH_HANDLES or kind not in ('product','collection','menu','metaobject'):raise SafeError('Unauthorized resource/kind; price, inventory, creation and publication changes are refused.')
  status=op.get('status')
  if not isinstance(status,str) or status not in {'ready','already_applied','blocked_wrong_identity','blocked_changed_options','blocked_changed_description','blocked_existing_description','blocked_branch_verification','blocked_menu_dependency'}:raise SafeError('Invalid status.')
  if status!='ready':skipped.append({'site':site,'kind':kind,'target':target,'status':status});continue
  payload=op.get('payload');expected=op.get('expected')
  if not isinstance(payload,dict) or not isinstance(expected,dict) or fingerprint(expected)!=op.get('expected_fingerprint'):raise SafeError('Invalid expected fingerprint/payload.')
  if kind in ('product','collection'):
   if set(payload)!={'id','descriptionHtml'} or payload['id']!=target or expected.get('id')!=target or not isinstance(payload['descriptionHtml'],str):raise SafeError('Only descriptionHtml is allowed; title, variants, prices, inventory and publication are refused.')
   filename=f'{site}-iphone17pro.proposed.description.html' if kind=='product' else 'national-smartphones.proposed.description.html'
   if payload['descriptionHtml']!=(D/filename).read_text():raise SafeError('Description differs from the reviewed proposal file; rebuild review artifacts.')
   if kind=='product' and (expected.get('handle')!='apple-iphone-17-pro' or expected.get('descriptionHtml')!=(D/f'{site}-iphone17pro.before.description.html').read_text() or next((x.get('values')for x in expected.get('options',[]) if x.get('name')=='נפח'),None)!=['256GB','512GB','1TB']):raise SafeError('Product baseline or verified capacity options do not match.')
   if kind=='collection' and (expected.get('handle')!='smartphones' or expected.get('descriptionHtml') not in ('',None)):raise SafeError('Only the verified empty National collection description may be filled.')
  elif kind=='metaobject':
   if set(payload)!={'id','metaobject'} or payload['id']!=expected.get('id') or not isinstance(payload['id'],str) or not payload['id'].startswith('gid://shopify/Metaobject/') or expected.get('handle')!=target or expected.get('type')!='branch' or not isinstance(payload['metaobject'],dict) or set(payload['metaobject'])!={'fields'}:raise SafeError('Only existing branch fields may update; creation/type/handle/capabilities changes refused.')
   updates=payload['metaobject']['fields']
   if not isinstance(updates,list) or not updates or any(not isinstance(x,dict) or set(x)!={'key','value'} or x['key']not in BRANCH_FIELDS or not isinstance(x['value'],str)for x in updates) or len({x['key']for x in updates})!=len(updates):raise SafeError('Unknown or duplicate branch fields.')
   source=op.get('source_expected');defs=op.get('definition_expected');source_defs=op.get('source_definition_expected')
   if not isinstance(source,dict) or fingerprint(source)!=op.get('source_fingerprint') or source.get('handle')!=target or source.get('type')!='branch':raise SafeError('Invalid branch source fingerprint.')
   sourcefields=fields_map(source);types=definition_map(defs);source_types=definition_map(source_defs)
   for x in updates:
    if x['value']!=sourcefields.get(x['key']) or not verified_field_type(x['key'],types.get(x['key']),source_types.get(x['key'])):raise SafeError('Branch values/types must match verified source fields.')
  elif kind=='menu':
   page=op.get('page_expected')
   if op.get('public_page_status')!=200 or fingerprint(page)!=op.get('page_fingerprint') or payload!=desired_menu(expected,page):raise SafeError('Menu payload must be exactly one append retaining every existing item.')
  ready.append(op)
 return ready,skipped

def live_expected(op,clients):
 client=clients[op['site']];kind=op['kind']
 if kind=='product':return client.node('Product',op['target'],PRODUCT_FIELDS)
 if kind=='collection':return client.node('Collection',op['target'],COLLECTION_FIELDS)
 if kind=='metaobject':
  source=clients['eilat'].node('Metaobject',op['source_expected']['id'],META_FIELDS)
  if fingerprint(source)!=op['source_fingerprint'] or clients['national'].definition()!=op['definition_expected'] or clients['eilat'].definition()!=op['source_definition_expected']:raise SafeError('Branch source/definition changed; refresh review before writing.')
  return client.node('Metaobject',op['expected']['id'],META_FIELDS)
 if kind=='menu':
  page=client.node('Page',op['page_expected']['id'],PAGE_FIELDS)
  if fingerprint(page)!=op['page_fingerprint'] or not page or page.get('isPublished') is not True:raise SafeError('JOY FIX page changed/unpublished; no menu write.')
  if client.joyfix_public_status()!=200:raise SafeError('Public JOY FIX is unavailable; no menu write.')
  return client.node('Menu',op['expected']['id'],MENU_FIELDS)
 raise SafeError('Unknown target.')

def outcome_matches(op,result):
 kind=op['kind'];p=op['payload']
 if not isinstance(result,dict) or result.get('id')!=p['id']:return False
 if kind in ('product','collection'):return result.get('descriptionHtml')==p['descriptionHtml'] and result.get('handle')==op['expected'].get('handle')
 if kind=='metaobject':
  fields=fields_map(result);return result.get('handle')==op['target'] and result.get('type')=='branch' and all(fields.get(x['key'])==x['value']for x in p['metaobject']['fields'])
 if kind=='menu':
  if result.get('handle')!='footer-1' or result.get('title')!=p['title']:return False
  items=normalize_items(result.get('items'));old=normalize_items(op['expected']['items'])
  return len(items)==len(old)+1 and items[:-1]==old and items[-1]['title']=='מעבדת JOY FIX' and items[-1]['type']=='PAGE' and items[-1]['resourceId']==op['page_expected']['id'] and items[-1]['items']==[]
 return False

def apply_plan(plan,clients):
 ready,skipped=validate_plan(plan);report={'mode':'apply','completed':[],'skipped':skipped,'stopped':False}
 try:
  # Preflight every ready operation before the first write, then again immediately before its write.
  for op in ready:
   if fingerprint(live_expected(op,clients))!=op['expected_fingerprint']:raise SafeError('A target changed since snapshot; no writes started.')
  for op in ready:
   if fingerprint(live_expected(op,clients))!=op['expected_fingerprint']:raise SafeError('A target changed during execution; remaining writes stopped.')
   result=clients[op['site']].mutate(op['kind'],copy.deepcopy(op['payload']))
   if not outcome_matches(op,result):raise MutationUnknown('Mutation result differs from requested change; stop and reconcile with fresh reads.')
   report['completed'].append({'site':op['site'],'kind':op['kind'],'target':op['target'],'id':result['id']})
 except SafeError as e:
  report.update(stopped=True,error=str(e),outcome_unknown=isinstance(e,MutationUnknown))
  if 'op' in locals():report['failed_operation']={'site':op['site'],'kind':op['kind'],'target':op['target']}
  if isinstance(e,MutationUnknown) and 'op' in locals():
   try:
    observed=live_expected(op,clients);report['observed_after_failure_fingerprint']=fingerprint(observed);report['observed_requested_result']=outcome_matches(op,observed)
   except SafeError:report['reread_failed']=True
  raise ApplyStopped(str(e),report) from None
 return report

def private_write(path,value):
 fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
 try:
  os.fchmod(fd,0o600)
  with os.fdopen(fd,'w',encoding='utf-8') as stream:stream.write(json.dumps(value,ensure_ascii=False,indent=2)+'\n')
 except Exception:
  try:os.close(fd)
  except OSError:pass
  raise

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--apply',type=pathlib.Path,metavar='REVIEWED_PLAN',help='Explicitly apply a previously saved plan; all targets are re-read first');p.add_argument('--snapshot-output',type=pathlib.Path,default=D/'admin-catalog-snapshot.json');p.add_argument('--plan-output',type=pathlib.Path,default=D/'admin-catalog-plan.json');p.add_argument('--report-output',type=pathlib.Path,default=D/'admin-catalog-apply-report.json');args=p.parse_args()
 try:
  clients={site:AdminClient(site)for site in STORES}
  if args.apply:
   plan=json.loads(args.apply.read_text());manifest=json.loads((D/'catalog-navigation-manifest.json').read_text())
   if plan.get('manifest_fingerprint')!=fingerprint(manifest):raise SafeError('Proposal manifest changed since the review plan; regenerate the dry-run.')
   report=apply_plan(plan,clients);private_write(args.report_output,report);print(json.dumps({'completed':len(report['completed']),'skipped':len(report['skipped']),'report_file':str(args.report_output)}))
  else:
   snapshots={site:client.snapshot()for site,client in clients.items()};private_write(args.snapshot_output,snapshots);manifest=json.loads((D/'catalog-navigation-manifest.json').read_text());plan=build_plan(snapshots,manifest);validate_plan(plan);private_write(args.plan_output,plan);print(json.dumps({'mode':'dry_run','statuses':[{'site':x['site'],'kind':x['kind'],'target':x['target'],'status':x['status']}for x in plan['operations']],'snapshot_file':str(args.snapshot_output),'plan_file':str(args.plan_output)}))
 except ApplyStopped as e:private_write(args.report_output,e.report);print(str(e),file=sys.stderr);return 1
 except (SafeError,ValueError,OSError,KeyError,TypeError) as e:print(str(e) if isinstance(e,SafeError) else 'Invalid or unreadable local plan/input; no additional writes attempted.',file=sys.stderr);return 1
 return 0
if __name__=='__main__':raise SystemExit(main())
