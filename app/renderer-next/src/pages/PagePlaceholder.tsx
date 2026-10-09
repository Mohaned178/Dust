import { EmptyState } from '../ui/EmptyState';
import { PageHeader } from '../ui/PageHeader';

/** Stands in for a screen until its phase of the rebuild lands. */
export function PagePlaceholder({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <>
      <PageHeader title={title} subtitle={subtitle} />
      <EmptyState title="This screen is being rebuilt" description="It will be here in a later update." />
    </>
  );
}
