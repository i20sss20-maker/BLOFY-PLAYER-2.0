using Microsoft.Data.Sqlite;
using Microsoft.Win32;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Blofy.Windows.Runtime;

/// <summary>One user-scoped DPAPI key wraps AES-GCM records; credentials are never written as cleartext.</summary>
public sealed class SecretVault : IDisposable
{
    private readonly byte[] _key;
    private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("BLOFY-Windows-v1");
    [System.Runtime.Versioning.SupportedOSPlatform("windows")]
    public SecretVault(string directory)
    {
        Directory.CreateDirectory(directory); var path = Path.Combine(directory, "vault.key");
        if (File.Exists(path)) _key = ProtectedData.Unprotect(File.ReadAllBytes(path), Entropy, DataProtectionScope.CurrentUser);
        else
        {
            _key = RandomNumberGenerator.GetBytes(32);
            Atomic(path, ProtectedData.Protect(_key, Entropy, DataProtectionScope.CurrentUser));
        }
        if (_key.Length != 32) throw new InvalidDataException("تعذر قراءة مفتاح بيانات التطبيق؛ لم نغيّر ملفاتك");
    }
    internal SecretVault(byte[] testKey) { if (testKey.Length != 32) throw new ArgumentException("Invalid key"); _key = testKey.ToArray(); }
    public string Seal(string text)
    {
        if (text.Length == 0) return "";
        var plain = Encoding.UTF8.GetBytes(text); var result = new byte[28 + plain.Length];
        RandomNumberGenerator.Fill(result.AsSpan(0, 12));
        using var aes = new AesGcm(_key, 16);
        aes.Encrypt(result.AsSpan(0, 12), plain, result.AsSpan(28), result.AsSpan(12, 16), Entropy);
        CryptographicOperations.ZeroMemory(plain); return Convert.ToBase64String(result);
    }
    public string Open(string text)
    {
        if (text.Length == 0) return "";
        var data = Convert.FromBase64String(text); if (data.Length < 28) throw new CryptographicException("Invalid stored record");
        var plain = new byte[data.Length - 28]; using var aes = new AesGcm(_key, 16);
        try { aes.Decrypt(data.AsSpan(0, 12), data.AsSpan(28), data.AsSpan(12, 16), plain, Entropy); return Encoding.UTF8.GetString(plain); }
        finally { CryptographicOperations.ZeroMemory(plain); }
    }
    public static void Atomic(string path, byte[] bytes)
    {
        string temp = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            using (var file = new FileStream(temp, FileMode.CreateNew, FileAccess.Write, FileShare.None, 4096, FileOptions.WriteThrough)) { file.Write(bytes); file.Flush(true); }
            File.Move(temp, path, true);
        }
        finally { if (File.Exists(temp)) File.Delete(temp); }
    }
    public void Dispose() => CryptographicOperations.ZeroMemory(_key);
}

public sealed class UserStore
{
    public UserData Data { get; }
    private readonly string _file;
    private readonly SecretVault _vault;
    public UserStore(string directory, SecretVault vault)
    {
        _vault = vault; _file = Path.Combine(directory, "profile.enc");
        if (File.Exists(_file))
        {
            Data = JsonSerializer.Deserialize<UserData>(_vault.Open(File.ReadAllText(_file))) ?? throw new InvalidDataException("ملف بيانات الجهاز غير صالح؛ لم يُعد إنشاء الهوية");
            if (Data.Identity == null || !System.Text.RegularExpressions.Regex.IsMatch(Data.Identity.DeviceId, "^BLOFY-[A-Z0-9]{4}-[A-Z0-9]{4}$") || !System.Text.RegularExpressions.Regex.IsMatch(Data.Identity.Code, "^[0-9]{6}$")) throw new InvalidDataException("تعذر قراءة هوية الجهاز المحفوظة");
        }
        else
        {
            const string alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
            string raw = new(Enumerable.Range(0, 8).Select(_ => alphabet[RandomNumberGenerator.GetInt32(alphabet.Length)]).ToArray());
            string machine = OperatingSystem.IsWindows() ? Registry.GetValue(@"HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Cryptography", "MachineGuid", null)?.ToString() ?? "" : "";
            // The server receives only a namespace-specific hash, never the raw machine identifier.
            if (machine.Length == 0) machine = Guid.NewGuid().ToString("N");
            var scope = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes("BLOFY-Windows-trial-v1|" + machine))).ToLowerInvariant();
            Data = new UserData { Identity = new($"BLOFY-{raw[..4]}-{raw[4..]}", RandomNumberGenerator.GetInt32(100000, 1000000).ToString(), scope) };
            Save();
        }
    }
    public void Save() => SecretVault.Atomic(_file, Encoding.UTF8.GetBytes(_vault.Seal(JsonSerializer.Serialize(Data))));
    public Provider? Active => Data.Providers.FirstOrDefault(p => p.Id == Data.ActiveId);
    public void Put(Provider p)
    {
        int index = Data.Providers.FindIndex(x => x.Id == p.Id);
        if (index < 0) Data.Providers.Add(p); else Data.Providers[index] = p;
        if (Data.ActiveId.Length == 0) Data.ActiveId = p.Id; Save();
    }
    public void Select(Provider p) { if (!Data.Providers.Any(x => x.Id == p.Id)) throw new ArgumentException("القائمة غير محفوظة"); Data.ActiveId = p.Id; Save(); }
    public void Remove(string id) { Data.Providers.RemoveAll(p => p.Id == id); if (Data.ActiveId == id) Data.ActiveId = Data.Providers.FirstOrDefault()?.Id ?? ""; Save(); }
    public int MergePortal(IReadOnlyList<Provider> remote)
    {
        int changes = 0;
        foreach (var p in remote)
        {
            var existing = Data.Providers.FirstOrDefault(x => x.Id == p.Id);
            // Explicitly edited local providers must never be replaced by an unrelated portal response.
            if (existing != null && !existing.FromPortal) continue;
            var merged = p with { UserAgent = existing?.UserAgent ?? p.UserAgent, Referer = existing?.Referer ?? p.Referer, LiveFormat = existing?.LiveFormat ?? p.LiveFormat };
            if (existing != merged) { Put(merged); changes++; }
        }
        return changes;
    }
}

public sealed class CatalogStore
{
    private readonly string _connection;
    private readonly SecretVault _vault;
    private readonly SemaphoreSlim _writer = new(1, 1);
    public CatalogStore(string path, SecretVault vault)
    {
        _vault = vault; _connection = new SqliteConnectionStringBuilder { DataSource = path, Pooling = true }.ToString();
        using var db = Open(); using var cmd = db.CreateCommand(); cmd.CommandText = """
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS head(provider TEXT PRIMARY KEY,generation TEXT NOT NULL,fingerprint TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS categories(generation TEXT NOT NULL,kind TEXT NOT NULL,id TEXT NOT NULL,name TEXT NOT NULL,ord INTEGER NOT NULL,PRIMARY KEY(generation,kind,id));
        CREATE TABLE IF NOT EXISTS entries(generation TEXT NOT NULL,kind TEXT NOT NULL,id TEXT NOT NULL,name TEXT NOT NULL,category TEXT NOT NULL,ord INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(generation,kind,id));
        CREATE INDEX IF NOT EXISTS entry_order ON entries(generation,kind,ord);
        CREATE INDEX IF NOT EXISTS entry_category ON entries(generation,kind,category,ord);
        CREATE TABLE IF NOT EXISTS watch(provider TEXT NOT NULL,key TEXT NOT NULL,payload TEXT NOT NULL,position INTEGER NOT NULL,duration INTEGER NOT NULL,favorite INTEGER NOT NULL,updated INTEGER NOT NULL,PRIMARY KEY(provider,key));
        """; cmd.ExecuteNonQuery();
    }
    private SqliteConnection Open() { var db = new SqliteConnection(_connection); db.Open(); using var c = db.CreateCommand(); c.CommandText = "PRAGMA busy_timeout=5000"; c.ExecuteNonQuery(); return db; }
    private static SqliteCommand Cmd(SqliteConnection db, string sql, params (string, object?)[] args)
    { var c = db.CreateCommand(); c.CommandText = sql; foreach (var (key, value) in args) c.Parameters.AddWithValue(key, value ?? DBNull.Value); return c; }
    public Task<bool> Ready(Provider p) => Task.Run(() => { using var db = Open(); using var cmd = Cmd(db, "SELECT count(*) FROM head WHERE provider=$p AND fingerprint=$f", ("$p", p.Id), ("$f", p.Fingerprint)); return Convert.ToInt64(cmd.ExecuteScalar()) > 0; });
    public async Task Import(Provider p, ProviderClient client, IProgress<ImportStatus>? progress, CancellationToken ct)
    {
        await _writer.WaitAsync(ct); string gen = Guid.NewGuid().ToString("N");
        try
        {
            await Task.Run(async () =>
            {
                await client.Authenticate(p, ct); var categories = new List<Category>(); var batch = new List<Entry>(250); long total = 0;
                var kinds = p.Type == "m3u" ? new[] { "m3u" } : new[] { "live", "movie", "series" }; int stage = 0;
                foreach (string kind in kinds)
                {
                    stage++; progress?.Report(new("تحميل " + (kind == "live" ? "البث المباشر" : kind == "movie" ? "الأفلام" : kind == "series" ? "المسلسلات" : "M3U"), total, stage));
                    if (kind != "m3u") categories.AddRange(await client.Categories(p, kind, ct));
                    var seen = new HashSet<string>();
                    await foreach (var entry in kind == "m3u" ? client.M3u(p, ct) : client.Entries(p, kind, ct))
                    {
                        ct.ThrowIfCancellationRequested(); batch.Add(entry); total++;
                        if (kind == "m3u" && seen.Add(entry.Kind + "\0" + entry.Category)) categories.Add(new(entry.Category, entry.Category.Length > 0 ? entry.Category : "عام", entry.Kind, categories.Count));
                        if (batch.Count >= 250) { WriteBatch(gen, batch, ct); batch.Clear(); progress?.Report(new("حفظ المكتبة", total, stage)); }
                    }
                    if (batch.Count > 0) { WriteBatch(gen, batch, ct); batch.Clear(); }
                }
                ct.ThrowIfCancellationRequested();
                if (total == 0) throw new InvalidDataException("لم يرجع السيرفر محتوى؛ مكتبتك السابقة محفوظة");
                Publish(p, gen, categories, ct); progress?.Report(new("اكتمل التحميل", total, 4));
            }, ct).ConfigureAwait(false);
        }
        finally
        {
            try { await Task.Run(() => { using var db = Open(); using var cmd = Cmd(db, "DELETE FROM entries WHERE generation NOT IN (SELECT generation FROM head); DELETE FROM categories WHERE generation NOT IN (SELECT generation FROM head);"); cmd.ExecuteNonQuery(); }).ConfigureAwait(false); }
            finally { _writer.Release(); }
        }
    }
    private void WriteBatch(string gen, List<Entry> entries, CancellationToken ct)
    {
        using var db = Open(); using var tx = db.BeginTransaction();
        using var c = Cmd(db, "INSERT OR IGNORE INTO entries VALUES($g,$k,$id,$n,$c,$o,$v)", ("$g", gen), ("$k", ""), ("$id", ""), ("$n", ""), ("$c", ""), ("$o", 0), ("$v", "")); c.Transaction = tx; c.Prepare();
        foreach (var e in entries)
        {
            ct.ThrowIfCancellationRequested(); c.Parameters["$k"].Value = e.Kind; c.Parameters["$id"].Value = e.Id; c.Parameters["$n"].Value = e.Name; c.Parameters["$c"].Value = e.Category; c.Parameters["$o"].Value = e.Order; c.Parameters["$v"].Value = _vault.Seal(JsonSerializer.Serialize(e)); c.ExecuteNonQuery();
        }
        tx.Commit();
    }
    private void Publish(Provider p, string gen, List<Category> cats, CancellationToken ct)
    {
        using var db = Open(); using var tx = db.BeginTransaction();
        foreach (var cat in cats)
        { ct.ThrowIfCancellationRequested(); using var c = Cmd(db, "INSERT OR IGNORE INTO categories VALUES($g,$k,$id,$n,$o)", ("$g", gen), ("$k", cat.Kind), ("$id", cat.Id), ("$n", cat.Name), ("$o", cat.Order)); c.Transaction = tx; c.ExecuteNonQuery(); }
        foreach (string kind in new[] { "live", "movie", "series" })
        {
            using var old = Cmd(db, "SELECT count(*) FROM entries WHERE generation=(SELECT generation FROM head WHERE provider=$p AND fingerprint=$f) AND kind=$k", ("$p", p.Id), ("$f", p.Fingerprint), ("$k", kind)); old.Transaction = tx;
            using var next = Cmd(db, "SELECT count(*) FROM entries WHERE generation=$g AND kind=$k", ("$g", gen), ("$k", kind)); next.Transaction = tx;
            if (Convert.ToInt64(old.ExecuteScalar()) > 0 && Convert.ToInt64(next.ExecuteScalar()) == 0) throw new InvalidDataException("أحد أقسام السيرفر ناقص؛ لم نستبدل مكتبتك السابقة");
        }
        ct.ThrowIfCancellationRequested();
        using var head = Cmd(db, "INSERT INTO head VALUES($p,$g,$f) ON CONFLICT(provider) DO UPDATE SET generation=excluded.generation,fingerprint=excluded.fingerprint", ("$p", p.Id), ("$g", gen), ("$f", p.Fingerprint)); head.Transaction = tx; head.ExecuteNonQuery(); tx.Commit();
    }
    public Task<List<Category>> Categories(Provider p, string kind, CancellationToken ct = default) => Task.Run(() =>
    {
        using var db = Open(); using var c = Cmd(db, "SELECT id,name,kind,ord FROM categories WHERE generation=(SELECT generation FROM head WHERE provider=$p AND fingerprint=$f) AND kind=$k ORDER BY ord", ("$p", p.Id), ("$f", p.Fingerprint), ("$k", kind));
        using var r = c.ExecuteReader(); var result = new List<Category>(); while (r.Read()) { ct.ThrowIfCancellationRequested(); result.Add(new(r.GetString(0), r.GetString(1), r.GetString(2), r.GetInt32(3))); } return result;
    }, ct);
    public Task<CatalogPage> Read(Provider p, string kind, string? category = null, string search = "", int offset = 0, int limit = 100, CancellationToken ct = default) => Task.Run(() =>
    {
        ct.ThrowIfCancellationRequested(); using var db = Open();
        string where = "generation=(SELECT generation FROM head WHERE provider=$p AND fingerprint=$f) AND ($k='' OR kind=$k) AND ($c IS NULL OR category=$c) AND ($s='' OR instr(lower(name),lower($s))>0)";
        var values = new (string, object?)[] { ("$p", p.Id), ("$f", p.Fingerprint), ("$k", kind), ("$c", category), ("$s", search.Trim()) };
        using var count = Cmd(db, "SELECT count(*) FROM entries WHERE " + where, values); using var registration = ct.Register(count.Cancel); int total = Convert.ToInt32(count.ExecuteScalar());
        using var c = Cmd(db, "SELECT payload FROM entries WHERE " + where + " ORDER BY ord,id LIMIT $l OFFSET $o", values); c.Parameters.AddWithValue("$l", Math.Clamp(limit, 1, 500)); c.Parameters.AddWithValue("$o", Math.Max(offset, 0));
        using var r = c.ExecuteReader(); var result = new List<Entry>(); while (r.Read()) { ct.ThrowIfCancellationRequested(); result.Add(JsonSerializer.Deserialize<Entry>(_vault.Open(r.GetString(0)))!); } return new CatalogPage(result, total);
    }, ct);
    public Task<Watch?> WatchState(Provider p, Entry e) => Task.Run(() =>
    {
        using var db = Open(); using var c = Cmd(db, "SELECT position,duration,favorite,updated FROM watch WHERE provider=$p AND key=$k", ("$p", p.Id + ":" + p.Fingerprint), ("$k", e.Key)); using var r = c.ExecuteReader(); return r.Read() ? new Watch(e, r.GetInt64(0), r.GetInt64(1), r.GetInt32(2) == 1, r.GetInt64(3)) : null;
    });
    public Task SaveWatch(Provider p, Entry e, long position, long duration, bool? favorite = null) => Task.Run(() =>
    {
        using var db = Open(); using var c = Cmd(db, """
        INSERT INTO watch(provider,key,payload,position,duration,favorite,updated) VALUES($p,$k,$v,$pos,$dur,coalesce($fav,0),$time)
        ON CONFLICT(provider,key) DO UPDATE SET payload=excluded.payload,position=CASE WHEN $pos>=0 THEN excluded.position ELSE watch.position END,duration=CASE WHEN $dur>=0 THEN excluded.duration ELSE watch.duration END,favorite=coalesce($fav,watch.favorite),updated=excluded.updated
        """, ("$p", p.Id + ":" + p.Fingerprint), ("$k", e.Key), ("$v", _vault.Seal(JsonSerializer.Serialize(e))), ("$pos", position), ("$dur", duration), ("$fav", favorite is null ? null : favorite.Value ? 1 : 0), ("$time", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds())); c.ExecuteNonQuery();
    });
    public Task<IReadOnlyList<Watch>> Library(Provider p, string mode) => Task.Run<IReadOnlyList<Watch>>(() =>
    {
        using var db = Open(); string condition = mode == "favorites" ? "favorite=1" : mode == "recent" ? "key LIKE 'live:%'" : "position>30000 AND (duration<=0 OR position<duration-10000) AND key NOT LIKE 'live:%'";
        using var c = Cmd(db, "SELECT payload,position,duration,favorite,updated FROM watch WHERE provider=$p AND " + condition + " ORDER BY updated DESC LIMIT 1000", ("$p", p.Id + ":" + p.Fingerprint)); using var r = c.ExecuteReader(); var result = new List<Watch>();
        while (r.Read()) result.Add(new(JsonSerializer.Deserialize<Entry>(_vault.Open(r.GetString(0)))!, r.GetInt64(1), r.GetInt64(2), r.GetInt32(3) == 1, r.GetInt64(4))); return result;
    });
}
