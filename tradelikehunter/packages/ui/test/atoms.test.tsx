import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Badge, Button, Money, PnlText, Spinner, StatTile } from '../src/index';

afterEach(cleanup);

describe('Button', () => {
  it('renders children and fires onClick', () => {
    let clicks = 0;
    const { getByRole } = render(<Button onClick={() => (clicks += 1)}>Place Order</Button>);
    const btn = getByRole('button');
    expect(btn.textContent).toBe('Place Order');
    fireEvent.click(btn);
    expect(clicks).toBe(1);
  });

  it('does not fire onClick when disabled', () => {
    let clicks = 0;
    const { getByRole } = render(
      <Button disabled onClick={() => (clicks += 1)}>
        Disabled
      </Button>,
    );
    fireEvent.click(getByRole('button'));
    expect(clicks).toBe(0);
  });
});

describe('PnlText', () => {
  it('is green & signed for a profit', () => {
    const { container } = render(<PnlText value={4210} digits={0} />);
    const el = container.querySelector('.tlh-pnl');
    expect(el?.className).toContain('text-profit');
    expect(el?.textContent).toBe('+4,210');
  });

  it('is red for a loss', () => {
    const { container } = render(<PnlText value={-42.22} />);
    const el = container.querySelector('.tlh-pnl');
    expect(el?.className).toContain('text-loss');
    expect(el?.textContent).toBe('-42.22');
  });
});

describe('Money / StatTile / Badge / Spinner', () => {
  it('Money formats INR', () => {
    const { container } = render(<Money value={984220} digits={0} />);
    expect(container.textContent).toBe('₹9,84,220');
  });

  it('StatTile shows label and value', () => {
    const { getByText } = render(<StatTile label="Today P&L" value="+₹4,210" />);
    expect(getByText('Today P&L')).toBeTruthy();
    expect(getByText('+₹4,210')).toBeTruthy();
  });

  it('Badge carries its tone colour', () => {
    const { container } = render(<Badge tone="good">Healthy</Badge>);
    expect(container.querySelector('.tlh-badge')?.className).toContain('text-profit');
  });

  it('Spinner exposes a loading status role', () => {
    const { getByRole } = render(<Spinner />);
    expect(getByRole('status')).toBeTruthy();
  });
});
