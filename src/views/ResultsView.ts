import { TextRenderable, type CliRenderer, type KeyEvent } from "@opentui/core";

import type { TestResults, View } from "./types";

export type ResultsViewOptions = {
  renderer: CliRenderer;
  onRestart: () => void;
};

export class ResultsView implements View {
  readonly id = "results" as const;
  private renderer: CliRenderer;
  private onRestart: () => void;
  private mounted = false;
  private visible = false;
  private results: TestResults | null = null;

  private title: TextRenderable;
  private stats: TextRenderable;
  private hint: TextRenderable;

  constructor(options: ResultsViewOptions) {
    this.renderer = options.renderer;
    this.onRestart = options.onRestart;

    this.title = new TextRenderable(this.renderer, {
      id: "results-title",
      content: "Results",
      position: "absolute",
      left: 0,
      top: 0,
      fg: "#bbf451",
      visible: false,
    });

    this.stats = new TextRenderable(this.renderer, {
      id: "results-stats",
      content: "",
      position: "absolute",
      left: 0,
      top: 0,
      fg: "#05df72",
      visible: false,
    });

    this.hint = new TextRenderable(this.renderer, {
      id: "results-hint",
      content: "",
      position: "absolute",
      left: 0,
      top: 0,
      fg: "#8200db",
      visible: false,
    });
  }

  mount() {
    if (this.mounted) {
      return;
    }
    this.mounted = true;
    this.renderer.root.add(this.title);
    this.renderer.root.add(this.stats);
    this.renderer.root.add(this.hint);
  }

  show() {
    this.visible = true;
    this.title.visible = true;
    this.stats.visible = true;
    this.hint.visible = true;
    this.updateContent();
    this.layout();
  }

  hide() {
    this.visible = false;
    this.title.visible = false;
    this.stats.visible = false;
    this.hint.visible = false;
  }

  layout() {
    if (!this.visible) {
      return;
    }
    this.applyLayout();
  }

  handleKey(key: KeyEvent) {
    if (!this.visible) {
      return false;
    }
    if (key.name === "return" || key.name === "enter" || key.name === "escape") {
      this.onRestart();
      return true;
    }
    return false;
  }

  setResults(results: TestResults) {
    this.results = results;
    if (this.visible) {
      this.updateContent();
      this.applyLayout();
    }
  }

  private updateContent() {
    if (!this.results) {
      return;
    }

    this.title.content = "Results";
    this.stats.content = `WPM: ${this.results.wpm}   Accuracy: ${this.results.accuracy}%   Errors: ${this.results.errors}`;
    this.hint.content = "Press Enter to start again  •  Esc: reset";
  }

  private applyLayout() {
    const terminalWidth = Math.max(0, this.renderer.terminalWidth);
    const terminalHeight = Math.max(0, this.renderer.terminalHeight);
    const gap = 1;

    const titleHeight = 1;
    const statsHeight = 1;
    const hintHeight = 1;
    const totalHeight = titleHeight + statsHeight + hintHeight + gap * 2;

    let top = Math.max(0, Math.floor((terminalHeight - totalHeight) / 2));

    this.title.left = this.centerLeft(this.textWidth(this.title), terminalWidth);
    this.title.top = top;
    top += titleHeight + gap;

    this.stats.left = this.centerLeft(this.textWidth(this.stats), terminalWidth);
    this.stats.top = top;
    top += statsHeight + gap;

    this.hint.left = this.centerLeft(this.textWidth(this.hint), terminalWidth);
    this.hint.top = top;

    this.renderer.root.requestRender();
  }

  private textWidth(text: TextRenderable): number {
    return text.plainText.replace(/\s+$/, "").length;
  }

  private centerLeft(contentWidth: number, terminalWidth: number) {
    return Math.max(0, Math.floor((terminalWidth - contentWidth) / 2));
  }
}
