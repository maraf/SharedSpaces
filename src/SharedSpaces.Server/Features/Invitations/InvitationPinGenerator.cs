using System.Buffers.Binary;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using SharedSpaces.Server.Features.Seeding;

namespace SharedSpaces.Server.Features.Invitations;

public interface IInvitationPinGenerator
{
    string GeneratePin();
}

public sealed class RandomInvitationPinGenerator : IInvitationPinGenerator
{
    public string GeneratePin()
    {
        return RandomNumberGenerator.GetInt32(100000, 1000000).ToString("D6", CultureInfo.InvariantCulture);
    }
}

public sealed class DeterministicInvitationPinGenerator(string seed) : IInvitationPinGenerator
{
    private readonly string _seed = string.IsNullOrWhiteSpace(seed) ? "sharedspaces-deterministic-pin-seed" : seed;
    private long _counter;

    public string GeneratePin()
    {
        var sequence = Interlocked.Increment(ref _counter) - 1;
        var payload = Encoding.UTF8.GetBytes($"{_seed}:{sequence}");
        var hash = SHA256.HashData(payload);
        var value = BinaryPrimitives.ReadUInt32LittleEndian(hash.AsSpan(0, sizeof(uint)));
        var pin = 100000u + (value % 900000u);
        return pin.ToString("D6", CultureInfo.InvariantCulture);
    }
}

public static class InvitationPinGeneratorFactory
{
    public static IInvitationPinGenerator Create(IConfiguration configuration)
    {
        var seededUtcNow = configuration[SystemClockFactory.SeededUtcNowConfigKey];
        if (string.IsNullOrWhiteSpace(seededUtcNow))
        {
            return new RandomInvitationPinGenerator();
        }

        return new DeterministicInvitationPinGenerator(seededUtcNow);
    }
}
