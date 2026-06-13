import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  handleTemplateWebhookChange,
  isTemplateWebhookField,
} from './template-webhook';

// ---------------------------------------------------------------------------
// Mock the Prisma client used by template-webhook.ts.
// We capture the arguments passed to updateMany so the tests can assert on
// what data would be written without hitting a real database.
// ---------------------------------------------------------------------------

const mockUpdateMany = vi.fn();

vi.mock('@/lib/db', () => ({
  prisma: {
    messageTemplate: {
      updateMany: (...args: unknown[]) => mockUpdateMany(...args),
    },
  },
}));

beforeEach(() => {
  mockUpdateMany.mockReset();
  // Default: succeed with one row updated
  mockUpdateMany.mockResolvedValue({ count: 1 });
});

describe('isTemplateWebhookField', () => {
  it('recognises the three template fields', () => {
    expect(isTemplateWebhookField('message_template_status_update')).toBe(true);
    expect(isTemplateWebhookField('message_template_quality_update')).toBe(true);
    expect(isTemplateWebhookField('message_template_components_update')).toBe(true);
  });
  it('rejects messaging fields', () => {
    expect(isTemplateWebhookField('messages')).toBe(false);
    expect(isTemplateWebhookField('message_status')).toBe(false);
  });
});

describe('handleTemplateWebhookChange — status update', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('flips status to APPROVED and clears any rejection_reason', async () => {
    await handleTemplateWebhookChange({
      field: 'message_template_status_update',
      value: {
        event: 'APPROVED',
        message_template_id: 12345,
        message_template_name: 'order_confirmation',
        message_template_language: 'en_US',
      },
    });
    expect(mockUpdateMany).toHaveBeenCalledTimes(1);
    const [call] = mockUpdateMany.mock.calls;
    expect(call[0].where).toEqual({ meta_template_id: '12345' });
    expect(call[0].data).toEqual({
      status: 'APPROVED',
      rejection_reason: null,
      submission_error: null,
    });
  });

  it('persists the reason field on REJECTED', async () => {
    await handleTemplateWebhookChange({
      field: 'message_template_status_update',
      value: {
        event: 'REJECTED',
        message_template_id: 'TMPL_99',
        reason: 'Template uses non-compliant language.',
      },
    });
    const [call] = mockUpdateMany.mock.calls;
    expect(call[0].data.status).toBe('REJECTED');
    expect(call[0].data.rejection_reason).toBe(
      'Template uses non-compliant language.',
    );
  });

  it('falls back to a generic reason when REJECTED has no `reason`', async () => {
    await handleTemplateWebhookChange({
      field: 'message_template_status_update',
      value: { event: 'REJECTED', message_template_id: '7' },
    });
    const [call] = mockUpdateMany.mock.calls;
    expect(call[0].data.rejection_reason).toBe('Rejected by Meta');
  });

  it('normalises PENDING_REVIEW → PENDING (via shared normalizeStatus)', async () => {
    await handleTemplateWebhookChange({
      field: 'message_template_status_update',
      value: { event: 'PENDING_REVIEW', message_template_id: '1' },
    });
    const [call] = mockUpdateMany.mock.calls;
    expect(call[0].data.status).toBe('PENDING');
  });

  it('logs and exits when meta_template_id is missing (no updateMany issued)', async () => {
    await handleTemplateWebhookChange({
      field: 'message_template_status_update',
      value: { event: 'APPROVED' },
    });
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it('logs a warning when the row is unknown locally (zero matches)', async () => {
    mockUpdateMany.mockResolvedValue({ count: 0 });
    const warn = vi.spyOn(console, 'warn');
    await handleTemplateWebhookChange({
      field: 'message_template_status_update',
      value: {
        event: 'APPROVED',
        message_template_id: 'NEVER_SEEN',
        message_template_name: 'mystery',
      },
    });
    expect(warn).toHaveBeenCalled();
  });
});

describe('handleTemplateWebhookChange — quality update', () => {
  it('sets quality_score from new_quality_score', async () => {
    await handleTemplateWebhookChange({
      field: 'message_template_quality_update',
      value: {
        message_template_id: '99',
        previous_quality_score: 'GREEN',
        new_quality_score: 'YELLOW',
      },
    });
    const [call] = mockUpdateMany.mock.calls;
    expect(call[0].data).toEqual({ quality_score: 'YELLOW' });
    expect(call[0].where).toEqual({ meta_template_id: '99' });
  });

  it('stores null for unrecognised quality scores', async () => {
    await handleTemplateWebhookChange({
      field: 'message_template_quality_update',
      value: {
        message_template_id: '99',
        new_quality_score: 'PURPLE', // not a real Meta value
      },
    });
    const [call] = mockUpdateMany.mock.calls;
    expect(call[0].data).toEqual({ quality_score: null });
  });
});

describe('handleTemplateWebhookChange — components update', () => {
  it('is an info-log no-op (does not write to DB)', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    await handleTemplateWebhookChange({
      field: 'message_template_components_update',
      value: {
        message_template_id: '5',
        message_template_name: 'x',
      },
    });
    expect(mockUpdateMany).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalled();
  });
});

describe('handleTemplateWebhookChange — unknown field', () => {
  it('is a defensive no-op', async () => {
    await handleTemplateWebhookChange(
      // Pretend Meta added a new template_* field we don't know about.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { field: 'message_template_future_field' as any, value: {} },
    );
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });
});
