import { createCliRenderer, LayoutEvents } from "@opentui/core";

import { COLORS } from "./constants";
import { ResultsView } from "./views/ResultsView";
import { TypingTestView } from "./views/TypingTestView";
import { ViewManager } from "./views/ViewManager";

export async function startApp() {
  let hudTimer: ReturnType<typeof setInterval> | null = null;

  const renderer = await createCliRenderer({
    targetFps: 60,
    backgroundColor: COLORS.background,
    onDestroy: () => {
      if (hudTimer) {
        clearInterval(hudTimer);
      }
    },
  });

  const viewManager = new ViewManager();

  const resultsView = new ResultsView({
    renderer,
    onRestart: () => {
      viewManager.show("typing");
    },
  });

  const typingView = new TypingTestView({
    renderer,
    onFinished: (results) => {
      resultsView.setResults(results);
      viewManager.show("results");
    },
  });

  viewManager.register(typingView);
  viewManager.register(resultsView);

  renderer.keyInput.on("keypress", (key) => {
    if (key.ctrl && key.name === "c") {
      renderer.destroy();
      process.exit(0);
    }
    viewManager.handleKey(key);
  });

  renderer.keyInput.on("paste", (event) => {
    event.preventDefault();
  });

  renderer.root.on(LayoutEvents.RESIZED, () => {
    viewManager.layout();
  });

  const ensureReady = () => {
    if (renderer.terminalWidth === 0 || renderer.terminalHeight === 0) {
      setTimeout(ensureReady, 16);
      return;
    }
    viewManager.show("typing");
  };

  ensureReady();

  hudTimer = setInterval(() => {
    viewManager.tick(performance.now());
  }, 100);
}
