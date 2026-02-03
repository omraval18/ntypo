import { readFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

export interface Paragraph {
  text: string;
  source: string;
  id: number;
  length: number;
}

export interface TypingUnit {
  text: string;
  ids: number[];
  length: number;
}

export interface ParagraphManagerOptions {
  filePath?: string;
  queueSize?: number;
  targetCharCount?: number;
}

const FALLBACK_WORDS: string[] = [
  "the",
  "be",
  "to",
  "of",
  "and",
  "a",
  "in",
  "that",
  "have",
  "i",
  "it",
  "for",
  "not",
  "on",
  "with",
  "he",
  "as",
  "you",
  "do",
  "at",
  "this",
  "but",
  "his",
  "by",
  "from",
  "they",
  "we",
  "say",
  "her",
  "she",
  "or",
  "an",
  "will",
  "my",
  "one",
  "all",
  "would",
  "there",
  "their",
  "what",
  "so",
  "up",
  "out",
  "if",
  "about",
  "who",
  "get",
  "which",
  "go",
  "me",
];

function generateFallbackText(seed: number): string {
  const words: string[] = [];
  const wordCount = 100 + (seed % 150);

  for (let i = 0; i < wordCount; i++) {
    const wordIndex = (seed + i) % FALLBACK_WORDS.length;
    const word = FALLBACK_WORDS[wordIndex];
    if (word) {
      words.push(word);
    }
  }

  return words.join(" ") + ".";
}

function generateFallbackParagraphs(count: number): Paragraph[] {
  const paragraphs: Paragraph[] = [];

  for (let i = 0; i < count; i++) {
    const text = generateFallbackText(i * 137);
    paragraphs.push({
      text,
      source: "fallback",
      id: i + 1,
      length: text.length,
    });
  }

  return paragraphs;
}

export class ParagraphManager {
  private paragraphs: Paragraph[] = [];
  private queue: TypingUnit[] = [];
  private usedIds: Set<number> = new Set();
  private queueSize: number;
  private targetCharCount: number;
  private currentIndex: number = 0;
  private totalParagraphs: number = 0;
  private isFallback: boolean = false;

  constructor(options: ParagraphManagerOptions = {}) {
    this.queueSize = options.queueSize ?? 3;
    this.targetCharCount = options.targetCharCount ?? 400;
    this.loadParagraphs(options.filePath);
    this.initializeQueue();
  }

  setTargetCharCount(count: number): void {
    this.targetCharCount = count;
  }

  private loadParagraphs(filePath?: string): void {
    try {
      const possiblePaths: string[] = [];
      const moduleDir = dirname(fileURLToPath(import.meta.url));

      if (filePath) {
        possiblePaths.push(filePath);
      }
      possiblePaths.push(join(moduleDir, "public/static/paragraphs.json"));
      possiblePaths.push(join(moduleDir, "../public/static/paragraphs.json"));
      possiblePaths.push(
        join(process.cwd(), "src/public/static/paragraphs.json"),
      );
      possiblePaths.push(join(process.cwd(), "public/static/paragraphs.json"));

      let data: string | null = null;
      let usedPath: string | null = null;

      for (const path of possiblePaths) {
        if (existsSync(path)) {
          data = readFileSync(path, "utf-8");
          usedPath = path;
          break;
        }
      }

      if (data) {
        this.paragraphs = JSON.parse(data) as Paragraph[];
        this.totalParagraphs = this.paragraphs.length;
        this.isFallback = false;
        console.log(
          `Loaded ${this.totalParagraphs} paragraphs from ${usedPath}`,
        );
      } else {
        console.warn(
          "Paragraphs JSON not found, using fallback word generation",
        );
        this.paragraphs = generateFallbackParagraphs(100);
        this.totalParagraphs = this.paragraphs.length;
        this.isFallback = true;
      }
    } catch (error) {
      console.error("Failed to load paragraphs:", error);
      console.warn("Using fallback word generation");
      this.paragraphs = generateFallbackParagraphs(100);
      this.totalParagraphs = this.paragraphs.length;
      this.isFallback = true;
    }
  }

  private initializeQueue(): void {
    this.queue = [];
    this.usedIds.clear();
    this.currentIndex = 0;
    this.refillQueue();
  }

  private getNextParagraph(): Paragraph | null {
    if (this.totalParagraphs === 0) {
      return null;
    }

    let attempts = 0;
    let paragraph: Paragraph | undefined;

    while (attempts < this.totalParagraphs) {
      const index = this.currentIndex % this.totalParagraphs;
      paragraph = this.paragraphs[index];

      if (paragraph && !this.usedIds.has(paragraph.id)) {
        this.usedIds.add(paragraph.id);
        this.currentIndex = index + 1;
        return paragraph;
      }

      this.currentIndex = index + 1;
      attempts++;
    }

    this.usedIds.clear();
    this.currentIndex = 0;

    paragraph = this.paragraphs[0];
    if (paragraph) {
      this.usedIds.add(paragraph.id);
      this.currentIndex = 1;
      return paragraph;
    }

    return null;
  }

  private createTypingUnit(): TypingUnit | null {
    const ids: number[] = [];
    const parts: string[] = [];
    let totalLength = 0;

    while (totalLength < this.targetCharCount) {
      const paragraph = this.getNextParagraph();
      if (!paragraph) {
        break;
      }

      ids.push(paragraph.id);
      parts.push(paragraph.text);
      totalLength += paragraph.text.length;

      if (parts.length >= 1 && totalLength >= this.targetCharCount * 0.7) {
        break;
      }

      if (parts.length >= 3) {
        break;
      }
    }

    if (parts.length === 0) {
      return null;
    }

    const mergedText = parts.join(" ");

    return {
      text: mergedText,
      ids,
      length: mergedText.length,
    };
  }

  private refillQueue(): void {
    while (this.queue.length < this.queueSize) {
      const unit = this.createTypingUnit();
      if (unit) {
        this.queue.push(unit);
      } else {
        break;
      }
    }
  }

  getCurrentUnit(): TypingUnit | null {
    if (this.queue.length === 0) {
      this.refillQueue();
    }
    return this.queue[0] ?? null;
  }

  completeCurrentUnit(): TypingUnit | null {
    if (this.queue.length === 0) {
      this.refillQueue();
      return this.getCurrentUnit();
    }

    this.queue.shift();

    this.refillQueue();

    return this.queue[0] ?? null;
  }

  getQueueSize(): number {
    return this.queue.length;
  }

  getQueuePreview(): { unitIndex: number; ids: number[]; length: number }[] {
    return this.queue.map((unit, index) => ({
      unitIndex: index,
      ids: unit.ids,
      length: unit.length,
    }));
  }

  reset(): void {
    this.initializeQueue();
  }

  getTotalCount(): number {
    return this.totalParagraphs;
  }

  getUsedCount(): number {
    return this.usedIds.size;
  }

  isUsingFallback(): boolean {
    return this.isFallback;
  }

  getTargetCharCount(): number {
    return this.targetCharCount;
  }
}
