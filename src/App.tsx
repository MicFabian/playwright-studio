import {
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  type EdgeTypes,
  type ReactFlowInstance,
  Controls,
  type EdgeChange,
  MiniMap,
  type NodeChange,
  type NodeTypes,
  Panel,
  ReactFlow,
  ReactFlowProvider,
} from '@xyflow/react';
import { FlowNodeCard } from './components/FlowNodeCard';
import { InsertionEdge } from './components/InsertionEdge';
import { Inspector } from './components/Inspector';
import { SideRail } from './components/SideRail';
import {
  commitWorkspace,
  createSnippet as createPersistedSnippet,
  createTest as createPersistedTest,
  getTestRun,
  initGitRepo,
  loadWorkspace as fetchWorkspace,
  saveSnippet as persistSnippet,
  saveTest as persistTest,
  startTestRun,
  stageWorkspaceFiles,
} from './lib/workspaceClient';
import {
  blockCatalog,
  blockLibrary,
  createSnippetStepCodeFromBlock,
  createSnippetStepNode,
  createConnectedEdge,
  createFlowNode,
  createSnippetNode,
  generatePlaywrightSpec,
  normalizeNode,
  serializeNodeToCode,
  splitSnippetCodeIntoSteps,
} from './lib/flow';
import type {
  FlowBlockKind,
  FlowEdge,
  FlowNode,
  SnippetItem,
  TestRun,
  WorkspaceData,
} from './types';

const QUICK_INSERT_MIME = 'application/x-playwright-lowcode-item';

type QuickInsertDragPayload =
  | {
      type: 'block';
      kind: FlowBlockKind;
    }
  | {
      type: 'snippet';
      snippetId: string;
    };

function AppShell() {
  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null);
  const [activeTestId, setActiveTestId] = useState<string | null>(null);
  const [activeSnippetId, setActiveSnippetId] = useState<string | null>(null);
  const [nodes, setNodes] = useState<FlowNode[]>([]);
  const [edges, setEdges] = useState<FlowEdge[]>([]);
  const [dirtyTests, setDirtyTests] = useState<Record<string, boolean>>({});
  const [dirtySnippets, setDirtySnippets] = useState<Record<string, boolean>>({});
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance<
    FlowNode,
    FlowEdge
  > | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>(
    'idle',
  );
  const [snippetSaveState, setSnippetSaveState] = useState<
    'idle' | 'saving' | 'saved' | 'error'
  >('idle');
  const [clipboardState, setClipboardState] = useState<'idle' | 'copied' | 'error'>(
    'idle',
  );
  const [gitActionState, setGitActionState] = useState<
    'idle' | 'working' | 'success' | 'error'
  >('idle');
  const [gitActionError, setGitActionError] = useState<string | null>(null);
  const [commitMessage, setCommitMessage] = useState('Save low-code workspace');
  const [snippetQuery, setSnippetQuery] = useState('');
  const [runState, setRunState] = useState<TestRun | null>(null);
  const [runStartState, setRunStartState] = useState<'idle' | 'starting' | 'error'>(
    'idle',
  );
  const [runError, setRunError] = useState<string | null>(null);
  const [liveRunMode, setLiveRunMode] = useState(true);
  const [canvasDropActive, setCanvasDropActive] = useState(false);
  const [quickInsertDragging, setQuickInsertDragging] = useState(false);
  const [activeInsertEdgeId, setActiveInsertEdgeId] = useState<string | null>(null);
  const [isCanvasLocked, setIsCanvasLocked] = useState(false);
  const [leftColumnWidth, setLeftColumnWidth] = useState(286);
  const [rightColumnWidth, setRightColumnWidth] = useState(324);
  const [activeResizer, setActiveResizer] = useState<null | 'left' | 'right'>(null);
  const runPollInFlightRef = useRef(false);
  const appShellRef = useRef<HTMLDivElement | null>(null);
  const insertionEdgeStateRef = useRef({
    activeInsertEdgeId: null as string | null,
    quickInsertDragging: false,
    isCanvasLocked: false,
  });
  const insertionEdgeHandlersRef = useRef({
    onInsertDragLeave: (_edgeId: string, _event: ReactDragEvent<HTMLDivElement>) => {},
    onInsertDragOver: (_edgeId: string, _event: ReactDragEvent<HTMLDivElement>) => {},
    onInsertDrop: (_edgeId: string, _event: ReactDragEvent<HTMLDivElement>) => {},
  });
  const updateNodeTitleRef = useRef<(nodeId: string, value: string) => void>(
    () => undefined,
  );
  const updateNodeFieldRef = useRef<
    (nodeId: string, fieldKey: string, value: string) => void
  >(() => undefined);
  const updateSnippetCodeRef = useRef<(id: string, value: string) => void>(
    () => undefined,
  );
  const insertSnippetStepRef = useRef<
    (nodeId: string, position: 'before' | 'after') => void
  >(() => undefined);
  const removeSnippetStepRef = useRef<(nodeId: string) => void>(() => undefined);
  const nodesRef = useRef<FlowNode[]>([]);
  insertionEdgeStateRef.current = {
    activeInsertEdgeId,
    quickInsertDragging,
    isCanvasLocked,
  };

  const activeTest = useMemo(
    () => workspace?.tests.find((test) => test.id === activeTestId) ?? null,
    [workspace, activeTestId],
  );
  const activeTestName = activeTest?.name || 'Untitled flow';
  const selectedSnippet = useMemo(
    () => workspace?.snippets.find((snippet) => snippet.id === activeSnippetId) ?? null,
    [workspace, activeSnippetId],
  );
  const deferredSnippetQuery = useDeferredValue(snippetQuery);
  const normalizedSnippetQuery = deferredSnippetQuery.trim().toLowerCase();
  const filteredSnippets = useMemo(() => {
    if (!workspace) {
      return [];
    }

    if (!normalizedSnippetQuery) {
      return workspace.snippets;
    }

    return workspace.snippets.filter((snippet) =>
      [snippet.name, snippet.description, snippet.filePath || '']
        .join(' ')
        .toLowerCase()
        .includes(normalizedSnippetQuery),
    );
  }, [workspace, normalizedSnippetQuery]);
  const selectedNode = useMemo(
    () => nodes.find((node) => node.selected),
    [nodes],
  );
  const generatedSpec = useMemo(
    () => generatePlaywrightSpec(activeTestName, nodes, edges),
    [activeTestName, nodes, edges],
  );
  const isSnippetCanvasActive = Boolean(activeSnippetId && selectedSnippet);
  const inspectorSelectedNode = isSnippetCanvasActive ? undefined : selectedNode;
  const activeRunStep =
    runState && runState.currentStepIndex != null
      ? runState.stepResults[runState.currentStepIndex] ?? null
      : null;
  const completedRunSteps =
    runState?.stepResults.filter(
      (step) => step.status === 'passed' || step.status === 'failed',
    ).length ?? 0;
  const runSummaryLabel =
    runStartState === 'starting'
      ? 'Starting run'
      : runState?.status === 'queued'
        ? 'Queued'
        : runState?.status === 'running'
          ? 'Running'
          : runState?.status === 'passed'
            ? 'Run passed'
            : runState?.status === 'failed'
              ? 'Run failed'
              : 'Ready to run';
  const runSummaryTone =
    runStartState === 'error' || runState?.status === 'failed'
      ? ' is-error'
      : runState?.status === 'passed'
        ? ' is-success'
        : runStartState === 'starting' ||
            runState?.status === 'queued' ||
            runState?.status === 'running'
          ? ' is-info'
          : '';
  const runProgressLabel = runState
    ? activeRunStep
      ? `Step ${activeRunStep.index + 1}/${runState.totalSteps}`
      : `${completedRunSteps}/${runState.totalSteps} done`
    : nodes.length > 0
      ? `${nodes.length} blocks`
      : 'No blocks';
  const formatFlowPathLabel = (filePath: string) => {
    const fileNameFromPath = (path: string) => {
      const normalized = path.split('/').filter(Boolean);
      return normalized[normalized.length - 1] || path;
    };
    const normalizedPath = filePath.split('\\').join('/');
    const normalizedTestsDir = workspace?.project.paths.testsDir
      .split('\\')
      .join('/')
      .replace(/\/+$/, '');

    if (
      normalizedTestsDir &&
      (normalizedPath === normalizedTestsDir ||
        normalizedPath.startsWith(`${normalizedTestsDir}/`))
    ) {
      return fileNameFromPath(normalizedPath);
    }

    return fileNameFromPath(normalizedPath);
  };
  const isActiveTestDirty = activeTestId ? Boolean(dirtyTests[activeTestId]) : false;
  const isActiveSnippetDirty = activeSnippetId
    ? Boolean(dirtySnippets[activeSnippetId])
    : false;
  const saveLabel =
    saveState === 'saving'
      ? 'Saving…'
      : saveState === 'saved'
        ? 'Saved'
        : saveState === 'error'
          ? 'Retry save'
          : isActiveTestDirty
            ? 'Save flow'
            : 'Saved';
  const saveStatusLabel = isActiveTestDirty
    ? 'Unsaved edits'
    : saveState === 'saved'
      ? 'Saved to disk'
      : 'In sync';
  const copyLabel =
    clipboardState === 'copied'
      ? 'Spec copied'
      : clipboardState === 'error'
        ? 'Copy failed'
        : 'Copy spec';
  const saveDisabled =
    !activeTest || (!isActiveTestDirty && saveState !== 'error') || saveState === 'saving';
  const snippetSaveDisabled =
    !selectedSnippet ||
    (!isActiveSnippetDirty && snippetSaveState !== 'error') ||
    snippetSaveState === 'saving';
  const snippetSaveLabel =
    snippetSaveState === 'saving'
      ? 'Saving…'
      : snippetSaveState === 'saved'
        ? 'Snippet saved'
        : snippetSaveState === 'error'
          ? 'Retry save'
          : isActiveSnippetDirty
            ? 'Save snippet'
            : 'Saved';
  const snippetSaveStatusLabel = isActiveSnippetDirty
    ? 'Unsaved snippet'
    : snippetSaveState === 'saved'
      ? 'Snippet saved'
      : 'In sync';
  const appShellStyle = useMemo(
    () =>
      ({
        '--left-column-width': `${leftColumnWidth}px`,
        '--right-column-width': `${rightColumnWidth}px`,
      }) as CSSProperties,
    [leftColumnWidth, rightColumnWidth],
  );

  const persistedNodeSignature = (node: FlowNode) => {
    const normalizedNode = normalizeNode(node);

    return {
      id: normalizedNode.id,
      type: normalizedNode.type,
      position: normalizedNode.position,
      data: normalizedNode.data,
    };
  };

  const persistedEdgeSignature = (edge: FlowEdge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: edge.type,
    animated: edge.animated ?? false,
  });

  const persistedFlowSignature = (nextNodes: FlowNode[], nextEdges: FlowEdge[]) =>
    JSON.stringify({
      nodes: nextNodes.map(persistedNodeSignature),
      edges: nextEdges.map(persistedEdgeSignature),
    });

  const isSnippetPersistedEqual = (left: SnippetItem, right: SnippetItem) =>
    left.name === right.name &&
    left.description === right.description &&
    left.code === right.code &&
    left.filePath === right.filePath &&
    left.updatedAt === right.updatedAt &&
    left.params.length === right.params.length &&
    left.params.every((param, index) => param === right.params[index]);

  const activeTestSignature = useMemo(
    () =>
      activeTest
        ? persistedFlowSignature(activeTest.nodes, activeTest.edges)
        : null,
    [activeTest],
  );

  const isSnippetStepNode = (node: FlowNode) => Boolean(node.data.snippetStep);

  const isPersistedNodeChange = (change: NodeChange<FlowNode>) => {
    switch (change.type) {
      case 'add':
      case 'remove':
      case 'replace':
      case 'position':
        return true;
      default:
        return false;
    }
  };

  const isPersistedEdgeChange = (change: EdgeChange<FlowEdge>) => {
    switch (change.type) {
      case 'add':
      case 'remove':
      case 'replace':
        return true;
      default:
        return false;
    }
  };

  const getSnippetStepCode = (node: FlowNode) => serializeNodeToCode(node);

  const orderSnippetStepNodes = (sourceNodes: FlowNode[]) =>
    sourceNodes
      .filter(isSnippetStepNode)
      .sort((left, right) => {
        const leftIndex =
          typeof left.data.snippetStepIndex === 'number'
            ? left.data.snippetStepIndex
            : Number.MAX_SAFE_INTEGER;
        const rightIndex =
          typeof right.data.snippetStepIndex === 'number'
            ? right.data.snippetStepIndex
            : Number.MAX_SAFE_INTEGER;

        if (leftIndex !== rightIndex) {
          return leftIndex - rightIndex;
        }

        if (left.position.x !== right.position.x) {
          return left.position.x - right.position.x;
        }

        return left.position.y - right.position.y;
      });

  const serializeSnippetStepNodes = (sourceNodes: FlowNode[]) => {
    const ordered = orderSnippetStepNodes(sourceNodes);

    if (ordered.length === 0) {
      return '';
    }

    const values = ordered.map((node) => getSnippetStepCode(node).trimEnd());

    if (values.every((value) => value.length === 0)) {
      return '';
    }

    return values.join('\n\n');
  };

  const buildSnippetStepNodes = (
    snippet: SnippetItem,
    sourceNodes: FlowNode[],
    preferredSelectedIndex?: number,
  ) => {
    const orderedCurrent = orderSnippetStepNodes(sourceNodes);
    const currentSelectedIndex = orderedCurrent.findIndex((node) => node.selected);
    const stepValues = splitSnippetCodeIntoSteps(snippet.code);
    const selectedIndexBase =
      preferredSelectedIndex ?? (currentSelectedIndex >= 0 ? currentSelectedIndex : 0);
    const selectedIndex = Math.max(
      0,
      Math.min(selectedIndexBase, stepValues.length - 1),
    );

    return stepValues.map((stepValue, index) => {
      const existingNode = orderedCurrent[index];
      const position = existingNode?.position ?? {
        x: 132 + index * 294,
        y: 220 + (index % 2) * 14,
      };
      const node = createSnippetStepNode(stepValue, position, {
        snippetRef: snippet.id,
        snippetStep: true,
        snippetStepIndex: index,
      });

      return {
        ...node,
        id: existingNode?.id ?? `${snippet.id}-step-${index}-${crypto.randomUUID().slice(0, 8)}`,
        position,
        selected: index === selectedIndex,
      };
    });
  };

  const buildSnippetStepEdges = (stepNodes: FlowNode[]): FlowEdge[] =>
    stepNodes.slice(1).map((node, index) => ({
      id: `${stepNodes[index].id}::${node.id}`,
      source: stepNodes[index].id,
      target: node.id,
      type: 'smoothstep',
      animated: true,
    }));

  const loadSnippetCanvas = (snippet: SnippetItem, preferredSelectedIndex?: number) => {
    const nextNodes = buildSnippetStepNodes(
      snippet,
      nodesRef.current,
      preferredSelectedIndex,
    );
    setNodes(nextNodes);
    setEdges(buildSnippetStepEdges(nextNodes));
  };

  useEffect(() => {
    void hydrateWorkspace();
  }, []);

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  useEffect(() => {
    if (clipboardState !== 'copied') {
      return;
    }

    const timeout = window.setTimeout(() => setClipboardState('idle'), 1600);
    return () => window.clearTimeout(timeout);
  }, [clipboardState]);

  useEffect(() => {
    if (saveState !== 'saved') {
      return;
    }

    const timeout = window.setTimeout(() => setSaveState('idle'), 1600);
    return () => window.clearTimeout(timeout);
  }, [saveState]);

  useEffect(() => {
    if (snippetSaveState !== 'saved') {
      return;
    }

    const timeout = window.setTimeout(() => setSnippetSaveState('idle'), 1600);
    return () => window.clearTimeout(timeout);
  }, [snippetSaveState]);

  useEffect(() => {
    if (gitActionState !== 'success') {
      return;
    }

    const timeout = window.setTimeout(() => setGitActionState('idle'), 1600);
    return () => window.clearTimeout(timeout);
  }, [gitActionState]);

  useEffect(() => {
    if (!isSnippetCanvasActive || !selectedSnippet) {
      return;
    }

    const currentNodes = nodesRef.current;
    const currentCode = serializeSnippetStepNodes(currentNodes);

    if (
      currentNodes.length > 0 &&
      currentNodes.every(isSnippetStepNode) &&
      currentCode === (selectedSnippet.code || '')
    ) {
      return;
    }

    loadSnippetCanvas(selectedSnippet);
  }, [isSnippetCanvasActive, selectedSnippet?.id, selectedSnippet?.code]);

  useEffect(() => {
    if (!runState || (runState.status !== 'queued' && runState.status !== 'running')) {
      return;
    }

    let stopped = false;
    let timeoutId: number | null = null;

    const poll = async () => {
      if (stopped || runPollInFlightRef.current) {
        return;
      }

      runPollInFlightRef.current = true;

      try {
        await refreshRun(runState.id);
      } finally {
        runPollInFlightRef.current = false;

        if (!stopped) {
          timeoutId = window.setTimeout(() => {
            void poll();
          }, 700);
        }
      }
    };

    void poll();

    return () => {
      stopped = true;
      runPollInFlightRef.current = false;

      if (timeoutId != null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [runState?.id, runState?.status]);

  useEffect(() => {
    if (!reactFlowInstance || !activeTestId || nodes.length === 0) {
      return;
    }

    window.requestAnimationFrame(() => {
      void reactFlowInstance.fitView({
        padding: 0.22,
        duration: 260,
        maxZoom: 1.02,
        minZoom: 0.45,
      });
    });
  }, [reactFlowInstance, activeTestId]);

  useEffect(() => {
    if (!activeResizer) {
      return;
    }

    const appShellElement = appShellRef.current;

    if (!appShellElement) {
      return;
    }

    const minLeft = 244;
    const maxLeft = 460;
    const minRight = 280;
    const maxRight = 520;

    const onMouseMove = (event: MouseEvent) => {
      const bounds = appShellElement.getBoundingClientRect();

      if (activeResizer === 'left') {
        const nextWidth = Math.min(
          maxLeft,
          Math.max(minLeft, event.clientX - bounds.left),
        );
        setLeftColumnWidth(nextWidth);
        return;
      }

      const nextWidth = Math.min(
        maxRight,
        Math.max(minRight, bounds.right - event.clientX),
      );
      setRightColumnWidth(nextWidth);
    };

    const onMouseUp = () => {
      setActiveResizer(null);
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [activeResizer]);

  async function hydrateWorkspace(preferredTestId?: string) {
    setLoadState('loading');

    try {
      const loaded = await fetchWorkspace();
      const normalizedTests = loaded.tests.map((test) => ({
        ...test,
        nodes: test.nodes.map(normalizeNode),
      }));
      const nextActiveId =
        preferredTestId && normalizedTests.some((test) => test.id === preferredTestId)
          ? preferredTestId
          : normalizedTests[0]?.id ?? null;
      const nextActiveTest =
        normalizedTests.find((test) => test.id === nextActiveId) ?? null;

      setWorkspace({
        ...loaded,
        tests: normalizedTests,
      });
      setActiveTestId(nextActiveId);
      setNodes(nextActiveTest?.nodes ?? []);
      setEdges(nextActiveTest?.edges ?? []);
      setDirtyTests(Object.fromEntries(normalizedTests.map((test) => [test.id, false])));
      setDirtySnippets(
        Object.fromEntries(loaded.snippets.map((snippet) => [snippet.id, false])),
      );
      setActiveSnippetId((current) =>
        current && loaded.snippets.some((snippet) => snippet.id === current)
          ? current
          : null,
      );
      setLoadError(null);
      setLoadState('ready');
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Failed to load workspace');
      setLoadState('error');
    }
  }

  function updateActiveTest(nextNodes: FlowNode[], nextEdges: FlowEdge[], dirty: boolean) {
    const nextSignature = dirty ? persistedFlowSignature(nextNodes, nextEdges) : null;
    const shouldMarkDirty = dirty && nextSignature !== activeTestSignature;

    setNodes(nextNodes);
    setEdges(nextEdges);

    if (isSnippetCanvasActive) {
      return;
    }

    if (!activeTestId) {
      return;
    }

    if (!shouldMarkDirty) {
      return;
    }

    setWorkspace((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        tests: current.tests.map((test) =>
          test.id === activeTestId
            ? {
                ...test,
                steps: nextNodes.length,
                nodes: nextNodes,
                edges: nextEdges,
              }
            : test,
        ),
      };
    });

    setDirtyTests((current) => ({
      ...current,
      [activeTestId]: true,
    }));
    setSaveState('idle');
  }

  function selectTest(testId: string) {
    const nextTest = workspace?.tests.find((test) => test.id === testId) ?? null;

    if (activeTestId === testId && !isSnippetCanvasActive) {
      return;
    }

    setActiveTestId(testId);
    setActiveSnippetId(null);
    setNodes(nextTest?.nodes ?? []);
    setEdges(nextTest?.edges ?? []);
    setSaveState('idle');
    setRunState((current) => (current?.testId === testId ? current : null));
    setRunError(null);
    setRunStartState('idle');
  }

  function nextPosition() {
    if (nodes.length === 0) {
      return {
        x: 120,
        y: 160,
      };
    }

    if (selectedNode) {
      return {
        x: selectedNode.position.x + 320,
        y: selectedNode.position.y + 24,
      };
    }

    const rightMost = nodes.reduce(
      (accumulator, node) =>
        node.position.x > accumulator.position.x ? node : accumulator,
      nodes[0],
    );

    return {
      x: rightMost.position.x + 280,
      y: 112 + ((nodes.length + 1) % 3) * 172,
    };
  }

  function resolveSnippetInsertIndexByX(flowX: number) {
    const ordered = orderSnippetStepNodes(nodes);

    if (ordered.length === 0) {
      return 0;
    }

    for (let index = 0; index < ordered.length; index += 1) {
      const node = ordered[index];
      const centerX = node.position.x + 140;

      if (flowX < centerX) {
        return index;
      }
    }

    return ordered.length;
  }

  function insertSnippetStepValues(stepValues: string[], preferredInsertIndex?: number) {
    if (!isSnippetCanvasActive || !selectedSnippet || stepValues.length === 0) {
      return;
    }

    const ordered = orderSnippetStepNodes(nodes);
    const selectedIndex = ordered.findIndex((node) => node.selected);
    const nextValues = ordered.map((node) => getSnippetStepCode(node));
    const fallbackInsertIndex = selectedIndex >= 0 ? selectedIndex + 1 : nextValues.length;
    const insertIndex = Math.max(
      0,
      Math.min(preferredInsertIndex ?? fallbackInsertIndex, nextValues.length),
    );
    const normalizedStepValues = stepValues.map((value) => value.trimEnd());
    nextValues.splice(insertIndex, 0, ...normalizedStepValues);

    const nextCode = nextValues.join('\n\n');

    updateWorkspaceSnippet(selectedSnippet.id, (snippet) => ({
      ...snippet,
      code: nextCode,
    }));
    loadSnippetCanvas(
      {
        ...selectedSnippet,
        code: nextCode,
      },
      insertIndex,
    );
  }

  function focusFlow() {
    if (!reactFlowInstance || nodes.length === 0) {
      return;
    }

    window.requestAnimationFrame(() => {
      void reactFlowInstance.fitView({
        padding: 0.22,
        duration: 260,
        maxZoom: 1.02,
        minZoom: 0.45,
      });
    });
  }

  function appendNode(nextNode: FlowNode) {
    const nextNodes = nodes
      .map((node) => ({ ...node, selected: false }))
      .concat({
        ...nextNode,
        selected: true,
      });
    const nextEdges = selectedNode
      ? edges.concat({
          id: crypto.randomUUID(),
          source: selectedNode.id,
          target: nextNode.id,
          type: 'smoothstep',
          animated: true,
        })
      : edges;

    updateActiveTest(nextNodes, nextEdges, true);
  }

  function createInteractiveEdge(source: string, target: string): FlowEdge {
    return {
      id: crypto.randomUUID(),
      source,
      target,
      type: 'smoothstep',
      animated: true,
    };
  }

  function endQuickInsertDrag() {
    setQuickInsertDragging(false);
    setCanvasDropActive(false);
    setActiveInsertEdgeId(null);
  }

  function beginQuickInsertDrag(
    event: ReactDragEvent<HTMLButtonElement>,
    payload: QuickInsertDragPayload,
  ) {
    if (!activeTestId && !isSnippetCanvasActive) {
      event.preventDefault();
      return;
    }

    event.dataTransfer.effectAllowed = 'copy';
    const serialized = JSON.stringify(payload);
    event.dataTransfer.setData(QUICK_INSERT_MIME, serialized);
    event.dataTransfer.setData('text/plain', serialized);
    setQuickInsertDragging(true);
    setActiveInsertEdgeId(null);
  }

  function readQuickInsertPayload(
    event: ReactDragEvent<HTMLDivElement>,
  ): QuickInsertDragPayload | null {
    const serialized =
      event.dataTransfer.getData(QUICK_INSERT_MIME) ||
      event.dataTransfer.getData('text/plain');

    if (!serialized) {
      return null;
    }

    try {
      const parsed = JSON.parse(serialized) as Partial<QuickInsertDragPayload>;

      if (
        parsed.type === 'block' &&
        typeof parsed.kind === 'string' &&
        blockLibrary.includes(parsed.kind as (typeof blockLibrary)[number])
      ) {
        return {
          type: 'block',
          kind: parsed.kind as FlowBlockKind,
        };
      }

      if (parsed.type === 'snippet' && typeof parsed.snippetId === 'string') {
        return {
          type: 'snippet',
          snippetId: parsed.snippetId,
        };
      }
    } catch {
      return null;
    }

    return null;
  }

  function handleCanvasDragOver(event: ReactDragEvent<HTMLDivElement>) {
    if (isCanvasLocked || (!activeTestId && !isSnippetCanvasActive)) {
      return;
    }

    const hasQuickInsertPayload =
      event.dataTransfer.types.includes(QUICK_INSERT_MIME) ||
      event.dataTransfer.types.includes('text/plain');

    if (!hasQuickInsertPayload) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';

    if (!canvasDropActive) {
      setCanvasDropActive(true);
    }
  }

  function handleCanvasDragLeave(event: ReactDragEvent<HTMLDivElement>) {
    const nextTarget = event.relatedTarget;

    if (
      nextTarget instanceof Node &&
      event.currentTarget.contains(nextTarget)
    ) {
      return;
    }

    setCanvasDropActive(false);
  }

  function handleCanvasDrop(event: ReactDragEvent<HTMLDivElement>) {
    event.preventDefault();
    endQuickInsertDrag();

    if (!reactFlowInstance || isCanvasLocked || (!activeTestId && !isSnippetCanvasActive)) {
      return;
    }

    const payload = readQuickInsertPayload(event);

    if (!payload) {
      return;
    }

    const flowPosition = reactFlowInstance.screenToFlowPosition({
      x: event.clientX,
      y: event.clientY,
    });
    const snappedPosition = {
      x: Math.round(flowPosition.x / 24) * 24,
      y: Math.round(flowPosition.y / 24) * 24,
    };

    if (isSnippetCanvasActive && selectedSnippet) {
      const insertIndex = resolveSnippetInsertIndexByX(flowPosition.x);

      if (payload.type === 'block') {
        insertSnippetStepValues([createSnippetStepCodeFromBlock(payload.kind)], insertIndex);
        return;
      }

      const snippet = workspace?.snippets.find(
        (entry) => entry.id === payload.snippetId,
      );

      if (!snippet) {
        return;
      }

      insertSnippetStepValues(splitSnippetCodeIntoSteps(snippet.code), insertIndex);
      return;
    }

    setActiveSnippetId(null);

    if (payload.type === 'block') {
      appendNode(createFlowNode(payload.kind, snappedPosition));
      return;
    }

    const snippet = workspace?.snippets.find(
      (entry) => entry.id === payload.snippetId,
    );

    if (!snippet) {
      return;
    }

    appendNode(createSnippetNode(snippet, snappedPosition));
  }

  function handleInsertEdgeDragOver(
    edgeId: string,
    event: ReactDragEvent<HTMLDivElement>,
  ) {
    if (isCanvasLocked || (!activeTestId && !isSnippetCanvasActive)) {
      return;
    }

    const payload = readQuickInsertPayload(event);

    if (!payload) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
    setCanvasDropActive(false);

    if (activeInsertEdgeId !== edgeId) {
      setActiveInsertEdgeId(edgeId);
    }
  }

  function handleInsertEdgeDragLeave(
    edgeId: string,
    event: ReactDragEvent<HTMLDivElement>,
  ) {
    event.stopPropagation();

    const nextTarget = event.relatedTarget;

    if (
      nextTarget instanceof Node &&
      event.currentTarget.contains(nextTarget)
    ) {
      return;
    }

    if (activeInsertEdgeId === edgeId) {
      setActiveInsertEdgeId(null);
    }
  }

  function handleInsertOnEdge(
    edgeId: string,
    event: ReactDragEvent<HTMLDivElement>,
  ) {
    event.preventDefault();
    event.stopPropagation();

    const payload = readQuickInsertPayload(event);
    endQuickInsertDrag();

    if (!payload) {
      return;
    }

    const edge = edges.find((entry) => entry.id === edgeId);

    if (!edge) {
      return;
    }

    if (isSnippetCanvasActive && selectedSnippet) {
      const ordered = orderSnippetStepNodes(nodes);
      const targetIndex = ordered.findIndex((node) => node.id === edge.target);
      const sourceIndex = ordered.findIndex((node) => node.id === edge.source);
      const insertIndex =
        targetIndex >= 0 ? targetIndex : sourceIndex >= 0 ? sourceIndex + 1 : undefined;

      if (payload.type === 'block') {
        insertSnippetStepValues(
          [createSnippetStepCodeFromBlock(payload.kind)],
          insertIndex,
        );
        return;
      }

      const snippet = workspace?.snippets.find(
        (entry) => entry.id === payload.snippetId,
      );

      if (!snippet) {
        return;
      }

      insertSnippetStepValues(
        splitSnippetCodeIntoSteps(snippet.code),
        insertIndex,
      );
      return;
    }

    const sourceNode = nodes.find((node) => node.id === edge.source);
    const targetNode = nodes.find((node) => node.id === edge.target);

    if (!sourceNode || !targetNode) {
      return;
    }

    const nextPosition = {
      x: Math.round(((sourceNode.position.x + targetNode.position.x) / 2) / 24) * 24,
      y: Math.round(((sourceNode.position.y + targetNode.position.y) / 2) / 24) * 24,
    };
    const insertedNode =
      payload.type === 'block'
        ? createFlowNode(payload.kind, nextPosition)
        : (() => {
            const snippet = workspace?.snippets.find(
              (entry) => entry.id === payload.snippetId,
            );
            return snippet ? createSnippetNode(snippet, nextPosition) : null;
          })();

    if (!insertedNode) {
      return;
    }

    const nextNodes = nodes
      .map((node) => ({ ...node, selected: false }))
      .concat({
        ...insertedNode,
        selected: true,
      });
    const remainingEdges = edges.filter((entry) => entry.id !== edgeId);
    const nextEdges = remainingEdges.concat([
      createInteractiveEdge(edge.source, insertedNode.id),
      createInteractiveEdge(insertedNode.id, edge.target),
    ]);

    updateActiveTest(nextNodes, nextEdges, true);
  }

  function handleAddBlock(kind: FlowBlockKind) {
    if (isCanvasLocked) {
      return;
    }

    if (isSnippetCanvasActive) {
      insertSnippetStepValues([createSnippetStepCodeFromBlock(kind)]);
      return;
    }

    if (!activeTestId) {
      return;
    }

    setActiveSnippetId(null);
    appendNode(createFlowNode(kind, nextPosition()));
  }

  function handleAddSnippet(snippet: SnippetItem) {
    if (isCanvasLocked) {
      return;
    }

    if (isSnippetCanvasActive) {
      insertSnippetStepValues(splitSnippetCodeIntoSteps(snippet.code));
      return;
    }

    if (!activeTestId) {
      return;
    }

    setActiveSnippetId(null);
    appendNode(createSnippetNode(snippet, nextPosition()));
  }

  function syncSnippetCodeFromNodes(nextNodes: FlowNode[]) {
    if (!selectedSnippet) {
      return;
    }

    const nextCode = serializeSnippetStepNodes(nextNodes);

    if (nextCode === (selectedSnippet.code || '')) {
      return;
    }

    updateWorkspaceSnippet(selectedSnippet.id, (snippet) => ({
      ...snippet,
      code: nextCode,
    }));
  }

  function handleEditSnippet(snippetId: string) {
    if (activeSnippetId === snippetId && isSnippetCanvasActive) {
      return;
    }

    setActiveSnippetId(snippetId);
    setRunError(null);
    setRunStartState('idle');
    const snippet = workspace?.snippets.find((entry) => entry.id === snippetId);

    if (!snippet) {
      return;
    }

    loadSnippetCanvas(snippet);
  }

  function handleNodesChange(changes: NodeChange<FlowNode>[]) {
    if (isCanvasLocked) {
      return;
    }

    const nextNodes = applyNodeChanges(changes, nodes);
    const dirty = changes.some(isPersistedNodeChange);

    if (isSnippetCanvasActive) {
      setNodes(nextNodes);

      if (dirty) {
        syncSnippetCodeFromNodes(nextNodes);
      }

      return;
    }

    updateActiveTest(nextNodes, edges, dirty);
  }

  function handleEdgesChange(changes: EdgeChange<FlowEdge>[]) {
    if (isCanvasLocked) {
      return;
    }

    const nextEdges = applyEdgeChanges(changes, edges);
    const dirty = changes.some(isPersistedEdgeChange);

    if (isSnippetCanvasActive) {
      setEdges(nextEdges);
      return;
    }

    updateActiveTest(nodes, nextEdges, dirty);
  }

  function handleUpdateTitle(nodeId: string, value: string) {
    if (selectedSnippet && nodeId === selectedSnippet.id) {
      handleUpdateSnippetName(selectedSnippet.id, value);
      return;
    }

    const nextNodes = nodes.map((node) =>
      node.id === nodeId
        ? {
            ...node,
            data: {
              ...node.data,
              title: value,
            },
          }
        : node,
    );

    updateActiveTest(nextNodes, edges, true);
  }

  function handleUpdateField(nodeId: string, fieldKey: string, value: string) {
    if (isSnippetCanvasActive) {
      const nextNodes = nodes.map((node) =>
        node.id === nodeId
          ? {
              ...node,
              data: {
                ...node.data,
                fields: node.data.fields.map((field) =>
                  field.key === fieldKey ? { ...field, value } : field,
                ),
              },
            }
          : node,
      );

      setNodes(nextNodes);
      syncSnippetCodeFromNodes(nextNodes);
      return;
    }

    if (selectedSnippet && nodeId === selectedSnippet.id) {
      const normalizedValue = value.trim();
      updateWorkspaceSnippet(selectedSnippet.id, (snippet) => ({
        ...snippet,
        params: snippet.params.map((param) =>
          param === fieldKey ? normalizedValue || fieldKey : param,
        ),
      }));
      return;
    }

    const nextNodes = nodes.map((node) =>
      node.id === nodeId
        ? {
            ...node,
            data: {
              ...node.data,
              fields: node.data.fields.map((field) =>
                field.key === fieldKey ? { ...field, value } : field,
              ),
            },
          }
        : node,
    );

    updateActiveTest(nextNodes, edges, true);
  }

  function handleInsertSnippetStep(nodeId: string, position: 'before' | 'after') {
    if (!isSnippetCanvasActive || !selectedSnippet) {
      return;
    }

    const ordered = orderSnippetStepNodes(nodes);
    const currentIndex = ordered.findIndex((node) => node.id === nodeId);

    if (currentIndex < 0) {
      return;
    }

    const nextValues = ordered.map((node) => getSnippetStepCode(node));
    const insertIndex = position === 'before' ? currentIndex : currentIndex + 1;
    nextValues.splice(insertIndex, 0, '');
    const nextCode = nextValues.join('\n\n');

    updateWorkspaceSnippet(selectedSnippet.id, (snippet) => ({
      ...snippet,
      code: nextCode,
    }));
    loadSnippetCanvas(
      {
        ...selectedSnippet,
        code: nextCode,
      },
      insertIndex,
    );
  }

  function handleRemoveSnippetStep(nodeId: string) {
    if (!isSnippetCanvasActive || !selectedSnippet) {
      return;
    }

    const ordered = orderSnippetStepNodes(nodes);
    const currentIndex = ordered.findIndex((node) => node.id === nodeId);

    if (currentIndex < 0) {
      return;
    }

    const nextValues = ordered
      .map((node) => getSnippetStepCode(node))
      .filter((_, index) => index !== currentIndex);
    const normalizedValues = nextValues.length > 0 ? nextValues : [''];
    const nextCode = normalizedValues.join('\n\n');
    const nextSelectedIndex = Math.max(0, Math.min(currentIndex, normalizedValues.length - 1));

    updateWorkspaceSnippet(selectedSnippet.id, (snippet) => ({
      ...snippet,
      code: nextCode,
    }));
    loadSnippetCanvas(
      {
        ...selectedSnippet,
        code: nextCode,
      },
      nextSelectedIndex,
    );
  }

  function updateWorkspaceSnippet(
    snippetId: string,
    transform: (snippet: SnippetItem) => SnippetItem,
  ) {
    let didChange = false;

    setWorkspace((current) => {
      if (!current) {
        return current;
      }

      const nextSnippets = current.snippets.map((snippet) => {
        if (snippet.id !== snippetId) {
          return snippet;
        }

        const nextSnippet = transform(snippet);

        if (!didChange && !isSnippetPersistedEqual(snippet, nextSnippet)) {
          didChange = true;
        }

        return nextSnippet;
      });

      if (!didChange) {
        return current;
      }

      return {
        ...current,
        snippets: nextSnippets,
      };
    });

    if (!didChange) {
      return;
    }

    setDirtySnippets((current) => ({
      ...current,
      [snippetId]: true,
    }));
    setSnippetSaveState('idle');
  }

  function handleUpdateSnippetCode(id: string, value: string) {
    if (selectedSnippet && selectedSnippet.id === id) {
      updateWorkspaceSnippet(id, (snippet) => ({
        ...snippet,
        code: value,
      }));
      return;
    }

    const nextNodes = nodes.map((node) =>
      node.id === id
        ? {
            ...node,
            data: {
              ...node.data,
              snippetCode: value,
            },
          }
        : node,
    );

    updateActiveTest(nextNodes, edges, true);
  }

  function handleUpdateSnippetName(snippetId: string, value: string) {
    if (selectedSnippet && snippetId === selectedSnippet.id && selectedSnippet.name === value) {
      return;
    }

    updateWorkspaceSnippet(snippetId, (snippet) => ({
      ...snippet,
      name: value,
    }));
  }

  function handleUpdateSnippetDescription(snippetId: string, value: string) {
    if (
      selectedSnippet &&
      snippetId === selectedSnippet.id &&
      selectedSnippet.description === value
    ) {
      return;
    }

    updateWorkspaceSnippet(snippetId, (snippet) => ({
      ...snippet,
      description: value,
    }));
  }

  function handleUpdateSnippetParams(snippetId: string, value: string) {
    const normalizedParams = value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);

    if (
      selectedSnippet &&
      snippetId === selectedSnippet.id &&
      selectedSnippet.params.length === normalizedParams.length &&
      selectedSnippet.params.every((param, index) => param === normalizedParams[index])
    ) {
      return;
    }

    updateWorkspaceSnippet(snippetId, (snippet) => ({
      ...snippet,
      params: normalizedParams,
    }));
  }

  async function handleCopySpec() {
    try {
      await navigator.clipboard.writeText(generatedSpec);
      setClipboardState('copied');
    } catch {
      setClipboardState('error');
    }
  }

  async function handleSave() {
    if (!activeTest) {
      return;
    }

    setSaveState('saving');

    try {
      await persistTest({
        ...activeTest,
        steps: nodes.length,
        nodes,
        edges,
      });
      await hydrateWorkspace(activeTest.id);
      setSaveState('saved');
    } catch {
      setSaveState('error');
    }
  }

  async function handleSaveSnippet() {
    if (!selectedSnippet) {
      return;
    }

    setSnippetSaveState('saving');

    try {
      await persistSnippet(selectedSnippet);
      await hydrateWorkspace(activeTestId ?? undefined);
      setActiveSnippetId(selectedSnippet.id);
      setSnippetSaveState('saved');
    } catch {
      setSnippetSaveState('error');
    }
  }

  async function handleCreateTest() {
    try {
      const response = await createPersistedTest('Untitled flow');
      await hydrateWorkspace(response.test.id);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Failed to create flow');
      setLoadState('error');
    }
  }

  async function handleCreateSnippet() {
    try {
      const response = await createPersistedSnippet('Untitled snippet');
      await hydrateWorkspace(activeTestId ?? undefined);
      setActiveSnippetId(response.snippet.id);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Failed to create snippet');
      setLoadState('error');
    }
  }

  async function runGitAction(action: () => Promise<unknown>) {
    setGitActionState('working');
    setGitActionError(null);

    try {
      await action();
      await hydrateWorkspace(activeTestId ?? undefined);
      setGitActionState('success');
    } catch (error) {
      setGitActionState('error');
      setGitActionError(error instanceof Error ? error.message : 'Git action failed');
    }
  }

  function handleGitRefresh() {
    setGitActionError(null);
    setGitActionState('idle');
    void hydrateWorkspace(activeTestId ?? undefined);
  }

  function handleGitInit() {
    void runGitAction(initGitRepo);
  }

  function handleGitStage() {
    void runGitAction(stageWorkspaceFiles);
  }

  function handleGitCommit() {
    if (!commitMessage.trim()) {
      setGitActionState('error');
      setGitActionError('Commit message is required.');
      return;
    }

    void runGitAction(() => commitWorkspace(commitMessage.trim()));
  }

  async function refreshRun(runId: string) {
    try {
      const { run } = await getTestRun(runId);
      setRunState(run);
    } catch (error) {
      setRunError(error instanceof Error ? error.message : 'Failed to refresh run');
    }
  }

  async function handleRunTest() {
    if (
      !activeTestId ||
      nodes.length === 0 ||
      runStartState === 'starting' ||
      runState?.status === 'queued' ||
      runState?.status === 'running'
    ) {
      return;
    }

    setRunStartState('starting');
    setRunError(null);

    try {
      if (activeTest) {
        await persistTest({ ...activeTest, steps: nodes.length, nodes, edges });
        await hydrateWorkspace(activeTest.id);
      }

      const { run } = await startTestRun({
        testId: activeTestId,
        testName: activeTest?.name || 'Untitled flow',
        liveMode: liveRunMode,
        slowMoMs: liveRunMode ? 180 : 0,
      });
      setRunState(run);
      setRunStartState('idle');
    } catch (error) {
      setRunStartState('error');
      setRunError(error instanceof Error ? error.message : 'Failed to start test run');
    }
  }

  updateNodeTitleRef.current = handleUpdateTitle;
  updateNodeFieldRef.current = handleUpdateField;
  updateSnippetCodeRef.current = handleUpdateSnippetCode;
  insertSnippetStepRef.current = handleInsertSnippetStep;
  removeSnippetStepRef.current = handleRemoveSnippetStep;
  insertionEdgeHandlersRef.current = {
    onInsertDragLeave: handleInsertEdgeDragLeave,
    onInsertDragOver: handleInsertEdgeDragOver,
    onInsertDrop: handleInsertOnEdge,
  };

  const nodeTypes = useMemo<NodeTypes>(
    () => ({
      flow: (props) => (
        <FlowNodeCard
          {...props}
          onUpdateTitle={(nodeId, value) =>
            updateNodeTitleRef.current(nodeId, value)
          }
          onUpdateField={(nodeId, fieldKey, value) =>
            updateNodeFieldRef.current(nodeId, fieldKey, value)
          }
          onUpdateSnippetCode={(id, value) =>
            updateSnippetCodeRef.current(id, value)
          }
          onInsertSnippetStep={(nodeId, position) =>
            insertSnippetStepRef.current(nodeId, position)
          }
          onRemoveSnippetStep={(nodeId) =>
            removeSnippetStepRef.current(nodeId)
          }
        />
      ),
    }),
    [],
  );

  const edgeTypes = useMemo<EdgeTypes>(
    () => ({
      smoothstep: (props) => {
        const insertionState = insertionEdgeStateRef.current;
        const insertionHandlers = insertionEdgeHandlersRef.current;

        return (
          <InsertionEdge
            {...props}
            insertionActive={insertionState.activeInsertEdgeId === props.id}
            insertionVisible={
              insertionState.quickInsertDragging && !insertionState.isCanvasLocked
            }
            onInsertDragLeave={insertionHandlers.onInsertDragLeave}
            onInsertDragOver={insertionHandlers.onInsertDragOver}
            onInsertDrop={insertionHandlers.onInsertDrop}
          />
        );
      },
    }),
    [],
  );

  if (loadState === 'loading') {
    return (
      <div className="status-screen">
        <div className="status-screen__card">
          <span className="section-kicker">Opening workspace</span>
          <h1>Loading file-backed flows and Git state</h1>
        </div>
      </div>
    );
  }

  if (loadState === 'error' || !workspace) {
    return (
      <div className="status-screen">
        <div className="status-screen__card">
          <span className="section-kicker">Workspace error</span>
          <h1>{loadError || 'Failed to load workspace'}</h1>
          <button className="primary-button" type="button" onClick={() => hydrateWorkspace()}>
            Reload workspace
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell" ref={appShellRef} style={appShellStyle}>
      <SideRail
        projectName={workspace.project.name}
        testsDir={workspace.project.paths.testsDir}
        tests={workspace.tests}
        snippets={workspace.snippets}
        snippetQuery={snippetQuery}
        activeTest={activeTest}
        activeTestId={activeTestId}
        activeSnippetId={activeSnippetId}
        dirtyTests={dirtyTests}
        dirtySnippets={dirtySnippets}
        gitState={workspace.git}
        gitActionState={gitActionState}
        gitActionError={gitActionError}
        commitMessage={commitMessage}
        onCreateTest={handleCreateTest}
        onCreateSnippet={handleCreateSnippet}
        onSelectTest={selectTest}
        onSnippetQueryChange={setSnippetQuery}
        onCommitMessageChange={setCommitMessage}
        onEditSnippet={handleEditSnippet}
        onGitRefresh={handleGitRefresh}
        onGitInit={handleGitInit}
        onGitStage={handleGitStage}
        onGitCommit={handleGitCommit}
      />

      <div
        aria-label="Resize left column"
        aria-orientation="vertical"
        className={`app-shell__divider app-shell__divider--left${activeResizer === 'left' ? ' is-active' : ''}`}
        role="separator"
        onMouseDown={(event) => {
          event.preventDefault();
          setActiveResizer('left');
        }}
      />

      <main className="canvas-card">
        <div className="canvas-card__header">
          <div className="canvas-card__header-main">
            <div className="canvas-card__intro">
              <span className="section-kicker">Visual editor</span>
              <h2>{isSnippetCanvasActive ? 'Snippet canvas' : 'Flow canvas'}</h2>
              <p>
                {isSnippetCanvasActive && selectedSnippet
                  ? `${selectedSnippet.params.length} params • ${formatFlowPathLabel(
                      selectedSnippet.filePath || `${selectedSnippet.name}.snippet.json`,
                    )}`
                  : activeTest
                  ? `${nodes.length} blocks on canvas • ${formatFlowPathLabel(activeTest.filePath)}`
                  : 'Choose a saved flow from the left rail to load its graph and generated spec.'}
              </p>
            </div>

            <div className="canvas-card__header-actions">
              {!isSnippetCanvasActive && activeTest ? (
                <div aria-live="polite" className="canvas-card__run-hud">
                  <span className={`canvas-status-chip${runSummaryTone}`}>
                    {runSummaryLabel}
                  </span>
                  <span className="canvas-status-chip">{runProgressLabel}</span>
                  {!runState ? (
                    <span className="canvas-status-chip">
                      {liveRunMode ? 'Live browser' : 'Headless'}
                    </span>
                  ) : null}
                  {activeRunStep?.title ? (
                    <span className="canvas-status-chip is-subtle">
                      {activeRunStep.title}
                    </span>
                  ) : null}
                </div>
              ) : null}

              {isSnippetCanvasActive ? (
                <>
                  <span className={`canvas-status-chip${isActiveSnippetDirty ? ' is-warn' : ''}`}>
                    {snippetSaveStatusLabel}
                  </span>
                  <button
                    className="primary-button"
                    disabled={snippetSaveDisabled}
                    type="button"
                    onClick={handleSaveSnippet}
                  >
                    {snippetSaveLabel}
                  </button>
                </>
              ) : (
                <>
                  <span className={`canvas-status-chip${isActiveTestDirty ? ' is-warn' : ''}`}>
                    {saveStatusLabel}
                  </span>
                  <button
                    className="ghost-button"
                    disabled={!activeTest}
                    type="button"
                    onClick={focusFlow}
                  >
                    Focus flow
                  </button>
                  <button
                    className="ghost-button"
                    disabled={!activeTest}
                    type="button"
                    onClick={handleCopySpec}
                  >
                    {copyLabel}
                  </button>
                  <button
                    className="primary-button"
                    disabled={saveDisabled}
                    type="button"
                    onClick={handleSave}
                  >
                    {saveLabel}
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="canvas-toolbar">
            <strong className="canvas-toolbar__title">Quick insert</strong>
            <div className="canvas-toolbar__grid">
              {blockLibrary.map((kind) => (
                <button
                  className="block-chip"
                  data-testid={`quick-block-${kind}`}
                  draggable={Boolean(activeTestId || isSnippetCanvasActive)}
                  key={kind}
                  type="button"
                  onDragStart={(event) =>
                    beginQuickInsertDrag(event, {
                      type: 'block',
                      kind,
                    })
                  }
                  onDragEnd={endQuickInsertDrag}
                  onClick={() => handleAddBlock(kind)}
                >
                  <span>{blockCatalog[kind].title}</span>
                  <small>{blockCatalog[kind].codeLabel}</small>
                </button>
              ))}
            </div>

            {workspace.snippets.length > 0 ? (
              <div className="canvas-toolbar__snippets">
                <div className="canvas-toolbar__snippets-header">
                  <span className="section-kicker">Snippets</span>
                  <input
                    aria-label="Filter quick snippets"
                    className="canvas-toolbar__snippet-filter"
                    data-testid="quick-snippet-filter-input"
                    placeholder="Filter snippets"
                    type="text"
                    value={snippetQuery}
                    onChange={(event) => setSnippetQuery(event.target.value)}
                  />
                </div>
                {filteredSnippets.length > 0 ? (
                  <div className="canvas-toolbar__snippet-list">
                    {filteredSnippets.map((snippet) => (
                      <button
                        className="snippet-chip"
                        data-testid={`quick-snippet-chip-${snippet.id}`}
                        draggable={Boolean(activeTestId || isSnippetCanvasActive)}
                        key={snippet.id}
                        type="button"
                        onDragStart={(event) =>
                          beginQuickInsertDrag(event, {
                            type: 'snippet',
                            snippetId: snippet.id,
                          })
                        }
                        onDragEnd={endQuickInsertDrag}
                        onClick={() => handleAddSnippet(snippet)}
                      >
                        <span>{snippet.name}</span>
                        <small>
                          {formatFlowPathLabel(
                            snippet.filePath || `${snippet.name}.snippet.json`,
                          )}
                        </small>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="canvas-toolbar__empty">
                    No snippets match this filter.
                  </p>
                )}
              </div>
            ) : null}
          </div>
        </div>

        <div
          className={`canvas-card__body${canvasDropActive ? ' is-drop-target' : ''}${quickInsertDragging ? ' is-inserting' : ''}${isCanvasLocked ? ' is-locked' : ''}`}
          data-testid="canvas-dropzone"
          onDragLeave={handleCanvasDragLeave}
          onDragOver={handleCanvasDragOver}
          onDrop={handleCanvasDrop}
        >
          <ReactFlow<FlowNode, FlowEdge>
            nodes={nodes}
            edges={edges}
            onInit={setReactFlowInstance}
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
            onConnect={(connection) =>
              !isCanvasLocked &&
              !isSnippetCanvasActive &&
              connection.source &&
              connection.target
                ? updateActiveTest(
                    nodes,
                    edges.concat(createConnectedEdge(connection)),
                    true,
                  )
                : undefined
            }
            edgeTypes={edgeTypes}
            nodeTypes={nodeTypes}
            snapToGrid
            snapGrid={[24, 24]}
            nodesDraggable={!isCanvasLocked}
            nodesConnectable={!isCanvasLocked}
            elementsSelectable={!isCanvasLocked}
            panOnDrag={!isCanvasLocked}
            panOnScroll={!isCanvasLocked}
            zoomOnScroll={!isCanvasLocked}
            zoomOnPinch={!isCanvasLocked}
            zoomOnDoubleClick={!isCanvasLocked}
            selectionOnDrag={!isCanvasLocked}
            nodesFocusable={!isCanvasLocked}
            edgesFocusable={!isCanvasLocked}
            minZoom={0.35}
            maxZoom={1.35}
          >
            <Background gap={24} size={1} color="rgba(132, 107, 62, 0.18)" />
            <MiniMap
              pannable
              zoomable
              nodeColor={(node) => {
                const accent = node.data?.accent;
                return typeof accent === 'string' ? accent : '#19c2b0';
              }}
              maskColor="rgba(18, 16, 11, 0.78)"
              style={{
                background: '#111417',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                width: 120,
                height: 76,
              }}
            />
            <Controls className="canvas-flow-controls" showInteractive={false} />
            <Panel className="canvas-flow-panel" position="bottom-left">
              <button
                className={`canvas-lock-button${isCanvasLocked ? ' is-locked' : ''}`}
                type="button"
                onClick={() => setIsCanvasLocked((current) => !current)}
              >
                {isCanvasLocked ? 'Unlock' : 'Lock'}
              </button>
            </Panel>
          </ReactFlow>
          {!activeTest ? (
            <div className="canvas-empty">
              <p>Create a flow file from the left rail to start editing.</p>
            </div>
          ) : null}
        </div>
      </main>

      <div
        aria-label="Resize right column"
        aria-orientation="vertical"
        className={`app-shell__divider app-shell__divider--right${activeResizer === 'right' ? ' is-active' : ''}`}
        role="separator"
        onMouseDown={(event) => {
          event.preventDefault();
          setActiveResizer('right');
        }}
      />

      <Inspector
        activeTest={activeTest}
        selectedNode={inspectorSelectedNode}
        selectedSnippet={selectedSnippet}
        snippetDirty={activeSnippetId ? Boolean(dirtySnippets[activeSnippetId]) : false}
        snippetSaveState={snippetSaveState}
        generatedSpec={generatedSpec}
        onUpdateTitle={handleUpdateTitle}
        onUpdateField={handleUpdateField}
        onUpdateSnippetCode={handleUpdateSnippetCode}
        onUpdateSnippetName={handleUpdateSnippetName}
        onUpdateSnippetDescription={handleUpdateSnippetDescription}
        onUpdateSnippetParams={handleUpdateSnippetParams}
        onSaveSnippet={handleSaveSnippet}
        runState={runState}
        runStartState={runStartState}
        runError={runError}
        liveRunMode={liveRunMode}
        hasRunnableSteps={nodes.length > 0 && !isSnippetCanvasActive}
        onRunTest={handleRunTest}
        onLiveRunModeChange={setLiveRunMode}
      />
    </div>
  );
}

export default function App() {
  return (
    <ReactFlowProvider>
      <AppShell />
    </ReactFlowProvider>
  );
}
