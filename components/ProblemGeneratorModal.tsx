'use client';

import React, { useState, useMemo } from 'react';
import { Subject, Concept, Material, ProblemType, ProblemDifficulty, ProblemDraft } from '../lib/types';
import { collectProblemSources } from '../lib/problemSources';
import { X, Sparkles, AlertCircle, BrainCircuit, Loader2 } from 'lucide-react';

interface ProblemGeneratorModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeSubject: Subject;
  concepts: Concept[];
  materials: Material[];
  selectedConceptId?: string;
  onGenerateSuccess: (newDrafts: ProblemDraft[]) => void;
}

const MATH_PROBLEM_TYPES: { type: ProblemType; label: string; desc: string; estMin: number }[] = [
  {
    type: 'essay_descriptive',
    label: '1. 대학 논술·서술형 (기본)',
    desc: '수학적 정의와 정리의 전제조건, 엄밀한 논리 전개 및 의의 서술',
    estMin: 20,
  },
  {
    type: 'calc_derivation',
    label: '2. 계산 유도형',
    desc: '수식 전개, 모수 추정, 미적분 및 대수학적 대입을 통한 최종 해 도출',
    estMin: 20,
  },
  {
    type: 'proof_counterexample',
    label: '3. 증명 및 반례',
    desc: '수학적 명제의 참/거짓 판별, 엄밀 증명 또는 반례 구성',
    estMin: 25,
  },
  {
    type: 'error_spotting',
    label: '4. 오류 검증형',
    desc: '제시된 잘못된 증명이나 풀이에서 논리적 비약과 오류 단계를 찾아 수정',
    estMin: 15,
  },
];

const CS_PROBLEM_TYPES: { type: ProblemType; label: string; desc: string; estMin: number }[] = [
  {
    type: 'impl_descriptive',
    label: '1. 구현 및 서술형 (기본)',
    desc: '자료구조 및 알고리즘의 동작 원리, 불변식, 핵심 구현 단계 서술',
    estMin: 20,
  },
  {
    type: 'algorithm_optimization',
    label: '2. 알고리즘 최적화 설명',
    desc: '비효율적 접근법을 분석하고 최적 자료구조와 점근적 개선 방안 도출',
    estMin: 25,
  },
  {
    type: 'complexity_proof',
    label: '3. 시간/공간 복잡도 증명',
    desc: '점화식 마스터 정리, 상각 분석(Amortized Analysis), 최악/평균 복잡도 증명',
    estMin: 20,
  },
  {
    type: 'debug_counterexample',
    label: '4. 디버깅 및 반례 분석',
    desc: '경계 조건(Corner Case), 무한 루프, 메모리 누수 또는 실패 테스트케이스 제시',
    estMin: 15,
  },
];

export function ProblemGeneratorModal({
  isOpen,
  onClose,
  activeSubject,
  concepts,
  materials,
  selectedConceptId,
  onGenerateSuccess,
}: ProblemGeneratorModalProps) {
  const isMath = activeSubject.domain === 'math_stats';
  const availableTypes = isMath ? MATH_PROBLEM_TYPES : CS_PROBLEM_TYPES;

  // Filter approved concepts in current subject
  const eligibleConcepts = concepts.filter(
    (c) => c.subjectId === activeSubject.id && c.status !== undefined
  );

  // Initial selected concepts: prefer selectedConceptId if valid, else first concept
  const [selectedConceptIds, setSelectedConceptIds] = useState<string[]>(() => {
    if (selectedConceptId && eligibleConcepts.some((c) => c.id === selectedConceptId)) {
      return [selectedConceptId];
    }
    return eligibleConcepts.length > 0 ? [eligibleConcepts[0].id] : [];
  });

  const [selectedType, setSelectedType] = useState<ProblemType>(() => {
    return isMath ? 'essay_descriptive' : 'impl_descriptive';
  });

  const [difficulty, setDifficulty] = useState<ProblemDifficulty>('advanced_college');
  const [problemCount, setProblemCount] = useState<number>(1);
  const [isGenerating, setIsGenerating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Materials actually linked to the currently selected concepts (same subject only).
  const selectedSourceMaterials = useMemo(() => {
    const ids = new Set<string>();
    eligibleConcepts
      .filter((c) => selectedConceptIds.includes(c.id))
      .forEach((c) => (c.materialIds || []).forEach((id) => ids.add(id)));
    return materials.filter((m) => m.subjectId === activeSubject.id && ids.has(m.id));
  }, [eligibleConcepts, selectedConceptIds, materials, activeSubject.id]);

  if (!isOpen) return null;

  const toggleConceptSelection = (conceptId: string) => {
    if (selectedConceptIds.includes(conceptId)) {
      if (selectedConceptIds.length === 1) {
        alert('최소 1개 이상의 개념을 선택해야 합니다.');
        return;
      }
      setSelectedConceptIds(selectedConceptIds.filter((id) => id !== conceptId));
    } else {
      setSelectedConceptIds([...selectedConceptIds, conceptId]);
    }
  };

  const handleSelectAllConcepts = () => {
    setSelectedConceptIds(eligibleConcepts.map((c) => c.id));
  };

  const handleClearConcepts = () => {
    if (eligibleConcepts.length > 0) {
      setSelectedConceptIds([eligibleConcepts[0].id]);
    }
  };

  const handleGenerate = async () => {
    if (isGenerating) return;
    if (selectedConceptIds.length === 0) {
      setErrorMessage('문제를 생성할 대상 개념을 최소 1개 이상 선택해 주세요.');
      return;
    }

    const targetConcepts = eligibleConcepts.filter((c) => selectedConceptIds.includes(c.id));

    setIsGenerating(true);
    setErrorMessage(null);

    try {
      const collected = await collectProblemSources({
        concepts: targetConcepts,
        materials,
        subjectId: activeSubject.id,
      });
      if (!collected.ok) {
        setErrorMessage(collected.error);
        return;
      }

      const response = await fetch('/api/generate-problems', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subjectId: activeSubject.id,
          subjectDomain: activeSubject.domain,
          concepts: targetConcepts,
          problemType: selectedType,
          difficulty,
          problemCount,
          sources: collected.sources,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        const errorMsg = data.error || 'AI 문제 생성에 실패했습니다.';
        const rawErr = data.rawError ? `\n(${data.rawError})` : '';
        setErrorMessage(`${errorMsg}${rawErr}`);
        return;
      }

      const generatedDrafts: ProblemDraft[] = Array.isArray(data.drafts) ? data.drafts : [];
      if (generatedDrafts.length === 0) {
        setErrorMessage('생성된 문제가 없습니다. 다시 시도해 주세요.');
        return;
      }

      onGenerateSuccess(generatedDrafts);
      onClose();
    } catch (err) {
      setErrorMessage(
        `네트워크 또는 서버 오류: ${err instanceof Error ? err.message : '알 수 없는 오류'}`
      );
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/60 backdrop-blur-xs overflow-y-auto">
      <div className="w-full max-w-2xl bg-white border border-[#c8c2b5] rounded-xs shadow-2xl my-auto overflow-hidden flex flex-col max-h-[92vh] animate-fade-in font-sans">
        {/* Header */}
        <div className="bg-[#191817] text-white px-5 py-3.5 flex items-center justify-between border-b border-[#33302b]">
          <div className="flex items-center gap-2.5">
            <span className="w-2.5 h-2.5 bg-[#c52828] inline-block shrink-0" />
            <span className="font-academic-mono text-xs text-[#ded6c8]">EXAM PROBLEM GENERATOR</span>
            <span className="text-[#827d73]">|</span>
            <span className="text-xs sm:text-sm font-bold text-white flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-amber-400" />
              <span>AI 시험 문제 출제 ({activeSubject.name})</span>
            </span>
          </div>

          <button
            onClick={onClose}
            disabled={isGenerating}
            className="text-[#ded6c8] hover:text-white p-1 rounded-xs transition-colors disabled:opacity-50"
            aria-label="닫기"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 sm:p-6 overflow-y-auto space-y-5 text-[#191817]">
          {/* Guide Banner */}
          <div className="p-3.5 bg-[#faf8f4] border border-[#ded6c8] rounded-xs text-xs space-y-1.5">
            <div className="font-bold flex items-center gap-1.5 text-[#191817]">
              <BrainCircuit className="w-4 h-4 text-[#c52828]" />
              <span>고난도 대학 시험형 AI 출제 엔진</span>
            </div>
            <p className="text-[11.5px] text-[#57544e] leading-relaxed">
              승인된 학술 개념을 바탕으로 대학 시험 수준의 고난도 서술형 문제를 출제합니다. 단순 수치
              치환이 아닌 심화 제약, 경계 조건, 개념 간 복합 연계를 설계하며, 총점 100점의 세부
              루브릭과 단계별 힌트를 함께 제공합니다.
            </p>
          </div>

          {/* Error Message Alert */}
          {errorMessage && (
            <div className="p-3.5 bg-red-50 border border-red-200 rounded-xs text-xs text-red-800 space-y-1">
              <div className="font-bold flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                <span>출제 오류 안내</span>
              </div>
              <p className="text-[11.5px] whitespace-pre-wrap leading-relaxed">{errorMessage}</p>
            </div>
          )}

          {/* Section 1: Target Concepts Selection */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold font-academic-mono text-[#57544e] uppercase flex items-center gap-1.5">
                <span>1. 대상 개념 선택 (다중 선택 가능)</span>
                <span className="text-[#c52828] font-bold">
                  {selectedConceptIds.length}개 선택됨
                </span>
              </label>

              <div className="flex items-center gap-2 text-[11px] font-academic-mono">
                <button
                  type="button"
                  onClick={handleSelectAllConcepts}
                  className="text-[#57544e] hover:text-[#c52828] underline"
                >
                  전체 선택
                </button>
                <span className="text-[#ded6c8]">|</span>
                <button
                  type="button"
                  onClick={handleClearConcepts}
                  className="text-[#57544e] hover:text-[#c52828] underline"
                >
                  초기화
                </button>
              </div>
            </div>

            {eligibleConcepts.length === 0 ? (
              <div className="p-4 border border-dashed border-[#ded6c8] rounded-xs text-center text-xs text-[#827d73]">
                현재 과목에 등록된 개념이 없습니다. 먼저 자료에서 개념을 추출하고 승인해 주세요.
              </div>
            ) : (
              <div className="max-h-44 overflow-y-auto border border-[#ded6c8] rounded-xs p-2 bg-[#faf8f4] space-y-1.5">
                {eligibleConcepts.map((concept) => {
                  const isChecked = selectedConceptIds.includes(concept.id);
                  return (
                    <label
                      key={concept.id}
                      className={`flex items-start gap-2.5 p-2 rounded-xs border cursor-pointer transition-all ${
                        isChecked
                          ? 'bg-white border-[#c52828] shadow-2xs'
                          : 'bg-transparent border-transparent hover:bg-white hover:border-[#ded6c8]'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleConceptSelection(concept.id)}
                        className="mt-0.5 accent-[#c52828]"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs font-bold text-[#191817] truncate">
                            {concept.title}
                          </span>
                          {concept.isDemo ? (
                            <span className="text-[9.5px] font-academic-mono bg-[#f4f1ea] border border-[#ded6c8] px-1 rounded-2xs text-[#827d73]">
                              데모 개념
                            </span>
                          ) : (
                            <span className="text-[9.5px] font-academic-mono bg-emerald-50 border border-emerald-300 text-emerald-800 px-1 rounded-2xs font-semibold">
                              자료 추출 승인
                            </span>
                          )}
                          {concept.status === 'unstudied' && (
                            <span className="text-[9.5px] font-academic-mono bg-slate-100 border border-slate-300 text-slate-600 px-1 rounded-2xs">
                              미학습 (대기)
                            </span>
                          )}
                        </div>
                        {concept.description && (
                          <p className="text-[11px] text-[#57544e] line-clamp-1 mt-0.5">
                            {concept.description}
                          </p>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {/* Linked source materials (grounding) */}
          <div className="p-3 rounded-xs border border-[#ded6c8] bg-[#faf8f4] text-[11.5px] space-y-1">
            <div className="font-bold font-academic-mono text-[#57544e] uppercase tracking-wider">
              연결된 학습 자료 (원문 근거)
            </div>
            {selectedSourceMaterials.length === 0 ? (
              <p className="text-red-700 leading-relaxed">
                선택한 개념에 연결된 자료 본문이 없습니다. 자료를 등록하고 개념에 연결한 뒤 출제할 수 있습니다.
              </p>
            ) : (
              <ul className="space-y-0.5 text-[#57544e]">
                {selectedSourceMaterials.map((m) => (
                  <li key={m.id} className="line-clamp-1">
                    · <strong className="text-[#191817]">{m.title}</strong> <span className="text-[#827d73]">({m.sourceRefs})</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Section 2: Problem Type Selection */}
          <div className="space-y-2">
            <label className="text-xs font-bold font-academic-mono text-[#57544e] uppercase flex items-center justify-between">
              <span>2. 문제 유형 선택 ({isMath ? '수학/수리통계' : '컴퓨터과학/코딩'})</span>
              <span className="text-[11px] text-[#827d73] font-normal">
                과목 분야 전용 유형 4종
              </span>
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {availableTypes.map((typeObj) => {
                const isSelected = selectedType === typeObj.type;
                return (
                  <button
                    key={typeObj.type}
                    type="button"
                    onClick={() => setSelectedType(typeObj.type)}
                    className={`text-left p-3 rounded-xs border transition-all ${
                      isSelected
                        ? 'bg-[#191817] text-white border-[#191817] shadow-xs'
                        : 'bg-[#faf8f4] text-[#191817] border-[#ded6c8] hover:bg-white hover:border-[#b8b0a2]'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-bold">{typeObj.label}</span>
                      <span
                        className={`text-[10px] font-academic-mono ${
                          isSelected ? 'text-[#ded6c8]' : 'text-[#827d73]'
                        }`}
                      >
                        ~{typeObj.estMin}분
                      </span>
                    </div>
                    <p
                      className={`text-[11px] leading-relaxed line-clamp-2 ${
                        isSelected ? 'text-[#c8c2b5]' : 'text-[#57544e]'
                      }`}
                    >
                      {typeObj.desc}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Section 3: Difficulty & Problem Count */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
            <div className="space-y-1.5">
              <label className="text-xs font-bold font-academic-mono text-[#57544e] uppercase">
                3. 출제 난이도
              </label>
              <select
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value as ProblemDifficulty)}
                className="w-full p-2 text-xs border border-[#ded6c8] rounded-xs bg-white text-[#191817] focus:outline-none focus:border-[#c52828]"
              >
                <option value="advanced_college">
                  고난도·대학 학부 시험 수준 (기본)
                </option>
                <option value="intermediate">
                  중간고사 표준형 (응용 및 개념 통합)
                </option>
                <option value="graduate_challenging">
                  대학원·심화 도전형 (일반화 및 엄밀 증명)
                </option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold font-academic-mono text-[#57544e] uppercase flex items-center justify-between">
                <span>출제 문항 수</span>
                <span className="text-[#827d73] text-[11px]">최대 3문항</span>
              </label>
              <div className="grid grid-cols-3 gap-2">
                {[1, 2, 3].map((num) => (
                  <button
                    key={num}
                    type="button"
                    onClick={() => setProblemCount(num)}
                    className={`py-2 text-xs font-academic-mono font-bold rounded-xs border transition-all ${
                      problemCount === num
                        ? 'bg-[#c52828] text-white border-[#c52828] shadow-xs'
                        : 'bg-white text-[#57544e] border-[#ded6c8] hover:bg-[#faf8f4]'
                    }`}
                  >
                    {num}문항
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 bg-[#faf8f4] border-t border-[#ded6c8] flex items-center justify-between gap-3">
          <div className="text-[11px] font-academic-mono text-[#827d73]">
            API: {activeSubject.domain === 'math_stats' ? '수리통계 수식 생성' : '알고리즘 코드 검증'}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isGenerating}
              className="px-4 py-2 text-xs border border-[#ded6c8] text-[#57544e] hover:bg-white rounded-xs transition-colors disabled:opacity-50"
            >
              취소
            </button>

            <button
              type="button"
              onClick={handleGenerate}
              disabled={isGenerating || eligibleConcepts.length === 0 || selectedSourceMaterials.length === 0}
              className="flex items-center gap-2 px-5 py-2 bg-[#c52828] hover:bg-[#a82020] text-white text-xs font-bold rounded-xs shadow-xs transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>학술 AI 출제 중...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 text-amber-300" />
                  <span>AI 고난도 문제 생성 실행 ({problemCount}문항)</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
