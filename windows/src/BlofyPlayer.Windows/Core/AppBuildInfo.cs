namespace BlofyPlayer.Windows.Core;

/// <summary>
/// Version label for BLOFY Windows network clients and portable backup metadata.
/// Keep in sync with the Windows project and Inno installer. CI verifies all three.
/// </summary>
public static class AppBuildInfo
{
    public const string Version = "0.1.0";
    public const string WindowsVersion = "windows-" + Version;
    public const string UserAgent = "BLOFY-STREAM-Windows/" + Version;
}
