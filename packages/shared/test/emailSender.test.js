import { beforeEach, describe, expect, it, vi } from 'vitest';

// Replace nodemailer with a fake so no network or real inbox is involved.
const sendMail = vi.fn();
const createTransport = vi.fn(() => ({ sendMail }));
const createTestAccount = vi.fn();
vi.mock('nodemailer', () => ({
  default: {
    createTransport,
    createTestAccount,
    getTestMessageUrl: (info) => info.previewUrl ?? false,
  },
}));

const { createEmailSender } = await import('../src/alerts/email.js');
const { createAlertSenders } = await import('../src/alerts/index.js');

const alert = {
  kind: 'down',
  title: 'API is DOWN',
  summary: 'It failed.',
  monitorName: 'API',
  link: 'https://app/x',
  fields: [['Cause', 'Connection refused']],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createEmailSender', () => {
  it('uses the configured SMTP server and creates the transport only once', async () => {
    sendMail.mockResolvedValue({});
    const send = createEmailSender({
      smtp: { host: 'smtp.example.com', port: 465, user: 'u', pass: 'p' },
      from: 'PulseBoard <a@b.c>',
    });

    expect(await send('ops@example.com', alert)).toEqual({ previewUrl: null });
    await send('ops@example.com', alert);

    expect(createTransport).toHaveBeenCalledTimes(1);
    expect(createTransport).toHaveBeenCalledWith({
      host: 'smtp.example.com',
      port: 465,
      secure: true,
      auth: { user: 'u', pass: 'p' },
    });
    expect(sendMail.mock.calls[0][0]).toMatchObject({
      from: 'PulseBoard <a@b.c>',
      to: 'ops@example.com',
      subject: 'API is DOWN',
    });
  });

  it('falls back to an Ethereal test inbox and returns the preview URL', async () => {
    createTestAccount.mockResolvedValue({
      user: 'eth-user',
      pass: 'eth-pass',
      smtp: { host: 'smtp.ethereal.email', port: 587, secure: false },
    });
    sendMail.mockResolvedValue({ previewUrl: 'https://ethereal.email/message/1' });

    const send = createEmailSender({ smtp: { host: '' }, from: 'x@y.z', logger: { info() {} } });
    expect(await send('ops@example.com', alert)).toEqual({
      previewUrl: 'https://ethereal.email/message/1',
    });
    expect(createTestAccount).toHaveBeenCalledTimes(1);
  });

  it('retries creating the transport after a failure', async () => {
    createTestAccount.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({
      user: 'u',
      pass: 'p',
      smtp: { host: 'h', port: 587, secure: false },
    });
    sendMail.mockResolvedValue({});
    const send = createEmailSender({ smtp: {}, from: 'x@y.z', logger: { info() {} } });

    await expect(send('ops@example.com', alert)).rejects.toThrow('offline');
    await expect(send('ops@example.com', alert)).resolves.toEqual({ previewUrl: null });
  });
});

describe('createAlertSenders', () => {
  it('returns one sender per channel type', () => {
    const senders = createAlertSenders({ smtp: {}, from: 'x@y.z' });
    expect(Object.keys(senders).sort()).toEqual(['discord', 'email', 'slack']);
  });
});
