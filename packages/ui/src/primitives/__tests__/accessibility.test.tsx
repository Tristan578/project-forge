import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { axe } from 'jest-axe';
import { THEME_NAMES, THEME_DEFINITIONS, type ThemeName } from '../../tokens';
import { Accordion } from '../Accordion';
import { Avatar } from '../Avatar';
import { Badge } from '../Badge';
import { Button } from '../Button';
import { Card } from '../Card';
import { Checkbox } from '../Checkbox';
import { Dialog } from '../Dialog';
import { Input } from '../Input';
import { Label } from '../Label';
import { Popover } from '../Popover';
import { Progress } from '../Progress';
import { ScrollArea } from '../ScrollArea';
import { Select } from '../Select';
import { Separator } from '../Separator';
import { Skeleton } from '../Skeleton';
import { Switch } from '../Switch';
import { Tabs } from '../Tabs';
import { Textarea } from '../Textarea';
import { Toast } from '../Toast';
import { Tooltip } from '../Tooltip';

/**
 * Applies a theme's CSS custom properties to the document root for testing.
 * This simulates the runtime theme application.
 */
function applyTheme(theme: ThemeName) {
  const tokens = THEME_DEFINITIONS[theme];
  document.documentElement.setAttribute('data-sf-theme', theme);
  for (const [key, value] of Object.entries(tokens)) {
    document.documentElement.style.setProperty(key, value);
  }
}

/**
 * Minimal renderings for each primitive that satisfy required props
 * and produce valid, accessible HTML.
 */
const PRIMITIVE_FIXTURES: Record<string, () => JSX.Element> = {
  Accordion: () => (
    <Accordion
      items={[
        { id: 'a1', title: 'Section 1', content: 'Content 1' },
        { id: 'a2', title: 'Section 2', content: 'Content 2' },
      ]}
    />
  ),
  Avatar: () => <Avatar alt="User avatar" fallback="TN" />,
  Badge: () => <Badge>Active</Badge>,
  Button: () => <Button>Click me</Button>,
  Card: () => <Card title="Card title">Card content</Card>,
  Checkbox: () => <Checkbox label="Accept terms" />,
  Dialog: () => (
    <Dialog open onClose={() => {}} title="Test dialog">
      Dialog content
    </Dialog>
  ),
  Input: () => <Input aria-label="Name" placeholder="Enter name" />,
  Label: () => <Label htmlFor="test-input">Name</Label>,
  Popover: () => (
    <Popover trigger={<button>Open</button>}>Popover content</Popover>
  ),
  Progress: () => <Progress value={50} aria-label="Upload progress" />,
  ScrollArea: () => (
    <ScrollArea height="100px">
      <p>Scrollable content</p>
    </ScrollArea>
  ),
  Select: () => (
    <Select
      aria-label="Color"
      options={[
        { value: 'red', label: 'Red' },
        { value: 'blue', label: 'Blue' },
      ]}
    />
  ),
  Separator: () => <Separator />,
  Skeleton: () => <Skeleton width="100px" height="20px" />,
  Switch: () => <Switch label="Dark mode" />,
  Tabs: () => (
    <Tabs
      tabs={[
        { id: 't1', label: 'Tab 1', content: 'Tab 1 content' },
        { id: 't2', label: 'Tab 2', content: 'Tab 2 content' },
      ]}
      activeTab="t1"
      onChange={() => {}}
    />
  ),
  Textarea: () => <Textarea aria-label="Message" placeholder="Type here" />,
  Toast: () => <Toast message="Success!" variant="success" onClose={() => {}} />,
  Tooltip: () => (
    <Tooltip content="Help text">
      <button>Hover me</button>
    </Tooltip>
  ),
};

const primitiveNames = Object.keys(PRIMITIVE_FIXTURES);

describe('Accessibility (axe-core)', () => {
  describe.each(THEME_NAMES)('Theme: %s', (theme) => {
    it.each(primitiveNames)('%s has no axe violations', async (name) => {
      applyTheme(theme);
      const Fixture = PRIMITIVE_FIXTURES[name];
      const { container } = render(<Fixture />);
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });
});
