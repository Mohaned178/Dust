import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { UpdateBanner } from '../../renderer/src/components/UpdateBanner';
import type { UpdateStatus } from '../../src/shared/ipc';
import { makeApi } from './fakes';

function renderBanner(status: UpdateStatus, overrides: Parameters<typeof makeApi>[0] = {}) {
  return render(
    <UpdateBanner
      api={makeApi({
        getUpdateStatus: async () => status,
        ...overrides,
      })}
    />,
  );
}

describe('UpdateBanner', () => {
  it('renders nothing while idle or up to date', () => {
    renderBanner({ phase: 'idle', version: null, percent: null, message: null });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows download progress', async () => {
    renderBanner({ phase: 'downloading', version: '1.2.0', percent: 42, message: null });
    expect(await screen.findByRole('status')).toHaveTextContent('Downloading update 1.2.0 — 42%');
  });

  it('offers a restart action once the update is downloaded', async () => {
    const installUpdate = vi.fn(async () => {});
    renderBanner({ phase: 'downloaded', version: '1.2.0', percent: 100, message: null }, { installUpdate });

    const button = await screen.findByRole('button', { name: 'Restart to update' });
    expect(screen.getByRole('status')).toHaveTextContent('Dust 1.2.0 is ready to install');
    fireEvent.click(button);
    expect(installUpdate).toHaveBeenCalledTimes(1);
  });

  it('can be dismissed', async () => {
    renderBanner({ phase: 'downloaded', version: '1.2.0', percent: 100, message: null });
    expect(await screen.findByRole('status')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss update notice' }));
    expect(screen.queryByRole('status')).toBeNull();
  });
});
