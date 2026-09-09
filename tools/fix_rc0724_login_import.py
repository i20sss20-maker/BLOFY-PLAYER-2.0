from pathlib import Path

p = Path('app/src/main/java/tv/blofy/player/ui/login/LoginActivity.kt')
text = p.read_text()
needle = 'import tv.blofy.player.core.identity.ActivationRemoteClient\n'
insert = needle + 'import tv.blofy.player.core.identity.DeviceIdentity\n'
if 'import tv.blofy.player.core.identity.DeviceIdentity\n' not in text:
    if needle not in text:
        raise SystemExit('LoginActivity import anchor missing')
    text = text.replace(needle, insert, 1)
p.write_text(text)
print('rc07.24 LoginActivity import fixed')
