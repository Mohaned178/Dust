import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '../../renderer/src/App';

describe('App shell', () => {
  it('renders the Dust shell', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Dust' })).toBeInTheDocument();
  });
});
