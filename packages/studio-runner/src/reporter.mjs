import fs from 'node:fs';

const EVENT_FD = 3;

function write(event) {
  try {
    fs.writeSync(EVENT_FD, `${JSON.stringify(event)}\n`);
  } catch {
    // The parent closed the channel; runs must not fail because of reporting.
  }
}

function stepId(step) {
  const match = /^\[(?<id>[^\]]+)\]\s/.exec(step.title || '');
  return match?.groups?.id ?? null;
}

export default class StudioReporter {
  onBegin(_config, suite) {
    write({ type: 'run:started', totalTests: suite.allTests().length, at: Date.now() });
  }

  onTestBegin(test) {
    write({ type: 'test:started', title: test.title, at: Date.now() });
  }

  onStepBegin(_test, _result, step) {
    if (step.category !== 'test.step') {
      return;
    }

    write({
      type: 'step:started',
      stepId: stepId(step),
      title: step.title,
      at: Date.now(),
    });
  }

  onStepEnd(_test, _result, step) {
    if (step.category !== 'test.step') {
      return;
    }

    write({
      type: 'step:finished',
      stepId: stepId(step),
      title: step.title,
      durationMs: step.duration,
      error: step.error ? (step.error.message ?? String(step.error)).split('\n')[0] : null,
      at: Date.now(),
    });
  }

  onTestEnd(test, result) {
    write({
      type: 'test:finished',
      title: test.title,
      status: result.status,
      durationMs: result.duration,
      error: result.error ? (result.error.message ?? '').split('\n')[0] : null,
      attachments: (result.attachments ?? [])
        .filter((attachment) => attachment.path)
        .map((attachment) => ({
          name: attachment.name,
          path: attachment.path,
          contentType: attachment.contentType,
        })),
      at: Date.now(),
    });
  }

  onEnd(result) {
    write({ type: 'run:finished', status: result.status, at: Date.now() });
  }

  printsToStdio() {
    return false;
  }
}
