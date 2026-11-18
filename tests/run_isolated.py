"""Run the HTTP suites with disposable local services and no real SMS credentials."""
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import tempfile
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]


def free_ports():
    listeners = [socket.socket() for _ in range(3)]
    try:
        for listener in listeners:
            listener.bind(('127.0.0.1', 0))
        return [listener.getsockname()[1] for listener in listeners]
    finally:
        for listener in listeners:
            listener.close()


def main():
    nginx = os.getenv('OPENRESTY_BIN') or shutil.which('openresty') or '/usr/local/openresty/nginx/sbin/nginx'
    with tempfile.TemporaryDirectory(prefix='nestledger-http-') as directory:
        p = Path(directory)
        (p / 'db').mkdir()
        (p / 'logs').mkdir()
        app, redis, mongo = free_ports()
        key = secrets.token_hex(32)
        origin = f'http://127.0.0.1:{app}'
        sock = str(p / 'redis.sock')
        env = dict(os.environ, MONGO_HOST='127.0.0.1', MONGO_PORT=str(mongo), MONGO_DATABASE='nestledger_test',
                   REDIS_HOST='127.0.0.1', REDIS_PORT=str(redis), REDIS_DATABASE='0', REDIS_PASSWORD='',
                   APP_ORIGIN=origin, NESTLEDGER_TEST_URL=origin, NESTLEDGER_TEST_REDIS_SOCKET=sock,
                   NESTLEDGER_TEST_SMS_HMAC_KEY=key, SMS_HMAC_KEY=key, COOKIE_SECURE='false',
                   PBKDF2_ITERATIONS='100000', ALIYUN_ACCESS_KEY_ID='test-placeholder',
                   ALIYUN_ACCESS_KEY_SECRET='test-placeholder', ALIYUN_SMS_SIGN_NAME='test-placeholder',
                   ALIYUN_SMS_REGISTER_TEMPLATE_CODE='100001', ALIYUN_SMS_PHONE_CHANGE_TEMPLATE_CODE='100002', ALIYUN_SMS_RESET_PASSWORD_TEMPLATE_CODE='100003')
        # Disposable services run without authentication; never inherit local credentials.
        for name in ('MONGO_USERNAME', 'MONGO_PASSWORD', 'MONGO_AUTH_SOURCE'):
            env.pop(name, None)
        config = (ROOT / 'backend/nginx.conf').read_text().replace('__PROJECT_ROOT__', str(ROOT))
        # No external DNS or provider calls in this test environment.
        config = config.replace('__DNS_RESOLVER__', '127.0.0.1').replace('listen __SERVER_LISTEN__;', f'listen 127.0.0.1:{app};').replace('        # __TLS_CONFIG__\n', '')
        config = config.replace('/tmp/nestledger-nginx.pid', str(p / 'nginx.pid')).replace('/dev/stderr', str(p / 'error.log')).replace('/dev/stdout', str(p / 'access.log')).replace('worker_processes auto;', 'worker_processes 2;')
        (p / 'nginx.conf').write_text(config)
        commands = [
            ['redis-server', '--bind', '127.0.0.1', '--port', str(redis), '--unixsocket', sock, '--unixsocketperm', '700', '--dir', directory, '--save', '', '--appendonly', 'no'],
            ['mongod', '--bind_ip', '127.0.0.1', '--port', str(mongo), '--dbpath', str(p / 'db')],
            [nginx, '-p', directory + '/', '-c', str(p / 'nginx.conf'), '-g', 'daemon off;'],
        ]
        with (p / 'services.log').open('wb') as log:
            procs = []
            try:
                for command in commands:
                    procs.append(subprocess.Popen(command, env=env, stdout=log, stderr=log))
                for _ in range(100):
                    try:
                        with urllib.request.urlopen(origin + '/api/health', timeout=1):
                            break
                    except OSError:
                        time.sleep(0.1)
                else:
                    raise RuntimeError((p / 'services.log').read_text()[-5000:])
                subprocess.run(['python3', '-m', 'unittest', 'discover', '-s', 'tests', '-v'], cwd=ROOT, env=env, check=True)
                # The suites together exceed 30 registrations/hour. Only clear the limit in this disposable Redis.
                subprocess.run(['redis-cli', '-s', sock, 'DEL', 'rate:register:127.0.0.1'], check=True)
                subprocess.run(['npm', 'test'], cwd=ROOT / 'tests/browser', env=env, check=True)
            finally:
                for proc in reversed(procs):
                    proc.terminate()
                    try:
                        proc.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        proc.kill()
                        proc.wait()


if __name__ == '__main__':
    main()
