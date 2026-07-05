import { describe, expect, it } from 'vitest';

import { fmtNum, formatINR, formatSigned } from '../src/format';

describe('formatINR', () => {
  it('uses Indian grouping and the ₹ symbol', () => {
    expect(formatINR(984220, 0)).toBe('₹9,84,220');
    expect(formatINR(1000000, 0)).toBe('₹10,00,000');
    expect(formatINR(-4210, 0)).toBe('-₹4,210');
  });
});

describe('formatSigned', () => {
  it('prefixes an explicit sign', () => {
    expect(formatSigned(100, 2)).toBe('+100.00');
    expect(formatSigned(-50, 2)).toBe('-50.00');
    expect(formatSigned(0, 0)).toBe('+0');
  });
});

describe('fmtNum', () => {
  it('handles non-finite gracefully', () => {
    expect(fmtNum(Number.POSITIVE_INFINITY)).toBe('—');
    expect(fmtNum(12.5, 2)).toBe('12.50');
  });
});
