import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifyInitData } from '../src/auth/telegram';

const BOT_TOKEN = '123456:TEST';

function sign(fields: Record<string, string>, token = BOT_TOKEN) {
  const dcs = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = createHmac('sha256', secret).update(dcs).digest('hex');
  return new URLSearchParams({ ...fields, hash }).toString();
}

const user = JSON.stringify({ id: 42, username: 'olexii' });
const now = Math.floor(Date.now() / 1000);

describe('Telegram initData', () => {
  it('accepts correctly signed data', () => {
    expect(verifyInitData(sign({ auth_date: String(now), user, query_id: 'q' }), BOT_TOKEN)).toMatchObject({ id: 42 });
  });

  it('rejects tampered data', () => {
    const data = sign({ auth_date: String(now), user }).replace('42', '43');
    expect(verifyInitData(data, BOT_TOKEN)).toBeNull();
  });

  it('rejects data signed by another bot', () => {
    expect(verifyInitData(sign({ auth_date: String(now), user }, '999:OTHER'), BOT_TOKEN)).toBeNull();
  });

  it('rejects stale data', () => {
    expect(verifyInitData(sign({ auth_date: String(now - 2 * 86400), user }), BOT_TOKEN)).toBeNull();
  });
});
