/**
 * Stage 11: Collects the real source material bodies for a set of selected concepts.
 *
 * Grounding rules:
 *  - Only concepts belonging to the given subject contribute materials.
 *  - Only materials belonging to the same subject are used.
 *  - A missing or unreadable body blocks generation with a precise reason.
 *  - Per-material identity and body hash are preserved for provenance/versioning.
 */

import { Concept, Material } from './types';
import { loadMaterialContentResult, MaterialLoadResult } from './materialStorage';
import { computeMarkdownHash } from './markdownUtils';

export interface ProblemSourceInput {
  materialId: string;
  title: string;
  markdown: string;
  sourceRefs: string;
  contentHash: string;
}

export type CollectProblemSourcesResult =
  | { ok: true; sources: ProblemSourceInput[] }
  | { ok: false; error: string };

export interface CollectProblemSourcesParams {
  concepts: Concept[];
  materials: Material[];
  subjectId: string;
  loadContent?: (materialId: string) => Promise<MaterialLoadResult>;
}

export async function collectProblemSources({
  concepts,
  materials,
  subjectId,
  loadContent = loadMaterialContentResult,
}: CollectProblemSourcesParams): Promise<CollectProblemSourcesResult> {
  const orderedIds: string[] = [];
  for (const concept of concepts) {
    if (concept.subjectId !== subjectId) continue;
    for (const id of concept.materialIds || []) {
      if (!orderedIds.includes(id)) orderedIds.push(id);
    }
  }

  if (orderedIds.length === 0) {
    return {
      ok: false,
      error:
        '선택한 개념에 연결된 학습 자료(materialIds)가 없습니다. 자료를 등록·연결한 뒤 다시 시도해 주세요.',
    };
  }

  const sources: ProblemSourceInput[] = [];
  const problems: string[] = [];

  for (const id of orderedIds) {
    const meta = materials.find((m) => m.id === id && m.subjectId === subjectId);
    if (!meta) {
      problems.push(`자료 ID ${id} (이 과목의 자료가 아님)`);
      continue;
    }

    const result = await loadContent(id);
    let markdown = '';
    if (result.status === 'found') {
      markdown = result.content.markdown || meta.parsedMarkdown || '';
    } else if (result.status === 'missing') {
      markdown = meta.parsedMarkdown || '';
    } else {
      problems.push(`${meta.title} (읽기 오류: ${result.error})`);
      continue;
    }

    if (!markdown.trim()) {
      problems.push(`${meta.title} (본문 없음)`);
      continue;
    }

    sources.push({
      materialId: meta.id,
      title: meta.title,
      markdown,
      sourceRefs: meta.sourceRefs,
      contentHash: computeMarkdownHash(markdown),
    });
  }

  if (problems.length > 0) {
    return {
      ok: false,
      error: `다음 자료의 본문을 확인할 수 없어 문제 생성을 보류합니다: ${problems.join(', ')}. 자료를 저장하거나 복구한 뒤 다시 시도해 주세요.`,
    };
  }

  if (sources.length === 0) {
    return { ok: false, error: '사용할 수 있는 자료 본문이 없습니다.' };
  }

  return { ok: true, sources };
}
