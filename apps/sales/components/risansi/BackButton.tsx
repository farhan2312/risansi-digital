'use client';

import { useRouter } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function BackButton() {
  const router = useRouter();
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => router.back()}
      className="mb-4 text-[var(--fg-3)] hover:text-[var(--fg)]"
    >
      <ChevronLeft />
      Back
    </Button>
  );
}
