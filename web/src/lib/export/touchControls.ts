/**
 * Mobile Touch Controls for Exported Games
 * Generates inline HTML/CSS/JS for virtual joysticks and buttons
 */

export interface VirtualJoystickConfig {
  position: 'bottom-left' | 'bottom-right';
  size: number; // pixels (default 120)
  deadZone: number; // 0-1 (default 0.15)
  opacity: number; // 0-1 (default 0.6)
  mode: 'fixed' | 'floating'; // fixed: always visible, floating: appears on touch
  actions: {
    horizontal: string; // input action name e.g. 'move_right'
    vertical: string | null; // input action name e.g. 'move_forward', null for horizontal-only
  };
}

export interface VirtualButtonConfig {
  id: string;
  action: string; // existing input action name (e.g., 'jump')
  position: { x: number; y: number }; // percent-based (0-100)
  size: number; // pixels (default 60)
  icon: string; // icon label text (e.g. '↑', '⊕', '↻')
  label?: string;
  opacity: number; // 0-1 (default 0.6)
}

export interface MobileTouchConfig {
  enabled: boolean;
  autoDetect: boolean;
  preset: string; // 'platformer' | 'fps' | 'topdown' | 'racing' | 'puzzle' | 'custom'
  joystick: VirtualJoystickConfig | null;
  lookJoystick?: VirtualJoystickConfig | null;
  buttons: VirtualButtonConfig[];
  preferredOrientation: 'any' | 'landscape' | 'portrait';
  autoReduceQuality: boolean;
}

/**
 * Get default touch preset based on input preset name
 */
export function getDefaultTouchPreset(inputPreset: string): MobileTouchConfig {
  const baseConfig = {
    enabled: true,
    autoDetect: true,
    preferredOrientation: 'any' as const,
    autoReduceQuality: true,
  };

  switch (inputPreset.toLowerCase()) {
    case 'fps':
      return {
        ...baseConfig,
        preset: 'fps',
        joystick: {
          position: 'bottom-left',
          size: 100,
          deadZone: 0.15,
          opacity: 0.6,
          mode: 'fixed',
          actions: { horizontal: 'move_right', vertical: 'move_forward' },
        },
        lookJoystick: {
          position: 'bottom-right',
          size: 100,
          deadZone: 0.15,
          opacity: 0.6,
          mode: 'fixed',
          actions: { horizontal: 'look_right', vertical: 'look_up' },
        },
        buttons: [
          {
            id: 'shoot',
            action: 'shoot',
            position: { x: 50, y: 70 },
            size: 70,
            icon: '⊕',
            opacity: 0.6,
          },
        ],
      };

    case 'topdown':
      return {
        ...baseConfig,
        preset: 'topdown',
        joystick: {
          position: 'bottom-left',
          size: 110,
          deadZone: 0.15,
          opacity: 0.6,
          mode: 'floating',
          actions: { horizontal: 'move_right', vertical: 'move_forward' },
        },
        buttons: [
          {
            id: 'interact',
            action: 'interact',
            position: { x: 85, y: 75 },
            size: 70,
            icon: '✋',
            opacity: 0.6,
          },
        ],
      };

    case 'racing':
      return {
        ...baseConfig,
        preset: 'racing',
        joystick: {
          position: 'bottom-left',
          size: 100,
          deadZone: 0.15,
          opacity: 0.6,
          mode: 'fixed',
          actions: { horizontal: 'steer', vertical: null },
        },
        buttons: [
          {
            id: 'gas',
            action: 'gas',
            position: { x: 85, y: 80 },
            size: 70,
            icon: '▲',
            opacity: 0.6,
          },
          {
            id: 'brake',
            action: 'brake',
            position: { x: 85, y: 60 },
            size: 60,
            icon: '▼',
            opacity: 0.6,
          },
        ],
      };

    case 'puzzle':
      return {
        ...baseConfig,
        preset: 'puzzle',
        joystick: null,
        buttons: [
          {
            id: 'interact',
            action: 'interact',
            position: { x: 50, y: 85 },
            size: 60,
            icon: '✋',
            opacity: 0.6,
          },
        ],
      };

    case 'platformer':
    default:
      return {
        ...baseConfig,
        preset: 'platformer',
        joystick: {
          position: 'bottom-left',
          size: 120,
          deadZone: 0.15,
          opacity: 0.6,
          mode: 'floating',
          actions: { horizontal: 'move_right', vertical: 'move_forward' },
        },
        buttons: [
          {
            id: 'jump',
            action: 'jump',
            position: { x: 85, y: 75 },
            size: 80,
            icon: '↑',
            opacity: 0.6,
          },
        ],
      };
  }
}

/**
 * Generate CSS for touch controls
 */
export function generateTouchCSS(): string {
  return `
.forge-touch-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 1000;
  touch-action: none;
}

.forge-joystick {
  position: absolute;
  pointer-events: auto;
  touch-action: none;
}

.forge-joystick-outer {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.3);
  background: rgba(0, 0, 0, 0.15);
}

.forge-joystick-knob {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 40%;
  height: 40%;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.5);
  transition: none;
}

.forge-button {
  position: absolute;
  pointer-events: auto;
  touch-action: none;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.3);
  background: rgba(0, 0, 0, 0.2);
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.7);
  font-size: 20px;
  user-select: none;
  -webkit-user-select: none;
  transition: transform 0.1s;
}

.forge-button.pressed {
  transform: scale(0.9);
  background: rgba(255, 255, 255, 0.15);
}

.forge-button-label {
  position: absolute;
  bottom: -16px;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.5);
  white-space: nowrap;
}
`.trim();
}

/**
 * Generate JavaScript for touch controls
 */
export function generateTouchJS(config: MobileTouchConfig): string {
  return `
(function() {
  'use strict';

  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
                   ('ontouchstart' in window) ||
                   (navigator.maxTouchPoints > 0);

  const config = ${JSON.stringify(config)};

  // Early exit if touch controls disabled
  if (!config.enabled || (!config.autoDetect && !isMobile)) {
    return;
  }

  // Initialize global touch input state
  window.__forgeTouchInput = {
    pressed: {},
    justPressed: {},
    justReleased: {},
    axes: {},
  };

  window.__forgeTouchFlush = function() {
    window.__forgeTouchInput.justPressed = {};
    window.__forgeTouchInput.justReleased = {};
  };

  // Create overlay
  const overlay = document.getElementById('forge-touch-overlay');
  if (!overlay) return;

  // Joystick state
  const joysticks = [];

  function createJoystick(joyConfig, containerId) {
    const container = document.createElement('div');
    container.className = 'forge-joystick';
    container.id = containerId;
    container.style.width = joyConfig.size + 'px';
    container.style.height = joyConfig.size + 'px';
    container.style.opacity = joyConfig.opacity;

    // Position
    if (joyConfig.position === 'bottom-left') {
      container.style.bottom = 'max(20px, calc(env(safe-area-inset-bottom) + 10px))';
      container.style.left = '20px';
    } else {
      container.style.bottom = 'max(20px, calc(env(safe-area-inset-bottom) + 10px))';
      container.style.right = '20px';
    }

    if (joyConfig.mode === 'floating') {
      container.style.display = 'none';
    }

    const outer = document.createElement('div');
    outer.className = 'forge-joystick-outer';

    const knob = document.createElement('div');
    knob.className = 'forge-joystick-knob';

    outer.appendChild(knob);
    container.appendChild(outer);
    overlay.appendChild(container);

    const state = {
      touchId: null,
      centerX: 0,
      centerY: 0,
      deltaX: 0,
      deltaY: 0,
      radius: joyConfig.size / 2,
      config: joyConfig,
    };

    const updateKnob = () => {
      const offsetX = (state.deltaX / state.radius) * (state.radius * 0.6);
      const offsetY = (state.deltaY / state.radius) * (state.radius * 0.6);
      knob.style.transform = \`translate(calc(-50% + \${offsetX}px), calc(-50% + \${offsetY}px))\`;
    };

    const updateAxes = () => {
      let normalizedX = state.deltaX / state.radius;
      let normalizedY = -state.deltaY / state.radius; // Invert Y for game coords

      // Apply dead zone
      const magnitude = Math.sqrt(normalizedX * normalizedX + normalizedY * normalizedY);
      if (magnitude < joyConfig.deadZone) {
        normalizedX = 0;
        normalizedY = 0;
      } else {
        // Scale from deadzone to 1.0
        const scale = (magnitude - joyConfig.deadZone) / (1.0 - joyConfig.deadZone);
        normalizedX = (normalizedX / magnitude) * scale;
        normalizedY = (normalizedY / magnitude) * scale;
      }

      window.__forgeTouchInput.axes[joyConfig.actions.horizontal] = normalizedX;
      if (joyConfig.actions.vertical) {
        window.__forgeTouchInput.axes[joyConfig.actions.vertical] = normalizedY;
      }
    };

    container.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (state.touchId !== null) return;

      const touch = e.changedTouches[0];
      state.touchId = touch.identifier;

      if (joyConfig.mode === 'floating') {
        container.style.display = 'block';
        container.style.left = (touch.clientX - state.radius) + 'px';
        container.style.top = (touch.clientY - state.radius) + 'px';
        container.style.bottom = 'auto';
        container.style.right = 'auto';
      }

      const rect = container.getBoundingClientRect();
      state.centerX = rect.left + rect.width / 2;
      state.centerY = rect.top + rect.height / 2;
    }, { passive: false });

    container.addEventListener('touchmove', (e) => {
      e.preventDefault();
      const touch = Array.from(e.changedTouches).find(t => t.identifier === state.touchId);
      if (!touch) return;

      let dx = touch.clientX - state.centerX;
      let dy = touch.clientY - state.centerY;

      // Clamp to radius
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > state.radius) {
        dx = (dx / dist) * state.radius;
        dy = (dy / dist) * state.radius;
      }

      state.deltaX = dx;
      state.deltaY = dy;
      updateKnob();
      updateAxes();
    }, { passive: false });

    const resetJoystick = () => {
      state.touchId = null;
      state.deltaX = 0;
      state.deltaY = 0;
      updateKnob();
      updateAxes();

      if (joyConfig.mode === 'floating') {
        container.style.display = 'none';
      }
    };

    container.addEventListener('touchend', (e) => {
      const touch = Array.from(e.changedTouches).find(t => t.identifier === state.touchId);
      if (!touch) return;
      resetJoystick();
    }, { passive: false });

    container.addEventListener('touchcancel', (e) => {
      const touch = Array.from(e.changedTouches).find(t => t.identifier === state.touchId);
      if (!touch) return;
      resetJoystick();
    }, { passive: false });

    joysticks.push(state);
  }

  // Create joysticks
  if (config.joystick) {
    createJoystick(config.joystick, 'forge-joystick-main');
  }
  if (config.lookJoystick) {
    createJoystick(config.lookJoystick, 'forge-joystick-look');
  }

  // Create buttons
  config.buttons.forEach((btnConfig) => {
    const btn = document.createElement('div');
    btn.className = 'forge-button';
    btn.id = 'forge-btn-' + btnConfig.id;
    btn.style.left = btnConfig.position.x + '%';
    btn.style.top = btnConfig.position.y + '%';
    btn.style.width = btnConfig.size + 'px';
    btn.style.height = btnConfig.size + 'px';
    btn.style.opacity = btnConfig.opacity;
    btn.style.transform = 'translate(-50%, -50%)';
    btn.textContent = btnConfig.icon;

    if (btnConfig.label) {
      const label = document.createElement('div');
      label.className = 'forge-button-label';
      label.textContent = btnConfig.label;
      btn.appendChild(label);
    }

    let touchId = null;

    btn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (touchId !== null) return;

      touchId = e.changedTouches[0].identifier;
      btn.classList.add('pressed');
      window.__forgeTouchInput.pressed[btnConfig.action] = true;
      window.__forgeTouchInput.justPressed[btnConfig.action] = true;

      if (navigator.vibrate) {
        navigator.vibrate(10);
      }
    }, { passive: false });

    btn.addEventListener('touchend', (e) => {
      const touch = Array.from(e.changedTouches).find(t => t.identifier === touchId);
      if (!touch) return;

      touchId = null;
      btn.classList.remove('pressed');
      window.__forgeTouchInput.pressed[btnConfig.action] = false;
      window.__forgeTouchInput.justReleased[btnConfig.action] = true;
    }, { passive: false });

    btn.addEventListener('touchcancel', (e) => {
      const touch = Array.from(e.changedTouches).find(t => t.identifier === touchId);
      if (!touch) return;

      touchId = null;
      btn.classList.remove('pressed');
      window.__forgeTouchInput.pressed[btnConfig.action] = false;
      window.__forgeTouchInput.justReleased[btnConfig.action] = true;
    }, { passive: false });

    overlay.appendChild(btn);
  });

  // Orientation hint
  if (config.preferredOrientation !== 'any') {
    window.addEventListener('orientationchange', () => {
      const isLandscape = window.innerWidth > window.innerHeight;
      if (config.preferredOrientation === 'landscape' && !isLandscape) {
        console.log('Please rotate your device to landscape mode for the best experience.');
      } else if (config.preferredOrientation === 'portrait' && isLandscape) {
        console.log('Please rotate your device to portrait mode for the best experience.');
      }
    });
  }

  // Auto reduce quality on mobile
  if (config.autoReduceQuality) {
    window.__forgeAutoReduceQuality = true;
  }
})();
`.trim();
}

/**
 * Generate HTML for touch overlay
 */
export function generateTouchOverlayHTML(_config: MobileTouchConfig): string {
  const parts: string[] = ['<div id="forge-touch-overlay" class="forge-touch-overlay">'];

  // Joystick HTML (containers created by JS)
  // Buttons HTML (created by JS)

  parts.push('</div>');
  return parts.join('\n');
}
