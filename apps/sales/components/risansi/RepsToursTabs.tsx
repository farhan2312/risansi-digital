'use client';

import { type CSSProperties, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

interface TabDef { value: string; label: string; content: ReactNode; }

/**
 * URL-driven (?tab=) tab strip for the System Admin hub. Generic over any
 * number of tabs; the active tab persists in the query string.
 */
export function RepsToursTabs({ tabs, defaultValue }: { tabs: TabDef[]; defaultValue?: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fallback = defaultValue ?? tabs[0]?.value ?? '';
  const param = searchParams.get('tab');
  const currentTab = tabs.some(t => t.value === param) ? (param as string) : fallback;

  const handleTabChange = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', value);
    router.replace(`?${params.toString()}`, { scroll: false });
  };

  const pillStyle = (value: string): CSSProperties => ({
    fontSize: 13, fontWeight: 600, padding: '6px 16px', borderRadius: 16,
    border: 'none', cursor: 'pointer', fontFamily: 'inherit',
    background: currentTab === value ? 'var(--title)' : 'transparent',
    color: currentTab === value ? 'white' : 'var(--fg-3)', boxShadow: 'none',
  });

  return (
    <Tabs value={currentTab} onValueChange={handleTabChange} style={{ display: 'flex', flexDirection: 'column' }}>
      <TabsList style={{
        width: 'fit-content', marginBottom: 16, background: 'var(--bg-elev)',
        borderRadius: 20, padding: 3, border: 'none', boxShadow: 'none', flexWrap: 'wrap',
      }}>
        {tabs.map(t => (
          <TabsTrigger key={t.value} value={t.value} style={pillStyle(t.value)}>{t.label}</TabsTrigger>
        ))}
      </TabsList>
      {tabs.map(t => (
        <TabsContent key={t.value} value={t.value} style={{ marginTop: 0 }}>{t.content}</TabsContent>
      ))}
    </Tabs>
  );
}
