"""Real OpenResty + MongoDB + Redis integration tests; stdlib only.
Run against a disposable service with tests/sms_fixture.py environment configured:
    python3 -m unittest discover -s tests -v
Creates isolated users/books; run against a development database, never production.
"""
import concurrent.futures
import http.cookiejar
import json
import os
import secrets
import unittest
import urllib.error
import urllib.parse
import urllib.request

from sms_fixture import sms_code

BASE = os.environ.get('NESTLEDGER_TEST_URL', '').rstrip('/')
ORIGIN = os.environ.get('NESTLEDGER_ORIGIN', BASE)
PASSWORD = 'NestLedger-Test-2026!'


def phone():
    return '139' + ''.join(str(secrets.randbelow(10)) for _ in range(8))


def without_attribution(items):
    """Drop list-only creator names before comparing with create/patch payloads."""
    return [{key: value for key, value in item.items() if key != 'createdByName'} for item in items]


class Client:
    def __init__(self):
        self.jar = http.cookiejar.CookieJar()
        self.http = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))

    def request(self, method, path, payload=None, *, origin=ORIGIN):
        headers = {'Accept': 'application/json', 'Origin': origin}
        body = None
        if payload is not None or method in ('POST', 'PATCH', 'DELETE'):
            body = json.dumps(payload if payload is not None else {}).encode()
            headers['Content-Type'] = 'application/json'
        req = urllib.request.Request(BASE + '/api' + path, body, headers, method=method)
        try:
            with self.http.open(req, timeout=15) as response:
                return response.status, json.loads(response.read())
        except urllib.error.HTTPError as error:
            return error.code, json.loads(error.read())

    def register(self, name):
        self.phone = phone()
        status, body = self.request('POST', '/auth/register', {
            'phone': self.phone, 'password': PASSWORD, 'name': name,
            'smsCode': sms_code(self.phone),
        })
        assert status in (200, 201), (status, body)
        self.user = body['data']
        return self.user


class PlatformTests(unittest.TestCase):
    def ok(self, client, method, path, payload=None):
        status, body = client.request(method, path, payload)
        self.assertIn(status, (200, 201), (method, path, status, body))
        self.assertIn('data', body)
        return body['data']

    def denied(self, client, method, path, payload=None, codes=(400, 403, 404)):
        status, body = client.request(method, path, payload)
        self.assertIn(status, codes, (method, path, status, body))
        self.assertIn('error', body)

    def test_concurrent_dependency_requests(self):
        # Each OP_MSG response must match its own request ID despite cosocket yields.
        def ping(_):
            return Client().request('GET', '/health')
        with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
            replies = list(pool.map(ping, range(36)))
        for status, body in replies:
            self.assertEqual(status, 200, body)
            self.assertEqual(body['data']['status'], 'ok')

    def test_health_and_auth_lifecycle(self):
        anonymous = Client()
        health = self.ok(anonymous, 'GET', '/health')
        self.assertEqual(health['status'], 'ok')
        self.assertTrue(health['mongo'])
        self.assertTrue(health['redis'])
        self.denied(anonymous, 'GET', '/auth/me', codes=(401,))
        owner = Client()
        self.denied(anonymous, 'POST', '/auth/register', {
            'phone': phone(), 'password': PASSWORD, 'name': '缺少验证码',
        }, codes=(400,))
        user = owner.register('账号测试')
        self.assertEqual(self.ok(owner, 'GET', '/auth/me')['id'], user['id'])
        cookies = list(owner.jar)
        self.assertTrue(any(c.name == 'nestledger_session' for c in cookies))
        self.denied(anonymous, 'POST', '/auth/register', {
            'phone': owner.phone, 'password': PASSWORD, 'name': '重复账号',
        }, codes=(409,))
        other_session = Client()
        self.ok(other_session, 'POST', '/auth/login', {'phone': owner.phone, 'password': PASSWORD})
        self.denied(owner, 'PATCH', '/auth/password', {
            'currentPassword': 'wrong-password', 'newPassword': 'Changed-Password-2026!',
        }, codes=(400, 401, 403))
        new_password = 'Changed-Password-2026!'
        self.ok(owner, 'PATCH', '/auth/password', {
            'currentPassword': PASSWORD, 'newPassword': new_password,
        })
        self.denied(other_session, 'GET', '/auth/me', codes=(401,))
        self.denied(anonymous, 'POST', '/auth/login', {
            'phone': owner.phone, 'password': PASSWORD,
        }, codes=(401,))
        self.ok(owner, 'POST', '/auth/login', {'phone': owner.phone, 'password': new_password})
        replacement = phone()
        self.denied(owner, 'PATCH', '/auth/phone', {
            'phone': replacement, 'currentPassword': new_password,
        }, codes=(400,))
        updated = self.ok(owner, 'PATCH', '/auth/phone', {
            'phone': replacement, 'currentPassword': new_password,
            'smsCode': sms_code(replacement, 'phone_change', user['id']),
        })
        self.assertEqual(updated['phone'], replacement)
        self.ok(owner, 'POST', '/auth/logout')
        self.denied(owner, 'GET', '/auth/me', codes=(401,))
        self.ok(owner, 'POST', '/auth/login', {'phone': replacement, 'password': new_password})

    def test_account_theme_settings_persistence_validation_and_session_isolation(self):
        owner, other = Client(), Client()
        baseline = owner.register('账号主题设置')
        other.register('独立主题账号')
        # Registration intentionally does not require a stored theme: absent
        # users.theme (the legacy shape) is represented as clay by user_out.
        self.assertEqual(baseline['theme'], 'clay')
        self.assertEqual(self.ok(owner, 'GET', '/auth/me'), baseline)
        self.assertEqual(self.ok(other, 'GET', '/auth/me')['theme'], 'clay')
        second_session = Client()
        self.ok(second_session, 'POST', '/auth/login', {'phone': owner.phone, 'password': PASSWORD})
        original_cookie = next(cookie.value for cookie in owner.jar if cookie.name == 'nestledger_session')
        for theme in ('clay', 'forest', 'blue', 'plum', 'coral', 'mango', 'mint', 'berry', 'contrast-ink', 'contrast-navy', 'contrast-wine'):
            with self.subTest(theme=theme):
                status, body = owner.request('PATCH', '/auth/settings', {'theme': theme})
                self.assertEqual(status, 200, body)
                expected = dict(baseline, theme=theme)
                self.assertEqual(body['data'], expected)
                self.assertEqual(self.ok(owner, 'GET', '/auth/me'), expected)
                # Neither the current nor another already-authenticated session
                # is invalidated; both immediately see the saved preference.
                self.assertEqual(self.ok(second_session, 'GET', '/auth/me'), expected)
                self.assertEqual(next(cookie.value for cookie in owner.jar
                                      if cookie.name == 'nestledger_session'), original_cookie)
                self.assertEqual(self.ok(other, 'GET', '/auth/me')['theme'], 'clay')
                fresh = Client()
                logged_in = self.ok(fresh, 'POST', '/auth/login', {'phone': owner.phone, 'password': PASSWORD})
                self.assertEqual(logged_in, expected)  # Password and phone unchanged.
                self.assertEqual(self.ok(fresh, 'GET', '/auth/me'), expected)
                self.ok(fresh, 'POST', '/auth/logout')
        for theme in ('', 'unknown', 'CLAY', ' clay ', None, {}, [], True, 1):
            with self.subTest(invalid_theme=theme):
                self.denied(owner, 'PATCH', '/auth/settings', {'theme': theme}, codes=(400,))
        for payload in ({}, [], 'forest', {'theme': 'blue', 'name': '越权昵称'},
                        {'theme': 'forest', 'phone': other.phone},
                        {'theme': 'clay', 'authVersion': 99}):
            self.denied(owner, 'PATCH', '/auth/settings', payload, codes=(400,))
        self.denied(Client(), 'PATCH', '/auth/settings', {'theme': 'forest'}, codes=(401,))
        status, body = owner.request('PATCH', '/auth/settings', {'theme': 'forest'}, origin='https://evil.example')
        self.assertEqual(status, 403, body)
        self.assertEqual(body['error']['code'], 'CSRF_REJECTED')
        for raw, content_type, code in ((b'{"theme":"forest"}', 'text/plain', 415),
                                        (b'null', 'application/json', 400),
                                        (b'{', 'application/json', 400)):
            req = urllib.request.Request(BASE + '/api/auth/settings', raw,
                                         {'Origin': ORIGIN, 'Content-Type': content_type}, method='PATCH')
            with self.assertRaises(urllib.error.HTTPError) as rejected:
                owner.http.open(req, timeout=15)
            self.assertEqual(rejected.exception.code, code)
        final = dict(baseline, theme='contrast-wine')  # last value exercised by the loop
        self.assertEqual(self.ok(owner, 'GET', '/auth/me'), final)
        self.assertEqual(self.ok(second_session, 'GET', '/auth/me'), final)
        self.ok(other, 'PATCH', '/auth/settings', {'theme': 'blue'})
        self.assertEqual(self.ok(owner, 'GET', '/auth/me'), final)
        self.assertEqual(self.ok(other, 'GET', '/auth/me')['theme'], 'blue')
        self.ok(owner, 'POST', '/auth/logout')
        self.assertEqual(self.ok(owner, 'POST', '/auth/login', {'phone': owner.phone, 'password': PASSWORD}), final)
        self.assertEqual(self.ok(second_session, 'GET', '/auth/me'), final)

    def test_books_invitations_and_record_permissions(self):
        owner, member, stranger = Client(), Client(), Client()
        owner.register('家庭创建人')
        member.register('家庭成员')
        stranger.register('无关用户')
        personal = self.ok(owner, 'POST', '/books', {'name': '我的私人账本', 'type': 'personal'})
        family = self.ok(owner, 'POST', '/books', {'name': '幸福小家', 'type': 'family'})
        fid, pid = family['id'], personal['id']
        second_personal = self.ok(owner, 'POST', '/books', {'name': '私人旅行', 'type': 'personal'})
        second_family = self.ok(owner, 'POST', '/books', {'name': '父母小家', 'type': 'family'})
        self.assertEqual(len(self.ok(owner, 'GET', '/books')), 4)
        renamed = self.ok(owner, 'PATCH', f'/books/{fid}', {'name': '幸福小家·新名字'})
        self.assertEqual(renamed['name'], '幸福小家·新名字')
        self.denied(member, 'PATCH', '/auth/phone', {'phone': owner.phone, 'currentPassword': PASSWORD}, codes=(409,))
        self.assertEqual(self.ok(member, 'GET', '/auth/me')['phone'], member.phone)
        self.denied(member, 'GET', f'/books/{pid}/records')
        self.denied(owner, 'POST', f'/books/{pid}/invitations', {'phone': member.phone}, codes=(400, 403, 409))
        invitation = self.ok(owner, 'POST', f'/books/{fid}/invitations', {'phone': member.phone})
        self.denied(owner, 'POST', f'/books/{fid}/invitations', {'phone': member.phone}, codes=(400, 409))
        self.denied(stranger, 'POST', f"/invitations/{invitation['id']}/accept")
        pending = self.ok(member, 'GET', '/invitations')
        self.assertTrue(any(item['id'] == invitation['id'] for item in pending))
        accepted = self.ok(member, 'POST', f"/invitations/{invitation['id']}/accept")
        self.assertEqual(accepted['id'], fid)
        self.assertTrue(any(book['id'] == fid for book in self.ok(member, 'GET', '/books')))
        members = self.ok(owner, 'GET', f'/books/{fid}/members')
        self.assertEqual(len(members['members']), 2)
        self.denied(member, 'PATCH', f'/books/{fid}', {'name': '越权改名'})
        self.denied(member, 'POST', f'/books/{fid}/invitations', {'phone': stranger.phone})
        payload = {'type': 'expense', 'amountCents': 1234, 'category': '餐饮',
                   'occurredAt': '2026-11-16T04:30:00.000Z', 'note': '午餐', 'paymentSource': '微信'}
        own_record = self.ok(owner, 'POST', f'/books/{fid}/records', payload)
        record = self.ok(member, 'POST', f'/books/{fid}/records', payload)
        self.denied(member, 'PATCH', f"/books/{fid}/records/{own_record['id']}", payload)
        self.denied(stranger, 'DELETE', f"/books/{fid}/records/{record['id']}")
        modified = self.ok(owner, 'PATCH', f"/books/{fid}/records/{record['id']}", dict(payload, note='更正'))
        self.assertEqual(modified['note'], '更正')
        # Family records keep the creator and can be filtered/aggregated by member.
        records_all = self.ok(owner, 'GET', f'/books/{fid}/records')
        self.assertEqual({item['id'] for item in records_all['authors']},
                         {owner.user['id'], member.user['id']})
        creators = {item['createdBy']: item['createdByName'] for item in records_all['items']}
        self.assertEqual(creators[owner.user['id']], '家庭创建人')
        self.assertEqual(creators[member.user['id']], '家庭成员')
        member_records = self.ok(owner, 'GET', f'/books/{fid}/records?createdBy={member.user["id"]}')
        self.assertEqual(member_records['total'], 1)
        self.assertEqual(member_records['items'][0]['createdBy'], member.user['id'])
        self.denied(owner, 'GET', f'/books/{fid}/records?createdBy=bad', codes=(400,))
        member_analysis = self.ok(owner, 'GET',
            f'/books/{fid}/analysis?period=month&date=2026-11-16&member={member.user["id"]}')
        self.assertEqual((member_analysis['expenseCents'], member_analysis['recordCount']), (1234, 1))
        self.assertEqual({item['userId'] for item in member_analysis['members']},
                         {owner.user['id'], member.user['id']})
        member_stat = next(item for item in member_analysis['members'] if item['userId'] == member.user['id'])
        self.assertEqual((member_stat['name'], member_stat['expenseCents'], member_stat['recordCount']),
                         ('家庭成员', 1234, 1))
        self.denied(owner, 'GET', f'/books/{fid}/analysis?period=month&member=bad', codes=(400,))
        # Read-only sharing is an invitation the recipient must accept or reject.
        shares = f'/books/{fid}/shares'
        self.denied(member, 'POST', shares, {'phone': stranger.phone}, codes=(403,))
        self.denied(member, 'GET', shares, codes=(403,))
        self.denied(stranger, 'GET', shares, codes=(403,))
        self.denied(owner, 'POST', shares, {'phone': owner.phone}, codes=(409,))
        self.denied(owner, 'POST', shares, {'phone': phone()}, codes=(404,))
        self.denied(owner, 'POST', shares, {'phone': member.phone}, codes=(409,))
        shared = self.ok(owner, 'POST', shares, {'phone': stranger.phone})
        self.assertEqual((shared['userId'], shared['phone'], shared['status']),
                         (stranger.user['id'], stranger.phone, 'pending'))
        self.denied(owner, 'POST', shares, {'phone': stranger.phone}, codes=(409,))
        listed = self.ok(owner, 'GET', shares)
        self.assertEqual(listed['ownerId'], owner.user['id'])
        self.assertEqual([(item['id'], item['status']) for item in listed['shares']],
                         [(shared['id'], 'pending')])
        # A pending share does not grant access yet.
        self.assertFalse(any(b['id'] == fid for b in self.ok(stranger, 'GET', '/books')))
        self.denied(stranger, 'GET', f'/books/{fid}/records', codes=(403,))
        self.denied(stranger, 'GET', f'/books/{fid}/analysis?period=month', codes=(403,))
        self.denied(stranger, 'POST', f'/books/{fid}/records', payload, codes=(403,))
        inbox = self.ok(stranger, 'GET', '/shares')
        self.assertEqual(len(inbox), 1)
        self.assertEqual(
            (inbox[0]['id'], inbox[0]['bookId'], inbox[0]['bookName'], inbox[0]['ownerPhone']),
            (shared['id'], fid, renamed['name'], owner.phone),
        )
        self.denied(member, 'POST', f"/shares/{shared['id']}/accept", codes=(403,))
        self.denied(owner, 'POST', f"/shares/{shared['id']}/accept", codes=(403,))
        self.denied(member, 'POST', f"/shares/{shared['id']}/reject", codes=(403,))
        # Rejection removes the invitation; the owner may send it again.
        self.ok(stranger, 'POST', f"/shares/{shared['id']}/reject")
        self.assertEqual(self.ok(stranger, 'GET', '/shares'), [])
        self.assertEqual(self.ok(owner, 'GET', shares)['shares'][0]['status'], 'rejected')
        self.denied(stranger, 'POST', f"/shares/{shared['id']}/accept", codes=(409,))
        resent = self.ok(owner, 'POST', shares, {'phone': stranger.phone})
        self.assertEqual((resent['id'], resent['status']), (shared['id'], 'pending'))
        accepted = self.ok(stranger, 'POST', f"/shares/{shared['id']}/accept")
        self.assertEqual(accepted['id'], fid)
        self.assertTrue(accepted['readOnly'])
        self.assertEqual((accepted['ownerName'], accepted['ownerPhone']), ('家庭创建人', owner.phone))
        self.denied(stranger, 'POST', f"/shares/{shared['id']}/accept", codes=(409,))
        self.assertEqual(self.ok(owner, 'GET', shares)['shares'][0]['status'], 'accepted')
        shared_book = next(b for b in self.ok(stranger, 'GET', '/books') if b['id'] == fid)
        self.assertTrue(shared_book['readOnly'])
        self.assertEqual((shared_book['ownerName'], shared_book['ownerPhone']), ('家庭创建人', owner.phone))
        owner_view = next(b for b in self.ok(owner, 'GET', '/books') if b['id'] == fid)
        self.assertFalse(owner_view['readOnly'])
        self.assertNotIn('ownerPhone', owner_view)
        shared_records = self.ok(stranger, 'GET', f'/books/{fid}/records')
        self.assertEqual(shared_records['total'], 2)
        self.assertCountEqual(without_attribution(shared_records['items']), [own_record, modified])
        shared_analysis = self.ok(stranger, 'GET', f'/books/{fid}/analysis?period=month&date=2026-11-16')
        self.assertEqual(shared_analysis['expenseCents'], 2468)
        self.denied(stranger, 'POST', f'/books/{fid}/records', payload, codes=(403,))
        self.denied(stranger, 'PATCH', f"/books/{fid}/records/{record['id']}", payload, codes=(403,))
        self.denied(stranger, 'DELETE', f"/books/{fid}/records/{record['id']}", codes=(403,))
        self.denied(stranger, 'GET', f'/books/{fid}/members', codes=(403,))
        self.denied(stranger, 'GET', f'/books/{fid}/export', codes=(403,))
        self.denied(stranger, 'POST', f'/books/{fid}/import', {
            'requestId': 'shared-no-write-0001', 'records': [payload],
        }, codes=(403,))
        stranger_order = [book['id'] for book in self.ok(stranger, 'GET', '/books')]
        self.assertIn(fid, stranger_order)
        self.assertEqual(
            [book['id'] for book in self.ok(stranger, 'PATCH', '/books/order', {'bookIds': stranger_order})],
            stranger_order,
        )
        self.denied(member, 'DELETE', f"{shares}/{stranger.user['id']}", codes=(403,))
        self.ok(owner, 'DELETE', f"{shares}/{stranger.user['id']}")
        self.denied(stranger, 'GET', f'/books/{fid}/records', codes=(403,))
        self.assertFalse(any(b['id'] == fid for b in self.ok(stranger, 'GET', '/books')))
        self.assertEqual(self.ok(stranger, 'GET', '/shares'), [])
        self.denied(owner, 'DELETE', f"{shares}/{stranger.user['id']}", codes=(404,))
        self.ok(member, 'DELETE', f'/books/{fid}/members/{member.user["id"]}')
        self.denied(member, 'GET', f'/books/{fid}/records')
        reinvite = self.ok(owner, 'POST', f'/books/{fid}/invitations', {'phone': member.phone})
        self.ok(member, 'POST', f'/invitations/{reinvite["id"]}/accept')
        self.ok(owner, 'DELETE', f'/books/{fid}/members/{member.user["id"]}')
        self.denied(member, 'GET', f'/books/{fid}/records')
        self.denied(owner, 'DELETE', f'/books/{fid}/members/{owner.user["id"]}', codes=(400, 403, 409))
        self.ok(owner, 'POST', shares, {'phone': stranger.phone})
        self.assertEqual(len(self.ok(stranger, 'GET', '/shares')), 1)
        self.ok(owner, 'DELETE', f'/books/{fid}')
        self.assertEqual(self.ok(stranger, 'GET', '/shares'), [])
        self.denied(stranger, 'GET', f'/books/{fid}/records', codes=(404,))
        self.assertFalse(any(b['id'] == fid for b in self.ok(stranger, 'GET', '/books')))
        self.denied(owner, 'GET', f'/books/{fid}/records')
        self.ok(owner, 'DELETE', f'/books/{pid}')
        self.ok(owner, 'DELETE', f'/books/{second_personal["id"]}')
        self.ok(owner, 'DELETE', f'/books/{second_family["id"]}')

    def test_account_book_order_persistence_validation_and_shared_isolation(self):
        owner, member = Client(), Client()
        owner.register('排序账本所有者')
        member.register('排序共享成员')

        def ids(client):
            return [book['id'] for book in self.ok(client, 'GET', '/books')]

        def reorder(client, order):
            return [book['id'] for book in self.ok(client, 'PATCH', '/books/order', {'bookIds': order})]

        self.denied(Client(), 'PATCH', '/books/order', {'bookIds': []}, codes=(401,))
        self.assertEqual(reorder(owner, []), [])
        # Empty objects must not be mistaken for empty CJSON arrays.
        invalid_payloads = ({}, {'bookIds': {}}, {'bookIds': None}, {'bookIds': ''},
                            {'bookIds': True}, {'bookIds': 1}, {'bookIds': {'1': '0' * 24}},
                            {'bookIds': [None]}, {'bookIds': [1]}, {'bookIds': [{}]},
                            {'bookIds': [[]]}, {'bookIds': ['bad']}, {'bookIds': ['A' * 24]},
                            {'bookIds': [], 'extra': True})
        for payload in invalid_payloads:
            with self.subTest(payload=payload):
                self.denied(owner, 'PATCH', '/books/order', payload, codes=(400,))

        personal = self.ok(owner, 'POST', '/books', {'name': '排序私人', 'type': 'personal'})
        family = self.ok(owner, 'POST', '/books', {'name': '排序共享', 'type': 'family'})
        private = self.ok(member, 'POST', '/books', {'name': '成员私人', 'type': 'personal'})
        pid, fid, mid = personal['id'], family['id'], private['id']
        default_books = self.ok(owner, 'GET', '/books')
        self.assertEqual(default_books, sorted(default_books, key=lambda b: (b['createdAt'], b['id']), reverse=True))
        target = list(reversed([book['id'] for book in default_books]))
        self.assertEqual(reorder(owner, target), target)
        self.assertEqual(ids(owner), target)
        self.ok(owner, 'POST', '/auth/logout')
        self.ok(owner, 'POST', '/auth/login', {'phone': owner.phone, 'password': PASSWORD})
        self.assertEqual(ids(owner), target)
        fresh_session = Client()
        self.ok(fresh_session, 'POST', '/auth/login', {'phone': owner.phone, 'password': PASSWORD})
        self.assertEqual(ids(fresh_session), target)

        self.denied(owner, 'PATCH', '/books/order', {'bookIds': [pid, fid, mid]}, codes=(403,))
        self.denied(member, 'PATCH', '/books/order', {'bookIds': [mid, fid]}, codes=(403,))
        self.denied(owner, 'PATCH', '/books/order', {'bookIds': [pid, pid]}, codes=(400,))
        for incomplete in ([], [pid], [fid], target + ['0' * 24]):
            status, body = owner.request('PATCH', '/books/order', {'bookIds': incomplete})
            self.assertEqual(status, 409, body)
            self.assertEqual(body['error']['code'], 'CONFLICT')
            self.assertIn('刷新', body['error']['message'])
        status, body = owner.request('PATCH', '/books/order', {'bookIds': target}, origin='https://evil.example')
        self.assertEqual(status, 403, body)
        self.assertEqual(body['error']['code'], 'CSRF_REJECTED')
        req = urllib.request.Request(BASE + '/api/books/order', json.dumps({'bookIds': target}).encode(),
                                     {'Origin': ORIGIN, 'Content-Type': 'text/plain'}, method='PATCH')
        with self.assertRaises(urllib.error.HTTPError) as rejected:
            owner.http.open(req, timeout=15)
        self.assertEqual(rejected.exception.code, 415)
        self.assertEqual(ids(owner), target)  # Rejected requests do not change preferences.

        self.assertEqual(reorder(member, [mid]), [mid])
        invitation = self.ok(owner, 'POST', f'/books/{fid}/invitations', {'phone': member.phone})
        self.ok(member, 'POST', f'/invitations/{invitation["id"]}/accept')
        self.assertEqual(ids(member), [mid, fid])  # Newly joined books append after saved choices.
        self.assertEqual(reorder(member, [fid, mid]), [fid, mid])
        other_target = list(reversed(target))
        self.assertEqual(reorder(owner, other_target), other_target)
        self.assertEqual(ids(member), [fid, mid])
        self.assertEqual(reorder(member, [mid, fid]), [mid, fid])
        self.assertEqual(ids(owner), other_target)

        new_family = self.ok(owner, 'POST', '/books', {'name': '新增共享', 'type': 'family'})
        nid = new_family['id']
        self.assertEqual(ids(owner), other_target + [nid])
        # Multiple unsaved books append in the established default order.
        new_personal = self.ok(owner, 'POST', '/books', {'name': '新增私人', 'type': 'personal'})
        aid = new_personal['id']
        additions = sorted([new_family, new_personal], key=lambda b: (b['createdAt'], b['id']), reverse=True)
        self.assertEqual(ids(owner), other_target + [b['id'] for b in additions])
        self.denied(owner, 'PATCH', '/books/order', {'bookIds': other_target}, codes=(409,))
        invitation = self.ok(owner, 'POST', f'/books/{nid}/invitations', {'phone': member.phone})
        self.ok(member, 'POST', f'/invitations/{invitation["id"]}/accept')
        self.assertEqual(ids(member), [mid, fid, nid])
        self.ok(owner, 'DELETE', f'/books/{fid}/members/{member.user["id"]}')
        self.assertEqual(ids(member), [mid, nid])  # Stale preferences never restore lost access.
        self.denied(member, 'PATCH', '/books/order', {'bookIds': [mid, fid, nid]}, codes=(403,))
        self.ok(owner, 'DELETE', f'/books/{fid}')
        self.assertEqual(ids(owner), [b for b in other_target if b != fid] + [b['id'] for b in additions])
        self.denied(owner, 'PATCH', '/books/order', {'bookIds': other_target + [nid, aid]}, codes=(409,))
        self.ok(owner, 'DELETE', f'/books/{pid}')
        self.ok(owner, 'DELETE', f'/books/{nid}')
        self.ok(owner, 'DELETE', f'/books/{aid}')
        self.assertEqual(ids(owner), [])
        self.assertEqual(reorder(owner, []), [])
        self.assertEqual(ids(member), [mid])
        self.ok(member, 'DELETE', f'/books/{mid}')
        self.assertEqual(ids(member), [])

    def test_book_export_import_permissions_validation_and_idempotency(self):
        owner, member, stranger = Client(), Client(), Client()
        owner.register('备份所有者')
        member.register('备份共享成员')
        stranger.register('备份外人')
        family = self.ok(owner, 'POST', '/books', {'name': '共享备份', 'type': 'family'})
        personal = self.ok(owner, 'POST', '/books', {'name': '私人备份', 'type': 'personal'})
        fid, pid = family['id'], personal['id']
        invitation = self.ok(owner, 'POST', f'/books/{fid}/invitations', {'phone': member.phone})
        self.ok(member, 'POST', f'/invitations/{invitation["id"]}/accept')
        before_options = self.ok(owner, 'GET', '/record-options')
        before_books = self.ok(owner, 'GET', '/books')
        rows = [
            {'type': 'expense', 'amountCents': 99999999999, 'category': '餐饮',
             'occurredAt': '2026-11-17T04:30:00.123Z', 'note': '=SUM(1,2)\n多行, "备注"', 'paymentSource': '微信'},
            {'type': 'income', 'amountCents': 123, 'category': '工资',
             'occurredAt': '2026-11-16T16:00:00.000Z', 'note': '', 'paymentSource': '现金'},
            {'type': 'expense', 'amountCents': 1, 'category': '交通',
             'occurredAt': '2026-11-17T04:30:00.123Z', 'note': '@text', 'paymentSource': '银行卡'},
        ]
        created = [self.ok(owner, 'POST', f'/books/{fid}/records', row) for row in rows]
        expected = [{key: record[key] for key in rows[0]}
                    for record in sorted(created, key=lambda r: (r['occurredAt'], r['id']))]
        exported = self.ok(member, 'GET', f'/books/{fid}/export')
        self.assertEqual(set(exported), {'format', 'version', 'exportedAt', 'book', 'records'})
        self.assertEqual(exported['format'], 'nestledger')
        self.assertEqual(exported['version'], 1)
        self.assertEqual(exported['book'], {'name': family['name'], 'type': 'family'})
        self.assertEqual(exported['records'], expected)
        self.assertEqual(self.ok(owner, 'GET', f'/books/{pid}/export')['records'], [])
        for actor, bid in ((stranger, fid), (member, pid)):
            self.denied(actor, 'GET', f'/books/{bid}/export', codes=(403,))
            self.denied(actor, 'POST', f'/books/{bid}/import',
                        {'requestId': secrets.token_hex(16), 'records': rows}, codes=(403,))
        self.denied(Client(), 'GET', f'/books/{fid}/export', codes=(401,))
        # Malformed large JSON must be rejected on identity/access before decoding.
        for actor, expected_status in ((Client(), 401), (stranger, 403)):
            req = urllib.request.Request(BASE + f'/api/books/{fid}/import', b'{' + b' ' * 100000,
                                         {'Origin': ORIGIN, 'Content-Type': 'application/json'}, method='POST')
            with self.assertRaises(urllib.error.HTTPError) as rejected:
                actor.http.open(req, timeout=15)
            self.assertEqual(rejected.exception.code, expected_status)
        date_query = urllib.parse.urlencode({'from': '2026-11-17T04:30:00.123Z',
                                            'to': '2026-11-17T04:30:00.124Z'})
        filtered = self.ok(owner, 'GET', f'/books/{fid}/export?{date_query}')
        self.assertEqual(filtered['records'], expected[1:])
        end_query = urllib.parse.urlencode({'to': '2026-11-17T04:30:00.123Z'})
        self.assertEqual(self.ok(owner, 'GET', f'/books/{fid}/export?{end_query}')['records'], expected[:1])
        for query in ('from=bad', 'to=2026-02-30T00:00:00Z', 'page=1',
                      'from=2026-11-18T00:00:00Z&to=2026-11-17T00:00:00Z'):
            self.denied(owner, 'GET', f'/books/{fid}/export?{query}', codes=(400,))

        request_id = secrets.token_hex(16)
        dry = self.ok(member, 'POST', f'/books/{fid}/import',
                      {'requestId': request_id, 'records': exported['records'], 'dryRun': True})
        self.assertEqual(dry, {'validated': True, 'count': 3, 'dryRun': True})
        self.assertEqual(self.ok(owner, 'GET', f'/books/{fid}/records')['total'], 3)
        # A dry run must not reserve its token: a different payload still commits.
        status, body = member.request('POST', f'/books/{fid}/import', {'requestId': request_id, 'records': rows[:1]})
        self.assertEqual(status, 201, body)
        self.assertEqual(body['data'], {'importedCount': 1, 'replayed': False, 'requestId': request_id})
        status, body = member.request('POST', f'/books/{fid}/import', {'records': rows[:1], 'requestId': request_id})
        self.assertEqual(status, 200, body)
        self.assertTrue(body['data']['replayed'])
        normalized = dict(rows[0], occurredAt='2026-11-17T12:30:00.123+08:00', category=' 餐饮 ', paymentSource=' 微信 ')
        status, body = member.request('POST', f'/books/{fid}/import', {'requestId': request_id, 'records': [normalized]})
        self.assertEqual(status, 200, body)
        self.assertTrue(body['data']['replayed'])
        status, body = member.request('POST', f'/books/{fid}/import', {'requestId': request_id, 'records': rows})
        self.assertEqual(status, 409, body)
        self.assertEqual(body['error']['code'], 'IMPORT_CONFLICT')
        # Token scope is both account and book, not a global request-ID namespace.
        self.ok(owner, 'POST', f'/books/{fid}/import', {'requestId': request_id, 'records': rows[:1]})
        self.ok(member, 'POST', f'/books/{fid}/import', {'requestId': secrets.token_hex(16), 'records': exported['records']})
        self.ok(owner, 'POST', f'/books/{pid}/import', {'requestId': request_id, 'records': exported['records']})
        self.assertCountEqual(self.ok(owner, 'GET', f'/books/{pid}/export')['records'], expected)
        records = self.ok(owner, 'GET', f'/books/{fid}/records')['items']
        self.assertEqual(sum(record['createdBy'] == member.user['id'] for record in records), 4)
        self.assertTrue(all('importBatchId' not in record for record in records))
        self.assertEqual(self.ok(owner, 'GET', '/record-options'), before_options)
        self.assertEqual(self.ok(owner, 'GET', '/books'), before_books)

        total = self.ok(owner, 'GET', f'/books/{fid}/records')['total']
        invalid = ({}, {'requestId': 'short', 'records': rows},
                   {'requestId': 'x' * 65, 'records': rows}, {'requestId': '_' * 16, 'records': rows},
                   {'requestId': secrets.token_hex(16), 'records': {}},
                   {'requestId': secrets.token_hex(16), 'records': []},
                   {'requestId': secrets.token_hex(16), 'records': rows, 'dryRun': 'true'},
                   {'requestId': secrets.token_hex(16), 'records': rows, 'extra': True})
        for payload in invalid:
            self.denied(owner, 'POST', f'/books/{fid}/import', payload, codes=(400,))
        for invalid_row in (dict(rows[0], amountCents=0), dict(rows[0], createdBy=owner.user['id']),
                            dict(rows[0], occurredAt='2026-02-30T00:00:00Z'), [], None):
            status, body = owner.request('POST', f'/books/{fid}/import',
                                         {'requestId': secrets.token_hex(16), 'records': [rows[0], invalid_row]})
            self.assertEqual(status, 400, body)
            self.assertIn('第2行', body['error']['message'])
            self.assertEqual(self.ok(owner, 'GET', f'/books/{fid}/records')['total'], total)
        status, body = owner.request('POST', f'/books/{fid}/import',
                                     {'requestId': secrets.token_hex(16), 'records': rows}, origin='https://evil.example')
        self.assertEqual(status, 403, body)
        self.assertEqual(self.ok(owner, 'GET', f'/books/{fid}/records')['total'], total)
        self.ok(owner, 'DELETE', f'/books/{fid}')
        self.ok(owner, 'DELETE', f'/books/{pid}')

    def test_import_large_bodies_export_cap_and_concurrent_replay(self):
        owner = Client()
        owner.register('大体积并发导入')
        book = self.ok(owner, 'POST', '/books', {'name': '批量导入', 'type': 'personal'})
        path = f'/books/{book["id"]}'
        row = {'type': 'expense', 'amountCents': 1, 'category': '批量',
               'occurredAt': '2026-11-17T00:00:00.123Z', 'note': '长' * 400, 'paymentSource': '现金'}
        # >16KiB and >1MiB, valid 5000 rows: the dedicated Nginx/Lua import cap applies.
        large_rows = [dict(row, note=('长' * 250) + str(index)) for index in range(5000)]
        request_id = secrets.token_hex(16)
        payload = {'requestId': request_id, 'records': large_rows}
        encoded = json.dumps(payload).encode()
        self.assertGreater(len(encoded), 1024 * 1024)
        self.assertLess(len(encoded), 10 * 1024 * 1024)
        self.assertEqual(self.ok(owner, 'POST', path + '/import', dict(payload, dryRun=True))['count'], 5000)
        self.assertEqual(self.ok(owner, 'GET', path + '/records')['total'], 0)
        self.denied(owner, 'POST', path + '/import',
                    {'requestId': secrets.token_hex(16), 'records': large_rows + [row]}, codes=(400,))
        too_big = {'requestId': secrets.token_hex(16), 'records': [dict(row, note='x' * (10 * 1024 * 1024))]}
        self.denied(owner, 'POST', path + '/import', too_big, codes=(413,))
        self.denied(owner, 'POST', '/books', {'name': 'x' * 20000, 'type': 'personal'}, codes=(413,))
        self.denied(owner, 'POST', path + '/records', dict(row, note='x' * 20000), codes=(413,))
        concurrent_rows = large_rows[:500]
        token = secrets.token_hex(16)
        concurrent_payload = {'requestId': token, 'records': concurrent_rows}
        def commit(_):
            return owner.request('POST', path + '/import', concurrent_payload)
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            replies = list(pool.map(commit, range(8)))
        self.assertEqual(sum(status == 201 for status, _ in replies), 1, replies)
        for status, body in replies:
            self.assertIn(status, (200, 201, 409), body)
            if status == 409:
                self.assertEqual(body['error']['code'], 'IMPORT_IN_PROGRESS')
        self.assertEqual(self.ok(owner, 'GET', path + '/records')['total'], 500)
        replay = self.ok(owner, 'POST', path + '/import', concurrent_payload)
        self.assertTrue(replay['replayed'])
        # Different same-token payloads racing have exactly one winner.
        conflict_token = secrets.token_hex(16)
        candidates = [dict(row, note='不同批-' + str(index)) for index in range(8)]
        def competing(index):
            return owner.request('POST', path + '/import', {'requestId': conflict_token, 'records': [candidates[index]]})
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            replies = list(pool.map(competing, range(8)))
        self.assertEqual(sum(status == 201 for status, _ in replies), 1, replies)
        for status, body in replies:
            if status != 201:
                self.assertEqual(status, 409, body)
                self.assertEqual(body['error']['code'], 'IMPORT_CONFLICT')
        self.assertEqual(self.ok(owner, 'GET', path + '/records')['total'], 501)
        # Commit exactly 5000 to an empty second book, then one more triggers export cap.
        second = self.ok(owner, 'POST', '/books', {'name': '5000边界', 'type': 'personal'})
        second_path = f'/books/{second["id"]}'
        status, body = owner.request('POST', second_path + '/import', payload)
        self.assertEqual(status, 201, body)
        exported = self.ok(owner, 'GET', second_path + '/export')
        self.assertEqual(len(exported['records']), 5000)
        self.ok(owner, 'POST', second_path + '/records', dict(row, occurredAt='2026-11-18T00:00:00Z'))
        status, body = owner.request('GET', second_path + '/export')
        self.assertEqual(status, 422, body)
        self.assertEqual(body['error']['code'], 'EXPORT_LIMIT_EXCEEDED')
        narrowed = self.ok(owner, 'GET', second_path + '/export?to=2026-11-18T00:00:00Z')
        self.assertEqual(len(narrowed['records']), 5000)
        self.ok(owner, 'DELETE', path)
        self.ok(owner, 'DELETE', second_path)

    def test_record_options_persistence_validation_isolation_and_atomic_limits(self):
        owner, other = Client(), Client()
        owner.register('自定义记账选项')
        other.register('独立选项用户')
        defaults = {
            'expenseCategories': ['餐饮美食', '日用百货', '交通出行', '住房物业', '购物消费',
                                  '休闲娱乐', '医疗健康', '教育学习', '人情往来', '其他支出'],
            'incomeCategories': ['工资薪酬', '奖金收入', '投资理财', '兼职收入', '礼金收入', '其他收入'],
            'paymentSources': ['微信', '支付宝', '银行卡', '现金', '其他'],
        }
        fields = {'expenseCategory': 'expenseCategories', 'incomeCategory': 'incomeCategories',
                  'paymentSource': 'paymentSources'}
        fallback_icons = {'expenseCategory': 'tag', 'incomeCategory': 'coins', 'paymentSource': 'wallet'}
        full_defaults = dict(defaults, icons={kind: {} for kind in fields})
        self.denied(Client(), 'GET', '/record-options', codes=(401,))
        self.denied(Client(), 'POST', '/record-options', {'kind': 'expenseCategory', 'name': '测试'}, codes=(401,))
        self.assertEqual(self.ok(owner, 'GET', '/record-options'), full_defaults)
        self.assertEqual(self.ok(other, 'GET', '/record-options'), full_defaults)

        family = self.ok(owner, 'POST', '/books', {'name': '选项共享历史', 'type': 'family'})
        invitation = self.ok(owner, 'POST', f'/books/{family["id"]}/invitations', {'phone': other.phone})
        self.ok(other, 'POST', f'/invitations/{invitation["id"]}/accept')
        path = f'/books/{family["id"]}/records'
        historical = self.ok(owner, 'POST', path, {
            'type': 'expense', 'amountCents': 100, 'category': '历史自由分类',
            'occurredAt': '2026-11-16T00:00:00Z', 'note': '', 'paymentSource': '历史支付来源',
        })
        expected = {key: list(value) for key, value in defaults.items()}
        expected['icons'] = {kind: {} for kind in fields}
        for kind, field in fields.items():
            status, body = owner.request('POST', '/record-options', {'kind': kind, 'name': '  自选名称\t '})
            self.assertEqual(status, 201, body)
            expected[field].append('自选名称')
            expected['icons'][kind]['自选名称'] = fallback_icons[kind]
            self.assertEqual(body['data'], expected)  # Each category kind is independent.
            self.denied(owner, 'POST', '/record-options', {'kind': kind, 'name': ' 自选名称 '}, codes=(409,))
            for name in defaults[field]:
                self.denied(owner, 'POST', '/record-options', {'kind': kind, 'name': ' ' + name + ' '}, codes=(409,))
        # UTF-8 character count, not byte count; exactly 40 Chinese characters is valid.
        expected['expenseCategories'].append('中' * 40)
        expected['icons']['expenseCategory']['中' * 40] = 'tag'
        self.assertEqual(self.ok(owner, 'POST', '/record-options',
                                 {'kind': 'expenseCategory', 'name': '中' * 40}), expected)
        invalid = ({}, [], 'string', {'kind': 'oops', 'name': 'x'}, {'kind': {}, 'name': 'x'},
                   {'kind': 'expenseCategory'}, {'name': 'x'}, {'kind': 'expenseCategory', 'name': None},
                   {'kind': 'incomeCategory', 'name': {}}, {'kind': 'paymentSource', 'name': []},
                   {'kind': 'expenseCategory', 'name': True}, {'kind': 'expenseCategory', 'name': 1},
                   {'kind': 'expenseCategory', 'name': ''}, {'kind': 'expenseCategory', 'name': ' \n\t '},
                   {'kind': 'expenseCategory', 'name': '中' * 41},
                   {'kind': 'expenseCategory', 'name': 'x\x00y'},
                   {'kind': 'expenseCategory', 'name': 'x', 'extra': True})
        for payload in invalid:
            with self.subTest(payload=payload):
                self.denied(owner, 'POST', '/record-options', payload, codes=(400,))
        status, body = owner.request('POST', '/record-options', {'kind': 'paymentSource', 'name': 'CSRF'},
                                     origin='https://evil.example')
        self.assertEqual(status, 403, body)
        self.assertEqual(body['error']['code'], 'CSRF_REJECTED')
        for raw, content_type, code in ((b'null', 'application/json', 400),
                                        (b'{', 'application/json', 400),
                                        (b'{"kind":"expenseCategory","name":"\xff"}', 'application/json', 400),
                                        (b'{}', 'text/plain', 415)):
            req = urllib.request.Request(BASE + '/api/record-options', raw,
                                         {'Origin': ORIGIN, 'Content-Type': content_type}, method='POST')
            with self.assertRaises(urllib.error.HTTPError) as rejected:
                owner.http.open(req, timeout=15)
            self.assertEqual(rejected.exception.code, code)
        self.assertEqual(self.ok(owner, 'GET', '/record-options'), expected)
        for icon in (None, {}, [], True, 1, '', 'TAG', 'not-an-icon', 'https://evil.example/icon.svg', '<svg>'):
            with self.subTest(icon=icon):
                self.denied(owner, 'POST', '/record-options',
                            {'kind': 'expenseCategory', 'name': '非法图标', 'icon': icon}, codes=(400,))
        selected_icons = ['utensils', 'shopping-basket', 'bus-front', 'house', 'shopping-bag', 'gamepad',
                          'heart-pulse', 'graduation-cap', 'gift', 'circle-ellipsis', 'briefcase-business',
                          'award', 'chart', 'laptop', 'coins', 'message-circle', 'qr-code', 'credit-card',
                          'banknote', 'wallet', 'tag', 'paw-print', 'coffee', 'baby', 'smartphone', 'plane',
                          'bike', 'car', 'book-open', 'music', 'camera', 'sparkles', 'heart', 'shirt', 'wrench']
        for icon in selected_icons:
            name = '图标-' + icon
            expected['expenseCategories'].append(name)
            expected['icons']['expenseCategory'][name] = icon
            self.assertEqual(self.ok(owner, 'POST', '/record-options',
                                     {'kind': 'expenseCategory', 'name': name, 'icon': icon}), expected)
        for kind, name, icon in (('expenseCategory', '宠物.护理', 'paw-print'),
                                 ('incomeCategory', '$礼金.收入', 'gift'),
                                 ('paymentSource', '__proto__', 'credit-card')):
            expected[fields[kind]].append(name)
            expected['icons'][kind][name] = icon
            self.assertEqual(self.ok(owner, 'POST', '/record-options',
                                     {'kind': kind, 'name': name, 'icon': icon}), expected)
        self.assertEqual(self.ok(owner, 'GET', '/record-options'), expected)
        self.assertEqual(self.ok(other, 'GET', '/record-options'), full_defaults)
        self.assertEqual(without_attribution(self.ok(other, 'GET', path)['items']), [historical])
        other_options = self.ok(other, 'POST', '/record-options',
                                {'kind': 'paymentSource', 'name': '自选名称', 'icon': 'qr-code'})
        self.assertEqual(other_options['icons'], {'expenseCategory': {}, 'incomeCategory': {},
                                                  'paymentSource': {'自选名称': 'qr-code'}})
        self.assertEqual(other_options['paymentSources'], defaults['paymentSources'] + ['自选名称'])
        self.assertEqual(other_options['expenseCategories'], defaults['expenseCategories'])
        self.assertEqual(self.ok(owner, 'GET', '/record-options'), expected)
        self.ok(owner, 'POST', '/auth/logout')
        self.ok(owner, 'POST', '/auth/login', {'phone': owner.phone, 'password': PASSWORD})
        self.assertEqual(self.ok(owner, 'GET', '/record-options'), expected)

        # Same-name parallel writes: exactly one creation, no duplicate array entry.
        def duplicate(index):
            return owner.request('POST', '/record-options',
                                 {'kind': 'paymentSource', 'name': '并发同名', 'icon': selected_icons[index]})
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            replies = list(pool.map(duplicate, range(8)))
        self.assertEqual(sorted(status for status, _ in replies), [201] + [409] * 7)
        winner = next(index for index, (status, _) in enumerate(replies) if status == 201)
        current_options = self.ok(owner, 'GET', '/record-options')
        self.assertEqual(current_options['paymentSources'].count('并发同名'), 1)
        self.assertEqual(current_options['icons']['paymentSource']['并发同名'], selected_icons[winner])

        # Test all three independent 50-item caps, including racing for the final slot.
        for kind, field in fields.items():
            current = self.ok(owner, 'GET', '/record-options')[field]
            custom_count = len(current) - len(defaults[field])
            for index in range(custom_count, 49):
                self.ok(owner, 'POST', '/record-options', {'kind': kind, 'name': f'限额-{index}'})

            def final_slot(index):
                return owner.request('POST', '/record-options',
                                     {'kind': kind, 'name': f'并发末位-{index}', 'icon': selected_icons[index]})
            with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
                replies = list(pool.map(final_slot, range(8)))
            self.assertEqual(sorted(status for status, _ in replies), [201] + [409] * 7)
            winner = next(index for index, (status, _) in enumerate(replies) if status == 201)
            final_options = self.ok(owner, 'GET', '/record-options')
            final = final_options[field]
            final_icons = final_options['icons'][kind]
            self.assertEqual(set(final_icons), set(final) - set(defaults[field]))
            self.assertEqual(final_icons[f'并发末位-{winner}'], selected_icons[winner])
            self.assertFalse(any(f'并发末位-{index}' in final_icons for index in range(8) if index != winner))
            self.assertEqual(len(final), len(defaults[field]) + 50)
            self.assertEqual(len(final), len(set(final)))
            self.denied(owner, 'POST', '/record-options', {'kind': kind, 'name': '超过上限'}, codes=(409,))
        self.assertEqual(without_attribution(self.ok(other, 'GET', path)['items']), [historical])
        self.ok(owner, 'DELETE', f'/books/{family["id"]}')

    def test_unregistered_phone_rejected_then_registered_user_invitation_and_rejection(self):
        owner, future = Client(), Client()
        owner.register('邀请人')
        family = self.ok(owner, 'POST', '/books', {'name': '新朋友', 'type': 'family'})
        target = phone()
        status, body = owner.request('POST', f'/books/{family["id"]}/invitations', {'phone': target})
        self.assertEqual(status, 404, body)
        self.assertEqual(body['error']['code'], 'USER_NOT_REGISTERED')
        self.assertIn('尚未注册', body['error']['message'])
        self.ok(future, 'POST', '/auth/register', {'phone': target, 'password': PASSWORD, 'name': '新成员', 'smsCode': sms_code(target)})
        # A rejected attempt must not leave an invitation waiting for later registration.
        self.assertEqual(self.ok(future, 'GET', '/invitations'), [])
        invited = self.ok(owner, 'POST', f'/books/{family["id"]}/invitations', {'phone': target})
        self.assertTrue(any(i['id'] == invited['id'] for i in self.ok(future, 'GET', '/invitations')))
        self.ok(future, 'POST', f'/invitations/{invited["id"]}/reject')
        self.denied(future, 'POST', f'/invitations/{invited["id"]}/accept', codes=(400, 403, 404, 409))
        self.ok(owner, 'DELETE', f'/books/{family["id"]}')

    def test_validation_csrf_and_input_safety(self):
        user = Client()
        self.denied(user, 'POST', '/auth/register', {'phone': '123', 'password': 'short', 'name': 'x'})
        user.register('校验测试')
        status, body = user.request('POST', '/books', {'name': 'CSRF', 'type': 'personal'}, origin='https://evil.example')
        self.assertEqual(status, 403, body)
        book = self.ok(user, 'POST', '/books', {'name': '校验账本', 'type': 'personal'})
        path = f'/books/{book["id"]}/records'
        payload = {'type': 'expense', 'amountCents': 1, 'category': '其他',
                   'occurredAt': '2026-11-16T00:00:00Z', 'note': '', 'paymentSource': '现金'}
        for invalid in ({'amountCents': 0}, {'amountCents': -1}, {'amountCents': 1.5},
                        {'amountCents': '1'}, {'amountCents': 100000000000}, {'type': 'oops'},
                        {'occurredAt': '2026-02-30T00:00:00Z'}, {'category': {'$ne': ''}},
                        {'note': 'a' * 501}):
            with self.subTest(invalid=invalid):
                self.denied(user, 'POST', path, dict(payload, **invalid), codes=(400, 422))
        self.denied(user, 'GET', path + '?page=0', codes=(400, 422))
        self.denied(user, 'GET', f'/books/{book["id"]}/analysis?period=decade', codes=(400, 422))
        self.ok(user, 'DELETE', f'/books/{book["id"]}')

    def test_all_books_analysis_only_counts_my_records(self):
        owner, member = Client(), Client()
        owner.register('全部账本拥有者')
        member.register('全部账本家人')
        personal = self.ok(owner, 'POST', '/books', {'name': '全部账本个人', 'type': 'personal'})
        family = self.ok(owner, 'POST', '/books', {'name': '全部账本家庭', 'type': 'family'})
        member_personal = self.ok(member, 'POST', '/books', {'name': '家人的个人账本', 'type': 'personal'})
        invitation = self.ok(owner, 'POST', f'/books/{family["id"]}/invitations', {'phone': member.phone})
        self.ok(member, 'POST', f'/invitations/{invitation["id"]}/accept')

        def add_record(client, book, cents, category, note):
            return self.ok(client, 'POST', f'/books/{book["id"]}/records', {
                'type': 'expense', 'amountCents': cents, 'category': category,
                'occurredAt': '2026-11-16T04:30:00.000Z', 'note': note, 'paymentSource': '微信',
            })
        add_record(owner, personal, 100, '早餐', '拥有者个人')
        add_record(owner, family, 200, '午餐', '拥有者家庭')
        add_record(member, family, 300, '晚餐', '家人家庭')
        add_record(member, member_personal, 400, '购物', '家人个人')

        owner_view = self.ok(owner, 'GET', '/analysis?period=month&date=2026-11-16')
        self.assertEqual((owner_view['expenseCents'], owner_view['recordCount']), (300, 2))
        self.assertEqual(owner_view['balanceCents'], -300)
        self.assertEqual(owner_view['members'], [])
        owner_books = {item['name']: item for item in owner_view['books']}
        self.assertEqual(set(owner_books), {'全部账本个人', '全部账本家庭'})
        self.assertEqual((owner_books['全部账本个人']['expenseCents'], owner_books['全部账本个人']['recordCount']),
                         (100, 1))
        self.assertEqual((owner_books['全部账本家庭']['expenseCents'], owner_books['全部账本家庭']['recordCount']),
                         (200, 1))

        member_view = self.ok(member, 'GET', '/analysis?period=month&date=2026-11-16')
        self.assertEqual((member_view['expenseCents'], member_view['recordCount']), (700, 2))
        self.assertEqual({item['name'] for item in member_view['books']},
                         {'全部账本家庭', '家人的个人账本'})
        self.denied(member, 'GET', '/analysis?period=decade', codes=(400,))

        self.ok(owner, 'DELETE', f'/books/{family["id"]}')
        self.ok(owner, 'DELETE', f'/books/{personal["id"]}')
        self.ok(member, 'DELETE', f'/books/{member_personal["id"]}')

    def test_filters_integer_money_and_calendar_analysis(self):
        user = Client()
        user.register('分析测试')
        book = self.ok(user, 'POST', '/books', {'name': '分析账本', 'type': 'personal'})
        path = f'/books/{book["id"]}/records'
        # Shanghai Monday 00:00 = previous UTC day 16:00; exact endpoint excluded.
        rows = [('expense', 10, '餐饮', '2026-11-15T15:59:59Z', '前一周'),
                ('expense', 20, '餐饮', '2026-11-15T16:00:00Z', '本周开始'),
                ('expense', 30, '交通', '2026-11-16T04:00:00Z', '地铁'),
                ('income', 10001, '工资', '2026-11-20T00:00:00Z', '收入'),
                ('expense', 40, '购物', '2026-11-22T16:00:00Z', '下一周')]
        for kind, cents, category, occurred, note in rows:
            self.ok(user, 'POST', path, {'type': kind, 'amountCents': cents, 'category': category,
                    'occurredAt': occurred, 'note': note, 'paymentSource': '银行卡'})
        all_records = self.ok(user, 'GET', path)['items']
        self.assertEqual([r['occurredAt'] for r in all_records],
                         sorted([r['occurredAt'] for r in all_records], reverse=True))
        filtered = self.ok(user, 'GET', path + '?type=expense&category=' + urllib.parse.quote('餐饮') + '&pageSize=1')
        self.assertEqual(filtered['total'], 2)
        self.assertEqual(len(filtered['items']), 1)
        searched = self.ok(user, 'GET', path + '?q=' + urllib.parse.quote('地铁'))
        self.assertEqual(searched['total'], 1)
        literal_search = self.ok(user, 'GET', path + '?q=' + urllib.parse.quote('[.*'))
        self.assertEqual(literal_search['total'], 0)
        week_filter = urllib.parse.urlencode({'from': '2026-11-15T16:00:00Z', 'to': '2026-11-22T16:00:00Z'})
        self.assertEqual(self.ok(user, 'GET', path + '?' + week_filter)['total'], 3)
        backwards = urllib.parse.urlencode({'from': '2026-11-22T16:00:00Z', 'to': '2026-11-15T16:00:00Z'})
        self.denied(user, 'GET', path + '?' + backwards, codes=(400,))
        week = self.ok(user, 'GET', f'/books/{book["id"]}/analysis?period=week&date=2026-11-16')
        self.assertEqual(week['incomeCents'], 10001)
        self.assertEqual(week['expenseCents'], 50)
        self.assertEqual(week['balanceCents'], 9951)
        self.assertEqual(week['recordCount'], 3)
        self.assertEqual(len(week['trend']), 7)
        self.assertEqual(week['categories'][0]['category'], '交通')
        month = self.ok(user, 'GET', f'/books/{book["id"]}/analysis?period=month&date=2026-11-16')
        self.assertEqual(month['expenseCents'], 100)
        self.assertEqual(len(month['trend']), 30)
        year = self.ok(user, 'GET', f'/books/{book["id"]}/analysis?period=year&date=2026-11-16')
        self.assertEqual(len(year['trend']), 12)
        leap = self.ok(user, 'GET', f'/books/{book["id"]}/analysis?period=month&date=2024-02-29')
        self.assertEqual(len(leap['trend']), 29)
        self.assertEqual(leap['recordCount'], 0)
        self.ok(user, 'DELETE', f'/books/{book["id"]}')


if __name__ == '__main__':
    unittest.main(verbosity=2)
