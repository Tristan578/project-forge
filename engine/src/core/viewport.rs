//! Viewport management - handles canvas resize and camera projection sync.

use serde::{Deserialize, Serialize};

/// Payload received from React when the viewport resizes.
#[derive(Debug, Clone, Deserialize)]
pub struct ResizePayload {
    pub width: u32,
    pub height: u32,
    pub dpr: f32,
}

/// Resource storing current viewport state.
#[derive(Debug, Clone, Default)]
pub struct ViewportResource {
    /// CSS pixel width
    pub logical_width: u32,
    /// CSS pixel height
    pub logical_height: u32,
    /// Actual pixel width (logical × dpr)
    pub physical_width: u32,
    /// Actual pixel height (logical × dpr)
    pub physical_height: u32,
    /// Device pixel ratio
    pub dpr: f32,
    /// Whether viewport has been initialized
    pub initialized: bool,
}

impl ViewportResource {
    /// Create a new viewport resource from a resize payload.
    pub fn from_resize(payload: &ResizePayload) -> Self {
        Self {
            logical_width: payload.width,
            logical_height: payload.height,
            physical_width: (payload.width as f32 * payload.dpr) as u32,
            physical_height: (payload.height as f32 * payload.dpr) as u32,
            dpr: payload.dpr,
            initialized: true,
        }
    }

    /// Update viewport from a resize payload.
    pub fn update(&mut self, payload: &ResizePayload) {
        self.logical_width = payload.width;
        self.logical_height = payload.height;
        self.physical_width = (payload.width as f32 * payload.dpr) as u32;
        self.physical_height = (payload.height as f32 * payload.dpr) as u32;
        self.dpr = payload.dpr;
        self.initialized = true;
    }

    /// Get the aspect ratio (width / height).
    pub fn aspect_ratio(&self) -> f32 {
        if self.logical_height == 0 {
            1.0
        } else {
            self.logical_width as f32 / self.logical_height as f32
        }
    }
}

/// Response sent back to React after viewport update.
#[derive(Debug, Clone, Serialize)]
pub struct ViewportUpdated {
    pub physical_width: u32,
    pub physical_height: u32,
    pub aspect_ratio: f32,
}

impl From<&ViewportResource> for ViewportUpdated {
    fn from(viewport: &ViewportResource) -> Self {
        Self {
            physical_width: viewport.physical_width,
            physical_height: viewport.physical_height,
            aspect_ratio: viewport.aspect_ratio(),
        }
    }
}

// Global viewport state (will be moved to Bevy Resource when ECS is integrated)
use std::sync::RwLock;
static VIEWPORT: RwLock<ViewportResource> = RwLock::new(ViewportResource {
    logical_width: 0,
    logical_height: 0,
    physical_width: 0,
    physical_height: 0,
    dpr: 1.0,
    initialized: false,
});

/// Handle a resize command from the frontend.
pub fn handle_resize(payload: ResizePayload) -> Result<ViewportUpdated, String> {
    tracing::info!(
        "Viewport resize: {}x{} @ {}dpr",
        payload.width,
        payload.height,
        payload.dpr
    );

    let mut viewport = VIEWPORT.write().map_err(|e| e.to_string())?;
    viewport.update(&payload);

    // TODO: When Bevy is integrated, this will:
    // 1. Update the ViewportResource in the Bevy World
    // 2. Trigger the sync_camera_projection system

    Ok(ViewportUpdated::from(&*viewport))
}

/// Get the current viewport state.
pub fn get_viewport() -> Result<ViewportResource, String> {
    VIEWPORT.read().map(|v| v.clone()).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resize_payload_to_resource() {
        let payload = ResizePayload {
            width: 1920,
            height: 1080,
            dpr: 2.0,
        };

        let resource = ViewportResource::from_resize(&payload);

        assert_eq!(resource.logical_width, 1920);
        assert_eq!(resource.logical_height, 1080);
        assert_eq!(resource.physical_width, 3840);
        assert_eq!(resource.physical_height, 2160);
        assert_eq!(resource.dpr, 2.0);
        assert!(resource.initialized);
    }

    #[test]
    fn test_aspect_ratio() {
        let payload = ResizePayload {
            width: 1920,
            height: 1080,
            dpr: 1.0,
        };

        let resource = ViewportResource::from_resize(&payload);
        let aspect = resource.aspect_ratio();

        assert!((aspect - 1.777).abs() < 0.01); // ~16:9
    }

    #[test]
    fn test_aspect_ratio_zero_height() {
        let resource = ViewportResource::default();
        assert_eq!(resource.aspect_ratio(), 1.0);
    }
}
