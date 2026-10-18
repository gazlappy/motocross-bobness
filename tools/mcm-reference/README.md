# Reading the original game's files (reference only)

Scripts for studying a copy of Motocross Madness (1998) you own, to match its tracks, stunts and
feel. **Nothing they read or write is committed or shipped**: extract the disc into `reference/`
(git-ignored) and keep the output there. Formats partly from
[AlexKimov/motocross-madness-file-formats](https://github.com/AlexKimov/motocross-madness-file-formats) (MIT).

```bash
"/c/Program Files/7-Zip/7z.exe" x -oreference/mcm-disc "assets/Disc image/MCM.iso"
python -I tools/mcm-reference/track_dat.py reference/mcm-disc/GAME/TERAFORM/NATIONAL/*.DAT
python -I tools/mcm-reference/vub.py reference/mcm-disc/GAME/SBIKE/SUPRMAN.VUB reference/mcm-disc/GAME/SBIKE/RIDER.VUT
python -I tools/mcm-reference/trn_layout.py reference/mcm-disc/GAME/TERAFORM/NATIONAL/TRACK01.TRN
```

- `track_dat.py`: track centrelines (`.DAT`), units in feet.
- `vub.py`: rider/bike animations (`.VUB`), bone order from `RIDER.VUT` / `BIKE.VUT`.
- `trn_layout.py`: walks a terrain (`.TRN`) and prints its block layout; the height tiles are
  compressed with a scheme not yet decoded.

What was learned is written up in `RESEARCH.md` section 5.
