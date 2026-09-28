/**
 * REDCALL Academic Study Suite - Transcript Parser
 * 
 * Accurately parses lecture recordings and transcripts into structured Markdown.
 * Preserves raw wording, speaker identification, and timestamps.
 * 
 * CRITICAL RULE: If the original transcript does not contain timestamp information,
 * NEVER invent or synthesize artificial timestamps.
 */

export interface ParsedTranscriptBlock {
  index: number;
  speaker?: string;
  timestamp?: string; // e.g. "00:15:30" (strictly only if provided in raw text)
  text: string;
}

export interface ParseTranscriptResult {
  title: string;
  markdown: string;
  speakers: string[];
  speakerCount: number;
  hasTimestamps: boolean;
  blocks: ParsedTranscriptBlock[];
  rawText: string;
  wordCount: number;
}

// Regex patterns for timestamps
// Matches [00:12:30], (12:30), 00:15:30, 1:23:45
const TIMESTAMP_REGEX = /(?:\[|\()?\b(\d{1,2}:\d{2}(?::\d{2})?)\b(?:\]|\))?/;

export function parseTranscript(rawText: string, fallbackTitle: string = '강의 녹음 전사본'): ParseTranscriptResult {
  const normalized = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');

  const blocks: ParsedTranscriptBlock[] = [];
  const speakersSet = new Set<string>();
  let hasAnyTimestamp = false;

  let currentSpeaker: string | undefined = undefined;
  let currentTimestamp: string | undefined = undefined;
  let currentParagraphs: string[] = [];

  const flushCurrentBlock = () => {
    const text = currentParagraphs.join('\n').trim();
    if (text || currentSpeaker || currentTimestamp) {
      blocks.push({
        index: blocks.length + 1,
        speaker: currentSpeaker,
        timestamp: currentTimestamp,
        text: text || '(내용 없음)',
      });
    }
    currentParagraphs = [];
  };

  let detectedTitle = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Check for title in markdown header format at top
    if (!detectedTitle && (line.startsWith('# ') || (i === 0 && line.length < 50 && !line.includes(':')))) {
      if (line.startsWith('# ')) {
        detectedTitle = line.replace(/^#+\s*/, '').trim();
        continue;
      }
    }

    if (!line) {
      // Empty line - if we have text, keep paragraph boundary
      if (currentParagraphs.length > 0) {
        currentParagraphs.push('');
      }
      continue;
    }

    // Pattern 1: [00:15:30] Speaker: Content OR [00:15:30] Content
    // Example: [00:15:30] 교수: 오늘 강의는...
    const fullMatch = line.match(/^(?:\[|\()(\d{1,2}:\d{2}(?::\d{2})?)(?:\]|\))\s*(?:([가-힣a-zA-Z0-9_\s]{1,20})\s*[:：])?\s*(.*)$/);
    if (fullMatch) {
      flushCurrentBlock();
      hasAnyTimestamp = true;
      currentTimestamp = fullMatch[1].trim();
      if (fullMatch[2]) {
        currentSpeaker = fullMatch[2].trim();
        speakersSet.add(currentSpeaker);
      }
      if (fullMatch[3]) {
        currentParagraphs.push(fullMatch[3].trim());
      }
      continue;
    }

    // Pattern 2: Speaker (00:15:30): Content OR Speaker: Content
    // Example: 교수님 (00:15:30): 설명... OR 교수: 설명...
    const speakerMatch = line.match(/^([가-힣a-zA-Z0-9_\s]{1,15})\s*(?:\(([\d:]{4,8})\)|\[([\d:]{4,8})\])?\s*[:：]\s*(.*)$/);
    if (speakerMatch) {
      const candidateSpeaker = speakerMatch[1].trim();
      // Guard against false positive like "http:" or "Note:"
      if (!candidateSpeaker.toLowerCase().startsWith('http') && candidateSpeaker.length <= 15) {
        flushCurrentBlock();
        currentSpeaker = candidateSpeaker;
        speakersSet.add(currentSpeaker);

        const ts = speakerMatch[2] || speakerMatch[3];
        if (ts && TIMESTAMP_REGEX.test(ts)) {
          hasAnyTimestamp = true;
          currentTimestamp = ts.trim();
        } else {
          currentTimestamp = undefined;
        }

        if (speakerMatch[4]) {
          currentParagraphs.push(speakerMatch[4].trim());
        }
        continue;
      }
    }

    // Pattern 3: Standalone timestamp line
    // Example: 00:12:45
    const standaloneTsMatch = line.match(/^(\d{1,2}:\d{2}(?::\d{2})?)$/);
    if (standaloneTsMatch) {
      flushCurrentBlock();
      hasAnyTimestamp = true;
      currentTimestamp = standaloneTsMatch[1].trim();
      continue;
    }

    // Plain line continuing current block
    currentParagraphs.push(line);
  }

  // Flush the last block
  flushCurrentBlock();

  // If no blocks were created (e.g. empty or purely whitespace), provide empty fallback
  if (blocks.length === 0 && normalized.trim()) {
    blocks.push({
      index: 1,
      text: normalized.trim(),
    });
  }

  const title = detectedTitle || fallbackTitle;
  const speakers = Array.from(speakersSet);

  // Generate clean, high-fidelity Markdown
  const markdownLines: string[] = [];
  markdownLines.push(`# ${title}\n`);

  if (speakers.length > 0) {
    markdownLines.push(`**참여 화자 (${speakers.length}명)**: ${speakers.join(', ')}\n`);
  }

  markdownLines.push('---\n');

  for (const block of blocks) {
    const refAnchor = `<!-- [발화 #${block.index}] -->`;
    markdownLines.push(refAnchor);

    if (block.timestamp && block.speaker) {
      markdownLines.push(`> ⏱️ **${block.timestamp}** | **${block.speaker}**`);
    } else if (block.timestamp) {
      markdownLines.push(`> ⏱️ **${block.timestamp}**`);
    } else if (block.speaker) {
      markdownLines.push(`> 👤 **${block.speaker}**`);
    }

    markdownLines.push('');
    markdownLines.push(block.text);
    markdownLines.push('');
  }

  const finalMarkdown = markdownLines.join('\n').trim();
  const wordCount = normalized.trim().split(/\s+/).filter(Boolean).length;

  return {
    title,
    markdown: finalMarkdown,
    speakers,
    speakerCount: speakers.length,
    hasTimestamps: hasAnyTimestamp,
    blocks,
    rawText: normalized,
    wordCount,
  };
}
