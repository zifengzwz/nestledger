"""Run SMS module checks against a temporary Redis without contacting Aliyun."""
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import time

root = Path(__file__).resolve().parents[2]
with socket.socket() as listener:
    listener.bind(('127.0.0.1', 0))
    port = listener.getsockname()[1]
with tempfile.TemporaryDirectory() as directory:
    redis = subprocess.Popen([
        'redis-server', '--bind', '127.0.0.1', '--port', str(port),
        '--save', '', '--appendonly', 'no', '--dir', directory,
    ], stdout=subprocess.DEVNULL)
    try:
        for _ in range(100):
            if redis.poll() is not None:
                raise RuntimeError('Temporary Redis exited')
            try:
                with socket.create_connection(('127.0.0.1', port), .1):
                    break
            except OSError:
                time.sleep(.02)
        else:
            raise RuntimeError('Temporary Redis did not start')
        env = dict(os.environ, REDIS_HOST='127.0.0.1', REDIS_PORT=str(port))
        env.pop('SMS_HMAC_KEY', None)
        # The disposable Redis has no password; never inherit local credentials.
        env.pop('REDIS_PASSWORD', None)
        subprocess.run([
            'resty', '--main-conf', 'env REDIS_HOST; env REDIS_PORT;',
            '-I', 'backend/lua', 'backend/tests/sms.lua',
        ], cwd=root, env=env, check=True)
    finally:
        redis.terminate()
        redis.wait()
