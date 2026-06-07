# Spec: Listening Player

## Status
draft

## Goal
Provide an audio player component for the listening quiz that plays an MP3 question clip
while displaying a phrase-level subtitle overlay. A visual marker moves through the
subtitle text in sync with audio playback. The user can click any subtitle segment to
seek the audio to that point.

## Scope
- In scope:
  - Audio playback controls: play, pause, seek via progress bar
  - Phrase-level subtitle display synced to playback position
  - Active segment highlighted / marker advances as audio plays
  - Click-to-seek on any subtitle segment
  - Volume control
- Out of scope:
  - Word-level highlighting
  - Playback speed control (may be added later)
  - Download or export of audio
  - Transcript editing

## Behaviour

### Playback
1. The player loads the audio for the current question before the user can interact with
   the question options.
2. Play and Pause buttons are always visible. The player starts in a paused state.
3. A scrubber (progress bar) shows elapsed time and total duration. The user can drag or
   click it to seek to any position.
4. Volume can be adjusted via a slider; the last-used volume level persists for the
   duration of the session (not across sessions).

### Subtitle overlay
5. All transcript segments are displayed as a list of subtitle phrases below (or beside)
   the player controls.
6. The currently playing segment is highlighted (e.g. bold text, accent background).
7. As playback advances, the highlight moves to the next segment automatically when
   `currentTime >= segment.start_ms / 1000`.
8. The subtitle list scrolls automatically to keep the active segment in view.

### Click-to-seek
9. Clicking any subtitle segment seeks the audio to the start time of that segment and
   begins playback from that point.
10. The highlight immediately updates to reflect the newly active segment.

### End of clip
11. When audio reaches the end, playback stops and the player returns to a paused state
    at position 0.
12. The user can replay the clip as many times as needed before confirming an answer.
    (Real mode does not restrict replays — confirmed as out of scope for now.)

## Data model changes
None — audio_files and transcript_segments are defined in the listening-import spec.

## API contract

### GET /api/questions/:id/audio
Stream or redirect to the MP3 file for a question.
```
Response: audio/mpeg stream, or 302 redirect to a local static file URL
Error:    { "data": null, "error": { "code": "NOT_FOUND", "message": "..." } }
```

### GET /api/questions/:id/transcript
Return phrase-level segments for a question.
```
Response: { "data": { "segments": [{ "sequence": number, "text": string, "startMs": number, "endMs": number }] }, "error": null }
```

## Open questions
- Should the MP3 be served as a static file (Express `static` middleware) or streamed
  through a dedicated route? Streaming supports range requests which HTML `<audio>` relies
  on for seeking — this should be confirmed before implementation.

## Revision history
- 2026-06-04: Initial draft
