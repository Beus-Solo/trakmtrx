import { useState, useEffect } from 'react';
import Header from './Header';
import MonthlyChecklist from './MonthlyChecklist';
import ShareModal from './ShareModal';
import { useBudgetData } from '../hooks/useBudgetData';
import { useBudgetOwner } from '../hooks/useBudgetOwner';
import { useHiddenCategories } from '../hooks/useHiddenCategories';

const VIEW_MODE_KEY = 'trakmtrx-view-mode';

export default function Dashboard() {
  const { ownerId, canEdit, loading: ownerLoading, viewers, inviteViewer, revokeViewer } = useBudgetOwner();
  const {
    transactions,
    loading,
    addTransaction,
    deleteTransaction,
    toggleChecked,
    updateTransaction
  } = useBudgetData(ownerId, canEdit);
  const { hiddenCategories, hideCategory } = useHiddenCategories(ownerId);
  const [showSettings, setShowSettings] = useState(false);

  // A device-local toggle letting the owner browse in a locked-down "View mode" without
  // touching their actual sharing permissions. Persisted so it survives a reload/relaunch.
  const [viewMode, setViewMode] = useState(() => {
    try {
      return localStorage.getItem(VIEW_MODE_KEY) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_MODE_KEY, viewMode ? '1' : '0');
    } catch {
      // localStorage unavailable (private browsing, etc.) — the toggle just won't persist.
    }
  }, [viewMode]);

  const effectiveCanEdit = canEdit && !viewMode;

  if (loading || ownerLoading) {
    return (
      <div className="flex min-h-screen flex-col bg-zinc-100">
        <Header
          onOpenSettings={() => setShowSettings(true)}
          viewMode={viewMode}
          canToggleViewMode={canEdit}
          onToggleViewMode={() => setViewMode(v => !v)}
        />
        <main className="flex flex-1 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-slate-900"></div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-100">
      <Header
        onOpenSettings={() => setShowSettings(true)}
        viewMode={viewMode}
        canToggleViewMode={canEdit}
        onToggleViewMode={() => setViewMode(v => !v)}
      />
      <main className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 lg:px-8">
        <MonthlyChecklist
          transactions={transactions}
          onAdd={addTransaction}
          onDelete={deleteTransaction}
          onToggleChecked={toggleChecked}
          onUpdate={updateTransaction}
          canEdit={effectiveCanEdit}
          hiddenCategories={hiddenCategories}
          onHideCategory={hideCategory}
        />
      </main>
      {showSettings && (
        <ShareModal
          onClose={() => setShowSettings(false)}
          canEdit={canEdit}
          viewers={viewers}
          inviteViewer={inviteViewer}
          revokeViewer={revokeViewer}
          viewMode={viewMode}
          onChangeViewMode={setViewMode}
        />
      )}
    </div>
  );
}
