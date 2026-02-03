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

// Extra characters typed (wrong chars in spaces, etc.)
export type ExtraChar = {
  char: string;
  afterIndex: number; // Index in chars array after which this extra char was typed
};

export class PromptView {
  readonly renderable: FrameBufferRenderable;
  private colors: PromptColors;
  private lastPositions: CharPos[] = [];
  private drawableSlots: CharPos[] = [];
  chars: string[] = [];
  positions: CharPos[] = [];
  states = new Int8Array(0);
  
  // Track extra (wrong) characters typed at each position
  private extraChars: Map<number, string[]> = new Map();

  constructor(renderable: FrameBufferRenderable, colors: PromptColors) {
    this.renderable = renderable;
    this.colors = colors;
  }

  setLayout(layout: PromptLayout) {
    this.chars = layout.chars;
    this.positions = layout.positions;
    this.states = new Int8Array(this.chars.length);
    this.extraChars.clear();
    this.drawableSlots = [];
    for (let i = 0; i < this.chars.length; i += 1) {
      if (this.chars[i] === "\n") {
        continue;
      }
      const pos = this.positions[i];
      if (pos) {
        this.drawableSlots.push(pos);
      }
    }
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
    this.extraChars.clear();
  }

  // Add an extra (wrong) character at a position
  addExtraChar(afterIndex: number, char: string): number {
    const extras = this.extraChars.get(afterIndex) ?? [];
    extras.push(char);
    this.extraChars.set(afterIndex, extras);
    this.redrawWithExtras();
    return extras.length;
  }

  // Remove the last extra character at a position
  removeExtraChar(afterIndex: number): boolean {
    const extras = this.extraChars.get(afterIndex);
    if (!extras || extras.length === 0) {
      return false;
    }
    extras.pop();
    if (extras.length === 0) {
      this.extraChars.delete(afterIndex);
    }
    this.redrawWithExtras();
    return true;
  }

  // Get count of extra chars at a position
  getExtraCharCount(afterIndex: number): number {
    return this.extraChars.get(afterIndex)?.length ?? 0;
  }

  // Check if there are any extra chars at a position
  hasExtraChars(afterIndex: number): boolean {
    return this.getExtraCharCount(afterIndex) > 0;
  }

  // Get total extra chars count
  getTotalExtraChars(): number {
    let total = 0;
    for (const extras of this.extraChars.values()) {
      total += extras.length;
    }
    return total;
  }

  private redrawWithExtras() {
    const width = Math.max(0, Math.floor(this.renderable.width));
    const height = Math.max(0, Math.floor(this.renderable.height));

    // Clear all previous positions
    for (const pos of this.lastPositions) {
      if (pos.x >= 0 && pos.y >= 0 && pos.x < width && pos.y < height) {
        this.renderable.frameBuffer.setCell(
          pos.x,
          pos.y,
          " ",
          this.colors.background,
          this.colors.background,
        );
      }
    }

    const tokens: Array<{
      char: string;
      state: PromptState;
      isExtra: boolean;
    }> = [];

    const pushExtras = (index: number) => {
      const extras = this.extraChars.get(index);
      if (!extras || extras.length === 0) {
        return;
      }
      for (const extraChar of extras) {
        tokens.push({ char: extraChar, state: 2, isExtra: true });
      }
    };

    for (let i = 0; i < this.chars.length; i += 1) {
      if (i > 0) {
        pushExtras(i - 1);
      }

      const char = this.chars[i];
      if (char === undefined || char === "\n") {
        continue;
      }

      tokens.push({
        char,
        state: (this.states[i] ?? 0) as PromptState,
        isExtra: false,
      });
    }

    // Extras after the last character
    if (this.chars.length > 0) {
      pushExtras(this.chars.length - 1);
    }

    const drawnPositions: CharPos[] = [];
    const maxTokens = Math.min(tokens.length, this.drawableSlots.length);
    for (let i = 0; i < maxTokens; i += 1) {
      const token = tokens[i];
      const pos = this.drawableSlots[i];
      if (!pos) {
        continue;
      }
      if (pos.x < 0 || pos.y < 0 || pos.x >= width || pos.y >= height) {
        continue;
      }

      const isExtraSpace = token.isExtra && token.char === " ";
      const fg = isExtraSpace
        ? this.colors.background
        : token.isExtra
          ? this.colors.wrong
          : token.state === 1
            ? this.colors.correct
            : token.state === 2
              ? this.colors.wrong
              : this.colors.pending;
      const bg = isExtraSpace ? this.colors.wrong : this.colors.background;

      this.renderable.frameBuffer.setCell(
        pos.x,
        pos.y,
        token.char,
        fg,
        bg,
      );
      drawnPositions.push({ x: pos.x, y: pos.y });
    }

    this.lastPositions = drawnPositions;
    this.renderable.requestRender();
  }

  drawAll() {
    this.redrawWithExtras();
  }

  setState(index: number, state: PromptState) {
    const char = this.chars[index];
    if (char === undefined) {
      return;
    }

    this.states[index] = state;
    
    // Redraw everything to account for positioning
    this.redrawWithExtras();
  }

  clearState(index: number) {
    this.setState(index, 0);
  }

  // Clear extra chars at a specific index
  clearExtraCharsAt(index: number) {
    if (this.extraChars.has(index)) {
      this.extraChars.delete(index);
      this.redrawWithExtras();
    }
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
