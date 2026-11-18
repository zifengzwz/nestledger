"""Seed a short-lived SMS challenge in a disposable test Redis instance only."""
import hashlib
import hmac
import os
import secrets
import subprocess
import sys
from urllib.parse import urlsplit


def sms_code(phone, purpose='register', user_id=''):
    url = urlsplit(os.environ.get('NESTLEDGER_TEST_URL', ''))
    socket = os.environ.get('NESTLEDGER_TEST_REDIS_SOCKET', '')
    key = os.environ.get('NESTLEDGER_TEST_SMS_HMAC_KEY', '').encode()
    if (url.scheme not in ('http', 'https') or url.hostname not in ('127.0.0.1', '::1')
            or not url.port or not os.path.isabs(socket) or len(key) < 32):
        raise RuntimeError('Set NESTLEDGER_TEST_URL to the disposable loopback service, '
                           'NESTLEDGER_TEST_REDIS_SOCKET to its private Redis Unix socket, '
                           'and NESTLEDGER_TEST_SMS_HMAC_KEY to its dedicated SMS_HMAC_KEY')
    scope = f'{phone}:{purpose}:{user_id}'
    code = f'{secrets.randbelow(1_000_000):06d}'

    def mac(value):
        return hmac.new(key, value.encode(), hashlib.sha256).hexdigest()

    result = subprocess.run([
        'redis-cli', '-s', socket, '--raw', 'EVAL',
        "redis.call('HSET',KEYS[1],'digest',ARGV[1],'failures',0); "
        "return redis.call('EXPIRE',KEYS[1],300)",
        '1', 'sms:code:' + mac('scope:' + scope), mac(f'code:{scope}:{code}'),
    ], check=True, capture_output=True, text=True, timeout=5)
    if result.stdout.strip() != '1':
        raise RuntimeError('Failed to seed SMS challenge in test Redis')
    return code


if __name__ == '__main__':
    print(sms_code(*sys.argv[1:]))
