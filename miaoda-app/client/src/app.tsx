import React from 'react';
import { Route, Routes, Navigate } from 'react-router-dom';
import { useAuth, ROLE_SUBJECT } from '@lark-apaas/client-toolkit/auth';

import Layout from './components/Layout';
import NotFound from './pages/NotFound/NotFound';
import Unauthorized from './pages/Unauthorized/Unauthorized';
import DashboardPage from './pages/Dashboard/DashboardPage';
import DocumentManagePage from './pages/DocumentManage/DocumentManagePage';
import CategoryManagePage from './pages/CategoryManage/CategoryManagePage';
import FeishuSyncPage from './pages/FeishuSync/FeishuSyncPage';
import PublishCenterPage from './pages/PublishCenter/PublishCenterPage';
import SystemConfigPage from './pages/SystemConfig/SystemConfigPage';

const ProtectedRoute: React.FC<{ children: React.ReactNode; requiredRoles: string[] }> = ({ children, requiredRoles }) => {
  const { ability, isLoading } = useAuth();
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">加载中...</p>
      </div>
    );
  }
  const hasPermission = requiredRoles.some((role: string) => ability.can(role, ROLE_SUBJECT));
  return hasPermission ? <>{children}</> : <Navigate to="/unauthorized" replace />;
};

const RoutesComponent = () => {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<DashboardPage />} />
        <Route path="documents" element={<DocumentManagePage />} />
        <Route
          path="categories"
          element={
            <ProtectedRoute requiredRoles={['super_admin', 'publish_admin']}>
              <CategoryManagePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="import/feishu"
          element={
            <ProtectedRoute requiredRoles={['super_admin', 'publish_admin']}>
              <FeishuSyncPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="publish-center"
          element={
            <ProtectedRoute requiredRoles={['super_admin', 'publish_admin', 'content_editor']}>
              <PublishCenterPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="system-config"
          element={
            <ProtectedRoute requiredRoles={['super_admin', 'publish_admin']}>
              <SystemConfigPage />
            </ProtectedRoute>
          }
        />
        <Route path="unauthorized" element={<Unauthorized />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
};

export default RoutesComponent;
