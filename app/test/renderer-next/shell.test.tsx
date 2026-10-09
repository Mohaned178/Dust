import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '../../renderer-next/src/app/App';

describe('renderer-next shell', () => {
  it('renders the Dust heading', () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1, name: 'Dust' })).toBeInTheDocument();
  });
});
