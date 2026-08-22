import type { Connection } from '@xyflow/react';
import type {
  BlockField,
  FlowBlockData,
  FlowBlockKind,
  FlowBlockTemplate,
  FlowEdge,
  FlowNode,
  SnippetItem,
  SelectorFieldPrefix,
  SelectorStrategy,
} from '../types';

const selectorStrategyOptions: NonNullable<BlockField['options']> = [
  { value: 'data-testid', label: 'data-testid' },
  { value: 'name', label: 'name' },
  { value: 'id', label: 'id' },
  { value: 'placeholder', label: 'placeholder' },
  { value: 'text', label: 'text' },
  { value: 'css', label: 'Custom selector' },
];

const selectorFieldDefaults: Record<
  SelectorFieldPrefix,
  {
    fallback: string;
    defaultStrategy: SelectorStrategy;
    defaultValue: string;
  }
> = {
  locator: {
    fallback: '[data-testid="submit"]',
    defaultStrategy: 'data-testid',
    defaultValue: 'submit',
  },
  target: {
    fallback: '[data-testid="dashboard-title"]',
    defaultStrategy: 'data-testid',
    defaultValue: 'dashboard-title',
  },
  guard: {
    fallback: '[data-testid="toast-error"]',
    defaultStrategy: 'data-testid',
    defaultValue: 'toast-error',
  },
};

const defaultFreeCode = "await page.waitForLoadState('networkidle');";

function createSelectField(
  key: string,
  label: string,
  value: SelectorStrategy,
  options: NonNullable<BlockField['options']>,
): BlockField {
  return {
    key,
    label,
    value,
    control: 'select',
    options,
  };
}

function selectorValuePlaceholder(strategy: SelectorStrategy, fallback: string) {
  switch (strategy) {
    case 'data-testid':
      return fallback || 'submit-button';
    case 'name':
      return fallback || 'email';
    case 'id':
      return fallback || 'submit-login';
    case 'placeholder':
      return fallback || 'Email address';
    case 'text':
      return fallback || 'Continue';
    case 'css':
    default:
      return fallback || '[data-testid="submit"]';
  }
}

function createSelectorFields(
  prefix: SelectorFieldPrefix,
  strategy: SelectorStrategy,
  value: string,
  fallback: string,
): BlockField[] {
  return [
    createSelectField(`${prefix}Kind`, 'Find by', strategy, selectorStrategyOptions),
    {
      key: `${prefix}Value`,
      label: strategy === 'css' ? 'Selector' : 'Value',
      value,
      placeholder: selectorValuePlaceholder(strategy, fallback),
    },
  ];
}

function getFieldValue(fields: FlowBlockData['fields'], key: string) {
  return fields.find((field) => field.key === key)?.value || '';
}

function escapeSelectorValue(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function parseSelector(selector?: string): { kind: SelectorStrategy; value: string } | null {
  const raw = String(selector || '').trim();

  if (!raw) {
    return null;
  }

  const attributeMatch = raw.match(/^\[(data-testid|name|id|placeholder)="([^"]*)"\]$/);

  if (attributeMatch) {
    return {
      kind: attributeMatch[1] as SelectorStrategy,
      value: attributeMatch[2],
    };
  }

  const idMatch = raw.match(/^#([a-zA-Z0-9_-]+)$/);

  if (idMatch) {
    return {
      kind: 'id',
      value: idMatch[1],
    };
  }

  if (raw.startsWith('text=')) {
    return {
      kind: 'text',
      value: raw.slice(5),
    };
  }

  return {
    kind: 'css',
    value: raw,
  };
}

function buildSelector(kind: SelectorStrategy | string, value: string, fallback: string) {
  const normalizedValue = String(value || '').trim();

  if (!normalizedValue) {
    return fallback;
  }

  switch (kind) {
    case 'data-testid':
      return `[data-testid="${escapeSelectorValue(normalizedValue)}"]`;
    case 'name':
      return `[name="${escapeSelectorValue(normalizedValue)}"]`;
    case 'id':
      return `[id="${escapeSelectorValue(normalizedValue)}"]`;
    case 'placeholder':
      return `[placeholder="${escapeSelectorValue(normalizedValue)}"]`;
    case 'text':
      return `text=${normalizedValue}`;
    case 'css':
    default:
      return normalizedValue;
  }
}

function readSelectorFieldGroup(prefix: SelectorFieldPrefix, fields: FlowBlockData['fields']) {
  const defaults = selectorFieldDefaults[prefix];
  const parsed = parseSelector(getFieldValue(fields, prefix));
  const explicitKind = getFieldValue(fields, `${prefix}Kind`);
  const explicitValue = getFieldValue(fields, `${prefix}Value`);

  return {
    kind: (explicitKind || parsed?.kind || defaults.defaultStrategy) as SelectorStrategy,
    value: explicitValue || parsed?.value || defaults.defaultValue,
    fallback: defaults.fallback,
  };
}

function normalizeSelectorFields(
  prefix: SelectorFieldPrefix,
  fields: FlowBlockData['fields'],
): FlowBlockData['fields'] {
  const selector = readSelectorFieldGroup(prefix, fields);

  return createSelectorFields(prefix, selector.kind, selector.value, selector.fallback);
}

function normalizeStructuredFields(
  kind: FlowBlockKind,
  fields: FlowBlockData['fields'],
): FlowBlockData['fields'] {
  switch (kind) {
    case 'click':
      return normalizeSelectorFields('locator', fields);
    case 'fill': {
      return [
        ...normalizeSelectorFields('locator', fields),
        {
          key: 'value',
          label: 'Text to fill',
          value: getFieldValue(fields, 'value') || 'qa@example.com',
          placeholder: 'Value or variable',
        },
      ];
    }
    case 'assert': {
      return [
        ...normalizeSelectorFields('target', fields),
        {
          key: 'expectation',
          label: 'Expected text',
          value: getFieldValue(fields, 'expectation') || 'Dashboard',
          placeholder: 'Expected text or condition',
        },
      ];
    }
    case 'extract': {
      return [
        ...normalizeSelectorFields('locator', fields),
        {
          key: 'variable',
          label: 'Variable',
          value: getFieldValue(fields, 'variable') || 'orderCount',
          placeholder: 'camelCase variable',
        },
      ];
    }
    case 'condition': {
      return normalizeSelectorFields('guard', fields);
    }
    case 'code':
    case 'freetext':
      return createCodeField(getFieldValue(fields, 'code') || getFieldValue(fields, 'content') || defaultFreeCode);
    case 'snippet':
      return fields;
    default:
      return fields;
    }
}

export function normalizeNodeData(data: FlowBlockData): FlowBlockData {
  return {
    ...data,
    fields: normalizeStructuredFields(data.kind, cloneFields(data.fields)),
  };
}

export function normalizeNode(node: FlowNode): FlowNode {
  return {
    ...node,
    data: normalizeNodeData(node.data),
  };
}

const templateCatalog: Record<FlowBlockKind, FlowBlockTemplate> = {
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
    fields: createSelectorFields('locator', 'data-testid', 'submit', '[data-testid="submit"]'),
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
      ...createSelectorFields('locator', 'name', 'email', '[name="email"]'),
      {
        key: 'value',
        label: 'Text to fill',
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
      ...createSelectorFields(
        'target',
        'data-testid',
        'dashboard-title',
        '[data-testid="dashboard-title"]',
      ),
      {
        key: 'expectation',
        label: 'Expected text',
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
      ...createSelectorFields(
        'locator',
        'data-testid',
        'order-count',
        '[data-testid="order-count"]',
      ),
      {
        key: 'variable',
        label: 'Variable',
        value: 'orderCount',
        placeholder: 'camelCase variable',
      },
    ],
  },
  code: {
    kind: 'code',
    category: 'action',
    title: 'Run code',
    description: 'Execute custom Playwright code.',
    accent: '#8c8274',
    codeLabel: 'custom code',
    status: 'draft',
    fields: [
      {
        key: 'code',
        label: 'Code',
        value: defaultFreeCode,
        placeholder: "await page.locator('[data-testid=\"target\"]').click();",
        multiline: true,
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
    fields: createSelectorFields('guard', 'data-testid', 'toast-error', '[data-testid="toast-error"]'),
  },
  freetext: {
    kind: 'freetext',
    category: 'action',
    title: 'Free code',
    description: 'Run any Playwright code inline.',
    accent: '#8c8274',
    codeLabel: 'custom code',
    status: 'draft',
    fields: [
      {
        key: 'code',
        label: 'Code',
        value: defaultFreeCode,
        placeholder: "await page.locator('[data-testid=\"target\"]').click();",
        multiline: true,
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
  return source.map((field) => ({
    ...field,
    ...(field.options ? { options: field.options.map((option) => ({ ...option })) } : {}),
  }));
}

function createCodeField(value: string): BlockField[] {
  return [
    {
      key: 'code',
      label: 'Code',
      value,
      placeholder: "await page.locator('[data-testid=\"target\"]').click();",
      multiline: true,
    },
  ];
}

function unwrapQuotedValue(source: string) {
  const trimmed = String(source || '').trim();

  if (trimmed.length < 2) {
    return trimmed;
  }

  const quote = trimmed[0];

  if (!['"', "'", '`'].includes(quote) || trimmed[trimmed.length - 1] !== quote) {
    return trimmed;
  }

  if (quote === '"') {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
  }

  if (quote === "'") {
    return trimmed.slice(1, -1).replace(/\\'/g, "'").replace(/\\\\/g, '\\');
  }

  return trimmed.slice(1, -1).replace(/\\`/g, '`').replace(/\\\\/g, '\\');
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

function parseSnippetStep(stepCode?: string): {
  kind: FlowBlockKind;
  fields: FlowBlockData['fields'];
} {
  const source = String(stepCode || '').trim();

  if (!source) {
    return {
      kind: 'code',
      fields: createCodeField(''),
    };
  }

  const navigateMatch = source.match(/^await\s+page\.goto\((.+?)\);?$/s);

  if (navigateMatch) {
    return {
      kind: 'navigate',
      fields: [
        {
          key: 'url',
          label: 'URL',
          value: unwrapQuotedValue(navigateMatch[1]),
          placeholder: 'https://app.example.com',
        },
      ],
    };
  }

  const fillMatch = source.match(/^await\s+page\.locator\((.+?)\)\.fill\((.+?)\);?$/s);

  if (fillMatch) {
    const parsedLocator = parseSelector(unwrapQuotedValue(fillMatch[1]));

    return {
      kind: 'fill',
      fields: [
        ...createSelectorFields(
          'locator',
          parsedLocator?.kind ?? 'css',
          parsedLocator?.value ?? unwrapQuotedValue(fillMatch[1]),
          selectorFieldDefaults.locator.fallback,
        ),
        {
          key: 'value',
          label: 'Text to fill',
          value: unwrapQuotedValue(fillMatch[2]),
          placeholder: 'Value or variable',
        },
      ],
    };
  }

  const clickMatch = source.match(/^await\s+page\.locator\((.+?)\)\.click\(\);?$/s);

  if (clickMatch) {
    const parsedLocator = parseSelector(unwrapQuotedValue(clickMatch[1]));

    return {
      kind: 'click',
      fields: createSelectorFields(
        'locator',
        parsedLocator?.kind ?? 'css',
        parsedLocator?.value ?? unwrapQuotedValue(clickMatch[1]),
        selectorFieldDefaults.locator.fallback,
      ),
    };
  }

  const assertMatch = source.match(
    /^await\s+expect\(page\.locator\((.+?)\)\)\.toContainText\((.+?)\);?$/s,
  );

  if (assertMatch) {
    const parsedTarget = parseSelector(unwrapQuotedValue(assertMatch[1]));

    return {
      kind: 'assert',
      fields: [
        ...createSelectorFields(
          'target',
          parsedTarget?.kind ?? 'css',
          parsedTarget?.value ?? unwrapQuotedValue(assertMatch[1]),
          selectorFieldDefaults.target.fallback,
        ),
        {
          key: 'expectation',
          label: 'Expected text',
          value: unwrapQuotedValue(assertMatch[2]),
          placeholder: 'Expected text or condition',
        },
      ],
    };
  }

  const extractMatch = source.match(
    /^(?:const|let)\s+([a-zA-Z_$][\w$]*)\s*=\s*await\s+page\.locator\((.+?)\)\.textContent\(\);?$/s,
  );

  if (extractMatch) {
    const parsedLocator = parseSelector(unwrapQuotedValue(extractMatch[2]));

    return {
      kind: 'extract',
      fields: [
        ...createSelectorFields(
          'locator',
          parsedLocator?.kind ?? 'css',
          parsedLocator?.value ?? unwrapQuotedValue(extractMatch[2]),
          selectorFieldDefaults.locator.fallback,
        ),
        {
          key: 'variable',
          label: 'Variable',
          value: extractMatch[1],
          placeholder: 'camelCase variable',
        },
      ],
    };
  }

  const conditionMatch = source.match(
    /^if\s*\(\s*await\s+page\.locator\((.+?)\)\.isVisible\(\)\s*\)\s*\{/s,
  );

  if (conditionMatch) {
    const parsedGuard = parseSelector(unwrapQuotedValue(conditionMatch[1]));

    return {
      kind: 'condition',
      fields: createSelectorFields(
        'guard',
        parsedGuard?.kind ?? 'css',
        parsedGuard?.value ?? unwrapQuotedValue(conditionMatch[1]),
        selectorFieldDefaults.guard.fallback,
      ),
    };
  }

  const loopMatch = source.match(
    /^for\s*\(\s*const\s+([a-zA-Z_$][\w$]*)\s+of\s+([^)]+)\)\s*\{/s,
  );

  if (loopMatch) {
    return {
      kind: 'loop',
      fields: [
        {
          key: 'collection',
          label: 'Collection',
          value: loopMatch[2].trim(),
          placeholder: 'rows',
        },
        {
          key: 'alias',
          label: 'Alias',
          value: loopMatch[1],
          placeholder: 'row',
        },
      ],
    };
  }

  return {
    kind: 'code',
    fields: createCodeField(stepCode || ''),
  };
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
    case 'code':
      return defaultFreeCode;
    case 'freetext':
      return defaultFreeCode;
    case 'snippet':
      return defaultFreeCode;
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
  const baseFields = overrides.fields ? cloneFields(overrides.fields) : cloneFields(template.fields);

  return {
    id: crypto.randomUUID(),
    type: 'flow',
    position,
    data: {
      ...template,
      ...overrides,
      fields: normalizeStructuredFields(kind, baseFields),
      snippetCode: overrides.snippetCode ?? template.snippetCode,
    },
  };
}

export function createSnippetStepNode(
  stepCode: string,
  position: { x: number; y: number },
  overrides: Partial<FlowBlockData> = {},
): FlowNode {
  const parsed = parseSnippetStep(stepCode);

  return createFlowNode(parsed.kind, position, {
    status: 'ready',
    ...overrides,
    fields: overrides.fields ? cloneFields(overrides.fields) : parsed.fields,
  });
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
  const locatorField = readSelectorFieldGroup('locator', node.data.fields);
  const targetField = readSelectorFieldGroup('target', node.data.fields);
  const guardField = readSelectorFieldGroup('guard', node.data.fields);
  const locator = buildSelector(locatorField.kind, locatorField.value, locatorField.fallback);
  const target = buildSelector(targetField.kind, targetField.value, targetField.fallback);
  const guard = buildSelector(guardField.kind, guardField.value, guardField.fallback);

  const renderRawCode = (content: string, fallback: string) => {
    const normalized = String(content || '').trimEnd();

    if (!normalized) {
      return [fallback];
    }

    return normalized.split('\n').map((line) => line.trimEnd());
  };

  switch (node.data.kind) {
    case 'navigate':
      return [`await page.goto(${q(fields.url || 'https://example.com')});`];
    case 'click':
      return [`await page.locator(${q(locator)}).click();`];
    case 'fill':
      return [`await page.locator(${q(locator)}).fill(${q(fields.value || '')});`];
    case 'assert':
      return [
        `await expect(page.locator(${q(target)})).toContainText(${q(
          fields.expectation || 'Expected text',
        )});`,
      ];
    case 'extract':
      return [
        `const ${safeIdentifier(fields.variable || 'value')} = await page.locator(${q(
          locator,
        )}).textContent();`,
      ];
    case 'code': {
      return renderRawCode(fields.code, '// Custom code');
    }
    case 'condition':
      return [
        `if (await page.locator(${q(guard)}).isVisible()) {`,
        '  // Attach branch blocks to this condition in the flow editor.',
        '}',
      ];
    case 'freetext': {
      return renderRawCode(fields.code, '// Custom code');
    }
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

export function serializeNodeToCode(node: FlowNode) {
  return renderNode(node).join('\n');
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
  'freetext',
] as const;

export const blockCatalog = templateCatalog;
