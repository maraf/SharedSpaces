using System.Security.Cryptography;
using System.Text;
using System.Threading;

namespace SharedSpaces.Server.Features.Seeding;

public interface IGuidGenerator
{
    Guid NewGuid();
}

public sealed class RandomGuidGenerator : IGuidGenerator
{
    public Guid NewGuid() => Guid.NewGuid();
}

public sealed class DeterministicGuidGenerator(string seed) : IGuidGenerator
{
    private readonly string _seed = string.IsNullOrWhiteSpace(seed) ? "sharedspaces-deterministic-guid-seed" : seed;
    private long _counter;

    public Guid NewGuid()
    {
        var sequence = Interlocked.Increment(ref _counter) - 1;
        var payload = Encoding.UTF8.GetBytes($"{_seed}:{sequence}");
        var hash = SHA256.HashData(payload);

        Span<byte> bytes = stackalloc byte[16];
        hash.AsSpan(0, bytes.Length).CopyTo(bytes);

        bytes[7] = (byte)((bytes[7] & 0x0F) | 0x50);
        bytes[8] = (byte)((bytes[8] & 0x3F) | 0x80);

        return new Guid(bytes);
    }
}

public static class GuidGeneratorFactory
{
    public static IGuidGenerator Create(IConfiguration configuration)
    {
        var seededUtcNow = configuration[SystemClockFactory.SeededUtcNowConfigKey];
        return string.IsNullOrWhiteSpace(seededUtcNow)
            ? new RandomGuidGenerator()
            : new DeterministicGuidGenerator(seededUtcNow);
    }
}
