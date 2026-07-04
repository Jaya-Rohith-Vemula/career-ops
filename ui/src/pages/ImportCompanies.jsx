import { useState } from 'react';
import YcImport from './YcImport';
import Builtin from './Builtin';

const TABS = [
  { key: 'yc', label: 'YC Import', Component: YcImport },
  { key: 'builtin', label: 'Built In', Component: Builtin },
];

export default function ImportCompanies() {
  const [activeTab, setActiveTab] = useState('yc');
  const { Component } = TABS.find((t) => t.key === activeTab);

  return (
    <div>
      <div className="tabs">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={`tab${activeTab === tab.key ? ' active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <Component />
    </div>
  );
}
