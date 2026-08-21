using FluentAssertions;
using SharedSpaces.Server.Features.Items;

namespace SharedSpaces.Server.Tests;

public sealed class SpaceItemExpiryTests
{
    [Fact]
    public void IsExpired_DoesNotExpireItemWithFutureSharedAt()
    {
        var now = DateTime.UtcNow;

        SpaceItemExpiry.IsExpired(now.AddSeconds(1), 60, now).Should().BeFalse();
    }

    [Fact]
    public void IsExpired_ExpiresItemAtTtlBoundary()
    {
        var now = DateTime.UtcNow;

        SpaceItemExpiry.IsExpired(now.AddSeconds(-60), 60, now).Should().BeTrue();
    }
}
