// Channel handler registry — creates and registers all channel handlers on the router.

export { createPhysicsHandler } from './physicsChannel';
export type { PhysicsChannelDeps } from './physicsChannel';

export { createAiHandler } from './aiChannel';
export type { AiChannelDeps } from './aiChannel';

export { createAssetHandler } from './assetChannel';
export type { AssetChannelDeps } from './assetChannel';

export { createAudioHandler } from './audioChannel';
export type { AudioChannelDeps } from './audioChannel';

export { createAnimationHandler } from './animationChannel';
export type { AnimationChannelDeps } from './animationChannel';
