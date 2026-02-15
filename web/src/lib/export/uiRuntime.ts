/**
 * Standalone UI runtime for exported games.
 * Vanilla JS implementation - NO React dependency.
 * Renders UI screens as DOM elements, evaluates bindings, handles interactions.
 */

export function generateUIRuntimeCode(uiData: string): string {
  return `
(function() {
  const uiData = ${uiData};
  if (!uiData || !uiData.screens) return;

  const uiRoot = document.getElementById('forge-ui-root');
  if (!uiRoot) return;

  const screenElements = new Map();
  const widgetElements = new Map();
  const screenVisibility = new Map();

  // Template interpolation
  function interpolate(template, state) {
    if (typeof template !== 'string') return template;
    return template.replace(/\\{\\{([^}]+)\\}\\}/g, function(_match, key) {
      return state[key] !== undefined ? state[key] : '';
    });
  }

  // Create screen container
  function createScreen(screen) {
    const screenDiv = document.createElement('div');
    screenDiv.id = 'ui-screen-' + screen.id;
    screenDiv.style.position = 'absolute';
    screenDiv.style.top = '0';
    screenDiv.style.left = '0';
    screenDiv.style.width = '100%';
    screenDiv.style.height = '100%';
    screenDiv.style.zIndex = String(screen.zIndex || 0);
    screenDiv.style.backgroundColor = screen.backgroundColor || 'transparent';
    screenDiv.style.display = screen.visible ? 'block' : 'none';
    screenDiv.style.pointerEvents = screen.blockInput ? 'all' : 'none';

    screenElements.set(screen.id, screenDiv);
    screenVisibility.set(screen.id, screen.visible);

    // Create widgets
    for (const widget of screen.widgets) {
      const widgetEl = createWidget(widget, screen.id);
      if (widgetEl) {
        screenDiv.appendChild(widgetEl);
      }
    }

    uiRoot.appendChild(screenDiv);

    // Auto-show on start
    if (screen.showOnStart) {
      screenVisibility.set(screen.id, true);
      screenDiv.style.display = 'block';
    }

    return screenDiv;
  }

  // Create widget element
  function createWidget(widget, screenId) {
    const el = document.createElement('div');
    el.id = 'ui-widget-' + screenId + '-' + widget.id;
    el.style.position = 'absolute';

    // Position
    applyPosition(el, widget);

    // Style
    applyStyle(el, widget.style);

    // Type-specific rendering
    if (widget.type === 'text') {
      el.textContent = widget.config.content || '';
    } else if (widget.type === 'button') {
      el.textContent = widget.config.label || 'Button';
      el.style.cursor = 'pointer';
      el.style.pointerEvents = 'all';
      el.onclick = function() {
        handleButtonAction(widget.config.action);
      };
    } else if (widget.type === 'progress_bar') {
      // Simple progress bar
      const track = document.createElement('div');
      track.style.width = '100%';
      track.style.height = '100%';
      track.style.backgroundColor = widget.config.trackColor || '#333';
      const fill = document.createElement('div');
      fill.style.height = '100%';
      fill.style.backgroundColor = widget.config.fillColor || '#0f0';
      fill.style.width = '0%';
      fill.dataset.valueBinding = widget.config.valueBinding?.stateKey || '';
      track.appendChild(fill);
      el.appendChild(track);
    }

    widgetElements.set(screenId + ':' + widget.id, el);
    return el;
  }

  function applyPosition(el, widget) {
    const anchor = widget.anchor || 'top_left';
    el.style.width = widget.width + '%';
    el.style.height = widget.height + '%';

    if (anchor === 'top_left') {
      el.style.left = widget.x + '%';
      el.style.top = widget.y + '%';
    } else if (anchor === 'center') {
      el.style.left = widget.x + '%';
      el.style.top = widget.y + '%';
      el.style.transform = 'translate(-50%, -50%)';
    } else if (anchor === 'top_right') {
      el.style.right = (100 - widget.x) + '%';
      el.style.top = widget.y + '%';
    }
  }

  function applyStyle(el, style) {
    if (!style) return;
    if (style.backgroundColor) el.style.backgroundColor = style.backgroundColor;
    if (style.borderWidth) el.style.border = style.borderWidth + 'px solid ' + (style.borderColor || '#000');
    if (style.borderRadius) el.style.borderRadius = style.borderRadius + 'px';
    if (style.padding) {
      const p = style.padding;
      el.style.padding = p[0] + 'px ' + p[1] + 'px ' + p[2] + 'px ' + p[3] + 'px';
    }
    if (style.opacity !== undefined) el.style.opacity = String(style.opacity);
    if (style.overflow) el.style.overflow = style.overflow;
    if (style.fontFamily) el.style.fontFamily = style.fontFamily;
    if (style.fontSize) el.style.fontSize = style.fontSize + 'px';
    if (style.fontWeight) el.style.fontWeight = style.fontWeight;
    if (style.color) el.style.color = style.color;
    if (style.textAlign) el.style.textAlign = style.textAlign;
  }

  function handleButtonAction(action) {
    if (!action) return;
    if (action.type === 'show_screen') {
      showScreen(action.screenId);
    } else if (action.type === 'hide_screen') {
      hideScreen(action.screenId);
    } else if (action.type === 'toggle_screen') {
      toggleScreen(action.screenId);
    } else if (action.type === 'set_state' && window.forge) {
      window.forge.state.set(action.key, action.value);
    } else if (action.type === 'call_function' && window.forge) {
      const fn = window.forge.state.get('__ui_callback_' + action.functionName);
      if (typeof fn === 'function') fn();
    } else if (action.type === 'scene_reset' && window.forge) {
      window.forge.scene.reset();
    }
  }

  function showScreen(screenId) {
    const el = screenElements.get(screenId);
    if (el) {
      el.style.display = 'block';
      screenVisibility.set(screenId, true);
    }
  }

  function hideScreen(screenId) {
    const el = screenElements.get(screenId);
    if (el) {
      el.style.display = 'none';
      screenVisibility.set(screenId, false);
    }
  }

  function toggleScreen(screenId) {
    const visible = screenVisibility.get(screenId);
    if (visible) {
      hideScreen(screenId);
    } else {
      showScreen(screenId);
    }
  }

  // Update loop - evaluate bindings from forge.state
  function updateBindings() {
    if (!window.forge || !window.forge.state) return;

    const state = window.forge.state;

    // Update progress bars
    for (const [key, el] of widgetElements.entries()) {
      const fill = el.querySelector('[data-value-binding]');
      if (fill && fill.dataset.valueBinding) {
        const value = state.get(fill.dataset.valueBinding);
        if (typeof value === 'number') {
          fill.style.width = Math.max(0, Math.min(100, value)) + '%';
        }
      }
    }

    requestAnimationFrame(updateBindings);
  }

  // Initialize all screens
  for (const screen of uiData.screens) {
    createScreen(screen);
  }

  // Start binding update loop
  requestAnimationFrame(updateBindings);

  // Expose API for script calls
  if (window.forge && window.forge.ui) {
    const origShowScreen = window.forge.ui.showScreen;
    window.forge.ui.showScreen = function(nameOrId) {
      if (origShowScreen) origShowScreen(nameOrId);
      showScreen(nameOrId);
    };

    const origHideScreen = window.forge.ui.hideScreen;
    window.forge.ui.hideScreen = function(nameOrId) {
      if (origHideScreen) origHideScreen(nameOrId);
      hideScreen(nameOrId);
    };

    const origToggleScreen = window.forge.ui.toggleScreen;
    window.forge.ui.toggleScreen = function(nameOrId) {
      if (origToggleScreen) origToggleScreen(nameOrId);
      toggleScreen(nameOrId);
    };

    window.forge.ui.hideAllScreens = function() {
      for (const screenId of screenElements.keys()) {
        hideScreen(screenId);
      }
    };
  }
})();
  `.trim();
}
