import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CategoryStrip } from '../../renderer/src/components/CategoryStrip';
import { makeCategories } from './fakes';

describe('CategoryStrip', () => {
  it('renders five categories in fixed order with zero rows disabled', () => {
    render(<CategoryStrip categories={makeCategories()} active={null} onSelect={vi.fn()} />);

    const strip = screen.getByRole('region', { name: 'Reclaimable by category' });
    expect(strip).toBeInTheDocument();
    for (const label of ['Temp', 'Recycle Bin', 'npm cache', 'App caches', 'npm projects']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText('256 KB')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Recycle Bin/ })).toBeDisabled();
    expect(screen.getAllByText(/nothing to clean/)).toHaveLength(4);
  });

  it('selects and clears the active category', () => {
    const onSelect = vi.fn();
    const { rerender } = render(<CategoryStrip categories={makeCategories()} active={null} onSelect={onSelect} />);

    fireEvent.click(screen.getByRole('button', { name: /Temp/ }));
    expect(onSelect).toHaveBeenCalledWith('temp');

    rerender(<CategoryStrip categories={makeCategories()} active="temp" onSelect={onSelect} />);
    expect(screen.getByRole('button', { name: /Temp/ })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: /Temp/ }));
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });
});
