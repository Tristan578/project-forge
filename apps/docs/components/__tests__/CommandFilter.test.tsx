/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CommandFilter, type CommandFilters } from '../CommandFilter';

// @testing-library/jest-dom matchers are expected via workspace root
import '@testing-library/jest-dom';

const DEFAULT_CATEGORIES = ['transform', 'material', 'physics'];
const DEFAULT_SCOPES = ['create', 'set', 'query'];

describe('CommandFilter', () => {
  describe('filter logic branches', () => {
    it('initially shows totalCommands when no filters are active', () => {
      render(
        <CommandFilter
          categories={DEFAULT_CATEGORIES}
          scopes={DEFAULT_SCOPES}
          totalCommands={42}
        />,
      );
      expect(screen.getByText('Showing 42 commands')).toBeInTheDocument();
    });

    it('shows visibleCount when a category filter is active and visibleCount is provided', () => {
      render(
        <CommandFilter
          categories={DEFAULT_CATEGORIES}
          scopes={DEFAULT_SCOPES}
          totalCommands={42}
          visibleCount={7}
        />,
      );
      const checkbox = screen.getByRole('checkbox', { name: 'transform' });
      fireEvent.click(checkbox);
      expect(screen.getByText('Showing 7 commands')).toBeInTheDocument();
    });

    it('shows totalCommands when filters are active but visibleCount is undefined', () => {
      render(
        <CommandFilter
          categories={DEFAULT_CATEGORIES}
          scopes={DEFAULT_SCOPES}
          totalCommands={42}
          // visibleCount intentionally omitted
        />,
      );
      const checkbox = screen.getByRole('checkbox', { name: 'material' });
      fireEvent.click(checkbox);
      // Without visibleCount, fallback is totalCommands
      expect(screen.getByText('Showing 42 commands')).toBeInTheDocument();
    });

    it('uses singular "command" when count is 1', () => {
      render(
        <CommandFilter
          categories={DEFAULT_CATEGORIES}
          scopes={DEFAULT_SCOPES}
          totalCommands={1}
        />,
      );
      expect(screen.getByText('Showing 1 command')).toBeInTheDocument();
    });

    it('can toggle a category on and off', () => {
      const onFilterChange = vi.fn();
      render(
        <CommandFilter
          categories={DEFAULT_CATEGORIES}
          scopes={DEFAULT_SCOPES}
          totalCommands={10}
          onFilterChange={onFilterChange}
        />,
      );
      const checkbox = screen.getByRole('checkbox', { name: 'transform' });

      // Check
      fireEvent.click(checkbox);
      expect(onFilterChange).toHaveBeenLastCalledWith(
        expect.objectContaining<Partial<CommandFilters>>({
          categories: expect.any(Set),
        }),
      );
      const lastCallCategories: Set<string> = onFilterChange.mock.calls.at(-1)[0].categories;
      expect(lastCallCategories.has('transform')).toBe(true);

      // Uncheck
      fireEvent.click(checkbox);
      const uncheckedCategories: Set<string> = onFilterChange.mock.calls.at(-1)[0].categories;
      expect(uncheckedCategories.has('transform')).toBe(false);
    });

    it('shows "Clear filters" button only when at least one filter is active', () => {
      render(
        <CommandFilter
          categories={DEFAULT_CATEGORIES}
          scopes={DEFAULT_SCOPES}
          totalCommands={10}
        />,
      );
      expect(screen.queryByRole('button', { name: /clear all filters/i })).toBeNull();

      fireEvent.click(screen.getByRole('checkbox', { name: 'physics' }));
      expect(screen.getByRole('button', { name: /clear all filters/i })).toBeInTheDocument();
    });

    it('clear button removes all active filters', () => {
      const onFilterChange = vi.fn();
      render(
        <CommandFilter
          categories={DEFAULT_CATEGORIES}
          scopes={DEFAULT_SCOPES}
          totalCommands={10}
          onFilterChange={onFilterChange}
        />,
      );
      fireEvent.click(screen.getByRole('checkbox', { name: 'material' }));
      fireEvent.click(screen.getByRole('checkbox', { name: 'set' }));

      const clearBtn = screen.getByRole('button', { name: /clear all filters/i });
      fireEvent.click(clearBtn);

      const lastCall: CommandFilters = onFilterChange.mock.calls.at(-1)[0];
      expect(lastCall.categories.size).toBe(0);
      expect(lastCall.scopes.size).toBe(0);
    });
  });

  describe('zero-results state', () => {
    it('shows zero-results message when active filters yield 0 visible commands', () => {
      render(
        <CommandFilter
          categories={DEFAULT_CATEGORIES}
          scopes={DEFAULT_SCOPES}
          totalCommands={10}
          visibleCount={0}
        />,
      );
      fireEvent.click(screen.getByRole('checkbox', { name: 'transform' }));
      expect(screen.getByText(/no public commands match these filters/i)).toBeInTheDocument();
    });

    it('does not show zero-results message when no filter is active (initial empty state)', () => {
      render(
        <CommandFilter
          categories={DEFAULT_CATEGORIES}
          scopes={DEFAULT_SCOPES}
          totalCommands={0}
          visibleCount={0}
        />,
      );
      // No filter active → message must not appear
      expect(screen.queryByText(/no public commands match these filters/i)).toBeNull();
    });

    it('hides zero-results message after clearing filters', () => {
      render(
        <CommandFilter
          categories={DEFAULT_CATEGORIES}
          scopes={DEFAULT_SCOPES}
          totalCommands={10}
          visibleCount={0}
        />,
      );
      fireEvent.click(screen.getByRole('checkbox', { name: 'transform' }));
      expect(screen.getByText(/no public commands match these filters/i)).toBeInTheDocument();

      // Click the inline clear button inside the zero-results message
      const clearBtns = screen.getAllByRole('button', { name: /clear all filters/i });
      fireEvent.click(clearBtns[0]);
      expect(screen.queryByText(/no public commands match these filters/i)).toBeNull();
    });
  });

  describe('onFilterChange callback', () => {
    it('fires onFilterChange when a category checkbox is toggled', () => {
      const onFilterChange = vi.fn();
      render(
        <CommandFilter
          categories={DEFAULT_CATEGORIES}
          scopes={DEFAULT_SCOPES}
          totalCommands={10}
          onFilterChange={onFilterChange}
        />,
      );
      fireEvent.click(screen.getByRole('checkbox', { name: 'material' }));
      expect(onFilterChange).toHaveBeenCalledTimes(1);
      const [filters] = onFilterChange.mock.calls[0] as [CommandFilters];
      expect(filters.categories.has('material')).toBe(true);
      expect(filters.scopes.size).toBe(0);
    });

    it('fires onFilterChange when a scope checkbox is toggled', () => {
      const onFilterChange = vi.fn();
      render(
        <CommandFilter
          categories={DEFAULT_CATEGORIES}
          scopes={DEFAULT_SCOPES}
          totalCommands={10}
          onFilterChange={onFilterChange}
        />,
      );
      fireEvent.click(screen.getByRole('checkbox', { name: 'create' }));
      expect(onFilterChange).toHaveBeenCalledTimes(1);
      const [filters] = onFilterChange.mock.calls[0] as [CommandFilters];
      expect(filters.scopes.has('create')).toBe(true);
      expect(filters.categories.size).toBe(0);
    });

    it('does not throw when onFilterChange is omitted', () => {
      render(
        <CommandFilter
          categories={DEFAULT_CATEGORIES}
          scopes={DEFAULT_SCOPES}
          totalCommands={10}
          // onFilterChange intentionally omitted
        />,
      );
      expect(() => {
        fireEvent.click(screen.getByRole('checkbox', { name: 'physics' }));
      }).not.toThrow();
    });
  });

  describe('scopes hidden when empty', () => {
    it('renders the Scope group when scopes are provided', () => {
      render(
        <CommandFilter
          categories={DEFAULT_CATEGORIES}
          scopes={DEFAULT_SCOPES}
          totalCommands={10}
        />,
      );
      expect(screen.getByText('Scope')).toBeInTheDocument();
    });

    it('hides the Scope group entirely when scopes array is empty', () => {
      render(
        <CommandFilter categories={DEFAULT_CATEGORIES} scopes={[]} totalCommands={10} />,
      );
      expect(screen.queryByText('Scope')).toBeNull();
    });

    it('scope checkboxes are not rendered when scopes array is empty', () => {
      render(
        <CommandFilter categories={DEFAULT_CATEGORIES} scopes={[]} totalCommands={10} />,
      );
      // Only category checkboxes should be present
      const checkboxes = screen.getAllByRole('checkbox');
      expect(checkboxes).toHaveLength(DEFAULT_CATEGORIES.length);
    });
  });
});
