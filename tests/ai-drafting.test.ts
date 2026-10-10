import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDraftWithAI } from '@/lib/ai/customer-draft';

const facts = {
  customerName: 'Aisyah',
  orderRef: 'GB-2024-014',
  supplierName: 'Kuching Harvest Trading',
  refundFormatted: 'RM84.00',
};

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.LLM_API_KEY;
  delete process.env.LLM_MODEL;
});

describe('optional AI drafting', () => {
  it('is disabled without a server-side API key', () => {
    delete process.env.LLM_API_KEY;
    expect(getDraftWithAI()).toBeUndefined();
  });

  it('accepts an AI message with the exact authoritative refund amount', async () => {
    process.env.LLM_API_KEY = 'test-key';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: {
        content: 'Hi Aisyah, the supplier cancelled order GB-2024-014. Your proposed refund is RM84.00, subject to founder confirmation.',
      } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const draft = await getDraftWithAI()!(facts);
    expect(draft).toContain('RM84.00');
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(options.headers.Authorization).toBe('Bearer test-key');
  });

  it('rejects a model output with the wrong amount', async () => {
    process.env.LLM_API_KEY = 'test-key';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'Your proposed refund is RM85.00. Thanks for understanding.' } }] }),
    }));
    await expect(getDraftWithAI()!(facts)).rejects.toThrow('safety validation');
  });

  it('rejects a false claim of payment completion', async () => {
    process.env.LLM_API_KEY = 'test-key';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'Hi Aisyah, we have refunded RM84.00 for the cancelled order already.' } }] }),
    }));
    await expect(getDraftWithAI()!(facts)).rejects.toThrow('safety validation');
  });
});
