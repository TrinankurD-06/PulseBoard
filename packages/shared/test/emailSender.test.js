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

const { createEmailSender, parseSender } = await import('../src/alerts/email.js');
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
      // Short, so a blocked SMTP port fails in seconds instead of two minutes.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
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

describe('createEmailSender over Resend (HTTPS)', () => {
  const okResponse = () => ({ ok: true, status: 200, json: async () => ({ id: 'abc' }) });

  it('posts the email to the Resend API and never touches SMTP', async () => {
    const fetchImpl = vi.fn(async () => okResponse());
    const send = createEmailSender({
      smtp: { host: 'smtp.example.com', port: 587 },
      from: 'PulseBoard <alerts@mydomain.com>',
      resendApiKey: 're_test_key',
      fetchImpl,
    });

    expect(await send('ops@example.com', alert)).toEqual({ previewUrl: null });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.method).toBe('POST');
    expect(init.headers.authorization).toBe('Bearer re_test_key');
    expect(JSON.parse(init.body)).toMatchObject({
      from: 'PulseBoard <alerts@mydomain.com>',
      to: ['ops@example.com'],
      subject: 'API is DOWN',
    });
    expect(JSON.parse(init.body).html).toContain('Connection refused');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(createTransport).not.toHaveBeenCalled();
    expect(createTestAccount).not.toHaveBeenCalled();
  });

  it("swaps the placeholder sender for Resend's test sender", async () => {
    const fetchImpl = vi.fn(async () => okResponse());
    const send = createEmailSender({
      from: 'PulseBoard <alerts@pulseboard.local>',
      resendApiKey: 'k',
      fetchImpl,
    });
    await send('ops@example.com', alert);
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).from).toBe(
      'PulseBoard <onboarding@resend.dev>',
    );
  });

  it("surfaces Resend's own explanation when it rejects the email", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 403,
      json: async () => ({ message: 'You can only send testing emails to your own email address' }),
    }));
    const send = createEmailSender({ from: 'x@y.z', resendApiKey: 'k', fetchImpl });
    await expect(send('someone@else.com', alert)).rejects.toThrow(
      'Resend rejected the email (403): You can only send testing emails to your own email address',
    );
  });

  it('still reports a status when the error body is not JSON', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error('not json');
      },
    }));
    const send = createEmailSender({ from: 'x@y.z', resendApiKey: 'k', fetchImpl });
    await expect(send('a@b.c', alert)).rejects.toThrow('Resend rejected the email (502)');
  });

  it('turns a timeout and a network error into clear messages', async () => {
    const timeout = Object.assign(new Error('aborted'), { name: 'TimeoutError' });
    const slow = createEmailSender({
      from: 'x@y.z',
      resendApiKey: 'k',
      fetchImpl: vi.fn().mockRejectedValue(timeout),
    });
    await expect(slow('a@b.c', alert)).rejects.toThrow('Resend did not answer in time');

    const down = createEmailSender({
      from: 'x@y.z',
      resendApiKey: 'k',
      fetchImpl: vi.fn().mockRejectedValue(new Error('getaddrinfo ENOTFOUND')),
    });
    await expect(down('a@b.c', alert)).rejects.toThrow(
      'Could not reach Resend: getaddrinfo ENOTFOUND',
    );
  });

  it('is chosen by createAlertSenders when the key is set', async () => {
    const fetchImpl = vi.fn(async () => okResponse());
    const original = globalThis.fetch;
    globalThis.fetch = fetchImpl;
    try {
      const senders = createAlertSenders({ smtp: {}, from: 'x@y.z', resendApiKey: 'k' });
      await senders.email('ops@example.com', alert);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe('createEmailSender over Brevo (HTTPS)', () => {
  const okResponse = () => ({
    ok: true,
    status: 201,
    json: async () => ({ messageId: '<1@brevo>' }),
  });
  const from = 'PulseBoard <alerts.sender@gmail.com>';

  it('posts to the Brevo API with the api-key header and the recipient the user entered', async () => {
    const fetchImpl = vi.fn(async () => okResponse());
    const send = createEmailSender({
      smtp: { host: 'smtp.example.com', port: 587 },
      from,
      brevoApiKey: 'xkeysib-test',
      fetchImpl,
    });

    // Any address, not only the account owner's.
    expect(await send('someone@else.com', alert)).toEqual({ previewUrl: null });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(init.method).toBe('POST');
    expect(init.headers['api-key']).toBe('xkeysib-test');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      sender: { name: 'PulseBoard', email: 'alerts.sender@gmail.com' },
      to: [{ email: 'someone@else.com' }],
      subject: 'API is DOWN',
    });
    expect(body.htmlContent).toContain('Connection refused');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(createTransport).not.toHaveBeenCalled();
  });

  it('wins over Resend and SMTP when its key is set', async () => {
    const fetchImpl = vi.fn(async () => okResponse());
    const send = createEmailSender({
      smtp: { host: 'smtp.example.com' },
      from,
      brevoApiKey: 'b',
      resendApiKey: 'r',
      fetchImpl,
    });
    await send('a@b.co', alert);
    expect(fetchImpl.mock.calls[0][0]).toBe('https://api.brevo.com/v3/smtp/email');
  });

  it('refuses the placeholder sender with an instruction, without calling Brevo', async () => {
    const fetchImpl = vi.fn();
    const send = createEmailSender({
      from: 'PulseBoard <alerts@pulseboard.local>',
      brevoApiKey: 'b',
      fetchImpl,
    });
    await expect(send('a@b.co', alert)).rejects.toThrow(/verified in your Brevo account/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("surfaces Brevo's own explanation, and still works when the body is not JSON", async () => {
    const rejected = vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ code: 'unauthorized', message: 'Key not found' }),
    }));
    await expect(
      createEmailSender({ from, brevoApiKey: 'bad', fetchImpl: rejected })('a@b.co', alert),
    ).rejects.toThrow('Brevo rejected the email (401): Key not found');

    const html = vi.fn(async () => ({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error('not json');
      },
    }));
    await expect(
      createEmailSender({ from, brevoApiKey: 'k', fetchImpl: html })('a@b.co', alert),
    ).rejects.toThrow('Brevo rejected the email (502)');
  });

  it('turns a timeout and a network error into clear messages', async () => {
    const timeout = Object.assign(new Error('aborted'), { name: 'TimeoutError' });
    await expect(
      createEmailSender({ from, brevoApiKey: 'k', fetchImpl: vi.fn().mockRejectedValue(timeout) })(
        'a@b.co',
        alert,
      ),
    ).rejects.toThrow('Brevo did not answer in time');
    await expect(
      createEmailSender({
        from,
        brevoApiKey: 'k',
        fetchImpl: vi.fn().mockRejectedValue(new Error('ENOTFOUND')),
      })('a@b.co', alert),
    ).rejects.toThrow('Could not reach Brevo: ENOTFOUND');
  });

  it('is chosen by createAlertSenders when the key is set', async () => {
    const fetchImpl = vi.fn(async () => okResponse());
    const original = globalThis.fetch;
    globalThis.fetch = fetchImpl;
    try {
      const senders = createAlertSenders({ smtp: {}, from, brevoApiKey: 'k' });
      await senders.email('ops@example.com', alert);
      expect(fetchImpl.mock.calls[0][0]).toBe('https://api.brevo.com/v3/smtp/email');
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe('parseSender', () => {
  it('reads "Name <addr>", a quoted name and a bare address', () => {
    expect(parseSender('PulseBoard <a@b.co>')).toEqual({ name: 'PulseBoard', email: 'a@b.co' });
    expect(parseSender('"Pulse Board" <a@b.co>')).toEqual({ name: 'Pulse Board', email: 'a@b.co' });
    expect(parseSender('a@b.co')).toEqual({ email: 'a@b.co' });
    expect(parseSender('<a@b.co>')).toEqual({ name: undefined, email: 'a@b.co' });
  });
});

describe('createAlertSenders', () => {
  it('returns one sender per channel type', () => {
    const senders = createAlertSenders({ smtp: {}, from: 'x@y.z' });
    expect(Object.keys(senders).sort()).toEqual(['discord', 'email', 'slack']);
  });
});
