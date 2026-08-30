// Расшифровка голосовых через AssemblyAI (речь → текст), режим pre-recorded.
//
// Используется официальный SDK: transcribe() сам загружает аудио и дожидается результата,
// то есть upload + polling вручную писать не нужно.
// Ключ SDK подставляет в заголовок Authorization как есть, без префикса Bearer.

import { AssemblyAI } from "assemblyai";
import { config } from "./config.js";

const client = new AssemblyAI({ apiKey: config.assemblyAiApiKey });

/**
 * Превращает голосовое в текст.
 * Пустая строка означает «речь не распознана» — это не ошибка, а обычный случай:
 * клиент записал тишину или шум.
 */
export async function transcribe(audio: Buffer): Promise<string> {
  const transcript = await client.transcripts.transcribe({
    audio,
    // Модель задаётся массивом: в типах SDK строка speech_model не знает про universal-2,
    // а speech_models принимает названия моделей как есть.
    speech_models: [config.speechModel],
    // Клиенты пишут в основном по-русски, иногда по-английски — язык определяем автоматически.
    language_detection: true,
  });

  if (transcript.status === "error") {
    throw new Error(`AssemblyAI не смог расшифровать: ${transcript.error}`);
  }

  return transcript.text?.trim() ?? "";
}
