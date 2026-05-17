const TABS = [
  { id: 'datasets', label: 'Datasets' },
  { id: 'test', label: 'Test' },
  { id: 'results', label: 'Results' },
];

export default function Layout({ activeTab, onTabChange, children }) {
  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <header className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">🏆 Champion Tester</h1>
      </header>
      <nav className="flex gap-1 mb-6 border-b border-gray-700">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => onTabChange(t.id)}
            className={`px-4 py-2 text-sm font-medium rounded-t transition-colors ${
              activeTab === t.id
                ? 'bg-gray-800 text-blue-400 border-b-2 border-blue-400'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <main>{children}</main>
    </div>
  );
}
