// dev.js — nyxilum_dev_build/nyxilum_dev_test: працюють з ДОВІРЕНИМ джерельним
// кодом самої NyxilumLang (dotnet build / tests/run_all.sh у репозиторії
// мови), а не з довільним .nx-кодом від виклику - на відміну від run.js
// (runNyxilumNode), тут НЕМА NX_SANDBOX/env-allowlist/тимчасового файлу:
// нічого користувацького сюди не потрапляє як текст, тож пісочниця не
// захищає ні від чого й лише заважала б (bash/dotnet мають бачити звичайне
// середовище розробника - PATH, DOTNET_ROOT, HOME тощо).

import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { resolveNyxilumNode } from './locate.js';

const MAX_OUTPUT_BYTES = 64 * 1024;

function ecosystemRoot() {
    // Той самий дефолт, що й у locate.js/tools.js: "NyxilumEcosystem" -
    // стара назва; NyxilumLang реально лежить поруч, сестринським репо.
    return process.env.NX_ECOSYSTEM_ROOT || join(import.meta.dirname, '..', '..', 'NyxilumLang');
}

function truncate(text) {
    const buf = Buffer.from(text ?? '', 'utf8');
    if (buf.length <= MAX_OUTPUT_BYTES) return { text: text ?? '', truncated: false };
    return {
        text: buf.subarray(0, MAX_OUTPUT_BYTES).toString('utf8') + `\n…[обрізано, було ${buf.length} байт]`,
        truncated: true,
    };
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function runDevCommand(cmd, args, { cwd, timeoutMs, extraEnv = {} }) {
    const start = Date.now();
    return new Promise((resolve) => {
        execFile(
            cmd,
            args,
            {
                cwd,
                timeout: timeoutMs,
                killSignal: 'SIGKILL',
                maxBuffer: MAX_OUTPUT_BYTES * 4,
                encoding: 'utf8',
                windowsHide: true,
                env: { ...process.env, ...extraEnv },
            },
            (error, stdout, stderr) => {
                const timedOut = error?.killed === true || error?.signal === 'SIGKILL' || error?.signal === 'SIGTERM';
                const exitCode = typeof error?.code === 'number' ? error.code : (error ? 1 : 0);
                const outTrunc = truncate(stdout);
                const errTrunc = truncate(stderr);
                resolve({
                    success: !error && !timedOut,
                    exitCode,
                    timedOut,
                    stdout: outTrunc.text,
                    stderr: errTrunc.text,
                    truncated: outTrunc.truncated || errTrunc.truncated,
                    durationMs: Date.now() - start,
                });
            }
        );
    });
}

// dotnet build src/NyxilumLang -f net10.0 [-c Debug|Release]. -p:EnableWindowsTargeting=true
// завжди додається - на Linux/Mac без нього restore/build падає одразу
// на TargetFrameworks net10.0-windows (NETSDK1100), як з'ясувалось живцем
// цієї ж сесії; на самій Windows прапорець просто нічого не означає.
export async function nyxilumDevBuild({ configuration, timeout_ms } = {}) {
    const config = configuration === 'Release' ? 'Release' : 'Debug';
    const timeoutMs = clamp(timeout_ms ?? 120_000, 1000, 300_000);
    const root = ecosystemRoot();

    return runDevCommand(
        'dotnet',
        ['build', 'src/NyxilumLang', '-f', 'net10.0', '-c', config, '-p:EnableWindowsTargeting=true'],
        { cwd: root, timeoutMs }
    );
}

// tests/run_all.sh - той самий скрипт, яким користується сам розробник
// мови; NX_EXE вказує на щойно зібраний бінарник (resolveNyxilumNode() -
// та сама логіка "найновіший net10.0-білд", що й в інших інструментах),
// а не на дефолтний net10.0-windows шлях у самому скрипті.
export async function nyxilumDevTest({ timeout_ms } = {}) {
    const timeoutMs = clamp(timeout_ms ?? 180_000, 1000, 300_000);
    const root = ecosystemRoot();

    let nxPath;
    try {
        nxPath = resolveNyxilumNode().path;
    } catch (err) {
        return {
            success: false,
            exitCode: 1,
            timedOut: false,
            stdout: '',
            stderr: err.message,
            truncated: false,
            durationMs: 0,
            note: 'Не знайдено зібраний NyxilumNode - спершу виклич nyxilum_dev_build.',
        };
    }

    const result = await runDevCommand('bash', ['tests/run_all.sh'], {
        cwd: root,
        timeoutMs,
        extraEnv: { NX_EXE: nxPath },
    });
    return { ...result, nxExeUsed: nxPath };
}
