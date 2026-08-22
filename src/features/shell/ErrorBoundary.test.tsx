import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ErrorBoundary } from './ErrorBoundary';

function Boom({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error('canvas exploded');
  }

  return <p>canvas content</p>;
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders children when nothing throws', () => {
    render(
      <ErrorBoundary label="The canvas">
        <Boom shouldThrow={false} />
      </ErrorBoundary>,
    );

    expect(screen.getByText('canvas content')).toBeDefined();
  });

  it('shows the failure instead of unmounting the whole app', () => {
    render(
      <ErrorBoundary label="The canvas">
        <Boom shouldThrow />
      </ErrorBoundary>,
    );

    expect(screen.getByRole('alert')).toBeDefined();
    expect(screen.getByText(/The canvas stopped responding/)).toBeDefined();
    expect(screen.getByText('canvas exploded')).toBeDefined();
  });

  it('recovers when the underlying problem is gone', () => {
    const onReset = vi.fn();
    const { rerender, container } = render(
      <ErrorBoundary label="The canvas" onReset={onReset}>
        <Boom shouldThrow />
      </ErrorBoundary>,
    );

    rerender(
      <ErrorBoundary label="The canvas" onReset={onReset}>
        <Boom shouldThrow={false} />
      </ErrorBoundary>,
    );

    const retry = within(container).getByRole('button', { name: 'Try again' });
    fireEvent.click(retry);

    expect(onReset).toHaveBeenCalledOnce();
    expect(within(container).getByText('canvas content')).toBeDefined();
  });
});
