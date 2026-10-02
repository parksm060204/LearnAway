import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '../../../lib/auth/apiAuth';
import { AI_CONFIG, isAiConfigured } from '../../../lib/aiConfig';
import { validateEvaluationOutput, validateEvaluationRubric } from '../../../lib/evaluationValidation';
import {
  RubricCriterion,
  MethodReasonCriterionKey,
  MethodReasonRating,
  MethodReasonCriterionResult,
  MethodSelectionDiagnosis,
  METHOD_REASON_CRITERION_LABELS,
  EvaluationResult,
} from '../../../lib/types';

export interface EvaluateAnswerRequest {
  problemId: string;
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
}

export async function POST(req: NextRequest) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;

  try {
    let body: EvaluateAnswerRequest;
    try {
      body = await req.json();
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid body');
    } catch {
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
      userAnswer,
      revealedHintCount = 0,
      hints = [],
      solvingReason,
      isReasonNotApplicable = false,
      reasonNotApplicableJustification,
    } = body;

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

    if (typeof problemPrompt !== 'string' || !problemPrompt.trim() || typeof modelAnswer !== 'string' || !modelAnswer.trim()) {
      return NextResponse.json(
        {
          success: false,
          error: '문제 지문, 모범 답안, 또는 채점 기준(루브릭) 정보가 누락되었습니다.',
        },
        { status: 400 }
      );
    }

    let checkedRubric: RubricCriterion[];
    try {
      checkedRubric = validateEvaluationRubric(rubric);
    } catch (cause) {
      return NextResponse.json({ success: false, error: cause instanceof Error ? cause.message : '채점 기준 오류' }, { status: 400 });
    }

    // 2. Check AI Configuration
    if (!isAiConfigured()) {
      return NextResponse.json(
        {
          success: false,
          error:
            'AI API 키가 설정되지 않았습니다. .env.local 파일에 GEMINI_API_KEY 또는 AI_API_KEY를 설정해 주세요.',
        },
        { status: 400 }
      );
    }

    // 3. Normalize Rubric Criteria
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
   - 학생의 답안이 모범 답안과 표현, 기호 표기법, 또는 전개 방식이 다르더라도, 수학적/논리적으로 동치이거나 타당한 대안 풀이(예: 대우명제 증명, 톤넬리 정리 연계, 다른 보조정리 활용 등)라면 만점으로 인정하십시오.
   - 단순히 모범 답안의 문장 구조나 특정 단어가 일치하지 않는다는 이유로 감점하는 것은 절대 금지됩니다.

2. **개념 오류 vs 단순 계산 실수의 엄격한 구별과 부분 점수**:
   - 논리적 뼈대와 증명 전개가 타당하나 단순 부호 착오나 사칙연산 실수가 발생한 경우, 개념 혼동과 엄격히 구별하여 80~90% 이상의 부분 점수를 부여하십시오.
   - 반면 정리의 필수 전제조건(예: 절대수렴성, 가측성, 미분가능성, 루프 불변식, RBT 블랙 높이)을 누락한 경우는 핵심 논증 결함으로 간주하여 해당 기준 배점에서 적절히 감점하십시오.

3. **코딩 답안 정적 검토 한계 고지**:
   - 코딩 문제의 경우, 서버에서 코드를 직접 컴파일하거나 실행하지 않고 알고리즘의 정확성, 시간/공간 복잡도 증명, 경계 조건(Corner Cases), 루프 불변식의 정합성만을 정적으로 검토합니다.

4. **근거 제시의 사실성(Grounding)과 날조 금지**:
   - 학생 답안이나 이유 설명에 실제로 없는 내용을 임의로 지어내거나 날조하여 칭찬하지 마십시오.
   - 각 기준별로 학생 답안에서 직접 확인한 근거 문장을 "evidenceQuote" / "evidence"에 명시하십시오. 만약 답안에 해당 내용이 전혀 없다면 "답안에 해당 서술 없음"으로 표기하십시오.

5. **정오 확정 불가 시 '검토 필요(needsReview)' 플래그**:
   - 학생의 증명이나 코드가 극히 모호하거나 독창적이어서 AI가 기계적으로 정오를 확정하기 어렵다면, 추측으로 감점하지 말고 needsReview를 true로 설정하고 검토 사유를 피드백에 적으십시오.

6. **배점 및 점수 규칙 (0~100점)**:
   - 각 루브릭 기준의 score는 0 이상 해당 maxScore 이하의 수치여야 합니다.
   - 총점(calculatedScore)은 각 루브릭 기준 score의 단순 합계(0~100점)입니다.

7. **[8단계 핵심] 방법 선택 이유(Method Selection Reason) 독립 진단 원칙**:
   - 학생이 작성한 [풀이 및 결론]과 [방법 선택 이유]를 분리하여 진단합니다.
   - **점수 독립성 (불변 규칙)**:
     - 기존 루브릭 점수(calculatedScore, 0-100점)는 '풀이 및 결론'의 루브릭 달성도로만 산출합니다.
     - '방법 선택 이유' 진단 결과는 calculatedScore에 가감되거나 점수를 변조하지 않습니다 (중복 감점 및 점수 왜곡 금지).
   - **독립적 판정 원칙**:
     - 최종 정답이 맞았더라도 방법 선택 이유가 얕거나 직관에만 의존했다면 이유는 '보완 필요'일 수 있습니다.
     - 반대로 최종 수식 계산 실수가 있어 답안 점수가 낮더라도, 정리/알고리즘 선택 이유와 전제조건 인식이 훌륭하다면 이유는 '충분'일 수 있습니다. 두 평가는 상호 구속되지 않고 독립적으로 설명해야 합니다.
   - **4대 진단 항목**:
     1) appropriate_method (적절한 방법 선택): 문제 해결을 위해 선택한 정리/공식/알고리즘/자료구조의 적절성
     2) precondition_understanding (전제조건 이해): 정리가 성립하기 위한 전제조건(가측성, 미분가능성, 음수 사이클 부재 등)의 이해와 서술
     3) constraint_alignment (문제의 제약과의 연결): 문제의 입력 크기, 제약조건, 시간/공간 복잡도 요구사항과의 부합성
     4) alternatives_limitations (대안·한계 인식): 다른 방법(단순 완전탐색, 타 정리 등)보다 이 접근이 적합한 이유 또는 이 방법의 한계 인식
   - 각 항목의 rating은 반드시 'proficient' (충분) | 'partially_met' (부분 충족) | 'needs_improvement' (보완 필요) | 'not_applicable' (평가 불가) 중 하나여야 합니다.
   - 학생이 '해당 없음'을 선택한 경우: 문제 유형을 보고 실제로 방법 선택의 여지가 없는 문항인지 AI가 판단하여 isApplicable을 설정하고, applicabilityAssessment에 그 이유를 밝히십시오.
   - 모호하거나 평가하기 어려운 이유는 억지로 점수를 매기지 말고 'not_applicable' 또는 needsReview를 설정하십시오.
   - 학생을 위한 구체적인 보완 제안 문장(suggestedImprovements, 1~2개)과 다음에 확인할 개념(nextConceptsToReview, 1~2개)을 구체적으로 제시하십시오.

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
  "recommendedErrorType": "none" | "concept_confusion" | "condition_misinterpretation" | "calc_or_impl_mistake" | "method_selection_error",
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

    // 5. Build User Prompt
    const userPrompt = `### [문제 정보]
- 과목 분야: ${domain === 'math_stats' ? '수학·통계학' : '컴퓨터과학·알고리즘'}
- 문제 제목: ${problemTitle}
- 문제 본문:
${problemPrompt}
${mathFormula ? `- 주요 수식: ${mathFormula}\n` : ''}${
      codeSnippet ? `- 코드 스니펫:\n${codeSnippet}\n` : ''
    }${
      appliedConditionNote
        ? `- AI 설계 심화 응용 조건: ${appliedConditionNote}\n`
        : ''
    }
- 출제자가 제시한 모범 답안:
${modelAnswer}

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

    // 6. Call AI Model
    const endpoint = `${AI_CONFIG.apiBase.replace(/\/+$/, '')}/chat/completions`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 45000); // 45s timeout

    let rawResponse: Response;
    try {
      rawResponse = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${AI_CONFIG.apiKey}`,
        },
        body: JSON.stringify({
          model: AI_CONFIG.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.15, // Low temperature for consistent academic grading
        }),
        signal: controller.signal,
      });
    } catch (networkErr) {
      clearTimeout(timeoutId);
      return NextResponse.json(
        {
          success: false,
          error: `AI 평가 API 네트워크 연결 실패: ${
            networkErr instanceof Error && networkErr.name === 'AbortError'
              ? '요청 시간이 초과되었습니다 (45초 타임아웃).'
              : networkErr instanceof Error ? networkErr.message : '네트워크 오류'
          }`,
        },
        { status: 502 }
      );
    }

    if (!rawResponse.ok) {
      let errorBody = '';
      try {
        errorBody = await rawResponse.text();
      } catch {
        errorBody = rawResponse.statusText;
      }
      // Keep the timeout alive through body reception, then release it.
      clearTimeout(timeoutId);
      return NextResponse.json(
        {
          success: false,
          error: `AI 평가 API 호출 실패 (HTTP ${rawResponse.status}): ${errorBody}`,
          rawError: errorBody,
        },
        { status: rawResponse.status >= 500 ? 502 : 400 }
      );
    }

    const aiData = await rawResponse.json();
    clearTimeout(timeoutId);
    const content = aiData?.choices?.[0]?.message?.content;
    if (!content) {
      return NextResponse.json(
        {
          success: false,
          error: 'AI 모델로부터 빈 평가 응답이 수신되었습니다.',
        },
        { status: 502 }
      );
    }

    // 7. Parse and Validate AI Evaluation Output
    let parsed: Record<string, unknown>;
    let evaluationResult: EvaluationResult;
    try {
      if (typeof content !== 'string') throw new Error('AI 평가 응답이 텍스트가 아닙니다.');
      const cleanJson = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
      parsed = JSON.parse(cleanJson);
      evaluationResult = validateEvaluationOutput(parsed, checkedRubric);
    } catch (cause) {
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

    return NextResponse.json({
      success: true,
      evaluation: evaluationResult,
      problemId,
      conceptId,
      conceptIds,
      subjectId,
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
