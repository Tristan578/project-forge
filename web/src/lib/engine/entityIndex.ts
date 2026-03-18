/**
 * EntityIndex — O(1) entity lookup structures built from scene graph data.
 *
 * Replaces O(N) linear scans (e.g., Object.values(nodes).find()) with
 * pre-built Map lookups. Build once per snapshot, use for all queries.
 */

import type { SceneNode, SceneGraph } from '@/stores/slices/types';

/** Aggregate of all component data for a single entity. */
export interface EntityData {
  node: SceneNode;
  entityType: string;
}

/** Pre-built index maps for O(1) entity lookups. */
export interface EntityIndex {
  /** Entity ID -> EntityData for O(1) ID lookups. */
  byId: Map<string, EntityData>;
  /** Entity type string -> Set of entity IDs. */
  byType: Map<string, Set<string>>;
  /** Component name -> Set of entity IDs that have that component. */
  byComponent: Map<string, Set<string>>;
  /** Entity name -> Set of entity IDs (names can be duplicated). */
  byName: Map<string, Set<string>>;
}

/**
 * Infer the high-level entity type from a SceneNode's component list.
 */
function inferEntityType(node: SceneNode): string {
  if (node.components.includes('TerrainEnabled')) return 'terrain';
  if (node.components.includes('PointLight')) return 'point_light';
  if (node.components.includes('DirectionalLight')) return 'directional_light';
  if (node.components.includes('SpotLight')) return 'spot_light';
  if (node.components.includes('Mesh3d')) return 'mesh';
  if (node.components.includes('Sprite')) return 'sprite';
  return 'entity';
}

/**
 * Build an EntityIndex from a SceneGraph in O(n) time.
 *
 * The resulting index supports O(1) lookups by ID, type, component, or name.
 */
export function buildEntityIndex(sceneGraph: SceneGraph): EntityIndex {
  const byId = new Map<string, EntityData>();
  const byType = new Map<string, Set<string>>();
  const byComponent = new Map<string, Set<string>>();
  const byName = new Map<string, Set<string>>();

  const nodes = sceneGraph.nodes;
  const nodeIds = Object.keys(nodes);

  for (let i = 0; i < nodeIds.length; i++) {
    const id = nodeIds[i];
    const node = nodes[id];
    const entityType = inferEntityType(node);

    // byId
    byId.set(id, { node, entityType });

    // byType
    let typeSet = byType.get(entityType);
    if (!typeSet) {
      typeSet = new Set<string>();
      byType.set(entityType, typeSet);
    }
    typeSet.add(id);

    // byComponent
    const components = node.components;
    for (let j = 0; j < components.length; j++) {
      const comp = components[j];
      let compSet = byComponent.get(comp);
      if (!compSet) {
        compSet = new Set<string>();
        byComponent.set(comp, compSet);
      }
      compSet.add(id);
    }

    // byName
    const name = node.name;
    let nameSet = byName.get(name);
    if (!nameSet) {
      nameSet = new Set<string>();
      byName.set(name, nameSet);
    }
    nameSet.add(id);
  }

  return { byId, byType, byComponent, byName };
}

/**
 * O(1) lookup of an entity by ID.
 */
export function lookupEntity(index: EntityIndex, id: string): EntityData | undefined {
  return index.byId.get(id);
}

/**
 * O(1) lookup of all entity IDs with a given type.
 */
export function lookupByType(index: EntityIndex, type: string): string[] {
  const set = index.byType.get(type);
  return set ? [...set] : [];
}

/**
 * O(1) lookup of all entity IDs that have a given component.
 */
export function lookupByComponent(index: EntityIndex, component: string): string[] {
  const set = index.byComponent.get(component);
  return set ? [...set] : [];
}

/**
 * O(1) lookup of all entity IDs with a given name.
 */
export function lookupByName(index: EntityIndex, name: string): string[] {
  const set = index.byName.get(name);
  return set ? [...set] : [];
}

/**
 * Find the first entity ID matching a name. O(1) average case.
 */
export function findEntityByName(index: EntityIndex, name: string): string | undefined {
  const set = index.byName.get(name);
  if (!set || set.size === 0) return undefined;
  return set.values().next().value as string;
}
