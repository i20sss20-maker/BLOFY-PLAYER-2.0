using Microsoft.Win32;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;

namespace BlofyPlayer.Windows.Core.Identity;

public sealed record BlofyIdentity(string DeviceId, string ActivationCode);

public static class WindowsDeviceIdentity
{
    private const string DeviceNamespace = "tv.blofy.player.windows/device-id/v1";
    private const string ActivationNamespace = "tv.blofy.player.windows/activation-code/v1";
    private const string Alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    public static BlofyIdentity Get()
    {
        var stable = ReadMachineGuid()
                     ?? $"{Environment.MachineName}:{WindowsIdentity.GetCurrent().User?.Value ?? Environment.UserName}";

        return new BlofyIdentity(
            DeriveDeviceId(stable),
            DeriveActivationCode(stable)
        );
    }

    private static string? ReadMachineGuid()
    {
        try
        {
            using var key = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Cryptography");
            return key?.GetValue("MachineGuid")?.ToString()?.Trim() is { Length: > 0 } value ? value : null;
        }
        catch
        {
            return null;
        }
    }

    private static string DeriveDeviceId(string stable)
    {
        var digest = Digest(DeviceNamespace, stable);
        var raw = new StringBuilder(8);
        for (var i = 0; i < 8; i++)
        {
            var index = digest[i] % Alphabet.Length;
            raw.Append(Alphabet[index]);
        }

        var value = raw.ToString();
        return $"BLOFY-{value[..4]}-{value[4..]}";
    }

    private static string DeriveActivationCode(string stable)
    {
        var digest = Digest(ActivationNamespace, stable);
        var value = ((uint)digest[0] << 24)
                    | ((uint)digest[1] << 16)
                    | ((uint)digest[2] << 8)
                    | digest[3];
        return (100_000 + (value % 900_000)).ToString();
    }

    private static byte[] Digest(string ns, string stable) =>
        SHA256.HashData(Encoding.UTF8.GetBytes($"{ns}:{stable}"));
}
