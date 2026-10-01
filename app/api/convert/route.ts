import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';

export async function POST(req: NextRequest) {
  let tempFilePath: string | null = null;

  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json(
        {
          success: false,
          hasText: false,
          pageCount: 0,
          error: '업로드된 PDF 파일이 없습니다.',
          pages: [],
          fullMarkdown: '',
        },
        { status: 400 }
      );
    }

    const filename = file.name || 'document.pdf';
    if (!filename.toLowerCase().endsWith('.pdf')) {
      return NextResponse.json(
        {
          success: false,
          hasText: false,
          pageCount: 0,
          error: 'PDF 파일(.pdf)만 변환을 지원합니다.',
          pages: [],
          fullMarkdown: '',
        },
        { status: 400 }
      );
    }

    // Convert file to buffer and write to temp directory
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const tempDir = os.tmpdir();
    tempFilePath = path.join(tempDir, `redcall_pdf_${Date.now()}_${Math.random().toString(36).substring(7)}.pdf`);
    await fs.writeFile(tempFilePath, buffer);

    const scriptPath = path.join(process.cwd(), 'scripts', 'convert_pdf.py');

    // Run Python convert_pdf.py worker using 'py' (or 'python')
    const pythonCmd = process.platform === 'win32' ? 'py' : 'python3';

    const result = await new Promise<{
      success: boolean;
      hasText: boolean;
      pageCount: number;
      pages: { pageNumber: number; markdown: string; hasText: boolean }[];
      fullMarkdown: string;
      error?: string | null;
    }>((resolve, reject) => {
      const child = spawn(pythonCmd, [scriptPath, tempFilePath!], {
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      });

      let stdoutData = '';
      let stderrData = '';
      let settled = false;

      // Hard time limit: never leave a hung conversion process running.
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill('SIGKILL');
        reject(new Error('PDF 변환 시간이 초과되었습니다 (120초). 파일을 확인 후 다시 시도해 주세요.'));
      }, 120000);

      const finish = (action: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        action();
      };

      child.stdout.on('data', (chunk) => {
        stdoutData += chunk.toString('utf-8');
      });

      child.stderr.on('data', (chunk) => {
        stderrData += chunk.toString('utf-8');
      });

      child.on('close', () => {
        finish(() => {
          try {
            if (!stdoutData.trim()) {
              resolve({
                success: false,
                hasText: false,
                pageCount: 0,
                pages: [],
                fullMarkdown: '',
                error: stderrData.trim() || '변환 프로세스에서 출력이 생성되지 않았습니다.',
              });
              return;
            }

            const parsed = JSON.parse(stdoutData.trim());
            resolve(parsed);
          } catch (e) {
            reject(
              new Error(
                `결과 파싱 실패: ${e instanceof Error ? e.message : '알 수 없는 오류'}\nSTDOUT: ${stdoutData}\nSTDERR: ${stderrData}`
              )
            );
          }
        });
      });

      child.on('error', (err) => {
        finish(() => {
          reject(new Error(`Python 프로세스 실행 실패 (${pythonCmd}): ${err.message}`));
        });
      });
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('PDF Conversion API Error:', error);
    return NextResponse.json(
      {
        success: false,
        hasText: false,
        pageCount: 0,
        pages: [],
        fullMarkdown: '',
        error: error instanceof Error ? error.message : '서버에서 PDF 변환 중 오류가 발생했습니다.',
      },
      { status: 500 }
    );
  } finally {
    if (tempFilePath) {
      try {
        await fs.unlink(tempFilePath);
      } catch {
        // ignore temp cleanup error
      }
    }
  }
}
