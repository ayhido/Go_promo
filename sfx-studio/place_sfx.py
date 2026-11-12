"""Раскладывает готовые SFX-файлы на НОВЫЕ аудиодорожки активного таймлайна DaVinci Resolve.

Работает без интернета и без Claude Code.
Папка звуков: Документы\\Mentol\\музыка (если есть), иначе assets/sfx; можно задать SFX_DIR.
План sfx_plan.csv кладётся в папку звуков или в папку проекта:

    file,timecode,track,offset_frames
    001_whoosh.wav,01:00:03:12,SFX Whooshes,0
    002_hit.wav,00:05.5,SFX Hits,-2

- file           имя файла в папке звуков (или полный путь)
- timecode       HH:MM:SS:FF — таймкод таймлайна (как в Resolve, обычно с 01:00:00:00)
                 или MM:SS(.s) / секунды — от начала таймлайна
- track          имя новой аудиодорожки (создаётся, существующие не трогаются)
- offset_frames  сдвиг в кадрах (необязательно; -1/-2 для ударов — чуть раньше)

Запуск: run_place_sfx.bat (Windows) или python3 place_sfx.py (Mac).
Требуется DaVinci Resolve Studio, открытый проект с таймлайном и
Preferences -> General -> External scripting using -> Local.
"""
import csv
import os
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))


def find_sfx_dir():
    """Папка со звуками: $SFX_DIR, затем Документы\\Mentol\\музыка, затем assets/sfx."""
    if os.environ.get("SFX_DIR"):
        return os.environ["SFX_DIR"]
    home = os.path.expanduser("~")
    for docs in (os.path.join(home, "Documents"), os.path.join(home, "OneDrive", "Documents"),
                 os.path.join(home, "OneDrive", "Документы")):
        d = os.path.join(docs, "Mentol", "музыка")
        if os.path.isdir(d):
            return d
    return os.path.join(ROOT, "assets", "sfx")


SFX_DIR = find_sfx_dir()
# План ищем сначала рядом со звуками, потом в папке проекта
PLAN = next((p for p in (os.path.join(SFX_DIR, "sfx_plan.csv"), os.path.join(ROOT, "sfx_plan.csv"))
             if os.path.exists(p)), os.path.join(SFX_DIR, "sfx_plan.csv"))


def setup_resolve_env():
    if sys.platform.startswith("win"):
        api = os.path.join(os.environ.get("PROGRAMDATA", r"C:\ProgramData"),
                           r"Blackmagic Design\DaVinci Resolve\Support\Developer\Scripting")
        lib = r"C:\Program Files\Blackmagic Design\DaVinci Resolve\fusionscript.dll"
    elif sys.platform == "darwin":
        api = "/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Scripting"
        lib = "/Applications/DaVinci Resolve/DaVinci Resolve.app/Contents/Libraries/Fusion/fusionscript.so"
    else:
        api = "/opt/resolve/Developer/Scripting"
        lib = "/opt/resolve/libs/Fusion/fusionscript.so"
    os.environ.setdefault("RESOLVE_SCRIPT_API", api)
    os.environ.setdefault("RESOLVE_SCRIPT_LIB", lib)
    sys.path.append(os.path.join(os.environ["RESOLVE_SCRIPT_API"], "Modules"))


def fail(msg):
    print("ОШИБКА:", msg)
    sys.exit(1)


def tc_to_frames(tc, fps):
    h, m, s, f = (int(x) for x in tc.replace(";", ":").split(":"))
    return ((h * 60 + m) * 60 + s) * fps + f


def parse_time(value, fps, start_frame, start_tc_frames):
    """Возвращает абсолютный кадр таймлайна."""
    v = value.strip()
    if v.count(":") == 3 or ";" in v:
        return start_frame + tc_to_frames(v, fps) - start_tc_frames
    secs = 0.0
    for part in v.split(":"):
        secs = secs * 60 + float(part.replace(",", "."))
    return start_frame + int(round(secs * fps))


def clip_length_frames(item, fps):
    frames = str(item.GetClipProperty("Frames") or "").strip()
    if frames.isdigit() and int(frames) > 0:
        return int(frames)
    dur = str(item.GetClipProperty("Duration") or "").strip()
    if dur.count(":") == 3:
        return tc_to_frames(dur, fps)
    return None


def main():
    if not os.path.exists(PLAN):
        fail(f"нет файла плана {PLAN}")
    with open(PLAN, newline="", encoding="utf-8-sig") as f:
        rows = [r for r in csv.DictReader(f) if (r.get("file") or "").strip()]
    if not rows:
        fail("sfx_plan.csv пуст")

    for r in rows:
        p = r["file"].strip()
        r["path"] = p if os.path.isabs(p) else os.path.join(SFX_DIR, p)
        if not os.path.exists(r["path"]):
            fail(f"нет файла {r['path']}")

    print(f"Звуки: {SFX_DIR}\nПлан:  {PLAN}")
    setup_resolve_env()
    try:
        import DaVinciResolveScript as dvr
    except ImportError:
        fail("не найден модуль скриптинга Resolve. Установлен ли DaVinci Resolve Studio?")
    resolve = dvr.scriptapp("Resolve")
    if not resolve:
        fail("Resolve не отвечает. Запустите Resolve Studio и включите "
             "Preferences -> General -> External scripting using -> Local")

    project = resolve.GetProjectManager().GetCurrentProject()
    timeline = project and project.GetCurrentTimeline()
    if not timeline:
        fail("нет открытого проекта или активного таймлайна")

    fps = int(round(float(timeline.GetSetting("timelineFrameRate") or 24)))
    start_frame = timeline.GetStartFrame()
    start_tc_frames = tc_to_frames(timeline.GetStartTimecode(), fps)
    print(f"Таймлайн: {timeline.GetName()}, {fps} fps, старт {timeline.GetStartTimecode()}")

    # Импорт в бин SFX
    pool = project.GetMediaPool()
    root = pool.GetRootFolder()
    sfx_bin = next((b for b in (root.GetSubFolderList() or []) if b.GetName() == "SFX"), None) \
        or pool.AddSubFolder(root, "SFX")
    pool.SetCurrentFolder(sfx_bin)
    paths = sorted({r["path"] for r in rows})
    imported = pool.ImportMedia(paths) or []
    by_path = {}
    for item in imported + list(sfx_bin.GetClipList() or []):
        fp = item.GetClipProperty("File Path")
        if fp:
            by_path[os.path.normcase(os.path.abspath(fp))] = item

    # Новые дорожки — по одной на каждое имя, существующие не трогаем
    track_idx = {}
    for name in dict.fromkeys(r.get("track", "").strip() or "SFX" for r in rows):
        if not timeline.AddTrack("audio", "stereo"):
            fail(f"не удалось создать дорожку {name}")
        idx = timeline.GetTrackCount("audio")
        timeline.SetTrackName("audio", idx, name)
        track_idx[name] = idx
        print(f"Создана дорожка A{idx}: {name}")

    placed, failed = 0, []
    for r in rows:
        name = r.get("track", "").strip() or "SFX"
        item = by_path.get(os.path.normcase(os.path.abspath(r["path"])))
        if not item:
            failed.append((r["file"], "не импортировался в медиапул"))
            continue
        try:
            frame = parse_time(r["timecode"], fps, start_frame, start_tc_frames)
            frame += int((r.get("offset_frames") or "0").strip() or 0)
        except ValueError:
            failed.append((r["file"], f"плохой таймкод {r['timecode']!r}"))
            continue
        info = {"mediaPoolItem": item, "trackIndex": track_idx[name],
                "recordFrame": frame, "mediaType": 2}
        length = clip_length_frames(item, fps)
        if length:
            info.update(startFrame=0, endFrame=length - 1)
        if pool.AppendToTimeline([info]):
            placed += 1
        else:
            failed.append((r["file"], "Resolve отказался ставить клип"))

    # Проверка по таймлайну
    print("\nПроверка таймлайна:")
    for name, idx in track_idx.items():
        n = len(timeline.GetItemListInTrack("audio", idx) or [])
        print(f"  A{idx} {name}: {n} клип(ов)")
    print(f"\nПоставлено: {placed} из {len(rows)}")
    for f, why in failed:
        print(f"  НЕ поставлен {f}: {why}")


if __name__ == "__main__":
    main()
