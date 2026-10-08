import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ResultsPage } from '../../renderer/src/pages/ResultsPage';
import { makeApi, makeResultsState } from './fakes';

function setup(overrides: Parameters<typeof makeApi>[0] = {}) {
  const getResults = vi.fn(async (root: string) => makeResultsState({ root }));
  const onRescan = vi.fn();
  const onBack = vi.fn();
  const api = makeApi({ getResults, ...overrides });
  render(
    <ResultsPage api={api} root={'C:\\'} onRescan={onRescan} onBack={onBack} onOpenDevCleanup={vi.fn()} />,
  );
  return { getResults, onRescan, onBack };
}

describe('ResultsPage', () => {
  it('shows the header, tabs with stable ids, and the clean-up panel first', async () => {
    const { onRescan, onBack } = setup();

    expect(screen.getByRole('heading', { name: /Results for C:/ })).toBeInTheDocument();
    const cleanTab = screen.getByRole('tab', { name: 'Clean up' });
    const mapTab = screen.getByRole('tab', { name: 'Space map' });
    expect(cleanTab).toHaveAttribute('aria-selected', 'true');
    expect(cleanTab).toHaveAttribute('id', 'results-tab-clean');
    expect(cleanTab).toHaveAttribute('aria-controls', 'results-panel-clean');
    expect(mapTab).toHaveAttribute('aria-selected', 'false');
    expect(mapTab).toHaveAttribute('id', 'results-tab-map');
    expect(await screen.findByRole('checkbox', { name: 'Select Temp' })).toBeInTheDocument();
    // The map is built on first open only.
    expect(document.getElementById('results-panel-map')).toBeNull();
    expect(screen.queryByText(/up to/i)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Rescan' }));
    expect(onRescan).toHaveBeenCalledWith('C:\\');
    fireEvent.click(screen.getByRole('button', { name: '← Home' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('keeps the selection when switching to the space map and back, with a single fetch', async () => {
    const { getResults } = setup();

    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select Temp' }));
    expect(screen.getByRole('status', { name: 'Selection' })).toHaveTextContent('1 selected');

    fireEvent.click(screen.getByRole('tab', { name: 'Space map' }));
    expect(screen.getByRole('tab', { name: 'Space map' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByRole('list', { name: 'Space map' })).toBeInTheDocument();
    expect(document.getElementById('results-panel-clean')).toHaveAttribute('hidden');
    expect(document.getElementById('results-panel-map')).not.toHaveAttribute('hidden');
    // The clean-up panel stays mounted but is hidden from the accessibility tree.
    expect(screen.queryByRole('checkbox', { name: 'Select Temp' })).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'Clean up' }));
    const checkbox = await screen.findByRole('checkbox', { name: 'Select Temp' });
    expect(checkbox).toBeChecked();
    expect(screen.getByRole('status', { name: 'Selection' })).toHaveTextContent('1 selected');
    expect(document.getElementById('results-panel-map')).toHaveAttribute('hidden');

    await waitFor(() => expect(getResults).toHaveBeenCalledTimes(1));
  });

  it('feeds the map from the same fetch and shows an alert there when it fails', async () => {
    const getResults = vi.fn(async () => {
      throw new Error('nope');
    });
    setup({ getResults });

    expect(await screen.findByText('Couldn\u2019t load results. Reload to try again.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Space map' }));
    expect(await screen.findByText(/Couldn.t load the space map/)).toBeInTheDocument();
    expect(getResults).toHaveBeenCalledTimes(1);
  });
});
