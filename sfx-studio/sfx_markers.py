"""SFX по маркерам — без Claude и без интернета.

1. Положите звуки в Документы\\Mentol\\музыка. Имя файла начинается с типа звука:
       whoosh_01.wav, whoosh_02.wav, удар_1.wav, клик.mp3
   или разложите по подпапкам:  музыка\\whoosh\\*.wav, музыка\\удар\\*.wav
2. В Resolve поставьте маркеры на таймлайне (клавиша M) и в имени маркера
   напишите тип звука: whoosh, удар, клик ...  (двойной клик по маркеру -> Name)
3. Запустите run_markers.bat — каждый тип ляжет на свою НОВУЮ дорожку "SFX <тип>".
   Если файлов одного типа несколько, они чередуются, чтобы не повторяться.
   Маркеры, для которых нет звука, пропускаются (их список выводится в конце).

Чтобы удар звучал чуть раньше кадра, допишите сдвиг в кадрах: "удар -2".
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import place_sfx as ps  # noqa: E402

AUDIO_EXT = {".wav", ".mp3", ".aif", ".aiff", ".flac", ".ogg", ".m4a"}


def collect_sounds(folder):
    """{тип: [пути]} из имён файлов и подпапок."""
    sounds = {}
    for dirpath, _, files in os.walk(folder):
        sub = os.path.relpath(dirpath, folder)
        for f in sorted(files):
            stem, ext = os.path.splitext(f)
            if ext.lower() not in AUDIO_EXT:
                continue
            if sub != ".":
                key = sub.split(os.sep)[0].lower()
            else:
                key = stem.lower().replace("-", "_").replace(" ", "_").split("_")[0].rstrip("0123456789")
            if key:
                sounds.setdefault(key, []).append(os.path.join(dirpath, f))
    return sounds


def parse_marker(m):
    text = (m.get("name") or "").strip() or (m.get("note") or "").strip()
    parts = text.lower().split()
    if not parts:
        return None, 0
    offset = 0
    if len(parts) > 1:
        try:
            offset = int(parts[-1])
            parts = parts[:-1]
        except ValueError:
            pass
    return " ".join(parts), offset


def main():
    folder = ps.SFX_DIR
    print(f"Звуки: {folder}")
    if not os.path.isdir(folder):
        ps.fail(f"нет папки {folder}")
    sounds = collect_sounds(folder)
    if not sounds:
        ps.fail("в папке нет аудиофайлов (wav, mp3, aif, flac, ogg, m4a)")
    print("Типы звуков: " + ", ".join(f"{k} ({len(v)})" for k, v in sorted(sounds.items())))

    ps.setup_resolve_env()
    try:
        import DaVinciResolveScript as dvr
    except ImportError:
        ps.fail("не найден модуль скриптинга Resolve. Установлен ли DaVinci Resolve Studio?")
    resolve = dvr.scriptapp("Resolve")
    if not resolve:
        ps.fail("Resolve не отвечает. Запустите Resolve Studio и включите "
                "Preferences -> General -> External scripting using -> Local")
    project = resolve.GetProjectManager().GetCurrentProject()
    timeline = project and project.GetCurrentTimeline()
    if not timeline:
        ps.fail("нет открытого проекта или активного таймлайна")

    fps = int(round(float(timeline.GetSetting("timelineFrameRate") or 24)))
    start = timeline.GetStartFrame()
    markers = timeline.GetMarkers() or {}
    print(f"Таймлайн: {timeline.GetName()}, {fps} fps, маркеров: {len(markers)}")

    plan, skipped = [], []
    counters = {}
    for frame in sorted(markers, key=float):
        key, offset = parse_marker(markers[frame])
        if not key:
            continue
        files = sounds.get(key)
        if not files:
            skipped.append(f"{key} (кадр {int(float(frame))})")
            continue
        i = counters.get(key, 0)
        counters[key] = i + 1
        plan.append((key, files[i % len(files)], start + int(float(frame)) + offset))
    if not plan:
        ps.fail("ни один маркер не совпал с типом звука. Имена маркеров должны быть как типы выше")

    pool = project.GetMediaPool()
    root = pool.GetRootFolder()
    sfx_bin = next((b for b in (root.GetSubFolderList() or []) if b.GetName() == "SFX"), None) \
        or pool.AddSubFolder(root, "SFX")
    pool.SetCurrentFolder(sfx_bin)
    imported = pool.ImportMedia(sorted({p for _, p, _ in plan})) or []
    by_path = {}
    for item in imported + list(sfx_bin.GetClipList() or []):
        fp = item.GetClipProperty("File Path")
        if fp:
            by_path[os.path.normcase(os.path.abspath(fp))] = item

    track_idx = {}
    for key in dict.fromkeys(k for k, _, _ in plan):
        if not timeline.AddTrack("audio", "stereo"):
            ps.fail(f"не удалось создать дорожку для {key}")
        idx = timeline.GetTrackCount("audio")
        timeline.SetTrackName("audio", idx, f"SFX {key}")
        track_idx[key] = idx

    placed, failed = 0, []
    for key, path, frame in plan:
        item = by_path.get(os.path.normcase(os.path.abspath(path)))
        if not item:
            failed.append(f"{os.path.basename(path)}: не импортировался")
            continue
        info = {"mediaPoolItem": item, "trackIndex": track_idx[key], "recordFrame": frame, "mediaType": 2}
        length = ps.clip_length_frames(item, fps)
        if length:
            info.update(startFrame=0, endFrame=length - 1)
        if pool.AppendToTimeline([info]):
            placed += 1
        else:
            failed.append(f"{os.path.basename(path)}: Resolve отказался ставить")

    print("\nПроверка таймлайна:")
    for key, idx in track_idx.items():
        print(f"  A{idx} SFX {key}: {len(timeline.GetItemListInTrack('audio', idx) or [])} клип(ов)")
    print(f"\nПоставлено: {placed} из {len(plan)}")
    for f in failed:
        print("  НЕ поставлен", f)
    if skipped:
        print("Нет звука для маркеров: " + ", ".join(skipped))


if __name__ == "__main__":
    main()
