import { RouterProvider } from '@tanstack/react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { router } from './router.jsx';
import { queryClient } from './queryClient.js';
import { ToastProvider } from './components/ui/ToastProvider.jsx';
import { ConfirmProvider } from './components/ui/ConfirmDialog.jsx';

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <ConfirmProvider>
          <RouterProvider router={router} />
        </ConfirmProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
