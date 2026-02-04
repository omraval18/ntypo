import {
  FrameBufferRenderable,
  TextRenderable,
  type CliRenderer,
  type KeyEvent,
} from "@opentui/core";

import { COLORS, DURATIONS, UI_COLORS } from "../constants";
import { applyLayout } from "../layout";
import { computeStats, computeTimeLeft, type Mode } from "../metrics";
import { buildParagraphLayout, PromptView } from "../prompt";
import { ParagraphManager, type ParagraphUsage } from "../paragraphs";
import type { TestResults, View } from "./types";

export type TypingTestViewOptions = {
  renderer: CliRenderer;
  onFinished: (results: TestResults) => void;
  paragraphUsage?: ParagraphUsage;
};

export class TypingTestView implements View {
  readonly id = "typing" as const;
  private static readonly MAX_SPACE_EXTRAS = 1;
  private renderer: CliRenderer;
  private onFinished: (results: TestResults) => void;
  private mounted = false;
  private visible = false;

  private header: TextRenderable;
  private hintText: TextRenderable;
  private timerText: TextRenderable;
  private footer: TextRenderable;
  private promptRenderable: FrameBufferRenderable;
  private promptView: PromptView;

  private paragraphManager: ParagraphManager;

  private mode: Mode = "idle";
  private durationIndex = 1;
  private startTime: number | null = null;
  private endTime: number | null = null;
  private cursor = 0;
  private correctCount = 0;
  private typedCount = 0;
  private errorCount = 0;
  private extraErrorCount = 0;
  private sessionCorrectCount = 0;
  private sessionTypedCount = 0;
  private sessionErrorCount = 0;
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

    this.hintText = new TextRenderable(this.renderer, {
      id: "hint",
      content: "",
      position: "absolute",
      left: 2,
      top: 0,
      fg: UI_COLORS.hint,
    });

    this.timerText = new TextRenderable(this.renderer, {
      id: "timer",
      content: "",
      position: "absolute",
      left: 10,
      top: 1,
      fg: UI_COLORS.timerIdle,
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
    this.paragraphManager = new ParagraphManager({
      queueSize: 3,
      usage: options.paragraphUsage,
    });
  }

  mount() {
    if (this.mounted) {
      return;
    }
    this.mounted = true;
    this.renderer.root.add(this.header);
    this.renderer.root.add(this.hintText);
    this.renderer.root.add(this.timerText);
    this.renderer.root.add(this.promptRenderable);
    this.renderer.root.add(this.footer);
  }

  show() {
    this.visible = true;
    this.header.visible = true;
    this.hintText.visible = false;
    this.timerText.visible = true;
    this.promptRenderable.visible = true;
    this.footer.visible = true;

    setTimeout(() => {
      this.resetTest();
    }, 0);
  }

  hide() {
    this.visible = false;
    this.header.visible = false;
    this.hintText.visible = false;
    this.timerText.visible = false;
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

      const targetChars = Math.floor(width * height * 0.9);
      this.paragraphManager.setTargetCharCount(targetChars);

      this.paragraphManager.reset();
    }

    const promptLeft =
      typeof this.promptRenderable.left === "number"
        ? this.promptRenderable.left
        : 0;
    const promptTop =
      typeof this.promptRenderable.top === "number"
        ? this.promptRenderable.top
        : 0;
    this.hintText.left = promptLeft;
    this.hintText.top = Math.max(0, promptTop - 1);

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
        this.hideEnterHint();
        this.handleLineBreak();
      } else {
        const char = this.keyToChar(key);
        if (char !== null) {
          this.handleExtraChar(char);
        }
        this.showEnterHint();
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
    const unit = this.paragraphManager.getCurrentUnit();
    if (!unit) {
      return;
    }

    const layout = buildParagraphLayout(
      this.lastPromptWidth,
      this.lastPromptHeight,
      unit.text,
    );
    this.promptView.setLayout(layout);
    this.promptView.drawAll();
    this.cursor = 0;
    this.hideEnterHint();

    if (resetCounts) {
      this.correctCount = 0;
      this.typedCount = 0;
      this.errorCount = 0;
      this.extraErrorCount = 0;
      this.sessionCorrectCount = 0;
      this.sessionTypedCount = 0;
      this.sessionErrorCount = 0;
    } else {
      this.sessionCorrectCount += this.correctCount;
      this.sessionTypedCount += this.typedCount;
      this.sessionErrorCount += this.errorCount + this.extraErrorCount;

      this.correctCount = 0;
      this.typedCount = 0;
      this.errorCount = 0;
      this.extraErrorCount = 0;
    }

    this.updateHud(performance.now());
  }

  private moveToNextUnit() {
    this.sessionCorrectCount += this.correctCount;
    this.sessionTypedCount += this.typedCount;
    this.sessionErrorCount += this.errorCount + this.extraErrorCount;

    this.paragraphManager.completeCurrentUnit();

    this.correctCount = 0;
    this.typedCount = 0;
    this.errorCount = 0;
    this.extraErrorCount = 0;
    this.cursor = 0;
    this.hideEnterHint();

    const unit = this.paragraphManager.getCurrentUnit();
    if (unit) {
      const layout = buildParagraphLayout(
        this.lastPromptWidth,
        this.lastPromptHeight,
        unit.text,
      );
      this.promptView.setLayout(layout);
      this.promptView.drawAll();
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
    this.hideEnterHint();
    this.paragraphManager.reset();
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

    const totalCorrect = this.sessionCorrectCount + this.correctCount;
    const totalTyped = this.sessionTypedCount + this.typedCount;
    const totalErrors =
      this.sessionErrorCount + this.errorCount + this.extraErrorCount;

    const stats = computeStats(
      this.mode,
      this.startTime,
      this.endTime,
      this.durationIndex,
      totalCorrect,
      totalErrors,
      now,
    );

    const durationSec = DURATIONS[this.durationIndex] ?? DURATIONS[0];
    const queueSize = this.paragraphManager.getQueueSize();
    const totalParagraphs = this.paragraphManager.getTotalCount();
    const usedParagraphs = this.paragraphManager.getUsedCount();
    const extraChars = this.promptView.getTotalExtraChars();

    if (this.mode === "idle") {
      this.header.content = `ntypo  ${this.formatDurationOptions()}   (press 1/2/3)  |  idle`;
      this.timerText.visible = false;
      this.footer.content =
        `Time: ${timeLeft.toFixed(1)}s  ` +
        `WPM: ${stats.wpm}  Acc: ${stats.accuracy}%  ` +
        `Errors: ${totalErrors}  ` +
        `Esc: reset`;
    } else {
      this.header.content = "ntypo";
      this.timerText.content = `${timeLeft.toFixed(1)}s`;
      this.timerText.fg = UI_COLORS.timerRunning;
      this.timerText.visible = true;
      this.footer.content =
        `WPM: ${stats.wpm}  Acc: ${stats.accuracy}%  ` +
        `Errors: ${totalErrors}` +
        (extraChars > 0 ? ` (+${extraChars} extra)` : "") +
        `  ` +
        `Progress: ${usedParagraphs}/${totalParagraphs}  ` +
        `Esc: reset`;
    }

    this.header.requestRender();
    this.timerText.requestRender();
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

      const totalCorrect = this.sessionCorrectCount + this.correctCount;
      const totalErrors =
        this.sessionErrorCount + this.errorCount + this.extraErrorCount;

      const stats = computeStats(
        this.mode,
        this.startTime,
        this.endTime,
        this.durationIndex,
        totalCorrect,
        totalErrors,
        nowMs,
      );
      this.onFinished({
        wpm: stats.wpm,
        accuracy: stats.accuracy,
        errors: totalErrors,
        durationSec,
      });
      return true;
    }
    return false;
  }

  private handleBackspace() {
    this.hideEnterHint();

    if (this.cursor > 0) {
      const prevIndex = this.cursor - 1;
      if (this.promptView.hasExtraChars(prevIndex)) {
        this.promptView.removeExtraChar(prevIndex);
        this.extraErrorCount = Math.max(0, this.extraErrorCount - 1);
        this.updateHud(performance.now());
        return;
      }
    }

    if (this.promptView.hasExtraChars(this.cursor > 0 ? this.cursor - 1 : 0)) {
      this.promptView.removeExtraChar(this.cursor > 0 ? this.cursor - 1 : 0);
      this.extraErrorCount = Math.max(0, this.extraErrorCount - 1);
      this.updateHud(performance.now());
      return;
    }

    if (this.cursor <= 0) {
      return;
    }
    this.cursor -= 1;
    this.promptView.clearState(this.cursor);
    this.updateHud(performance.now());
  }

  private handleExtraChar(char: string) {
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

    const insertIndex = this.cursor > 0 ? this.cursor - 1 : 0;
    this.promptView.addExtraChar(insertIndex, char);
    this.extraErrorCount += 1;
    this.typedCount += 1;
    this.updateHud(now);
  }

  private handleCharInput(char: string) {
    if (this.mode === "finished") {
      return;
    }

    if (this.mode === "idle") {
      this.startTest();
    }

    this.hideEnterHint();

    const now = performance.now();
    if (this.finishIfNeeded(now)) {
      return;
    }

    if (this.cursor >= this.promptView.chars.length) {
      this.moveToNextUnit();
      return;
    }

    const expected = this.promptView.chars[this.cursor];
    if (expected === undefined) {
      return;
    }

    const isCorrect = char === expected;

    if (isCorrect) {
      this.promptView.setState(this.cursor, 1);
      this.typedCount += 1;
      this.correctCount += 1;
      this.cursor += 1;
    } else if (expected === " ") {
      const insertIndex = this.cursor > 0 ? this.cursor - 1 : 0;
      if (
        this.promptView.getExtraCharCount(insertIndex) >=
        TypingTestView.MAX_SPACE_EXTRAS
      ) {
        return;
      }
      this.promptView.addExtraChar(insertIndex, " ");
      this.extraErrorCount += 1;
      this.typedCount += 1;
    } else {
      this.promptView.setState(this.cursor, 2);
      this.typedCount += 1;
      this.errorCount += 1;
      this.cursor += 1;
    }

    if (this.cursor >= this.promptView.chars.length) {
      this.moveToNextUnit();
    }
  }

  private handleLineBreak() {
    if (this.mode === "finished") {
      return;
    }

    if (this.mode === "idle") {
      this.startTest();
    }

    this.hideEnterHint();

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

    if (this.cursor >= this.promptView.chars.length) {
      this.moveToNextUnit();
    }
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

  private showEnterHint() {
    this.hintText.content = "Hint: ↵  ";
    this.hintText.visible = true;
    this.hintText.requestRender();
  }

  private hideEnterHint() {
    this.hintText.content = "";
    this.hintText.visible = false;
    this.hintText.requestRender();
  }
}
