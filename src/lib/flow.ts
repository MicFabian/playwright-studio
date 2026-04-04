import type { Connection } from '@xyflow/react';
import type {
  FlowBlockData,
  FlowBlockKind,
  FlowEdge,
  FlowNode,
  SnippetItem,
} from '../types';

const templateCatalog: Record<FlowBlockKind, FlowBlockData> = {
  navigate: {
    kind: 'navigate',
    category: 'entry',
    title: 'Open page',
    description: 'Boot a browser page or jump to a route.',
    accent: '#19c2b0',
    codeLabel: 'page.goto()',
    status: 'ready',
    fields: [
      {
        key: 'url',
        label: 'URL',
        value: 'https://app.example.com/login',
        placeholder: 'https://app.example.com',
      },
    ],
  },
  click: {
    kind: 'click',
    category: 'action',
    title: 'Click target',
    description: 'Trigger a button, link, or custom locator.',
    accent: '#ffc857',
    codeLabel: 'locator.click()',
    status: 'ready',
    fields: [
      {
        key: 'locator',
        label: 'Locator',
        value: '[data-testid="submit"]',
        placeholder: '[data-testid="submit"]',
      },
    ],
  },
  fill: {
    kind: 'fill',
    category: 'action',
    title: 'Fill input',
    description: 'Type or replace content in a field.',
    accent: '#f59e0b',
    codeLabel: 'locator.fill()',
    status: 'ready',
    fields: [
      {
        key: 'locator',
        label: 'Locator',
        value: '[name="email"]',
        placeholder: '[name="email"]',
      },
      {
        key: 'value',
        label: 'Value',
        value: 'qa@example.com',
        placeholder: 'Value or variable',
      },
    ],
  },
  assert: {
    kind: 'assert',
    category: 'assertion',
    title: 'Assert state',
    description: 'Validate text, visibility, or state.',
    accent: '#ff825b',
    codeLabel: 'expect()',
    status: 'ready',
    fields: [
      {
        key: 'target',
        label: 'Target',
        value: '[data-testid="dashboard-title"]',
        placeholder: 'Locator or role selector',
      },
      {
        key: 'expectation',
        label: 'Expectation',
        value: 'Dashboard',
        placeholder: 'Expected text or condition',
      },
    ],
  },
  extract: {
    kind: 'extract',
    category: 'action',
    title: 'Extract value',
    description: 'Read text or state and bind it to a variable.',
    accent: '#58d3ff',
    codeLabel: 'textContent()',
    status: 'draft',
    fields: [
      {
        key: 'locator',
        label: 'Locator',
        value: '[data-testid="order-count"]',
        placeholder: 'Element to read',
      },
      {
        key: 'variable',
        label: 'Variable',
        value: 'orderCount',
        placeholder: 'camelCase variable',
      },
    ],
  },
  condition: {
    kind: 'condition',
    category: 'logic',
    title: 'Condition',
    description: 'Gate a branch based on a locator or expression.',
    accent: '#e85d3f',
    codeLabel: 'if / else',
    status: 'draft',
    fields: [
      {
        key: 'guard',
        label: 'Guard',
        value: '[data-testid="toast-error"]',
        placeholder: 'Locator or expression',
      },
    ],
  },
  loop: {
    kind: 'loop',
    category: 'logic',
    title: 'Loop',
    description: 'Repeat a reusable sequence over test data.',
    accent: '#cfac48',
    codeLabel: 'for...of',
    status: 'draft',
    fields: [
      {
        key: 'collection',
        label: 'Collection',
        value: 'rows',
        placeholder: 'rows',
      },
      {
        key: 'alias',
        label: 'Alias',
        value: 'row',
        placeholder: 'row',
      },
    ],
  },
  snippet: {
    kind: 'snippet',
    category: 'snippet',
    title: 'Custom snippet',
    description: 'Reusable code block with local parameters.',
    accent: '#f3d27a',
    codeLabel: 'custom snippet',
    status: 'draft',
    fields: [],
    snippetCode: `await page.waitForLoadState('networkidle');`,
  },
};

function cloneFields(source: FlowBlockData['fields']) {
  return source.map((field) => ({ ...field }));
}

export function splitSnippetCodeIntoSteps(snippetCode?: string) {
  const source = snippetCode || '';

  if (source.trim().length === 0) {
    return [''];
  }

  const steps: string[] = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inTemplateQuote = false;
  let escaped = false;

  const isSpace = (char?: string) => char === ' ' || char === '\t';

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    current += char;

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (!inDoubleQuote && !inTemplateQuote && char === "'") {
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (!inSingleQuote && !inTemplateQuote && char === '"') {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote && char === '`') {
      inTemplateQuote = !inTemplateQuote;
      continue;
    }

    if (inSingleQuote || inDoubleQuote || inTemplateQuote) {
      continue;
    }

    if (char === ';') {
      let lookAhead = index + 1;

      while (lookAhead < source.length && isSpace(source[lookAhead])) {
        lookAhead += 1;
      }

      const nextChar = source[lookAhead];

      if (nextChar === '\n' || nextChar === '\r' || nextChar == null) {
        const normalized = current.trim();

        if (normalized.length > 0) {
          steps.push(normalized);
        }

        current = '';
      }
    }
  }

  const trailing = current.trim();

  if (trailing.length > 0) {
    steps.push(trailing);
  }

  return steps.length > 0 ? steps : [''];
}

export function createSnippetStepCodeFromBlock(kind: FlowBlockKind) {
  switch (kind) {
    case 'navigate':
      return "await page.goto('https://app.example.com/login');";
    case 'click':
      return "await page.locator('[data-testid=\"submit\"]').click();";
    case 'fill':
      return "await page.locator('[name=\"email\"]').fill('qa@example.com');";
    case 'assert':
      return "await expect(page.locator('[data-testid=\"dashboard-title\"]')).toContainText('Dashboard');";
    case 'extract':
      return "const orderCount = await page.locator('[data-testid=\"order-count\"]').textContent();";
    case 'condition':
      return "if (await page.locator('[data-testid=\"toast-error\"]').isVisible()) {\n  // add snippet actions\n}";
    case 'loop':
      return "for (const row of rows) {\n  // add snippet actions\n}";
    case 'snippet':
      return "await page.waitForLoadState('networkidle');";
    default:
      return '// add snippet action';
  }
}

export function createFlowNode(
  kind: FlowBlockKind,
  position: { x: number; y: number },
  overrides: Partial<FlowBlockData> = {},
): FlowNode {
  const template = templateCatalog[kind];

  return {
    id: crypto.randomUUID(),
    type: 'flow',
    position,
    data: {
      ...template,
      ...overrides,
      fields: overrides.fields ? cloneFields(overrides.fields) : cloneFields(template.fields),
      snippetCode: overrides.snippetCode ?? template.snippetCode,
    },
  };
}

export function createSnippetNode(
  snippet: SnippetItem,
  position: { x: number; y: number },
): FlowNode {
  return createFlowNode('snippet', position, {
    title: snippet.name,
    description: snippet.description,
    status: 'ready',
    fields: snippet.params.map((param) => ({
      key: param,
      label: param,
      value: param,
      placeholder: `Bind ${param}`,
    })),
    snippetRef: snippet.id,
    snippetCode: snippet.code,
  });
}

function fieldMap(node: FlowNode) {
  return Object.fromEntries(node.data.fields.map((field) => [field.key, field.value]));
}

function q(value: string) {
  return JSON.stringify(value);
}

function safeIdentifier(candidate: string) {
  const cleaned = candidate.replace(/[^a-zA-Z0-9_$]/g, '');

  if (!cleaned) {
    return 'value';
  }

  if (/^[0-9]/.test(cleaned)) {
    return `v${cleaned}`;
  }

  return cleaned;
}

function orderNodes(nodes: FlowNode[], edges: FlowEdge[]) {
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, FlowEdge[]>();
  const byId = new Map(nodes.map((node) => [node.id, node]));

  nodes.forEach((node) => incoming.set(node.id, 0));

  edges.forEach((edge) => {
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
    const connected = outgoing.get(edge.source) ?? [];
    connected.push(edge);
    outgoing.set(edge.source, connected);
  });

  const sortByPosition = (left: FlowNode, right: FlowNode) => {
    if (left.position.x === right.position.x) {
      return left.position.y - right.position.y;
    }

    return left.position.x - right.position.x;
  };

  outgoing.forEach((connected) => {
    connected.sort((left, right) => {
      const leftNode = byId.get(left.target);
      const rightNode = byId.get(right.target);

      if (!leftNode || !rightNode) {
        return 0;
      }

      return sortByPosition(leftNode, rightNode);
    });
  });

  const roots = [...nodes]
    .filter((node) => (incoming.get(node.id) ?? 0) === 0)
    .sort(sortByPosition);

  const ordered: FlowNode[] = [];
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
    (outgoing.get(nodeId) ?? []).forEach((edge) => visit(edge.target));
  };

  roots.forEach((node) => visit(node.id));

  [...nodes].sort(sortByPosition).forEach((node) => visit(node.id));

  return ordered;
}

function renderNode(node: FlowNode) {
  const fields = fieldMap(node);

  switch (node.data.kind) {
    case 'navigate':
      return [`await page.goto(${q(fields.url || 'https://example.com')});`];
    case 'click':
      return [
        `await page.locator(${q(fields.locator || '[data-testid="submit"]')}).click();`,
      ];
    case 'fill':
      return [
        `await page.locator(${q(fields.locator || '[name="field"]')}).fill(${q(
          fields.value || '',
        )});`,
      ];
    case 'assert':
      return [
        `await expect(page.locator(${q(
          fields.target || '[data-testid="target"]',
        )})).toContainText(${q(fields.expectation || 'Expected text')});`,
      ];
    case 'extract':
      return [
        `const ${safeIdentifier(
          fields.variable || 'value',
        )} = await page.locator(${q(
          fields.locator || '[data-testid="value"]',
        )}).textContent();`,
      ];
    case 'condition':
      return [
        `if (await page.locator(${q(fields.guard || '[data-testid="guard"]')}).isVisible()) {`,
        '  // Attach branch blocks to this condition in the flow editor.',
        '}',
      ];
    case 'loop':
      return [
        `for (const ${safeIdentifier(fields.alias || 'item')} of ${
          fields.collection || 'items'
        }) {`,
        '  // Attach repeatable blocks or snippets inside this loop.',
        '}',
      ];
    case 'snippet': {
      const parameterLines = node.data.fields.map((field) => {
        return `const ${safeIdentifier(field.key)} = ${q(field.value || field.key)};`;
      });
      const snippetLines = (node.data.snippetCode || '// add snippet code')
        .split('\n')
        .map((line) => line.trimEnd());

      return [`// Snippet: ${node.data.title}`, ...parameterLines, ...snippetLines];
    }
    default:
      return ['// Unsupported block'];
  }
}

export function generatePlaywrightSpec(
  title: string,
  nodes: FlowNode[],
  edges: FlowEdge[],
) {
  const flowLines = orderNodes(nodes, edges).flatMap((node) =>
    renderNode(node).map((line) => `  ${line}`),
  );

  return [
    "import { expect, test } from '@playwright/test';",
    '',
    `test(${q(title)}, async ({ page }) => {`,
    ...flowLines,
    '});',
  ].join('\n');
}

export function createConnectedEdge(connection: Connection): FlowEdge {
  return {
    id: crypto.randomUUID(),
    source: connection.source ?? '',
    target: connection.target ?? '',
    type: 'smoothstep',
    animated: true,
  };
}

export const blockLibrary = [
  'navigate',
  'fill',
  'click',
  'assert',
  'extract',
  'condition',
  'loop',
] as const;

export const blockCatalog = templateCatalog;
