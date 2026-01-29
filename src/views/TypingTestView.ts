import {
  FrameBufferRenderable,
  TextRenderable,
  type CliRenderer,
  type KeyEvent,
} from "@opentui/core";

import { COLORS, DURATIONS, UI_COLORS, WORDS } from "../constants";
import { applyLayout } from "../layout";
import { computeStats, computeTimeLeft, type Mode } from "../metrics";
import { buildPromptLayout, PromptView } from "../prompt";
import type { TestResults, View } from "./types";

export type TypingTestViewOptions = {
  renderer: CliRenderer;
  onFinished: (results: TestResults) => void;
};

export class TypingTestView implements View {
  readonly id = "typing" as const;
  private renderer: CliRenderer;
  private onFinished: (results: TestResults) => void;
  private mounted = false;
  private visible = false;

  private header: TextRenderable;
  private footer: TextRenderable;
  private promptRenderable: FrameBufferRenderable;
  private promptView: PromptView;

  private mode: Mode = "idle";
  private durationIndex = 1;
  private startTime: number | null = null;
  private endTime: number | null = null;
  private cursor = 0;
  private correctCount = 0;
  private typedCount = 0;
  private errorCount = 0;
  private wordSeed = Math.floor(Math.random() * WORDS.length);
  private lastPromptWidth = 0;
  private lastPromptHeight = 0;

  constructor(options: TypingTestViewOptions) {
    this.renderer = options.renderer;
    this.onFinished = options.onFinished;

    this.header = new TextRenderable(this.renderer, {
      id: "header",
      content: "",
      position: "absolute",
      left: 2,
      top: 1,
      fg: UI_COLORS.header,
    });

    this.promptRenderable = new FrameBufferRenderable(this.renderer, {
      id: "prompt",
      width: 10,
      height: 3,
      position: "absolute",
      left: 0,
      top: 0,
      respectAlpha: true,
    });
    this.promptRenderable.frameBuffer.setRespectAlpha(true);

    this.footer = new TextRenderable(this.renderer, {
      id: "footer",
      content: "",
      position: "absolute",
      left: 2,
      top: 0,
      fg: UI_COLORS.footer,
    });

    this.promptView = new PromptView(this.promptRenderable, COLORS);
  }

  mount() {
    if (this.mounted) {
      return;
    }
    this.mounted = true;
    this.renderer.root.add(this.header);
    this.renderer.root.add(this.promptRenderable);
    this.renderer.root.add(this.footer);
  }

  show() {
    this.visible = true;
    this.header.visible = true;
    this.promptRenderable.visible = true;
    this.footer.visible = true;
    this.resetTest();
  }

  hide() {
    this.visible = false;
    this.header.visible = false;
    this.promptRenderable.visible = false;
    this.footer.visible = false;
  }

  layout() {
    if (!this.visible) {
      return;
    }
    if (this.renderer.terminalWidth <= 0 || this.renderer.terminalHeight <= 0) {
      return;
    }
    const { width, height } = applyLayout(
      this.renderer.terminalWidth,
      this.renderer.terminalHeight,
      this.promptRenderable,
      this.header,
      this.footer,
    );

    if (width !== this.lastPromptWidth || height !== this.lastPromptHeight) {
      this.promptRenderable.frameBuffer.resize(width, height);
      this.promptView.clearAll(width, height);
      this.lastPromptWidth = width;
      this.lastPromptHeight = height;
    }

    this.regeneratePrompt(true);
  }

  handleKey(key: KeyEvent) {
    if (!this.visible) {
      return false;
    }

    if (key.name === "escape") {
      this.resetTest();
      return true;
    }

    if (this.handleDurationKey(key)) {
      return true;
    }

    if (key.name === "backspace") {
      if (this.mode === "running") {
        this.handleBackspace();
      }
      return true;
    }

    const expected = this.promptView.chars[this.cursor];
    if (expected === "\n") {
      if (key.name === "return" || key.name === "enter") {
        this.handleLineBreak();
      }
      return true;
    }

    const char = this.keyToChar(key);
    if (char === null) {
      return false;
    }

    this.handleCharInput(char);
    return true;
  }

  tick(nowMs: number) {
    if (!this.visible) {
      return;
    }
    if (this.mode === "running") {
      this.finishIfNeeded(nowMs);
    }
    this.updateHud(nowMs);
  }

  private regeneratePrompt(resetCounts: boolean) {
    const layout = buildPromptLayout(
      this.lastPromptWidth,
      this.lastPromptHeight,
      WORDS,
      this.wordSeed,
    );
    this.wordSeed = (this.wordSeed + layout.chars.length) % WORDS.length;
    this.promptView.setLayout(layout);
    this.promptView.drawAll();
    this.cursor = 0;

    if (resetCounts) {
      this.correctCount = 0;
      this.typedCount = 0;
      this.errorCount = 0;
    }

    this.updateHud(performance.now());
  }

  private startTest() {
    this.mode = "running";
    this.startTime = performance.now();
    this.endTime = null;
  }

  private resetTest() {
    this.mode = "idle";
    this.startTime = null;
    this.endTime = null;
    if (this.lastPromptWidth > 0 && this.lastPromptHeight > 0) {
      this.regeneratePrompt(true);
    }
    this.updateHud(performance.now());
  }

  private formatDurationOptions() {
    return DURATIONS.map((duration, index) =>
      index === this.durationIndex ? `[${duration}s]` : ` ${duration}s `,
    ).join("  ");
  }

  private updateHud(now: number) {
    const timeLeft = computeTimeLeft(
      this.mode,
      this.startTime,
      this.endTime,
      this.durationIndex,
      now,
    );
    const stats = computeStats(
      this.mode,
      this.startTime,
      this.endTime,
      this.durationIndex,
      this.correctCount,
      this.errorCount,
      now,
    );

    const modeLabel =
      this.mode === "idle"
        ? "idle"
        : this.mode === "running"
          ? "running"
          : "finished";

    this.header.content = `nType  ${this.formatDurationOptions()}   (press 1/2/3)  |  ${modeLabel}`;
    this.footer.content =
      `Time: ${timeLeft.toFixed(1)}s  ` +
      `WPM: ${stats.wpm}  Acc: ${stats.accuracy}%  ` +
      `Errors: ${this.errorCount}  ` +
      `Esc: reset`;

    this.header.requestRender();
    this.footer.requestRender();
  }

  private finishIfNeeded(nowMs: number) {
    if (this.mode !== "running" || this.startTime === null) {
      return false;
    }
    const durationSec = DURATIONS[this.durationIndex] ?? DURATIONS[0];
    const durationMs = durationSec * 1000;
    if (nowMs - this.startTime >= durationMs) {
      this.mode = "finished";
      this.endTime = nowMs;
      const stats = computeStats(
        this.mode,
        this.startTime,
        this.endTime,
        this.durationIndex,
        this.correctCount,
        this.errorCount,
        nowMs,
      );
      this.onFinished({
        wpm: stats.wpm,
        accuracy: stats.accuracy,
        errors: this.errorCount,
        durationSec,
      });
      return true;
    }
    return false;
  }

  private handleBackspace() {
    if (this.cursor <= 0) {
      return;
    }
    this.cursor -= 1;
    this.promptView.clearState(this.cursor);
  }

  private handleCharInput(char: string) {
    if (this.mode === "finished") {
      return;
    }

    if (this.mode === "idle") {
      this.startTest();
    }

    const now = performance.now();
    if (this.finishIfNeeded(now)) {
      return;
    }

    if (this.cursor >= this.promptView.chars.length) {
      this.regeneratePrompt(false);
    }

    const expected = this.promptView.chars[this.cursor];
    if (expected === undefined) {
      return;
    }

    const isCorrect = char === expected;
    this.promptView.setState(this.cursor, isCorrect ? 1 : 2);
    this.typedCount += 1;
    if (isCorrect) {
      this.correctCount += 1;
    } else {
      this.errorCount += 1;
    }

    this.cursor += 1;
  }

  private handleLineBreak() {
    if (this.mode === "finished") {
      return;
    }

    if (this.mode === "idle") {
      this.startTest();
    }

    const now = performance.now();
    if (this.finishIfNeeded(now)) {
      return;
    }

    const expected = this.promptView.chars[this.cursor];
    if (expected !== "\n") {
      return;
    }

    this.promptView.setState(this.cursor, 1);
    this.typedCount += 1;
    this.correctCount += 1;
    this.cursor += 1;
  }

  private keyToChar(key: KeyEvent): string | null {
    if (key.ctrl || key.meta) {
      return null;
    }
    if (key.name === "space") {
      return " ";
    }
    if (key.sequence && key.sequence.length === 1) {
      return key.sequence;
    }
    return null;
  }

  private handleDurationKey(key: KeyEvent) {
    if (this.mode !== "idle") {
      return false;
    }
    if (key.sequence === "1") {
      this.durationIndex = 0;
      this.resetTest();
      return true;
    }
    if (key.sequence === "2") {
      this.durationIndex = 1;
      this.resetTest();
      return true;
    }
    if (key.sequence === "3") {
      this.durationIndex = 2;
      this.resetTest();
      return true;
    }
    return false;
  }
}
