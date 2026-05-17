import { useState } from 'react';
import Layout from './components/Layout.jsx';
import DatasetPanel from './components/DatasetPanel.jsx';
import TestRunner from './components/TestRunner.jsx';
import ResultsTable from './components/ResultsTable.jsx';
import SweepPanel from './components/SweepPanel.jsx';

export default function App() {
  const [tab, setTab] = useState('datasets');

  return (
    <Layout activeTab={tab} onTabChange={setTab}>
      {tab === 'datasets' && <DatasetPanel />}
      {tab === 'test' && <TestRunner />}
      {tab === 'sweep' && <SweepPanel />}
      {tab === 'results' && <ResultsTable />}
    </Layout>
  );
}
