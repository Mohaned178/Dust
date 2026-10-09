import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from '../../../renderer-next/src/ui/Button';
import { Checkbox } from '../../../renderer-next/src/ui/Checkbox';
import type { CheckedState } from '../../../renderer-next/src/ui/Checkbox';
import { IconButton } from '../../../renderer-next/src/ui/IconButton';
import { SegmentedControl } from '../../../renderer-next/src/ui/SegmentedControl';
import { Switch } from '../../../renderer-next/src/ui/Switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../../renderer-next/src/ui/Tabs';

describe('Button', () => {
  it('fires on click and on Enter and Space', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Scan again</Button>);
    await user.click(screen.getByRole('button', { name: 'Scan again' }));
    screen.getByRole('button').focus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(onClick).toHaveBeenCalledTimes(3);
  });

  it('blocks clicks and reports busy while loading, keeping its label', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Scanning
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Scanning' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('IconButton', () => {
  it('uses its label as the accessible name and shows it as a tooltip on focus', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <IconButton label="Copy path" onClick={onClick}>
        <svg />
      </IconButton>,
    );
    const button = screen.getByRole('button', { name: 'Copy path' });
    await user.tab();
    expect(button).toHaveFocus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Copy path');
    await user.keyboard('{Enter}');
    expect(onClick).toHaveBeenCalledOnce();
  });
});

function CheckboxHarness({ initial }: { initial: CheckedState }) {
  const [state, setState] = useState<CheckedState>(initial);
  return <Checkbox label="Temporary files" checked={state} onCheckedChange={setState} />;
}

describe('Checkbox', () => {
  it('toggles with Space and exposes checked state', async () => {
    const user = userEvent.setup();
    render(<CheckboxHarness initial={false} />);
    const box = screen.getByRole('checkbox', { name: 'Temporary files' });
    expect(box).toHaveAttribute('aria-checked', 'false');
    await user.tab();
    await user.keyboard(' ');
    expect(box).toHaveAttribute('aria-checked', 'true');
    await user.keyboard(' ');
    expect(box).toHaveAttribute('aria-checked', 'false');
  });

  it('shows the mixed state to assistive tech and resolves it to checked', async () => {
    const user = userEvent.setup();
    render(<CheckboxHarness initial="indeterminate" />);
    const box = screen.getByRole('checkbox');
    expect(box).toHaveAttribute('aria-checked', 'mixed');
    await user.click(box);
    expect(box).toHaveAttribute('aria-checked', 'true');
  });

  it('can be named with aria-label alone, and ignores clicks when disabled', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(<Checkbox aria-label="Select all" checked={false} disabled onCheckedChange={onCheckedChange} />);
    await user.click(screen.getByRole('checkbox', { name: 'Select all' }));
    expect(onCheckedChange).not.toHaveBeenCalled();
  });
});

describe('Switch', () => {
  it('is a labelled switch that toggles with Space', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(<Switch label="Start Spotify with Windows" checked={false} onCheckedChange={onCheckedChange} />);
    const toggle = screen.getByRole('switch', { name: 'Start Spotify with Windows' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    await user.tab();
    await user.keyboard(' ');
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it('does nothing when disabled', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(<Switch label="Locked" checked disabled onCheckedChange={onCheckedChange} />);
    await user.click(screen.getByRole('switch'));
    expect(onCheckedChange).not.toHaveBeenCalled();
  });
});

describe('SegmentedControl', () => {
  const options = [
    { value: 'all', label: 'All' },
    { value: 'on', label: 'On' },
    { value: 'off', label: 'Off' },
  ] as const;

  it('is a labelled radio group that moves with the arrow keys', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SegmentedControl label="Show startup apps" options={options} value="all" onChange={onChange} />);
    expect(screen.getByRole('radiogroup', { name: 'Show startup apps' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'All' })).toHaveAttribute('aria-checked', 'true');
    await user.tab();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'On' })).toHaveFocus();
    await user.keyboard(' ');
    expect(onChange).toHaveBeenCalledWith('on');
  });

  it('keeps one option selected when the current one is pressed again', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SegmentedControl label="Filter" options={options} value="all" onChange={onChange} />);
    await user.click(screen.getByRole('radio', { name: 'All' }));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('Tabs', () => {
  it('switches panels with the arrow keys', async () => {
    const user = userEvent.setup();
    render(
      <Tabs defaultValue="folders">
        <TabsList aria-label="Explore disk views">
          <TabsTrigger value="folders">Folders</TabsTrigger>
          <TabsTrigger value="map">Map</TabsTrigger>
        </TabsList>
        <TabsContent value="folders">Folder tree</TabsContent>
        <TabsContent value="map">Treemap</TabsContent>
      </Tabs>,
    );
    expect(screen.getByRole('tab', { name: 'Folders' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Folder tree');
    await user.tab();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Map' })).toHaveFocus();
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Treemap');
  });
});
