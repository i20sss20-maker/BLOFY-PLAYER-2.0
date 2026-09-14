#ifndef SourceDir
  #define SourceDir "..\..\publish\BLOFY-PLAYER"
#endif
#ifndef OutputDir
  #define OutputDir "..\..\output"
#endif
[Setup]
AppId={{90B2CED1-4D79-4A61-83E7-E317B5473BA0}
AppName=BLOFY PLAYER
AppVersion=0.2.0
AppPublisher=BLOFY
DefaultDirName={localappdata}\Programs\BLOFY PLAYER
DefaultGroupName=BLOFY PLAYER
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
DisableProgramGroupPage=yes
OutputDir={#OutputDir}
OutputBaseFilename=BLOFY-PLAYER-Windows-0.2.0-Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\BLOFY.Player.Windows.exe
CloseApplications=yes
RestartApplications=no
[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; Flags: unchecked
[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
[Icons]
Name: "{autoprograms}\BLOFY PLAYER"; Filename: "{app}\BLOFY.Player.Windows.exe"
Name: "{autodesktop}\BLOFY PLAYER"; Filename: "{app}\BLOFY.Player.Windows.exe"; Tasks: desktopicon
[Run]
Filename: "{app}\BLOFY.Player.Windows.exe"; Description: "Open BLOFY PLAYER"; Flags: nowait postinstall skipifsilent
; User data in LOCALAPPDATA\BLOFY PLAYER\Windows is deliberately retained on uninstall.
