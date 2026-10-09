#define MyAppName "BLOFY PLAYER"
#define MyAppVersion "0.4.9"
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
CloseApplications=force
RestartApplications=no
SetupLogging=yes

[Files]
Source: "..\publish\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\BLOFY PLAYER"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\BLOFY PLAYER"; Filename: "{app}\{#MyAppExeName}"

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "تشغيل BLOFY PLAYER"; Flags: nowait postinstall skipifsilent


[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  { A previous BLOFY PLAYER process can keep .NET/LibVLC DLLs locked even after
    its window disappears. Force-close only our own executable tree before files
    are replaced so upgrades never stop on clrjit.dll with code 5. }
  Exec(
    ExpandConstant('{sys}\taskkill.exe'),
    '/F /T /IM "{#MyAppExeName}"',
    '',
    SW_HIDE,
    ewWaitUntilTerminated,
    ResultCode
  );
  Sleep(900);
  Result := '';
end;
