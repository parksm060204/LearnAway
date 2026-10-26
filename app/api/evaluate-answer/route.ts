import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '../../../lib/auth/apiAuth';
import { createClient } from '../../../lib/supabase/server';
import { callAiChat, httpStatusForAiError } from '../../../lib/aiClient';
import { resolveAiConfigForUser, lookupConnectionSecret, operatorFallbackAllowed, type TrialContext } from '../../../lib/aiCredentials';
import { recordAiUsageTelemetry } from '../../../lib/aiCostTelemetry';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
import { computeMarkdownHash } from '../../../lib/markdownUtils';
import {
  validateTrialEvaluateAnswerInput,
  settleTrialCredit,
  releaseTrialCredit,
  recordTrialResultReady,
  lookupSavedTaskResult,
  buildUserScopedTaskId,
  buildLegacyTaskId,
  MAX_TRIAL_EXECUTION_TIMEOUT_MS,
  MAX_TRIAL_OUTPUT_TOKENS,
} from '../../../lib/trialCredits';
import { validateEvaluationOutput, validateEvaluationRubric } from '../../../lib/evaluationValidation';
import {
  RubricCriterion,
  MethodReasonCriterionKey,
  MethodReasonRating,
  MethodReasonCriterionResult,
  MethodSelectionDiagnosis,
  METHOD_REASON_CRITERION_LABELS,
  EvaluationResult,
  SourceVerificationStatus,
} from '../../../lib/types';

export interface EvaluateAnswerRequest {
  problemId?: string;
  problemVersion?: number;
  problemType?: string;
  mockExamSessionId?: string;
  isProvisionalLocal?: boolean;
  conceptId: string;
  conceptIds?: string[];
  subjectId: string;
  domain: 'math_stats' | 'computer_science';
  problemTitle: string;
  problemPrompt: string;
  appliedConditionNote?: string;
  mathFormula?: string;
  codeSnippet?: string;
  modelAnswer: string;
  rubric: RubricCriterion[];
  userAnswer: string;
  revealedHintCount: number;
  hints?: string[];
  // Stage 8 fields:
  solvingReason?: string;
  isReasonNotApplicable?: boolean;
  reasonNotApplicableJustification?: string;
  taskId?: string;
  isSaveRetry?: boolean;
  action?: string;
}

const EVALUATE_ANSWER_PROMPT_VERSION = 'v2';

const MAX_REQUEST_BYTES = 128 * 1024;
const MAX_PROMPT_CHARS = 12_000;
const MAX_ANSWER_CHARS = 16_000;
const MAX_MODEL_ANSWER_CHARS = 12_000;
const MAX_AUXILIARY_CHARS = 8_000;
const MAX_HINTS = 12;

async function readBoundedJson(req: NextRequest): Promise<unknown> {
  const contentLength = Number(req.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) throw new RangeError('REQUEST_TOO_LARGE');
  if (!req.body) throw new SyntaxError('EMPTY_BODY');

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_REQUEST_BYTES) {
        await reader.cancel();
        throw new RangeError('REQUEST_TOO_LARGE');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

function isStringWithin(value: unknown, limit: number): value is string | undefined {
  return value === undefined || (typeof value === 'string' && value.length <= limit);
}

export async function POST(req: NextRequest) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;

  try {
    let body: EvaluateAnswerRequest;
    try {
      body = await readBoundedJson(req) as EvaluateAnswerRequest;
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid body');
    } catch (cause) {
      if (cause instanceof RangeError) {
        return NextResponse.json({ success: false, error: '요청 본문이 너무 큽니다.' }, { status: 413 });
      }
      return NextResponse.json({ success: false, error: '요청 본문은 JSON 객체여야 합니다.' }, { status: 400 });
    }
    const {
      problemId,
      conceptId,
      conceptIds = [],
      subjectId,
      domain = 'math_stats',
      problemTitle,
      problemPrompt,
      appliedConditionNote,
      mathFormula,
      codeSnippet,
      modelAnswer,
      rubric = [],
      revealedHintCount = 0,
      hints = [],
    } = body;
    let {
      userAnswer,
      solvingReason,
      isReasonNotApplicable = false,
      reasonNotApplicableJustification,
    } = body;

    const boundedStrings =
      isStringWithin(problemTitle, 300) &&
      isStringWithin(problemPrompt, MAX_PROMPT_CHARS) &&
      isStringWithin(modelAnswer, MAX_MODEL_ANSWER_CHARS) &&
      isStringWithin(userAnswer, MAX_ANSWER_CHARS) &&
      isStringWithin(appliedConditionNote, 2_000) &&
      isStringWithin(mathFormula, 4_000) &&
      isStringWithin(codeSnippet, 6_000) &&
      isStringWithin(solvingReason, MAX_ANSWER_CHARS) &&
      isStringWithin(reasonNotApplicableJustification, 2_000);
    const validHints = Array.isArray(hints) && hints.length <= MAX_HINTS && hints.every(
      (hint) => typeof hint === 'string' && hint.length <= 1_000
    );
    if (!boundedStrings || !Array.isArray(rubric) || rubric.length > 12 || !validHints || !Number.isInteger(revealedHintCount) || revealedHintCount < 0 ||
        (conceptIds !== undefined && (!Array.isArray(conceptIds) || conceptIds.length > 20 || conceptIds.some((id) => typeof id !== 'string' || id.length > 200)))) {
      return NextResponse.json({ success: false, error: '요청의 텍스트 또는 목록 크기가 허용 범위를 넘었습니다.' }, { status: 400 });
    }
    const auxiliaryTextLength = [problemTitle, appliedConditionNote, mathFormula, codeSnippet, solvingReason,
      reasonNotApplicableJustification].reduce((sum, value) => sum + (typeof value === 'string' ? value.length : 0), 0) +
      hints.reduce((sum, hint) => sum + hint.length, 0) +
      (Array.isArray(rubric) ? rubric.reduce((sum, criterion) => sum +
        (criterion && typeof criterion === 'object'
          ? String(criterion.label ?? '').length + String(criterion.description ?? '').length
          : 0), 0) : MAX_AUXILIARY_CHARS + 1);
    if (auxiliaryTextLength > MAX_AUXILIARY_CHARS) {
      return NextResponse.json({ success: false, error: '요청의 보조 설명이 너무 깁니다.' }, { status: 400 });
    }

    // 1. Mandatory Input Validations
    if (typeof userAnswer !== 'string' || !userAnswer.trim()) {
      return NextResponse.json(
        {
          success: false,
          error: '답안이 비어 있습니다. 답안을 작성한 후 평가를 요청해 주세요.',
        },
        { status: 400 }
      );
    }

    if (!body.mockExamSessionId && !problemId) {
      if (typeof problemPrompt !== 'string' || !problemPrompt.trim() || typeof modelAnswer !== 'string' || !modelAnswer.trim()) {
        return NextResponse.json(
          {
            success: false,
            error: '문제 지문, 모범 답안, 또는 채점 기준(루브릭) 정보가 누락되었습니다.',
          },
          { status: 400 }
        );
      }
    }

    const supabase = await createClient();

    // 2. Trust Boundary Enforcement: Resolve authoritative problem from server DB / frozen snapshots.
    // Client-supplied modelAnswer or rubric tampering must not override server source-of-truth.
    let verifiedPrompt = problemPrompt;
    let verifiedModelAnswer = modelAnswer;
    let verifiedRubric = rubric;
    let verifiedMathFormula = mathFormula;
    let verifiedCodeSnippet = codeSnippet;
    let verifiedAppliedCondition = appliedConditionNote;
    let qualityStatusNotice: string | undefined = undefined;
    let isProvisional = false;
    let resolvedProblemType: string = typeof body.problemType === 'string' ? body.problemType : '';
    let authoritativeConceptIds: string[] = conceptIds.length > 0 ? conceptIds : (conceptId ? [conceptId] : []);
    let resolvedMaterialId: string | undefined = undefined;
    let resolvedExcerpt: string | undefined = undefined;
    let resolvedPage: string | undefined = undefined;
    let resolvedContentVersion: string | undefined = undefined;
    let resolvedSourceStatus: SourceVerificationStatus = 'unverified';

    const hasDb = Boolean(supabase && typeof supabase.from === 'function');

    if (body.mockExamSessionId && hasDb) {
      if (!problemId) {
        return NextResponse.json(
          { success: false, error: '모의시험 평가에는 problemId가 필수입니다.' },
          { status: 400 }
        );
      }
      const targetProblemId = problemId;

      // 2A. Mock Exam Immutable Snapshot: past exams are evaluated against their frozen snapshot
      const { data: examRow, error: examErr } = await supabase
        .from('mock_exam_sessions')
        .select('*')
        .eq('id', body.mockExamSessionId)
        .eq('user_id', auth.user.id)
        .maybeSingle();

      if (examErr) {
        return NextResponse.json(
          { success: false, error: `모의시험 세션 조회 실패: ${examErr.message}. DB 오류로 평가를 중단합니다.` },
          { status: 500 }
        );
      }
      if (!examRow) {
        return NextResponse.json(
          { success: false, error: '모의시험 세션을 찾을 수 없거나 접근 권한이 없습니다.' },
          { status: 404 }
        );
      }

      if (examRow.status !== 'submitted' && examRow.status !== 'graded') {
        return NextResponse.json(
          { success: false, error: `제출되지 않았거나 취소된 모의시험은 평가할 수 없습니다. (상태: ${examRow.status})` },
          { status: 400 }
        );
      }

      const examPayload = (examRow.payload || {}) as Record<string, unknown>;
      const frozenProblems = Array.isArray(examPayload.problems)
        ? (examPayload.problems as Array<Record<string, unknown>>)
        : [];
      const frozenProb = frozenProblems.find((p) => p.id === targetProblemId || p.problemId === targetProblemId);

      if (!frozenProb) {
        return NextResponse.json(
          { success: false, error: '해당 모의시험 세션의 문제 스냅샷에 포함되지 않은 문항입니다.' },
          { status: 404 }
        );
      }

      if (
        typeof frozenProb.promptText !== 'string' || !frozenProb.promptText.trim() ||
        typeof frozenProb.modelAnswer !== 'string' || !frozenProb.modelAnswer.trim() ||
        !Array.isArray(frozenProb.rubric) || frozenProb.rubric.length === 0
      ) {
        return NextResponse.json(
          { success: false, error: '모의시험 문제 스냅샷의 필수 정보(지문, 모범답안, 루브릭)가 누락되었습니다.' },
          { status: 500 }
        );
      }

      // 1. Authoritative Server Submitted Answer Resolution
      const serverAnswers = (examPayload.answers || {}) as Record<string, string>;
      const serverAnswer = typeof serverAnswers[targetProblemId] === 'string' ? serverAnswers[targetProblemId].trim() : '';

      if (!serverAnswer) {
        return NextResponse.json(
          {
            success: false,
            error: '서버에 제출된 확정 답안이 없습니다. 미제출 문항은 평가할 수 없습니다.',
          },
          { status: 400 }
        );
      }

      // If client sent an explicit userAnswer, verify it strictly matches the submitted answer
      if (typeof body.userAnswer === 'string' && body.userAnswer.trim() && body.userAnswer.trim() !== serverAnswer) {
        return NextResponse.json(
          {
            success: false,
            error: '클라이언트 요청 답안이 서버 제출 답안과 일치하지 않습니다. 모의시험 평가는 서버에 확정된 공식 제출 답안만 사용합니다.',
          },
          { status: 400 }
        );
      }

      userAnswer = serverAnswer;

      // 2. Authoritative Method Selection Details Resolution
      const serverReasons = (examPayload.reasons || {}) as Record<string, string>;
      const serverIsNotApplicableMap = (examPayload.isReasonNotApplicable || {}) as Record<string, boolean>;
      const serverJustifications = (examPayload.reasonNotApplicableJustification || {}) as Record<string, string>;

      solvingReason = typeof serverReasons[targetProblemId] === 'string' ? serverReasons[targetProblemId].trim() : '';
      isReasonNotApplicable = Boolean(serverIsNotApplicableMap[targetProblemId]);
      reasonNotApplicableJustification =
        typeof serverJustifications[targetProblemId] === 'string' ? serverJustifications[targetProblemId].trim() : undefined;

      // 3. Cache Check: If already evaluated, return confirmed evaluation without calling AI
      const existingEvaluations = (examPayload.evaluations || {}) as Record<string, unknown>;
      const existingEval = existingEvaluations[targetProblemId] as EvaluationResult | undefined;
      if (existingEval && typeof existingEval.calculatedScore === 'number' && Array.isArray(existingEval.rubricResults)) {
        return NextResponse.json({
          success: true,
          cached: true,
          evaluation: existingEval,
          problemId: targetProblemId,
          conceptId,
          conceptIds,
          subjectId,
          isProvisionalLocal: false,
        });
      }

      verifiedPrompt = frozenProb.promptText;
      verifiedModelAnswer = frozenProb.modelAnswer;
      verifiedRubric = frozenProb.rubric as RubricCriterion[];
      verifiedMathFormula = typeof frozenProb.mathFormula === 'string' ? frozenProb.mathFormula : undefined;
      verifiedCodeSnippet = typeof frozenProb.codeSnippet === 'string' ? frozenProb.codeSnippet : undefined;
      verifiedAppliedCondition = typeof frozenProb.appliedConditionNote === 'string' ? frozenProb.appliedConditionNote : undefined;
      if (typeof frozenProb.type === 'string') resolvedProblemType = frozenProb.type;
      resolvedMaterialId = typeof frozenProb.sourceMaterialId === 'string' ? frozenProb.sourceMaterialId : undefined;
      if (Array.isArray(frozenProb.sourceConceptIds) && frozenProb.sourceConceptIds.length > 0) {
        authoritativeConceptIds = frozenProb.sourceConceptIds.filter((id): id is string => typeof id === 'string');
      } else if (Array.isArray(frozenProb.conceptIds) && frozenProb.conceptIds.length > 0) {
        authoritativeConceptIds = frozenProb.conceptIds.filter((id): id is string => typeof id === 'string');
      }
      resolvedExcerpt = typeof frozenProb.sourceExcerpt === 'string' ? frozenProb.sourceExcerpt : undefined;
      resolvedPage = frozenProb.sourcePage !== undefined ? String(frozenProb.sourcePage) : undefined;
      resolvedContentVersion = typeof frozenProb.sourceContentVersion === 'string' ? frozenProb.sourceContentVersion : undefined;
      const frozenRawStatus = frozenProb.sourceVerificationStatus as SourceVerificationStatus | undefined;
      const frozenNeedsReview = Boolean(frozenProb.needsSourceReview);
      resolvedSourceStatus = frozenNeedsReview ? 'needs_review' : (frozenRawStatus || 'unverified');
    } else if (problemId) {
      // 2B. Problem Version Snapshot or Authoritative Problem Resolution
      if (hasDb) {
        let resolvedPayload: Record<string, unknown> | null = null;
        let qualityStatus = 'normal';

        const { data: serverProb, error: probErr } = await supabase
          .from('problems')
          .select('*')
          .eq('id', problemId)
          .maybeSingle();

        if (probErr) {
          return NextResponse.json(
            { success: false, error: `문제 조회 실패: ${probErr.message}. DB 오류로 평가를 중단합니다.` },
            { status: 500 }
          );
        }

        if (!serverProb) {
          return NextResponse.json(
            { success: false, error: '해당 문제를 찾을 수 없습니다.' },
            { status: 404 }
          );
        }

        const problemOwner = serverProb.user_id;
        const isDemo = Boolean(serverProb.is_demo);
        qualityStatus = serverProb.quality_status;

        if (problemOwner && problemOwner !== auth.user.id && !isDemo) {
          return NextResponse.json(
            {
              success: false,
              error: '해당 문제에 대한 접근 권한이 없거나 다른 사용자의 문제입니다.',
            },
            { status: 404 }
          );
        }

        const requestedVersion = typeof body.problemVersion === 'number' ? body.problemVersion : undefined;
        const currentProblemVersion = typeof serverProb.version === 'number' ? serverProb.version : 1;

        if (requestedVersion !== undefined && requestedVersion !== currentProblemVersion) {
          // Explicit version requested differs from current problem: lookup immutable snapshot
          const { data: versionRow, error: versionErr } = await supabase
            .from('problem_versions')
            .select('*')
            .eq('problem_id', problemId)
            .eq('version', requestedVersion)
            .maybeSingle();

          if (versionErr) {
            return NextResponse.json(
              { success: false, error: `문제 버전 이력 조회 실패: ${versionErr.message}. DB 오류로 평가를 중단합니다.` },
              { status: 500 }
            );
          }

          if (!versionRow) {
            return NextResponse.json(
              {
                success: false,
                error: `요청한 문제 버전(${requestedVersion})의 스냅샷을 찾을 수 없습니다. 최신 문제로 대체할 수 없습니다.`,
              },
              { status: 404 }
            );
          }

          if (versionRow.user_id && versionRow.user_id !== auth.user.id) {
            return NextResponse.json(
              { success: false, error: '해당 문제 버전에 대한 접근 권한이 없습니다.' },
              { status: 404 }
            );
          }

          resolvedPayload = (versionRow.snapshot || {}) as Record<string, unknown>;
        } else {
          resolvedPayload = (serverProb.payload || {}) as Record<string, unknown>;
        }

        if (
          typeof resolvedPayload.promptText !== 'string' || !resolvedPayload.promptText.trim() ||
          typeof resolvedPayload.modelAnswer !== 'string' || !resolvedPayload.modelAnswer.trim() ||
          !Array.isArray(resolvedPayload.rubric) || resolvedPayload.rubric.length === 0
        ) {
          return NextResponse.json(
            { success: false, error: '서버 문제 스냅샷의 필수 정보(지문, 모범답안, 루브릭)가 누락되었습니다.' },
            { status: 500 }
          );
        }

        verifiedPrompt = resolvedPayload.promptText;
        verifiedModelAnswer = resolvedPayload.modelAnswer;
        verifiedRubric = resolvedPayload.rubric as RubricCriterion[];
        verifiedMathFormula = typeof resolvedPayload.mathFormula === 'string' ? resolvedPayload.mathFormula : undefined;
        verifiedCodeSnippet = typeof resolvedPayload.codeSnippet === 'string' ? resolvedPayload.codeSnippet : undefined;
        verifiedAppliedCondition = typeof resolvedPayload.appliedConditionNote === 'string' ? resolvedPayload.appliedConditionNote : undefined;
        if (typeof resolvedPayload.type === 'string') resolvedProblemType = resolvedPayload.type;
        resolvedMaterialId = typeof resolvedPayload.sourceMaterialId === 'string' ? resolvedPayload.sourceMaterialId : undefined;
        if (Array.isArray(resolvedPayload.sourceConceptIds) && resolvedPayload.sourceConceptIds.length > 0) {
          authoritativeConceptIds = resolvedPayload.sourceConceptIds.filter((id): id is string => typeof id === 'string');
        } else if (Array.isArray(resolvedPayload.conceptIds) && resolvedPayload.conceptIds.length > 0) {
          authoritativeConceptIds = resolvedPayload.conceptIds.filter((id): id is string => typeof id === 'string');
        }
        resolvedExcerpt = typeof resolvedPayload.sourceExcerpt === 'string' ? resolvedPayload.sourceExcerpt : undefined;
        resolvedPage = resolvedPayload.sourcePage !== undefined ? String(resolvedPayload.sourcePage) : undefined;
        resolvedContentVersion = typeof resolvedPayload.sourceContentVersion === 'string' ? resolvedPayload.sourceContentVersion : undefined;
        const payloadRawStatus = resolvedPayload.sourceVerificationStatus as SourceVerificationStatus | undefined;
        const payloadNeedsReview = Boolean(resolvedPayload.needsSourceReview || serverProb?.needs_source_review);
        resolvedSourceStatus = payloadNeedsReview ? 'needs_review' : (payloadRawStatus || 'unverified');

        if (qualityStatus !== 'verified') {
          qualityStatusNotice =
            '본 문항은 정답성 및 난이도에 대한 표본 검증 또는 교수자 자문이 진행 중인 문항입니다. AI 평가는 학습 참고용으로 제공됩니다.';
        }
      }
    } else {
      // 2C. No problemId: Unregistered local item requires explicit isProvisionalLocal
      if (!body.isProvisionalLocal) {
        return NextResponse.json(
          {
            success: false,
            error: '공식 평가를 진행하려면 문제 식별자(problemId)가 필요합니다. 미등록 로컬 문항을 평가하려면 isProvisionalLocal을 true로 설정하십시오.',
          },
          { status: 400 }
        );
      }
      isProvisional = true;
      qualityStatusNotice =
        '서버에 공인 등록되지 않은 로컬·초안 문항입니다. 정답성 및 난이도가 공인 검증되지 않았으므로 참고용으로 활용하세요.';
    }

    let checkedRubric: RubricCriterion[];
    try {
      checkedRubric = validateEvaluationRubric(verifiedRubric);
    } catch (cause) {
      return NextResponse.json(
        { success: false, error: cause instanceof Error ? cause.message : '채점 기준 오류' },
        { status: 400 }
      );
    }

    const isMockExam = Boolean(body.mockExamSessionId);
    let trialContext: TrialContext | undefined = undefined;

    const normalizedEvaluationInput = {
      version: EVALUATE_ANSWER_PROMPT_VERSION,
      problemId: problemId || '',
      problemVersion: body.problemVersion ?? 1,
      userAnswer: userAnswer.trim(),
      solvingReason: (solvingReason || '').trim(),
      isReasonNotApplicable: Boolean(isReasonNotApplicable),
      reasonNotApplicableJustification: (reasonNotApplicableJustification || '').trim(),
      revealedHintCount: Number(revealedHintCount) || 0,
      hints: Array.isArray(hints) ? hints.slice(0, Number(revealedHintCount) || 0) : [],
      isMockExam,
    };
    const inputIdentifier = computeMarkdownHash(JSON.stringify(normalizedEvaluationInput));
    const legacyInputIdentifier = isMockExam
      ? computeMarkdownHash(`mock_exam:${problemId}:${body.problemVersion ?? 1}:${userAnswer.trim()}`)
      : computeMarkdownHash(`${problemId}:${body.problemVersion ?? 1}:${userAnswer.trim()}`);

    const rawTaskId = (typeof body?.taskId === 'string' && body.taskId.trim()) ? body.taskId.trim() : '';
    const isLegacyDefault = rawTaskId === `eval_${legacyInputIdentifier}` || rawTaskId === `eval_${inputIdentifier}`;
    const explicitTaskId = (rawTaskId && !isLegacyDefault) ? rawTaskId : null;
    let taskId: string = explicitTaskId || buildUserScopedTaskId(auth.user.id, 'eval', inputIdentifier);
    const legacyTaskId = buildLegacyTaskId('eval', legacyInputIdentifier);
    const isSaveRetry = Boolean(body?.isSaveRetry || body?.action === 'retry_save');

    if (isSaveRetry) {
      let saved = await lookupSavedTaskResult(auth.user.id, taskId, 'evaluate_answer', inputIdentifier, legacyInputIdentifier);
      if (!saved.success && !explicitTaskId) {
        saved = await lookupSavedTaskResult(auth.user.id, legacyTaskId, 'evaluate_answer', legacyInputIdentifier);
      }
      if (!saved.success) {
        const status = saved.errorCode === 'TASK_OWNERSHIP_MISMATCH' ? 403 : 400;
        return NextResponse.json(
          {
            success: false,
            error: saved.message || '저장 재시도할 기존 평가 결과를 찾을 수 없습니다.',
            errorCode: saved.errorCode || 'SAVED_TASK_NOT_FOUND',
          },
          { status }
        );
      }
      const cached = saved.cachedResult as {
        evaluation: EvaluationResult;
        problemId?: string;
        conceptId?: string;
        conceptIds?: string[];
        subjectId?: string;
        isProvisionalLocal?: boolean;
      } | null;

      if (!cached || !cached.evaluation) {
        return NextResponse.json(
          {
            success: false,
            error: '저장된 평가 결과 데이터가 비어 있습니다.',
            errorCode: 'INVALID_CACHED_RESULT',
          },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        evaluation: cached.evaluation,
        problemId: cached.problemId || problemId,
        conceptId: cached.conceptId || conceptId,
        conceptIds: cached.conceptIds || conceptIds,
        subjectId: cached.subjectId || subjectId,
        isProvisionalLocal: cached.isProvisionalLocal || isProvisional,
        fromCache: true,
        persisted: true,
        settled: true,
        taskId: saved.taskId || taskId,
      });
    }

    if (!isMockExam) {
      trialContext = {
        taskId,
        taskType: 'evaluate_answer',
        inputIdentifier,
        legacyInputIdentifier,
        isSaveRetry,
      };

      const userLookup = await lookupConnectionSecret(auth.user.id);
      if (userLookup.status === 'unregistered') {
        const trialVal = validateTrialEvaluateAnswerInput(userAnswer, false);
        if (!trialVal.ok) {
          return NextResponse.json(
            { success: false, error: trialVal.error, errorCode: trialVal.errorCode, needsAiConnection: true },
            { status: 400 }
          );
        }
      }
    } else {
      const userLookup = await lookupConnectionSecret(auth.user.id);
      if (userLookup.status === 'unregistered' && !operatorFallbackAllowed()) {
        return NextResponse.json(
          {
            success: false,
            errorCode: 'MOCK_EXAM_TRIAL_PROHIBITED',
            error: '모의시험은 여러 문항이 일괄 평가되므로 AI 체험 크레딧으로 이용할 수 없습니다. 설정 > 내 AI API 연결에서 개인 API 키를 등록해 주세요.',
            needsAiConnection: true,
          },
          { status: 400 }
        );
      }
      trialContext = {
        taskId,
        taskType: 'evaluate_answer',
        inputIdentifier,
        legacyInputIdentifier,
        isSaveRetry,
      };
    }

    // 3. Resolve AI credentials (user's registered key first, then operator trial credit).
    const cred = await resolveAiConfigForUser(auth.user.id, trialContext);
    if (cred.taskId) {
      taskId = cred.taskId;
    }
    if (!cred.ok) {
      if (cred.code === 'already_completed' && cred.cachedResult && typeof cred.cachedResult === 'object') {
        const cached = cred.cachedResult as {
          evaluation: EvaluationResult;
          problemId?: string;
          conceptId?: string;
          conceptIds?: string[];
          subjectId?: string;
          isProvisionalLocal?: boolean;
        };
        return NextResponse.json({
          success: true,
          evaluation: cached.evaluation,
          problemId: cached.problemId || problemId,
          conceptId: cached.conceptId || conceptId,
          conceptIds: cached.conceptIds || conceptIds,
          subjectId: cached.subjectId || subjectId,
          isProvisionalLocal: cached.isProvisionalLocal || isProvisional,
          fromCache: true,
          persisted: true,
          settled: true,
          taskId: cred.taskId || taskId,
        });
      }
      if (cred.code === 'concurrent_in_progress') {
        return NextResponse.json(
          { success: false, error: cred.message, errorCode: 'CONCURRENT_EXECUTION_BLOCKED' },
          { status: 409 }
        );
      }
      const needsAiConnection = cred.needsAiConnection ?? (cred.code === 'no_credentials');
      return NextResponse.json(
        { success: false, error: cred.message, errorCode: cred.code === 'no_credentials' ? 'AI_CONNECTION_REQUIRED' : cred.code, needsAiConnection },
        { status: needsAiConnection ? 400 : 502 }
      );
    }

    const { data: budgetData, error: budgetError } = await supabase.rpc('consume_ai_call_budget');
    if (budgetError || !budgetData || typeof budgetData !== 'object') {
      if (taskId && cred.leaseToken) {
        await releaseTrialCredit(auth.user.id, taskId, 'budget_check_error', cred.leaseToken);
      }
      return NextResponse.json({ success: false, error: 'AI 호출 한도를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.' }, { status: 503 });
    }
    const budget = budgetData as { allowed?: boolean; retryAfterSeconds?: number };
    if (!budget.allowed) {
      if (taskId && cred.leaseToken) {
        await releaseTrialCredit(auth.user.id, taskId, 'rate_limited', cred.leaseToken);
      }
      const retryAfter = Math.max(1, Math.min(60, Number(budget.retryAfterSeconds) || 60));
      return NextResponse.json(
        { success: false, error: '평가 요청이 잠시 많습니다. 잠시 후 다시 시도해 주세요.', retryAfterSeconds: retryAfter },
        { status: 429, headers: { 'Retry-After': String(retryAfter) } }
      );
    }

    // 4. Normalize Rubric Criteria
    // Ensure total maxScore sum is tracked and each criterion is clearly defined
    const rubricDescList = checkedRubric.map((c, idx) => ({
      id: c.id || `crit-${idx + 1}`,
      label: c.label,
      maxScore: c.maxScore,
      description: c.description || c.label,
    }));

    const rubricSum = rubricDescList.reduce((acc, c) => acc + c.maxScore, 0);

    // 4. Build Academic System Prompt
    const systemPrompt = `당신은 대학 학부 및 대학원 수준의 [${
      domain === 'math_stats' ? '수학·수리통계학' : '컴퓨터과학·알고리즘'
    }] 정규 시험을 채점하는 엄격하고 공정한 전공 교수이자 평가 위원입니다.
제시된 문제 지문, AI 설계 응용 조건, 모범 답안, 100점 채점 기준(Rubric), 그리고 학생의 [풀이 및 결론]과 [방법 선택 이유]를 바탕으로 전문적으로 첨삭·평가하십시오.

### [필수 평가 원칙]
1. **수학적 동치성 및 대안적 해법 인정 (가장 중요)**:
   - 학생의 답안이 모범 답안과 표현, 기호 표기법, 또는 전개 방식이 다르더라도, 수학적/논리적으로 동치이거나 타당한 대안 풀이(예: 대우명제 증명, 톤넬리 정리 연계, 다른 보조정리 활용, $1/2$ vs $0.5$ 등)라면 만점으로 인정하십시오.
   - 단순히 모범 답안의 문장 구조나 특정 단어가 일치하지 않는다는 이유로 감점하는 것은 절대 금지됩니다.

2. **개념 오류 vs 단순 계산 실수의 엄격한 구별과 부분 점수**:
   - 논리적 뼈대와 증명 전개가 타당하나 단순 부호 착오나 사칙연산 실수가 발생한 경우, 개념 혼동과 엄격히 구별하여 해당 계산 유도 기준에서 70~90% 이상의 부분 점수를 부여하십시오. 절대 전체 0점 처리하지 마십시오.
   - 반면 정리의 필수 전제조건(예: 절대수렴성, 가측성, 미분가능성, 루프 불변식, RBT 블랙 높이)을 누락한 경우는 핵심 논증 결함으로 간주하여 해당 기준 배점에서 적절히 감점하십시오.

3. **정답만 제시한 경우(Answer-Only) 감점 규칙 및 유형별 예외**:
   - 단, 단답형('short_answer') 또는 객관식('multiple_choice') 문제의 경우, 별도의 증명 과정이나 전개 유도식을 요구하지 않으므로 증명/유도 과정이 없다는 이유로 감점하지 마십시오.
   - 단답형/객관식이 아닌 서술형·증명형·유도형 문제에서 학생이 풀이 과정, 유도 식, 또는 논리적 근거 없이 최종 수치나 결론만 단답식으로 작성한 경우, 풀이 과정/접근법/논리 전개에 해당하는 루브릭 배점은 대폭 감점하고 최종 결론 배점만 인정하십시오.

4. **코딩 답안 정적 검토 한계 고지**:
   - 코딩 문제의 경우, 서버에서 코드를 직접 컴파일하거나 실행하지 않고 알고리즘의 정확성, 시간/공간 복잡도 증명, 경계 조건(Corner Cases), 루프 불변식의 정합성만을 정적으로 검토합니다.

5. **근거 제시의 사실성(Grounding)과 날조 금지**:
   - 학생 답안이나 이유 설명에 실제로 없는 내용을 임의로 지어내거나 날조하여 칭찬하지 마십시오.
   - 각 기준별로 학생 답안에서 직접 확인한 근거 문장을 "evidenceQuote" / "evidence"에 명시하십시오. 만약 답안에 해당 내용이 전혀 없다면 "답안에 해당 서술 없음"으로 표기하십시오.

6. **정오 확정 불가 시 '검토 필요(needsReview)' 플래그**:
   - 학생의 증명이나 코드가 극히 모호하거나 독창적이어서 AI가 기계적으로 정오를 확정하기 어렵다면, 추측으로 감점하지 말고 needsReview를 true로 설정하고 검토 사유를 피드백에 적으십시오.

7. **배점 및 점수 규칙 (0~100점)**:
   - 각 루브릭 기준의 score는 0 이상 해당 maxScore 이하의 수치여야 합니다.
   - 총점(calculatedScore)은 각 루브릭 기준 score의 단순 합계(0~100점)입니다.

8. **[P03-05 핵심] 9대 학술 오류 원인 분류 (Academic Error Taxonomy)**:
   - 답안에서 감점이 발생한 경우 가장 본질적인 원인을 다음 9개 중 1개로 정확히 분류하십시오:
     - "NO_ERROR": 오류 없음 (완전한 정답 완제 및 감점 요인이 전혀 없는 100점 만점인 경우)
     - "CONCEPT_MISUNDERSTANDING": 개념 이해 부족 (핵심 개념·정의 오해)
     - "FORMULA_MISAPPLICATION": 공식의 잘못된 적용 (부적합한 공식/정리 적용 또는 전제조건 위반)
     - "CALCULATION_ERROR": 계산 실수 (접근법은 옳으나 중간 산술/대수/부호 실수)
     - "LOGICAL_ERROR": 논리 전개 오류 (단계 간 인과 결여, 순환논증, 논리 비약)
     - "CONDITION_OMISSION": 조건 누락 (주어진 제약조건, 정의역, 경계조건 간과)
     - "TERMINOLOGY_ERROR": 용어 사용 오류 (학술 용어 또는 기호의 부적절한 사용)
     - "INCOMPLETE_REASONING": 풀이 과정 부족 (정답만 작성, 핵심 증명/유도 생략)
     - "ANSWER_FORMAT_ERROR": 답안 형식 오류 (단위 누락, 제출 양식 미준수)
     - "UNCERTAIN": 원인 확정 불가 (답안이 극히 짧거나 모호하여 단정할 수 없음)
   - [중요 원칙]:
     - 학생 답안에 소폭의 감점(예: 95점)이 있더라도 계산 실수나 부호 착오가 있다면 "NO_ERROR"로 처리하지 말고 "CALCULATION_ERROR" 등 발생한 실제 오류로 정확히 분류하십시오. 점수가 높다는 이유만으로 기계적으로 NO_ERROR로 처리하지 마십시오.
     - 100점 만점으로 감점 요인이 전혀 없는 경우에만 "NO_ERROR"로 분류하십시오.
     - 원인을 확정할 수 없는 경우 임의로 "개념 이해 부족"으로 단정하지 말고 "UNCERTAIN"으로 분류하십시오.

9. **[8단계 핵심] 방법 선택 이유(Method Selection Reason) 독립 진단 원칙**:
   - 학생이 작성한 [풀이 및 결론]과 [방법 선택 이유]를 분리하여 진단합니다.
   - **점수 독립성 (불변 규칙)**:
     - 기존 루브릭 점수(calculatedScore, 0-100점)는 '풀이 및 결론'의 루브릭 달성도로만 산출합니다.
     - '방법 선택 이유' 진단 결과는 calculatedScore에 가감되거나 점수를 변조하지 않습니다 (중복 감점 및 점수 왜곡 금지).
   - **4대 진단 항목**:
     1) appropriate_method (적절한 방법 선택)
     2) precondition_understanding (전제조건 이해)
     3) constraint_alignment (문제의 제약과의 연결)
     4) alternatives_limitations (대안·한계 인식)
   - 각 항목의 rating은 반드시 'proficient' | 'partially_met' | 'needs_improvement' | 'not_applicable' 중 하나여야 합니다.

### [출력 형식]
반드시 다음 JSON 구조로만 응답하십시오 (Markdown 코드 블록 없이 순수 JSON만 반환):
{
  "calculatedScore": number, // 각 루브릭 기준 점수의 합계 (0 ~ 100)
  "rubricResults": [
    {
      "criterionId": string,
      "label": string,
      "score": number, // 0 ~ maxScore
      "maxScore": number,
      "isVulnerable": boolean, // score가 maxScore의 70% 미만이면 true
      "evidenceQuote": string, // 답안에서 확인한 실제 문장
      "deductionReason": string, // 감점 이유 (감점 없으면 "감점 요인 없음 (만점 기준 충족)")
      "improvementTip": string // 구체적인 개선 및 보완 방법
    }
  ],
  "strengths": string, // 1~2문장의 잘한 점
  "criticalImprovements": string, // 1~2문장의 가장 중요한 보완할 점
  "academicErrorType": "NO_ERROR" | "CONCEPT_MISUNDERSTANDING" | "FORMULA_MISAPPLICATION" | "CALCULATION_ERROR" | "LOGICAL_ERROR" | "CONDITION_OMISSION" | "TERMINOLOGY_ERROR" | "INCOMPLETE_REASONING" | "ANSWER_FORMAT_ERROR" | "UNCERTAIN",
  "recommendedErrorType": "none" | "concept_confusion" | "condition_misinterpretation" | "calc_or_impl_mistake" | "method_selection_error",
  "structuredError": {
    "errorType": "NO_ERROR" | "CONCEPT_MISUNDERSTANDING" | "FORMULA_MISAPPLICATION" | "CALCULATION_ERROR" | "LOGICAL_ERROR" | "CONDITION_OMISSION" | "TERMINOLOGY_ERROR" | "INCOMPLETE_REASONING" | "ANSWER_FORMAT_ERROR" | "UNCERTAIN",
    "severity": "critical" | "moderate" | "minor" | "none",
    "conceptId": "${conceptId}",
    "conceptTitle": "${problemTitle}",
    "evidence": string, // 오류를 확인한 답안 인용구
    "feedback": string // 오류 개선을 위한 핵심 학술 조언
  },
  "staticAnalysisNotice": "본 평가는 AI 모델의 정적 분석 및 논증 검토를 바탕으로 산출되었으며, 코드를 서버에서 직접 실행하거나 동적 테스트를 거치지 않았습니다.",
  "needsReview": boolean,
  "feedback": string, // 종합 학술 첨삭 총평 (문단 형태의 완성된 피드백)
  "methodSelectionDiagnosis": {
    "isApplicable": boolean,
    "applicabilityAssessment": string,
    "criteria": [
      {
        "key": "appropriate_method",
        "label": "적절한 방법 선택",
        "rating": "proficient" | "partially_met" | "needs_improvement" | "not_applicable",
        "evidence": string,
        "feedback": string
      },
      {
        "key": "precondition_understanding",
        "label": "전제조건 이해",
        "rating": "proficient" | "partially_met" | "needs_improvement" | "not_applicable",
        "evidence": string,
        "feedback": string
      },
      {
        "key": "constraint_alignment",
        "label": "문제의 제약과의 연결",
        "rating": "proficient" | "partially_met" | "needs_improvement" | "not_applicable",
        "evidence": string,
        "feedback": string
      },
      {
        "key": "alternatives_limitations",
        "label": "대안·한계 인식",
        "rating": "proficient" | "partially_met" | "needs_improvement" | "not_applicable",
        "evidence": string,
        "feedback": string
      }
    ],
    "summary": string,
    "suggestedImprovements": [string],
    "nextConceptsToReview": [string]
  }
}`;

    // 5. Build User Prompt using authoritative, verified content
    const userPrompt = `### [문제 정보]
- 과목 분야: ${domain === 'math_stats' ? '수학·통계학' : '컴퓨터과학·알고리즘'}
- 문제 유형: ${resolvedProblemType || '대학 시험형'}
- 문제 제목: ${problemTitle}
- 문제 본문:
${verifiedPrompt}
${verifiedMathFormula ? `- 주요 수식: ${verifiedMathFormula}\n` : ''}${
      verifiedCodeSnippet ? `- 코드 스니펫:\n${verifiedCodeSnippet}\n` : ''
    }${
      verifiedAppliedCondition
        ? `- AI 설계 심화 응용 조건: ${verifiedAppliedCondition}\n`
        : ''
    }
- 출제자가 제시한 모범 답안:
${verifiedModelAnswer}

### [채점 기준표 (총합 ${rubricSum}점)]
${rubricDescList
  .map(
    (c, i) =>
      `${i + 1}. [${c.id}] ${c.label} (배점: ${c.maxScore}점)\n   - 평가 가이드: ${
        c.description
      }`
  )
  .join('\n')}

### [학생 제출 정보]
- 공개하여 열람한 힌트 수: ${revealedHintCount}개
${
  revealedHintCount > 0 && hints.length > 0
    ? `- 열람한 힌트 내용: ${hints.slice(0, revealedHintCount).join(' / ')}\n`
    : ''
}
- [1. 풀이 및 결론]:
"""
${userAnswer}
"""

- [2. 방법 선택 이유]:
${
  isReasonNotApplicable
    ? `[해당 없음 선택됨]\n사유: ${reasonNotApplicableJustification || '(사유 서술 없음)'}`
    : `"""\n${solvingReason || '(이유 작성 생략됨)'}\n"""`
}

위 학생의 답안과 방법 선택 이유를 [필수 평가 원칙]에 따라 면밀히 검토하고, 각 루브릭 기준별 점수, 확인된 근거 인용, 감점 이유, 개선 방법, 종합 피드백, 그리고 독립된 방법 선택 이유 진단 결과를 지정된 JSON 형식으로 산출해 주십시오.`;

    // 6. Call AI Model through the shared server client
    const aiStartTime = Date.now();
    const aiCall = await callAiChat({
      system: systemPrompt,
      user: userPrompt,
      temperature: 0.15, // Low temperature for consistent academic grading
      json: true,
      outputTokenCeiling: cred.isTrial ? MAX_TRIAL_OUTPUT_TOKENS : 16_000,
      timeoutMs: cred.isTrial ? MAX_TRIAL_EXECUTION_TIMEOUT_MS : 45000,
      label: 'evaluate-answer',
    }, cred.config);
    const aiExecutionTimeMs = Date.now() - aiStartTime;

    if (!aiCall.ok) {
      await recordAiUsageTelemetry({
        requestId: taskId || undefined,
        userId: auth.user.id,
        taskType: 'evaluate_answer',
        provider: cred.config.provider,
        model: cred.config.model,
        executionTimeMs: aiExecutionTimeMs,
        status: aiCall.error.code === 'timeout' ? 'timeout' : 'error',
        errorCode: aiCall.error.code,
        creditSource: (cred.source === 'operator' || cred.isTrial) ? 'operator_trial' : 'personal_key',
        inputText: userPrompt,
      });

      if (taskId && cred.leaseToken) {
        await releaseTrialCredit(auth.user.id, taskId, 'ai_call_failed', cred.leaseToken);
      }
      return NextResponse.json(
        { success: false, error: aiCall.error.message, errorCode: aiCall.error.code },
        { status: httpStatusForAiError(aiCall.error.code) }
      );
    }
    const content = aiCall.content;

    await recordAiUsageTelemetry({
      requestId: taskId || undefined,
      userId: auth.user.id,
      taskType: 'evaluate_answer',
      provider: cred.config.provider,
      model: aiCall.model || cred.config.model,
      inputTokens: aiCall.usage?.promptTokens,
      outputTokens: aiCall.usage?.completionTokens,
      inputText: userPrompt,
      outputText: content,
      executionTimeMs: aiExecutionTimeMs,
      status: 'success',
      creditSource: (cred.source === 'operator' || cred.isTrial) ? 'operator_trial' : 'personal_key',
    });

    // 7. Parse and Validate AI Evaluation Output
    let parsed: Record<string, unknown>;
    let evaluationResult: EvaluationResult;
    try {
      if (typeof content !== 'string') throw new Error('AI 평가 응답이 텍스트가 아닙니다.');
      const cleanJson = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
      parsed = JSON.parse(cleanJson);
      const primaryConceptId = authoritativeConceptIds.includes(conceptId)
        ? conceptId
        : (authoritativeConceptIds[0] || conceptId || '');

      evaluationResult = validateEvaluationOutput(parsed, checkedRubric, {
        conceptId: primaryConceptId,
        conceptTitle: problemTitle,
        userAnswer,
        allowedConceptIds: authoritativeConceptIds,
        isProvisionalLocal: isProvisional,
      });
      evaluationResult.sourceProvenance = {
        sourceMaterialId: resolvedMaterialId,
        sourceConceptIds: authoritativeConceptIds,
        sourceExcerpt: resolvedExcerpt,
        sourcePage: resolvedPage,
        sourceContentVersion: resolvedContentVersion,
        sourceVerificationStatus: resolvedSourceStatus,
      };
    } catch (cause) {
      if (taskId && cred.leaseToken) {
        await releaseTrialCredit(auth.user.id, taskId, 'validation_failed', cred.leaseToken);
      }
      return NextResponse.json({ success: false,
        error: cause instanceof Error ? cause.message : 'AI 평가 결과 검증에 실패했습니다.' }, { status: 502 });
    }

    // 9. Normalize Method Selection Diagnosis (Stage 8)
    const CRITERIA_KEYS: MethodReasonCriterionKey[] = [
      'appropriate_method',
      'precondition_understanding',
      'constraint_alignment',
      'alternatives_limitations',
    ];

    const rawDiagnosis = (parsed.methodSelectionDiagnosis || {}) as {
      isApplicable?: unknown;
      criteria?: { key?: string; rating?: string; evidence?: string; feedback?: string }[];
      applicabilityAssessment?: string;
      summary?: string;
      suggestedImprovements?: unknown[];
      nextConceptsToReview?: unknown[];
    };
    const validRatings: MethodReasonRating[] = [
      'proficient',
      'partially_met',
      'needs_improvement',
      'not_applicable',
    ];

    const verifiedCriteria: MethodReasonCriterionResult[] = CRITERIA_KEYS.map((key) => {
      const found = Array.isArray(rawDiagnosis.criteria)
        ? rawDiagnosis.criteria.find((c) => c.key === key)
        : null;

      const rating: MethodReasonRating = validRatings.includes(found?.rating as MethodReasonRating)
        ? (found!.rating as MethodReasonRating)
        : isReasonNotApplicable
        ? 'not_applicable'
        : 'needs_improvement';

      return {
        key,
        label: METHOD_REASON_CRITERION_LABELS[key],
        rating,
        evidence:
          found?.evidence ||
          (isReasonNotApplicable
            ? (reasonNotApplicableJustification || '해당 없음 선택됨')
            : (solvingReason?.trim() ? '이유 서술 내 관련 언급 확인됨' : '답안 및 이유에 해당 서술 없음')),
        feedback:
          found?.feedback ||
          (rating === 'proficient'
            ? '선택한 방법과 이유가 타당하고 충실합니다.'
            : rating === 'partially_met'
            ? '방향은 맞으나 세부 논증이나 전제조건 서술이 부분 충족되었습니다.'
            : rating === 'needs_improvement'
            ? '공식/정리/알고리즘 선택 이유 또는 제약조건과의 연결에 보완이 필요합니다.'
            : '평가 불가 또는 해당 없음.'),
      };
    });

    const isApplicable = isReasonNotApplicable
      ? (rawDiagnosis.isApplicable !== undefined ? Boolean(rawDiagnosis.isApplicable) : false)
      : (rawDiagnosis.isApplicable !== undefined ? Boolean(rawDiagnosis.isApplicable) : true);

    const verifiedDiagnosis: MethodSelectionDiagnosis = {
      isApplicable,
      applicabilityAssessment:
        rawDiagnosis.applicabilityAssessment ||
        (isReasonNotApplicable
          ? '학생이 방법 선택 이유에 대해 [해당 없음]을 지정했습니다. 문제 성격상 방법 선택 평가 가능 여부를 검토했습니다.'
          : '문제 유형 및 풀이 접근 방식에 대한 방법 선택 이유 진단을 완료했습니다.'),
      criteria: verifiedCriteria,
      summary:
        rawDiagnosis.summary ||
        (isReasonNotApplicable
          ? '해당 없음 사유 및 문제 유형과의 적합성을 확인했습니다.'
          : '선택한 공식/정리/알고리즘의 선택 타당성과 전제조건 인식을 진단했습니다.'),
      suggestedImprovements: Array.isArray(rawDiagnosis.suggestedImprovements) && rawDiagnosis.suggestedImprovements.length > 0
        ? rawDiagnosis.suggestedImprovements.map(String)
        : [
            domain === 'math_stats'
              ? '적용한 정리의 가측성, 적분가능성 등 필수 전제조건 성립 여부를 풀이 서두에 밝혀주세요.'
              : '선택한 알고리즘의 시간/공간 복잡도가 문제의 입력 크기 제약조건을 왜 충족하는지 명시하세요.',
          ],
      nextConceptsToReview: Array.isArray(rawDiagnosis.nextConceptsToReview) && rawDiagnosis.nextConceptsToReview.length > 0
        ? rawDiagnosis.nextConceptsToReview.map(String)
        : [
            domain === 'math_stats'
              ? '정리의 적용 전제조건 및 대안적 유도 기법'
              : '자료구조 선택 기준 및 시간복잡도 상한 분석',
          ],
      evaluatedAt: new Date().toISOString(),
    };

    evaluationResult.methodSelectionDiagnosis = verifiedDiagnosis;
    evaluationResult.qualityStatusNotice = qualityStatusNotice;

    if (body.mockExamSessionId && hasDb && supabase && auth?.user && problemId) {
      try {
        const { data: currentExam } = await supabase
          .from('mock_exam_sessions')
          .select('payload')
          .eq('id', body.mockExamSessionId)
          .eq('user_id', auth.user.id)
          .maybeSingle();

        const curPayload = ((currentExam?.payload || {}) as Record<string, unknown>);
        const curEvals = { ...((curPayload.evaluations || {}) as Record<string, unknown>) };
        curEvals[problemId] = evaluationResult;
        curPayload.evaluations = curEvals;

        await supabase
          .from('mock_exam_sessions')
          .update({
            payload: curPayload,
            updated_at: new Date().toISOString(),
          })
          .eq('id', body.mockExamSessionId)
          .eq('user_id', auth.user.id);
      } catch (cacheErr) {
        console.warn('Failed to persist mock exam evaluation cache into mock_exam_sessions:', cacheErr);
      }
    }

    const finalReturnedConceptId = evaluationResult.conceptId || evaluationResult.structuredError?.conceptId ||
      (authoritativeConceptIds.includes(conceptId) ? conceptId : (authoritativeConceptIds[0] || conceptId));
    evaluationResult.conceptId = finalReturnedConceptId;

    let persisted = false;
    let settled = false;
    let settlementError: string | undefined;

    if (taskId && cred.leaseToken) {
      const cacheRes = await recordTrialResultReady(
        auth.user.id,
        taskId,
        {
          evaluation: evaluationResult,
          problemId,
          conceptId: finalReturnedConceptId,
          conceptIds: authoritativeConceptIds,
          subjectId,
          isProvisionalLocal: isProvisional,
        },
        cred.leaseToken
      );
      if (!cacheRes.success) {
        if (
          cacheRes.errorCode === 'STALE_LEASE_TOKEN' ||
          cacheRes.errorCode === 'ALREADY_SETTLED' ||
          cacheRes.errorCode === 'ALREADY_REFUNDED' ||
          cacheRes.errorCode === 'TASK_OWNERSHIP_MISMATCH' ||
          cacheRes.errorCode === 'LEASE_TOKEN_REQUIRED'
        ) {
          return NextResponse.json(
            {
              success: false,
              error: cacheRes.error || '답안 평가 실행권이 만료되었거나 다른 요청에 의해 선점되었습니다.',
              errorCode: cacheRes.errorCode,
            },
            { status: 409 }
          );
        }
        return NextResponse.json(
          {
            success: false,
            error: `답안 평가는 완료되었으나 결과 보존에 실패했습니다 (${cacheRes.error}). AI 재호출 없이 저장만 다시 시도할 수 있습니다.`,
            errorCode: cacheRes.errorCode || 'PERSISTENCE_FAILED',
            canRetrySave: true,
            taskId,
            evaluation: evaluationResult,
            problemId,
            conceptId: finalReturnedConceptId,
            conceptIds: authoritativeConceptIds,
            subjectId,
            isProvisionalLocal: isProvisional,
            persisted: false,
            settled: false,
          },
          { status: 500 }
        );
      }

      persisted = true;

      const settleResult = await settleTrialCredit(auth.user.id, taskId, cred.leaseToken);
      if (!settleResult.success) {
        settlementError = settleResult.error;
        settled = false;
        if (
          settleResult.errorCode === 'STALE_LEASE_TOKEN' ||
          settleResult.errorCode === 'ALREADY_REFUNDED' ||
          settleResult.errorCode === 'TASK_OWNERSHIP_MISMATCH' ||
          settleResult.errorCode === 'LEASE_TOKEN_REQUIRED'
        ) {
          return NextResponse.json(
            {
              success: false,
              error: settleResult.error || '정산 실행권 검증에 실패했습니다.',
              errorCode: settleResult.errorCode,
            },
            { status: 409 }
          );
        }
      } else {
        settled = true;
      }
    } else {
      persisted = true;
      settled = true;
    }

    return NextResponse.json({
      success: true,
      evaluation: evaluationResult,
      problemId,
      conceptId: finalReturnedConceptId,
      conceptIds: authoritativeConceptIds,
      subjectId,
      isProvisionalLocal: isProvisional,
      taskId,
      persisted,
      settled,
      settlementError,
      notice: settlementError
        ? `답안 평가 결과는 보존되었으나 크레딧 정산에 실패했습니다 (${settlementError}).`
        : undefined,
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: `서버 내부 처리 오류: ${err instanceof Error ? err.message : '알 수 없는 오류'}`,
      },
      { status: 500 }
    );
  }
}
