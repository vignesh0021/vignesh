import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { AppShell } from './app/AppShell';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { ComingInMilestone } from './features/shared/ComingInMilestone';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element #root not found');

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/markets" element={<ComingInMilestone name="Markets & Option Chain" milestone="M1" />} />
          <Route path="/trade" element={<ComingInMilestone name="Trade" milestone="M1" />} />
          <Route path="/portfolio" element={<ComingInMilestone name="Portfolio & Positions" milestone="M1" />} />
          <Route path="/learn" element={<ComingInMilestone name="Learning Center" milestone="M7" />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
