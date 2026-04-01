using FluentAssertions;
using Microsoft.Extensions.Configuration;
using SharedSpaces.Server.Features.Seeding;

namespace SharedSpaces.Server.Tests;

public class SystemClockFactoryTests
{
    [Fact]
    public void Create_WithoutSeededUtcNow_UsesWallClock()
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection()
            .Build();

        var before = DateTime.UtcNow;
        var clock = SystemClockFactory.Create(configuration);
        var actual = clock.UtcNow;
        var after = DateTime.UtcNow;

        clock.Should().BeOfType<SystemClock>();
        actual.Should().BeOnOrAfter(before.AddSeconds(-1));
        actual.Should().BeOnOrBefore(after.AddSeconds(1));
    }

    [Fact]
    public void Create_WithSeededUtcNow_UsesDefaultOneSecondAutoAdvance()
    {
        const string seededUtcNow = "2025-03-19T12:00:00Z";
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                [SystemClockFactory.SeededUtcNowConfigKey] = seededUtcNow
            })
            .Build();

        var clock = SystemClockFactory.Create(configuration);

        clock.Should().BeOfType<IncrementingSystemClock>();
        clock.UtcNow.Should().Be(DateTime.Parse(seededUtcNow, null, System.Globalization.DateTimeStyles.RoundtripKind).ToUniversalTime());
        clock.UtcNow.Should().Be(DateTime.Parse(seededUtcNow, null, System.Globalization.DateTimeStyles.RoundtripKind).ToUniversalTime().AddSeconds(1));
    }

    [Fact]
    public void Create_WithAutoAdvanceSeconds_UsesConfiguredIncrement()
    {
        const string seededUtcNow = "2025-03-19T12:00:00Z";
        var seeded = DateTime.Parse(seededUtcNow, null, System.Globalization.DateTimeStyles.RoundtripKind).ToUniversalTime();
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                [SystemClockFactory.SeededUtcNowConfigKey] = seededUtcNow,
                [SystemClockFactory.AutoAdvanceSecondsConfigKey] = "60"
            })
            .Build();

        var clock = SystemClockFactory.Create(configuration);

        clock.Should().BeOfType<IncrementingSystemClock>();
        clock.UtcNow.Should().Be(seeded);
        clock.UtcNow.Should().Be(seeded.AddMinutes(1));
        clock.UtcNow.Should().Be(seeded.AddMinutes(2));
    }
}
