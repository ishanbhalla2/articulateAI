import { useState } from 'react';
import { createBrowserRouter, NavLink, Outlet, RouterProvider } from 'react-router';
import { Button, Sheet, SheetContent, SheetHeader, SheetTitle, useIsMobile } from '@databricks/appkit-ui/react';
import { Menu, Settings } from 'lucide-react';
import { ErrorBlock, LoadingBlock } from './components/States';
import { useApi, type Me } from './lib/api';
import { AdminPage } from './pages/AdminPage';
import { NewSessionPage } from './pages/NewSessionPage';
import { SessionFeedbackPage } from './pages/SessionFeedbackPage';
import { SessionsPage } from './pages/SessionsPage';
import { SettingsPage } from './pages/SettingsPage';

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
    isActive ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
  }`;

function NavLinks({ className, onClick }: { className?: string; onClick?: () => void }) {
  return (
    <nav className={className} aria-label="Main">
      <NavLink to="/" end className={linkClass} onClick={onClick}>
        New session
      </NavLink>
      <NavLink to="/sessions" className={linkClass} onClick={onClick}>
        My sessions
      </NavLink>
      <NavLink to="/admin" className={linkClass} onClick={onClick}>
        Admin
      </NavLink>
    </nav>
  );
}

function Layout() {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex items-center gap-4 border-b bg-card px-4 py-3 md:px-6">
        <h1 className="text-lg font-bold tracking-tight text-primary">Articulate</h1>
        <NavLinks className="hidden gap-1 md:flex" />
        <div className="ml-auto flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <NavLink to="/settings">
              <Settings className="h-4 w-4" /> Settings
            </NavLink>
          </Button>
          <div className="md:hidden">
            <Sheet open={open && isMobile} onOpenChange={setOpen}>
              <Button variant="ghost" size="icon" onClick={() => setOpen(true)}>
                <Menu className="h-5 w-5" />
                <span className="sr-only">Open navigation</span>
              </Button>
              <SheetContent side="left">
                <SheetHeader>
                  <SheetTitle>Articulate</SheetTitle>
                </SheetHeader>
                <NavLinks className="flex flex-col gap-1 px-4" onClick={() => setOpen(false)} />
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </header>
      <main className="flex-1 p-4 md:p-6">
        <Outlet />
      </main>
    </div>
  );
}

function AdminRoute() {
  const me = useApi<Me>('/api/me');
  if (me.loading && !me.data) return <LoadingBlock />;
  if (me.error || !me.data) return <ErrorBlock message={me.error ?? 'Could not check your access.'} onRetry={me.reload} />;
  return <AdminPage me={me.data} />;
}

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <NewSessionPage /> },
      { path: '/sessions', element: <SessionsPage /> },
      { path: '/sessions/:id', element: <SessionFeedbackPage /> },
      { path: '/sessions/:id/edit', element: <NewSessionPage /> },
      { path: '/admin', element: <AdminRoute /> },
      { path: '/settings', element: <SettingsPage /> },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
