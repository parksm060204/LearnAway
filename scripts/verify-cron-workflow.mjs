import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

// Test harness that starts a mock HTTP server with configurable responses,
// then executes the exact bash/node snippet from .github/workflows/cron-scheduler.yml
async function main() {
  console.log('=== [3] Verifying GitHub Actions cron-scheduler.yml HTTP Error Handling ===\n');

  let currentHandler = (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
  };

  const server = http.createServer((req, res) => {
    currentHandler(req, res);
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`Mock HTTP server running on ${baseUrl}\n`);

  // Helper to run bash script matching the workflow
  async function runCronStep(endpoint, secret = 'valid_secret', customUrl = null) {
    const targetUrl = customUrl || `${baseUrl}${endpoint}`;
    const BASH_BIN = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';

    const script = `#!/usr/bin/env bash
APP_URL="${targetUrl}"
CRON_SECRET="${secret}"

BODY_FILE=$(mktemp)
trap 'rm -f "$BODY_FILE"' EXIT

HTTP_CODE=$(curl -sS -o "$BODY_FILE" -w "%{http_code}" \\
  --max-time 10 \\
  --connect-timeout 2 \\
  --max-redirs 0 \\
  -X GET "$APP_URL" \\
  -H "Authorization: Bearer $CRON_SECRET" 2>/dev/null) || CURL_EXIT=$?
CURL_EXIT=\${CURL_EXIT:-0}

if [ $CURL_EXIT -ne 0 ]; then
  echo "CURL_ERROR: code $CURL_EXIT"
  exit 10
fi

if ! [[ "$HTTP_CODE" =~ ^[0-9]{3}$ ]]; then
  echo "INVALID_STATUS: $HTTP_CODE"
  exit 11
fi

if [ "$HTTP_CODE" -lt 200 ] || [ "$HTTP_CODE" -ge 300 ]; then
  echo "HTTP_FAILURE: $HTTP_CODE"
  node -e '
    const fs = require("fs");
    try {
      const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      console.log("Error details:", data.error || data.message || "No details");
    } catch {
      console.log("Non-JSON error response");
    }
  ' "$BODY_FILE"
  exit 12
fi

node -e '
  const fs = require("fs");
  let data;
  try {
    data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  } catch (e) {
    console.error("JSON_PARSE_ERROR: " + e.message);
    process.exit(13);
  }
  if (data.success !== true) {
    console.error("API_LOGICAL_FAILURE: " + (data.error || "Unknown error"));
    process.exit(14);
  }
  const failed = Number(data.failed || data.failedCount || 0);
  if (failed > 0) {
    console.log("PARTIAL_FAILURE: count " + failed);
  } else {
    console.log("ALL_SUCCESS");
  }
' "$BODY_FILE"
`;

    const tmpScript = path.resolve(`.tmp_cron_test_${Date.now()}_${Math.random().toString(36).slice(2)}.sh`);
    fs.writeFileSync(tmpScript, script, 'utf8');

    try {
      const { stdout, stderr } = await execAsync(`"${BASH_BIN}" "${tmpScript.replace(/\\/g, '/')}"`);
      return { code: 0, stdout: stdout.trim(), stderr: stderr.trim() };
    } catch (err) {
      return { code: err.code, stdout: (err.stdout || '').trim(), stderr: (err.stderr || '').trim() };
    } finally {
      if (fs.existsSync(tmpScript)) fs.unlinkSync(tmpScript);
    }
  }

  const tests = [
    {
      name: '1. Normal 200 JSON (Reminders All Success)',
      handler: (req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, totalEvaluated: 5, dispatched: 5, skipped: 0, failed: 0 }));
      },
      expectedCode: 0,
      expectedOut: 'ALL_SUCCESS',
    },
    {
      name: '2. Normal 200 JSON with Partial Failure (failed > 0)',
      handler: (req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, totalEvaluated: 5, dispatched: 3, skipped: 0, failed: 2 }));
      },
      expectedCode: 0,
      expectedOut: 'PARTIAL_FAILURE: count 2',
    },
    {
      name: '3. HTTP 200 with success: false (Business failure)',
      handler: (req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Database locked' }));
      },
      expectedCode: 14,
      expectedOut: 'API_LOGICAL_FAILURE: Database locked',
    },
    {
      name: '4. HTTP 401 Unauthorized with JSON body',
      handler: (req, res) => {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Invalid cron secret' }));
      },
      expectedCode: 12,
      expectedOut: 'HTTP_FAILURE: 401\nError details: Invalid cron secret',
    },
    {
      name: '5. HTTP 500 Internal Server Error with JSON body',
      handler: (req, res) => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Database connection timed out' }));
      },
      expectedCode: 12,
      expectedOut: 'HTTP_FAILURE: 500\nError details: Database connection timed out',
    },
    {
      name: '6. Multiline JSON body with newlines and indentation',
      handler: (req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          details: "line 1\nline 2\nline 3",
          failedCount: 0
        }, null, 2));
      },
      expectedCode: 0,
      expectedOut: 'ALL_SUCCESS',
    },
    {
      name: '7. Non-JSON multiline error (HTML error page)',
      handler: (req, res) => {
        res.writeHead(502, { 'Content-Type': 'text/html' });
        res.end('<html>\n<body>502 Bad Gateway</body>\n</html>');
      },
      expectedCode: 12,
      expectedOut: 'HTTP_FAILURE: 502\nNon-JSON error response',
    },
    {
      name: '8. Empty body on 200 OK',
      handler: (req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('');
      },
      expectedCode: 13,
      expectedOut: 'JSON_PARSE_ERROR',
    },
    {
      name: '9. Redirect 302 (must NOT be treated as success)',
      handler: (req, res) => {
        res.writeHead(302, { 'Location': '/auth/login' });
        res.end('Redirecting to login...');
      },
      expectedCode: 12,
      expectedOut: 'HTTP_FAILURE: 302',
    },
    {
      name: '10. Network connection failure (Dead port)',
      handler: null,
      customUrl: 'http://127.0.0.1:59999/api/cron',
      expectedCode: 10,
      expectedOut: 'CURL_ERROR:',
    },
  ];

  let passed = 0;
  for (const t of tests) {
    if (t.handler) {
      currentHandler = t.handler;
    }
    const res = await runCronStep('/api/reminders/cron', 'secret', t.customUrl);
    const codeMatch = res.code === t.expectedCode;
    const outMatch = (res.stdout + ' ' + res.stderr).includes(t.expectedOut);

    if (codeMatch && outMatch) {
      console.log(`✓ PASS: ${t.name}`);
      passed++;
    } else {
      console.error(`✗ FAIL: ${t.name}`);
      console.error(`  Expected code: ${t.expectedCode}, got: ${res.code}`);
      console.error(`  Expected output to include: "${t.expectedOut}"`);
      console.error(`  Actual stdout: "${res.stdout}"`);
      console.error(`  Actual stderr: "${res.stderr}"`);
      server.close();
      process.exit(1);
    }
  }

  server.close();
  console.log(`\n🎉 All ${passed}/${tests.length} Cron Workflow Simulation Tests Passed Successfully!\n`);
}

main();
