'use client';

import { type ReactNode, useId, useState } from 'react';

type TabKey = 'overview' | 'trading' | 'activity' | 'relationship';

const tabs: Array<{ key: TabKey; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'trading', label: 'Trading' },
  { key: 'activity', label: 'Activity' },
  { key: 'relationship', label: 'Relationship & risk' },
];

export default function CustomerWorkspaceTabs({
  overview,
  trading,
  activity,
  relationship,
}: {
  overview: ReactNode;
  trading: ReactNode;
  activity: ReactNode;
  relationship: ReactNode;
}) {
  const [active, setActive] = useState<TabKey>('overview');
  const id = useId();
  const panels: Record<TabKey, ReactNode> = { overview, trading, activity, relationship };

  function moveFocus(currentIndex: number, direction: -1 | 1) {
    const nextIndex = (currentIndex + direction + tabs.length) % tabs.length;
    const nextTab = tabs[nextIndex];
    setActive(nextTab.key);
    requestAnimationFrame(() => document.getElementById(`${id}-${nextTab.key}-tab`)?.focus());
  }

  return (
    <section className="customer-360-workspace">
      <div className="customer-360-tabs" role="tablist" aria-label="Customer workspace sections">
        {tabs.map((tab, index) => (
          <button
            key={tab.key}
            id={`${id}-${tab.key}-tab`}
            type="button"
            role="tab"
            aria-selected={active === tab.key}
            aria-controls={`${id}-${tab.key}-panel`}
            tabIndex={active === tab.key ? 0 : -1}
            onClick={() => setActive(tab.key)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight') {
                event.preventDefault();
                moveFocus(index, 1);
              }
              if (event.key === 'ArrowLeft') {
                event.preventDefault();
                moveFocus(index, -1);
              }
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.key}
          id={`${id}-${tab.key}-panel`}
          role="tabpanel"
          aria-labelledby={`${id}-${tab.key}-tab`}
          className="customer-360-panel"
          hidden={active !== tab.key}
        >
          {panels[tab.key]}
        </div>
      ))}
    </section>
  );
}
