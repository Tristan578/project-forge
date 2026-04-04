import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CollapsibleSection } from '../CollapsibleSection';

describe('CollapsibleSection', () => {
  it('renders title and content when open', () => {
    render(
      <CollapsibleSection title="Transform">
        <p>Position inputs</p>
      </CollapsibleSection>
    );
    expect(screen.getByText('Transform')).not.toBeNull();
    expect(screen.getByText('Position inputs')).not.toBeNull();
  });

  it('starts collapsed when defaultOpen is false', () => {
    render(
      <CollapsibleSection title="Physics" defaultOpen={false}>
        <p>Physics content</p>
      </CollapsibleSection>
    );
    expect(screen.queryByText('Physics content')).toBeNull();
  });

  it('toggles on click', () => {
    render(
      <CollapsibleSection title="Material">
        <p>Material content</p>
      </CollapsibleSection>
    );
    expect(screen.getByText('Material content')).not.toBeNull();
    fireEvent.click(screen.getByText('Material'));
    expect(screen.queryByText('Material content')).toBeNull();
    fireEvent.click(screen.getByText('Material'));
    expect(screen.getByText('Material content')).not.toBeNull();
  });

  it('renders headerRight content', () => {
    render(
      <CollapsibleSection title="Lights" headerRight={<span>3 items</span>}>
        <p>Content</p>
      </CollapsibleSection>
    );
    expect(screen.getByText('3 items')).not.toBeNull();
  });

  it('has aria-expanded attribute', () => {
    render(
      <CollapsibleSection title="Audio">
        <p>Audio settings</p>
      </CollapsibleSection>
    );
    const btn = screen.getByRole('button', { name: /Audio/ });
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('false');
  });
});
