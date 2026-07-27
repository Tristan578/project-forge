import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { getTableName } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import * as schema from '../schema';

const MIGRATION_SQL_PATH = path.join(
  __dirname,
  '../../../../drizzle/0010_graph_retrieval_nodes_edges.sql'
);

/**
 * Schema-only coverage for graph_nodes / graph_edges (PF-985 #8977,
 * specs/graph-rag-retrieval.md Phase 0). Asserts the Drizzle table/enum/type
 * shape schema.ts declares — column presence, index names, FK targets, and
 * exported TS types — WITHOUT touching a real or PGlite database. Full
 * migration-chain parity (does the migration actually create this shape) is
 * covered by schemaMigrationParity.db.test.ts's `it.each(tables)` sweep,
 * which already includes graphNodes/graphEdges automatically since it
 * enumerates every PgTable exported from schema.ts.
 */
describe('graph_nodes / graph_edges schema shape (PF-985 #8977)', () => {
  it('exports graphNodes and graphEdges as Drizzle table objects', () => {
    expect(schema.graphNodes).not.toBeUndefined();
    expect(schema.graphEdges).not.toBeUndefined();
    expect(getTableName(schema.graphNodes)).toBe('graph_nodes');
    expect(getTableName(schema.graphEdges)).toBe('graph_edges');
  });

  it('exports graphNodeKindEnum and graphEdgeTypeEnum with the spec values', () => {
    expect(schema.graphNodeKindEnum).not.toBeUndefined();
    expect(schema.graphNodeKindEnum.enumValues).toEqual([
      'project',
      'scene',
      'entity',
      'asset',
      'script',
      'generation',
    ]);

    expect(schema.graphEdgeTypeEnum).not.toBeUndefined();
    expect(schema.graphEdgeTypeEnum.enumValues).toEqual([
      'contains',
      'references',
      'script_bound_to',
      'spawned_from_prompt',
      'derived_from',
    ]);
  });

  it('graphNodes has every schema.ts column', () => {
    const keys = Object.keys(schema.graphNodes);
    expect(keys).toContain('id');
    expect(keys).toContain('userId');
    expect(keys).toContain('projectId');
    expect(keys).toContain('kind');
    expect(keys).toContain('refId');
    expect(keys).toContain('contentHash');
    expect(keys).toContain('embedding');
    expect(keys).toContain('text');
    expect(keys).toContain('updatedAt');
  });

  it('graphEdges has every schema.ts column', () => {
    const keys = Object.keys(schema.graphEdges);
    expect(keys).toContain('id');
    expect(keys).toContain('userId');
    expect(keys).toContain('projectId');
    expect(keys).toContain('type');
    expect(keys).toContain('srcNodeId');
    expect(keys).toContain('dstNodeId');
  });

  it('graphNodes.embedding is a 1536-dimension vector column', () => {
    const { embedding } = schema.graphNodes;
    // Drizzle's pg-core vector column exposes its declared dimensions on
    // the column config — this is the live check that the "1536,
    // Matryoshka-truncated, PROVISIONAL" dimensionality documented in
    // schema.ts is actually what got declared, not just what the comment
    // claims.
    expect(embedding.columnType).toBe('PgVector');
    expect((embedding as unknown as { dimensions: number }).dimensions).toBe(1536);
  });

  it('declares the exact indexes specs/graph-rag-retrieval.md requires', () => {
    const nodeIndexNames = getTableConfig(schema.graphNodes)
      .indexes.map((ix) => ix.config.name)
      .sort();
    expect(nodeIndexNames).toEqual(
      [
        'uq_graph_nodes_user_project_kind_ref',
        'idx_graph_nodes_user_project_kind',
        'idx_graph_nodes_embedding_hnsw',
      ].sort()
    );

    const edgeIndexNames = getTableConfig(schema.graphEdges)
      .indexes.map((ix) => ix.config.name)
      .sort();
    expect(edgeIndexNames).toEqual(
      [
        'uq_graph_edges_user_type_src_dst',
        'idx_graph_edges_user_src',
        'idx_graph_edges_user_dst',
      ].sort()
    );
  });

  it('graphNodes.embedding index uses hnsw + vector_cosine_ops', () => {
    const embeddingIndex = getTableConfig(schema.graphNodes).indexes.find(
      (ix) => ix.config.name === 'idx_graph_nodes_embedding_hnsw'
    );
    expect(embeddingIndex).not.toBeUndefined();
    expect(embeddingIndex?.config.method).toBe('hnsw');
  });

  it('graphNodes.embedding hnsw index is partial (WHERE embedding IS NOT NULL)', () => {
    // embedding is nullable (not every node is embedded eagerly), so the hnsw
    // index must exclude NULL entries via a partial predicate — an HNSW index
    // built over NULL vectors wastes build time/space on rows that can never
    // match a similarity search. Guards both representations: the drizzle
    // index builder's `.where(...)` AND the raw migration SQL's `WHERE` clause
    // (Sentry finding, PF-985 #8977).
    const embeddingIndex = getTableConfig(schema.graphNodes).indexes.find(
      (ix) => ix.config.name === 'idx_graph_nodes_embedding_hnsw'
    );
    expect(embeddingIndex?.config.where).not.toBeUndefined();

    const migrationSql = readFileSync(MIGRATION_SQL_PATH, 'utf8');
    const hnswLine = migrationSql
      .split('\n')
      .find((line) => line.includes('idx_graph_nodes_embedding_hnsw'));
    expect(hnswLine).toMatch(/WHERE\s+"embedding"\s+IS\s+NOT\s+NULL/i);
  });

  it('graphEdges FKs target users, projects, and graphNodes (self-referential)', () => {
    const edgeConfig = getTableConfig(schema.graphEdges);
    const fkTargets = edgeConfig.foreignKeys.map((fk) => getTableName(fk.reference().foreignTable));
    expect(fkTargets).toContain('users');
    expect(fkTargets).toContain('projects');
    // Both srcNodeId and dstNodeId reference graph_nodes.
    expect(fkTargets.filter((name) => name === 'graph_nodes')).toHaveLength(2);
  });

  it('graphNodes FKs target users and projects', () => {
    const nodeConfig = getTableConfig(schema.graphNodes);
    const fkTargets = nodeConfig.foreignKeys.map((fk) => getTableName(fk.reference().foreignTable));
    expect(fkTargets).toContain('users');
    expect(fkTargets).toContain('projects');
  });

  it('every graph FK is ON DELETE CASCADE (spec: deleting a project cascades its nodes/edges)', () => {
    // specs/graph-rag-retrieval.md requires "ON DELETE CASCADE" so that deleting
    // a project (or user) tears down its graph_nodes, and deleting a node tears
    // down the graph_edges that reference it — no orphan rows, no manual cleanup.
    // Guards both directions: the schema.ts `.references(..., { onDelete })` AND
    // the migration's `ON DELETE cascade` (0010_graph_retrieval_nodes_edges.sql).
    const nodeFks = getTableConfig(schema.graphNodes).foreignKeys;
    const edgeFks = getTableConfig(schema.graphEdges).foreignKeys;
    expect(nodeFks).toHaveLength(2);
    expect(edgeFks).toHaveLength(4);
    for (const fk of [...nodeFks, ...edgeFks]) {
      expect(fk.onDelete).toBe('cascade');
    }
  });

  it('exports GraphNode/GraphEdge inferred types and the kind/type unions', () => {
    // Compile-time shape check: if these type exports are ever removed or
    // renamed, this file fails to type-check (tsc --noEmit) rather than
    // silently losing coverage.
    const kinds: schema.GraphNodeKind[] = [
      'project',
      'scene',
      'entity',
      'asset',
      'script',
      'generation',
    ];
    const edgeTypes: schema.GraphEdgeType[] = [
      'contains',
      'references',
      'script_bound_to',
      'spawned_from_prompt',
      'derived_from',
    ];
    expect(kinds).toHaveLength(6);
    expect(edgeTypes).toHaveLength(5);

    const sampleNode: Partial<schema.NewGraphNode> = { kind: 'entity', refId: 'test' };
    const sampleEdge: Partial<schema.NewGraphEdge> = { type: 'contains' };
    expect(sampleNode.kind).toBe('entity');
    expect(sampleEdge.type).toBe('contains');
  });
});
