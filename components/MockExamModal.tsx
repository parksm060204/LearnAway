'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Concept, EvaluationResult, MockExamSession, Problem, ProblemType, Subject, isProblemAvailableForPractice } from '../lib/types';
import { getExamScore, loadMockExams, saveMockExam, selectMockExamProblems } from '../lib/mockExam';
import { loadStoredAttempts, loadStoredSettings, recordAttemptAndUpdateConcept } from '../lib/storage';
import { X, Clock, Award } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  subject: Subject;
  concepts: Concept[];
  problems: Problem[];
  onExamRecorded: () => void;
}

const labels: Partial<Record<ProblemType, string>> = {
  essay_descriptive: '논술·서술', calc_derivation: '계산 유도', proof_counterexample: '증명·반례',
  error_spotting: '오류 검증', impl_descriptive: '구현 서술', algorithm_optimization: '알고리즘 최적화',
  complexity_proof: '복잡도 증명', debug_counterexample: '디버깅·반례',
};

export function MockExamModal({ isOpen, onClose, subject, concepts, problems, onExamRecorded }: Props) {
  const eligible = useMemo(() => problems.filter((p) => p.subjectId === subject.id && p.isApproved !== false && isProblemAvailableForPractice(p)), [problems, subject.id]);
  const availableTypes = useMemo(() => Array.from(new Set(eligible.map((p) => p.type))), [eligible]);
  const [conceptIds, setConceptIds] = useState<string[]>(() => concepts.filter((c) => c.subjectId === subject.id).map((c) => c.id));
  const [types, setTypes] = useState<ProblemType[]>(() => Array.from(new Set(problems.filter((p) => p.subjectId === subject.id && p.isApproved !== false && isProblemAvailableForPractice(p)).map((p) => p.type))));
  const [count, setCount] = useState(4);
  const [minutes, setMinutes] = useState(60);
  const [session, setSession] = useState<MockExamSession | null>(() => loadMockExams().find((s) => s.subjectId === subject.id && s.status !== 'recorded') ?? null);
  const [index, setIndex] = useState(0);
  const [now, setNow] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen || session?.status !== 'in_progress') return;
    const timer = window.setInterval(() => {
      const tick = Date.now();
      setNow(tick);
      if (tick >= new Date(session.endsAt).getTime()) {
        setSession((previous) => {
          if (!previous || previous.status !== 'in_progress') return previous;
          const submitted = { ...previous, status: 'submitted' as const, submittedAt: new Date().toISOString() };
          saveMockExam(submitted);
          return submitted;
        });
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isOpen, session?.status, session?.endsAt]);

  const save = (updated: MockExamSession) => { saveMockExam(updated); setSession(updated); };
  const current = session?.problems[index];
  const remaining = session ? (now === 0 ? session.durationMinutes * 60 : Math.max(0, Math.ceil((new Date(session.endsAt).getTime() - now) / 1000))) : 0;
  const blocked = session?.problems.filter((p) => !eligible.some((available) => available.id === p.id)) ?? [];
  const history = isOpen ? loadMockExams().filter((s) => s.subjectId === subject.id && s.status === 'recorded') : [];

  const startExam = () => {
    const chosen = selectMockExamProblems(subject, concepts, eligible, conceptIds, types, count);
    if (chosen.length < count) { setError(`조건에 맞는 문제는 ${chosen.length}개입니다. 문항 수나 범위를 조정해 주세요.`); return; }
    const createdAt = new Date();
    save({ id: crypto.randomUUID(), subjectId: subject.id, createdAt: createdAt.toISOString(),
      endsAt: new Date(createdAt.getTime() + minutes * 60_000).toISOString(), durationMinutes: minutes,
      status: 'in_progress', selectedConceptIds: [...conceptIds], selectedTypes: [...types],
      problems: chosen, answers: {}, evaluations: {} });
    setNow(Date.now()); setIndex(0); setError('');
  };

  const submitExam = () => {
    if (!session || session.status !== 'in_progress' || !window.confirm('답안을 제출하고 시험을 종료할까요?')) return;
    save({ ...session, status: 'submitted', submittedAt: new Date().toISOString() });
  };

  const gradeExam = async () => {
    if (!session || session.status !== 'submitted' || busy || blocked.length) return;
    setBusy(true); setError('');
    const evaluations = { ...session.evaluations };
    try {
      for (const problem of session.problems) {
        const answer = session.answers[problem.id]?.trim();
        if (!answer || evaluations[problem.id]) continue;
        const response = await fetch('/api/evaluate-answer', { method: 'POST',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
            problemId: problem.id, conceptId: problem.conceptIds[0], conceptIds: problem.conceptIds,
            subjectId: subject.id, domain: subject.domain || 'math_stats', problemTitle: problem.title,
            problemPrompt: problem.promptText, appliedConditionNote: problem.appliedConditionNote,
            mathFormula: problem.mathFormula, codeSnippet: problem.codeSnippet, modelAnswer: problem.modelAnswer,
            rubric: problem.rubric, userAnswer: answer, revealedHintCount: 0, hints: [],
          }) });
        const data = await response.json();
        if (!response.ok || !data.success) throw new Error(`문항 「${problem.title}」: ${data.error || '평가 실패'}`);
        evaluations[problem.id] = data.evaluation as EvaluationResult;
        save({ ...session, evaluations: { ...evaluations } });
      }
      save({ ...session, evaluations, status: 'graded' });
    } catch (cause) { setError(cause instanceof Error ? cause.message : '평가에 실패했습니다. 완료된 문항은 보존했습니다.'); }
    finally { setBusy(false); }
  };

  const recordExam = () => {
    if (!session || session.status !== 'graded' || blocked.length) return;
    const settings = loadStoredSettings();
    for (const problem of session.problems) {
      const answer = session.answers[problem.id]?.trim();
      const evaluation = session.evaluations[problem.id];
      if (!answer || !evaluation || !problem.conceptIds.length) continue;
      const id = `att-exam-${session.id}-${problem.id}`;
      if (loadStoredAttempts().some((attempt) => attempt.id === id)) continue;
      recordAttemptAndUpdateConcept({ id, mockExamSessionId: session.id,
        problemId: problem.id, conceptId: problem.conceptIds[0], conceptIds: [...problem.conceptIds],
        subjectId: subject.id, at: session.submittedAt || new Date().toISOString(), answer,
        confidence: 3, errorType: evaluation.recommendedErrorType || 'none', hintCount: 0,
        reasoningNotes: '혼합형 모의시험 답안', calculatedScore: evaluation.calculatedScore,
        rubricResults: evaluation.rubricResults, evaluatorFeedback: evaluation.feedback,
        strengths: evaluation.strengths, criticalImprovements: evaluation.criticalImprovements,
        staticAnalysisNotice: evaluation.staticAnalysisNotice, needsReview: evaluation.needsReview,
        isAiEvaluated: evaluation.isAiEvaluated, problemVersion: problem.version ?? 1,
        problemTitleSnapshot: problem.title, problemPromptSnapshot: problem.promptText,
        modelAnswerSnapshot: problem.modelAnswer, rubricSnapshot: structuredClone(problem.rubric),
      }, settings);
    }
    save({ ...session, status: 'recorded', recordedAttemptIds: session.problems
      .filter((p) => Boolean(session.answers[p.id]?.trim() && session.evaluations[p.id]))
      .map((p) => `att-exam-${session.id}-${p.id}`) });
    onExamRecorded();
  };

  if (!isOpen) return null;
  return <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/50" role="dialog" aria-modal="true" aria-label="혼합형 모의시험">
    <div className="w-full max-w-4xl max-h-[94vh] overflow-y-auto bg-white border border-[#c8c2b5] shadow-xl">
      <header className="bg-[#191817] text-white px-5 py-3 flex items-center justify-between">
        <h2 className="font-bold flex items-center gap-2"><Award className="w-4 h-4 text-[#c52828]" />{subject.name} · 혼합형 모의시험</h2>
        <button onClick={onClose} aria-label="닫기"><X className="w-5 h-5" /></button>
      </header>
      <div className="p-5 space-y-4 text-sm">
        {error && <p role="alert" className="p-3 bg-red-50 border border-red-200 text-red-800">{error}</p>}
        {!session || session.status === 'recorded' ? <>
          <p className="text-[#57544e]">과목의 승인 문제를 섞어 구성합니다. 신고·검토 중인 문항은 제외합니다.</p>
          <div><h3 className="font-semibold mb-2">시험 범위 · 개념 선택</h3><p className="text-xs text-[#606060]">과목 범위: {subject.scope || '별도 지정 없음'} · 아래 개념만 포함합니다.</p>
            <div className="grid sm:grid-cols-2 gap-1 max-h-40 overflow-y-auto border p-2">{concepts.filter((c) => c.subjectId === subject.id).map((c) =>
              <label key={c.id} className="flex gap-2 items-center"><input type="checkbox" checked={conceptIds.includes(c.id)} onChange={() => setConceptIds(conceptIds.includes(c.id) ? conceptIds.filter((id) => id !== c.id) : [...conceptIds, c.id])} />{c.title} <span className="text-xs text-[#827d73]">{c.chapterRef}</span></label>)}</div>
          </div>
          <div><h3 className="font-semibold mb-2">문제 유형</h3><div className="flex flex-wrap gap-3">{availableTypes.map((type) => <label key={type} className="flex gap-1 items-center"><input type="checkbox" checked={types.includes(type)} onChange={() => setTypes(types.includes(type) ? types.filter((x) => x !== type) : [...types, type])} />{labels[type] || type}</label>)}</div></div>
          <div className="flex flex-wrap gap-4"><label>문항 수 <input type="number" min={1} max={10} value={count} onChange={(e) => setCount(Math.min(10, Math.max(1, Number(e.target.value) || 1)))} className="border p-1 w-20 ml-1" /></label><label>제한 시간(분) <input type="number" min={5} max={180} value={minutes} onChange={(e) => setMinutes(Math.min(180, Math.max(5, Number(e.target.value) || 5)))} className="border p-1 w-20 ml-1" /></label></div>
          <p className="text-xs text-[#606060]">출제 가능: {eligible.filter((p) => types.includes(p.type) && p.conceptIds.some((id) => conceptIds.includes(id))).length}문항 · 여러 유형을 선택하면 혼합합니다.</p>
          <button onClick={startExam} disabled={!conceptIds.length || !types.length || !eligible.length} className="bg-[#c52828] text-white px-4 py-2 font-bold disabled:opacity-40">모의시험 시작</button>
          {history.length > 0 && <section className="border-t pt-3"><h3 className="font-semibold">지난 모의시험</h3>{history.map((item) => <details key={item.id} className="border p-2 my-2 text-xs"><summary className="cursor-pointer">{new Date(item.createdAt).toLocaleString('ko-KR')} · {item.problems.length}문항 · AI 평가 평균 {getExamScore(item) ?? '미평가'}점</summary>
            {item.problems.map((p, i) => <div key={p.id} className="border-t mt-2 pt-2 space-y-1"><strong>{i + 1}. {p.title} · 버전 {p.version ?? 1}</strong><p className="whitespace-pre-wrap">{p.promptText}</p><p>제출 답안: {item.answers[p.id] || '미응답'}</p><p>평가: {item.evaluations[p.id]?.calculatedScore ?? 0}점 · {item.evaluations[p.id]?.feedback || '미응답'}</p></div>)}
          </details>)}</section>}
        </> : <>
          <div className="flex justify-between items-center gap-3 border-b pb-2"><strong>{session.status === 'in_progress' ? '진행 중' : session.status === 'submitted' ? '제출 완료 · 평가 대기' : '평가 완료'}</strong><span className="flex items-center gap-1 font-mono"><Clock className="w-4 h-4" />{String(Math.floor(remaining / 60)).padStart(2, '0')}:{String(remaining % 60).padStart(2, '0')}</span></div>
          <nav className="flex flex-wrap gap-2" aria-label="문항 이동">{session.problems.map((p, i) => <button key={p.id} onClick={() => setIndex(i)} className={`border px-2 py-1 ${index === i ? 'bg-[#191817] text-white' : ''}`}>{i + 1}{session.answers[p.id]?.trim() ? ' ✓' : ''}</button>)}</nav>
          {current && <section className="space-y-3">
            <div className="text-xs text-[#827d73]">문항 {index + 1}/{session.problems.length} · {labels[current.type]} · 권장 {current.timeStandardMinutes}분 · 버전 {current.version ?? 1}</div>
            <h3 className="font-bold text-lg">{current.title}</h3><p className="whitespace-pre-wrap leading-relaxed">{current.promptText}</p>
            {current.mathFormula && <pre className="overflow-x-auto bg-[#faf8f4] p-2">{current.mathFormula}</pre>}
            {current.codeSnippet && <pre className="overflow-x-auto bg-[#191817] text-white p-2">{current.codeSnippet}</pre>}
            <label className="block font-semibold">답안<textarea className="block border border-[#c8c2b5] p-3 w-full min-h-44 mt-1 font-normal" value={session.answers[current.id] || ''} disabled={session.status !== 'in_progress'} onChange={(e) => save({ ...session, answers: { ...session.answers, [current.id]: e.target.value } })} placeholder="풀이 과정과 결론을 서술하세요." /></label>
            {session.status !== 'in_progress' && <p className="text-xs text-[#827d73]">모범 답안: {current.modelAnswer}</p>}
            {session.evaluations[current.id] && <div className="bg-[#faf8f4] border p-3 space-y-1"><strong>AI 평가 {session.evaluations[current.id].calculatedScore}/100</strong>
              {session.evaluations[current.id].needsReview && <p className="text-amber-800">AI가 정오 판단의 검토 필요를 표시했습니다. 점수를 확인하고 확정해 주세요.</p>}
              {session.evaluations[current.id].rubricResults.map((r) => <p key={r.criterionId}>{r.label}: {r.score}/{r.maxScore} · {r.feedback || r.deductionReason}</p>)}
              <p>{session.evaluations[current.id].feedback}</p></div>}
          </section>}
          {session.status === 'in_progress' && <button onClick={submitExam} className="bg-[#c52828] text-white px-4 py-2">시험 제출</button>}
          {session.status === 'submitted' && <button onClick={gradeExam} disabled={busy || Boolean(blocked.length)} className="bg-[#191817] text-white px-4 py-2 disabled:opacity-50">{busy ? 'AI 평가 중...' : '답안 평가 (미응답 0점)'}</button>}
          {session.status === 'graded' && <div className="border-t pt-3 space-y-3"><h3 className="font-bold">결과: {getExamScore(session)}점 (문항 평균)</h3><p className="text-xs text-[#606060]">미응답은 0점으로 합산하며 풀이 이력은 만들지 않습니다. 코딩 답안은 실행하지 않는 AI 정적 평가입니다.</p><button onClick={recordExam} disabled={Boolean(blocked.length)} className="bg-[#191817] text-white px-4 py-2 disabled:opacity-50">결과 확인 및 학습 이력 확정</button></div>}
          {blocked.length > 0 && <p className="text-sm text-red-700">품질 검토 상태로 바뀐 문항 {blocked.length}개가 있습니다. 평가·기록을 보류합니다.</p>}
        </>}
      </div>
    </div>
  </div>;
}
