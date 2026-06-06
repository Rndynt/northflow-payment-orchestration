"use client";

import { PageHeader } from "@/components/shared/page-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

export default function EventsPage() {
  return (
    <>
      <PageHeader
        title="Provider Events"
        description="Webhook audit log from payment providers"
      />
      <Card padding="lg">
        <EmptyState
          title="Provider Events"
          description="Provider events are stored in the database. Direct DB querying or a list endpoint will be needed to display them here. This page will be fully implemented in Phase 2."
          icon={
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
            </svg>
          }
        />
      </Card>
    </>
  );
}
