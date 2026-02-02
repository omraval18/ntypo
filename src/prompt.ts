import { FrameBufferRenderable, RGBA } from "@opentui/core";

export type CharPos = { x: number; y: number };

export type PromptLayout = {
  chars: string[];
  positions: CharPos[];
};

export type PromptColors = {
  background: RGBA;
  pending: RGBA;
  correct: RGBA;
  wrong: RGBA;
};

export type PromptState = 0 | 1 | 2;

export class PromptView {
  readonly renderable: FrameBufferRenderable;
  private colors: PromptColors;
  private lastPositions: CharPos[] = [];
  chars: string[] = [];
  positions: CharPos[] = [];
  states = new Int8Array(0);

  constructor(renderable: FrameBufferRenderable, colors: PromptColors) {
    this.renderable = renderable;
    this.colors = colors;
  }

  setLayout(layout: PromptLayout) {
    this.chars = layout.chars;
    this.positions = layout.positions;
    this.states = new Int8Array(this.chars.length);
  }

  clearAll(width: number, height: number) {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        this.renderable.frameBuffer.setCell(
          x,
          y,
          " ",
          this.colors.background,
          this.colors.background,
        );
      }
    }
    this.lastPositions = [];
  }

  drawAll() {
    const width = Math.max(0, Math.floor(this.renderable.width));
    const height = Math.max(0, Math.floor(this.renderable.height));

    for (const pos of this.lastPositions) {
      if (pos.x < 0 || pos.y < 0 || pos.x >= width || pos.y >= height) {
        continue;
      }
      this.renderable.frameBuffer.setCell(
        pos.x,
        pos.y,
        " ",
        this.colors.background,
        this.colors.background,
      );
    }

    const drawnPositions: CharPos[] = [];
    for (let i = 0; i < this.chars.length; i += 1) {
      const pos = this.positions[i];
      const char = this.chars[i];
      if (!pos || char === undefined || char === "\n") {
        continue;
      }
      this.renderable.frameBuffer.setCell(
        pos.x,
        pos.y,
        char,
        this.colors.pending,
        this.colors.background,
      );
      drawnPositions.push(pos);
    }

    this.lastPositions = drawnPositions;
    this.renderable.requestRender();
  }

  setState(index: number, state: PromptState) {
    const pos = this.positions[index];
    const char = this.chars[index];
    if (!pos || char === undefined) {
      return;
    }

    this.states[index] = state;
    if (char === "\n") {
      return;
    }
    const fg =
      state === 1
        ? this.colors.correct
        : state === 2
          ? this.colors.wrong
          : this.colors.pending;

    this.renderable.frameBuffer.setCell(
      pos.x,
      pos.y,
      char,
      fg,
      this.colors.background,
    );
    this.renderable.requestRender();
  }

  clearState(index: number) {
    this.setState(index, 0);
  }
}

export function buildParagraphLayout(
  width: number,
  height: number,
  text: string,
): PromptLayout {
  const chars: string[] = [];
  const positions: CharPos[] = [];
  let line = 0;
  let col = 0;

  const words = text.split(/\s+/).filter((w) => w.length > 0);
  let wordIndex = 0;

  while (line < height && wordIndex < words.length) {
    const word = words[wordIndex] ?? "";
    const needsSpace = col > 0;
    const extra = needsSpace ? 1 : 0;

    if (col + extra + word.length > width) {
      if (line + 1 >= height) {
        break;
      }

      if (col > 0) {
        positions.push({
          x: Math.min(width - 1, Math.max(0, col - 1)),
          y: line,
        });
        chars.push("\n");
      }
      line += 1;
      col = 0;
      continue;
    }

    if (line >= height) {
      break;
    }

    if (needsSpace) {
      positions.push({ x: col, y: line });
      chars.push(" ");
      col += 1;
    }

    for (let i = 0; i < word.length; i += 1) {
      positions.push({ x: col, y: line });
      chars.push(word[i] ?? "");
      col += 1;
    }

    wordIndex += 1;
  }

  return { chars, positions };
}
