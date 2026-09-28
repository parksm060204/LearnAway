import { NextRequest, NextResponse } from 'next/server';
import { AI_CONFIG, isAiConfigured } from '../../../lib/aiConfig';
import { RubricCriterion, RubricResult, ErrorType } from '../../../lib/types';

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
}

export async function POST(req: NextRequest) {
  try {
    const body: EvaluateAnswerRequest = await req.json();
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
    } = body;

    // 1. Mandatory Input Validations
    if (!userAnswer || !userAnswer.trim()) {
      return NextResponse.json(
        {
          success: false,
          error: '답안이 비어 있습니다. 답안을 작성한 후 평가를 요청해 주세요.',
        },
        { status: 400 }
      );
    }

    if (!problemPrompt || !modelAnswer || rubric.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: '문제 지문, 모범 답안, 또는 채점 기준(루브릭) 정보가 누락되었습니다.',
        },
        { status: 400 }
      );
    }

    // 2. Check AI Configuration
    if (!isAiConfigured()) {
      return NextResponse.json(
        {
          success: false,
          error:
            'AI API 키가 설정되지 않았습니다. .env.local 파일에 DEEPSEEK_API_KEY 또는 OPENAI_API_KEY를 설정해 주세요.',
        },
        { status: 400 }
      );
    }

    // 3. Normalize Rubric Criteria
    // Ensure total maxScore sum is tracked and each criterion is clearly defined
    const rubricDescList = rubric.map((c, idx) => ({
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
제시된 문제 지문, AI 설계 응용 조건, 모범 답안, 100점 채점 기준(Rubric)을 바탕으로 학생의 서술형 답안을 전문적으로 첨삭·평가하십시오.

### [필수 평가 원칙]
1. **수학적 동치성 및 대안적 해법 인정 (가장 중요)**:
   - 학생의 답안이 모범 답안과 표현, 기호 표기법, 또는 전개 방식이 다르더라도, 수학적/논리적으로 동치이거나 타당한 대안 풀이(예: 대우명제 증명, 톤넬리 정리 연계, 다른 보조정리 활용 등)라면 만점으로 인정하십시오.
   - 단순히 모범 답안의 문장 구조나 특정 단어가 일치하지 않는다는 이유로 감점하는 것은 절대 금지됩니다.

2. **개념 오류 vs 단순 계산 실수의 엄격한 구별과 부분 점수**:
   - 논리적 뼈대와 증명 전개가 타당하나 단순 부호 착오나 사칙연산 실수가 발생한 경우, 개념 혼동과 엄격히 구별하여 80~90% 이상의 부분 점수를 부여하십시오.
   - 반면 정리의 필수 전제조건(예: 절대수렴성, 가측성, 미분가능성, 루프 불변식, RBT 블랙 높이)을 누락한 경우는 핵심 논증 결함으로 간주하여 해당 기준 배점에서 적절히 감점하십시오.

3. **코딩 답안 정적 검토 한계 고지**:
   - 코딩 문제의 경우, 서버에서 코드를 직접 컴파일하거나 실행하지 않고 알고리즘의 정확성, 시간/공간 복잡도 증명, 경계 조건(Corner Cases), 루프 불변식의 정합성만을 정적으로 검토합니다.

4. **근거 제시의 사실성(Grounding)**:
   - 학생 답안에 실제로 없는 내용을 임의로 지어내거나, 실행하지도 않은 테스트 케이스를 통과했다고 날조하지 마십시오.
   - 각 기준별로 학생 답안에서 직접 확인한 근거 문장을 "evidenceQuote"에 명시하십시오. 만약 답안에 해당 내용이 전혀 없다면 "답안에 해당 서술 없음"으로 표기하십시오.

5. **정오 확정 불가 시 '검토 필요(needsReview)' 플래그**:
   - 학생의 증명이나 코드가 극히 모호하거나 독창적이어서 AI가 기계적으로 정오를 확정하기 어렵다면, 추측으로 감점하지 말고 needsReview를 true로 설정하고 검토 사유를 피드백에 적으십시오.

6. **배점 및 점수 규칙**:
   - 각 기준의 score는 0 이상 해당 maxScore 이하의 정수(또는 0.5 단위 실수)여야 합니다.
   - 총점(calculatedScore)은 각 기준 score의 단순 합계(0~100점)입니다.

### [출력 형식]
반드시 다음 JSON 구조로만 응답하십시오 (Markdown 코드 블록 없이 순수 JSON만 반환):
{
  "calculatedScore": number, // 각 기준 점수의 합계 (0 ~ 100)
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
  "feedback": string // 종합 학술 첨삭 총평 (문단 형태의 완성된 피드백)
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
- 학생이 작성한 최종 답안:
"""
${userAnswer}
"""

위 학생의 답안을 [필수 평가 원칙]에 따라 면밀히 검토하고, 각 루브릭 기준별 점수, 확인된 근거 인용, 감점 이유, 개선 방법, 종합 피드백을 JSON으로 산출해 주십시오.`;

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
    } catch (networkErr: any) {
      clearTimeout(timeoutId);
      return NextResponse.json(
        {
          success: false,
          error: `AI 평가 API 네트워크 연결 실패: ${
            networkErr.name === 'AbortError'
              ? '요청 시간이 초과되었습니다 (45초 타임아웃).'
              : networkErr.message || '네트워크 오류'
          }`,
        },
        { status: 502 }
      );
    } finally {
      clearTimeout(timeoutId);
    }

    if (!rawResponse.ok) {
      let errorBody = '';
      try {
        errorBody = await rawResponse.text();
      } catch {
        errorBody = rawResponse.statusText;
      }
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
    let parsed: any;
    try {
      const cleanJson = content
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/```$/i, '')
        .trim();
      parsed = JSON.parse(cleanJson);
    } catch (parseErr: any) {
      return NextResponse.json(
        {
          success: false,
          error: 'AI 평가 결과 JSON 파싱에 실패했습니다.',
          rawContent: content,
        },
        { status: 502 }
      );
    }

    // 8. Server-side Score and Rubric Integrity Check
    const verifiedRubricResults: RubricResult[] = [];
    let calculatedScoreSum = 0;

    for (const crit of rubricDescList) {
      const foundResult = Array.isArray(parsed.rubricResults)
        ? parsed.rubricResults.find(
            (r: any) =>
              r.criterionId === crit.id ||
              (r.label && r.label.trim() === crit.label.trim())
          )
        : null;

      let score = foundResult ? Number(foundResult.score) : 0;
      if (isNaN(score)) score = 0;
      // Clamp between 0 and maxScore
      score = Math.max(0, Math.min(crit.maxScore, score));
      // Round to 1 decimal place if float
      score = Math.round(score * 10) / 10;

      calculatedScoreSum += score;
      const isVulnerable = score < crit.maxScore * 0.7;

      verifiedRubricResults.push({
        criterionId: crit.id,
        label: crit.label,
        score,
        maxScore: crit.maxScore,
        isVulnerable,
        feedback:
          foundResult?.feedback ||
          foundResult?.deductionReason ||
          '채점 완료',
        evidenceQuote:
          foundResult?.evidenceQuote || '답안에서 확인한 근거 기록됨',
        deductionReason:
          score === crit.maxScore
            ? '감점 요인 없음 (만점 기준 충족)'
            : foundResult?.deductionReason || '기준 미달로 인한 감점',
        improvementTip:
          foundResult?.improvementTip || '조건과 전개 과정을 보완하십시오.',
      });
    }

    // Clamp calculatedScoreSum strictly between 0 and 100
    calculatedScoreSum = Math.max(0, Math.min(100, Math.round(calculatedScoreSum)));

    const validErrorTypes: ErrorType[] = [
      'none',
      'concept_confusion',
      'condition_misinterpretation',
      'calc_or_impl_mistake',
      'method_selection_error',
    ];

    const recommendedErrorType: ErrorType = validErrorTypes.includes(
      parsed.recommendedErrorType
    )
      ? parsed.recommendedErrorType
      : calculatedScoreSum >= 90
      ? 'none'
      : 'concept_confusion';

    const evaluationResult = {
      calculatedScore: calculatedScoreSum,
      rubricResults: verifiedRubricResults,
      feedback:
        parsed.feedback ||
        `총점 ${calculatedScoreSum}점으로 평가되었습니다. 각 항목별 첨삭을 검토하십시오.`,
      strengths:
        parsed.strengths || '수식 전개 및 핵심 논리 전개가 확인되었습니다.',
      criticalImprovements:
        parsed.criticalImprovements ||
        '정리의 전제조건과 결론 도출 과정을 더욱 엄밀하게 서술하십시오.',
      recommendedErrorType,
      staticAnalysisNotice:
        parsed.staticAnalysisNotice ||
        '본 평가는 AI 모델의 정적 분석 및 논증 검토를 바탕으로 산출되었으며, 코드를 서버에서 직접 실행하거나 동적 테스트를 거치지 않았습니다.',
      needsReview: Boolean(parsed.needsReview),
      isAiEvaluated: true,
    };

    return NextResponse.json({
      success: true,
      evaluation: evaluationResult,
      problemId,
      conceptId,
      conceptIds,
      subjectId,
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        error: `서버 내부 처리 오류: ${err?.message || '알 수 없는 오류'}`,
      },
      { status: 500 }
    );
  }
}
