from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Sequence

from .pipeline import analyze_files, inspect_audio_file
from .separation import separate_vocals
from .synthetic import create_demo_files


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="karaoke-analyze",
        description="Inspect audio or analyze a performance against a monophonic reference.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    analyze = subparsers.add_parser("analyze", help="Analyze two WAV files")
    analyze.add_argument("--reference", required=True, type=Path)
    analyze.add_argument("--performance", required=True, type=Path)
    analyze.add_argument("--output", required=True, type=Path)
    analyze.add_argument("--min-frequency", type=float, default=70.0)
    analyze.add_argument("--max-frequency", type=float, default=700.0)
    analyze.add_argument("--max-shift-seconds", type=float, default=1.5)
    analyze.add_argument("--alignment", choices=("global", "dtw"), default="global")
    analyze.add_argument("--dtw-band-seconds", type=float, default=12.0)

    demo = subparsers.add_parser("demo", help="Generate and analyze a synthetic demo")
    demo.add_argument("--output", required=True, type=Path)

    inspect = subparsers.add_parser("inspect", help="Inspect one phone or microphone recording")
    inspect.add_argument("--input", required=True, type=Path)
    inspect.add_argument("--output", required=True, type=Path)
    inspect.add_argument("--min-frequency", type=float, default=70.0)
    inspect.add_argument("--max-frequency", type=float, default=700.0)

    separate = subparsers.add_parser(
        "separate", help="Separate a phone recording into vocals and accompaniment"
    )
    separate.add_argument("--input", required=True, type=Path)
    separate.add_argument("--output", required=True, type=Path)
    separate.add_argument("--model", default="htdemucs")
    separate.add_argument("--device", choices=("cpu", "cuda"), default="cpu")
    separate.add_argument("--shifts", type=int, default=0)
    separate.add_argument("--min-frequency", type=float, default=70.0)
    separate.add_argument("--max-frequency", type=float, default=700.0)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "separate":
        if not args.input.is_file():
            raise SystemExit(f"input audio does not exist: {args.input}")
        result = separate_vocals(
            args.input,
            args.output,
            model=args.model,
            device=args.device,
            shifts=args.shifts,
        )
        inspections = {
            "mixed": inspect_audio_file(
                result.prepared_path,
                args.output / "inspection_mixed",
                min_frequency=args.min_frequency,
                max_frequency=args.max_frequency,
            ),
            "vocals": inspect_audio_file(
                result.vocals_path,
                args.output / "inspection_vocals",
                min_frequency=args.min_frequency,
                max_frequency=args.max_frequency,
            ),
            "accompaniment": inspect_audio_file(
                result.accompaniment_path,
                args.output / "inspection_accompaniment",
                min_frequency=args.min_frequency,
                max_frequency=args.max_frequency,
            ),
        }
        payload = result.to_dict()
        payload["inspections"] = inspections
        (args.output / "separation_report.json").write_text(
            json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        print(f"Results: {args.output.resolve()}")
        return 0
    if args.command == "inspect":
        if not args.input.is_file():
            raise SystemExit(f"input audio does not exist: {args.input}")
        report = inspect_audio_file(
            args.input,
            args.output,
            min_frequency=args.min_frequency,
            max_frequency=args.max_frequency,
        )
        print(json.dumps(report, ensure_ascii=False, indent=2))
        print(f"Results: {args.output.resolve()}")
        return 0
    if args.command == "demo":
        reference, performance = create_demo_files(args.output)
        result_directory = args.output / "result"
        report = analyze_files(reference, performance, result_directory)
    else:
        for label, path in (("reference", args.reference), ("performance", args.performance)):
            if not path.is_file():
                raise SystemExit(f"{label} audio does not exist: {path}")
        report = analyze_files(
            args.reference,
            args.performance,
            args.output,
            min_frequency=args.min_frequency,
            max_frequency=args.max_frequency,
            max_shift_seconds=args.max_shift_seconds,
            alignment_method=args.alignment,
            dtw_band_seconds=args.dtw_band_seconds,
        )
        result_directory = args.output

    print(json.dumps(report.to_dict(), ensure_ascii=False, indent=2))
    print(f"Results: {result_directory.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
