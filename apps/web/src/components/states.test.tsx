import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';

describe('the states every view has', () => {
  it('loading says so to a screen reader', () => {
    render(<LoadingState />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
  });

  it('empty says what will make data appear', () => {
    render(<EmptyState title="No projects yet">Create the first project.</EmptyState>);
    expect(screen.getByRole('heading', { name: 'No projects yet' })).toBeInTheDocument();
    expect(screen.getByText('Create the first project.')).toBeInTheDocument();
  });

  it('an error says what failed, why, and offers Retry', async () => {
    const retry = vi.fn();
    const error = new ApiError({
      status: 500,
      code: 'internal',
      message: 'Something went wrong on the server.',
      requestId: 'req-9',
    });
    render(<ErrorState what="The projects" error={error} onRetry={retry} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('The projects could not be loaded.');
    expect(alert).toHaveTextContent('Something went wrong on the server.');
    expect(alert).toHaveTextContent('Request req-9');
    // The id is in mono and its label is not.
    const id = within(alert).getByText('req-9');
    expect(id.tagName).toBe('CODE');
    expect(id).toHaveClass('font-mono');
    expect(id.parentElement).toHaveTextContent(/^Request req-9$/);
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('a 403 from the server is shown with its reason, and its rule only in the event log', () => {
    const error = new ApiError({
      status: 403,
      code: 'forbidden',
      message: 'This needs the role Owner or Admin.',
      rule: 'R7',
    });
    render(<ErrorState what="The members" error={error} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Your role cannot open this');
    expect(alert).toHaveTextContent('This needs the role Owner or Admin.');
    expect(alert).not.toHaveTextContent('R7');
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('loading rows take the shape of the list they stand for, when it is given', () => {
    const { container } = render(
      <LoadingRows rows={3} row={<span data-testid="shape">time actor sentence</span>} />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    expect(screen.getAllByTestId('shape')).toHaveLength(3);
    expect(container.querySelectorAll('[data-slot="loading-row"]')).toHaveLength(3);
  });
});
