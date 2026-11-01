# Idolytics media library

This folder is maintained by the local Vite dev server. It keeps copies of the audio and video
files you link to songs so they can load automatically the next time you open the app.

## Structure

```text
media/
  .idolytics-media.json          # folder mapping for stable group/song ids
  .tmp/                          # staging area for uploads and URL imports
  groups/
    <Group>/
      songs/
        <Song>/
          audio/
          video/
```

Group and song folders follow their current names. Renaming either one in the app moves the
folder. Names are sanitized for the filesystem, and duplicate names receive a ` (2)` suffix.
Deleting a group or song leaves its folder in place; files are never deleted automatically.

## When files are copied

Audio and video are copied when you link them, as long as **Auto-copy linked media** is enabled in
Settings → Media. The original download is never moved or changed. If a file with the same name and
size is already in the song folder, it is reused instead of copied again.

This feature is only available while running the local dev server:

```bash
npm run dev
```

Production builds and static previews fall back to the normal local-file linking flow. The media
folder is excluded from Git and from workspace JSON exports.

## URL imports

The **Import URL** action in the video and audio panels downloads supported links with yt-dlp and
writes the finished file through the same manifest used by linked files. Video downloads are capped
at 1080p by default, or 720p / Best if you choose another option in the dialog. Song audio is
imported separately; audio is never extracted from an imported video.

Downloads are staged in `media/.tmp/import-<jobId>/` and moved into the song folder only after the
download finishes. Cancelled, failed, and stale temp folders are removed automatically. Playlist,
live, private-network, and credential-bearing URLs are rejected.

yt-dlp and ffmpeg must be installed and available on `PATH`, or pointed to with
`IDOLYTICS_YTDLP_PATH` and `IDOLYTICS_FFMPEG_PATH`. For links that require a sign-in, set
`IDOLYTICS_YTDLP_COOKIES_FROM_BROWSER` or `IDOLYTICS_YTDLP_COOKIES_FILE` before starting the dev
server. These settings are server-side only and are never written to the workspace or this folder.
See the main [`README.md`](../README.md#url-imports) for examples.
