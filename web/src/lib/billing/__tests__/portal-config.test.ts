import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildPortalSessionParams, isCancelFlow } from '../portal-config';

const ORIGINAL_ENV = process.env.STRIPE_PORTAL_CONFIGURATION_ID;

describe('isCancelFlow', () => {
  it('matches only the literal "cancel"', () => {
    expect(isCancelFlow('cancel')).toBe(true);
    expect(isCancelFlow('Cancel')).toBe(false);
    expect(isCancelFlow('cancel_subscription')).toBe(false);
    expect(isCancelFlow('switch')).toBe(false);
    expect(isCancelFlow(undefined)).toBe(false);
    expect(isCancelFlow(null)).toBe(false);
    expect(isCancelFlow('')).toBe(false);
  });
});

describe('buildPortalSessionParams', () => {
  beforeEach(() => {
    delete process.env.STRIPE_PORTAL_CONFIGURATION_ID;
  });

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env.STRIPE_PORTAL_CONFIGURATION_ID;
    } else {
      process.env.STRIPE_PORTAL_CONFIGURATION_ID = ORIGINAL_ENV;
    }
  });

  it('returns minimal params when no optional config is present', () => {
    const params = buildPortalSessionParams({
      customer: 'cus_123',
      returnUrl: 'https://app.example.com/dashboard',
    });
    expect(params).toEqual({
      customer: 'cus_123',
      return_url: 'https://app.example.com/dashboard',
    });
    expect(params.configuration).toBeUndefined();
    expect(params.flow_data).toBeUndefined();
  });

  it('pins the configuration id from STRIPE_PORTAL_CONFIGURATION_ID', () => {
    process.env.STRIPE_PORTAL_CONFIGURATION_ID = 'bpc_live_abc';
    const params = buildPortalSessionParams({
      customer: 'cus_123',
      returnUrl: 'https://app.example.com/dashboard',
    });
    expect(params.configuration).toBe('bpc_live_abc');
  });

  it('prefers an explicit configurationId over the env var', () => {
    process.env.STRIPE_PORTAL_CONFIGURATION_ID = 'bpc_from_env';
    const params = buildPortalSessionParams({
      customer: 'cus_123',
      returnUrl: 'https://app.example.com/dashboard',
      configurationId: 'bpc_explicit',
    });
    expect(params.configuration).toBe('bpc_explicit');
  });

  it('treats a whitespace-only env var as absent', () => {
    process.env.STRIPE_PORTAL_CONFIGURATION_ID = '   ';
    const params = buildPortalSessionParams({
      customer: 'cus_123',
      returnUrl: 'https://app.example.com/dashboard',
    });
    expect(params.configuration).toBeUndefined();
  });

  it('trims a padded configuration id', () => {
    const params = buildPortalSessionParams({
      customer: 'cus_123',
      returnUrl: 'https://app.example.com/dashboard',
      configurationId: '  bpc_padded  ',
    });
    expect(params.configuration).toBe('bpc_padded');
  });

  it('adds the subscription_cancel flow when flow=cancel and a subscription id is present', () => {
    const params = buildPortalSessionParams({
      customer: 'cus_123',
      returnUrl: 'https://app.example.com/dashboard',
      flow: 'cancel',
      subscriptionId: 'sub_456',
    });
    expect(params.flow_data).toEqual({
      type: 'subscription_cancel',
      subscription_cancel: { subscription: 'sub_456' },
      after_completion: {
        type: 'redirect',
        redirect: { return_url: 'https://app.example.com/dashboard' },
      },
    });
  });

  it('omits the cancel flow when no subscription id is available', () => {
    const params = buildPortalSessionParams({
      customer: 'cus_123',
      returnUrl: 'https://app.example.com/dashboard',
      flow: 'cancel',
      subscriptionId: null,
    });
    expect(params.flow_data).toBeUndefined();
  });

  it('omits the cancel flow when subscription id is whitespace-only', () => {
    const params = buildPortalSessionParams({
      customer: 'cus_123',
      returnUrl: 'https://app.example.com/dashboard',
      flow: 'cancel',
      subscriptionId: '   ',
    });
    expect(params.flow_data).toBeUndefined();
  });

  it('ignores an unknown flow value even with a subscription id', () => {
    const params = buildPortalSessionParams({
      customer: 'cus_123',
      returnUrl: 'https://app.example.com/dashboard',
      flow: 'upgrade',
      subscriptionId: 'sub_456',
    });
    expect(params.flow_data).toBeUndefined();
  });

  it('combines configuration id and cancel flow together', () => {
    const params = buildPortalSessionParams({
      customer: 'cus_123',
      returnUrl: 'https://app.example.com/dashboard',
      flow: 'cancel',
      subscriptionId: 'sub_456',
      configurationId: 'bpc_combo',
    });
    expect(params.configuration).toBe('bpc_combo');
    expect(params.flow_data?.type).toBe('subscription_cancel');
  });
});
