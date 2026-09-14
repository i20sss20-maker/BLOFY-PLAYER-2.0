# BLOFY PLAYER — Windows Android-parity work

## Current milestone: UI review, not a complete player

This project transfers the **approved Android TV/wide-screen design** at `dc0b0c84d7dd5973e8d0426f16793f14b9b06417` into Windows WPF resources. It is not an alternative desktop design and must not be distributed as the finished Windows edition.

Implemented in this milestone:

- Existing two-panel Android login resource is integrated into a WPF project.
- Original Android logo is embedded unchanged, directly from the repository asset.
- Home hierarchy, labels, right-hand sidebar, cards, story order, gradients and relative dimensions are translated from `HomeActivity.kt`.
- Movies/series catalog uses the original right category rail and five poster columns.
- Catalog view models preserve source ordering and selected categories.
- Outer poster rows use WPF recycling virtualization; tests exercise 20,000 synthetic local items.
- Keyboard navigation between category rail and posters, route history and focus restoration are implemented in the UI review host.

**Not implemented in this milestone:** provider/server connections, persistent playlists, activation API, device credentials/QR generation, live playback, movie playback, series episodes, details screens, production settings, signed installer or updates. Incomplete actions are disabled or clearly explain their status. No success, activation or sample server content is fabricated. Normal startup has no provider data. Synthetic test records exist only in `--verify-ui` verification.

The UI review executable is a development artifact, not a substitute for the requested complete app. All acceptance gates in `ANDROID_PARITY.md` remain applicable. Source translation and compilation are not proof of pixel-perfect or behavioral parity. No paired Android/Windows runtime screenshot comparison has yet been completed; Windows font rendering is also not an exact Android-font match.

## Review host

Open `BLOFY.Player.Windows.exe` on a Windows machine. F1 opens login; F2 home; F3 movies; F4 series. Escape/Back returns to the prior review screen. These review shortcuts are not a new customer navigation design. The native title explicitly identifies this as UI review.

## Build and verify

Requires .NET 10 SDK on Windows for WPF runtime verification.

```powershell
dotnet publish windows/Blofy.Windows/Blofy.Windows.csproj -c Release -r win-x64 --self-contained true -o publish/BLOFY-PLAYER-UI-Review
publish/BLOFY-PLAYER-UI-Review/BLOFY.Player.Windows.exe --verify-ui --evidence-dir=ui-evidence
```

`ui-evidence/verification.json` records pass/fail and exact checks. Four PNGs contain synthetic UI fixtures, not real provider content. `SCOPE.txt` records the verification limitations. A source-only project copy needs the original logo at `app/src/main/res/drawable-nodpi/blofy_logo.png`, so build from the repository root.

GitHub workflow: `.github/workflows/windows-ui-build.yml`. It checks that `app/` has not changed from the starting Windows branch and verifies the original logo's Git blob identity. Workflow permissions are read-only. Verification performs no network calls and does not register production devices or alter Android/portal data.
