import { useState, useEffect } from 'react';
import Layout from './components/Layout.jsx';
import DatasetPanel from './components/DatasetPanel.jsx';
import TestRunner from './components/TestRunner.jsx';
import ResultsTable from './components/ResultsTable.jsx';
import SweepPanel from './components/SweepPanel.jsx';
import CompareView from './components/CompareView.jsx';
import Dashboard from './components/Dashboard.jsx';
import TradingPanel from './components/TradingPanel.jsx';

export default function App() {
  const [tab, setTab] = useState('dashboard');

  return (
    <Layout activeTab={tab} onTabChange={setTab}>
      {tab === 'dashboard' && <Dashboard onNavigate={setTab} />}
      {tab === 'datasets' && <DatasetPanel />}
      {tab === 'test' && <TestRunner />}
      {tab === 'sweep' && <SweepPanel />}
      {tab === 'results' && <ResultsTable />}
      {tab === 'compare' && <CompareView />}
      {tab === 'trading' && <TradingPanel />}
    </Layout>
  );
}
