import { useState, createContext, useContext, useCallback } from 'react';
import { AlertTriangle } from 'lucide-react';

const ConfirmContext = createContext(null);

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used within ConfirmProvider');
  return ctx;
}

export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null);

  const confirm = useCallback(({ title = 'Confirm', message, variant = 'danger' }) => {
    return new Promise((resolve) => {
      setState({ title, message, variant, resolve });
    });
  }, []);

  const handleConfirm = () => { state?.resolve(true); setState(null); };
  const handleCancel = () => { state?.resolve(false); setState(null); };

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      {state && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={handleCancel}>
          <div className="bg-surface-1 rounded-xl border border-border-subtle w-full max-w-sm mx-4 shadow-2xl p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                state.variant === 'danger' ? 'bg-error/10' : 'bg-warning/10'
              }`}>
                <AlertTriangle size={18} className={state.variant === 'danger' ? 'text-error' : 'text-warning'} />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-100">{state.title}</h3>
              </div>
            </div>
            <p className="text-xs text-gray-400 mb-6">{state.message}</p>
            <div className="flex items-center justify-end gap-3">
              <button onClick={handleCancel}
                className="px-4 py-2 text-xs font-medium text-gray-400 hover:text-gray-200 bg-surface-2 hover:bg-surface-2/80 rounded-lg transition-colors">
                Cancel
              </button>
              <button onClick={handleConfirm}
                className={`px-4 py-2 text-xs font-semibold text-white rounded-lg transition-colors ${
                  state.variant === 'danger' ? 'bg-error hover:bg-red-600' : 'bg-warning hover:bg-amber-600'
                }`}>
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
