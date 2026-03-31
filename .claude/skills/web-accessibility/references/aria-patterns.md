# ARIA Patterns — SpawnForge Editor Components

## Tree View (Scene Hierarchy)

```html
<ul role="tree" aria-label="Scene hierarchy">
  <li role="treeitem" aria-expanded="true" aria-selected="false">
    <span>Root Node</span>
    <ul role="group">
      <li role="treeitem" aria-selected="true">Child Entity</li>
      <li role="treeitem" aria-expanded="false">
        <span>Group</span>
        <!-- collapsed children -->
      </li>
    </ul>
  </li>
</ul>
```

**Keyboard:** Arrow Up/Down to move, Arrow Right to expand, Arrow Left to collapse, Enter/Space to select, Home/End for first/last.

## Tab Panel (Inspector Tabs)

```html
<div role="tablist" aria-label="Inspector panels">
  <button role="tab" aria-selected="true" aria-controls="panel-transform" id="tab-transform">
    Transform
  </button>
  <button role="tab" aria-selected="false" aria-controls="panel-material" id="tab-material">
    Material
  </button>
</div>
<div role="tabpanel" id="panel-transform" aria-labelledby="tab-transform">
  <!-- Transform inspector content -->
</div>
```

**Keyboard:** Arrow Left/Right to switch tabs, Tab to enter panel content.

## Toolbar (Scene Toolbar)

```html
<div role="toolbar" aria-label="Scene tools" aria-orientation="horizontal">
  <button aria-label="Select tool" aria-pressed="true">
    <CursorIcon />
  </button>
  <button aria-label="Move tool" aria-pressed="false">
    <MoveIcon />
  </button>
  <div role="separator" aria-orientation="vertical"></div>
  <button aria-label="Play scene">
    <PlayIcon />
  </button>
</div>
```

**Keyboard:** Arrow Left/Right between buttons, Tab to leave toolbar.

## Dialog (Export, Settings)

```html
<div role="dialog" aria-modal="true" aria-labelledby="dialog-title" aria-describedby="dialog-desc">
  <h2 id="dialog-title">Export Game</h2>
  <p id="dialog-desc">Configure export settings for your game.</p>
  <!-- form content -->
  <button>Cancel</button>
  <button>Export</button>
</div>
```

**Focus:** Move to first focusable element on open, trap Tab within dialog, return focus to trigger on close.

## Alert Dialog (Destructive Confirmation)

```html
<div role="alertdialog" aria-modal="true" aria-labelledby="alert-title" aria-describedby="alert-desc">
  <h2 id="alert-title">Delete Entity</h2>
  <p id="alert-desc">This will permanently delete "Player" and all children. This cannot be undone.</p>
  <button>Cancel</button>
  <button autofocus>Delete</button>
</div>
```

**Focus:** Move to the least destructive action (Cancel) on open.

## Canvas (Non-Interactive Label)

```html
<canvas role="img" aria-label="3D scene viewport — use keyboard shortcuts to navigate">
</canvas>
```

The canvas is not directly accessible — provide a skip link and ensure all operations are available via inspector panels and keyboard shortcuts.

## Listbox (Dropdown Select)

```html
<div role="listbox" aria-label="Material preset" aria-activedescendant="option-metal">
  <div role="option" id="option-metal" aria-selected="true">Brushed Metal</div>
  <div role="option" id="option-wood" aria-selected="false">Oak Wood</div>
</div>
```

**Keyboard:** Arrow Up/Down to navigate, Enter to select, Escape to close.
