using System.IO;
using System.Text.Json;

namespace BlofyPlayer.Windows;

internal record ConnectionSettings(string BaseUrl, string Username, string Password);

internal static class ConnectionStore
{
    private static readonly string Dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "BLOFY PLAYER");
    private static readonly string FilePath = Path.Combine(Dir, "connection.json");

    public static void Save(ConnectionSettings settings)
    {
        Directory.CreateDirectory(Dir);
        File.WriteAllText(FilePath, JsonSerializer.Serialize(settings));
    }

    public static ConnectionSettings? Load()
    {
        try
        {
            if (!File.Exists(FilePath)) return null;
            return JsonSerializer.Deserialize<ConnectionSettings>(File.ReadAllText(FilePath));
        }
        catch { return null; }
    }
}
