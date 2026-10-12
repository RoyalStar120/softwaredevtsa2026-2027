import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useSession } from './state/session.tsx';
import { AppShell } from './components/Layout.tsx';
import { PageLoading } from './components/ui.tsx';
import { Landing } from './pages/Landing.tsx';
import { AuthPage } from './pages/Auth.tsx';

const LearnerHome = lazy(() => import('./pages/LearnerHome.tsx'));
const Practice = lazy(() => import('./pages/Practice.tsx'));
const Progress = lazy(() => import('./pages/Progress.tsx'));
const ScenarioPlayer = lazy(() => import('./pages/ScenarioPlayer.tsx'));
const Debrief = lazy(() => import('./pages/Debrief.tsx'));
const InstructorHome = lazy(() => import('./pages/InstructorHome.tsx'));
const ClassDetail = lazy(() => import('./pages/ClassDetail.tsx'));
const StudentDetail = lazy(() => import('./pages/StudentDetail.tsx'));
const About = lazy(() => import('./pages/About.tsx'));

function RequireAuth({ children, role }: { children: ReactNode; role?: 'learner' | 'instructor' }) {
  const { user, loading } = useSession();
  const loc = useLocation();
  if (loading) return <PageLoading />;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  if (role && user.role !== role) return <Navigate to={user.role === 'instructor' ? '/instructor' : '/home'} replace />;
  return <>{children}</>;
}

function Shell({ children, role }: { children: ReactNode; role?: 'learner' | 'instructor' }) {
  return (
    <RequireAuth role={role}>
      <AppShell>
        <Suspense fallback={<PageLoading />}>{children}</Suspense>
      </AppShell>
    </RequireAuth>
  );
}

function HomeRedirect() {
  const { user, loading } = useSession();
  if (loading) return <PageLoading />;
  if (!user) return <Landing />;
  return <Navigate to={user.role === 'instructor' ? '/instructor' : '/home'} replace />;
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<HomeRedirect />} />
      <Route path="/welcome" element={<Landing />} />
      <Route path="/login" element={<AuthPage mode="login" />} />
      <Route path="/register" element={<AuthPage mode="register" />} />
      <Route path="/home" element={<Shell role="learner"><LearnerHome /></Shell>} />
      <Route path="/practice" element={<Shell><Practice /></Shell>} />
      <Route path="/progress" element={<Shell role="learner"><Progress /></Shell>} />
      <Route path="/about" element={<Shell><About /></Shell>} />
      <Route
        path="/play/:id"
        element={
          <RequireAuth>
            <Suspense fallback={<PageLoading />}>
              <ScenarioPlayer />
            </Suspense>
          </RequireAuth>
        }
      />
      <Route path="/debrief/:id" element={<Shell><Debrief /></Shell>} />
      <Route path="/instructor" element={<Shell role="instructor"><InstructorHome /></Shell>} />
      <Route path="/instructor/classes/:id" element={<Shell role="instructor"><ClassDetail /></Shell>} />
      <Route path="/instructor/students/:id" element={<Shell role="instructor"><StudentDetail /></Shell>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
