#!/usr/bin/env python3
"""Озвучка одной реплики нейроголосом Microsoft Edge (бесплатно, без ключа).

usage: tts.py <voice> <rate> <pitch> <out.mp3> <out.json>   (текст из stdin)
В out.json пишется список слов с таймингом: [{"t": сек, "d": сек, "w": "слово"}].
"""
import asyncio
import json
import os
import ssl
import sys

import edge_tts
import edge_tts.communicate as communicate


def ssl_context():
    # certifi + корпоративные/прокси сертификаты, если они заданы в окружении
    try:
        import certifi
        ctx = ssl.create_default_context(cafile=certifi.where())
    except Exception:
        ctx = ssl.create_default_context()
    for var in ("EXTRA_CA_FILE", "SSL_CERT_FILE", "NODE_EXTRA_CA_CERTS", "REQUESTS_CA_BUNDLE"):
        path = os.environ.get(var)
        if path and os.path.isfile(path):
            try:
                ctx.load_verify_locations(cafile=path)
            except Exception:
                pass
    return ctx


communicate._SSL_CTX = ssl_context()


async def synth(text, voice, rate, pitch, out_mp3):
    kw = {"boundary": "WordBoundary"}
    if rate and rate != "+0%":
        kw["rate"] = rate
    if pitch and pitch != "+0Hz":
        kw["pitch"] = pitch
    words = []
    with open(out_mp3, "wb") as f:
        async for ch in edge_tts.Communicate(text, voice, **kw).stream():
            if ch["type"] == "audio":
                f.write(ch["data"])
            elif ch["type"] == "WordBoundary":
                words.append({"t": round(ch["offset"] / 1e7, 3), "d": round(ch["duration"] / 1e7, 3), "w": ch["text"]})
    return words


async def main():
    voice, rate, pitch, out_mp3, out_json = sys.argv[1:6]
    text = sys.stdin.read().strip()
    last = None
    # сервис иногда не отдаёт звук с изменённым темпом — тогда пробуем проще
    for r, p in ((rate, pitch), ("+0%", pitch), ("+0%", "+0Hz")):
        for _ in range(2):
            try:
                words = await synth(text, voice, r, p, out_mp3)
                if os.path.getsize(out_mp3) > 0:
                    with open(out_json, "w", encoding="utf-8") as f:
                        json.dump(words, f, ensure_ascii=False)
                    return
            except Exception as e:  # noqa: BLE001
                last = e
                await asyncio.sleep(0.6)
    print(f"TTS failed: {last}", file=sys.stderr)
    sys.exit(1)


asyncio.run(main())
