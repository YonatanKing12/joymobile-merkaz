import copy
import importlib.util
import json
import os
import pathlib
import tempfile
import unittest
from unittest.mock import patch

PATH = pathlib.Path(__file__).with_name('admin-pages.py')
spec = importlib.util.spec_from_file_location('admin_pages', PATH)
a = importlib.util.module_from_spec(spec)
spec.loader.exec_module(a)

def page(handle='about', body='<p>Old</p>', **extra):
    return {'id': a.ALLOWED_IDS.get(handle, '9001'), 'handle': handle, 'body_html': body,
            'template_suffix': None, 'title': handle, 'updatedAt': '2026-10-10T00:00:00Z', 'isPublished': False, **extra}

def update(handle='about', before='<p>Old</p>', after='<p>New</p>'):
    identifier = a.ALLOWED_IDS[handle]
    return {'handle': handle, 'id': identifier, 'status': 'ready_to_update', 'operation': 'update_page_body_html',
            'expected_body_html': before, 'payload': {'page': {'id': identifier, 'handle': handle, 'body_html': after}}}

def create(body='<p>Repair service</p>'):
    return {'handle': 'joy-fix', 'id': None, 'status': 'ready_to_create', 'operation': 'create_page_if_handle_absent',
            'payload': {'page': {'handle': 'joy-fix', 'body_html': body, 'title': 'JOY FIX', 'published': True, 'template_suffix': 'joy-fix'}}}

def plan(*ops):
    return {'store': a.STORE, 'operations': list(ops)}

class MockClient:
    def __init__(self, pages):
        self.pages = copy.deepcopy(pages)
        self.reads = 0
        self.writes = []
        self.before_read = None
        self.unknown = False

    def snapshot(self):
        self.reads += 1
        if self.before_read:
            self.before_read(self)
        return {'store': a.STORE, 'pages': copy.deepcopy(self.pages)}

    def update(self, operation):
        self.writes.append(copy.deepcopy(operation))
        current = next(p for p in self.pages if p['handle'] == operation['handle'])
        current['body_html'] = operation['body']
        if self.unknown:
            raise a.MutationUnknown('mock timeout')
        return copy.deepcopy(current)

    def create(self, operation):
        self.writes.append(copy.deepcopy(operation))
        current = page('joy-fix', operation['body'], title=operation['title'], template_suffix='joy-fix', isPublished=True)
        self.pages.append(current)
        return copy.deepcopy(current)

class ApplierTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.backup = pathlib.Path(self.temp.name) / 'backup.json'

    def test_missing_token_fails_before_network(self):
        with patch.dict(os.environ, {}, clear=True), patch.object(a.urllib.request, 'build_opener') as opener:
            with self.assertRaises(a.SafeError):
                a.AdminClient()
            opener.assert_not_called()

    def test_unknown_status_and_tampered_handle_rejected(self):
        for mutate in [lambda op: op.update(status='ready'), lambda op: op['payload']['page'].update(handle='other'), lambda op: op.update(handle='other'), lambda op: op['payload']['page'].update(title='Changed title'), lambda op: op.update(id='1')]:
            op = update(); mutate(op)
            client = MockClient([page()])
            with self.assertRaises(a.SafeError):
                a.run_plan(client, plan(op), apply=True, backup_path=self.backup)
            self.assertEqual(client.reads, 0)
            self.assertEqual(client.writes, [])

    def test_stale_entire_plan_preflight_writes_nothing(self):
        client = MockClient([page(), page('shipping', '<p>Changed by merchant</p>')])
        with self.assertRaises(a.SafeError):
            a.run_plan(client, plan(update(), update('shipping')), apply=True, backup_path=self.backup)
        self.assertFalse(self.backup.exists())
        self.assertEqual(client.writes, [])

    def test_duplicate_admin_handles_abort_all(self):
        client = MockClient([page(), page(id='42')])
        with self.assertRaises(a.SafeError):
            a.run_plan(client, plan(update()), apply=True, backup_path=self.backup)
        self.assertEqual(client.writes, [])

    def test_already_applied_is_idempotent_and_noop(self):
        client = MockClient([page(body='<p>New</p>')])
        report = a.run_plan(client, plan(update()), apply=True, backup_path=self.backup)
        self.assertEqual(report['results'][0]['status'], 'already_applied')
        self.assertEqual(client.writes, [])
        self.assertFalse(self.backup.exists())

    def test_unchanged_target_is_noop_even_expected_matches(self):
        client = MockClient([page()])
        report = a.run_plan(client, plan(update(after='<p>Old</p>')), apply=True, backup_path=self.backup)
        self.assertEqual(report['remote_writes'], 0)
        self.assertEqual(client.writes, [])

    def test_backup_is_actual_before_state_and_private(self):
        client = MockClient([page()])
        report = a.run_plan(client, plan(update()), apply=True, backup_path=self.backup)
        self.assertEqual(report['remote_writes'], 1)
        self.assertEqual(json.loads(self.backup.read_text())['pages'][0]['body_html'], '<p>Old</p>')
        self.assertEqual(self.backup.stat().st_mode & 0o777, 0o600)
        self.assertEqual(client.reads, 2)

    def test_create_existing_nonmatching_aborts_other_updates(self):
        client = MockClient([page(), page('joy-fix', '<p>Merchant page</p>')])
        with self.assertRaises(a.SafeError):
            a.run_plan(client, plan(update(), create()), apply=True, backup_path=self.backup)
        self.assertEqual(client.writes, [])

    def test_create_matching_is_idempotent(self):
        client = MockClient([page('joy-fix', '<p>Repair service</p>', template_suffix='joy-fix', title='JOY FIX', isPublished=True)])
        report = a.run_plan(client, plan(create()), apply=True, backup_path=self.backup)
        self.assertEqual(report['results'][0]['status'], 'already_applied')
        self.assertEqual(client.writes, [])

    def test_immediate_recheck_detects_change_before_mutation(self):
        client = MockClient([page()])
        client.before_read = lambda c: c.pages[0].update(body_html='<p>Concurrent edit</p>') if c.reads == 2 else None
        with self.assertRaises(a.ApplyStopped):
            a.run_plan(client, plan(update()), apply=True, backup_path=self.backup)
        self.assertEqual(client.writes, [])
        self.assertTrue(self.backup.exists())

    def test_timeout_rereads_and_never_retries(self):
        client = MockClient([page()]); client.unknown = True
        with self.assertRaises(a.ApplyStopped) as caught:
            a.run_plan(client, plan(update()), apply=True, backup_path=self.backup)
        report = caught.exception.report
        self.assertEqual(len(client.writes), 1)
        self.assertEqual(client.reads, 3)
        self.assertEqual(report['results'][0]['status'], 'confirmed_applied_after_unknown_response')
        self.assertEqual(report['mutation_attempts'], 1)
        self.assertFalse(report['results'][0]['automatic_retry'])

    def test_dry_run_mutates_nothing(self):
        client = MockClient([page()])
        report = a.run_plan(client, plan(update(), create()))
        self.assertEqual(report['mode'], 'dry_run')
        self.assertEqual(client.writes, [])
        self.assertFalse(self.backup.exists())

    def test_graphql_payload_body_only_and_fixed_create(self):
        client = a.AdminClient(token='mock-local-token', opener=object())
        calls = []
        def mock_graphql(query, variables, **kwargs):
            calls.append((query, variables, kwargs))
            p = variables['page']; handle = p.get('handle', 'about')
            r = {'id': 'gid://shopify/Page/' + a.ALLOWED_IDS.get(handle, '9001'), 'handle': handle,
                 'body': p['body'], 'templateSuffix': p.get('templateSuffix'), 'title': p.get('title', 'about'),
                 'updatedAt': '2026-10-10', 'isPublished': p.get('isPublished', False)}
            return {'pageCreate' if handle == 'joy-fix' else 'pageUpdate': {'page': r, 'userErrors': []}}
        client.graphql = mock_graphql
        executable, _ = a.validate_plan(plan(update(), create()))
        client.update(executable[0]); client.create(executable[1])
        self.assertEqual(calls[0][1]['page'], {'body': '<p>New</p>'})
        self.assertEqual(calls[1][1]['page'], {'handle': 'joy-fix', 'body': '<p>Repair service</p>', 'title': 'JOY FIX', 'templateSuffix': 'joy-fix', 'isPublished': True})
        self.assertTrue(all(c[2]['mutation'] for c in calls))

    def test_transport_failure_performs_one_verified_fixed_host_request(self):
        class OfflineOpener:
            def __init__(self):
                self.requests = []
            def open(self, request, timeout):
                self.requests.append((request, timeout))
                raise a.urllib.error.URLError('mock connection closed')
        opener = OfflineOpener()
        client = a.AdminClient(token='mock-local-token', opener=opener)
        executable, _ = a.validate_plan(plan(update()))
        with self.assertRaises(a.MutationUnknown) as caught:
            client.update(executable[0])
        self.assertEqual(len(opener.requests), 1)
        request, timeout = opener.requests[0]
        self.assertEqual(request.full_url, 'https://k8qhkp-gn.myshopify.com/admin/api/2026-07/graphql.json')
        self.assertEqual(timeout, 30)
        self.assertNotIn('mock-local-token', str(caught.exception))
        body = json.loads(request.data)
        self.assertEqual(body['variables']['page'], {'body': '<p>New</p>'})

    def test_create_handle_appearing_after_preflight_stops_without_creation(self):
        client = MockClient([])
        client.before_read = lambda c: c.pages.append(page('joy-fix', '<p>Other merchant content</p>')) if c.reads == 2 else None
        with self.assertRaises(a.ApplyStopped):
            a.run_plan(client, plan(create()), apply=True, backup_path=self.backup)
        self.assertEqual(client.writes, [])
        self.assertTrue(self.backup.exists())

    def test_snapshot_pagination_preserves_unpublished_pages(self):
        client = a.AdminClient(token='mock-local-token', opener=object()); calls = []
        def read(query, variables):
            calls.append(variables)
            node = {'id': 'gid://shopify/Page/' + str(len(calls)), 'handle': 'page' + str(len(calls)), 'body': '<p>Draft</p>', 'templateSuffix': None, 'title': 'Draft', 'updatedAt': '2026-10-10', 'isPublished': False}
            return {'pages': {'nodes': [node], 'pageInfo': {'hasNextPage': len(calls) == 1, 'endCursor': 'next'}}}
        client.graphql = read
        snapshot = client.snapshot()
        self.assertEqual(calls, [{'after': None}, {'after': 'next'}])
        self.assertEqual(len(snapshot['pages']), 2)
        self.assertFalse(snapshot['pages'][0]['isPublished'])

if __name__ == '__main__':
    unittest.main()
