import { Wallet, Settings, Eye } from 'lucide-react';

interface Props {
  onOpenSettings: () => void;
  viewMode?: boolean;
  canToggleViewMode?: boolean;
  onToggleViewMode?: () => void;
}

export default function Header({ onOpenSettings, viewMode, canToggleViewMode, onToggleViewMode }: Props) {
  return (
    <header className="px-4 pt-6 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-3xl items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-white shadow-sm">
            <Wallet className="h-4.5 w-4.5" />
          </div>
          <span className="text-lg font-semibold tracking-tight text-slate-900">TRAKMTRX</span>
          {canToggleViewMode && (
            <button
              onClick={onToggleViewMode}
              aria-pressed={viewMode}
              aria-label={viewMode ? 'Turn off View mode' : 'Turn on View mode'}
              title={viewMode ? 'View mode is on — tap to switch back to editing' : 'Tap to browse in View mode'}
              className={`flex h-6 w-6 items-center justify-center rounded-full ${
                viewMode ? 'bg-slate-900/10 text-slate-700' : 'text-slate-400 hover:bg-slate-900/5 hover:text-slate-600'
              }`}
            >
              <Eye className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <button
          onClick={onOpenSettings}
          aria-label="Account settings"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white/70 text-slate-500 hover:bg-white hover:text-slate-800"
        >
          <Settings className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}
