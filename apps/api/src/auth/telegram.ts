import { createHmac, timingSafeEqual } from 'node:crypto';

export interface TelegramUser {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
}

/**
 * Validates Telegram MiniApp `initData`
 * (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app).
 * secret = HMAC_SHA256("WebAppData", botToken); hash = HMAC_SHA256(secret, data_check_string)
 */
export function verifyInitData(initData: string, botToken: string, maxAgeSec = 24 * 3600, now = Date.now()) {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = createHmac('sha256', secret).update(dataCheckString).digest();
  const given = Buffer.from(hash, 'hex');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  const authDate = Number(params.get('auth_date'));
  if (!authDate || now / 1000 - authDate > maxAgeSec) return null;

  const user = params.get('user');
  return user ? (JSON.parse(user) as TelegramUser) : null;
}
