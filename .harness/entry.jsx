import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import JobWorkspacePanel from '@/components/jobs/JobWorkspacePanel';
createRoot(document.getElementById('root')).render(
  <MemoryRouter><div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}><JobWorkspacePanel jobId="j1" /></div></MemoryRouter>
);
