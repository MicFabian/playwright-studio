import { Node, Project, SyntaxKind, type Expression, type ObjectLiteralExpression } from 'ts-morph';

export interface PlaywrightProjectInfo {
  name: string;
  device?: string;
}

export interface PlaywrightConfigInfo {
  configPath: string;
  testDir: string | null;
  baseURL: string | null;
  testIdAttribute: string | null;
  projects: PlaywrightProjectInfo[];
  hasWebServer: boolean;
  fixtureImports: string[];
  diagnostics: { code: string; message: string }[];
}

function literalText(expression: Expression | undefined): string | null {
  if (!expression) {
    return null;
  }

  if (Node.isStringLiteral(expression) || Node.isNoSubstitutionTemplateLiteral(expression)) {
    return expression.getLiteralText();
  }

  return null;
}

function propertyValue(
  object: ObjectLiteralExpression | null,
  name: string,
): Expression | undefined {
  const property = object?.getProperty(name);
  return property && Node.isPropertyAssignment(property)
    ? (property.getInitializer() as Expression)
    : undefined;
}

function objectOf(expression: Expression | undefined): ObjectLiteralExpression | null {
  return expression && Node.isObjectLiteralExpression(expression) ? expression : null;
}

function findConfigObject(sourceText: string): {
  object: ObjectLiteralExpression | null;
  project: Project;
} {
  const project = new Project({ useInMemoryFileSystem: true, skipFileDependencyResolution: true });
  const sourceFile = project.createSourceFile('playwright.config.ts', sourceText);

  const defineCall = sourceFile
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .find((call) => call.getExpression().getText() === 'defineConfig');

  if (defineCall) {
    return { object: objectOf(defineCall.getArguments()[0] as Expression), project };
  }

  const exportAssignment = sourceFile.getExportAssignment(() => true);
  const expression = exportAssignment?.getExpression();

  return { object: objectOf(expression as Expression | undefined), project };
}

function readProjects(config: ObjectLiteralExpression | null): PlaywrightProjectInfo[] {
  const projectsValue = propertyValue(config, 'projects');

  if (!projectsValue || !Node.isArrayLiteralExpression(projectsValue)) {
    return [];
  }

  return projectsValue
    .getElements()
    .map((element) => {
      const entry = objectOf(element as Expression);
      const name = literalText(propertyValue(entry, 'name'));

      if (!name) {
        return null;
      }

      const use = objectOf(propertyValue(entry, 'use'));
      const device = use
        ?.getProperties()
        .flatMap((property) =>
          Node.isSpreadAssignment(property) ? [property.getExpression().getText()] : [],
        )
        .map((text) => text.match(/devices\[['"](.+?)['"]\]/)?.[1])
        .find((candidate): candidate is string => candidate != null);

      return { name, ...(device ? { device } : {}) };
    })
    .filter((entry): entry is PlaywrightProjectInfo => entry != null);
}

export function readPlaywrightConfig(
  sourceText: string,
  configPath = 'playwright.config.ts',
): PlaywrightConfigInfo {
  const diagnostics: { code: string; message: string }[] = [];
  const { object: config } = findConfigObject(sourceText);

  if (!config) {
    diagnostics.push({
      code: 'config-not-understood',
      message:
        'Could not find a defineConfig object in this file. Studio will fall back to its defaults.',
    });
  }

  const use = objectOf(propertyValue(config, 'use'));
  const baseURL = literalText(propertyValue(use, 'baseURL'));
  const testIdAttribute = literalText(propertyValue(use, 'testIdAttribute'));

  if (propertyValue(use, 'baseURL') && !baseURL) {
    diagnostics.push({
      code: 'dynamic-base-url',
      message: 'baseURL is computed at runtime, so navigation steps will keep absolute URLs.',
    });
  }

  return {
    configPath,
    testDir: literalText(propertyValue(config, 'testDir')),
    baseURL,
    testIdAttribute,
    projects: readProjects(config),
    hasWebServer: propertyValue(config, 'webServer') != null,
    fixtureImports: [],
    diagnostics,
  };
}

export function findFixtureModules(sourceText: string, fileName = 'fixtures.ts'): string[] {
  const project = new Project({ useInMemoryFileSystem: true, skipFileDependencyResolution: true });
  const sourceFile = project.createSourceFile(fileName, sourceText);
  const exported: string[] = [];

  sourceFile.getVariableDeclarations().forEach((declaration) => {
    if (!declaration.isExported()) {
      return;
    }

    const initializer = declaration.getInitializer();

    if (!initializer) {
      return;
    }

    const text = initializer.getText();

    if (/\.extend\s*[<(]/.test(text) || /\bmergeTests\s*\(/.test(text)) {
      exported.push(declaration.getName());
    }
  });

  sourceFile.getExportDeclarations().forEach((declaration) => {
    declaration.getNamedExports().forEach((named) => {
      const name = named.getName();

      if ((name === 'test' || name === 'expect') && !exported.includes(name)) {
        exported.push(name);
      }
    });
  });

  return exported;
}
