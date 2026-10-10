"""Compile reviewable page operations. Offline, dry-run only: never sends API requests."""
import argparse,datetime,html,json,pathlib,re,sys,zoneinfo
from html.parser import HTMLParser

class CanonicalHTML(HTMLParser):
 """Ignore HTML serialization differences, retaining text, tags and attributes."""
 def __init__(self):super().__init__(convert_charrefs=True);self.parts=[]
 def handle_starttag(self,tag,attrs):self.parts.append(('start',tag,tuple(sorted(attrs))))
 def handle_startendtag(self,tag,attrs):self.handle_starttag(tag,attrs);self.handle_endtag(tag)
 def handle_endtag(self,tag):
  if tag not in {'area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'}:self.parts.append(('end',tag))
 def handle_data(self,data):
  text=' '.join(data.split())
  if text:self.parts.append(('text',text))
def equivalent_html(left,right):
 l=CanonicalHTML();r=CanonicalHTML();l.feed(left);r.feed(right);return l.parts==r.parts
P=argparse.ArgumentParser(description=__doc__)
P.add_argument('--facts',type=pathlib.Path,help='JSON object of confirmed National facts; values are HTML escaped')
P.add_argument('--snapshot',type=pathlib.Path,help='Fresh Admin JSON {pages:[{id,handle,body_html,template_suffix}]} for strict before/already-applied checks')
P.add_argument('--publication-date',help='Actual Israel publication date, YYYY-MM-DD; default is today, provisional until apply')
P.add_argument('--output',type=pathlib.Path,help='Write proposed operations JSON; no remote writes')
a=P.parse_args();D=pathlib.Path(__file__).parent;manifest=json.loads((D/'manifest.json').read_text())
facts=json.loads(a.facts.read_text()) if a.facts else {}
snapshot=json.loads(a.snapshot.read_text()) if a.snapshot else None
if snapshot is not None and not isinstance(snapshot,dict):raise SystemExit('Snapshot must be {pages:[...]}')
current={p['handle']:p for p in snapshot.get('pages',[])} if snapshot is not None else None
stamp=datetime.date.fromisoformat(a.publication_date) if a.publication_date else datetime.datetime.now(zoneinfo.ZoneInfo('Asia/Jerusalem')).date()
stamp_text=f'{stamp.day}.{stamp.month}.{stamp.year}'
operations=[]
for page in manifest['pages']:
 op={'handle':page['handle'],'id':page['id'],'operation':page['operation'],'status':page['status']}
 if page['operation']=='patch_theme_template_settings':
  op['patch_notes_file']=page['patch_notes_file'];op['status']='root_owned_theme_patch';operations.append(op);continue
 proposed=(D/page['proposed_body_html_file']).read_text().strip().replace('{{publication_date}}',stamp_text)
 missing=[]
 for token,key in page.get('fact_bindings',{}).items():
  value=facts.get(key)
  if not isinstance(value,str) or not value.strip():missing.append(key);continue
  if '[' in value or ']' in value:raise SystemExit(f'Fact {key} contains unresolved placeholder brackets')
  proposed=proposed.replace(token,html.escape(value.strip(),quote=True))
 unresolved=re.findall(r'\[[^\]\n<>]+\]',proposed)
 if missing or unresolved:
  op.update(status='blocked_missing_confirmed_facts',missing_facts=missing,remaining_placeholders=unresolved);operations.append(op);continue
 payload={'handle':page['handle'],'body_html':proposed}
 if page['operation']=='create_page_if_handle_absent':payload.update(title=page['title'],template_suffix=page['template_suffix'],published=True)
 op['payload']={'page':payload};op['publication_date_provisional_until_apply']=stamp.isoformat()
 if current is None:
  op['status']='requires_fresh_admin_snapshot';op['reason']='Public rendered HTML cannot establish Admin body concurrency or prove a handle is absent.'
 else:
  existing=current.get(page['handle'])
  if existing:
   op['id']=str(existing['id']);payload['id']=existing['id'];actual=(existing.get('body_html') or '').strip()
   if actual==proposed and (page['operation']!='create_page_if_handle_absent' or existing.get('template_suffix')==page['template_suffix']):op['status']='already_applied';op.pop('payload')
   elif page['operation']=='create_page_if_handle_absent':op['status']='conflict_existing_handle';op.pop('payload')
   else:
    expected=(D/page['before_body_html_file']).read_text().strip()
    if str(existing['id'])!=page['id'] or not equivalent_html(actual,expected):op['status']='conflict_changed_content';op.pop('payload')
    else:op['status']='ready_to_update';op['expected_body_html']=existing['body_html']
  elif page['operation']=='create_page_if_handle_absent':op['status']='ready_to_create'
  else:op['status']='conflict_missing_page';op.pop('payload')
 operations.append(op)
result={'mode':'dry_run','remote_writes':False,'store':manifest['store'],'note':'Only confirmed facts and a fresh Admin snapshot can yield executable page operations. Re-read expected content before a separate authorized applier writes. This helper never calls Shopify.','operations':operations}
data=json.dumps(result,ensure_ascii=False,indent=2)+'\n'
if a.output:a.output.write_text(data)
else:sys.stdout.write(data)
