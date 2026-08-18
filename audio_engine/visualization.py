from __future__ import annotations

from html import escape
from pathlib import Path

import numpy as np

from .alignment import Alignment
from .pitch import PitchTrack, frequency_to_midi
from .scoring import ScoreReport


def render_pitch_comparison(
    reference: PitchTrack,
    performance: PitchTrack,
    alignment: Alignment,
    report: ScoreReport,
    output_path: str | Path,
) -> None:
    width, height = 1200, 640
    left, right, top, bottom = 80, 30, 100, 70
    plot_width = width - left - right
    plot_height = height - top - bottom
    duration = max(reference.duration_seconds, 0.1)

    ref_midi = frequency_to_midi(reference.frequencies)
    user_midi = frequency_to_midi(performance.frequencies) - alignment.octave_shift_semitones
    valid_values = np.concatenate([ref_midi[~np.isnan(ref_midi)], user_midi[~np.isnan(user_midi)]])
    if valid_values.size:
        midi_min = int(np.floor(np.min(valid_values))) - 2
        midi_max = int(np.ceil(np.max(valid_values))) + 2
    else:
        midi_min, midi_max = 48, 72
    if midi_max - midi_min < 12:
        padding = (12 - (midi_max - midi_min)) // 2 + 1
        midi_min -= padding
        midi_max += padding

    def point(time: float, midi: float) -> tuple[float, float]:
        x = left + np.clip(time / duration, 0.0, 1.0) * plot_width
        y = top + (midi_max - midi) / (midi_max - midi_min) * plot_height
        return float(x), float(y)

    elements = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">',
        '<rect width="100%" height="100%" fill="#0b1020"/>',
        '<text x="80" y="44" fill="#f8fafc" font-size="25" font-family="sans-serif" font-weight="700">音高对比</text>',
        f'<text x="80" y="73" fill="#94a3b8" font-size="15" font-family="sans-serif">总分 {report.overall:.1f} · 音准 {report.pitch:.1f} · 节奏 {report.rhythm:.1f} · 完整度 {report.completeness:.1f} · 稳定性 {report.stability:.1f}</text>',
        f'<rect x="{left}" y="{top}" width="{plot_width}" height="{plot_height}" fill="#111827" stroke="#334155"/>',
    ]

    for midi in range(midi_min, midi_max + 1):
        _, y = point(0.0, float(midi))
        color = "#334155" if midi % 12 == 0 else "#1e293b"
        elements.append(f'<line x1="{left}" y1="{y:.2f}" x2="{left + plot_width}" y2="{y:.2f}" stroke="{color}" stroke-width="1"/>')
        if midi % 12 == 0:
            elements.append(f'<text x="{left - 12}" y="{y + 5:.2f}" text-anchor="end" fill="#94a3b8" font-size="13" font-family="sans-serif">C{midi // 12 - 1}</text>')

    tick_step = 1 if duration <= 15 else 5
    for second in np.arange(0, duration + 0.001, tick_step):
        x, _ = point(float(second), float(midi_min))
        elements.append(f'<line x1="{x:.2f}" y1="{top}" x2="{x:.2f}" y2="{top + plot_height}" stroke="#1e293b" stroke-width="1"/>')
        elements.append(f'<text x="{x:.2f}" y="{top + plot_height + 25}" text-anchor="middle" fill="#94a3b8" font-size="12" font-family="sans-serif">{second:g}s</text>')

    elements.extend(
        _track_polylines(reference.times, ref_midi, point, "#38bdf8", 3.0)
    )
    adjusted_user_times = performance.times - alignment.shift_seconds
    elements.extend(
        _track_polylines(adjusted_user_times, user_midi, point, "#fb7185", 2.4)
    )
    elements.extend(
        [
            '<line x1="860" y1="42" x2="900" y2="42" stroke="#38bdf8" stroke-width="4"/>',
            '<text x="910" y="47" fill="#cbd5e1" font-size="14" font-family="sans-serif">原唱</text>',
            '<line x1="1010" y1="42" x2="1050" y2="42" stroke="#fb7185" stroke-width="4"/>',
            '<text x="1060" y="47" fill="#cbd5e1" font-size="14" font-family="sans-serif">你的演唱</text>',
            f'<text x="{left}" y="{height - 18}" fill="#64748b" font-size="12" font-family="sans-serif">延迟校正 {alignment.shift_seconds:+.3f}秒 · 八度校正 {alignment.octave_shift_semitones:+d}半音</text>',
            "</svg>",
        ]
    )
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(elements), encoding="utf-8")


def render_pitch_track(
    track: PitchTrack,
    output_path: str | Path,
    *,
    title: str = "Pitch track",
) -> None:
    width, height = 1200, 560
    left, right, top, bottom = 80, 30, 90, 65
    plot_width = width - left - right
    plot_height = height - top - bottom
    duration = max(track.duration_seconds, 0.1)
    midi_values = frequency_to_midi(track.frequencies)
    voiced_values = midi_values[~np.isnan(midi_values)]
    if voiced_values.size:
        midi_min = int(np.floor(np.percentile(voiced_values, 1))) - 2
        midi_max = int(np.ceil(np.percentile(voiced_values, 99))) + 2
    else:
        midi_min, midi_max = 48, 72
    if midi_max - midi_min < 12:
        padding = (12 - (midi_max - midi_min)) // 2 + 1
        midi_min -= padding
        midi_max += padding

    def point(time: float, midi: float) -> tuple[float, float]:
        x = left + np.clip(time / duration, 0.0, 1.0) * plot_width
        y = top + (midi_max - midi) / (midi_max - midi_min) * plot_height
        return float(x), float(y)

    voiced_percent = float(np.mean(track.voiced) * 100.0) if track.voiced.size else 0.0
    elements = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">',
        '<rect width="100%" height="100%" fill="#0b1020"/>',
        f'<text x="80" y="40" fill="#f8fafc" font-size="24" font-family="sans-serif" font-weight="700">{escape(title)}</text>',
        f'<text x="80" y="68" fill="#94a3b8" font-size="14" font-family="sans-serif">Duration {duration:.1f}s · detected pitch coverage {voiced_percent:.1f}%</text>',
        f'<rect x="{left}" y="{top}" width="{plot_width}" height="{plot_height}" fill="#111827" stroke="#334155"/>',
    ]
    for midi in range(midi_min, midi_max + 1):
        _, y = point(0.0, float(midi))
        color = "#334155" if midi % 12 == 0 else "#1e293b"
        elements.append(f'<line x1="{left}" y1="{y:.2f}" x2="{left + plot_width}" y2="{y:.2f}" stroke="{color}" stroke-width="1"/>')
        if midi % 12 == 0:
            elements.append(f'<text x="{left - 12}" y="{y + 5:.2f}" text-anchor="end" fill="#94a3b8" font-size="13" font-family="sans-serif">C{midi // 12 - 1}</text>')

    tick_step = 5 if duration <= 30 else 15 if duration <= 120 else 30
    for second in np.arange(0, duration + 0.001, tick_step):
        x, _ = point(float(second), float(midi_min))
        elements.append(f'<line x1="{x:.2f}" y1="{top}" x2="{x:.2f}" y2="{top + plot_height}" stroke="#1e293b" stroke-width="1"/>')
        elements.append(f'<text x="{x:.2f}" y="{top + plot_height + 24}" text-anchor="middle" fill="#94a3b8" font-size="12" font-family="sans-serif">{second:g}s</text>')
    elements.extend(_track_polylines(track.times, midi_values, point, "#38bdf8", 2.2))
    elements.extend(
        [
            f'<text x="{left}" y="{height - 15}" fill="#64748b" font-size="12" font-family="sans-serif">YIN monophonic baseline; dense external playback can create false pitch detections.</text>',
            "</svg>",
        ]
    )
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(elements), encoding="utf-8")


def _track_polylines(times, midi_values, point, color: str, stroke_width: float) -> list[str]:
    lines: list[str] = []
    current: list[str] = []
    last_time: float | None = None
    for time, midi in zip(times, midi_values, strict=True):
        valid = not np.isnan(midi) and time >= 0
        contiguous = last_time is None or time - last_time <= 0.05
        if not valid or not contiguous:
            if len(current) >= 2:
                lines.append(_polyline(current, color, stroke_width))
            current = []
        if valid:
            x, y = point(float(time), float(midi))
            current.append(f"{x:.2f},{y:.2f}")
            last_time = float(time)
        else:
            last_time = None
    if len(current) >= 2:
        lines.append(_polyline(current, color, stroke_width))
    return lines


def _polyline(points: list[str], color: str, stroke_width: float) -> str:
    joined = escape(" ".join(points), quote=True)
    return f'<polyline points="{joined}" fill="none" stroke="{color}" stroke-width="{stroke_width}" stroke-linecap="round" stroke-linejoin="round"/>'
