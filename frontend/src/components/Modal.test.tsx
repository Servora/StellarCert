import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import Modal from './Modal';

describe('Modal', () => {
  it('exposes dialog semantics, closes on Escape, and restores focus', async () => {
    const user = userEvent.setup();
    const onClosed = vi.fn();

    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open dialog
          </button>
          <Modal
            isOpen={open}
            onClose={() => {
              onClosed();
              setOpen(false);
            }}
            labelledBy="modal-title"
          >
            <h2 id="modal-title">Accessible dialog</h2>
            <button type="button">First action</button>
            <button type="button">Last action</button>
          </Modal>
        </>
      );
    }

    render(<Harness />);

    const trigger = screen.getByRole('button', { name: 'Open dialog' });
    await user.click(trigger);

    const dialog = screen.getByRole('dialog', { name: 'Accessible dialog' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('button', { name: 'First action' })).toHaveFocus();

    await user.keyboard('{Escape}');

    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('traps Tab focus inside the dialog', async () => {
    const user = userEvent.setup();

    render(
      <Modal isOpen onClose={vi.fn()} labelledBy="focus-title">
        <h2 id="focus-title">Focus trap</h2>
        <button type="button">First</button>
        <button type="button">Last</button>
      </Modal>,
    );

    const first = screen.getByRole('button', { name: 'First' });
    const last = screen.getByRole('button', { name: 'Last' });

    expect(first).toHaveFocus();

    await user.tab({ shift: true });
    expect(last).toHaveFocus();

    await user.tab();
    expect(first).toHaveFocus();
  });
});
