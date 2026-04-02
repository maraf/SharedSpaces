using System.Globalization;
using System.Threading;

namespace SharedSpaces.Server.Features.Seeding;

public interface ISystemClock
{
    DateTime UtcNow { get; }
}

public sealed class SystemClock : ISystemClock
{
    public DateTime UtcNow => DateTime.UtcNow;
}

public sealed class IncrementingSystemClock : ISystemClock
{
    private readonly DateTime _seededUtcNow;
    private readonly long _stepTicks;
    private long _ticksOffset;

    public IncrementingSystemClock(DateTime seededUtcNow, TimeSpan step)
    {
        if (step < TimeSpan.Zero)
        {
            throw new ArgumentOutOfRangeException(nameof(step), "Deterministic time auto-advance must be zero or greater.");
        }

        _seededUtcNow = seededUtcNow.Kind switch
        {
            DateTimeKind.Utc => seededUtcNow,
            DateTimeKind.Local => seededUtcNow.ToUniversalTime(),
            _ => DateTime.SpecifyKind(seededUtcNow, DateTimeKind.Utc)
        };
        _stepTicks = step.Ticks;
    }

    public DateTime UtcNow
    {
        get
        {
            var offset = Interlocked.Add(ref _ticksOffset, _stepTicks) - _stepTicks;
            return _seededUtcNow.AddTicks(offset);
        }
    }
}

public static class SystemClockFactory
{
    public const string SeededUtcNowConfigKey = "DeterministicTime:SeededUtcNow";
    public const string AutoAdvanceSecondsConfigKey = "DeterministicTime:AutoAdvanceSeconds";

    public static ISystemClock Create(IConfiguration configuration)
    {
        var seededUtcNowValue = configuration[SeededUtcNowConfigKey];
        if (string.IsNullOrWhiteSpace(seededUtcNowValue))
        {
            return new SystemClock();
        }

        if (!DateTimeOffset.TryParse(
                seededUtcNowValue,
                CultureInfo.InvariantCulture,
                DateTimeStyles.RoundtripKind,
                out var seededUtcNow))
        {
            throw new InvalidOperationException($"{SeededUtcNowConfigKey} must be a valid ISO-8601 timestamp.");
        }

        var autoAdvanceSecondsValue = configuration[AutoAdvanceSecondsConfigKey];
        var autoAdvanceSeconds = 1;

        if (!string.IsNullOrWhiteSpace(autoAdvanceSecondsValue)
            && !int.TryParse(autoAdvanceSecondsValue, CultureInfo.InvariantCulture, out autoAdvanceSeconds))
        {
            throw new InvalidOperationException($"{AutoAdvanceSecondsConfigKey} must be a valid integer.");
        }

        return new IncrementingSystemClock(seededUtcNow.UtcDateTime, TimeSpan.FromSeconds(autoAdvanceSeconds));
    }
}
