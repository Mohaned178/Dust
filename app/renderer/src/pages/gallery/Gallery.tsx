import { useState } from 'react';
import type { ReactNode } from 'react';
import { GradePill, Badge, Tag } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Card, CardHeader, Section } from '../../ui/Card';
import { Checkbox } from '../../ui/Checkbox';
import type { CheckedState } from '../../ui/Checkbox';
import { ConfirmDialog, Dialog } from '../../ui/Dialog';
import { FileSize, Kbd, RelativeTime, Stat } from '../../ui/Display';
import { EmptyState, ErrorState } from '../../ui/EmptyState';
import { IconButton } from '../../ui/IconButton';
import { CopyIcon, DeleteIcon, FolderIcon, OpenIcon, RefreshIcon } from '../../ui/icons';
import { Notice } from '../../ui/Notice';
import { PageHeader } from '../../ui/PageHeader';
import { ProgressBar } from '../../ui/ProgressBar';
import { Ring } from '../../ui/Ring';
import { SearchBox } from '../../ui/SearchBox';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { Skeleton } from '../../ui/Skeleton';
import { Switch } from '../../ui/Switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../ui/Tabs';
import { ToastHost, useToast } from '../../ui/Toast';
import { UsageBar } from '../../ui/UsageBar';
import { VirtualList } from '../../ui/VirtualList';

const GB = 1024 ** 3;

const ROWS = Array.from({ length: 5000 }, (_, index) => ({
  id: `row-${index}`,
  name: `C:\\Users\\Example\\Cache\\item-${index}`,
  bytes: (5000 - index) * 1024 * 37,
}));

function renderRow(row: (typeof ROWS)[number]): ReactNode {
  return (
    <div className="flex h-full items-center gap-3 border-b border-border px-4 text-body">
      <FolderIcon className="size-5 shrink-0 text-ink-3" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate font-mono text-caption">{row.name}</span>
      <FileSize bytes={row.bytes} className="text-ink-2" />
    </div>
  );
}

function Demo({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader title={title} />
      <div className="flex flex-wrap items-center gap-3 px-4 pb-4">{children}</div>
    </Card>
  );
}

/** Dev-only (#gallery). Every component in every state: the visual review surface. */
export function Gallery() {
  const toast = useToast();
  const [checks, setChecks] = useState<CheckedState[]>([true, false, 'indeterminate']);
  const [on, setOn] = useState(true);
  const [segment, setSegment] = useState<'all' | 'on' | 'off'>('all');
  const [dialog, setDialog] = useState<'plain' | 'confirm' | 'danger' | null>(null);
  const [query, setQuery] = useState('');

  return (
    <div className="h-full overflow-y-auto bg-canvas">
      <div className="mx-auto flex max-w-[1040px] flex-col gap-6 px-8 py-6">
        <PageHeader title="Gallery" subtitle="Every component in every state. Development only." />

        <Section title="Buttons">
          <Demo title="Variants">
            <Button variant="primary">Choose what to clean</Button>
            <Button variant="secondary">Scan again</Button>
            <Button variant="subtle">Keep</Button>
            <Button variant="danger">Delete 4.2 GB</Button>
          </Demo>
          <Demo title="Sizes, icon, loading, disabled">
            <Button size="lg" variant="primary">
              Review and clean
            </Button>
            <Button icon={<RefreshIcon className="size-4" aria-hidden="true" />}>Scan again</Button>
            <Button variant="primary" loading>
              Scanning
            </Button>
            <Button disabled>Unavailable</Button>
          </Demo>
          <Demo title="Icon buttons (hover or focus for the tooltip)">
            <IconButton label="Copy path">
              <CopyIcon className="size-5" aria-hidden="true" />
            </IconButton>
            <IconButton label="Show in Explorer">
              <OpenIcon className="size-5" aria-hidden="true" />
            </IconButton>
            <IconButton label="Delete" disabled>
              <DeleteIcon className="size-5" aria-hidden="true" />
            </IconButton>
          </Demo>
        </Section>

        <Section title="Selection">
          <Demo title="Checkbox (checked, unchecked, mixed, disabled)">
            {checks.map((state, index) => (
              <Checkbox
                key={index}
                label={['Temporary files', 'Browser caches', 'Some selected'][index]}
                checked={state}
                onCheckedChange={(next) =>
                  setChecks((current) => current.map((value, i) => (i === index ? next : value)))
                }
              />
            ))}
            <Checkbox label="Protected" checked={false} disabled onCheckedChange={() => {}} />
          </Demo>
          <Demo title="Switch">
            <Switch label="Start Spotify with Windows" checked={on} onCheckedChange={setOn} />
            <Switch label="Locked entry" checked disabled onCheckedChange={() => {}} />
          </Demo>
          <Demo title="Segmented control">
            <SegmentedControl
              label="Show startup apps"
              value={segment}
              onChange={setSegment}
              options={[
                { value: 'all', label: 'All' },
                { value: 'on', label: 'On' },
                { value: 'off', label: 'Off' },
              ]}
            />
          </Demo>
          <Card className="px-4 pb-4">
            <Tabs defaultValue="folders">
              <TabsList aria-label="Explore disk views">
                <TabsTrigger value="folders">Folders</TabsTrigger>
                <TabsTrigger value="map">Map</TabsTrigger>
              </TabsList>
              <TabsContent value="folders">A lazy folder tree goes here.</TabsContent>
              <TabsContent value="map">A treemap goes here.</TabsContent>
            </Tabs>
          </Card>
        </Section>

        <Section title="Search">
          <Demo title="Search box (300 ms debounce, Ctrl+F, Esc clears)">
            <SearchBox label="Search apps" placeholder="Search apps" onSearch={setQuery} />
            <span className="text-caption text-ink-2">Settled query: “{query}”</span>
          </Demo>
        </Section>

        <Section title="Progress and usage">
          <Demo title="Progress bar">
            <div className="flex w-full flex-col gap-3">
              <ProgressBar label="Scanning" value={0.45} />
              <ProgressBar label="Scanning" />
            </div>
          </Demo>
          <Demo title="Usage bar with legend (segments are buttons)">
            <UsageBar
              className="w-full"
              label="Space used on C:\"
              totalBytes={237 * GB}
              segments={[
                { id: 'apps', label: 'Apps', bytes: 80 * GB, onSelect: () => toast({ title: 'Opened Apps' }) },
                { id: 'temp', label: 'Temp', bytes: 1.9 * GB, onSelect: () => toast({ title: 'Opened Temp' }) },
                { id: 'browser', label: 'Browser', bytes: 1.1 * GB },
                { id: 'bin', label: 'Recycle Bin', bytes: 0.8 * GB },
                { id: 'other', label: 'Everything else', bytes: 103 * GB },
              ]}
            />
          </Demo>
          <Demo title="Ring">
            <Ring value={0.61} label="Memory in use, 61%">
              <span className="text-subtitle font-semibold">61%</span>
            </Ring>
            <Ring value={0.12} size={72} strokeWidth={6} label="CPU in use, 12%">
              <span className="text-body font-semibold">12%</span>
            </Ring>
            <Ring value={1} size={56} strokeWidth={5} label="Full" />
          </Demo>
        </Section>

        <Section title="Keys">
          <Demo title="Keyboard hints">
            <span className="text-body">
              Search with <Kbd>Ctrl</Kbd> + <Kbd>F</Kbd>, clear with <Kbd>Esc</Kbd>
            </span>
          </Demo>
        </Section>

        <Section title="Labels">
          <Demo title="Grade pills, badge, tag, stat, time">
            <GradePill grade="safe" />
            <GradePill grade="review" />
            <GradePill grade="protected" />
            <Badge>9 apps</Badge>
            <Badge tone="accent">New</Badge>
            <Tag>Registry</Tag>
            <Tag onRemove={() => {}} removeLabel="Remove filter">
              Chrome
            </Tag>
            <dl className="flex gap-6">
              <Stat label="Can be freed">4.2 GB</Stat>
              <Stat label="Last checked">
                <RelativeTime ms={Date.now() - 2 * 24 * 3_600_000} />
              </Stat>
            </dl>
          </Demo>
        </Section>

        <Section title="Feedback">
          <Notice action={<Button variant="subtle">Scan again</Button>}>This list is from 2 days ago.</Notice>
          <Notice variant="warning">Scan cancelled. Showing what was found.</Notice>
          <Demo title="Toast (5 s, pauses on hover, Undo)">
            <Button
              onClick={() =>
                toast({
                  title: 'Startup entry turned off',
                  description: 'Spotify will not start with Windows.',
                  action: { label: 'Undo', onAction: () => toast({ title: 'Turned back on' }) },
                })
              }
            >
              Show toast
            </Button>
          </Demo>
          <Demo title="Dialogs">
            <Button onClick={() => setDialog('plain')}>Open dialog</Button>
            <Button onClick={() => setDialog('confirm')}>Confirm dialog</Button>
            <Button variant="danger" onClick={() => setDialog('danger')}>
              Delete dialog
            </Button>
          </Demo>
        </Section>

        <Section title="States">
          <Card>
            <EmptyState
              icon={<FolderIcon aria-hidden="true" />}
              title="Nothing to clean right now"
              description="C:\ is in good shape. Scan again later to check."
              action={<Button>Scan again</Button>}
            />
          </Card>
          <Card>
            <ErrorState
              description="Dust couldn't read the list of installed apps."
              onRetry={() => toast({ title: 'Trying again' })}
            />
          </Card>
          <Card className="flex flex-col gap-2 p-4">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </Card>
        </Section>

        <Section title="Virtual list (5,000 rows)">
          <Card className="h-80 overflow-hidden">
            <VirtualList
              label="Example files"
              items={ROWS}
              rowHeight={40}
              getKey={(row) => row.id}
              renderRow={renderRow}
            />
          </Card>
        </Section>
      </div>

      <Dialog
        open={dialog === 'plain'}
        onOpenChange={(open) => !open && setDialog(null)}
        title="Uninstall Spotify"
        description="Dust will run Spotify's own uninstaller first, then look for leftovers."
        footer={
          <Button variant="primary" onClick={() => setDialog(null)}>
            Continue
          </Button>
        }
      >
        <p className="text-body">You choose what to remove before anything is deleted.</p>
      </Dialog>
      <ConfirmDialog
        open={dialog === 'confirm'}
        onOpenChange={(open) => !open && setDialog(null)}
        title="Clean 3 categories?"
        description="Everything selected is safe and comes back when needed."
        confirmLabel="Clean 8.2 GB"
        onConfirm={() => setDialog(null)}
      />
      <ConfirmDialog
        open={dialog === 'danger'}
        onOpenChange={(open) => !open && setDialog(null)}
        title="Delete 4.2 GB?"
        description="These files cannot be recovered."
        confirmLabel="Delete 4.2 GB"
        destructive
        onConfirm={() => setDialog(null)}
      >
        <Checkbox label="I understand these items cannot be recovered" checked={false} onCheckedChange={() => {}} />
      </ConfirmDialog>
      <ToastHost />
    </div>
  );
}
