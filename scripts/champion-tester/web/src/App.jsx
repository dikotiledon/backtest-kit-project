import { useState } from 'react';
import Layout from './components/Layout.jsx';

export default function App() {
  const [tab, setTab] = useState('datasets');

  return (
    <Layout activeTab={tab} onTabChange={setTab}>
      {tab === 'datasets' && <p className="text-gray-400">DatasetPanel placeholder</p>}
      {tab === 'test' && <p className="text-gray-400">TestRunner placeholder</p>}
      {tab === 'results' && <p className="text-gray-400">ResultsTable placeholder</p>}
    </Layout>
  );
}
