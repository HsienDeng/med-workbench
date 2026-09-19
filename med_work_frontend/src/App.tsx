import { useEffect, useMemo } from 'react';
import { ConfigProvider, App as AntApp } from 'antd';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import zhCN from 'antd/locale/zh_CN';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import { BasicLayout } from '@/layouts';
import { themeConfig } from '@/theme';
import { getPageFromPath, getPagePath, isPageKey } from '@/constants/menu';
import { useAppStore } from '@/stores/app';
import { useConversationStore } from '@/stores/conversations';
import Dashboard from '@/pages/Dashboard';
import Analysis from '@/pages/Analysis';
import Patients from '@/pages/Patients';
import Documents from '@/pages/Documents';
import WxGroups from '@/pages/WxGroups';
import Assistant from '@/pages/Assistant';
import Retrieval from '@/pages/Retrieval';
import AiProviderManagement from '@/pages/AiProviderManagement';
import Phase2Placeholder from '@/pages/Phase2Placeholder';
import Dictionaries from '@/pages/Dictionaries';
import Accounts from '@/pages/Accounts';
import Permissions from '@/pages/Permissions';
import Audit from '@/pages/Audit';
import Login from '@/pages/Login';
import type { PageKey } from '@/types';
import { getCurrentMenus, getCurrentUser, logoutApi } from '@/services/api';
import { setFeedbackListener } from '@/services/global-feedback';
import { setUnauthorizedHandler } from '@/services/auth-storage';

dayjs.locale('zh-cn');

const PHASE2_PAGES: PageKey[] = [
  'entities',
];

function FeedbackBridge() {
  const { message } = AntApp.useApp();

  useEffect(() => {
    setFeedbackListener((error) => message.error(error.message));
    return () => setFeedbackListener(null);
  }, [message]);

  return null;
}

export default function App() {
  const user = useAppStore((state) => state.user);
  const menus = useAppStore((state) => state.menus);
  const menusLoaded = useAppStore((state) => state.menusLoaded);
  const login = useAppStore((state) => state.login);
  const logout = useAppStore((state) => state.logout);
  const setMenus = useAppStore((state) => state.setMenus);
  const resetConversations = useConversationStore((state) => state.reset);
  const location = useLocation();
  const routerNavigate = useNavigate();
  const page = getPageFromPath(location.pathname) ?? 'dashboard';

  const allowedPages = useMemo(
    () => menus.flatMap((item) => item.routeKey && isPageKey(item.routeKey) ? [item.routeKey] : []),
    [menus],
  );
  const defaultPage = allowedPages.includes('dashboard') ? 'dashboard' : allowedPages[0] ?? 'dashboard';

  const navigate = (key: PageKey) => {
    routerNavigate(getPagePath(key));
    window.scrollTo(0, 0);
  };

  const newConversation = () => {
    routerNavigate('/assistant', { state: { newConversation: true } });
    window.scrollTo(0, 0);
  };

  const openConversation = (key: string) => {
    routerNavigate('/assistant', { state: { conversationKey: key } });
    window.scrollTo(0, 0);
  };

  useEffect(() => {
    setUnauthorizedHandler(() => {
      resetConversations();
      logout();
    });
    if (!user) return;
    void getCurrentUser().catch(() => undefined);
    void getCurrentMenus()
      .then(({ items }) => setMenus(items))
      .catch(() => setMenus([]));
  }, [logout, resetConversations, setMenus, user]);

  useEffect(() => {
    if (!user) {
      if (location.pathname !== '/login') routerNavigate('/login', { replace: true });
      return;
    }
    if (!menusLoaded) return;
    const requestedPage = getPageFromPath(location.pathname);
    if (!requestedPage || !allowedPages.includes(requestedPage)) {
      routerNavigate(getPagePath(defaultPage), { replace: true });
    }
  }, [allowedPages, defaultPage, location.pathname, menusLoaded, routerNavigate, user]);

  const handleLogin = (auth: Parameters<typeof login>[0]) => {
    resetConversations();
    login(auth);
    routerNavigate('/dashboard', { replace: true });
  };

  const handleLogout = async () => {
    await logoutApi().catch(() => undefined);
    resetConversations();
    logout();
    routerNavigate('/login', { replace: true });
  };

  return (
    <ConfigProvider locale={zhCN} theme={themeConfig}>
      <AntApp>
        <FeedbackBridge />
        {user ? (
          <BasicLayout
            page={page}
            onNavigate={navigate}
            onNewConversation={newConversation}
            onOpenConversation={openConversation}
            user={user}
            onLogout={handleLogout}
          >
            <Routes>
              <Route path="/dashboard" element={<Dashboard onNavigate={navigate} />} />
              <Route path="/analysis" element={<Analysis />} />
              <Route path="/patients" element={<Patients />} />
              <Route path="/documents" element={<Documents />} />
              <Route path="/wxGroups" element={<WxGroups />} />
              <Route path="/assistant" element={<Assistant />} />
              <Route path="/dictionaries" element={<Dictionaries />} />
              <Route path="/accounts" element={<Accounts />} />
              <Route path="/permissions" element={<Permissions />} />
              <Route path="/audit" element={<Audit />} />
              <Route path="/retrieval" element={<Retrieval />} />
              <Route path="/ai-connections" element={<AiProviderManagement />} />
              {PHASE2_PAGES.map((routePage) => (
                <Route
                  key={routePage}
                  path={getPagePath(routePage)}
                  element={<Phase2Placeholder page={routePage} onNavigate={navigate} />}
                />
              ))}
              <Route path="*" element={<Navigate to={getPagePath(defaultPage)} replace />} />
            </Routes>
          </BasicLayout>
        ) : (
          <Login onLogin={handleLogin} />
        )}
      </AntApp>
    </ConfigProvider>
  );
}
