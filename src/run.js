// run.js — безпечний запуск довільного .nx-коду як окремого процесу.
//
// Код НІКОЛИ не потрапляє в argv/shell як текст — завжди пишеться у
// власний тимчасовий файл і передається лише як шлях. execFile (не
// exec/spawn зі shell:true) означає, що ОС не інтерпретує вміст коду
// як команду, навіть якщо код містить символи на кшталт `&`, `$(...)`,
// `;` тощо — вони просто лишаються текстом усередині .nx-файлу.
//
// NX_GC_MAX_OBJECTS рахує лише NyxilumLang-виділення (масиви/структури/
// мапи) — він НЕ зупинить чистий `while (true) {}` без виділень.
// Єдиний реальний захист від цього — процесний timeout нижче.
//
// NX_SANDBOX=1 — фіксований прапорець, НЕ винесений у inputSchema
// нижче: якби виклик міг сам його вимкнути, це б знецінило пісочницю.
// Під ним NyxilumLang-рантайм (readFile/writeFile/httpGet/osEnv тощо)
// обмежує файловий доступ поточною робочою директорією (dir вище) і
// забороняє мережу й читання змінних середовища — саме тому, що код
// тут потенційно згенерований ШІ й не заслуговує довіри за замовчуванням.

import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveNyxilumNode } from './locate.js';

const MAX_OUTPUT_BYTES = 32 * 1024;
const ENV_ALLOWLIST = ['SystemRoot', 'PATH', 'Path', 'TEMP', 'TMP', 'ProgramFiles', 'ProgramFiles(x86)', 'DOTNET_ROOT'];

function baseEnv() {
    const env = {};
    for (const key of ENV_ALLOWLIST) {
        if (process.env[key] !== undefined) env[key] = process.env[key];
    }
    return env;
}

function truncate(text) {
    const buf = Buffer.from(text ?? '', 'utf8');
    if (buf.length <= MAX_OUTPUT_BYTES) return { text: text ?? '', truncated: false };
    return {
        text: buf.subarray(0, MAX_OUTPUT_BYTES).toString('utf8') + `\n…[обрізано, було ${buf.length} байт]`,
        truncated: true,
    };
}

/**
 * @param {string} code
 * @param {string[]} subArgs аргументи NyxilumNode ПЕРЕД шляхом до файлу (напр. ['format'] чи ['lint'])
 * @param {{ timeoutMs?: number, gcMaxObjects?: number }} options
 */
export async function runNyxilumNode(code, subArgs, options = {}) {
    const timeoutMs = clamp(options.timeoutMs ?? 10_000, 100, 60_000);
    const gcMaxObjects = options.gcMaxObjects ?? 5_000_000;

    const { cmd, preArgs } = resolveNyxilumNode();
    const dir = await mkdtemp(join(tmpdir(), 'nyxilummcp-'));
    const file = join(dir, 'main.nx');
    const start = Date.now();

    try {
        await writeFile(file, code, 'utf8');

        const result = await new Promise((resolvePromise) => {
            const child = execFile(
                cmd,
                [...preArgs, ...subArgs, file],
                {
                    cwd: dir,
                    timeout: timeoutMs,
                    killSignal: 'SIGKILL',
                    maxBuffer: MAX_OUTPUT_BYTES * 4,
                    encoding: 'utf8',
                    windowsHide: true,
                    env: { ...baseEnv(), NX_GC_MAX_OBJECTS: String(gcMaxObjects), NX_SANDBOX: '1' },
                },
                (error, stdout, stderr) => {
                    resolvePromise({
                        error,
                        stdout: stdout ?? '',
                        stderr: stderr ?? '',
                    });
                }
            );
            // execFile сам вбиває дитину при таймауті, але на Windows
            // .exe інколи лишає дочірні процеси — targeted taskkill /T
            // добиває все дерево, а не лише сам NyxilumLang.exe.
            child.on('exit', () => {});
        });

        const timedOut = result.error?.killed === true || result.error?.signal === 'SIGKILL' || result.error?.signal === 'SIGTERM';
        const exitCode = typeof result.error?.code === 'number' ? result.error.code : (result.error ? 1 : 0);

        const outTrunc = truncate(result.stdout);
        const errTrunc = truncate(result.stderr);

        return {
            success: !result.error && !timedOut,
            exitCode,
            timedOut,
            stdout: outTrunc.text,
            stderr: errTrunc.text,
            truncated: outTrunc.truncated || errTrunc.truncated,
            durationMs: Date.now() - start,
        };
    } finally {
        await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}
