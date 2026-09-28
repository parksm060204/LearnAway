'use client';

import React, { useState } from 'react';
import { Subject } from '../lib/types';
import { X, Layers, Plus, Trash2, Check } from 'lucide-react';

interface ScopeManageModalProps {
  isOpen: boolean;
  onClose: () => void;
  subject: Subject;
  onUpdateSubject: (updated: Subject) => void;
}

export function ScopeManageModal({
  isOpen,
  onClose,
  subject,
  onUpdateSubject,
}: ScopeManageModalProps) {
  const [scopeText, setScopeText] = useState(subject.scope);
  const [chapters, setChapters] = useState<string[]>(subject.chapters || []);
  const [newChapter, setNewChapter] = useState('');

  if (!isOpen) return null;

  const handleAddChapter = () => {
    if (!newChapter.trim()) return;
    setChapters([...chapters, newChapter.trim()]);
    setNewChapter('');
  };

  const handleRemoveChapter = (index: number) => {
    setChapters(chapters.filter((_, i) => i !== index));
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const updated: Subject = {
      ...subject,
      scope: scopeText,
      chapters,
    };
    onUpdateSubject(updated);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
      <div className="w-full max-w-lg bg-white border border-[#c8c2b5] rounded-xs shadow-xl overflow-hidden">
        {/* Header */}
        <div className="bg-[#191817] text-white px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-[#c52828]" />
            <h3 className="font-academic-serif text-sm font-bold">출제 범위 및 단원 관리</h3>
          </div>
          <button onClick={onClose} className="text-[#ded6c8] hover:text-white" aria-label="닫기">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSave} className="p-5 space-y-4 text-xs font-sans">
          <div>
            <label className="block font-academic-mono text-[11px] text-[#57544e] mb-1">
              시험 전체 출제 범위 요약:
            </label>
            <input
              type="text"
              value={scopeText}
              onChange={(e) => setScopeText(e.target.value)}
              placeholder="예: 제1장 ~ 제4장 [확률변수, 조건부 기댓값, 결합분포, 검정이론]"
              required
              className="w-full p-2 border border-[#ded6c8] rounded-xs bg-[#fefefe] text-[#191817]"
            />
          </div>

          <div>
            <label className="block font-academic-mono text-[11px] text-[#57544e] mb-1">
              상세 단원 및 교재 챕터 목록 ({chapters.length}개):
            </label>
            <div className="space-y-1.5 max-h-48 overflow-y-auto p-2 border border-[#ded6c8] rounded-xs bg-[#faf8f4]">
              {chapters.map((ch, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between gap-2 p-1.5 bg-white border border-[#ede8de] rounded-xs text-xs"
                >
                  <span className="text-[#191817] font-medium">{ch}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveChapter(idx)}
                    className="text-[#827d73] hover:text-[#c52828] p-1"
                    title="단원 삭제"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>

            {/* Add new chapter */}
            <div className="flex gap-2 mt-2">
              <input
                type="text"
                value={newChapter}
                onChange={(e) => setNewChapter(e.target.value)}
                placeholder="추가할 단원명 입력 (예: 제5장 가설검정)"
                className="flex-1 p-2 border border-[#ded6c8] rounded-xs bg-white text-[#191817]"
              />
              <button
                type="button"
                onClick={handleAddChapter}
                className="px-3 py-2 bg-[#faf8f4] hover:bg-white border border-[#ded6c8] text-[#191817] font-medium rounded-xs flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>추가</span>
              </button>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#f1ede4]">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 text-xs border border-[#ded6c8] text-[#57544e] hover:bg-[#faf8f4] rounded-xs"
            >
              취소
            </button>
            <button
              type="submit"
              className="flex items-center gap-1.5 px-4 py-2 text-xs bg-[#191817] hover:bg-[#33302b] text-white font-bold rounded-xs shadow-xs"
            >
              <Check className="w-3.5 h-3.5 text-emerald-400" />
              <span>범위 저장</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
