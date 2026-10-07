#define MyAppName "BLOFY PLAYER"
#define MyAppVersion "0.3.0"
#define MyAppPublisher "BLOFY"
#define MyAppExeName "BLOFY PLAYER.exe"

[Setup]
AppId={{D6CC4787-17D2-4A46-8DF3-44C56A5C7B2C}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={localappdata}\Programs\BLOFY PLAYER
DefaultGroupName=BLOFY PLAYER
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=output
OutputBaseFilename=BLOFY-PLAYER-Windows-Setup-x64
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
SetupIconFile=..\src\BlofyPlayer.Windows\Assets\blofy.ico
UninstallDisplayIcon={app}\{#MyAppExeName}
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=yes
RestartApplications=no
SetupLogging=yes

[Files]
Source: "..\publish\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\BLOFY PLAYER"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\BLOFY PLAYER"; Filename: "{app}\{#MyAppExeName}"

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "تشغيل BLOFY PLAYER"; Flags: nowait postinstall skipifsilent
