"""Offline regression tests only; no credentials or network calls."""
import copy,importlib.util,json,pathlib,unittest
D=pathlib.Path(__file__).parent
spec=importlib.util.spec_from_file_location('admin_catalog',D/'admin-catalog.py');A=importlib.util.module_from_spec(spec);spec.loader.exec_module(A)
MANIFEST=json.loads((D/'catalog-navigation-manifest.json').read_text())

def item(gid,title='existing',url='/pages/about',children=None):return {'id':gid,'title':title,'type':'PAGE','url':url,'resourceId':'gid://shopify/Page/10','tags':[],'items':children or []}
def fixtures():
 definition={'type':'branch','fieldDefinitions':[{'key':key,'type':{'name':'rich_text_field' if key=='text' else 'single_line_text_field'}}for key in sorted(A.BRANCH_FIELDS)]}
 snapshots={}
 for site in A.STORES:
  proposal=next(p for p in MANIFEST['products'] if p['store']==A.STORES[site]);product={'id':A.PRODUCTS[site],'handle':'apple-iphone-17-pro','descriptionHtml':(D/proposal['before_description_file']).read_text(),'options':[{'name':'נפח','values':['256GB','512GB','1TB']}]}
  branches=[]
  for n,p in enumerate(MANIFEST['physical_branches']):
   rendered=p['before_rendered'] if site=='national' else p['proposed_rendered'];fields={k:rendered[k]for k in ('name','address','map_query')};fields['text']=rendered['text_rich_text_field_value'] or '';fields.update(phone='unchanged-phone',services='unchanged-services',hours='unchanged-hours',company='unrelated-legal-field')
   branches.append({'id':f'gid://shopify/Metaobject/{1000+n if site=="national" else 2000+n}','handle':p['handle'],'type':'branch','updatedAt':'snapshot-time','fields':[{'key':k,'value':v}for k,v in fields.items()]})
  snapshots[site]={'store':A.STORES[site],'product':product,'branches':branches,'branch_definition':copy.deepcopy(definition)}
 snapshots['national'].update(collection={'id':A.COLLECTION,'handle':'smartphones','descriptionHtml':''},menus=[{'id':'gid://shopify/Menu/11','handle':'footer-1','title':'חנויות','items':[item('gid://shopify/MenuItem/12',children=[item('gid://shopify/MenuItem/13','nested')])]}],pages=[{'id':'gid://shopify/Page/44','handle':'joy-fix','isPublished':True}],joyfix_public_status=200)
 return snapshots
class FakeClient:
 def __init__(self,site,snapshot):self.site=site;self.data=copy.deepcopy(snapshot);self.writes=[];self.public_status=200;self.fail=False
 def node(self,kind,gid,fields):
  rows=[self.data.get('product'),self.data.get('collection')]+self.data.get('branches',[])+self.data.get('menus',[])+self.data.get('pages',[])
  return copy.deepcopy(next((x for x in rows if x and x['id']==gid),None))
 def definition(self):return copy.deepcopy(self.data['branch_definition'])
 def joyfix_public_status(self):return self.public_status
 def mutate(self,kind,payload):
  self.writes.append((kind,copy.deepcopy(payload)))
  if self.fail:raise A.MutationUnknown('Mock lost response; no retry.')
  if kind in ('product','collection'):
   row=self.data[kind];row['descriptionHtml']=payload['descriptionHtml']
  elif kind=='metaobject':
   row=next(x for x in self.data['branches']if x['id']==payload['id']);fields=A.fields_map(row)
   for x in payload['metaobject']['fields']:fields[x['key']]=x['value']
   row['fields']=[{'key':k,'value':v}for k,v in fields.items()];row['updatedAt']='after-write'
  elif kind=='menu':
   row=self.data['menus'][0];old=payload['items'][:-1];new=payload['items'][-1];row['items']=copy.deepcopy(old)+[{'id':'gid://shopify/MenuItem/99','title':new['title'],'type':new['type'],'url':'https://joymobile.co.il/pages/joy-fix','resourceId':new['resourceId'],'tags':[],'items':[]}]
  return copy.deepcopy(row)
class Tests(unittest.TestCase):
 def setUp(self):self.s=fixtures();self.plan=A.build_plan(self.s,MANIFEST);self.clients={k:FakeClient(k,v)for k,v in self.s.items()}
 def ready(self,kind,site='national'):return next(x for x in self.plan['operations']if x['kind']==kind and x['site']==site and x['status']=='ready')
 def assert_no_writes(self):self.assertFalse(any(c.writes for c in self.clients.values()))
 def test_apply_exact_scoped_payloads(self):
  original_menu=copy.deepcopy(self.s['national']['menus'][0]['items']);r=A.apply_plan(self.plan,self.clients);self.assertEqual(len(r['completed']),8)
  self.assertEqual(self.clients['national'].data['menus'][0]['items'][:-1],original_menu)
  for c in self.clients.values():
   for kind,p in c.writes:
    if kind in ('product','collection'):self.assertEqual(set(p),{'id','descriptionHtml'})
    elif kind=='metaobject':self.assertEqual(set(p['metaobject']),{'fields'});self.assertTrue(all(x['key']in A.BRANCH_FIELDS for x in p['metaobject']['fields']))
  self.assertEqual(A.fields_map(self.clients['national'].data['branches'][0])['company'],'unrelated-legal-field')
 def test_stale_preflight_aborts_before_any_mutation(self):
  self.clients['eilat'].data['product']['descriptionHtml']+=' concurrent'
  with self.assertRaises(A.ApplyStopped)as e:A.apply_plan(self.plan,self.clients)
  self.assertEqual(e.exception.report['completed'],[]);self.assert_no_writes()
 def test_stale_menu_nested_item_aborts_all(self):
  self.clients['national'].data['menus'][0]['items'][0]['items'][0]['title']='changed'
  with self.assertRaises(A.ApplyStopped):A.apply_plan(self.plan,self.clients)
  self.assert_no_writes()
 def test_target_changes_after_global_preflight_before_first_write(self):
  c=self.clients['national'];original=c.node;calls=0
  def node(kind,gid,fields):
   nonlocal calls
   if kind=='Product':
    calls+=1
    if calls==2:c.data['product']['descriptionHtml']+=' late change'
   return original(kind,gid,fields)
  c.node=node
  with self.assertRaises(A.ApplyStopped):A.apply_plan(self.plan,self.clients)
  self.assert_no_writes()
 def test_idempotent_descriptions_and_menu(self):
  for site in A.STORES:self.s[site]['product']['descriptionHtml']=(D/f'{site}-iphone17pro.proposed.description.html').read_text()
  self.s['national']['collection']['descriptionHtml']=(D/'national-smartphones.proposed.description.html').read_text()
  child=item('gid://shopify/MenuItem/90',url='https://joymobile.co.il/pages/joy-fix');self.s['national']['menus'][0]['items'][0]['items'].append(child)
  p=A.build_plan(self.s,MANIFEST)
  for x in p['operations']:
   if x['kind']in ('product','collection','menu'):self.assertEqual(x['status'],'already_applied')
 def test_unpublished_page_refused(self):
  self.s['national']['pages'][0]['isPublished']=False;p=A.build_plan(self.s,MANIFEST);self.assertEqual(next(x for x in p['operations']if x['kind']=='menu')['status'],'blocked_menu_dependency')
 def test_public404_page_refused(self):
  self.s['national']['joyfix_public_status']=404;p=A.build_plan(self.s,MANIFEST);self.assertEqual(next(x for x in p['operations']if x['kind']=='menu')['status'],'blocked_menu_dependency')
 def test_page_unpublished_after_plan_aborts_all(self):
  self.clients['national'].data['pages'][0]['isPublished']=False
  with self.assertRaises(A.ApplyStopped):A.apply_plan(self.plan,self.clients)
  self.assert_no_writes()
 def test_missing_branch_refuses_creation(self):
  self.s['national']['branches']=[];p=A.build_plan(self.s,MANIFEST);self.assertTrue(all(x['status']=='blocked_branch_verification'for x in p['operations']if x['kind']=='metaobject'))
 def test_unknown_branch_field_refused(self):
  self.ready('metaobject')['payload']['metaobject']['fields'].append({'key':'company','value':'new company'})
  with self.assertRaises(A.SafeError):A.validate_plan(self.plan)
 def test_branch_capability_publication_changes_refused(self):
  self.ready('metaobject')['payload']['metaobject']['capabilities']={'publishable':{'status':'ACTIVE'}}
  with self.assertRaises(A.SafeError):A.validate_plan(self.plan)
 def test_price_inventory_publication_title_variant_fields_refused(self):
  for field in ['price','inventoryQuantity','isPublished','title','variants']:
   p=copy.deepcopy(self.plan);op=next(x for x in p['operations']if x['kind']=='product');op['payload'][field]='forbidden'
   with self.assertRaises(A.SafeError,msg=field):A.validate_plan(p)
 def test_unknown_target_and_creation_refused(self):
  for kind,target in [('create','branch-new'),('product','gid://shopify/Product/999'),('metaobject','branch-new')]:
   p=copy.deepcopy(self.plan);p['operations'][0].update(kind=kind,target=target)
   with self.assertRaises(A.SafeError):A.validate_plan(p)
 def test_menu_item_removal_refused(self):
  self.ready('menu')['payload']['items'].pop(0)
  with self.assertRaises(A.SafeError):A.validate_plan(self.plan)
 def test_incomplete_menu_field_refused(self):
  del self.s['national']['menus'][0]['items'][0]['tags']
  with self.assertRaises(A.SafeError):A.desired_menu(self.s['national']['menus'][0],self.s['national']['pages'][0])
 def test_source_branch_changed_aborts_all(self):
  self.clients['eilat'].data['branches'][0]['fields'][0]['value']='changed source'
  with self.assertRaises(A.ApplyStopped):A.apply_plan(self.plan,self.clients)
  self.assert_no_writes()
 def test_definition_change_aborts_all(self):
  self.clients['national'].data['branch_definition']['fieldDefinitions'][0]['type']['name']='integer'
  with self.assertRaises(A.ApplyStopped):A.apply_plan(self.plan,self.clients)
  self.assert_no_writes()
 def test_unknown_outcome_stops_and_reports_partial(self):
  self.clients['eilat'].fail=True
  with self.assertRaises(A.ApplyStopped)as e:A.apply_plan(self.plan,self.clients)
  self.assertEqual(len(e.exception.report['completed']),1);self.assertTrue(e.exception.report['outcome_unknown']);self.assertEqual(len(self.clients['eilat'].writes),1);self.assertFalse(any(k!='product'for k,p in self.clients['national'].writes))
  self.assertFalse(e.exception.report['observed_requested_result'])
 def test_lost_response_after_realized_mock_write_reconciles_without_retry(self):
  c=self.clients['eilat'];original=c.mutate
  def mutate(kind,payload):original(kind,payload);raise A.MutationUnknown('Mock response lost after write.')
  c.mutate=mutate
  with self.assertRaises(A.ApplyStopped)as e:A.apply_plan(self.plan,self.clients)
  self.assertTrue(e.exception.report['observed_requested_result']);self.assertEqual(len(c.writes),1)
 def test_eilat_url_does_not_suppress_national_menu_link(self):
  self.s['national']['menus'][0]['items'][0]['url']='https://www.eilat.joymobile.co.il/pages/joy-fix'
  self.assertIsNotNone(A.desired_menu(self.s['national']['menus'][0],self.s['national']['pages'][0]))
 def test_changed_capacity_blocks_product(self):
  self.s['national']['product']['options'][0]['values']=['512GB'];p=A.build_plan(self.s,MANIFEST);self.assertEqual(next(x for x in p['operations']if x['kind']=='product'and x['site']=='national')['status'],'blocked_changed_options')
 def test_pagination_and_cursor_guard(self):
  c=object.__new__(A.AdminClient);calls=[]
  def graphql(query,vars):
   calls.append(vars['after']);return {'menus':{'nodes':[{'id':str(len(calls))}],'pageInfo':{'hasNextPage':len(calls)==1,'endCursor':'next'}}}
  c.graphql=graphql;self.assertEqual(c.connection('menus','id'),[{'id':'1'},{'id':'2'}]);self.assertEqual(calls,[None,'next'])
  c.graphql=lambda q,v:{'menus':{'nodes':[],'pageInfo':{'hasNextPage':True,'endCursor':'repeated'}}}
  with self.assertRaises(A.SafeError):c.connection('menus','id')
if __name__=='__main__':unittest.main()
