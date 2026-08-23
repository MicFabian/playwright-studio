import {
  FLOW_FORMAT_VERSION,
  type AriaRole,
  type FlowDocument,
  type FlowStep,
  type LocatorRef,
  type LocatorTarget,
  type ValueExpr,
} from './ir';

interface V1Field {
  key?: string;
  value?: string;
}

interface V1Node {
  id?: string;
  position?: { x?: number; y?: number };
  data?: {
    kind?: string;
    title?: string;
    fields?: V1Field[];
    snippetCode?: string;
    snippetRef?: string;
  };
}

interface V1Edge {
  source?: string;
  target?: string;
}

export interface V1Flow {
  id?: string;
  name?: string;
  status?: string;
  updatedAt?: string;
  nodes?: V1Node[];
  edges?: V1Edge[];
}

export interface MigrationNote {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  stepId?: string;
}

export interface MigrationResult {
  document: FlowDocument;
  notes: MigrationNote[];
}

const TEMPLATE_TITLES = new Set([
  'Open page',
  'Click target',
  'Fill input',
  'Assert state',
  'Extract value',
  'Run code',
  'Condition',
  'Free code',
  'Loop',
  'Custom snippet',
]);

const ROLE_VALUES = new Set<string>([
  'alert',
  'button',
  'checkbox',
  'columnheader',
  'combobox',
  'dialog',
  'heading',
  'link',
  'list',
  'listbox',
  'listitem',
  'menu',
  'menuitem',
  'navigation',
  'option',
  'progressbar',
  'radio',
  'region',
  'row',
  'searchbox',
  'separator',
  'slider',
  'spinbutton',
  'status',
  'switch',
  'tab',
  'table',
  'tabpanel',
  'textbox',
  'tooltip',
]);

function finiteOr(candidate: unknown, fallback: number): number {
  const parsed = Number(candidate);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function literal(value: string): ValueExpr {
  return { source: 'literal', value };
}

function fieldValue(node: V1Node, key: string): string {
  return node.data?.fields?.find((field) => field.key === key)?.value ?? '';
}

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'untitled-flow';
}

function parseLegacySelector(selector: string): LocatorRef {
  const raw = selector.trim();

  const attribute = raw.match(/^\[(data-testid|name|id|placeholder)="([^"]*)"\]$/);

  if (attribute) {
    const [, attributeName, value] = attribute;

    if (attributeName === 'data-testid') {
      return { by: 'testId', value: literal(value) };
    }

    if (attributeName === 'placeholder') {
      return { by: 'placeholder', text: literal(value) };
    }

    return { by: 'css', selector: literal(raw) };
  }

  if (raw.startsWith('text=')) {
    return { by: 'text', text: literal(raw.slice(5)) };
  }

  const roleMatch = raw.match(/^role=([a-z]+)(?:\[name="([^"]*)"\])?$/);

  if (roleMatch && ROLE_VALUES.has(roleMatch[1])) {
    return {
      by: 'role',
      role: roleMatch[1] as AriaRole,
      ...(roleMatch[2] ? { name: literal(roleMatch[2]) } : {}),
    };
  }

  return { by: 'css', selector: literal(raw) };
}

function buildLegacySelector(kind: string, value: string): string {
  switch (kind) {
    case 'data-testid':
      return `[data-testid="${value}"]`;
    case 'name':
      return `[name="${value}"]`;
    case 'id':
      return `[id="${value}"]`;
    case 'placeholder':
      return `[placeholder="${value}"]`;
    case 'text':
      return `text=${value}`;
    default:
      return value;
  }
}

function readTarget(node: V1Node, prefix: 'locator' | 'target' | 'guard'): LocatorTarget {
  const strategy = fieldValue(node, `${prefix}Kind`);
  const value = fieldValue(node, `${prefix}Value`);
  const legacy = fieldValue(node, prefix);

  if (strategy && value) {
    if (strategy === 'data-testid') {
      return { base: { by: 'testId', value: literal(value) } };
    }

    if (strategy === 'placeholder') {
      return { base: { by: 'placeholder', text: literal(value) } };
    }

    if (strategy === 'text') {
      return { base: { by: 'text', text: literal(value) } };
    }

    return { base: parseLegacySelector(buildLegacySelector(strategy, value)) };
  }

  return { base: parseLegacySelector(legacy || '') };
}

function orderV1Nodes(nodes: V1Node[], edges: V1Edge[]): V1Node[] {
  // A v1 file may have nodes without ids, and every one of them would otherwise
  // collide on the string "undefined" and all but the last would be dropped.
  nodes.forEach((node, index) => {
    if (!node.id) {
      node.id = `node-${index + 1}`;
    }
  });

  const byId = new Map(nodes.map((node) => [String(node.id), node]));
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, string[]>();

  nodes.forEach((node) => incoming.set(String(node.id), 0));

  edges.forEach((edge) => {
    const source = String(edge.source);
    const target = String(edge.target);

    if (!byId.has(source) || !byId.has(target)) {
      return;
    }

    incoming.set(target, (incoming.get(target) ?? 0) + 1);
    outgoing.set(source, [...(outgoing.get(source) ?? []), target]);
  });

  const byPosition = (left: V1Node, right: V1Node) => {
    const leftX = finiteOr(left.position?.x, 0);
    const rightX = finiteOr(right.position?.x, 0);
    if (leftX !== rightX) {
      return leftX - rightX;
    }

    return finiteOr(left.position?.y, 0) - finiteOr(right.position?.y, 0);
  };

  const ordered: V1Node[] = [];
  const visited = new Set<string>();

  const visit = (nodeId: string) => {
    if (visited.has(nodeId)) {
      return;
    }

    const node = byId.get(nodeId);

    if (!node) {
      return;
    }

    visited.add(nodeId);
    ordered.push(node);
    (outgoing.get(nodeId) ?? [])
      .map((id) => byId.get(id))
      .filter((child): child is V1Node => child != null)
      .sort(byPosition)
      .forEach((child) => visit(String(child.id)));
  };

  [...nodes]
    .filter((node) => (incoming.get(String(node.id)) ?? 0) === 0)
    .sort(byPosition)
    .forEach((node) => visit(String(node.id)));

  [...nodes].sort(byPosition).forEach((node) => visit(String(node.id)));

  return ordered;
}

export function migrateV1Flow(raw: V1Flow, fallbackId: string): MigrationResult {
  const notes: MigrationNote[] = [];
  const nodes = Array.isArray(raw.nodes) ? raw.nodes : [];
  const edges = Array.isArray(raw.edges) ? raw.edges : [];
  const ordered = orderV1Nodes(nodes, edges);
  const positions: Record<string, { x: number; y: number }> = {};
  const steps: FlowStep[] = [];

  ordered.forEach((node) => {
    const id = String(node.id || `step-${steps.length + 1}`);
    const kind = String(node.data?.kind || '');
    const title = String(node.data?.title || '');
    const label = title && !TEMPLATE_TITLES.has(title) ? title : undefined;

    positions[id] = {
      x: finiteOr(node.position?.x, 0),
      y: finiteOr(node.position?.y, 0),
    };

    const base = { id, ...(label ? { label } : {}) };

    switch (kind) {
      case 'navigate':
        steps.push({ ...base, kind: 'navigate', url: literal(fieldValue(node, 'url')) });
        return;

      case 'click':
        steps.push({ ...base, kind: 'click', target: readTarget(node, 'locator') });
        return;

      case 'fill':
        steps.push({
          ...base,
          kind: 'fill',
          target: readTarget(node, 'locator'),
          value: literal(fieldValue(node, 'value')),
        });
        return;

      case 'assert':
        steps.push({
          ...base,
          kind: 'assert',
          target: readTarget(node, 'target'),
          assertion: { type: 'containsText', text: literal(fieldValue(node, 'expectation')) },
        });
        return;

      case 'extract':
        steps.push({
          ...base,
          kind: 'extract',
          target: readTarget(node, 'locator'),
          variable: fieldValue(node, 'variable') || 'value',
        });
        return;

      case 'code':
      case 'freetext':
        steps.push({ ...base, kind: 'code', code: fieldValue(node, 'code') });
        return;

      case 'snippet': {
        const code = String(node.data?.snippetCode || '').trim();
        const bindings = (node.data?.fields ?? [])
          .filter((field) => field.key && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(field.key))
          .map((field) => `const ${field.key} = ${JSON.stringify(field.value ?? '')};`);

        notes.push({
          severity: 'info',
          code: 'snippet-inlined',
          message: `Snippet "${title || id}" was inlined as a custom code step.`,
          stepId: id,
        });
        steps.push({
          ...base,
          kind: 'code',
          code: [...bindings, code].filter(Boolean).join('\n'),
        });
        return;
      }

      case 'condition': {
        notes.push({
          severity: 'error',
          code: 'condition-body-lost',
          message:
            `Condition "${title || id}" had no real branch in v1 — the old format could not ` +
            'express nesting, so its body was never executed. Rebuild the branch in the editor.',
          stepId: id,
        });
        steps.push({
          ...base,
          kind: 'condition',
          predicate: { type: 'locatorVisible', target: readTarget(node, 'guard') },
          then: { steps: [] },
        });
        return;
      }

      case 'loop': {
        notes.push({
          severity: 'error',
          code: 'loop-body-lost',
          message:
            `Loop "${title || id}" had no real body in v1 — the old format could not express ` +
            'nesting, so it only ever ran a single implicit iteration. Rebuild the body in the editor.',
          stepId: id,
        });
        steps.push({
          ...base,
          kind: 'loop',
          source: literal(fieldValue(node, 'collection') || 'items'),
          itemName: fieldValue(node, 'alias') || 'item',
          body: { steps: [] },
        });
        return;
      }

      default:
        notes.push({
          severity: 'warning',
          code: 'unknown-kind',
          message: `Unknown block kind "${kind}" was preserved as a comment.`,
          stepId: id,
        });
        steps.push({ ...base, kind: 'comment', text: `Unsupported v1 block: ${kind}` });
    }
  });

  const status = raw.status === 'stable' || raw.status === 'failing' ? raw.status : 'draft';

  return {
    document: {
      formatVersion: FLOW_FORMAT_VERSION,
      id: slugify(String(raw.id || raw.name || fallbackId)),
      name: String(raw.name || 'Untitled flow'),
      status,
      ...(raw.updatedAt ? { updatedAt: String(raw.updatedAt) } : {}),
      root: { steps },
      layout: { positions },
    },
    notes,
  };
}

export function isV1Flow(raw: unknown): raw is V1Flow {
  if (raw == null || typeof raw !== 'object') {
    return false;
  }

  const candidate = raw as { formatVersion?: unknown; nodes?: unknown };
  return candidate.formatVersion !== FLOW_FORMAT_VERSION && Array.isArray(candidate.nodes);
}
