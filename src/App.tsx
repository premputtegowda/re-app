import { useState } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { Layout } from './components/Layout/Layout';
import { Dashboard } from './components/Dashboard/Dashboard';
import { ChatLikeEntry } from './components/HoursEntry/ChatLikeEntry';
import { HoursList } from './components/HoursList/HoursList';
import { Settings } from './components/Settings/Settings';
import { ToastContainer } from './components/UI/Toast';
import type { ViewMode } from './types';

function AppContent() {
  const [currentView, setCurrentView] = useState<ViewMode>('dashboard');
  const { toasts, removeToast } = useApp();

  const renderView = () => {
    switch (currentView) {
      case 'dashboard':
        return <Dashboard onViewChange={setCurrentView} />;
      case 'entry':
        return <ChatLikeEntry />;
      case 'list':
        return <HoursList />;
      case 'settings':
        return <Settings />;
      default:
        return <Dashboard onViewChange={setCurrentView} />;
    }
  };

  return (
    <>
      <Layout currentView={currentView} onViewChange={setCurrentView}>
        {renderView()}
      </Layout>
      <ToastContainer toasts={toasts} onClose={removeToast} />
    </>
  );
}

function App() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
}

export default App;
