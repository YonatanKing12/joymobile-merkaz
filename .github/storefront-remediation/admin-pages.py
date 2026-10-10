"""Restricted National Shopify page applier. Read-only unless --apply PLAN is explicit."""
from __future__ import annotations
import argparse
import datetime as dt
import json
import os
import pathlib
import re
import ssl
import sys
import urllib.error
import urllib.request

STORE = 'k8qhkp-gn.myshopify.com'
API_VERSION = '2026-07'
TOKEN_ENV = 'SHOPIFY_NATIONAL_ADMIN_TOKEN'
ALLOWED_IDS = {
    'about': '720270197105', 'shipping': '720269934961',
    'terms': '720270033265', 'returns': '720269967729',
    'privacy': '720270000497', 'accessibility': '720270164337',
}
STATUSES = {
    'ready_to_update', 'ready_to_create', 'already_applied',
    'blocked_missing_confirmed_facts', 'requires_fresh_admin_snapshot',
    'conflict_existing_handle', 'conflict_changed_content', 'conflict_missing_page',
    'root_owned_theme_patch',
}
FIELDS = 'id handle body templateSuffix title updatedAt isPublished'
PAGES_QUERY = 'query Pages($after: String) { pages(first: 100, after: $after) { nodes { ' + FIELDS + ' } pageInfo { hasNextPage endCursor } } }'
UPDATE_MUTATION = 'mutation UpdatePage($id: ID!, $page: PageUpdateInput!) { pageUpdate(id: $id, page: $page) { page { ' + FIELDS + ' } userErrors { code field } } }'
CREATE_MUTATION = 'mutation CreatePage($page: PageCreateInput!) { pageCreate(page: $page) { page { ' + FIELDS + ' } userErrors { code field } } }'

class SafeError(Exception):
    pass

class MutationUnknown(SafeError):
    pass

class ApplyStopped(SafeError):
    def __init__(self, message, report):
        super().__init__(message)
        self.report = report

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None

def numeric_id(value):
    value = str(value)
    if value.startswith('gid://shopify/Page/'):
        value = value.removeprefix('gid://shopify/Page/')
    if not re.fullmatch(r'[0-9]+', value):
        raise SafeError('Invalid page ID.')
    return value

def normalize_page(page):
    required = {'id', 'handle', 'body', 'templateSuffix', 'title', 'updatedAt', 'isPublished'}
    if not isinstance(page, dict) or not required.issubset(page):
        raise SafeError('Incomplete Admin page response.')
    if not isinstance(page['handle'], str) or not isinstance(page['title'], str) or not isinstance(page['body'], str):
        raise SafeError('Invalid Admin page response.')
    return {
        'id': numeric_id(page['id']), 'handle': page['handle'], 'body_html': page['body'],
        'template_suffix': page['templateSuffix'], 'title': page['title'],
        'updatedAt': page['updatedAt'], 'isPublished': page['isPublished'],
    }

class AdminClient:
    def __init__(self, token=None, opener=None):
        self._token = token if token is not None else os.environ.get(TOKEN_ENV)
        if not isinstance(self._token, str) or not self._token.strip():
            raise SafeError(f'Set {TOKEN_ENV} through the secure environment before running.')
        self._opener = opener or urllib.request.build_opener(
            NoRedirect(), urllib.request.HTTPSHandler(context=ssl.create_default_context()))

    def graphql(self, query, variables, *, mutation=False):
        request = urllib.request.Request(
            f'https://{STORE}/admin/api/{API_VERSION}/graphql.json',
            data=json.dumps({'query': query, 'variables': variables}).encode(),
            headers={'Content-Type': 'application/json', 'X-Shopify-Access-Token': self._token},
            method='POST')
        try:
            with self._opener.open(request, timeout=30) as response:
                result = json.load(response)
        except (urllib.error.URLError, TimeoutError, OSError, ValueError):
            if mutation:
                raise MutationUnknown('Mutation response was not received; no automatic retry was attempted.') from None
            raise SafeError('Admin read failed. Check connectivity, token and content scopes; no writes attempted by this request.') from None
        if not isinstance(result, dict) or result.get('errors') or not isinstance(result.get('data'), dict):
            if mutation:
                raise MutationUnknown('Mutation response could not establish its outcome; no automatic retry was attempted.')
            raise SafeError('Admin GraphQL read failed. Check API version and read content access.')
        return result['data']

    def snapshot(self):
        pages, after, seen = [], None, set()
        while True:
            result = self.graphql(PAGES_QUERY, {'after': after})
            connection = result.get('pages', {})
            if not isinstance(connection.get('nodes'), list) or not isinstance(connection.get('pageInfo'), dict):
                raise SafeError('Incomplete Admin page pagination response.')
            pages.extend(normalize_page(page) for page in connection['nodes'])
            info = connection['pageInfo']
            if info.get('hasNextPage') is False:
                break
            after = info.get('endCursor')
            if not after or after in seen:
                raise SafeError('Admin pagination did not advance; snapshot is incomplete.')
            seen.add(after)
        return {'store': STORE, 'api_version': API_VERSION, 'captured_utc': dt.datetime.now(dt.timezone.utc).isoformat(), 'pages': pages}

    def update(self, operation):
        data = self.graphql(UPDATE_MUTATION, {'id': 'gid://shopify/Page/' + operation['id'], 'page': {'body': operation['body']}}, mutation=True)
        return self._mutation_page(data, 'pageUpdate')

    def create(self, operation):
        payload = {'handle': 'joy-fix', 'body': operation['body'], 'title': operation['title'], 'templateSuffix': 'joy-fix', 'isPublished': True}
        data = self.graphql(CREATE_MUTATION, {'page': payload}, mutation=True)
        return self._mutation_page(data, 'pageCreate')

    @staticmethod
    def _mutation_page(data, key):
        result = data.get(key)
        if not isinstance(result, dict):
            raise MutationUnknown('Mutation result is incomplete; its outcome requires a fresh read.')
        if result.get('userErrors'):
            raise SafeError('Shopify rejected the page mutation; review content and write access before retrying.')
        try:
            return normalize_page(result['page'])
        except (KeyError, SafeError):
            raise MutationUnknown('Mutation page response is incomplete; its outcome requires a fresh read.') from None

def validate_plan(plan):
    if not isinstance(plan, dict) or plan.get('store') != STORE or not isinstance(plan.get('operations'), list):
        raise SafeError('Plan must target the fixed National store and contain an operations list.')
    executable, skipped, seen = [], [], set()
    for raw in plan['operations']:
        if not isinstance(raw, dict):
            raise SafeError('Invalid operation.')
        handle, status, kind = raw.get('handle'), raw.get('status'), raw.get('operation')
        if handle not in set(ALLOWED_IDS) | {'joy-fix', 'faqs', 'contact'} or handle in seen:
            raise SafeError('Unknown, tampered or duplicate page handle in plan.')
        seen.add(handle)
        if status not in STATUSES:
            raise SafeError('Unknown operation status; rebuild the plan with prepare-updates.py.')
        expected_kind = 'update_page_body_html' if handle in ALLOWED_IDS else 'create_page_if_handle_absent' if handle == 'joy-fix' else 'patch_theme_template_settings'
        if kind != expected_kind:
            raise SafeError('Operation kind does not match its allowed page handle.')
        if status not in {'ready_to_update', 'ready_to_create'}:
            skipped.append({'handle': handle, 'status': status, 'executed': False})
            continue
        if (status == 'ready_to_update') != (handle in ALLOWED_IDS):
            raise SafeError('Executable operation has an invalid status for its handle.')
        payload = raw.get('payload')
        if not isinstance(payload, dict) or set(payload) != {'page'} or not isinstance(payload['page'], dict):
            raise SafeError('Executable operation requires a page-only payload.')
        page = payload['page']
        if page.get('handle') != handle or not isinstance(page.get('body_html'), str) or not page['body_html'].strip():
            raise SafeError('Tampered page handle or invalid body.')
        if re.search(r'\{\{publication_date\}\}|\[[^\]\n<>]+\]', page['body_html']):
            raise SafeError('Proposed body contains unresolved placeholders.')
        operation = {'handle': handle, 'kind': kind, 'body': page['body_html']}
        if status == 'ready_to_update':
            if set(page) - {'id', 'handle', 'body_html'} or 'id' not in page:
                raise SafeError('Updates may change only body_html; other page fields are forbidden.')
            identifier = numeric_id(raw.get('id'))
            if identifier != ALLOWED_IDS[handle] or numeric_id(page['id']) != identifier:
                raise SafeError('Page ID does not match the fixed audited page.')
            if not isinstance(raw.get('expected_body_html'), str):
                raise SafeError('Updates require the exact fresh Admin expected_body_html.')
            operation.update(id=identifier, expected=raw['expected_body_html'])
        else:
            if set(page) != {'handle', 'body_html', 'title', 'template_suffix', 'published'} or page.get('published') is not True or page.get('template_suffix') != 'joy-fix' or not isinstance(page.get('title'), str) or not page['title'].strip() or raw.get('id') is not None:
                raise SafeError('Only a published joy-fix page with template joy-fix may be created.')
            operation['title'] = page['title']
        executable.append(operation)
    return executable, skipped

def preflight(operations, snapshot):
    if snapshot.get('store') != STORE or not isinstance(snapshot.get('pages'), list):
        raise SafeError('Invalid fresh Admin snapshot.')
    by_handle, identifiers = {}, set()
    for page in snapshot['pages']:
        handle, identifier = page['handle'], numeric_id(page['id'])
        if handle in by_handle or identifier in identifiers:
            raise SafeError('Duplicate handle or page ID in fresh Admin snapshot.')
        by_handle[handle] = page
        identifiers.add(identifier)
    decisions = []
    for op in operations:
        current = by_handle.get(op['handle'])
        if op['kind'] == 'update_page_body_html':
            if not current or numeric_id(current['id']) != op['id']:
                raise SafeError(f"Page identity changed for {op['handle']}; nothing in this preflight may execute.")
            if current['body_html'] == op['body']:
                status = 'already_applied'
            elif current['body_html'] != op['expected']:
                raise SafeError(f"Admin content changed for {op['handle']}; rebuild the plan from a new snapshot.")
            else:
                status = 'ready_to_update'
        elif current:
            if current['body_html'] != op['body'] or current.get('template_suffix') != 'joy-fix' or current.get('title') != op['title'] or current.get('isPublished') is not True:
                raise SafeError('joy-fix already exists with different content/settings; no creation allowed.')
            status = 'already_applied'
        else:
            status = 'ready_to_create'
        decisions.append({'handle': op['handle'], 'status': status})
    return decisions

def save_private(path, data, *, exclusive=False):
    path = pathlib.Path(path)
    flags = os.O_WRONLY | os.O_CREAT | (os.O_EXCL if exclusive else os.O_TRUNC)
    descriptor = os.open(path, flags, 0o600)
    os.fchmod(descriptor, 0o600)
    with os.fdopen(descriptor, 'w', encoding='utf-8') as file:
        file.write(json.dumps(data, ensure_ascii=False, indent=2) + '\n')

def run_plan(client, plan, *, apply=False, backup_path=None):
    operations, skipped = validate_plan(plan)
    snapshot = client.snapshot()
    decisions = preflight(operations, snapshot)  # Whole executable plan checked before any mutation.
    report = {'store': STORE, 'mode': 'apply' if apply else 'dry_run', 'results': decisions + skipped, 'remote_writes': 0, 'mutation_attempts': 0}
    if not apply or not any(d['status'].startswith('ready_') for d in decisions):
        return report
    if backup_path is None:
        raise SafeError('Apply requires an actual Admin backup path.')
    save_private(backup_path, snapshot, exclusive=True)  # Backup must succeed before the first write.
    report['backup_file'] = str(backup_path)
    report['results'] = []
    for operation in operations:
        try:
            fresh = client.snapshot()
            decision = preflight([operation], fresh)[0]  # Recheck immediately before each mutation.
            if decision['status'] == 'already_applied':
                report['results'].append(decision)
                continue
            try:
                report['mutation_attempts'] += 1
                page = client.update(operation) if operation['kind'] == 'update_page_body_html' else client.create(operation)
                if page['handle'] != operation['handle'] or page['body_html'] != operation['body'] or (operation['kind'] == 'update_page_body_html' and numeric_id(page['id']) != operation['id']) or (operation['kind'] == 'create_page_if_handle_absent' and (page.get('template_suffix') != 'joy-fix' or page.get('isPublished') is not True or page.get('title') != operation['title'])):
                    raise MutationUnknown('Shopify returned unexpected page state; re-read before proceeding.')
            except MutationUnknown:
                try:
                    observed = preflight([operation], client.snapshot())[0]
                    state = 'confirmed_applied_after_unknown_response' if observed['status'] == 'already_applied' else 'confirmed_not_applied_after_unknown_response'
                    if observed['status'] == 'already_applied':
                        report['remote_writes'] += 1
                except SafeError:
                    state = 'unknown_outcome_requires_new_snapshot'
                report['results'].append({'handle': operation['handle'], 'status': state, 'automatic_retry': False})
                raise ApplyStopped('Mutation response was uncertain. A fresh read was attempted; stop and review before rerunning.', report) from None
            report['remote_writes'] += 1
            report['results'].append({'handle': operation['handle'], 'status': 'updated' if operation['kind'] == 'update_page_body_html' else 'created', 'id': page['id']})
        except ApplyStopped:
            raise
        except SafeError as error:
            report['results'].append({'handle': operation['handle'], 'status': 'stopped', 'reason': str(error)})
            raise ApplyStopped('Apply stopped; review the local report and backup before continuing.', report) from None
    report['results'].extend(skipped)
    return report

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--plan', type=pathlib.Path, help='Preflight this operations JSON without writing remotely (default).')
    mode.add_argument('--apply', type=pathlib.Path, help='Explicitly apply this operations JSON after all checks and backup.')
    parser.add_argument('--snapshot', type=pathlib.Path, help='Save all Admin pages, including unpublished pages, locally.')
    parser.add_argument('--backup', type=pathlib.Path, help='New backup file; must not already exist.')
    parser.add_argument('--report', type=pathlib.Path, help='Save a local outcome report (no credentials).')
    args = parser.parse_args(argv)
    try:
        client = AdminClient()  # No token means fail before any network request.
        if args.snapshot:
            save_private(args.snapshot, client.snapshot())
        plan_path = args.apply or args.plan
        if plan_path:
            plan = json.loads(plan_path.read_text())
            backup = args.backup or pathlib.Path(__file__).with_name('admin-pages-backup-' + dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ') + '.json')
            report = run_plan(client, plan, apply=bool(args.apply), backup_path=backup)
        elif not args.snapshot:
            snapshot = client.snapshot()
            report = {'store': STORE, 'mode': 'dry_run', 'page_count': len(snapshot['pages']), 'remote_writes': 0, 'note': 'Use --snapshot FILE then prepare-updates.py; --apply PLAN is the only remote-write mode.'}
        else:
            report = {'store': STORE, 'mode': 'snapshot', 'snapshot_file': str(args.snapshot), 'remote_writes': 0}
        if args.report:
            save_private(args.report, report)
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0
    except ApplyStopped as error:
        if args.report:
            save_private(args.report, error.report)
        print(json.dumps(error.report, ensure_ascii=False, indent=2))
        print(str(error), file=sys.stderr)
        return 2
    except (SafeError, OSError, ValueError):
        print('Stopped safely. Check the secure token environment, valid plan/snapshot, content scopes and writable local output paths. No automatic mutation retry was performed.', file=sys.stderr)
        return 2

if __name__ == '__main__':
    sys.exit(main())
