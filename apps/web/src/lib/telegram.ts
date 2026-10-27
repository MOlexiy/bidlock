interface TelegramWebApp {
  initData: string;
  ready(): void;
  expand(): void;
  HapticFeedback?: { notificationOccurred(type: 'error' | 'success' | 'warning'): void };
}

export const tg = (): TelegramWebApp | undefined =>
  (window as unknown as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp;

export const insideTelegram = () => Boolean(tg()?.initData);

export const haptic = (type: 'error' | 'success' | 'warning') => tg()?.HapticFeedback?.notificationOccurred(type);
