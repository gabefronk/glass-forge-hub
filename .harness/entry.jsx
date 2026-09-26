import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Layout from '@/components/Layout';
import Dashboard from '@/pages/Dashboard';
import CalendarPage from '@/pages/CalendarPage';
import JobBudgets from '@/pages/JobBudgets';
import PurchaseOrders from '@/pages/PurchaseOrders';
import BrandsSpecs from '@/pages/BrandsSpecs';
import Summit from '@/pages/Summit';
import Todos from '@/pages/Todos';
import ContactsDirectory from '@/pages/ContactsDirectory';
import WindowQuotes from '@/pages/WindowQuotes';
import Invoicing from '@/pages/Invoicing';
import JobsHub from '@/pages/JobsHub';
const path = new URLSearchParams(location.search).get('p') || '/dashboard';
createRoot(document.getElementById('root')).render(
  <QueryClientProvider client={new QueryClient()}>
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/job-budgets" element={<JobBudgets />} />
          <Route path="/purchase-orders" element={<PurchaseOrders />} />
          <Route path="/brands-specs" element={<BrandsSpecs />} />
          <Route path="/summit" element={<Summit />} />
          <Route path="/todos" element={<Todos />} />
          <Route path="/contacts" element={<ContactsDirectory />} />
          <Route path="/window-quotes" element={<WindowQuotes />} />
          <Route path="/" element={<Invoicing />} />
          <Route path="/jobs" element={<JobsHub />} />
        </Route>
      </Routes>
    </MemoryRouter>
  </QueryClientProvider>
);
