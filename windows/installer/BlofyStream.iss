#define MyAppName "BLOFY STREAM"
#define MyAppVersion "0.1.0"
#define MyAppPublisher "BLOFY"
#define MyAppExeName "BLOFY STREAM.exe"

[Setup]
AppId={{91A17C3D-8AF7-40C5-988C-39C5A6A86B2C}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={localappdata}\Programs\BLOFY STREAM
DefaultGroupName=BLOFY STREAM
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=output
OutputBaseFilename=BLOFY-STREAM-Windows-0.1.0-Setup-x64-UNSIGNED-TEST
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
Name: "{autoprograms}\BLOFY STREAM"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\BLOFY STREAM"; Filename: "{app}\{#MyAppExeName}"

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "تشغيل BLOFY STREAM"; Flags: nowait postinstall skipifsilent

[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  Exec(ExpandConstant('{sys}\taskkill.exe'),
    '/F /T /IM "{#MyAppExeName}"', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Result := '';
end;
