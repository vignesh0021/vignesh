import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { DashboardPage } from '../src/features/dashboard/DashboardPage';

afterEach(cleanup);

describe('DashboardPage', () => {
  it('renders engine-computed KPIs and sections', () => {
    const { getByText } = render(<DashboardPage />);
    expect(getByText('Dashboard')).toBeTruthy();
    expect(getByText('Portfolio Value')).toBeTruthy();
    expect(getByText('Portfolio Greeks')).toBeTruthy();
    expect(getByText('Payoff at expiry')).toBeTruthy();
    // Positions section lists the four demo-book legs.
    expect(getByText('Positions (4)')).toBeTruthy();
  });
});
