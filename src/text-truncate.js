// text-truncate.js — спільна логіка обрізання виводу підпроцесу
// (stdout/stderr), винесена з run.js/dev.js, де вона раніше жила двома
// незалежними копіями (і обидві мали той самий баг: наосліп обрізаний
// по байтах Buffer.toString('utf8') може розірвати багатобайтовий
// символ UTF-8 навпіл і підставити replacement character "�" замість
// нього - кирилиця в UTF-8 займає 2 байти на символ, а і NyxilumLang
// (кирилиця в іменах), і сам dotnet/bash-вивід цілком можуть містити
// кириличний текст, тож не теоретичний випадок).
//
// StringDecoder буферизує незавершену послідовність байтів на кінці
// замість того, щоб її "розпакувати" в replacement character - саме
// те, що треба для обрізання показу (просто відкинути недописаний
// хвіст), а не для точного розбору потоку.

import { StringDecoder } from 'node:string_decoder';

/**
 * @param {string} text
 * @param {number} maxBytes
 * @returns {{ text: string, truncated: boolean }}
 */
export function truncateUtf8(text, maxBytes) {
    const buf = Buffer.from(text ?? '', 'utf8');
    if (buf.length <= maxBytes) return { text: text ?? '', truncated: false };
    const safeText = new StringDecoder('utf8').write(buf.subarray(0, maxBytes));
    return {
        text: safeText + `\n…[обрізано, було ${buf.length} байт]`,
        truncated: true,
    };
}
